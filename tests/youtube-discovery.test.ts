import { describe, it, expect, vi } from 'vitest';
import { exactPublicationTimestamp, nativeYouTubeDiscovery, pageJson } from '../netlify/functions/_shared/youtube-discovery';
import type { Source } from '../src/lib/types';
import { pollStoredApify, YOUTUBE_ACTOR_ID } from '../netlify/functions/_shared/apify';
const channel = 'UCabcdefghijklmnopqrstuv', video = 'abcdefghijk';
const source: Source = { id: 'source', name: 'Channel', platform: 'YouTube', url: 'https://www.youtube.com/channel/' + channel, status: 'ready', creatorIds: [] };
const page = (identity = channel) => 'var ytInitialData = ' + JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: identity } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [{ videoRenderer: { videoId: video } }] } } } }] } } });
const watch = (identity = channel, date = '2026-11-04T12:34:56+00:00') => 'var ytInitialPlayerResponse = ' + JSON.stringify({ videoDetails: { videoId: video, channelId: identity, title: 'An upload', shortDescription: 'Publisher description' }, microformat: { playerMicroformatRenderer: { publishDate: date } } });
const download = (watchText = watch()) => vi.fn(async (url: string) => ({ text: url.includes('/watch?') ? watchText : page(), url, contentType: 'text/html', status: 200 }));
describe('free public YouTube discovery', () => {
 it('parses nested braces in quoted JSON without evaluating source scripts', () => expect(pageJson('var ytInitialData = {"text":"a } { \\\" value","ok":true}; throw Error()', 'ytInitialData')).toMatchObject({ ok: true }));
 it('requires channel and video identity plus an exact publication timestamp', async () => {
  const read = download(); const out = await nativeYouTubeDiscovery(source, channel, new Set(), read);
  expect(out).toMatchObject({ gapPossible: true, updates: [{ sourceId: source.id, url: 'https://www.youtube.com/watch?v=' + video, publishedAt: '2026-11-04T12:34:56.000Z', contentKind: 'metadata_only' }] });
  expect(read).toHaveBeenCalledTimes(2);
 });
 it('does not download metadata again for a known original', async () => { const read = download(); expect((await nativeYouTubeDiscovery(source, channel, new Set(['youtube:' + video]), read)).updates).toEqual([]); expect(read).toHaveBeenCalledTimes(1); });
 it.each([watch('UCxxxxxxxxxxxxxxxxxxxxxx'), watch(channel, '2026-11-04'), watch(channel, '2026-11-04T12:34:56'), watch(channel, '2026-02-30T12:34:56Z'), watch(channel, 'yesterday')])('rejects foreign identity and imprecise publication dates', async text => { await expect(nativeYouTubeDiscovery(source, channel, new Set(), download(text))).rejects.toMatchObject({ code: 'youtube_upload_unconfirmed' }); });
 it('does not turn an unrecognized page into quiet coverage', async () => { await expect(nativeYouTubeDiscovery(source, channel, new Set(), async url => ({ url, text: '<html>Sign in</html>', contentType: 'text/html' }))).rejects.toMatchObject({ code: 'youtube_channel_mismatch' }); });
});

describe('exact source publication timestamps', () => {
 it.each(['2026-11-04', '2026-11-04T12:34:56', '2026-02-29T12:00:00Z', '2026-04-31T12:00:00Z', '2026-11-04T24:00:00Z', '2026-11-04T12:60:00Z', '2026-11-04T12:00:60Z', '2026-11-04T12:00:00+24:00', '2026-11-04T12:00:00+00:60', '', null])('rejects imprecise or invalid date %s', value => expect(exactPublicationTimestamp(value)).toBeUndefined());
 it.each([['2024-02-29T23:59:59.123Z', '2024-02-29T23:59:59.123Z'], ['2026-11-04T12:34:56+02:30', '2026-11-04T10:04:56.000Z']])('preserves a valid supplied instant %s', (value, expected) => expect(exactPublicationTimestamp(value)).toBe(expected));
});

describe('bounded retained-provider discovery pages', () => {
 const values: Record<string,string> = { APIFY_RUNTIME_ENABLED:'true',APIFY_API_TOKEN:'fixture-token',COLLECTION_JOB_SECRET:'fixture-secret-at-least-thirty-two-characters',
  APIFY_YOUTUBE_BUILD:'0.0.314',APIFY_YOUTUBE_BUILD_ID:'Build123456',APIFY_MAX_ITEMS:'3',APIFY_MAX_TOTAL_CHARGE_USD:'0.05',COLLECTION_ALLOWED_USER_IDS:'fixture-owner' };
 const env = (key:string) => values[key];
 const job = { providerRunId:'Run123456789',actorId:YOUTUBE_ACTOR_ID,ledgerId:'12345678-1234-4234-8234-123456789012',maxItems:3,source,discoveryChannelId:channel };
 const row = (index:number) => ({ id:'abcdefghij'+index,url:'https://www.youtube.com/watch?v=abcdefghij'+index,channelId:channel,date:'2026-11-10T19:00:00Z',title:'Retained upload '+index,
  subtitles:[{srt:'1\n00:00:01,000 --> 00:00:02,000\nExact retained caption '+index+'.'}] });
 function provider(pages:unknown[]) {
  return vi.fn(async (input:RequestInfo|URL,init?:RequestInit) => {
   expect(init?.method??'GET').toBe('GET');
   const url=new URL(String(input));
   if(url.pathname.includes('/actor-runs/'))return Response.json({data:{id:job.providerRunId,actId:YOUTUBE_ACTOR_ID,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',defaultDatasetId:'Dataset123456',usageTotalUsd:.012}});
   expect(url.pathname).toBe('/v2/datasets/Dataset123456/items');expect(url.searchParams.get('limit')).toBe('1');
   expect(url.searchParams.has('fields')).toBe(false);expect(url.searchParams.has('unwind')).toBe(false);
   return Response.json(pages[Number(url.searchParams.get('offset'))]);
  });
 }
 it('reads three complete individually bounded records whose combined body exceeds the response cap',async()=>{
  const pages=[0,1,2].map(i=>[{...row(i),retainedProviderMetadata:'x'.repeat(1_100_000)}]);
  expect(JSON.stringify(pages.flat()).length).toBeGreaterThan(2*1024*1024);
  const read=provider(pages),out=await pollStoredApify(job,'fixture-owner',env,read);
  expect(out.contentError).toBeUndefined();expect(out.result?.updates.map(u=>u.content)).toEqual([0,1,2].map(i=>'Exact retained caption '+i+'.'));
  expect(read).toHaveBeenCalledTimes(4);expect(out.telemetry?.cost).toBe(.012);
 });
 it('does not stop at an empty cleaned row and still preserves later exact identities',async()=>{
  const read=provider([[],[row(1)],[row(2)]]),out=await pollStoredApify(job,'fixture-owner',env,read);
  expect(out.result?.updates).toHaveLength(2);expect(read).toHaveBeenCalledTimes(4);
 });
 it('rejects an oversized single record while retaining terminal fee telemetry',async()=>{
  const read=provider([[{...row(0),retainedProviderMetadata:'x'.repeat(2*1024*1024)}],[],[]]);
  const out=await pollStoredApify(job,'fixture-owner',env,read);
  expect(out).toMatchObject({status:'completed',contentError:'response_too_large',telemetry:{cost:.012}});expect(out.result).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
 });
 it('rejects a malformed page or foreign channel without importing a partial prefix',async()=>{
  for(const pages of [[[row(0),row(1)],[],[]],[[row(0)],[{...row(1),channelId:'UCxxxxxxxxxxxxxxxxxxxxxx'}],[]]]) {
   const out=await pollStoredApify(job,'fixture-owner',env,provider(pages));
   expect(out.result).toBeUndefined();expect(out.contentError).toMatch(/^provider_(response_invalid|channel_unconfirmed)$/);expect(out.telemetry?.cost).toBe(.012);
  }
 });
});
