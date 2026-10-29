import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHourlyCollector, type HourlyClaim, type HourlyStore, type StoredProviderJob } from '../netlify/functions/_shared/hourly-collection';
import { pollStoredApify, YOUTUBE_ACTOR_ID } from '../netlify/functions/_shared/apify';
import type { finishJob } from '../netlify/functions/_shared/job-ledger';
import type { Source, SourceUpdate } from '../src/lib/types';

const base = Date.parse('2026-10-25T12:00:00Z');
const user = 'synthetic-owner';
const source: Source = { id:'synthetic-source', name:'Synthetic', platform:'YouTube', url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', creatorIds:[], status:'ready' };
const policy = { user_id:user, enabled:true, provider_enabled:false, daily_limit_usd:.1, lifetime_limit_usd:1 };
const values: Record<string,string> = { HOURLY_COLLECTION_ENABLED:'true', APIFY_RUNTIME_ENABLED:'true', APIFY_API_TOKEN:'synthetic-only', COLLECTION_JOB_SECRET:'synthetic-only-secret-over-thirty-two-characters', APIFY_YOUTUBE_BUILD:'0.0.319', APIFY_YOUTUBE_BUILD_ID:'SyntheticBuild1', APIFY_MAX_ITEMS:'1', APIFY_MAX_TOTAL_CHARGE_USD:'0.005', COLLECTION_ALLOWED_USER_IDS:user };
const record = (i: number, src=source): SourceUpdate => ({ id:'synthetic-update-'+i, sourceId:src.id, title:'Synthetic', summary:'Synthetic', url:'https://www.youtube.com/watch?v='+String(i).padStart(11,'0'), publishedAt:'2026-10-22T12:00:00Z', contributorIds:[], topics:[], brands:[], sponsors:[], references:[], insights:[], format:'video', isSample:false, contentKind:'metadata_only' });
const claim = (src=source, queue: unknown[]=[]): HourlyClaim => ({ source:src, checkId:'11111111-1111-4111-8111-111111111111', leaseToken:'22222222-2222-4222-8222-222222222222', state:{ user_id:user, source_id:src.id, fingerprint:'synthetic-fingerprint', collection_id:'synthetic', channel_id:'UCabcdefghijklmnopqrstuv', feed_url:null, etag:null, last_modified:null, content_hash:null, initialized_at:'2026-10-22T12:00:00Z', workspace_revision:'synthetic-revision', cursor:{}, pending_captions:queue as never } });
const job = (i:number, src=source): StoredProviderJob & { servicedAt?:number } => ({ id:'synthetic-job-'+i, user_id:user, source_id:src.id, item_key:'youtube:'+String(i).padStart(11,'0'), job_id:'44444444-4444-4444-8444-444444444444', check_id:claim().checkId, reservation_id:'33333333-3333-4333-8333-333333333333', actor_id:YOUTUBE_ACTOR_ID, maximum_usd:.005, provider_run_id:'SyntheticRun'+i, job_token:null, state:'running', actual_cost_usd:null, source_fingerprint:'synthetic-fingerprint', discard_result:false, content_pending:true });
const queue = (count:number) => Array.from({length:count},(_,i)=>({record:record(i+1),attempts:0,nextAttemptAt:new Date(0).toISOString()}));
function setup(tasks:unknown[]=[]) {
 const c=claim(source,tasks);
 const store: HourlyStore = { policies:vi.fn(async()=>[policy]), schedule:vi.fn(async()=>[{user_id:user,source_id:source.id}]), workspace:vi.fn(async()=>null), claim:vi.fn(async()=>c), seen:vi.fn(async()=>new Set<string>()), pending:vi.fn(async()=>[]), serviced:vi.fn(async()=>{}), providerClaimed:vi.fn(async()=>false), jobCost:vi.fn(async()=>null), finish:vi.fn(async()=>({retrievedCount:0,importAccepted:true})), reserve:vi.fn(async()=>{throw Error('RESERVATION_FORBIDDEN')}), providerPatch:vi.fn(async()=>{}) };
 const forbidden=vi.fn(async()=>{throw Error('PROVIDER_START_FORBIDDEN')});
 const deps={ env:(k:string)=>values[k],store, download:vi.fn(async()=>({text:'',url:source.url,status:304,contentType:'application/xml'})), captions:vi.fn(async()=>null), startApify:forbidden as never, preflight:forbidden, startJob:forbidden as never, finishJob:vi.fn<typeof finishJob>(async()=>{}), settleBudget:vi.fn(async()=>({}) as never), pollApify:vi.fn(async()=>({status:'running'})) as ReturnType<typeof vi.fn<typeof pollStoredApify>>, pause:vi.fn(async()=>{}), now:()=>Date.now() };
 return {store,deps,c,run:()=>createHourlyCollector(deps)(),patch:()=>vi.mocked(store.finish).mock.calls.at(-1)![1]};
}
afterEach(()=>vi.useRealTimers());
describe('D38 four exact synthetic caption-recovery reproducers, corrected behavior',()=>{
 it('F1 touches all 100 no-run holds and reaches job 101 across fresh collector invocations without removing any hold or POST',async()=>{
  const t=setup(), jobs=Array.from({length:100},(_,i)=>({...job(i+1),state:'ambiguous' as const,provider_run_id:null})).concat([job(101) as never]);
  let service=0;
  t.store.pending=async()=>[...jobs].sort((a,b)=>(a.servicedAt??-Infinity)-(b.servicedAt??-Infinity)).slice(0,100);
  t.store.serviced=async(_c,id)=>{jobs.find(j=>j.id===id)!.servicedAt=++service;};
  for(let i=0;i<3;i++)await t.run();
  expect(t.deps.pollApify).toHaveBeenCalled();
  expect(t.deps.pollApify).toHaveBeenCalledWith(expect.objectContaining({providerRunId:'SyntheticRun101'}),user,expect.any(Function));
  expect(jobs).toHaveLength(101);expect(jobs.every(j=>j.actual_cost_usd===null)).toBe(true);
  expect(t.deps.settleBudget).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({terminal:false,actualUsd:null}),expect.any(Function));
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('F2 shares exactly twenty attempts across changed-feed passes, preserves forty tasks, and retains the 304 control',async()=>{
  vi.useFakeTimers();vi.setSystemTime(base);
  const t=setup(queue(40));
  t.deps.download.mockResolvedValue({text:'<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId></feed>',url:source.url,status:200,contentType:'application/atom+xml'});
  await t.run();expect(t.deps.captions).toHaveBeenCalledTimes(20);
  expect(t.patch()).toMatchObject({status:'partial',details:{deferredCount:20}});
  expect(t.patch().pending_captions).toHaveLength(40);
  const control=setup(queue(40));await control.run();expect(control.deps.captions).toHaveBeenCalledTimes(20);
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('F3 rotates all 39 slow sources and stored recovery durably over six restarted runs, across a slow first owner',async()=>{
  vi.useFakeTimers();vi.setSystemTime(base);
  const sources=Array.from({length:39},(_,i)=>({...source,id:'synthetic-source-'+i}));
  const t=setup(),due=new Map<string,number>(),started=new Map<string,number>(),visited=new Set<string>(),polled=new Set<string>();
  const owners=sources.map((s,i)=>({user_id:i<30?user:'synthetic-later-owner',source_id:s.id}));
  t.store.policies=async()=>[policy,{...policy,user_id:'synthetic-later-owner'}];
  t.store.schedule=async()=>[...owners].filter(e=>(due.get(e.source_id)||0)<=Date.now()).sort((a,b)=>(started.get(a.source_id)??-Infinity)-(started.get(b.source_id)??-Infinity));
  t.store.claim=async(uid,id)=>{if((due.get(id)||0)>Date.now())return null;started.set(id,Date.now());visited.add(id);const c=claim(sources.find(s=>s.id===id)!);c.state.user_id=uid;return c;};
  t.store.pending=async(c)=>Array.from({length:100},(_,i)=>job(i+1,c.source));
  t.store.finish=async(c)=>{due.set(c.source.id,Date.now()+55*60_000);return {retrievedCount:0,importAccepted:true};};
  t.deps.download.mockImplementation(async()=>{await new Promise(r=>setTimeout(r,8000));return {text:'',url:source.url,status:304,contentType:'application/xml'};});
  t.deps.pollApify.mockImplementation(async(j)=>{polled.add(j.source.id);await new Promise(r=>setTimeout(r,10000));return {status:'running'};});
  for(let turn=0;turn<6;turn++){vi.setSystemTime(base+turn*3600_000);const running=t.run();await vi.runAllTimersAsync();await running;}
  expect(visited.size).toBe(39);expect(polled.size).toBe(39);expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('F4 settles the validated terminal fee after oversized datasets, retains unread GET-only content, then accepts bounded original without another POST',async()=>{
  const t=setup([{record:record(1),attempts:1,nextAttemptAt:'2099-01-01T00:00:00Z'}]),j=job(1);
  t.store.pending=async()=>[j];t.store.providerPatch=async(_id,patch)=>{Object.assign(j,patch);};
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).includes('actor-runs/')?new Response(JSON.stringify({data:{id:j.provider_run_id,actId:YOUTUBE_ACTOR_ID,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',defaultDatasetId:'SyntheticDataset1',usageTotalUsd:.004}})):new Response(JSON.stringify([{url:record(1).url,date:record(1).publishedAt,title:'Synthetic',text:'x'.repeat(2*1024*1024)}])));
  t.deps.pollApify.mockImplementation((j,u,e)=>pollStoredApify(j,u,e,fetcher));
  await t.run();await t.run();expect(fetcher).toHaveBeenCalledTimes(4);
  expect(t.deps.settleBudget).toHaveBeenCalledWith(expect.any(String),{terminal:true,actualUsd:.004,providerRunId:'SyntheticRun1'},expect.any(Function));
  expect(j).toMatchObject({state:'completed',actual_cost_usd:.004,content_pending:true});
  expect(t.patch()).toMatchObject({status:'partial',details:{captionStatus:'response_too_large'}});
  expect(vi.mocked(t.store.finish).mock.calls.every(c=>c[2].length===0)).toBe(true);
  fetcher.mockImplementation(async(url)=>String(url).includes('actor-runs/')?new Response(JSON.stringify({data:{id:j.provider_run_id,actId:YOUTUBE_ACTOR_ID,buildId:values.APIFY_YOUTUBE_BUILD_ID,status:'SUCCEEDED',defaultDatasetId:'SyntheticDataset1',usageTotalUsd:.004}})):new Response(JSON.stringify([{url:record(1).url,date:record(1).publishedAt,title:'Synthetic',subtitles:[{srt:'1\n00:00:01,000 --> 00:00:03,000\nExisting bounded original caption'}]}])));
  await t.run();expect(j.content_pending).toBe(false);expect(t.patch().pending_captions).toMatchObject([{record:{content:'Existing bounded original caption'},status:'retry',reason:'video_format_unconfirmed'}]);expect(t.deps.startApify).not.toHaveBeenCalled();
 });
});

describe('caption allowance input and exact identity guards',()=>{
 it.each(['NaN','Infinity','-Infinity','0','-1','1.5'])('validates finite positive integer allowance %s without losing unknown tasks',async(value)=>{
  vi.useFakeTimers();vi.setSystemTime(base);
  const malformed=[{record:record(41),attempts:NaN,nextAttemptAt:'bad'},{unrecognized:'opaque-future-task'},null];
  const t=setup([...queue(40),...malformed]);t.deps.env=k=>k==='HOURLY_COLLECTION_MAX_NEW_VIDEOS'?value:values[k];
  await t.run();expect(t.deps.captions).toHaveBeenCalledTimes(20);expect(t.patch().pending_captions).toHaveLength(43);
  expect((t.patch().pending_captions as unknown[]).slice(-3)).toEqual(malformed);expect(t.patch()).toMatchObject({status:'partial',details:{invalidCaptionTasks:3}});
 });
 it('does not retry duplicate identities across passes even when native retrieval fails and feed repeats them',async()=>{
  vi.useFakeTimers();vi.setSystemTime(base);
  const t=setup([queue(1)[0],queue(1)[0]]);t.deps.download.mockResolvedValue({text:'<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId><entry><yt:videoId>00000000001</yt:videoId><title>Synthetic</title><published>2026-10-22T12:00:00Z</published></entry></feed>',url:source.url,status:200,contentType:'application/xml'});
  await t.run();expect(t.deps.captions).toHaveBeenCalledTimes(1);expect(t.patch().pending_captions).toHaveLength(1);expect(t.deps.startApify).not.toHaveBeenCalled();
 });
});

describe('independent fee and content outcomes',()=>{
 it.each([null,0,.004])('retains unread content and settles only explicit terminal fee %s',async fee=>{
  const t=setup([{record:record(1),attempts:1,nextAttemptAt:'2099-01-01T00:00:00Z'}]),j=job(1);
  t.store.pending=async()=>[j];t.deps.pollApify.mockResolvedValue({status:'completed',contentError:'provider_error',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:fee}});
  await t.run();expect(t.store.providerPatch).toHaveBeenCalledWith(j.id,{state:'completed',actual_cost_usd:fee,content_pending:true});
  expect(t.deps.settleBudget).toHaveBeenCalledWith(j.reservation_id,{terminal:true,actualUsd:fee,providerRunId:j.provider_run_id},expect.any(Function));
  expect(t.patch()).toMatchObject({status:'partial',cost_status:fee===null?'unknown':'provider_reported',observed_cost_usd:fee});
  expect(t.patch().pending_captions).toHaveLength(1);expect(vi.mocked(t.store.finish).mock.calls[0][2]).toEqual([]);expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('reconciles a late fee without erasing accepted result counts or content error metadata',async()=>{
  const t=setup(),j={...job(1),state:'completed' as const,actual_cost_usd:null,content_pending:false,finished_at:'2026-10-24T12:00:00Z'};
  const existing={result_count:7,error_code:'partial_caption_coverage',status:'succeeded'};
  t.store.pending=async()=>[j];
  t.deps.pollApify.mockResolvedValue({status:'completed',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:.004}});
  await t.run();
  const patch=vi.mocked(t.deps.finishJob).mock.calls[0][2];
  expect(patch).toMatchObject({status:'succeeded',observedCostUsd:.004,costStatus:'provider_reported'});
  expect(patch).not.toHaveProperty('resultCount');expect(patch).not.toHaveProperty('errorCode');
  const providerPatch=vi.mocked(t.store.providerPatch).mock.calls.find(([,p])=>p.state==='completed')![1];expect(providerPatch).not.toHaveProperty('finished_at');
  expect({...existing,...('resultCount' in patch?{result_count:patch.resultCount}:{}),...('errorCode' in patch?{error_code:patch.errorCode}:{})}).toEqual(existing);
  expect(t.deps.settleBudget).toHaveBeenCalledWith(j.reservation_id,expect.objectContaining({terminal:true,actualUsd:.004}),expect.any(Function));
  expect(t.deps.pollApify).toHaveBeenCalledWith(expect.objectContaining({feeOnly:true}),user,expect.any(Function));
  expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('preserves an already settled immutable fee if later terminal telemetry becomes unknown',async()=>{
  const t=setup(),j={...job(1),state:'completed' as const,actual_cost_usd:.004,observed_cost_usd:.004,content_pending:true};t.store.pending=async()=>[j];
  t.deps.pollApify.mockResolvedValue({status:'completed',contentError:'response_too_large',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:null}});
  await t.run();expect(t.deps.settleBudget).toHaveBeenCalledWith(j.reservation_id,expect.objectContaining({terminal:true,actualUsd:.004}),expect.any(Function));
  expect(t.store.providerPatch).toHaveBeenCalledWith(j.id,{state:'completed',actual_cost_usd:.004,content_pending:true});
 });
 it('does not rewrite settled fee evidence when a later provider response contradicts it',async()=>{
  const t=setup(),j={...job(1),state:'completed' as const,actual_cost_usd:.004,observed_cost_usd:.004};t.store.pending=async()=>[j];
  t.deps.pollApify.mockResolvedValue({status:'completed',contentError:'response_too_large',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:.005}});
  await t.run();expect(t.deps.settleBudget).not.toHaveBeenCalled();expect(t.store.providerPatch).not.toHaveBeenCalled();expect(t.patch()).toMatchObject({status:'partial',details:{captionStatus:'provider_final_fee_changed'}});
 });
 it.each([{discard_result:true},{source_fingerprint:'changed-source'}])('never imports or fetches discarded/changed-source originals %j',async patch=>{
  const t=setup(),j={...job(1),...patch};t.store.pending=async()=>[j];
  t.deps.pollApify.mockResolvedValue({status:'completed',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:.004}});
  await t.run();expect(t.deps.pollApify).toHaveBeenCalledWith(expect.objectContaining({feeOnly:true}),user,expect.any(Function));expect(vi.mocked(t.store.finish).mock.calls[0][2]).toEqual([]);expect(t.deps.startApify).not.toHaveBeenCalled();
 });
 it('keeps a financially settled unread original eligible when source import CAS rejects the same check',async()=>{
  const t=setup(),j=job(1);t.store.pending=async()=>[j];t.store.finish=async()=>({retrievedCount:0,importAccepted:false});
  t.deps.pollApify.mockResolvedValue({status:'completed',contentError:'response_too_large',telemetry:{ledgerId:j.job_id,providerRunId:j.provider_run_id!,cost:.004}});
  await t.run();expect(t.store.providerPatch).toHaveBeenCalledWith(j.id,{state:'completed',actual_cost_usd:.004,content_pending:true});expect(t.deps.startApify).not.toHaveBeenCalled();
 });
});
