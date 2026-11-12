import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { database, requireAdmin } from './admin-data';
import { analysisWorkerAuthorized, analysisRequestHash } from './content-analysis';
import { analysisRuntimeEnv } from './content-analysis-runtime';
import { analysisExecutionIdentity, analysisLimits, conservativeCallUsd, createGatewayGenerator, createOpenRouterAnalysisGenerator, AnalysisError, AnalysisProviderHttpError, type AnalysisGenerator, type AnalysisExecutionIdentity, type GenerationRequest, type GenerationResult } from './content-analysis-model';
import {createProviderMetadataGuard,assertProviderMetadataFresh,type ProviderMetadataGuard} from './content-analysis-provider-metadata';
import {finiteDiagnosticAttachment} from './provider-http-diagnostic';
import { ANALYSIS_MODEL_IDS } from '../../../src/lib/analysis-settings-types';
import { CollectionError, errorResponse, json, readTextLimited, runtimeEnv, type Env } from './security';

type Database=ReturnType<typeof database>;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,DIGEST=/^[a-f0-9]{64}$/;
export const KEYWORD_LEARNING_KEY=/^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$/;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(code:string,status=400):never=>{throw new CollectionError(status,code,'The private keyword evaluation could not proceed.');};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** CONTEXT is a Netlify build setting, not a reliable function-runtime value.
 * Bind this endpoint to the configured HTTPS app origin instead. Authentication
 * and the finite released database session independently remain mandatory. */
function configuredAppRequest(request:Request,env:Env):boolean {
 const configured=env('APP_URL');
 if(!configured)return false;
 try{
  const app=new URL(configured),actual=new URL(request.url),host=app.hostname.toLowerCase();
  return app.protocol==='https:'&&!app.username&&!app.password&&!app.search&&!app.hash
   &&(!app.port||app.port==='443')&&host.includes('.')&&!isIP(host.replace(/^\[|\]$/g,''))
   &&!/(?:^|\.)(?:localhost|local|internal)$/.test(host)&&actual.origin===app.origin;
 }catch{return false;}
}
export interface KeywordLearningInput {
 action:'generate'|'preflight';sessionId:string;sourceOrdinal:number;sourceHash:string;model:string;request:GenerationRequest;originalKey?:string;
}
/** Namespaced keys identify an evaluation request; its full prompt/source/model
 * binding is independently hashed and stored before the provider is called. */
export function parseKeywordLearningInput(body:unknown):KeywordLearningInput {
 if(!object(body)||Object.keys(body).some(k=>!['action','sessionId','sourceOrdinal','sourceHash','model','request','originalKey'].includes(k))
  ||!['generate','preflight'].includes(String(body.action))||typeof body.sessionId!=='string'||!UUID.test(body.sessionId)
  ||!Number.isSafeInteger(body.sourceOrdinal)||(body.sourceOrdinal as number)<1||(body.sourceOrdinal as number)>1000
  ||typeof body.sourceHash!=='string'||!DIGEST.test(body.sourceHash)||typeof body.model!=='string'||!(ANALYSIS_MODEL_IDS as readonly string[]).includes(body.model)
  ||!object(body.request))return fail('keyword_learning_invalid_input');
 const r=body.request;
 if(Object.keys(r).some(k=>!['role','key','system','prompt','schema','maxOutputTokens','correction'].includes(k))
  ||!['extractor','checker'].includes(String(r.role))||typeof r.key!=='string'||!KEYWORD_LEARNING_KEY.test(r.key)
  ||typeof r.system!=='string'||!r.system.trim()||r.system.length>30000||typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>100000
  ||!object(r.schema)||JSON.stringify(r.schema).length>60000||!Number.isSafeInteger(r.maxOutputTokens)||(r.maxOutputTokens as number)<1||(r.maxOutputTokens as number)>8192
  ||(body.originalKey!==undefined&&(typeof body.originalKey!=='string'||body.originalKey.length>160)))return fail('keyword_learning_invalid_input');
 if(r.correction!==undefined&&(!object(r.correction)||Object.keys(r.correction).some(k=>!['baseKey','errorCode'].includes(k))
  ||typeof r.correction.baseKey!=='string'||r.correction.baseKey.length>160||typeof r.correction.errorCode!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(r.correction.errorCode)))return fail('keyword_learning_invalid_input');
 return body as unknown as KeywordLearningInput;
}
function unwrap<T>(result:{data:T;error:{code?:string}|null}):T {
 if(result.error){const code=result.error.code;return fail(code==='PT402'?'analysis_budget_exhausted':code==='PT429'?'analysis_daily_budget_exhausted':code==='PT409'?'keyword_learning_state_conflict':code==='PT403'?'keyword_learning_not_released':'keyword_learning_storage_unavailable',code==='PT402'?402:code==='PT429'?429:code==='PT409'?409:code==='PT403'?403:502);}
 return result.data;
}
async function sourceFor(db:Database,input:KeywordLearningInput):Promise<string> {
 const s=unwrap(await db.from('keyword_learning_sessions').select('user_id,state,expires_at,sources,models').eq('id',input.sessionId).single());
 if(!s||s.state!=='released'||typeof s.user_id!=='string'||Date.parse(s.expires_at)<=Date.now()||!Array.isArray(s.models)||!s.models.includes(input.model)||!Array.isArray(s.sources))return fail('keyword_learning_not_released',403);
 const source=s.sources.find((x:Record<string,unknown>)=>x.ordinal===input.sourceOrdinal&&x.sourceHash===input.sourceHash);
 if(!source||typeof source.updateId!=='string')return fail('keyword_learning_source_changed',409);
 const row=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',s.user_id).eq('id',source.updateId).single());
 if(!row||typeof row.record?.content!=='string'||hash(row.record.content)!==input.sourceHash)return fail('keyword_learning_source_changed',409);
 return s.user_id;
}
interface Reservation {claimed:boolean;call:{id:string;lease_token:string;state:string;actual_usd:number|string|null;observed_usd:number|string|null;maximum_usd:number|string;attempt_number:number;model:string;user_id:string;request_hash:string;execution_identity:AnalysisExecutionIdentity};result:GenerationResult|null;errorCode:string|null;requestHash:string}
interface Dependencies {now:()=>number;env:Env;db:()=>Database;authorize:typeof requireAdmin;workerAuthorized:typeof analysisWorkerAuthorized;generator:(env:Env)=>AnalysisGenerator;providerMetadata:ProviderMetadataGuard}
const response=(value:unknown,status=200)=>{const r=json(value,status);r.headers.set('x-robots-tag','noindex, nofollow');return r;};
/** Deliberately separate from production queue flags. Only a manually released,
 * finite private session authorizes inference, while the shared durable ledger
 * still enforces all aggregate/day/owner/per-call monetary ceilings. */
export function createKeywordLearningHandler(overrides:Partial<Dependencies>={},options:{generateOnly?:boolean;generationTimeoutMs?:number;assertBeforeReservation?:()=>Promise<void>}={}) {
 if(options.generationTimeoutMs!==undefined&&(!options.generateOnly||!Number.isSafeInteger(options.generationTimeoutMs)||options.generationTimeoutMs<1||options.generationTimeoutMs>120000))throw new AnalysisError('analysis_configuration_required');
 const generator=(env:Env)=>options.generationTimeoutMs===undefined?createGatewayGenerator(env):createOpenRouterAnalysisGenerator(env,undefined,{timeoutMs:options.generationTimeoutMs});
 if(options.assertBeforeReservation!==undefined&&(!options.generateOnly||typeof options.assertBeforeReservation!=='function'))throw new AnalysisError('analysis_configuration_required');
 const deps:Dependencies={now:Date.now,env:runtimeEnv,db:()=>database(overrides.env||runtimeEnv),authorize:requireAdmin,workerAuthorized:analysisWorkerAuthorized,generator,providerMetadata:createProviderMetadataGuard(),...overrides};
 return async(request:Request):Promise<Response>=>{
  try {
   if(request.method!=='POST')return response({error:{code:'method_not_allowed'}},405);
   if(!deps.workerAuthorized(request,deps.env))await deps.authorize(request,deps.env);
   if(!configuredAppRequest(request,deps.env))return fail('keyword_learning_production_required',403);
   if(!request.headers.get('content-type')?.includes('application/json'))return fail('json_required',415);
   let body:unknown;try{body=JSON.parse(await readTextLimited(new Response(request.body),220000));}catch(error){if(error instanceof CollectionError)throw error;return fail('keyword_learning_invalid_input');}
   if(options.generateOnly&&(!object(body)||body.action!=='generate'))return fail('keyword_learning_invalid_input');
   const db=deps.db();
   if(object(body)&&body.action==='read'){
    if(Object.keys(body).some(k=>!['action','sessionId','callKey'].includes(k))||typeof body.sessionId!=='string'||!UUID.test(body.sessionId)||typeof body.callKey!=='string'||!KEYWORD_LEARNING_KEY.test(body.callKey))return fail('keyword_learning_invalid_input');
    return response(unwrap(await db.rpc('read_keyword_learning_call',{p_session_id:body.sessionId,p_call_key:body.callKey})));
   }
   const input=parseKeywordLearningInput(body);
   const sourceOwner=await sourceFor(db,input);
   const env=analysisRuntimeEnv(deps.env,input.model,1),limits=analysisLimits(env),identity=analysisExecutionIdentity(env,limits);
   const estimateUsd=conservativeCallUsd(input.request,limits);
   if(estimateUsd>.10||estimateUsd>limits.maxCallUsd)return fail('analysis_call_limit',402);
   // These private tests reserve the whole approved per-call allowance. A live
   // response reported a charge above its token estimate; that estimate must
   // not make aggregate/session headroom appear available before settlement.
   const maximumUsd=Math.min(.10,limits.maxCallUsd);
   const generationHash=analysisRequestHash(input.request,identity,{responseModel:env('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:env('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')});
   const requestHash=hash(JSON.stringify({generationHash,sourceOrdinal:input.sourceOrdinal,sourceHash:input.sourceHash,originalKey:input.originalKey??null,key:input.request.key}));
   // Existing keys are immutable readback, independent of current public
   // advertisements. Never reserve/retry an unknown or cached call again.
   if(input.action==='generate'){
    const prior=unwrap(await db.rpc('read_keyword_learning_call',{p_session_id:input.sessionId,p_call_key:input.request.key})) as Reservation|null;
    if(prior){
     if(!object(prior.call)||prior.requestHash!==requestHash||prior.call.request_hash!==requestHash||prior.call.model!==input.model
      ||prior.call.user_id!==sourceOwner||Number(prior.call.maximum_usd)!==maximumUsd||!object(prior.call.execution_identity)
      ||analysisRequestHash(input.request,prior.call.execution_identity,{responseModel:env('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:env('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')})!==generationHash)return fail('keyword_learning_state_conflict',409);
     return response({...prior,cached:!!prior.result,providerCall:false},prior.call.actual_usd===null?202:200);
    }
   }
   const providerMetadata=await deps.providerMetadata(env,input.request);
   // Metadata may wait on I/O. Revalidate every current binding afterwards;
   // SQL independently repeats frozen source/session/financial guards under lock.
   if(await sourceFor(db,input)!==sourceOwner)return fail('keyword_learning_source_changed',409);
   const freshEnv=analysisRuntimeEnv(deps.env,input.model,1),freshIdentity=analysisExecutionIdentity(freshEnv,analysisLimits(freshEnv));
   if(analysisRequestHash(input.request,freshIdentity,{responseModel:freshEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:freshEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')})!==generationHash)return fail('keyword_learning_state_conflict',409);
   await options.assertBeforeReservation?.();
   assertProviderMetadataFresh(providerMetadata,deps.now());
   if(input.action==='preflight')return response({preflight:true,maximumUsd,requestHash,executionIdentity:identity,providerMetadata,providerCall:false,reserved:false});
   const reservation=unwrap(await db.rpc('reserve_keyword_learning_call',{
    p_session_id:input.sessionId,p_call_key:input.request.key,p_source_ordinal:input.sourceOrdinal,p_source_hash:input.sourceHash,
    p_model:input.model,p_execution_identity:identity,p_request_hash:requestHash,p_maximum_usd:maximumUsd,
    p_request:{request:input.request,originalKey:input.originalKey??null,generationHash},
   })) as Reservation;
   if(!reservation.claimed)return response({...reservation,cached:!!reservation.result,providerCall:false},reservation.call.actual_usd===null?202:200);
   let result:GenerationResult,providerInvoked=false;
   try{
    await options.assertBeforeReservation?.();
    if(await sourceFor(db,input)!==sourceOwner)return fail('keyword_learning_source_changed',409);
    const dispatchEnv=analysisRuntimeEnv(deps.env,input.model,1),dispatchIdentity=analysisExecutionIdentity(dispatchEnv,analysisLimits(dispatchEnv));
    if(analysisRequestHash(input.request,dispatchIdentity,{responseModel:dispatchEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:dispatchEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')})!==generationHash)throw new AnalysisError('keyword_learning_state_conflict');
    assertProviderMetadataFresh(providerMetadata,deps.now());providerInvoked=true;result=await deps.generator(env)(input.request);}
   catch(error){
    const code=error instanceof AnalysisError||error instanceof CollectionError?error.code:'analysis_generation_failed';
    const binding={p_session_id:input.sessionId,p_call_key:input.request.key,p_call_id:reservation.call.id,p_lease_token:reservation.call.lease_token,p_request_hash:requestHash,p_error_code:code};
    let saved:unknown;
    if(error instanceof AnalysisProviderHttpError&&error.diagnostic){
     const attachment=finiteDiagnosticAttachment({sessionId:input.sessionId,callId:reservation.call.id,leaseToken:reservation.call.lease_token,requestHash,attemptNumber:reservation.call.attempt_number},error.diagnostic);
     saved=unwrap(await db.rpc('record_keyword_learning_failure_with_diagnostic',{...binding,p_attempt_number:reservation.call.attempt_number,p_diagnostic:attachment.diagnostic}));
    }else saved=unwrap(await db.rpc('record_keyword_learning_call',{...binding,p_result:null}));
    return response({...saved as object,providerCall:providerInvoked},202);
   }
   const saved=unwrap(await db.rpc('record_keyword_learning_call',{p_session_id:input.sessionId,p_call_key:input.request.key,p_call_id:reservation.call.id,p_lease_token:reservation.call.lease_token,p_request_hash:requestHash,p_result:result,p_error_code:result.validationError??null}));
   return response({...saved,providerCall:true});
  }catch(error){
   if(error instanceof AnalysisError)return response({error:{code:error.code,message:'The private evaluation failed its model or capacity preflight.'}},error.code==='analysis_input_limit'?413:error.code==='analysis_call_limit'?402:503);
   return errorResponse(error);
  }
 };
}
