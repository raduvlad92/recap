import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Source } from '../src/lib/types';
import { normalizeYouTubeItems, startYouTubeDiscovery, pollStoredApify, verifyHourlyApifyConfiguration, YOUTUBE_ACTOR_ID } from '../netlify/functions/_shared/apify';
import { conditionalFeedHeaders } from '../netlify/functions/_shared/feed';
import { createCollectHandler } from '../netlify/functions/_shared/collect-handler';
const source: Source = { id: 'real-channel', name: 'A channel', platform: 'YouTube', url: 'https://www.youtube.com/watch?v=abcdefghijk', creatorIds: [], status: 'ready' };
const pricing = { pricingModel: 'PAY_PER_EVENT', startedAt: '2026-09-02T00:00:00.000Z' };
const priceHash = createHash('sha256').update(JSON.stringify(pricing)).digest('hex');
const values: Record<string, string> = { APIFY_RUNTIME_ENABLED: 'true', APIFY_API_TOKEN: 'test-only', COLLECTION_JOB_SECRET: 'test-only-signing-secret-longer-than-thirty-two', APIFY_YOUTUBE_BUILD: '0.0.319', APIFY_YOUTUBE_BUILD_ID: 'Build123456789', APIFY_MAX_ITEMS: '1', APIFY_MAX_TOTAL_CHARGE_USD: '0.005', COLLECTION_ALLOWED_USER_IDS: 'user_operator', HOURLY_COLLECTION_ENABLED: 'true', HOURLY_COLLECTION_PROVIDER_VERIFIED: 'true', APIFY_YOUTUBE_PRICING_SHA256: priceHash };
const env = (name: string) => values[name];
const body = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('conditional freshness request headers', () => {
  it('reuses valid publisher validators', () => {
    expect(conditionalFeedHeaders({ etag: 'W/"revision-4"', lastModified: 'Thu, 22 Oct 2026 12:00:00 GMT' })).toEqual({ 'if-none-match': 'W/"revision-4"', 'if-modified-since': 'Thu, 22 Oct 2026 12:00:00 GMT' });
  });
  it('rejects oversized and injected headers or invalid dates', () => {
    expect(conditionalFeedHeaders({ etag: '"valid"\r\nAuthorization: secret', lastModified: 'not a date' })).toEqual({});
    expect(conditionalFeedHeaders({ etag: 'x'.repeat(513) })).toEqual({});
  });
});

describe('free provider review before paid launch', () => {
  it('validates the exact actor build and reviewed effective pricing using GET only', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      return String(url).includes('actor-builds/') ? body({ data: { id: 'Build123456789', actId: YOUTUBE_ACTOR_ID, buildNumber: '0.0.319', status: 'SUCCEEDED' } }) : body({ data: { id: YOUTUBE_ACTOR_ID, pricingInfos: [pricing] } });
    });
    await verifyHourlyApifyConfiguration('user_operator', env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('blocks pricing changes and unreviewed builds', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('actor-builds/') ? body({ data: { id: 'Build123456789', actId: YOUTUBE_ACTOR_ID, buildNumber: '0.0.320', status: 'SUCCEEDED' } }) : body({ data: { id: YOUTUBE_ACTOR_ID, pricingInfos: [pricing] } }));
    await expect(verifyHourlyApifyConfiguration('user_operator', env, fetcher)).rejects.toMatchObject({ code: 'provider_review_changed' });
    fetcher.mockImplementation(async (url) => String(url).includes('actor-builds/') ? body({ data: { id: 'Build123456789', actId: YOUTUBE_ACTOR_ID, buildNumber: '0.0.319', status: 'SUCCEEDED' } }) : body({ data: { id: YOUTUBE_ACTOR_ID, pricingInfos: [{ ...pricing, pricingModel: 'CHANGED' }] } }));
    await expect(verifyHourlyApifyConfiguration('user_operator', env, fetcher)).rejects.toMatchObject({ code: 'provider_review_changed' });
  });
  it('rejects a higher per-run cap before making a provider request', async () => {
    const fetcher = vi.fn();
    await expect(verifyHourlyApifyConfiguration('user_operator', name => name === 'APIFY_MAX_TOTAL_CHARGE_USD' ? '0.10' : env(name), fetcher)).rejects.toMatchObject({ code: 'provider_review_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('stored server-only provider recovery', () => {
  const job = { providerRunId: 'Run123456789', actorId: YOUTUBE_ACTOR_ID, source, maxItems: 1, ledgerId: 'a9a43a2a-c01a-40eb-ae1e-a1d41b52b901' };
  it('recovers a known run without a short-lived browser token', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('actor-runs/') ? body({ data: { id: job.providerRunId, actId: job.actorId, buildId: values.APIFY_YOUTUBE_BUILD_ID, status: 'SUCCEEDED', defaultDatasetId: 'Dataset1234567', usageTotalUsd: 0.004 } }) : body([{ url: source.url, date: '2026-10-22T12:00:00Z', title: 'Real new video' }]));
    const result = await pollStoredApify(job, 'user_operator', env, fetcher);
    expect(result).toMatchObject({ status: 'completed', telemetry: { ledgerId: job.ledgerId, cost: 0.004 }, result: { updates: [{ isSample: false, title: 'Real new video' }] } });
  });
  it('rejects another user, arbitrary actors and channel-wide jobs', async () => {
    const fetcher = vi.fn();
    await expect(pollStoredApify(job, 'user_other', env, fetcher)).rejects.toMatchObject({ status: 403 });
    await expect(pollStoredApify({ ...job, actorId: 'OtherActor123' }, 'user_operator', env, fetcher)).rejects.toMatchObject({ status: 403 });
    await expect(pollStoredApify({ ...job, source: { ...source, url: 'https://www.youtube.com/@example' } }, 'user_operator', env, fetcher)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a provider result from a different build', async () => {
    const fetcher = vi.fn(async () => body({ data: { id: job.providerRunId, actId: job.actorId, buildId: 'OtherBuild123', status: 'RUNNING' } }));
    await expect(pollStoredApify(job, 'user_operator', env, fetcher)).rejects.toMatchObject({ code: 'provider_build_mismatch' });
  });
});

describe('new collected material preserves usable source content', () => {
  it('keeps full captions beyond the retired 24k limit, real timing and Shorts status', () => {
    const speech = 'Actual source words. '.repeat(2000);
    const [update] = normalizeYouTubeItems([{ url: 'https://www.youtube.com/shorts/abcdefghijk', title: 'New short', date: '2026-10-22T12:00:00Z', subtitles: [{ srt: '1\n00:00:01,000 --> 00:00:03,000\n' + speech }] }], source, 1);
    expect(update.content?.length).toBeGreaterThan(24_000);
    expect(update).toMatchObject({ isShort: true, isSample: false, contentKind: 'transcript', transcriptSegments: [{ startSeconds: 1, durationSeconds: 2 }] });
    expect(update.insights).toEqual([]);
    expect(update.videoSummary).toBeUndefined();
  });
  it('blocks manual paid starts that would bypass hourly user budgets', async () => {
    const start = vi.fn(), finish = vi.fn();
    const handler = createCollectHandler({ env, authenticate: async () => 'user_operator', startJob: async () => 'a9a43a2a-c01a-40eb-ae1e-a1d41b52b901', finishJob: finish, startApify: start });
    const response = await handler(new Request('https://recap.example/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) }));
    expect(response.status).toBe(503);
    expect(start).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(expect.any(String), 'user_operator', expect.objectContaining({ status: 'blocked', errorCode: 'managed_collection_only' }), env);
  });
});

describe('publisher-signed caption URL exception', () => {
  it('allows only YouTube timedtext signatures while generic source URLs remain strict', async () => {
    const { youtubeCaptionUrl } = await import('../netlify/functions/_shared/feed');
    const { publicHttpsUrl } = await import('../netlify/functions/_shared/security');
    const url = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&signature=publisher-signed&fmt=json3';
    expect(youtubeCaptionUrl(url).searchParams.get('signature')).toBe('publisher-signed');
    expect(() => publicHttpsUrl(url)).toThrow();
    for (const unsafe of ['https://evil.example/api/timedtext?v=abcdefghijk&signature=x', 'https://www.youtube.com/watch?v=abcdefghijk&signature=x', 'https://www.youtube.com/api/timedtext?v=short&signature=x', 'https://www.youtube.com/api/timedtext?v=abcdefghijk&token=secret', 'http://www.youtube.com/api/timedtext?v=abcdefghijk&signature=x', 'https://user:secret@www.youtube.com/api/timedtext?v=abcdefghijk&signature=x', 'https://www.youtube.com/api/timedtext?v=abcdefghijk&v=lmnopqrstuv&signature=x']) expect(() => youtubeCaptionUrl(unsafe)).toThrow();
  });
});

describe('public publisher IPv6 DNS classification', () => {
  it('accepts ordinary public Google IPv6 alongside public IPv4 records', async () => {
    const { isPublicAddress } = await import('../netlify/functions/_shared/security');
    for (const ip of ['2001:4860:4827:400::', '2001:4860:4860::8888', '2001:0200::1', '2001:500::1', '142.251.156.4']) expect(isPublicAddress(ip)).toBe(true);
  });
  it('keeps special-purpose, documentation, transition and private IPv6 blocked', async () => {
    const { isPublicAddress } = await import('../netlify/functions/_shared/security');
    for (const ip of ['2001::1', '2001:0::1', '2001:1ff:ffff::1', '2001:2::1', '2001:10::1', '2001:20::1', '2001:db8::1', '2001:0DB8::1', '2002:c000:0204::1', '3fff::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '::1']) expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('terminal fee telemetry survives bounded original-result failures', () => {
 const job = { providerRunId:'Run123456789',actorId:YOUTUBE_ACTOR_ID,source,maxItems:1,ledgerId:'a9a43a2a-c01a-40eb-ae1e-a1d41b52b901' };
 it.each([0, .004, null])('preserves validated terminal fee %s independently of oversized content', async fee => {
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   expect(init?.method).toBeUndefined();
   return String(url).includes('actor-runs/')?body({data:{id:job.providerRunId,actId:job.actorId,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',defaultDatasetId:'Dataset1234567',usageTotalUsd:fee}}):body([{url:source.url,text:'x'.repeat(2*1024*1024)}]);
  });
  const result=await pollStoredApify(job,'user_operator',env,fetcher);
  expect(result).toMatchObject({status:'completed',contentError:'response_too_large',telemetry:{cost:fee}});expect(result.result).toBeUndefined();
  expect(fetcher.mock.calls[1][0]).toBe('https://api.apify.com/v2/datasets/Dataset1234567/items?clean=true&format=json&limit=1');
 });
 it.each(['http','json','transport'])('preserves fee after dataset %s error without success/import claims',async mode=>{
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
   if(String(url).includes('actor-runs/'))return body({data:{id:job.providerRunId,actId:job.actorId,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',defaultDatasetId:'Dataset1234567',usageTotalUsd:.004}});
   if(mode==='transport')throw Error('private upstream details');
   return mode==='http'?new Response('',{status:503}):new Response('bad json');
  });
  const result=await pollStoredApify(job,'user_operator',env,fetcher);
  expect(result).toMatchObject({status:'completed',telemetry:{cost:.004},contentError:mode==='http'?'provider_error':mode==='json'?'provider_response_invalid':'provider_result_unreadable'});
  expect(result.result).toBeUndefined();expect(JSON.stringify(result)).not.toContain('private upstream');
 });
 it.each(['FAILED','ABORTED','TIMED-OUT'])('retains fee for verified terminal %s without fetching any dataset',async status=>{
  const fetcher=vi.fn(async()=>body({data:{id:job.providerRunId,actId:job.actorId,buildId:values.APIFY_YOUTUBE_BUILD_ID,status,usageTotalUsd:.004}}));
  expect(await pollStoredApify(job,'user_operator',env,fetcher)).toMatchObject({status:'failed',telemetry:{cost:.004}});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects unknown run status before financial settlement, and verifies identity before transporting any fee',async()=>{
  for(const patch of [{status:'SOMETHING_NEW'},{id:'DifferentRun'},{actId:'DifferentActor'},{buildId:'DifferentBuild'}]){
   const fetcher=vi.fn(async()=>body({data:{id:job.providerRunId,actId:job.actorId,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',usageTotalUsd:.004,...patch}}));
   await expect(pollStoredApify(job,'user_operator',env,fetcher)).rejects.toMatchObject({code:patch.buildId?'provider_build_mismatch':patch.status?'provider_response_invalid':'invalid_job'});expect(fetcher).toHaveBeenCalledTimes(1);
  }
 });
 it('skips dataset content for fee-only reconciliation of an imported or discarded original',async()=>{
  const fetcher=vi.fn(async()=>body({data:{id:job.providerRunId,actId:job.actorId,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',usageTotalUsd:.004}}));
  expect(await pollStoredApify({...job,feeOnly:true},'user_operator',env,fetcher)).toEqual({status:'completed',telemetry:{ledgerId:job.ledgerId,providerRunId:job.providerRunId,cost:.004}});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('keeps the current 200000-character output cap and explicit clipped coverage',()=>{
  const [update]=normalizeYouTubeItems([{url:source.url,title:'Synthetic',date:'2026-10-22T12:00:00Z',subtitles:[{srt:'1\n00:00:00,000 --> 00:00:02,000\n'+'x'.repeat(200001)}]}],source,1);
  expect(update.content).toHaveLength(200000);expect(update.coverage).toContain('clipped');
 });
});


describe('bounded paid channel fallback',()=>{
 it('retrieves at most three uploads with available captions under the existing build and a fixed cash cap',async()=>{
  const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>body({data:{id:'RunDiscovery123',actId:YOUTUBE_ACTOR_ID,buildId:values.APIFY_YOUTUBE_BUILD_ID}}));
  await startYouTubeDiscovery(source,'UCabcdefghijklmnopqrstuv','user_operator',env,fetcher);
  const [url,init]=fetcher.mock.calls[0];const options=new URL(String(url)).searchParams;
  expect(options.get('maxTotalChargeUsd')).toBe('0.02');expect(options.get('maxItems')).toBe('3');expect(options.get('restartOnError')).toBe('false');
  expect(JSON.parse(String(init?.body))).toMatchObject({startUrls:[{url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'}],maxResults:3,transcriptionAndSubtitle:'ALWAYS_SUBTITLES',aiVideoDescription:false,aiVideoSummary:false});
 });
});
