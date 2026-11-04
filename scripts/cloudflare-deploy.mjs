import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assetManifest, fileHash } from './cloudflare-artifacts.mjs';
const root = process.cwd(), release = JSON.parse(readFileSync('.local/cloudflare-build/release.json', 'utf8'));
const mode = process.env.HOSTING_DEPLOY_MODE || 'shadow';
if (mode !== 'shadow') throw new Error('Active promotion requires the separate verified hosting cutover operation');
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Cloudflare deploy credentials are missing');
// An erroneous repository target variable must never overwrite an active host
// with the guest-only duplicate during a later automatic deployment.
const base = 'https://api.cloudflare.com/client/v4/accounts/' + process.env.CLOUDFLARE_ACCOUNT_ID;
const existing = await fetch(base + '/workers/scripts/therecap-web/settings', { headers: { authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN } });
if (existing.ok) {
  const settings = await existing.json();
  if (settings.result?.bindings?.some(item => item.name === 'HOSTING_MODE' && item.text === 'active')) throw new Error('Refusing to replace an active runtime with a shadow deployment');
} else if (existing.status !== 404) throw new Error('Current Cloudflare deployment could not be verified');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== release.release || release.mode !== 'shadow') throw new Error('The tested shadow artifact must match the checked commit');
const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).split('\n');
if (changed.some(line => /^(?:.{3})(?:src\/|public\/|index\.html|netlify\/|cloudflare\/|containers\/|scripts\/|package(?:-lock)?\.json|tsconfig\.json|vite\.)/.test(line))) throw new Error('Commit production source changes before deploying the tested artifact');
if (JSON.stringify(assetManifest(root + '/dist-cloudflare')) !== JSON.stringify(release.assets)) throw new Error('Built assets changed after verification');
const sourceConfigFile = '.local/cloudflare-build/source.json';
if (fileHash(sourceConfigFile) !== release.configs?.source || fileHash('.local/cloudflare-build/source-worker/source.js') !== release.hashes.sourceWorker
  || createHash('sha256').update(readFileSync('.local/cloudflare-build/source-container/server.mjs')).update(readFileSync('.local/cloudflare-build/source-container/Dockerfile')).digest('hex') !== release.hashes.sourceContainer) throw new Error('Prepared source artifacts changed after verification');
const sourceConfig = JSON.parse(readFileSync(sourceConfigFile, 'utf8'));
if (sourceConfig.vars.SOURCE_TRANSPORT_ENABLED !== 'false' || sourceConfig.vars.RELEASE_SHA !== head || sourceConfig.workers_dev || sourceConfig.containers.length !== 1
  || sourceConfig.containers[0].max_instances !== 1 || sourceConfig.containers[0].instance_type !== 'lite') throw new Error('Source deployment exceeds its private, disabled scope');
// A named, empty auth profile prevents cached interactive OAuth scopes from
// incorrectly overriding the explicitly supplied deployment API token.
execFileSync('npx', ['wrangler', 'deploy', '--no-bundle', '--config', sourceConfigFile, '--profile', 'therecap-migration-api'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
for (const kind of ['jobs', 'web']) {
  const main = root + '/.local/cloudflare-build/' + kind + '/' + kind + '.js';
  const hash = createHash('sha256').update(readFileSync(main)).digest('hex');
  if (hash !== release.hashes[kind]) throw new Error('Built Worker artifact changed after verification');
  const configFile = '.local/cloudflare-build/' + kind + '.json';
  if (fileHash(configFile) !== release.configs?.[kind]) throw new Error('Built deployment configuration changed after verification');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (config.vars.HOSTING_MODE !== 'shadow' || config.vars.SOURCE_TRANSPORT_VERIFIED !== 'false' || config.vars.RELEASE_SHA !== head || config.triggers.crons.length || config.queues.consumers.length
    || Object.entries(config.vars).some(([key, value]) => key.endsWith('_ENABLED') && value !== 'false')) throw new Error('Shadow deployment cannot activate processing');
  config.main = main;
  // Upload exactly the tested bundle, never rebuild from a moving Git branch.
  const file = '.local/cloudflare-build/' + kind + '.deploy.json'; writeFileSync(file, JSON.stringify(config, null, 2));
  execFileSync('npx', ['wrangler', 'deploy', '--no-bundle', '--config', file], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
}
console.log(JSON.stringify({ event: 'cloudflare_shadow_deployed', release: release.release, jobsEnabled: false }));
