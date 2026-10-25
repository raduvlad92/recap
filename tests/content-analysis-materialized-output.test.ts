import {describe,it,expect,vi} from 'vitest';
import {createOpenRouterAnalysisGenerator,type OpenAIClientFactory,type GenerationRequest} from '../netlify/functions/_shared/content-analysis-model';
import {analysisRuntimeEnv} from '../netlify/functions/_shared/content-analysis-runtime';
import {DEFAULT_ANALYSIS_MODEL} from '../src/lib/analysis-settings-types';
const env=analysisRuntimeEnv(name=>name==='OPENROUTER_API_KEY'?'synthetic-fixture-key':undefined,DEFAULT_ANALYSIS_MODEL,1);
const request:GenerationRequest={role:'summary',key:'summary:v2:chunk:0',system:'synthetic policy',prompt:'synthetic original',maxOutputTokens:8192,schema:{type:'object'}};
function response(content:string|null,finish='stop',refusal:string|null=null){return {id:'gen-materialized-fixture',model:DEFAULT_ANALYSIS_MODEL,provider:'Relace',choices:[{finish_reason:finish,message:{role:'assistant',content,refusal}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300,cost:.0001,is_byok:false}};}
function generate(raw:ReturnType<typeof response>){const create=vi.fn(async()=>raw);const factory=(()=>({chat:{completions:{create}}})) as unknown as OpenAIClientFactory;return {run:createOpenRouterAnalysisGenerator(env,factory),create};}
describe('content-v2 materialized response accounting',()=>{
 it('retains billed malformed JSON and actual cost for one separately fenced correction',async()=>{
  const {run,create}=generate(response('{"unfinished":'));
  const out=await run(request);
  expect(out).toMatchObject({validationError:'analysis_invalid_json',value:{rawOutput:'{"unfinished":',finishReason:'stop'},providerId:'gen-materialized-fixture',actualUsd:.0001,observedUsd:.0001});
  expect(create).toHaveBeenCalledTimes(1);
 });
 it('preserves parsed partial verdicts under truncation so a negative verdict cannot turn into agreement',async()=>{
  const text=JSON.stringify({readComplete:false,verdicts:[{id:'s0',supported:false,reason:'The original does not support the claim.'}]}),{run}=generate(response(text,'length'));
  const out=await run({...request,key:'summary:v2:verify:0'});
  expect(out.validationError).toBe('analysis_output_capacity');expect(out.value).toEqual(JSON.parse(text));expect(out.actualUsd).toBe(.0001);
 });
 it('retains refusal evidence and billing while explicitly prohibiting a content correction',async()=>{
  const {run,create}=generate(response(null,'stop','Synthetic provider refusal.'));
  expect(await run(request)).toMatchObject({validationError:'analysis_provider_refusal',value:{rawOutput:'',refusal:'Synthetic provider refusal.'},actualUsd:.0001});expect(create).toHaveBeenCalledTimes(1);
 });
 it('does not invent a known charge when non-BYOK accounting is absent',async()=>{
  const raw=response('invalid json');delete (raw.usage as {is_byok?:boolean}).is_byok;
  const out=await generate(raw).run(request);expect(out.actualUsd).toBeNull();expect(out.observedUsd).toBe(.0001);expect(out.validationError).toBe('analysis_invalid_json');
 });
 it('keeps legacy malformed/truncated output behavior and wrong-identity rejection unchanged',async()=>{
  await expect(generate(response('invalid json')).run({...request,key:'summary:0'})).rejects.toThrow('analysis_invalid_json');
  await expect(generate(response('{}','length')).run({...request,key:'summary:0'})).rejects.toThrow('analysis_incomplete_generation');
  const raw=response('invalid json');raw.provider='Different provider';await expect(generate(raw).run(request)).rejects.toThrow('analysis_provider_not_verified');
 });
 it('keeps the enlarged output request below the unchanged one-cent bound',async()=>{
  const {run,create}=generate(response('{}'));await run(request);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({max_tokens:8192}),expect.objectContaining({maxRetries:0,timeout:45000}));
 });
});
