import {withHostRuntime} from '../netlify/functions/_shared/host-runtime';
import {describe,it,expect,vi} from 'vitest';
import {compareAdvertisedRoutePrices,createProviderMetadataGuard,assertProviderMetadataFresh,type PricePin} from '../netlify/functions/_shared/content-analysis-provider-metadata';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import type {GenerationRequest} from '../netlify/functions/_shared/content-analysis-model';
const NOW=Date.parse('2026-11-12T04:00:00.000Z');
const pin:PricePin={model:'fiction/model-1',providerSlug:'example-provider',providerName:'Example Provider',advertisedServiceTier:null,promptPerMillion:'0.07',completionPerMillion:'0.5',cachedInputPerMillion:'0.008',requestUsd:'0',cacheWriteApplies:false,cacheWritePerMillion:null,requiredParameters:['max_tokens','response_format','structured_outputs','reasoning']};
const endpoint={model_id:pin.model,provider_name:pin.providerName,tag:pin.providerSlug+'/fp4',status:0,service_tier:null,pricing:{prompt:'0.00000007',completion:'0.0000005',input_cache_read:'0.000000008',input_cache_write:'0',request:'0'},supported_parameters:[...pin.requiredParameters]};
const fresh={httpStatus:200,receivedAtMs:NOW,nowMs:NOW,maximumAgeMs:60000},body=(es:unknown[]=[endpoint],id=pin.model)=>JSON.stringify({data:{id,endpoints:es}}),run=(es:unknown[]=[endpoint],p=pin,o=fresh)=>compareAdvertisedRoutePrices(body(es),p,o);
describe('advertised prices are necessary conditions, never spending authority',()=>{
 it('compares exact per-token metadata against per-million pins and grants no authority',()=>expect(run()).toMatchObject({compatible:true,code:'advertised_constraints_compatible',actualQualification:false,spendingAuthority:false}));
 for(const field of ['prompt','completion','input_cache_read','input_cache_write','request'] as const){
  it('rejects a known over-pin '+field,()=>expect(run([{...endpoint,pricing:{...endpoint.pricing,[field]:'0.1'}}])).toMatchObject({compatible:false,code:'price_exceeds_pin'}));
  it('does not turn absent '+field+' into zero',()=>{const pricing={...endpoint.pricing} as Record<string,string>;delete pricing[field];expect(run([{...endpoint,pricing}])).toMatchObject({compatible:false,code:'price_unknown'});});
  it.each(['-1','NaN','1e-7','0,00000007',' 0','+0','00.1',null,0])('rejects malformed '+field+' %s',value=>expect(run([{...endpoint,pricing:{...endpoint.pricing,[field]:value}}])).toMatchObject({compatible:false,code:'price_unknown'}));
 }
 it('detects the smallest supported above-pin fraction without floating point rounding',()=>expect(run([{...endpoint,pricing:{...endpoint.pricing,prompt:'0.000000070000000001'}}])).toMatchObject({compatible:false,code:'price_exceeds_pin'}));
 it('accepts the exact supported below-pin fraction',()=>expect(run([{...endpoint,pricing:{...endpoint.pricing,prompt:'0.000000069999999999'}}]).compatible).toBe(true));
 it.each([{nowMs:NOW+60001},{nowMs:NOW-1},{maximumAgeMs:60001},{maximumAgeMs:0},{nowMs:NaN}])('rejects stale or caller-invalid observation %j',patch=>expect(run([endpoint],pin,{...fresh,...patch})).toMatchObject({compatible:false,code:'metadata_stale'}));
 it('one cheap sibling cannot authorize an expensive cached-input sibling',()=>expect(run([endpoint,{...endpoint,tag:pin.providerSlug+'/other',pricing:{...endpoint.pricing,input_cache_read:'1'}}])).toMatchObject({compatible:false,code:'price_exceeds_pin'}));
 it('one cheap sibling cannot authorize unknown sibling fees',()=>{const pricing={...endpoint.pricing} as Record<string,string>;delete pricing.request;expect(run([endpoint,{...endpoint,tag:pin.providerSlug+'/other',pricing}])).toMatchObject({compatible:false,code:'price_unknown'});});
 it('requires cache-write fees even when the existing plan says writes do not apply',()=>expect(run([{...endpoint,pricing:{...endpoint.pricing,input_cache_write:'0.0000001'}}])).toMatchObject({compatible:false,code:'price_exceeds_pin'}));
 it('checks an explicitly allowed cache-write tariff without changing it',()=>expect(run([{...endpoint,pricing:{...endpoint.pricing,input_cache_write:'0.0000001'}}],{...pin,cacheWriteApplies:true,cacheWritePerMillion:'0.1'}).compatible).toBe(true));
 it.each([{model_id:'fiction/other'},{status:1},{status:undefined},{service_tier:undefined},{service_tier:'priority'},{service_tier:'default'}])('never infers an endpoint/model/tier mapping %j',patch=>expect(run([{...endpoint,...patch}])).toMatchObject({compatible:false,code:'price_unknown'}));
 it('requires an explicitly reviewed advertised tier marker',()=>expect(run([{...endpoint,service_tier:'default'}],{...pin,advertisedServiceTier:'default'}).compatible).toBe(true));
 it('rejects conflicting provider name and family tag even beside a good sibling',()=>expect(run([endpoint,{...endpoint,tag:pin.providerSlug+'/other',provider_name:'Other Provider'}])).toMatchObject({compatible:false,code:'metadata_invalid'}));
 it('does not select an unrelated provider or a similarly spelled family',()=>expect(run([{...endpoint,tag:pin.providerSlug+'-other/fp4'}])).toMatchObject({compatible:false,code:'provider_missing'}));
 it('does not substitute an advertised model alias',()=>expect(compareAdvertisedRoutePrices(body([endpoint],'fiction/alias'),pin,fresh)).toMatchObject({compatible:false,code:'model_mismatch'}));
 it('refuses duplicate endpoint identities',()=>expect(run([endpoint,endpoint])).toMatchObject({compatible:false,code:'metadata_invalid'}));
 it('rejects an entirely unsupported family rather than silently dropping required parameters',()=>expect(run([{...endpoint,supported_parameters:[]}])).toMatchObject({compatible:false,code:'parameters_unsupported'}));
 it.each([{requestUsd:undefined},{advertisedServiceTier:undefined},{cacheWriteApplies:true,cacheWritePerMillion:null},{cacheWriteApplies:false,cacheWritePerMillion:'0.1'},{requiredParameters:[]}])('rejects incomplete or inconsistent frozen pins %j',patch=>expect(run([endpoint],{...pin,...patch} as PricePin)).toMatchObject({compatible:false,code:'pin_invalid'}));
});
const model='deepseek/deepseek-v4.1-flash-1017',url='https://openrouter.ai/api/v1/models/'+model+'/endpoints';
const env=analysisRuntimeEnv(key=>key==='OPENROUTER_API_KEY'?'PRIVATE-TEST-KEY':undefined,model,1);
const request:GenerationRequest={role:'extractor',key:'keyword-learning:v1:offline',system:'policy',prompt:'PRIVATE SOURCE SENTINEL',schema:{type:'object'},maxOutputTokens:100};
const realEndpoint={...endpoint,model_id:model,provider_name:'Relace',tag:'relace/fp4'};
function reply(value:BodyInit=body([realEndpoint],model),headers:HeadersInit={},status=200,actualUrl=url){const response=new Response(value,{status,headers:{'content-type':'application/json',date:new Date(NOW).toUTCString(),age:'0',...headers}});Object.defineProperty(response,'url',{value:actualUrl});return response;}
function fixture(response=()=>reply(),clock:()=>number=()=>NOW){const fetcher=vi.fn(async()=>response());return {fetcher,guard:createProviderMetadataGuard({fetcher:fetcher as typeof fetch,now:clock})};}
describe('bounded metadata acquisition before any financial admission',()=>{
 it('performs one credential-free fixed-origin GET with no source or key',async()=>{
  const f=fixture();expect(await f.guard(env,request)).toMatchObject({checked:true,actualQualification:false,spendingAuthority:false,compatibleTags:['relace/fp4']});expect(f.fetcher).toHaveBeenCalledOnce();const [sentUrl,init]=f.fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(sentUrl).toBe(url);expect(init).toMatchObject({method:'GET',credentials:'omit',cache:'no-store',redirect:'error'});expect(init.body).toBeUndefined();expect(new Headers(init.headers).has('authorization')).toBe(false);expect(new Headers(init.headers).has('cookie')).toBe(false);expect(JSON.stringify(f.fetcher.mock.calls)).not.toContain(request.prompt);expect(JSON.stringify(f.fetcher.mock.calls)).not.toContain('PRIVATE-TEST-KEY');
 });
 it('uses the Workers-compatible non-following mode in a native host context',async()=>{
  const f=fixture();await withHostRuntime({env},()=>f.guard(env,request));
  expect((f.fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].redirect).toBe('manual');
 });
 it.each([301,302,303,307,308])('never follows a Workers redirect %s',async status=>{
  const f=fixture(()=>reply('{}',{},status));await expect(withHostRuntime({env},()=>f.guard(env,request))).rejects.toMatchObject({code:'analysis_provider_metadata_unavailable'});expect(f.fetcher).toHaveBeenCalledOnce();
 });
 it('blocks a price increase without adopting the price or performing a completion',async()=>{const f=fixture(()=>reply(body([{...realEndpoint,pricing:{...realEndpoint.pricing,prompt:'0.00000012'}}],model)));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_price_exceeds_pin'});expect(f.fetcher).toHaveBeenCalledOnce();});
 it.each([302,401,403,404,429,503])('never retries HTTP %s or treats it as a zero fee',async status=>{const f=fixture(()=>reply('{}',{},status));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_unavailable'});expect(f.fetcher).toHaveBeenCalledOnce();});
 it('rejects an unexpected response URL instead of following it',async()=>{const f=fixture(()=>reply('{}',{},200,'https://attacker.test/endpoints'));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_unavailable'});});
 it('rejects non-JSON without reading it into an error',async()=>{const f=fixture(()=>reply('PRIVATE BODY',{'content-type':'text/plain'}));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_invalid'});});
 it.each([{date:new Date(NOW-61000).toUTCString()},{date:new Date(NOW+6000).toUTCString()},{age:'61'},{age:'NaN'},{date:'bad'}])('rejects unverified response freshness %j',async headers=>{const f=fixture(()=>reply('{}',headers as unknown as Record<string,string>));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_stale'});});
 it('does not assume a missing Date proves freshness',async()=>{const f=fixture(()=>{const r=reply();r.headers.delete('date');return r;});await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_stale'});});
 it('rejects oversized declared metadata',async()=>{const f=fixture(()=>reply('{}',{'content-length':String(512*1024+1)}));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_invalid'});});
 it('enforces the streaming byte bound without trusting Content-Length',async()=>{let cancelled=false;const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(512*1024+1));},cancel(){cancelled=true;}});const f=fixture(()=>reply(stream));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_invalid'});expect(cancelled).toBe(true);});
 it('rejects invalid UTF8 instead of replacing source bytes',async()=>{const f=fixture(()=>reply(new Uint8Array([0xc3,0x28])));await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_invalid'});});
 it('rechecks observation age after body read',async()=>{let clockCalls=0;const f=fixture(()=>reply(),()=>clockCalls++===0?NOW:NOW+60001);await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_stale'});});
 it('bounds an ignored fetch abort with one whole-operation deadline',async()=>{vi.useFakeTimers();try{const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));const guard=createProviderMetadataGuard({fetcher:fetcher as typeof fetch,now:()=>NOW});const pending=expect(guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_timeout'});await vi.advanceTimersByTimeAsync(3001);await pending;expect(fetcher).toHaveBeenCalledOnce();expect((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].signal?.aborted).toBe(true);}finally{vi.useRealTimers();}});
 it('bounds a stalled error/success body as well as headers',async()=>{vi.useFakeTimers();try{let cancelled=false;const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});const f=fixture(()=>reply(stream));const pending=expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_timeout'});await vi.advanceTimersByTimeAsync(3001);await pending;expect(f.fetcher).toHaveBeenCalledOnce();expect(cancelled).toBe(true);}finally{vi.useRealTimers();}});
 it('does not contact metadata for an invalid input plan',async()=>{const f=fixture();await expect(f.guard(env,{...request,maxOutputTokens:0})).rejects.toMatchObject({code:'analysis_input_limit'});expect(f.fetcher).not.toHaveBeenCalled();});
 it('preserves non-OpenRouter routes without claiming new qualification',async()=>{const f=fixture();const direct=(key:string)=>key==='CONTENT_ANALYSIS_ROUTE'?'direct':env(key);expect(await f.guard(direct,request)).toMatchObject({route:'direct',checked:false,actualQualification:false,spendingAuthority:false});expect(f.fetcher).not.toHaveBeenCalled();});
 it.each([{date:new Date(NOW-59000).toUTCString()},{age:'59'}])('does not reset origin age while downloading %j',async headers=>{
  let n=0;const f=fixture(()=>reply(body([realEndpoint],model),headers as unknown as Record<string,string>),()=>n++===0?NOW:NOW+2000);
  await expect(f.guard(env,request)).rejects.toMatchObject({code:'analysis_provider_metadata_stale'});
 });
 it('returns the original advertisement time and rechecks it at later native gates',async()=>{
  const f=fixture(()=>reply(body([realEndpoint],model),{age:'59'}));const r=await f.guard(env,request);expect(r.observedAt).toBe(new Date(NOW-59000).toISOString());
  expect(()=>assertProviderMetadataFresh(r,NOW+1001)).toThrow('analysis_provider_metadata_stale');
  expect(()=>assertProviderMetadataFresh(r,NOW)).not.toThrow();
 });

});
