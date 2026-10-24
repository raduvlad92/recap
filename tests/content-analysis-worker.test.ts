import {describe,it,expect,vi} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {createAnalysisWorker,analysisRequestHash,analysisWorkerAuthorized,dispatchContentAnalysis,createAnalysisStatusHandler,type AnalysisCall,type AnalysisClaim,type AnalysisStore} from '../netlify/functions/_shared/content-analysis';
import {analysisExecutionIdentity,type AnalysisGenerator,type AnalysisLimits,AnalysisError} from '../netlify/functions/_shared/content-analysis-model';
const limits:AnalysisLimits={model:'fixture/model',pricingVersion:'fixture-prices-v1',chunkChars:1000,overlapChars:256,maxChunks:100,maxSourceChars:100000,maxOutputTokens:4000,inputUsdPerMillion:.2,outputUsdPerMillion:1.2,cachedInputUsdPerMillion:.02,cacheWriteApplies:false,maxCallUsd:1};
const record:SourceUpdate={id:'v',sourceId:'s',contributorIds:[],title:'Video',summary:'description',url:'https://example.com/v',publishedAt:'2026-10-24T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content:'The GPU benchmark improved from 30 to 45 frames per second.',videoFormat:{kind:'regular',basis:'provider'}};
const claim=(task:'summary'|'keywords'):AnalysisClaim=>({job:{id:task,user_id:'owner',update_id:'v',source_id:'s',content_hash:'hash',task,state:'running',result:null},record,leaseToken:'lease'});
const env=(patch:Record<string,string|undefined>={})=>(key:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_MODEL:'fixture/model',CONTENT_ANALYSIS_WORKER_SECRET:'a'.repeat(32),CONTEXT:'production',APP_URL:'https://example.net',...patch})[key];
function storeFor(queue:AnalysisClaim[]) {
 const calls=new Map<string,AnalysisCall>();
 return {policies:vi.fn(async()=>[{user_id:'owner',enabled:true,model:'fixture/model'}]),sync:vi.fn(async(_userId:string,_epoch?:string)=>({synchronized:2})),claim:vi.fn(async(_userId:string)=>queue.shift()||null),
  reserve:vi.fn<AnalysisStore['reserve']>(async(claim,request,_maximumUsd,model,identity)=>{const key=claim.job.id+':'+request.key,call=calls.get(key);if(call)return {claimed:false,call};const row={id:key,model,execution_identity:identity,result:null};calls.set(key,row);return {claimed:true,call:row};}),
  saveCall:vi.fn(async(call:AnalysisCall,_claim:unknown,result:unknown)=>{calls.set(call.id,{...calls.get(call.id),id:call.id,result:result as AnalysisCall['result']});}),prepare:vi.fn(async()=>{}),publish:vi.fn(async()=>true),fail:vi.fn(async(_claim:AnalysisClaim,_code:string,_retryable:boolean,_yielded?:boolean)=>{})} satisfies AnalysisStore;
}
const generator:AnalysisGenerator=async request=>{const p=JSON.parse(request.prompt);return {value:{readComplete:true,endQuote:p.requiredEndQuote,...(request.role==='summary'?{highlights:[{text:'The GPU test improved from 30 to 45 frames per second.',evidenceQuote:record.content,startSeconds:null}]}:{candidates:[{label:'GPU',kind:'category',confidence:100,reason:'Explicit category.',mention:'GPU',evidenceQuote:'GPU'}]})},observedUsd:.0001,actualUsd:.0001};};
describe('private durable automatic video analysis worker',()=>{
 it('processes independent summary/keyword tasks, saves metered results and publishes annotations',async()=>{
  const store=storeFor([claim('summary'),claim('keywords')]),generate=vi.fn(generator);
  const result=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(result.completed).toBe(2);expect(generate).toHaveBeenCalledTimes(3);expect(store.reserve).toHaveBeenCalledTimes(3);expect(store.saveCall).toHaveBeenCalledTimes(3);expect(store.prepare).toHaveBeenCalledTimes(2);
 });
 it('never duplicates a model charge on duplicate claim delivery with durable cached call results',async()=>{
  const store=storeFor([claim('summary'),claim('summary')]),generate=vi.fn(generator);
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(2);
  expect(generate).toHaveBeenCalledTimes(1);expect(store.saveCall).toHaveBeenCalledTimes(1);
 });
 it('retains ambiguous reservations and does not relaunch a timed out model request',async()=>{
  const store=storeFor([claim('summary'),claim('summary')]),generate=vi.fn(async()=>{throw new Error('simulated timeout with unknown provider charge');});
  const result=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(result.blocked).toBe(1);expect(store.fail.mock.calls[1][1]).toBe('analysis_unknown_charge_hold');
 });
 it.each([
  {name:'route/provider',model:'deepseek/deepseek-v4.1-flash-1017',patch:{CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8'}},
  {name:'reasoning',patch:{CONTENT_ANALYSIS_REASONING_EFFORT:'low'}},
  {name:'model',model:'another-fixture-model'},
  {name:'pricing',pricingVersion:'fixture-prices-v2'},
 ])('blocks cached output after changing $name without changing stable call keys',async scenario=>{
  const queue=[claim('summary')],store=storeFor(queue),generate=vi.fn(generator);
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);
  queue.push(claim('summary'));
  const nextLimits={...limits,...(scenario.model?{model:scenario.model}:{}),...(scenario.pricingVersion?{pricingVersion:scenario.pricingVersion}:{})};
  store.policies.mockResolvedValue([{user_id:'owner',enabled:true,model:nextLimits.model}]);
  const result=await createAnalysisWorker({env:env(scenario.patch),store,limits:nextLimits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(1);
  expect(store.fail.mock.calls.at(-1)?.[1]).toBe('analysis_cached_input_changed');
  expect(store.reserve.mock.calls.map(call=>call[1].key)).toEqual(['summary:0','summary:0']);
 });
 it('keeps an unknown-charge hold when the configured provider changes',async()=>{
  const queue=[claim('summary')],store=storeFor(queue),generate=vi.fn(async()=>{throw new Error('ambiguous timeout');});
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  queue.push(claim('summary'));
  const nextLimits={...limits,model:'deepseek/deepseek-v4.1-flash-1017'};
  store.policies.mockResolvedValue([{user_id:'owner',enabled:true,model:nextLimits.model}]);
  const result=await createAnalysisWorker({env:env({CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8'}),store,limits:nextLimits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(1);
  expect(store.fail.mock.calls.at(-1)?.[1]).toBe('analysis_unknown_charge_hold');
 });
 it('does not trust cached legacy calls without their independent execution identity',async()=>{
  const queue=[claim('summary')],store=storeFor(queue),generate=vi.fn(generator);
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  const reserve=store.reserve.getMockImplementation()!;
  store.reserve.mockImplementation(async(...args)=>{const result=await reserve(...args);return {...result,call:{...result.call,execution_identity:null}};});
  queue.push(claim('summary'));
  const result=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).toHaveBeenCalledTimes(1);
  expect(store.fail.mock.calls.at(-1)?.[1]).toBe('analysis_cached_input_changed');
 });
 it('fingerprints identity and schemas independently of JSON object key order',()=>{
  const identity=analysisExecutionIdentity(env(),limits),request={role:'summary' as const,key:'summary:0',system:'policy',prompt:'source',maxOutputTokens:1000,schema:{type:'object',properties:{a:{type:'string'},b:{type:'number'}}}};
  // PostgreSQL JSONB may reorder every nested object; rebuild recursively.
  const reverse=(value:unknown):unknown=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
  expect(analysisRequestHash(request,identity)).toBe(analysisRequestHash({...request,schema:reverse(request.schema) as Record<string,unknown>},reverse(identity) as typeof identity));
  const pin={responseModel:'provider/model-v1',providerName:'Provider'};
  expect(analysisRequestHash(request,identity,pin)).not.toBe(analysisRequestHash(request,identity,{...pin,responseModel:'provider/model-v2'}));
  expect(analysisRequestHash(request,identity,pin)).not.toBe(analysisRequestHash(request,identity,{...pin,providerName:'Another provider'}));
 });
 it('does not let a failed keyword task block a valid summary',async()=>{
  const store=storeFor([claim('keywords'),claim('summary')]);
  const result=await createAnalysisWorker({env:env(),store,limits,generate:async request=>{if(request.role==='extractor')throw new AnalysisError('analysis_unsupported_quote');return generator(request);},now:()=>0})();
  expect(result).toMatchObject({completed:1,failed:1});
 });
 it('stops per-call/daily-cap reservations before model use',async()=>{
  const store=storeFor([claim('summary')]),generate=vi.fn(generator);store.reserve.mockRejectedValue(new AnalysisError('analysis_budget_exhausted'));
  const result=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).not.toHaveBeenCalled();
 });
 it('persists credential/config blocked status after queue synchronization without model execution',async()=>{
  const store=storeFor([claim('summary')]);
  const result=await createAnalysisWorker({env:env(),store,limits,now:()=>0})();
  expect(result.blocked).toBe(1);expect(store.sync).toHaveBeenCalledWith('owner','');expect(store.reserve).not.toHaveBeenCalled();expect(store.fail.mock.calls[0][1]).toBe('analysis_pricing_not_verified');
 });
 it('uses the saved admin model instead of stale environment model/provider settings',async()=>{
  const model='minimax/minimax-m3.1-flash',store=Object.assign(storeFor([claim('summary')]),{runtime:vi.fn(async()=>({selected_model:model,revision:7}))}),generate=vi.fn(generator);
  store.policies.mockResolvedValue([{user_id:'owner',enabled:true,model}]);
  const result=await createAnalysisWorker({env:env({CONTENT_ANALYSIS_MODEL:'google/gemini-2.5-flash-lite',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'google-ai-studio'}),store,generate,now:()=>0})();
  expect(result.completed).toBe(1);expect(generate).toHaveBeenCalledTimes(1);
  expect(store.reserve.mock.calls[0][3]).toBe(model);
  expect(store.reserve.mock.calls[0][4]).toMatchObject({route:'openrouter',model});
  expect(store.sync.mock.calls[0][1]).toContain('7');
 });
 it('blocks an invalid saved model without falling back or reserving a charge',async()=>{
  const store=Object.assign(storeFor([claim('summary')]),{runtime:vi.fn(async()=>({selected_model:'google/gemini-2.5-flash-lite',revision:8}))}),generate=vi.fn(generator);
  const result=await createAnalysisWorker({env:env(),store,generate,now:()=>0})();
  expect(result.blocked).toBe(1);expect(generate).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();
 });
 it('resumes a prepared result through publication without generation',async()=>{
  const pending=claim('summary');pending.job.state='prepared';pending.job.result={state:'empty',patch:{},pending:[],evidence:{}};
  const store=storeFor([pending]),generate=vi.fn(generator);
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);expect(generate).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();
 });
 it('yields a long owner job and continues another owner instead of returning globally',async()=>{
  let current=0;
  const a=claim('keywords'),b={...claim('summary'),job:{...claim('summary').job,id:'b-summary',user_id:'bbb'}};
  const store=storeFor([]);
  store.policies.mockResolvedValue([{user_id:'owner',enabled:true,model:'fixture/model'},{user_id:'bbb',enabled:true,model:'fixture/model'}]);
  store.claim.mockImplementation(async userId=>userId==='owner'?(a.job.state==='running'?(a.job.state='claimed',a):null):(b.job.state==='running'?(b.job.state='claimed',b):null));
  const result=await createAnalysisWorker({env:env(),store,limits,now:()=>current,generate:async request=>{const result=await generator(request);if(request.role==='extractor')current+=260000;return result;}})();
  expect(result.yielded).toBe(1);expect(result.completed).toBe(1);expect(store.claim).toHaveBeenCalledWith('bbb');
 });
 it('returns before constructing resources when runtime is off',async()=>expect((await createAnalysisWorker({env:env({CONTENT_ANALYSIS_ENABLED:'false'})})()).enabled).toBe(false));
});
describe('private dispatch and read-only owner status',()=>{
 it('denies browser GET and bad worker secrets',()=>{
  expect(analysisWorkerAuthorized(new Request('https://example.net',{method:'GET'}),env())).toBe(false);
  expect(analysisWorkerAuthorized(new Request('https://example.net',{method:'POST',headers:{'x-content-analysis-secret':'x'.repeat(32)}}),env())).toBe(false);
  expect(analysisWorkerAuthorized(new Request('https://example.net',{method:'POST',headers:{'x-content-analysis-secret':'a'.repeat(32)}}),env())).toBe(true);
 });
 it('dispatches only enabled production runtime to a private fixed worker endpoint',async()=>{
  const fetcher=vi.fn(async(_input:URL|RequestInfo,_init?:RequestInit)=>new Response(null,{status:202}));
  expect(await dispatchContentAnalysis(env({CONTEXT:'deploy-preview'}),fetcher)).toEqual({dispatched:false});
  expect(fetcher).not.toHaveBeenCalled();
  expect(await dispatchContentAnalysis(env(),fetcher)).toEqual({dispatched:true});
  expect(fetcher.mock.calls[0][0]).toBe('https://example.net/.netlify/functions/content-analysis-worker');
 });
 it('returns lightweight windowed changes with stable keyset pagination and no transcript/hash work',async()=>{
  const query={select:vi.fn(),eq:vi.fn(),gt:vi.fn(),lte:vi.fn(),order:vi.fn(),or:vi.fn(),range:vi.fn(async()=>({data:[{update_id:'v',state:'published',updated_at:'2026-10-24T01:00:00Z',id:'123e4567-e89b-12d3-a456-426614174000'}],error:null}))};
  for(const method of ['select','eq','gt','lte','order','or'] as const)query[method].mockReturnValue(query);
  const db={from:vi.fn(()=>query)},handler=createAnalysisStatusHandler({env:env(),verify:async()=> 'owner',db:db as never});
  const response=await handler(new Request('https://example.net/api/content-analysis-status?since=2026-10-24T00:00:00Z&until=2026-10-24T02:00:00Z&afterUpdatedAt=2026-10-24T00:30:00Z&afterId=123e4567-e89b-12d3-a456-426614174000'));
  expect(await response.json()).toEqual({updateIds:['v'],lastChangedAt:'2026-10-24T01:00:00Z',windowEnd:'2026-10-24T02:00:00Z',nextOffset:null,nextCursor:null});
  expect(db.from).toHaveBeenCalledWith('reader_content_analysis_jobs');expect(query.select).toHaveBeenCalledWith('update_id,state,updated_at,id');expect(query.eq).toHaveBeenCalledWith('user_id','owner');
  expect(query.range).toHaveBeenCalledWith(0,99);expect(query.or).toHaveBeenCalled();
  expect((await handler(new Request('https://example.net/api/content-analysis-status?since=bad'))).status).toBe(400);
 });
 it('uses authenticated ownership and returns only public per-item status, with no queue/model mutation',async()=>{
  const query={select:vi.fn(),eq:vi.fn(),order:vi.fn(),range:vi.fn(async()=>({data:[{id:'v',record}],error:null}))};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.order.mockReturnValue(query);
  const db={from:vi.fn(()=>query)},verify=vi.fn(async()=> 'owner');
  const handler=createAnalysisStatusHandler({env:env(),verify,db:db as never});
  const response=await handler(new Request('https://example.net/api/content-analysis-status?user_id=attacker'));
  const data=await response.json();expect(query.eq).toHaveBeenCalledWith('user_id','owner');expect(data.items[0].processing.recap).toBe('pending');expect(JSON.stringify(data)).not.toContain('description');
  expect((await handler(new Request('https://example.net',{method:'POST'}))).status).toBe(405);
 });
});
