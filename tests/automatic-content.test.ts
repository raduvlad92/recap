import { describe, expect, it, vi } from 'vitest';
import type { SourceUpdate } from '../src/lib/types';
import { contentHash } from '../src/lib/content-processing';
import { AnalysisError, type GenerationResult } from '../netlify/functions/_shared/content-analysis-model';
import type { KeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import * as learning from '../netlify/functions/_shared/keyword-learning';
import { automaticContentRuntimeAllowed, automaticContentWorkerAuthorized, createAutomaticContentStore, createAutomaticContentWorker, createAutomaticLearningCaller, dispatchAutomaticContent,
 generateAutomaticContent, validateAutomaticRecap, type AutomaticContentClaim } from '../netlify/functions/_shared/automatic-content';

const content='AeroBox supports C#. An ad mentions NovaPay. The final test lasted five hours.';
const record:SourceUpdate={id:'video-fixture',sourceId:'source-fixture',contributorIds:[],title:'Do not use TitleOnlyBrand',summary:'Metadata only',
 url:'https://example.com/video',publishedAt:'2026-10-29T03:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,content,contentKind:'transcript'};
const claim=(task:'keywords'|'recap'='keywords',source=record):AutomaticContentClaim=>({task:{id:'automatic-fixture',user_id:'reader-fixture',update_id:source.id,
 content_hash:contentHash(source.content!),task,session_id:'12345678-1234-4234-8234-123456789012'},record:source,leaseToken:'lease-fixture'});
const successful=(value:unknown):GenerationResult=>({value,providerId:'fixture-provider-receipt',observedUsd:.001,actualUsd:.001});
const configuredEnv=(name:string)=>({APP_URL:'https://example.com',CONTENT_ANALYSIS_WORKER_SECRET:'s'.repeat(40)})[name];
const point={text:'The final test lasted five hours.',evidenceQuote:'The final test lasted five hours.'};
function keywordCall(input:KeywordLearningInput):GenerationResult{
 if(input.request.role==='extractor')return successful({names:['AeroBox','C#','NovaPay'],uncertainNames:[]});
 const prompt=JSON.parse(input.request.prompt.slice(input.request.prompt.lastIndexOf('\n')+1));
 return successful({readComplete:true,verdicts:prompt.candidates.map(({candidateIndex,name}:{candidateIndex:number;name:string})=>[candidateIndex,0,name==='NovaPay'?1:name==='AeroBox'?0:2]),missingNames:[]});
}
function recapCall(input:KeywordLearningInput):GenerationResult{
 const prompt=JSON.parse(input.request.prompt);
 if(prompt.task==='recap_check')return successful({readComplete:true,verdicts:prompt.findings.map(({index}:{index:number})=>({index,supported:true,reason:'The exact source quote supports the statement.'}))});
 return successful({readComplete:true,highlights:[point]});
}

describe('automatic content review bridge, isolated model fixtures only',()=>{
 it('uses both current inventories and Sol checker, holding accepted and uncertain names without flooding rejected suggestions',async()=>{
  const call=vi.fn(async(input:KeywordLearningInput)=>keywordCall(input));
  const output=await generateAutomaticContent(claim(),call);
  expect(call.mock.calls.map(([input])=>input.model)).toEqual(['deepseek/deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro']);
  expect(call.mock.calls[1][0].request.prompt).toContain('Sweep the entire source by naming role');
  expect(output.kind).toBe('keywords');expect(output.proposals?.map(value=>value.label)).toEqual(['AeroBox','NovaPay']);
  expect(output.proposals?.every(value=>value.reason.includes('approval')||value.reason.includes('uncertain'))).toBe(true);
  expect(output.callKeys).toHaveLength(3);expect(new Set(output.callKeys).size).toBe(3);
  expect(record.topics).toEqual([]);expect(JSON.stringify(output)).not.toContain('TitleOnlyBrand');
 });
 it('reconstructs identical request keys after a worker continuation rather than authoring new paid keys',async()=>{
  const seen=new Set<string>(),actualCalls:string[]=[];
  const cached=new Map<string,GenerationResult>();
  const call=async(input:KeywordLearningInput)=>{seen.add(input.request.key);if(!cached.has(input.request.key)){actualCalls.push(input.request.key);cached.set(input.request.key,keywordCall(input));}return cached.get(input.request.key)!;};
  const first=await generateAutomaticContent(claim(),call),second=await generateAutomaticContent(claim(),call);
  expect(first).toEqual(second);expect(actualCalls).toHaveLength(3);expect(seen.size).toBe(3);
 });
 it('rejects source/hash drift before any model call',async()=>{
  const call=vi.fn(),changed={...claim(),record:{...record,content:'Changed transcript'}};
  await expect(generateAutomaticContent(changed,call)).rejects.toThrow('automatic_content_source_changed');expect(call).not.toHaveBeenCalled();
 });
 it.each([true,false])('retains a complete %s checker verdict with an overlong display explanation, still pending review',async supported=>{
  const reason='The explanation preserves the original support verdict. '.repeat(7);
  const response={readComplete:true,verdicts:[{index:0,supported,reason}]};
  const before=JSON.stringify(response);
  const call=vi.fn(async(input:KeywordLearningInput)=>input.originalKey?.endsWith(':check')?successful(response):recapCall(input));
  const output=await generateAutomaticContent(claim('recap'),call);
  expect(output.proposal?.highlights).toEqual([point]);expect(call).toHaveBeenCalledTimes(2);
  expect(output.reason).toContain(supported?'requires your approval':'questioned this draft');
  expect(output.reason).toContain('original responses remain saved');
  if(!supported){expect(output.reason).toContain('Point 1:');expect(output.reason).toContain('…');}
  expect(JSON.stringify(response)).toBe(before);
 });
 it.each(['',null,17])('still rejects an invalid checker explanation %s',async reason=>{
  const call=vi.fn(async(input:KeywordLearningInput)=>input.originalKey?.endsWith(':check')?successful({readComplete:true,verdicts:[{index:0,supported:true,reason}]}):recapCall(input));
  await expect(generateAutomaticContent(claim('recap'),call)).rejects.toThrow('automatic_recap_invalid_check');
 });
 it('generates a source-quoted recap with a separate support check and keeps positive results pending',async()=>{
  const call=vi.fn(async(input:KeywordLearningInput)=>recapCall(input)),output=await generateAutomaticContent(claim('recap'),call);
  expect(call).toHaveBeenCalledTimes(2);expect(call.mock.calls.map(([input])=>input.model)).toEqual(['deepseek/deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash-1017']);
  expect(output).toMatchObject({kind:'recap',proposal:{highlights:[point]},reason:expect.stringContaining('requires your approval')});
  expect(JSON.parse(call.mock.calls[0][0].request.prompt).content).toBe(content);
  expect(JSON.parse(call.mock.calls[1][0].request.prompt).findings).toEqual([{index:0,...point}]);
  expect(output.callKeys[0]).not.toBe(output.callKeys[1]);
 });
 it('preserves a checker-negative recap as a questioned human proposal without retrying until agreement',async()=>{
  const call=vi.fn(async(input:KeywordLearningInput)=>input.originalKey?.endsWith(':check')?successful({readComplete:true,verdicts:[{index:0,supported:false,reason:'The statement needs a qualification.'}]}):recapCall(input));
  const output=await generateAutomaticContent(claim('recap'),call);
  expect(call).toHaveBeenCalledTimes(2);expect(output.proposal?.highlights).toEqual([point]);expect(output.reason).toContain('Point 1: The statement needs a qualification.');
 });
 it('rejects an unsupported recap quote before checker inference',async()=>{
  const call=vi.fn(async()=>successful({readComplete:true,highlights:[{text:'Invented result.',evidenceQuote:'This quote never occurred in the source.'}]}));
  await expect(generateAutomaticContent(claim('recap'),call)).rejects.toThrow('automatic_recap_empty_requires_review');expect(call).toHaveBeenCalledTimes(1);
  expect(()=>validateAutomaticRecap({readComplete:true,highlights:[{text:'Invented result.',evidenceQuote:'This quote never occurred in the source.'}]},content)).toThrow('automatic_recap_unsupported_draft');
 });
 it('preserves valid distinct draft points when other paid draft quotes are unsupported, without another draft call',async()=>{
  const second={text:'AeroBox supports C#.',evidenceQuote:'AeroBox supports C#.'};
  const call=vi.fn(async(input:KeywordLearningInput)=>{
   const prompt=JSON.parse(input.request.prompt);
   if(prompt.task==='recap_check')return successful({readComplete:true,verdicts:prompt.findings.map(({index}:{index:number})=>({index,supported:true,reason:'Supported by the literal quote.'}))});
   return successful({readComplete:true,highlights:[point,{text:'Invented result.',evidenceQuote:'This quote never occurred in the source.'},second,point,{text:'Invalid quote length.',evidenceQuote:'tiny'}]});
  });
  const result=await generateAutomaticContent(claim('recap'),call);
  expect(call).toHaveBeenCalledTimes(2);expect(result.proposal?.highlights).toEqual([point,second]);expect(result.reason).toContain('2 draft points were withheld');expect(result.reason).toContain('may be incomplete');
  expect(JSON.parse(call.mock.calls[1][0].request.prompt).findings).toEqual([{index:0,...point},{index:1,...second}]);
 });
 it.each([{readComplete:false,highlights:[point]},{readComplete:true,highlights:[point],extra:true},{readComplete:true,highlights:Array(7).fill(point)}])('does not salvage points from an incomplete or malformed source envelope',async value=>{
  const call=vi.fn(async()=>successful(value));
  await expect(generateAutomaticContent(claim('recap'),call)).rejects.toThrow('automatic_recap_invalid_draft');expect(call).toHaveBeenCalledTimes(1);
 });
 it('requires distinct complete indexed checker verdicts',async()=>{
  const second={text:'AeroBox supports C#.',evidenceQuote:'AeroBox supports C#.'};
  const call=vi.fn(async(input:KeywordLearningInput)=>input.originalKey?.endsWith(':check')?successful({readComplete:true,verdicts:[{index:0,supported:true,reason:'Supported'},{index:0,supported:true,reason:'Duplicate'}]}):successful({readComplete:true,highlights:[point,second]}));
  await expect(generateAutomaticContent(claim('recap'),call)).rejects.toThrow('automatic_recap_invalid_check');expect(call).toHaveBeenCalledTimes(2);
 });
 it('does not let reduction rewrite the selected finding or borrow a source-wide unrelated quote',()=>{
  expect(()=>validateAutomaticRecap({readComplete:true,highlights:[{...point,text:'The final test lasted five whole hours.'}]},content,[point])).toThrow('automatic_recap_changed_finding');
 });
 it('reads every long-source chunk and selects from exact existing findings before a final independent check',async()=>{
  const longContent=Array.from({length:9},(_,i)=>`The measured result for trial ${i+1} was accepted. `+'Ordinary source sentence. '.repeat(100)).join('\n')+'The measured result for trial 10 was accepted.';
  const longRecord={...record,content:longContent},drafts:string[]=[],reductions:string[]=[];
  const call=vi.fn(async(input:KeywordLearningInput)=>{
   const prompt=JSON.parse(input.request.prompt);
   if(prompt.task==='recap_draft'){
    drafts.push(prompt.content);const quotes=prompt.content.match(/The measured result for trial \d+ was accepted\./g)||[];
    return successful({readComplete:true,highlights:quotes.slice(0,6).map((quote:string)=>({text:quote,evidenceQuote:quote}))});
   }
   if(prompt.task==='recap_select'){reductions.push(input.request.key);return successful({readComplete:true,highlights:prompt.findings.slice(-6)});}
   return successful({readComplete:true,verdicts:prompt.findings.map(({index}:{index:number})=>({index,supported:true,reason:'Supported.'}))});
  });
  const output=await generateAutomaticContent(claim('recap',longRecord),call);
  expect(drafts.length).toBeGreaterThan(1);expect(drafts[0]).toContain('trial 1');expect(drafts.at(-1)).toContain('trial 10');
  expect(reductions).toHaveLength(1);expect(output.proposal?.highlights).toHaveLength(6);expect(output.proposal?.highlights.at(-1)?.text).toContain('trial 10');
 });
 it('does no database work or inference when the new runtime is disabled, regardless of legacy settings',async()=>{
  const store={sync:vi.fn(),claim:vi.fn(),finish:vi.fn()},call=vi.fn();
  const result=await createAutomaticContentWorker({env:name=>name==='AUTOMATIC_CONTENT_ENABLED'?'false':name==='CONTENT_ANALYSIS_ENABLED'?'true':configuredEnv(name),store,call})();
  expect(result.enabled).toBe(false);expect(store.sync).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
 });
 it('finishes independent source tasks into the inbox and never calls the old queue/publication functions',async()=>{
  const store={sync:vi.fn().mockResolvedValue({synchronized:2}),claim:vi.fn().mockResolvedValueOnce(claim()).mockResolvedValueOnce(claim('recap')).mockResolvedValue(null),finish:vi.fn().mockResolvedValue({reviewCount:1})};
  const call=vi.fn(async(input:KeywordLearningInput)=>input.originalKey?.startsWith('automatic-recap')?recapCall(input):keywordCall(input));
  const result=await createAutomaticContentWorker({env:configuredEnv,store,call,now:()=>0})();
  expect(result).toMatchObject({synchronized:2,queuedForReview:2,blocked:0});expect(store.finish).toHaveBeenCalledTimes(2);
  expect(store.finish.mock.calls.every(([,value])=>value.callKeys.length>0)).toBe(true);
 });
 it('stops on an unknown charge without a retry, preserving the task failure for the backend',async()=>{
  const store={sync:vi.fn().mockResolvedValue({synchronized:2}),claim:vi.fn().mockResolvedValue(claim()),finish:vi.fn().mockResolvedValue(null)};
  const call=vi.fn().mockRejectedValue(new AnalysisError('analysis_unknown_charge_hold'));
  const result=await createAutomaticContentWorker({env:configuredEnv,store,call,now:()=>0})();
  expect(result.blocked).toBe(1);expect(store.claim).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(1);
  expect(store.finish).toHaveBeenCalledExactlyOnceWith(expect.anything(),null,'analysis_unknown_charge_hold');
 });
 it('yields before a new model call when the slice is short, preserving the session for later cached replay',async()=>{
  let now=0;
  const store={sync:vi.fn().mockResolvedValue({synchronized:1}),claim:vi.fn(async()=>{now=550000;return claim();}),finish:vi.fn().mockResolvedValue(null)},call=vi.fn();
  const result=await createAutomaticContentWorker({env:configuredEnv,store,call,now:()=>now})();
  expect(result.yielded).toBe(1);expect(call).not.toHaveBeenCalled();expect(store.finish).toHaveBeenCalledExactlyOnceWith(expect.anything(),null,'automatic_worker_yield');
 });
 it('uses only the dedicated private RPC interface',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:null}),store=createAutomaticContentStore({rpc} as never);
  await store.claim();await store.finish(claim(),null,'analysis_budget_exhausted');
  expect(rpc.mock.calls).toEqual([['claim_automatic_content_task',{p_lease_seconds:900}],['finish_automatic_content_task',{p_task_id:'automatic-fixture',p_lease_token:'lease-fixture',p_result:null,p_error_code:'analysis_budget_exhausted'}]]);
 });
 it('normalizes a native no-work claim and rejects a malformed success before a task can finish',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({data:{claimed:false},error:null}).mockResolvedValueOnce({data:{claimed:true},error:null}),store=createAutomaticContentStore({rpc} as never);
  expect(await store.claim()).toBeNull();await expect(store.claim()).rejects.toThrow('automatic_content_invalid_claim');
 });
 it.each([
  {call:{state:'unknown',actual_usd:null},completed:false,result:null},
  {call:{state:'settled',actual_usd:.001},completed:true,result:{...successful({}),actualUsd:.002}},
  {call:{state:'settled',actual_usd:.001},completed:true,result:{...successful({}),providerId:undefined}},
 ])('rejects incomplete or contradictory native settlement before accepting a generation result',async saved=>{
  const spy=vi.spyOn(learning,'createKeywordLearningHandler').mockReturnValue(async()=>Response.json(saved));
  try{
   const caller=createAutomaticLearningCaller(name=>({APP_URL:'https://example.com',CONTENT_ANALYSIS_WORKER_SECRET:'s'.repeat(40)})[name],{} as never);
   await expect(caller({} as never)).rejects.toThrow();
  }finally{spy.mockRestore();}
 });
 it('dispatches only to the configured private background route with its existing secret',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:202})),env=(name:string)=>({AUTOMATIC_CONTENT_ENABLED:'true',APP_URL:'https://example.com',CONTENT_ANALYSIS_WORKER_SECRET:'s'.repeat(40)})[name];
  expect(await dispatchAutomaticContent(env,fetcher)).toEqual({dispatched:true});expect(String(fetcher.mock.calls[0][0])).toBe('https://example.com/.netlify/functions/automatic-content-worker');
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{'x-content-analysis-secret':'s'.repeat(40)}});
  expect(automaticContentWorkerAuthorized(new Request('https://example.com/.netlify/functions/automatic-content-worker',{method:'POST',headers:{'x-content-analysis-secret':'s'.repeat(40)}}),env)).toBe(true);
  expect(automaticContentWorkerAuthorized(new Request('https://preview.example.com/.netlify/functions/automatic-content-worker',{method:'POST',headers:{'x-content-analysis-secret':'s'.repeat(40)}}),env)).toBe(false);
 });
 it('does not dispatch while disabled or with missing private authentication',async()=>{
  const fetcher=vi.fn();expect(await dispatchAutomaticContent(name=>name==='AUTOMATIC_CONTENT_ENABLED'?'false':configuredEnv(name),fetcher)).toEqual({dispatched:false});expect(fetcher).not.toHaveBeenCalled();
  expect(await dispatchAutomaticContent(()=>undefined,fetcher)).toEqual({dispatched:false});expect(fetcher).not.toHaveBeenCalled();
 });
 it('allows dispatch without an extra enable variable while still requiring database opt-in for any model call',async()=>{
  expect(automaticContentRuntimeAllowed(()=>undefined)).toBe(true);expect(automaticContentRuntimeAllowed(()=> 'false')).toBe(false);
  const store={sync:vi.fn().mockResolvedValue({synchronized:0}),claim:vi.fn().mockResolvedValue(null),finish:vi.fn()},call=vi.fn();
  const result=await createAutomaticContentWorker({env:configuredEnv,store,call,now:()=>0})();
  expect(result.enabled).toBe(true);expect(store.sync).toHaveBeenCalledTimes(1);expect(store.claim).toHaveBeenCalledTimes(1);expect(call).not.toHaveBeenCalled();
 });
 it('does not initialize database resources when app/private-worker configuration is absent',async()=>{
  const store={sync:vi.fn(),claim:vi.fn(),finish:vi.fn()},call=vi.fn();
  expect((await createAutomaticContentWorker({env:()=>undefined,store,call})()).enabled).toBe(false);expect(store.sync).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
 });
});
