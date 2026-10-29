import {describe,it,expect,vi} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {createAnalysisWorker,analysisRequestHash,analysisWorkerAuthorized,dispatchContentAnalysis,createAnalysisStatusHandler,type AnalysisCall,type AnalysisClaim,type AnalysisStore} from '../netlify/functions/_shared/content-analysis';
import {analysisExecutionIdentity,type AnalysisGenerator,type AnalysisLimits,AnalysisError,AnalysisProviderHttpError,type AnalysisRejectionReceipt} from '../netlify/functions/_shared/content-analysis-model';
const limits:AnalysisLimits={model:'fixture/model',pricingVersion:'fixture-prices-v1',chunkChars:1000,overlapChars:256,maxChunks:100,maxSourceChars:100000,maxOutputTokens:4000,inputUsdPerMillion:.2,outputUsdPerMillion:1.2,cachedInputUsdPerMillion:.02,cacheWriteApplies:false,maxCallUsd:1};
const record:SourceUpdate={id:'v',sourceId:'s',contributorIds:[],title:'Video',summary:'description',url:'https://example.com/v',publishedAt:'2026-10-24T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content:'The GPU benchmark improved from 30 to 45 frames per second.',videoFormat:{kind:'regular',basis:'provider'}};
const claim=(task:'summary'|'keywords'):AnalysisClaim=>({job:{id:task,user_id:'owner',update_id:'v',source_id:'s',content_hash:'hash',task,state:'running',result:null},record,leaseToken:'lease'});
const env=(patch:Record<string,string|undefined>={})=>(key:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_MODEL:'fixture/model',CONTENT_ANALYSIS_WORKER_SECRET:'a'.repeat(32),CONTEXT:'production',APP_URL:'https://example.net',...patch})[key];
function storeFor(queue:AnalysisClaim[]) {
 const calls=new Map<string,AnalysisCall>();
 return {policies:vi.fn(async()=>[{user_id:'owner',enabled:true,model:'fixture/model'}]),sync:vi.fn(async(_userId:string,_epoch?:string)=>({synchronized:2})),claim:vi.fn(async(_userId:string)=>queue.shift()||null),
  reserve:vi.fn<AnalysisStore['reserve']>(async(claim,request,_maximumUsd,model,identity,requestHash)=>{const key=claim.job.id+':'+request.key,call=calls.get(key);if(call)return {claimed:false,call};const row={id:key,model,execution_identity:identity,request_hash:requestHash,result:null};calls.set(key,row);return {claimed:true,call:row};}),
  recordRejection:vi.fn<AnalysisStore['recordRejection']>(async()=>({retryEligible:false,retryAt:'2026-10-24T20:30:00Z'})),
  saveCall:vi.fn(async(call:AnalysisCall,_claim:unknown,result:unknown)=>{const saved={...calls.get(call.id),id:call.id,result:result as AnalysisCall['result'],actual_usd:(result as {actualUsd?:number}).actualUsd??null,state:(result as {actualUsd?:number}).actualUsd==null?'unknown':'settled'};calls.set(call.id,saved);return saved;}),prepare:vi.fn(async()=>{}),publish:vi.fn(async()=>true),fail:vi.fn(async(_claim:AnalysisClaim,_code:string,_retryable:boolean,_yielded?:boolean)=>{})} satisfies AnalysisStore;
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
 it('reuses a valid v2 cached success without filling the new null pre-call hash',async()=>{
  const queue=[claim('summary')],store=storeFor(queue),generate=vi.fn(generator);
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);
  const reserve=store.reserve.getMockImplementation()!;
  store.reserve.mockImplementation(async(...args)=>{const result=await reserve(...args);return {...result,call:{...result.call!,request_hash:null}};});
  queue.push(claim('summary'));
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);
  expect(generate).toHaveBeenCalledTimes(1);expect(store.saveCall).toHaveBeenCalledTimes(1);expect(store.fail).not.toHaveBeenCalled();
 });
 it('blocks a v2 cache whose result identity disagrees with its immutable call identity',async()=>{
  const queue=[claim('summary')],store=storeFor(queue),generate=vi.fn(generator);
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  const reserve=store.reserve.getMockImplementation()!;
  store.reserve.mockImplementation(async(...args)=>{const result=await reserve(...args);return {...result,call:{...result.call!,request_hash:null,result:{...result.call!.result!,executionIdentity:{...result.call!.execution_identity!,provider:'another-provider'}}}};});
  queue.push(claim('summary'));
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).blocked).toBe(1);
  expect(generate).toHaveBeenCalledTimes(1);expect(store.fail.mock.calls[0][1]).toBe('analysis_cached_input_changed');
 });
 it('retains ambiguous reservations and does not relaunch a timed out model request',async()=>{
  const store=storeFor([claim('summary'),claim('summary')]),generate=vi.fn(async()=>{throw new Error('simulated timeout with unknown provider charge');});
  const result=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(result.blocked).toBe(1);expect(store.fail.mock.calls[1][1]).toBe('analysis_unknown_charge_hold');
 });
 const routerModel='deepseek/deepseek-v4.1-flash-1017',routerLimits={...limits,model:routerModel};
 const routerEnv=env({CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'deepinfra/fp8',CONTENT_ANALYSIS_OPENROUTER_PROVIDER_NAME:'DeepInfra',CONTENT_ANALYSIS_OPENROUTER_RESPONSE_MODEL:routerModel});
 const receipt:AnalysisRejectionReceipt={httpStatus:429,preGeneration:true,retryAfterSeconds:120,providerRequestId:'req-fixture',receivedAt:'2026-10-24T20:30:00.000Z'};
 function routerStore(){const store=storeFor([claim('summary'),claim('keywords')]);store.policies.mockResolvedValue([{user_id:'owner',enabled:true,model:routerModel},{user_id:'second',enabled:true,model:routerModel}]);return store;}
 it('records only status and pauses the whole provider turn, preserving every financial hold until separate verification',async()=>{
  const store=routerStore(),generate=vi.fn(async()=>{throw new AnalysisProviderHttpError(429,receipt);});
  const stats=await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(stats).toMatchObject({failed:1,completed:0});expect(generate).toHaveBeenCalledTimes(1);
  expect(store.reserve).toHaveBeenCalledTimes(1);expect(store.claim).toHaveBeenCalledTimes(1);expect(store.sync).toHaveBeenCalledTimes(1);
  expect(store.saveCall).not.toHaveBeenCalled();expect(store.prepare).not.toHaveBeenCalled();expect(store.publish).not.toHaveBeenCalled();
  expect(store.recordRejection).toHaveBeenCalledTimes(1);
  const saved=store.recordRejection.mock.calls[0];
  expect(saved[0].request_hash).toMatch(/^[a-f0-9]{64}$/);expect(saved[2]).toBe(store.reserve.mock.calls[0][5]);expect(saved[3]).toMatchObject({route:'openrouter',model:routerModel});expect(saved[4]).toEqual(receipt);
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_provider_http_429',false,false);
  expect(store.recordRejection.mock.invocationCallOrder[0]).toBeLessThan(store.fail.mock.invocationCallOrder[0]);
 });
 it('stops even when status receipt persistence fails, without assuming any zero charge',async()=>{
  const store=routerStore(),generate=vi.fn(async()=>{throw new AnalysisProviderHttpError(429,receipt);});
  store.recordRejection.mockRejectedValue(new AnalysisError('analysis_storage_unavailable'));
  await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(store.claim).toHaveBeenCalledTimes(1);expect(store.saveCall).not.toHaveBeenCalled();
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_storage_unavailable',true,false);
 });
 it('stops after a 429 even when a concurrent deletion invalidates failure scheduling',async()=>{
  const store=routerStore(),generate=vi.fn(async()=>{throw new AnalysisProviderHttpError(429,receipt);});
  store.fail.mockRejectedValue(new AnalysisError('analysis_source_changed'));
  await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(store.claim).toHaveBeenCalledTimes(1);expect(store.sync).toHaveBeenCalledTimes(1);
 });
 it('records malformed-body 429 metadata as unknown and pauses without retrying generation',async()=>{
  const store=routerStore(),incomplete={...receipt,preGeneration:false},generate=vi.fn(async()=>{throw new AnalysisProviderHttpError(429,incomplete);});
  await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(store.recordRejection.mock.calls[0][4]).toEqual(incomplete);expect(store.fail.mock.calls[0][2]).toBe(false);expect(generate).toHaveBeenCalledTimes(1);
 });
 it('honors a shared durable provider cooldown across owners before any new financial reservation',async()=>{
  const store=routerStore(),generate=vi.fn(generator);
  store.reserve.mockResolvedValue({claimed:false,reason:'analysis_provider_cooldown',retryAt:'2026-10-24T20:32:00.000Z'});
  await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(generate).not.toHaveBeenCalled();expect(store.recordRejection).not.toHaveBeenCalled();expect(store.claim).toHaveBeenCalledTimes(1);expect(store.sync).toHaveBeenCalledTimes(1);
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_provider_cooldown',true,false);
 });
 it('passes only an explicitly reconciled reservation pause to the receipt-checked durable retry scheduler',async()=>{
  const store=routerStore(),generate=vi.fn(generator);
  store.reserve.mockResolvedValue({claimed:false,reason:'analysis_provider_rate_limited',retryAt:'2026-10-24T20:32:00.000Z'});
  await createAnalysisWorker({env:routerEnv,store,limits:routerLimits,generate,now:()=>0})();
  expect(generate).not.toHaveBeenCalled();expect(store.recordRejection).not.toHaveBeenCalled();expect(store.claim).toHaveBeenCalledTimes(1);
  expect(store.fail).toHaveBeenCalledWith(expect.anything(),'analysis_provider_rate_limited',true,false);
 });
 it('never saves a rejection receipt or retries an HTTP 200 generation failure',async()=>{
  const store=storeFor([claim('summary'),claim('summary')]),generate=vi.fn(async()=>{throw new AnalysisError('analysis_incomplete_generation');});
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(store.recordRejection).not.toHaveBeenCalled();expect(store.fail.mock.calls[0][2]).toBe(false);expect(store.fail.mock.calls[1][1]).toBe('analysis_unknown_charge_hold');
 });
 it('requires the exact pre-call request hash before using new provider permission',async()=>{
  const store=storeFor([claim('summary')]),reserve=store.reserve.getMockImplementation()!,generate=vi.fn(generator);
  store.reserve.mockImplementation(async(...args)=>{const reservation=await reserve(...args);return {...reservation,call:{...reservation.call!,request_hash:'0'.repeat(64)}};});
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(generate).not.toHaveBeenCalled();expect(store.fail.mock.calls[0][1]).toBe('analysis_configuration_required');
 });
 it('blocks known cached output when the prompt changes while retaining its stable call key',async()=>{
  const changed={...claim('summary'),record:{...record,content:record.content+' New source words.'}},store=storeFor([claim('summary'),changed]),generate=vi.fn(generator);
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(generate).toHaveBeenCalledTimes(1);expect(store.fail.mock.calls[0][1]).toBe('analysis_cached_input_changed');expect(store.reserve.mock.calls.map(args=>args[1].key)).toEqual(['summary:0','summary:0']);
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
  store.reserve.mockImplementation(async(...args)=>{const result=await reserve(...args);return {...result,call:{...result.call!,execution_identity:null}};});
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
 it('finds manual archive approvals without job changes and pages bounded text IDs safely',async()=>{
  const cursorId='video,(key):"quotes"\\path',at='2026-10-29T02:00:00Z';
  const rows=Array.from({length:100},(_,index)=>({id:index===99?cursorId:'saved-video-'+index,updated_at:at}));
  const query={select:vi.fn(),eq:vi.fn(),gt:vi.fn(),lte:vi.fn(),order:vi.fn(),or:vi.fn(),range:vi.fn(async()=>({data:rows,error:null}))};
  for(const method of ['select','eq','gt','lte','order','or'] as const)query[method].mockReturnValue(query);
  const db={from:vi.fn((table:string)=>{if(table!=='reader_source_updates')throw Error('Unchanged jobs must not be queried.');return query;})};
  const handler=createAnalysisStatusHandler({env:env(),verify:async()=> 'owner',db:db as never});
  const params=new URLSearchParams({mode:'archive',since:'2026-10-29T01:00:00Z',until:'2026-10-29T03:00:00Z'});
  const first=await(await handler(new Request('https://example.net/api/content-analysis-status?'+params))).json();
  expect(first.updateIds).toEqual(rows.map(row=>row.id));expect(first.nextCursor).toEqual({updatedAt:at,id:cursorId});
  expect(query.select).toHaveBeenCalledWith('id,updated_at');expect(query.eq).toHaveBeenCalledWith('user_id','owner');expect(query.range).toHaveBeenLastCalledWith(0,99);
  params.set('afterUpdatedAt',first.nextCursor.updatedAt);params.set('afterId',first.nextCursor.id);
  expect((await handler(new Request('https://example.net/api/content-analysis-status?'+params))).status).toBe(200);
  expect(query.or).toHaveBeenLastCalledWith('updated_at.gt.2026-10-29T02:00:00Z,and(updated_at.eq.2026-10-29T02:00:00Z,id.gt."video,(key):\\"quotes\\"\\\\path")');
  expect(query.range).toHaveBeenLastCalledWith(0,99);expect(db.from.mock.calls.every(([table])=>table==='reader_source_updates')).toBe(true);
 });
 it.each(['x'.repeat(251),'line\nend','null\0end'])('rejects unsafe archive cursor IDs before reading rows (%j)',async id=>{
  const db={from:vi.fn()},handler=createAnalysisStatusHandler({env:env(),verify:async()=> 'owner',db:db as never});
  const params=new URLSearchParams({mode:'archive',since:'2026-10-29T01:00:00Z',until:'2026-10-29T03:00:00Z',afterUpdatedAt:'2026-10-29T02:00:00Z',afterId:id});
  expect((await handler(new Request('https://example.net/api/content-analysis-status?'+params))).status).toBe(400);expect(db.from).not.toHaveBeenCalled();
 });
 it('keeps UUID job cursors as the default and rejects invalid change modes',async()=>{
  const db={from:vi.fn()},handler=createAnalysisStatusHandler({env:env(),verify:async()=> 'owner',db:db as never});
  const params=new URLSearchParams({since:'2026-10-29T01:00:00Z',until:'2026-10-29T03:00:00Z',afterUpdatedAt:'2026-10-29T02:00:00Z',afterId:'saved-video-text-id'});
  expect((await handler(new Request('https://example.net/api/content-analysis-status?'+params))).status).toBe(400);
  expect((await handler(new Request('https://example.net/api/content-analysis-status?mode=archive'))).status).toBe(400);
  expect((await handler(new Request('https://example.net/api/content-analysis-status?mode=unknown'))).status).toBe(400);expect(db.from).not.toHaveBeenCalled();
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

describe('exact prompt receipts before new model spending',()=>{
 it('saves the exact request before reserving money or contacting a model',async()=>{
  const events:string[]=[],store=Object.assign(storeFor([claim('summary')]),{recordPrompt:vi.fn<NonNullable<AnalysisStore['recordPrompt']>>(async()=>{events.push('prompt');return true;})});
  const reserve=store.reserve.getMockImplementation()!;store.reserve.mockImplementation(async(...args)=>{events.push('reserve');return reserve(...args);});
  const generate=vi.fn<AnalysisGenerator>(async request=>{events.push('provider');return generator(request);});
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);
  expect(events).toEqual(['prompt','reserve','provider']);
  expect(store.recordPrompt.mock.calls[0][1]).toEqual(generate.mock.calls[0][0]);
  expect(store.recordPrompt.mock.calls[0][2]).toBe(limits.model);
  expect(store.recordPrompt.mock.calls[0][3]).toBe(store.reserve.mock.calls[0][5]);
 });
 it('does not reserve or spend when the exact request cannot be recorded',async()=>{
  const store=Object.assign(storeFor([claim('summary')]),{recordPrompt:vi.fn(async()=>false)}),generate=vi.fn(generator);
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(store.fail.mock.calls[0][1]).toBe('analysis_prompt_not_recorded');
  expect(store.reserve).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();expect(store.saveCall).not.toHaveBeenCalled();
 });
 it('does not create a charge hold if prompt storage fails',async()=>{
  const store=Object.assign(storeFor([claim('summary')]),{recordPrompt:vi.fn(async()=>{throw new AnalysisError('analysis_storage_unavailable');})}),generate=vi.fn(generator);
  await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();
  expect(store.fail.mock.calls[0][1]).toBe('analysis_storage_unavailable');expect(store.reserve).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();
 });
 it('replays grounded cached results without retroactively recording a historical prompt',async()=>{
  const source={...claim('summary'),job:{...claim('summary').job,rule_version:'content-v2' as const}},queue=[source],store=Object.assign(storeFor(queue),{recordPrompt:vi.fn(async()=>true)});
  const generate=vi.fn<AnalysisGenerator>(async request=>{const p=JSON.parse(request.prompt);return {value:p.task==='verify_summary'?{readComplete:true,verdicts:p.claims.map((c:{id:string})=>({id:c.id,supported:true,reason:'Source comparison is explicit.'}))}:{readComplete:true,lastPassageId:p.requiredLastPassageId,highlights:[{text:'The GPU benchmark improved from 30 to 45 frames per second.',passageIds:[p.passages[0].id]}]},actualUsd:.0001,observedUsd:.0001};});
  const first=await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})();expect(store.fail.mock.calls.map(row=>row[1])).toEqual([]);expect(first.completed).toBe(1);
  const paid=generate.mock.calls.length,cached=store.saveCall.mock.calls.map(([call,,result])=>({...call,call_key:call.id.slice('summary:'.length),state:'settled',actual_usd:.0001,result:result as AnalysisCall['result']}));
  Object.assign(store,{cachedCalls:vi.fn<NonNullable<AnalysisStore['cachedCalls']>>(async(_claim,keys)=>({calls:cached.filter(c=>keys.includes(c.call_key)).sort((a,b)=>a.call_key.localeCompare(b.call_key)),nextAfterKey:null}))});
  store.recordPrompt.mockClear();store.recordPrompt.mockRejectedValue(new Error('Must not invent a missing old prompt'));queue.push(source);
  expect((await createAnalysisWorker({env:env(),store,limits,generate,now:()=>0})()).completed).toBe(1);
  expect(store.recordPrompt).not.toHaveBeenCalled();expect(generate).toHaveBeenCalledTimes(paid);expect(store.reserve).toHaveBeenCalledTimes(paid);
 });
});
