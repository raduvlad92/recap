import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { loadEnv } from 'vite';
import { assetManifest, fileHash } from './cloudflare-artifacts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.env.HOSTING_BUILD_MODE || 'shadow';
const release = process.env.RELEASE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!['shadow', 'active'].includes(mode) || !/^[a-f0-9]{40}$/.test(release)) throw new Error('Invalid release configuration');
const env = { ...process.env };
// Vite reads .env.local too. Explicit empty values prevent an isolated preview
// from signing readers into the production database through direct browser RPC.
if (mode === 'shadow') for (const key of ['VITE_CLERK_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) env[key] = '';
execFileSync('npx', ['vite', 'build', '--config', 'vite.cloudflare.config.ts'], { cwd: root, env, stdio: 'inherit' });
writeFileSync(root + 'dist-cloudflare/_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n');
if (mode === 'shadow') {
  // A separate operator page can sign in, but has no browser database client.
  // The ordinary guest shell still has all three production VITE values empty.
  const key = process.env.CLOUDFLARE_CLERK_PUBLISHABLE_KEY || loadEnv('production', root, 'VITE_CLERK_PUBLISHABLE_KEY').VITE_CLERK_PUBLISHABLE_KEY || '';
  if (key && !/^pk_(?:test|live)_[A-Za-z0-9_=-]+$/.test(key)) throw new Error('Invalid verification publishable key');
  await build({ entryPoints: [root + 'cloudflare/verification-ui.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(key) }, outfile: root + 'dist-cloudflare/migration-check.js' });
  writeFileSync(root + 'dist-cloudflare/migration-check.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Check your account | recap</title><style>body{font:18px/1.6 system-ui,sans-serif;background:#f5f6f3;color:#182b26;margin:0}main{max-width:40rem;margin:12vh auto;padding:2rem}a{color:inherit}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#285e50;color:white;cursor:pointer}button:disabled{opacity:.5}h1{line-height:1.2}</style></head><body><div id="root"></div><script type="module" src="/migration-check.js"></script></body></html>');
}
mkdirSync(root + '.local/cloudflare-build', { recursive: true });
mkdirSync(root + '.local/cloudflare-build/source-container', { recursive: true });
await build({ entryPoints: [root + 'containers/source-server.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: root + '.local/cloudflare-build/source-container/server.mjs' });
copyFileSync(root + 'containers/Dockerfile', root + '.local/cloudflare-build/source-container/Dockerfile');
await build({ entryPoints: [root + 'cloudflare/source-container.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', external: ['cloudflare:workers'], outfile: root + '.local/cloudflare-build/source-worker/source.js' });
const sourceConfig = JSON.parse(readFileSync(root + 'cloudflare/wrangler.source.jsonc', 'utf8'));
sourceConfig.main = root + '.local/cloudflare-build/source-worker/source.js';
sourceConfig.containers[0].image = root + '.local/cloudflare-build/source-container/Dockerfile';
sourceConfig.vars.RELEASE_SHA = release;
writeFileSync(root + '.local/cloudflare-build/source.json', JSON.stringify(sourceConfig, null, 2));
for (const kind of ['jobs', 'web']) {
  const config = JSON.parse(readFileSync(root + 'cloudflare/wrangler.' + kind + '.jsonc', 'utf8'));
  config.main = root + 'cloudflare/' + kind + '.ts';
  if (config.assets) config.assets.directory = root + 'dist-cloudflare';
  config.vars.RELEASE_SHA = release;
  // Build configuration is always inert. Activating a deployment requires the
  // explicit checked cutover workflow and the database ownership gate.
  writeFileSync(root + '.local/cloudflare-build/' + kind + '.json', JSON.stringify(config, null, 2));
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--config', root + '.local/cloudflare-build/' + kind + '.json', '--outdir', root + '.local/cloudflare-build/' + kind], { cwd: root, stdio: 'inherit' });
}
const hashes = Object.fromEntries(['jobs', 'web'].map(kind => [kind, createHash('sha256').update(readFileSync(root + '.local/cloudflare-build/' + kind + '/' + kind + '.js')).digest('hex')]));
hashes.sourceWorker = createHash('sha256').update(readFileSync(root + '.local/cloudflare-build/source-worker/source.js')).digest('hex');
hashes.sourceContainer = createHash('sha256').update(readFileSync(root + '.local/cloudflare-build/source-container/server.mjs')).update(readFileSync(root + '.local/cloudflare-build/source-container/Dockerfile')).digest('hex');
const configs = Object.fromEntries(['source', 'jobs', 'web'].map(kind => [kind, fileHash(root + '.local/cloudflare-build/' + kind + '.json')]));
writeFileSync(root + '.local/cloudflare-build/release.json', JSON.stringify({ release, mode, appUrl: 'https://recap.filternode.dev', jobsEnabled: false, hashes, configs, assets: assetManifest(root + 'dist-cloudflare') }, null, 2) + '\n');
