import { timingSafeEqual } from 'node:crypto';
import type { SourceUpdate } from '../../../src/lib/types';
import type { ContentProcessing } from '../../../src/lib/processing-types';
import { contentHash, getContentProcessing } from '../../../src/lib/content-processing';
import { database } from './admin-data';
import { authenticate, CollectionError, errorResponse, json, publicHttpsUrl, runtimeEnv, type Env } from './security';
import { analyzeKeywords, analyzeSummary, analyzeKeywordsV2, analyzeSummaryV2, analyzeKeywordsV3, analyzeSummaryV3, type AnalysisOutput } from './content-analysis-engine';
import { parseAnalysisV2CallKey } from './content-analysis-grounded-v2-protocol';
import { parseAnalysisV3CallKey, ANALYSIS_V3_CONTRACT_HASH } from './content-analysis-grounded-v3-protocol';
import { analysisRuntimeEnv } from './content-analysis-runtime';
import { AnalysisError, AnalysisProviderHttpError, analysisFailure, analysisLimits, analysisExecutionIdentity, conservativeCallUsd, createGatewayGenerator, type AnalysisRejectionReceipt, type AnalysisExecutionIdentity, type AnalysisGenerator, type AnalysisLimits, type GenerationResult, type GenerationRequest } from './content-analysis-model';

export interface AnalysisPolicy { user_id:string; enabled:boolean; model:string }
export interface AnalysisJob { id:string; user_id:string; update_id:string; source_id:string; content_hash:string; task:'summary'|'keywords'; state:string; result:AnalysisOutput|null;rule_version?:'content-v1'|'content-v2'|'content-v3';generation_contract_hash?:string|null;generation_predecessor_job_id?:string|null }
export interface AnalysisGenerationContext { protocolVersion:'content-v3';generationContractHash:string;predecessorJobId:string;emptyDisposition:'findings_expected'|'no_findings_reviewed'|'unreviewed';sourceReviewDigest:string|null }
export interface AnalysisClaim { job:AnalysisJob; record:SourceUpdate; leaseToken:string;generationContext?:AnalysisGenerationContext }
export interface AnalysisCall {id:string;call_key?:string;model?:string;execution_identity?:AnalysisExecutionIdentity|null;request_hash?:string|null;result?:(GenerationResult & {requestHash?:string})|null; maximum_usd?:number;actual_usd?:number|string|null;observed_usd?:number|string|null;state?:string;validation_error_code?:string|null}
export interface AnalysisReservation {claimed:boolean;call?:AnalysisCall;reason?:string;retryAt?:string}
export interface AnalysisCachePage {calls:AnalysisCall[];nextAfterKey:string|null}
export const ANALYSIS_CACHE_PAGE_BYTES=1_048_576;
const CACHE_WINDOW_CHUNKS=32,CACHE_WINDOW_KEYS=64;
// Reconstruction and generation have separate headroom. The old 60s slice
// left only 10s for cached RPCs, so valid continuations exhausted their stalls.
const MIN_CLAIM_WINDOW_MS=180_000,GENERATION_HEADROOM_MS=50_000;
export interface AnalysisStore {
 runtime?():Promise<{selected_model:string;revision:number}>;
 policies():Promise<AnalysisPolicy[]>;
 sync(userId:string,configEpoch?:string):Promise<unknown>;
 claim(userId:string):Promise<AnalysisClaim|null>;
 /** Optional for older fixture stores. Never grants provider permission. */
 cachedCalls?(claim:AnalysisClaim,keys:string[],afterKey:string|null,model:string):Promise<AnalysisCachePage>;
 reserve(claim:AnalysisClaim,request:GenerationRequest,maximumUsd:number,model:string,identity:AnalysisExecutionIdentity,requestHash:string):Promise<AnalysisReservation>;
 recordRejection(call:AnalysisCall,claim:AnalysisClaim,requestHash:string,identity:AnalysisExecutionIdentity,receipt:AnalysisRejectionReceipt):Promise<{retryEligible:false;retryAt:string}>;
 saveCall(call:AnalysisCall,claim:AnalysisClaim,result:GenerationResult):Promise<AnalysisCall|void>;
 markInvalid?(claim:AnalysisClaim,call:AnalysisCall,requestHash:string,errorCode:string):Promise<AnalysisCall|void>;
 prepare(claim:AnalysisClaim,result:AnalysisOutput):Promise<void>;
 publish(claim:AnalysisClaim):Promise<boolean>;
 fail(claim:AnalysisClaim,code:string,retryable:boolean,yielded?:boolean):Promise<{state:string}|void>;
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
  sync:(userId,configEpoch)=>rpc('sync_content_analysis_jobs_v2',{p_user_id:userId,p_limit:200,p_config_epoch:configEpoch??env('CONTENT_ANALYSIS_CONFIG_EPOCH')??''}),
  claim:userId=>rpc('claim_content_analysis_job_v2',{p_user_id:userId,p_lease_seconds:900}),
  cachedCalls:(claim,keys,afterKey,model)=>rpc('read_content_analysis_cached_calls_v2',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_call_keys:keys,p_after_key:afterKey,p_model:model}),
  reserve:(claim,request,maximumUsd,model,identity,requestHash)=>rpc('reserve_content_analysis_call_v3',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_call_key:request.key,p_maximum_usd:maximumUsd,p_model:model,p_execution_identity:identity,p_request_hash:requestHash}),
  recordRejection:(call,claim,requestHash,identity,receipt)=>rpc('record_content_analysis_known_rejection',{p_call_id:call.id,p_lease_token:claim.leaseToken,p_request_hash:requestHash,p_execution_identity:identity,p_http_status:receipt.httpStatus,p_retry_after_seconds:receipt.retryAfterSeconds,p_provider_request_id:receipt.providerRequestId,p_received_at:receipt.receivedAt,p_pre_generation:receipt.preGeneration}),
  saveCall:(call,claim,result)=>rpc<AnalysisCall>('record_content_analysis_call_result',{p_call_id:call.id,p_lease_token:claim.leaseToken,p_result:result,p_usage:result.usage||{},p_provider_id:result.providerId||null,p_actual_usd:result.actualUsd??null,p_observed_usd:result.observedUsd}),
  markInvalid:(claim,call,requestHash,errorCode)=>rpc<AnalysisCall>('mark_content_analysis_call_invalid',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_call_key:callKeyForInvalid(call),p_request_hash:requestHash,p_error_code:errorCode}),
  async prepare(claim,result){await rpc('prepare_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_result:result});},
  publish:claim=>rpc('publish_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken}),
  fail:(claim,code,retryable,yielded=false)=>rpc<{state:string}>('fail_content_analysis_job',{p_job_id:claim.job.id,p_lease_token:claim.leaseToken,p_error_code:code,p_retryable:retryable,p_yield:yielded}),
 };
}
export interface AnalysisWorkerDependencies {env:Env;store:AnalysisStore;generate:AnalysisGenerator;limits:AnalysisLimits;now:()=>number}
function callKeyForInvalid(call:AnalysisCall):string {
 const key=call.call_key,parsed=typeof key==='string'?(parseAnalysisV2CallKey(key)||parseAnalysisV3CallKey(key)):null;
 if(!parsed||parsed.repairAttempt||parsed.baseKey==='summary:v3:verify:0')return analysisFailure('analysis_invalid_correction');
 return key!;
}
/** A result's own usage claim cannot authorize another paid correction. */
export function durableGenerationResult(call:AnalysisCall,result:GenerationResult):GenerationResult {
 const raw=call.actual_usd;
 const amount=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;
 return {...result,actualUsd:call.state==='settled'&&Number.isFinite(amount)&&amount>=0?amount:null};
}
function stableJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export function analysisRequestHash(request:GenerationRequest,identity:AnalysisExecutionIdentity,verification?:{responseModel?:string;providerName?:string}):string {
 return contentHash(stableJson({executionIdentity:identity,verification:verification??null,system:request.system,prompt:request.prompt,schema:request.schema,maxOutputTokens:request.maxOutputTokens,...(request.correction?{correction:request.correction}:{})}));
}
/** Only retain one bounded key window, including its possible one-shot repairs. */
function cacheWindow(key:string):string[] {
 const base=(parseAnalysisV2CallKey(key)||parseAnalysisV3CallKey(key))?.baseKey;
 if(!base)return analysisFailure('analysis_invalid_protocol_key');
 const match=/^(.*:(?:chunk|group):)(\d+)$/.exec(base);
 const index=match?Number(match[2]):0;
 if(!Number.isSafeInteger(index))return analysisFailure('analysis_invalid_protocol_key');
 const start=Math.floor(index/CACHE_WINDOW_CHUNKS)*CACHE_WINDOW_CHUNKS;
 return (match?Array.from({length:CACHE_WINDOW_CHUNKS},(_,i)=>match[1]+(start+i)):[base])
  .flatMap(value=>[value,value+':repair:1']).sort();
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
   if(now()>deadline-MIN_CLAIM_WINDOW_MS)break;
   await store.sync(policy.user_id,effectiveEnv('CONTENT_ANALYSIS_CONFIG_EPOCH')||''); stats.synchronized++;
   const ownerDeadline=Math.min(deadline,now()+Math.max(MIN_CLAIM_WINDOW_MS,Math.floor(600_000/Math.max(1,Math.min(policies.length,10)))));
   // Latest-first DB claims with bounded backfill; next invocation scans the archive again for recovered captions.
   // Do not claim a second job with only the scraps of the owner's slice.
   // Real claims persist last_served_at; owners omitted at the global deadline
   // lead the next invocation, even when one long continuation uses its slice.
   for(let count=0;count<tasksPerOwner && now()<=ownerDeadline-MIN_CLAIM_WINDOW_MS;count++) {
    const claim=await store.claim(policy.user_id);if(!claim) break;
    let stopProviderTurn=false;
    try {
     if(claim.job.user_id!==policy.user_id) return analysisFailure('analysis_owner_mismatch');
     const protocolV3=claim.job.rule_version==='content-v3';
     const generationContext=claim.generationContext;
     if(claim.job.rule_version!==undefined&&!['content-v1','content-v2','content-v3'].includes(claim.job.rule_version))return analysisFailure('analysis_invalid_protocol_key');
     if(protocolV3&&(!generationContext||generationContext.protocolVersion!=='content-v3'
      ||generationContext.generationContractHash!==ANALYSIS_V3_CONTRACT_HASH||claim.job.generation_contract_hash!==ANALYSIS_V3_CONTRACT_HASH
      ||generationContext.predecessorJobId!==claim.job.generation_predecessor_job_id||!generationContext.predecessorJobId
      ||!['findings_expected','no_findings_reviewed','unreviewed'].includes(generationContext.emptyDisposition)
      ||generationContext.sourceReviewDigest!==null&&!/^[a-f0-9]{64}$/.test(generationContext.sourceReviewDigest)))return analysisFailure('analysis_generation_contract_changed');
     if(claim.job.state==='prepared' && claim.job.result) {
      if(await store.publish(claim)) stats.completed++;continue;
     }
     if(setupCode || !limits || !generator || !identity) return analysisFailure(setupCode||'analysis_configuration_required');
     const generate=generator;
     const executionIdentity=identity;
     const verification=executionIdentity.route==='openrouter'?{responseModel:effectiveEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:effectiveEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')}:undefined;
     if(policy.model!==limits.model)return analysisFailure('analysis_model_policy_mismatch');
     const grounded=claim.job.rule_version==='content-v2'||protocolV3;
     // The engine requests a repair immediately after its base. Keep only that
     // result, rather than retaining hundreds of raw half-megabyte responses.
     const materialized=new Map<string,{call:AnalysisCall;requestHash:string;result:GenerationResult}>();
     const remember=(key:string,call:AnalysisCall,requestHash:string,result:GenerationResult)=>{
      materialized.clear();materialized.set(key,{call,requestHash,result});
     };
     let windowKeys:string[]=[],windowCalls=new Map<string,AnalysisCall>();
     const cachedCall=async(key:string):Promise<AnalysisCall|undefined>=>{
      if(!grounded||!store.cachedCalls)return;
      const keys=cacheWindow(key);
      if(keys[0]!==windowKeys[0]){
       windowKeys=keys;windowCalls=new Map();
       let after:string|null=null;
       // At most one row per requested key, even when every row fills a page.
       for(let pageNumber=0;pageNumber<CACHE_WINDOW_KEYS;pageNumber++){
        if(now()>ownerDeadline-GENERATION_HEADROOM_MS)return analysisFailure('analysis_worker_yield');
        const page=await store.cachedCalls(claim,keys,after,limits.model);
        if(!page||!Array.isArray(page.calls)||page.calls.length>keys.length
         ||Buffer.byteLength(JSON.stringify(page),'utf8')>ANALYSIS_CACHE_PAGE_BYTES
         ||page.nextAfterKey!==null&&(typeof page.nextAfterKey!=='string'||!keys.includes(page.nextAfterKey)||after!==null&&page.nextAfterKey<=after))
         return analysisFailure('analysis_storage_unavailable');
        let previous:string|null=after;
        for(const call of page.calls){
         const callKey=call.call_key;
         if(typeof callKey!=='string'||!keys.includes(callKey)||previous!==null&&callKey<=previous||windowCalls.has(callKey))
          return analysisFailure('analysis_storage_unavailable');
         windowCalls.set(callKey,call);previous=callKey;
        }
        if(page.nextAfterKey===null)break;
        if(page.calls.length===0||page.nextAfterKey!==previous||pageNumber===CACHE_WINDOW_KEYS-1)
         return analysisFailure('analysis_storage_unavailable');
        after=page.nextAfterKey;
       }
      }
      return windowCalls.get(key);
     };
     const metered:AnalysisGenerator=async request=>{
      if(now()>ownerDeadline-GENERATION_HEADROOM_MS) return analysisFailure('analysis_worker_yield');
      const parsed=protocolV3?parseAnalysisV3CallKey(request.key):grounded?parseAnalysisV2CallKey(request.key):null;
      if(grounded&&!parsed||!grounded&&request.correction)return analysisFailure('analysis_invalid_protocol_key');
      if(protocolV3&&parsed?.repairAttempt&&parsed.baseKey==='summary:v3:verify:0')return analysisFailure('analysis_invalid_protocol_key');
      if(parsed?.repairAttempt){
       const correction=request.correction,base=materialized.get(parsed.baseKey);
       if(!correction||correction.baseKey!==parsed.baseKey||!/^[a-z][a-z0-9_]{0,79}$/.test(correction.errorCode)
        ||!base||typeof base.result.actualUsd!=='number'||!Number.isFinite(base.result.actualUsd)||base.result.actualUsd<0||!store.markInvalid)
        return analysisFailure('analysis_correction_charge_unknown');
      }else if(request.correction)return analysisFailure('analysis_invalid_correction');
      // A materialized response may be usable while its bill is unknown. It
      // can be replayed, but cannot authorize the next separately charged key.
      // SQL repeats this fence under lock; fail truthfully before that PT409.
      if(grounded&&[...materialized].some(([key,base])=>key!==request.key&&base.result.actualUsd==null))
       return analysisFailure('analysis_unknown_charge_hold');
      const maximumUsd=conservativeCallUsd(request,limits);
      if(maximumUsd>limits.maxCallUsd) return analysisFailure('analysis_call_limit');
      const requestHash=analysisRequestHash(request,executionIdentity,verification);
      const cached=await cachedCall(request.key);
      // A cached correction was already authorized and charged. Repeating its
      // invalidity write on every replay can starve a long repaired prefix.
      // New corrections still commit the exact base marker before reservation.
      if(parsed?.repairAttempt&&!cached?.result){
       const base=materialized.get(parsed.baseKey)!;
       await store.markInvalid!(claim,{...base.call,call_key:parsed.baseKey},base.requestHash,request.correction!.errorCode);
      }
      // Missing/result-less rows still pass through the authoritative stable-key
      // reservation, including unknown holds and authenticated-zero retries.
      if(now()>ownerDeadline-GENERATION_HEADROOM_MS)return analysisFailure('analysis_worker_yield');
      const reservation=cached?.result?{claimed:false,call:cached}:await store.reserve(claim,request,maximumUsd,limits.model,executionIdentity,requestHash);
      if(!reservation.claimed) {
       if(reservation.reason==='analysis_provider_cooldown'||reservation.reason==='analysis_provider_rate_limited'){
        stopProviderTurn=true;return analysisFailure(reservation.reason);
       }
       if(reservation.reason==='analysis_provider_retry_exhausted')return analysisFailure(reservation.reason);
       if(reservation.call?.result) {
        if(reservation.call.model!==limits.model||stableJson(reservation.call.execution_identity)!==stableJson(executionIdentity)
         ||stableJson(reservation.call.result.executionIdentity)!==stableJson(executionIdentity)||reservation.call.result.requestHash!==requestHash
         ||(grounded?reservation.call.request_hash!==requestHash:reservation.call.request_hash!=null&&reservation.call.request_hash!==requestHash))return analysisFailure('analysis_cached_input_changed');
        const result=grounded?durableGenerationResult(reservation.call,reservation.call.result):reservation.call.result;
        remember(request.key,reservation.call,requestHash,result);
        return result;
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
      if(result.actualUsd!==undefined&&result.actualUsd!==null&&(!Number.isFinite(result.actualUsd)||result.actualUsd<0))return analysisFailure('analysis_invalid_cost');
      const persisted=await store.saveCall(call,claim,{...result,requestHash,executionIdentity} as GenerationResult);
      const saved=grounded?durableGenerationResult(persisted||call,result):result;
      remember(request.key,persisted||call,requestHash,saved);
      return saved;
     };
     const result=protocolV3
      ?await (claim.job.task==='summary'?analyzeSummaryV3:analyzeKeywordsV3)(claim.record,limits,metered,generationContext)
      :await (claim.job.task==='summary'?(grounded?analyzeSummaryV2:analyzeSummary):(grounded?analyzeKeywordsV2:analyzeKeywords))(claim.record,limits,metered);
     await store.prepare(claim,result);
     if(await store.publish(claim)) stats.completed++;
    } catch(error) {
     const code=error instanceof AnalysisError?error.code:'analysis_generation_failed';
     const yielded=code==='analysis_worker_yield',blocked=['analysis_daily_budget_exhausted','analysis_budget_exhausted','analysis_input_limit','analysis_call_limit','analysis_unknown_charge_hold','analysis_correction_charge_unknown','analysis_cached_input_changed','analysis_generation_contract_changed','analysis_model_policy_mismatch','analysis_credentials_required','analysis_configuration_required','analysis_pricing_not_verified','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_runtime_disabled'].includes(code);
     if(yielded)stats.yielded++;else if(blocked)stats.blocked++;else stats.failed++;
     // Network errors keep their durable call hold. They must never be retried as a new model charge.
     // The rate-limited state comes only from the reservation RPC after an
     // explicit verified-zero authorization. fail() rechecks that receipt.
     const retryable=code==='analysis_storage_unavailable'||code==='analysis_provider_cooldown'||code==='analysis_provider_rate_limited';
     try {
      const failure=await store.fail(claim,code,retryable,yielded);
      // The durable no-progress guard can turn a requested yield into a
      // terminal stop. Report that outcome; older fixture stores return void.
      if(yielded&&failure?.state==='failed'){stats.yielded--;stats.failed++;}
     } catch { /* Source/deletion fence can invalidate the lease; never recreate it. */ }
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
