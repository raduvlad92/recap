import {AnalysisError,analysisExecutionIdentity,analysisLimits,type GenerationRequest} from './content-analysis-model';
import {fetchNoRedirect} from './fetch-no-redirect';
import type {Env} from './security';

/** Pure additional admission check; no reservation or inference authority.
 * A compatible advertisement is NOT billing, auth, policy, availability or spending authority.
 */
export type PricePin={model:string;providerSlug:string;providerName:string;advertisedServiceTier:null|'default';promptPerMillion:string;completionPerMillion:string;cachedInputPerMillion:string;requestUsd:string;cacheWriteApplies:boolean;cacheWritePerMillion:string|null;requiredParameters:readonly string[]};
export type MetadataObservation={httpStatus:number;receivedAtMs:number;nowMs:number;maximumAgeMs:number};
export type RoutePriceCode='pin_invalid'|'metadata_unavailable'|'metadata_invalid'|'metadata_stale'|'model_mismatch'|'provider_missing'|'parameters_unsupported'|'price_unknown'|'price_exceeds_pin'|'advertised_constraints_compatible';
export type RoutePriceResult={compatible:boolean;code:RoutePriceCode;actualQualification:false;spendingAuthority:false;matchingEndpoints:number;compatibleTags:string[]};
const slug=/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;
const model=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const parameter=/^[a-z][a-z0-9_]{0,49}$/;
const object=(x:unknown):Record<string,unknown>|undefined=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:undefined;
// All quantities have at most 18 fractional digits; comparisons are exact BigInt.
// Reject exponent/sign/whitespace/locale formats rather than infer another amount.
const decimal=(x:unknown):bigint|null=>{
 if(typeof x!=='string'||x.length>37||!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,18})?$/.test(x))return null;
 const [a,b='']=x.split('.');return BigInt(a)*10n**18n+BigInt(b.padEnd(18,'0'));
};
const result=(code:RoutePriceCode,matchingEndpoints=0,compatibleTags:string[]=[]):RoutePriceResult=>({compatible:code==='advertised_constraints_compatible',code,actualQualification:false,spendingAuthority:false,matchingEndpoints,compatibleTags});
/** Includes an explicit request-fee comparison; absent pricing.request is UNKNOWN.
 * Status 0 is only an accepted advertised marker, never native availability proof.
 * Prefix matching follows the request's provider family; it does not select a new endpoint.
 */
export function compareAdvertisedRoutePrices(text:string,pin:PricePin,observation:MetadataObservation):RoutePriceResult{
 const rates=pin&&[pin.promptPerMillion,pin.completionPerMillion,pin.cachedInputPerMillion,pin.requestUsd].map(decimal);
 if(!pin||!model.test(pin.model)||pin.model.length>150||!slug.test(pin.providerSlug)||pin.providerSlug.length>150
  ||typeof pin.providerName!=='string'||!pin.providerName.trim()||pin.providerName!==pin.providerName.trim()||pin.providerName.length>150||/[\u0000-\u001f\u007f]/.test(pin.providerName)
  ||!Object.hasOwn(pin,'advertisedServiceTier')||!(pin.advertisedServiceTier===null||pin.advertisedServiceTier==='default')
  ||!rates||rates.some(x=>x===null)||rates[0]===0n||rates[1]===0n
  ||typeof pin.cacheWriteApplies!=='boolean'||(pin.cacheWriteApplies?(decimal(pin.cacheWritePerMillion)===null||decimal(pin.cacheWritePerMillion)===0n):pin.cacheWritePerMillion!==null)
  ||!Array.isArray(pin.requiredParameters)||pin.requiredParameters.length<1||pin.requiredParameters.length>20||new Set(pin.requiredParameters).size!==pin.requiredParameters.length||pin.requiredParameters.some(x=>typeof x!=='string'||!parameter.test(x)))return result('pin_invalid');
 const o=observation;
 if(!o||o.httpStatus!==200)return result('metadata_unavailable');
 if(![o.nowMs,o.receivedAtMs,o.maximumAgeMs].every(Number.isSafeInteger)||o.nowMs<0||o.receivedAtMs<0||o.maximumAgeMs<1||o.maximumAgeMs>60000||o.receivedAtMs>o.nowMs||o.nowMs-o.receivedAtMs>o.maximumAgeMs)return result('metadata_stale');
 if(typeof text!=='string'||new TextEncoder().encode(text).length>524288)return result('metadata_invalid');
 let raw:unknown;try{raw=JSON.parse(text);}catch{return result('metadata_invalid');}
 const root=object(raw),data=object(root?.data),endpoints=data?.endpoints;
 if(!root||root.error!=null||!data||!Array.isArray(endpoints)||endpoints.length>512)return result('metadata_invalid');
 if(data.id!==pin.model)return result('model_mismatch');
 const seen=new Set<string>();let matches=0,unknown=false,over=false,unsupported=false;const compatibleTags:string[]=[];
 for(const value of endpoints){
  const e=object(value);if(!e||typeof e.tag!=='string'||!slug.test(e.tag)||e.tag.length>150||typeof e.provider_name!=='string')return result('metadata_invalid');
  if(seen.has(e.tag))return result('metadata_invalid');seen.add(e.tag);
  if(!(e.tag===pin.providerSlug||e.tag.startsWith(pin.providerSlug+'/')))continue;
  matches++;
  if(e.provider_name!==pin.providerName)return result('metadata_invalid',matches);
  // Match the frozen reviewed metadata marker EXACTLY, with no implicit
  // null-to-default or alternative-tier mapping. This does not prove routing.
  if(e.model_id!==pin.model||e.status!==0||e.service_tier!==pin.advertisedServiceTier){unknown=true;continue;}
  const parameters=e.supported_parameters;
  if(!Array.isArray(parameters)||parameters.length>200||parameters.some(x=>typeof x!=='string'||!parameter.test(x))||!pin.requiredParameters.every(x=>parameters.includes(x))){unsupported=true;continue;}
  const p=object(e.pricing),actual=p&&[p.prompt,p.completion,p.input_cache_read,p.request].map(decimal);
  if(!actual){unknown=true;continue;}
  const writes=decimal(p?.input_cache_write),writePin=pin.cacheWriteApplies?decimal(pin.cacheWritePerMillion):0n;
  const incomplete=actual.some(x=>x===null)||writes===null;
  if(incomplete)unknown=true;
  // Token rates supplied by endpoint API are per TOKEN; pin and max_price are per MILLION.
  if(actual.slice(0,3).some((v,i)=>v!==null&&v*1000000n>rates[i]!)||(actual[3]!==null&&actual[3]>rates[3]!)||(writes!==null&&writes*1000000n>writePin!)){over=true;continue;}
  if(incomplete)continue;
  compatibleTags.push(e.tag);
 }
 // only/order may choose ANY matching endpoint; max_price cannot cap cached
 // rates. One cheap sibling must never bless an expensive/unknown sibling.
 if(compatibleTags.length===matches&&matches>0)return result('advertised_constraints_compatible',matches,compatibleTags.sort());
 return result(matches===0?'provider_missing':over?'price_exceeds_pin':unknown?'price_unknown':unsupported?'parameters_unsupported':'metadata_invalid',matches);
}

const METADATA_ORIGIN='https://openrouter.ai';
const MAX_BYTES=512*1024,MAX_AGE_MS=60000,TIMEOUT_MS=3000;
export interface ProviderMetadataReceipt {
 route:'openrouter'|'direct'|'netlify';checked:boolean;observedAt:string|null;
 compatibleTags:readonly string[];actualQualification:false;spendingAuthority:false;
}
/** Recheck after every awaited native gate. A stale advertisement cannot
 * authorize a new reservation or a provider call delayed by database I/O. */
export function assertProviderMetadataFresh(receipt:ProviderMetadataReceipt,nowMs=Date.now()):void {
 if(receipt.route!=='openrouter')return;
 const observed=receipt.observedAt===null?NaN:Date.parse(receipt.observedAt);
 if(!receipt.checked||!Number.isSafeInteger(nowMs)||!Number.isFinite(observed)||observed>nowMs||nowMs-observed>60000)
  throw new AnalysisError('analysis_provider_metadata_stale');
}
export type ProviderMetadataGuard=(env:Env,request:GenerationRequest)=>Promise<ProviderMetadataReceipt>;
const failure=(reason:string):never=>{throw new AnalysisError('analysis_provider_'+reason);};
/** Public metadata GET only. Never sends credentials, source text or account IDs.
 * No redirects/retries/cache reuse. The separate inference request retains all
 * original provider, privacy and maximum-price filters after this check.
 */
export function createProviderMetadataGuard(options:{fetcher?:typeof fetch;now?:()=>number}={}):ProviderMetadataGuard {
 const fetcher=options.fetcher??fetch,now=options.now??Date.now;
 return async(env,request)=>{
  const limits=analysisLimits(env),identity=analysisExecutionIdentity(env,limits);
  if(!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1||request.maxOutputTokens>limits.maxOutputTokens)throw new AnalysisError('analysis_input_limit');
  if(identity.route!=='openrouter')return {route:identity.route,checked:false,observedAt:null,compatibleTags:[],actualQualification:false,spendingAuthority:false};
  const name=env('CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME')?.trim();
  if(!name||!model.test(identity.model))return failure('metadata_pin_invalid');
  const pin:PricePin={model:identity.model,providerSlug:identity.provider,providerName:name,
   // An explicit advertised-schema marker, not evidence that null means a
   // default routing tier. The inference service_tier stays independently fixed.
   advertisedServiceTier:null,promptPerMillion:String(limits.inputUsdPerMillion),completionPerMillion:String(limits.outputUsdPerMillion),
   cachedInputPerMillion:String(limits.cachedInputUsdPerMillion),requestUsd:'0',cacheWriteApplies:limits.cacheWriteApplies===true,
   cacheWritePerMillion:limits.cacheWriteApplies?String(limits.cacheWriteUsdPerMillion):null,
   requiredParameters:['max_tokens','response_format','structured_outputs',...(identity.reasoningEffort?['reasoning']:[])]};
  const [author,slug]=identity.model.split('/'),url=METADATA_ORIGIN+'/api/v1/models/'+encodeURIComponent(author!)+'/'+encodeURIComponent(slug!)+'/endpoints';
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{});};
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{cancel();reject(new AnalysisError('analysis_provider_metadata_timeout'));},TIMEOUT_MS);});
  const observe=async():Promise<ProviderMetadataReceipt>=>{
   const response=await fetchNoRedirect(url,{method:'GET',headers:{accept:'application/json','cache-control':'no-cache'},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal},fetcher);
   controller.signal.throwIfAborted();
   if(response.status!==200||response.redirected||response.url!==url){void response.body?.cancel().catch(()=>{});return failure('metadata_unavailable');}
   if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){void response.body?.cancel().catch(()=>{});return failure('metadata_invalid');}
   const receivedAt=now(),date=response.headers.get('date'),dateMs=date===null?NaN:Date.parse(date),age=response.headers.get('age');
   if(!Number.isSafeInteger(receivedAt)||!Number.isFinite(dateMs)||new Date(dateMs).toUTCString()!==date
    ||dateMs>receivedAt+5000||receivedAt-dateMs>MAX_AGE_MS||age!==null&&(!/^\d{1,6}$/.test(age)||Number(age)*1000>MAX_AGE_MS)){
    void response.body?.cancel().catch(()=>{});return failure('metadata_stale');
   }
   const originAt=Math.min(dateMs,receivedAt-(age===null?0:Number(age)*1000));
   const length=response.headers.get('content-length');
   if(length!==null&&(!/^\d{1,9}$/.test(length)||Number(length)>MAX_BYTES)){void response.body?.cancel().catch(()=>{});return failure('metadata_invalid');}
   if(!response.body)return failure('metadata_invalid');reader=response.body.getReader();
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){controller.signal.throwIfAborted();const next=await reader.read();controller.signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>MAX_BYTES){cancel();return failure('metadata_invalid');}chunks.push(next.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return failure('metadata_invalid');}
   const result=compareAdvertisedRoutePrices(text,pin,{httpStatus:200,receivedAtMs:originAt,nowMs:now(),maximumAgeMs:MAX_AGE_MS});
   if(!result.compatible)return failure(result.code.startsWith('metadata_')?result.code:'metadata_'+result.code);
   return {route:'openrouter',checked:true,observedAt:new Date(originAt).toISOString(),compatibleTags:result.compatibleTags,actualQualification:false,spendingAuthority:false};
  };
  try{return await Promise.race([observe(),deadline]);}
  catch(error){cancel();if(error instanceof AnalysisError)throw error;return failure('metadata_unavailable');}
  finally{clearTimeout(timer);}
 };
}
