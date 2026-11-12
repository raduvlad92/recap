import {offlineProviderMetadata} from './helpers/provider-metadata';
import {describe,it,expect,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {createAnalysisStore,createAnalysisWorker,type AnalysisCall,type AnalysisClaim,type AnalysisStore} from '../netlify/functions/_shared/content-analysis';
import {ANALYSIS_V3_CONTRACT_HASH} from '../netlify/functions/_shared/content-analysis-grounded-v3-protocol';
import type {AnalysisGenerator,AnalysisLimits,GenerationRequest,GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
const content='Nvidia improved rendering. The saved benchmark rose from 30 to 45 frames per second.';
const record:SourceUpdate={id:'synthetic-update',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic benchmark',summary:'Description',url:'https://example.org/video',publishedAt:'2026-10-25T00:00:00Z',format:'video',isSample:true,topics:[],brands:[],sponsors:[],references:[],insights:[],contentKind:'transcript',content,transcriptSegments:[{text:content,startSeconds:7,durationSeconds:8}]};
const limits:AnalysisLimits={model:'fixture/model',pricingVersion:'fixture-v1',chunkChars:12000,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,maxCallUsd:.01};
const env=(key:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_MODEL:limits.model} as Record<string,string>)[key];
const markerTransport=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../netlify/functions/_shared/admin-data',()=>({database:()=>({rpc:markerTransport.rpc})}));
function claim():AnalysisClaim{return {job:{id:'synthetic-job',user_id:'synthetic-owner',update_id:record.id,source_id:record.sourceId,content_hash:contentHash(content),task:'summary',state:'running',result:null,rule_version:'content-v3',generation_contract_hash:ANALYSIS_V3_CONTRACT_HASH,generation_predecessor_job_id:'synthetic-predecessor'},record,leaseToken:'synthetic-lease',generationContext:{protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,predecessorJobId:'synthetic-predecessor',emptyDisposition:'findings_expected',sourceReviewDigest:'a'.repeat(64)}};}
/** Simulate JSONB's order-changing roundtrip, including nested invalid output. */
function persisted<T>(value:T):T{return JSON.parse(JSON.stringify(value,(_key,value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.length-b.length||a.localeCompare(b))):value));}
function fixture(initial:AnalysisClaim[]){
 const queue=[...initial],calls=new Map<string,AnalysisCall>();
 const store:AnalysisStore={policies:vi.fn(async()=>[{user_id:'synthetic-owner',enabled:true,model:limits.model}]),sync:vi.fn(async()=>({synchronized:0})),claim:vi.fn(async()=>queue.shift()||null),
 cachedCalls:vi.fn<NonNullable<AnalysisStore['cachedCalls']>>(async(_claim,keys,after)=>({calls:keys.filter(key=>calls.has(key)&&(after===null||key>after)).sort().map(key=>persisted(calls.get(key)!)),nextAfterKey:null})),
 reserve:vi.fn(async(_claim,request,maximum,model,execution_identity,request_hash)=>{const existing=calls.get(request.key);if(existing)return {claimed:false,call:persisted(existing)};const call:AnalysisCall={id:request.key,call_key:request.key,maximum_usd:maximum,model,execution_identity,request_hash,actual_usd:null,state:'reserved'};calls.set(request.key,call);return {claimed:true,call};}),
 saveCall:vi.fn(async(call,_claim,result)=>{const row=persisted({...call,result,actual_usd:result.actualUsd??null,state:result.actualUsd==null?'unknown':'settled'});calls.set(call.call_key!,row);return row;}),
 markInvalid:vi.fn(async(_claim,call,_hash,error)=>{const row={...calls.get(call.call_key!)!,validation_error_code:error};calls.set(call.call_key!,row);return row;}),
 recordRejection:vi.fn(async()=>({retryEligible:false as const,retryAt:'2026-10-25T00:00:00Z'})),prepare:vi.fn(async()=>{}),publish:vi.fn(async()=>true),fail:vi.fn(async()=>{})};
 return {queue,calls,store};
}
function valid(request:GenerationRequest):GenerationResult{
 let p=JSON.parse(request.prompt);if(request.correction)p=p.originalRequest;
 return {actualUsd:.0001,observedUsd:.0001,value:p.task==='verify_summary'?{readComplete:true,verdicts:p.claims.map((point:{id:string})=>({id:point.id,supported:true,reason:'The exact saved evidence supports this synthetic claim.'}))}:{readComplete:true,lastPassageId:p.requiredLastPassageId,highlights:[{text:'Nvidia improved rendering.',passageIds:[p.passages[0].id]}]}};
}
describe('content-v3 worker trust and persisted repair replay',()=>{
 it.each([false,true])('uses a verifier-only cache window for a %s comparison summary',async comparison=>{
  const c=claim();
  if(comparison){
   c.job.generation_comparison_id='a1000000-0000-4000-8000-000000000001';
   c.generationContext!.comparisonId=c.job.generation_comparison_id;
  }
  const {store}=fixture([c]);
  // Mirror the applied SQL guard through the real store transport. A final
  // semantic verdict is terminal and has no authorized correction call key.
  markerTransport.rpc.mockReset().mockImplementation(async(name,args)=>{
   if(name!=='read_content_analysis_cached_calls_v2')throw new Error('Unexpected RPC');
   return args.p_call_keys.includes('summary:v3:verify:0:repair:1')
    ?{data:null,error:{code:'PT409'}}
    :{data:{calls:[],nextAfterKey:null},error:null};
  });
  store.cachedCalls=createAnalysisStore(env).cachedCalls;
  const generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await createAnalysisWorker({providerMetadata:offlineProviderMetadata,env,limits,store,generate})()).completed).toBe(1);
  const windows=markerTransport.rpc.mock.calls.map(([,args])=>args.p_call_keys);
  expect(windows).toContainEqual(['summary:v3:verify:0']);
  expect(windows.flat()).not.toContain('summary:v3:verify:0:repair:1');
  expect(generate.mock.calls.map(([request])=>request.key)).toEqual(['summary:v3:chunk:0','summary:v3:verify:0']);
  expect(store.prepare).toHaveBeenCalledTimes(1);expect(store.publish).toHaveBeenCalledTimes(1);
  expect(store.fail).not.toHaveBeenCalled();
 });
 it.each(['summary:v3:chunk:0','extractor:v3:chunk:0','checker:v3:chunk:0','summary-reduce:v3:level:0:group:0'])('the real store persists the authorized %s invalid marker',async key=>{
  markerTransport.rpc.mockReset().mockResolvedValue({data:{id:'synthetic-call',call_key:key,validation_error_code:'analysis_incomplete_coverage'},error:null});
  const store=createAnalysisStore(env);
  await store.markInvalid!(claim(),{id:'synthetic-call',call_key:key},'a'.repeat(64),'analysis_incomplete_coverage');
  expect(markerTransport.rpc).toHaveBeenCalledExactlyOnceWith('mark_content_analysis_call_invalid',{p_job_id:'synthetic-job',p_lease_token:'synthetic-lease',p_call_key:key,p_request_hash:'a'.repeat(64),p_error_code:'analysis_incomplete_coverage'});
 });
 it.each(['summary:v3:verify:0','summary:v3:chunk:0:repair:1','summary:v3:chunk:0:repair:2'])('the real store rejects %s marker before its RPC',async key=>{
  markerTransport.rpc.mockReset();
  expect(()=>createAnalysisStore(env).markInvalid!(claim(),{id:'synthetic-call',call_key:key},'a'.repeat(64),'analysis_invalid_output')).toThrow('analysis_invalid_correction');
  expect(markerTransport.rpc).not.toHaveBeenCalled();
 });
 it('the actual worker reaches one fresh repair through the real store marker helper',async()=>{
  const {calls,store}=fixture([claim()]);
  markerTransport.rpc.mockReset().mockImplementation(async(_name,args)=>{const row={...calls.get(args.p_call_key)!,validation_error_code:args.p_error_code};calls.set(args.p_call_key,row);return {data:row,error:null};});
  store.markInvalid=createAnalysisStore(env).markInvalid;
  const reserve=store.reserve;store.reserve=vi.fn<AnalysisStore['reserve']>(async(...args)=>{if(args[1].correction)expect(markerTransport.rpc).toHaveBeenCalledTimes(1);return reserve(...args);});
  const generate=vi.fn<AnalysisGenerator>(async request=>request.key==='summary:v3:chunk:0'?{actualUsd:.0001,observedUsd:.0001,value:{readComplete:false,lastPassageId:JSON.parse(request.prompt).requiredLastPassageId,highlights:[]}}:valid(request));
  expect((await createAnalysisWorker({providerMetadata:offlineProviderMetadata,env,limits,store,generate})()).completed).toBe(1);
  expect(markerTransport.rpc).toHaveBeenCalledTimes(1);expect(generate).toHaveBeenCalledTimes(3);expect(calls.size).toBe(3);expect(store.publish).toHaveBeenCalledTimes(1);
 });
 it('resumes a nested multi-field repaired summary after JSONB reordering without changing either paid request hash',async()=>{
  const {queue,calls,store}=fixture([claim()]);let clock=0,saved=0;
  const save=store.saveCall;store.saveCall=vi.fn<AnalysisStore['saveCall']>(async(...args)=>{const row=await save(...args);if(++saved===2)clock=551000;return row;});
  const generate=vi.fn<AnalysisGenerator>(async request=>request.key==='summary:v3:chunk:0'?{actualUsd:.0001,observedUsd:.0001,value:{readComplete:false,lastPassageId:JSON.parse(request.prompt).requiredLastPassageId,highlights:[]}}:valid(request));
  const worker=createAnalysisWorker({providerMetadata:offlineProviderMetadata,store,env,limits,generate,now:()=>clock});
  expect((await worker()).yielded).toBe(1);expect(calls.size).toBe(2);expect(store.publish).not.toHaveBeenCalled();
  const old=new Map([...calls].map(([key,row])=>[key,JSON.stringify(row)]));queue.push(claim());
  expect((await worker()).completed).toBe(1);expect(calls.size).toBe(3);expect(generate).toHaveBeenCalledTimes(3);expect(store.markInvalid).toHaveBeenCalledTimes(1);
  for(const [key,row] of old)expect(JSON.stringify(calls.get(key))).toBe(row);
  expect(vi.mocked(store.fail).mock.calls.every(([,code])=>code!=='analysis_cached_input_changed')).toBe(true);
  expect(store.prepare).toHaveBeenCalledTimes(1);expect(store.publish).toHaveBeenCalledTimes(1);
 });
 it.each(['missing-context','wrong-hash','wrong-predecessor','bad-disposition'] as const)('rejects %s before prepare, cache, reservation or generation',async variant=>{
  const c=claim();c.job.state='prepared';c.job.result={state:'ready',patch:{},pending:[],evidence:{}};
  if(variant==='missing-context')delete c.generationContext;
  if(variant==='wrong-hash')c.generationContext!.generationContractHash='b'.repeat(64);
  if(variant==='wrong-predecessor')c.generationContext!.predecessorJobId='another-predecessor';
  if(variant==='bad-disposition')c.generationContext!.emptyDisposition='self-approved' as never;
  const {store}=fixture([c]),generate=vi.fn<AnalysisGenerator>();
  expect((await createAnalysisWorker({providerMetadata:offlineProviderMetadata,store,env,limits,generate})()).blocked).toBe(1);
  for(const fn of [store.cachedCalls,store.reserve,store.prepare,store.publish,generate])expect(fn).not.toHaveBeenCalled();
  expect(store.fail).toHaveBeenCalledWith(c,'analysis_generation_contract_changed',false,false);
 });
 it('reports an unreviewed or substantive-source empty as failed without publishing a no-finding conclusion',async()=>{
  const c=claim(),{store}=fixture([c]);
  const generate=vi.fn<AnalysisGenerator>(async request=>({actualUsd:.0001,observedUsd:.0001,value:{readComplete:true,lastPassageId:JSON.parse(request.prompt).requiredLastPassageId,highlights:[]}}));
  expect((await createAnalysisWorker({providerMetadata:offlineProviderMetadata,store,env,limits,generate})()).failed).toBe(1);
  expect(store.prepare).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();expect(store.fail).toHaveBeenCalledWith(c,'analysis_summary_omission',false,false);
 });
});
