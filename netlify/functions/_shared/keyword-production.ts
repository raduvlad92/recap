import type { SourceUpdate } from '../../../src/lib/types';
import { contentHash, sourceContentState, usableAnalysisContent } from '../../../src/lib/content-processing';
import frozen from '../../../docs/tech/keyword-autonomous-prompts-2026-10-27.json';
// @ts-expect-error The measured prompts remain shared with the private evaluator.
import { keywordExtractionRequest, keywordCheckerRequest, keywordCheckerValueForNormalization, KEYWORD_LEARNING_KINDS } from '../../../scripts/lib/keyword-learning-prompts.mjs';
// @ts-expect-error Reuse the measured literal-evidence and boundary rules unchanged.
import { validateLiteralInventory, minePatternNames, combineKeywordInventories, resolveKeywordCheckerVerdicts, applyKeywordBoundaryGuards } from '../../../scripts/lib/keyword-learning.mjs';
// @ts-expect-error Match the existing publication/review key without guessing a display spelling.
import { canonicalKeywordKey } from '../../../scripts/lib/keyword-analysis.mjs';
import { analysisFailure, type GenerationRequest, type GenerationResult } from './content-analysis-model';
import type { AnalysisOutput } from './content-analysis-engine';
import { createKeywordProductionOccurrenceFinder } from './keyword-production-occurrences';

export const KEYWORD_PRODUCTION_VERSION = 'named-mentions-v1';
/** Frozen provider-request namespace from the first production release.
 * Host-only publication fixes can replay exact settled requests without
 * inventing a new charge or changing the original paid payload. */
export const KEYWORD_PRODUCTION_GENERATION_HASH = 'e7ae78feabd396e9e774799697afd84c5795bc36667ab1208c20acd69c306323';
export const KEYWORD_PRODUCTION_LITERAL_CORE_SHA256 = 'bffe9e3d80e1e9d1b872b4fca3bf6a024a7780f410f6eef10587c79c811b1fe3';
export const KEYWORD_PRODUCTION_EXTRACTOR_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
export const KEYWORD_PRODUCTION_CHECKER_MODEL = 'openai/gpt-6.1-sol-pro';
export const KEYWORD_PRODUCTION_CHUNK_CHARS = 12_000;
export const KEYWORD_PRODUCTION_LONG_CHUNK_BYTES = 12_000;
export const KEYWORD_PRODUCTION_OVERLAP_CHARS = 200;
export const KEYWORD_PRODUCTION_MAX_SOURCE_CHARS = 1_000_000;
export const KEYWORD_PRODUCTION_MAX_NAMES = 500;
const MAX_PROMPT_CHARS = 100_000;
const COMPACT_CHECKER_AFTER_NAMES = 100;
const COMPACT_CHECKER_AFTER_NAME_BYTES = 2200;
const CHECKER_DISPOSITIONS = ['accepted','review','rejected'] as const;
const ALIAS_BOUNDARY_LESSON='For ambiguous identity boundaries, distinguish an explicitly attributed parent brand from an invented personal alias. Retain a parent brand in a possessive product or game title. Keep a complete personal name; an unquoted internal phrase is not automatically a separately established nickname or handle, so use review for that proposed alias unless this source explicitly presents it as an alias. When the source names a document/file collection using a surname without identifying a separate person, retain the full named collection; a separately inferred person belongs in review. Do not expand names or identify people from outside knowledge.';
const PARENT_ATTRIBUTION_LESSON='A named parent brand counts even when it occurs only inside a complete product, model or game title. It does not need an independent sentence or standalone occurrence. Retain both the actual parent name and the complete named product/family/version. A source-present character or franchise name can likewise remain distinct from its explicitly named installment or add-on.';
const UNCLEAR_SOURCE_LESSON='Accept an unfamiliar literal name when this source clearly presents it as a named identity or institution. Distinguish genuinely unclear boundaries from unfamiliar spelling: an unbranded merchandise class or ambiguous printed version punctuation belongs in review unless the text itself settles its naming role. Do not call generic nouns or fragments proper names merely because they occur in an ad. A clearly introduced joke name or pseudo-domain may remain a literal named_mention without claiming a working domain. Do not guess corrected names or versions.';
export type KeywordProductionCheckerPolicy='standard'|'alias-boundaries-v1';

/** A production version pins both measured prompts and its explicit long-source
 * adaptation. The seven-case proof used one complete-source chunk; chunked
 * sources are a separately measured extension, never claimed as that proof. */
export const KEYWORD_PRODUCTION_CONTRACT_HASH = contentHash(JSON.stringify({
 version: KEYWORD_PRODUCTION_VERSION,
 promptModuleSha256: frozen.promptModuleSha256,
 evaluatedCoreModuleSha256: frozen.coreModuleSha256,
 coreModuleSha256: KEYWORD_PRODUCTION_LITERAL_CORE_SHA256,
 extractorModel: KEYWORD_PRODUCTION_EXTRACTOR_MODEL,
 checkerModel: KEYWORD_PRODUCTION_CHECKER_MODEL,
 extractorLessons: frozen.extractorLessons,
 admittedSectionSweep:'unique-in-range-chunk-indices-second-extractor-sections-v1',
 checkerLessons: frozen.checkerLessons,
 patternMining: 'focused', checkerReasons: false, checkerMaxOutputTokens: 2000,
 checkerTransport:{version:'explicit-candidate-kind-disposition-integer-tuples-v2',afterCandidateCount:COMPACT_CHECKER_AFTER_NAMES,
  afterCandidateUtf8Bytes:COMPACT_CHECKER_AFTER_NAME_BYTES,kindIds:KEYWORD_LEARNING_KINDS,dispositionIds:CHECKER_DISPOSITIONS},
 chunkChars: KEYWORD_PRODUCTION_CHUNK_CHARS, overlapChars: KEYWORD_PRODUCTION_OVERLAP_CHARS,
 longSourceChunkUtf8Bytes:KEYWORD_PRODUCTION_LONG_CHUNK_BYTES,
 maximumNames: KEYWORD_PRODUCTION_MAX_NAMES,
 merge: 'source-present-legacy-key-aliases-conflicts-review-v3', boundaryGuards: true,
 parentBrandGuard:'preserve-checker-accepted-literal-name-prefix-is-not-rejection-v3',
 checkerPolicies:{standard:'frozen-six-lessons',aliasBoundaries:[ALIAS_BOUNDARY_LESSON,PARENT_ATTRIBUTION_LESSON,UNCLEAR_SOURCE_LESSON]},
 hostSourceWhitespaceAlignment:'linebreak-runs-with-original-utf16-offsets-v1',
 publicationEvidence:'literal-first-span-all-ranges-and-durable-call-lineage-v1',
 timing:'cached-complete-or-unique-cue-alignment-v1',
 auditedTiming:'source-bound-polysemy-withheld-with-exact-named-context-v1',
}));

type Disposition = 'accepted' | 'review' | 'rejected';
type LegacyKind = 'brand' | 'product' | 'game' | 'technology' | 'category';
export type KeywordProductionStep = 'direct' | 'type_sweep' | 'checker';
export interface KeywordProductionChunk { index:number; start:number; end:number; content:string; sourceHash:string; chunkHash:string }
export interface KeywordProductionCall { chunkIndex:number; step:KeywordProductionStep; model:string; request:GenerationRequest }
export interface KeywordProductionOccurrence { start:number; end:number; quote:string; ranges:Array<{startSeconds:number;endSeconds:number}> }
export interface KeywordProductionDecision {
 name:string; kind:string|null; disposition:Disposition; reason:string;
 originalVerdicts?:unknown[]; hostReviewReason?:string; [key:string]:unknown;
}
export interface KeywordProductionChunkResult {
 chunk:KeywordProductionChunk; candidates:string[]; rows:KeywordProductionDecision[];
 rawRows:KeywordProductionDecision[]; boundaryChanges:unknown[];
 duplicateVerdicts:number; conflicts:unknown[];
 checkerEncoding:'named_rows'|'numeric_tuples';
 secondExtractorMethod:'type_sweep'|'sections';
}
interface Inventory { names:string[]; uncertainNames:string[] }
type ChunkInventories = { direct:unknown; type_sweep:unknown };

const record = (value:unknown):value is Record<string,unknown> => value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys = (value:Record<string,unknown>, keys:string[]) => Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const chunkPlanCache=new WeakMap<SourceUpdate,{content:string;chunks:KeywordProductionChunk[]}>();
const inventoryCache=new WeakMap<KeywordProductionChunk,{signature:string;rows:Array<{name:string}>}>();

/** Prompt source remains byte-for-byte unchanged. Only the host's literal
 * matcher renders a whitespace run containing a line break as one space,
 * retaining an exact map back to original UTF-16 positions and quotations. */
function renderSource(content:string):{text:string;starts:number[];ends:number[]} {
 let text='';const starts:number[]=[],ends:number[]=[];
 for(let index=0;index<content.length;){
  const run=/[\t \r\n]/u.test(content[index])?/^[\t \r\n]+/u.exec(content.slice(index))?.[0]:undefined;
  if(run&&/[\r\n]/u.test(run)){
   text+=' ';starts.push(index);ends.push(index+run.length);index+=run.length;
  }else{text+=content[index];starts.push(index);ends.push(index+1);index++;}
 }
 return {text,starts,ends};
}

function sourceOccurrences(update:SourceUpdate,name:string,rendered=renderSource(source(update)),find=createKeywordProductionOccurrenceFinder(rendered.text,update.transcriptSegments??[])):KeywordProductionOccurrence[] {
 const original=source(update);
 const found=find(name);
 return found.map(occurrence=>{const start=rendered.starts[occurrence.start],end=rendered.ends[occurrence.end-1];
  return {...occurrence,start,end,quote:original.slice(start,end)};});
}

function source(update:SourceUpdate):string {
 if(!usableAnalysisContent(update))return analysisFailure('usable_keyword_content_required');
 if(update.content!.length>KEYWORD_PRODUCTION_MAX_SOURCE_CHARS)return analysisFailure('analysis_source_capacity');
 return update.content!;
}

/** Cover every UTF-16 source position. Overlap is longer than any supported
 * 100-character literal name, and boundaries never split a surrogate pair.
 * No title, description, synthetic text, guessed timing or dropped tail. */
export function planKeywordProductionChunks(update:SourceUpdate):KeywordProductionChunk[] {
 const content=source(update),cached=chunkPlanCache.get(update);
 if(cached?.content===content)return cached.chunks.map(chunk=>({...chunk}));
 const sourceHash=contentHash(content), chunks:KeywordProductionChunk[]=[];
 for(let start=0;start<content.length;){
  let end=Math.min(content.length,start+KEYWORD_PRODUCTION_CHUNK_CHARS);
  if(content.length>KEYWORD_PRODUCTION_CHUNK_CHARS&&new TextEncoder().encode(content.slice(start,end)).length>KEYWORD_PRODUCTION_LONG_CHUNK_BYTES){
   let low=1,high=end-start;
   while(low<high){const middle=Math.ceil((low+high)/2);if(new TextEncoder().encode(content.slice(start,start+middle)).length<=KEYWORD_PRODUCTION_LONG_CHUNK_BYTES)low=middle;else high=middle-1;}
   end=start+low;
  }
  if(end<content.length&&/[\uD800-\uDBFF]/u.test(content[end-1]))end--;
  chunks.push({index:chunks.length,start,end,content:content.slice(start,end),sourceHash,chunkHash:contentHash(content.slice(start,end))});
  if(end===content.length)break;
  start=end-KEYWORD_PRODUCTION_OVERLAP_CHARS;
  if(/[\uDC00-\uDFFF]/u.test(content[start]))start--;
 }
 chunkPlanCache.set(update,{content,chunks:chunks.map(chunk=>({...chunk}))});
 return chunks;
}

function checkedChunk(update:SourceUpdate, chunk:KeywordProductionChunk):KeywordProductionChunk {
 const expected=planKeywordProductionChunks(update)[chunk.index];
 if(!expected||JSON.stringify(expected)!==JSON.stringify(chunk))return analysisFailure('keyword_production_source_changed');
 return expected;
}

function requestCapacity(request:GenerationRequest):GenerationRequest {
 if(request.prompt.length>MAX_PROMPT_CHARS)return analysisFailure('analysis_input_limit');
 return request;
}

/** This policy is private source admission data. It never changes the first
 * extractor or the stable typed receipt role used by the publication ledger. */
export function validateKeywordProductionSectionSweepChunks(update:SourceUpdate,value:unknown):number[] {
 if(value===undefined)return [];
 const count=planKeywordProductionChunks(update).length;
 if(!Array.isArray(value)||value.length>count||new Set(value).size!==value.length
  ||[...value].some(index=>!Number.isSafeInteger(index)||index<0||index>=count))return analysisFailure('keyword_production_section_sweep_invalid');
 return [...value] as number[];
}

function secondExtractionMethod(update:SourceUpdate,chunk:KeywordProductionChunk,sectionSweepChunks:unknown):'type_sweep'|'sections' {
 return validateKeywordProductionSectionSweepChunks(update,sectionSweepChunks).includes(chunk.index)?'sections':'type_sweep';
}

export function keywordProductionExtractionCalls(update:SourceUpdate,chunk:KeywordProductionChunk,sectionSweepChunks?:unknown):KeywordProductionCall[] {
 checkedChunk(update,chunk);
 const second=secondExtractionMethod(update,chunk,sectionSweepChunks);
 return (['direct','type_sweep'] as const).map(step=>({chunkIndex:chunk.index,step,model:KEYWORD_PRODUCTION_EXTRACTOR_MODEL,
  request:requestCapacity(keywordExtractionRequest({method:step==='direct'?step:second,content:chunk.content,lessons:frozen.extractorLessons}))}));
}

function combinedInventory(chunk:KeywordProductionChunk,values:ChunkInventories,second:'type_sweep'|'sections'='type_sweep'):Array<{name:string}> {
 const signature=JSON.stringify({values,second}),cached=inventoryCache.get(chunk);
 if(cached?.signature===signature)return cached.rows;
 const direct=validateLiteralInventory(values.direct) as Inventory, typed=validateLiteralInventory(values.type_sweep) as Inventory;
 const rows=combineKeywordInventories(renderSource(chunk.content).text,[{method:'direct',output:direct},{method:second,output:typed},
  {method:'patterns',output:minePatternNames(chunk.content,{precision:'focused'})}]) as Array<{name:string}>;
 inventoryCache.set(chunk,{signature,rows});return rows;
}

export function keywordProductionCheckerCall(update:SourceUpdate,chunk:KeywordProductionChunk,values:ChunkInventories,policy:KeywordProductionCheckerPolicy='standard',sectionSweepChunks?:unknown):KeywordProductionCall {
 checkedChunk(update,chunk);
 if(!['standard','alias-boundaries-v1'].includes(policy))return analysisFailure('keyword_production_checker_policy_invalid');
 const names=combinedInventory(chunk,values,secondExtractionMethod(update,chunk,sectionSweepChunks)).map(row=>row.name);
 const lessons=policy==='standard'?frozen.checkerLessons:[...frozen.checkerLessons,ALIAS_BOUNDARY_LESSON,PARENT_ATTRIBUTION_LESSON,UNCLEAR_SOURCE_LESSON];
 const request=keywordCheckerRequest({content:chunk.content,names,lessons,maxOutputTokens:2000,includeReasons:false}) as GenerationRequest;
 return {chunkIndex:chunk.index,step:'checker',model:KEYWORD_PRODUCTION_CHECKER_MODEL,
  request:requestCapacity(compactChecker(names)?compactCheckerRequest(request,names):request)};
}

function compactChecker(names:string[]):boolean {
 const encoder=new TextEncoder(),bytes=names.reduce((sum,name)=>sum+encoder.encode(name).length,0);
 return names.length>COMPACT_CHECKER_AFTER_NAMES||bytes>COMPACT_CHECKER_AFTER_NAME_BYTES;
}

/** Large unions retain every candidate and the same semantic instructions.
 * Only the returned representation changes: the host restores literal names
 * from immutable input indices instead of asking the model to repeat them. */
function compactCheckerRequest(request:GenerationRequest,names:string[]):GenerationRequest {
 const oldRows='Return exactly ONE decisions row per supplied candidate, using that identical name. The decisions array must match the exact candidate count required by the response schema.';
 const oldFields='Return only name, disposition and kind in every decision and missing-name row. Do not include reason or any explanation fields.';
 const marker='\nUNTRUSTED TRANSCRIPT AND CANDIDATES\n',at=request.prompt.lastIndexOf(marker);
 if(at<0||!request.prompt.slice(0,at).includes(oldRows)||!request.prompt.slice(0,at).includes(oldFields))return analysisFailure('keyword_production_checker_contract_changed');
 const instructions=request.prompt.slice(0,at)
  .replace(oldRows,'Return exactly ONE verdict tuple per supplied candidate. Use the explicit candidateIndex attached to each input candidate; never infer or count its position. The verdicts array must cover every candidateIndex exactly once; never omit, repeat, rename or collapse candidates.')
  .replace(oldFields,'For each supplied candidate, return only [candidateIndex,kindIndex,dispositionIndex] in verdicts. All three tuple values are integers, in that order. Use the fixed KIND_IDS and DISPOSITION_IDS tables below. Candidate indices identify the suggestion array, never transcript word positions or offsets. Do not repeat candidate names in verdicts: the host restores their identical literal spelling from candidateIndex. In missingNames, return literal name, disposition and kind as strings. Do not include reasons or explanation fields. Literal-name copying instructions apply to missingNames; supplied candidates keep their original names through the indices.');
 const base=request.schema as {properties:{readComplete:unknown;missingNames:unknown}};
 const schema={type:'object',additionalProperties:false,required:['readComplete','verdicts','missingNames'],properties:{
  readComplete:base.properties.readComplete,
  verdicts:{type:'array',minItems:names.length,maxItems:names.length,items:{type:'array',minItems:3,maxItems:3,
   items:{type:'integer',minimum:0,maximum:Math.max(names.length-1,KEYWORD_LEARNING_KINDS.length-1,CHECKER_DISPOSITIONS.length-1)}}},
  missingNames:base.properties.missingNames,
 }};
 const tables='\nFIXED TRANSPORT TABLES (explicit numeric IDs; these are instructions, not source claims)\nKIND_IDS='+JSON.stringify(Object.fromEntries(KEYWORD_LEARNING_KINDS.map((kind:string,id:number)=>[id,kind])))+'\nDISPOSITION_IDS='+JSON.stringify(Object.fromEntries(CHECKER_DISPOSITIONS.map((disposition,id)=>[id,disposition])));
 const input=JSON.parse(request.prompt.slice(at+marker.length)) as {content:string;candidates:string[]};
 return {...request,schema,prompt:instructions+tables+marker+JSON.stringify({content:input.content,candidates:names.map((name,candidateIndex)=>({candidateIndex,name}))})};
}

/** Reject incomplete, duplicate or out-of-range tuples before source checks.
 * The provider's original tuple JSON remains in the durable paid receipt. */
function decodedChecker(value:unknown,names:string[]):unknown {
 if(!compactChecker(names))return value;
 if(!record(value)||!exactKeys(value,['readComplete','verdicts','missingNames'])||value.readComplete!==true
  ||!Array.isArray(value.verdicts)||value.verdicts.length!==names.length||!Array.isArray(value.missingNames))return analysisFailure('checker_incomplete');
 const seen=new Set<number>(),decisions:Record<string,unknown>[]=[];
 for(const tuple of value.verdicts){
  if(!Array.isArray(tuple)||tuple.length!==3||!tuple.every(Number.isSafeInteger))return analysisFailure('checker_invalid_decision');
  const [candidateIndex,kindIndex,dispositionIndex]=tuple as number[];
  if(candidateIndex<0||candidateIndex>=names.length||kindIndex<0||kindIndex>=KEYWORD_LEARNING_KINDS.length||dispositionIndex<0||dispositionIndex>=CHECKER_DISPOSITIONS.length)return analysisFailure('checker_invalid_decision');
  if(seen.has(candidateIndex))return analysisFailure('checker_candidate_decisions_incomplete');
  seen.add(candidateIndex);decisions.push({name:names[candidateIndex],kind:KEYWORD_LEARNING_KINDS[kindIndex],disposition:CHECKER_DISPOSITIONS[dispositionIndex]});
 }
 return {readComplete:true,decisions,missingNames:value.missingNames};
}

/** Enforce the compact response schema again before interpreting persisted
 * provider JSON. An exactly-sized array alone does not prove every name was
 * checked: names must also be a one-to-one match with the supplied union. */
function validateChecker(value:unknown,names:string[]):void {
 if(!record(value)||!exactKeys(value,['readComplete','decisions','missingNames'])||value.readComplete!==true
  ||!Array.isArray(value.decisions)||value.decisions.length!==names.length||!Array.isArray(value.missingNames)
  ||value.missingNames.length>KEYWORD_PRODUCTION_MAX_NAMES)return analysisFailure('checker_incomplete');
 const supplied=new Set(names), seen=new Set<string>();
 for(const [section,rows] of [['decisions',value.decisions],['missingNames',value.missingNames]] as const)for(const raw of rows){
  if(!record(raw)||!exactKeys(raw,['name','kind','disposition'])||typeof raw.name!=='string'
   ||typeof raw.kind!=='string'||!(KEYWORD_LEARNING_KINDS as string[]).includes(raw.kind)
   ||!['accepted','review','rejected'].includes(raw.disposition as string))return analysisFailure('checker_invalid_decision');
  if(section==='decisions'){
   if(!supplied.has(raw.name)||seen.has(raw.name))return analysisFailure('checker_candidate_decisions_incomplete');
   seen.add(raw.name);
  }
 }
}

export function finalizeKeywordProductionChunk(update:SourceUpdate,chunk:KeywordProductionChunk,values:ChunkInventories&{checker:unknown},policy:KeywordProductionCheckerPolicy='standard',sectionSweepChunks?:unknown):KeywordProductionChunkResult {
 checkedChunk(update,chunk);
 if(!['standard','alias-boundaries-v1'].includes(policy))return analysisFailure('keyword_production_checker_policy_invalid');
 const secondExtractorMethod=secondExtractionMethod(update,chunk,sectionSweepChunks),candidates=combinedInventory(chunk,values,secondExtractorMethod).map(row=>row.name);
 const checker=decodedChecker(values.checker,candidates);
 validateChecker(checker,candidates);
 const rendered=renderSource(chunk.content).text;
 const normalized=resolveKeywordCheckerVerdicts({content:rendered,names:candidates,
  value:keywordCheckerValueForNormalization(checker,{includeReasons:false})}) as {rows:KeywordProductionDecision[];duplicateVerdicts:number;conflicts:unknown[]};
 const boundary=applyKeywordBoundaryGuards({content:rendered,rows:normalized.rows}) as {rows:KeywordProductionDecision[];changes:unknown[]};
 const originals=new Map(normalized.rows.map(row=>[row.name,row])),restoredParents=new Set<string>();
 for(const row of boundary.rows){
  const original=originals.get(row.name),guard=row.hostBoundaryGuard;
  if(original?.disposition==='accepted'&&row.disposition==='rejected'
   &&record(guard)&&guard.code==='only_prefix_of_longer_accepted_name'){
   row.disposition='accepted';row.hostBoundaryGuard={...guard,overriddenBy:'source_supported_checker_accepted_name'};restoredParents.add(row.name);
  }
 }
 const boundaryChanges=boundary.changes.map(change=>record(change)&&restoredParents.has(String(change.name))&&change.code==='only_prefix_of_longer_accepted_name'
  ?{...change,guardTo:change.to,to:'accepted',overriddenBy:'source_supported_checker_accepted_name'}:change);
 return {chunk,candidates,rawRows:normalized.rows,rows:boundary.rows,boundaryChanges,secondExtractorMethod,
  duplicateVerdicts:normalized.duplicateVerdicts,conflicts:normalized.conflicts,checkerEncoding:compactChecker(candidates)?'numeric_tuples':'named_rows'};
}

function legacyKind(kind:string|null):LegacyKind {
 if(kind==='brand'||kind==='game')return kind;
 if(['product','product_family','product_variant','chip_model'].includes(kind??''))return 'product';
 if(['technology','technology_version','software','software_version','service','standard','certification','architecture','feature'].includes(kind??''))return 'technology';
 return 'category';
}

function mergedRanges(occurrences:KeywordProductionOccurrence[]):Array<{startSeconds:number;endSeconds:number}> {
 const ranges=occurrences.flatMap(occurrence=>occurrence.ranges).sort((a,b)=>a.startSeconds-b.startSeconds),merged:Array<{startSeconds:number;endSeconds:number}>=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&range.startSeconds<=last.endSeconds)last.endSeconds=Math.max(last.endSeconds,range.endSeconds);else merged.push({...range});}
 return merged;
}

/** Preserve literal forms while reconciling the existing reader's identity
 * keys. Conflicting status/type requires review. Source-absent normalization
 * remains in unmatchedReview and never enters accepted reader fields. */
export function mergeKeywordProductionChunks(update:SourceUpdate,results:KeywordProductionChunkResult[]):AnalysisOutput {
 const content=source(update),rendered=renderSource(content),find=createKeywordProductionOccurrenceFinder(rendered.text,update.transcriptSegments??[]),chunks=planKeywordProductionChunks(update),byName=new Map<string,Array<{chunkIndex:number;row:KeywordProductionDecision}>>();
 if(results.length!==chunks.length||results.some((result,index)=>result.chunk.index!==index||JSON.stringify(result.chunk)!==JSON.stringify(chunks[index])))return analysisFailure('incomplete_keyword_coverage');
 for(const result of results)for(const row of result.rows){const rows=byName.get(row.name)??[];rows.push({chunkIndex:result.chunk.index,row});byName.set(row.name,rows);}
 const byKey=new Map<string,Array<{label:string;originalRows:Array<{chunkIndex:number;row:KeywordProductionDecision}>}>>();
 for(const [label,originalRows] of byName){const key=canonicalKeywordKey(label) as string,aliases=byKey.get(key)??[];aliases.push({label,originalRows});byKey.set(key,aliases);}
 const accepted:Record<string,unknown>[]=[],pending:Record<string,unknown>[]=[],rejected:Record<string,unknown>[]=[],unmatchedReview:Record<string,unknown>[]=[],crossChunkConflicts:unknown[]=[];
 for(const [key,aliases] of byKey){
  const judgments=aliases.flatMap(alias=>alias.originalRows);
  // Rejected suggestions never need whole-source timing. Their exact raw
  // judgments remain in the call receipts; avoid repeatedly aligning every
  // caption cue for ordinary words that the checker already discarded.
  if(judgments.every(value=>value.row.disposition==='rejected')){
   const kinds=[...new Set(judgments.map(value=>value.row.kind))];
   rejected.push({label:aliases[0].label,literalKind:kinds.length===1?kinds[0]:null,disposition:'rejected'});continue;
  }
  const literalForms=aliases.map(alias=>({...alias,occurrences:sourceOccurrences(update,alias.label,rendered,find)}));
  // A rejected spelling that never occurs in the source cannot dispute a
  // different, source-present spelling. Retain the rejected suggestion in
  // private evidence, and reconcile only actual literal forms.
  for(const form of literalForms.filter(form=>!form.occurrences.length)){
   const rows=form.originalRows.map(value=>value.row),kinds=[...new Set(rows.map(row=>row.kind))],literalKind=kinds.length===1?kinds[0]:null;
   if(rows.every(row=>row.disposition==='rejected'))rejected.push({label:form.label,literalKind,disposition:'rejected'});
   else unmatchedReview.push({label:form.label,literalKind,disposition:'review',reason:'literal_name_not_in_source'});
  }
  const supportedForms=literalForms.filter(form=>form.occurrences.length);
  if(!supportedForms.length)continue;
  supportedForms.sort((a,b)=>a.occurrences[0].start-b.occurrences[0].start);
  const label=supportedForms[0].label,originalRows=supportedForms.flatMap(alias=>alias.originalRows);
  const kinds=[...new Set(originalRows.map(value=>value.row.kind))],dispositions=[...new Set(originalRows.map(value=>value.row.disposition))];
  const conflict=kinds.length!==1||dispositions.length!==1, literalKind=kinds.length===1?kinds[0]:null;
  let disposition:Disposition=conflict?'review':dispositions[0];
  if(conflict)crossChunkConflicts.push({name:label,kinds,dispositions,chunkIndices:originalRows.map(value=>value.chunkIndex)});
  const occurrences=supportedForms.flatMap(alias=>alias.occurrences).sort((a,b)=>a.start-b.start);
  if(disposition==='rejected'){rejected.push({label,literalKind,disposition});continue;}
  if(!occurrences.length){unmatchedReview.push({label,literalKind,disposition:'review',reason:'literal_name_not_in_source',originalRows,literalForms});continue;}
  // A label found elsewhere in the full source cannot repair absent local
  // support in the chunk that proposed it. The raw verdict stays auditable.
  if(originalRows.some(value=>value.row.hostReviewReason==='literal_name_not_in_source'))disposition='review';
  const ranges=mergedRanges(occurrences), first=occurrences[0];
  const row={label,kind:legacyKind(literalKind),literalKind,disposition,key,
   literalForms:supportedForms.map(form=>({label:form.label,occurrenceCount:form.occurrences.length,
    ...(form.occurrences[0]?{start:form.occurrences[0].start,end:form.occurrences[0].end,evidenceQuote:form.occurrences[0].quote}:{})})),
   // The legacy publication contract requires an integer confidence. This
   // is only a disposition compatibility marker, not requested AI confidence
   // or a calibrated probability. Raw typed verdicts remain private below.
   confidence:disposition==='accepted'?50:0,confidenceOrigin:'legacy_acceptance_marker_not_model_score',
   reason:conflict?'Chunk judgments disagree; requires private review.':disposition==='accepted'?'Literal named mention accepted by the frozen checker.':'Literal naming role or boundary requires private review.',
   evidenceQuote:first.quote,mention:first.quote,start:first.start,end:first.end,occurrenceCount:occurrences.length,ranges,
   ...(ranges.length?{seconds:ranges.reduce((sum,range)=>sum+range.endSeconds-range.startSeconds,0)}:{}),
   chunkVerdicts:originalRows.map(({chunkIndex,row})=>({chunkIndex,kind:row.kind,disposition:row.disposition,...(row.hostReviewReason?{hostReviewReason:row.hostReviewReason}:{})}))};
  (disposition==='accepted'?accepted:pending).push(row);
 }
 if(accepted.length+pending.length>KEYWORD_PRODUCTION_MAX_NAMES)return analysisFailure('keyword_capacity_requires_review');
 if(!accepted.length&&!pending.length)return analysisFailure('empty_keyword_inventory_requires_manual_review');
 accepted.sort((a,b)=>(typeof b.seconds==='number'?b.seconds:-1)-(typeof a.seconds==='number'?a.seconds:-1));
 const result:AnalysisOutput={state:pending.length?'review':'ready',patch:{keywordRuleVersion:'entities-v2'},pending,
  evidence:{ruleVersion:'entities-v2',protocolVersion:KEYWORD_PRODUCTION_VERSION,generationContractHash:KEYWORD_PRODUCTION_CONTRACT_HASH,
   contentHash:contentHash(content),sourceContentState:sourceContentState(update),accepted,
   unmatchedReview:unmatchedReview.map(({label,literalKind,disposition,reason})=>({label,literalKind,disposition,reason})),
   rejected:rejected.map(({label,literalKind,disposition})=>({label,literalKind,disposition})),
   coverage:chunks.map(({start,end})=>({start,end})),chunkCount:chunks.length,crossChunkConflicts,
   extractionMethods:['direct',...new Set(results.map(result=>result.secondExtractorMethod)),'focused_patterns'],extractorModel:KEYWORD_PRODUCTION_EXTRACTOR_MODEL,checkerModel:KEYWORD_PRODUCTION_CHECKER_MODEL,
   checkerReasons:false,confidenceOrigin:'legacy_acceptance_marker_not_model_score',
   rawGenerationEvidence:'Exact request payloads and provider responses remain in the bound durable call receipts; this publication proof avoids duplicating them.',
   chunks:results.map(({chunk,candidates,rows,boundaryChanges,duplicateVerdicts,conflicts,checkerEncoding,secondExtractorMethod})=>({index:chunk.index,start:chunk.start,end:chunk.end,chunkHash:chunk.chunkHash,checkerEncoding,secondExtractorMethod,
    candidateCount:candidates.length,acceptedCount:rows.filter(r=>r.disposition==='accepted').length,reviewCount:rows.filter(r=>r.disposition==='review').length,
    rejectedCount:rows.filter(r=>r.disposition==='rejected').length,boundaryChanges,duplicateVerdicts,conflictCount:conflicts.length}))}};
 if(new TextEncoder().encode(JSON.stringify(result)).length>400000)return analysisFailure('keyword_production_evidence_capacity');
 return result;
}

function settled(result:GenerationResult):unknown {
 if(result.validationError)return analysisFailure(result.validationError);
 if(typeof result.actualUsd!=='number'||!Number.isFinite(result.actualUsd)||result.actualUsd<0)return analysisFailure('analysis_unknown_charge_hold');
 return result.value;
}

/** The caller supplies durable, metered generation. This module owns no
 * credentials, ledger, retries, scheduling, session release or publication. */
export async function analyzeProductionKeywords(update:SourceUpdate,generate:(call:KeywordProductionCall)=>Promise<GenerationResult>,sectionSweepChunks?:unknown):Promise<AnalysisOutput> {
 const results:KeywordProductionChunkResult[]=[];
 for(const chunk of planKeywordProductionChunks(update)){
  const [directCall,typedCall]=keywordProductionExtractionCalls(update,chunk,sectionSweepChunks),direct=settled(await generate(directCall)),type_sweep=settled(await generate(typedCall));
  const checkerCall=keywordProductionCheckerCall(update,chunk,{direct,type_sweep},'standard',sectionSweepChunks),checker=settled(await generate(checkerCall));
  results.push(finalizeKeywordProductionChunk(update,chunk,{direct,type_sweep,checker},'standard',sectionSweepChunks));
 }
 return mergeKeywordProductionChunks(update,results);
}

/** A source-only audit may establish a name while also proving its spelling
 * is an ordinary word elsewhere. Keep that literal name and exact named
 * context, but withhold a discussion-time estimate rather than borrowing
 * unrelated word occurrences. Only private admitted source data supplies this
 * policy; neither request callers nor model output can introduce it. */
export function applyKeywordProductionTimingReviews(update:SourceUpdate,output:AnalysisOutput,reviews:unknown):AnalysisOutput {
 if(reviews===undefined)return output;
 if(!Array.isArray(reviews)||reviews.length>500)return analysisFailure('keyword_production_invalid_timing_review');
 const content=source(update),byName=new Map<string,{name:string;evidenceQuote:string;start:number;end:number}>();
 for(const review of reviews){
  if(!record(review)||!exactKeys(review,['name','evidenceQuote'])||typeof review.name!=='string'||!review.name.trim()||review.name.length>100
   ||typeof review.evidenceQuote!=='string'||!review.evidenceQuote.trim()||review.evidenceQuote.length>1000||byName.has(review.name))return analysisFailure('keyword_production_invalid_timing_review');
  const at=content.indexOf(review.evidenceQuote),within=review.evidenceQuote.indexOf(review.name);
  if(at<0||within<0)return analysisFailure('keyword_production_unsupported_timing_review');
  byName.set(review.name,{name:review.name,evidenceQuote:review.evidenceQuote,start:at+within,end:at+within+review.name.length});
 }
 const apply=(row:Record<string,any>)=>{
  const review=[...byName.values()].find(r=>row.label===r.name||row.literalForms?.some((form:Record<string,unknown>)=>form.label===r.name));
  if(!review)return row;
  const {seconds:_seconds,...other}=row;
  return {...other,evidenceQuote:review.evidenceQuote,mention:review.name,start:review.start,end:review.end,ranges:[],timingStatus:'withheld_ambiguous_word_uses'};
 };
 return {...output,pending:(output.pending as Record<string,any>[]).map(apply),evidence:{...output.evidence,
  accepted:(output.evidence.accepted as Record<string,any>[]).map(apply),auditedTimingReviews:[...byName.values()]}};
}

/** Reader fields are derived from accepted rows only. Private source quotes,
 * model judgments, types, confidence markers and unresolved suggestions never
 * become public catalogue/API metadata through this conversion. */
export function keywordProductionReaderFields(output:AnalysisOutput):Pick<SourceUpdate,'videoKeywords'|'topics'|'brands'|'keywordRuleVersion'|'keywordContentHash'> {
 if(output.evidence.protocolVersion!==KEYWORD_PRODUCTION_VERSION||output.evidence.generationContractHash!==KEYWORD_PRODUCTION_CONTRACT_HASH
  ||!Array.isArray(output.evidence.accepted)||typeof output.evidence.contentHash!=='string')return analysisFailure('keyword_production_invalid_result');
 const accepted=output.evidence.accepted as Array<{label:string;kind:LegacyKind;ranges:Array<{startSeconds:number;endSeconds:number}>;seconds?:number}>;
 return {keywordRuleVersion:'entities-v2',keywordContentHash:output.evidence.contentHash,
  videoKeywords:accepted.map(({label,ranges,seconds})=>({label,ranges,...(seconds!==undefined?{seconds}:{})})),
  topics:accepted.map(row=>row.label),brands:accepted.filter(row=>['brand','product','game'].includes(row.kind)).map(row=>row.label)};
}
