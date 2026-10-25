import {describe,expect,it} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {analyzeKeywordsV2,analyzeSummaryV2,analysisV2CallPlan,planAnalysisV2Chunks} from '../netlify/functions/_shared/content-analysis-engine';
import {analysisPassagesV2,alignAnalysisCuesV2,literalMentionOffsetsV2} from '../netlify/functions/_shared/content-analysis-grounded-v2-source';
import {hasKnownSettledAnalysisCharge,parseAnalysisV2CallKey} from '../netlify/functions/_shared/content-analysis-grounded-v2-protocol';
import {AnalysisError,type AnalysisGenerator,type AnalysisLimits,type GenerationRequest,type GenerationResult} from '../netlify/functions/_shared/content-analysis-model';

const limits:AnalysisLimits={model:'fixture-model',chunkChars:1200,overlapChars:256,maxChunks:100,maxSourceChars:100000,maxOutputTokens:4096,
 inputUsdPerMillion:.2,outputUsdPerMillion:1.2,cachedInputUsdPerMillion:.02,cacheWriteApplies:false,maxCallUsd:1};
const record=(content:string):SourceUpdate=>({id:'synthetic-video',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic video',summary:'Do not use this metadata as content.',
 url:'https://example.test/video',publishedAt:'2026-10-25T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,
 contentKind:'transcript',content,videoFormat:{kind:'regular',basis:'provider'}});
type Passage={id:string;text:string};
type Prompt={task:string;requiredLastPassageId:string;passages:Passage[];findings?:Array<{text:string;passageIds:string[]}>;claims?:Array<{id:string;text:string}>;originalRequest?:Prompt;invalidResponse?:unknown;errors?:string[]};
const prompt=(request:GenerationRequest):Prompt=>{const body=JSON.parse(request.prompt);return body.originalRequest||body;};
const ack=(body:Prompt)=>({readComplete:true,lastPassageId:body.requiredLastPassageId});
function refs(body:Prompt,mention:string):string[]|null {
 const text=body.passages.map(p=>p.text).join(''),at=literalMentionOffsetsV2(text,mention)[0];
 if(at===undefined)return null;
 let offset=0;const ids:string[]=[];
 for(const passage of body.passages){if(offset<at+mention.length&&offset+passage.text.length>at)ids.push(passage.id);offset+=passage.text.length;}
 return ids;
}
interface Entity {label:string;mention?:string;kind?:string;confidence?:number|null}
const baseEntities:Entity[]=[{label:'Nvidia',kind:'brand'},{label:'RTX 5090'},{label:'GPU',kind:'category'},{label:'DLSS 5'},{label:'Tape to Tape',kind:'game'},
 {label:'Factorio',kind:'game'},{label:'C',kind:'technology'},{label:'C++',kind:'technology'},{label:'C#',kind:'technology'}];
function keywordValue(body:Prompt,entities=baseEntities) {
 return {...ack(body),candidates:entities.flatMap(entity=>{
  const mention=entity.mention||entity.label,passageIds=refs(body,mention);
  return passageIds?[{label:entity.label,kind:entity.kind||'product',confidence:entity.confidence===undefined?100:entity.confidence,
   reason:'Explicit literal identity; not selected by importance.',mention,passageIds}]:[];
 })};
}
const keywordGenerator=(entities=baseEntities):AnalysisGenerator=>async request=>({value:keywordValue(prompt(request),entities),observedUsd:0,actualUsd:0});
const finding='The measured GPU frame rate improved from 30 to 45 FPS in our test.';
const takeaway='The GPU improved from 30 to 45 FPS in the reported test.';
function summaryValue(body:Prompt) {
 if(body.task==='verify_summary')return {readComplete:true,verdicts:body.claims!.map(claim=>({id:claim.id,supported:true,reason:'Every claim is supported by the supplied original evidence.'}))};
 if(body.task==='reduce_findings')return {...ack(body),highlights:[...new Map(body.findings!.map(point=>[point.text,point])).values()].slice(0,6)};
 const passageIds=refs(body,finding);
 return {...ack(body),highlights:passageIds?[{text:takeaway,passageIds}]:[]};
}
const summaryGenerator:AnalysisGenerator=async request=>({value:summaryValue(prompt(request)),observedUsd:0,actualUsd:0});

describe('v2 lossless source and bounded request plan',()=>{
 it('covers exact UTF16 originals, whitespace and the final one-character tail with stable passage IDs',()=>{
  const content=('word\r\n\u00a0cafe\u0301 🧪 '.repeat(200))+'Z',passages=analysisPassagesV2(content);
  expect(passages.map(p=>p.text).join('')).toBe(content);
  expect(passages.at(-1)!.text.endsWith('Z')).toBe(true);
  expect(passages.every(p=>p.text===content.slice(p.start,p.end)&&p.id===`p${p.start}_${p.end}`&&!/[\uD800-\uDBFF]$/u.test(p.text))).toBe(true);
  for(const task of ['summary','keywords'] as const) {
   const chunks=planAnalysisV2Chunks(content,limits,task),seen=new Map(chunks.flatMap(c=>c.passages).map(p=>[p.id,p]));
   expect([...seen.values()].sort((a,b)=>a.start-b.start).map(p=>p.text).join('')).toBe(content);
   expect(chunks[0].start).toBe(0);expect(chunks.at(-1)!.end).toBe(content.length);
   expect(chunks.every((c,i)=>i===0||c.start<=chunks[i-1].end)).toBe(true);
  }
  expect(analysisV2CallPlan(content,limits)).toEqual(analysisV2CallPlan(content,limits));
  expect(analysisV2CallPlan(content,limits).keywordBaseCalls).toBe(planAnalysisV2Chunks(content,limits,'keywords').length*2);
 });
 it('bounds keyword chunks by output capacity and fails excess capacity before calling a model',async()=>{
  const text='literal text '.repeat(700),configured={...limits,chunkChars:12000};
  expect(planAnalysisV2Chunks(text,configured,'keywords').every(c=>c.end-c.start<=2048)).toBe(true);
  let calls=0;const generate:AnalysisGenerator=async()=>{calls++;throw new Error('must not call');};
  await expect(analyzeKeywordsV2(record(text),{...configured,maxChunks:1},generate)).rejects.toThrow('analysis_source_capacity');
  await expect(analyzeSummaryV2(record(text),{...limits,maxSourceChars:10},generate)).rejects.toThrow('analysis_source_capacity');
  await expect(analyzeSummaryV2(record(text),{...limits,maxOutputTokens:512},generate)).rejects.toThrow('analysis_output_capacity');
  expect(calls).toBe(0);
 });
 it('continues a 231540-character saved original through every bounded keyword chunk including the final name',async()=>{
  const content=('Nvidia '+'ordinary context. '.repeat(15000)).slice(0,231527)+' Tape to Tape',configured={...limits,chunkChars:12000,maxSourceChars:1000000,maxChunks:800};
  expect(content.length).toBe(231540);
  const requests:GenerationRequest[]=[],result=await analyzeKeywordsV2(record(content),configured,async request=>{requests.push(request);return keywordGenerator()(request);});
  expect(new Set((result.evidence.accepted as Array<{label:string}>).map(c=>c.label))).toEqual(new Set(['Nvidia','Tape to Tape']));
  expect(requests.length).toBe(analysisV2CallPlan(content,configured).keywordBaseCalls);
  expect(requests.filter(r=>r.role==='checker').at(-1)!.key).toBe(`checker:v2:chunk:${planAnalysisV2Chunks(content,configured,'keywords').length-1}`);
  expect((result.evidence.coverage as Array<{end:number}>).at(-1)!.end).toBe(231540);
 });
 it('uses only versioned bounded keys and forbids nested repairs',()=>{
  for(const key of ['summary:v2:chunk:0','extractor:v2:chunk:1','checker:v2:chunk:2','summary-reduce:v2:level:3:group:1','summary:v2:verify:0']) {
   expect(parseAnalysisV2CallKey(key)).toEqual({baseKey:key,repairAttempt:0});
   expect(parseAnalysisV2CallKey(key+':repair:1')).toEqual({baseKey:key,repairAttempt:1});
   expect(parseAnalysisV2CallKey(key+':repair:2')).toBeNull();expect(parseAnalysisV2CallKey(key+':repair:1:repair:1')).toBeNull();
  }
  expect(parseAnalysisV2CallKey('summary:0')).toBeNull();
 });
});

describe('v2 blind full-source keyword inventories',()=>{
 it('keeps more than ten identities, sponsor/outro/final-tail names and exact source positions across chunks',async()=>{
  const entities=[...baseEntities,...Array.from({length:24},(_,i)=>({label:`Brand${i}`,kind:'brand'}))],content='Nvidia RTX 5090 GPU DLSS 5. C++, C# and C. '+
   entities.slice(9).map(e=>e.label).join(' ')+' context '.repeat(200)+'Sponsor: Factorio. Our final game is Tape to Tape',requests:GenerationRequest[]=[];
  const result=await analyzeKeywordsV2(record(content),limits,async request=>{requests.push(request);return keywordGenerator(entities)(request);});
  const accepted=result.evidence.accepted as Array<{label:string;evidenceQuote:string}>,extraction=result.evidence.extraction as {proposals:Array<{mention:string;start:number;end:number}>};
  expect(new Set(accepted.map(c=>c.label))).toEqual(new Set(entities.map(e=>e.label)));
  expect(accepted.length).toBeGreaterThan(10);expect(result.state).toBe('ready');
  expect(extraction.proposals.every(c=>content.slice(c.start,c.end)===c.mention)).toBe(true);expect(accepted.every(c=>content.includes(c.evidenceQuote))).toBe(true);
  const chunks=planAnalysisV2Chunks(content,limits,'keywords');expect(requests).toHaveLength(chunks.length*2);
  for(const role of ['extractor','checker'])expect(requests.filter(r=>r.role===role).map(r=>prompt(r).passages.at(-1)!.text).at(-1)!.endsWith('Tape to Tape')).toBe(true);
  for(const request of requests.filter(r=>r.role==='checker')) {
   expect(JSON.parse(request.prompt)).not.toHaveProperty('extraction');expect(JSON.parse(request.prompt)).not.toHaveProperty('candidates');
   expect(request.prompt).not.toContain('Explicit literal identity');
  }
  expect(JSON.stringify(result.patch)).not.toContain('evidenceQuote');expect(result.evidence.protocolVersion).toBe('content-v2');
 });
 it('supports a literal name crossing passage boundaries without changing any original character',async()=>{
  const text='x'.repeat(234)+' Tape to Tape is mentioned.',bodySource=planAnalysisV2Chunks(text,limits,'keywords')[0];
  expect(bodySource.passages[0].text.includes('Tape to Tape')).toBe(false);
  const result=await analyzeKeywordsV2(record(text),limits,keywordGenerator([{label:'Tape to Tape',kind:'game'}]));
  expect((result.evidence.accepted as unknown[])).toHaveLength(1);
 });
 it('keeps explicit canonical aliases and casing while disputed identities wait privately',async()=>{
  const content='NVIDIA graphics cards PS5. Nvidia is named.',entities:Entity[]=[{label:'nvidia',mention:'NVIDIA',kind:'brand'},
   {label:'graphics cards',kind:'category'},{label:'ps5',mention:'PS5'},{label:'AMD',mention:'Nvidia',kind:'brand'}];
  const result=await analyzeKeywordsV2(record(content),limits,keywordGenerator(entities));
  expect((result.evidence.accepted as Array<{label:string}>).map(c=>c.label)).toEqual(['Nvidia','GPU','PlayStation 5']);
  expect(result.state).toBe('review');expect(result.pending).toMatchObject([{label:'AMD',evidenceQuote:content}]);
 });
 it('preserves checker-only discoveries and low/unknown confidence instead of dropping them',async()=>{
  const entities:Entity[]=[{label:'Nvidia',kind:'brand',confidence:49},{label:'GPU',kind:'category',confidence:null},{label:'Tape to Tape',kind:'game'}];
  const result=await analyzeKeywordsV2(record('Nvidia GPU Tape to Tape'),limits,async request=>keywordGenerator(request.role==='extractor'?entities.slice(0,2):entities)(request));
  expect(result.state).toBe('review');expect(result.pending).toHaveLength(3);expect(result.evidence.accepted).toEqual([]);
 });
 it.each([false,true])('retains a disputed alias when the same pass also has a valid canonical proposal (reverse=%s)',async reverse=>{
  const entities:Entity[]=[{label:'AMD',mention:'AMD',kind:'brand'},{label:'AMD',mention:'Nvidia',kind:'brand'}];
  const result=await analyzeKeywordsV2(record('AMD and Nvidia are separate brands.'),limits,keywordGenerator(reverse?entities.reverse():entities));
  expect(result.state).toBe('review');expect(result.evidence.accepted).toEqual([]);expect(result.pending).toMatchObject([{label:'AMD',confidence:0}]);
  expect((result.evidence.extraction as {proposals:unknown[]}).proposals).toHaveLength(2);
 });
 it('rejects a passage from another chunk even when its words are identical',async()=>{
  const text='Nvidia. '+'context '.repeat(250)+'Nvidia.',requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV2(record(text),limits,async request=>{
   requests.push(request);const body=prompt(request),value=keywordValue(body);
   if(request.key.includes('chunk:1'))value.candidates=[{label:'Nvidia',kind:'brand',confidence:100,reason:'Literal name.',mention:'Nvidia',passageIds:[analysisPassagesV2(text)[0].id]}];
   return {value,observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_unsupported_passage');
  expect(requests.at(-1)!.key).toBe('extractor:v2:chunk:1:repair:1');
 });
 it('rejects identity substrings against actual original boundaries and never times C from C++/C#',async()=>{
  expect(literalMentionOffsetsV2('C++ C#','C')).toEqual([]);expect(literalMentionOffsetsV2('(C++) C# then C.','C')).toEqual([14]);
  const content='C++, C#, then C.',result=await analyzeKeywordsV2({...record(content),transcriptSegments:[
   {startSeconds:0,text:'C++,',durationSeconds:10},{startSeconds:10,text:'C#, then',durationSeconds:10},{startSeconds:20,text:'C.',durationSeconds:10},
  ]},limits,keywordGenerator([{label:'C',kind:'technology'}]));
  expect(result.evidence.accepted).toMatchObject([{label:'C',ranges:[{startSeconds:20,endSeconds:30}],seconds:10}]);
  await expect(analyzeKeywordsV2(record('C++ C#'),limits,async request=>({value:{...ack(prompt(request)),candidates:[{label:'C',kind:'technology',confidence:100,
   reason:'Wrong substring.',mention:'C',passageIds:[prompt(request).passages[0].id]}]},observedUsd:0,actualUsd:0}))).rejects.toThrow('analysis_unsupported_mention');
 });
 it.each(['confidence','reason','kind','passageIds'])('validates every duplicate proposal before merging: invalid %s cannot hide',async field=>{
  await expect(analyzeKeywordsV2(record('Nvidia'),limits,async request=>{
   const value=keywordValue(prompt(request),[{label:'Nvidia',kind:'brand'}]),duplicate={...value.candidates[0]} as Record<string,unknown>;
   duplicate[field]=field==='confidence'?999:field==='reason'?'':field==='kind'?'person':['not-a-passage'];
   value.candidates.push(duplicate as never);return {value,observedUsd:0,actualUsd:0};
  })).rejects.toThrow();
 });
 it('does not silently erase one bad candidate during correction',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV2(record('Nvidia'),limits,async request=>{
   requests.push(request);const value=keywordValue(prompt(request),[{label:'Nvidia',kind:'brand'}]);
   if(!request.key.endsWith(':repair:1'))value.candidates.push({...value.candidates[0],label:'Ghost',mention:'Ghost'});
   return {value,observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_correction_dropped_proposal');
  expect(requests).toHaveLength(2);
 });
 it('repairs all candidates, preserves the invalid proposal unchanged, and reuses identical keys across resume',async()=>{
  const paid=new Map<string,GenerationResult>(),requests:GenerationRequest[]=[],invalid:unknown[]=[];
  const generate:AnalysisGenerator=async request=>{
   requests.push(request);if(paid.has(request.key))return paid.get(request.key)!;
   const value=keywordValue(prompt(request),[{label:'Nvidia',kind:'brand'}]);
   if(request.key==='extractor:v2:chunk:0'){value.candidates[0].passageIds=['wrong'];invalid.push(structuredClone(value));}
   const result={value,observedUsd:0,actualUsd:0};paid.set(request.key,result);return result;
  };
  const first=await analyzeKeywordsV2(record('Nvidia'),limits,generate),paidCount=paid.size;
  expect(paid.get('extractor:v2:chunk:0')!.value).toEqual(invalid[0]);
  const repair=requests.find(r=>r.key.endsWith(':repair:1'))!,repairBody=JSON.parse(repair.prompt);
  expect(repair).toMatchObject({correction:{baseKey:'extractor:v2:chunk:0',errorCode:'analysis_unsupported_passage'}});
  expect(repairBody.invalidResponse).toEqual(invalid[0]);expect(repairBody.originalRequest.passages).toEqual(JSON.parse(requests[0].prompt).passages);
  const second=await analyzeKeywordsV2(record('Nvidia'),limits,generate);
  expect(paid.size).toBe(paidCount);expect(second).toEqual(first);
  expect([...paid.keys()]).toEqual(['extractor:v2:chunk:0','extractor:v2:chunk:0:repair:1','checker:v2:chunk:0']);
 });
 it('fails truthfully for two genuine empty inventories without manufacturing a candidate',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV2(record('We will see you next time.'),limits,async request=>{requests.push(request);return keywordGenerator([])(request);})).rejects.toMatchObject({code:'empty_keyword_inventory_requires_manual_review'});
  expect(requests.map(r=>r.role)).toEqual(['extractor','checker']);
 });
 it('fits 300 valid identities inside the existing SQL prepared-result limit without losing any label',async()=>{
  const entities=Array.from({length:300},(_,i)=>({label:`Brand${i}`,kind:'brand'})),content=entities.map(e=>`${e.label} is an explicit public brand in this synthetic material. `).join('');
  const result=await analyzeKeywordsV2(record(content),limits,keywordGenerator(entities));
  expect((result.evidence.accepted as unknown[])).toHaveLength(300);
  expect(Buffer.byteLength(JSON.stringify(result,null,1),'utf8')).toBeLessThan(480000);
  const pass=result.evidence.extraction as {proposalCount:number;proposals:unknown[];candidates:unknown[]};
  expect(pass.proposalCount).toBeGreaterThanOrEqual(300);expect(pass.proposals).toHaveLength(300);expect(pass.candidates).toHaveLength(300);
 });
});

describe('v2 financial correction boundary',()=>{
 it.each(['analysis_invalid_json','analysis_output_capacity'] as const)('repairs known-settled materialized %s after domain validation and retains the original value',async validationError=>{
  const requests:GenerationRequest[]=[],opaque={rawOutput:'{"unfinishedSyntheticResponse":',finishReason:'length'};
  const result=await analyzeKeywordsV2(record('Nvidia'),limits,async request=>{
   requests.push(request);
   if(request.key==='extractor:v2:chunk:0')return {value:validationError==='analysis_invalid_json'?opaque:keywordValue(prompt(request)),validationError,observedUsd:0,actualUsd:0};
   return keywordGenerator()(request);
  });
  expect(result.state).toBe('ready');expect(requests.map(r=>r.key)).toEqual(['extractor:v2:chunk:0','extractor:v2:chunk:0:repair:1','checker:v2:chunk:0']);
  expect(requests[1]).toMatchObject({correction:{baseKey:'extractor:v2:chunk:0',errorCode:validationError}});
  if(validationError==='analysis_invalid_json')expect(JSON.parse(requests[1].prompt).invalidResponse).toEqual(opaque);
 });
 it('treats refusal as terminal even when the refusal value is structurally invalid',async()=>{
  let calls=0;await expect(analyzeKeywordsV2(record('Nvidia'),limits,async()=>{calls++;return {value:{rawOutput:'Synthetic refusal'},validationError:'analysis_provider_refusal',observedUsd:0,actualUsd:0};})).rejects.toThrow('analysis_provider_refusal');expect(calls).toBe(1);
 });
 it('does not repair a materialized malformed generation with unknown cost',async()=>{
  let calls=0;await expect(analyzeKeywordsV2(record('Nvidia'),limits,async()=>{calls++;return {value:{rawOutput:'{'},validationError:'analysis_invalid_json',observedUsd:0,actualUsd:null};})).rejects.toThrow('analysis_correction_charge_unknown');expect(calls).toBe(1);
 });
 it('fails after the only correction when it still carries an output-capacity marker',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV2(record('Nvidia'),limits,async request=>{requests.push(request);return {value:keywordValue(prompt(request)),validationError:'analysis_output_capacity',observedUsd:0,actualUsd:0};})).rejects.toThrow('analysis_output_capacity');
  expect(requests).toHaveLength(2);
 });
 it.each([undefined,null,-1,NaN,Infinity,'0'])('never repairs an invalid response with unknown/unsettled actual charge %s',async actual=>{
  let calls=0;
  await expect(analyzeKeywordsV2(record('Nvidia'),limits,async request=>{
   calls++;const value=keywordValue(prompt(request));value.readComplete=false;
   return {value,observedUsd:0,...(actual!==undefined?{actualUsd:actual}:{})} as GenerationResult;
  })).rejects.toThrow('analysis_correction_charge_unknown');
  expect(calls).toBe(1);expect(hasKnownSettledAnalysisCharge({actualUsd:actual as number|null})).toBe(false);
 });
 it('does not repair or retry a transport failure',async()=>{
  let calls=0;await expect(analyzeKeywordsV2(record('Nvidia'),limits,async()=>{calls++;throw new AnalysisError('analysis_provider_timeout');})).rejects.toThrow('analysis_provider_timeout');expect(calls).toBe(1);
 });
 it('makes at most one repair even after a settled invalid correction',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV2(record('Nvidia'),limits,async request=>{
   requests.push(request);return {value:{...keywordValue(prompt(request)),readComplete:false},observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_incomplete_coverage');
  expect(requests.map(r=>r.key)).toEqual(['extractor:v2:chunk:0','extractor:v2:chunk:0:repair:1']);
 });
});

describe('v2 concrete summaries and semantic grounding',()=>{
 it('publishes synthesized concise prose, code-reconstructed evidence and only exact saved-cue times',async()=>{
  const update={...record(finding),transcriptSegments:[{startSeconds:453.84000000000003,text:finding,durationSeconds:8}]},requests:GenerationRequest[]=[];
  const result=await analyzeSummaryV2(update,limits,async request=>{requests.push(request);return summaryGenerator(request);});
  expect(result.patch.videoHighlights).toEqual([{text:takeaway,startSeconds:453.84000000000003}]);
  expect(result.evidence.selected).toMatchObject([{text:takeaway,evidenceQuote:finding,start:0,end:finding.length}]);
  expect(requests.map(r=>r.key)).toEqual(['summary:v2:chunk:0','summary:v2:verify:0']);
  expect(requests.every(r=>!r.prompt.includes('startSeconds'))).toBe(true);
  expect(JSON.stringify(result.patch)).not.toContain('evidenceQuote');
 });
 it('leaves partial and ambiguous cue matches untimed and never estimates missing durations',async()=>{
  const content=finding+' This final qualification has no saved timing.',result=await analyzeSummaryV2({...record(content),transcriptSegments:[{startSeconds:12,text:finding,durationSeconds:8}]},limits,summaryGenerator);
  expect(result.patch.videoHighlights).toEqual([{text:takeaway}]);expect(result.patch.videoSummary).toMatchObject({timingBasis:'none'});
  expect(alignAnalysisCuesV2('Repeated. A unique middle. Repeated.',[{startSeconds:99,text:'Repeated.',durationSeconds:1}])).toEqual([]);
  expect(alignAnalysisCuesV2('Repeated. Repeated.',[{startSeconds:1,text:'Repeated.'},{startSeconds:2,text:'Repeated.'}])).toMatchObject([{start:0,startSeconds:1},{start:10,startSeconds:2}]);
  const keywords=await analyzeKeywordsV2({...record('Nvidia'),transcriptSegments:[{startSeconds:10,text:'Nvidia'}]},limits,keywordGenerator());
  expect(keywords.evidence.accepted).toMatchObject([{label:'Nvidia',ranges:[]}]);
 });
 it('keeps an occurrence untimed when overlapping partial cue spans claim conflicting saved times',async()=>{
  const result=await analyzeKeywordsV2({...record('Nvidia GPU'),transcriptSegments:[{startSeconds:0,text:'Nvidia GPU',durationSeconds:10},{startSeconds:100,text:'GPU',durationSeconds:10}]},limits,keywordGenerator());
  expect(result.evidence.accepted).toMatchObject([{label:'Nvidia',ranges:[]},{label:'GPU',ranges:[]}]);
 });
 it('uses all three conflicting cue rows before removing an ambiguous identical-span pair',async()=>{
  const result=await analyzeKeywordsV2({...record('Nvidia GPU'),transcriptSegments:[{startSeconds:0,text:'Nvidia GPU',durationSeconds:10},
   {startSeconds:100,text:'Nvidia GPU',durationSeconds:10},{startSeconds:50,text:'GPU',durationSeconds:10}]},limits,keywordGenerator());
  expect(result.evidence.accepted).toMatchObject([{label:'Nvidia',ranges:[]},{label:'GPU',ranges:[]}]);
 });
 it('reads every chunk and late finding, then uses bounded deterministic reductions and verifies final prose',async()=>{
  const text='Context only. '.repeat(700)+finding,requests:GenerationRequest[]=[];
  const result=await analyzeSummaryV2(record(text),limits,async request=>{requests.push(request);return summaryGenerator(request);});
  expect(requests.filter(r=>/^summary:v2:chunk:/u.test(r.key))).toHaveLength(planAnalysisV2Chunks(text,limits,'summary').length);
  expect(requests.some(r=>r.role==='summary-reduce')).toBe(true);expect(requests.at(-1)!.key).toBe('summary:v2:verify:0');
  expect(result.patch.videoHighlights).toEqual([{text:takeaway}]);
  expect((result.evidence.coverage as Array<{end:number}>).at(-1)!.end).toBe(text.length);
  expect(requests.length).toBeLessThanOrEqual(analysisV2CallPlan(text,limits).summaryBaseCallsMax);
 });
 it('performs final global selection even when many reduction groups each shrink to one repeated point',async()=>{
  const text=(finding+' Context filler. '.repeat(70)).repeat(24),requests:GenerationRequest[]=[];
  const result=await analyzeSummaryV2(record(text),{...limits,maxChunks:200},async request=>{requests.push(request);return summaryGenerator(request);});
  const reductions=requests.filter(r=>r.role==='summary-reduce');
  expect(reductions.some(r=>r.key.startsWith('summary-reduce:v2:level:1:'))).toBe(true);
  expect(result.patch.videoHighlights).toEqual([{text:takeaway}]);
  expect(requests.length).toBeLessThanOrEqual(analysisV2CallPlan(text,{...limits,maxChunks:200}).summaryBaseCallsMax);
  expect(reductions.every(r=>prompt(r).findings!.length<=18)).toBe(true);
 });
 it.each([
  ['negation reversal','The GPU did not improve in the reported test.'],
  ['unsupported doubling','The GPU doubled its frame rate in the reported test.'],
  ['certainty inflation','The GPU will improve in every future test.'],
  ['lost attribution','Independent tests prove the vendor GPU always outperforms competitors.'],
 ])('fails a negative semantic verdict for %s and never retries the verifier into agreement',async(_kind,text)=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV2(record(finding),limits,async request=>{
   requests.push(request);const body=prompt(request);
   return {value:body.task==='verify_summary'?{readComplete:true,verdicts:[{id:'s0',supported:false,reason:'The sentence changes the original meaning.'}]}:
    {...ack(body),highlights:[{text,passageIds:[body.passages[0].id]}]},observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_unsupported_summary_claim');
  expect(requests.map(r=>r.key)).toEqual(['summary:v2:chunk:0','summary:v2:verify:0']);
 });
 it('rejects invented numeric findings before semantic checking, even when the quote itself is real',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV2(record(finding),limits,async request=>{
   requests.push(request);const body=prompt(request);return {value:{...ack(body),highlights:[{text:'The GPU improved to 60 FPS in the reported test.',passageIds:[body.passages[0].id]}]},observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_unsupported_summary_number');
  expect(requests).toHaveLength(2);expect(requests.some(r=>r.key.includes('verify'))).toBe(false);
 });
 it.each(['missing','duplicate'])('requires one semantic verdict per final finding: %s verdicts cannot pass',async mode=>{
  await expect(analyzeSummaryV2(record(finding),limits,async request=>{
   const body=prompt(request);return body.task==='verify_summary'?{value:{readComplete:true,verdicts:mode==='missing'?[]:[
    {id:'s0',supported:true,reason:'Support.'},{id:'s0',supported:true,reason:'Duplicate.'},
   ]},observedUsd:0,actualUsd:0}:summaryGenerator(request);
  })).rejects.toThrow('analysis_incomplete_summary_verification');
 });
 it('requires the exact expected claim-ID set rather than numeric-equivalent IDs',async()=>{
  const text=finding+' The GPU consumed less power under the same measured workload.';
  await expect(analyzeSummaryV2(record(text),limits,async request=>{
   const body=prompt(request);return {value:body.task==='verify_summary'?{readComplete:true,verdicts:[{id:'s0',supported:true,reason:'Support.'},{id:'s00',supported:true,reason:'Incorrect duplicate numeric ID.'}]}:
    {...ack(body),highlights:[{text:takeaway,passageIds:[body.passages[0].id]},{text:'The GPU consumed less power in the same measured workload.',passageIds:[body.passages[0].id]}]},observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_invalid_summary_verification');
 });
 it('never repairs an incomplete negative verdict into positive agreement',async()=>{
  const text=finding+' The GPU consumed less power under the same measured workload.',requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV2(record(text),limits,async request=>{
   requests.push(request);const body=prompt(request);
   return {value:body.task==='verify_summary'?(request.key.endsWith(':repair:1')?{readComplete:true,verdicts:[{id:'s0',supported:true,reason:'Changed agreement.'},{id:'s1',supported:true,reason:'Changed agreement.'}]}:
    {readComplete:false,verdicts:[{id:'s0',supported:false,reason:'The first finding is not supported.'}],unexpected:'also malformed'}):
    {...ack(body),highlights:[{text:takeaway,passageIds:[body.passages[0].id]},{text:'The GPU consumed less power in the same measured workload.',passageIds:[body.passages[0].id]}]},observedUsd:0,actualUsd:0};
  })).rejects.toThrow('analysis_unsupported_summary_claim');
  expect(requests.map(r=>r.key)).toEqual(['summary:v2:chunk:0','summary:v2:verify:0']);
 });
 it('keeps a recognizable semantic rejection terminal even when the generation also has a partial-output marker',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV2(record(finding),limits,async request=>{
   requests.push(request);return prompt(request).task==='verify_summary'?{value:{readComplete:false,verdicts:[{id:'s0',supported:false,reason:'Unsupported finding.'}]},
    validationError:'analysis_output_capacity',observedUsd:0,actualUsd:0}:summaryGenerator(request);
  })).rejects.toThrow('analysis_unsupported_summary_claim');
  expect(requests.map(r=>r.key)).toEqual(['summary:v2:chunk:0','summary:v2:verify:0']);
 });
 it('allows an honestly empty promotional recap without substituting excerpts or fake findings',async()=>{
  const result=await analyzeSummaryV2(record('Buy this sponsor product today. Like and subscribe.'),limits,summaryGenerator);
  expect(result.state).toBe('empty');expect(result.patch.videoHighlights).toEqual([]);expect(result.evidence.verification).toEqual([]);
 });
 it('never analyzes metadata-only video descriptions',async()=>{
  let calls=0;const generate:AnalysisGenerator=async()=>{calls++;throw new Error('unexpected');};
  await expect(analyzeSummaryV2({...record(finding),contentKind:'metadata_only'},limits,generate)).rejects.toThrow('usable_summary_content_required');
  await expect(analyzeKeywordsV2({...record(finding),contentKind:'feed_text'},limits,generate)).rejects.toThrow('usable_keyword_content_required');expect(calls).toBe(0);
 });
});
