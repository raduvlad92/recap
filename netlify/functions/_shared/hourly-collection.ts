import { providerOnlyCollection } from './provider-content';
import { fetchNoRedirect } from './fetch-no-redirect';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Source, SourceUpdate, WorkspaceState } from '../../../src/lib/types';
import { classifyWatchPageVideoFormat, mergeVideoFormatFields, videoFormatKind, watchPagePlayer, youtubeVideoId } from '../../../src/lib/video-format';
import { sanitizePostContext } from '../../../src/lib/post-context';
import { database } from './admin-data';
import { apifyConfig, startApify, startYouTubeMetadata, startYouTubeDiscovery, pollStoredApify, verifyHourlyApifyConfiguration, YOUTUBE_ACTOR, YOUTUBE_ACTOR_ID } from './apify';
import { createRetrievalLog, retrievalAttempt, type RetrievalLog } from './retrieval-log';
import { normalizePublicFeed } from './public-feed';
import { createPublicOriginalExtractor, needsPublicOriginal, ORIGINAL_REQUESTS_PER_SOURCE } from './public-content';
import { nativeYouTubeDiscovery, DISCOVERY_ITEMS, DISCOVERY_MAX_USD } from './youtube-discovery';
import { settleBudget } from './budget-ledger';
import { hostRuntime } from './host-runtime';
import { assertPreparedMetadataScope, preflightMetadataProvider, startMetadataProvider, pollMetadataProvider, type PreparedMetadataScope, type JoinedMetadataIntent, type MetadataPreflight, type ObservedFormatEvidence } from './youtube-format-provider';
import { startJob, finishJob } from './job-ledger';
import { downloadPublic, downloadHourlySource, downloadYouTubeCaptions, youtubeCaptionUrl, plainText, safeLink, type Download } from './feed';
import { validateSource } from './collect-handler';
import { CollectionError, runtimeEnv, publicHttpsUrl, readTextLimited, type Env } from './security';

export interface HourlyPolicy { user_id: string; enabled: boolean; provider_enabled: boolean; daily_limit_usd: number; lifetime_limit_usd: number }
export interface CaptionTask { record: SourceUpdate; attempts: number; nextAttemptAt: string; status?: 'pending' | 'retry' | 'blocked' | 'provider_pending' | 'unavailable'; reason?: string; checkedAt?: string }
export interface HourlyState {
 user_id: string; source_id: string; fingerprint: string; collection_id: string;
 channel_id: string | null; feed_url: string | null; etag: string | null; last_modified: string | null; content_hash: string | null;
 pending_captions?: CaptionTask[]; workspace_revision: string; initialized_at: string; cursor: Record<string, unknown>;
}
export interface HourlyClaim { source: Source & { youtubeChannelId?: string; channelId?: string }; state: HourlyState; checkId: string; leaseToken: string }
export interface ProviderReference { jobId: string; providerRunId: string | null; actorId: string; itemKey: string; reservedUsd: number; observedCostUsd: number | null; costStatus: 'unknown' | 'provider_reported' }
export interface StoredProviderJob {
 id: string; user_id: string; source_id: string; item_key: string; job_id: string; check_id: string; reservation_id: string;
 actor_id: string; maximum_usd: number; provider_run_id: string | null; job_token: string | null;
 state: 'launch_claimed' | 'running' | 'completed' | 'failed' | 'ambiguous'; actual_cost_usd: number | null; observed_cost_usd?: number | null;
 source_fingerprint: string; discard_result: boolean; content_pending?: boolean; finished_at?: string | null;
}
export type HourlyPatch = Record<string, unknown> & { status: 'unchanged' | 'collected' | 'partial' | 'unsupported' | 'blocked' | 'failed' };
export type ConditionalDownload = Download & { status?: number; etag?: string; lastModified?: string; bytes?: number };
export type HourlyDownload = (url: string, redirects?: number, validators?: { etag?: string; lastModified?: string }) => Promise<ConditionalDownload>;
export interface HourlyStore {
 policies(): Promise<HourlyPolicy[]>;
 schedule(): Promise<Array<{ user_id: string; source_id: string }>>;
 serviced(claim: HourlyClaim, jobId: string): Promise<void>;
 workspace(userId: string): Promise<WorkspaceState | null>;
 claim(userId: string, sourceId: string): Promise<HourlyClaim | null>;
 seen(claim: HourlyClaim): Promise<Set<string>>;
 pending(claim: HourlyClaim): Promise<StoredProviderJob[]>;
 providerClaimed(claim: HourlyClaim, itemKey: string): Promise<boolean>;
 jobCost(jobId: string, userId: string): Promise<number | null>;
 finish(claim: HourlyClaim, patch: HourlyPatch, updates: SourceUpdate[]): Promise<{ retrievedCount: number; importAccepted: boolean }>;
 reserve(claim: HourlyClaim, itemKey: string, jobId: string, maximumUsd: number): Promise<{ claimed: boolean; id: string; reservationId?: string }>;
 providerPatch(id: string, patch: Partial<StoredProviderJob> & { finished_at?: string }): Promise<void>;
 currentArchive?(claim: HourlyClaim, itemKey: string): Promise<SourceUpdate | null>;
 prepareMetadata?(claim: HourlyClaim): Promise<PreparedMetadataScope[]>;
 pendingMetadata?(claim: HourlyClaim): Promise<JoinedMetadataIntent[]>;
 reserveMetadata?(claim: HourlyClaim, scope: PreparedMetadataScope, jobId: string, preflight: MetadataPreflight): Promise<{ claimed: boolean; id: string; reservationId: string; intent: JoinedMetadataIntent }>;
 assertMetadataDispatch?(claim: HourlyClaim, intent: JoinedMetadataIntent): Promise<void>;
 recordMetadata?(claim: HourlyClaim, intent: JoinedMetadataIntent, evidence: Record<string, unknown>): Promise<{ observationId: string; status: string; fee?: unknown; classification?: unknown }>;
 finishMetadata?(claim: HourlyClaim, intent: JoinedMetadataIntent, observationId: string): Promise<{ applied: boolean; reason?: string }>;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : v ? [v] : []).map(object);
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const validChannel = (v: unknown): v is string => typeof v === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(v);
const unavailable = () => new CollectionError(503, 'hourly_store_unavailable', 'Hourly collection storage is unavailable.');

/** No catalogue, fixture, collection membership or browser-provided inventory. */
export function followedHourlySources(workspace: WorkspaceState): Source[] {
 const followed = new Set(workspace.followedSourceIds);
 const sources = new Map<string, Source>();
 for (const raw of workspace.customSources) {
  if (!raw || raw.status === 'sample' || !followed.has(raw.id)) continue;
  // Validation happens after the durable check is claimed so invalid saved
  // sources get an honest failed check without blocking the other follows.
  sources.set(raw.id, raw);
 }
 return [...sources.values()];
}

/** Match old tech/live IDs and YouTube URL aliases through original identity. */
export function hourlyItemKey(value: string): string {
 const url = publicHttpsUrl(value);
 let video: string | null = null;
 if (['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)) {
  if (url.pathname === '/watch') video = url.searchParams.get('v');
  else video = /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(url.pathname)?.[1] || null;
 } else if (url.hostname === 'youtu.be') video = /^\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(url.pathname)?.[1] || null;
 if (video && /^[A-Za-z0-9_-]{11}$/.test(video)) return 'youtube:' + video;
 return url.href.replace(/\/$/, '');
}
function archiveIdentity(update: SourceUpdate): SourceUpdate {
 return { ...update, id: 'hourly-' + digest(update.sourceId + '\n' + hourlyItemKey(update.url)).slice(0, 32), isSample: false };
}
function goodUpdate(update: SourceUpdate, source: Source): boolean {
 try { return update.sourceId === source.id && update.isSample === false && Number.isFinite(Date.parse(update.publishedAt)) && !!hourlyItemKey(update.url) && (update.postContext === undefined || source.platform === 'X' && update.format === 'post' && isDeepStrictEqual(update.postContext, sanitizePostContext(update.postContext, update.url))); } catch { return false; }
}

export function createHourlyStore(env: Env = runtimeEnv): HourlyStore {
 const db = database(env);
 async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await db.rpc(name, args);
  if (result.error) throw new CollectionError(result.error.code === 'PT402' ? 402 : result.error.code === 'PT409' ? 409 : 503,
   result.error.code === 'PT402' ? 'collection_budget_exhausted' : result.error.code === 'PT409' ? 'hourly_state_changed' : 'hourly_store_unavailable', 'Hourly collection could not safely continue.');
  return result.data as T;
 }
 return {
  async policies() { const r = await db.from('reader_collection_policies').select('*').eq('enabled', true).order('user_id'); if (r.error) throw unavailable(); return r.data as HourlyPolicy[]; },
  schedule: () => rpc('schedule_hourly_sources', {}),
  serviced: (claim, jobId) => rpc('service_hourly_provider', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_provider_job_id: jobId }),
  async workspace(userId) { const r = await db.from('reader_workspaces').select('state').eq('user_id', userId).maybeSingle(); if (r.error) throw unavailable(); return r.data?.state as WorkspaceState || null; },
  claim: (userId, sourceId) => rpc('claim_hourly_source', { p_user_id: userId, p_source_id: sourceId }),
  async seen(claim) {
   const keys = new Set<string>();
   for (let offset = 0; ; offset += 1000) {
    const r = await db.from('reader_collection_seen_items').select('item_key').eq('user_id', claim.state.user_id).eq('source_id', claim.source.id).order('item_key').range(offset, offset + 999);
    if (r.error) throw unavailable(); for (const row of r.data) keys.add(row.item_key);
    if (r.data.length < 1000) return keys;
   }
  },
  pending: claim => rpc('pending_hourly_providers', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken }),
  async providerClaimed(claim, itemKey) { const r = await db.from('reader_collection_provider_jobs').select('id').eq('user_id', claim.state.user_id).eq('source_id', claim.source.id).eq('item_key', itemKey).maybeSingle(); if (r.error) throw unavailable(); return !!r.data; },
  async jobCost(jobId, userId) { const r = await db.from('collection_jobs').select('observed_cost_usd').eq('id', jobId).eq('user_id', userId).single(); if (r.error) throw unavailable(); return r.data.observed_cost_usd === null ? null : Number(r.data.observed_cost_usd); },
  finish: (claim, patch, updates) => rpc('finish_hourly_source', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_patch: patch, p_items: updates.map(record => ({ itemKey: hourlyItemKey(record.url), record })) }),
  reserve: (claim, itemKey, jobId, maximumUsd) => rpc(itemKey.startsWith('youtube:') ? 'reserve_hourly_caption_provider' : 'reserve_hourly_provider', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_item_key: itemKey, p_job_id: jobId, p_actor_id: YOUTUBE_ACTOR_ID, p_maximum_usd: maximumUsd, p_parent_reservation_id: env('HOURLY_COLLECTION_BUDGET_PARENT_ID') || null }),
  async providerPatch(id, patch) { const r = await db.from('reader_collection_provider_jobs').update(patch).eq('id', id).select('id').single(); if (r.error || !r.data) throw unavailable(); },
  async currentArchive(claim, itemKey) {
   const seen = await db.from('reader_collection_seen_items').select('archive_id').eq('user_id', claim.state.user_id).eq('source_id', claim.source.id).eq('item_key', itemKey).maybeSingle();
   if (seen.error) throw unavailable(); if (!seen.data) return null;
   const result = await db.from('reader_source_updates').select('record').eq('user_id', claim.state.user_id).eq('source_id', claim.source.id).eq('id', seen.data.archive_id).maybeSingle();
   if (result.error) throw unavailable(); const record = result.data?.record as SourceUpdate | undefined;
   if (record && (!goodUpdate(record, claim.source) || hourlyItemKey(record.url) !== itemKey)) throw unavailable();
   return record || null;
  },
  prepareMetadata: claim => hostRuntime()?.pipelineCapability ? rpc('prepare_hourly_metadata_provider', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_scope_id: null, p_capability: hostRuntime()!.pipelineCapability }) : Promise.resolve([]),
  pendingMetadata: claim => hostRuntime()?.pipelineCapability ? rpc('pending_hourly_metadata_providers', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_capability: hostRuntime()!.pipelineCapability }) : Promise.resolve([]),
  reserveMetadata: (claim, scope, jobId, preflight) => rpc('reserve_hourly_metadata_provider', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_scope_id: scope.scopeId, p_job_id: jobId, p_prepared_digest: scope.preparedDigest, p_preflight: preflight, p_capability: hostRuntime()?.pipelineCapability || null }),
  async assertMetadataDispatch(claim, intent) {
   if (await rpc('assert_hourly_metadata_dispatch', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_intent_id: intent.id, p_capability: hostRuntime()?.pipelineCapability || null }) !== true) throw new CollectionError(409, 'metadata_dispatch_changed', 'Metadata admission changed before dispatch.');
  },
  // Each fresh provider read is a distinct immutable observation. Its time is
  // material: a terminal fee can become final only after the native quiet age.
  // Replaying the same captured payload still produces the same receipt key.
  recordMetadata: (claim, intent, evidence) => rpc('record_hourly_metadata_observation', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_intent_id: intent.id, p_observation_key: 'metadata.' + intent.id + '.' + digest(JSON.stringify(evidence)), p_evidence: evidence, p_capability: hostRuntime()?.pipelineCapability || null }),
  finishMetadata: (claim, intent, observationId) => rpc('finish_hourly_metadata_provider', { p_check_id: claim.checkId, p_lease_token: claim.leaseToken, p_intent_id: intent.id, p_observation_id: observationId, p_capability: hostRuntime()?.pipelineCapability || null }),
 };
}

/** Resolve only the current saved source link. Channel ID is persisted after the
 * first free lookup. No search provider or catalogue sweep is involved. */
export async function resolveHourlyYouTubeChannel(source: HourlyClaim['source'], state: HourlyState, download: HourlyDownload): Promise<string> {
 const url = publicHttpsUrl(source.url);
 if (!['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) throw new CollectionError(422, 'youtube_channel_unresolved', 'A YouTube channel link is required for RSS freshness checks.');
 const pathId = /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/.exec(url.pathname)?.[1];
 if (pathId) return pathId;
 if (validChannel(source.youtubeChannelId)) return source.youtubeChannelId;
 if (validChannel(source.channelId)) return source.channelId;
 if (validChannel(state.channel_id)) return state.channel_id;
 if (!/^\/(?:@[^/]+|(?:c|user)\/[^/]+)(?:\/(?:videos|shorts|streams))?\/?$/.test(url.pathname)) throw new CollectionError(422, 'youtube_channel_unresolved', 'This saved link cannot be checked as a channel feed.');
 const response = await download(url.href);
 if (!['youtube.com','www.youtube.com','m.youtube.com'].includes(new URL(response.url).hostname)) throw new CollectionError(422, 'youtube_channel_unresolved', 'The channel redirected outside YouTube.');
 // Prefer channel-specific metadata, never a generic recommendation channelId.
 const html = response.text;
 const candidates = [
  /<meta\b[^>]*itemprop=["']channelId["'][^>]*content=["'](UC[A-Za-z0-9_-]{22})["']/i.exec(html)?.[1],
  /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/(?:www\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i.exec(html)?.[1],
  /"channelMetadataRenderer"\s*:\s*\{[\s\S]{0,10000}?"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(html)?.[1],
 ];
 const channelId = candidates.find(validChannel);
 if (!channelId) throw new CollectionError(422, 'youtube_channel_unresolved', 'The public page did not identify its own stable channel.');
 return channelId;
}

const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false });
const builder = new XMLBuilder({ ignoreAttributes: false });
function parsedXml(text: string): Record<string, unknown> {
 if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new CollectionError(422, 'invalid_feed', 'The source returned invalid or unsafe XML.');
 return object(parser.parse(text));
}
export function parseHourlyYouTubeFeed(text: string, source: Source, channelId: string): { updates: SourceUpdate[]; invalidCount: number; gapPossible: boolean } {
 const feed = object(parsedXml(text).feed);
 // YouTube's Atom header can omit UC; individual entries still use the full ID.
 const headerChannelId = String(feed['yt:channelId'] || '');
 if (headerChannelId !== channelId && headerChannelId !== channelId.slice(2)) throw new CollectionError(422, 'youtube_channel_mismatch', 'The RSS feed belongs to a different channel.');
 const updates: SourceUpdate[] = []; let invalidCount = 0;
 const entries = list(feed.entry);
 for (const entry of entries.slice(0, 100)) {
  const videoId = String(entry['yt:videoId'] || ''), date = String(entry.published || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !Number.isFinite(Date.parse(date)) || (entry['yt:channelId'] && entry['yt:channelId'] !== channelId)) { invalidCount++; continue; }
  const group = object(entry['media:group']);
  const description = plainText(group['media:description'], 700);
  const thumbnail = object(group['media:thumbnail'])['@_url'];
  updates.push(archiveIdentity({ id: '', sourceId: source.id, contributorIds: [], title: plainText(entry.title, 240) || 'Untitled video', summary: description,
   url: 'https://www.youtube.com/watch?v=' + videoId, publishedAt: new Date(date).toISOString(), format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'metadata_only', videoFormat: { kind: 'unknown', basis: 'legacy' },
   ...(typeof thumbnail === 'string' && safeLink(thumbnail, source.url) ? { image: safeLink(thumbnail, source.url) } : {}),
   coverage: 'Public YouTube RSS metadata; spoken content and full channel history are not established.' }));
 }
 return { updates, invalidCount, gapPossible: entries.length >= 15 };
}
function parseHourlyFeed(text: string, source: Source, url: string): { updates: SourceUpdate[]; invalidCount: number; gapPossible: boolean } {
 const root = parsedXml(text), rss = object(root.rss), channel = object(rss.channel || root['rdf:RDF'] || root.feed);
 const entries = list(channel.item || channel.entry);
 if (!Object.keys(channel).length) throw new CollectionError(422, 'feed_not_found', 'No RSS or Atom feed was found.');
 const updates = new Map<string, SourceUpdate>(); let invalidCount = 0;
 // Normalize each item separately to preserve the manual collector's five-item
 // limit while hourly collection processes the bounded whole current feed.
 for (const entry of entries.slice(0, 100)) {
  const xml = root.feed ? builder.build({ feed: { title: channel.title, entry } }) : builder.build({ rss: { channel: { title: channel.title, item: entry } } });
  const normalized = normalizePublicFeed(xml, source, url).updates[0];
  if (!normalized || !goodUpdate(normalized, source)) { invalidCount++; continue; }
  updates.set(hourlyItemKey(normalized.url), archiveIdentity(normalized));
 }
 return { updates: [...updates.values()], invalidCount, gapPossible: entries.length > 100 };
}
function discoverFeed(response: ConditionalDownload): string {
 for (const match of response.text.slice(0, 512_000).matchAll(/<link\b[^>]*>/gi)) {
  const tag = match[0];
  if (!/\brel\s*=\s*["'][^"']*alternate[^"']*["']/i.test(tag) || !/\btype\s*=\s*["']application\/(?:rss|atom)\+xml["']/i.test(tag)) continue;
  const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  const link = safeLink(href?.replace(/&amp;/g, '&'), response.url); if (link) return link;
 }
 if (new URL(response.url).hostname.endsWith('.substack.com')) return new URL('/feed', response.url).href;
 throw new CollectionError(422, 'feed_not_found', 'A public RSS or Atom feed could not be found.');
}

export interface CaptionResult { content?: string; transcriptSegments?: SourceUpdate['transcriptSegments']; coverage: string; videoFormat?: SourceUpdate['videoFormat']; captionStatus?: 'retrieved' | 'unavailable' | 'retry'; reason?: string }
export const HOURLY_WATCH_PAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Fixed first-party watch endpoint only; larger than RSS but still bounded.
 * No cookies, arbitrary URLs, redirect following or provider discovery. */
export async function downloadHourlyWatchPage(value: string, _redirects = 0, _validators: { etag?: string; lastModified?: string } = {}, fetcher: typeof fetch = fetch): Promise<ConditionalDownload> {
 const url = publicHttpsUrl(value);
 if (url.hostname !== 'www.youtube.com' || url.pathname !== '/watch' || url.searchParams.size !== 1 || !youtubeVideoId(url.href)) throw new CollectionError(400, 'unsafe_watch_page', 'Only an exact public YouTube watch page is supported.');
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
 try {
  const response = await fetchNoRedirect(url.href, { signal: controller.signal, headers: { accept: 'text/html' } }, fetcher);
  if (response.status !== 200 || response.url && youtubeVideoId(response.url) !== youtubeVideoId(url.href)) {
   await response.body?.cancel(); throw new CollectionError(422, 'source_unavailable', 'The public video page is unavailable.', response.status);
  }
  const text = await readTextLimited(response, HOURLY_WATCH_PAGE_MAX_BYTES);
  return { text, url: url.href, status: 200, contentType: response.headers.get('content-type') || '', bytes: Buffer.byteLength(text) };
 } catch (error) {
  if (controller.signal.aborted) throw new CollectionError(504, 'source_timeout', 'The public video page took too long to respond.');
  throw error;
 } finally { clearTimeout(timer); }
}
/** Classification survives missing/broken captions. Failure is a retrieval gap,
 * never evidence that the original has no captions or is a regular video. */
export async function nativeHourlyCaptions(videoId: string, download: HourlyDownload = downloadHourlyWatchPage, captionDownload: HourlyDownload = download === downloadHourlyWatchPage || download === downloadPublic ? downloadYouTubeCaptions : download): Promise<CaptionResult | null> {
 if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new CollectionError(400, 'invalid_video_id', 'Invalid YouTube video ID.');
 const page = await download('https://www.youtube.com/watch?v=' + videoId);
 const videoFormat = { ...classifyWatchPageVideoFormat(page.text, videoId, page.url), checkedAt: new Date().toISOString() };
 const missing = (reason: string, captionStatus: 'unavailable' | 'retry' = 'retry'): CaptionResult => ({ videoFormat, captionStatus, reason, coverage: 'Video format checked from public page metadata; usable captions were not retrieved; spoken content is not established.' });
 const player = watchPagePlayer(page.text);
 if (youtubeVideoId(page.url) !== videoId || !player || object(player.videoDetails).videoId !== videoId) return missing('watch_page_identity_unconfirmed');
 if (object(player.playabilityStatus).status !== 'OK') return missing('watch_page_playability_unavailable');
 const tracks = list(object(object(player.captions).playerCaptionsTracklistRenderer).captionTracks);
 const track = tracks.find(t => t.kind !== 'asr') || tracks[0];
 if (!track || typeof track.baseUrl !== 'string') return missing('caption_tracks_not_supplied', 'unavailable');
 let captionUrl: URL;
 try { captionUrl = youtubeCaptionUrl(track.baseUrl); } catch { return missing('unsafe_caption_url'); }
 if (!['youtube.com','www.youtube.com'].includes(captionUrl.hostname) || captionUrl.pathname !== '/api/timedtext' || captionUrl.searchParams.get('v') !== videoId) return missing('caption_video_mismatch');
 captionUrl.searchParams.set('fmt', 'json3');
 let captions: ConditionalDownload;
 try { captions = await captionDownload(captionUrl.href); } catch (error) { return missing(error instanceof CollectionError ? error.code : 'caption_download_failed'); }
 let data: Record<string, unknown>;
 try { data = object(JSON.parse(captions.text)); } catch { return missing('caption_response_invalid'); }
 const segments: NonNullable<SourceUpdate['transcriptSegments']> = [];
 let characters = 0;
 for (const event of list(data.events)) {
  const text = list(event.segs).map(s => typeof s.utf8 === 'string' ? s.utf8 : '').join('').replace(/\s+/g, ' ').trim();
  const startMs = Number(event.tStartMs), durationMs = Number(event.dDurationMs);
  if (!text || !Number.isFinite(startMs) || startMs < 0) continue;
  if (characters + text.length > 200_000 || segments.length >= 10_000) break;
  characters += text.length; segments.push({ text, startSeconds: startMs / 1000, ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationSeconds: durationMs / 1000 } : {}) });
 }
 if (!segments.length) return missing('caption_text_not_supplied');
 return { content: segments.map(s => s.text).join('\n'), transcriptSegments: segments, videoFormat, captionStatus: 'retrieved',
  coverage: 'Existing public YouTube captions retrieved without a scraping supplier; visual content and completeness are not verified; bounded to 200,000 characters.' };
}

interface Dependencies {
 env: Env; store: HourlyStore; log: RetrievalLog; discover: typeof nativeYouTubeDiscovery; startDiscovery: typeof startYouTubeDiscovery; download: HourlyDownload; captions: (videoId: string) => Promise<CaptionResult | null>;
 startApify: typeof startApify; startMetadata: typeof startYouTubeMetadata; pollApify: typeof pollStoredApify; preflight: typeof verifyHourlyApifyConfiguration;
 startJob: typeof startJob; finishJob: typeof finishJob; settleBudget: typeof settleBudget; now: () => number; pause: (ms: number) => Promise<void>;
 metadataPreflight: typeof preflightMetadataProvider; metadataStart: typeof startMetadataProvider; metadataPoll: typeof pollMetadataProvider;
 enrichMetadata: (intentId: string, run: unknown, rows: unknown) => Promise<ObservedFormatEvidence>;
}
function providerReference(job: StoredProviderJob): ProviderReference {
 return { jobId: job.job_id, providerRunId: job.provider_run_id, actorId: job.actor_id, itemKey: job.item_key, reservedUsd: Number(job.maximum_usd), observedCostUsd: job.actual_cost_usd === null ? null : Number(job.actual_cost_usd), costStatus: job.actual_cost_usd === null ? 'unknown' : 'provider_reported' };
}

export function createHourlyCollector(overrides: Partial<Dependencies> = {}) {
 const env = overrides.env || runtimeEnv;
 if (env('HOURLY_COLLECTION_ENABLED') !== 'true') return async () => ({ enabled: false, checked: 0, failed: 0, skipped: 0, statuses: {} });
 const deps: Dependencies = { env, log: overrides.log || createRetrievalLog(env), discover: nativeYouTubeDiscovery, startDiscovery: startYouTubeDiscovery, store: overrides.store || createHourlyStore(env), download: downloadHourlySource, captions: nativeHourlyCaptions, startApify, startMetadata: startYouTubeMetadata, pollApify: pollStoredApify, preflight: verifyHourlyApifyConfiguration, startJob, finishJob, settleBudget, now: Date.now, pause: ms => new Promise(resolve => setTimeout(resolve, ms)), metadataPreflight: preflightMetadataProvider, metadataStart: startMetadataProvider, metadataPoll: pollMetadataProvider,
 enrichMetadata: async (id, run, rows) => { const stage = hostRuntime()?.enrichYouTubeFormat; if (!stage) throw new CollectionError(503, 'metadata_service_unavailable', 'The private metadata service is unavailable.'); return stage(id, run, rows); }, ...overrides };
 const verified = new Set<string>();
 // Request sharing is scoped to one bounded worker run, never an isolate lifetime.
 let extractOriginal = createPublicOriginalExtractor(deps.download);
 async function processSource(policy: HourlyPolicy, sourceId: string, workerDeadline: number): Promise<string> {
  const claimed = await deps.store.claim(policy.user_id, sourceId); if (!claimed) return 'skipped';
  const claim: HourlyClaim = claimed;
  let source = claim.source;
  const captionQueue = new Map<string, CaptionTask>();
  // Malformed/unknown durable tasks are retained verbatim, never silently
  // removed or turned into an unbounded attempt/date calculation.
  const retainedTasks: CaptionTask[] = [];
  for (const task of claim.state.pending_captions || []) {
   if (!task || !task.record || !goodUpdate(task.record, claim.source) || !Number.isSafeInteger(task.attempts) || task.attempts < 0 || !Number.isFinite(Date.parse(task.nextAttemptAt)) || task.status !== undefined && !['pending','retry','blocked','provider_pending','unavailable'].includes(task.status)) { retainedTasks.push(task); continue; }
   const key = hourlyItemKey(task.record.url);
   if (!captionQueue.has(key)) captionQueue.set(key, { ...task });
  }
  const configuredAttempts = Number(deps.env('HOURLY_COLLECTION_MAX_NEW_VIDEOS') || 20);
  const captionLimit = Number.isFinite(configuredAttempts) && Number.isInteger(configuredAttempts) && configuredAttempts > 0 ? Math.min(20, configuredAttempts) : 20;
  const attemptedIdentities = new Set<string>();
  let remainingCaptionAttempts = captionLimit;
  const updates = new Map<string, SourceUpdate>(); const references: ProviderReference[] = [];
  // Write-only CAS metadata is kept outside source records and pending tasks.
  // The database compares it with the live archive row under its write lock;
  // a queue snapshot match alone is not authority to classify a later revision.
  const metadataExpectedHashes = new Map<string, string>();
  function stageUpdate(key: string, record: SourceUpdate, expectedMetadataHash?: string) {
   if (expectedMetadataHash) metadataExpectedHashes.set(key, expectedMetadataHash); else metadataExpectedHashes.delete(key);
   updates.set(key, record);
  }
  const sourceStartedAt = deps.now();
  const sourceDeadline = Math.min(workerDeadline, sourceStartedAt + 90_000);
  let patch: HourlyPatch = { status: 'unchanged', new_count: 0 }, partial = retainedTasks.length > 0;
  let metadataCheck = false;
  const completedJobs: Array<{ id: string; patch: Partial<StoredProviderJob> & { finished_at?: string } }> = [];
  const originalQueue = new Map<string, SourceUpdate>();
  for (const raw of Array.isArray(claim.state.cursor.pendingOriginals) ? claim.state.cursor.pendingOriginals.slice(0, 100) : []) {
   if (raw && typeof raw === 'object' && goodUpdate(raw as SourceUpdate, claim.source) && needsPublicOriginal(raw as SourceUpdate)) originalQueue.set(hourlyItemKey((raw as SourceUpdate).url), raw as SourceUpdate);
  }
  let originalRequests = 0;
  async function processOriginals(feedUrl: string) {
   for (const [key, record] of originalQueue) {
    if (originalRequests >= ORIGINAL_REQUESTS_PER_SOURCE || deps.now() > sourceDeadline - 45_000) break;
    originalRequests++;
    let enriched: SourceUpdate;
    try { enriched = await extractOriginal(source, record, feedUrl, deps.log, { checkId: claim.checkId }); }
    catch (error) {
     if (error instanceof CollectionError && error.code === 'original_batch_limit') break;
     if (error instanceof CollectionError && error.code === 'retrieval_log_unavailable') throw error;
     enriched = { ...record, contentKind: 'metadata_only', originalContent: { ...record.originalContent!, status: 'failed', reason: error instanceof CollectionError ? error.code : 'original_retrieval_failed' }, coverage: 'Original text retrieval failed; only metadata or an incomplete extract is available. No automatic repeat is scheduled.' };
    }
    originalQueue.delete(key); stageUpdate(key, enriched);
    if (enriched.originalContent?.status !== 'usable') partial = true;
   }
  }
  let details: Record<string, unknown> = { coverage: 'Checks cover only the current public feed; full history and source completeness remain unverified.' };
  async function save() {
   if (metadataCheck) {
    const known = references.length > 0 && references.every(ref => ref.observedCostUsd !== null);
    const outcome = await deps.store.finish(claim, { status: patch.status, new_count: 0, provider: 'apify',
     cost_status: known ? 'provider_reported' : 'unknown', observed_cost_usd: known ? references.reduce((sum, ref) => sum + ref.observedCostUsd!, 0) : null,
     ...(patch.error_code ? { error_code: patch.error_code } : {}), details: { ...details, mode: 'metadata_only_provider', coverage: 'Bounded provider format evidence only; no source publication, caption acquisition or ordinary feed import.', providerJobs: references } }, []);
    if (!outcome.importAccepted) { patch.status = 'blocked'; patch.error_code = 'hourly_state_changed'; }
    return;
   }
   const deferred = [...captionQueue].filter(([key, task]) => !attemptedIdentities.has(key) && task.status !== 'provider_pending' && Date.parse(task.nextAttemptAt) <= deps.now()).length;
   if (deferred) { partial = true; details.deferredCount = deferred; }
   if (retainedTasks.length) details.invalidCaptionTasks = retainedTasks.length;
   if (references.length) {
    const known = references.every(ref => ref.observedCostUsd !== null);
    patch = { ...patch, provider: 'apify', cost_status: known ? 'provider_reported' : 'unknown', observed_cost_usd: known ? references.reduce((sum, ref) => sum + ref.observedCostUsd!, 0) : null,
     ...(references.length === 1 ? { job_id: references[0].jobId, provider_run_id: references[0].providerRunId } : {}) };
    details = { ...details, providerJobs: references, reservedUsd: references.reduce((sum, ref) => sum + ref.reservedUsd, 0) };
   }
   for (const [key, update] of updates) if (source.platform === 'YouTube' && update.format === 'video' && update.contentKind === 'transcript' && update.content) {
    if (videoFormatKind(update) !== 'unknown') captionQueue.delete(key);
    else {
     // Captions and Shorts classification are independent. Retain a distinct
     // format stage after a provider supplies text without checked video type.
     const prior = captionQueue.get(key);
     captionQueue.set(key, { ...(prior || { attempts: 0, nextAttemptAt: new Date(deps.now() + 3600_000).toISOString() }), record: update, status: 'retry', reason: 'video_format_unconfirmed' });
     partial = true;
    }
   }
   if (['Blog','Substack','Podcast'].includes(source.platform)) {
    if (originalQueue.size) partial = true;
    details.originalDeferredCount = originalQueue.size;
    details.originalAttempts = originalRequests;
    patch.cursor = { ...(patch.cursor as Record<string, unknown> || claim.state.cursor), pendingOriginals: [...originalQueue.values()].map(({ content: _text, transcriptSegments: _segments, ...record }) => record) };
   }
   if (partial && ['collected','unchanged'].includes(patch.status)) patch.status = 'partial';
   const outcome = await deps.store.finish(claim, { ...patch, details, pending_captions: [...captionQueue.values(), ...retainedTasks] }, [...updates].map(([key, record]) => metadataExpectedHashes.has(key) ? { ...record, metadataExpectedContentHash: metadataExpectedHashes.get(key)! } : record));
   if (!outcome.importAccepted) { patch.status = 'blocked'; patch.error_code = 'hourly_state_changed'; return; }
   for (const completed of completedJobs) await deps.store.providerPatch(completed.id, completed.patch);
  }
  async function reconcileMetadata(intent: JoinedMetadataIntent): Promise<void> {
   assertPreparedMetadataScope(intent);
   const ref: ProviderReference = { jobId: intent.jobId, providerRunId: intent.providerRunId, actorId: intent.contract.actorId, itemKey: intent.itemKey, reservedUsd: 0.005, observedCostUsd: intent.actualCostUsd === null ? null : Number(intent.actualCostUsd), costStatus: intent.actualCostUsd === null ? 'unknown' : 'provider_reported' };
   references.push(ref); partial = true;
   if (!intent.providerRunId) { details.metadataStatus = 'metadata_launch_ambiguous'; return; }
   if (!deps.store.recordMetadata || !deps.store.finishMetadata) throw unavailable();
   const polled = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey: intent.itemKey }, 'youtube_metadata_candidate_result', 'apify', 'content', () => deps.metadataPoll(intent, policy.user_id, deps.env), result => ({ status: result.status === 'running' ? 'partial' : result.contentError || result.status === 'failed' ? 'failed' : 'succeeded', provider_run_id: intent.providerRunId, error_code: result.contentError || null }));
   // Fee/status evidence survives missing fields, invalid classification and
   // oversized datasets. Only native numeric accounting can settle it.
   const statusReceipt = await deps.store.recordMetadata(claim, intent, { kind: 'status', ...polled.fee });
   const finalFee = object(statusReceipt.fee).actualUsd;
   if (typeof finalFee === 'string' && Number.isFinite(Number(finalFee)) && Number(finalFee) >= 0) { ref.observedCostUsd = Number(finalFee); ref.costStatus = 'provider_reported'; }
   if (object(statusReceipt.fee).lateCorrectionRequired === true) { details.metadataStatus = 'provider_final_fee_changed'; return; }
   if (polled.contentError) {
    await deps.store.recordMetadata(claim, intent, { kind: 'result', ...polled.fee, datasetSha256: polled.datasetSha256 || null, channelId: intent.target.channelId, classification: null, contentError: polled.contentError });
    details.metadataStatus = polled.contentError; return;
   }
   if (!polled.rows || polled.status !== 'completed') { details.metadataStatus = polled.status === 'running' ? 'provider_pending' : 'provider_failed'; return; }
   let classification: ObservedFormatEvidence;
   try { classification = await deps.enrichMetadata(intent.id, polled.run, polled.rows); }
   catch (error) {
    const reason = error instanceof CollectionError ? error.code : '';
    if (!['metadata_explicit_format_missing','metadata_result_identity_changed','metadata_result_incomplete'].includes(reason)) throw error;
    await deps.store.recordMetadata(claim, intent, { kind: 'result', ...polled.fee, datasetSha256: polled.datasetSha256 || null, channelId: intent.target.channelId, classification: null, contentError: reason });
    details.metadataStatus = reason; return;
   }
   const receipt = await deps.store.recordMetadata(claim, intent, { kind: 'result', ...polled.fee, datasetSha256: polled.datasetSha256, channelId: intent.target.channelId, classification });
   if (intent.purpose === 'qualification') { details.metadataStatus = 'qualification_observed_not_imported'; return; }
   if (deps.env('HOURLY_COLLECTION_METADATA_VERIFIED') !== 'true') { details.metadataStatus = 'metadata_repair_disabled'; return; }
   if (typeof finalFee !== 'string' || !Number.isFinite(Number(finalFee)) || Number(finalFee) <= 0) { details.metadataStatus = 'metadata_fee_pending'; return; }
   const outcome = await deps.store.finishMetadata(claim, intent, receipt.observationId);
   details.metadataStatus = outcome.applied ? 'metadata_repaired' : outcome.reason || 'metadata_source_changed';
  }
  async function processMetadataScopes(scopes: PreparedMetadataScope[]): Promise<void> {
   if (scopes.length !== 1) throw new CollectionError(409, 'metadata_scope_ambiguous', 'Exactly one finite metadata scope is required.');
   const scope = scopes[0]; assertPreparedMetadataScope(scope);
   partial = true;
   if (!policy.provider_enabled || deps.env('HOURLY_COLLECTION_PROVIDER_VERIFIED') !== 'true' || scope.purpose === 'repair' && deps.env('HOURLY_COLLECTION_METADATA_VERIFIED') !== 'true') { details.metadataStatus = 'metadata_provider_disabled'; return; }
   if (!deps.store.reserveMetadata || !deps.store.recordMetadata || !deps.store.assertMetadataDispatch) throw unavailable();
   // No native platform lookup or captions occur anywhere in this branch.
   if (deps.now() > sourceDeadline - 30_000) throw new CollectionError(409, 'metadata_source_time_limit', 'The metadata source deadline is too close.');
   const preflight = await deps.metadataPreflight(scope, policy.user_id, deps.env);
   let jobId: string | undefined, intent: JoinedMetadataIntent | undefined;
   try {
    jobId = await deps.startJob({ ...source, url: scope.target.url, provider: 'apify', actorId: scope.contract.actorId }, policy.user_id, deps.env);
    const reservation = await deps.store.reserveMetadata(claim, scope, jobId, preflight);
    if (!reservation.claimed) { await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: 'provider_already_claimed' }, deps.env); details.metadataStatus = 'metadata_already_admitted'; return; }
    intent = reservation.intent;
    assertPreparedMetadataScope(intent);
    if (intent.scopeId !== scope.scopeId || intent.itemKey !== scope.itemKey || intent.requestSha256 !== scope.requestSha256 || intent.jobId !== jobId || intent.providerRunId !== null) throw new CollectionError(409, 'metadata_intent_changed', 'The saved metadata intent changed.');
    const started = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey: intent.itemKey }, 'youtube_metadata_candidate_launch', 'apify', 'content', async () => {
     await deps.store.assertMetadataDispatch!(claim, intent!);
     if (deps.now() > sourceDeadline - 30_000) throw new CollectionError(409, 'metadata_source_time_limit', 'The metadata source deadline changed before dispatch.');
     return deps.metadataStart(intent!, policy.user_id, deps.env);
    }, result => ({ status: 'partial', provider_run_id: result.providerRunId }));
    await deps.store.recordMetadata(claim, intent, { kind: 'ack', runId: started.providerRunId, responseSha256: started.responseSha256, observedAt: started.observedAt });
    intent = { ...intent, providerRunId: started.providerRunId, state: 'running' };
    await reconcileMetadata(intent);
   } catch (error) {
    if (intent) {
     // A claimed financial identity is never recycled after an uncertain POST
     // or ACK. Its native row/hold remains recoverable under the SAME run.
     if (!intent.providerRunId) try { await deps.store.providerPatch(intent.id, { state: 'ambiguous' }); } catch { /* Durable native admission remains held. */ }
    } else if (jobId) await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: error instanceof CollectionError ? error.code : 'metadata_admission_failed' }, deps.env);
    throw error;
   }
  }
  async function reconcileJob(job: StoredProviderJob): Promise<boolean> {
    // Touch only work we actually service, including no-run ambiguous holds.
    // The RPC checks this source's current lease/workspace before advancing.
    await deps.store.serviced(claim, job.id);
    const ref = references.find(r => r.jobId === job.job_id) || providerReference(job); if (!references.includes(ref)) references.push(ref);
    if (!job.provider_run_id) { partial = true; details.captionStatus = 'provider_launch_ambiguous'; const task = captionQueue.get(job.item_key.startsWith('youtube-format:') ? 'youtube:' + job.item_key.split(':')[1] : job.item_key); if (task) { task.status = 'blocked'; task.reason = 'provider_launch_ambiguous'; } return false; }
    const discoveryChannelId = /^youtube-discovery:(UC[A-Za-z0-9_-]{22}):\d{4}-\d\d-\d\d$/.exec(job.item_key)?.[1];
    const metadataMatch = /^youtube-format:([A-Za-z0-9_-]{11}):([a-f0-9]{64})$/.exec(job.item_key);
    const videoId = metadataMatch?.[1] || job.item_key.replace(/^youtube:/, '');
    const targetKey = metadataMatch ? 'youtube:' + videoId : job.item_key;
    const metadataBase = metadataMatch ? updates.get(targetKey) || captionQueue.get(targetKey)?.record : undefined;
    const metadataSourceMatches = !metadataMatch || metadataBase?.contentKind === 'transcript' && typeof metadataBase.content === 'string' && digest(metadataBase.content) === metadataMatch[2];
    try {
     const feeOnly = job.discard_result || job.source_fingerprint !== claim.state.fingerprint || job.content_pending === false || !metadataSourceMatches;
     const result = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey: job.item_key }, discoveryChannelId ? 'youtube_apify_discovery_result' : metadataMatch ? 'youtube_apify_metadata_result' : 'youtube_apify_caption_result', 'apify', discoveryChannelId ? 'discovery' : 'content', () => deps.pollApify({ providerRunId: job.provider_run_id!, actorId: YOUTUBE_ACTOR_ID, source: { ...source, url: discoveryChannelId ? 'https://www.youtube.com/channel/' + discoveryChannelId : 'https://www.youtube.com/watch?v=' + videoId }, maxItems: discoveryChannelId ? DISCOVERY_ITEMS : 1, ledgerId: job.job_id, feeOnly, ...(discoveryChannelId ? { discoveryChannelId } : {}), ...(metadataMatch ? { metadataOnly: true } : {}) }, policy.user_id, deps.env), result => ({ status: result.status === 'failed' || result.contentError ? 'failed' : result.status === 'running' ? 'partial' : result.result?.updates.length ? 'succeeded' : 'empty', result_count: result.result?.updates.length ?? null, provider_run_id: job.provider_run_id, error_code: result.contentError || null }));
     const terminal = ['completed','failed'].includes(result.status), reported = result.telemetry?.cost ?? null;
     const observed = [reported, await deps.store.jobCost(job.job_id, policy.user_id), job.observed_cost_usd, job.actual_cost_usd, ref.observedCostUsd].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
     const highWater = observed.length ? Math.max(...observed) : null;
     // A terminal missing charge remains unknown; known prior usage is retained
     // as a lower bound, never substituted for the missing final charge.
     // A terminal zero can precede the provider's charge accounting. Keep the
     // hold; age or content completion does not certify a free run. Existing
     // settlements require the separate audited late-fee receipt path.
     const cost = job.actual_cost_usd !== null ? Number(job.actual_cost_usd) : terminal && (reported === null || reported === 0) ? null : highWater;
     if (job.actual_cost_usd !== null && highWater !== null && highWater > Number(job.actual_cost_usd)) throw new CollectionError(409, 'provider_final_fee_changed', 'The final provider fee changed and needs review.');
     if (highWater !== null) {
      await deps.store.providerPatch(job.id, { observed_cost_usd: highWater });
      job.observed_cost_usd = highWater; ref.observedCostUsd = highWater; ref.costStatus = 'provider_reported';
     }
     await deps.finishJob(job.job_id, policy.user_id, { status: result.status === 'completed' ? 'succeeded' : result.status === 'failed' ? 'failed' : 'running', providerRunId: job.provider_run_id,
      ...(terminal && !feeOnly && !result.contentError ? { resultCount: result.result?.updates.length || 0 } : {}), ...(terminal && !feeOnly ? { errorCode: result.contentError || null } : {}), ...(cost !== null ? { observedCostUsd: cost, costStatus: 'provider_reported' } : {}) }, deps.env);
     // Nonterminal usage is a fee observation, never a final budget settlement.
     await deps.settleBudget(job.reservation_id, { providerRunId: job.provider_run_id, terminal, actualUsd: terminal ? cost : null }, deps.env);
     if (terminal && result.contentError) {
      // Financial evidence is independent of content import. Preserve the
      // original unread dataset and GET-only eligibility after settling a
      // validated terminal fee. An unknown final fee retains its hold.
      await deps.store.providerPatch(job.id, { state: 'completed', actual_cost_usd: cost, content_pending: true });
      ref.observedCostUsd = cost; ref.costStatus = cost === null ? 'unknown' : 'provider_reported';
      partial = true; details.captionStatus = result.contentError;
      const queued = captionQueue.get(targetKey);
      if (queued) { queued.status = 'blocked'; queued.reason = result.contentError; }
      return true;
     }
     if (terminal) {
      const queued = captionQueue.get(targetKey);
      if (queued) { queued.status = 'retry'; queued.reason = result.status === 'failed' ? 'provider_failed' : metadataMatch ? 'video_format_unconfirmed' : 'provider_returned_no_captions'; partial = true; details.captionStatus = queued.reason; }
      completedJobs.push({ id: job.id, patch: { state: result.status === 'completed' ? 'completed' : 'failed', actual_cost_usd: cost, content_pending: false, ...(!job.finished_at ? { finished_at: new Date(deps.now()).toISOString() } : {}) } });
      ref.observedCostUsd = cost; ref.costStatus = cost === null ? 'unknown' : 'provider_reported';
      if (!job.discard_result && job.source_fingerprint === claim.state.fingerprint && metadataSourceMatches) for (const update of result.result?.updates || []) {
       if (discoveryChannelId && goodUpdate(update, source) && youtubeVideoId(update.url)) {
        const key = hourlyItemKey(update.url); stageUpdate(key, archiveIdentity(update));
        if (!captionQueue.has(key)) captionQueue.set(key, { record: update, attempts: 0, nextAttemptAt: new Date(0).toISOString() });
        partial = true; details.gapPossible = true;
       } else if (!discoveryChannelId && goodUpdate(update, source) && hourlyItemKey(update.url) === targetKey) {
        const base = updates.get(targetKey) || captionQueue.get(targetKey)?.record || update;
        const merged = { ...base, ...mergeVideoFormatFields(base, update), ...(!metadataMatch && update.contentKind === 'transcript' && update.content ? { content: update.content, contentKind: 'transcript' as const, transcriptSegments: update.transcriptSegments, coverage: update.coverage } : {}) };
        stageUpdate(targetKey, metadataMatch ? merged : archiveIdentity(merged), metadataMatch?.[2]);
        const task = captionQueue.get(targetKey);
        if (task) { task.record = merged; task.status = metadataMatch ? 'retry' : update.contentKind === 'transcript' && update.content ? 'pending' : 'unavailable'; task.reason = metadataMatch ? 'video_format_unconfirmed' : update.contentKind === 'transcript' && update.content ? undefined : 'provider_returned_no_captions'; }
       }
      }
      else { partial = true; details.captionStatus = 'workspace_changed_before_provider_result'; }
     } else { partial = true; const task = captionQueue.get(targetKey); if (task) { task.status = 'provider_pending'; task.reason = 'provider_pending'; } }
     return terminal;
    } catch (error) { partial = true; const reason = error instanceof CollectionError ? error.code : 'provider_poll_failed'; details.captionStatus = reason; const queued = captionQueue.get(targetKey); if (queued) { queued.status = 'blocked'; queued.reason = reason; } return false; }
  }
  async function launchProviderDiscovery(channelId: string): Promise<void> {
     const config = apifyConfig(deps.env), itemKey = 'youtube-discovery:' + channelId + ':' + new Date(deps.now()).toISOString().slice(0, 10);
     if (policy.provider_enabled && config && deps.env('HOURLY_COLLECTION_PROVIDER_VERIFIED') === 'true' && config.allowedUsers.includes(policy.user_id) && !await deps.store.providerClaimed(claim, itemKey)) {
      await deps.preflight(policy.user_id, deps.env);
      const jobId = await deps.startJob({ ...source, provider: 'apify', actorId: YOUTUBE_ACTOR_ID }, policy.user_id, deps.env);
      const reservation = await deps.store.reserve(claim, itemKey, jobId, DISCOVERY_MAX_USD).catch(async reserveError => { await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: reserveError instanceof CollectionError ? reserveError.code : 'provider_reservation_failed' }, deps.env); throw reserveError; });
      if (reservation.claimed && reservation.reservationId) {
       const ref: ProviderReference = { jobId, providerRunId: null, actorId: YOUTUBE_ACTOR_ID, itemKey, reservedUsd: DISCOVERY_MAX_USD, observedCostUsd: null, costStatus: 'unknown' }; references.push(ref);
       try {
        const started = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey }, 'youtube_apify_discovery_launch', 'apify', 'discovery', async () => { const started = await deps.startDiscovery(source, channelId, policy.user_id, deps.env); await deps.store.providerPatch(reservation.id, { state: 'running', provider_run_id: started.providerRunId }); return started; }, result => ({ status: 'partial', provider_run_id: result.providerRunId }));
        ref.providerRunId = started.providerRunId;
        await deps.settleBudget(reservation.reservationId, { providerRunId: started.providerRunId, terminal: false, actualUsd: null }, deps.env);
        await deps.finishJob(jobId, policy.user_id, { status: 'running', providerRunId: started.providerRunId }, deps.env);
       } catch (launchError) {
        await deps.store.providerPatch(reservation.id, { state: 'ambiguous' });
        throw launchError;
       }
      } else await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: 'provider_already_claimed' }, deps.env);
     }
  }
  async function processCaptionQueue() {
   const useProviderOnly = providerOnlyCollection(deps.env);
   const candidates = [...captionQueue.values()].filter(task => task.status !== 'provider_pending' && !attemptedIdentities.has(hourlyItemKey(task.record.url)) && Date.parse(task.nextAttemptAt) <= deps.now());
   for (const task of candidates) {
    if (!remainingCaptionAttempts) break;
    let update = updates.get(hourlyItemKey(task.record.url)) || task.record;
    const archived = await deps.store.currentArchive?.(claim, hourlyItemKey(update.url));
    if (archived?.contentKind === 'transcript' && archived.content) { update = archived; task.record = archived; }
    if (deps.now() > sourceDeadline - 30_000) { partial = true; details.captionStatus = 'source_time_limit'; break; }
    const itemKey = hourlyItemKey(update.url), videoId = itemKey.slice(8);
    remainingCaptionAttempts--; attemptedIdentities.add(itemKey);
    const hasTranscript = update.contentKind === 'transcript' && !!update.content;
    const metadataOnly = hasTranscript && deps.env('HOURLY_COLLECTION_METADATA_VERIFIED') === 'true';
    if (hasTranscript && videoFormatKind(update) !== 'unknown') { captionQueue.delete(itemKey); continue; }
    // Back off source-stage retries, retaining the item through RSS 304/hash
    // responses, budget stops and temporary provider/configuration failures.
    task.attempts++; task.checkedAt = new Date(deps.now()).toISOString(); task.status = 'retry'; task.reason = 'captions_not_retrieved'; task.nextAttemptAt = new Date(deps.now() + Math.min(24, 2 ** Math.min(task.attempts - 1, 5)) * 3600_000).toISOString();
    let captions: CaptionResult | null = null;
    try { if (!useProviderOnly && !metadataOnly) captions = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey }, 'youtube_native_captions', 'native', 'content', () => deps.captions(videoId), result => ({ status: result?.content ? 'succeeded' : 'empty', result_count: result?.content ? 1 : 0, error_code: result?.reason || null })); } catch (error) { task.reason = error instanceof CollectionError ? error.code : 'native_caption_failed'; details.captionStatus = task.reason; }
    if (captions?.videoFormat) {
     update = { ...update, ...mergeVideoFormatFields(update, { ...update, isShort: undefined, videoFormat: captions.videoFormat }) };
     task.record = update; stageUpdate(itemKey, update);
    }
    if (hasTranscript && !metadataOnly) {
     // Never buy captions again, or replace saved source text, merely to learn
     // whether an already transcribed original is a Short.
     if (videoFormatKind(update) !== 'unknown') captionQueue.delete(itemKey);
     else { task.status = 'retry'; task.reason = 'video_format_unconfirmed'; partial = true; }
     details.captionStatus = videoFormatKind(update) === 'unknown' ? 'video_format_unconfirmed' : 'video_format_recovered';
     continue;
    }
    if (captions?.captionStatus && captions.captionStatus !== 'retrieved') { task.status = captions.captionStatus; task.reason = captions.reason || 'captions_not_retrieved'; }
    if (captions?.content) {
     stageUpdate(itemKey, { ...update, content: captions.content, contentKind: 'transcript', transcriptSegments: captions.transcriptSegments, summary: captions.content.slice(0, 700), coverage: captions.coverage });
     captionQueue.delete(itemKey); details.captionStatus = 'native_captions_retrieved'; continue;
    }
    partial = true;
    if (task.reason === 'retrieval_log_unavailable') throw new CollectionError(503, task.reason, 'Retrieval could not be recorded.');
    const providerItemKey = metadataOnly ? 'youtube-format:' + videoId + ':' + digest(update.content!) : itemKey;
    const config = apifyConfig(deps.env);
    if (!policy.provider_enabled || deps.env('HOURLY_COLLECTION_PROVIDER_VERIFIED') !== 'true' || !config || config.maxItems !== 1 || config.maxCharge > 0.005 || !config.allowedUsers.includes(policy.user_id)) {
     task.status = captions?.captionStatus === 'unavailable' ? 'unavailable' : 'blocked'; task.reason ||= 'native_unavailable_provider_disabled'; details.captionStatus = 'native_unavailable_provider_disabled'; continue;
    }
    if (await deps.store.providerClaimed(claim, providerItemKey)) { task.status = 'blocked'; task.reason = 'provider_already_attempted'; details.captionStatus = task.reason; continue; }
    try {
     if (!verified.has(policy.user_id)) { await deps.preflight(policy.user_id, deps.env); verified.add(policy.user_id); }
    } catch (error) { task.status = 'blocked'; task.reason = error instanceof CollectionError ? error.code : 'provider_preflight_failed'; details.captionStatus = task.reason; continue; }
    let jobId: string | undefined, reservation: { claimed: boolean; id: string; reservationId?: string } | undefined;
    try {
     jobId = await deps.startJob({ ...source, url: update.url, provider: 'apify', actorId: YOUTUBE_ACTOR_ID }, policy.user_id, deps.env);
     reservation = await deps.store.reserve(claim, providerItemKey, jobId, config.maxCharge);
     if (!reservation.claimed || !reservation.reservationId) {
      task.status = 'blocked'; task.reason = 'provider_already_claimed';
      await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: 'provider_already_claimed' }, deps.env); continue;
     }
     const ref: ProviderReference = { jobId, providerRunId: null, actorId: YOUTUBE_ACTOR_ID, itemKey: providerItemKey, reservedUsd: config.maxCharge, observedCostUsd: null, costStatus: 'unknown' };
     references.push(ref);
     const started = await retrievalAttempt(deps.log, { checkId: claim.checkId, itemKey: providerItemKey }, metadataOnly ? 'youtube_apify_metadata_launch' : 'youtube_apify_caption_launch', 'apify', 'content', async () => { const started = await (metadataOnly ? deps.startMetadata : deps.startApify)({ ...source, url: update.url }, policy.user_id, deps.env, undefined, jobId); await deps.store.providerPatch(reservation!.id, { state: 'running', provider_run_id: started.providerRunId, job_token: started.jobToken }); return started; }, result => ({ status: 'partial', provider_run_id: result.providerRunId }));
     ref.providerRunId = started.providerRunId;
     // Persist the actual ID before any further provider request. A failed DB
     // write leaves the launch claimed, so the next hour cannot duplicate it.
     await deps.settleBudget(reservation.reservationId, { providerRunId: started.providerRunId, actualUsd: null, terminal: false }, deps.env);
     await deps.finishJob(jobId, policy.user_id, { status: 'running', providerRunId: started.providerRunId }, deps.env);
     task.status = 'provider_pending'; task.reason = 'provider_pending'; details.captionStatus = 'provider_pending';
     // Try GET-only recovery immediately within this source's bounded slice. A slow run remains durable for a later hour; no new POST.
     const stored: StoredProviderJob = { id: reservation.id, user_id: policy.user_id, source_id: source.id, item_key: providerItemKey, check_id: claim.checkId, job_id: jobId,
      reservation_id: reservation.reservationId, actor_id: YOUTUBE_ACTOR_ID, maximum_usd: config.maxCharge, provider_run_id: started.providerRunId,
      job_token: started.jobToken, state: 'running', actual_cost_usd: null, source_fingerprint: claim.state.fingerprint, discard_result: false };
     for (let attempt = 0; attempt < 22; attempt++) {
      if (await reconcileJob(stored)) break;
      if (deps.now() - sourceStartedAt >= 45_000 || deps.now() > sourceDeadline - 30_000) break;
      await deps.pause(5_000);
     }
    } catch (error) {
     const code = error instanceof CollectionError ? error.code : 'provider_start_ambiguous'; task.status = 'blocked'; task.reason = code; details.captionStatus = code;
     if (reservation?.claimed) {
      try { await deps.store.providerPatch(reservation.id, { state: 'ambiguous' }); } catch { /* Pre-POST claim and global hold remain durable. */ }
     } else if (jobId) {
      try { await deps.finishJob(jobId, policy.user_id, { status: 'blocked', errorCode: code }, deps.env); } catch { /* Never launch after a ledger failure. */ }
     }
    }
   }
  }
  try {
   source = { ...claim.source, ...validateSource(claim.source) };
   if (!['YouTube','Blog','Substack','Podcast'].includes(source.platform)) {
    patch = { status: 'unsupported', error_code: 'freshness_check_unavailable', provider: 'none' };
    details = { mode: 'unsupported', coverage: 'No inexpensive verified freshness adapter is configured for this platform. No supplier job was started; unchanged activity is unknown.' };
    await save(); return patch.status;
   }
   if (source.platform === 'YouTube') {
    const scopes = await deps.store.prepareMetadata?.(claim) || [];
    if (scopes.length) {
     metadataCheck = true;
     await processMetadataScopes(scopes);
     patch.status = 'partial'; await save(); return patch.status;
    }
    const pendingMetadata = await deps.store.pendingMetadata?.(claim) || [];
    if (pendingMetadata.length) metadataCheck = true;
    for (const intent of pendingMetadata) {
     if (deps.now() > sourceDeadline - 30_000) break;
     try { await reconcileMetadata(intent); } catch (error) { partial = true; details.metadataStatus = error instanceof CollectionError ? error.code : 'metadata_recovery_failed'; }
    }
    if (pendingMetadata.length) { patch.status = 'partial'; await save(); return patch.status; }
   }
   // GET-only recovery; an ambiguous launch never becomes a second POST.
   for (const job of await deps.store.pending(claim)) {
    // New candidate rows have an immutable joined contract. Never poll them
    // through the legacy Streamers adapter, even if their side row is absent.
    if (job.item_key.startsWith('youtube-format-v2:')) { partial = true; continue; }
    if (deps.now() >= Math.min(sourceDeadline - 30_000, sourceStartedAt + 45_000)) { partial = true; details.captionStatus = 'recovery_time_limit'; break; }
    await reconcileJob(job);
   }
   if (source.platform === 'YouTube') await processCaptionQueue();
   const seen = await deps.store.seen(claim);
   if (source.platform === 'YouTube' && providerOnlyCollection(deps.env)) {
    // Platform links are opaque vendor targets in this accepted policy. Cached
    // identities may be used, but a missing channel ID never triggers our HTML/RSS.
    const channelId = await resolveHourlyYouTubeChannel(claim.source, claim.state, async () => { throw new CollectionError(503, 'provider_channel_identity_required', 'The provider route needs a checked channel identity.'); });
    patch.channel_id = channelId; details.mode = 'youtube_provider_only'; details.gapPossible = true;
    await launchProviderDiscovery(channelId);
    patch.new_count = [...updates].filter(([key]) => !seen.has(key)).length;
    patch.status = 'partial'; partial = true; await save(); return patch.status;
   }
   let feedUrl: string, channelId: string | undefined;
   if (source.platform === 'YouTube') {
    channelId = await retrievalAttempt(deps.log, { checkId: claim.checkId }, 'youtube_channel_identity', 'native', 'discovery', () => resolveHourlyYouTubeChannel(claim.source, claim.state, deps.download), () => ({ status: 'succeeded' }));
    feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
    details.mode = 'youtube_rss'; patch.channel_id = channelId;
   } else { feedUrl = claim.state.feed_url || source.feedUrl || source.url; details.mode = 'native_feed'; }
   if (source.platform !== 'YouTube') await processOriginals(feedUrl);
   const validators = claim.state.feed_url === feedUrl ? { etag: claim.state.etag || undefined, lastModified: claim.state.last_modified || undefined } : {};
   let response: ConditionalDownload;
   try {
    response = await retrievalAttempt(deps.log, { checkId: claim.checkId }, channelId ? 'youtube_rss' : 'native_feed', 'native', 'discovery', async () => { const result = await deps.download(feedUrl, 0, validators); patch.http_status = result.status || 200; if (channelId && result.status !== 304) { try { parseHourlyYouTubeFeed(result.text, source, channelId); } catch (parseError) { if (parseError instanceof CollectionError) throw new CollectionError(parseError.status, parseError.code, parseError.message, result.status || 200); throw parseError; } } return result; }, result => ({ status: 'succeeded', http_status: result.status || 200 }));
   } catch (error) {
    if (!channelId || error instanceof CollectionError && error.code === 'retrieval_log_unavailable') throw error;
    partial = true;
    let discovered: SourceUpdate[] | undefined;
    try {
     const result = await retrievalAttempt(deps.log, { checkId: claim.checkId }, 'youtube_public_uploads', 'native', 'discovery', () => deps.discover(source, channelId!, seen), result => ({ status: 'partial', result_count: result.updates.length }));
     discovered = result.updates;
    } catch (nativeError) {
     if (nativeError instanceof CollectionError && nativeError.code === 'retrieval_log_unavailable') throw nativeError;
     await launchProviderDiscovery(channelId!);
    }
    if (discovered) {
     for (const record of discovered) if (!seen.has(hourlyItemKey(record.url))) { const key = hourlyItemKey(record.url); stageUpdate(key, archiveIdentity(record)); captionQueue.set(key, { record, attempts: 0, nextAttemptAt: new Date(0).toISOString() }); }
     patch.new_count = discovered.filter(record => !seen.has(hourlyItemKey(record.url))).length;
     details.mode = 'youtube_public_uploads'; details.gapPossible = true;
     await processCaptionQueue(); patch.status = 'partial'; await save(); return patch.status;
    }
    // Preserve the original RSS failure and pending paid reference. A provider
    // launch is not successful discovery and never advances the RSS cursor.
    throw error;
   }
   patch.http_status = response.status || 200;
   if (response.status === 304) {
    details.httpNotModified = true; patch.status = partial ? 'partial' : updates.size ? 'collected' : 'unchanged';
    await save(); return patch.status;
   }
   if (source.platform !== 'YouTube' && !/<(?:rss\b|feed\b|rdf:RDF\b)/i.test(response.text)) response = await deps.download(discoverFeed(response));
   const hash = digest(response.text);
   patch = { ...patch, feed_url: response.url, etag: response.etag || null, last_modified: response.lastModified || null, http_status: response.status || 200 };
   if (hash === claim.state.content_hash) {
    details.httpNotModified = false; patch.status = partial ? 'partial' : updates.size ? 'collected' : 'unchanged';
    await save(); return patch.status;
   }
   const parsed = channelId ? parseHourlyYouTubeFeed(response.text, source, channelId) : parseHourlyFeed(response.text, source, response.url);
   details = { ...details, invalidCount: parsed.invalidCount, gapPossible: parsed.gapPossible };
   if (parsed.invalidCount || parsed.gapPossible) partial = true;
   const unseen = parsed.updates.filter(update => !seen.has(hourlyItemKey(update.url)));
   patch.new_count = unseen.length;
   for (const update of unseen) if (!updates.has(hourlyItemKey(update.url))) stageUpdate(hourlyItemKey(update.url), update);
   for (const update of channelId ? unseen : []) { const key = hourlyItemKey(update.url); if (!captionQueue.has(key)) captionQueue.set(key, { record: update, attempts: 0, nextAttemptAt: new Date(0).toISOString() }); }
   if (channelId) await processCaptionQueue();
   else {
    for (const update of unseen) if (needsPublicOriginal(update)) {
     if (originalQueue.size < 100) originalQueue.set(hourlyItemKey(update.url), update);
     else { partial = true; details.originalQueueLimit = true; }
    }
    await processOriginals(response.url);
   }
   patch.content_hash = hash;
   const latestPublishedAt = parsed.updates.map(update => update.publishedAt).sort().at(-1);
   patch.cursor = { ...(latestPublishedAt ? { latestPublishedAt } : {}), checkedAt: new Date(deps.now()).toISOString() };
   patch.status = partial ? 'partial' : updates.size ? 'collected' : 'unchanged';
   await save(); return patch.status;
  } catch (error) {
   const code = error instanceof CollectionError ? error.code : 'hourly_check_failed';
   const httpStatus = error instanceof CollectionError ? error.upstreamStatus ?? patch.http_status : patch.http_status;
   // Do not advance validators/cursors on a failed import. A retry must see the
   // same representation again rather than permanently skipping it via 304.
   patch = { status: 'failed', error_code: code, new_count: Number(patch.new_count || 0), ...(httpStatus !== undefined ? { http_status: httpStatus } : {}) };
   await save(); return 'failed';
  }
 }
 return async function collectHourly(): Promise<{ enabled: boolean; checked: number; failed: number; skipped: number; statuses: Record<string, number> }> {
  if (deps.env('HOURLY_COLLECTION_ENABLED') !== 'true') return { enabled: false, checked: 0, failed: 0, skipped: 0, statuses: {} };
  extractOriginal = createPublicOriginalExtractor(deps.download);
  const started = deps.now(), statuses: Record<string, number> = {};
  let checked = 0, failed = 0, skipped = 0;
  // A background run is bounded below Netlify's 15-minute maximum. Unprocessed
  // sources are not leased or marked checked; next run reads them afresh.
  const policies = new Map((await deps.store.policies()).filter(p => p.enabled).map(p => [p.user_id, p]));
  // Global durable order spans owners. Reading the schedule changes no service
  // timestamp; only a successful database lease claim advances that source.
  const scheduled = await deps.store.schedule();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, scheduled.length) }, async () => {
   while (next < scheduled.length && deps.now() - started < 12 * 60_000 - 120_000) {
    const entry = scheduled[next++], policy = policies.get(entry.user_id);
    if (!policy) continue;
    try {
     const status = await processSource(policy, entry.source_id, started + 12 * 60_000);
     statuses[status] = (statuses[status] || 0) + 1;
     if (status === 'skipped') skipped++; else { checked++; if (status === 'failed') failed++; }
    } catch { failed++; /* Existing running check survives and expires honestly. */ }
   }
  }));
  return { enabled: true, checked, failed, skipped, statuses };
 };
}

/** The browser cannot choose readers, sources, caps, or trigger paid work. */
export function hourlyWorkerAuthorized(request: Request, env: Env = runtimeEnv): boolean {
 const secret = env('HOURLY_COLLECTION_WORKER_SECRET') || '', provided = request.headers.get('x-hourly-collection-secret') || '';
 if (secret.length < 32 || secret.length > 256 || Buffer.byteLength(provided) !== Buffer.byteLength(secret) || request.method !== 'POST') return false;
 return timingSafeEqual(Buffer.from(secret), Buffer.from(provided));
}
export async function dispatchHourly(env: Env = runtimeEnv, fetcher: typeof fetch = fetch): Promise<{ dispatched: boolean }> {
 if (env('HOURLY_COLLECTION_ENABLED') !== 'true') return { dispatched: false };
 const secret = env('HOURLY_COLLECTION_WORKER_SECRET') || '', app = publicHttpsUrl(env('APP_URL'));
 if (secret.length < 32 || secret.length > 256) throw new CollectionError(503, 'hourly_worker_not_configured', 'Hourly background dispatch is not configured.');
 const response = await fetchNoRedirect(new URL('/.netlify/functions/hourly-collection-worker', app).href, {
  method: 'POST', headers: { 'x-hourly-collection-secret': secret, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000),
 }, fetcher);
 await response.body?.cancel();
 if (response.status !== 202) throw new CollectionError(503, 'hourly_dispatch_failed', 'Hourly background work was not accepted.');
 return { dispatched: true };
}
