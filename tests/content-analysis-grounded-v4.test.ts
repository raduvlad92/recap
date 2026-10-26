import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SourceUpdate } from '../src/lib/types';
import { analyzeKeywordsV4, analyzeSummaryV4, generateValidatedAnalysisV4, type AnalysisV4Context } from '../netlify/functions/_shared/content-analysis-grounded-v4';
import { ANALYSIS_V4_GENERATION_CONTRACT_HASH, ANALYSIS_V4_GENERATION_CONTRACT_JSON, ANALYSIS_V4_GENERATION_CONTRACT_DESCRIPTOR, canonicalAnalysisV4Json, isAnalysisV4CallKey } from '../netlify/functions/_shared/content-analysis-grounded-v4-protocol';
import { analysisLexicalUnitsV4, analysisMentionV4, analysisV4CallPlan, planAnalysisV4Chunks } from '../netlify/functions/_shared/content-analysis-grounded-v4-source';
import { ANALYSIS_V3_GENERATION_CONTRACT_HASH } from '../netlify/functions/_shared/content-analysis-grounded-v3-protocol';
import type { AnalysisGenerator, AnalysisLimits, GenerationRequest, GenerationResult } from '../netlify/functions/_shared/content-analysis-model';

const limits:AnalysisLimits={model:'synthetic-model',chunkChars:1200,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,inputUsdPerMillion:.2,outputUsdPerMillion:1.2,maxCallUsd:.1};
const context:AnalysisV4Context={protocolVersion:'content-v4',generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,predecessorJobId:null,emptyDisposition:'findings_expected'};
const record=(content:string):SourceUpdate=>({id:'synthetic',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic',summary:'Not evidence',url:'https://example.test/video',publishedAt:'2026-10-26T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content});
type Body={task:string;requiredLastPassageId:string;passages:Array<{id:string;text:string}>;lexicalUnits:Array<{id:string;text:string}>;claims:Array<{id:string;text:string;originalProposals:Array<{text:string}>}>;findings:Array<{proposalId:string;text:string;passageIds:string[]}>};
const payload=(request:GenerationRequest)=>JSON.parse(request.prompt);
const body=(request:GenerationRequest):Body=>payload(request).originalRequest??payload(request);
const ack=(value:Body)=>({readComplete:true,lastPassageId:value.requiredLastPassageId});
const settled=(value:unknown):GenerationResult=>({value,observedUsd:0,actualUsd:0});
const verdicts=(value:Body,sameFinding=true)=>({readComplete:true,verdicts:value.claims.map(claim=>({id:claim.id,supported:true,sameFinding,reason:'Synthetic independently supported finding.'}))});
const point=(value:Body,text='The tested device drew 0.166 V under the measured load.')=>({text,passageIds:[value.passages[0].id]});
function keyword(value:Body,content:string,label:string,mention=label) {
 const first=value.lexicalUnits.find(unit=>{
  const start=Number(unit.id.slice(1).split('_')[0]);return content.slice(start,start+mention.length)===mention;
 })!;
 const start=Number(first.id.slice(1).split('_')[0]),end=start+mention.length,last=value.lexicalUnits.find(unit=>Number(unit.id.split('_')[1])===end)!;
 return {label,kind:'product',confidence:100,reason:'Explicit source identity.',firstUnitId:first.id,lastUnitId:last.id};
}
const repaired=(request:GenerationRequest,rows:unknown[])=>({ ...ack(body(request)),[request.role==='extractor'||request.role==='checker'?'candidates':'highlights']:rows.map((row,index)=>({...row as object,proposalId:payload(request).proposalLineage[index].proposalId,correctionReason:'Narrowed to the same supported finding or corrected exact source references.'}))});

describe('content-v4 immutable contract and lexical evidence',()=>{
 it('has its own canonical hash and preserves unchanged H3',()=>{
  expect(ANALYSIS_V3_GENERATION_CONTRACT_HASH).toBe('8b45295994cadc1798f29d61675f169687c5cf187de289c48eb117b5b62d0946');
  expect(ANALYSIS_V4_GENERATION_CONTRACT_HASH).not.toBe(ANALYSIS_V3_GENERATION_CONTRACT_HASH);
  expect(createHash('sha256').update(ANALYSIS_V4_GENERATION_CONTRACT_JSON).digest('hex')).toBe(ANALYSIS_V4_GENERATION_CONTRACT_HASH);
  expect(Object.isFrozen(ANALYSIS_V4_GENERATION_CONTRACT_DESCRIPTOR.schemaTemplates)).toBe(true);
  for(const key of ['summary:v4:chunk:0','extractor:v4:chunk:2','checker:v4:chunk:3','summary-reduce:v4:level:0:group:0','summary:v4:verify:0']) {
   expect(isAnalysisV4CallKey(key)).toBe(true);expect(isAnalysisV4CallKey(key+':repair:1')).toBe(true);
   expect(isAnalysisV4CallKey(key.replace(':v4:',':v3:'))).toBe(false);expect(isAnalysisV4CallKey(key+':repair:2')).toBe(false);
  }
 });
 it('reconstructs exact Unicode, separators, versions and C/C++/C# without model string copies',()=>{
  const content='C C++ C# café RTX  5090, .NET and ﬀ are distinct.';
  const units=analysisLexicalUnitsV4(content);
  expect(units.filter(unit=>['C','C++','C#','café'].includes(unit.text)).map(unit=>unit.text)).toEqual(['C','C++','C#','café']);
  const start=units.find(unit=>unit.text==='RTX')!,end=units.find(unit=>unit.text==='5090')!;
  expect(analysisMentionV4(content,units,start.id,end.id)).toMatchObject({mention:'RTX  5090',start:content.indexOf('RTX'),end:content.indexOf('RTX')+9});
  expect(()=>analysisMentionV4(content,units,end.id,start.id)).toThrow('analysis_unsupported_mention');
  expect(()=>analysisMentionV4(content,units,'u2_3','u2_3')).toThrow('analysis_unsupported_mention');
  const partial=analysisLexicalUnitsV4(content,3,5);expect(partial).toEqual([]);
 });
 it('never turns a chunk-edge fragment or split surrogate into a whole lexical identity',()=>{
  const content='X C++ café\u0301 AeroBox 😀.NET';
  const all=analysisLexicalUnitsV4(content);
  for(let start=0;start<content.length;start++)for(let end=start;end<=content.length;end++) {
   if(/[\uDC00-\uDFFF]/u.test(content[start]??'')||/[\uD800-\uDBFF]/u.test(content[end-1]??''))continue;
   expect(analysisLexicalUnitsV4(content,start,end)).toEqual(all.filter(unit=>unit.start>=start&&unit.end<=end));
  }
  const emoji=content.indexOf('😀');expect(()=>analysisLexicalUnitsV4(content,emoji+1)).toThrow('analysis_unsupported_mention');
 });
 it('binds keyword schema IDs to each exact chunk and preserves the saved tail in both blind passes',async()=>{
  const content='AeroBox is a product. '+('Ordinary neutral synthetic source context. '.repeat(90))+' OutroGlider',requests:GenerationRequest[]=[];
  const result=await analyzeKeywordsV4(record(content),limits,async request=>{
   requests.push(request);const value=body(request),candidates=[];
   for(const label of ['AeroBox','OutroGlider'])if(value.lexicalUnits.some(unit=>unit.text===label))candidates.push(keyword(value,content,label));
   return settled({...ack(value),candidates});
  },context);
  expect(result.state).toBe('ready');
  expect((result.evidence as any).accepted.map((candidate:any)=>candidate.label)).toEqual(['AeroBox','OutroGlider']);
  const roles=requests.map(request=>request.role);expect(roles.lastIndexOf('extractor')).toBeLessThan(roles.indexOf('checker'));
  for(const request of requests) {
   const value=body(request),schema=request.schema as any;
   expect(schema.properties.candidates.items.properties.firstUnitId.enum).toEqual(value.lexicalUnits.map(unit=>unit.id));
   expect(schema.properties.candidates.items.properties.mention).toBeUndefined();
   expect(request.prompt).toBe(canonicalAnalysisV4Json(payload(request)));
   expect(payload(request).extraction).toBeUndefined();
  }
  expect((result.evidence as any).coverage.at(-1).end).toBe(content.length);
  expect((result.evidence as any).extraction.candidates[0]).toMatchObject({mention:'AeroBox',proposalId:expect.any(String),firstUnitId:expect.any(String)});
 });
 it('rejects source/context mismatch before any generator call',async()=>{
  let calls=0;const generate:AnalysisGenerator=async()=>{calls++;return settled(null);};
  await expect(analyzeSummaryV4(record('A useful synthetic finding.'),limits,generate,{...context,generationContractHash:'wrong'})).rejects.toThrow('analysis_generation_context_mismatch');
  await expect(analyzeKeywordsV4(record('AeroBox'),limits,generate,{...context,protocolVersion:'content-v3'} as any)).rejects.toThrow('analysis_generation_context_mismatch');
  expect(calls).toBe(0);
 });
 it('uses lossless old source geometry while reserving no repair for final verification',()=>{
  const content='Ordinary source context. '.repeat(500),chunks=planAnalysisV4Chunks(content,limits,'keywords');
  expect(chunks[0].start).toBe(0);expect(chunks.at(-1)!.end).toBe(content.length);
  const plan=analysisV4CallPlan(content,limits);expect(plan.summaryCallsIncludingRepairsMax).toBe(2*(plan.summaryBaseCallsMax-1)+1);expect(plan.keywordCallsIncludingRepairsMax).toBe(4*plan.keywordChunks);
 });
});

describe('accountable same-finding summary corrections',()=>{
 it('permits a supported wording change and sends immutable original finding to the terminal verifier',async()=>{
  const requests:GenerationRequest[]=[],content='The tested device drew 0.166 V under the measured load.';
  const result=await analyzeSummaryV4(record(content),limits,async request=>{
   requests.push(request);const value=body(request);
   if(value.task==='verify_summary') {
    expect(value.claims[0].originalProposals[0].text).toContain('0.166 mV');
    expect((request.schema as any).properties.verdicts.items.required).toContain('sameFinding');
    return settled(verdicts(value));
   }
   if(request.correction)return settled(repaired(request,[point(value)]));
   return settled({...ack(value),highlights:[point(value,'The tested device drew 0.166 mV under the measured load.')]});
  },context);
  expect(requests.map(request=>request.key)).toEqual(['summary:v4:chunk:0','summary:v4:chunk:0:repair:1','summary:v4:verify:0']);
  expect(result.state).toBe('ready');expect((result.patch.videoHighlights as Array<{text:string}>)?.[0].text).toContain('0.166 V');
  expect((result.evidence as any).selected[0].lineage[0]).toMatchObject({corrected:true,originalResponseHash:expect.stringMatching(/^[a-f0-9]{64}$/),originalProposalHash:expect.stringMatching(/^[a-f0-9]{64}$/),originalText:expect.stringContaining('mV')});
 });
 it('rejects an unrelated same-count replacement with the terminal continuity verdict and never repairs it',async()=>{
  const content='The tested device drew 0.166 V under load. Another product reduced latency by 8 ms.',keys:string[]=[];
  await expect(analyzeSummaryV4(record(content),limits,async request=>{
   keys.push(request.key);const value=body(request);
   if(value.task==='verify_summary')return settled(verdicts(value,false));
   if(request.correction)return settled(repaired(request,[point(value,'Another product reduced latency by 8 ms.')]));
   return settled({...ack(value),highlights:[point(value,'The tested device drew 0.166 mV under load.')]});
  },context)).rejects.toThrow('analysis_correction_changed_finding');
  expect(keys).toHaveLength(3);expect(keys.at(-1)).toBe('summary:v4:verify:0');
 });
 it.each(['missing','duplicate','reordered','invented'])('rejects %s trusted proposal identities before final verification',async(mode)=>{
  const content='The tested device drew 0.166 V. A second device drew 0.166 V.',keys:string[]=[];
  await expect(analyzeSummaryV4(record(content),limits,async request=>{
   keys.push(request.key);const value=body(request);
   const rows=[point(value,'The tested device drew 0.166 mV.'),point(value,'A second device drew 0.166 mV.')];
   if(!request.correction)return settled({...ack(value),highlights:rows});
   const corrected=repaired(request,[point(value,'The tested device drew 0.166 V.'),point(value,'A second device drew 0.166 V.')]);
   const highlights=(corrected as any).highlights;
   if(mode==='missing')highlights.pop();if(mode==='duplicate')highlights[1].proposalId=highlights[0].proposalId;
   if(mode==='reordered')highlights.reverse();if(mode==='invented')highlights[0].proposalId='invented';
   return settled(corrected);
  },context)).rejects.toThrow('analysis_correction_dropped_proposal');
  expect(keys).toHaveLength(2);
 });
 it('does not infer a missing or garbled unit, even after the one correction',async()=>{
  await expect(analyzeSummaryV4(record('The source reports a reading of 0.166 map during testing.'),limits,async request=>{
   const value=body(request),rows=[point(value,'The device measured 0.166 MP during testing.')];
   return settled(request.correction?repaired(request,rows):{...ack(value),highlights:rows});
  },context)).rejects.toThrow('analysis_unsupported_summary_unit');
 });
 it('retains trusted ancestry through reductions and requires the reducer to select one actual parent',async()=>{
  const content='The tested device drew 0.166 V under measured load. '.repeat(65),keys:string[]=[];
  const result=await analyzeSummaryV4(record(content),limits,async request=>{
   keys.push(request.key);const value=body(request);
   if(value.task==='verify_summary'){expect(value.claims[0].originalProposals.length).toBeGreaterThan(0);return settled(verdicts(value));}
   if(value.task==='reduce_findings')return settled({...ack(value),highlights:[{text:value.findings[0].text,passageIds:value.findings[0].passageIds,parentProposalId:value.findings[0].proposalId}]});
   return settled({...ack(value),highlights:[point(value)]});
  },context);
  expect(keys.some(key=>key.startsWith('summary-reduce:v4:'))).toBe(true);expect((result.evidence as any).selected[0].lineage.length).toBeGreaterThan(1);
 });
});

describe('strict materialization, financial and evidence failures',()=>{
 it.each(['analysis_invalid_json','analysis_output_capacity','analysis_provider_refusal'] as const)('keeps precise %s on the corrected response without another correction',async(validationError)=>{
  let calls=0;
  await expect(analyzeSummaryV4(record('The tested device drew 0.166 V under measured load.'),limits,async request=>{
   calls++;const value=body(request);
   if(request.correction)return {...settled({rawOutput:'{"highlights":[]} trailing {"highlights":[]}'}),validationError};
   return settled({...ack(value),highlights:[point(value,'The tested device drew 0.166 mV.')]});
  },context)).rejects.toThrow(validationError);
  expect(calls).toBe(2);
 });
 it.each([null,undefined])('unknown actual cost %s cannot authorize correction',async(actualUsd)=>{
  let calls=0;
  await expect(analyzeSummaryV4(record('The tested device drew 0.166 V.'),limits,async()=>{
   calls++;return {value:{readComplete:false,highlights:[]},observedUsd:0,...(actualUsd===undefined?{}:{actualUsd})};
  },context)).rejects.toThrow('analysis_correction_charge_unknown');expect(calls).toBe(1);
 });
 it('uses opaque raw-parent lineage for a single malformed-message correction without selecting a fragment',async()=>{
  const raw='{"highlights":[]} trailing {"highlights":[]}',content='The tested device drew 0.166 V under measured load.';let calls=0;
  const result=await analyzeSummaryV4(record(content),limits,async request=>{
   calls++;const value=body(request);
   if(value.task==='verify_summary')return settled(verdicts(value));
   if(request.correction){expect(payload(request).invalidResponse.rawOutput).toBe(raw);expect(payload(request).proposalLineage).toEqual([]);return settled({...ack(value),highlights:[point(value)]});}
   return {...settled({rawOutput:raw,finishReason:'stop'}),validationError:'analysis_invalid_json'};
  },context);
  expect(calls).toBe(3);expect((result.evidence as any).selected[0].lineage[0]).toMatchObject({opaqueParent:true,corrected:true});
 });
 it.each([{readComplete:true,verdicts:[]},{readComplete:false,verdicts:[{supported:false}]},{verdicts:[{sameFinding:false}]},{rawOutput:'two envelopes'}])('never repairs a final-verifier negative or malformed shape',async(value)=>{
  let calls=0;
  await expect(analyzeSummaryV4(record('The tested device drew 0.166 V under the measured load.'),limits,async request=>{
   calls++;const parsed=body(request);return settled(parsed.task==='verify_summary'?value:{...ack(parsed),highlights:[point(parsed)]});
  },context)).rejects.toThrow();expect(calls).toBe(2);
 });
 it('rejects out-of-chunk keyword IDs and cannot swap canonical identities during correction',async()=>{
  const content='AeroBox and Glider are products.';let calls=0;
  await expect(analyzeKeywordsV4(record(content),limits,async request=>{
   calls++;const value=body(request);
   if(request.correction)return settled(repaired(request,[keyword(value,content,'Glider')]));
   return settled({...ack(value),candidates:[{...keyword(value,content,'AeroBox'),firstUnitId:'u9000_9005'}]});
  },context)).rejects.toThrow('analysis_correction_dropped_proposal');expect(calls).toBe(2);
 });
 it('does not convert two empty keyword inventories into a successful empty annotation',async()=>{
  let calls=0;
  await expect(analyzeKeywordsV4(record('Ordinary source language with no reviewed empty disposition.'),limits,async request=>{calls++;return settled({...ack(body(request)),candidates:[]});},context)).rejects.toThrow('empty_keyword_inventory_requires_manual_review');expect(calls).toBe(2);
 });
 it('retains grounded unknown aliases and checker-only closing names in private review',async()=>{
  const content='We tested aerobox. Final comparison: OutroGlider.';
  const result=await analyzeKeywordsV4(record(content),limits,async request=>{
   const value=body(request),first={...keyword(value,content,'AeroBox','aerobox'),confidence:null},candidates:unknown[]=[first];
   if(request.role==='checker')candidates.push({...keyword(value,content,'OutroGlider'),confidence:100});
   return settled({...ack(value),candidates});
  },context);
  expect(result.state).toBe('review');expect(result.pending.map((candidate:any)=>candidate.label)).toEqual(['AeroBox','OutroGlider']);
  expect((result.evidence as any).accepted).toEqual([]);
 });
 it('derives keyword evidence and discussion ranges only from real matching cues',async()=>{
  const content='AeroBox performs the task. AeroBox remains available.',update={...record(content),transcriptSegments:[{text:'AeroBox performs the task.',startSeconds:12,durationSeconds:4},{text:'AeroBox remains available.',startSeconds:25}]};
  const result=await analyzeKeywordsV4(update,limits,async request=>settled({...ack(body(request)),candidates:[keyword(body(request),content,'AeroBox')]}),context);
  expect((result.evidence as any).accepted[0].ranges).toEqual([{startSeconds:12,endSeconds:16}]);
  expect((result.evidence as any).accepted[0].seconds).toBe(4);
 });
 it('requires independent empty-summary review and never erases findings_expected',async()=>{
  const generate:AnalysisGenerator=async request=>settled({...ack(body(request)),highlights:[]});
  await expect(analyzeSummaryV4(record('Ordinary synthetic source language.'),limits,generate,context)).rejects.toThrow('analysis_summary_omission');
  const reviewed=await analyzeSummaryV4(record('Ordinary synthetic source language.'),limits,generate,{...context,emptyDisposition:'no_findings_reviewed',sourceReviewDigest:'synthetic-source-review'});expect(reviewed.state).toBe('empty');
 });
 it('reconstructs repair identities and canonical prompts exactly after JSONB object reordering',async()=>{
  const content='The tested device drew 0.166 V under measured load.',cache=new Map<string,{hash:string;result:GenerationResult}>();let fresh=0;
  const generate:AnalysisGenerator=async request=>{
   const hash=createHash('sha256').update(canonicalAnalysisV4Json(request)).digest('hex'),cached=cache.get(request.key);
   if(cached){expect(hash).toBe(cached.hash);return cached.result;}
   fresh++;const value=body(request),result=settled(value.task==='verify_summary'?verdicts(value):request.correction?repaired(request,[point(value)]):{...ack(value),highlights:[point(value,'The tested device drew 0.166 mV.')]});
   cache.set(request.key,{hash,result});return result;
  };
  await analyzeSummaryV4(record(content),limits,generate,context);const first=fresh;
  for(const entry of cache.values())entry.result.value=JSON.parse(canonicalAnalysisV4Json(entry.result.value));
  await analyzeSummaryV4(record(content),limits,generate,context);expect(fresh).toBe(first);expect(fresh).toBe(3);
 });
});
