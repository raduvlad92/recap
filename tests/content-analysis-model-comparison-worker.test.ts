import {beforeEach,describe,expect,it,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {createAnalysisStore,createAnalysisWorker,type AnalysisCall,type AnalysisClaim} from '../netlify/functions/_shared/content-analysis';
import {ANALYSIS_V3_CONTRACT_HASH} from '../netlify/functions/_shared/content-analysis-grounded-v3-protocol';
import {ANALYSIS_V4_GENERATION_CONTRACT_HASH} from '../netlify/functions/_shared/content-analysis-grounded-v4-protocol';
import {AnalysisError,type AnalysisGenerator,type GenerationRequest,type GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import type {Env} from '../netlify/functions/_shared/security';

const transport=vi.hoisted(()=>({database:vi.fn()}));
vi.mock('../netlify/functions/_shared/admin-data',()=>({database:transport.database}));
beforeEach(()=>transport.database.mockReset());

const LUNA='openai/gpt-6-luna-pro',DEEPSEEK='deepseek/deepseek-v4.1-flash-1017';
const COMPARISON='a1000000-0000-4000-8000-000000000001';
const OTHER_COMPARISON='a1000000-0000-4000-8000-000000000002';
const content='Nvidia improved rendering. Its synthetic benchmark rose from 30 to 45 frames per second.';
const record:SourceUpdate={id:'synthetic-update',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic comparison fixture',summary:'Metadata is not evidence.',
 url:'https://example.test/synthetic',publishedAt:'2026-10-25T00:00:00Z',format:'video',isSample:true,topics:[],brands:[],sponsors:[],references:[],insights:[],
 contentKind:'transcript',content,videoFormat:{kind:'regular',basis:'provider'},transcriptSegments:[{text:content,startSeconds:7,durationSeconds:8}]};
const env=(overrides:Record<string,string>={}):Env=>key=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_CONFIG_EPOCH:'synthetic-base-epoch',
 // The saved selection must override these stale environment settings.
 CONTENT_ANALYSIS_MODEL:DEEPSEEK,CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'relace',...overrides} as Record<string,string>)[key];
function claim(task:'summary'|'keywords'='summary',comparisonId:string|null|undefined=COMPARISON):AnalysisClaim {
 const suffix=task==='summary'?'1':'2',original=`b1000000-0000-4000-8000-00000000000${suffix}`;
 const predecessor=comparisonId==null?`c1000000-0000-4000-8000-00000000000${suffix}`:original;
 return {job:{id:comparisonId==null?original:`d1000000-0000-4000-8000-00000000000${suffix}`,user_id:'synthetic-owner',update_id:record.id,source_id:record.sourceId,
  content_hash:contentHash(content),task,state:'running',result:null,rule_version:'content-v3',generation_contract_hash:ANALYSIS_V3_CONTRACT_HASH,generation_predecessor_job_id:predecessor,
  ...(comparisonId!==undefined?{generation_comparison_id:comparisonId}:{})},record,leaseToken:'synthetic-lease',generationContext:{protocolVersion:'content-v3',
  generationContractHash:ANALYSIS_V3_CONTRACT_HASH,predecessorJobId:predecessor,emptyDisposition:'findings_expected',sourceReviewDigest:'a'.repeat(64),
  ...(comparisonId!==undefined?{comparisonId}:{})}};
}
/** A recursive JSONB-like roundtrip, including raw invalid model output. */
function jsonb<T>(value:T):T {
 return JSON.parse(JSON.stringify(value,(_key,child)=>child!==null&&typeof child==='object'&&!Array.isArray(child)
  ?Object.fromEntries(Object.entries(child).sort(([a],[b])=>a.length-b.length||a.localeCompare(b))):child));
}
type StoredCall=AnalysisCall&{job_id:string};
type RpcArgs=Record<string,any>;
/** Only the existing RPC transport is mocked. Store, worker, profile and H3 engine are real. */
function fixture(initial:AnalysisClaim[]){
 const queue=[...initial],calls=new Map<string,StoredCall>();
 const state={model:LUNA,revision:23,clock:0,cacheOverride:null as AnalysisCall[]|null,cacheReferences:new Map<string,string[]>(),
  durableCost:(result:GenerationResult):number|null=>result.actualUsd??null,afterSave:()=>{},deniedRpc:null as string|null};
 const callKey=(jobId:string,key:string)=>`${jobId}/${key}`;
 const rpc=vi.fn(async(name:string,args:RpcArgs):Promise<{data:unknown;error:{code:string}|null}>=>{
  if(state.deniedRpc===name)return {data:null,error:{code:'PT403'}};
  let data:unknown;
  switch(name){
   case 'sync_content_analysis_jobs_v2':data={synchronized:0};break;
   case 'claim_content_analysis_job_v2':data=queue.shift()??null;break;
   case 'read_content_analysis_cached_calls_v2':{
    const rows=state.cacheOverride??[...calls.values()].filter(row=>row.job_id===args.p_job_id||state.cacheReferences.get(args.p_job_id)?.includes(row.id));
    data={calls:rows.filter(row=>args.p_call_keys.includes(row.call_key)&&(!args.p_after_key||row.call_key!>args.p_after_key))
     .sort((a,b)=>a.call_key!.localeCompare(b.call_key!)),nextAfterKey:null};break;
   }
   case 'reserve_content_analysis_call_v3':{
    const key=callKey(args.p_job_id,args.p_call_key),existing=calls.get(key);
    if(existing){data={claimed:false,call:existing};break;}
    const row:StoredCall={id:key,job_id:args.p_job_id,call_key:args.p_call_key,maximum_usd:args.p_maximum_usd,model:args.p_model,
     execution_identity:args.p_execution_identity,request_hash:args.p_request_hash,actual_usd:null,state:'reserved'};
    calls.set(key,jsonb(row));data={claimed:true,call:row};break;
   }
   case 'record_content_analysis_call_result':{
    const previous=calls.get(args.p_call_id)!;
    const actual=state.durableCost(args.p_result),row=jsonb({...previous,result:args.p_result,actual_usd:actual,observed_usd:args.p_observed_usd,state:actual===null?'unknown':'settled'});
    calls.set(args.p_call_id,row);data=row;state.afterSave();break;
   }
   case 'mark_content_analysis_call_invalid':{
    const key=callKey(args.p_job_id,args.p_call_key),row={...calls.get(key)!,validation_error_code:args.p_error_code};
    calls.set(key,jsonb(row));data=row;break;
   }
   case 'prepare_content_analysis_job':data=null;break;
   case 'publish_content_analysis_job':data=true;break;
   case 'fail_content_analysis_job':data={state:args.p_yield?'queued':'failed'};break;
   default:throw new Error(`Unexpected offline RPC: ${name}`);
  }
  return {data:jsonb(data),error:null};
 });
 const from=vi.fn((table:string)=>{
  if(table!=='content_analysis_runtime_settings'&&table!=='reader_content_analysis_policies')throw new Error(`Unexpected offline table: ${table}`);
  const query={select:vi.fn(),eq:vi.fn(),order:vi.fn(),single:vi.fn(async()=>({data:{selected_model:state.model,revision:state.revision},error:null})),
   data:[{user_id:'synthetic-owner',enabled:true,model:state.model}],error:null};
  for(const method of ['select','eq','order'] as const)query[method].mockReturnValue(query);
  return query;
 });
 transport.database.mockReturnValue({rpc,from});
 const named=(name:string)=>rpc.mock.calls.filter(([method])=>method===name).map(([,args])=>args);
 const run=(generate:AnalysisGenerator,workerEnv=env())=>createAnalysisWorker({env:workerEnv,store:createAnalysisStore(workerEnv),generate,now:()=>state.clock})();
 return {queue,calls,state,rpc,from,named,run,callKey};
}
function valid(request:GenerationRequest):GenerationResult {
 const parsed=JSON.parse(request.prompt),p=parsed.originalRequest??parsed;
 const value=p.task==='verify_summary'
  ?{readComplete:true,verdicts:p.claims.map((point:{id:string})=>({id:point.id,supported:true,reason:'Synthetic verifier stub for the cited saved passage.'}))}
  :request.role==='summary'
   ?{readComplete:true,lastPassageId:p.requiredLastPassageId,highlights:[{text:'Nvidia improved rendering.',passageIds:[p.passages[0].id]}]}
   :{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates:[{label:'Nvidia',mention:'Nvidia',kind:'brand',confidence:100,reason:'Explicit synthetic source identity.',passageIds:[p.passages[0].id]}]};
 return {value,actualUsd:.0001,observedUsd:.0001};
}
const prepared=(c:AnalysisClaim)=>{c.job.state='prepared';c.job.result={state:'ready',patch:{},pending:[],evidence:{}};return c;};
const cacheRpc='read_content_analysis_cached_calls_v2',reserveRpc='reserve_content_analysis_call_v3',prepareRpc='prepare_content_analysis_job',publishRpc='publish_content_analysis_job';

describe('comparison claim association before H3 work or prepared publication',()=>{
 it.each(['absent','null','job-null','context-null'] as const)('preserves historical original %s associations',async variant=>{
  const c=claim('summary',null);delete c.job.generation_comparison_id;delete c.generationContext!.comparisonId;
  if(variant==='null'||variant==='job-null')c.job.generation_comparison_id=null;
  if(variant==='null'||variant==='context-null')c.generationContext!.comparisonId=null;
  const f=fixture([c]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).completed).toBe(1);
  expect(generate).toHaveBeenCalledTimes(2);expect(f.named(prepareRpc)).toHaveLength(1);expect(f.named(publishRpc)).toHaveLength(1);
  expect(f.named('fail_content_analysis_job')).toEqual([]);
 });

 const invalid:Array<{name:string;change:(c:AnalysisClaim)=>void}>=[
  {name:'missing trusted comparison ID',change:c=>{delete c.generationContext!.comparisonId;}},
  {name:'null trusted comparison ID',change:c=>{c.generationContext!.comparisonId=null;}},
  {name:'malformed matching IDs',change:c=>{c.job.generation_comparison_id='not-a-uuid';c.generationContext!.comparisonId='not-a-uuid';}},
  {name:'matching IDs with a trailing newline',change:c=>{c.job.generation_comparison_id=COMPARISON+'\n';c.generationContext!.comparisonId=COMPARISON+'\n';}},
  {name:'non-string matching IDs',change:c=>{Object.assign(c.job,{generation_comparison_id:17});Object.assign(c.generationContext!,{comparisonId:17});}},
  {name:'wrong trusted comparison ID',change:c=>{c.generationContext!.comparisonId=OTHER_COMPARISON;}},
  {name:'case-normalized instead of exact ID',change:c=>{c.generationContext!.comparisonId=COMPARISON.toUpperCase();}},
  {name:'missing job association with nonnull context',change:c=>{delete c.job.generation_comparison_id;}},
  {name:'null original association with nonnull context',change:c=>{c.job.generation_comparison_id=null;}},
  {name:'missing entire generation context',change:c=>{delete c.generationContext;}},
  {name:'comparison on a legacy protocol',change:c=>{c.job.rule_version='content-v2';}},
 ];
 describe.each(['running','prepared'] as const)('%s claim',state=>{
  it.each(invalid)('rejects $name before cache, reservation, generation or publication',async scenario=>{
   const c=claim();if(state==='prepared')prepared(c);scenario.change(c);
   const f=fixture([c]),generate=vi.fn<AnalysisGenerator>();
   expect((await f.run(generate)).blocked).toBe(1);
   for(const name of [cacheRpc,reserveRpc,prepareRpc,publishRpc])expect(f.named(name)).toEqual([]);
   expect(generate).not.toHaveBeenCalled();
   expect(f.named('fail_content_analysis_job')).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken,p_error_code:'analysis_generation_contract_changed',p_retryable:false,p_yield:false}]);
  });
 });

 it.each(['protocol','context-hash','job-hash','predecessor','review-digest','empty-disposition'] as const)('retains the existing %s fence with a matching comparison',async field=>{
  const c=prepared(claim());
  if(field==='protocol')Object.assign(c.generationContext!,{protocolVersion:'content-v2'});
  if(field==='context-hash')c.generationContext!.generationContractHash='b'.repeat(64);
  if(field==='job-hash')c.job.generation_contract_hash='b'.repeat(64);
  if(field==='predecessor')c.generationContext!.predecessorJobId='wrong-predecessor';
  if(field==='review-digest')c.generationContext!.sourceReviewDigest='malformed';
  if(field==='empty-disposition')Object.assign(c.generationContext!,{emptyDisposition:'self-approved'});
  const f=fixture([c]),generate=vi.fn<AnalysisGenerator>();
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expect(f.named(publishRpc)).toEqual([]);
  expect(f.named('fail_content_analysis_job')[0].p_error_code).toBe('analysis_generation_contract_changed');
 });

 it('accepts the trusted association through the real store, worker and both H3 task engines',async()=>{
  const summary=claim(),keywords=claim('keywords'),f=fixture([summary,keywords]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).completed).toBe(2);expect(generate).toHaveBeenCalledTimes(4);
  expect(ANALYSIS_V3_CONTRACT_HASH).toBe('8b45295994cadc1798f29d61675f169687c5cf187de289c48eb117b5b62d0946');
  expect(f.named('sync_content_analysis_jobs_v2')[0].p_config_epoch).toBe(analysisRuntimeEnv(env(),LUNA,23)('CONTENT_ANALYSIS_CONFIG_EPOCH'));
  expect(f.named(prepareRpc).map(args=>args.p_result.state)).toEqual(['ready','ready']);
  for(const args of f.named(prepareRpc)){
   expect(args.p_result.evidence).toMatchObject({protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH});
   expect(Object.keys(args).sort()).toEqual(['p_job_id','p_lease_token','p_result']);
  }
  expect(f.named(prepareRpc)[0].p_result.patch.videoHighlights).toEqual([{text:'Nvidia improved rendering.',startSeconds:7}]);
  for(const args of f.named(reserveRpc)){
   expect(Object.keys(args).sort()).toEqual(['p_call_key','p_execution_identity','p_job_id','p_lease_token','p_maximum_usd','p_model','p_request_hash']);
   expect(args.p_model).toBe(LUNA);expect(args.p_execution_identity).toMatchObject({route:'openrouter',provider:'openai',model:LUNA,reasoningEffort:'none',
    pricing:{inputUsdPerMillion:.1,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.01,cacheWriteApplies:true,cacheWriteUsdPerMillion:.125}});
   expect(args.p_maximum_usd).toBeLessThanOrEqual(.01);
  }
  expect(f.named(publishRpc)).toEqual([summary,keywords].map(c=>({p_job_id:c.job.id,p_lease_token:c.leaseToken})));
 });

 it('keeps comparison association out of prompts, canonical keys and request fingerprints',async()=>{
  const original=claim('summary',null),comparison=claim(),f=fixture([original,comparison]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).completed).toBe(2);
  expect(generate.mock.calls.slice(0,2)).toEqual(generate.mock.calls.slice(2));
  const reservations=f.named(reserveRpc);
  expect(reservations.slice(0,2).map(args=>[args.p_call_key,args.p_request_hash])).toEqual(reservations.slice(2).map(args=>[args.p_call_key,args.p_request_hash]));
  expect(new Set(reservations.map(args=>args.p_job_id)).size).toBe(2);expect(f.calls.size).toBe(4);
  for(const [request] of generate.mock.calls){expect(JSON.stringify(request)).not.toContain(COMPARISON);expect(JSON.stringify(request)).not.toContain('comparisonId');}
 });

 it.each([reserveRpc,publishRpc])('a matching client association cannot override SQL denial at %s',async deniedRpc=>{
  const c=claim();if(deniedRpc===publishRpc)prepared(c);
  const f=fixture([c]),generate=vi.fn<AnalysisGenerator>();f.state.deniedRpc=deniedRpc;
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expect(f.calls.size).toBe(0);
  expect(f.named(deniedRpc)).toHaveLength(1);expect(f.named('fail_content_analysis_job')[0].p_error_code).toBe('analysis_runtime_disabled');
 });

 it('publishes a valid prepared comparison through the existing RPC without generation',async()=>{
  const c=prepared(claim()),f=fixture([c]),generate=vi.fn<AnalysisGenerator>();
  expect((await f.run(generate)).completed).toBe(1);expect(generate).not.toHaveBeenCalled();
  for(const name of [cacheRpc,reserveRpc,prepareRpc])expect(f.named(name)).toEqual([]);
  expect(f.named(publishRpc)).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken}]);
 });
});

describe('v4 admission through the actual worker/store',()=>{
 function v4Claim(task:'summary'|'keywords'){
  const c=claim(task,null);c.job.rule_version='content-v4';c.job.generation_contract_hash=ANALYSIS_V4_GENERATION_CONTRACT_HASH;
  c.job.generation_predecessor_job_id=null;c.job.generation_admission_id='f4000000-0000-4000-8000-000000000001';
  c.generationContext={protocolVersion:'content-v4',generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,predecessorJobId:null,
   emptyDisposition:'findings_expected',sourceReviewDigest:'a'.repeat(64),admissionId:c.job.generation_admission_id,purpose:'content_v4_evaluation'};
  return c;
 }
 const v4Result:AnalysisGenerator=async request=>{
  const raw=JSON.parse(request.prompt),p=raw.originalRequest??raw;
  if(p.task==='verify_summary')return {value:{readComplete:true,verdicts:p.claims.map((point:{id:string})=>({id:point.id,supported:true,sameFinding:true,reason:'Synthetic bound original finding.'}))},actualUsd:.0001,observedUsd:.0001};
  if(request.role==='summary')return {value:{readComplete:true,lastPassageId:p.requiredLastPassageId,highlights:[{text:'Nvidia improved rendering.',passageIds:[p.passages[0].id]}]},actualUsd:.0001,observedUsd:.0001};
  const units=p.lexicalUnits.map((unit:{id:string;text:string}|[string,string])=>Array.isArray(unit)?{id:unit[0],text:unit[1]}:unit);
  const unit=units.find((unit:{text:string})=>unit.text==='Nvidia');
  return {value:{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates:[{label:'Nvidia',kind:'brand',confidence:100,reason:'Explicit synthetic source identity.',firstUnitId:unit.id,lastUnitId:unit.id}]},actualUsd:.0001,observedUsd:.0001};
 };
 it.each(['summary','keywords'] as const)('binds %s generation, v4 keys and prepared publication without comparison context',async task=>{
  const c=v4Claim(task),f=fixture([c]),generate=vi.fn<AnalysisGenerator>(v4Result);
  expect((await f.run(generate)).completed).toBe(1);
  expect(generate.mock.calls.every(([request])=>request.key.includes(':v4:'))).toBe(true);
  expect(f.named(prepareRpc)[0].p_result.evidence).toMatchObject({protocolVersion:'content-v4',generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH});
  expect(f.named(publishRpc)[0].p_job_id).toBe(c.job.id);
  f.queue.push(c);generate.mockClear();expect((await f.run(generate)).completed).toBe(1);expect(generate).not.toHaveBeenCalled();
 });
 it.each(['summary','keywords'] as const)('commits the settled v4 %s invalidity marker through the RPC store before its only correction',async task=>{
  const c=v4Claim(task),f=fixture([c]),baseKey=task==='summary'?'summary:v4:chunk:0':'extractor:v4:chunk:0';
  const generate=vi.fn<AnalysisGenerator>(async request=>{
   const result=await v4Result(request),value=result.value as Record<string,any>;
   if(request.key===baseKey)return {...result,value:{...value,readComplete:false}};
   if(request.correction){
    const original=JSON.parse(request.prompt),field=task==='summary'?'highlights':'candidates';
    return {...result,value:{...value,[field]:value[field].map((row:Record<string,unknown>,index:number)=>({...row,
     proposalId:original.proposalLineage[index].proposalId,correctionReason:'Retained the original finding and its exact source references.'}))}};
   }
   return result;
  });
  expect((await f.run(generate)).completed).toBe(1);
  const base=f.calls.get(f.callKey(c.job.id,baseKey))!;
  expect(base).toMatchObject({state:'settled',actual_usd:.0001,validation_error_code:'analysis_incomplete_coverage'});
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken,
   p_call_key:baseKey,p_request_hash:base.request_hash,p_error_code:'analysis_incomplete_coverage'}]);
  const requests=generate.mock.calls.map(([request])=>request.key);
  expect(requests).toEqual([baseKey,baseKey+':repair:1',task==='summary'?'summary:v4:verify:0':'checker:v4:chunk:0']);
  const markerIndex=f.rpc.mock.calls.findIndex(([method])=>method==='mark_content_analysis_call_invalid');
  const repairIndex=f.rpc.mock.calls.findIndex(([method,args])=>method===reserveRpc&&args.p_call_key===baseKey+':repair:1');
  expect(markerIndex).toBeGreaterThan(-1);expect(repairIndex).toBeGreaterThan(markerIndex);
  expect(f.named('fail_content_analysis_job')).toEqual([]);expect(f.named(prepareRpc)).toHaveLength(1);expect(f.named(publishRpc)).toHaveLength(1);
  const before=JSON.stringify([...f.calls]);f.queue.push(c);generate.mockClear();
  expect((await f.run(generate)).completed).toBe(1);expect(generate).not.toHaveBeenCalled();
  expect(JSON.stringify([...f.calls])).toBe(before);expect(f.named('mark_content_analysis_call_invalid')).toHaveLength(1);
 });
 it.each(['summary:v3:verify:0','summary:v4:verify:0','summary:v3:chunk:0:repair:1','summary:v4:chunk:0:repair:1'])(
  'rejects an invalidity RPC for terminal or already-corrected key %s',key=>{
   const c=v4Claim('summary'),f=fixture([]),store=createAnalysisStore(env());
   expect(()=>store.markInvalid!(c,{id:'synthetic-call',call_key:key},'b'.repeat(64),'analysis_incomplete_coverage')).toThrow('analysis_invalid_correction');
   expect(f.rpc).not.toHaveBeenCalled();
  });
 it.each(['missing_admission','wrong_purpose','wrong_hash'] as const)('rejects %s before any v4 reservation',async issue=>{
  const c=v4Claim('summary');if(issue==='missing_admission')delete c.job.generation_admission_id;
  if(issue==='wrong_purpose')c.generationContext!.purpose='summary_finalization';
  if(issue==='wrong_hash')c.job.generation_contract_hash='f'.repeat(64);
  const f=fixture([c]),generate=vi.fn<AnalysisGenerator>(v4Result);expect((await f.run(generate)).blocked).toBe(1);
  expect(generate).not.toHaveBeenCalled();expect(f.named(reserveRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
 });
});

describe('sealed one-summary finalization through the actual worker/store',()=>{
 const admissionId='f1000000-0000-4000-8000-000000000001',prefixId='f2000000-0000-4000-8000-000000000001';
 async function finalizer(){
  const old=claim('summary'),f=fixture([old]);
  expect((await f.run(async request=>valid(request))).completed).toBe(1);
  const base=[...f.calls.values()].find(row=>row.call_key==='summary:v3:chunk:0')!;
  const verifier=[...f.calls.values()].find(row=>row.call_key==='summary:v3:verify:0')!;
  const sealed={...base,id:prefixId};f.calls.set(prefixId,sealed);
  const next=claim('summary',null);
  next.job.id='f3000000-0000-4000-8000-000000000001';
  next.job.generation_predecessor_job_id=old.job.id;next.job.generation_admission_id=admissionId;
  next.generationContext={protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,predecessorJobId:old.job.id,
   emptyDisposition:'findings_expected',sourceReviewDigest:'a'.repeat(64),admissionId,purpose:'summary_finalization',
   prefixCalls:[{callId:prefixId,callKey:'summary:v3:chunk:0',requestHash:base.request_hash!}],
   allowedFreshRequest:{key:'summary:v3:verify:0',requestHash:verifier.request_hash!}};
  f.state.cacheReferences.set(next.job.id,[prefixId]);f.queue.push(next);
  f.rpc.mockClear();return {f,next,sealed};
 }
 it('reuses the original settled prefix and purchases only the missing verifier',async()=>{
  const {f,next,sealed}=await finalizer(),before=JSON.stringify(sealed),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).completed).toBe(1);
  expect(generate.mock.calls.map(([request])=>request.key)).toEqual(['summary:v3:verify:0']);
  expect(f.named(reserveRpc).map(args=>args.p_call_key)).toEqual(['summary:v3:verify:0']);
  expect(JSON.stringify(f.calls.get(prefixId))).toBe(before);expect(f.named(publishRpc)[0].p_job_id).toBe(next.job.id);
  f.queue.push(next);generate.mockClear();expect((await f.run(generate)).completed).toBe(1);expect(generate).not.toHaveBeenCalled();
 });
 it.each(['missing_prefix','changed_prefix_id','changed_prefix_hash','changed_verifier_hash','wrong_association','wrong_task'])(
  'blocks %s before a provider attempt',async issue=>{
   const {f,next}=await finalizer();
   if(issue==='missing_prefix')f.state.cacheReferences.clear();
   if(issue==='changed_prefix_id')next.generationContext!.prefixCalls![0].callId='f2000000-0000-4000-8000-000000000002';
   if(issue==='changed_prefix_hash')next.generationContext!.prefixCalls![0].requestHash='f'.repeat(64);
   if(issue==='changed_verifier_hash')next.generationContext!.allowedFreshRequest!.requestHash='f'.repeat(64);
   if(issue==='wrong_association')next.generationContext!.admissionId='f1000000-0000-4000-8000-000000000002';
   if(issue==='wrong_task')next.job.task='keywords';
   const generate=vi.fn<AnalysisGenerator>(async request=>valid(request));expect((await f.run(generate)).blocked).toBe(1);
   expect(generate).not.toHaveBeenCalled();expect(f.named(reserveRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
  });
 it('preserves a negative final verdict without repair or publication',async()=>{
  const {f}=await finalizer(),generate=vi.fn<AnalysisGenerator>(async request=>({value:{readComplete:true,verdicts:JSON.parse(request.prompt).claims.map((p:{id:string})=>({id:p.id,supported:false,reason:'Synthetic unsupported finding.'}))},actualUsd:.0001,observedUsd:.0001}));
  expect((await f.run(generate)).failed).toBe(1);expect(generate).toHaveBeenCalledTimes(1);
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
 });
 it('retains an unknown final charge and blocks publication',async()=>{
  const {f}=await finalizer();f.state.durableCost=()=>null;
  expect((await f.run(async request=>valid(request))).blocked).toBe(1);expect(f.named(prepareRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
 });
});

describe('comparison payment namespace, durable cache and bounded correction',()=>{
 it('resumes Luna repair replay after recursive JSONB reordering without changing hashes, costs or markers',async()=>{
  const c=claim(),f=fixture([c]);let saves=0;
  f.state.afterSave=()=>{if(++saves===2)f.state.clock=551000;};
  const generate=vi.fn<AnalysisGenerator>(async request=>{
   if(request.key!=='summary:v3:chunk:0')return valid(request);
   const result=valid(request);return {...result,value:{...result.value as object,readComplete:false,rawOutput:{z:{nested:[{z:2,a:{last:true,first:false}}]},a:{b:2,a:1}}}};
  });
  expect((await f.run(generate)).yielded).toBe(1);expect(f.calls.size).toBe(2);expect(f.named(publishRpc)).toEqual([]);
  const before=jsonb([...f.calls]),old=new Map([...f.calls].map(([key,row])=>[key,JSON.stringify(row)]));
  expect(before[0][1].validation_error_code).toBe('analysis_invalid_output');
  f.queue.push(c);expect((await f.run(generate)).completed).toBe(1);
  expect(generate).toHaveBeenCalledTimes(3);expect(f.named(reserveRpc)).toHaveLength(3);expect(f.named('mark_content_analysis_call_invalid')).toHaveLength(1);
  for(const [key,row] of old)expect(JSON.stringify(f.calls.get(key))).toBe(row);
  const complete=JSON.stringify([...f.calls]);f.queue.push(c);expect((await f.run(generate)).completed).toBe(1);
  expect(JSON.stringify([...f.calls])).toBe(complete);expect(generate).toHaveBeenCalledTimes(3);expect(f.named(reserveRpc)).toHaveLength(3);
  expect(f.named('mark_content_analysis_call_invalid')).toHaveLength(1);expect(f.named('record_content_analysis_call_result')).toHaveLength(3);
  expect(f.named('fail_content_analysis_job').map(args=>args.p_error_code)).toEqual(['analysis_worker_yield']);
 });

 it('uses new job payment identities and never copies or changes the original DeepSeek cache',async()=>{
  const original=claim('summary',null),comparison=claim(),f=fixture([original]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  f.state.model=DEEPSEEK;f.state.revision=22;
  expect((await f.run(generate)).completed).toBe(1);
  const old=new Map([...f.calls].map(([key,row])=>[key,JSON.stringify(row)])),oldHashes=[...f.calls.values()].map(row=>row.request_hash);
  f.state.model=LUNA;f.state.revision=23;f.queue.push(comparison);
  expect((await f.run(generate)).completed).toBe(1);expect(generate).toHaveBeenCalledTimes(4);expect(f.calls.size).toBe(4);
  for(const [key,row] of old)expect(JSON.stringify(f.calls.get(key))).toBe(row);
  const fresh=[...f.calls.values()].filter(row=>row.job_id===comparison.job.id);
  expect(fresh.map(row=>row.call_key)).toEqual(['summary:v3:chunk:0','summary:v3:verify:0']);
  expect(fresh.every(row=>row.model===LUNA&&!oldHashes.includes(row.request_hash))).toBe(true);
 });

 it('refuses an old DeepSeek result even if a broken transport returns it in the new job cache',async()=>{
  const f=fixture([claim('summary',null)]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  f.state.model=DEEPSEEK;expect((await f.run(generate)).completed).toBe(1);
  const before=JSON.stringify([...f.calls]);f.state.cacheOverride=[...f.calls.values()];f.state.model=LUNA;f.queue.push(claim());
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(2);expect(JSON.stringify([...f.calls])).toBe(before);
  expect(f.named(reserveRpc)).toHaveLength(2);expect(f.named(prepareRpc)).toHaveLength(1);expect(f.named(publishRpc)).toHaveLength(1);
  expect(f.named('fail_content_analysis_job').at(-1)!.p_error_code).toBe('analysis_cached_input_changed');
 });

 it.each([0,.0001])('repairs a materialized JSON null only once with durable settled cost %s',async actual=>{
  const f=fixture([claim('keywords')]);f.state.durableCost=()=>actual;
  const generate=vi.fn<AnalysisGenerator>(async request=>request.key==='extractor:v3:chunk:0'?{value:null,observedUsd:.0001,actualUsd:.0001}:valid(request));
  expect((await f.run(generate)).completed).toBe(1);
  expect(generate.mock.calls.map(([request])=>request.key)).toEqual(['extractor:v3:chunk:0','extractor:v3:chunk:0:repair:1','checker:v3:chunk:0']);
  const base=[...f.calls.values()].find(row=>row.call_key==='extractor:v3:chunk:0')!;
  expect(base).toMatchObject({actual_usd:actual,state:'settled',validation_error_code:'analysis_invalid_output',result:{value:null}});
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([{p_job_id:base.job_id,p_lease_token:'synthetic-lease',p_call_key:base.call_key,p_request_hash:base.request_hash,p_error_code:'analysis_invalid_output'}]);
 });

 it('does not trust a materialized null response cost assertion over an unknown durable charge, including replay',async()=>{
  const c=claim('keywords'),f=fixture([c]);f.state.durableCost=()=>null;
  const generate=vi.fn<AnalysisGenerator>(async()=>({value:null,observedUsd:.0001,actualUsd:.0001}));
  expect((await f.run(generate)).blocked).toBe(1);
  const before=JSON.stringify([...f.calls]);f.queue.push(c);expect((await f.run(generate)).blocked).toBe(1);
  expect(JSON.stringify([...f.calls])).toBe(before);expect(generate).toHaveBeenCalledTimes(1);expect(f.named(reserveRpc)).toHaveLength(1);
  expect([...f.calls.values()][0]).toMatchObject({state:'unknown',actual_usd:null,result:{value:null,actualUsd:.0001}});
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([]);expect(f.named(prepareRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
  expect(f.named('fail_content_analysis_job').map(args=>args.p_error_code)).toEqual(['analysis_correction_charge_unknown','analysis_correction_charge_unknown']);
 });

 it('keeps an ambiguous reservation and never retries generation or changes providers on redelivery',async()=>{
  const c=claim(),f=fixture([c]),generate=vi.fn<AnalysisGenerator>(async()=>{throw new AnalysisError('analysis_provider_timeout');});
  expect((await f.run(generate)).failed).toBe(1);
  const before=JSON.stringify([...f.calls]);f.queue.push(c);expect((await f.run(generate)).blocked).toBe(1);
  expect(JSON.stringify([...f.calls])).toBe(before);expect(generate).toHaveBeenCalledTimes(1);
  expect(f.named(reserveRpc).every(args=>args.p_model===LUNA&&args.p_execution_identity.provider==='openai')).toBe(true);
  expect(f.named('fail_content_analysis_job').map(args=>args.p_error_code)).toEqual(['analysis_provider_timeout','analysis_unknown_charge_hold']);
  expect(f.named(prepareRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
 });

 it('keeps the independent terminal verifier nonrepairable for a comparison',async()=>{
  const f=fixture([claim()]),generate=vi.fn<AnalysisGenerator>(async request=>request.key==='summary:v3:verify:0'
   ?{value:{readComplete:true,verdicts:[{supported:false}]},observedUsd:.0001,actualUsd:.0001}:valid(request));
  expect((await f.run(generate)).failed).toBe(1);
  expect(generate.mock.calls.map(([request])=>request.key)).toEqual(['summary:v3:chunk:0','summary:v3:verify:0']);
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([]);expect(f.named(prepareRpc)).toEqual([]);expect(f.named(publishRpc)).toEqual([]);
 });

 it('performs zero database construction, RPCs or generation when runtime is off',async()=>{
  const f=fixture([claim()]),generate=vi.fn<AnalysisGenerator>();transport.database.mockClear();
  expect(await createAnalysisWorker({env:env({CONTENT_ANALYSIS_ENABLED:'false'}),generate})()).toMatchObject({enabled:false,synchronized:0,completed:0});
  expect(transport.database).not.toHaveBeenCalled();expect(f.from).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();
 });
});
