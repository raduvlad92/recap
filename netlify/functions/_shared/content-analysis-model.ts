import OpenAI from 'openai';
import { runtimeEnv, type Env } from './security';
export type AnalysisRole='summary'|'summary-reduce'|'extractor'|'checker';
export interface GenerationRequest {role:AnalysisRole;key:string;system:string;prompt:string;maxOutputTokens:number;schema:Record<string,unknown>}
export interface AnalysisUsage {inputTokens:number;outputTokens:number;cachedInputTokens?:number;cacheWriteTokens?:number}
export interface GenerationResult {value:unknown;providerId?:string;usage?:AnalysisUsage;observedUsd:number|null;actualUsd?:number|null}
export type AnalysisGenerator=(request:GenerationRequest)=>Promise<GenerationResult>;
export class AnalysisError extends Error {constructor(public code:string){super(code);}}
export const analysisFailure=(code:string):never=>{throw new AnalysisError(code);};
export interface AnalysisLimits {
 model:string;chunkChars:number;overlapChars:number;maxChunks:number;maxSourceChars:number;maxOutputTokens:number;
 inputUsdPerMillion:number;outputUsdPerMillion:number;maxCallUsd:number;maxInputTokens?:number;
 cachedInputUsdPerMillion?:number;cacheWriteUsdPerMillion?:number;cacheWriteApplies?:boolean;pricingVersion?:string;
}
const number=(env:Env,key:string,min:number,max:number)=>{
 const raw=env(key),value=raw?.trim()?Number(raw):NaN;
 if(!Number.isFinite(value)||value<min||value>max)return analysisFailure('analysis_configuration_required');
 return value;
};
/** Exact pinned model + explicit verified positive price plan. No deprecated/default model or pricier fallback. */
export function analysisLimits(env:Env=runtimeEnv):AnalysisLimits {
 const model=env('CONTENT_ANALYSIS_MODEL')?.trim(),pricingVersion=env('CONTENT_ANALYSIS_PRICING_VERSION')?.trim();
 if(!model||model.length>150||!/^[A-Za-z0-9_./:-]+$/.test(model)||env('CONTENT_ANALYSIS_PRICE_MODEL')!==model||env('CONTENT_ANALYSIS_PRICING_VERIFIED')!=='true'||!pricingVersion||pricingVersion.length>150)return analysisFailure('analysis_pricing_not_verified');
 const write=env('CONTENT_ANALYSIS_CACHE_WRITE_APPLIES');
 if(write!=='true'&&write!=='false')return analysisFailure('analysis_pricing_not_verified');
 const result:AnalysisLimits={model,pricingVersion,chunkChars:number(env,'CONTENT_ANALYSIS_CHUNK_CHARS',1000,24000),overlapChars:256,
  maxChunks:number(env,'CONTENT_ANALYSIS_MAX_CHUNKS',1,100),maxSourceChars:number(env,'CONTENT_ANALYSIS_MAX_SOURCE_CHARS',1000,1000000),
  maxOutputTokens:number(env,'CONTENT_ANALYSIS_MAX_OUTPUT_TOKENS',512,16000),
  inputUsdPerMillion:number(env,'CONTENT_ANALYSIS_INPUT_USD_PER_MILLION',0.000001,1000),
  outputUsdPerMillion:number(env,'CONTENT_ANALYSIS_OUTPUT_USD_PER_MILLION',0.000001,1000),
  cachedInputUsdPerMillion:number(env,'CONTENT_ANALYSIS_CACHED_INPUT_USD_PER_MILLION',0.000001,1000),
  cacheWriteApplies:write==='true',...(write==='true'?{cacheWriteUsdPerMillion:number(env,'CONTENT_ANALYSIS_CACHE_WRITE_USD_PER_MILLION',0.000001,1000)}:{}),
  maxCallUsd:number(env,'CONTENT_ANALYSIS_MAX_CALL_USD',0.000001,1),
  maxInputTokens:env('CONTENT_ANALYSIS_MAX_INPUT_TOKENS')?number(env,'CONTENT_ANALYSIS_MAX_INPUT_TOKENS',1000,128000):128000};
 if(![result.chunkChars,result.maxChunks,result.maxSourceChars,result.maxOutputTokens].every(Number.isInteger)||result.cachedInputUsdPerMillion!>result.inputUsdPerMillion)return analysisFailure('analysis_configuration_required');
 return result;
}
const money=(n:number)=>Math.ceil(n*1e9)/1e9;
/** UTF8 byte count bounds text tokens; JSON-schema/messages overhead reserved separately. */
export function conservativeCallUsd(request:GenerationRequest,limits:AnalysisLimits):number {
 const bytes=Buffer.byteLength(request.system+request.prompt+JSON.stringify(request.schema),'utf8')+4096;
 if(bytes>(limits.maxInputTokens||128000)||request.maxOutputTokens>limits.maxOutputTokens)return analysisFailure('analysis_input_limit');
 const inputRate=Math.max(limits.inputUsdPerMillion,limits.cacheWriteApplies?limits.cacheWriteUsdPerMillion||0:0);
 return money((bytes*inputRate+request.maxOutputTokens*limits.outputUsdPerMillion)/1e6);
}
/** Only verified rates and complete nonnegative token accounting can release a hold. */
export function usageUsd(usage:AnalysisUsage|undefined,limits:AnalysisLimits):number|null {
 if(!usage)return null;
 const input=usage.inputTokens,output=usage.outputTokens,cached=usage.cachedInputTokens;
 if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0||!Number.isSafeInteger(cached)||cached!<0||cached!>input)return null;
 if(limits.cachedInputUsdPerMillion===undefined||!Number.isFinite(limits.cachedInputUsdPerMillion)||limits.cachedInputUsdPerMillion<=0)return null;
 const writes=limits.cacheWriteApplies?usage.cacheWriteTokens:0;
 if(!Number.isSafeInteger(writes)||writes!<0||writes!+cached!>input||limits.cacheWriteApplies&&(!limits.cacheWriteUsdPerMillion||limits.cacheWriteUsdPerMillion<=0))return null;
 return money(((input-cached!-writes!)*limits.inputUsdPerMillion+cached!*limits.cachedInputUsdPerMillion+writes!*(limits.cacheWriteUsdPerMillion||0)+output*limits.outputUsdPerMillion)/1e6);
}
export type OpenAIClientFactory=(options?:{apiKey:string;baseURL:string})=>Pick<OpenAI,'chat'>;
/** Direct OpenAI uses the owner's existing server key. Optional gateway requires an exact verified injected URL. */
export function createOpenAIAnalysisGenerator(env:Env=runtimeEnv,factory:OpenAIClientFactory=options=>new OpenAI(options)):AnalysisGenerator {
 const limits=analysisLimits(env),route=env('CONTENT_ANALYSIS_ROUTE')||'direct',key=env('OPENAI_API_KEY');
 if(!key?.trim())return analysisFailure('analysis_credentials_required');
 let client:Pick<OpenAI,'chat'>;
 if(route==='direct') {
  const base=env('OPENAI_BASE_URL')||'https://api.openai.com/v1';
  if(base.replace(/\/$/,'')!=='https://api.openai.com/v1')return analysisFailure('analysis_provider_not_verified');
  client=factory({apiKey:key,baseURL:'https://api.openai.com/v1'});
 } else if(route==='netlify') {
  const expected=env('CONTENT_ANALYSIS_GATEWAY_BASE_URL'),actual=env('OPENAI_BASE_URL');
  if(!expected||expected!==actual||!env('NETLIFY_AI_GATEWAY_URL'))return analysisFailure('analysis_gateway_not_verified');
  let host:URL;try{host=new URL(expected);}catch{return analysisFailure('analysis_gateway_not_verified');}
  if(host.protocol!=='https:'||host.username||host.password||host.search||host.hash||!host.hostname.endsWith('.netlify.com'))return analysisFailure('analysis_gateway_not_verified');
  client=factory(); // Official SDK consumes Netlify's injected provider credentials.
 } else return analysisFailure('analysis_provider_not_verified');
 return async request=>{
  const effort=env('CONTENT_ANALYSIS_REASONING_EFFORT');
  if(effort!==undefined&&!['none','low'].includes(effort))return analysisFailure('analysis_configuration_required');
  const result=await client.chat.completions.create({model:limits.model,max_completion_tokens:request.maxOutputTokens,
   ...(effort?{reasoning_effort:effort as 'none'|'low'}:{}),
   messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],
   response_format:{type:'json_schema',json_schema:{name:'content_analysis',strict:true,schema:request.schema}},store:false,
  },{maxRetries:0,timeout:45000});
  const choice=result.choices[0];
  if(!choice||choice.finish_reason!=='stop'||choice.message.refusal||!choice.message.content)return analysisFailure('analysis_incomplete_generation');
  let value:unknown;try{value=JSON.parse(choice.message.content);}catch{return analysisFailure('analysis_invalid_json');}
  const details=result.usage?.prompt_tokens_details as ({cached_tokens?:number;cache_write_tokens?:number}|null|undefined);
  const usage=result.usage?{inputTokens:result.usage.prompt_tokens,outputTokens:result.usage.completion_tokens,
   // Missing cache accounting keeps the charge unknown; never infer it from text length.
   cachedInputTokens:details?.cached_tokens,...(limits.cacheWriteApplies?{cacheWriteTokens:details?.cache_write_tokens}:{})}:undefined;
  const actualUsd=usageUsd(usage,limits);
  return {value,providerId:result.id,actualUsd,observedUsd:actualUsd,...(usage?{usage}:{})};
 };
}
// Existing integration import remains valid; gateway is now optional within the factory.
export const createGatewayGenerator=createOpenAIAnalysisGenerator;
