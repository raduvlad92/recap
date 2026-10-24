import {describe,it,expect} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {analyzeKeywords,analyzeSummary,chunkAnalysisText,exactMentionInText} from '../netlify/functions/_shared/content-analysis-engine';
import {conservativeCallUsd,usageUsd,type AnalysisGenerator,type AnalysisLimits,type GenerationRequest} from '../netlify/functions/_shared/content-analysis-model';
const limits:AnalysisLimits={model:'fixture-model',chunkChars:1000,overlapChars:256,maxChunks:100,maxSourceChars:100000,maxOutputTokens:4000,inputUsdPerMillion:.2,outputUsdPerMillion:1.2,cachedInputUsdPerMillion:.02,cacheWriteApplies:false,maxCallUsd:1};
const record=(content:string):SourceUpdate=>({id:'v1',sourceId:'s1',contributorIds:[],title:'Video',summary:'Never use this description.',url:'https://example.com/v1',publishedAt:'2026-10-24T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content,videoFormat:{kind:'regular',basis:'provider'}});
const ack=(request:GenerationRequest)=>{const prompt=JSON.parse(request.prompt);return {prompt,readComplete:true,endQuote:prompt.requiredEndQuote};};
const keywords=(request:GenerationRequest)=>{const {prompt,...body}=ack(request);return {...body,candidates:['Nvidia','RTX 5090','GPU','DLSS 5','Tape to Tape','Factorio','C++','C#'].filter(label=>prompt.sourceText.includes(label)).map(label=>({label,kind:['GPU'].includes(label)?'category':['Tape to Tape','Factorio'].includes(label)?'game':label==='Nvidia'?'brand':'product',confidence:100,reason:'Explicit source identity; prominence does not affect inclusion.',mention:label,evidenceQuote:label}))};};
const generator:AnalysisGenerator=async request=>({value:keywords(request),observedUsd:0,actualUsd:0});
describe('automatic D28 analysis',()=>{
 it('makes two blind inventories of complete text and preserves casual final mentions and punctuation',async()=>{
  const requests:GenerationRequest[]=[],content='Nvidia RTX 5090 GPU DLSS 5. C++ and C#. A game like Tape to Tape or Factorio.';
  const result=await analyzeKeywords(record(content),limits,async request=>{requests.push(request);return generator(request);});
  expect(result.state).toBe('ready');
  expect((result.evidence.accepted as Array<{label:string}>).map(c=>c.label)).toEqual(['Nvidia','RTX 5090','GPU','DLSS 5','Tape to Tape','Factorio','C++','C#']);
  expect(requests.map(r=>r.role)).toEqual(['extractor','checker']);
  expect(JSON.parse(requests[1].prompt)).not.toHaveProperty('candidates');
  expect(JSON.parse(requests[1].prompt).sourceText).toBe(content);
  expect(JSON.stringify(result.patch)).not.toContain('evidenceQuote');
 });
 it('processes all chunks and checker final tail, deriving offsets from exact evidence',async()=>{
  const text='Nvidia '+ 'word '.repeat(700)+'Tape to Tape',requests:GenerationRequest[]=[];
  const result=await analyzeKeywords(record(text),limits,async request=>{requests.push(request);return generator(request);});
  const chunks=chunkAnalysisText(text,limits);
  expect(requests).toHaveLength(chunks.length*2);
  expect(JSON.parse(requests.at(-1)!.prompt).sourceText.endsWith('Tape to Tape')).toBe(true);
  const second=(result.evidence.checker as {candidates:Array<{label:string;start:number;end:number}>}).candidates.find(c=>c.label==='Tape to Tape')!;
  expect(text.slice(second.start,second.end)).toBe('Tape to Tape');
  expect(second.start).toBe(text.indexOf('Tape to Tape'));
 });
 it('queues 49/unknown confidence and discoveries in only one inventory',async()=>{
  let pass=0;
  const result=await analyzeKeywords(record('Nvidia GPU Tape to Tape'),limits,async request=>{
   const value=keywords(request);value.candidates=value.candidates.filter(c=>pass===0||c.label!=='GPU');
   value.candidates=value.candidates.map(c=>({...c,confidence:c.label==='Nvidia'?49:c.label==='Tape to Tape'?null:100})) as never;pass++;
   return {value,observedUsd:0};
  });
  expect(result.state).toBe('review');expect(result.pending).toHaveLength(3);
 });
 it('blocks invalid quotes, incomplete final acknowledgement and two empty inventories',async()=>{
  await expect(analyzeKeywords(record('Nvidia'),limits,async request=>{const value=keywords(request);value.candidates[0].evidenceQuote='Imaginary';return {value,observedUsd:null};})).rejects.toThrow('analysis_unsupported_quote');
  await expect(analyzeKeywords(record('Nvidia'),limits,async request=>({value:{...keywords(request),endQuote:'missing ending'},observedUsd:null}))).rejects.toThrow('analysis_incomplete_coverage');
  await expect(analyzeKeywords(record('There are no named entities.'),limits,generator)).rejects.toThrow('empty_keyword_inventory_requires_manual_review');
 });
 it('merges case aliases across overlapping chunks without inventing disagreement',async()=>{
  const content='NVIDIA GPU. '+'filler '.repeat(250)+'Nvidia GPU.';
  const result=await analyzeKeywords(record(content),limits,async request=>{
   const {prompt,...body}=ack(request),mention=prompt.sourceText.includes('NVIDIA')?'NVIDIA':prompt.sourceText.includes('Nvidia')?'Nvidia':null;
   return {value:{...body,candidates:mention?[{label:mention,kind:'brand',confidence:100,reason:'Explicit brand identity.',mention,evidenceQuote:mention}]:[]},observedUsd:null};
  });
  expect(result.pending).toEqual([]);expect((result.evidence.accepted as unknown[])).toHaveLength(1);
 });
 it('does not assign C the timing of C++ or C#',async()=>{
  const content='C++, C#, then C.';
  const result=await analyzeKeywords({...record(content),transcriptSegments:[{startSeconds:0,text:'C++',durationSeconds:10},{startSeconds:10,text:'C#',durationSeconds:10},{startSeconds:20,text:'C',durationSeconds:10}]},limits,async request=>{
   const {prompt,...body}=ack(request);return {value:{...body,candidates:[{label:'C',kind:'technology',confidence:100,reason:'Explicit language identity.',mention:'C',evidenceQuote:'then C.'}]},observedUsd:null};
  });
  expect((result.evidence.accepted as Array<{ranges:unknown[];seconds:number}>)[0]).toMatchObject({ranges:[{startSeconds:20,endSeconds:30}],seconds:10});
  expect(exactMentionInText('C++ C#','C')).toBe(false);expect(exactMentionInText('(C++)','C++')).toBe(true);
 });
 it('routes an exact but abstract claim fragment to private review, rather than accepting it as a category',async()=>{
  const content='Console performance stagnation is a claim.';
  const result=await analyzeKeywords(record(content),limits,async request=>{const {prompt,...body}=ack(request);return {value:{...body,candidates:[{label:'Console performance stagnation',kind:'category',confidence:100,reason:'Exact text, but not an identity.',mention:'Console performance stagnation',evidenceQuote:'Console performance stagnation'}]},observedUsd:null};});
  expect(result.state).toBe('review');expect(result.pending).toHaveLength(1);expect(result.evidence.accepted).toHaveLength(0);
 });
 it('does not analyze video descriptions or silently truncate over-capacity text',async()=>{
  await expect(analyzeKeywords({...record('Nvidia'),contentKind:'metadata_only'},limits,generator)).rejects.toThrow('usable_keyword_content_required');
  await expect(analyzeSummary({...record('Description only'),contentKind:'feed_text'},limits,generator)).rejects.toThrow('usable_summary_content_required');
  expect(()=>chunkAnalysisText('x'.repeat(2001),{...limits,maxSourceChars:2000})).toThrow('analysis_source_capacity');
  expect(()=>chunkAnalysisText('x'.repeat(2000),{...limits,maxChunks:1})).toThrow('analysis_source_capacity');
 });
 it('keeps more than ten candidates with no editorial cutoff',async()=>{
  const content=Array.from({length:80},(_,i)=>'Brand'+i).join(' '),generate:AnalysisGenerator=async request=>{
   const {prompt,...body}=ack(request);return {value:{...body,candidates:content.split(' ').filter(label=>prompt.sourceText.includes(label)).map(label=>({label,kind:'brand',confidence:100,reason:'Explicit identity.',mention:label,evidenceQuote:label}))},observedUsd:null};
  };
  expect((await analyzeKeywords(record(content),limits,generate)).evidence.accepted).toHaveLength(80);
 });
});
describe('D25 grounded concise takeaways',()=>{
 const quote='The measured GPU frame rate improved from 30 to 45 FPS in our test.';
 const summarizer:AnalysisGenerator=async request=>{const {prompt,...body}=ack(request);return {value:{...body,highlights:[{text:'The GPU improved from 30 to 45 FPS in the reported test.',evidenceQuote:quote,startSeconds:null}]},observedUsd:0};};
 it('derives a real supporting cue, retains private evidence and labels unverified content partial',async()=>{
  const result=await analyzeSummary({...record(quote),transcriptSegments:[{startSeconds:120,text:quote,durationSeconds:8}]},limits,summarizer);
  expect(result.patch.videoHighlights).toEqual([{text:'The GPU improved from 30 to 45 FPS in the reported test.',startSeconds:120}]);
  expect(result.evidence.sourceContentState).toBe('partial');
  expect(JSON.stringify(result.patch)).not.toContain('evidenceQuote');
 });
 it('allows honestly untimed source text and promotional-only empty results',async()=>{
  expect(((await analyzeSummary(record(quote),limits,summarizer)).patch.videoHighlights as object[])[0]).not.toHaveProperty('startSeconds');
  const result=await analyzeSummary(record('Buy this sponsor product today.'),limits,async request=>{const {prompt,...body}=ack(request);return {value:{...body,highlights:[]},observedUsd:0};});
  expect(result.state).toBe('empty');expect(result.patch.videoHighlights).toEqual([]);
 });
 it('reads every long-source chunk before choosing the final concise findings',async()=>{
  const content='Opening context. '+'other material '.repeat(200)+quote,requests:GenerationRequest[]=[];
  const generate:AnalysisGenerator=async request=>{
   requests.push(request);const {prompt,...body}=ack(request);
   return {value:{...body,highlights:request.role==='summary-reduce'||prompt.sourceText.includes(quote)?[{text:'The GPU test improved from 30 to 45 FPS.',evidenceQuote:quote,startSeconds:null}]:[]},observedUsd:null};
  };
  const result=await analyzeSummary(record(content),limits,generate);
  expect(requests.at(-1)?.role).toBe('summary-reduce');
  expect(requests.filter(r=>r.role==='summary')).toHaveLength(chunkAnalysisText(content,limits).length);
  expect(result.state).toBe('ready');expect((result.patch.videoHighlights as unknown[])).toHaveLength(1);
  expect(JSON.parse(requests.at(-1)!.prompt).findings.some((p:{evidenceQuote:string})=>p.evidenceQuote===quote)).toBe(true);
 });
 it('allows an exact untimed quote when only other parts have saved cues',async()=>{
  const result=await analyzeSummary({...record(quote),transcriptSegments:[{startSeconds:0,text:'Only an unrelated opening has timing.',durationSeconds:3}]},limits,summarizer);
  expect(result.patch.videoSummary).toMatchObject({timingBasis:'none'});
  expect((result.patch.videoHighlights as unknown[])[0]).not.toHaveProperty('startSeconds');
 });
 it('rejects guessed times even if they are real cue boundaries elsewhere',async()=>{
  await expect(analyzeSummary({...record(quote),transcriptSegments:[{startSeconds:0,text:'Unrelated earlier cue',durationSeconds:10},{startSeconds:120,text:quote,durationSeconds:8}]},limits,async request=>{
   const result=await summarizer(request);(result.value as {highlights:Array<{startSeconds:number}>}).highlights[0].startSeconds=0;return result;
  })).rejects.toThrow('analysis_unsupported_takeaway_time');
 });
 it('rejects unsupported quotes and takeaways over 38 words',async()=>{
  await expect(analyzeSummary(record(quote),limits,async request=>{const result=await summarizer(request);(result.value as {highlights:Array<{text:string}>}).highlights[0].text='word '.repeat(39);return result;})).rejects.toThrow('analysis_invalid_takeaways');
 });
});
describe('per-call conservative prices and known usage',()=>{
 it('reserves prompt/schema overhead, UTF8 bytes and hard maximum output',()=>{
  const request:GenerationRequest={role:'summary',key:'s:0',system:'policy',prompt:'😀'.repeat(1000),schema:{},maxOutputTokens:4000};
  expect(conservativeCallUsd(request,limits)).toBeGreaterThan((4000*.2+4000*1.2)/1e6);
 });
 it('uses verified input/cache/output rates and leaves incomplete usage unknown',()=>{
  expect(usageUsd({inputTokens:1000,outputTokens:100,cachedInputTokens:500},limits)).toBe(.00023);
  expect(usageUsd({inputTokens:1000,outputTokens:100},limits)).toBeNull();
  expect(usageUsd({inputTokens:1000,outputTokens:100,cachedInputTokens:1001},limits)).toBeNull();
  expect(usageUsd({inputTokens:1000,outputTokens:100,cachedInputTokens:500}, {...limits,cacheWriteApplies:true,cacheWriteUsdPerMillion:.3})).toBeNull();
  expect(usageUsd({inputTokens:1000,outputTokens:100,cachedInputTokens:500,cacheWriteTokens:100},{...limits,cacheWriteApplies:true,cacheWriteUsdPerMillion:.3})).toBe(.00024);
 });
});
