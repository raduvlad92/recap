import {describe,it,expect,vi} from 'vitest';
import {analysisLimits,createOpenAIAnalysisGenerator,type GenerationRequest,type OpenAIClientFactory} from '../netlify/functions/_shared/content-analysis-model';
const config:Record<string,string>={CONTENT_ANALYSIS_MODEL:'reviewed-model',CONTENT_ANALYSIS_PRICE_MODEL:'reviewed-model',CONTENT_ANALYSIS_PRICING_VERIFIED:'true',CONTENT_ANALYSIS_PRICING_VERSION:'official-2026-10-24',CONTENT_ANALYSIS_CHUNK_CHARS:'12000',CONTENT_ANALYSIS_MAX_CHUNKS:'30',CONTENT_ANALYSIS_MAX_SOURCE_CHARS:'200000',CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS:'4000',CONTENT_ANALYSIS_INPUT_USD_PER_MILLION:'.2',CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION:'1.2',CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION:'.02',CONTENT_ANALYSIS_CACHE_WRITE_APPLIES:'false',CONTENT_ANALYSIS_MAX_CALL_USD:'.02',OPENAI_API_KEY:'test-only-private-key',CONTENT_ANALYSIS_REASONING_EFFORT:'none'};
const env=(patch:Record<string,string|undefined>={})=>(name:string)=>({...config,...patch})[name];
const request:GenerationRequest={role:'summary',key:'summary:0',system:'policy',prompt:'source',schema:{type:'object'},maxOutputTokens:4000};
const fixture=(patch:Record<string,unknown>={})=>({id:'response-fixture',choices:[{finish_reason:'stop',message:{content:'{"readComplete":true}'}}],usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:500}},...patch});
describe('official OpenAI adapter with injected factory, no external calls',()=>{
 it('uses the reviewed direct URL by default without gateway environment or plan upgrade',async()=>{
  const create=vi.fn().mockResolvedValue(fixture()),factory=vi.fn(()=>({chat:{completions:{create}}}));
  const result=await createOpenAIAnalysisGenerator(env(),factory as unknown as OpenAIClientFactory)(request);
  expect(factory).toHaveBeenCalledWith({apiKey:'test-only-private-key',baseURL:'https://api.openai.com/v1'});
  expect(result.actualUsd).toBe(.00023);
  expect(create.mock.calls[0][0]).toMatchObject({model:'reviewed-model',reasoning_effort:'none',max_completion_tokens:4000,store:false,response_format:{type:'json_schema'}});
  expect(create.mock.calls[0][1]).toEqual({maxRetries:0,timeout:45000});
 });
 it('does not accept arbitrary model/baseURL targets or missing key',()=>{
  expect(()=>createOpenAIAnalysisGenerator(env({OPENAI_BASE_URL:'https://attacker.example/v1'}))).toThrow('analysis_provider_not_verified');
  expect(()=>createOpenAIAnalysisGenerator(env({OPENAI_API_KEY:undefined}))).toThrow('analysis_credentials_required');
  expect(()=>analysisLimits(env({CONTENT_ANALYSIS_PRICE_MODEL:'other-model'}))).toThrow('analysis_pricing_not_verified');
 });
 it.each(['0','-1','NaN','Infinity','',undefined])('rejects nonpositive or unknown token pricing %s',value=>expect(()=>analysisLimits(env({CONTENT_ANALYSIS_INPUT_USD_PER_MILLION:value}))).toThrow());
 it('requires exact verified optional Netlify injection and constructs the SDK with no options there',async()=>{
  const create=vi.fn().mockResolvedValue(fixture()),factory=vi.fn(()=>({chat:{completions:{create}}}));
  const gateway={CONTENT_ANALYSIS_ROUTE:'netlify',OPENAI_BASE_URL:'https://ai-gateway.netlify.com/v1',CONTENT_ANALYSIS_GATEWAY_BASE_URL:'https://ai-gateway.netlify.com/v1',NETLIFY_AI_GATEWAY_URL:'https://ai-gateway.netlify.com'};
  await createOpenAIAnalysisGenerator(env(gateway),factory as unknown as OpenAIClientFactory)(request);
  expect(factory).toHaveBeenCalledWith();
  expect(()=>createOpenAIAnalysisGenerator(env({...gateway,CONTENT_ANALYSIS_GATEWAY_BASE_URL:'https://different.netlify.com/v1'}))).toThrow('analysis_gateway_not_verified');
 });
 it('retains unknown cost when usage is absent and refuses truncated model output',async()=>{
  const factory=()=>({chat:{completions:{create:vi.fn().mockResolvedValue(fixture({usage:undefined}))}}});
  const result=await createOpenAIAnalysisGenerator(env(),factory as unknown as OpenAIClientFactory)(request);
  expect(result.actualUsd).toBeNull();expect(result.observedUsd).toBeNull();
  await expect(createOpenAIAnalysisGenerator(env(),(()=>({chat:{completions:{create:vi.fn().mockResolvedValue(fixture({choices:[{finish_reason:'length',message:{content:'{}'}}]}))}}})) as unknown as OpenAIClientFactory)(request)).rejects.toThrow('analysis_incomplete_generation');
 });
});
