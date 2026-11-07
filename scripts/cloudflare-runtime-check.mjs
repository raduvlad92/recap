import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { build } from 'esbuild';
const release = JSON.parse(readFileSync('.local/cloudflare-build/release.json', 'utf8')).release;
const config = JSON.parse(readFileSync('.local/cloudflare-build/web.json', 'utf8'));
// Exercise the actual Wrangler-bundled Worker under workerd. No credentials,
// source traffic, live database or queue binding is available in this harness.
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: '.local/cloudflare-build/web/web.js',
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: config.vars,
  serviceBindings: { ASSETS: async () => new Response('<!doctype html><title>Workspace fixture</title>') },
  outboundService: async () => { throw new Error('Outbound networking is prohibited in the runtime harness'); },
}));
let checks = 0;
try {
  const health = await mf.dispatchFetch('https://recap.filternode.dev/api/health');
  assert.equal(health.status, 200); const body = await health.json();
  assert.equal(body.hosting.release, release); assert.equal(body.hosting.mode, 'shadow'); checks++;
  const account = await mf.dispatchFetch('https://recap.filternode.dev/api/migration-verification');
  assert.equal(account.status, 401); assert.equal(account.headers.get('cache-control'), 'no-store'); checks++;
  assert.equal((await mf.dispatchFetch('https://recap.filternode.dev/api/migration-verification', { method: 'POST' })).status, 405); checks++;
  for (const path of ['/api/admin', '/api/collect', '/api/keyword-learning', '/api/daily-briefings', '/.netlify/functions/keyword-learning-worker']) {
    const response = await mf.dispatchFetch('https://recap.filternode.dev' + path);
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store'); checks++;
  }
  for (const path of ['/api/unknown', '/api/nested/path', '/.netlify/functions/social-collection-worker', '/.netlify/functions/hourly-collection']) {
    const response = await mf.dispatchFetch('https://recap.filternode.dev' + path);
    assert.equal(response.status, 404); assert.match(response.headers.get('content-type'), /json/); checks++;
  }
  const catalogue = await mf.dispatchFetch('https://recap.filternode.dev/creators/');
  assert.equal(catalogue.status, 503); assert.match(catalogue.headers.get('content-type'), /html/); assert.equal(catalogue.headers.get('cache-control'), 'no-store'); checks++;
  const redirect = await mf.dispatchFetch('https://recap.filternode.dev/creators', { redirect: 'manual' });
  assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), 'https://recap.filternode.dev/creators/'); checks++;
  const app = await mf.dispatchFetch('https://recap.filternode.dev/admin/');
  assert.equal(app.status, 200); assert.equal(app.headers.get('x-frame-options'), 'DENY'); assert.match(app.headers.get('x-robots-tag'), /noindex/); checks++;
  const robots = await mf.dispatchFetch('https://recap.filternode.dev/robots.txt');
  assert.match(robots.headers.get('x-robots-tag'), /noindex/); assert.equal(robots.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await robots.text(), /Sitemap: https:\/\/recap\.filternode\.dev\/sitemap\.xml/); checks++;
  console.log(JSON.stringify({ runtime: 'workerd', checks, passed: true, outboundNetwork: 'blocked', productionCredentials: false }));
} finally { await mf.dispose(); }
// Full protected path in the actual bundled runtime, using only ephemeral
// signing keys and fake provider responses. No real identity/database traffic.
const origin = 'https://recap.filternode.dev', issuer = 'https://clerk.fixture.invalid';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'runtime-fixture', alg: 'RS256', use: 'sig' };
const sign = subject => new SignJWT({ azp: origin }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
let redirectRpc = false, fixturePaused = true;
const outbound = [];
const accountRuntime = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: '.local/cloudflare-build/web/web.js',
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ...config.vars, CLERK_ISSUER_URL: issuer, CLERK_SECRET_KEY: 'fixture-only-clerk-secret', ADMIN_USER_IDS: 'fixture-owner', VITE_SUPABASE_URL: 'https://zlfdqzabsfndifxiqguo.supabase.co', SUPABASE_SECRET_KEY: 'fixture-only-database-secret' },
  outboundService: async request => {
    const url = new URL(request.url); outbound.push({ origin: url.origin, path: url.pathname });
    if (url.href === issuer + '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    if (url.origin === 'https://api.clerk.com' && ['/v1/users/fixture-owner', '/v1/users/fixture-reader'].includes(url.pathname)) return Response.json({ id: url.pathname.split('/').at(-1), email_addresses: [], primary_email_address_id: null, banned: false, locked: false });
    if (url.origin === 'https://zlfdqzabsfndifxiqguo.supabase.co' && url.pathname === '/rest/v1/rpc/read_hosting_runtime') {
      assert.equal(request.method, 'POST'); assert.equal(await request.text(), '{}');
      if (redirectRpc) return new Response(null, { status: 302, headers: { location: 'https://must-not-receive-secrets.invalid/' } });
      return Response.json({ owner: 'netlify', epoch: 1, paused: fixturePaused, old_host_fenced: false, release: '0'.repeat(40) });
    }
    if (url.origin === 'https://zlfdqzabsfndifxiqguo.supabase.co' && url.pathname === '/rest/v1/reader_workspaces') {
      assert.equal(request.method, 'HEAD'); assert.equal(url.searchParams.get('user_id'), 'eq.fixture-owner');
      return new Response(null, { headers: { 'content-range': '0-0/1' } });
    }
    throw new Error('Unexpected outbound destination in protected runtime check');
  },
}));
try {
  const headers = { authorization: 'Bearer ' + await sign('fixture-owner'), origin };
  const path = origin + '/api/migration-verification';
  const positive = await accountRuntime.dispatchFetch(path, { headers });
  assert.equal(positive.status, 200); assert.deepEqual(await positive.json(), { authenticated: true, administrator: true, workspacePresent: true, processingPaused: true, release }); checks++;
  assert.equal((await accountRuntime.dispatchFetch(path, { headers: { ...headers, origin: 'https://foreign.invalid' } })).status, 403); checks++;
  assert.equal((await accountRuntime.dispatchFetch(path, { headers: { authorization: 'Bearer ' + await sign('fixture-reader'), origin } })).status, 403); checks++;
  fixturePaused = false;
  assert.equal((await accountRuntime.dispatchFetch(path, { headers })).status, 503); checks++;
  fixturePaused = true; redirectRpc = true;
  const redirected = await accountRuntime.dispatchFetch(path, { headers });
  assert.equal(redirected.status, 503); assert.equal((await redirected.json()).error.code, 'hosting_state_unavailable');
  assert(outbound.every(item => !item.origin.includes('must-not-receive-secrets'))); checks++;
  console.log(JSON.stringify({ runtime: 'workerd', protectedAccountChecks: 5, totalWebChecks: checks, liveProviderRequests: 0, redirectedCredentials: false }));
} finally { await accountRuntime.dispose(); }
// The real void RPC returns 204, rather than JSON null. Exercise both successful
// and rejected HTTP handlers through actual admission and lease completion.
let activeStateEmpty = false, finishFailure = false, activeFinishes = 0;
const activeRuntime = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: '.local/cloudflare-build/web/web.js',
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ...config.vars, HOSTING_MODE: 'active', SOURCE_TRANSPORT_VERIFIED: 'true', CLERK_ISSUER_URL: issuer, CLERK_SECRET_KEY: 'fixture-only-clerk-secret', ADMIN_USER_IDS: 'fixture-owner', VITE_SUPABASE_URL: 'https://zlfdqzabsfndifxiqguo.supabase.co', SUPABASE_SECRET_KEY: 'fixture-only-database-secret' },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.href === issuer + '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    if (url.href === 'https://api.clerk.com/v1/users/fixture-owner') return Response.json({ id: 'fixture-owner', email_addresses: [], primary_email_address_id: null, banned: false, locked: false });
    assert.equal(url.origin, 'https://zlfdqzabsfndifxiqguo.supabase.co'); assert.equal(request.method, 'POST');
    const name = url.pathname.split('/').at(-1);
    if (name === 'read_hosting_runtime') return activeStateEmpty ? new Response(null, { status: 204 }) : Response.json({ owner: 'cloudflare', epoch: 2, paused: false, old_host_fenced: true, release });
    if (name === 'admit_hosting_work') return Response.json(true);
    if (name === 'begin_hosting_work') return Response.json({ token: 'fixture-http-lease' });
    if (name === 'finish_hosting_work') {
      assert.equal((await request.json()).p_completed, true); activeFinishes++;
      return new Response(null, { status: finishFailure ? 503 : 204 });
    }
    throw new Error('Unexpected active HTTP/provider request');
  },
}));
try {
  const headers = { authorization: 'Bearer ' + await sign('fixture-owner'), origin };
  const access = await activeRuntime.dispatchFetch(origin + '/api/admin?section=access', { headers });
  assert.equal(access.status, 200); assert.deepEqual(await access.json(), { authorized: true }); checks++;
  const method = await activeRuntime.dispatchFetch(origin + '/api/keyword-learning', { headers });
  assert.equal(method.status, 405); assert.equal(activeFinishes, 2); checks++;
  assert.equal((await activeRuntime.dispatchFetch(origin + '/api/admin')).status, 401); assert.equal(activeFinishes, 2); checks++;
  activeStateEmpty = true;
  const empty = await activeRuntime.dispatchFetch(origin + '/api/admin', { headers });
  assert.equal(empty.status, 503); assert.equal((await empty.json()).error.code, 'hosting_state_unavailable'); checks++;
  activeStateEmpty = false; finishFailure = true;
  const unfinished = await activeRuntime.dispatchFetch(origin + '/api/admin?section=access', { headers });
  assert.equal(unfinished.status, 503); assert.equal((await unfinished.json()).error.code, 'hosting_state_unavailable'); checks++;
  console.log(JSON.stringify({ runtime: 'workerd', activeHttpCompletionChecks: 5, totalWebChecks: checks, liveProviderRequests: 0, nativeVoidStatus: 204 }));
} finally { await activeRuntime.dispose(); }
// Timer/queue handlers run without a browser request context. Exercise their
// actual exports under workerd with fake RPCs and no provider/queue admission.
await build({ entryPoints: ['tests/fixtures/cloudflare-jobs-runtime.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*'], outfile: '.local/cloudflare-build/jobs-fixture.js' });
let jobsPaused = false, jobsRedirect = false, jobsClaim = false, jobsCompleted = true, jobsSuperseded = false;
const jobCalls = [];
const jobRuntime = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: '.local/cloudflare-build/jobs-fixture.js',
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ...config.vars, HOSTING_MODE: 'active', SOURCE_TRANSPORT_VERIFIED: 'true', HOURLY_COLLECTION_ENABLED: 'true', HOURLY_COLLECTION_WORKER_SECRET: 'fixture-only-hourly-worker-secret-32-characters', VITE_SUPABASE_URL: 'https://zlfdqzabsfndifxiqguo.supabase.co', SUPABASE_SECRET_KEY: 'fixture-only-database-secret' },
  outboundService: async request => {
    const url = new URL(request.url), name = url.pathname.split('/').at(-1);
    assert.equal(url.origin, 'https://zlfdqzabsfndifxiqguo.supabase.co');
    assert.equal(request.method, 'POST'); jobCalls.push(name);
    if (name === 'read_hosting_release_status') return Response.json({ control: { owner: 'cloudflare', epoch: 2, paused: jobsPaused, old_host_fenced: true, release }, revision: '11111111-1111-4111-8111-111111111111' });
    if (name === 'read_hosting_runtime') {
      if (jobsRedirect) return new Response(null, { status: 302, headers: { location: 'https://must-not-receive-secrets.invalid/' } });
      return Response.json({ owner: 'cloudflare', epoch: 2, paused: jobsPaused, old_host_fenced: true, release });
    }
    if (name === 'begin_hosting_work') return Response.json(jobsClaim ? { token: 'fixture-queue-lease', payload: null } : null);
    if (name === 'begin_automatic_hosting_queue_work') {
      assert.deepEqual(await request.json(), { p_key: 'cron:automatic-content:2:1', p_epoch: 2, p_release: release, p_message_id: 'fixture-native-message' });
      return Response.json(jobsSuperseded ? { superseded: true, recovery_required: true } : jobsClaim ? { token: 'fixture-queue-lease', payload: null, revision: '11111111-1111-4111-8111-111111111111' } : null);
    }
    if (name === 'finish_hosting_work' || name === 'finish_automatic_hosting_queue_work') {
      const args = await request.json();
      assert.equal(args.p_completed, jobsCompleted);
      if (name === 'finish_automatic_hosting_queue_work') {
        assert.equal(args.p_message_id, 'fixture-native-message'); assert.equal(args.p_release, release);
      }
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected job admission/provider request in runtime fixture');
  },
}));
try {
  const cron = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/cron');
  assert.equal(cron.status, 200, 'Timer result: ' + await cron.clone().text()); assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime']);
  const stale = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/stale');
  assert.deepEqual(await stale.json(), { completed: true, acknowledgements: 1, retries: [] }); assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime']);
  jobsPaused = true;
  const paused = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/queue');
  assert.deepEqual(await paused.json(), { completed: true, acknowledgements: 0, retries: [300] }); assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime']);
  jobsPaused = false;
  const duplicate = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/queue');
  assert.deepEqual(await duplicate.json(), { completed: true, acknowledgements: 1, retries: [] }); assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime', 'begin_hosting_work']);
  jobsClaim = true;
  for (const path of ['/completed','/failed']) {
    jobsCompleted = path === '/completed';
    const finished = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid' + path);
    assert.deepEqual(await finished.json(), { completed: true, acknowledgements: 1, retries: [] });
    assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime','begin_hosting_work','read_hosting_runtime','finish_hosting_work']);
  }
  jobsCompleted = true;
  const automatic = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/automatic');
  assert.deepEqual(await automatic.json(), { completed: true, acknowledgements: 1, retries: [] });
  assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime','begin_automatic_hosting_queue_work','read_hosting_release_status','finish_automatic_hosting_queue_work']);
  jobsSuperseded = true;
  const superseded = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/automatic-superseded');
  assert.deepEqual(await superseded.json(), { completed: true, acknowledgements: 1, retries: [] });
  assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime','begin_automatic_hosting_queue_work']);
  const unidentified = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/automatic-missing-id');
  assert.equal(unidentified.status, 503); assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime']);
  jobsSuperseded = false; jobsClaim = false;
  const automaticDuplicate = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/automatic-duplicate');
  assert.deepEqual(await automaticDuplicate.json(), { completed: true, acknowledgements: 1, retries: [] });
  assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime','begin_automatic_hosting_queue_work']);
  jobsClaim = false;
  jobsRedirect = true;
  const redirected = await jobRuntime.dispatchFetch('https://jobs.fixture.invalid/cron');
  assert.equal(redirected.status, 503); assert.equal((await redirected.json()).code, 'hosting_state_unavailable');
  assert.deepEqual(jobCalls.splice(0), ['read_hosting_runtime']);
  console.log(JSON.stringify({ runtime: 'workerd', jobsChecks: 11, liveProviderRequests: 0, queueMessagesSent: 0, redirectedCredentials: false, nativeVoidStatus: 204 }));
} finally { await jobRuntime.dispose(); }
const source = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: '.local/cloudflare-build/source-worker/source.js',
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { SOURCE_TRANSPORT_ENABLED: 'false' },
  outboundService: async () => { throw new Error('Source backend networking prohibited'); },
}));
try {
  assert.equal((await source.dispatchFetch('https://source.internal/download', { method: 'POST' })).status, 503);
  console.log(JSON.stringify({ runtime: 'workerd', sourceGatewayDisabled: true, containerStarted: false }));
} finally { await source.dispose(); }
