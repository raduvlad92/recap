import {describe,it,expect,vi} from 'vitest';
import {contentHash} from '../src/lib/content-processing';
import type {SourceUpdate} from '../src/lib/types';
import {createAnalysisWorker,type AnalysisCall,type AnalysisClaim,type AnalysisStore} from '../netlify/functions/_shared/content-analysis';
import {analysisLimits,createOpenRouterAnalysisGenerator,type OpenAIClientFactory} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import {DEFAULT_ANALYSIS_MODEL} from '../src/lib/analysis-settings-types';

// Synthetic local-only transport, source, policy, identities, ledger and cost.
// No runtimeEnv, database client, network, .env file, or real key is used.
const env=analysisRuntimeEnv(name=>name==='OPENROUTER_API_KEY'?'synthetic-review-key':name==='CONTENT_ANALYSIS_ENABLED'?'true':undefined,DEFAULT_ANALYSIS_MODEL,1);
const limits=analysisLimits(env);
const content='In the measured GPU test, the frame rate did not improve.';
const inventedClaim='The GPU frame rate improved in the measured test.';
const record:SourceUpdate={id:'synthetic-r3',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic',summary:'Synthetic metadata',url:'https://example.invalid/synthetic',publishedAt:'2026-10-25T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],contentKind:'transcript',content,isSample:false,videoFormat:{kind:'regular',basis:'provider'},transcriptSegments:[{startSeconds:7,text:content,durationSeconds:5}]};
const negative={readComplete:false,verdicts:[{id:'s0',supported:false,reason:'The evidence says the frame rate did not improve; the sentence reverses the negation.'}]};
const malformed=JSON.stringify(negative).slice(0,-1)+',';
function harness(finish:'stop'|'length',parsedNegative=false,durableKnown=true,repairInvalid=false){
 const calls=new Map<string,AnalysisCall>(),trace:unknown[]=[],queue:AnalysisClaim[]=[];
 const claim=():AnalysisClaim=>({job:{id:'synthetic-job',user_id:'synthetic-owner',update_id:record.id,source_id:record.sourceId,content_hash:contentHash(content),task:'summary',state:'running',result:null,rule_version:'content-v2'},record,leaseToken:'synthetic-lease'});
 queue.push(claim());
 let prepared:unknown=null;
 const store:AnalysisStore={
  policies:async()=>[{user_id:'synthetic-owner',enabled:true,model:limits.model}],sync:async()=>({}),claim:async()=>queue.shift()||null,
  reserve:vi.fn(async(_claim,request,max,model,identity,hash)=>{
   trace.push({op:'reserve',key:request.key,correction:request.correction??null});
   if(calls.has(request.key))return {claimed:false,call:calls.get(request.key)};
   const row:AnalysisCall={id:request.key,call_key:request.key,model,maximum_usd:max,execution_identity:identity,request_hash:hash,state:'reserved',actual_usd:null};calls.set(request.key,row);return {claimed:true,call:row};
  }),
  saveCall:vi.fn(async(call,_claim,result)=>{const known=durableKnown||call.call_key!=='summary:v2:verify:0';const row:AnalysisCall={...call,result:structuredClone(result),state:known?'settled':'unknown',actual_usd:known?String(result.actualUsd):null};calls.set(call.call_key!,row);trace.push({op:'save',key:call.call_key,state:row.state,actual:row.actual_usd,validationError:result.validationError});return row;}),
  markInvalid:vi.fn(async(_claim,call,hash,code)=>{trace.push({op:'markInvalid',key:call.call_key,hash,code});const row={...calls.get(call.call_key!)!,validation_error_code:code};calls.set(call.call_key!,row);return row;}),
  recordRejection:async()=>({retryEligible:false as const,retryAt:'2026-10-25T00:00:00Z'}),
  prepare:vi.fn(async(_claim,result)=>{prepared=structuredClone(result);trace.push({op:'prepare',state:result.state});}),
  publish:vi.fn(async()=>{trace.push({op:'publish'});return true;}),
  fail:vi.fn(async(_claim,code,retryable,yielded)=>{trace.push({op:'fail',code,retryable,yielded});}),
 };
 const create=vi.fn(async(payload:any)=>{
  const rawPrompt=JSON.parse(payload.messages[1].content),repair=rawPrompt.task==='correct_invalid_response',prompt=rawPrompt.originalRequest??rawPrompt;
  trace.push({op:'synthetic_transport',task:prompt.task,repair});
  let text:string,reason='stop';
  if(prompt.task==='verify_summary'){
   if(repair)text=repairInvalid?'{':JSON.stringify({readComplete:true,verdicts:[{id:'s0',supported:true,reason:'Synthetic correction changed the negative verdict to agreement.'}]});
   else {text=parsedNegative?JSON.stringify(negative):malformed;reason=finish;}
  }else text=JSON.stringify({readComplete:true,lastPassageId:prompt.requiredLastPassageId,highlights:[{text:inventedClaim,passageIds:[prompt.passages[0].id]}]});
  return {id:'gen-synthetic-r3-'+create.mock.calls.length,model:DEFAULT_ANALYSIS_MODEL,provider:'Relace',choices:[{finish_reason:reason,message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200,cost:.0001,is_byok:false}};
 });
 const factory=(()=>({chat:{completions:{create}}})) as unknown as OpenAIClientFactory;
 const generate=createOpenRouterAnalysisGenerator(env,factory);
 const run=createAnalysisWorker({env,store,limits,generate,now:()=>0});
 return {run,store,calls,create,trace,queue,claim,prepared:()=>prepared};
}
describe('R3 actual adapter -> worker -> engine: recognizable semantic negative is terminal',()=>{
 for(const finish of ['stop','length'] as const)it(`rejects malformed supported:false under finish_reason=${finish}`,async()=>{
  const h=harness(finish),stats=await h.run();
  const base=h.calls.get('summary:v2:verify:0')!;
  expect(base.result?.value).toEqual({rawOutput:malformed,finishReason:finish});
  expect(base.actual_usd).toBe('0.0001');expect(base.state).toBe('settled');
  // Exercise replay too: the same cached negative/repair must not become publishable.
  h.queue.push(h.claim());const replay=await h.run();

  expect({stats,published:vi.mocked(h.store.publish).mock.calls.length,invalidMarkers:vi.mocked(h.store.markInvalid!).mock.calls.length,prepared:h.prepared()}).toMatchObject({stats:{completed:0,failed:1},published:0,invalidMarkers:0});
  expect(h.create).toHaveBeenCalledTimes(2);
 });
 it.each(['stop','length'] as const)('control: parsed negative stays terminal with finish_reason=%s',async finish=>{
  const h=harness(finish,true),stats=await h.run();expect(stats.failed).toBe(1);expect(stats.completed).toBe(0);expect(h.create).toHaveBeenCalledTimes(2);expect(h.store.publish).not.toHaveBeenCalled();expect(h.store.markInvalid).not.toHaveBeenCalled();expect(h.store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_unsupported_summary_claim',false,false);
 });
 it('keeps invalid final verification terminal even with an unsettled charge',async()=>{
  const h=harness('length',false,false),stats=await h.run();expect(stats.failed).toBe(1);expect(h.create).toHaveBeenCalledTimes(2);expect(h.store.markInvalid).not.toHaveBeenCalled();expect(h.store.publish).not.toHaveBeenCalled();expect(h.store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_output_capacity',false,false);
 });
 it('never requests a correction of final verification, regardless of a willing agreement response',async()=>{
  const h=harness('length',false,true,true),stats=await h.run();expect(stats.failed).toBe(1);expect(stats.completed).toBe(0);expect(h.create).toHaveBeenCalledTimes(2);expect(h.store.markInvalid).not.toHaveBeenCalled();expect(h.store.publish).not.toHaveBeenCalled();expect([...h.calls.keys()]).toEqual(['summary:v2:chunk:0','summary:v2:verify:0']);
 });
});
