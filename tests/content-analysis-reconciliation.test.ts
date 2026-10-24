import {describe,it,expect,vi} from 'vitest';
import {createAnalysisReconciliationHandler} from '../netlify/functions/_shared/content-analysis-reconciliation';
const model='deepseek/deepseek-v4.1-flash-1017',secret='a'.repeat(48),callId='123e4567-e89b-12d3-a456-426614174000',providerGenerationId='gen-1792873127-fixture';
const env=(key:string)=>({CONTENT_ANALYSIS_WORKER_SECRET:secret,OPENROUTER_API_KEY:'private-fixture-key',CONTENT_ANALYSIS_RECONCILIATION_IDS:providerGenerationId})[key];
const request=(patch:Record<string,unknown>={})=>new Request('https://example.net',{method:'POST',headers:{'x-content-analysis-secret':secret},body:JSON.stringify({callId,providerGenerationId,...patch})});
function fixture(data:Record<string,unknown>={}){
 const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({error:null,data:{id:callId,model,provider_id:null,created_at:'2026-10-24T20:18:47.728Z',execution_identity:{route:'openrouter',model,provider:'deepinfra/fp8'}}}))};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
 const db=vi.fn(()=>({from:vi.fn(()=>query)})),fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:{id:providerGenerationId,model,provider_name:'DeepInfra',created_at:'2026-10-24T20:18:47.900Z',total_cost:0,is_byok:false,native_tokens_prompt:0,native_tokens_completion:0,native_tokens_reasoning:0,...data}}));
 return{db,query,fetcher,handler:createAnalysisReconciliationHandler({env,db:db as never,fetcher:fetcher as typeof fetch})};
}
describe('private read-only provider receipt reconciliation',()=>{
 it('denies public requests before database/provider access',async()=>{const f=fixture();expect((await f.handler(new Request('https://example.net'))).status).toBe(403);expect(f.db).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();});
 it('reads one fixed metadata URL and projects no private/raw data',async()=>{const f=fixture({prompt:'private source',api_key:'private key',app_id:123});const result=await f.handler(request());const value=await result.json();expect(value).toMatchObject({status:'available',noChargeConfirmed:true,totalCost:0});expect(JSON.stringify(value)).not.toMatch(/private|app_id/);expect(String(f.fetcher.mock.calls[0]?.[0])).toBe('https://openrouter.ai/api/v1/generation?id='+providerGenerationId);});
 it.each([{total_cost:null},{total_cost:'0'},{total_cost:.001},{is_byok:true},{is_byok:null}])('retains uncertainty for %j',async patch=>{expect((await (await fixture(patch).handler(request())).json()).noChargeConfirmed).toBe(false);});
 it('rejects identity mismatch or arbitrary URLs before provider access',async()=>{const f=fixture();expect((await f.handler(request({providerGenerationId:'https://attacker.example'}))).status).toBe(400);expect((await f.handler(request({providerGenerationId:'gen-1792873131-another'}))).status).toBe(403);expect(f.fetcher).not.toHaveBeenCalled();});
 it('does not turn missing provider records into a zero charge',async()=>{const f=fixture();f.fetcher.mockResolvedValue(new Response(null,{status:404}));expect(await(await f.handler(request())).json()).toEqual({status:'not_found',noChargeConfirmed:false});});
 it('rejects a provider model mismatch',async()=>{expect((await fixture({model:'other/model'}).handler(request())).status).toBe(409);});
 it.each([{provider_name:'Another provider'},{created_at:'2026-10-24T21:00:00Z'},{created_at:null}])('rejects incompatible provider/time %j',async patch=>{expect((await fixture(patch).handler(request())).status).toBe(409);});
});
