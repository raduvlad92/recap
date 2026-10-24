import OpenAI from 'openai';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AnalysisError,AnalysisProviderHttpError,createOpenAIAnalysisGenerator,createOpenRouterAnalysisGenerator,type GenerationRequest,type OpenAIClientFactory} from '../netlify/functions/_shared/content-analysis-model';

// All transport responses are synthetic. No key, provider or inference access.
const config:Record<string,string>={
 CONTENT_ANALYSIS_ROUTE:'openrouter',OPENROUTER_API_KEY:'fixture-key',OPENAI_API_KEY:'fixture-direct-key',
 CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8',CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME:'DeepInfra',
 CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:'deepseek/deepseek-v4.1-flash-1017',
 CONTENT_ANALYSIS_MODEL:'deepseek/deepseek-v4.1-flash-1017',CONTENT_ANALYSIS_PRICE_MODEL:'deepseek/deepseek-v4.1-flash-1017',
 CONTENT_ANALYSIS_PRICING_VERIFIED:'true',CONTENT_ANALYSIS_PRICING_VERSION:'fixture-v1',
 CONTENT_ANALYSIS_CHUNK_CHARS:'12000',CONTENT_ANALYSIS_MAX_CHUNKS:'30',CONTENT_ANALYSIS_MAX_SOURCE_CHARS:'200000',
 CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS:'4000',CONTENT_ANALYSIS_INPUT_USD_PER_MILLION:'.1',CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION:'.4',
 CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION:'.01',CONTENT_ANALYSIS_CACHE_WRITE_APPLIES:'false',CONTENT_ANALYSIS_MAX_CALL_USD:'.02',
};
const env=(patch:Record<string,string>={})=>(key:string)=>({...config,...patch})[key];
const request:GenerationRequest={role:'summary',key:'summary:0',system:'private synthetic policy',prompt:'private synthetic source',maxOutputTokens:4000,schema:{type:'object'}};
const receivedAt=Date.parse('2026-10-24T20:30:00.000Z');
const errorBody={error:{code:429,message:'private synthetic provider message',metadata:{raw:'private synthetic credential'}}};
async function rejected(status:number,body:unknown=errorBody,headers:Record<string,string>={}){
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}}));
 const result=await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error as unknown);
 expect(fetcher).toHaveBeenCalledTimes(1);
 return result as AnalysisProviderHttpError;
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('safe provider transport error boundary and status-only 429 receipts',()=>{
 it('preserves only safe actual HTTP metadata and never claims cost or retry permission',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(receivedAt);
  const error=await rejected(429,errorBody,{'retry-after':'125.2','x-request-id':'req-fixture-429'});
  expect(error).toBeInstanceOf(AnalysisProviderHttpError);
  expect(error.code).toBe('analysis_provider_http_429');
  expect(error.rejection).toEqual({httpStatus:429,preGeneration:true,retryAfterSeconds:126,providerRequestId:'req-fixture-429',receivedAt:'2026-10-24T20:30:00.000Z'});
  expect(JSON.stringify(error)).not.toMatch(/private|credential|prompt|cause|actualUsd|total_cost/);
  expect(error.message).toBe('analysis_provider_http_429');
  expect(error.stack).not.toContain(errorBody.error.message);
 });
 it.each([400,401,402,403,408,422,500,502,503])('keeps HTTP %i visible as a safe nonretry error',async status=>{
  const error=await rejected(status,{error:{code:status,message:'private synthetic secret'}});
  expect(error).toBeInstanceOf(AnalysisError);expect(error.code).toBe(`analysis_provider_http_${status}`);expect(error.rejection).toBeNull();
  expect(JSON.stringify(error)).not.toContain('private');
 });
 it.each([
  ['missing',{},null],['negative',{'retry-after':'-3'},null],['invalid',{'retry-after':'soon'},null],
  ['zero',{'retry-after':'0'},0],['bounded',{'retry-after':'999999999'},3600],
  ['date',{'retry-after':'Sat, 24 Oct 2026 20:32:01 GMT'},121],
  ['past',{'retry-after':'Sat, 24 Oct 2026 20:00:00 GMT'},0],
 ] as const)('bounds %s Retry-After metadata',async(_name,headers,expected)=>{
  vi.spyOn(Date,'now').mockReturnValue(receivedAt);
  expect((await rejected(429,errorBody,headers)).rejection?.retryAfterSeconds).toBe(expected);
 });
 const requestIdHeaders:Record<string,string>[]=[{}, {'x-request-id':'Bearer private key'}, {'x-request-id':'a'.repeat(201)}];
 it.each(requestIdHeaders)('never invents a provider request ID or stores unsafe IDs %j',async headers=>{
  expect((await rejected(429,errorBody,headers)).rejection?.providerRequestId).toBeNull();
 });
 it.each(['{"error":{"code":429', '<html>upstream unavailable</html>',{}, {error:{code:429}}, {error:{code:200,message:'error'}}, {error:{code:'429',message:'error'}}])('retains incomplete/malformed 429 as status-only evidence %j',async body=>{
  const error=await rejected(429,body);
  expect(error.code).toBe('analysis_provider_http_429');
  expect(error.rejection).toMatchObject({httpStatus:429,preGeneration:false});
  expect(error).not.toHaveProperty('actualUsd');
 });
 it('retains the HTTP status when reading its error body fails',async()=>{
  const stream=new ReadableStream({start(controller){controller.error(new Error('private synthetic truncated body'));}});
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(stream,{status:429,headers:{'content-type':'application/json','retry-after':'120'}}));
  const error=await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error);
  expect(error).toMatchObject({code:'analysis_provider_http_429',rejection:{preGeneration:false,retryAfterSeconds:120}});
  expect(JSON.stringify(error)).not.toContain('private');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('never interprets an HTTP 200 error envelope as a transport rejection',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:{code:429,message:'private partial generation failure'}}));
  const error=await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error);
  expect(error).toBeInstanceOf(AnalysisError);expect(error.code).toBe('analysis_incomplete_generation');expect(error).not.toHaveProperty('rejection');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not accept a plain object claiming to be a 429 SDK error',async()=>{
  const create=vi.fn().mockRejectedValue({status:429,error:errorBody.error,headers:new Headers(),message:'private synthetic message'});
  const factory=(()=>({chat:{completions:{create}}})) as unknown as OpenAIClientFactory;
  const error=await createOpenRouterAnalysisGenerator(env(),factory)(request).catch(error=>error);
  expect(error.code).toBe('analysis_generation_failed');expect(error).not.toHaveProperty('rejection');expect(JSON.stringify(error)).not.toContain('private');
 });
 it('keeps direct-provider 429 visible without applying the OpenRouter receipt contract',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(errorBody,{status:429}));
  const error=await createOpenAIAnalysisGenerator(env({CONTENT_ANALYSIS_ROUTE:'direct'}),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error);
  expect(error.code).toBe('analysis_provider_http_429');expect(error.rejection).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('sanitizes SDK network errors and never retries them',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('private synthetic network failure'));
  const error=await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error);
  expect(error.code).toBe('analysis_provider_network_error');expect(error).not.toHaveProperty('rejection');expect(error).not.toHaveProperty('cause');expect(fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('OpenRouter full-request deadline, pinned SDK with synthetic fetch only',()=>{
 const completion={id:'gen-fixture',model:config.CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL,provider:'DeepInfra',
  choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:5,cost:.0001,is_byok:false}};
 const cases=[
  {phase:'headers',status:undefined},
  {phase:'success body',status:200},
  {phase:'429 error body',status:429},
  {phase:'503 error body',status:503},
 ] as const;
 for(const late of ['completion','failure'] as const)it.each(cases)(`aborts stalled $phase at exactly 45000ms and handles late ${late} without retry`,async({status})=>{
  vi.useFakeTimers();vi.setSystemTime(receivedAt);
  let body!:ReadableStreamDefaultController<Uint8Array>,signal:AbortSignal|undefined,settled=false;
  let resolveHeaders!:(response:Response)=>void,rejectHeaders!:(error:Error)=>void;
  const text=JSON.stringify(status===200||status===undefined?completion:errorBody);
  const stream=new ReadableStream<Uint8Array>({start(controller){body=controller;controller.enqueue(new TextEncoder().encode(text.slice(0,8)));}});
  const headers={'content-type':'application/json','retry-after':'120','x-request-id':'req-fixture-timeout','x-private':'fixture-key'};
  const response=new Response(stream,{status:status??200,headers});
  // Deliberately ignore abort: the adapter must bound even a noncooperating transport.
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
   signal=init?.signal as AbortSignal;
   return status===undefined?new Promise<Response>((resolve,reject)=>{resolveHeaders=resolve;rejectHeaders=reject;}):response;
  });
  const unhandled=vi.fn();process.on('unhandledRejection',unhandled);
  try{
   const pending=createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request)
    .then(()=>{settled=true;return null;},error=>{settled=true;return error;});
   await vi.advanceTimersByTimeAsync(0);
   expect(fetcher).toHaveBeenCalledTimes(1);expect(signal).toBeInstanceOf(AbortSignal);expect(signal?.aborted).toBe(false);
   await vi.advanceTimersByTimeAsync(44999);expect(settled).toBe(false);expect(signal?.aborted).toBe(false);
   await vi.advanceTimersByTimeAsync(1);
   expect(settled).toBe(true);expect(signal?.aborted).toBe(true);
   const error=await pending;
   expect(error).toBeInstanceOf(AnalysisError);expect(error.code).toBe('analysis_provider_timeout');
   expect(error.message).toBe('analysis_provider_timeout');
   if(status===undefined){expect(error).not.toHaveProperty('httpStatus');expect(error).not.toHaveProperty('rejection');}
   else{
    expect(error).toBeInstanceOf(AnalysisProviderHttpError);expect(error.httpStatus).toBe(status);
    expect(error.rejection).toEqual(status===429?{httpStatus:429,preGeneration:false,retryAfterSeconds:120,providerRequestId:'req-fixture-timeout',receivedAt:'2026-10-24T20:30:00.000Z'}:null);
   }
   // No cost/zero-charge receipt can escape a timeout and release its reservation.
   expect(JSON.stringify(error)).not.toMatch(/private|fixture-key|Bearer|cause|actualUsd|observedUsd|nonbillable|total_cost/);
   if(status===undefined){
    if(late==='completion')resolveHeaders(response);else rejectHeaders(new Error('private fixture-key late network failure'));
   }
   if(late==='completion'){body.enqueue(new TextEncoder().encode(text.slice(8)));body.close();}
   else body.error(new Error('private fixture-key late body failure'));
   await vi.advanceTimersByTimeAsync(90000);
   expect(unhandled).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
   expect(await pending).toBe(error);
  }finally{process.off('unhandledRejection',unhandled);}
 });
 it('uses one total deadline when 429 headers arrive just before expiry and sanitizes their metadata',async()=>{
  vi.useFakeTimers();vi.setSystemTime(receivedAt);
  let signal:AbortSignal|undefined,body!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(controller){body=controller;}});
  const fetcher=vi.fn<typeof fetch>().mockImplementation((_url,init)=>{
   signal=init?.signal as AbortSignal;
   return new Promise(resolve=>setTimeout(()=>resolve(new Response(stream,{status:429,headers:{'content-type':'application/json',
    'retry-after':'Sat, 24 Oct 2026 20:32:00 GMT','x-request-id':'Bearer fixture-key'}})),44999));
  });
  let settled=false;
  const pending=createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request)
   .catch(error=>{settled=true;return error;});
  await vi.advanceTimersByTimeAsync(44999);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);expect(signal?.aborted).toBe(true);
  const error=await pending;
  expect(error).toMatchObject({code:'analysis_provider_timeout',httpStatus:429,rejection:{httpStatus:429,preGeneration:false,
   retryAfterSeconds:76,providerRequestId:null,receivedAt:'2026-10-24T20:30:44.999Z'}});
  expect(JSON.stringify(error)).not.toMatch(/Bearer|fixture-key|actualUsd|nonbillable/);
  body.error(new Error('private synthetic cleanup'));
  await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it.each([200,429])('cleans up the deadline after a timely HTTP %i body without later abort',async status=>{
  vi.useFakeTimers();
  let signal:AbortSignal|undefined;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
   signal=init?.signal as AbortSignal;
   return Response.json(status===200?completion:errorBody,{status});
  });
  const result=await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request).catch(error=>error);
  if(status===200)expect(result.value).toEqual({ok:true});else expect(result.code).toBe('analysis_provider_http_429');
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(90000);
  expect(signal?.aborted).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('keeps deadline metadata and abort signals isolated across concurrent requests',async()=>{
  vi.useFakeTimers();vi.setSystemTime(receivedAt);
  const signals:AbortSignal[]=[],bodies:ReadableStreamDefaultController<Uint8Array>[]=[];
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
   signals.push(init?.signal as AbortSignal);
   const ordinal=signals.length;
   return new Response(new ReadableStream<Uint8Array>({start(controller){bodies.push(controller);}}),
    {status:ordinal===1?429:200,headers:{'content-type':'application/json','retry-after':'120','x-request-id':'req-first'}});
  });
  const generate=createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}));
  const first=generate(request).catch(error=>error);
  await vi.advanceTimersByTimeAsync(1000);
  let secondSettled=false;
  const second=generate(request).catch(error=>{secondSettled=true;return error;});
  await vi.advanceTimersByTimeAsync(44000);
  expect(await first).toMatchObject({code:'analysis_provider_timeout',httpStatus:429,rejection:{providerRequestId:'req-first'}});
  expect(signals[0].aborted).toBe(true);expect(signals[1].aborted).toBe(false);expect(secondSettled).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await second).toMatchObject({code:'analysis_provider_timeout',httpStatus:200,rejection:null});
  expect(signals[1].aborted).toBe(true);
  bodies.forEach(body=>body.error(new Error('private synthetic cleanup')));
  await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 });
});
