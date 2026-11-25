import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export async function verifyReviewedApifyBuild({ authorityFile, reviewed, fetcher = fetch, at = Date.now() }) {
  if (!authorityFile) throw new Error('Approved Apify authority file required');
  const approvedPath = realpathSync(authorityFile);
  if (basename(approvedPath) === 'prepared-runtime-secrets.json') throw new Error('Preparation credentials are not approved for Apify');
  // Use only the explicitly selected approved custody file. Runtime and
  // preparation environment values are never used as an authentication fallback.
  const token = JSON.parse(readFileSync(approvedPath, 'utf8')).APIFY_API_TOKEN;
  if (typeof token !== 'string' || !token.trim()) throw new Error('Approved Apify credential missing');
  if (!/^[a-zA-Z0-9]+$/.test(reviewed?.buildId ?? '')) throw new Error('Reviewed Apify build identity missing');
  const get = async path => {
    const response = await fetcher('https://api.apify.com/v2/' + path, {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Approved Apify metadata request returned HTTP ' + response.status);
    }
    return (await response.json()).data;
  };
  const [build, actor] = await Promise.all([get('actor-builds/' + reviewed.buildId), get('actors/streamers~youtube-scraper')]);
  if (build?.id !== reviewed.buildId || build.status !== 'SUCCEEDED' || build.actId !== reviewed.actorId ||
      actor?.taggedBuilds?.latest?.buildId !== reviewed.buildId || actor.taggedBuilds.latest.buildNumber !== reviewed.buildNumber) {
    throw new Error('Reviewed Apify build identity changed');
  }
  const price = actor.pricingInfos.filter(row => Date.parse(row.startedAt) <= at)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
  if (!price || createHash('sha256').update(JSON.stringify(canonical(price))).digest('hex') !== reviewed.pricingSha256) {
    throw new Error('Reviewed Apify pricing changed');
  }
  return { buildNumber: reviewed.buildNumber, buildId: reviewed.buildId, pricingVerified: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const reviewed = JSON.parse(readFileSync(new URL('../actors/tech-collector/providers/youtube-reviewed-metadata.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify(await verifyReviewedApifyBuild({ authorityFile: process.env.APIFY_APPROVED_AUTHORITY_FILE, reviewed })));
}
