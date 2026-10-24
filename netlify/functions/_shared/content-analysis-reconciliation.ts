import { database } from './admin-data';
import { analysisWorkerAuthorized } from './content-analysis';
import { isAnalysisModelId } from '../../../src/lib/analysis-settings-types';
import { json, readTextLimited, runtimeEnv, type Env } from './security';

const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const amount=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
interface Dependencies {env:Env;db:typeof database;fetcher:typeof fetch}

/** Private read-only operator check. Never settles a call, retries generation or returns source/account content. */
export function createAnalysisReconciliationHandler(overrides:Partial<Dependencies>={}) {
 const deps={env:runtimeEnv,db:database,fetcher:fetch,...overrides};
 return async(request:Request):Promise<Response>=>{
  if(!analysisWorkerAuthorized(request,deps.env))return new Response(null,{status:403});
  try {
   let body:Record<string,unknown>|undefined;
   try {body=object(JSON.parse(await readTextLimited(new Response(request.body,{headers:{'content-length':request.headers.get('content-length')||''}}),1000)));}
   catch {return json({error:'invalid_receipt_request'},400);}
   if(!body||Object.keys(body).some(k=>!['callId','providerGenerationId'].includes(k))||typeof body.callId!=='string'||!/^[-a-f0-9]{36}$/.test(body.callId)||typeof body.providerGenerationId!=='string'||!/^gen-[A-Za-z0-9-]{1,200}$/.test(body.providerGenerationId))return json({error:'invalid_receipt_request'},400);
   const allowed=(deps.env('CONTENT_ANALYSIS_RECONCILIATION_IDS')||'').split(',').map(id=>id.trim()).filter(Boolean);
   if(!allowed.includes(body.providerGenerationId))return json({error:'receipt_not_authorized'},403);
   const row=await deps.db(deps.env).from('reader_content_analysis_calls').select('id,model,created_at,provider_id,execution_identity').eq('id',body.callId).maybeSingle();
   if(row.error||!row.data)return json({error:'receipt_call_unavailable'},404);
   const call=row.data,identity=object(call.execution_identity);
   if(!isAnalysisModelId(call.model)||identity?.route!=='openrouter'||identity.model!==call.model)return json({error:'receipt_identity_mismatch'},409);
   const callTime=Date.parse(call.created_at);if(!Number.isFinite(callTime))return json({error:'receipt_identity_mismatch'},409);
   // Legacy failed calls did not save a provider ID. Only accept their exact recorded second;
   // a captured ID on newer calls is always authoritative. This read never changes financial state.
   if(call.provider_id!==body.providerGenerationId){
    if(call.provider_id)return json({error:'receipt_identity_mismatch'},409);
    const epoch=/^gen-(\d{10})-/.exec(body.providerGenerationId);
    if(!epoch||Math.abs(Number(epoch[1])*1000-callTime)>=1000)return json({error:'receipt_identity_mismatch'},409);
   }
   const key=deps.env('OPENROUTER_API_KEY');if(!key?.trim())return json({error:'receipt_credentials_required'},503);
   const target=new URL('https://openrouter.ai/api/v1/generation');target.searchParams.set('id',body.providerGenerationId);
   const controller=new AbortController();let response:Response|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   const read=async()=>{
    response=await deps.fetcher(target,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
    if(response.status!==200){await response.body?.cancel();return json({status:response.status===404?'not_found':'unavailable',noChargeConfirmed:false},response.status===404?200:502);}
    if(response.redirected||response.url&&response.url!==target.href){await response.body?.cancel();return json({error:'receipt_redirect_rejected'},502);}
    const envelope=object(JSON.parse(await readTextLimited(response,65536))),data=object(envelope?.data);
    const expectedProvider=typeof identity.provider==='string'?({deepinfra:'DeepInfra',together:'Together',openai:'OpenAI'} as Record<string,string>)[identity.provider.split('/')[0]]:undefined;
    const metadataTime=typeof data?.created_at==='string'?Date.parse(data.created_at):NaN;
    if(!data||envelope?.error!=null||data.id!==body.providerGenerationId||data.model!==call.model||!expectedProvider||data.provider_name!==expectedProvider||!Number.isFinite(metadataTime)||Math.abs(metadataTime-callTime)>30000)return json({error:'receipt_identity_mismatch'},409);
    const totalCost=amount(data.total_cost),isByok=typeof data.is_byok==='boolean'?data.is_byok:null,promptTokens=count(data.native_tokens_prompt),completionTokens=count(data.native_tokens_completion),reasoningTokens=data.native_tokens_reasoning===undefined?null:count(data.native_tokens_reasoning);
    return json({status:'available',providerGenerationId:data.id,model:data.model,provider:typeof data.provider_name==='string'?data.provider_name.slice(0,150):null,totalCost,isByok,promptTokens,completionTokens,reasoningTokens,
     createdAt:data.created_at,lookedUpAt:new Date().toISOString(),noChargeConfirmed:totalCost===0&&isByok===false});
   };
   try {return await Promise.race([read(),new Promise<Response>(resolve=>{timer=setTimeout(()=>{controller.abort();void response?.body?.cancel().catch(()=>{});resolve(json({error:'receipt_unavailable'},502));},8000);})]);}
   finally {clearTimeout(timer);}
  }catch{return json({error:'receipt_unavailable'},502);}
 };
}
