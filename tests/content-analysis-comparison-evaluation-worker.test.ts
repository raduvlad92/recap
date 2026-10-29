import {beforeEach,describe,expect,it,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {ANALYSIS_COMPARISON_LIMITS,createAnalysisStore,createAnalysisWorker,type AnalysisCall,type AnalysisClaim} from '../netlify/functions/_shared/content-analysis';
import {ANALYSIS_V4_GENERATION_CONTRACT_HASH} from '../netlify/functions/_shared/content-analysis-grounded-v4-protocol';
import {AnalysisError,type AnalysisGenerator,type GenerationRequest,type GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import type {Env} from '../netlify/functions/_shared/security';

const transport=vi.hoisted(()=>({database:vi.fn()}));
vi.mock('../netlify/functions/_shared/admin-data',()=>({database:transport.database}));
beforeEach(()=>transport.database.mockReset());

const DEEPSEEK='deepseek/deepseek-v4.1-flash-1017';
const profiles=[
 {model:'minimax/minimax-m3.1-flash',provider:'together',reasoning:'low',input:.15,output:.6,cacheWrite:null},
 {model:'openai/gpt-6-luna-pro',provider:'openai',reasoning:'none',input:.1,output:.5,cacheWrite:.125},
 {model:'openai/gpt-6.1-sol-pro',provider:'openai',reasoning:'low',input:2,output:10,cacheWrite:2.5},
] as const;
const ADMISSION='e1000000-0000-4000-8000-000000000001';
const OTHER_ADMISSION='e1000000-0000-4000-8000-000000000002';
// More than two complete common-limit chunks; no real source or model output.
const content='Nvidia demonstrates synthetic renderingperformance with stableframeboundaries and repeatablesourcetext. '.repeat(32)
 +'Nintendo ends this entirely synthetic saved source.';
const record:SourceUpdate={id:'synthetic-comparison-update',sourceId:'synthetic-comparison-source',contributorIds:[],title:'Synthetic keyword comparison',
 summary:'Metadata is not source evidence.',url:'https://example.test/comparison',publishedAt:'2026-10-27T00:00:00Z',format:'video',isSample:true,
 topics:[],brands:[],sponsors:[],references:[],insights:[],contentKind:'transcript',content,videoFormat:{kind:'regular',basis:'provider'},
 transcriptSegments:[{text:content,startSeconds:5,durationSeconds:30}]};
const env=(overrides:Record<string,string>={}):Env=>key=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_CONFIG_EPOCH:'synthetic-comparison-epoch',
 // The saved selection replaces stale model/provider values. Sealed common
 // limits replace these valid but unsuitable ordinary-runtime limits.
 CONTENT_ANALYSIS_MODEL:DEEPSEEK,CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'relace',CONTENT_ANALYSIS_CHUNK_CHARS:'24000',
 CONTENT_ANALYSIS_MAX_SOURCE_CHARS:'1000',CONTENT_ANALYSIS_MAX_CHUNKS:'1',CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS:'512',
 CONTENT_ANALYSIS_MAX_INPUT_TOKENS:'1000',CONTENT_ANALYSIS_MAX_CALL_USD:'.001',...overrides} as Record<string,string>)[key];
function claim():AnalysisClaim {
 return {job:{id:'e2000000-0000-4000-8000-000000000001',user_id:'synthetic-owner',update_id:record.id,source_id:record.sourceId,
  content_hash:contentHash(content),task:'keywords',state:'running',result:null,rule_version:'content-v4',
  generation_contract_hash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,generation_predecessor_job_id:null,generation_comparison_id:null,generation_admission_id:ADMISSION},
  record,leaseToken:'synthetic-comparison-lease',generationContext:{protocolVersion:'content-v4',generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,
   predecessorJobId:null,emptyDisposition:'findings_expected',sourceReviewDigest:'a'.repeat(64),admissionId:ADMISSION,purpose:'content_model_comparison',
   commonLimits:{...ANALYSIS_COMPARISON_LIMITS}}};
}
function prepared(c:AnalysisClaim):AnalysisClaim {
 c.job.state='prepared';c.job.result={state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{protocolVersion:'content-v4'}};return c;
}
/** Real store and engine; only the database's transport is replaced. */
function fixture(initial:AnalysisClaim[],model:string=profiles[1].model){
 const seenClaims=new Map<string,AnalysisClaim>(),savedRequests=new Map<string,Record<string,any>>();
 const queue=[...initial],calls=new Map<string,AnalysisCall&{job_id:string}>();
 const state={model,revision:37,durableCost:(result:GenerationResult):number|null=>result.actualUsd??null,
  deniedRpc:null as string|null,completionResult:true,missingCompletionMethod:false};
 const key=(jobId:string,callKey:string)=>`${jobId}/${callKey}`;
 const rpc=vi.fn(async(name:string,args:Record<string,any>):Promise<{data:any;error:{code:string}|null}>=>{
  if(name===state.deniedRpc)return {data:null,error:{code:'PT403'}};
  let data:unknown;
  switch(name){
   case 'sync_content_analysis_jobs_v2':data={synchronized:0};break;
   case 'claim_content_analysis_job_v2':{const c=queue.shift()??null;if(c)seenClaims.set(c.job.id,c);data=c;break;}
   case 'record_admin_analysis_prompt':{
    const c=seenClaims.get(args.p_job_id);expect(c).toBeDefined();expect(args.p_lease_token).toBe(c!.leaseToken);
    expect(args.p_model).toBe(state.model);expect(args.p_request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_request).toEqual(expect.objectContaining({key:expect.any(String),role:expect.any(String),system:expect.any(String),prompt:expect.any(String),schema:expect.any(Object),maxOutputTokens:expect.any(Number)}));
    const old=calls.get(key(args.p_job_id,args.p_request.key));
    if(!old)savedRequests.set(key(args.p_job_id,args.p_request.key),args);
    data=old?{recorded:false,cached:old.model===args.p_model&&old.request_hash===args.p_request_hash&&old.result!=null,reason:'historical_prompt_unavailable',...(!old.result?{blockedReason:old.actual_usd==null?'analysis_unknown_charge_hold':'analysis_provider_retry_exhausted'}:{})}:{recorded:true,replayed:false};break;
   }
   case 'read_content_analysis_cached_calls_v2':data={calls:[...calls.values()].filter(row=>row.job_id===args.p_job_id&&args.p_call_keys.includes(row.call_key)
    &&(!args.p_after_key||row.call_key!>args.p_after_key)).sort((a,b)=>a.call_key!.localeCompare(b.call_key!)),nextAfterKey:null};break;
   case 'reserve_content_analysis_call_v3':{
    const id=key(args.p_job_id,args.p_call_key),old=calls.get(id);
    if(old){data={claimed:false,call:old};break;}
    expect(savedRequests.get(key(args.p_job_id,args.p_call_key))).toMatchObject({p_request_hash:args.p_request_hash,p_model:args.p_model,p_lease_token:args.p_lease_token});
    const row={id,job_id:args.p_job_id,call_key:args.p_call_key,maximum_usd:args.p_maximum_usd,model:args.p_model,
     execution_identity:args.p_execution_identity,request_hash:args.p_request_hash,actual_usd:null,state:'reserved'};
    calls.set(id,row);data={claimed:true,call:row};break;
   }
   case 'record_content_analysis_call_result':{
    const old=calls.get(args.p_call_id)!,actual=state.durableCost(args.p_result);
    const row={...old,result:args.p_result,actual_usd:actual,observed_usd:args.p_observed_usd,state:actual===null?'unknown':'settled'};
    calls.set(args.p_call_id,row);data=row;break;
   }
   case 'mark_content_analysis_call_invalid':{
    const id=key(args.p_job_id,args.p_call_key),row={...calls.get(id)!,validation_error_code:args.p_error_code};calls.set(id,row);data=row;break;
   }
   case 'prepare_content_analysis_job':data=null;break;
   case 'complete_content_analysis_comparison_job':data=state.completionResult;break;
   case 'publish_content_analysis_job':data=true;break;
   case 'fail_content_analysis_job':data={state:args.p_yield?'queued':'failed'};break;
   default:throw new Error(`Unexpected offline comparison RPC: ${name}`);
  }
  return {data:JSON.parse(JSON.stringify(data)),error:null};
 });
 const from=vi.fn((table:string)=>{
  if(!['content_analysis_runtime_settings','reader_content_analysis_policies'].includes(table))throw new Error(`Unexpected offline table: ${table}`);
  const query={select:vi.fn(),eq:vi.fn(),order:vi.fn(),single:vi.fn(async()=>({data:{selected_model:state.model,revision:state.revision},error:null})),
   data:[{user_id:'synthetic-owner',enabled:true,model:state.model}],error:null};
  for(const method of ['select','eq','order'] as const)query[method].mockReturnValue(query);
  return query;
 });
 transport.database.mockReturnValue({rpc,from});
 const named=(name:string)=>rpc.mock.calls.filter(([method])=>method===name).map(([,args])=>args);
 const run=(generate:AnalysisGenerator)=>{
  const workerEnv=env(),store=createAnalysisStore(workerEnv);if(state.missingCompletionMethod)delete store.completeComparison;
  return createAnalysisWorker({env:workerEnv,store,generate,now:()=>0})();
 };
 return {queue,calls,state,rpc,from,named,run};
}
function valid(request:GenerationRequest):GenerationResult {
 const raw=JSON.parse(request.prompt),p=raw.originalRequest??raw;
 const candidates=['Nvidia','Nintendo'].flatMap(label=>{
  const unit=p.lexicalUnits.find((unit:{text:string})=>unit.text===label);
  return unit?[{label,kind:'brand',confidence:100,reason:'Explicit identity in the synthetic saved source.',firstUnitId:unit.id,lastUnitId:unit.id}]:[];
 });
 return {value:{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates},actualUsd:.0001,observedUsd:.0001};
}
const cacheRpc='read_content_analysis_cached_calls_v2',reserveRpc='reserve_content_analysis_call_v3',prepareRpc='prepare_content_analysis_job';
const publishRpc='publish_content_analysis_job',completeRpc='complete_content_analysis_comparison_job',failureRpc='fail_content_analysis_job';
function expectNoOutput(f:ReturnType<typeof fixture>){for(const name of [prepareRpc,completeRpc,publishRpc])expect(f.named(name)).toEqual([]);}

describe('sealed v4 keyword evaluation through the real store and worker',()=>{
 it.each(profiles)('uses the saved $model profile, identical common limits and evaluation-only completion',async profile=>{
  const c=claim(),f=fixture([c],profile.model),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  const result=await f.run(generate);
  expect(result).toMatchObject({completed:0,evaluated:1,failed:0,blocked:0,yielded:0});
  expect(content.length).toBeGreaterThan(2500);expect(generate.mock.calls.length).toBeGreaterThan(4);
  expect(f.named('sync_content_analysis_jobs_v2')[0].p_config_epoch).toBe(analysisRuntimeEnv(env(),profile.model,37)('CONTENT_ANALYSIS_CONFIG_EPOCH'));
  for(const [request] of generate.mock.calls){
   expect(request.maxOutputTokens).toBe(3072);expect(request.key).toMatch(/^(extractor|checker):v4:chunk:\d+$/);
   const p=JSON.parse(request.prompt);expect(p.interval.end-p.interval.start).toBeLessThanOrEqual(1250);
   expect(p.sourceHash).toBe(contentHash(content));expect(p.requiredLastPassageId).toBe(p.passages.at(-1).id);
   expect(p.passages.map((passage:{text:string})=>passage.text).join('')).toBe(content.slice(p.interval.start,p.interval.end));
  }
  const preparedResult=f.named(prepareRpc)[0].p_result;
  for(const role of ['extraction','checker']){
   const coverage=preparedResult.evidence[role].coverage;
   expect(coverage[0].start).toBe(0);expect(coverage.at(-1).end).toBe(content.length);
   let end=0;for(const span of coverage){expect(span.start).toBeLessThanOrEqual(end);expect(span.end).toBeGreaterThan(end);end=span.end;}
   expect(end).toBe(content.length);
  }
  expect(preparedResult.evidence.accepted.map((candidate:{label:string})=>candidate.label).sort()).toEqual(['Nintendo','Nvidia']);
  expect(preparedResult.evidence).toMatchObject({protocolVersion:'content-v4',generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH});
  for(const args of f.named(reserveRpc)){
   expect(args.p_model).toBe(profile.model);expect(args.p_maximum_usd).toBeGreaterThan(.001);expect(args.p_maximum_usd).toBeLessThanOrEqual(.10);
   expect(args.p_execution_identity).toMatchObject({model:profile.model,route:'openrouter',provider:profile.provider,reasoningEffort:profile.reasoning,
    pricing:{inputUsdPerMillion:profile.input,outputUsdPerMillion:profile.output,cacheWriteApplies:profile.cacheWrite!==null,cacheWriteUsdPerMillion:profile.cacheWrite}});
  }
  expect(f.named(completeRpc)).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken}]);expect(f.named(publishRpc)).toEqual([]);
  const completeIndex=f.rpc.mock.calls.findIndex(([name])=>name===completeRpc),prepareIndex=f.rpc.mock.calls.findIndex(([name])=>name===prepareRpc);
  expect(completeIndex).toBeGreaterThan(prepareIndex);expect(f.named(failureRpc)).toEqual([]);
 });

 it.each(profiles)('finishes prepared $model evaluation without cache, reservation, generation or publishing',async profile=>{
  const c=prepared(claim()),f=fixture([c],profile.model),generate=vi.fn<AnalysisGenerator>();
  expect(await f.run(generate)).toMatchObject({completed:0,evaluated:1,failed:0,blocked:0});
  expect(generate).not.toHaveBeenCalled();for(const rpc of [cacheRpc,reserveRpc,prepareRpc,publishRpc])expect(f.named(rpc)).toEqual([]);
  expect(f.named(completeRpc)).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken}]);
 });

 it('accepts JSONB-reordered common limits without changing their exact values',async()=>{
  const c=prepared(claim());c.generationContext!.commonLimits=Object.fromEntries(Object.entries(ANALYSIS_COMPARISON_LIMITS).reverse()) as typeof ANALYSIS_COMPARISON_LIMITS;
  const f=fixture([c]);expect((await f.run(vi.fn<AnalysisGenerator>())).evaluated).toBe(1);expect(f.named(publishRpc)).toEqual([]);
 });

 it('does not count a declined evaluation completion as published or evaluated',async()=>{
  const f=fixture([prepared(claim())]);f.state.completionResult=false;
  expect(await f.run(vi.fn<AnalysisGenerator>())).toMatchObject({completed:0,evaluated:0,failed:0,blocked:0});expect(f.named(publishRpc)).toEqual([]);
 });
});

const invalid:Array<{name:string;change:(c:AnalysisClaim)=>void}>=[
 {name:'missing common limits',change:c=>{delete c.generationContext!.commonLimits;}},
 {name:'null common limits',change:c=>{Object.assign(c.generationContext!,{commonLimits:null});}},
 {name:'array common limits',change:c=>{Object.assign(c.generationContext!,{commonLimits:[]});}},
 {name:'extra common-limit field',change:c=>{Object.assign(c.generationContext!.commonLimits!,{unsealedField:true});}},
 {name:'missing common-limit field',change:c=>{delete (c.generationContext!.commonLimits! as Record<string,unknown>).maxInputTokens;}},
 ...Object.entries(ANALYSIS_COMPARISON_LIMITS).map(([field,value])=>({name:`changed ${field}`,change:(c:AnalysisClaim)=>{Object.assign(c.generationContext!.commonLimits!,{[field]:value+1});}})),
 {name:'string instead of numeric common limit',change:c=>{Object.assign(c.generationContext!.commonLimits!,{maxCallUsd:'0.10'});}},
 {name:'missing purpose',change:c=>{delete c.generationContext!.purpose;}},
 {name:'null purpose',change:c=>{Object.assign(c.generationContext!,{purpose:null});}},
 {name:'ordinary v4 evaluation purpose',change:c=>{c.generationContext!.purpose='content_v4_evaluation';}},
 {name:'summary finalization purpose',change:c=>{c.generationContext!.purpose='summary_finalization';}},
 {name:'missing whole generation context',change:c=>{delete c.generationContext;}},
 {name:'missing job admission',change:c=>{delete c.job.generation_admission_id;}},
 {name:'null job admission',change:c=>{c.job.generation_admission_id=null;}},
 {name:'missing context admission',change:c=>{delete c.generationContext!.admissionId;}},
 {name:'different context admission',change:c=>{c.generationContext!.admissionId=OTHER_ADMISSION;}},
 {name:'different job admission',change:c=>{c.job.generation_admission_id=OTHER_ADMISSION;}},
 {name:'malformed matching admission IDs',change:c=>{c.job.generation_admission_id='invalid';c.generationContext!.admissionId='invalid';}},
 {name:'matching admission IDs with trailing newline',change:c=>{c.job.generation_admission_id=ADMISSION+'\n';c.generationContext!.admissionId=ADMISSION+'\n';}},
 {name:'legacy comparison job association',change:c=>{c.job.generation_comparison_id=OTHER_ADMISSION;}},
 {name:'legacy comparison context association',change:c=>{c.generationContext!.comparisonId=OTHER_ADMISSION;}},
 {name:'predecessor association mismatch',change:c=>{c.job.generation_predecessor_job_id=OTHER_ADMISSION;}},
 {name:'context contract hash mismatch',change:c=>{c.generationContext!.generationContractHash='b'.repeat(64);}},
 {name:'job contract hash mismatch',change:c=>{c.job.generation_contract_hash='b'.repeat(64);}},
 {name:'matching protocol changed to v3',change:c=>{c.job.rule_version='content-v3';c.generationContext!.protocolVersion='content-v3';}},
 {name:'malformed source review digest',change:c=>{c.generationContext!.sourceReviewDigest='bad';}},
 {name:'source review digest with trailing newline',change:c=>{c.generationContext!.sourceReviewDigest='a'.repeat(64)+'\n';}},
];
describe.each(['running','prepared'] as const)('invalid sealed comparison while %s',state=>{
 it.each(invalid)('blocks $name before cache, reservation, generation, prepare or either completion route',async scenario=>{
  const c=claim();if(state==='prepared')prepared(c);scenario.change(c);
  const f=fixture([c]),generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expectNoOutput(f);
  expect(f.named(cacheRpc)).toEqual([]);expect(f.named(reserveRpc)).toEqual([]);
  expect(f.named(failureRpc)).toEqual([{p_job_id:c.job.id,p_lease_token:c.leaseToken,p_error_code:'analysis_generation_contract_changed',p_retryable:false,p_yield:false}]);
 });
 it('requires the evaluation-only completion capability even for a prepared result',async()=>{
  const c=claim();if(state==='prepared')prepared(c);const f=fixture([c]),generate=vi.fn<AnalysisGenerator>();f.state.missingCompletionMethod=true;
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expect(f.named(cacheRpc)).toEqual([]);expect(f.named(reserveRpc)).toEqual([]);expectNoOutput(f);
 });
});

describe('evaluation-only failures and ambiguous money',()=>{
 it.each(profiles)('preserves unknown $model cost and blocks the next fresh chunk on replay',async profile=>{
  const c=claim(),f=fixture([c],profile.model);f.state.durableCost=()=>null;
  const generate=vi.fn<AnalysisGenerator>(async request=>valid(request));
  expect((await f.run(generate)).blocked).toBe(1);expectNoOutput(f);
  expect(generate).toHaveBeenCalledTimes(1);expect(f.named(reserveRpc)).toHaveLength(1);
  const before=JSON.stringify([...f.calls]);f.queue.push(c);expect((await f.run(generate)).blocked).toBe(1);
  expect(JSON.stringify([...f.calls])).toBe(before);expect(generate).toHaveBeenCalledTimes(1);expect(f.named(reserveRpc)).toHaveLength(1);
  expect([...f.calls.values()][0]).toMatchObject({call_key:'extractor:v4:chunk:0',state:'unknown',actual_usd:null,result:{actualUsd:.0001}});
  expect(f.named(failureRpc).map(args=>args.p_error_code)).toEqual(['analysis_unknown_charge_hold','analysis_unknown_charge_hold']);
  expect(f.named('mark_content_analysis_call_invalid')).toEqual([]);expectNoOutput(f);
 });
 it('never retries a provider timeout or publishes its ambiguous reserved call',async()=>{
  const c=claim(),f=fixture([c]),generate=vi.fn<AnalysisGenerator>(async()=>{throw new AnalysisError('analysis_provider_timeout');});
  expect((await f.run(generate)).failed).toBe(1);const before=JSON.stringify([...f.calls]);f.queue.push(c);
  expect((await f.run(generate)).blocked).toBe(1);expect(JSON.stringify([...f.calls])).toBe(before);expect(generate).toHaveBeenCalledTimes(1);
  expect(f.named(failureRpc).map(args=>args.p_error_code)).toEqual(['analysis_provider_timeout','analysis_unknown_charge_hold']);expectNoOutput(f);
 });
 it('retains failed complete-coverage correction without completing or publishing the comparison',async()=>{
  const f=fixture([claim()]);const generate=vi.fn<AnalysisGenerator>(async request=>{
   const result=valid(request);return {...result,value:{...result.value as object,readComplete:false,candidates:[]}};
  });
  expect((await f.run(generate)).failed).toBe(1);expect(generate.mock.calls.map(([request])=>request.key)).toEqual(['extractor:v4:chunk:0','extractor:v4:chunk:0:repair:1']);
  expect(f.named('mark_content_analysis_call_invalid')).toHaveLength(1);expectNoOutput(f);
 });
 it('cannot replace SQL denial of evaluation completion with publication',async()=>{
  const f=fixture([prepared(claim())]);f.state.deniedRpc=completeRpc;const generate=vi.fn<AnalysisGenerator>();
  expect((await f.run(generate)).blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expect(f.named(completeRpc)).toHaveLength(1);expect(f.named(publishRpc)).toEqual([]);
  expect(f.named(failureRpc)[0].p_error_code).toBe('analysis_runtime_disabled');
 });
});
