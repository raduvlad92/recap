import { describe,expect,it,vi } from 'vitest';
import { createKeywordLearningHandler,parseKeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import { AnalysisError,createOpenRouterAnalysisGenerator,type GenerationResult,type OpenAIClientFactory } from '../netlify/functions/_shared/content-analysis-model';
import { analysisRuntimeEnv } from '../netlify/functions/_shared/content-analysis-runtime';
import { createHash } from 'node:crypto';

const source='The fictional AeroBox Plus includes C++ support.',sourceHash=createHash('sha256').update(source).digest('hex');
const input={action:'generate',sessionId:'12345678-1234-1234-1234-123456789012',sourceOrdinal:1,sourceHash,model:'deepseek/deepseek-v4.1-flash-1017',
 request:{role:'extractor',key:'keyword-learning:v1:direct-1',system:'List literal names.',prompt:source,schema:{type:'object',properties:{names:{type:'array',items:{type:'string'}}},required:['names'],additionalProperties:false},maxOutputTokens:3000}};
const result:GenerationResult={value:{names:['AeroBox Plus','C++']},actualUsd:.001,observedUsd:.001,providerId:'gen-fixture'};
function fixture(patch:Record<string,unknown>={}){
 const generate=vi.fn().mockResolvedValue(result),authorize=vi.fn().mockResolvedValue('fixture-admin'),workerAuthorized=vi.fn().mockReturnValue(true);
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='reserve_keyword_learning_call'?{claimed:true,call:{id:'call-fixture',lease_token:'lease-fixture',state:'reserved',actual_usd:null,maximum_usd:.003},requestHash:args.p_request_hash,result:null,errorCode:null}:name==='record_keyword_learning_call'?{call:{state:args.p_result?'settled':'unknown',actual_usd:args.p_result?.['actualUsd' as keyof typeof args.p_result]??null},result:args.p_result,errorCode:args.p_error_code,completed:true}:{call:{state:'settled'},result},error:null}));
 const tables=vi.fn((table:string)=>{const chain:any={select:()=>chain,eq:()=>chain,single:async()=>({data:table==='keyword_learning_sessions'?{user_id:'fixture-owner',state:'released',expires_at:'2099-01-01T00:00:00Z',models:[input.model],sources:[{ordinal:1,sourceHash,updateId:'fixture-video'}]}:{record:{content:source}},error:null})};return chain;});
 const db={from:tables,rpc},env=(key:string)=>({CONTEXT:'production',CONTENT_ANALYSIS_ENABLED:'false',OPENROUTER_API_KEY:'synthetic-unused-fixture'}[key]);
 const handler=createKeywordLearningHandler({env,db:()=>db as never,authorize,workerAuthorized,generator:()=>generate,...patch});
 const send=(body:unknown=input)=>handler(new Request('https://example.test/.netlify/functions/keyword-learning',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 return {handler,send,generate,authorize,workerAuthorized,rpc,tables};
}
describe('private keyword evaluation handler, synthetic adapters only',()=>{
 it('requires the worker secret or existing verified admin authorizer before database access',async()=>{
  const f=fixture({workerAuthorized:()=>false,authorize:vi.fn().mockRejectedValue(new Error('denied'))});
  expect((await f.send()).status).toBe(502);expect(f.tables).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('preflights the exact source/model/request without reserving money or calling a model',async()=>{
  const f=fixture(),r=await f.send({...input,action:'preflight'}),body=await r.json();
  expect(r.status).toBe(200);expect(body).toMatchObject({preflight:true,providerCall:false,reserved:false});expect(body.maximumUsd).toBeGreaterThan(0);expect(body.maximumUsd).toBeLessThan(.1);expect(body.requestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.generate).not.toHaveBeenCalled();
 });
 it('reserves exact durable binding before generation and records billable output',async()=>{
  const f=fixture(),r=await f.send(),body=await r.json();
  expect(r.status).toBe(200);expect(body).toMatchObject({providerCall:true,result});
  expect(f.rpc.mock.calls[0][0]).toBe('reserve_keyword_learning_call');expect(f.rpc.mock.calls[1][0]).toBe('record_keyword_learning_call');
  expect(f.rpc.mock.calls[0][1]).toMatchObject({p_source_hash:sourceHash,p_model:input.model,p_request:{request:input.request}});
  expect(f.generate).toHaveBeenCalledExactlyOnceWith(input.request);expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('never sends again when reservation returns an existing unsettled request',async()=>{
  const f=fixture();f.rpc.mockResolvedValueOnce({data:{claimed:false,call:{state:'unknown',actual_usd:null},result:null,errorCode:'analysis_provider_timeout'},error:null} as never);
  const r=await f.send();expect(r.status).toBe(202);expect(f.generate).not.toHaveBeenCalled();expect((await r.json()).providerCall).toBe(false);
 });
 it('returns a settled cached result without spending again',async()=>{
  const f=fixture();f.rpc.mockResolvedValueOnce({data:{claimed:false,call:{state:'settled',actual_usd:.001},result,errorCode:null},error:null} as never);
  const r=await f.send();expect(r.status).toBe(200);expect(f.generate).not.toHaveBeenCalled();expect(await r.json()).toMatchObject({cached:true,result,providerCall:false});
 });
 it('persists a provider timeout as unknown cost and never refunds/retries it',async()=>{
  const f=fixture();f.generate.mockRejectedValueOnce(new AnalysisError('analysis_provider_timeout'));
  const r=await f.send();expect(r.status).toBe(202);expect(f.rpc.mock.calls[1]).toEqual(['record_keyword_learning_call',expect.objectContaining({p_result:null,p_error_code:'analysis_provider_timeout'})]);
  expect(f.generate).toHaveBeenCalledTimes(1);expect(await r.json()).toMatchObject({call:{state:'unknown'},errorCode:'analysis_provider_timeout'});
 });
 it('retains a malformed but billable result and its operational validation error',async()=>{
  const f=fixture();f.generate.mockResolvedValueOnce({...result,value:{rawOutput:'{"names":'},validationError:'analysis_invalid_json'});
  const r=await f.send();expect(r.status).toBe(200);expect(f.rpc.mock.calls[1][1]).toMatchObject({p_error_code:'analysis_invalid_json',p_result:{actualUsd:.001}});
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
  expect(f.rpc.mock.calls[0][1]).toMatchObject({p_request:{originalKey:'extractor:v4:chunk:0:repair:1',request:{correction:{baseKey:'extractor:v4:chunk:0',errorCode:'analysis_invalid_json'}}}});
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
});
