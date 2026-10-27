/** Explicit private experiment CLI. Bundle with esbuild before running.
 * No key extraction: provider credentials remain on the existing server.
 * A local receipt never authorizes replaying an unknown billed request.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {analyzeKeywordsV4} from '../netlify/functions/_shared/content-analysis-grounded-v4';
import {analysisLimits,conservativeCallUsd,type GenerationRequest,type GenerationResult} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
// @ts-expect-error Shared CLI-only JavaScript helpers.
import {validateLiteralInventory,combineKeywordInventories,minePatternNames,scoreKeywordInventory,compareKeywordMethods,findLiteralNameOccurrences} from './lib/keyword-learning.mjs';
// @ts-expect-error Shared repository-owned versioned prompts.
import {keywordExtractionRequest,keywordCheckerRequest,keywordImprovementLessons} from './lib/keyword-learning-prompts.mjs';

type Obj=Record<string,any>;
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
function stable(v:any):string {if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v!==null&&typeof v==='object')return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
const assert=(v:any,code:string)=>{if(!v)throw Error(code);};
function save(file:string,value:unknown){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600);}
const args=process.argv.slice(2),arg=(name:string,fallback?:string)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const configFile=arg('config'),phase=arg('phase','report')!;
assert(configFile&&['baseline','development','validate','report'].includes(phase),'explicit_config_and_phase_required');
const config=read(configFile!),outDir=config.outputDir;
assert(typeof outDir==='string'&&outDir.startsWith('.local/'),'private_output_directory_required');
assert(/^https:\/\/recap-v0-radu\.netlify\.app\/\.netlify\/functions\/keyword-learning$/.test(config.endpoint),'fixed_private_endpoint_required');
const execute=args.includes('--execute'),cohort=read(config.sourcePath).records,reference=read(config.referencePath);
const ordinals=phase==='development'?[1,2,6]:[1,2,6,10,20];
const sources=cohort.filter((r:Obj)=>ordinals.includes(r.ordinal));
assert(sources.length===ordinals.length,'five_frozen_sources_required');
for(const source of sources)assert(sha(source.source.record.content)===source.sourceHash,'source_hash_changed');
const refFor=(ordinal:number)=>{const r=reference.cases.find((x:Obj)=>x.ordinal===ordinal);assert(r&&r.sourceHash===cohort.find((x:Obj)=>x.ordinal===ordinal).sourceHash,'reference_source_mismatch');return r;};
const version=arg('version','v1')!;
assert(/^[a-z0-9-]{1,40}$/.test(version),'safe_prompt_version_required');
const lessonsFile=arg('lessons'),lessons=lessonsFile?read(lessonsFile):[];
assert(Array.isArray(lessons),'lesson_array_required');
const models={extractor:config.extractorModel,checker:config.checkerModel};
let requestCount=0;

async function rpc(body:Obj):Promise<Obj>{
 const secret=fs.readFileSync(config.workerSecretPath,'utf8').trim();assert(secret.length>=32&&secret.length<=256,'worker_auth_unavailable');
 const response=await fetch(config.endpoint,{method:'POST',headers:{'content-type':'application/json','x-content-analysis-secret':secret},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(55000)});
 const text=await response.text();let result:Obj;try{result=JSON.parse(text);}catch{throw Error('evaluation_response_unreadable_'+response.status);}
 if(!response.ok)throw Object.assign(Error('evaluation_http_'+response.status),{safeCode:result.error?.code??result.code??result.error??'evaluation_request_failed'});
 return result;
}
function unwrap(raw:Obj):GenerationResult {
 const result=raw.result??raw.generationResult??raw.request?.result;
 const call=raw.call??raw.request?.call;
 assert(result&&call&&call.state==='settled'&&call.actual_usd!==null&&call.actual_usd!==undefined,'evaluation_charge_not_settled');
 assert(typeof result.providerId==='string'&&result.executionIdentity,'evaluation_receipt_incomplete');
 return {...result,actualUsd:Number(call.actual_usd)};
}
async function generate(source:Obj,request:GenerationRequest,model:string,tag:string):Promise<GenerationResult>{
 const key='keyword-learning:v1:'+sha(stable({ordinal:source.ordinal,sourceHash:source.sourceHash,model,tag,request}));
 // Include original correction fields in the request binding, but use the
 // learning namespace for durable private accounting rather than a live job.
 const bound={...request,key},body={action:'generate',sessionId:config.sessionId,sourceOrdinal:source.ordinal,sourceHash:source.sourceHash,model,request:bound,originalKey:request.key};
 const file=path.join(outDir,'calls',key.slice(-64)+'.json');
 if(fs.existsSync(file)){
  const receipt=read(file);assert(stable(receipt.body)===stable(body),'local_request_binding_changed');
  if(receipt.state==='complete')return unwrap(receipt.response);
  assert(execute,'paid_execution_requires_execute');
  const prior=await rpc({action:'read',sessionId:config.sessionId,callKey:key});
  const result=unwrap(prior);save(file,{...receipt,state:'complete',recoveredAt:new Date().toISOString(),response:prior});return result;
 }
 assert(execute,'paid_execution_requires_execute');
 const preflight=await rpc({...body,action:'preflight'});
 save(file,{state:'dispatch_started_do_not_duplicate',startedAt:new Date().toISOString(),body,preflight});
 requestCount++;
 let response:Obj;
 try{response=await rpc(body);}catch(error:any){save(file,{state:'dispatch_unknown_or_rejected_do_not_duplicate',at:new Date().toISOString(),body,preflight,errorCode:error.safeCode??error.message});throw error;}
 save(file,{state:'response_received',at:new Date().toISOString(),body,preflight,response});
 const result=unwrap(response);save(file,{state:'complete',at:new Date().toISOString(),body,preflight,response});
 console.log(JSON.stringify({event:'call_settled',ordinal:source.ordinal,tag,model,actualUsd:result.actualUsd,validationError:result.validationError??null}));
 return result;
}
function rowsFor(output:Obj){return [...output.names.map((name:string)=>({name,disposition:'accepted'})),...output.uncertainNames.map((name:string)=>({name,disposition:'review'}))];}
function checkedRows(content:string,value:Obj,names:string[]){
 assert(value.readComplete===true&&Array.isArray(value.decisions)&&Array.isArray(value.missingNames),'checker_incomplete');
 assert(value.decisions.length===names.length&&new Set(value.decisions.map((x:Obj)=>x.name)).size===names.length&&value.decisions.every((x:Obj)=>names.includes(x.name)),'checker_candidate_decisions_incomplete');
 const all=[...value.decisions,...value.missingNames];
 assert(all.every((x:Obj)=>typeof x.name==='string'&&typeof x.kind==='string'&&['accepted','review','rejected'].includes(x.disposition)),'checker_invalid_decision');
 assert(new Set(all.map((x:Obj)=>x.name)).size===all.length,'checker_duplicate_decision');
 return all.map((x:Obj)=>({...x,...(!findLiteralNameOccurrences(content,x.name).length&&x.disposition==='accepted'?{disposition:'review',hostReviewReason:'literal_name_not_in_source'}:{})}));
}
async function runCase(source:Obj){
 const content=source.source.record.content,segments=source.source.record.transcriptSegments??[],referenceCase=refFor(source.ordinal);
 const report:Obj={ordinal:source.ordinal,sourceHash:source.sourceHash,promptVersion:version,lessons,extractorModel:models.extractor,checkerModel:models.checker,methods:[],checker:null};
 const methods:Obj[]=[];
 for(const method of ['direct','type_sweep','patterns',...(config.includeSectionSweep?['sections']:[])]){
  const resultFile=path.join(outDir,version,`${source.ordinal}-${method}.json`);
  let generated:GenerationResult|null=null;
  try{
   const request=method==='patterns'?null:keywordExtractionRequest({method,content,lessons});
   generated=request?await generate(source,request,models.extractor,version+':'+method):null;
   if(generated?.validationError)throw Error(generated.validationError);
   const output=validateLiteralInventory(generated?generated.value:minePatternNames(content));
   const rows=rowsFor(output),score=scoreKeywordInventory({content,rows,reference:referenceCase});
   const entry={method,output,rows,score,scoreStage:'raw_extraction_reference_score',request,generated};save(resultFile,entry);methods.push({method,output,deliveryStatus:'complete',costUsd:generated?.actualUsd??0});report.methods.push({method,status:'complete',score,scoreStage:entry.scoreStage,actualUsd:generated?.actualUsd??0});
  }catch(error:any){const entry={method,status:'failed',errorCode:error.safeCode??error.code??error.message,score:null,actualUsd:generated?.actualUsd??null};save(resultFile,entry);methods.push({method,deliveryStatus:'failed',costUsd:entry.actualUsd});report.methods.push(entry);}
 }
 const completedMethods=methods.filter((method:Obj)=>method.deliveryStatus==='complete');
 const union=combineKeywordInventories(content,completedMethods,segments),names=union.map((x:Obj)=>x.name);
 report.unionCandidates=union;report.extractionComparison=compareKeywordMethods({content,methods,reference:referenceCase,segments});
 report.extractionComparison.stage='raw_methods_and_unreviewed_candidate_union';
 report.extractionComparison.union.stage='unreviewed_candidate_union';
 try{
  const request=keywordCheckerRequest({content,names}),generated=await generate(source,request,models.checker,version+':checker');
  if(generated.validationError)throw Error(generated.validationError);
  const rows=checkedRows(content,generated.value as Obj,names),kept=rows.filter((x:Obj)=>x.disposition!=='rejected');
  const decisions=new Map(rows.map((x:Obj)=>[x.name,x]));
  report.checkedMethodScores=completedMethods.map((m:Obj)=>({method:m.method,scoreStage:'checker_judged_extractor_predictions',score:scoreKeywordInventory({content,rows:rowsFor(m.output).map((r:Obj)=>({...r,...decisions.get(r.name)})),reference:referenceCase})}));
  report.checker={status:'complete',scoreStage:'checked_final_union',rows,rejected:rows.filter((x:Obj)=>x.disposition==='rejected'),discoveries:generated.value.missingNames,actualUsd:generated.actualUsd,score:scoreKeywordInventory({content,rows:kept,reference:referenceCase}),request,generated};
 }catch(error:any){report.checker={status:'failed',errorCode:error.safeCode??error.code??error.message,score:null};}
 save(path.join(outDir,version,`${source.ordinal}-report.json`),report);
 console.log(JSON.stringify({event:'case_complete',ordinal:source.ordinal,promptVersion:version,methods:report.methods.map((x:Obj)=>({method:x.method,status:x.status,score:x.score?.score??null})),checker:report.checker.status,checkedScore:report.checker.score?.score??null,good:report.checker.score?.good??false}));
 return report;
}
async function baseline(source:Obj){
 const limits={...analysisLimits(analysisRuntimeEnv(()=>undefined,models.extractor,config.modelRevision??18)),...config.baselineLimits};
 let output:any=null,errorCode:string|null=null;const calls:any[]=[];
 const saved=config.baselineReplay?read(config.baselineReplay):null;
 if(saved&&[1,2,6].includes(source.ordinal)){
  const scope=saved.scopes.find((x:Obj)=>x.task==='keywords'||x.prefix==='proof-deepseek'),job=scope?.jobs.find((x:Obj)=>x.ordinal===source.ordinal);
  assert(job&&job.sourceHash===source.sourceHash&&job.terminalFailureReproducibleFromSavedResponses===true,'exact_baseline_replay_missing');
  const result={ordinal:source.ordinal,sourceHash:source.sourceHash,mode:'exact_settled_response_replay',replayFile:config.baselineReplay,output:job.replayedOutput??null,errorCode:job.replayError,semanticScore:null,calls:job.matchedSavedCalls,newCostUsd:0,priorScopeReportedCostUsd:scope.financial?.knownSettledUsd??null};
  save(path.join(outDir,'baseline',`${source.ordinal}.json`),result);console.log(JSON.stringify({event:'baseline_complete',ordinal:source.ordinal,mode:result.mode,errorCode:result.errorCode,semanticScore:null}));return result;
 }
 try{output=await analyzeKeywordsV4(source.source.record,limits,async request=>{assert(conservativeCallUsd(request,limits)<=limits.maxCallUsd,'analysis_call_limit');const result=await generate(source,request,models.extractor,'baseline:'+request.key);calls.push({key:request.key,actualUsd:result.actualUsd});return result;});}catch(error:any){errorCode=error.code??error.safeCode??error.message;}
 const proposals=output?[...(output.evidence.extraction?.candidates??[]),...(output.evidence.checker?.candidates??[])]:[];
 const baselineRow=(r:Obj,disposition:string)=>{
  const matching=proposals.filter((p:Obj)=>p.label===r.label&&p.kind===r.kind&&typeof p.mention==='string');
  const literals=[...new Set(matching.map((p:Obj)=>p.mention))];
  const name=r.mention??(literals.length===1?literals[0]:r.label);
  return {name,canonicalLabel:r.label,kind:r.kind,disposition,...(literals.length>1?{baselineAliasAmbiguity:literals}:{} )};
 };
 const rows=output?[...(output.evidence.accepted??[]).map((r:Obj)=>baselineRow(r,'accepted')),...(output.pending??[]).map((r:Obj)=>baselineRow(r,'review'))]:[];
 const result={ordinal:source.ordinal,sourceHash:source.sourceHash,mode:'current_process_private_live_run',output,errorCode,calls,semanticScore:output?scoreKeywordInventory({content:source.source.record.content,rows,reference:refFor(source.ordinal)}):null};
 save(path.join(outDir,'baseline',`${source.ordinal}.json`),result);console.log(JSON.stringify({event:'baseline_complete',ordinal:source.ordinal,mode:result.mode,errorCode,semanticScore:result.semanticScore?.score??null}));return result;
}
if(phase==='baseline'){for(const source of sources)await baseline(source);}
if(phase==='development'||phase==='validate'){
 if(phase==='validate'){
  assert(config.frozenWinner?.version===version&&config.frozenWinner.lessonsSha256===sha(stable(lessons)),'frozen_winner_required_before_validation');
  assert(config.frozenWinner.promptModuleSha256===sha(fs.readFileSync('scripts/lib/keyword-learning-prompts.mjs')),'frozen_prompt_module_changed');
 }
 const reports=[];for(const source of sources)reports.push(await runCase(source));
 save(path.join(outDir,version,phase+'-summary.json'),{generatedAt:new Date().toISOString(),phase,version,referenceVersion:reference.version,reports:reports.map((r:Obj)=>({ordinal:r.ordinal,methods:r.methods,checker:r.checker})),newCallsThisInvocation:requestCount,allFiveComplete:reports.length===5&&reports.every((r:Obj)=>r.checker.status==='complete'),allGood:reports.every((r:Obj)=>r.checker.score?.good===true)});
 if(phase==='development')save(path.join(outDir,version,'suggested-lessons.json'),keywordImprovementLessons(reports.flatMap((r:Obj)=>[...(r.checkedMethodScores??r.methods).map((method:Obj)=>method.score),r.checker.score]).filter(Boolean)));
}
if(phase==='report'){
 const files=fs.existsSync(path.join(outDir,'calls'))?fs.readdirSync(path.join(outDir,'calls')).filter(x=>x.endsWith('.json')):[];
 const calls=files.map(x=>read(path.join(outDir,'calls',x)));
 const report={checkedAt:new Date().toISOString(),calls:calls.length,localComplete:calls.filter(x=>x.state==='complete').length,localUnresolved:calls.filter(x=>x.state!=='complete').length,settledUsd:calls.reduce((n,x)=>n+Number(x.response?.call?.actual_usd??0),0),authoritativeFinancialLedger:false};
 console.log(JSON.stringify(report));save(path.join(outDir,'local-call-summary.json'),report);
}
