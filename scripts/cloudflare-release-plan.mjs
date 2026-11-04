import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assetManifest, fileHash } from './cloudflare-artifacts.mjs';
import { executionFlags, planRelease } from './cloudflare-release-state.mjs';

// Read-only command. No pause, deployment, source request, queue send, ownership
// transition, secret rotation or retirement is reachable from this entrypoint.
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.slice(2).length) throw new Error('release_plan_is_read_only');
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID, key = process.env.SUPABASE_SECRET_KEY;
  if (!token || !/^[a-f0-9]{32}$/.test(account || '') || !key) throw new Error('release_credentials_missing');
  const cf = async path => {
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, { headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok || result.success === false) throw new Error('release_provider_read_failed'); return result.result;
  };
  const artifact = JSON.parse(readFileSync(root + '.local/cloudflare-build/release.json', 'utf8'));
  if (JSON.stringify(assetManifest(root + 'dist-cloudflare')) !== JSON.stringify(artifact.assets)) throw new Error('release_assets_changed');
  for (const kind of ['web', 'jobs']) if (fileHash(root + '.local/cloudflare-build/' + kind + '/' + kind + '.js') !== artifact.hashes[kind]) throw new Error('release_worker_changed');
  for (const kind of ['web', 'jobs', 'source']) if (fileHash(root + '.local/cloudflare-build/' + kind + '.json') !== artifact.configs[kind]) throw new Error('release_configuration_changed');
  if (fileHash(root + '.local/cloudflare-build/source-worker/source.js') !== artifact.hashes.sourceWorker
    || createHash('sha256').update(readFileSync(root + '.local/cloudflare-build/source-container/server.mjs')).update(readFileSync(root + '.local/cloudflare-build/source-container/Dockerfile')).digest('hex') !== artifact.hashes.sourceContainer) throw new Error('release_source_changed');
  const proof = JSON.parse(readFileSync(root + 'cloudflare/verified-source.json', 'utf8'));
  const worker = async name => {
    const [settings, deployments] = await Promise.all([cf('/workers/scripts/' + name + '/settings'), cf('/workers/scripts/' + name + '/deployments')]);
    const versions = deployments.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100) throw new Error('release_split_traffic_unsupported');
    const text = name => settings.bindings.find(item => item.name === name)?.text;
    return { version: versions[0].version_id, mode: text('HOSTING_MODE'), release: text('RELEASE_SHA'), sourceVerified: text('SOURCE_TRANSPORT_VERIFIED') === 'true', flags: Object.fromEntries(executionFlags.map(flag => [flag, text(flag)])), hasSecrets: settings.bindings.some(item => item.type === 'secret_text') };
  };
  const statusRequest = fetch('https://zlfdqzabsfndifxiqguo.supabase.co/rest/v1/rpc/read_hosting_release_status', {
    method: 'POST', headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(15000),
  }).then(async response => { if (!response.ok) { await response.body?.cancel(); throw new Error('release_status_unavailable'); } return response.json(); });
  const [web, jobs, source, applications, domains, sourceRoute, status] = await Promise.all([
    worker('therecap-web'), worker('therecap-jobs'), worker('therecap-source'), cf('/containers/applications'), cf('/workers/domains'), cf('/workers/scripts/therecap-source/subdomain'), statusRequest,
  ]);
  const app = applications.find(item => item.name === 'therecap-source-sourcedownloader');
  const image = app?.configuration?.image?.split('@sha256:')[1];
  const sourceVerified = proof.schema === 1 && proof.hostedChecks === 10 && source.version === proof.version && image === proof.image && app.max_instances === 1 && sourceRoute.enabled === false && sourceRoute.previews_enabled === false && !domains.some(item => item.service === 'therecap-source') && !source.hasSecrets;
  const plan = planRelease(artifact, { ...status, workers: { web, jobs }, sourceVerified, sourcePin: proof, domain: domains.find(item => item.hostname === 'recap.filternode.dev' && item.service === 'therecap-web')?.hostname });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // This additional report gate cannot be removed by interpreting a green PR
  // as approval to activate the old-host-unfenced shadow deployment.
  console.log(JSON.stringify({ recorded_at: new Date().toISOString(), read_only: true, repository_head: head, artifact_matches_head: artifact.release === head, ready_for_release: plan.blockers.length === 0 && artifact.release === head, plan }, null, 2));
} catch (error) {
  const code = error instanceof Error && /^[a-z_]{1,80}$/.test(error.message) ? error.message : 'release_preflight_unavailable';
  console.error(JSON.stringify({ read_only: true, error: code })); process.exitCode = 1;
}
