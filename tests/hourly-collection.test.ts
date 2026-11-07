import { testRetrievalLog } from './helpers/retrieval-log';
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createHourlyCollector, dispatchHourly, followedHourlySources, hourlyItemKey, hourlyWorkerAuthorized, nativeHourlyCaptions, parseHourlyYouTubeFeed, resolveHourlyYouTubeChannel, type HourlyClaim, type HourlyPolicy, type HourlyStore, type StoredProviderJob } from '../netlify/functions/_shared/hourly-collection';
import { CollectionError } from '../netlify/functions/_shared/security';
import type { Source, SourceUpdate, WorkspaceState } from '../src/lib/types';

const channelId = 'UCabcdefghijklmnopqrstuv';
const videoId = 'abcdefghijk';
const source: Source = { id: 'hourly-test-source', name: 'Public channel', platform: 'YouTube', url: 'https://www.youtube.com/channel/' + channelId, creatorIds: [], status: 'ready' };
const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
const update: SourceUpdate = { id: 'old-tech-id', sourceId: source.id, title: 'Real title', summary: 'Description', url: 'https://www.youtube.com/watch?v=' + videoId, publishedAt: '2026-10-22T12:00:00.000Z', contributorIds: [], topics: [], brands: [], sponsors: [], references: [], insights: [], format: 'video', isSample: false, contentKind: 'metadata_only' };
const policy: HourlyPolicy = { user_id: 'hourly-test-reader', enabled: true, provider_enabled: false, daily_limit_usd: 0.1, lifetime_limit_usd: 1 };
const claim: HourlyClaim = { source, checkId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', state: { user_id: policy.user_id, source_id: source.id, fingerprint: 'source-fingerprint', collection_id: 'tech', channel_id: channelId, feed_url: feedUrl, etag: '"old"', last_modified: 'Thu, 22 Oct 2026 12:00:00 GMT', content_hash: null, initialized_at: '2026-10-22T12:00:00Z', workspace_revision: '2026-10-22T13:00:00Z', cursor: {} } };
const xml = (ids = [videoId]) => `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${channelId}</yt:channelId>${ids.map(id => `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>Real &amp; useful</title><published>2026-10-22T12:00:00Z</published><media:group xmlns:media="http://search.yahoo.com/mrss/"><media:description>Publisher description</media:description></media:group></entry>`).join('')}</feed>`;
const realSchemaChannelId = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const youtubeAtom = (headerChannelId = realSchemaChannelId.slice(2), entryChannelId = realSchemaChannelId) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
 <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=${realSchemaChannelId}"/>
 <id>yt:channel:${realSchemaChannelId.slice(2)}</id><yt:channelId>${headerChannelId}</yt:channelId>
 <title>Public channel</title><link rel="alternate" href="https://www.youtube.com/channel/${realSchemaChannelId}"/>
 <author><name>Public channel</name><uri>https://www.youtube.com/channel/${realSchemaChannelId}</uri></author>
 <published>2010-01-01T00:00:00+00:00</published>
 <entry><id>yt:video:${videoId}</id><yt:videoId>${videoId}</yt:videoId><yt:channelId>${entryChannelId}</yt:channelId>
  <title>Real &amp; useful</title><link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
  <author><name>Public channel</name><uri>https://www.youtube.com/channel/${realSchemaChannelId}</uri></author>
  <published>2026-10-22T12:00:00+00:00</published><updated>2026-10-22T13:00:00+00:00</updated>
  <media:group><media:title>Real &amp; useful</media:title><media:content url="https://www.youtube.com/v/${videoId}" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" width="480" height="360"/><media:description>Publisher description</media:description>
  </media:group>
 </entry>
</feed>`;
const workspace = (sources: Source[] = [source]): WorkspaceState => ({ version: 1, followedSourceIds: sources.map(s => s.id), customSources: sources, savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: { interests: [], interfaceLanguage: 'en', recapLanguage: 'en', timezone: 'UTC', deliveryTime: '09:00', emailReminder: false } });
const envValues: Record<string, string> = { HOURLY_COLLECTION_ENABLED: 'true', APIFY_RUNTIME_ENABLED: 'true', HOURLY_COLLECTION_PROVIDER_VERIFIED: 'true', APIFY_API_TOKEN: 'synthetic-private-token', COLLECTION_JOB_SECRET: 'synthetic-secret-of-more-than-32-characters', APIFY_YOUTUBE_BUILD: '0.0.319', APIFY_MAX_ITEMS: '1', APIFY_MAX_TOTAL_CHARGE_USD: '0.005', COLLECTION_ALLOWED_USER_IDS: policy.user_id };
function setup(options: { policy?: HourlyPolicy; source?: Source; seen?: string[]; pending?: StoredProviderJob[]; body?: string; status?: number; state?: Partial<HourlyClaim['state']> } = {}) {
 const savedSource = options.source || source;
 const currentClaim = { ...claim, source: savedSource, state: { ...claim.state, ...options.state } };
 const store: HourlyStore = { schedule: vi.fn(async () => [{ user_id: policy.user_id, source_id: savedSource.id }]), serviced: vi.fn(async () => {}), policies: vi.fn(async () => [options.policy || policy]), workspace: vi.fn(async () => workspace([savedSource])), claim: vi.fn(async () => currentClaim), seen: vi.fn(async () => new Set(options.seen || [])), pending: vi.fn(async () => options.pending || []), finish: vi.fn(async () => ({ retrievedCount: 1, importAccepted: true })), reserve: vi.fn(async () => ({ claimed: true, id: 'private-job-id', reservationId: '33333333-3333-4333-8333-333333333333' })), providerClaimed: vi.fn(async () => false), jobCost: vi.fn(async () => null), providerPatch: vi.fn(async () => {}) };
 const deps = { log: testRetrievalLog(), discover: vi.fn(async (): Promise<{updates:SourceUpdate[];gapPossible:boolean}> => { throw new CollectionError(422, 'youtube_discovery_unavailable', 'Fixture discovery failure'); }), startDiscovery: vi.fn(async () => ({ providerRunId: 'Discovery12345' })), store, env: (key: string) => envValues[key], download: vi.fn(async () => ({ text: options.body ?? xml(), url: feedUrl, status: options.status ?? 200, contentType: 'application/atom+xml', etag: '"new"' })), captions: vi.fn(async () => null as Awaited<ReturnType<typeof nativeHourlyCaptions>>), preflight: vi.fn(async () => {}), startApify: vi.fn(async () => ({ status: 'running' as const, jobToken: 'never-public-token', providerRunId: 'providerRun123', message: 'pending' })), pollApify: vi.fn(async () => ({ status: 'completed', result: { source, updates: [{ ...update, contentKind: 'transcript' as const, content: 'Real source captions', videoFormat: { kind: 'regular' as const, basis: 'provider' as const } } as SourceUpdate], notice: 'Source captions' }, telemetry: { ledgerId: claim.checkId, providerRunId: 'providerRun123', cost: 0.004 } })), startJob: vi.fn(async () => '44444444-4444-4444-8444-444444444444'), finishJob: vi.fn(async () => {}), settleBudget: vi.fn(async () => ({} as never)), pause: vi.fn(async () => {}), now: () => 1000 };
 return { deps, store, run: () => createHourlyCollector(deps)(), patch: () => vi.mocked(store.finish).mock.calls.at(-1)![1], updates: () => vi.mocked(store.finish).mock.calls.at(-1)![2] };
}
const pending = (patch: Partial<StoredProviderJob> = {}): StoredProviderJob => ({ id: 'private-job', user_id: policy.user_id, source_id: source.id, item_key: 'youtube:' + videoId, check_id: claim.checkId, job_id: '44444444-4444-4444-8444-444444444444', reservation_id: '33333333-3333-4333-8333-333333333333', actor_id: 'h7sDV53CddomktSi5', maximum_usd: 0.005, provider_run_id: 'providerRun123', job_token: 'private-only-token', state: 'running', actual_cost_usd: null, source_fingerprint: claim.state.fingerprint, discard_result: false, ...patch });

describe('bounded hourly public originals', () => {
 const publication = { ...source, platform: 'Blog' as const, url: 'https://publication.example/' };
 const feed = 'https://publication.example/feed';
 const prose = 'The publication measured a laboratory instrument for three weeks. Its new configuration lowered background noise while preserving the signal. The observed result applies to this specific test and should not be generalized to every configuration. ';
 const articles = (date = 'Sat, 07 Nov 2026 12:00:00 GMT') => `<rss><channel>${Array.from({ length: 5 }, (_, index) => `<item><title>Fixture ${index}</title><link>https://publication.example/article/${index}</link><pubDate>${date}</pubDate><description>Excerpt only</description></item>`).join('')}</channel></rss>`;
 it('caps downloads at three per source, resumes deferred items on 304, then never refetches seen originals', async () => {
  const first = setup({ source: publication, state: { feed_url: feed } });
  const download = vi.fn(async (url: string) => ({ text: url === feed ? articles() : `<article><p>${prose}</p></article>`, url, status: 200, contentType: url === feed ? 'application/rss+xml' : 'text/html' }));
  await createHourlyCollector({ ...first.deps, download })();
  expect(download).toHaveBeenCalledTimes(4); expect(first.updates()).toHaveLength(5);
  expect(first.updates().filter(record => record.originalContent?.status === 'usable')).toHaveLength(3);
  const cursor = first.patch().cursor as Record<string, unknown>;
  expect(cursor.pendingOriginals).toHaveLength(2);
  expect(JSON.stringify(cursor)).not.toContain(prose.trim());
  const seen = first.updates().map(record => hourlyItemKey(record.url));
  const second = setup({ source: publication, seen, state: { feed_url: feed, cursor } });
  download.mockClear(); download.mockImplementation(async url => ({ text: url === feed ? '' : `<article><p>${prose}</p></article>`, url, status: url === feed ? 304 : 200, contentType: url === feed ? 'application/rss+xml' : 'text/html' }));
  await createHourlyCollector({ ...second.deps, download })();
  expect(download).toHaveBeenCalledTimes(3); expect(second.updates()).toHaveLength(2); expect(second.updates().every(record => record.originalContent?.status === 'usable')).toBe(true);
  expect(second.patch().cursor).toMatchObject({ pendingOriginals: [] });
  const third = setup({ source: publication, seen, state: { feed_url: feed, cursor: second.patch().cursor as Record<string, unknown> } });
  download.mockClear(); await createHourlyCollector({ ...third.deps, download })(); expect(download).toHaveBeenCalledTimes(1); expect(third.updates()).toHaveLength(0);
  expect(first.deps.startApify).not.toHaveBeenCalled(); expect(first.deps.startJob).not.toHaveBeenCalled();
 });
 it('rejects unknown, local and invalid calendar dates before any linked-body request', async () => {
  for (const date of ['', '2026-11-07', '2026-02-30T12:00:00Z']) {
   const t = setup({ source: publication, state: { feed_url: feed } });
   const download = vi.fn(async (url: string) => ({ text: articles(date), url, contentType: 'application/rss+xml', status: 200 }));
   await createHourlyCollector({ ...t.deps, download })(); expect(download).toHaveBeenCalledTimes(1); expect(t.updates()).toHaveLength(0); expect(t.patch().status).toBe('partial');
  }
 });
 it('does not repeat an uncertain durable attempt or invent usable content after parent import rejection', async () => {
  const t = setup({ source: publication, state: { feed_url: feed } });
  vi.mocked(t.deps.log.start).mockImplementation(async (_parent, method) => { if (method === 'public_article') throw new CollectionError(409, 'original_already_attempted', 'Retained attempt'); return 'fixture'; });
  vi.mocked(t.store.finish).mockResolvedValue({ retrievedCount: 0, importAccepted: false });
  const download = vi.fn(async (url: string) => ({ text: articles(), url, contentType: 'application/rss+xml', status: 200 }));
  expect(await createHourlyCollector({ ...t.deps, download })()).toMatchObject({ statuses: { blocked: 1 } });
  expect(download).toHaveBeenCalledTimes(1); expect(t.updates().every(record => record.contentKind === 'metadata_only')).toBe(true);
 });
});

describe('hourly native freshness and exact original identity', () => {
 it.each(['https://youtu.be/abcdefghijk?t=3','https://www.youtube.com/watch?x=1&v=abcdefghijk&feature=share','https://youtube.com/shorts/abcdefghijk','https://m.youtube.com/live/abcdefghijk'])('matches YouTube alias %s', url => expect(hourlyItemKey(url)).toBe('youtube:' + videoId));
 it('loads only currently followed real custom sources, never a catalogue or sample', () => {
  const w = workspace([source, { ...source, id: 'sample', status: 'sample' }, { ...source, id: 'unfollowed' }]); w.followedSourceIds = [source.id, 'sample', 'catalogue-only'];
  expect(followedHourlySources(w).map(s => s.id)).toEqual([source.id]);
 });
 it('disabled work requires no database configuration or provider request', async () => expect(await createHourlyCollector({ log: testRetrievalLog(), env: () => undefined })()).toMatchObject({ enabled: false, checked: 0 }));
 it('a leased/due source is skipped before any network call', async () => { const t = setup(); vi.mocked(t.store.claim).mockResolvedValue(null); expect(await t.run()).toMatchObject({ skipped: 1 }); expect(t.deps.download).not.toHaveBeenCalled(); });
 it('sends persisted exact feed validators and skips all caption/provider requests on 304', async () => { const t = setup({ status: 304 }); await t.run(); expect(t.deps.download).toHaveBeenCalledWith(feedUrl, 0, { etag: '"old"', lastModified: claim.state.last_modified }); expect(t.patch()).toMatchObject({ status: 'unchanged', http_status: 304 }); expect(t.deps.captions).not.toHaveBeenCalled(); expect(t.deps.startApify).not.toHaveBeenCalled(); });
 it('skips all downstream requests for an unchanged response body hash', async () => { const t = setup({ state: { content_hash: createHash('sha256').update(xml()).digest('hex') } }); await t.run(); expect(t.patch().status).toBe('unchanged'); expect(t.deps.captions).not.toHaveBeenCalled(); });
 it('deduplicates prior tech archive aliases before attempting captions', async () => { const t = setup({ seen: ['youtube:' + videoId] }); await t.run(); expect(t.updates()).toHaveLength(0); expect(t.deps.captions).not.toHaveBeenCalled(); expect(t.patch().new_count).toBe(0); });
 it('retrieves native captions only for unseen video IDs and never starts paid fallback after success', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); t.deps.captions.mockResolvedValue({ content: 'Actual captions', coverage: 'Existing captions' }); await t.run(); expect(t.deps.captions).toHaveBeenCalledWith(videoId); expect(t.updates()[0]).toMatchObject({ content: 'Actual captions', summary: 'Actual captions', contentKind: 'transcript', isSample: false, insights: [] }); expect(t.deps.startApify).not.toHaveBeenCalled(); });
 it('persists honest metadata when native captions are missing and provider is off', async () => { const t = setup(); await t.run(); expect(t.updates()[0]).toMatchObject({ contentKind: 'metadata_only', summary: 'Publisher description' }); expect(t.patch()).toMatchObject({ status: 'partial', details: { captionStatus: 'native_unavailable_provider_disabled' } }); expect(t.deps.startJob).not.toHaveBeenCalled(); });
 it.each(['X','Instagram','LinkedIn'] as const)('logs unsupported %s without contacting the platform or provider', async platform => { const t = setup({ source: { ...source, platform, url: platform === 'X' ? 'https://x.com/publictest' : platform === 'Instagram' ? 'https://instagram.com/publictest' : 'https://linkedin.com/in/publictest' } }); await t.run(); expect(t.patch()).toMatchObject({ status: 'unsupported', error_code: 'freshness_check_unavailable', provider: 'none' }); expect(t.deps.download).not.toHaveBeenCalled(); expect(t.deps.startApify).not.toHaveBeenCalled(); });
 it('rejects feed channel mismatches rather than collecting another creator', () => expect(() => parseHourlyYouTubeFeed(xml().replaceAll(channelId, 'UCxxxxxxxxxxxxxxxxxxxxxx'), source, channelId)).toThrow('different channel'));
 it.each([realSchemaChannelId, realSchemaChannelId.slice(2)])('accepts the real YouTube Atom header form %s with an exact full entry channel ID', headerChannelId => {
  const result = parseHourlyYouTubeFeed(youtubeAtom(headerChannelId), source, realSchemaChannelId);
  expect(result).toMatchObject({ invalidCount: 0, gapPossible: false });
  expect(result.updates).toHaveLength(1);
  expect(result.updates[0]).toMatchObject({ sourceId: source.id, url: update.url, title: 'Real & useful', summary: 'Publisher description', publishedAt: update.publishedAt, contentKind: 'metadata_only', isSample: false });
 });
 it.each(['UCxxxxxxxxxxxxxxxxxxxxxx', 'xxxxxxxxxxxxxxxxxxxxxx', 'UC' + realSchemaChannelId, ''])('rejects a wrong or missing real-schema header %s even when the entry matches', headerChannelId => {
  expect(() => parseHourlyYouTubeFeed(youtubeAtom(headerChannelId), source, realSchemaChannelId)).toThrow('different channel');
 });
 it.each(['UCxxxxxxxxxxxxxxxxxxxxxx', realSchemaChannelId.slice(2)])('excludes a real-schema entry without the exact full channel ID: %s', entryChannelId => {
  const result = parseHourlyYouTubeFeed(youtubeAtom(undefined, entryChannelId), source, realSchemaChannelId);
  expect(result).toEqual({ updates: [], invalidCount: 1, gapPossible: false });
 });
 it('leaves missing publication dates unknown and excludes them from the dated archive', () => { const result = parseHourlyYouTubeFeed(xml().replace('2026-10-22T12:00:00Z', 'not-a-date'), source, channelId); expect(result.updates).toHaveLength(0); expect(result.invalidCount).toBe(1); });
 it('resolves a saved channel ID without downloading a public channel page', async () => { const download = vi.fn(); expect(await resolveHourlyYouTubeChannel(source, claim.state, download)).toBe(channelId); expect(download).not.toHaveBeenCalled(); });
 it('does not infer the owner channel from generic recommended-video channelIds', async () => { const download = vi.fn(async () => ({ text: `{"channelId":"${channelId}"}`, url: 'https://youtube.com/@test', contentType: 'text/html' })); await expect(resolveHourlyYouTubeChannel({ ...source, url: 'https://youtube.com/@test' }, { ...claim.state, channel_id: null }, download)).rejects.toMatchObject({ code: 'youtube_channel_unresolved' }); });
 it('does not advance validators after a parse failure and preserves the successful HTTP response status', async () => { const t = setup({ body: 'not XML' }); await t.run(); expect(t.patch()).toMatchObject({ status: 'failed', error_code: 'invalid_feed', http_status: 200 }); expect(t.patch()).not.toHaveProperty('etag'); expect(t.patch()).not.toHaveProperty('content_hash'); });
 it('preserves an upstream HTTP 503 on a failed download', async () => {
  const t = setup();
  t.deps.download.mockRejectedValue(new CollectionError(422, 'source_unavailable', 'Unavailable', 503));
  await t.run();
  expect(t.patch()).toMatchObject({ status: 'failed', error_code: 'source_unavailable', http_status: 503 });
  expect(t.patch()).not.toHaveProperty('etag');
  expect(t.patch()).not.toHaveProperty('content_hash');
  expect(t.deps.captions).not.toHaveBeenCalled();
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('omits HTTP status when a download fails without receiving an upstream response', async () => {
  const t = setup();
  t.deps.download.mockRejectedValue(new CollectionError(504, 'source_timeout', 'Timed out'));
  await t.run();
  expect(t.patch()).toMatchObject({ status: 'failed', error_code: 'source_timeout' });
  expect(t.patch()).not.toHaveProperty('http_status');
 });
 it('collects more than five native feed items without inventing a summary', async () => { const body = `<rss><channel><title>Feed</title>${Array.from({ length: 9 }, (_, i) => `<item><title>Entry ${i}</title><link>https://publisher.org/${i}</link><pubDate>Thu, 22 Oct 2026 12:00:00 GMT</pubDate><description>Publisher excerpt</description></item>`).join('')}</channel></rss>`; const t = setup({ source: { ...source, platform: 'Blog', url: 'https://publisher.org/feed' }, body }); await t.run(); expect(t.updates()).toHaveLength(9); expect(t.updates().every(u => u.contentKind === 'metadata_only' && u.insights.length === 0)).toBe(true); });
});

describe('hourly provider authorization, ambiguity and recovery', () => {
 it('rejects forged X context attached to a recovered YouTube record before storage', async () => {
  const t = setup({ pending: [pending()], status: 304 });
  const result = await t.deps.pollApify();
  Object.assign(result.result.updates[0], { postContext: { reply: { status: 'available', postId: '123', url: 'https://evil.test/parent', text: 'Wrong original' } } });
  t.deps.pollApify.mockResolvedValue(result);
  await t.run();
  expect(t.updates()).toHaveLength(0);
 });
 it('reserves durable global/user budget before the exact single-video paid POST', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); await t.run(); expect(t.deps.preflight.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(t.store.reserve).mock.invocationCallOrder[0]); expect(vi.mocked(t.store.reserve).mock.invocationCallOrder[0]).toBeLessThan(t.deps.startApify.mock.invocationCallOrder[0]); expect(t.deps.startApify).toHaveBeenCalledWith(expect.objectContaining({ url: update.url }), policy.user_id, expect.any(Function), undefined, expect.any(String)); expect(t.deps.pollApify).toHaveBeenCalled(); expect(t.updates()[0].content).toBe('Real source captions'); expect(JSON.stringify(t.patch())).not.toContain('never-public-token'); });
 it('changed provider preflight starts no job and makes no reservation', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); t.deps.preflight.mockRejectedValue(new CollectionError(503, 'provider_review_changed', 'private detail')); await t.run(); expect(t.deps.startJob).not.toHaveBeenCalled(); expect(t.store.reserve).not.toHaveBeenCalled(); expect(t.patch()).toMatchObject({ details: { captionStatus: 'provider_review_changed' } }); });
 it('daily/global cap failure prevents paid POST while still archiving real RSS metadata', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); vi.mocked(t.store.reserve).mockRejectedValue(new CollectionError(402, 'collection_budget_exhausted', 'budget')); await t.run(); expect(t.deps.startApify).not.toHaveBeenCalled(); expect(t.updates()[0].contentKind).toBe('metadata_only'); expect(t.deps.finishJob).toHaveBeenCalledWith(expect.any(String), policy.user_id, { status: 'blocked', errorCode: 'collection_budget_exhausted' }, expect.any(Function)); });
 it('an already-claimed provider item never gets another POST', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); vi.mocked(t.store.reserve).mockResolvedValue({ claimed: false, id: 'old' }); await t.run(); expect(t.deps.startApify).not.toHaveBeenCalled(); });
 it('an ambiguous provider POST retains its hold and is recorded without retry', async () => { const t = setup({ policy: { ...policy, provider_enabled: true } }); t.deps.startApify.mockRejectedValue(new Error('transport private detail')); await t.run(); expect(t.deps.startApify).toHaveBeenCalledTimes(1); expect(t.store.providerPatch).toHaveBeenCalledWith('private-job-id', { state: 'ambiguous' }); expect(t.patch()).toMatchObject({ cost_status: 'unknown', observed_cost_usd: null }); expect(JSON.stringify(t.patch())).not.toContain('transport private detail'); });
 it('a persisted ambiguous launch without a run ID is never reposted even on an unchanged check', async () => { const t = setup({ pending: [pending({ provider_run_id: null, state: 'ambiguous' })], status: 304 }); await t.run(); expect(t.deps.startApify).not.toHaveBeenCalled(); expect(t.deps.pollApify).not.toHaveBeenCalled(); expect(t.patch()).toMatchObject({ status: 'partial', cost_status: 'unknown' }); });
 it('recovers captions by durable actual run identity without an expiring browser token', async () => { const t = setup({ pending: [pending()], status: 304 }); await t.run(); expect(t.deps.pollApify).toHaveBeenCalledWith(expect.objectContaining({ providerRunId: 'providerRun123', actorId: 'h7sDV53CddomktSi5', maxItems: 1, source: expect.objectContaining({ url: update.url }) }), policy.user_id, expect.any(Function)); expect(t.updates()[0].content).toBe('Real source captions'); expect(vi.mocked(t.store.providerPatch).mock.calls.some(([, patch]) => patch.state === 'completed')).toBe(true); });
 it('preserves recovered captions when the same video is still unseen in the current RSS body', async () => { const t = setup({ pending: [pending()], seen: [] }); await t.run(); expect(t.updates()[0]).toMatchObject({ contentKind: 'transcript', content: 'Real source captions' }); expect(t.deps.captions).not.toHaveBeenCalled(); expect(t.deps.startApify).not.toHaveBeenCalled(); });
 it('keeps a terminal provider result recoverable when the archive CAS rejects a concurrent workspace edit', async () => { const t = setup({ pending: [pending()], status: 304 }); vi.mocked(t.store.finish).mockResolvedValue({ retrievedCount: 0, importAccepted: false }); await t.run(); expect(vi.mocked(t.store.providerPatch).mock.calls.every(([, patch]) => patch.state === undefined)).toBe(true); });
 it('does not resurrect reset/deleted history from a late provider result', async () => { const t = setup({ pending: [pending({ discard_result: true })], status: 304 }); await t.run(); expect(t.updates()).toHaveLength(0); expect(t.deps.finishJob).toHaveBeenCalled(); });
 it('does not attribute a changed-source provider result to the new source identity', async () => { const t = setup({ pending: [pending({ source_fingerprint: 'old-source' })], status: 304 }); await t.run(); expect(t.updates()).toHaveLength(0); });
 it('never lowers global or reader settled cost below earlier running usage or the authoritative job ledger', async () => { const t = setup({ pending: [pending({ observed_cost_usd: 0.004 })], status: 304 }); vi.mocked(t.store.jobCost).mockResolvedValue(0.0045); t.deps.pollApify.mockResolvedValue({ status: 'completed', result: { source, updates: [], notice: '' }, telemetry: { ledgerId: claim.checkId, providerRunId: 'providerRun123', cost: 0.002 } }); await t.run(); expect(t.deps.settleBudget).toHaveBeenCalledWith(expect.any(String), { providerRunId: 'providerRun123', terminal: true, actualUsd: 0.0045 }, expect.any(Function)); expect(t.store.providerPatch).toHaveBeenCalledWith('private-job', expect.objectContaining({ actual_cost_usd: 0.0045 })); });
 it('persists unfinished captions after a daily-cap failure and retries natively despite the next RSS 304', async () => { const first = setup({ policy: { ...policy, provider_enabled: true } }); vi.mocked(first.store.reserve).mockRejectedValue(new CollectionError(402, 'collection_budget_exhausted', 'budget')); await first.run(); const queue = first.patch().pending_captions as NonNullable<HourlyClaim['state']['pending_captions']>; expect(queue).toHaveLength(1); const second = setup({ status: 304, seen: ['youtube:' + videoId], state: { pending_captions: queue } }); second.deps.now = () => Date.parse(queue[0].nextAttemptAt) + 3600_000; second.deps.captions.mockResolvedValue({ content: 'Recovered real captions', coverage: 'Existing captions', videoFormat: { kind: 'regular', basis: 'watch_page' } }); await second.run(); expect(second.deps.captions).toHaveBeenCalledWith(videoId); expect(second.updates()[0].content).toBe('Recovered real captions'); expect(second.patch().pending_captions).toEqual([]); expect(second.deps.startApify).not.toHaveBeenCalled(); });
 it('retries an unfinished caption after temporary preflight failure even when RSS hash is unchanged', async () => { const first = setup({ policy: { ...policy, provider_enabled: true } }); first.deps.preflight.mockRejectedValue(new CollectionError(503, 'provider_review_changed', 'review')); await first.run(); const queue = first.patch().pending_captions as NonNullable<HourlyClaim['state']['pending_captions']>; const second = setup({ seen: ['youtube:' + videoId], state: { pending_captions: queue, content_hash: createHash('sha256').update(xml()).digest('hex') } }); second.deps.now = () => Date.parse(queue[0].nextAttemptAt) + 1; second.deps.captions.mockResolvedValue({ content: 'Native retry captions', coverage: 'Existing captions', videoFormat: { kind: 'regular', basis: 'watch_page' } }); await second.run(); expect(second.updates()[0].content).toBe('Native retry captions'); expect(second.patch().pending_captions).toEqual([]); });
 it('retains a queued item without ever repeating a previously claimed paid launch', async () => { const t = setup({ policy: { ...policy, provider_enabled: true }, status: 304, state: { pending_captions: [{ record: update, attempts: 1, nextAttemptAt: new Date(0).toISOString() }] } }); vi.mocked(t.store.providerClaimed).mockResolvedValue(true); await t.run(); expect(t.deps.startJob).not.toHaveBeenCalled(); expect(t.deps.startApify).not.toHaveBeenCalled(); expect(t.patch().pending_captions).toHaveLength(1); });
 it('keeps terminal unknown costs null for later reconciliation', async () => { const t = setup({ pending: [pending({ observed_cost_usd: 0.004 })], status: 304 }); t.deps.pollApify.mockResolvedValue({ status: 'completed', result: { source, updates: [], notice: '' }, telemetry: { ledgerId: claim.checkId, providerRunId: 'providerRun123', cost: null as unknown as number } }); await t.run(); expect(t.patch()).toMatchObject({ cost_status: 'unknown', observed_cost_usd: null }); expect(t.store.providerPatch).toHaveBeenCalledWith('private-job', expect.objectContaining({ actual_cost_usd: null })); });
});

describe('durable caption-independent classification recovery', () => {
 it('retains a free format retry when newly retrieved captions have no checked video kind', async () => {
  const t=setup({policy:{...policy,provider_enabled:true}});
  t.deps.captions.mockResolvedValue({content:'Saved actual transcript',videoFormat:{kind:'unknown',basis:'watch_page'},coverage:'Partial captions'});
  await t.run();
  expect(t.patch()).toMatchObject({status:'partial',pending_captions:[{record:{content:'Saved actual transcript'},status:'retry',reason:'video_format_unconfirmed'}]});
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('retains provider captions for format recovery after a later page check', async () => {
  const t=setup({pending:[pending()],status:304});
  t.deps.pollApify.mockResolvedValue({status:'completed',result:{source,updates:[{...update,contentKind:'transcript',content:'Exact provider transcript'}],notice:''},telemetry:{ledgerId:claim.checkId,providerRunId:'providerRun123',cost:.004}});
  await t.run();
  expect(t.patch()).toMatchObject({status:'partial',pending_captions:[{record:{content:'Exact provider transcript'},reason:'video_format_unconfirmed'}]});
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it.each(['regular','short'] as const)('recovers checked %s format through RSS304 without replacing or buying saved captions',async kind=>{
  const saved={...update,contentKind:'transcript' as const,content:'Exact saved transcript',videoHighlights:[{text:'Existing recap'}],videoFormat:{kind:'unknown' as const,basis:'provider' as const}};
  const t=setup({status:304,policy:{...policy,provider_enabled:true},seen:['youtube:'+videoId],state:{pending_captions:[{record:saved,attempts:1,nextAttemptAt:new Date(0).toISOString(),status:'retry',reason:'video_format_unconfirmed'}]}});
  t.deps.captions.mockResolvedValue({content:'Different later caption text',videoFormat:{kind,basis:'watch_page'},coverage:'Current page'});
  await t.run();
  expect(t.updates()[0]).toMatchObject({content:saved.content,videoHighlights:saved.videoHighlights,videoFormat:{kind,basis:'watch_page'},isShort:kind==='short'});
  expect(t.patch().pending_captions).toEqual([]);
  expect(t.store.reserve).not.toHaveBeenCalled();expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('backs off format-only recovery without another supplier request when the public page still fails',async()=>{
  const saved={...update,contentKind:'transcript' as const,content:'Exact saved transcript'};
  const t=setup({status:304,policy:{...policy,provider_enabled:true},seen:['youtube:'+videoId],state:{pending_captions:[{record:saved,attempts:2,nextAttemptAt:new Date(0).toISOString(),status:'retry',reason:'video_format_unconfirmed'}]}});
  t.deps.captions.mockRejectedValue(new CollectionError(413,'response_too_large','Private upstream details'));
  await t.run();
  expect(t.patch()).toMatchObject({status:'partial',pending_captions:[{record:{content:saved.content},attempts:3,status:'retry',reason:'video_format_unconfirmed'}]});
  expect(t.store.reserve).not.toHaveBeenCalled();expect(t.deps.startApify).not.toHaveBeenCalled();
 });

 it('saves watch-page classification and a per-item reason even without captions through RSS 304', async () => {
  const t = setup({ status: 304, seen: ['youtube:' + videoId], state: { pending_captions: [{ record: update, attempts: 0, nextAttemptAt: new Date(0).toISOString() }] } });
  t.deps.captions.mockResolvedValue({ videoFormat: { kind: 'regular', basis: 'watch_page' }, coverage: 'Page metadata only', captionStatus: 'unavailable', reason: 'caption_tracks_not_supplied' });
  await t.run();
  expect(t.updates()[0]).toMatchObject({ contentKind: 'metadata_only', isShort: false, videoFormat: { kind: 'regular', basis: 'watch_page' } });
  expect(t.patch().pending_captions).toMatchObject([{ record: { videoFormat: { kind: 'regular' } }, status: 'unavailable', reason: 'caption_tracks_not_supplied', attempts: 1 }]);
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('persists transport failure separately from unavailability and retains the retry/backoff', async () => {
  const t = setup(); t.deps.captions.mockRejectedValue(new CollectionError(413, 'response_too_large', 'Private upstream detail'));
  await t.run();
  expect(t.patch().pending_captions).toMatchObject([{ status: 'blocked', reason: 'response_too_large', attempts: 1 }]);
  expect(JSON.stringify(t.patch())).not.toContain('Private upstream detail');
 });
 it('merges provider format evidence from a metadata-only result without claiming recovered captions', async () => {
  const t = setup({ pending: [pending()], status: 304, state: { pending_captions: [{ record: { ...update, isShort: true }, attempts: 1, nextAttemptAt: '2099-01-01T00:00:00Z' }] } });
  t.deps.pollApify.mockResolvedValue({ status: 'completed', result: { source, updates: [{ ...update, isShort: false, videoFormat: { kind: 'regular', basis: 'provider' } }], notice: '' }, telemetry: { ledgerId: claim.checkId, providerRunId: 'providerRun123', cost: 0.004 } } as never);
  await t.run();
  expect(t.updates()[0]).toMatchObject({ contentKind: 'metadata_only', isShort: true, videoFormat: { kind: 'short' } });
  expect(t.patch().pending_captions).toMatchObject([{ status: 'unavailable', reason: 'provider_returned_no_captions' }]);
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('keeps pending run identity and hold without starting another job or free caption fetch', async () => {
  const t = setup({ pending: [pending()], status: 304, policy: { ...policy, provider_enabled: true }, state: { pending_captions: [{ record: update, attempts: 1, nextAttemptAt: new Date(0).toISOString() }] } });
  t.deps.pollApify.mockResolvedValue({ status: 'running', telemetry: { ledgerId: claim.checkId, providerRunId: 'providerRun123', cost: 0.001 } } as never);
  await t.run();
  expect(t.patch().pending_captions).toMatchObject([{ status: 'provider_pending', reason: 'provider_pending' }]);
  expect(t.deps.captions).not.toHaveBeenCalled(); expect(t.deps.startApify).not.toHaveBeenCalled();
  expect(t.deps.settleBudget).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ terminal: false, actualUsd: null }), expect.any(Function));
 });
});

describe('native existing captions and authenticated background dispatch', () => {
 it('extracts only exact-video existing caption cues and preserves their real times', async () => {
  const player = { videoDetails: { videoId }, playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en` }] } } };
  const download = vi.fn().mockResolvedValueOnce({ text: `var ytInitialPlayerResponse = ${JSON.stringify(player)};`, url: update.url }).mockResolvedValueOnce({ text: JSON.stringify({ events: [{ tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'Real captions' }] }] }), url: 'https://www.youtube.com/api/timedtext' });
  expect(await nativeHourlyCaptions(videoId, download)).toMatchObject({ content: 'Real captions', transcriptSegments: [{ text: 'Real captions', startSeconds: 1.5, durationSeconds: 2 }] });
 });
 it('uses the dedicated exact-video downloader for provider-issued signed caption URLs', async () => { const player = { videoDetails: { videoId }, playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&signature=public-source-signature` }] } } }; const watch = vi.fn(async () => ({ text: `ytInitialPlayerResponse = ${JSON.stringify(player)};`, url: update.url, contentType: 'text/html' })); const captions = vi.fn(async () => ({ text: JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Signed native captions' }] }] }), url: 'https://www.youtube.com/api/timedtext', contentType: 'application/json' })); expect(await nativeHourlyCaptions(videoId, watch, captions)).toMatchObject({ content: 'Signed native captions' }); expect(watch).toHaveBeenCalledTimes(1); expect(captions).toHaveBeenCalledWith(expect.stringContaining('signature=public-source-signature')); });
 it('refuses a caption URL outside YouTube before a second request', async () => { const player = { videoDetails: { videoId }, playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: `https://evil.example/api/timedtext?v=${videoId}` }] } } }; const download = vi.fn(async () => ({ text: `ytInitialPlayerResponse = ${JSON.stringify(player)};`, url: update.url, contentType: 'text/html' })); expect(await nativeHourlyCaptions(videoId, download)).toMatchObject({ captionStatus: 'retry', reason: 'unsafe_caption_url', videoFormat: { kind: 'unknown' } }); expect(download).toHaveBeenCalledTimes(1); });
 it('disabled schedule dispatch does not contact a worker', async () => { const fetcher = vi.fn(); expect(await dispatchHourly(() => undefined, fetcher)).toEqual({ dispatched: false }); expect(fetcher).not.toHaveBeenCalled(); });
 it('requires the server secret and POST; no browser identity can authorize work', () => { const env = (key: string) => key === 'HOURLY_COLLECTION_WORKER_SECRET' ? 's'.repeat(40) : undefined; expect(hourlyWorkerAuthorized(new Request('https://app.org', { method: 'POST', headers: { 'x-hourly-collection-secret': 's'.repeat(40) } }), env)).toBe(true); expect(hourlyWorkerAuthorized(new Request('https://app.org', { method: 'POST', headers: { 'x-hourly-collection-secret': 'é'.repeat(40) } }), env)).toBe(false); expect(hourlyWorkerAuthorized(new Request('https://app.org'), env)).toBe(false); });
 it('dispatches only to the fixed app-owned background path and expects 202', async () => { const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 })); const env = (key: string) => ({ HOURLY_COLLECTION_ENABLED: 'true', APP_URL: 'https://recap.example.org/', HOURLY_COLLECTION_WORKER_SECRET: 's'.repeat(40) })[key]; expect(await dispatchHourly(env, fetcher)).toEqual({ dispatched: true }); expect(fetcher.mock.calls[0]?.[0]).toBe('https://recap.example.org/.netlify/functions/hourly-collection-worker'); });
});

describe('free-first discovery fallbacks and audit trail', () => {
 it('uses free uploads after RSS fails and skips paid discovery when it succeeds', async () => {
  const t=setup({policy:{...policy,provider_enabled:true}});
  t.deps.download.mockRejectedValue(new CollectionError(422,'source_unavailable','Restricted feed',404));
  t.deps.discover.mockImplementation(async()=>({updates:[update],gapPossible:true}));
  t.deps.captions.mockResolvedValue({content:'Free public captions',coverage:'Existing captions',videoFormat:{kind:'regular',basis:'watch_page'}});
  await t.run();
  expect(t.patch()).toMatchObject({status:'partial',details:{mode:'youtube_public_uploads'}});
  expect(t.updates()[0].content).toBe('Free public captions');
  expect(t.deps.startDiscovery).not.toHaveBeenCalled();expect(t.store.reserve).not.toHaveBeenCalled();
  expect(vi.mocked(t.deps.log.start).mock.calls.map(call=>call[1])).toEqual(['youtube_channel_identity','youtube_rss','youtube_public_uploads','youtube_native_captions']);
  expect(t.deps.log.finish).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({status:'failed',http_status:404}));
 });
 it('reserves paid channel discovery only after both free routes fail and keeps the RSS failure visible',async()=>{
  const t=setup({policy:{...policy,provider_enabled:true}});
  t.deps.download.mockRejectedValue(new CollectionError(422,'source_unavailable','Restricted feed',500));
  await t.run();
  expect(t.deps.startDiscovery).toHaveBeenCalledTimes(1);
  expect(t.store.reserve).toHaveBeenCalledWith(expect.anything(),expect.stringMatching(/^youtube-discovery:UC/),expect.any(String),.02);
  expect(t.patch()).toMatchObject({status:'failed',http_status:500,cost_status:'unknown',details:{providerJobs:[{providerRunId:'Discovery12345'}]}});
 });
 it('makes no fallback request when the failed free attempt cannot be logged',async()=>{
  const t=setup({policy:{...policy,provider_enabled:true}});
  vi.mocked(t.deps.log.start).mockRejectedValue(new CollectionError(503,'retrieval_log_unavailable','No log'));
  await t.run();expect(t.deps.download).not.toHaveBeenCalled();expect(t.deps.discover).not.toHaveBeenCalled();expect(t.deps.startDiscovery).not.toHaveBeenCalled();
 });
});
