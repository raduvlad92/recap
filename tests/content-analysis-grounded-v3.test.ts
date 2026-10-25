import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import type {SourceUpdate} from '../src/lib/types';
import {contentHash} from '../src/lib/content-processing';
import {analyzeKeywordsV3,analyzeSummaryV3,analysisV3CallPlan,planAnalysisV3Chunks} from '../netlify/functions/_shared/content-analysis-engine';
import {analysisV3Numbers,type AnalysisDiagnosticV3,type AnalysisV3Context} from '../netlify/functions/_shared/content-analysis-grounded-v3';
import {ANALYSIS_V3_CONTRACT_HASH,ANALYSIS_V3_GENERATION_CONTRACT_DESCRIPTOR,ANALYSIS_V3_GENERATION_CONTRACT_HASH,ANALYSIS_V3_GENERATION_CONTRACT_JSON,
 canonicalAnalysisV3Json,isAnalysisV3CallKey,parseAnalysisV3CallKey} from '../netlify/functions/_shared/content-analysis-grounded-v3-protocol';
import {analysisPassagesV3,literalMentionOffsetsV3} from '../netlify/functions/_shared/content-analysis-grounded-v3-source';
import type {AnalysisGenerator,AnalysisLimits,GenerationRequest,GenerationResult} from '../netlify/functions/_shared/content-analysis-model';

const H3='8b45295994cadc1798f29d61675f169687c5cf187de289c48eb117b5b62d0946';
const limits:AnalysisLimits={model:'synthetic-model',chunkChars:1200,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,
 inputUsdPerMillion:.2,outputUsdPerMillion:1.2,cachedInputUsdPerMillion:.02,cacheWriteApplies:false,maxCallUsd:.01};
const record=(content:string):SourceUpdate=>({id:'synthetic-video',sourceId:'synthetic-source',contributorIds:[],title:'Synthetic title',summary:'Metadata is not evidence.',
 url:'https://example.test/synthetic',publishedAt:'2026-10-25T00:00:00Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,contentKind:'transcript',content});
type Body={task:string;requiredLastPassageId:string;passages:Array<{id:string;text:string}>;claims:Array<{id:string;text:string}>;findings:Array<{text:string;passageIds:string[]}>};
const body=(request:GenerationRequest):Body=>{const parsed=JSON.parse(request.prompt);return parsed.originalRequest||parsed;};
const ack=(value:Body)=>({readComplete:true,lastPassageId:value.requiredLastPassageId});
const settled=(value:unknown):GenerationResult=>({value,observedUsd:0,actualUsd:0});
const verdicts=(value:Body)=>({readComplete:true,verdicts:value.claims.map(claim=>({id:claim.id,supported:true,reason:'Synthetic verifier stub: cited evidence supports this sentence.'}))});
function keyword(value:Body,label='AeroBox',mention='aerobox') {
 return {label,mention,kind:'product',confidence:100,reason:'Explicit synthetic source identity.',passageIds:[value.passages.find(p=>p.text.includes(mention))!.id]};
}
function reorder(value:unknown):unknown {
 if(Array.isArray(value))return value.map(reorder);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>b.localeCompare(a)).map(([key,child])=>[key,reorder(child)]));
 return value;
}
const expectedContext:AnalysisV3Context={protocolVersion:'content-v3',generationContractHash:H3,predecessorJobId:'synthetic-predecessor',emptyDisposition:'findings_expected',sourceReviewDigest:'synthetic-review'};

describe('fixed source-free content-v3 generation contract',()=>{
 it('locks the independently SHA-256 checked canonical descriptor and parent alias to H3',()=>{
  expect(ANALYSIS_V3_GENERATION_CONTRACT_HASH).toBe(H3);expect(ANALYSIS_V3_CONTRACT_HASH).toBe(H3);
  expect(createHash('sha256').update(ANALYSIS_V3_GENERATION_CONTRACT_JSON).digest('hex')).toBe(H3);
  expect(canonicalAnalysisV3Json(reorder(ANALYSIS_V3_GENERATION_CONTRACT_DESCRIPTOR))).toBe(ANALYSIS_V3_GENERATION_CONTRACT_JSON);
  expect(Object.isFrozen(ANALYSIS_V3_GENERATION_CONTRACT_DESCRIPTOR.schemaTemplates)).toBe(true);
 });
 it('sorts nested object fields recursively but preserves arrays, strings and every value',()=>{
  const first={z:[{beta:2,alpha:{z:false,a:null}}],a:{rawOutput:{tail:3,head:1},errors:[{fieldPath:'$.candidates[3].mention',errorCode:'synthetic_error',constraint:'Synthetic constraint.'}]}};
  expect(canonicalAnalysisV3Json(first)).toBe(canonicalAnalysisV3Json(reorder(first)));
  expect(JSON.parse(canonicalAnalysisV3Json(first))).toEqual(first);
  expect(canonicalAnalysisV3Json([2,1])).not.toBe(canonicalAnalysisV3Json([1,2]));
  for(const unsupported of [undefined,NaN,Infinity,{missing:undefined},new Date(0)])expect(()=>canonicalAnalysisV3Json(unsupported)).toThrow('analysis_non_json_value');
 });
 it('rejects old, nested and unlimited repair identities without relabeling any key',()=>{
  for(const key of ['summary:v3:chunk:0','extractor:v3:chunk:2','checker:v3:chunk:3','summary-reduce:v3:level:1:group:2','summary:v3:verify:0']) {
   expect(parseAnalysisV3CallKey(key)).toEqual({baseKey:key,repairAttempt:0});expect(isAnalysisV3CallKey(key+':repair:1')).toBe(true);
   expect(isAnalysisV3CallKey(key+':repair:2')).toBe(false);expect(isAnalysisV3CallKey(key+':repair:1:repair:1')).toBe(false);
   expect(isAnalysisV3CallKey(key.replace(':v3:',':v2:'))).toBe(false);
  }
 });
 it.each([['protocolVersion','content-v2'],['generationContractHash','wrong-contract'],['emptyDisposition','not-a-disposition']])('rejects mismatched %s before either generator operates',async(field,value)=>{
  let calls=0;const generate:AnalysisGenerator=async()=>{calls++;throw new Error('must not generate');};
  const context={...expectedContext,[field]:value} as AnalysisV3Context;
  await expect(analyzeSummaryV3(record('The synthetic device improved.'),limits,generate,context)).rejects.toThrow('analysis_generation_context_mismatch');
  await expect(analyzeKeywordsV3(record('aerobox'),limits,generate,context)).rejects.toThrow('analysis_generation_context_mismatch');
  expect(calls).toBe(0);
 });
 it('binds each schema to exactly its supplied IDs and last ID while retaining literal runtime checks',async()=>{
  const requests:GenerationRequest[]=[],content='We tested aerobox today. '+('ordinary synthetic context. '.repeat(60));
  const result=await analyzeKeywordsV3(record(content),limits,async request=>{
   requests.push(request);const value=body(request);
   return settled({...ack(value),candidates:value.passages.some(p=>p.text.includes('aerobox'))?[keyword(value)]:[]});
  },expectedContext);
  expect(result.evidence).toMatchObject({protocolVersion:'content-v3',generationContractHash:H3});
  for(const request of requests) {
   const value=body(request),properties=request.schema.properties as Record<string,any>;
   expect(properties.lastPassageId.const).toBe(value.requiredLastPassageId);
   expect(properties.candidates.items.properties.passageIds.items.enum).toEqual(value.passages.map(p=>p.id));
   expect(properties.candidates.items.properties.mention.description).toContain('EXACT original');
   expect(properties.candidates.items.properties.mention.description).toContain('aerobox');
   expect(request.prompt).toBe(canonicalAnalysisV3Json(JSON.parse(request.prompt)));
  }
 });
 it('counts no correction for the terminal verifier in conservative fresh-call planning',()=>{
  const plan=analysisV3CallPlan('Synthetic saved context. '.repeat(2000),limits);
  expect(plan.protocolVersion).toBe('content-v3');
  expect(plan.summaryCallsIncludingRepairsMax).toBe(2*(plan.summaryBaseCallsMax-1)+1);
  expect(plan.keywordCallsIncludingRepairsMax).toBe(4*plan.keywordChunks);
 });
});

describe('all-proposal repair diagnostics and JSONB-stable prompts',()=>{
 it('corrects a materialized known-settled JSON null once, then runs the independent checker',async()=>{
  const requests:GenerationRequest[]=[];
  const result=await analyzeKeywordsV3(record('We tested aerobox today.'),limits,async request=>{
   requests.push(request);const value=body(request);
   if(request.key==='extractor:v3:chunk:0')return settled(null);
   return settled({...ack(value),candidates:[keyword(value)]});
  },expectedContext);
  expect(result.state).toBe('ready');expect(requests.map(r=>r.key)).toEqual(['extractor:v3:chunk:0','extractor:v3:chunk:0:repair:1','checker:v3:chunk:0']);
 });
 it('indexes all invalid candidates and constraints even after an invalid envelope and first error',async()=>{
  const content='We tested aerobox and glider today. '+('neutral synthetic context. '.repeat(22)),requests:GenerationRequest[]=[];
  let original:unknown;
  await expect(analyzeKeywordsV3(record(content),limits,async request=>{
   requests.push(request);const value=body(request),ids=value.passages.map(p=>p.id);
   original={readComplete:false,lastPassageId:'not-the-tail',unrequestedPrivateProperty:'never-echo-this-in-diagnostics',candidates:[
    {...keyword(value),mention:'occurrence-count'},
    {...keyword(value,'Glider','glider'),confidence:101,reason:'',passageIds:[ids[0],ids[2]],mention:'serialized-passage-list'},
    {...keyword(value),label:'ThirdSyntheticIdentity',kind:'person',mention:'.'},
   ]};
   return settled(structuredClone(original));
  })).rejects.toThrow();
  expect(requests).toHaveLength(2);
  const repair=JSON.parse(requests[1].prompt),errors=repair.errors as AnalysisDiagnosticV3[];
  for(const index of [0,1,2])expect(errors.some(error=>error.fieldPath.startsWith(`$.candidates[${index}]`))).toBe(true);
  expect(errors).toEqual(expect.arrayContaining([
   expect.objectContaining({fieldPath:'$.readComplete',errorCode:'analysis_incomplete_coverage'}),
   expect.objectContaining({fieldPath:'$.lastPassageId',errorCode:'analysis_incomplete_coverage'}),
   expect.objectContaining({fieldPath:'$.candidates[1].passageIds[1]',errorCode:'analysis_unsupported_passage'}),
   expect.objectContaining({fieldPath:'$.candidates[1].mention',errorCode:'analysis_unsupported_mention'}),
   expect.objectContaining({fieldPath:'$.candidates[1].confidence',errorCode:'invalid_keyword_candidate'}),
   expect.objectContaining({fieldPath:'$.candidates[1].reason',errorCode:'invalid_keyword_candidate'}),
  ]));
  const diagnosticText=JSON.stringify(errors);
  for(const secret of ['AeroBox','Glider','ThirdSyntheticIdentity','occurrence-count','serialized-passage-list','unrequestedPrivateProperty','never-echo-this'])expect(diagnosticText).not.toContain(secret);
  expect(errors.every(error=>error.constraint.length>20&&/^\$(?:\.[a-zA-Z]+|\[\d+\])*$/u.test(error.fieldPath))).toBe(true);
  expect(repair.invalidResponse).toEqual(original);
 });
 it('recreates identical multi-field repair prompts/hashes after recursive JSONB-style object reordering',async()=>{
  const source=record('We tested aerobox and glider today.'),cached=new Map<string,GenerationResult>(),first:GenerationRequest[]=[],second:GenerationRequest[]=[];
  let replay=false;
  const generate:AnalysisGenerator=async request=>{
   (replay?second:first).push(request);
   if(cached.has(request.key))return {...cached.get(request.key)!,value:replay?reorder(cached.get(request.key)!.value):cached.get(request.key)!.value};
   const value=body(request),response={...ack(value),candidates:[keyword(value),keyword(value,'Glider','glider')]};
   if(!request.correction&&request.role==='extractor') {
    response.readComplete=false;response.candidates[0].confidence=101;response.candidates[1].reason='';
    Object.assign(response,{rawOutput:{zeta:{reason:'synthetic opaque field',nested:[{z:2,a:{last:true,first:false}}]},alpha:{b:2,a:1}}});
   }
   const result=settled(response);cached.set(request.key,structuredClone(result));return result;
  };
  const before=await analyzeKeywordsV3(source,limits,generate,expectedContext),unchanged=structuredClone([...cached]);
  replay=true;const after=await analyzeKeywordsV3(source,limits,generate,expectedContext);
  expect([...cached]).toEqual(unchanged);expect(after).toEqual(before);expect(cached.size).toBe(3);
  expect(second.map(request=>contentHash(canonicalAnalysisV3Json(request)))).toEqual(first.map(request=>contentHash(canonicalAnalysisV3Json(request))));
  const repaired=JSON.parse(first[1].prompt);
  expect(repaired.invalidResponse.rawOutput.zeta.nested[0].a).toEqual({last:true,first:false});
  expect(repaired.errors.map((error:AnalysisDiagnosticV3)=>error.fieldPath)).toEqual(expect.arrayContaining(['$.candidates[0].confidence','$.candidates[1].reason']));
  expect(first.every(request=>request.prompt===canonicalAnalysisV3Json(JSON.parse(request.prompt)))).toBe(true);
 });
 it.each(['label','kind'])('a shared literal placeholder cannot authorize changing a proposal %s',async field=>{
  const source=record('We tested aerobox and glider today. Synthetic placeholder word.'),requests:GenerationRequest[]=[];
  await expect(analyzeKeywordsV3(source,limits,async request=>{
   requests.push(request);const value=body(request),proposal=keyword(value);
   if(!request.correction)return settled({...ack(value),readComplete:false,candidates:[{...proposal,mention:'placeholder'}]});
   return settled({...ack(value),candidates:[field==='label'?{...proposal,label:'Glider',mention:'placeholder'}:{...proposal,kind:'brand',mention:'placeholder'}]});
  })).rejects.toThrow('analysis_correction_dropped_proposal');
  expect(requests).toHaveLength(2);
 });
 it('never substitutes unrelated summary prose for an invalid point at the same array length',async()=>{
  await expect(analyzeSummaryV3(record('The synthetic device improved. Its battery became safer.'),limits,async request=>{
   const value=body(request);return settled({...ack(value),readComplete:!!request.correction,highlights:[{text:request.correction?'The battery became safer.':'The device improved.',passageIds:[value.passages[0].id]}]});
  },expectedContext)).rejects.toThrow('analysis_correction_dropped_proposal');
 });
 it('keeps ambiguous aliases in private review even when both blind inventories agree',async()=>{
  const result=await analyzeKeywordsV3(record('We tested aerobox today.'),limits,async request=>settled({...ack(body(request)),candidates:[keyword(body(request),'InventedCanonicalAlias','aerobox')]}));
  expect(result.state).toBe('review');expect(result.evidence.accepted).toEqual([]);expect(result.pending).toHaveLength(1);
 });
 it.each([undefined])('does not turn a nonmaterialized %s response into a new paid repair',async value=>{
  let calls=0;await expect(analyzeKeywordsV3(record('aerobox'),limits,async()=>{calls++;return settled(value);})).rejects.toThrow('analysis_correction_charge_unknown');expect(calls).toBe(1);
 });
});

describe('whole numeric values, cited quantities and terminal semantic verification',()=>{
 it('does not backtrack decimals next to units into integer prefixes',()=>{
  expect(analysisV3Numbers('0.166V; 3.3V; 90W; 0.166 voltage drop; 3.3volt; 12x24x36mm')).toEqual(['0.166','3.3','90','0.166','3.3','12','24','36']);
 });
 it.each([
  ['The measured voltage drop was 0.166 voltage drop under the synthetic load.','The measured voltage drop was 0.166V under the synthetic load.'],
  ['The synthetic rail remained at 3.3volt during the test.','The rail remained at 3.3V during the test.'],
 ])('accepts unambiguous numeric formatting only after a semantic verifier: %s',async(source,claim)=>{
  const requests:GenerationRequest[]=[],result=await analyzeSummaryV3(record(source),limits,async request=>{
   requests.push(request);const value=body(request);
   return settled(value.task==='verify_summary'?verdicts(value):{...ack(value),highlights:[{text:claim,passageIds:[value.passages[0].id]}]});
  },expectedContext);
  expect(result.state).toBe('ready');expect(result.evidence.generationContractHash).toBe(H3);
  expect(requests.map(request=>request.key)).toEqual(['summary:v3:chunk:0','summary:v3:verify:0']);
 });
 it.each([
  ['The synthetic rail remained at 0 voltage during the test.','The rail remained at 0.166V during the test.','analysis_unsupported_summary_number'],
  ['The synthetic response lasted 3.3ms in the test.','The response measured 3.3mV in the test.','analysis_unsupported_summary_unit'],
  ['The synthetic sensor recorded 3.3map during the test.','The sensor recorded 3.3MP during the test.','analysis_unsupported_summary_unit'],
  ['The synthetic rail measured 20 volts under load.','The rail reached 20°C under load.','analysis_unsupported_summary_unit'],
  ['The synthetic rail measured 20 volts under load.','The rail reached 20 degrees Celsius under load.','analysis_unsupported_summary_unit'],
  ['The synthetic trace recorded 20 events during the test.','The trace reached 20 kelvins during the test.','analysis_unsupported_summary_unit'],
  ['The synthetic case cost 20 dollars in the test.','The case measured 20mm in the test.','analysis_unsupported_summary_unit'],
  ['The synthetic trace reported 20°Certain in the test.','The trace measured 20°C in the test.','analysis_unsupported_summary_unit'],
 ])('never lets formatting equivalence invent a measurement: %s',async(source,claim,error)=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV3(record(source),limits,async request=>{
   requests.push(request);const value=body(request);return settled({...ack(value),highlights:[{text:claim,passageIds:[value.passages[0].id]}]});
  },expectedContext)).rejects.toThrow(error);
  expect(requests).toHaveLength(2);expect(requests.some(request=>request.key.includes('verify'))).toBe(false);
 });
 it('indexes every invalid summary point and refuses source-wide support from uncited numbers',async()=>{
  const content='The device reached 95°C. '+('Neutral synthetic background. '.repeat(18))+'The case became warm and remained compact.',requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV3(record(content),{...limits,chunkChars:2400},async request=>{
   requests.push(request);const value=body(request),ids=value.passages.map(p=>p.id);
   return settled({...ack(value),highlights:[
    {text:'The case reached 95°C in the test.',passageIds:[ids.at(-1)!]},
    {text:'The case became warm and remained compact.',passageIds:[ids[0],ids[2]]},
    {text:'The case was 720mm wide.',passageIds:[ids.at(-1)!]},
   ]});
  },expectedContext)).rejects.toThrow('analysis_unsupported_summary_number');
  const errors=JSON.parse(requests[1].prompt).errors as AnalysisDiagnosticV3[];
  for(const index of [0,1,2])expect(errors.some(error=>error.fieldPath.startsWith(`$.highlights[${index}]`))).toBe(true);
  expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({fieldPath:'$.highlights[1].passageIds[1]',errorCode:'analysis_unsupported_passage'})]));
 });
 it.each(['negative-malformed','opaque-negative','missing','refusal'] as const)('keeps %s verifier response terminal with no repair',async mode=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV3(record('The synthetic rail remained stable during the test.'),limits,async request=>{
   requests.push(request);const value=body(request);
   if(value.task!=='verify_summary')return settled({...ack(value),highlights:[{text:'The rail remained stable during the test.',passageIds:[value.passages[0].id]}]});
   if(mode==='negative-malformed')return {...settled({verdicts:[{supported:false}],unexpected:'bad shape'}),validationError:'analysis_output_capacity'};
   if(mode==='opaque-negative')return {...settled({rawOutput:'{"verdicts":[{"supported":false'}),validationError:'analysis_invalid_json'};
   if(mode==='refusal')return {...settled({rawOutput:'Synthetic refusal'}),validationError:'analysis_provider_refusal'};
   return settled({readComplete:true,verdicts:[]});
  },expectedContext)).rejects.toThrow();
  expect(requests.map(request=>request.key)).toEqual(['summary:v3:chunk:0','summary:v3:verify:0']);
 });
});

describe('trusted full-saved-source empty disposition',()=>{
 const emptyGenerator:AnalysisGenerator=async request=>settled({...ack(body(request)),highlights:[]});
 it.each([undefined,'unreviewed'] as const)('withholds %s empty summaries for independent review',async emptyDisposition=>{
  await expect(analyzeSummaryV3(record('This synthetic source contains substantive findings.'),limits,emptyGenerator,{emptyDisposition})).rejects.toThrow('analysis_empty_summary_requires_review');
 });
 it('rejects an expected-finding empty as an omission even with perfect coverage and acknowledgment',async()=>{
  const requests:GenerationRequest[]=[];
  await expect(analyzeSummaryV3(record('This synthetic source contains substantive findings.'),limits,async request=>{requests.push(request);return emptyGenerator(request);},expectedContext)).rejects.toThrow('analysis_summary_omission');
  expect(requests).toHaveLength(1);expect(requests[0].key).toBe('summary:v3:chunk:0');
 });
 it('permits trusted reviewed empties only with explicit full-saved-source disposition and complete tail coverage',async()=>{
  const source=record('Synthetic promotional-only copy. '.repeat(100)+'Z'),requests:GenerationRequest[]=[],context={...expectedContext,emptyDisposition:'no_findings_reviewed' as const};
  const result=await analyzeSummaryV3(source,limits,async request=>{requests.push(request);return emptyGenerator(request);},context);
  expect(result.state).toBe('empty');expect(result.evidence).toMatchObject({protocolVersion:'content-v3',generationContractHash:H3,emptyDisposition:'no_findings_reviewed',emptyReview:{basis:'trusted_full_saved_source',contentHash:contentHash(source.content!),sourceReviewDigest:'synthetic-review'}});
  expect((result.evidence.coverage as Array<{end:number}>).at(-1)!.end).toBe(source.content!.length);
  expect(body(requests.at(-1)!).passages.at(-1)!.text.endsWith('Z')).toBe(true);expect(requests).toHaveLength(planAnalysisV3Chunks(source.content!,limits,'summary').length);
  expect(result.evidence.verification).toEqual([]);
 });
 it('never lets reviewed-empty permission erase nonempty findings during reduction',async()=>{
  const source='Synthetic device finding. '+('background only. '.repeat(200));
  await expect(analyzeSummaryV3(record(source),limits,async request=>{
   const value=body(request);return settled({...ack(value),highlights:value.task==='reduce_findings'?[]:[{text:'The synthetic device had a finding.',passageIds:[value.passages[0].id]}]});
  },{...expectedContext,emptyDisposition:'no_findings_reviewed'})).rejects.toThrow('analysis_incomplete_summary_reduction');
 });
 it('retains exact literals and boundaries without rewriting saved source text',()=>{
  const source='AeroBoxX is distinct from aerobox. C++ differs from C#.';
  expect(analysisPassagesV3(source).map(p=>p.text).join('')).toBe(source);
  expect(literalMentionOffsetsV3(source,'AeroBox')).toEqual([]);expect(literalMentionOffsetsV3(source,'C')).toEqual([]);
 });
});
