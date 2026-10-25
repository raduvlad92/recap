import {describe,it,expect,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {ANALYSIS_CACHE_PAGE_BYTES,createAnalysisWorker,durableGenerationResult,type AnalysisCall,type AnalysisClaim,type AnalysisStore} from '../netlify/functions/_shared/content-analysis';
import {AnalysisError,type AnalysisGenerator,type AnalysisLimits,type GenerationRequest,type GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
import {analysisV2CallPlan,planAnalysisV2Chunks} from '../netlify/functions/_shared/content-analysis-engine';
const content='The GPU benchmark improved from 30 to 45 frames per second.';
const record:SourceUpdate={id:'fixture',sourceId:'source',contributorIds:[],title:'Synthetic',summary:'Description',url:'https://example.org/fixture',publishedAt:'2026-10-25T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],contentKind:'transcript',content,isSample:true,videoFormat:{kind:'regular',basis:'provider'},transcriptSegments:[{startSeconds:17,text:content,durationSeconds:3}]};
const limits:AnalysisLimits={model:'fixture/model',pricingVersion:'fixture-v1',chunkChars:12000,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,maxCallUsd:.01};
const env=(name:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_MODEL:limits.model} as Record<string,string>)[name];
const makeClaim=():AnalysisClaim=>({job:{id:'job',user_id:'owner',update_id:record.id,source_id:record.sourceId,content_hash:contentHash(content),task:'summary',state:'running',result:null,rule_version:'content-v2'},record,leaseToken:'lease'});
function setup(claims:AnalysisClaim[]){
 const calls=new Map<string,AnalysisCall>();
 const store:AnalysisStore={policies:vi.fn(async()=>[{user_id:'owner',enabled:true,model:limits.model}]),sync:vi.fn(async()=>({synchronized:1})),claim:vi.fn(async()=>claims.shift()||null),
  reserve:vi.fn(async(_claim,request,_max,model,identity,hash)=>{if(calls.has(request.key))return {claimed:false,call:calls.get(request.key)};const call:AnalysisCall={id:request.key,call_key:request.key,model,execution_identity:identity,request_hash:hash,state:'reserved',actual_usd:null};calls.set(request.key,call);return {claimed:true,call};}),
  saveCall:vi.fn(async(call,_claim,result)=>{const row={...call,result,state:result.actualUsd==null?'unknown':'settled',actual_usd:result.actualUsd??null};calls.set(call.call_key!,row);return row;}),
  markInvalid:vi.fn(async(_claim,call,_hash,code)=>{const row={...calls.get(call.call_key!)!,validation_error_code:code};calls.set(call.call_key!,row);return row;}),
  recordRejection:vi.fn(async()=>({retryEligible:false as const,retryAt:'2026-10-25T00:00:00Z'})),prepare:vi.fn(async()=>{}),publish:vi.fn(async()=>true),fail:vi.fn(async()=>{})};
 return {store,calls};
}
function valid(request:GenerationRequest):GenerationResult {
 let p=JSON.parse(request.prompt);if(request.correction)p=p.originalRequest;
 const value=p.task==='verify_summary'?{readComplete:true,verdicts:p.claims.map((c:{id:string})=>({id:c.id,supported:true,reason:'The synthetic saved evidence supports the measured comparison.'}))}:{readComplete:true,lastPassageId:p.requiredLastPassageId,highlights:[{text:'The GPU benchmark improved from 30 to 45 frames per second.',passageIds:[p.passages[0].id]}]};
 return {value,actualUsd:.0001,observedUsd:.0001};
}
function bulkCache(store:AnalysisStore,calls:Map<string,AnalysisCall>,pageSize=64){
 store.cachedCalls=vi.fn<NonNullable<AnalysisStore['cachedCalls']>>(async(_claim,keys,after)=>{
  const remaining=keys.filter(key=>(after===null||key>after)&&calls.has(key)).sort(),selected=remaining.slice(0,pageSize);
  return {calls:selected.map(key=>calls.get(key)!),nextAfterKey:remaining.length>selected.length?selected.at(-1)!:null};
 });
 return vi.mocked(store.cachedCalls);
}
describe('content-v2 worker and durable correction integration',()=>{
 it('finishes 800 chunks after a 1599-result prefix at ten enabled owners and 500ms per RPC, using 50 bounded cache pages',async()=>{
  const lim={...limits,chunkChars:1000},source='Nvidia makes a GPU. '+'Saved original words. '.repeat(24000);
  const full=planAnalysisV2Chunks(source,{...lim,maxChunks:2000},'keywords'),text=source.slice(0,full[799].end);
  expect(analysisV2CallPlan(text,lim).keywordChunks).toBe(800);
  const c={...makeClaim(),job:{...makeClaim().job,task:'keywords' as const,content_hash:contentHash(text)},record:{...record,content:text,transcriptSegments:[]}};
  const queue=[c],{store,calls}=setup(queue);let clock=0,seed=true,saved=0;
  const save=store.saveCall;store.saveCall=vi.fn<AnalysisStore['saveCall']>(async(...args)=>{const row=await save(...args);if(++saved===1599&&seed)clock=551000;else if(!seed)clock+=500;return row;});
  const generate=vi.fn<AnalysisGenerator>(async r=>{if(!seed)clock+=8000;const p=JSON.parse(r.prompt);return {value:{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates:p.interval.start===0?[{label:'Nvidia',kind:'brand',confidence:90,reason:'Literal synthetic brand.',mention:'Nvidia',passageIds:[p.passages[0].id]}]:[]},actualUsd:.0001,observedUsd:.0001};});
  expect((await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})()).yielded).toBe(1);expect(saved).toBe(1599);
  const cached=bulkCache(store,calls),read=cached.getMockImplementation()!;
  cached.mockImplementation(async(...args)=>{clock+=500;return read(...args);});
  store.policies=vi.fn(async()=>Array.from({length:10},(_,i)=>({user_id:i?'idle-'+i:'owner',enabled:true,model:lim.model})));
  const reserve=store.reserve;store.reserve=vi.fn<AnalysisStore['reserve']>(async(...args)=>{clock+=500;return reserve(...args);});
  const before=new Map([...calls].map(([key,row])=>[key,JSON.stringify(row)])),oldReservations=vi.mocked(reserve).mock.calls.length;
  seed=false;queue.push(c);
  expect((await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})()).completed).toBe(1);
  expect(cached).toHaveBeenCalledTimes(50);expect(store.reserve).toHaveBeenCalledTimes(1);expect(oldReservations).toBe(1599);
  expect(generate).toHaveBeenCalledTimes(1600);expect(saved).toBe(1600);expect(calls.size).toBe(1600);
  expect(cached.mock.calls.every(([,keys])=>keys.length<=64)).toBe(true);
  for(const result of cached.mock.results)expect(Buffer.byteLength(JSON.stringify(await result.value))).toBeLessThanOrEqual(ANALYSIS_CACHE_PAGE_BYTES);
  for(const [key,row] of before)expect(JSON.stringify(calls.get(key))).toBe(row);
 },20000);
 it('finishes an 800-chunk repaired prefix without repeating 799 cached invalidity writes',async()=>{
  const lim={...limits,chunkChars:1000},source='Nvidia makes a GPU. '+'Saved original words. '.repeat(24000);
  const full=planAnalysisV2Chunks(source,{...lim,maxChunks:2000},'keywords'),text=source.slice(0,full[799].end);
  expect(analysisV2CallPlan(text,lim).keywordChunks).toBe(800);
  const c={...makeClaim(),job:{...makeClaim().job,task:'keywords' as const,content_hash:contentHash(text)},record:{...record,content:text,transcriptSegments:[]}};
  const queue=[c],{store,calls}=setup(queue);let clock=0,seed=true,saved=0,stalls=0;
  const save=store.saveCall;store.saveCall=vi.fn<AnalysisStore['saveCall']>(async(...args)=>{if(!seed)clock+=500;const row=await save(...args);if(++saved===1599&&seed)clock=551000;return row;});
  const mark=store.markInvalid!;store.markInvalid=vi.fn<NonNullable<AnalysisStore['markInvalid']>>(async(...args)=>{if(!seed)clock+=500;return mark(...args);});
  const generate=vi.fn<AnalysisGenerator>(async r=>{let p=JSON.parse(r.prompt);if(r.correction)p=p.originalRequest;return {value:r.correction?{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates:p.interval.start===0?[{label:'Nvidia',kind:'brand',confidence:90,reason:'Literal synthetic brand.',mention:'Nvidia',passageIds:[p.passages[0].id]}]:[]}:{readComplete:false},actualUsd:.0001,observedUsd:.0001};});
  expect((await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})()).yielded).toBe(1);expect(saved).toBe(1599);
  const cached=bulkCache(store,calls),read=cached.getMockImplementation()!;cached.mockImplementation(async(...args)=>{clock+=500;return read(...args);});
  store.policies=vi.fn(async()=>Array.from({length:10},(_,i)=>({user_id:i?'idle-'+i:'owner',enabled:true,model:lim.model})));
  const reserve=store.reserve;store.reserve=vi.fn<AnalysisStore['reserve']>(async(...args)=>{clock+=500;return reserve(...args);});
  store.fail=vi.fn(async(_c,code,_retry,yielded)=>({state:yielded&&++stalls>=3?'failed':'queued'}));
  const oldRaw=new Map([...calls].map(([key,row])=>[key,JSON.stringify({result:row.result,actual:row.actual_usd,identity:row.execution_identity,requestHash:row.request_hash})]));
  seed=false;const markers=vi.mocked(store.markInvalid!).mock.calls.length;let completed=false,lastSaved=saved;
  store.fail=vi.fn(async(_c,_code,_retry,yielded)=>{if(yielded){stalls=saved>lastSaved?0:stalls+1;lastSaved=saved;}return {state:stalls>=3?'failed':'queued'};});
  for(let turn=0;turn<64&&!completed;turn++){
   const prior=saved;queue.push(c);const stats=await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})();
   expect(stats.failed).toBe(0);expect(saved).toBeGreaterThan(prior);completed=stats.completed===1;
  }
  expect(completed).toBe(true);expect(saved).toBe(3200);expect(generate).toHaveBeenCalledTimes(3200);expect(calls.size).toBe(3200);
  // Every correction is marked once, including newly reached work after resume.
  expect(vi.mocked(store.markInvalid!).mock.calls.length).toBe(1600);expect(markers).toBe(799);
  for(const [key,raw]of oldRaw){const row=calls.get(key)!;expect(JSON.stringify({result:row.result,actual:row.actual_usd,identity:row.execution_identity,requestHash:row.request_hash})).toBe(raw);}
 },120000);
 it('rotates ten genuinely active owners across bounded invocations using persisted real-claim order',async()=>{
  const {store}=setup([]),owners=Array.from({length:10},(_,i)=>'owner-'+i),served=new Map<string,number>(),published=new Set<string>();
  let clock=0;const claimed:string[]=[];
  store.policies=vi.fn(async()=>owners.slice().sort((a,b)=>(served.get(a)??-1)-(served.get(b)??-1)).map(user_id=>({user_id,enabled:true,model:limits.model})));
  store.claim=vi.fn(async owner=>{if(published.has(owner))return null;served.set(owner,clock);claimed.push(owner);return {...makeClaim(),job:{...makeClaim().job,id:owner,user_id:owner}};});
  store.reserve=vi.fn(async(c,r,_max,model,identity,hash)=>({claimed:true,call:{id:c.job.id+r.key,call_key:r.key,model,execution_identity:identity,request_hash:hash}}));
  store.saveCall=vi.fn(async(row,_claim,result)=>({...row,result,state:'settled',actual_usd:.0001}));
  store.publish=vi.fn(async c=>{published.add(c.job.user_id);return true;});
  const generate:AnalysisGenerator=async r=>{clock+=70000;return valid(r);};
  const run=createAnalysisWorker({env,store,limits,generate,now:()=>clock});
  await run();expect(published.size).toBeLessThan(10);expect(published.size).toBeGreaterThan(0);
  await run();await run();expect(published.size).toBe(10);expect(claimed).toEqual(owners);expect(store.fail).not.toHaveBeenCalled();
 });
 it('reconstructs through bounded optional cache pages and never re-reserves or changes saved raw outputs',async()=>{
  const queue=[makeClaim()],{store,calls}=setup(queue),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  const before=JSON.stringify([...calls]),cached=bulkCache(store,calls,1),reservations=vi.mocked(store.reserve).mock.calls.length;
  queue.push(makeClaim());expect((await createAnalysisWorker({env,store,limits,generate,now:()=>0})()).completed).toBe(1);
  expect(cached).toHaveBeenCalledTimes(2);expect(cached.mock.calls.every(([,keys])=>keys.length<=64)).toBe(true);
  expect(store.reserve).toHaveBeenCalledTimes(reservations);expect(generate).toHaveBeenCalledTimes(2);expect(JSON.stringify([...calls])).toBe(before);
 });
 it('replays an original invalid response and its one settled correction from bulk cache without a new charge',async()=>{
  const queue=[makeClaim()],{store,calls}=setup(queue);
  const generate=vi.fn<AnalysisGenerator>(async r=>r.key==='summary:v2:chunk:0'?{...valid(r),value:{readComplete:false}}:valid(r));
  expect((await createAnalysisWorker({env,store,limits,generate,now:()=>0})()).completed).toBe(1);
  const before=JSON.stringify([...calls]),reservations=vi.mocked(store.reserve).mock.calls.length;
  bulkCache(store,calls,1);queue.push(makeClaim());
  expect((await createAnalysisWorker({env,store,limits,generate,now:()=>0})()).completed).toBe(1);
  expect(generate).toHaveBeenCalledTimes(3);expect(store.reserve).toHaveBeenCalledTimes(reservations);expect(calls.size).toBe(3);
  expect(JSON.stringify([...calls])).toBe(before);expect(store.markInvalid).toHaveBeenCalledTimes(1);
 });
 it.each(['pre-call hash','result hash','call identity','result identity','model'])('blocks bulk cached %s mismatch before reuse',async kind=>{
  const queue=[makeClaim()],{store,calls}=setup(queue),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  const key='summary:v2:chunk:0',base=calls.get(key)!;
  calls.set(key,kind==='pre-call hash'?{...base,request_hash:null}:kind==='result hash'?{...base,result:{...base.result!,requestHash:'0'.repeat(64)}}:kind==='model'?{...base,model:'other'}:kind==='call identity'?{...base,execution_identity:null}:{...base,result:{...base.result!,executionIdentity:{...base.execution_identity!,provider:'other'}}});
  bulkCache(store,calls);queue.push(makeClaim());const prepared=vi.mocked(store.prepare).mock.calls.length;
  expect((await createAnalysisWorker({env,store,limits,generate,now:()=>0})()).blocked).toBe(1);
  expect(store.fail).toHaveBeenLastCalledWith(expect.anything(),'analysis_cached_input_changed',false,false);
  expect(generate).toHaveBeenCalledTimes(2);expect(store.prepare).toHaveBeenCalledTimes(prepared);
 });
 it('bulk replay never promotes a raw cost assertion over an unknown durable charge',async()=>{
  const queue=[makeClaim()],{store,calls}=setup(queue),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  const base=calls.get('summary:v2:chunk:0')!;calls.set(base.call_key!,{...base,state:'unknown',actual_usd:null});
  bulkCache(store,calls);queue.push(makeClaim());const reservations=vi.mocked(store.reserve).mock.calls.length;
  expect((await createAnalysisWorker({env,store,limits,generate,now:()=>0})()).blocked).toBe(1);
  expect(store.fail).toHaveBeenLastCalledWith(expect.anything(),'analysis_unknown_charge_hold',false,false);
  expect(store.reserve).toHaveBeenCalledTimes(reservations);expect(generate).toHaveBeenCalledTimes(2);
 });
 it.each(['analysis_source_changed','analysis_runtime_disabled'])('a denied cache fence %s prevents generation and publication',async code=>{
  const {store}=setup([makeClaim()]),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  store.cachedCalls=vi.fn(async()=>{throw new AnalysisError(code);});
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(generate).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();
 });
 it.each(['oversized','nonadvancing','outside-window'])('rejects %s cache pages with bounded requests and no provider call',async kind=>{
  const {store}=setup([makeClaim()]),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  store.cachedCalls=vi.fn(async(_claim,keys,after)=>kind==='oversized'?{calls:[{id:'oversized',call_key:keys[0],result:{value:'x'.repeat(ANALYSIS_CACHE_PAGE_BYTES),observedUsd:0}}],nextAfterKey:null}:kind==='outside-window'?{calls:[{id:'other',call_key:'outside'}],nextAfterKey:null}:{calls:[{id:'repeat',call_key:keys[0]}],nextAfterKey:after||keys[0]});
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(vi.mocked(store.cachedCalls).mock.calls.length).toBeLessThanOrEqual(2);expect(generate).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();
 });
 it('routes the v2 job through reconstruction and semantic checking, then reuses both paid calls on duplicate delivery',async()=>{
  const {store}=setup([makeClaim(),makeClaim()]),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  const result=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(result.completed).toBe(2);expect(generate).toHaveBeenCalledTimes(2);expect(store.saveCall).toHaveBeenCalledTimes(2);expect(store.markInvalid).not.toHaveBeenCalled();
  expect(vi.mocked(store.prepare).mock.calls[0][1].patch.videoHighlights).toEqual([{text:'The GPU benchmark improved from 30 to 45 frames per second.',startSeconds:17}]);
 });
 it('persists invalid evidence and marks its exact base hash before reserving one correction',async()=>{
  const {store,calls}=setup([makeClaim()]);
  const generate=vi.fn<AnalysisGenerator>(async r=>r.key==='summary:v2:chunk:0'?{...valid(r),value:{readComplete:true,lastPassageId:'untrusted',highlights:[]}}:valid(r));
  const result=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(result.completed).toBe(1);expect(generate).toHaveBeenCalledTimes(3);expect(store.markInvalid).toHaveBeenCalledTimes(1);
  expect(calls.get('summary:v2:chunk:0')?.result?.value).toMatchObject({lastPassageId:'untrusted'});
  const marker=vi.mocked(store.markInvalid!).mock.calls[0];expect(marker[1].call_key).toBe('summary:v2:chunk:0');expect(marker[2]).toMatch(/^[a-f0-9]{64}$/);expect(marker[3]).toBe('analysis_incomplete_coverage');
  expect(vi.mocked(store.saveCall).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(store.markInvalid!).mock.invocationCallOrder[0]);
  expect(vi.mocked(store.markInvalid!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(store.reserve).mock.invocationCallOrder[1]);
 });
 it('does not authorize correction from materialized output with unknown durable cost',async()=>{
  const {store}=setup([makeClaim()]),generate=vi.fn<AnalysisGenerator>(async()=>({value:{readComplete:false},actualUsd:null,observedUsd:0}));
  const result=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(1);expect(store.markInvalid).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_correction_charge_unknown',false,false);
 });
 it('blocks the next separately charged key when usable saved output has an unknown durable bill, then replays it after settlement',async()=>{
  const claims=[makeClaim()],{store,calls}=setup(claims);
  const generate=vi.fn<AnalysisGenerator>(async r=>r.key==='summary:v2:chunk:0'?{...valid(r),actualUsd:null}:valid(r));
  const result=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(1);expect(store.reserve).toHaveBeenCalledTimes(1);
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_unknown_charge_hold',false,false);expect(store.publish).not.toHaveBeenCalled();
  const base=calls.get('summary:v2:chunk:0')!;calls.set(base.call_key!,{...base,state:'settled',actual_usd:.0001});claims.push(makeClaim());
  const resumed=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(resumed.completed).toBe(1);expect(generate).toHaveBeenCalledTimes(2);expect(calls.size).toBe(2);
 });
 it('does not promote a raw cached cost assertion or a missing pre-call hash in a content-v2 job',async()=>{
  const queue=[makeClaim()],{store,calls}=setup(queue),generate=vi.fn<AnalysisGenerator>(async r=>valid(r));
  await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  const base=calls.get('summary:v2:chunk:0')!;calls.set(base.call_key!,{...base,request_hash:null});queue.push(makeClaim());
  const result=await createAnalysisWorker({env,store,limits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(2);expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_cached_input_changed',false,false);
  expect(durableGenerationResult({id:'x',state:'unknown',actual_usd:null},{value:{},actualUsd:0,observedUsd:0}).actualUsd).toBeNull();
 });
 it.each([0,.1,'0.1'])('accepts only an explicitly settled durable cost: %j',actual=>{
  expect(durableGenerationResult({id:'x',state:'settled',actual_usd:actual},{value:{},actualUsd:null,observedUsd:0}).actualUsd).toBe(Number(actual));
 });
 it('plans the actual saved long-source capacity without increasing a single-call or cumulative allowance',()=>{
  const plan=analysisV2CallPlan('Synthetic complete source words. '.repeat(7237),limits);
  expect(plan.keywordChunks).toBeGreaterThan(90);expect(plan.keywordChunks).toBeLessThanOrEqual(800);expect(limits.maxCallUsd).toBe(.01);
 });
});
