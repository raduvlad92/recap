import {describe,it,expect,vi} from 'vitest';
import OpenAI from 'openai';
import {providerHttpDiagnostic,finiteDiagnosticAttachment,OPENROUTER_CHAT_URL} from '../netlify/functions/_shared/provider-http-diagnostic';
import {AnalysisProviderHttpError,createOpenRouterAnalysisGenerator,type GenerationRequest,type OpenAIClientFactory} from '../netlify/functions/_shared/content-analysis-model';
const stamp='2026-11-12T02:10:00.000Z',id='12345678-1234-4234-8234-123456789012';
const base={httpStatus:404,requestMethod:'POST',requestUrl:OPENROUTER_CHAT_URL,responseUrl:OPENROUTER_CHAT_URL,providerRequestId:id,providerCode:404,receivedAt:stamp};
const binding={sessionId:id,callId:'22345678-1234-4234-8234-123456789012',leaseToken:'32345678-1234-4234-8234-123456789012',requestHash:'a'.repeat(64),attemptNumber:1};
describe('bounded transport diagnostics, synthetic data and injected fetch only',()=>{
 it('retains only the fixed allowlist; status is never a cost or retry receipt',()=>{
  const receipt=providerHttpDiagnostic({...base,message:'PRIVATE SOURCE TEXT',raw:'PRIVATE SECRET',headers:{authorization:'Bearer PRIVATE'}} as any)!;
  expect(receipt).toEqual({schema:1,kind:'model-provider-http-diagnostic-v1',route:'openrouter',httpStatus:404,requestMethod:'POST',requestUrl:OPENROUTER_CHAT_URL,responseUrl:OPENROUTER_CHAT_URL,providerRequestId:id,providerCode:404,receivedAt:stamp,costConclusion:'unknown',retryAuthority:false});
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE');expect(Object.isFrozen(receipt)).toBe(true);
 });
 it.each(['https://secret:token@openrouter.ai/api/v1/chat/completions','https://openrouter.ai/api/v1/chat/completions?key=SECRET','https://openrouter.ai/api/v1/chat/completions#SECRET','https://attacker.example/api/v1/chat/completions','https://openrouter.ai/api/v1/private/SOURCE','https://openrouter.ai:443/api/v1/chat/completions','https://openrouter.ai/api/v1/../SECRET'])('drops unallowlisted URL %s without losing the observed status',url=>{
  const receipt=providerHttpDiagnostic({...base,requestUrl:url,responseUrl:url})!;expect(receipt.requestUrl).toBeNull();expect(receipt.responseUrl).toBeNull();expect(receipt.httpStatus).toBe(404);expect(receipt.costConclusion).toBe('unknown');
 });
 it.each(['sk-private-secret','Bearer private-secret','owner@example.com','source words','req_too_short','req_'+('x'.repeat(101)),'https://private.example/source','gen-123-private-secret'])('drops unsafe or unknown request ID %s',providerRequestId=>expect(providerHttpDiagnostic({...base,providerRequestId})?.providerRequestId).toBeNull());
 it.each([id,'a'.repeat(32),'req_aBcD0123456789','gen-1794444170-aBcD0123456789'])('keeps a bounded known request ID family %s',providerRequestId=>expect(providerHttpDiagnostic({...base,providerRequestId})?.providerRequestId).toBe(providerRequestId));
 it.each([null,undefined,{},[],404.5,900,'secret-source-code','404 private-message','no_endpoints_found'])('drops unknown provider code %s',providerCode=>expect(providerHttpDiagnostic({...base,providerCode})?.providerCode).toBeNull());
 it.each([404,'404',429,'429',503])('retains only a known bounded numeric provider code %s',providerCode=>expect(providerHttpDiagnostic({...base,providerCode})?.providerCode).toBe(Number(providerCode)));
 it.each([200,302,399,600,404.5,'404',null])('never changes a nonerror/invalid HTTP status %s into provider404',httpStatus=>expect(providerHttpDiagnostic({...base,httpStatus})).toBeNull());
 it.each(['2026-02-30T02:10:00.000Z','2026-11-12T02:10:00Z','private-source',null])('rejects invalid observed time %s',receivedAt=>expect(providerHttpDiagnostic({...base,receivedAt})).toBeNull());
 it('does not copy arbitrary methods or infer request/response URLs when unobserved',()=>{
  expect(providerHttpDiagnostic({...base,requestMethod:'GET',requestUrl:undefined,responseUrl:undefined})).toMatchObject({requestMethod:null,requestUrl:null,responseUrl:null});
 });
 it('creates only an exact call/attempt-bound sidecar proposal and accepts key reordering',()=>{
  const diagnostic=providerHttpDiagnostic(base)!;const reordered=Object.fromEntries(Object.entries(diagnostic).reverse()) as any;
  const attachment=finiteDiagnosticAttachment(binding,reordered);expect(attachment).toMatchObject({...binding,diagnostic});expect(Object.isFrozen(attachment)).toBe(true);expect(attachment).not.toHaveProperty('result');expect(attachment).not.toHaveProperty('actualUsd');
 });
 it.each([{attemptNumber:0},{attemptNumber:4},{requestHash:'bad'},{callId:'other-call'},{leaseToken:'other-lease'},{sessionId:'other-session'}])('refuses an invalid durable binding %s',patch=>expect(()=>finiteDiagnosticAttachment({...binding,...patch},providerHttpDiagnostic(base)!)).toThrow('provider_diagnostic_binding_invalid'));
 it('refuses forged financial authority and extra raw fields in a sidecar receipt',()=>{
  expect(()=>finiteDiagnosticAttachment(binding,{...providerHttpDiagnostic(base)!,actualUsd:0} as any)).toThrow('provider_diagnostic_receipt_invalid');
  expect(()=>finiteDiagnosticAttachment(binding,{...providerHttpDiagnostic(base)!,retryAuthority:true} as any)).toThrow('provider_diagnostic_receipt_invalid');
 });
});
const config:Record<string,string>={CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_MODEL:'deepseek/deepseek-v4.1-flash-1017',CONTENT_ANALYSIS_PRICE_MODEL:'deepseek/deepseek-v4.1-flash-1017',CONTENT_ANALYSIS_PRICING_VERIFIED:'true',CONTENT_ANALYSIS_PRICING_VERSION:'offline-fixture',CONTENT_ANALYSIS_CHUNK_CHARS:'12000',CONTENT_ANALYSIS_MAX_CHUNKS:'30',CONTENT_ANALYSIS_MAX_SOURCE_CHARS:'200000',CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS:'4000',CONTENT_ANALYSIS_MAX_INPUT_TOKENS:'128000',CONTENT_ANALYSIS_INPUT_USD_PER_MILLION:'.07',CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION:'.5',CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION:'.008',CONTENT_ANALYSIS_CACHE_WRITE_APPLIES:'false',CONTENT_ANALYSIS_MAX_CALL_USD:'.10',OPENROUTER_API_KEY:'offline-provider-fixture-key',CONTENT_ANALYSIS_REASONING_EFFORT:'none',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'relace',CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME:'Relace',CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:'deepseek/deepseek-v4.1-flash-1017'};
const request:GenerationRequest={role:'extractor',key:'keyword-learning:v1:offline-fixture',system:'policy',prompt:'private synthetic source',schema:{type:'object'},maxOutputTokens:50};
describe('exact model attachment candidate with the installed SDK and mock fetch',()=>{
 it.each([404,429,503])('attaches sanitized HTTP%s evidence with one mock request and no retry',async status=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{const response=new Response(JSON.stringify({error:{code:status,message:'PRIVATE SOURCE ECHO: offline-provider-fixture-key',metadata:{raw:'PRIVATE'}}}),{status,headers:{'content-type':'application/json','x-request-id':id,'authorization':'Bearer PRIVATE','retry-after':'12'}});Object.defineProperty(response,'url',{value:OPENROUTER_CHAT_URL});return response;});
  const factory:OpenAIClientFactory=options=>new OpenAI({...options,fetch:fetcher});
  let error:unknown;try{await createOpenRouterAnalysisGenerator(name=>config[name],factory)(request);}catch(e){error=e;}
  expect(error).toBeInstanceOf(AnalysisProviderHttpError);const failed=error as AnalysisProviderHttpError;
  expect(failed.code).toBe('analysis_provider_http_'+status);expect(failed.diagnostic).toMatchObject({httpStatus:status,requestMethod:'POST',requestUrl:OPENROUTER_CHAT_URL,responseUrl:OPENROUTER_CHAT_URL,providerRequestId:id,providerCode:status,costConclusion:'unknown',retryAuthority:false});
  expect(failed.rejection===null).toBe(status!==429);expect(fetcher).toHaveBeenCalledOnce();expect(String(fetcher.mock.calls[0]?.[0])).toBe(OPENROUTER_CHAT_URL);
  expect(JSON.stringify(failed)).not.toContain('PRIVATE');expect(JSON.stringify(failed)).not.toContain('private synthetic source');expect(JSON.stringify(failed)).not.toContain(config.OPENROUTER_API_KEY);
 });
 it('preserves old constructor semantics without inventing a diagnostic',()=>{const old=new AnalysisProviderHttpError(404);expect(old.code).toBe('analysis_provider_http_404');expect(old.diagnostic).toBeNull();});
 it('does not attach diagnostics or change accounting on a successful synthetic SDK response',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'gen-1794444170-aBcD0123456789',model:config.CONTENT_ANALYSIS_MODEL,provider:'Relace',choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"readComplete":true}'}}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,prompt_tokens_details:{cached_tokens:0},cost:.001,is_byok:false}}),{status:200,headers:{'content-type':'application/json'}}));
  const result=await createOpenRouterAnalysisGenerator(name=>config[name],options=>new OpenAI({...options,fetch:fetcher}))(request);
  expect(result).toMatchObject({value:{readComplete:true},actualUsd:.001,observedUsd:.001});expect(result).not.toHaveProperty('diagnostic');expect(fetcher).toHaveBeenCalledOnce();
 });
});
