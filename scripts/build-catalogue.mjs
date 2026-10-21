import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESEARCH_PLATFORMS = ['YouTube', 'Instagram', 'X', 'Substack', 'LinkedIn'];
const researchFiles = ['research-youtube.json', 'research-instagram.json', 'research-x.json', 'research-substack.json', 'research-linkedin.json'];
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(root, 'data/catalogue');
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const sort = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const genericDomains = new Set(['youtube.com', 'youtu.be', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'substack.com', 'linktr.ee', 'feedspot.com']);
export function safeHttps(value) {
  need(typeof value === 'string' && value.length <= 2048, 'A source or evidence URL is missing or too long.');
  let url;
  try { url = new URL(value); } catch { throw new Error('An invalid source or evidence URL was found.'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname.includes('.') &&
    !/^(?:\d+\.){3}\d+$/.test(url.hostname) && !url.hostname.includes(':') &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname), 'Only public HTTPS source and evidence URLs are allowed.');
  need(![...url.searchParams.keys()].some(k => /^(?:token|access_token|api[_-]?key|authorization|secret|password|x-amz-.+|signature)$/i.test(k)), 'Credential-bearing URLs cannot enter the catalogue.');
  return url;
}
/** Matching only: compiled channels preserve originally researched URLs. */
export function accountKey(value) {
  const url = safeHttps(value);
  let host = url.hostname.toLowerCase().replace(/^www\./, '');
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (['twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(host)) host = 'x.com';
  if (['x.com', 'instagram.com', 'linkedin.com'].includes(host) || (host === 'youtube.com' && !path.startsWith('/channel/'))) path = path.toLowerCase();
  need(!url.search && !url.hash, 'Research account URLs must be clean public account destinations.');
  return 'https://' + host + path;
}
function normalizeName(value, kind) {
  const words = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
  return (kind === 'person' && words.length > 2 ? words.filter((w, i) => i === 0 || i === words.length - 1 || w.length > 1) : words).join(' ');
}
function normalizeIdentity(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 2048, 'Invalid identity anchor.');
  if (value.startsWith('https://')) {
    const url = safeHttps(value);
    need(!url.search && !url.hash && url.pathname !== '/', 'A profile identity anchor needs an exact path.');
    return accountKey(value);
  }
  const url = safeHttps('https://' + value.toLowerCase().replace(/^www\./, ''));
  const host = url.hostname.replace(/^www\./, '');
  need(url.pathname === '/' && !url.search && !url.hash && !genericDomains.has(host), 'A generic platform domain is not an identity.');
  return host;
}
function validEvidence(evidence) {
  need(Array.isArray(evidence) && evidence.length > 0, 'Every channel needs affirmative evidence.');
  for (const e of evidence) {
    safeHttps(e.url);
    need(typeof e.note === 'string' && e.note.trim().length > 0 && e.note.length <= 2000, 'Evidence needs an explanation.');
  }
}
function supports(identity, evidence) {
  if (identity.startsWith('https://')) {
    const anchor = safeHttps(identity);
    return evidence.some(e => {
      const url = safeHttps(e.url), path = url.pathname.replace(/\/$/, ''), target = anchor.pathname.replace(/\/$/, '');
      return url.hostname.replace(/^www\./, '') === anchor.hostname.replace(/^www\./, '') &&
        (path === target || path.replace(/\/about$/, '') === target);
    });
  }
  return evidence.some(e => {
    const host = safeHttps(e.url).hostname.replace(/^www\./, '');
    return host === identity || host.endsWith('.' + identity);
  });
}
export function validateResearch(rows, exact = true) {
  need(Array.isArray(rows), 'Research must be an array.');
  const keys = new Set(), counts = Object.fromEntries(RESEARCH_PLATFORMS.map(p => [p, 0]));
  const hosts = { YouTube: ['youtube.com', 'youtu.be'], Instagram: ['instagram.com'], X: ['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'], LinkedIn: ['linkedin.com'] };
  for (const row of rows) {
    need(RESEARCH_PLATFORMS.includes(row.platform), 'Unsupported research platform.');
    need(typeof row.name === 'string' && row.name.trim().length > 0 && row.name.length <= 160 && ['person', 'group'].includes(row.kind), 'Invalid creator identity.');
    need(typeof row.description === 'string' && row.description.length >= 10 && row.description.length <= 2000, 'Invalid factual description.');
    need(typeof row.handle === 'string' && row.handle.length > 0 && row.handle.length <= 300, 'Missing public channel address.');
    need(Array.isArray(row.topics) && row.topics.length > 0 && row.topics.every(t => typeof t === 'string' && t.length > 0 && t.length <= 100), 'Invalid subject tags.');
    need(typeof row.language === 'string' && /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(row.language), 'Invalid source language.');
    need(/^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt) && Number.isFinite(Date.parse(row.checkedAt)), 'Missing research date.');
    need(['official_crosslink', 'official_profile', 'public_directory'].includes(row.verification), 'Invalid evidence method.');
    validEvidence(row.evidence);
    const key = accountKey(row.url);
    need(!keys.has(key), 'Duplicate account URL: ' + row.url); keys.add(key);
    if (hosts[row.platform]) need(hosts[row.platform].includes(safeHttps(row.url).hostname.replace(/^www\./, '')), 'Platform hostname disagrees: ' + row.name);
    if (row.identityKey) need(supports(normalizeIdentity(row.identityKey), row.evidence), 'Identity anchor lacks official evidence: ' + row.name);
    counts[row.platform] += 1;
  }
  if (exact) need(Object.values(counts).every(n => n === 120), 'Need exactly 120 distinct accounts on each requested platform.');
  return counts;
}
function applyBridges(rows, overrides) {
  const byAccount = new Map(rows.map(r => [accountKey(r.url), r])), assigned = new Set();
  for (const group of overrides?.identityGroups ?? []) {
    need(['person', 'group'].includes(group.kind) && typeof group.name === 'string', 'A bridge needs a named person or group.');
    need(Array.isArray(group.accounts) && group.accounts.length >= 2, 'A bridge needs two accounts.');
    validEvidence(group.evidence);
    const identity = normalizeIdentity(group.identityKey);
    need(supports(identity, group.evidence), 'Bridge lacks an exact official witness: ' + group.name);
    for (const url of group.accounts) {
      const account = accountKey(url), row = byAccount.get(account);
      need(row && !assigned.has(account), 'Bridge account absent or assigned twice: ' + url);
      need(row.kind === group.kind && normalizeName(row.name, row.kind) === normalizeName(group.name, group.kind), 'Incompatible bridge names/kinds: ' + group.name);
      assigned.add(account); row.identityKey = identity;
      const combined = [...row.evidence, ...group.evidence];
      row.evidence = combined.filter((e, i) => combined.findIndex(other => other.url === e.url && other.note === e.note) === i);
      row.verification = 'official_crosslink';
    }
  }
  return rows;
}
function buildPlans(config) {
  need(config?.collectionEnabled === false && config?.actualSourceCollectionRuns === 0, 'Provider research cannot authorize execution.');
  const find = platform => {
    const p = config.platformRecommendations.find(p => p.platform === platform);
    need(p && p.activation === 'off' && p.proofStatus === 'documented_only', 'Missing disabled recommendation: ' + platform); return p;
  };
  const amount = config.brightData.readyMadePaygUsdPer1000DeliveredRecords;
  const tariff = (actor, event, tier = 'FREE') => {
    const row = config.apifyPublicActorTariffs.find(r => r.actor === actor)?.events.find(e => e.key === event);
    const value = row?.tierUsd?.[tier] ?? row?.usd;
    need(typeof value === 'number' && value >= 0 && Number.isFinite(value), 'Missing saved Actor tariff: ' + actor + '/' + event);
    return value;
  };
  const youtubePer1000 = tariff(find('YouTube').actor, 'result') * 1000;
  const xPerQuery = tariff(find('X').actor, 'list-query');
  need(amount === 1.5, 'Refresh the reviewed Bright Data tariff mapping.');
  need(find('Instagram').primaryProvider === 'Bright Data' && find('LinkedIn').primaryProvider === 'Bright Data' && find('Substack').primaryProvider === 'Publisher RSS', 'Provider choices differ from reviewed plan.');
  const defs = [
    ['YouTube', 'apify', find('YouTube').actor, 'https://apify.com/streamers/youtube-scraper/pricing', youtubePer1000, 'USD per 1,000 video records (Free tier)', 'Existing captions differ from generated transcription ($0.048/started minute on Free). Bright Data cheaper rows need equivalent transcript proof.'],
    ['Instagram', 'brightdata', null, 'https://brightdata.com/pricing/web-scraper', amount, 'USD per 1,000 public post/caption records', 'Apify Instagram fallback. Spoken Reel content needs a separately metered transcript; captions/media URLs are not full audiovisual coverage.'],
    ['X', 'apify', find('X').actor, 'https://apify.com/apidojo/twitter-scraper-lite/pricing', xPerQuery, 'USD per profile/search query (about 40 initial results)', 'Extra item tiers and single-post queries differ. Bright Data known-post rows are cheaper; complete profile-post discovery needs proof.'],
    ['Substack', 'native_feed', null, 'https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication', 0, 'Scraper-supplier fee per public feed check; hosting excluded', 'RSS discovery first; body completeness unverified. Apify hata1234/substack-scraper fallback $1/1,000 articles + $0.005 start, includeBody:true. Bright Data Studio bills page loads. Paid previews remain partial.'],
    ['LinkedIn', 'brightdata', null, 'https://brightdata.com/pricing/web-scraper', amount, 'USD per 1,000 public post-text records', 'Apify harvestapi/linkedin-profile-posts fallback $2/1,000 plus events. Verify public-post limits, full articles and documents.'],
    ['Blog', 'native_feed', null, null, 0, 'Scraper-supplier fee per public feed check; hosting excluded', 'Native public feed discovery/extracts; body completeness varies. Catalogue collection stays off.'],
    ['Podcast', 'native_feed', null, null, 0, 'Scraper-supplier fee per public feed check; hosting excluded', 'Public feed metadata/show notes only. Audio and generated transcription are not included or enabled.'],
  ];
  return defs.map(([platform, provider, actor_id, pricing_url, quoted_usd, unit_label, notes]) => ({ platform, provider, actor_id, pricing_url, unit_label, quoted_usd, quote_checked_at: config.checkedAt, notes, planned_check_hours: 24, execution_enabled: false }));
}
export function buildCatalogue(inputRows, config, overrides = {}) {
  validateResearch(inputRows);
  const rows = applyBridges(structuredClone(inputRows), overrides); validateResearch(rows);
  const groups = new Map(), creators = [], channels = [], identities = [];
  for (const row of rows) {
    const key = row.identityKey ? row.kind + '|' + normalizeIdentity(row.identityKey) + '|' + normalizeName(row.name, row.kind) : 'account|' + row.platform + '|' + accountKey(row.url);
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
  }
  for (const [key, members] of groups) {
    members.sort((a, b) => sort(a.name, b.name) || sort(a.platform, b.platform) || sort(a.url, b.url));
    const name = [...members].sort((a, b) => a.name.length - b.name.length || sort(a.name, b.name))[0].name;
    const digest = hash(key), id = 'creator-' + digest.slice(0, 20);
    const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110).replace(/-$/, '') || 'creator';
    const dates = members.map(m => m.checkedAt).sort();
    creators.push({ id, slug: base + '-' + digest.slice(0, 8), name, kind: members[0].kind,
      description: [...new Set(members.map(m => m.description))].join(' ').slice(0, 2000),
      topics: [...new Set(members.flatMap(m => m.topics))].sort(sort), language: members[0].language,
      is_listed: true, researched_at: dates[dates.length - 1] });
    for (const r of members) channels.push({ id: 'channel-' + hash(r.platform + '|' + accountKey(r.url)).slice(0, 20), creator_id: id,
      platform: r.platform, name: r.name, handle: r.handle, url: r.url, description: r.description, language: r.language,
      verification: r.verification, evidence: r.evidence, researched_at: r.checkedAt, collection_status: 'planned' });
    if (members.length > 1) identities.push({ creatorId: id, name, kind: members[0].kind, anchor: normalizeIdentity(members[0].identityKey), accounts: members.map(m => m.url) });
  }
  creators.sort((a, b) => sort(a.slug, b.slug)); channels.sort((a, b) => sort(a.platform, b.platform) || sort(a.url, b.url)); identities.sort((a, b) => sort(a.name, b.name));
  const catalogue = { version: 1, researchedAt: config.checkedAt, creators, channels, plans: buildPlans(config) }; validateCatalogue(catalogue);
  return { catalogue, identities };
}
export function validateCatalogue(catalogue) {
  need(Array.isArray(catalogue.creators) && Array.isArray(catalogue.channels) && Array.isArray(catalogue.plans), 'Incomplete catalogue.');
  const ids = new Set(), slugs = new Set(), accounts = new Set(), channelIds = new Set();
  for (const c of catalogue.creators) {
    need(!ids.has(c.id) && !slugs.has(c.slug), 'Creator ID/slug collision.');
    need(/^[a-z0-9][a-z0-9-]{0,119}$/.test(c.slug) && c.id.length <= 120 && c.is_listed === true, 'Invalid page identifier.');
    ids.add(c.id); slugs.add(c.slug);
  }
  const counts = Object.fromEntries(RESEARCH_PLATFORMS.map(p => [p, 0]));
  for (const c of catalogue.channels) {
    const key = accountKey(c.url);
    need(ids.has(c.creator_id) && !accounts.has(key) && !channelIds.has(c.id) && typeof c.id === 'string' && c.id.length <= 120, 'Broken/duplicate channel identity.');
    need(c.collection_status === 'planned' && RESEARCH_PLATFORMS.includes(c.platform), 'Imported channels must stay planned.');
    validEvidence(c.evidence); accounts.add(key); channelIds.add(c.id); counts[c.platform] += 1;
  }
  need(Object.values(counts).every(n => n === 120) && catalogue.channels.length === 600, 'Compiled platform account count changed.');
  need(catalogue.creators.every(c => catalogue.channels.some(s => s.creator_id === c.id)), 'Canonical creator has no channel.');
  need(catalogue.plans.length === 7 && new Set(catalogue.plans.map(p => p.platform)).size === 7 && catalogue.plans.every(p => [...RESEARCH_PLATFORMS, 'Blog', 'Podcast'].includes(p.platform)), 'Need seven source-family plans.');
  for (const p of catalogue.plans) {
    need(p.execution_enabled === false && p.planned_check_hours === 24 && typeof p.quoted_usd === 'number' && p.quoted_usd >= 0 && Number.isFinite(p.quoted_usd), 'Invalid or enabled collection plan.');
    need(['apify', 'brightdata', 'native_feed', 'undecided'].includes(p.provider), 'Invalid collection provider.');
    if (p.pricing_url) safeHttps(p.pricing_url);
  }
}
function report(catalogue, identities, inputHashes, outputHash, overrides) {
  const counts = RESEARCH_PLATFORMS.map(p => '| ' + p + ' | ' + catalogue.channels.filter(c => c.platform === p).length + ' |').join('\n');
  const methods = Object.entries(catalogue.channels.reduce((out, c) => ({ ...out, [c.verification]: (out[c.verification] || 0) + 1 }), {})).map(([v, n]) => v + ': ' + n).join('; ');
  return '# Catalogue import manifest\n\nPrepared **' + catalogue.researchedAt + '**. Metadata seed only. **This script performs no database write, supplier run, schedule or activation.**\n\n## Result\n\n' +
    '- **600 public platform accounts**: exactly 120 per requested platform.\n- **' + catalogue.creators.length + ' canonical creators/pages**, with ' + identities.length + ' evidenced creators/groups having multiple channels.\n- **Seven disabled plans**; every channel is planned.\n- No inferred memberships, presenters, sponsors, collected updates, audience figures or private participant records.\n\n| Platform | Distinct accounts |\n| --- | ---: |\n' + counts +
    '\n\nEvidence methods: ' + methods + '. These describe identity evidence, not a collection pass.\n\n## Identity rules\n\n' +
    'Merge only on a shared evidenced official domain or exact official-profile anchor, a compatible public name and the same person/group kind. A matching name alone never merges records. Compatible names permit punctuation, diacritics and a middle initial (Codie A. Sanchez / Codie Sanchez); unrelated aliases are not automatically equated. Twelve extra bridges are saved in [identity-overrides.json](../../data/catalogue/identity-overrides.json), and their evidence is appended to affected compiled channels. Researcher source files remain unchanged.\n\n' +
    'Original URLs, descriptions, languages and evidence remain on channels. Topic labels are combined on canonical creators; the source research files preserve platform-specific topic assignments. Creator descriptions combine original channel-focus descriptions. Hash-derived IDs and readable hash-suffixed slugs are deterministic and unaffected by input ordering. Later changes to an identity anchor that merge already-published records need explicit redirects/migrations; this seed does not silently rewrite a database.\n\n| Canonical creator | Kind | Channels | Evidenced anchor |\n| --- | --- | ---: | --- |\n' +
    identities.map(g => '| ' + g.name.replaceAll('|', '/') + ' | ' + g.kind + ' | ' + g.accounts.length + ' | ' + g.anchor + ' |').join('\n') +
    '\n\n## Unresolved identity pairs\n\n' + (overrides.unresolved ?? []).map(g => '- **' + g.name + '**: ' + g.reason + ' Accounts: ' + g.accounts.map(u => '[' + u + '](' + u + ')').join(', ') + '.').join('\n') +
    '\n\nA separate unresolved record is not proof of a separate real-world creator. Resolve this pair before treating its separate pages as authoritative distinct identities.\n\n## Provider plan\n\n' +
    'YouTube: Apify $4/1,000 Free-tier video records. Instagram/LinkedIn: Bright Data $1.50/1,000 comparable public text rows. X: Apify $0.016/profile-search query; extras differ. Substack/Blog/Podcast: native public feed discovery, $0 scraper-supplier fee excluding hosting/body/audio processing. Fallback and transcript limits are saved on plans. These are quotes, not budgets or observed charges. See [cost research](COLLECTION-COSTS.md).\n\n## Reproduction and integrity\n\n' +
    'Run node scripts/build-catalogue.mjs to regenerate, or node scripts/build-catalogue.mjs --check to detect drift without writing. Inputs are local research JSON, saved provider prices and reviewed identity overrides. No network, credentials, database client, collection trigger or scheduling is present in the build. Root separately imports the reviewed rows.\n\nCompiled catalogue SHA-256: ' + outputHash + '.\n\n' +
    inputHashes.map(([file, digest]) => '- ' + file + ': ' + digest + '.').join('\n') +
    '\n\nPublic directories/profiles establish identity only. Some platform pages are cached or blocked; affirmative cross-link evidence is described on the channel. SEO indexing/rank, source completeness and content generation are not validated by this import.\n';
}
async function main() {
  const files = [...researchFiles, 'provider-plans.json', 'identity-overrides.json'];
  const input = await Promise.all(files.map(async f => [f, await readFile(resolve(dataDir, f), 'utf8')]));
  const rows = input.filter(([f]) => f.startsWith('research-')).flatMap(([, t]) => JSON.parse(t));
  const config = JSON.parse(input.find(([f]) => f === 'provider-plans.json')[1]), overrides = JSON.parse(input.find(([f]) => f === 'identity-overrides.json')[1]);
  const { catalogue, identities } = buildCatalogue(rows, config, overrides), serialized = JSON.stringify(catalogue, null, 2) + '\n', digest = hash(serialized);
  const outputs = [[resolve(dataDir, 'catalogue.json'), serialized], [resolve(root, 'docs/catalogue/IMPORT-REPORT.md'), report(catalogue, identities, input.map(([f, t]) => [f, hash(t)]), digest, overrides)]];
  const check = process.argv.includes('--check');
  for (const [path, text] of outputs) {
    if (check) need(await readFile(path, 'utf8') === text, 'Catalogue output is stale: ' + path);
    else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
  }
  console.log(JSON.stringify({ status: check ? 'current' : 'built', creators: catalogue.creators.length, channels: catalogue.channels.length, multiChannelCreators: identities.length, collectionEnabled: false, sha256: digest }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
