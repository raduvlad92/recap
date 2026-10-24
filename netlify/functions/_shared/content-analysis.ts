import { timingSafeEqual } from 'node:crypto';
import type { SourceUpdate } from '../../../src/lib/types';
import type { ContentProcessing } from '../../../src/lib/processing-types';
import { contentHash, getContentProcessing } from '../../../src/lib/content-processing';
import { database } from './admin-data';
import { authenticate, CollectionError, errorResponse, json, publicHttpsUrl, runtimeEnv, type Env } from './security';
import { analyzeKeywords, analyzeSummary, type AnalysisOutput } from './content-analysis-engine';
import { analysisRuntimeEnv } from './content-analysis-runtime';
import { AnalysisError, AnalysisProviderHttpError, analysisFailure, analysisLimits, analysisExecutionIdentity, conservativeCallUsd, createGatewayGenerator, type AnalysisRejectionReceipt, type AnalysisExecutionIdentity, type AnalysisGenerator, type AnalysisLimits, type GenerationResult, type GenerationRequest } from './content-analysis-model';

export interface AnalysisPolicy { user_id:string; enabled:boolean; model:string }
export interface AnalysisJob { id:string; user_id:string; update_id:string; source_id:string; content_hash:string; task:'summary'|'keywords'; state:string; result:AnalysisOutput|null }
export interface AnalysisClaim { job:AnalysisJob; record:SourceUpdate; leaseToken:string }
export interface AnalysisCall {id:string;model?:string;execution_identity?:AnalysisExecutionIdentity|null;request_hash?:string|null;result?:(GenerationResult & {requestHash?:string})|null; maximum_usd?:number}
export interface AnalysisReservation {claimed:boolean;call?:AnalysisCall;reason?:string;retryAt?:string}
export interface AnalysisStore {
 runtime?():Promise<{selected_model:string;revision:number}>;
 policies():Promise<AnalysisPolicy[]>;
 sync(userId:string,configEpoch?:string):Promise<unknown>;
 claim(userId:string):Promise<AnalysisClaim|null>;
 reserve(claim:AnalysisClaim,request:GenerationRequest,maximumUsd:number,model:string,identity:AnalysisExecutionIdentity,requestHash:string):Promise<AnalysisReservation>;
 recordRejection(call:AnalysisCall,claim:AnalysisClaim,requestHash:string,identity:AnalysisExecutionIdentity,receipt:AnalysisRejectionReceipt):Promise<{retryEligible:false;retryAt:string}>;
 saveCall(call:AnalysisCall,claim:AnalysisClaim,result:GenerationResult):Promise<void>;
 prepare(claim:AnalysisClaim,result:AnalysisOutput):Promise<void>;
 publish(claim:AnalysisClaim):Promise<boolean>;
 fail(claim:AnalysisClaim,code:string,retryable:boolean,yielded?:boolean):Promise<void>;
}
export function createAnalysisStore(env:Env=runtimeEnv):AnalysisStore {
 const db=database(env);
 async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T> {
  const result=await db.rpc(name,args);
  if(result.error) throw new AnalysisError(result.error.code==='PT429'?'analysis_daily_budget_exhausted':result.error.code==='PT402'?'analysis_budget_exhausted':result.error.code==='PT403'?'analysis_runtime_disabled':result.error.code==='PT409'?'analysis_source_changed':name==='reserve_content_analysis_call_v3'&&result.error.code==='PT400'?'analysis_configuration_required':'analysis_storage_unavailable');
  return result.data as T;
 }
 return {
  async runtime(){const result=await db.from('content_analysis_runtime_settings').select('selected_model,revision').eq('id',true).single();if(result.error||!result.data)return analysisFailure('analysis_storage_unavailable');return result.data;},
  async policies(){const result=await db.from('reader_content_analysis_policies').select('user_id,enabled,model').eq('enabled',true).order('last_served_at').order('user_id');if(result.error) return analysisFailure('analysis_storage_unavailable');return result.data as AnalysisPolicy[];},
  sync:(userId,configEpoch)=>rpc('sync_content_analysis_jobs',{p_user_id:userId,p_limit:200,p_config_epoch:configEpoch??env('CONTENT_ANALYSIS_CONFIG_EPOCH')??''}),
  claim:userId=>rpc('claim_content_analysis_job',{p_user_id:userId,p_lease_seconds:900}),
  reserve:(claim,request,maximumUsd,model,identity,requestHash)=>rpc('reserve_content_analysis_call_v3',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_call_key:request.key,p_maximum_usd:maximumUsd,p_model:model,p_execution_identity:identity,p_request_hash:requestHash}),
  recordRejection:(call,claim,requestHash,identity,receipt)=>rpc('record_content_analysis_known_rejection',{p_call_id:call.id,p_lease_token:claim.leaseToken,p_request_hash:requestHash,p_execution_identity:identity,p_http_status:receipt.httpStatus,p_retry_after_seconds:receipt.retryAfterSeconds,p_provider_request_id:receipt.providerRequestId,p_received_at:receipt.receivedAt,p_pre_generation:receipt.preGeneration}),
  async saveCall(call,claim,result){await rpc('record_content_analysis_call_result',{p_call_id:call.id,p_lease_token:claim.leaseToken,p_result:result,p_usage:result.usage||{},p_provider_id:result.providerId||null,p_actual_usd:result.actualUsd??null,p_observed_usd:result.observedUsd});},
  async prepare(claim,result){await rpc('prepare_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_result:result});},
  publish:claim=>rpc('publish_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken}),
  async fail(claim,code,retryable,yielded=false){await rpc('fail_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_error_code:code,p_retryable:retryable,p_yield:yielded});},
 };
}
export interface AnalysisWorkerDependencies {env:Env;store:AnalysisStore;generate:AnalysisGenerator;limits:AnalysisLimits;now:()=>number}
function stableJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export function analysisRequestHash(request:GenerationRequest,identity:AnalysisExecutionIdentity,verification?:{responseModel?:string;providerName?:string}):string {
 return contentHash(stableJson({executionIdentity:identity,verification:verification??null,system:request.system,prompt:request.prompt,schema:request.schema,maxOutputTokens:request.maxOutputTokens}));
}
export function createAnalysisWorker(dependencies:Partial<AnalysisWorkerDependencies>={}) {
 const env=dependencies.env||runtimeEnv,now=dependencies.now||Date.now;
 return async()=>{
  const stats={enabled:env('CONTENT_ANALYSIS_ENABLED')==='true',synchronized:0,completed:0,failed:0,blocked:0,yielded:0};
  if(!stats.enabled) return stats;
  // Construct runtime resources only after the global feature gate. No import/build or anonymous call spends.
  const store=dependencies.store||createAnalysisStore(env);
  let limits:AnalysisLimits|undefined,generator:AnalysisGenerator|undefined,identity:AnalysisExecutionIdentity|undefined,setupCode:string|undefined,effectiveEnv=env;
  try {
   if(store.runtime){const selected=await store.runtime();effectiveEnv=analysisRuntimeEnv(env,selected.selected_model,selected.revision);}
   limits=dependencies.limits||analysisLimits(effectiveEnv);identity=analysisExecutionIdentity(effectiveEnv,limits);generator=dependencies.generate||createGatewayGenerator(effectiveEnv);
  }
  catch(error){setupCode=error instanceof AnalysisError?(error.code==='analysis_model_not_allowed'?'analysis_provider_not_verified':error.code):'analysis_configuration_required';}
  const started=now(),deadline=started+11*60_000;
  const policies=await store.policies(),tasksPerOwner=Math.max(2,Math.floor(50/Math.max(1,policies.length)));
  for(const policy of policies) {
   if(!policy.enabled) continue;
   if(now()>=deadline-50_000)break;
   await store.sync(policy.user_id,effectiveEnv('CONTENT_ANALYSIS_CONFIG_EPOCH')||''); stats.synchronized++;
   const ownerDeadline=Math.min(deadline,now()+Math.max(60_000,Math.floor(600_000/Math.max(1,Math.min(policies.length,10)))));
   // Latest-first DB claims with bounded backfill; next invocation scans the archive again for recovered captions.
   for(let count=0;count<tasksPerOwner && now()<ownerDeadline-50_000;count++) {
    const claim=await store.claim(policy.user_id);if(!claim) break;
    let stopProviderTurn=false;
    try {
     if(claim.job.user_id!==policy.user_id) return analysisFailure('analysis_owner_mismatch');
     if(claim.job.state==='prepared' && claim.job.result) {
      if(await store.publish(claim)) stats.completed++;continue;
     }
     if(setupCode || !limits || !generator || !identity) return analysisFailure(setupCode||'analysis_configuration_required');
     const generate=generator;
     const executionIdentity=identity;
     const verification=executionIdentity.route==='openrouter'?{responseModel:effectiveEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:effectiveEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')}:undefined;
     if(policy.model!==limits.model)return analysisFailure('analysis_model_policy_mismatch');
     const metered:AnalysisGenerator=async request=>{
      if(now()>ownerDeadline-50_000) return analysisFailure('analysis_worker_yield');
      const maximumUsd=conservativeCallUsd(request,limits);
      if(maximumUsd>limits.maxCallUsd) return analysisFailure('analysis_call_limit');
      const requestHash=analysisRequestHash(request,executionIdentity,verification);
      const reservation=await store.reserve(claim,request,maximumUsd,limits.model,executionIdentity,requestHash);
      if(!reservation.claimed) {
       if(reservation.reason==='analysis_provider_cooldown'||reservation.reason==='analysis_provider_rate_limited'){
        stopProviderTurn=true;return analysisFailure(reservation.reason);
       }
       if(reservation.reason==='analysis_provider_retry_exhausted')return analysisFailure(reservation.reason);
       if(reservation.call?.result) {
        if(reservation.call.model!==limits.model||stableJson(reservation.call.execution_identity)!==stableJson(executionIdentity)
         ||stableJson(reservation.call.result.executionIdentity)!==stableJson(executionIdentity)||reservation.call.result.requestHash!==requestHash
         ||reservation.call.request_hash!=null&&reservation.call.request_hash!==requestHash)return analysisFailure('analysis_cached_input_changed');
        return reservation.call.result;
       }
       // A provider may have charged an interrupted request. Never resubmit an ambiguous call key.
       return analysisFailure('analysis_unknown_charge_hold');
      }
      const call=reservation.call;
      if(!call||call.model!==limits.model||stableJson(call.execution_identity)!==stableJson(executionIdentity)||call.request_hash!==requestHash)return analysisFailure('analysis_configuration_required');
      let result:GenerationResult;
      try{result=await generate(request);}
      catch(error){
       // One rate-limited route is shared by every reader in this run. Stop
       // even if receipt persistence/failure scheduling loses its source lease.
       if(error instanceof AnalysisProviderHttpError&&error.httpStatus===429){
        stopProviderTurn=true;
        if(error.rejection&&executionIdentity.route==='openrouter'){
         // Status-only evidence pauses the shared provider. It cannot release
         // money or schedule generation: a verified provider cost receipt is
         // required separately, including for complete pre-generation 429s.
         await store.recordRejection(call,claim,requestHash,executionIdentity,error.rejection);
        }
       }
       throw error;
      }
      if(result.observedUsd!==null && (!Number.isFinite(result.observedUsd)||result.observedUsd<0)) return analysisFailure('analysis_invalid_cost');
      await store.saveCall(call,claim,{...result,requestHash,executionIdentity} as GenerationResult);
      return result;
     };
     const result=claim.job.task==='summary'?await analyzeSummary(claim.record,limits,metered):await analyzeKeywords(claim.record,limits,metered);
     await store.prepare(claim,result);
     if(await store.publish(claim)) stats.completed++;
    } catch(error) {
     const code=error instanceof AnalysisError?error.code:'analysis_generation_failed';
     const yielded=code==='analysis_worker_yield',blocked=['analysis_daily_budget_exhausted','analysis_budget_exhausted','analysis_input_limit','analysis_call_limit','analysis_unknown_charge_hold','analysis_cached_input_changed','analysis_model_policy_mismatch','analysis_credentials_required','analysis_configuration_required','analysis_pricing_not_verified','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_runtime_disabled'].includes(code);
     if(yielded)stats.yielded++;else if(blocked)stats.blocked++;else stats.failed++;
     // Network errors keep their durable call hold. They must never be retried as a new model charge.
     // The rate-limited state comes only from the reservation RPC after an
     // explicit verified-zero authorization. fail() rechecks that receipt.
     const retryable=code==='analysis_storage_unavailable'||code==='analysis_provider_cooldown'||code==='analysis_provider_rate_limited';
     try {await store.fail(claim,code,retryable,yielded);} catch { /* Source/deletion fence can invalidate the lease; never recreate it. */ }
     if(stopProviderTurn)return stats;
     if(yielded) break;
    }
   }
  }
  return stats;
 };
}
export function analysisWorkerAuthorized(request:Request,env:Env=runtimeEnv):boolean {
 const secret=env('CONTENT_ANALYSIS_WORKER_SECRET')||'',provided=request.headers.get('x-content-analysis-secret')||'';
 return request.method==='POST' && secret.length>=32 && secret.length<=256 && Buffer.byteLength(secret)===Buffer.byteLength(provided) && timingSafeEqual(Buffer.from(secret),Buffer.from(provided));
}
export async function dispatchContentAnalysis(env:Env=runtimeEnv,fetcher:typeof fetch=fetch):Promise<{dispatched:boolean}> {
 if(env('CONTENT_ANALYSIS_ENABLED')!=='true'||env('CONTEXT')!=='production') return {dispatched:false};
 const secret=env('CONTENT_ANALYSIS_WORKER_SECRET')||'';
 if(secret.length<32||secret.length>256) return analysisFailure('analysis_worker_not_configured');
 const app=publicHttpsUrl(env('APP_URL'));
 const response=await fetcher(new URL('/.netlify/functions/content-analysis-worker',app).href,{method:'POST',headers:{'x-content-analysis-secret':secret,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10_000)});
 await response.body?.cancel();
 if(response.status!==202) return analysisFailure('analysis_dispatch_failed');
 return {dispatched:true};
}
/** Read-only owner endpoint: no model calls, synchronization, queue mutation or private evidence. */
export function createAnalysisStatusHandler(deps:{env?:Env;verify?:typeof authenticate;db?:ReturnType<typeof database>}={}) {
 const env=deps.env||runtimeEnv;
 return async(request:Request)=>{
  try {
   if(request.method!=='GET') throw new CollectionError(405,'method_not_allowed','Use GET to read processing status.');
   const userId=await (deps.verify||authenticate)(request,env),url=new URL(request.url);
   const offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new CollectionError(400,'invalid_page','Use a valid status page.');
   const db=deps.db||database(env);
   if(url.searchParams.has('since')) {
    const timestamp=(value:string|null):value is string=>!!value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
    const since=url.searchParams.get('since'),windowEnd=url.searchParams.get('until')||new Date().toISOString();
    const afterAt=url.searchParams.get('afterUpdatedAt'),afterId=url.searchParams.get('afterId');
    if(!timestamp(since)||!timestamp(windowEnd)||Date.parse(windowEnd)<Date.parse(since)
     ||((afterAt||afterId)&&(!timestamp(afterAt)||!afterId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(afterId)||Date.parse(afterAt)<Date.parse(since)||Date.parse(afterAt)>Date.parse(windowEnd)))) {
     throw new CollectionError(400,'invalid_window','Use a valid processing change window.');
    }
    let query=db.from('reader_content_analysis_jobs').select('update_id,state,updated_at,id').eq('user_id',userId)
     .gt('updated_at',since).lte('updated_at',windowEnd).order('updated_at',{ascending:true}).order('id',{ascending:true});
    // Cursor traversal does not skip untouched rows if earlier jobs move beyond
    // until during pagination. Offset mode is retained for simple clients.
    if(afterAt&&afterId)query=query.or('updated_at.gt.'+afterAt+',and(updated_at.eq.'+afterAt+',id.gt.'+afterId+')');
    const result=await query.range(afterAt?0:offset,(afterAt?0:offset)+99);
    if(result.error)throw new CollectionError(503,'analysis_status_unavailable','Processing changes could not be read.');
    const last=result.data.at(-1),more=result.data.length===100;
    return json({updateIds:[...new Set(result.data.map(row=>row.update_id))],lastChangedAt:last?.updated_at||since,windowEnd,
     nextOffset:more?offset+100:null,nextCursor:more&&last?{updatedAt:last.updated_at,id:last.id}:null});
   }
   const result=await db.from('reader_source_updates').select('id,record').eq('user_id',userId).order('published_at',{ascending:false}).order('id').range(offset,offset+99);
   if(result.error) throw new CollectionError(503,'analysis_status_unavailable','Processing status could not be read.');
   return json({items:result.data.map(row=>({updateId:row.id,processing:getContentProcessing(row.record as SourceUpdate) as ContentProcessing})),offset,nextOffset:result.data.length===100?offset+100:null});
  } catch(error){return errorResponse(error);}
 };
}
