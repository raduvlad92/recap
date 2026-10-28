import {createHash} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {CollectionError} from '../netlify/functions/_shared/security';
import {createKeywordRecoveryHandler} from '../netlify/functions/_shared/keyword-recovery-handler';
import {bindKeywordProductionCall,canonicalKeywordProductionJson as stable} from '../netlify/functions/_shared/keyword-production-handler';
import {KEYWORD_PRODUCTION_CONTRACT_HASH,planKeywordProductionChunks,keywordProductionExtractionCalls,keywordProductionCheckerCall,finalizeKeywordProductionChunk,mergeKeywordProductionChunks,applyKeywordProductionTimingReviews} from '../netlify/functions/_shared/keyword-production';
import {KEYWORD_RECOVERY_CONTRACT_HASH,KEYWORD_RECOVERY_REUSABLE_V4,keywordRecoveryHash,keywordRecoveryRequests,applyKeywordRecovery} from '../netlify/functions/_shared/keyword-recovery';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import {analysisExecutionIdentity,analysisLimits} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRequestHash} from '../netlify/functions/_shared/content-analysis';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const sid='12345678-1234-1234-1234-123456789012',originId='87654321-4321-4321-4321-210987654321',owner='synthetic-owner';
const baselineContractHash='a'.repeat(64),semanticReviewHash='b'.repeat(64);
const update:SourceUpdate={id:'synthetic-video',sourceId:'synthetic-source',contributorIds:[],title:'A fixture',summary:'',url:'https://example.test/video',publishedAt:'2026-10-28T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content:'AeroBox runs NovaPay. Project Ember exists.'};
const sourceHash=hash(update.content!);
const target={name:'Project Ember',contexts:[{start:0,end:update.content!.length,text:update.content!}]};
const approved={readComplete:true,decisions:[{targetId:0,kind:'organization',disposition:'accepted'}]};

function fixture(repairs:unknown[]=[structuredClone(target)],sourceUpdate:SourceUpdate=update){
 const update=sourceUpdate,sourceHash=hash(update.content!);
 const env=(key:string)=>key==='APP_URL'?'https://example.test':undefined;
 const source={ordinal:1,updateId:update.id,sourceHash};
 const slot:any={...source,chunkCount:1,baselineGenerationContractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,repairs};
 const current:any={id:sid,user_id:owner,state:'released',expires_at:'2099-01-01T00:00:00Z',sources:[source]};
 const origin:any={id:originId,user_id:owner,state:'closed',expires_at:'2026-10-27T00:00:00Z',sources:[structuredClone(source)]};
 const release:any={session_id:sid,state:'released',contract_hash:KEYWORD_RECOVERY_CONTRACT_HASH,origin_session_id:originId,baseline_contract_hash:baselineContractHash,sources:[slot],recovery_requests:[]};
 const originRelease:any={session_id:originId,state:'closed',contract_hash:baselineContractHash,sources:[{...source,chunkCount:1}]};
 const tables:Record<string,any[]>={
  keyword_learning_sessions:[current,origin],keyword_production_releases:[release,originRelease],
  reader_source_updates:[{id:update.id,user_id:owner,record:structuredClone(update)}],
  keyword_learning_requests:[],reader_content_analysis_calls:[],
  keyword_production_publications:[{session_id:sid,source_ordinal:1,user_id:owner,update_id:update.id,receipt:{published:true,keywordCount:3}}],
 };
 const queries:{table:string;filters:[string,unknown][]}[]=[];
 const from=vi.fn((name:string)=>{
  let rows=tables[name]??[];const filters:[string,unknown][]=[];
  const finish=()=>{queries.push({table:name,filters:structuredClone(filters)});return {data:rows,error:null};};
  const chain:any={select:()=>chain,eq:(key:string,value:unknown)=>{filters.push([key,value]);rows=rows.filter(row=>row[key]===value);return chain;},in:(key:string,values:unknown[])=>{filters.push([key,values]);rows=rows.filter(row=>values.includes(row[key]));return chain;},single:async()=>{finish();return {data:rows[0]??null,error:null};},then:(yes:any,no:any)=>Promise.resolve(finish()).then(yes,no)};
  return chain;
 });
 const rpc=vi.fn(async(name:string,args:any)=>{
  if(name==='seal_keyword_recovery_plan'){
   slot.baselineOutputHash=args.p_baseline_output_hash;slot.baselineReceipts=structuredClone(args.p_baseline_calls);
   release.recovery_requests=structuredClone(args.p_requests);
   return {data:{sealed:true,requestCount:args.p_requests.length},error:null};
  }
  return {data:{published:true,keywordCount:3},error:null};
 });
 const db=vi.fn(()=>({from,rpc}) as never),authorize=vi.fn(async()=>owner),workerAuthorized=vi.fn(()=>true);
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Synthetic recovery tests cannot contact a provider or database.'));
 const handler=createKeywordRecoveryHandler({env,db,authorize,workerAuthorized});
 const send=(input:any,url='https://example.test/.netlify/functions/keyword-recovery')=>handler(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sid,sourceOrdinal:1,...input})}));
 const add=(bound:any,value:unknown)=>{
  const modelEnv=analysisRuntimeEnv(env,bound.model,1),identity=analysisExecutionIdentity(modelEnv,analysisLimits(modelEnv));
  const generationHash=analysisRequestHash(bound.request,identity,{responseModel:modelEnv('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL'),providerName:modelEnv('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')});
  const requestHash=hash(JSON.stringify({generationHash,sourceOrdinal:1,sourceHash,originalKey:bound.originalKey??null,key:bound.request.key}));
  const id='00000000-0000-0000-0000-'+String(tables.keyword_learning_requests.length+1).padStart(12,'0');
  const result={value:structuredClone(value),actualUsd:.001,providerId:'gen-synthetic',executionIdentity:structuredClone(identity)};
  const request={session_id:bound.sessionId,source_ordinal:1,source_hash:sourceHash,call_key:bound.request.key,call_id:id,request_hash:requestHash,request_payload:{request:structuredClone(bound.request),originalKey:bound.originalKey??null,generationHash},result,error_code:null,completed:true};
  const charge={id,user_id:owner,model:bound.model,source_revision:sourceHash,state:'settled',actual_usd:.001,request_hash:requestHash,execution_identity:structuredClone(identity)};
  tables.keyword_learning_requests.push(request);tables.reader_content_analysis_calls.push(charge);return {request,charge};
 };
 const completeBaseline=(namespace=originId)=>{
  const chunk=planKeywordProductionChunks(update)[0],[a,b]=keywordProductionExtractionCalls(update,chunk),inventory={names:['AeroBox','NovaPay'],uncertainNames:[]};
  add(bindKeywordProductionCall(namespace,1,sourceHash,a),inventory);add(bindKeywordProductionCall(namespace,1,sourceHash,b),inventory);
  const checker=keywordProductionCheckerCall(update,chunk,{direct:inventory,type_sweep:inventory});
  const data=JSON.parse(checker.request.prompt.slice(checker.request.prompt.lastIndexOf('\n')+1));
  const checked={readComplete:true,decisions:data.candidates.map((name:string)=>({name,kind:name==='NovaPay'?'service':'brand',disposition:['AeroBox','NovaPay'].includes(name)?'accepted':'rejected'})),missingNames:[]};
  add(bindKeywordProductionCall(namespace,1,sourceHash,checker),checked);
  return applyKeywordProductionTimingReviews(update,mergeKeywordProductionChunks(update,[finalizeKeywordProductionChunk(update,chunk,{direct:inventory,type_sweep:inventory,checker:checked})]),undefined);
 };
 const seal=async()=>{const response=await send({action:'plan'});expect(response.status).toBe(200);return response.json();};
 const ready=async()=>{const baseline=completeBaseline(),plan=await seal();const fresh=plan.requests.map((call:any)=>add(call,approved));return {baseline,plan,fresh};};
 return {send,handler,tables,current,origin,release,originRelease,slot,from,db,rpc,queries,authorize,workerAuthorized,network,add,completeBaseline,seal,ready,update,sourceHash};
}

function prefixFixture(){
 const names=Array.from({length:36},(_,i)=>'Fixture Entity '+i),text=update.content+' '+names.join('. '),u={...update,content:text};
 const targets=names.map(name=>({name,contexts:[{start:0,end:text.length,text}]})),f=fixture(targets.slice(0,2),u),baseline=f.completeBaseline(),prefixId='abcdefab-1234-1234-1234-123456789012';
 const roles=['direct','typed','checker'],receipts=f.tables.keyword_learning_requests.filter(r=>r.session_id===originId).map((r,i)=>({chunkIndex:0,role:roles[i],callId:r.call_id,requestHash:r.request_hash})).sort((a,b)=>a.role.localeCompare(b.role));
 const baselineOutputHash=keywordRecoveryHash(baseline),baselineReceiptHash=keywordRecoveryHash(receipts),oldSlot={...structuredClone(f.slot),repairs:targets,baselineOutputHash,baselineReceipts:receipts};
 const oldSession:any={id:prefixId,user_id:owner,state:'closed',sources:structuredClone(f.current.sources)},oldRelease:any={session_id:prefixId,state:'closed',contract_hash:KEYWORD_RECOVERY_REUSABLE_V4.contractHash,origin_session_id:originId,baseline_contract_hash:baselineContractHash,sources:[oldSlot],recovery_requests:[]};
 const plans=keywordRecoveryRequests(u,targets,{sessionId:prefixId,ordinal:1,sourceHash:f.sourceHash,baselineReceiptHash},'v4'),allDecisions:any[]=[],oldCalls:any[]=[];
 for(const plan of plans){
  const decisions=Array.from({length:plan.targetCount},(_,i)=>({targetId:plan.targetStart+i,kind:'named_mention',disposition:'accepted'}));allDecisions.push(...decisions);
  const stored=f.add(plan.body,{readComplete:true,decisions});oldCalls.push(stored);oldRelease.recovery_requests.push({sourceOrdinal:1,batchIndex:plan.batchIndex,callKey:plan.body.request.key,model:plan.body.model,requestHash:stored.request.request_hash,requestPayload:structuredClone(stored.request.request_payload),executionIdentity:structuredClone(stored.charge.execution_identity)});
 }
 const oldOutput=applyKeywordRecovery(u,baseline,targets,allDecisions,{originSessionId:originId,baselineContractHash,baselineReceiptHash,baselineOutputHash});Object.assign(oldOutput.evidence,{recoveryProtocol:KEYWORD_RECOVERY_REUSABLE_V4.version,recoveryContractHash:KEYWORD_RECOVERY_REUSABLE_V4.contractHash});
 f.slot.reuseRecovery={sessionId:prefixId,...KEYWORD_RECOVERY_REUSABLE_V4,outputHash:keywordRecoveryHash(oldOutput)};f.tables.keyword_learning_sessions.push(oldSession);f.tables.keyword_production_releases.push(oldRelease);f.current.state=f.release.state='staged';
 return {...f,oldSession,oldRelease,oldSlot,oldCalls,oldOutput,names};
}

afterEach(()=>vi.restoreAllMocks());

describe('finite recovery handler, synthetic adapters only',()=>{
 it('authenticates before database access or plan disclosure',async()=>{
  const f=fixture();f.workerAuthorized.mockReturnValue(false);f.authorize.mockRejectedValue(new CollectionError(403,'admin_required','Admin required.'));
  const response=await f.send({action:'plan'});expect(response.status).toBe(403);expect(f.db).not.toHaveBeenCalled();expect(f.from).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
 });
 it('checks the deployment origin before touching the database',async()=>{
  const f=fixture();expect((await f.send({action:'plan'},'https://foreign.test/.netlify/functions/keyword-recovery')).status).toBe(403);expect(f.db).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
 });
 it.each(['output','repairs','request','model','semanticReviewHash','reuseRecovery'])('refuses caller-authored %s before database access',async key=>{
  const f=fixture();expect((await f.send({action:'plan',[key]:'caller authored'})).status).toBe(400);expect(f.db).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['session','release'])('requires the original %s to remain closed',async changed=>{
  const f=fixture();f.completeBaseline();(changed==='session'?f.origin:f.originRelease).state='released';
  const response=await f.send({action:'plan'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_origin_changed');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('seals server-authored requests while the new session is staged, without generating or publishing',async()=>{
  const f=fixture();f.completeBaseline();f.current.state=f.release.state='staged';const plan=await f.seal();
  expect(plan.contractHash).toBe(KEYWORD_RECOVERY_CONTRACT_HASH);expect(plan.requests).toHaveLength(1);expect(plan.baselineCalls).toHaveLength(3);
  expect(plan.requests[0]).toMatchObject({sessionId:sid,sourceOrdinal:1,sourceHash,action:'generate'});expect(plan.requests[0].request.key).toMatch(/^keyword-learning:v1:[a-f0-9]{64}$/);
  expect(plan.requests[0].request.prompt).not.toContain('expectedDisposition');expect(plan.requests[0].request.prompt).not.toContain('proposedDecision');
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('seal_keyword_recovery_plan',{p_session_id:sid,p_source_ordinal:1,p_baseline_calls:plan.baselineCalls,p_baseline_output_hash:plan.baselineOutputHash,p_requests:f.release.recovery_requests});
  expect(f.release.recovery_requests[0]).toMatchObject({sourceOrdinal:1,batchIndex:0,callKey:plan.requests[0].request.key,model:plan.requests[0].model});
  expect(f.release.recovery_requests[0].requestPayload.request).toEqual(plan.requests[0].request);expect(f.network).not.toHaveBeenCalled();
  expect((await f.send({action:'preview'})).status).toBe(403);
 });
 it.each(['closed','expired','bad-date'])('refuses new plans for a %s recovery session',async state=>{
  const f=fixture();f.completeBaseline();if(state==='closed')f.current.state=f.release.state='closed';else f.current.expires_at=state==='bad-date'?'invalid-date':'2000-01-01T00:00:00Z';
  const response=await f.send({action:'plan'});expect(response.status).toBe(403);expect((await response.json()).error.code).toBe('keyword_recovery_not_released');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('loads and verifies baseline calls only from the immutable original session namespace',async()=>{
  const f=fixture();f.completeBaseline();const plan=await f.seal();
  const originalIds=f.tables.keyword_learning_requests.filter(r=>r.session_id===originId).map(r=>r.call_id).sort();expect(plan.baselineCalls.map((r:any)=>r.callId).sort()).toEqual(originalIds);
  expect(f.queries.filter(q=>q.table==='keyword_learning_requests')).toEqual([{table:'keyword_learning_requests',filters:[['session_id',originId],['source_ordinal',1]]}]);
  expect(f.tables.keyword_learning_requests.every(r=>r.session_id===originId)).toBe(true);expect(f.network).not.toHaveBeenCalled();
 });
 it('does not treat copied current-namespace calls as original paid evidence',async()=>{
  const f=fixture();f.completeBaseline(sid);const response=await f.send({action:'plan'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_production_call_not_ready');expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['payload','hash','executionIdentity','unknown-charge'])('refuses altered original %s evidence before sealing',async field=>{
  const f=fixture();f.completeBaseline();const request=f.tables.keyword_learning_requests[0],charge=f.tables.reader_content_analysis_calls[0];
  if(field==='payload')request.request_payload.request.prompt+=' Changed.';if(field==='hash')charge.request_hash='f'.repeat(64);if(field==='executionIdentity')request.result.executionIdentity={provider:'different'};if(field==='unknown-charge'){charge.state='unknown';charge.actual_usd=null;}
  expect((await f.send({action:'plan'})).status).toBe(409);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('previews empty repairs with zero new requests and preserves all baseline names',async()=>{
  const f=fixture([]),baseline=f.completeBaseline(),plan=await f.seal();expect(plan.requests).toEqual([]);expect(f.release.recovery_requests).toEqual([]);
  const response=await f.send({action:'preview'}),value=await response.json();expect(response.status).toBe(200);expect(value.calls).toHaveLength(3);expect(value.output.evidence.accepted).toEqual(baseline.evidence.accepted);expect(value.output.pending).toEqual(baseline.pending);expect(value.baselineOutputHash).toBe(keywordRecoveryHash(baseline));expect(f.tables.keyword_learning_requests).toHaveLength(3);expect(f.network).not.toHaveBeenCalled();
 });
 it.each(['baselineOutputHash','baselineReceipts'])('rejects a changed sealed %s',async field=>{
  const f=fixture();await f.ready();f.slot[field]=field==='baselineOutputHash'?'f'.repeat(64):[];
  const response=await f.send({action:'preview'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_baseline_changed');expect(f.rpc.mock.calls.every(([name])=>name==='seal_keyword_recovery_plan')).toBe(true);
 });
 it.each(['absent','changed-payload','changed-hash'])('refuses an %s repair-request admission',async changed=>{
  const f=fixture();await f.ready();if(changed==='absent')f.release.recovery_requests=[];else if(changed==='changed-payload')f.release.recovery_requests[0].requestPayload.request.prompt+=' Changed.';else f.release.recovery_requests[0].requestHash='f'.repeat(64);
  const response=await f.send({action:'preview'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_plan_changed');
 });
 it.each(['payload','source','request-hash','charge-hash','model','user','revision','charge-identity','result-identity','cost-mismatch'])('refuses fresh %s binding tampering',async field=>{
  const f=fixture(),{fresh}=await f.ready(),{request,charge}=fresh[0];
  if(field==='payload')request.request_payload.request.prompt+=' Changed.';if(field==='source')request.source_hash='f'.repeat(64);if(field==='request-hash')request.request_hash='f'.repeat(64);if(field==='charge-hash')charge.request_hash='f'.repeat(64);if(field==='model')charge.model='openai/different-model';if(field==='user')charge.user_id='someone-else';if(field==='revision')charge.source_revision='f'.repeat(64);if(field==='charge-identity')charge.execution_identity={provider:'different'};if(field==='result-identity')request.result.executionIdentity={provider:'different'};if(field==='cost-mismatch')request.result.actualUsd=.002;
  const response=await f.send({action:'preview'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_call_binding_changed');expect(f.network).not.toHaveBeenCalled();
 });
 it.each(['missing','incomplete','error','unknown-charge','no-provider','validation-error'])('refuses %s fresh calls without replacing them with empty success',async state=>{
  const f=fixture(),{fresh}=await f.ready(),{request,charge}=fresh[0];
  if(state==='missing')f.tables.keyword_learning_requests=f.tables.keyword_learning_requests.filter(r=>r!==request);if(state==='incomplete')request.completed=false;if(state==='error')request.error_code='provider_error';if(state==='unknown-charge'){charge.state='unknown';charge.actual_usd=null;}if(state==='no-provider')request.result.providerId='';if(state==='validation-error')request.result.validationError='invalid';
  const response=await f.send({action:'preview'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_call_not_settled');expect(f.network).not.toHaveBeenCalled();
 });
 it.each([-.001,.100001,Number.POSITIVE_INFINITY,Number.NaN])('refuses invalid or over-cap settled repair cost %s',async cost=>{
  const f=fixture(),{fresh}=await f.ready();fresh[0].charge.actual_usd=cost;fresh[0].request.result.actualUsd=cost;
  const response=await f.send({action:'preview'});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('keyword_recovery_call_not_settled');
 });
 it.each([
  {readComplete:false,decisions:approved.decisions},
  {readComplete:true,decisions:[]},
  {readComplete:true,decisions:[{targetId:1,kind:'organization',disposition:'accepted'}]},
  {readComplete:true,decisions:[{targetId:0,kind:'organization',disposition:'accepted',name:'Injected'}]},
 ])('refuses partial or unsealed fresh decision payload %j',async value=>{
  const f=fixture(),{fresh}=await f.ready();fresh[0].request.result.value=value;
  expect((await f.send({action:'preview'})).status).toBe(409);expect(f.rpc.mock.calls.every(([name])=>name==='seal_keyword_recovery_plan')).toBe(true);
 });
 it('changes only admitted target keys, preserving original rows, patch and complete coverage',async()=>{
  const f=fixture(),{baseline}=await f.ready(),before=structuredClone(baseline),response=await f.send({action:'preview'}),value=await response.json();
  expect(response.status).toBe(200);expect(value.output.evidence.accepted.filter((r:any)=>r.label!=='Project Ember')).toEqual(before.evidence.accepted);
  expect(value.output.patch).toEqual(before.patch);expect(value.output.evidence.coverage).toEqual(before.evidence.coverage);expect(value.output.pending).toEqual(before.pending);expect(baseline).toEqual(before);
  expect(value.output.evidence.accepted.find((r:any)=>r.label==='Project Ember')).toMatchObject({literalKind:'organization',disposition:'accepted',ranges:[],timingStatus:'withheld_targeted_correction'});
  expect(value.output.evidence.accepted.find((r:any)=>r.label==='Project Ember').seconds).toBeUndefined();expect(value.calls).toHaveLength(4);expect(value.calls.filter((r:any)=>r.role==='repair')).toHaveLength(1);
  expect(value.outputHash).toBe(hash(stable(value.output)));expect(value.output.evidence.recoveryLineage.originSessionId).toBe(originId);expect(f.network).not.toHaveBeenCalled();
 });
 it('requires matching caller review, sealed output review and independent semantic review before publication',async()=>{
  const f=fixture();await f.ready();const preview=await f.send({action:'preview'}),value=await preview.json();
  expect((await f.send({action:'publish',expectedOutputHash:value.outputHash})).status).toBe(409);
  f.slot.reviewedOutputHash=value.outputHash;expect((await f.send({action:'publish',expectedOutputHash:value.outputHash})).status).toBe(409);
  f.slot.semanticReviewHash=semanticReviewHash;expect((await f.send({action:'publish',expectedOutputHash:'f'.repeat(64)})).status).toBe(409);
  f.slot.reviewedOutputHash='f'.repeat(64);expect((await f.send({action:'publish',expectedOutputHash:value.outputHash})).status).toBe(409);
  f.slot.reviewedOutputHash=value.outputHash;const response=await f.send({action:'publish',expectedOutputHash:value.outputHash});expect(response.status).toBe(200);expect((await response.json()).published).toBe(true);
  expect(f.rpc.mock.calls.filter(([name])=>name==='publish_keyword_recovery_result')).toEqual([['publish_keyword_recovery_result',{p_session_id:sid,p_source_ordinal:1,p_contract_hash:KEYWORD_RECOVERY_CONTRACT_HASH,p_calls:value.calls,p_output:value.output}]]);expect(f.network).not.toHaveBeenCalled();
 });
 it('retains receipt and reader readback after closure without reopening requests or sessions',async()=>{
  const f=fixture();f.current.state=f.release.state='closed';f.tables.reader_source_updates[0].record.videoKeywords=[{label:'AeroBox',ranges:[]}];
  const response=await f.send({action:'read'}),value=await response.json();expect(response.status).toBe(200);expect(value.receipt).toEqual({published:true,keywordCount:3});expect(value.reader.videoKeywords).toEqual([{label:'AeroBox',ranges:[]}]);
  expect(f.from.mock.calls.map(([table])=>table)).toEqual(['keyword_production_publications','reader_source_updates']);expect(f.rpc).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
 });
 it('reconstructs nine closed v4 batches and pays only the two new target decisions',async()=>{
  const f=prefixFixture(),plan=await f.seal();expect(plan.requests).toHaveLength(1);expect(plan.baselineCalls).toHaveLength(3);expect(plan.baselineOutputHash).not.toBe(f.slot.reuseRecovery.outputHash);
  f.add(plan.requests[0],{readComplete:true,decisions:[{targetId:0,kind:'named_mention',disposition:'review'},{targetId:1,kind:'named_mention',disposition:'accepted'}]});f.current.state=f.release.state='released';
  const response=await f.send({action:'preview'}),value=await response.json();expect(response.status).toBe(200);const proof=value.output.evidence.reusedRecoveryProof;
  expect(proof.policy).toEqual(f.slot.reuseRecovery);expect(proof.calls).toHaveLength(9);expect(proof.calls.map((r:any)=>r.callId)).toEqual(f.oldCalls.map(x=>x.charge.id));
  expect(proof.calls[0]).toMatchObject({actualUsd:.001,resultHash:keywordRecoveryHash(f.oldCalls[0].request.result),requestPayloadHash:keywordRecoveryHash(f.oldCalls[0].request.request_payload),callBindingHash:keywordRecoveryHash(f.oldCalls[0].charge),executionIdentityHash:keywordRecoveryHash(f.oldCalls[0].charge.execution_identity)});
  expect(value.output.evidence.accepted.filter((r:any)=>!f.names.slice(0,2).includes(r.label))).toEqual((f.oldOutput.evidence.accepted as any[]).filter(r=>!f.names.slice(0,2).includes(r.label)));
  expect(value.calls).toHaveLength(4);expect(value.calls.filter((r:any)=>r.role==='repair')).toHaveLength(1);expect(value.calls.some((r:any)=>f.oldCalls.some(x=>x.charge.id===r.callId))).toBe(false);
  expect(f.tables.keyword_learning_requests.filter(r=>r.session_id===sid)).toHaveLength(1);expect(f.tables.keyword_learning_requests.filter(r=>r.session_id===f.oldSession.id)).toHaveLength(9);expect(f.network).not.toHaveBeenCalled();
  f.slot.reviewedOutputHash=value.outputHash;f.slot.semanticReviewHash=semanticReviewHash;expect((await f.send({action:'publish',expectedOutputHash:value.outputHash})).status).toBe(200);
  const published=f.rpc.mock.calls.find(([name])=>name==='publish_keyword_recovery_result')![1];expect(published.p_calls).toEqual(value.calls);expect(published.p_output.evidence.reusedRecoveryProof).toEqual(proof);
 });
 it.each(['contractHash','version','outputHash','sessionId','extra-key'])('rejects invalid reuse admission %s',async changed=>{
  const f=prefixFixture();if(changed==='extra-key')f.slot.reuseRecovery.depth=2;else f.slot.reuseRecovery[changed]=changed==='outputHash'?'f'.repeat(64):'invalid';
  expect((await f.send({action:'plan'})).status).toBe(409);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['open-session','open-release','foreign-owner','wrong-origin','wrong-contract','baseline-contract','source-binding','sourceRevision','sourceFingerprint','keywordSnapshotHash','base-host','nested-prefix','checker-policy','sweep-policy','timing-policy','context-policy','baseline-hash','baseline-receipts'])('rejects changed or recursive v4 prefix %s',async changed=>{
  const f=prefixFixture();if(changed==='open-session')f.oldSession.state='released';if(changed==='open-release')f.oldRelease.state='released';if(changed==='foreign-owner')f.oldSession.user_id='other';if(changed==='wrong-origin')f.oldRelease.origin_session_id=sid;if(changed==='wrong-contract')f.oldRelease.contract_hash='f'.repeat(64);if(changed==='baseline-contract')f.oldRelease.baseline_contract_hash='f'.repeat(64);if(changed==='source-binding')f.oldSession.sources[0].sourceHash='f'.repeat(64);if(['sourceRevision','sourceFingerprint','keywordSnapshotHash'].includes(changed))f.oldSlot[changed]='tampered';if(changed==='base-host')f.oldSlot.baselineGenerationContractHash='f'.repeat(64);if(changed==='nested-prefix')f.oldSlot.reuseRecovery={...f.slot.reuseRecovery};if(changed==='checker-policy')f.oldSlot.checkerPolicy='strict-context-v1';if(changed==='sweep-policy')f.oldSlot.sectionSweepChunks=[0];if(changed==='timing-policy')f.oldSlot.timingReviews=[];if(changed==='context-policy')f.oldSlot.contextReviews=[];if(changed==='baseline-hash')f.oldSlot.baselineOutputHash='f'.repeat(64);if(changed==='baseline-receipts')f.oldSlot.baselineReceipts=[];
  expect((await f.send({action:'plan'})).status).toBe(409);expect(f.rpc).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
 });
 it.each(['request','manifest','result','identity','owner','unknown','partial','over-cap','extra-call'])('rejects altered closed-prefix %s evidence before sealing',async changed=>{
  const f=prefixFixture(),{request,charge}=f.oldCalls[0];if(changed==='request')request.request_payload.request.prompt+=' Changed.';if(changed==='manifest')f.oldRelease.recovery_requests[0].requestHash='f'.repeat(64);if(changed==='result')request.result.value.decisions[0].disposition='review';if(changed==='identity')request.result.executionIdentity={provider:'other'};if(changed==='owner')charge.user_id='other';if(changed==='unknown'){charge.state='unknown';charge.actual_usd=null;}if(changed==='partial')request.completed=false;if(changed==='over-cap'){charge.actual_usd=.11;request.result.actualUsd=.11;}if(changed==='extra-call')f.tables.keyword_learning_requests.push({...request,call_key:'unsealed-extra'});
  expect((await f.send({action:'plan'})).status).toBe(409);expect(f.rpc).not.toHaveBeenCalled();
 });
});
