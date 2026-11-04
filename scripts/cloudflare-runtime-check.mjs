import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
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
