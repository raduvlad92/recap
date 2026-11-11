import { testRetrievalLog } from './helpers/retrieval-log';
import { describe, expect, it, vi } from 'vitest';
import { socialSourceKey, socialItemKey, socialActorInput, normalizeSocialDataset, createSocialCollector, verifySocialConfiguration, socialPricingFingerprint, type SocialJob, type SocialStore } from '../netlify/functions/_shared/social-collection';
const configuration = { platform: 'X' as const, enabled: true, actor_ref: 'xquik/x-tweet-scraper', actor_id: 'Actor12345', build_id: 'Build12345', build_number: '1.2.3', apify_user_id: 'User12345', pricing_fingerprint: 'a'.repeat(64), max_items: 20, maximum_usd: .05, memory_mb: 256, timeout_seconds: 120, reviewed_at: '2026-10-30T00:00:00Z' };
const job: SocialJob = { collection_job_id: 'ledger-job', id: 'one-job', source_key: 'x.com/source', platform: 'X', source_url: 'https://x.com/source', source_name: 'Source', window_from: '2026-10-30T00:00:00Z', window_to: '2026-10-31T00:00:00Z', state: 'claimed', lease_token: 'lease', reservation_id: 'reservation', provider_run_id: null, dataset_id: null, config: configuration };
const row = { id: '123456789', url: 'https://x.com/source/status/123456789', author: { userName: 'source' }, createdAt: '2026-10-30T12:00:00Z', text: 'AeroBox has announced a quiet focus mode.' };
function store(value: SocialJob | null = job): SocialStore { let claimed = false; return { sync: vi.fn(async () => 1), claim: vi.fn(async () => { if (claimed) return null; claimed = true; return value; }), launch: vi.fn(async () => true), run: vi.fn(async () => {}), finish: vi.fn(async () => {}) }; }
describe('shared platform discovery contracts', () => {
 it('has bounded queue capacity for 3900 distinct sources plus one poll each within an hourly synthetic window', async () => {
  const queue=Array.from({length:7800},(_,index)=>({...job,id:'job-'+index,source_key:'x.com/source'+(index%3900),source_url:'https://x.com/source'+(index%3900),state:'running' as const,provider_run_id:'Run'+String(index).padStart(8,'0')}));
  const seen=new Set<string>();const fakeStore:SocialStore={sync:async()=>3900,claim:async()=>queue.shift()??null,launch:async()=>{throw Error('No external launch in synthetic capacity proof');},run:async()=>{},finish:async row=>{seen.add(row.id);}};
  const fetcher=vi.fn(async (url:RequestInfo|URL)=>new Response(JSON.stringify({data:{id:String(url).split('/').at(-1),actId:configuration.actor_id,userId:configuration.apify_user_id,buildId:configuration.build_id,status:'RUNNING'}})));
  for(let tick=0;tick<12&&queue.length;tick++)await createSocialCollector({ log: testRetrievalLog(), native: async () => [],env:name=>name==='APIFY_API_TOKEN'?'fixture-token':undefined,store:fakeStore,fetcher,now:()=>0})();
  expect(queue).toHaveLength(0);expect(seen.size).toBe(7800);expect(fetcher).toHaveBeenCalledTimes(7800);
 });
 it('canonicalizes source identities without merging names or account kinds', () => {
  expect(socialSourceKey('X', 'https://twitter.com/Source/')).toBe('x.com/source');
  expect(socialSourceKey('LinkedIn', 'https://www.linkedin.com/company/Acme/')).toBe('linkedin.com/company/acme');
  expect(socialSourceKey('LinkedIn', 'https://www.linkedin.com/in/Acme/')).toBe('linkedin.com/in/acme');
  for (const url of ['https://instagram.com/p/123', 'https://x.com/home', 'https://x.com/source?token=private', 'https://user:pass@x.com/source']) expect(() => socialSourceKey('X', url)).toThrow();
 });
 it('uses native post identities across URL aliases', () => {
  expect(socialItemKey('X', row.url)).toBe(socialItemKey('X', 'https://twitter.com/source/status/123456789?ref=one'));
  expect(socialItemKey('Instagram', 'https://www.instagram.com/reel/AbCd123/')).toBe('instagram:AbCd123');
  expect(socialItemKey('LinkedIn', 'https://www.linkedin.com/posts/source_launch-activity-123456789-xyz')).toBe('linkedin:123456789');
 });
 it('bounds each Actor and disables expensive unrelated results', () => {
  expect(socialActorInput(job)).toMatchObject({ mode: 'profileTweets', maxItems: 20, queryType: 'Latest' });
  expect(socialActorInput(job)).toMatchObject({twitterHandles:['source'],time:{sinceTime:String(Date.parse(job.window_from)/1000),untilTime:String(Date.parse(job.window_to)/1000)}});
  expect(socialActorInput({ ...job, platform: 'Instagram' })).toMatchObject({ resultsType: 'posts', resultsLimit: 20, onlyPostsNewerThan: new Date(job.window_from).toISOString() });
  expect(socialActorInput({...job,platform:'Instagram',window_from:'2026-10-30T00:00:00.000+00:00'})).toMatchObject({onlyPostsNewerThan:'2026-10-30T00:00:00.000Z'});
  expect(socialActorInput({ ...job, platform: 'LinkedIn' })).toMatchObject({ maxPosts: 20, scrapeComments: false, scrapeReactions: false });
  expect(() => socialActorInput({ ...job, config: { ...configuration, max_items: 0 } })).toThrow();
  expect(socialActorInput({...job,platform:'Instagram',config:{...configuration,actor_ref:'yugenox/instagram-post-scraper'}})).toMatchObject({urls:[job.source_url],maxPosts:20,maxPostsPerProfile:20,skipPinnedPosts:true,monitor:false});
  expect(socialActorInput({...job,platform:'Instagram',config:{...configuration,actor_ref:'yugenox/instagram-post-scraper'}})).not.toHaveProperty('newerThan');
 });
 it('rejects demo, foreign author, missing date and out-of-window results', () => {
  const out = normalizeSocialDataset(job, [row, { ...row, demo: true }, { ...row, author: { userName: 'foreign' } }, { ...row, createdAt: null }, { ...row, createdAt: job.window_to }]);
  expect(out.items).toHaveLength(1); expect(out.coverage.rejected).toEqual({ provider_demo_data: 1, unattributed: 1, missing_date: 1, outside_window: 1 });
  expect(out.items[0].record).toMatchObject({ contentKind: 'feed_text', content: row.text, sourceId: job.source_key, isSample: false });
 });
 it('preserves revised originals separately and deduplicates exact item identity', () => {
  const a = normalizeSocialDataset(job, [row, row]), b = normalizeSocialDataset(job, [{ ...row, text: row.text + ' Corrected.' }]);
  expect(a.items).toHaveLength(1); expect(a.items[0].itemKey).toBe(b.items[0].itemKey); expect(a.items[0].revision).not.toBe(b.items[0].revision);
 });
 it('never turns empty, errored or short provider output into exhaustive quiet coverage', () => {
  expect(normalizeSocialDataset(job, []).coverage).toMatchObject({ status: 'unknown', complete: false, reason: 'empty_or_unusable_response' });
  expect(normalizeSocialDataset(job, [row]).coverage).toMatchObject({ status: 'partial', complete: false });
  expect(normalizeSocialDataset({ ...job, config: { ...configuration, max_items: 1 } }, [row]).coverage.reason).toBe('result_limit_reached');
 });
 it('preserves Instagram caption scope and LinkedIn source attribution', () => {
  const instagram = { ...job, platform: 'Instagram' as const, source_key: 'instagram.com/source' };
  expect(normalizeSocialDataset(instagram, [{ url: 'https://www.instagram.com/p/AbCd123/', ownerUsername: 'source', timestamp: row.createdAt, caption: 'Caption only.' }]).items[0].record.coverage).toContain('media audio are not collected');
  expect(normalizeSocialDataset(instagram,[{url:'https://www.instagram.com/p/AbCd123/',code:'AbCd123',owner:{username:'source'},createdAt:row.createdAt,caption:'A documented backup caption.',image:{url:'https://scontent.cdninstagram.com/photo.jpg',width:640,height:640}}]).items[0].record).toMatchObject({content:'A documented backup caption.',media:[{type:'image',url:'https://scontent.cdninstagram.com/photo.jpg'}]});
  expect(normalizeSocialDataset(instagram,[{url:'https://www.instagram.com/p/AbCd123/',code:'Other123',owner:{username:'source'},createdAt:row.createdAt,caption:'Foreign code.'}]).coverage.rejected).toEqual({identity_mismatch:1});
  expect(normalizeSocialDataset({...instagram,config:{...configuration,actor_ref:'yugenox/instagram-post-scraper',max_items:1}},[{url:'https://www.instagram.com/p/AbCd123/',owner:{username:'source'},createdAt:'2026-10-29T23:00:00Z',caption:'Earlier day caption.'}]).coverage).toMatchObject({status:'unknown',complete:false,accepted:0,reason:'provider_returned_older_window'});
  const linkedin = { ...job, platform: 'LinkedIn' as const, source_key: 'linkedin.com/in/source' };
  const item = { linkedinUrl: 'https://www.linkedin.com/posts/source_launch-activity-123456789-xyz', author: { linkedinUrl: 'https://www.linkedin.com/in/source/' }, postedAt: { date: row.createdAt }, content: 'A real authored LinkedIn update.' };
  expect(normalizeSocialDataset(linkedin, [item]).items).toHaveLength(1);
  expect(normalizeSocialDataset(linkedin,[{...item,author:{linkedinUrl:'https://www.linkedin.com/in/source/posts?miniProfileUrn=example'}}]).items).toHaveLength(1);
  expect(normalizeSocialDataset(linkedin, [{ ...item, author: { linkedinUrl: 'https://www.linkedin.com/company/source/' } }]).items).toHaveLength(0);
 });
 it('keeps new launch stopped explicitly while allowing stored-run recovery', async () => {
  const storage = store(null), fetcher = vi.fn(); await createSocialCollector({ log: testRetrievalLog(), native: async () => [], store: storage, fetcher, env: () => 'false' })();
  expect(storage.sync).not.toHaveBeenCalled(); expect(storage.claim).toHaveBeenCalledWith(false); expect(fetcher).not.toHaveBeenCalled();
 });
 it('rounds real provider usage upward to the ledger precision before settling an existing run',async()=>{
  const storage=store({...job,state:'running',provider_run_id:'Run12345'});
  const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>String(input).includes('/datasets/')?Response.json([]):Response.json({data:{id:'Run12345',actId:configuration.actor_id,userId:configuration.apify_user_id,buildId:configuration.build_id,status:'SUCCEEDED',defaultDatasetId:'Dataset12345',usageTotalUsd:.00007906879155834517}}));
  await createSocialCollector({ log: testRetrievalLog(), native: async () => [],store:storage,fetcher,env:()=> 'fixture-token'})();
  expect(storage.finish).toHaveBeenCalledWith(expect.anything(),[],expect.anything(),.000079068792,true);
 });
 it('reconciles an ambiguous start without ever issuing a second POST', async () => {
  const storage = store({ ...job, state: 'ambiguous' }), fetcher = vi.fn();
  await createSocialCollector({ log: testRetrievalLog(), native: async () => [], store: storage, fetcher, env: () => undefined })();
  expect(fetcher).not.toHaveBeenCalled(); expect(storage.finish).toHaveBeenCalledWith(expect.anything(), [], expect.objectContaining({ reason: 'ambiguous_launch' }), null, false, 'ambiguous_launch');
 });
 it('fails closed before launch when reviewed account or price differs', async () => {
  const pricing = { startedAt: '2026-01-01T00:00:00Z', pricingModel: 'PAY_PER_EVENT' };
  const config = { ...configuration, pricing_fingerprint: socialPricingFingerprint(pricing) };
  const fetcher = vi.fn(async (input: string | URL | Request) => Response.json({ data: String(input).includes('users/me') ? { id: 'Wrong12345' } : String(input).includes('actor-builds') ? { id: config.build_id, actId: config.actor_id, buildNumber: config.build_number, status: 'SUCCEEDED' } : { id: config.actor_id, pricingInfos: [pricing] } }));
  await expect(verifySocialConfiguration(config, () => 'token', fetcher)).rejects.toMatchObject({ code: 'social_review_changed' });
 });
});

describe('free-first social retrieval',()=>{
 it('imports free attributable text without a provider preflight or paid launch',async()=>{
  const storage=store(),log=testRetrievalLog(),fetcher=vi.fn();
  await createSocialCollector({store:storage,log,fetcher,native:async()=>[row],env:()=>undefined})();
  expect(fetcher).not.toHaveBeenCalled();expect(storage.launch).not.toHaveBeenCalled();
  expect(storage.finish).toHaveBeenCalledWith(job,expect.arrayContaining([expect.objectContaining({itemKey:'x:123456789'})]),expect.objectContaining({retrieval:'native',accepted:1}),0,true);
 });
 it('retains known-run recovery without trying a free route or another POST',async()=>{
  const native=vi.fn(),storage=store({...job,state:'running',provider_run_id:'Run12345'});
  const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>String(input).includes('/datasets/')?Response.json([row]):Response.json({data:{id:'Run12345',actId:configuration.actor_id,userId:configuration.apify_user_id,buildId:configuration.build_id,status:'SUCCEEDED',defaultDatasetId:'Dataset12345',usageTotalUsd:.001}}));
  await createSocialCollector({store:storage,log:testRetrievalLog(),native,fetcher,env:()=> 'fixture-token'})();
  expect(native).not.toHaveBeenCalled();expect(fetcher.mock.calls.every(call=>!(call[1]as RequestInit|undefined)?.method)).toBe(true);
 });
 it('reads and sanitizes Instagram blocked-route diagnostics',async()=>{
  const {socialDiagnostics}=await import('../netlify/functions/_shared/social-collection');
  const report={totals:{requests:6,requestsByQuery:{privateSource:{blocked:3,gated:true}}},queries:[{status:'empty',username:'private-follow-sentinel'}],notes:['private-cookie-sentinel']};
  const output=await socialDiagnostics({...job,platform:'Instagram',config:{...configuration,actor_ref:'yugenox/instagram-post-scraper'}},{defaultKeyValueStoreId:'Store12345'},()=> 'token',async()=>Response.json(report));
  expect(output).toMatchObject({report_present:true,blocked_requests:3,requests:6,empty_targets:1});
  expect(JSON.stringify(output)).not.toContain('private-');
 });
});

describe('paid fallback after free output is unusable',()=>{
 it('runs one reviewed capped profile pull and saves its run reference before the launch log completes',async()=>{
  const pricing={startedAt:'2026-01-01T00:00:00Z',pricingModel:'PAY_PER_EVENT'};
  const config={...configuration,pricing_fingerprint:socialPricingFingerprint(pricing)};
  const target={...job,config},storage=store(target),log=testRetrievalLog();
  const run={id:'RunFallback123',actId:config.actor_id,userId:config.apify_user_id,buildId:config.build_id,status:'SUCCEEDED',defaultDatasetId:'Dataset12345',usageTotalUsd:.002};
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes('/datasets/'))return Response.json([row]);
   if(url.includes('/actor-runs/')||init?.method==='POST')return Response.json({data:run});
   if(url.includes('/actor-builds/'))return Response.json({data:{id:config.build_id,actId:config.actor_id,buildNumber:config.build_number,status:'SUCCEEDED'}});
   if(url.includes('/users/me'))return Response.json({data:{id:config.apify_user_id}});
   return Response.json({data:{id:config.actor_id,username:'xquik',name:'x-tweet-scraper',pricingInfos:[pricing]}});
  });
  await createSocialCollector({store:storage,log,native:async()=>[],fetcher,env:()=> 'fixture-token'})();
  const posts=fetcher.mock.calls.filter(call=>call[1]?.method==='POST');expect(posts).toHaveLength(1);
  expect(new URL(String(posts[0][0])).searchParams.get('maxTotalChargeUsd')).toBe('0.05');
  expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({mode:'profileTweets',twitterHandles:['source'],maxItems:20});
  expect(storage.run).toHaveBeenCalledWith(target,run.id,run.defaultDatasetId);
  const completedLaunch=vi.mocked(log.finish).mock.calls.findIndex(call=>call[1].provider_run_id===run.id);
  expect(vi.mocked(storage.run).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(log.finish).mock.invocationCallOrder[completedLaunch]);
  expect(storage.finish).toHaveBeenCalledWith(target,expect.anything(),expect.objectContaining({retrieval:'apify',accepted:1}),.002,true);
 });
});

describe('provider-only Instagram speech contract', () => {
 const instagram: SocialJob = { ...job, platform: 'Instagram', source_key: 'instagram.com/source', source_url: 'https://www.instagram.com/source/', config: { ...configuration, platform: 'Instagram', actor_ref: 'apify/instagram-reel-scraper' } };
 const reel = { url: 'https://www.instagram.com/reel/AbCd123/', shortCode: 'AbCd123', ownerUsername: 'source', timestamp: row.createdAt, caption: 'Brief caption.', transcript: 'The speech discusses a different important result.' };
 it('normalizes speech from only the explicit reviewed Reel route, preserving the caption and coverage gap', () => {
  const accepted = normalizeSocialDataset(instagram, [reel]);
  expect(accepted.items[0].record).toMatchObject({ contentKind: 'feed_text', contentProvenance: { primaryKind: 'speech_transcript', complete: false, parts: [{ kind: 'post_caption', text: reel.caption }, { kind: 'speech_transcript', text: reel.transcript }] } });
  expect(accepted.items[0].record.content).toContain(reel.transcript);
  expect(accepted.items[0].record.coverage).toContain('visual content and completeness are not verified');
  const legacy = normalizeSocialDataset({ ...instagram, config: { ...instagram.config, actor_ref: 'yugenox/instagram-post-scraper' } }, [reel]);
  expect(legacy.items[0].record.content).toBe(reel.caption);
  expect(legacy.items[0].revision).not.toBe(accepted.items[0].revision);
 });
 it('rejects malformed speech as a contract error without silently returning only the available caption', () => {
  const output = normalizeSocialDataset(instagram, [{ ...reel, transcript: { text: 'Unexpected schema.' } }]);
  expect(output.items).toEqual([]); expect(output.coverage).toMatchObject({ complete: false, rejected: { provider_content_schema_changed: 1 } });
 });
 it('makes transcription a separate opt-in and disables media downloads and share-count add-ons', () => {
  expect(socialActorInput(instagram)).toMatchObject({ username: [instagram.source_url], resultsLimit: 20, includeTranscript: false, includeDownloadedVideo: false, includeSharesCount: false });
 });
 it('never uses native Instagram when the provider-only preflight returns an authentication failure', async () => {
  const fakeStore = store(instagram), native = vi.fn(async () => [reel]);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Secret upstream body must not escape.' } }), { status: 401 }));
  await createSocialCollector({ log: testRetrievalLog(), store: fakeStore, native, fetcher, now: () => 0, env: name => name === 'SOURCE_COLLECTION_POLICY' ? 'provider-only-v1' : name === 'APIFY_API_TOKEN' ? 'fixture-token' : undefined })();
  expect(native).not.toHaveBeenCalled(); expect(fakeStore.launch).not.toHaveBeenCalled();
  expect(fakeStore.finish).toHaveBeenCalledWith(instagram, [], expect.objectContaining({ complete: false }), null, false, 'social_provider_authentication_failed');
  expect(JSON.stringify(vi.mocked(fakeStore.finish).mock.calls)).not.toContain('Secret upstream');
 });
});

describe('same-run bounded oversized dataset recovery', () => {
 function scenario(individualOversize = false) {
  const pricing = { startedAt: '2020-01-01T00:00:00Z', pricingModel: 'PAY_PER_EVENT' };
  const config = { ...configuration, platform: 'Instagram' as const, actor_ref: 'apify/instagram-reel-scraper', max_items: 2, maximum_usd: .01, pricing_fingerprint: socialPricingFingerprint(pricing) };
  const current: SocialJob = { ...job, platform: 'Instagram', source_key: 'instagram.com/source', source_url: 'https://www.instagram.com/source/', config };
  const first = { url: 'https://www.instagram.com/reel/AbCd123/', shortCode: 'AbCd123', ownerUsername: 'source', timestamp: row.createdAt, caption: 'First complete caption.', transcript: 'First complete speech.', largeUnusedMetadata: 'x'.repeat(individualOversize ? 2 * 1024 * 1024 + 1 : 1150_000) };
  const second = { ...first, url: 'https://www.instagram.com/reel/Other123/', shortCode: 'Other123', caption: 'Second complete caption.', transcript: 'Second complete speech.' };
  const run = { id: 'Run12345', actId: config.actor_id, userId: config.apify_user_id, buildId: config.build_id, defaultDatasetId: 'Dataset12345', status: 'SUCCEEDED', usageTotalUsd: .006 };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
   const url = new URL(String(input));
   expect(url.hostname).toBe('api.apify.com');
   if (url.pathname.endsWith('/users/me')) return new Response(JSON.stringify({ data: { id: config.apify_user_id } }));
   if (url.pathname.includes('/actor-builds/')) return new Response(JSON.stringify({ data: { id: config.build_id, actId: config.actor_id, buildNumber: config.build_number, status: 'SUCCEEDED' } }));
   if (url.pathname.endsWith('/acts/' + config.actor_id)) return new Response(JSON.stringify({ data: { id: config.actor_id, username: 'apify', name: 'instagram-reel-scraper', pricingInfos: [pricing] } }));
   if (url.pathname.includes('/datasets/')) {
    const offset = url.searchParams.get('offset');
    return new Response(JSON.stringify(offset === null ? [first, second] : offset === '0' ? [first] : offset === '1' ? [second] : []));
   }
   if (init?.method === 'POST') expect(JSON.parse(String(init.body))).toMatchObject({ includeTranscript: true, includeDownloadedVideo: false });
   return new Response(JSON.stringify({ data: run }));
  });
  const fakeStore = store(current), native = vi.fn(async () => []);
  return { fetcher, fakeStore, native, current, run: () => createSocialCollector({ log: testRetrievalLog(), store: fakeStore, native, fetcher, now: () => Date.parse('2026-10-31T01:00:00Z'), env: name => name === 'SOURCE_COLLECTION_POLICY' ? 'provider-only-v1' : name === 'INSTAGRAM_REEL_SPEECH_ENABLED' ? 'true' : name === 'APIFY_API_TOKEN' ? 'fixture-token' : undefined })() };
 }
 it('reads complete fixed-offset records from the same accepted dataset without buying the source again', async () => {
  const value = scenario(); await value.run();
  expect(value.native).not.toHaveBeenCalled();
  expect(value.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  const datasetReads = value.fetcher.mock.calls.filter(([url]) => String(url).includes('/datasets/')).map(([url]) => new URL(String(url)));
  expect(datasetReads.map(url => url.searchParams.get('offset'))).toEqual([null, '0', '1', '2']);
  const call = vi.mocked(value.fakeStore.finish).mock.calls.at(-1)!;
  expect(call[1]).toHaveLength(2); expect(call[3]).toBe(.006); expect(call[4]).toBe(true);
  expect(call[1][0].record.content).toContain('First complete speech.');
 });
 it('keeps an oversized single original pending and never truncates, retries its POST or imports partial text', async () => {
  const value = scenario(true); await value.run();
  expect(value.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(value.fakeStore.finish).toHaveBeenLastCalledWith(value.current, [], expect.objectContaining({ complete: false, reason: 'reconciliation_required' }), null, false, 'response_too_large');
 });
});
