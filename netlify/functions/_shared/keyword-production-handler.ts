import { createHash } from 'node:crypto';
import { database, requireAdmin } from './admin-data';
import { analysisWorkerAuthorized, analysisRequestHash } from './content-analysis';
import { analysisExecutionIdentity, analysisLimits, AnalysisError, type GenerationResult } from './content-analysis-model';
import { analysisRuntimeEnv } from './content-analysis-runtime';
import { CollectionError, errorResponse, json, readTextLimited, runtimeEnv, type Env } from './security';
import type { SourceUpdate } from '../../../src/lib/types';
import { KEYWORD_PRODUCTION_CONTRACT_HASH, planKeywordProductionChunks, keywordProductionExtractionCalls, keywordProductionCheckerCall, finalizeKeywordProductionChunk, mergeKeywordProductionChunks, type KeywordProductionCall } from './keyword-production';

type DB=ReturnType<typeof database>;
type Row=Record<string,any>;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function canonicalKeywordProductionJson(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonicalKeywordProductionJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalKeywordProductionJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const stable=canonicalKeywordProductionJson;
const fail=(code:string,status=409):never=>{throw new CollectionError(status,code,'The bounded keyword rollout could not proceed.');};
function unwrap<T>(value:{data:T;error:{code?:string}|null}):T {
 if(value.error)return fail(value.error.code==='PT403'?'keyword_production_not_released':value.error.code==='PT400'?'keyword_production_invalid_result':'keyword_production_storage_conflict',value.error.code==='PT403'?403:409);
 return value.data;
}
const response=(value:unknown,status=200)=>{const r=json(value,status);r.headers.set('cache-control','private, no-store');r.headers.set('x-robots-tag','noindex, nofollow');return r;};
interface Context {session:Row;slot:Row;update:SourceUpdate;chunks:ReturnType<typeof planKeywordProductionChunks>}
interface Stored {requests:Map<string,Row>;charges:Map<string,Row>}

/** Request plans are server-authored. The client chooses only an admitted
 * source/chunk, never a prompt, model, output, accepted label or price. */
export function bindKeywordProductionCall(sessionId:string,ordinal:number,sourceHash:string,call:KeywordProductionCall) {
 const key='keyword-learning:v1:'+hash(stable({contractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,sessionId,ordinal,sourceHash,chunkIndex:call.chunkIndex,step:call.step,model:call.model,request:call.request}));
 return {action:'generate',sessionId,sourceOrdinal:ordinal,sourceHash,model:call.model,originalKey:call.request.key,request:{...call.request,key}};
}
async function contextFor(db:DB,sessionId:string,ordinal:number):Promise<Context> {
 const session=unwrap(await db.from('keyword_learning_sessions').select('*').eq('id',sessionId).single()) as Row;
 const release=unwrap(await db.from('keyword_production_releases').select('*').eq('session_id',sessionId).single()) as Row;
 if(!session||session.state!=='released'||!session.user_id||Date.parse(session.expires_at)<=Date.now()||!release||release.state!=='released'||release.contract_hash!==KEYWORD_PRODUCTION_CONTRACT_HASH)return fail('keyword_production_not_released',403);
 const slots=(release.sources as Row[]).filter(s=>s.ordinal===ordinal),slot=slots[0];
 if(slots.length!==1||!(session.sources as Row[]).some(s=>s.ordinal===ordinal&&s.updateId===slot.updateId&&s.sourceHash===slot.sourceHash))return fail('keyword_production_source_changed');
 const row=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',session.user_id).eq('id',slot.updateId).single()) as Row;
 if(!row?.record||typeof row.record.content!=='string'||hash(row.record.content)!==slot.sourceHash)return fail('keyword_production_source_changed');
 const update=row.record as SourceUpdate,chunks=planKeywordProductionChunks(update);
 if(chunks.length!==slot.chunkCount)return fail('keyword_production_source_changed');
 return {session,slot,update,chunks};
}
async function storedFor(db:DB,sessionId:string,ordinal:number):Promise<Stored> {
 const requests=unwrap(await db.from('keyword_learning_requests').select('*').eq('session_id',sessionId).eq('source_ordinal',ordinal)) as Row[];
 if(!requests.length)return {requests:new Map(),charges:new Map()};
 const charges=unwrap(await db.from('reader_content_analysis_calls').select('*').in('id',requests.map(r=>r.call_id))) as Row[];
 return {requests:new Map(requests.map(r=>[r.call_key,r])),charges:new Map(charges.map(c=>[c.id,c]))};
}
function verifiedCall(ctx:Context,stored:Stored,call:KeywordProductionCall,env:Env) {
 const body=bindKeywordProductionCall(ctx.session.id,ctx.slot.ordinal,ctx.slot.sourceHash,call),r=stored.requests.get(body.request.key),c=r&&stored.charges.get(r.call_id);
 if(!r||!c)return fail('keyword_production_call_not_ready');
 if(!r.completed||r.error_code||!r.result||c.state!=='settled'||c.actual_usd===null||!Number.isFinite(Number(c.actual_usd))||Number(c.actual_usd)<0)return fail('keyword_production_call_not_settled');
 const result=r.result as GenerationResult,modelEnv=analysisRuntimeEnv(env,call.model,1),identity=analysisExecutionIdentity(modelEnv,analysisLimits(modelEnv));
 if(r.session_id!==ctx.session.id||r.source_ordinal!==ctx.slot.ordinal||r.source_hash!==ctx.slot.sourceHash||c.user_id!==ctx.session.user_id||c.model!==call.model||c.source_revision!==ctx.slot.sourceHash
  ||stable(r.request_payload?.request)!==stable(body.request)||r.request_payload?.originalKey!==body.originalKey||result.validationError||!result.providerId
  ||stable(c.execution_identity)!==stable(identity)||stable(result.executionIdentity)!==stable(identity)||Number(result.actualUsd)!==Number(c.actual_usd))return fail('keyword_production_call_binding_changed');
 const generationHash=analysisRequestHash(body.request,identity,{responseModel:modelEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:modelEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')});
 const requestHash=hash(JSON.stringify({generationHash,sourceOrdinal:ctx.slot.ordinal,sourceHash:ctx.slot.sourceHash,originalKey:body.originalKey??null,key:body.request.key}));
 if(r.request_payload.generationHash!==generationHash||r.request_hash!==requestHash||c.request_hash!==requestHash)return fail('keyword_production_call_binding_changed');
 return {value:result.value,receipt:{chunkIndex:call.chunkIndex,role:call.step==='type_sweep'?'typed':call.step,callId:c.id,requestHash}};
}
interface Dependencies {env:Env;db:()=>DB;authorize:typeof requireAdmin;workerAuthorized:typeof analysisWorkerAuthorized}
export function createKeywordProductionHandler(overrides:Partial<Dependencies>={}) {
 const deps:Dependencies={env:runtimeEnv,db:()=>database(overrides.env||runtimeEnv),authorize:requireAdmin,workerAuthorized:analysisWorkerAuthorized,...overrides};
 return async(request:Request):Promise<Response>=>{
  try{
   if(request.method!=='POST')return response({error:{code:'method_not_allowed'}},405);
   if(!deps.workerAuthorized(request,deps.env))await deps.authorize(request,deps.env);
   const app=deps.env('APP_URL');if(!app||new URL(app).protocol!=='https:'||new URL(request.url).origin!==new URL(app).origin)return fail('keyword_production_origin_required',403);
   if(!request.headers.get('content-type')?.includes('application/json'))return fail('json_required',415);
   let input:Row;try{input=JSON.parse(await readTextLimited(new Response(request.body),4096));}catch{return fail('keyword_production_invalid_input',400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','sessionId','sourceOrdinal','chunkIndex','stage','expectedOutputHash'].includes(k))
    ||!['plan','preview','publish','read'].includes(input.action)||!UUID.test(input.sessionId)||!Number.isSafeInteger(input.sourceOrdinal)||input.sourceOrdinal<1||input.sourceOrdinal>1000)return fail('keyword_production_invalid_input',400);
   const db=deps.db();
   if(input.action==='read'){
    const saved=unwrap(await db.from('keyword_production_publications').select('user_id,update_id,receipt').eq('session_id',input.sessionId).eq('source_ordinal',input.sourceOrdinal).single()) as Row;
    if(!saved)return fail('keyword_production_not_published',404);
    const current=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',saved.user_id).eq('id',saved.update_id).single()) as Row;
    if(!current?.record)return fail('keyword_production_source_deleted',404);
    const r=current.record;return response({receipt:saved.receipt,reader:{videoKeywords:r.videoKeywords,topics:r.topics,brands:r.brands,keywordRuleVersion:r.keywordRuleVersion,keywordContentHash:r.keywordContentHash,processing:r.processing}});
   }
   const ctx=await contextFor(db,input.sessionId,input.sourceOrdinal);
   if(input.action==='plan'){
    if(!Number.isSafeInteger(input.chunkIndex)||input.chunkIndex<0||!ctx.chunks[input.chunkIndex]||!['extractors','checker'].includes(input.stage))return fail('keyword_production_invalid_input',400);
    const chunk=ctx.chunks[input.chunkIndex],extractions=keywordProductionExtractionCalls(ctx.update,chunk);
    if(input.stage==='extractors')return response({contractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,chunkCount:ctx.chunks.length,calls:extractions.map(c=>bindKeywordProductionCall(input.sessionId,input.sourceOrdinal,ctx.slot.sourceHash,c))});
    const stored=await storedFor(db,input.sessionId,input.sourceOrdinal),direct=verifiedCall(ctx,stored,extractions[0],deps.env).value,type_sweep=verifiedCall(ctx,stored,extractions[1],deps.env).value;
    const checker=keywordProductionCheckerCall(ctx.update,chunk,{direct,type_sweep});
    return response({contractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,chunkCount:ctx.chunks.length,calls:[bindKeywordProductionCall(input.sessionId,input.sourceOrdinal,ctx.slot.sourceHash,checker)]});
   }
   const stored=await storedFor(db,input.sessionId,input.sourceOrdinal),receipts:Row[]=[],results=[];
   for(const chunk of ctx.chunks){
    const [a,b]=keywordProductionExtractionCalls(ctx.update,chunk),direct=verifiedCall(ctx,stored,a,deps.env),typed=verifiedCall(ctx,stored,b,deps.env);
    const check=keywordProductionCheckerCall(ctx.update,chunk,{direct:direct.value,type_sweep:typed.value}),checked=verifiedCall(ctx,stored,check,deps.env);
    receipts.push(direct.receipt,typed.receipt,checked.receipt);
    results.push(finalizeKeywordProductionChunk(ctx.update,chunk,{direct:direct.value,type_sweep:typed.value,checker:checked.value}));
   }
   const output=mergeKeywordProductionChunks(ctx.update,results),outputHash=hash(stable(output));
   if(input.action==='preview')return response({contractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,outputHash,output,calls:receipts});
   if(input.expectedOutputHash!==outputHash)return fail('keyword_production_reviewed_output_changed');
   const receipt=unwrap(await db.rpc('publish_keyword_production_result',{p_session_id:input.sessionId,p_source_ordinal:input.sourceOrdinal,p_contract_hash:KEYWORD_PRODUCTION_CONTRACT_HASH,p_calls:receipts,p_output:output}));
   return response({published:true,outputHash,receipt});
  }catch(error){if(error instanceof AnalysisError)return response({error:{code:error.code}},409);return errorResponse(error);}
 };
}
