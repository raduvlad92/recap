import {createHash} from 'node:crypto';
import {database,requireAdmin} from './admin-data';
import {analysisWorkerAuthorized,analysisRequestHash} from './content-analysis';
import {analysisRuntimeEnv} from './content-analysis-runtime';
import {analysisExecutionIdentity,analysisLimits,AnalysisError} from './content-analysis-model';
import {CollectionError,errorResponse,json,readTextLimited,runtimeEnv,type Env} from './security';
import {KEYWORD_PRODUCTION_CONTRACT_HASH,planKeywordProductionChunks,keywordProductionExtractionCalls,keywordProductionCheckerCall,finalizeKeywordProductionChunk,mergeKeywordProductionChunks,applyKeywordProductionTimingReviews,validateKeywordProductionSectionSweepChunks} from './keyword-production';
import {readKeywordProductionStored,verifyKeywordProductionStoredCall,canonicalKeywordProductionJson as stable} from './keyword-production-handler';
import {KEYWORD_RECOVERY_CONTRACT_HASH,KEYWORD_RECOVERY_REUSABLE_V4,keywordRecoveryHash,keywordRecoveryRequests,decodeKeywordRecoveryDecisions,applyKeywordRecovery,applyKeywordRecoveryContextReviews} from './keyword-recovery';
import type {SourceUpdate} from '../../../src/lib/types';

type DB=ReturnType<typeof database>;
type Row=Record<string,any>;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,DIGEST=/^[a-f0-9]{64}$/;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const fail=(code:string,status=409):never=>{throw new CollectionError(status,code,'The finite keyword recovery could not proceed.');};
function unwrap<T>(r:{data:T;error:{code?:string}|null}):T{if(r.error)return fail(r.error.code==='PT403'?'keyword_recovery_not_released':'keyword_recovery_storage_conflict',r.error.code==='PT403'?403:409);return r.data;}
function requestProof(body:Row,env:Env){
 const modelEnv=analysisRuntimeEnv(env,body.model,1),identity=analysisExecutionIdentity(modelEnv,analysisLimits(modelEnv));
 const generationHash=analysisRequestHash(body.request,identity,{responseModel:modelEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:modelEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')});
 return{requestHash:sha(JSON.stringify({generationHash,sourceOrdinal:body.sourceOrdinal,sourceHash:body.sourceHash,originalKey:body.originalKey??null,key:body.request.key})),requestPayload:{request:body.request,originalKey:body.originalKey??null,generationHash},executionIdentity:identity};
}
const manifestFor=(plans:ReturnType<typeof keywordRecoveryRequests>,ordinal:number,env:Env)=>plans.map(p=>({sourceOrdinal:ordinal,batchIndex:p.batchIndex,callKey:p.body.request.key,model:p.body.model,...requestProof(p.body,env)}));
async function verifiedRepairs(db:DB,session:Row,release:Row,slot:Row,plans:ReturnType<typeof keywordRecoveryRequests>,env:Env){
 const manifest=manifestFor(plans,slot.ordinal,env),allowed=release.recovery_requests.filter((r:Row)=>r.sourceOrdinal===slot.ordinal).sort((a:Row,b:Row)=>a.batchIndex-b.batchIndex);
 if(stable(allowed)!==stable(manifest))return fail('keyword_recovery_plan_changed');
 const stored=await readKeywordProductionStored(db,session.id,slot.ordinal),decisions=[],receipts:Row[]=[],proofs:Row[]=[];
 if(stored.requests.size!==plans.length)return fail('keyword_recovery_call_not_settled');
 for(const[i,plan]of plans.entries()){
  const expected=manifest[i],r=stored.requests.get(plan.body.request.key),c=r&&stored.charges.get(r.call_id);
  if(!r||!c||!r.completed||r.error_code||!r.result?.providerId||r.result.validationError||c.state!=='settled'||c.actual_usd===null||!Number.isFinite(Number(c.actual_usd))||Number(c.actual_usd)<0||Number(c.actual_usd)>.10)return fail('keyword_recovery_call_not_settled');
  if(r.session_id!==session.id||r.source_hash!==slot.sourceHash||r.source_ordinal!==slot.ordinal||r.request_hash!==expected.requestHash||c.request_hash!==expected.requestHash||stable(r.request_payload)!==stable(expected.requestPayload)||stable(c.execution_identity)!==stable(expected.executionIdentity)||stable(r.result.executionIdentity)!==stable(expected.executionIdentity)||c.user_id!==session.user_id||c.model!==plan.body.model||c.source_revision!==slot.sourceHash||Number(c.actual_usd)!==Number(r.result.actualUsd))return fail('keyword_recovery_call_binding_changed');
  decisions.push(...decodeKeywordRecoveryDecisions(r.result.value,plan.targetStart,plan.targetCount));
  const receipt={chunkIndex:i,role:'repair',callId:c.id,requestHash:r.request_hash};receipts.push(receipt);proofs.push({...receipt,requestPayloadHash:keywordRecoveryHash(r.request_payload),resultHash:keywordRecoveryHash(r.result),callBindingHash:keywordRecoveryHash(c),executionIdentityHash:keywordRecoveryHash(c.execution_identity),actualUsd:Number(c.actual_usd)});
 }
 return{decisions,receipts,proofs,manifestHash:keywordRecoveryHash(manifest)};
}
interface Dependencies{env:Env;db:()=>DB;authorize:typeof requireAdmin;workerAuthorized:typeof analysisWorkerAuthorized}
export function createKeywordRecoveryHandler(overrides:Partial<Dependencies>={}){
 const deps:Dependencies={env:runtimeEnv,db:()=>database(overrides.env||runtimeEnv),authorize:requireAdmin,workerAuthorized:analysisWorkerAuthorized,...overrides};
 const response=(v:unknown,status=200)=>{const r=json(v,status);r.headers.set('cache-control','private, no-store');r.headers.set('x-robots-tag','noindex, nofollow');return r;};
 return async(request:Request):Promise<Response>=>{
  try{
   if(request.method!=='POST')return response({error:{code:'method_not_allowed'}},405);
   if(!deps.workerAuthorized(request,deps.env))await deps.authorize(request,deps.env);
   const app=deps.env('APP_URL');if(!app||new URL(app).protocol!=='https:'||new URL(request.url).origin!==new URL(app).origin)return fail('keyword_recovery_origin_required',403);
   if(!request.headers.get('content-type')?.includes('application/json'))return fail('json_required',415);
   let input:Row;try{input=JSON.parse(await readTextLimited(new Response(request.body),4096));}catch{return fail('keyword_recovery_invalid_input',400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['action','sessionId','sourceOrdinal','expectedOutputHash'].includes(k))||!['plan','preview','publish','read'].includes(input.action)||!UUID.test(input.sessionId)||!Number.isInteger(input.sourceOrdinal)||input.sourceOrdinal<1||input.sourceOrdinal>1000)return fail('keyword_recovery_invalid_input',400);
   const db=deps.db();
   if(input.action==='read'){
    const pub=unwrap(await db.from('keyword_production_publications').select('user_id,update_id,receipt').eq('session_id',input.sessionId).eq('source_ordinal',input.sourceOrdinal).single()) as Row;
    if(!pub)return fail('keyword_recovery_not_published',404);
    const row=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',pub.user_id).eq('id',pub.update_id).single()) as Row;
    if(!row?.record)return fail('keyword_recovery_source_deleted',404);
    const r=row.record;return response({receipt:pub.receipt,reader:{videoKeywords:r.videoKeywords,topics:r.topics,brands:r.brands,keywordRuleVersion:r.keywordRuleVersion,keywordContentHash:r.keywordContentHash,processing:r.processing}});
   }
   const session=unwrap(await db.from('keyword_learning_sessions').select('*').eq('id',input.sessionId).single()) as Row,release=unwrap(await db.from('keyword_production_releases').select('*').eq('session_id',input.sessionId).single()) as Row;
   const planning=input.action==='plan',allowed=planning?['staged','released']:['released'];
   if(!session?.user_id||!release||!allowed.includes(session.state)||session.state!==release.state||!Number.isFinite(Date.parse(session.expires_at))||Date.parse(session.expires_at)<=Date.now()||release.contract_hash!==KEYWORD_RECOVERY_CONTRACT_HASH||!UUID.test(release.origin_session_id)||!DIGEST.test(release.baseline_contract_hash)||release.origin_session_id===session.id)return fail('keyword_recovery_not_released',403);
   const slots=release.sources.filter((s:Row)=>s.ordinal===input.sourceOrdinal),slot=slots[0];
   if(slots.length!==1||slot.baselineGenerationContractHash!==KEYWORD_PRODUCTION_CONTRACT_HASH||!session.sources.some((s:Row)=>s.ordinal===slot.ordinal&&s.updateId===slot.updateId&&s.sourceHash===slot.sourceHash))return fail('keyword_recovery_source_changed');
   const origin=unwrap(await db.from('keyword_learning_sessions').select('*').eq('id',release.origin_session_id).single()) as Row,originRelease=unwrap(await db.from('keyword_production_releases').select('*').eq('session_id',release.origin_session_id).single()) as Row;
   if(origin?.state!=='closed'||origin.user_id!==session.user_id||originRelease?.state!=='closed'||originRelease.contract_hash!==release.baseline_contract_hash||!origin.sources.some((s:Row)=>s.ordinal===slot.ordinal&&s.updateId===slot.updateId&&s.sourceHash===slot.sourceHash))return fail('keyword_recovery_origin_changed');
   const row=unwrap(await db.from('reader_source_updates').select('record').eq('user_id',session.user_id).eq('id',slot.updateId).single()) as Row;
   if(typeof row?.record?.content!=='string'||sha(row.record.content)!==slot.sourceHash)return fail('keyword_recovery_source_changed');
   const update=row.record as SourceUpdate,chunks=planKeywordProductionChunks(update),sectionSweepChunks=validateKeywordProductionSectionSweepChunks(update,slot.sectionSweepChunks);
   if(chunks.length!==slot.chunkCount)return fail('keyword_recovery_source_changed');
   const stored=await readKeywordProductionStored(db,origin.id,slot.ordinal),ctx={session:origin,slot,update,chunks,sectionSweepChunks},receipts:Row[]=[],results=[];
   for(const chunk of chunks){
    const[a,b]=keywordProductionExtractionCalls(update,chunk,sectionSweepChunks),direct=verifyKeywordProductionStoredCall(ctx,stored,a,deps.env),typed=verifyKeywordProductionStoredCall(ctx,stored,b,deps.env),checker=keywordProductionCheckerCall(update,chunk,{direct:direct.value,type_sweep:typed.value},slot.checkerPolicy,sectionSweepChunks),checked=verifyKeywordProductionStoredCall(ctx,stored,checker,deps.env);
    receipts.push(direct.receipt,typed.receipt,checked.receipt);results.push(finalizeKeywordProductionChunk(update,chunk,{direct:direct.value,type_sweep:typed.value,checker:checked.value},slot.checkerPolicy,sectionSweepChunks));
   }
   receipts.sort((a,b)=>a.chunkIndex-b.chunkIndex||a.role.localeCompare(b.role));
   let baseline=applyKeywordRecoveryContextReviews(update,applyKeywordProductionTimingReviews(update,mergeKeywordProductionChunks(update,results),slot.timingReviews),slot.contextReviews);
   const originalBaselineOutputHash=keywordRecoveryHash(baseline),baselineReceiptHash=keywordRecoveryHash(receipts);
   if(slot.reuseRecovery!==undefined){
    const reuse=slot.reuseRecovery,v4=KEYWORD_RECOVERY_REUSABLE_V4;
    if(!reuse||typeof reuse!=='object'||Array.isArray(reuse)||Object.keys(reuse).sort().join(',')!=='contractHash,outputHash,sessionId,version'||Object.values(reuse).some(v=>typeof v!=='string')||!UUID.test(reuse.sessionId)||[session.id,origin.id].includes(reuse.sessionId)||reuse.contractHash!==v4.contractHash||reuse.version!==v4.version||!DIGEST.test(reuse.outputHash))return fail('keyword_recovery_reuse_invalid');
    const oldSession=unwrap(await db.from('keyword_learning_sessions').select('*').eq('id',reuse.sessionId).single()) as Row,oldRelease=unwrap(await db.from('keyword_production_releases').select('*').eq('session_id',reuse.sessionId).single()) as Row;
    if(oldSession?.state!=='closed'||oldSession.user_id!==session.user_id||oldRelease?.state!=='closed'||oldRelease.contract_hash!==v4.contractHash||oldRelease.origin_session_id!==release.origin_session_id||oldRelease.baseline_contract_hash!==release.baseline_contract_hash||!oldSession.sources?.some((s:Row)=>s.ordinal===slot.ordinal&&s.updateId===slot.updateId&&s.sourceHash===slot.sourceHash))return fail('keyword_recovery_reuse_binding_changed');
    const oldSlots=oldRelease.sources.filter((s:Row)=>s.ordinal===slot.ordinal),oldSlot=oldSlots[0],fields=['ordinal','updateId','sourceHash','sourceRevision','sourceFingerprint','keywordSnapshotHash','chunkCount','baselineGenerationContractHash','checkerPolicy','sectionSweepChunks','timingReviews','contextReviews'];
    if(oldSlots.length!==1||oldSlot.reuseRecovery!==undefined||fields.some(k=>stable(oldSlot[k])!==stable(slot[k]))||oldSlot.baselineOutputHash!==originalBaselineOutputHash||stable(oldSlot.baselineReceipts)!==stable(receipts))return fail('keyword_recovery_reuse_baseline_changed');
    const oldPlans=keywordRecoveryRequests(update,oldSlot.repairs,{sessionId:oldSession.id,ordinal:slot.ordinal,sourceHash:slot.sourceHash,baselineReceiptHash},'v4'),old=await verifiedRepairs(db,oldSession,oldRelease,oldSlot,oldPlans,deps.env);
    baseline=applyKeywordRecovery(update,baseline,oldSlot.repairs,old.decisions,{originSessionId:origin.id,baselineContractHash:release.baseline_contract_hash,baselineReceiptHash,baselineOutputHash:originalBaselineOutputHash});
    Object.assign(baseline.evidence,{recoveryProtocol:v4.version,recoveryContractHash:v4.contractHash});
    if(keywordRecoveryHash(baseline)!==reuse.outputHash)return fail('keyword_recovery_reuse_output_changed');
    baseline.evidence.reusedRecoveryProof={policy:{...reuse},sourceBinding:{ordinal:slot.ordinal,updateId:slot.updateId,sourceHash:slot.sourceHash,originSessionId:origin.id,baselineContractHash:release.baseline_contract_hash},closedSession:true,closedRelease:true,baselinePolicyHash:keywordRecoveryHash(Object.fromEntries(fields.map(k=>[k,oldSlot[k]]))),targetsHash:keywordRecoveryHash(oldSlot.repairs),sealedRequestsHash:old.manifestHash,originalBaselineOutputHash,baselineReceiptHash,calls:old.proofs,verification:'host-verified-single-v4-prefix-not-database-native-proof'};
   }
   const baselineOutputHash=keywordRecoveryHash(baseline),plans=keywordRecoveryRequests(update,slot.repairs,{sessionId:session.id,ordinal:slot.ordinal,sourceHash:slot.sourceHash,baselineReceiptHash}),manifest=manifestFor(plans,slot.ordinal,deps.env);
   if(planning){
    const sealed=unwrap(await db.rpc('seal_keyword_recovery_plan',{p_session_id:session.id,p_source_ordinal:slot.ordinal,p_baseline_calls:receipts,p_baseline_output_hash:baselineOutputHash,p_requests:manifest}));
    return response({contractHash:KEYWORD_RECOVERY_CONTRACT_HASH,baselineOutputHash,baselineReceiptHash,baselineCalls:receipts,requests:plans.map(p=>p.body),sealed});
   }
   if(slot.baselineOutputHash!==baselineOutputHash||stable(slot.baselineReceipts)!==stable(receipts))return fail('keyword_recovery_baseline_changed');
   const fresh=await verifiedRepairs(db,session,release,slot,plans,deps.env),decisions=fresh.decisions,allReceipts=[...receipts,...fresh.receipts];
   const output=applyKeywordRecovery(update,baseline,slot.repairs,decisions,{originSessionId:origin.id,baselineContractHash:release.baseline_contract_hash,baselineReceiptHash,baselineOutputHash}),outputHash=keywordRecoveryHash(output);
   if(input.action==='preview')return response({contractHash:KEYWORD_RECOVERY_CONTRACT_HASH,baselineOutputHash,baselineReceiptHash,outputHash,output,calls:allReceipts});
   if(input.expectedOutputHash!==outputHash||slot.reviewedOutputHash!==outputHash||!DIGEST.test(slot.semanticReviewHash))return fail('keyword_recovery_reviewed_output_changed');
   const receipt=unwrap(await db.rpc('publish_keyword_recovery_result',{p_session_id:session.id,p_source_ordinal:slot.ordinal,p_contract_hash:KEYWORD_RECOVERY_CONTRACT_HASH,p_calls:allReceipts,p_output:output}));
   return response({published:true,outputHash,receipt});
  }catch(error){if(error instanceof AnalysisError)return response({error:{code:error.code}},409);return errorResponse(error);}
 };
}
