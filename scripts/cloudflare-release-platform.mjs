import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assetManifest, fileHash } from './cloudflare-artifacts.mjs';
import { canUseVerifiedSource } from './cloudflare-source-proof.mjs';
import { executionFlags, ReleaseError } from './cloudflare-release-state.mjs';

const origin = 'https://recap.filternode.dev';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const requireState = (condition, code) => { if (!condition) throw new ReleaseError(code); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const changingVars = new Set([...executionFlags, 'RELEASE_SHA', 'HOSTING_MODE', 'SOURCE_TRANSPORT_VERIFIED']);
export const bindingHash = bindings => createHash('sha256').update(JSON.stringify(canonical(bindings.filter(item => item.type !== 'plain_text' || !changingVars.has(item.name)).sort((a, b) => a.name.localeCompare(b.name))))).digest('hex');
const text = (bindings, name) => bindings.find(item => item.name === name)?.text;

export function checkedArtifact(root) {
  const build = join(root, '.local/cloudflare-build'), artifact = JSON.parse(readFileSync(join(build, 'release.json'), 'utf8'));
  requireState(/^[a-f0-9]{40}$/.test(artifact.release || '') && ['shadow', 'active'].includes(artifact.mode), 'invalid_release_artifact');
  if (artifact.mode === 'active') requireState(JSON.stringify(artifact.publicConfig) === JSON.stringify(JSON.parse(readFileSync(join(root, 'cloudflare/verified-public-config.json'), 'utf8'))), 'release_public_configuration_changed');
  requireState(JSON.stringify(assetManifest(join(root, 'dist-cloudflare'))) === JSON.stringify(artifact.assets), 'release_assets_changed');
  for (const kind of ['web', 'jobs']) requireState(fileHash(join(build, kind, kind + '.js')) === artifact.hashes[kind], 'release_worker_changed');
  for (const kind of ['web', 'jobs', 'source']) requireState(fileHash(join(build, kind + '.json')) === artifact.configs[kind], 'release_configuration_changed');
  requireState(fileHash(join(build, 'source-worker/source.js')) === artifact.hashes.sourceWorker, 'release_source_changed');
  requireState(createHash('sha256').update(readFileSync(join(build, 'source-container/server.mjs'))).update(readFileSync(join(build, 'source-container/Dockerfile'))).digest('hex') === artifact.hashes.sourceContainer, 'release_source_changed');
  return artifact;
}

export class ReleasePlatform {
  constructor({ root, account, token, databaseKey, fetcher = fetch, runner }) {
    requireState(/^[a-f0-9]{32}$/.test(account || '') && token, 'release_credentials_missing');
    Object.assign(this, { root, account, token, databaseKey, fetcher });
    this.runner = runner || (args => execFileSync('npx', args, { cwd: root, env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  }
  async cf(path, body, method) {
    const response = await this.fetcher('https://api.cloudflare.com/client/v4/accounts/' + this.account + path, {
      method: method || (body ? 'POST' : 'GET'), headers: { authorization: 'Bearer ' + this.token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const data = await response.json(); requireState(response.ok && data.success !== false, 'cloudflare_release_request_failed'); return data.result;
  }
  async rpc(name, args = {}) {
    requireState(this.databaseKey && ['read_hosting_release_status', 'quiesce_hosting_release_checked', 'advance_hosting_release_checked'].includes(name), 'release_database_unconfigured');
    const response = await this.fetcher('https://zlfdqzabsfndifxiqguo.supabase.co/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: this.databaseKey, authorization: 'Bearer ' + this.databaseKey, 'content-type': 'application/json' }, body: JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); throw new ReleaseError('release_database_request_failed'); }
    return response.json();
  }
  status() { return this.rpc('read_hosting_release_status'); }
  async current(kind) {
    requireState(['web', 'jobs', 'source'].includes(kind), 'invalid_worker_kind');
    const [settings, deployments] = await Promise.all([this.cf('/workers/scripts/therecap-' + kind + '/settings'), this.cf('/workers/scripts/therecap-' + kind + '/deployments')]);
    const versions = deployments.deployments?.[0]?.versions;
    requireState(versions?.length === 1 && versions[0].percentage === 100 && uuid(versions[0].version_id), 'release_split_traffic_unsupported');
    const bindings = settings.bindings;
    if (kind !== 'source') requireState(text(bindings, 'APP_URL') === origin && text(bindings, 'CONTEXT') === 'production', 'release_origin_configuration_changed');
    return { version: versions[0].version_id, mode: text(bindings, 'HOSTING_MODE'), release: text(bindings, 'RELEASE_SHA'), sourceVerified: text(bindings, 'SOURCE_TRANSPORT_VERIFIED') === 'true', flags: Object.fromEntries(executionFlags.map(flag => [flag, text(bindings, flag)])), bindingsHash: bindingHash(bindings), enabled: text(bindings, 'SOURCE_TRANSPORT_ENABLED') === 'true' ? true : text(bindings, 'SOURCE_TRANSPORT_ENABLED') === 'false' ? false : null, hasSecrets: bindings.some(item => item.type === 'secret_text') };
  }
  async source(artifact) {
    const proof = JSON.parse(readFileSync(join(this.root, 'cloudflare/verified-source.json'), 'utf8'));
    const [current, applications, domains, route] = await Promise.all([this.current('source'), this.cf('/containers/applications'), this.cf('/workers/domains'), this.cf('/workers/scripts/therecap-source/subdomain')]);
    const app = applications.find(item => item.name === 'therecap-source-sourcedownloader');
    const live = { ...current, image: app?.configuration?.image?.split('@sha256:')[1], maximumInstances: app?.max_instances, publicRoute: !(route.enabled === false && route.previews_enabled === false && !domains.some(item => item.service === 'therecap-source')) };
    return { verified: canUseVerifiedSource(artifact, proof, live), pin: { version: live.version, image: live.image, workerHash: proof.workerHash, containerHash: proof.containerHash, enabled: live.enabled }, domain: domains.find(item => item.hostname === 'recap.filternode.dev' && item.service === 'therecap-web')?.hostname };
  }
  async snapshot(artifact) {
    const [web, jobs, source, status] = await Promise.all([this.current('web'), this.current('jobs'), this.source(artifact), this.status()]);
    return { ...status, workers: { web, jobs }, sourceVerified: source.verified, sourcePin: source.pin, domain: source.domain };
  }
  async assertSource(plan, artifact) {
    const source = await this.source(artifact);
    requireState(source.verified && source.domain === 'recap.filternode.dev' && JSON.stringify(source.pin) === JSON.stringify(plan.sourcePin), 'release_source_drift');
  }
  async preflight(plan, artifact) {
    checkedArtifact(this.root); await this.assertSource(plan, artifact);
    const snapshot = await this.snapshot(artifact);
    for (const kind of ['jobs', 'web']) requireState(snapshot.workers[kind].version === plan.priorVersions[kind] && snapshot.workers[kind].mode === 'active' && snapshot.workers[kind].release === plan.expected.release && snapshot.workers[kind].bindingsHash === plan.bindings[kind] && executionFlags.every(flag => snapshot.workers[kind].flags[flag] === plan.policy[flag]), 'release_worker_drift');
  }
  async assertVersion(kind, version, artifact, policy, mode, bindingsHashExpected) {
    requireState(uuid(version), 'invalid_uploaded_version');
    const data = await this.cf('/workers/scripts/therecap-' + kind + '/versions/' + version), bindings = data.resources?.bindings || [];
    requireState(text(bindings, 'RELEASE_SHA') === artifact.release && text(bindings, 'HOSTING_MODE') === mode && text(bindings, 'SOURCE_TRANSPORT_VERIFIED') === (mode === 'active' ? 'true' : 'false'), 'uploaded_version_configuration_changed');
    requireState(executionFlags.every(flag => text(bindings, flag) === policy[flag]) && bindingHash(bindings) === bindingsHashExpected, 'uploaded_version_bindings_changed');
    return version;
  }
  async uploadVersion(kind, artifact, policy, mode, bindingsHashExpected, operation) {
    requireState(['web', 'jobs'].includes(kind) && ['active', 'shadow'].includes(mode) && (mode !== 'active' || artifact.mode === 'active'), 'invalid_version_upload');
    if (mode === 'shadow') requireState(executionFlags.every(flag => policy[flag] === 'false'), 'shadow_execution_forbidden');
    const message = 'therecap:' + operation + ':' + kind;
    const list = await this.cf('/workers/scripts/therecap-' + kind + '/versions');
    const found = list.items?.find(item => item.annotations?.['workers/message'] === message);
    if (found) return this.assertVersion(kind, found.id, artifact, policy, mode, bindingsHashExpected);
    const config = JSON.parse(readFileSync(join(this.root, '.local/cloudflare-build/' + kind + '.json'), 'utf8'));
    requireState(config.vars.RELEASE_SHA === artifact.release, 'release_configuration_changed');
    const settings = await this.cf('/workers/scripts/therecap-' + kind + '/settings');
    requireState(bindingHash(settings.bindings) === bindingsHashExpected, 'release_worker_drift');
    config.vars = { ...Object.fromEntries(settings.bindings.filter(item => item.type === 'plain_text').map(item => [item.name, item.text])), ...policy, RELEASE_SHA: artifact.release, HOSTING_MODE: mode, SOURCE_TRANSPORT_VERIFIED: mode === 'active' ? 'true' : 'false' };
    config.main = join(this.root, '.local/cloudflare-build/' + kind + '/' + kind + '.js');
    if (config.assets) config.assets.directory = join(this.root, 'dist-cloudflare');
    // Versions do not change triggers, consumer configuration or the source.
    const path = join(this.root, '.local/cloudflare-build/' + kind + '.version.json'); writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
    let output;
    try { output = await this.runner(['wrangler', 'versions', 'upload', '--no-bundle', '--config', path, '--profile', 'therecap-migration-api', '--message', message]); }
    catch { throw new ReleaseError('release_version_upload_uncertain'); }
    const version = output.match(/(?:Worker )?Version ID:\s*([a-f0-9-]{36})/)?.[1];
    requireState(uuid(version), 'release_version_upload_uncertain');
    return this.assertVersion(kind, version, artifact, policy, mode, bindingsHashExpected);
  }
  async promoteVersion(kind, version, allowedCurrent) {
    requireState(['web', 'jobs'].includes(kind) && uuid(version), 'invalid_version_promotion');
    const current = await this.current(kind);
    requireState([version, ...allowedCurrent].includes(current.version), 'release_worker_drift');
    if (current.version !== version) await this.cf('/workers/scripts/therecap-' + kind + '/deployments', { strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }] });
    requireState((await this.current(kind)).version === version, 'release_promotion_unverified');
  }
  async verify(plan, artifact, versions, mode = 'active') {
    checkedArtifact(this.root); await this.assertSource(plan, artifact);
    for (const kind of ['jobs', 'web']) {
      const current = await this.current(kind);
      requireState(current.version === versions[kind], 'release_promotion_unverified');
      await this.assertVersion(kind, current.version, artifact, plan.policy, mode, plan.bindings[kind]);
    }
    const response = await this.fetcher(origin + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const health = await response.json(); requireState(response.status === 200 && health.hosting?.release === artifact.release && health.hosting.mode === mode, 'release_health_unverified');
    const assets = Object.entries(artifact.assets).filter(([name]) => !['_headers', 'robots.txt'].includes(name));
    let position = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (position < assets.length) { const [name, expected] = assets[position++]; const path = name === 'index.html' ? '/' : '/' + name; const result = await this.fetcher(origin + path, { redirect: 'follow', signal: AbortSignal.timeout(15000) }); requireState(result.ok && createHash('sha256').update(new Uint8Array(await result.arrayBuffer())).digest('hex') === expected, 'release_asset_unverified'); } }));
    return true;
  }
}
