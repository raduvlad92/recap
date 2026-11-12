import { describe,expect,it,vi } from 'vitest';
import { createKeywordLearningHandler,parseKeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import { AnalysisError,AnalysisProviderHttpError,createOpenRouterAnalysisGenerator,type GenerationResult,type OpenAIClientFactory } from '../netlify/functions/_shared/content-analysis-model';
import * as modelAdapter from '../netlify/functions/_shared/content-analysis-model';
import { analysisRuntimeEnv } from '../netlify/functions/_shared/content-analysis-runtime';
import { createHash } from 'node:crypto';
import { providerHttpDiagnostic,OPENROUTER_CHAT_URL } from '../netlify/functions/_shared/provider-http-diagnostic';

const source='The fictional AeroBox Plus includes C++ support.',sourceHash=createHash('sha256').update(source).digest('hex');
const input={action:'generate',sessionId:'12345678-1234-1234-1234-123456789012',sourceOrdinal:1,sourceHash,model:'deepseek/deepseek-v4.1-flash-1017',
 request:{role:'extractor',key:'keyword-learning:v1:direct-1',system:'List literal names.',prompt:source,schema:{type:'object',properties:{names:{type:'array',items:{type:'string'}}},required:['names'],additionalProperties:false},maxOutputTokens:3000}};
const callId='22345678-1234-4234-8234-123456789012',leaseToken='32345678-1234-4234-8234-123456789012';
const metadataReceipt={route:'openrouter' as const,checked:true,observedAt:'2026-11-12T04:00:00.000Z',compatibleTags:['relace'],actualQualification:false as const,spendingAuthority:false as const};
const result:GenerationResult={value:{names:['AeroBox Plus','C++']},actualUsd:.001,observedUsd:.001,providerId:'gen-fixture'};
function fixture(patch:Record<string,unknown>={},generateOnly=false,options:Parameters<typeof createKeywordLearningHandler>[1]={}){
 const generate=vi.fn().mockResolvedValue(result),authorize=vi.fn().mockResolvedValue('fixture-admin'),workerAuthorized=vi.fn().mockReturnValue(true);
 const providerMetadata=vi.fn().mockResolvedValue(metadataReceipt);
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='read_keyword_learning_call'?null:name==='reserve_keyword_learning_call'?{claimed:true,call:{id:callId,lease_token:leaseToken,state:'reserved',actual_usd:null,maximum_usd:.1,attempt_number:1},requestHash:args.p_request_hash,result:null,errorCode:null}:['record_keyword_learning_call','record_keyword_learning_failure_with_diagnostic'].includes(name)?{call:{state:args.p_result?'settled':'unknown',actual_usd:args.p_result?.['actualUsd' as keyof typeof args.p_result]??null},result:args.p_result,errorCode:args.p_error_code,completed:true}:{call:{state:'settled'},result},error:null}));
 const sourceState={owner:'fixture-owner',content:source,session:'released'};
 const tables=vi.fn((table:string)=>{const chain:any={select:()=>chain,eq:()=>chain,single:async()=>({data:table==='keyword_learning_sessions'?{user_id:sourceState.owner,state:sourceState.session,expires_at:'2099-01-01T00:00:00Z',models:[input.model],sources:[{ordinal:1,sourceHash,updateId:'fixture-video'}]}:{record:{content:sourceState.content}},error:null})};return chain;});
 const db={from:tables,rpc},env=(key:string)=>({APP_URL:'https://example.test',CONTENT_ANALYSIS_ENABLED:'false',OPENROUTER_API_KEY:'synthetic-unused-fixture'}[key]);
 const handler=createKeywordLearningHandler({now:()=>Date.parse(metadataReceipt.observedAt),env,db:()=>db as never,authorize,workerAuthorized,generator:()=>generate,providerMetadata,...patch},{generateOnly,...options});
 const send=(body:unknown=input,url='https://example.test/.netlify/functions/keyword-learning')=>handler(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 return {handler,send,generate,authorize,workerAuthorized,rpc,tables,env,db,providerMetadata,sourceState};
}
async function existing(f:ReturnType<typeof fixture>,state:'unknown'|'settled',body=input){
 const preflight=await (await f.send({...body,action:'preflight'})).json();
 return {claimed:false,call:{id:callId,lease_token:leaseToken,state,actual_usd:state==='settled'?.001:null,maximum_usd:preflight.maximumUsd,attempt_number:1,model:body.model,user_id:'fixture-owner',request_hash:preflight.requestHash,execution_identity:preflight.executionIdentity},requestHash:preflight.requestHash,result:state==='settled'?result:null,errorCode:state==='unknown'?'analysis_provider_timeout':null};
}
describe('private keyword evaluation handler, synthetic adapters only',()=>{
 it('accepts the configured HTTPS app without the build-only CONTEXT variable',async()=>{
  const f=fixture(),r=await f.send({...input,action:'preflight'});expect(r.status).toBe(200);expect((await r.json()).providerCall).toBe(false);expect(f.providerMetadata).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it.each(['https://deploy-preview-12--example.test/.netlify/functions/keyword-learning','http://localhost:8888/.netlify/functions/keyword-learning','http://example.test/.netlify/functions/keyword-learning'])('rejects a non-app request origin %s',async url=>{
  const f=fixture(),r=await f.send({...input,action:'preflight'},url);expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('keyword_learning_production_required');expect(f.tables).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it.each([undefined,'','malformed','http://example.test','https://user:password@example.test','https://127.0.0.1','https://localhost','https://app.internal','https://example.test:8443','https://example.test?token=x','https://example.test#fragment'])('rejects missing or malformed APP_URL %s',async appUrl=>{
  const f=fixture({env:(name:string)=>name==='APP_URL'?appUrl:undefined}),r=await f.send({...input,action:'preflight'});expect(r.status).toBe(403);expect(f.tables).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('requires the worker secret or existing verified admin authorizer before database access',async()=>{
  const f=fixture({workerAuthorized:()=>false,authorize:vi.fn().mockRejectedValue(new Error('denied'))});
  expect((await f.send()).status).toBe(502);expect(f.tables).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('preflights the exact source/model/request without reserving money or calling a model',async()=>{
  const f=fixture(),r=await f.send({...input,action:'preflight'}),body=await r.json();
  expect(r.status).toBe(200);expect(body).toMatchObject({preflight:true,providerCall:false,reserved:false,maximumUsd:.1});expect(body.requestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('reserves exact durable binding before generation and records billable output',async()=>{
  const f=fixture(),r=await f.send(),body=await r.json();
  expect(r.status).toBe(200);expect(body).toMatchObject({providerCall:true,result});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call','reserve_keyword_learning_call','record_keyword_learning_call']);
  expect(f.rpc.mock.calls.find(([name])=>name==='reserve_keyword_learning_call')![1]).toMatchObject({p_source_hash:sourceHash,p_model:input.model,p_maximum_usd:.1,p_request:{request:input.request}});
  expect(f.generate).toHaveBeenCalledExactlyOnceWith(input.request);expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('never sends again when reservation returns an existing unsettled request',async()=>{
  const f=fixture();const prior=await existing(f,'unknown');f.rpc.mockResolvedValueOnce({data:prior,error:null} as never);f.providerMetadata.mockClear();
  const r=await f.send();expect(r.status).toBe(202);expect(f.generate).not.toHaveBeenCalled();expect((await r.json()).providerCall).toBe(false);
 });
 it('returns a settled cached result without spending again',async()=>{
  const f=fixture();const prior=await existing(f,'settled');f.rpc.mockResolvedValueOnce({data:prior,error:null} as never);f.providerMetadata.mockClear();
  const r=await f.send();expect(r.status).toBe(200);expect(f.generate).not.toHaveBeenCalled();expect(await r.json()).toMatchObject({cached:true,result,providerCall:false});expect(f.providerMetadata).not.toHaveBeenCalled();
 });
 it.each(['preflight','read','other'])('the background entry rejects %s after authorization, before database access',async action=>{
  const f=fixture({},true),r=await f.send({...input,action},'https://example.test/.netlify/functions/keyword-learning-worker');
  expect(r.status).toBe(400);expect(f.workerAuthorized).toHaveBeenCalledTimes(1);expect(f.tables).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('the background entry still rejects unauthorized requests before reading any session',async()=>{
  const f=fixture({workerAuthorized:()=>false,authorize:vi.fn().mockRejectedValue(new Error('denied'))},true);
  expect((await f.send(input,'https://example.test/.netlify/functions/keyword-learning-worker')).status).toBe(502);expect(f.tables).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('limits the longer default transport to an explicitly configured generate-only worker',async()=>{
  const f=fixture(),generate=vi.fn().mockResolvedValue(result),openrouter=vi.spyOn(modelAdapter,'createOpenRouterAnalysisGenerator').mockReturnValue(generate),gateway=vi.spyOn(modelAdapter,'createGatewayGenerator').mockReturnValue(generate);
  const deps={now:()=>Date.parse(metadataReceipt.observedAt),env:f.env,db:()=>f.db as never,authorize:f.authorize,workerAuthorized:f.workerAuthorized,providerMetadata:f.providerMetadata};
  try{
   const worker=createKeywordLearningHandler(deps,{generateOnly:true,generationTimeoutMs:120000});
   await worker(new Request('https://example.test/.netlify/functions/keyword-learning-worker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
   expect(openrouter).toHaveBeenCalledExactlyOnceWith(expect.any(Function),undefined,{timeoutMs:120000});expect(gateway).not.toHaveBeenCalled();expect(generate).toHaveBeenCalledExactlyOnceWith(input.request);
   openrouter.mockClear();generate.mockClear();
   await createKeywordLearningHandler(deps)(new Request('https://example.test/.netlify/functions/keyword-learning',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
   expect(gateway).toHaveBeenCalledExactlyOnceWith(expect.any(Function));expect(openrouter).not.toHaveBeenCalled();expect(generate).toHaveBeenCalledExactlyOnceWith(input.request);
  }finally{openrouter.mockRestore();gateway.mockRestore();}
 });
 it('preserves injected generators when the background transport has a longer deadline',async()=>{
  const f=fixture(),handler=createKeywordLearningHandler({now:()=>Date.parse(metadataReceipt.observedAt),env:f.env,db:()=>f.db as never,authorize:f.authorize,workerAuthorized:f.workerAuthorized,generator:()=>f.generate,providerMetadata:f.providerMetadata},{generateOnly:true,generationTimeoutMs:120000});
  await handler(new Request('https://example.test/.netlify/functions/keyword-learning-worker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));expect(f.generate).toHaveBeenCalledExactlyOnceWith(input.request);
 });
 it.each([{generationTimeoutMs:120000},{generateOnly:true,generationTimeoutMs:120001},{generateOnly:true,generationTimeoutMs:0},{generateOnly:true,generationTimeoutMs:NaN}])('rejects an unsafe worker-only transport option %j before dispatch',options=>{
  const f=fixture();expect(()=>createKeywordLearningHandler({db:()=>f.db as never},options)).toThrow('analysis_configuration_required');expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it.each(['settled','unknown'] as const)('a background reinvocation cannot resend the same %s request',async state=>{
  const f=fixture({},true),rpc=f.rpc.getMockImplementation()!;
  if(state==='unknown')f.generate.mockRejectedValueOnce(new AnalysisError('analysis_provider_timeout'));
  let alreadyReserved=false;
  f.rpc.mockImplementation(async(name,args)=>{
   if(name==='reserve_keyword_learning_call'){
    if(alreadyReserved)return {data:{claimed:false,call:{state,actual_usd:state==='settled'?.001:null},result:state==='settled'?result:null,errorCode:state==='unknown'?'analysis_provider_timeout':null},error:null} as never;
    alreadyReserved=true;
   }
   return rpc(name,args);
  });
  const url='https://example.test/.netlify/functions/keyword-learning-worker';
  await f.send(input,url);const repeated=await f.send(input,url),body=await repeated.json();
  expect(repeated.status).toBe(state==='settled'?200:202);expect(body.providerCall).toBe(false);expect(f.generate).toHaveBeenCalledExactlyOnceWith(input.request);
  expect(f.rpc.mock.calls.filter(([name])=>name==='record_keyword_learning_call')).toHaveLength(1);
 });
 it('persists a provider timeout as unknown cost and never refunds/retries it',async()=>{
  const f=fixture();f.generate.mockRejectedValueOnce(new AnalysisError('analysis_provider_timeout'));
  const r=await f.send();expect(r.status).toBe(202);expect(f.rpc.mock.calls.find(([name])=>name==='record_keyword_learning_call')!).toEqual(['record_keyword_learning_call',expect.objectContaining({p_result:null,p_error_code:'analysis_provider_timeout'})]);
  expect(f.generate).toHaveBeenCalledTimes(1);expect(await r.json()).toMatchObject({call:{state:'unknown'},errorCode:'analysis_provider_timeout'});
 });
 it('retains a malformed but billable result and its operational validation error',async()=>{
  const f=fixture();f.generate.mockResolvedValueOnce({...result,value:{rawOutput:'{"names":'},validationError:'analysis_invalid_json'});
  const r=await f.send();expect(r.status).toBe(200);expect(f.rpc.mock.calls.find(([name])=>name==='record_keyword_learning_call')![1]).toMatchObject({p_error_code:'analysis_invalid_json',p_result:{actualUsd:.001}});
 });
 it('read is private and does not construct a provider or reserve a call',async()=>{
  const f=fixture();const r=await f.send({action:'read',sessionId:input.sessionId,callKey:input.request.key});
  expect(r.status).toBe(200);expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_keyword_learning_call',{p_session_id:input.sessionId,p_call_key:input.request.key});expect(f.generate).not.toHaveBeenCalled();expect(f.tables).not.toHaveBeenCalled();
 });
 it.each([{model:'other/model'},{sourceHash:'broken'},{request:{...input.request,key:'extractor:v4:chunk:0'}},{request:{...input.request,maxOutputTokens:8193}},{extra:true}])('rejects malformed or unauthorized request %j before generation',patch=>{
  expect(()=>parseKeywordLearningInput({...input,...patch})).toThrow('The private keyword evaluation');
 });
 it('binds original pipeline key and correction metadata without changing it',async()=>{
  const f=fixture();await f.send({...input,originalKey:'extractor:v4:chunk:0:repair:1',request:{...input.request,correction:{baseKey:'extractor:v4:chunk:0',errorCode:'analysis_invalid_json'}}});
  expect(f.rpc.mock.calls.find(([name])=>name==='reserve_keyword_learning_call')![1]).toMatchObject({p_request:{originalKey:'extractor:v4:chunk:0:repair:1',request:{correction:{baseKey:'extractor:v4:chunk:0',errorCode:'analysis_invalid_json'}}}});
 });
 it.each([
  {finish:'stop',content:'{"names":',error:'analysis_invalid_json'},
  {finish:'length',content:'{"names":[]}',error:'analysis_output_capacity'},
  {finish:'stop',content:'',refusal:'Synthetic refusal.',error:'analysis_provider_refusal'},
 ])('the existing provider adapter retains billable $error for the new namespace',async test=>{
  const create=vi.fn().mockResolvedValue({id:'gen-fixture',model:input.model,provider:'Relace',choices:[{finish_reason:test.finish,message:{role:'assistant',content:test.content,...(test.refusal?{refusal:test.refusal}:{})}}],usage:{prompt_tokens:100,completion_tokens:20,cost:.001,is_byok:false}});
  const env=analysisRuntimeEnv(key=>key==='OPENROUTER_API_KEY'?'synthetic-unused-fixture':undefined,input.model,1);
  const result=await createOpenRouterAnalysisGenerator(env,(()=>({chat:{completions:{create}}})) as unknown as OpenAIClientFactory)(input.request as never);
  expect(result.actualUsd).toBe(.001);expect(result.validationError).toBe(test.error);expect(create).toHaveBeenCalledTimes(1);
 });
 it('blocks a fresh request before any reservation or inference when advertised prices fail',async()=>{
  const f=fixture();f.providerMetadata.mockRejectedValueOnce(new AnalysisError('analysis_provider_metadata_price_exceeds_pin'));
  const r=await f.send();expect(r.status).toBe(503);expect(await r.json()).toMatchObject({error:{code:'analysis_provider_metadata_price_exceeds_pin'}});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call']);expect(f.generate).not.toHaveBeenCalled();
 });
 it.each(['content','owner','closed'])('rechecks %s after the metadata wait, before money is reserved',async changed=>{
  const f=fixture();f.providerMetadata.mockImplementationOnce(async()=>{if(changed==='content')f.sourceState.content+=' changed';if(changed==='owner')f.sourceState.owner='different-owner';if(changed==='closed')f.sourceState.session='closed';return metadataReceipt;});
  expect((await f.send()).status).toBe(changed==='closed'?403:409);expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call']);expect(f.generate).not.toHaveBeenCalled();
 });
 it.each(['request_hash','model','user_id','maximum_usd','execution_identity'])('rejects a cached %s mismatch without invoking metadata or reserving',async field=>{
  const f=fixture(),prior=await existing(f,'unknown');(prior.call as Record<string,unknown>)[field]=field==='maximum_usd'?.09:field==='execution_identity'?{}:'different';
  f.rpc.mockResolvedValueOnce({data:prior,error:null} as never);f.providerMetadata.mockClear();
  expect((await f.send()).status).toBe(409);expect(f.providerMetadata).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('a trusted native capability revoked after metadata cannot reserve money',async()=>{
  const assertBeforeReservation=vi.fn().mockRejectedValue(new AnalysisError('analysis_runtime_disabled'));
  const f=fixture({},true,{assertBeforeReservation});const r=await f.send();expect(r.status).toBe(503);expect(f.providerMetadata).toHaveBeenCalledOnce();expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call']);expect(f.generate).not.toHaveBeenCalled();
 });
 it('a capability revoked after reservation retains an unknown hold without calling the model',async()=>{
  const assertBeforeReservation=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AnalysisError('analysis_runtime_disabled'));
  const f=fixture({},true,{assertBeforeReservation});const r=await f.send();expect(r.status).toBe(202);expect(await r.json()).toMatchObject({call:{state:'unknown',actual_usd:null},providerCall:false,errorCode:'analysis_runtime_disabled'});
  expect(f.generate).not.toHaveBeenCalled();expect(f.rpc.mock.calls.at(-1)).toEqual(['record_keyword_learning_call',expect.objectContaining({p_result:null,p_error_code:'analysis_runtime_disabled'})]);
 });
 it('persists an HTTP error as a separately bound diagnostic, with no generation or zero-charge receipt',async()=>{
  const diagnostic=providerHttpDiagnostic({httpStatus:404,requestMethod:'POST',requestUrl:OPENROUTER_CHAT_URL,responseUrl:OPENROUTER_CHAT_URL,providerRequestId:callId,providerCode:404,receivedAt:'2026-11-12T04:00:00.000Z'})!;
  const f=fixture();f.generate.mockRejectedValueOnce(new AnalysisProviderHttpError(404,null,undefined,diagnostic));const r=await f.send();
  expect(r.status).toBe(202);expect(await r.json()).toMatchObject({call:{state:'unknown',actual_usd:null},providerCall:true,errorCode:'analysis_provider_http_404'});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call','reserve_keyword_learning_call','record_keyword_learning_failure_with_diagnostic']);
  const args=f.rpc.mock.calls.at(-1)![1];expect(args).toMatchObject({p_session_id:input.sessionId,p_call_id:callId,p_lease_token:leaseToken,p_attempt_number:1,p_error_code:'analysis_provider_http_404',p_diagnostic:diagnostic});
  expect(args).not.toHaveProperty('p_result');expect(args).not.toHaveProperty('actualUsd');expect(args.p_request_hash).toMatch(/^[a-f0-9]{64}$/);expect(f.generate).toHaveBeenCalledOnce();
 });
 it('does not downgrade a failed diagnostic transaction into a successful error receipt or financial settlement',async()=>{
  const diagnostic=providerHttpDiagnostic({httpStatus:404,receivedAt:'2026-11-12T04:00:00.000Z'})!,f=fixture(),rpc=f.rpc.getMockImplementation()!;
  f.generate.mockRejectedValueOnce(new AnalysisProviderHttpError(404,null,undefined,diagnostic));f.rpc.mockImplementation(async(name,args)=>name==='record_keyword_learning_failure_with_diagnostic'?{data:null,error:{code:'XX000'}} as never:rpc(name,args));
  expect((await f.send()).status).toBe(502);expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call','reserve_keyword_learning_call','record_keyword_learning_failure_with_diagnostic']);expect(f.generate).toHaveBeenCalledOnce();
 });
 it('only a server-configured generate-only entry may supply the native recheck',()=>{
  expect(()=>createKeywordLearningHandler({}, {assertBeforeReservation:async()=>{}})).toThrow('analysis_configuration_required');
  expect(()=>parseKeywordLearningInput({...input,assertBeforeReservation:true})).toThrow();
 });

 it('rechecks advertisement age after the final native pre-reservation gate',async()=>{
  let now=Date.parse(metadataReceipt.observedAt);const f=fixture({now:()=>now},true,{assertBeforeReservation:async()=>{now+=60001;}});
  expect((await f.send()).status).toBe(503);expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['read_keyword_learning_call']);expect(f.generate).not.toHaveBeenCalled();
 });
 it('does not infer after a reserved call waits beyond metadata expiry',async()=>{
  let now=Date.parse(metadataReceipt.observedAt);const f=fixture({now:()=>now});const rpc=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name,args)=>{const r=await rpc(name,args);if(name==='reserve_keyword_learning_call')now+=60001;return r;});
  const r=await f.send();expect(r.status).toBe(202);expect(await r.json()).toMatchObject({providerCall:false,errorCode:'analysis_provider_metadata_stale',call:{state:'unknown',actual_usd:null}});expect(f.generate).not.toHaveBeenCalled();
 });

 it.each(['content','owner','closed'])('does not send a source invalidated during the post-reservation native gate: %s',async changed=>{
  let n=0;let f:ReturnType<typeof fixture>;f=fixture({},true,{assertBeforeReservation:async()=>{if(++n===2){if(changed==='content')f.sourceState.content+=' erased';if(changed==='owner')f.sourceState.owner='different-owner';if(changed==='closed')f.sourceState.session='closed';}}});
  const r=await f.send();expect(r.status).toBe(202);expect(await r.json()).toMatchObject({providerCall:false,call:{state:'unknown',actual_usd:null},errorCode:changed==='closed'?'keyword_learning_not_released':'keyword_learning_source_changed'});expect(f.generate).not.toHaveBeenCalled();
 });

});
