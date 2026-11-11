import { retryKnownApifyRead } from './provider-read-retry';
import { hostRuntime } from './host-runtime';
import { INSTAGRAM_REELS_ACTOR, normalizeInstagramProviderContent, providerOnlyCollection, type InstagramProviderContent } from './provider-content';
import { nativeSocialRows } from './native-social';
import { createRetrievalLog, retrievalAttempt, type RetrievalLog } from './retrieval-log';
import { fetchNoRedirect } from './fetch-no-redirect';
import { createHash } from 'node:crypto';
import type { SourceUpdate, SourceMedia } from '../../../src/lib/types';
import { extractPostContext } from '../../../actors/tech-collector/src/post-context.mjs';
import { extractPostMedia, visiblePostText } from '../../../actors/tech-collector/src/post-media.mjs';
import { sanitizePostContext } from '../../../src/lib/post-context';
import { sanitizePostMedia } from '../../../src/lib/post-media';
import { database } from './admin-data';
import { hourlyWorkerAuthorized } from './hourly-collection';
import { CollectionError, publicHttpsUrl, readTextLimited, runtimeEnv, type Env } from './security';

export type SocialPlatform = 'X' | 'Instagram' | 'LinkedIn';
export const SOCIAL_ACTORS: Record<SocialPlatform, string> = { X: 'xquik/x-tweet-scraper', Instagram: 'apify/instagram-scraper', LinkedIn: 'harvestapi/linkedin-profile-posts' };
const INSTAGRAM_BACKUP = 'yugenox/instagram-post-scraper';
export interface SocialConfiguration {
 platform: SocialPlatform; enabled: boolean; actor_ref: string; actor_id: string; build_id: string; build_number: string; apify_user_id: string;
 pricing_fingerprint: string; max_items: number; maximum_usd: number; memory_mb: number; timeout_seconds: number; reviewed_at: string;
}
export interface SocialJob {
 purpose?:'collection'|'proof';
 collection_job_id: string;
 id: string; source_key: string; platform: SocialPlatform; source_url: string; source_name: string; window_from: string; window_to: string;
 state: 'claimed' | 'launch_claimed' | 'running' | 'ambiguous' | 'completed' | 'failed'; lease_token: string; reservation_id: string | null;
 provider_run_id: string | null; dataset_id: string | null; config: SocialConfiguration;
}
export interface SocialCoverage { status: 'collected' | 'partial' | 'unknown' | 'blocked' | 'failed'; complete: boolean; returned: number; accepted: number; rejected: Record<string, number>; reason?: string; retrieval?: 'native' | 'apify'; diagnostics?: Record<string, number | boolean | string> }
export interface SocialItem { itemKey: string; revision: string; record: SourceUpdate }
export interface SocialStore {
 sync(): Promise<number>; claim(allowLaunch: boolean): Promise<SocialJob | null>; launch(job: SocialJob): Promise<boolean>;
 run(job: SocialJob, runId: string, datasetId: string | null): Promise<void>;
 finish(job: SocialJob, items: SocialItem[], coverage: SocialCoverage, actualUsd: number | null, terminal: boolean, error?: string): Promise<void>;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, maximum = 200_000) => typeof v === 'string' ? v.slice(0, maximum).trim() : '';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const stableJson = (v: unknown): string => Array.isArray(v) ? '[' + v.map(stableJson).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v) ?? 'null';
export const socialPricingFingerprint = (v: unknown) => digest(stableJson(v));
const providerId = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Za-z0-9]{6,64}$/.test(v)) throw new CollectionError(502, 'social_provider_identity_invalid', 'The source provider returned an invalid identity.'); return v; };

/** Public account identity only. No display-name merging or arbitrary URLs. */
export function socialSourceKey(platform: SocialPlatform, value: string): string {
 const url = publicHttpsUrl(value), host = url.hostname.replace(/^www\./, '').toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
 if (url.search || url.hash) throw new CollectionError(400, 'social_source_invalid', 'Use the original public account URL.');
 if (platform === 'LinkedIn') {
  if (host !== 'linkedin.com' || parts.length !== 2 || !['in', 'company'].includes(parts[0]) || !/^[A-Za-z0-9_-]{1,120}$/.test(parts[1])) throw new CollectionError(400, 'social_source_invalid', 'Use a public LinkedIn profile or company URL.');
  return 'linkedin.com/' + parts.join('/').toLowerCase();
 }
 const hosts = platform === 'X' ? ['x.com', 'twitter.com'] : ['instagram.com'];
 if (!hosts.includes(host) || parts.length !== 1 || !/^[A-Za-z0-9_.]{1,120}$/.test(parts[0]) || ['home', 'search', 'explore', 'accounts', 'p', 'reel', 'reels', 'i'].includes(parts[0].toLowerCase())) throw new CollectionError(400, 'social_source_invalid', 'Use the original public account URL.');
 return (platform === 'X' ? 'x.com/' : 'instagram.com/') + parts[0].toLowerCase();
}
export function socialItemKey(platform: SocialPlatform, value: string): string {
 const url = publicHttpsUrl(value), host = url.hostname.replace(/^www\./, '').toLowerCase(); let id: string | undefined;
 if (platform === 'X' && ['x.com', 'twitter.com'].includes(host)) id = /^\/[A-Za-z0-9_]+\/status\/(\d+)\/?$/.exec(url.pathname)?.[1];
 if (platform === 'Instagram' && host === 'instagram.com') id = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
 if (platform === 'LinkedIn' && host === 'linkedin.com') id = /(?:activity-|urn:li:(?:activity|ugcPost):)(\d+)/.exec(decodeURIComponent(url.pathname))?.[1];
 if (!id) throw new CollectionError(400, 'social_post_invalid', 'The provider returned an invalid original post link.');
 return platform.toLowerCase() + ':' + id;
}
export function socialActorInput(job: Pick<SocialJob, 'platform' | 'source_key' | 'source_url' | 'window_from' | 'window_to' | 'config' | 'purpose'>): Record<string, unknown> {
 const count = job.config.max_items;
 if (!Number.isInteger(count) || count < 1 || count > 100 || !(Date.parse(job.window_from) < Date.parse(job.window_to))) throw new CollectionError(503, 'social_config_invalid', 'The social collector requires a bounded reviewed configuration.');
 if (job.platform === 'X') return { mode: 'profileTweets', twitterHandles: [job.source_key.split('/')[1]], time:{sinceTime:String(Math.floor(Date.parse(job.window_from)/1000)),untilTime:String(Math.ceil(Date.parse(job.window_to)/1000))}, queryType: 'Latest', maxItems: count, maxItemsPerTarget: count, outputVariant: 'rich', fieldStyle: 'camelCase', includeSearchTerms: true };
 // The reviewed backup's date-window route is datacenter-only and was blocked.
 // Read only the capped newest posts, then enforce the immutable UTC window locally.
 if(job.platform==='Instagram'&&job.config.actor_ref===INSTAGRAM_BACKUP)return{urls:[job.source_url],maxPosts:count,maxPostsPerProfile:count,skipPinnedPosts:true,monitor:false};
 if (job.platform === 'Instagram' && job.config.actor_ref === INSTAGRAM_REELS_ACTOR) return { username: [job.source_url], resultsLimit: count, onlyPostsNewerThan: new Date(job.window_from).toISOString(), skipPinnedPosts: true, includeTranscript: false, includeDownloadedVideo: false, includeSharesCount: false };
 if (job.platform === 'Instagram') return { directUrls: [job.source_url], resultsType: 'posts', resultsLimit: count, onlyPostsNewerThan: new Date(job.window_from).toISOString(), addParentData: true };
 return { targetUrls: [job.source_url], maxPosts: count, postedLimitDate: job.window_from, includeQuotePosts: true, includeReposts: true, scrapeComments: false, scrapeReactions: false };
}

function extractedMedia(raw: Record<string, unknown>, platform: SocialPlatform): SourceMedia[] {
 if(platform==='Instagram'&&(raw.image||raw.video||raw.carousel)){
  const image=object(raw.image),video=object(raw.video),rows:unknown[]=[];
  if(image.url)rows.push({type:'image',url:image.url,width:image.width,height:image.height});
  if(video.url)rows.push({type:'video',url:video.url,width:video.width,height:video.height,durationSeconds:video.duration});
  if(Array.isArray(raw.carousel))for(const child of raw.carousel){const item=object(child);rows.push({type:item.videoUrl?'video':'image',url:item.videoUrl||item.url,width:item.width,height:item.height});}
  return sanitizePostMedia(rows);
 }
 if (platform !== 'LinkedIn') return sanitizePostMedia(extractPostMedia(raw, platform));
 return sanitizePostMedia(raw.media);
}

/** One immutable source version per item; empty/blocked rows never prove quiet coverage. */
export function normalizeSocialDataset(job: SocialJob, rows: unknown[], native = false, enriched?: ReadonlyMap<number, InstagramProviderContent>): { items: SocialItem[]; coverage: SocialCoverage } {
 const rejected: Record<string, number> = {}, items = new Map<string, SocialItem>();
 let beforeWindow = 0;
 const reject = (reason: string) => { rejected[reason] = (rejected[reason] || 0) + 1; };
 for (const [rowIndex, value] of rows.entries()) {
  const raw = object(value); if (!Object.keys(raw).length || raw.demo === true || raw.error || raw.type === 'reaction' || raw.type === 'comment') { reject(raw.demo === true ? 'provider_demo_data' : 'provider_error'); continue; }
  try {
   const author = object(raw.author), owner = object(raw.owner), date = raw.createdAt || raw.timestamp || raw.date || object(raw.postedAt).date;
   const publishedAtMs = Date.parse(typeof date === 'number' ? new Date(date).toISOString() : String(date || ''));
   if (!Number.isFinite(publishedAtMs)) { reject('missing_date'); continue; }
   if (publishedAtMs < Date.parse(job.window_from)) { beforeWindow++; reject('outside_window'); continue; }
   if (publishedAtMs >= Date.parse(job.window_to)) { reject('outside_window'); continue; }
   let authorKey: string;
   if (job.platform === 'X') authorKey = 'x.com/' + text(author.userName || author.username || author.screen_name).toLowerCase();
   else if (job.platform === 'Instagram') authorKey = 'instagram.com/' + text(raw.ownerUsername || owner.username).toLowerCase();
   else {const authorUrl=publicHttpsUrl(text(author.linkedinUrl||author.url));authorUrl.search='';authorUrl.hash='';authorUrl.pathname=authorUrl.pathname.replace(/\/(?:posts|recent-activity(?:\/all)?)\/?$/,'');authorKey=socialSourceKey('LinkedIn',authorUrl.href);}
   if (authorKey !== job.source_key) { reject('unattributed'); continue; }
   const original = publicHttpsUrl(text(raw.url || raw.twitterUrl || raw.linkedinUrl));
   const itemKey = socialItemKey(job.platform, original.href);
   if (job.platform === 'Instagram' && (raw.code || raw.shortCode) && itemKey !== 'instagram:' + text(raw.code || raw.shortCode)) { reject('identity_mismatch'); continue; }
   if (job.platform === 'X' && original.pathname.split('/')[1].toLowerCase() !== job.source_key.split('/')[1]) { reject('unattributed'); continue; }
   original.search = ''; original.hash = '';
   if (job.platform === 'X') original.hostname = 'x.com';
   if (job.platform === 'Instagram') original.hostname = 'www.instagram.com';
   const instagramContent = job.platform === 'Instagram' ? enriched?.get(rowIndex) || normalizeInstagramProviderContent(raw, native ? 'native-caption' : job.config.actor_ref) : undefined;
   const fullText = instagramContent ? instagramContent.content : job.platform === 'LinkedIn' ? raw.content || raw.text : visiblePostText(raw, job.platform);
   if (typeof fullText === 'string' && fullText.length > 200_000) { reject('content_too_large'); continue; }
   const content = text(fullText), media = extractedMedia(raw, job.platform), url = original.href;
   const context = job.platform === 'X' ? sanitizePostContext(extractPostContext(raw, 'X') || raw.postContext, url) : undefined;
   const record: SourceUpdate = { id: 'social-' + digest(job.source_key + '\n' + itemKey).slice(0, 32), sourceId: job.source_key, contributorIds: [], title: content.slice(0, 120) || 'Update from ' + job.source_name, summary: content.slice(0, 700) || 'No usable post text returned. Open the original update.', url, publishedAt: new Date(publishedAtMs).toISOString(), format: 'post', topics: [], brands: [], sponsors: [], references: [{ title: 'Original update', url }], insights: [], isSample: false, contentKind: content ? 'feed_text' : 'metadata_only', ...(content ? { content } : {}), ...(media.length ? { media } : {}), ...(context ? { postContext: context } : {}), coverage: 'Public post/caption text only. Linked articles, image text and media audio are not collected.', ...instagramContent };
   if (Buffer.byteLength(JSON.stringify(record)) > 1024 * 1024) { reject('content_too_large'); continue; }
   const revision = digest(stableJson({ content, url, publishedAt: record.publishedAt, media, context: context || null, ...(instagramContent?.contentProvenance ? { contentProvenance: instagramContent.contentProvenance } : {}) }));
   items.set(itemKey, { itemKey, revision, record });
  } catch (error) { reject(error instanceof CollectionError && error.code.startsWith('provider_content_') ? error.code : 'invalid_original'); }
 }
 // This adapter accepts day precision. A capped response entirely before the
 // exact window is still unknown coverage, but must not freeze a quiet source.
 const olderWindow = job.config.actor_ref === INSTAGRAM_BACKUP && rows.length > 0 && beforeWindow === rows.length;
 const capped = (native ? items.size >= job.config.max_items : rows.length >= job.config.max_items) && !olderWindow;
 // A successful run with fewer rows is not evidence that the platform returned
 // an exhaustive timeline. Retain the gap instead of blessing provider success.
 return { items: [...items.values()].slice(0, job.config.max_items), coverage: { status: items.size ? 'partial' : 'unknown', complete: false, returned: rows.length, accepted: Math.min(items.size, job.config.max_items), rejected, reason: capped ? 'result_limit_reached' : olderWindow ? 'provider_returned_older_window' : items.size ? 'provider_completeness_unverified' : 'empty_or_unusable_response' } };
}

async function apify(path: string, env: Env, fetcher: typeof fetch, init: RequestInit = {}): Promise<unknown> {
 const token = env('APIFY_API_TOKEN'); if (!token) throw new CollectionError(503, 'social_provider_unconfigured', 'Social collection requires the existing provider connection.');
 const response = await fetchNoRedirect('https://api.apify.com/v2/' + path, { ...init, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) }, (input, init) => retryKnownApifyRead(input, init, fetcher));
 if (!response.ok) { await response.body?.cancel(); const code = response.status === 401 || response.status === 403 ? 'social_provider_authentication_failed' : response.status === 429 ? 'social_provider_rate_limited' : response.status >= 500 ? 'social_provider_unavailable' : 'social_provider_error'; throw new CollectionError(502, code, 'The social provider request could not finish.', response.status); }
 try { return JSON.parse(await readTextLimited(response, 2 * 1024 * 1024)); } catch (error) { if (error instanceof CollectionError) throw error; throw new CollectionError(502, 'social_provider_invalid', 'The social provider returned unreadable data.'); }
}
/** Read the SAME accepted run. Oversized multi-item responses may be split
 * into fixed complete records, never clipped/relaunched. Each page keeps the
 * 2-MiB response bound, total work is <=8 MiB / 21 extra reads. */
async function socialDataset(datasetId: string, maximum: number, env: Env, fetcher: typeof fetch): Promise<unknown[]> {
 const path = 'datasets/' + datasetId + '/items?clean=true';
 try {
  const rows = await apify(path + '&limit=' + (maximum + 1), env, fetcher);
  if (!Array.isArray(rows) || rows.length > maximum) throw new CollectionError(502, 'social_result_limit_exceeded', 'The source provider exceeded its reviewed result bound.');
  return rows;
 } catch (error) {
  if (!(error instanceof CollectionError) || error.code !== 'response_too_large') throw error;
  if (maximum > 20) throw new CollectionError(413, 'social_result_read_budget_exceeded', 'The complete dataset requires a separately reviewed read plan.');
  const rows: unknown[] = []; let bytes = 0;
  for (let offset = 0; offset <= maximum; offset++) {
   const page = await apify(path + '&limit=1&offset=' + offset, env, fetcher);
   if (!Array.isArray(page) || page.length > 1) throw new CollectionError(502, 'social_provider_invalid', 'The source provider returned an invalid page.');
   bytes += Buffer.byteLength(JSON.stringify(page));
   if (bytes > 8 * 1024 * 1024) throw new CollectionError(413, 'social_result_read_budget_exceeded', 'The complete dataset exceeds its reviewed read budget.');
   rows.push(...page);
  }
  if (rows.length > maximum) throw new CollectionError(502, 'social_result_limit_exceeded', 'The source provider exceeded its reviewed result bound.');
  return rows;
 }
}
export async function socialDiagnostics(job: SocialJob, run: Record<string, unknown>, env: Env, fetcher: typeof fetch = fetch): Promise<Record<string, number | boolean | string>> {
 const store = run.defaultKeyValueStoreId;
 if (typeof store !== 'string') return { report_present: false };
 const keys = job.platform === 'Instagram' && job.config.actor_ref === INSTAGRAM_BACKUP ? ['RUN_REPORT'] : job.platform === 'X' ? ['diagnostics', 'run-report'] : [];
 const summary: Record<string, number | boolean | string> = { report_present: false };
 for (const key of keys) {
  const response = await fetchNoRedirect('https://api.apify.com/v2/key-value-stores/' + providerId(store) + '/records/' + key, { headers: { authorization: 'Bearer ' + env('APIFY_API_TOKEN') }, signal: AbortSignal.timeout(8_000) }, fetcher);
  if (response.status === 404) { await response.body?.cancel(); continue; }
  if (!response.ok) { await response.body?.cancel(); throw new CollectionError(502, 'provider_report_unavailable', 'The provider diagnostic report was unavailable.'); }
  let value: unknown; try { value = JSON.parse(await readTextLimited(response, 256 * 1024)); } catch { throw new CollectionError(502, 'provider_report_invalid', 'The provider report was unreadable.'); }
  const reports = Array.isArray(value) ? value.slice(0, 100).map(object) : [object(value)];
  summary.report_present = true;
  for (const report of reports) {
   const totals = object(report.totals), queries = object(totals.requestsByQuery), filtering = object(report.filtering);
   const blocked = Object.values(queries).reduce<number>((sum, value) => sum + (typeof object(value).blocked === 'number' ? Math.max(0, Math.min(10000, Number(object(value).blocked))) : 0), 0);
   summary.blocked_requests = Math.max(Number(summary.blocked_requests || 0), blocked);
   for (const [output, input] of [['failed_targets','failedSubtargets'],['unavailable_targets','unavailableTargets'],['stop_causes','stopCauses']] as const) if (Array.isArray(report[input])) summary[output] = Math.max(Number(summary[output] || 0), (report[input] as unknown[]).length);
   if (typeof filtering.actorFilteredRows === 'number') summary.filtered_rows = Math.max(Number(summary.filtered_rows || 0), Math.min(100000, Math.max(0, filtering.actorFilteredRows)));
   if (typeof totals.requests === 'number') summary.requests = Math.min(10000, Math.max(0, totals.requests));
   if (Array.isArray(report.queries)) summary.empty_targets = report.queries.filter(q => object(q).status === 'empty').length;
  }
 }
 return summary;
}

export async function verifySocialConfiguration(config: SocialConfiguration, env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<void> {
 if (!config.enabled || ![SOCIAL_ACTORS[config.platform],...(config.platform==='Instagram'?[INSTAGRAM_BACKUP,INSTAGRAM_REELS_ACTOR]:[])].includes(config.actor_ref) || !config.reviewed_at || !/^[a-f0-9]{64}$/.test(config.pricing_fingerprint || '') || !/^\d+\.\d+\.\d+$/.test(config.build_number) || !Number.isFinite(config.maximum_usd) || config.maximum_usd <= 0 || config.maximum_usd > 1 || config.timeout_seconds < 30 || config.timeout_seconds > 600 || ![128, 256, 512, 1024].includes(config.memory_mb)) throw new CollectionError(503, 'social_review_required', 'This platform requires a reviewed bounded Actor configuration.');
 const [actorResult, buildResult, accountResult] = await Promise.all([apify('acts/' + providerId(config.actor_id), env, fetcher), apify('actor-builds/' + providerId(config.build_id), env, fetcher), apify('users/me', env, fetcher)]);
 const actor = object(object(actorResult).data), build = object(object(buildResult).data), account = object(object(accountResult).data);
 const pricing = (Array.isArray(actor.pricingInfos) ? actor.pricingInfos.map(object) : []).filter(p => typeof p.startedAt === 'string' && Date.parse(p.startedAt) <= now).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).at(-1);
 if (actor.id !== config.actor_id || actor.username + '/' + actor.name !== config.actor_ref || build.id !== config.build_id || build.actId !== config.actor_id || build.buildNumber !== config.build_number || build.status !== 'SUCCEEDED' || account.id !== config.apify_user_id || !pricing || socialPricingFingerprint(pricing) !== config.pricing_fingerprint) throw new CollectionError(503, 'social_review_changed', 'The social Actor build, account or price changed; new pulls are paused.');
}
export function createSocialStore(env: Env = runtimeEnv): SocialStore {
 const db = database(env);
 async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> { const result = await db.rpc(name, args); if (result.error) throw new CollectionError(result.error.code === 'PT402' ? 402 : result.error.code === 'PT409' ? 409 : 503, result.error.code === 'PT402' ? 'social_budget_exhausted' : 'social_state_changed', 'Social collection could not safely continue.'); return result.data as T; }
 return { sync: () => rpc('sync_social_collection_sources'), claim: allowLaunch => rpc('claim_social_collection_job', { p_allow_launch: allowLaunch }), launch: job => rpc('mark_social_collection_launch', { p_id: job.id, p_lease: job.lease_token }), run: (job, runId, datasetId) => rpc('record_social_collection_run', { p_id: job.id, p_lease: job.lease_token, p_run_id: runId, p_dataset_id: datasetId }), finish: (job, items, coverage, actualUsd, terminal, error) => rpc('finish_social_collection_job', { p_id: job.id, p_lease: job.lease_token, p_items: items, p_coverage: coverage, p_actual_usd: actualUsd, p_terminal: terminal, p_error: error || null }) };
}
export function createSocialCollector(options: { env?: Env; store?: SocialStore; fetcher?: typeof fetch; now?: () => number; log?: RetrievalLog; native?: typeof nativeSocialRows } = {}) {
 const env = options.env || runtimeEnv, fetcher = options.fetcher || fetch, now = options.now || Date.now;
 return async () => {
  // Private database platform policies are the positive enabling authority.
  // An explicit environment false is an additional emergency launch stop.
  const store = options.store || createSocialStore(env), log = options.log || createRetrievalLog(env), native = options.native || nativeSocialRows, allowLaunch = env('SOCIAL_COLLECTION_ENABLED') !== 'false';
  let synchronized = 0, checked = 0, failed = 0;
  if (allowLaunch) synchronized = await store.sync();
  const deadline = now() + 10 * 60_000;
  const reviewedConfigurations = new Map<string, Promise<void>>();
  // One job per shared source; bounded worker batch and provider time limits.
  let count = 0;
  const consume = async () => { while (count++ < 1200 && now() < deadline) {
   const job = await store.claim(allowLaunch); if (!job) break;
   let launched = job.state !== 'claimed', runId = job.provider_run_id;
   try {
    if (!runId) {
     if (launched) { await store.finish(job, [], { status: 'blocked', complete: false, returned: 0, accepted: 0, rejected: {}, reason: 'ambiguous_launch' }, null, false, 'ambiguous_launch'); failed++; continue; }
     if (job.purpose !== 'proof' && ['Instagram', 'X'].includes(job.platform) && !(job.platform === 'Instagram' && providerOnlyCollection(env))) {
      try {
       const rows = await native(job, log, fetcher), normalized = await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_native_validation', 'native', 'discovery', async () => normalizeSocialDataset(job, rows, true), value => ({ status: value.items.some(item => item.record.content?.trim()) ? 'partial' : 'empty', result_count: value.items.length, diagnostics: { rejected_rows: Object.values(value.coverage.rejected).reduce((sum, n) => sum + n, 0) } }));
       if (normalized.items.some(item => item.record.content?.trim())) {
        await store.finish(job, normalized.items, { ...normalized.coverage, retrieval: 'native' }, 0, true); checked++; continue;
       }
      } catch (error) { if (error instanceof CollectionError && error.code === 'retrieval_log_unavailable') throw error; }
     }
     const configurationKey=stableJson(job.config);
     await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_preflight', 'apify', 'discovery', () => { let review = reviewedConfigurations.get(configurationKey); if (!review) { review = verifySocialConfiguration(job.config, env, fetcher, now()); reviewedConfigurations.set(configurationKey, review); } return review; }, () => ({ status: 'succeeded' }));
     const actorInput = { ...socialActorInput(job), ...(job.platform === 'Instagram' && job.config.actor_ref === INSTAGRAM_REELS_ACTOR && env('INSTAGRAM_REEL_SPEECH_ENABLED') === 'true' ? { includeTranscript: true } : {}) };
     if (!await store.launch(job)) continue;
     launched = true;
     const params = new URLSearchParams({ build: job.config.build_number, memory: String(job.config.memory_mb), timeout: String(job.config.timeout_seconds), maxTotalChargeUsd: String(job.config.maximum_usd), restartOnError: 'false' });
     const run = object(object(await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_launch', 'apify', 'discovery', async () => { const response = await apify('acts/' + providerId(job.config.actor_id) + '/runs?' + params, env, fetcher, { method: 'POST', body: JSON.stringify(actorInput) }); const started = object(object(response).data); if (started.actId !== job.config.actor_id || started.userId !== job.config.apify_user_id || started.buildId !== job.config.build_id) throw new CollectionError(502, 'social_run_mismatch', 'The provider run does not match its reviewed identity.'); await store.run(job, providerId(started.id), started.defaultDatasetId ? providerId(started.defaultDatasetId) : null); return response; }, value => ({ status: 'partial', provider_run_id: providerId(object(object(value).data).id) }))).data);
     runId = providerId(run.id);
     if (run.actId !== job.config.actor_id || run.userId !== job.config.apify_user_id || run.buildId !== job.config.build_id) throw new CollectionError(502, 'social_run_mismatch', 'The provider run does not match its reviewed identity.');
    }
    const run = object(object(await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_poll', 'apify', 'discovery', () => apify('actor-runs/' + providerId(runId), env, fetcher), value => ({ status: object(object(value).data).status === 'SUCCEEDED' ? 'succeeded' : ['FAILED','ABORTED','TIMED-OUT'].includes(String(object(object(value).data).status)) ? 'failed' : 'partial', provider_run_id: runId }))).data);
    if (run.id !== runId || run.actId !== job.config.actor_id || run.userId !== job.config.apify_user_id || run.buildId !== job.config.build_id || job.dataset_id && run.defaultDatasetId !== job.dataset_id) throw new CollectionError(502, 'social_run_mismatch', 'The stored provider run identity changed.');
    const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(String(run.status));
    if (!terminal) { await store.finish(job, [], { status: 'partial', complete: false, returned: 0, accepted: 0, rejected: {}, reason: 'provider_running' }, null, false); continue; }
    const fee = typeof run.usageTotalUsd === 'number' && Number.isFinite(run.usageTotalUsd) && run.usageTotalUsd >= 0 ? Math.ceil(run.usageTotalUsd * 1e12) / 1e12 : null;
    if (run.status !== 'SUCCEEDED') { await store.finish(job, [], { status: 'failed', complete: false, returned: 0, accepted: 0, rejected: {}, reason: 'provider_failed' }, fee, true, 'provider_failed'); failed++; continue; }
    const datasetId = providerId(run.defaultDatasetId);
    const rows = await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_dataset', 'apify', 'discovery', () => socialDataset(datasetId, job.config.max_items, env, fetcher), value => ({ status: Array.isArray(value) && value.length ? 'partial' : 'empty', result_count: Array.isArray(value) ? value.length : null, provider_run_id: runId }));
    if (!Array.isArray(rows) || rows.length > job.config.max_items) throw new CollectionError(502, 'social_result_limit_exceeded', 'The source provider exceeded its reviewed result bound.');
    const enriched = new Map<number, InstagramProviderContent>();
    if (job.platform === 'Instagram') for (const [index, value] of rows.entries()) enriched.set(index, await (hostRuntime()?.enrichInstagram?.(value, job.config.actor_ref) ?? normalizeInstagramProviderContent(value, job.config.actor_ref)));
    const normalized = await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_validation', 'apify', 'discovery', async () => normalizeSocialDataset(job, rows, false, enriched), value => ({ status: value.items.length ? 'partial' : 'empty', result_count: value.items.length, provider_run_id: runId, diagnostics: { rejected_rows: Object.values(value.coverage.rejected).reduce((sum, n) => sum + n, 0) } }));
    const diagnostics = await retrievalAttempt(log, { jobId: job.collection_job_id }, job.platform.toLowerCase() + '_apify_diagnostics', 'apify', 'discovery', () => socialDiagnostics(job, run, env, fetcher), value => ({ status: value.blocked_requests || value.failed_targets ? 'blocked' : 'succeeded', provider_run_id: runId, diagnostics: value })).catch(error => { if (error instanceof CollectionError && error.code === 'retrieval_log_unavailable') throw error; return { report_unavailable: true } as Record<string, number | boolean | string>; });
    const blocked = !!(diagnostics.blocked_requests || diagnostics.failed_targets);
    const coverage: SocialCoverage = { ...normalized.coverage, retrieval: 'apify', diagnostics, ...(blocked ? { status: normalized.items.length ? 'partial' : 'blocked', reason: 'provider_blocked' } : {}) };
    if (blocked && !normalized.items.length) await store.finish(job, normalized.items, coverage, fee, true, 'provider_blocked');
    else await store.finish(job, normalized.items, coverage, fee, true); checked++;
   } catch (error) {
    await store.finish(job, [], { status: launched ? 'blocked' : 'failed', complete: false, returned: 0, accepted: 0, rejected: {}, reason: launched ? 'reconciliation_required' : 'configuration_failed' }, null, false, error instanceof CollectionError ? error.code : 'social_collection_failed'); failed++;
   }
  } };
  await Promise.all(Array.from({ length: 6 }, consume));
  return { enabled: allowLaunch, synchronized, checked, failed };
 };
}
export const socialWorkerAuthorized = hourlyWorkerAuthorized;
/** The caller first obtains this exact finite job through the service-only proof
 * RPC. Empty consumers means qualification never adds follows or reader data. */
export async function collectSocialProof(job: SocialJob, env: Env = runtimeEnv, fetcher: typeof fetch = fetch) {
 if (env('SOCIAL_COLLECTION_ENABLED') === 'false') return { enabled: false, synchronized: 0, checked: 0, failed: 0 };
 const store = createSocialStore(env); let claimed = false;
 return createSocialCollector({ env, fetcher, store: { ...store, sync: async () => 0, claim: async () => { if (claimed) return null; claimed = true; return job; } } })();
}
export async function dispatchSocial(env: Env = runtimeEnv, fetcher: typeof fetch = fetch): Promise<{ dispatched: boolean }> {
 const secret = env('HOURLY_COLLECTION_WORKER_SECRET') || '';
 if (secret.length < 32 || secret.length > 256) throw new CollectionError(503, 'social_dispatch_unconfigured', 'Social collection worker is not configured.');
 const response = await fetchNoRedirect(new URL('/.netlify/functions/social-collection-worker', publicHttpsUrl(env('APP_URL'))).href, { method: 'POST', headers: { 'x-hourly-collection-secret': secret, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) }, fetcher);
 await response.body?.cancel(); if (response.status !== 202) throw new CollectionError(503, 'social_dispatch_failed', 'Social collection work was not accepted.');
 return { dispatched: true };
}
