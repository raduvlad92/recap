import OpenAI from 'openai';
import {providerHttpDiagnostic,type AnalysisProviderHttpDiagnostic} from './provider-http-diagnostic';
import { runtimeEnv, type Env } from './security';
import { ANALYSIS_MODEL_IDS } from '../../../src/lib/analysis-settings-types';
import { isAnalysisV2CallKey } from './content-analysis-grounded-v2-protocol';
import { isAnalysisV3CallKey } from './content-analysis-grounded-v3-protocol';
import { isAnalysisV4CallKey } from './content-analysis-grounded-v4-protocol';
export type AnalysisRole='summary'|'summary-reduce'|'extractor'|'checker';
export interface GenerationRequest {role:AnalysisRole;key:string;system:string;prompt:string;maxOutputTokens:number;schema:Record<string,unknown>;correction?:{baseKey:string;errorCode:string}}
export interface AnalysisUsage {inputTokens:number;outputTokens:number;cachedInputTokens?:number;cacheWriteTokens?:number;totalTokens?:number;reasoningOutputTokens?:number}
export interface GenerationResult {
 value:unknown;providerId?:string;usage?:AnalysisUsage;observedUsd:number|null;actualUsd?:number|null;
 executionIdentity?:AnalysisExecutionIdentity;
 validationError?:'analysis_invalid_json'|'analysis_output_capacity'|'analysis_provider_refusal';
 routing?:{route:'openrouter';model:string;provider:string|null;providerSlug:string;isByok:boolean|null;upstreamInferenceUsd:number|null;upstreamPromptUsd:number|null;upstreamCompletionUsd:number|null};
}
export type AnalysisGenerator=(request:GenerationRequest)=>Promise<GenerationResult>;
export class AnalysisError extends Error {constructor(public code:string){super(code);}}
/** Transport status is operational evidence, never proof of a zero charge.
 * No SDK error, message, raw body, headers or cause crosses this boundary. */
export interface AnalysisRejectionReceipt {
 httpStatus:429;preGeneration:boolean;retryAfterSeconds:number|null;providerRequestId:string|null;receivedAt:string;
}
export class AnalysisProviderHttpError extends AnalysisError {
 constructor(public httpStatus:number,public rejection:AnalysisRejectionReceipt|null=null,code?:'analysis_provider_timeout',public diagnostic:Readonly<AnalysisProviderHttpDiagnostic>|null=null){super(code??`analysis_provider_http_${httpStatus}`);}
}
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
  maxChunks:number(env,'CONTENT_ANALYSIS_MAX_CHUNKS',1,1000),maxSourceChars:number(env,'CONTENT_ANALYSIS_MAX_SOURCE_CHARS',1000,1000000),
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
export interface AnalysisExecutionIdentity {
 adapterVersion:string;route:'direct'|'netlify'|'openrouter';baseURL:string;provider:string;model:string;reasoningEffort:string|null;
 pricing:{version:string;inputUsdPerMillion:number;outputUsdPerMillion:number;cachedInputUsdPerMillion:number|null;cacheWriteApplies:boolean;cacheWriteUsdPerMillion:number|null};
}
const OPENROUTER_BASE_URL='https://openrouter.ai/api/v1';
const reasoningEffort=(env:Env):'none'|'low'|undefined=>{
 const effort=env('CONTENT_ANALYSIS_REASONING_EFFORT');
 if(effort!==undefined&&effort!=='none'&&effort!=='low')return analysisFailure('analysis_configuration_required');
 return effort;
};
/** Pure, credential-free identity for durable reservations and cache hashes. No defaults for model or prices. */
export function analysisExecutionIdentity(env:Env,limits:AnalysisLimits):AnalysisExecutionIdentity {
 const route=env('CONTENT_ANALYSIS_ROUTE')||'direct';
 if(route!=='direct'&&route!=='netlify'&&route!=='openrouter')return analysisFailure('analysis_provider_not_verified');
 if(!limits.pricingVersion?.trim()||limits.pricingVersion.length>150)return analysisFailure('analysis_pricing_not_verified');
 let baseURL:string,provider:string;
 if(route==='openrouter'){
  if(!(ANALYSIS_MODEL_IDS as readonly string[]).includes(limits.model))return analysisFailure('analysis_provider_not_verified');
  const slug=env('CONTENT_ANALYSIS_OPENROUTER_PROVIDER')?.trim();
  if(!slug||slug.length>150||!/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(slug)||!limits.model.includes('/')||limits.model.startsWith('openrouter/')||limits.model.includes(':'))return analysisFailure('analysis_provider_not_verified');
  baseURL=OPENROUTER_BASE_URL;provider=slug;
 }else if(route==='direct'){
  if((env('OPENAI_BASE_URL')||'https://api.openai.com/v1').replace(/\/$/,'')!=='https://api.openai.com/v1')return analysisFailure('analysis_provider_not_verified');
  baseURL='https://api.openai.com/v1';provider='openai';
 }else{
  const expected=env('CONTENT_ANALYSIS_GATEWAY_BASE_URL');
  if(!expected||expected!==env('OPENAI_BASE_URL')||!env('NETLIFY_AI_GATEWAY_URL'))return analysisFailure('analysis_gateway_not_verified');
  let host:URL;try{host=new URL(expected);}catch{return analysisFailure('analysis_gateway_not_verified');}
  if(host.protocol!=='https:'||host.username||host.password||host.search||host.hash||!host.hostname.endsWith('.netlify.com'))return analysisFailure('analysis_gateway_not_verified');
  baseURL=expected;provider='netlify';
 }
 return {adapterVersion:'content-analysis-model-v2',route,baseURL,provider,model:limits.model,reasoningEffort:reasoningEffort(env)??null,
  pricing:{version:limits.pricingVersion,inputUsdPerMillion:limits.inputUsdPerMillion,outputUsdPerMillion:limits.outputUsdPerMillion,
   cachedInputUsdPerMillion:limits.cachedInputUsdPerMillion??null,cacheWriteApplies:limits.cacheWriteApplies===true,
   cacheWriteUsdPerMillion:limits.cacheWriteApplies?limits.cacheWriteUsdPerMillion??null:null}};
}
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const safeRequestId=(value:unknown):string|null=>typeof value==='string'&&value.length<=200&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)?value:null;
function retryAfterSeconds(value:string|null,receivedAt:number):number|null {
 if(value===null)return null;
 // Persist at most one hour of provider metadata; the ledger independently
 // enforces its own minimum/exponential delay. Invalid metadata is absent.
 const seconds=/^\d+(?:\.\d+)?$/.test(value)?Number(value):/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)?(Date.parse(value)-receivedAt)/1000:NaN;
 return Number.isFinite(seconds)?Math.min(3600,Math.max(0,Math.ceil(seconds))):null;
}
function openRouterRejection(headers:Headers,receivedAt:number,preGeneration:boolean):AnalysisRejectionReceipt {
 return {httpStatus:429,preGeneration,retryAfterSeconds:retryAfterSeconds(headers.get('retry-after'),receivedAt),
  providerRequestId:safeRequestId(headers.get('x-request-id')),receivedAt:new Date(receivedAt).toISOString()};
}
function safeProviderFailure(error:unknown,route:string,transport:Readonly<AnalysisProviderHttpDiagnostic>|null=null):AnalysisError {
 if(error instanceof AnalysisError)return error;
 if(error instanceof OpenAI.APIConnectionTimeoutError)return new AnalysisError('analysis_provider_timeout');
 if(error instanceof OpenAI.APIError&&typeof error.status==='number'&&Number.isInteger(error.status)&&error.status>=100&&error.status<=599){
  const httpStatus=error.status,body=object(error.error),receivedAt=Date.now();
  // SDK APIError.status is the HTTP status, while body.code on a 200 can
  // describe a failure after processing began. A complete body is useful
  // telemetry, but EVEN a complete 429 can have a charge: keep its full hold.
  // https://openrouter.ai/docs/api_reference/errors-and-debugging
  // https://openrouter.ai/blog/insights/reliability-failover/
  const rejection:AnalysisRejectionReceipt|null=route==='openrouter'&&httpStatus===429&&error.headers instanceof Headers
   ?openRouterRejection(error.headers,receivedAt,body?.code===429&&typeof body.message==='string'&&!!body.message.trim()):null;
  const sameTransport=transport?.httpStatus===httpStatus?transport:null;
  const diagnostic=route==='openrouter'?providerHttpDiagnostic({httpStatus,requestMethod:sameTransport?.requestMethod,
   requestUrl:sameTransport?.requestUrl,responseUrl:sameTransport?.responseUrl,
   providerRequestId:error.headers instanceof Headers?error.headers.get('x-request-id'):null,
   providerCode:body?.code,receivedAt:sameTransport?.receivedAt??new Date(receivedAt).toISOString()}):null;
  return new AnalysisProviderHttpError(httpStatus,rejection,undefined,diagnostic);
 }
 return new AnalysisError(error instanceof OpenAI.APIConnectionError?'analysis_provider_network_error':'analysis_generation_failed');
}
const charge=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const tokens=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function openRouterUsage(value:unknown):AnalysisUsage|undefined {
 const raw=object(value);if(!raw||!tokens(raw.prompt_tokens)||!tokens(raw.completion_tokens))return undefined;
 const usage:AnalysisUsage={inputTokens:raw.prompt_tokens,outputTokens:raw.completion_tokens};
 if(raw.total_tokens!==undefined){if(!tokens(raw.total_tokens)||raw.total_tokens!==usage.inputTokens+usage.outputTokens)return undefined;usage.totalTokens=raw.total_tokens;}
 for(const [field,key,parent,max] of [
  ['cachedInputTokens','cached_tokens','prompt_tokens_details',usage.inputTokens],
  ['cacheWriteTokens','cache_write_tokens','prompt_tokens_details',usage.inputTokens],
  ['reasoningOutputTokens','reasoning_tokens','completion_tokens_details',usage.outputTokens],
 ] as const){
  const details=object(raw[parent]);if(raw[parent]!=null&&!details)return undefined;
  if(details?.[key]!==undefined){const count=details[key];if(!tokens(count)||count>max)return undefined;usage[field]=count;}
 }
 if((usage.cachedInputTokens??0)+(usage.cacheWriteTokens??0)>usage.inputTokens)return undefined;
 return usage;
}
/** Response model IDs are not guaranteed to echo request IDs: pin a separately reviewed exact response ID.
 * Provider names, when returned, are display names rather than endpoint slugs. Missing metadata stays unknown.
 * https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion
 */
export function createOpenRouterAnalysisGenerator(env:Env=runtimeEnv,factory:OpenAIClientFactory=options=>new OpenAI(options),options:{timeoutMs?:number}={}):AnalysisGenerator {
 const timeoutMs=options.timeoutMs===undefined?45000:options.timeoutMs;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)return analysisFailure('analysis_configuration_required');
 const limits=analysisLimits(env),identity=analysisExecutionIdentity(env,limits),key=env('OPENROUTER_API_KEY');
 if(identity.route!=='openrouter')return analysisFailure('analysis_provider_not_verified');
 if(!key?.trim())return analysisFailure('analysis_credentials_required');
 const providerName=env('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')?.trim();
 const responseModel=env('CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL')?.trim();
 if(!providerName||providerName.length>150||!responseModel||responseModel.length>150||!/^[A-Za-z0-9_./:-]+$/.test(responseModel))return analysisFailure('analysis_provider_not_verified');
 const client=factory({apiKey:key,baseURL:OPENROUTER_BASE_URL});
 return async request=>{
  if(!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1)return analysisFailure('analysis_input_limit');
  if(conservativeCallUsd(request,limits)>limits.maxCallUsd)return analysisFailure('analysis_call_limit');
  // OpenRouter max_tokens includes reasoning and visible output. require_parameters refuses unsupported settings.
  // https://openrouter.ai/docs/guides/routing/provider-selection
  const payload:OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {provider:Record<string,unknown>;reasoning?:{effort:'none'|'low';exclude:true}}={
   model:limits.model,max_tokens:request.maxOutputTokens,stream:false,service_tier:'default',
   ...(identity.reasoningEffort?{reasoning:{effort:identity.reasoningEffort as 'none'|'low',exclude:true as const}}:{}),
   provider:{only:[identity.provider],order:[identity.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',
    max_price:{prompt:limits.inputUsdPerMillion,completion:limits.outputUsdPerMillion,request:0}},
   messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],
   response_format:{type:'json_schema',json_schema:{name:'content_analysis',strict:true,schema:request.schema}},
  };
  // SDK 7.43 bounds success-body parsing, but its HTTP-error body read can stall
  // past timeout. One independent aborting deadline covers create + either body.
  // Status-only 429 evidence still pauses the worker and retains the full hold.
  const controller=new AbortController();
  let httpStatus:number|undefined,rejection:AnalysisRejectionReceipt|null=null,diagnostic:Readonly<AnalysisProviderHttpDiagnostic>|null=null,expired=false;
  // A per-request clone preserves the configured transport without mutating the
  // shared client. Observe headers before the SDK consumes a possible error body.
  const requestClient=client instanceof OpenAI?client.withOptions({}):client;
  if(requestClient instanceof OpenAI){
   const fetchWithTimeout=requestClient.fetchWithTimeout.bind(requestClient);
   requestClient.fetchWithTimeout=async(...args)=>{
    const response=await fetchWithTimeout(...args);
    if(!expired){
     httpStatus=response.status;
     diagnostic=providerHttpDiagnostic({httpStatus,requestMethod:args[1]?.method,requestUrl:String(args[0]),responseUrl:response.url,
      providerRequestId:response.headers.get('x-request-id'),receivedAt:new Date().toISOString()});
     if(response.status===429)rejection=openRouterRejection(response.headers,Date.now(),false);
    }
    return response;
   };
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>{
    expired=true;
    reject(httpStatus===undefined?new AnalysisError('analysis_provider_timeout'):new AnalysisProviderHttpError(httpStatus,rejection,'analysis_provider_timeout',diagnostic));
    controller.abort();
   },timeoutMs);
  });
  let result:unknown;
  // Promise.race observes late success/rejection even if a transport ignores abort.
  try{result=await Promise.race([Promise.resolve().then(()=>requestClient.chat.completions.create(payload,{maxRetries:0,timeout:timeoutMs,signal:controller.signal})),deadline]);}
  catch(error){throw safeProviderFailure(error,'openrouter',diagnostic);}
  finally{clearTimeout(timer);}
  const raw=object(result);
  if(!raw||raw.error!=null)return analysisFailure('analysis_incomplete_generation');
  if(raw.model!==responseModel||(raw.provider!=null&&raw.provider!==providerName)||typeof raw.id!=='string'||!raw.id.trim())return analysisFailure('analysis_provider_not_verified');
  const choices=raw.choices,choice=Array.isArray(choices)&&choices.length===1?object(choices[0]):undefined,message=object(choice?.message);
  if(!choice||choice.error!=null||!message||message.role!=='assistant'||message.tool_calls!=null)return analysisFailure('analysis_incomplete_generation');
  // For the new protocol, preserve known billable output before domain
  // validation. A refusal remains terminal; a materialized format failure can
  // take exactly one financially fenced correction. Legacy behavior is stable.
  const v2=isAnalysisV2CallKey(request.key)||isAnalysisV3CallKey(request.key)||isAnalysisV4CallKey(request.key)
   ||/^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$/.test(request.key);
  let validationError:GenerationResult['validationError'];
  if(message.refusal!=null){if(!v2)return analysisFailure('analysis_incomplete_generation');validationError='analysis_provider_refusal';}
  else if(choice.finish_reason!=='stop'){
   if(!v2||choice.finish_reason!=='length')return analysisFailure('analysis_incomplete_generation');
   validationError='analysis_output_capacity';
  }
  if(typeof message.content!=='string'||!message.content.trim()){
   if(!v2||!validationError)return analysisFailure('analysis_incomplete_generation');
  }
  let value:unknown;
  try{value=JSON.parse(typeof message.content==='string'?message.content:'');}
  catch{
   if(!v2)return analysisFailure('analysis_invalid_json');
   validationError??='analysis_invalid_json';
   value={rawOutput:typeof message.content==='string'?message.content:'',finishReason:choice.finish_reason};
  }
  if(validationError==='analysis_provider_refusal')value={rawOutput:typeof message.content==='string'?message.content:'',refusal:typeof message.refusal==='string'?message.refusal:null,finishReason:choice.finish_reason};
  const usage=openRouterUsage(raw.usage),accounting=object(raw.usage),details=object(accounting?.cost_details),observedUsd=charge(accounting?.cost);
  // cost is the account charge, not an estimate. BYOK can bill a second upstream account; retain its hold.
  // https://openrouter.ai/docs/cookbook/administration/usage-accounting
  const isByok=typeof accounting?.is_byok==='boolean'?accounting.is_byok:null;
  const actualUsd=isByok===false?observedUsd:null;
  return {value,providerId:raw.id,observedUsd,actualUsd,...(usage?{usage}:{}),...(validationError?{validationError}:{}),executionIdentity:identity,
   routing:{route:'openrouter',model:raw.model as string,provider:raw.provider==null?null:raw.provider as string,providerSlug:identity.provider,isByok,
    upstreamInferenceUsd:charge(details?.upstream_inference_cost),upstreamPromptUsd:charge(details?.upstream_inference_prompt_cost),upstreamCompletionUsd:charge(details?.upstream_inference_completions_cost)}};
 };
}
/** Direct OpenAI uses the owner's existing server key. Optional gateway requires an exact verified injected URL. */
export function createOpenAIAnalysisGenerator(env:Env=runtimeEnv,factory:OpenAIClientFactory=options=>new OpenAI(options)):AnalysisGenerator {
 if(env('CONTENT_ANALYSIS_ROUTE')==='openrouter')return createOpenRouterAnalysisGenerator(env,factory);
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
  },{maxRetries:0,timeout:45000}).catch(error=>{throw safeProviderFailure(error,route);});
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
