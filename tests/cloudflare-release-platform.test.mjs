import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindingHash, ReleasePlatform } from '../scripts/cloudflare-release-platform.mjs';
import { executionFlags } from '../scripts/cloudflare-release-state.mjs';
const ids = { prior: '11111111-1111-4111-8111-111111111111', uploaded: '22222222-2222-4222-8222-222222222222', other: '33333333-3333-4333-8333-333333333333' };
const release = 'a'.repeat(40), policy = Object.fromEntries(executionFlags.map(flag => [flag, 'false']));
const textBindings = vars => Object.entries(vars).map(([name, text]) => ({ name, type: 'plain_text', text }));
let root;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = null; });
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'recap-release-')); mkdirSync(join(root, '.local/cloudflare-build'), { recursive: true });
  const vars = { APP_URL: 'https://recap.filternode.dev', CONTEXT: 'production', RELEASE_SHA: release, HOSTING_MODE: 'shadow', SOURCE_TRANSPORT_VERIFIED: 'false', ...policy };
  writeFileSync(join(root, '.local/cloudflare-build/web.json'), JSON.stringify({ main: 'unused', vars, assets: { directory: 'unused' } }));
  const extra = [{ name: 'SUPABASE_SECRET_KEY', type: 'secret_text' }, { name: 'SOURCE_DOWNLOADER', type: 'service', service: 'therecap-source', environment: 'production' }];
  const settings = { bindings: [...textBindings({ ...vars, PRIVATE_OPERATOR_BOUND: 'fixture-existing-bound' }), ...extra] };
  let current = ids.prior, uploaded = null, uploads = 0; const posts = [];
  const response = result => Response.json({ success: true, result });
  const fetcher = async (input, init = {}) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/settings')) return response(settings);
    if (path.endsWith('/versions/' + ids.uploaded)) return response({ id: ids.uploaded, resources: { bindings: uploaded.bindings } });
    if (path.endsWith('/versions')) return response({ items: uploaded ? [{ id: ids.uploaded, annotations: { 'workers/message': uploaded.message } }] : [] });
    if (path.endsWith('/deployments')) {
      if (init.method === 'POST') { const body = JSON.parse(init.body); posts.push(body); current = body.versions[0].version_id; }
      return response({ deployments: [{ versions: [{ version_id: current, percentage: 100 }] }] });
    }
    throw new Error('Unexpected fake provider endpoint');
  };
  const runner = args => {
    uploads++; const config = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
    expect(config.vars.PRIVATE_OPERATOR_BOUND).toBe('fixture-existing-bound'); expect(JSON.stringify(config)).not.toContain('fixture-secret-value');
    uploaded = { bindings: [...textBindings(config.vars), ...extra], message: args[args.indexOf('--message') + 1] };
    return 'Uploaded therecap-web\nWorker Version ID: ' + ids.uploaded;
  };
  const platform = new ReleasePlatform({ root, account: '0'.repeat(32), token: 'fixture-token', fetcher, runner });
  return { platform, settings, hash: () => bindingHash(settings.bindings), posts, uploads: () => uploads, setCurrent: value => { current = value; }, setRunner: value => { platform.runner = value; }, runner };
}
describe('real release provider adapter with isolated transport', () => {
  it('fingerprints secret/service/queue/ordinary variable bindings independently of JSON key order', () => {
    const a = [{ type: 'secret_text', name: 'server-key' }, { name: 'bound', type: 'plain_text', text: 'fixture-bound' }];
    const b = [{ text: 'fixture-bound', type: 'plain_text', name: 'bound' }, { name: 'server-key', type: 'secret_text' }];
    expect(bindingHash(a)).toBe(bindingHash(b)); expect(bindingHash(a)).not.toBe(bindingHash(a.slice(1)));
    expect(bindingHash(a)).not.toBe(bindingHash([{ ...a[1], text: 'changed' }, a[0]]));
  });
  it('uploads exact policy, preserves unknown bounds and inherited secret inventory, and reuses a marked version', async () => {
    const f = fixture(), artifact = { release, mode: 'shadow' };
    expect(await f.platform.uploadVersion('web', artifact, policy, 'shadow', f.hash(), 'fixture-operation')).toBe(ids.uploaded);
    expect(await f.platform.uploadVersion('web', artifact, policy, 'shadow', f.hash(), 'fixture-operation')).toBe(ids.uploaded);
    expect(f.uploads()).toBe(1); expect(f.posts).toHaveLength(0);
  });
  it('reconciles an upload response lost after the provider retained the version', async () => {
    const f = fixture(), artifact = { release, mode: 'shadow' };
    f.setRunner(args => { f.runner(args); throw new Error('private transport failure'); });
    await expect(f.platform.uploadVersion('web', artifact, policy, 'shadow', f.hash(), 'fixture-operation')).rejects.toThrow('release_version_upload_uncertain');
    expect(await f.platform.uploadVersion('web', artifact, policy, 'shadow', f.hash(), 'fixture-operation')).toBe(ids.uploaded); expect(f.uploads()).toBe(1);
  });
  it('refuses source uploads, shadow execution flags and active uploads of guest artifacts', async () => {
    const f = fixture(), artifact = { release, mode: 'shadow' };
    await expect(f.platform.uploadVersion('source', artifact, policy, 'shadow', f.hash(), 'x')).rejects.toThrow('invalid_version_upload');
    await expect(f.platform.uploadVersion('web', artifact, { ...policy, SOCIAL_COLLECTION_ENABLED: 'true' }, 'shadow', f.hash(), 'x')).rejects.toThrow('shadow_execution_forbidden');
    await expect(f.platform.uploadVersion('web', artifact, policy, 'active', f.hash(), 'x')).rejects.toThrow('invalid_version_upload'); expect(f.uploads()).toBe(0);
  });
  it('refuses secret/bound drift before upload or promotion', async () => {
    const f = fixture();
    await expect(f.platform.uploadVersion('web', { release, mode: 'shadow' }, policy, 'shadow', 'bad-hash', 'x')).rejects.toThrow('release_worker_drift');
    f.setCurrent(ids.other); await expect(f.platform.promoteVersion('web', ids.uploaded, [ids.prior])).rejects.toThrow('release_worker_drift'); expect(f.uploads()).toBe(0); expect(f.posts).toHaveLength(0);
  });
  it('promotes a specific version at 100 percent and makes retries read-only', async () => {
    const f = fixture(); await f.platform.promoteVersion('web', ids.uploaded, [ids.prior]); await f.platform.promoteVersion('web', ids.uploaded, [ids.prior]);
    expect(f.posts).toEqual([{ strategy: 'percentage', versions: [{ version_id: ids.uploaded, percentage: 100 }] }]);
    await expect(f.platform.promoteVersion('source', ids.uploaded, [ids.prior])).rejects.toThrow('invalid_version_promotion');
  });
});
