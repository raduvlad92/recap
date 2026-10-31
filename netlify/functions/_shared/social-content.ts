import type { AutomaticContentClaim, AutomaticContentResult, AutomaticContentStore } from './automatic-content';
import { generateAutomaticContent, createAutomaticLearningCaller } from './automatic-content';
import { database } from './admin-data';
import { analysisWorkerAuthorized } from './content-analysis';
import { AnalysisError, type GenerationResult } from './content-analysis-model';
import type { KeywordLearningInput } from './keyword-learning';
import { publicHttpsUrl, runtimeEnv, type Env } from './security';
type DB=ReturnType<typeof database>;
const fail=(code:string):never=>{throw new AnalysisError(code);};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const errorCode=(error:unknown)=>error instanceof AnalysisError?error.code:'social_content_failed';
export function createSocialContentStore(db:DB):AutomaticContentStore {
 async function rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
  const value=await db.rpc(name,args);
  if(value.error)return fail(value.error.code==='PT402'?'analysis_budget_exhausted':value.error.code==='PT429'?'analysis_daily_budget_exhausted':value.error.code==='PT403'?'social_content_disabled':'social_content_storage_conflict');
  return value.data as T;
 }
 return {sync:()=>rpc('sync_social_content_tasks'),async claim(){
   const value=await rpc<unknown>('claim_social_content_task',{p_lease_seconds:900});
   if(value===null||object(value)&&value.claimed===false)return null;
   if(!object(value)||value.claimed!==true||!object(value.task)||!object(value.record)||typeof value.leaseToken!=='string'
    ||!['id','user_id','update_id','content_hash','session_id'].every(key=>typeof (value.task as Record<string,unknown>)[key]==='string')
    ||!['keywords','recap'].includes(String(value.task.task)))return fail('social_content_invalid_claim');
   return {task:value.task,record:value.record,leaseToken:value.leaseToken} as unknown as AutomaticContentClaim;
  },
  finish:(claim,result,code)=>rpc('finish_social_content_task',{p_task_id:claim.task.id,p_lease_token:claim.leaseToken,p_result:result,p_error_code:code??null})};
}

interface WorkerDependencies {env:Env;store:AutomaticContentStore;call:(input:KeywordLearningInput)=>Promise<GenerationResult>;now:()=>number}
/** Database policies are the opt-in authority. The optional runtime variable
 * provides an emergency stop without requiring a second enabling switch. */
export const socialContentRuntimeAllowed=(env:Env=runtimeEnv):boolean=>env('SOCIAL_CONTENT_ENABLED')!=='false';
function socialContentConfigured(env:Env):boolean{
 const secret=env('CONTENT_ANALYSIS_WORKER_SECRET')||'';
 if(secret.length<32||secret.length>256)return false;
 try{publicHttpsUrl(env('APP_URL'));return true;}catch{return false;}
}
export function createSocialContentWorker(overrides:Partial<WorkerDependencies>={}){
 const env=overrides.env||runtimeEnv,now=overrides.now||Date.now;
 return async()=>{
  const stats={enabled:socialContentRuntimeAllowed(env)&&socialContentConfigured(env),synchronized:0,queuedForReview:0,blocked:0,yielded:0};
  if(!stats.enabled)return stats;
  const db=!overrides.store||!overrides.call?database(env):undefined;
  const store=overrides.store||createSocialContentStore(db!),call=overrides.call||createAutomaticLearningCaller(env,db!);
  stats.synchronized=(await store.sync()).synchronized;
  const deadline=now()+10*60_000;
  for(let index=0;index<20&&now()<deadline-130_000;index++){
   const claim=await store.claim();if(!claim)break;
   try{
    const result=await generateAutomaticContent(claim,call,()=>{if(now()>deadline-130_000)return fail('automatic_worker_yield');});
    await store.finish(claim,result);stats.queuedForReview++;
   }catch(error){
    const code=errorCode(error);
    await store.finish(claim,null,code);
    if(code==='automatic_worker_yield'){stats.yielded++;break;}
    stats.blocked++;
    if(['analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_unknown_charge_hold','keyword_learning_not_released'].includes(code))break;
   }
  }
  return stats;
 };
}

export async function dispatchSocialContent(env:Env=runtimeEnv,fetcher:typeof fetch=fetch):Promise<{dispatched:boolean}>{
 if(!socialContentRuntimeAllowed(env)||!socialContentConfigured(env))return {dispatched:false};
 const secret=env('CONTENT_ANALYSIS_WORKER_SECRET')||'';
 if(secret.length<32||secret.length>256)return fail('analysis_worker_not_configured');
 const app=publicHttpsUrl(env('APP_URL'));
 const response=await fetcher(new URL('/.netlify/functions/social-content-worker',app),{method:'POST',headers:{'content-type':'application/json','x-content-analysis-secret':secret},body:'{}',redirect:'error',signal:AbortSignal.timeout(10_000)});
 await response.body?.cancel();if(response.status!==202)return fail('social_content_dispatch_failed');return {dispatched:true};
}

export function socialContentWorkerAuthorized(request:Request,env:Env=runtimeEnv):boolean{
 if(!analysisWorkerAuthorized(request,env))return false;
 try{return new URL(request.url).origin===publicHttpsUrl(env('APP_URL')).origin;}catch{return false;}
}
