import OpenAI from 'openai';
import {describe,it,expect,vi} from 'vitest';
import {analysisExecutionIdentity,analysisLimits,createGatewayGenerator,createOpenRouterAnalysisGenerator,type GenerationRequest,type OpenAIClientFactory} from '../netlify/functions/_shared/content-analysis-model';

// Reviewed-looking values are synthetic configuration, not an access/pricing verification.
const config:Record<string,string>={
 CONTENT_ANALYSIS_ROUTE:'openrouter',OPENROUTER_API_KEY:'fixture-router-key',
 CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8',CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME:'DeepInfra',
 CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:'deepseek/deepseek-v4.1-flash-1017',
 CONTENT_ANALYSIS_MODEL:'deepseek/deepseek-v4.1-flash-1017',CONTENT_ANALYSIS_PRICE_MODEL:'deepseek/deepseek-v4.1-flash-1017',
 CONTENT_ANALYSIS_PRICING_VERIFIED:'true',CONTENT_ANALYSIS_PRICING_VERSION:'fixture-pricing-v1',
 CONTENT_ANALYSIS_CHUNK_CHARS:'12000',CONTENT_ANALYSIS_MAX_CHUNKS:'30',CONTENT_ANALYSIS_MAX_SOURCE_CHARS:'200000',
 CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS:'4000',CONTENT_ANALYSIS_INPUT_USD_PER_MILLION:'.1',CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION:'.4',
 CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION:'.01',CONTENT_ANALYSIS_CACHE_WRITE_APPLIES:'false',CONTENT_ANALYSIS_MAX_CALL_USD:'.02',
 CONTENT_ANALYSIS_REASONING_EFFORT:'none',
};
const env=(patch:Record<string,string|undefined>={})=>(name:string)=>({...config,...patch})[name];
const request:GenerationRequest={role:'summary',key:'summary:0',system:'policy',prompt:'untrusted source',maxOutputTokens:4000,
 schema:{type:'object',properties:{readComplete:{type:'boolean'}},required:['readComplete'],additionalProperties:false}};
const usage={prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_tokens_details:{cached_tokens:500,cache_write_tokens:100},completion_tokens_details:{reasoning_tokens:40},cost:.0007,is_byok:false,cost_details:{upstream_inference_cost:0}};
const fixture=(patch:Record<string,unknown>={})=>({id:'gen-fixture',model:'deepseek/deepseek-v4.1-flash-1017',provider:'DeepInfra',choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"readComplete":true}'}}],usage,...patch});
const injected=(response:unknown=fixture())=>{
 const create=vi.fn().mockResolvedValue(response),factory=vi.fn(()=>({chat:{completions:{create}}}));
 return {create,factory,factoryArg:factory as unknown as OpenAIClientFactory};
};
describe('OpenRouter analysis adapter, synthetic responses only',()=>{
 it('routes through the existing integration with exact host/key, strict schema, pinned routing and server price ceilings',async()=>{
  const sdk=injected(),read=vi.fn(env({OPENAI_API_KEY:'wrong-provider-key',OPENAI_BASE_URL:'https://attacker.invalid'}));
  const result=await createGatewayGenerator(read,sdk.factoryArg)(request);
  expect(sdk.factory).toHaveBeenCalledExactlyOnceWith({apiKey:'fixture-router-key',baseURL:'https://openrouter.ai/api/v1'});
  expect(read.mock.calls.flat()).not.toContain('OPENAI_API_KEY');
  expect(read.mock.calls.flat()).not.toContain('OPENAI_BASE_URL');
  expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
   model:'deepseek/deepseek-v4.1-flash-1017',max_tokens:4000,stream:false,service_tier:'default',reasoning:{effort:'none',exclude:true},
   provider:{only:['deepinfra/fp8'],order:['deepinfra/fp8'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',max_price:{prompt:.1,completion:.4,request:0}},
   messages:[{role:'system',content:'policy'},{role:'user',content:'untrusted source'}],
   response_format:{type:'json_schema',json_schema:{name:'content_analysis',strict:true,schema:request.schema}},
  },{maxRetries:0,timeout:45000,signal:expect.any(AbortSignal)});
  expect(result).toMatchObject({value:{readComplete:true},providerId:'gen-fixture',actualUsd:.0007,observedUsd:.0007,
   usage:{inputTokens:1000,outputTokens:100,totalTokens:1100,cachedInputTokens:500,cacheWriteTokens:100,reasoningOutputTokens:40},
   routing:{route:'openrouter',model:'deepseek/deepseek-v4.1-flash-1017',provider:'DeepInfra',providerSlug:'deepinfra/fp8',isByok:false,upstreamInferenceUsd:0}});
 });
 it('does not infer allowed response IDs from upstream bare IDs or request suffixes',async()=>{
  await expect(createOpenRouterAnalysisGenerator(env(),injected(fixture({model:'fixture-model'})).factoryArg)(request)).rejects.toThrow('analysis_provider_not_verified');
 });
 it('accepts a separately verified response ID rather than requiring a universal request echo',async()=>{
  const result=await createOpenRouterAnalysisGenerator(env({CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:'fixture-model-2026-10-24'}),injected(fixture({model:'fixture-model-2026-10-24'})).factoryArg)(request);
  expect(result.routing?.model).toBe('fixture-model-2026-10-24');expect(result.executionIdentity?.model).toBe('deepseek/deepseek-v4.1-flash-1017');
 });
 it('allows documented missing provider metadata and retains it as unknown, while request routing remains pinned',async()=>{
  const sdk=injected(fixture({provider:undefined})),result=await createOpenRouterAnalysisGenerator(env(),sdk.factoryArg)(request);
  expect(result.routing?.provider).toBeNull();expect(sdk.create.mock.calls[0][0].provider.only).toEqual(['deepinfra/fp8']);
 });
 it.each([{model:'other/fixture-model'},{model:undefined},{provider:'Other Provider'},{provider:'deepinfra/fp8'},{provider:123},{id:''},{id:123}])('rejects unexpected response identity %j',async patch=>{
  await expect(createOpenRouterAnalysisGenerator(env(),injected(fixture(patch)).factoryArg)(request)).rejects.toThrow('analysis_provider_not_verified');
 });
 it.each([
  {CONTENT_ANALYSIS_OPENROUTER_PROVIDER:undefined},{CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'DeepInfra'},
  {CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8,other'},{CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'https://attacker.invalid'},
  {CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME:undefined},
  {CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:undefined},{CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:' '},
 ])('requires explicit provider slug and reviewed response display name %j',patch=>{
  const sdk=injected();expect(()=>createOpenRouterAnalysisGenerator(env(patch),sdk.factoryArg)).toThrow('analysis_provider_not_verified');expect(sdk.factory).not.toHaveBeenCalled();
 });
 it('never falls back to an OpenAI key',()=>{
  const sdk=injected();expect(()=>createGatewayGenerator(env({OPENROUTER_API_KEY:undefined,OPENAI_API_KEY:'fixture-direct-key'}),sdk.factoryArg)).toThrow('analysis_credentials_required');expect(sdk.factory).not.toHaveBeenCalled();
 });
 it.each(['openrouter/auto','openrouter/free','deepseek/deepseek-v4.1-flash-1017:free','bare-model','reviewed/model','google/gemini-2.5-flash-lite','openai/gpt-6-luna','deepseek/deepseek-v4.1-flash'])('does not accept any model outside the four exact IDs: %s',model=>{
  const sdk=injected(),read=vi.fn(env({CONTENT_ANALYSIS_MODEL:model,CONTENT_ANALYSIS_PRICE_MODEL:model}));
  expect(()=>createOpenRouterAnalysisGenerator(read,sdk.factoryArg)).toThrow('analysis_provider_not_verified');
  expect(()=>analysisExecutionIdentity(read,{...analysisLimits(env()),model})).toThrow('analysis_provider_not_verified');
  expect(sdk.factory).not.toHaveBeenCalled();
  expect(read.mock.calls.flat()).not.toContain('OPENROUTER_API_KEY');
 });
 it('keeps the full provider endpoint suffix in routing and identity',async()=>{
  const sdk=injected(),read=env({CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'inference-net/fp4'});
  const result=await createOpenRouterAnalysisGenerator(read,sdk.factoryArg)(request);
  expect(sdk.create.mock.calls[0][0].provider.only).toEqual(['inference-net/fp4']);
  expect(sdk.create.mock.calls[0][0].provider.order).toEqual(['inference-net/fp4']);
  expect(result.executionIdentity?.provider).toBe('inference-net/fp4');
 });
 it.each(['none','low'])('maps supported reasoning effort %s into the OpenRouter object',async effort=>{
  const sdk=injected();await createOpenRouterAnalysisGenerator(env({CONTENT_ANALYSIS_REASONING_EFFORT:effort}),sdk.factoryArg)(request);
  expect(sdk.create.mock.calls[0][0].reasoning).toEqual({effort,exclude:true});
  expect(sdk.create.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
 });
 it('omits reasoning when no explicit effort is configured',async()=>{
  const sdk=injected();await createOpenRouterAnalysisGenerator(env({CONTENT_ANALYSIS_REASONING_EFFORT:undefined}),sdk.factoryArg)(request);
  expect(sdk.create.mock.calls[0][0]).not.toHaveProperty('reasoning');
 });
 it.each(['','high','invalid','max_tokens:100'])('rejects unsupported reasoning configuration %s before constructing a client',effort=>{
  const sdk=injected();expect(()=>createOpenRouterAnalysisGenerator(env({CONTENT_ANALYSIS_REASONING_EFFORT:effort}),sdk.factoryArg)).toThrow('analysis_configuration_required');expect(sdk.factory).not.toHaveBeenCalled();
 });
 it.each([undefined,null,'0.01',NaN,Infinity,-1,{},false])('preserves unknown/malformed cost %j as null instead of estimating from tokens',async cost=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:{...usage,cost}})).factoryArg)(request);
  expect(result.observedUsd).toBeNull();expect(result.actualUsd).toBeNull();
  expect(result.usage?.inputTokens).toBe(1000);
 });
 it('accepts an actual numeric zero account charge and retains reasoning inside completion totals',async()=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:{...usage,cost:0}})).factoryArg)(request);
  expect(result.actualUsd).toBe(0);expect(result.observedUsd).toBe(0);expect(result.usage?.outputTokens).toBe(100);expect(result.usage?.reasoningOutputTokens).toBe(40);
 });
 it.each([undefined,null,[],{cost:.1,is_byok:false,prompt_tokens:'100',completion_tokens:2},
  {...usage,total_tokens:999},{...usage,completion_tokens:-1},{...usage,prompt_tokens:NaN},
  {...usage,completion_tokens_details:{reasoning_tokens:101}},{...usage,prompt_tokens_details:{cached_tokens:1001}},
  {...usage,prompt_tokens_details:{cached_tokens:950,cache_write_tokens:100}},{...usage,prompt_tokens_details:[]}])('does not fabricate valid token accounting for malformed usage %j',async rawUsage=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:rawUsage})).factoryArg)(request);
  expect(result.usage).toBeUndefined();
  expect(result.observedUsd).toBe(rawUsage&&typeof rawUsage==='object'&&!Array.isArray(rawUsage)&&'cost' in rawUsage?rawUsage.cost:null);
 });
 it('retains missing cache/reasoning counters as absent, not invented zeroes',async()=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:{prompt_tokens:10,completion_tokens:5,is_byok:false,cost:.001}})).factoryArg)(request);
  expect(result.usage).toEqual({inputTokens:10,outputTokens:5});expect(result.actualUsd).toBe(.001);
 });
 it.each([true,undefined,'false'])('retains account charge but does not settle uncertain/BYOK upstream billing (%j)',async isByok=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:{...usage,is_byok:isByok,cost:.0005,cost_details:{upstream_inference_cost:.01,upstream_inference_prompt_cost:.003,upstream_inference_completions_cost:.007}}})).factoryArg)(request);
  expect(result.observedUsd).toBe(.0005);expect(result.actualUsd).toBeNull();
  expect(result.routing).toMatchObject({isByok:typeof isByok==='boolean'?isByok:null,upstreamInferenceUsd:.01,upstreamPromptUsd:.003,upstreamCompletionUsd:.007});
 });
 it('does not add upstream details to the documented non-BYOK total charge',async()=>{
  const result=await createOpenRouterAnalysisGenerator(env(),injected(fixture({usage:{...usage,cost_details:{upstream_inference_cost:9}}})).factoryArg)(request);
  expect(result.actualUsd).toBe(.0007);expect(result.routing?.upstreamInferenceUsd).toBe(9);
 });
 it.each([
  {error:{code:502}}, {choices:[]},{choices:null},{choices:[{},{}]},
  ...['length','content_filter','error','tool_calls',null].map(finish_reason=>({choices:[{finish_reason,message:{content:'{}'}}]})),
  {choices:[{finish_reason:'stop',error:{code:500},message:{content:'{}'}}]},
  {choices:[{finish_reason:'stop',message:{content:'{}',refusal:'refused'}}]},
  {choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[]}}]},
  {choices:[{finish_reason:'stop',message:{content:null}}]},
  {choices:[{finish_reason:'stop',message:{content:[]}}]},
  {choices:[{finish_reason:'stop',message:{role:'user',content:'{}'}}]},
  {choices:[{finish_reason:'stop',message:{role:'assistant',content:'{}',refusal:false}}]},
 ])('rejects refusal, errors, truncation, tools and invalid envelopes without another request %j',async patch=>{
  const sdk=injected(fixture(patch));await expect(createOpenRouterAnalysisGenerator(env(),sdk.factoryArg)(request)).rejects.toThrow('analysis_incomplete_generation');expect(sdk.create).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid JSON without healing, fallback or retries',async()=>{
  const sdk=injected(fixture({choices:[{finish_reason:'stop',message:{role:'assistant',content:'```json\n{}\n```'}}]}));
  await expect(createOpenRouterAnalysisGenerator(env(),sdk.factoryArg)(request)).rejects.toThrow('analysis_invalid_json');expect(sdk.create).toHaveBeenCalledTimes(1);
 });
 it('does not call the client when output/cost bounds are exceeded',async()=>{
  const sdk=injected(),generate=createOpenRouterAnalysisGenerator(env(),sdk.factoryArg);
  await expect(generate({...request,maxOutputTokens:4001})).rejects.toThrow('analysis_input_limit');
  await expect(generate({...request,maxOutputTokens:1.5})).rejects.toThrow('analysis_input_limit');
  await expect(createOpenRouterAnalysisGenerator(env({CONTENT_ANALYSIS_MAX_CALL_USD:'.000001'}),sdk.factoryArg)(request)).rejects.toThrow('analysis_call_limit');
  expect(sdk.create).not.toHaveBeenCalled();
 });
 it('serializes the exact OpenRouter endpoint, credential and extension fields through pinned SDK with injected fetch',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture()),{headers:{'content-type':'application/json'}}));
  await createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,init]=fetcher.mock.calls[0];expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-router-key');
  const body=JSON.parse(init?.body as string);expect(body.provider.only).toEqual(['deepinfra/fp8']);expect(body.max_tokens).toBe(4000);expect(body).not.toHaveProperty('max_completion_tokens');expect(body).not.toHaveProperty('store');
 });
 it('does not retry a provider HTTP failure in the pinned SDK',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{"error":{"message":"unavailable"}}',{status:503,headers:{'content-type':'application/json'}}));
  await expect(createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('enforces the 45 second deadline after headers while body bytes are stalled, with no retry',async()=>{
  vi.useFakeTimers();
  try{
   const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"id":'));}}),{headers:{'content-type':'application/json'}}));
   const pending=createOpenRouterAnalysisGenerator(env(),options=>new OpenAI({...options,fetch:fetcher}))(request);
   const rejected=expect(pending).rejects.toThrow('analysis_provider_timeout');
   await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(45000);await rejected;expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it('uses a bounded explicit 120 second deadline for both SDK and independent abort, without retry',async()=>{
  vi.useFakeTimers();
  try{
   const create=vi.fn().mockImplementation(()=>new Promise(()=>{})),factory=(()=>({chat:{completions:{create}}})) as unknown as OpenAIClientFactory;
   const pending=createOpenRouterAnalysisGenerator(env(),factory,{timeoutMs:120000})({...request,key:'keyword-learning:v1:background-slow'});
   const rejected=expect(pending).rejects.toThrow('analysis_provider_timeout');
   await vi.advanceTimersByTimeAsync(45000);
   expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][1]).toMatchObject({maxRetries:0,timeout:120000});
   const signal=create.mock.calls[0][1].signal as AbortSignal;expect(signal.aborted).toBe(false);
   await vi.advanceTimersByTimeAsync(74999);expect(signal.aborted).toBe(false);
   await vi.advanceTimersByTimeAsync(1);await rejected;expect(signal.aborted).toBe(true);expect(create).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it.each([0,-1,120001,1.5,NaN,Infinity,'120000',null])('rejects an invalid explicit transport deadline %j before client construction',timeoutMs=>{
  const sdk=injected();expect(()=>createOpenRouterAnalysisGenerator(env(),sdk.factoryArg,{timeoutMs} as never)).toThrow('analysis_configuration_required');expect(sdk.factory).not.toHaveBeenCalled();
 });
});
describe('pure analysis execution identity contract',()=>{
 it('returns the exact stable non-secret identity shape and never reads keys',()=>{
  const limits=analysisLimits(env()),read=vi.fn(env());
  expect(analysisExecutionIdentity(read,limits)).toEqual({adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'deepinfra/fp8',model:'deepseek/deepseek-v4.1-flash-1017',reasoningEffort:'none',pricing:{version:'fixture-pricing-v1',inputUsdPerMillion:.1,outputUsdPerMillion:.4,cachedInputUsdPerMillion:.01,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}});
  expect(read.mock.calls.flat().some(name=>name.includes('KEY'))).toBe(false);
 });
 it.each(['direct','netlify'] as const)('preserves the %s route identity',route=>{
  const read=env({CONTENT_ANALYSIS_ROUTE:route,OPENAI_BASE_URL:route==='direct'?'https://api.openai.com/v1':'https://gateway.netlify.com/v1',CONTENT_ANALYSIS_GATEWAY_BASE_URL:'https://gateway.netlify.com/v1',NETLIFY_AI_GATEWAY_URL:'https://gateway.netlify.com'});
  expect(analysisExecutionIdentity(read,analysisLimits(read))).toMatchObject({route,provider:route==='direct'?'openai':'netlify'});
 });
 it('requires a real explicit pricing version even for injected limits',()=>{
  expect(()=>analysisExecutionIdentity(env(),{...analysisLimits(env()),pricingVersion:undefined})).toThrow('analysis_pricing_not_verified');
 });
 it('changes whenever the route, endpoint, model, reasoning or price plan changes',()=>{
  const limits=analysisLimits(env()),baseline=analysisExecutionIdentity(env(),limits);
  for(const patch of [{CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'inference-net/fp4'},{CONTENT_ANALYSIS_REASONING_EFFORT:'low'}])expect(analysisExecutionIdentity(env(patch),limits)).not.toEqual(baseline);
  for(const patch of [{model:'minimax/minimax-m3.1-flash'},{pricingVersion:'other-version'},{inputUsdPerMillion:.2},{outputUsdPerMillion:.8},{cachedInputUsdPerMillion:.02},{cacheWriteApplies:true,cacheWriteUsdPerMillion:.15}])expect(analysisExecutionIdentity(env(),{...limits,...patch})).not.toEqual(baseline);
 });
});

describe('content-v3 materialized response accounting, synthetic provider only',()=>{
 it.each([
  {name:'invalid JSON',finish:'stop',content:'{"unfinished":',refusal:undefined,error:'analysis_invalid_json'},
  {name:'truncated body',finish:'length',content:'{"readComplete":false}',refusal:undefined,error:'analysis_output_capacity'},
  {name:'provider refusal',finish:'stop',content:'',refusal:'Synthetic refusal.',error:'analysis_provider_refusal'},
 ])('retains known charges and raw $name for durable validation without an adapter retry',async test=>{
  const sdk=injected(fixture({choices:[{finish_reason:test.finish,message:{role:'assistant',content:test.content,...(test.refusal?{refusal:test.refusal}:{})}}]}));
  const result=await createOpenRouterAnalysisGenerator(env(),sdk.factoryArg)({...request,key:'summary:v3:chunk:0'});
  expect(result.validationError).toBe(test.error);expect(result.actualUsd).toBe(.0007);expect(result.providerId).toBe('gen-fixture');expect(result.executionIdentity?.model).toBe(config.CONTENT_ANALYSIS_MODEL);
  expect(sdk.create).toHaveBeenCalledTimes(1);expect(sdk.create.mock.calls[0][1]).toMatchObject({maxRetries:0,timeout:45000});
 });
 it('keeps unknown BYOK cost unknown for v3 malformed output',async()=>{
  const sdk=injected(fixture({usage:{...usage,is_byok:true},choices:[{finish_reason:'stop',message:{role:'assistant',content:'invalid'}}]}));
  const result=await createOpenRouterAnalysisGenerator(env(),sdk.factoryArg)({...request,key:'extractor:v3:chunk:0'});
  expect(result.validationError).toBe('analysis_invalid_json');expect(result.observedUsd).toBe(.0007);expect(result.actualUsd).toBeNull();expect(sdk.create).toHaveBeenCalledTimes(1);
 });
});
