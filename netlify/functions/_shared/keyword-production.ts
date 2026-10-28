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
export const KEYWORD_PRODUCTION_EXTRACTOR_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
export const KEYWORD_PRODUCTION_CHECKER_MODEL = 'openai/gpt-6.1-sol-pro';
export const KEYWORD_PRODUCTION_CHUNK_CHARS = 12_000;
export const KEYWORD_PRODUCTION_OVERLAP_CHARS = 200;
export const KEYWORD_PRODUCTION_MAX_SOURCE_CHARS = 1_000_000;
export const KEYWORD_PRODUCTION_MAX_NAMES = 500;
const MAX_PROMPT_CHARS = 100_000;

/** A production version pins both measured prompts and its explicit long-source
 * adaptation. The seven-case proof used one complete-source chunk; chunked
 * sources are a separately measured extension, never claimed as that proof. */
export const KEYWORD_PRODUCTION_CONTRACT_HASH = contentHash(JSON.stringify({
 version: KEYWORD_PRODUCTION_VERSION,
 promptModuleSha256: frozen.promptModuleSha256,
 coreModuleSha256: frozen.coreModuleSha256,
 extractorModel: KEYWORD_PRODUCTION_EXTRACTOR_MODEL,
 checkerModel: KEYWORD_PRODUCTION_CHECKER_MODEL,
 extractorLessons: frozen.extractorLessons,
 checkerLessons: frozen.checkerLessons,
 patternMining: 'focused', checkerReasons: false, checkerMaxOutputTokens: 2000,
 chunkChars: KEYWORD_PRODUCTION_CHUNK_CHARS, overlapChars: KEYWORD_PRODUCTION_OVERLAP_CHARS,
 maximumNames: KEYWORD_PRODUCTION_MAX_NAMES,
 merge: 'legacy-key-aliases-conflicts-review-v2', boundaryGuards: true,
 hostSourceWhitespaceAlignment:'linebreak-runs-with-original-utf16-offsets-v1',
 publicationEvidence:'literal-first-span-all-ranges-and-durable-call-lineage-v1',
 timing:'cached-complete-or-unique-cue-alignment-v1',
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

export function keywordProductionExtractionCalls(update:SourceUpdate,chunk:KeywordProductionChunk):KeywordProductionCall[] {
 checkedChunk(update,chunk);
 return (['direct','type_sweep'] as const).map(step=>({chunkIndex:chunk.index,step,model:KEYWORD_PRODUCTION_EXTRACTOR_MODEL,
  request:requestCapacity(keywordExtractionRequest({method:step,content:chunk.content,lessons:frozen.extractorLessons}))}));
}

function combinedInventory(chunk:KeywordProductionChunk,values:ChunkInventories):Array<{name:string}> {
 const signature=JSON.stringify(values),cached=inventoryCache.get(chunk);
 if(cached?.signature===signature)return cached.rows;
 const direct=validateLiteralInventory(values.direct) as Inventory, typed=validateLiteralInventory(values.type_sweep) as Inventory;
 const rows=combineKeywordInventories(renderSource(chunk.content).text,[{method:'direct',output:direct},{method:'type_sweep',output:typed},
  {method:'patterns',output:minePatternNames(chunk.content,{precision:'focused'})}]) as Array<{name:string}>;
 inventoryCache.set(chunk,{signature,rows});return rows;
}

export function keywordProductionCheckerCall(update:SourceUpdate,chunk:KeywordProductionChunk,values:ChunkInventories):KeywordProductionCall {
 checkedChunk(update,chunk);
 const names=combinedInventory(chunk,values).map(row=>row.name);
 return {chunkIndex:chunk.index,step:'checker',model:KEYWORD_PRODUCTION_CHECKER_MODEL,
  request:requestCapacity(keywordCheckerRequest({content:chunk.content,names,lessons:frozen.checkerLessons,maxOutputTokens:2000,includeReasons:false}))};
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

export function finalizeKeywordProductionChunk(update:SourceUpdate,chunk:KeywordProductionChunk,values:ChunkInventories&{checker:unknown}):KeywordProductionChunkResult {
 checkedChunk(update,chunk);
 const candidates=combinedInventory(chunk,values).map(row=>row.name);
 validateChecker(values.checker,candidates);
 const rendered=renderSource(chunk.content).text;
 const normalized=resolveKeywordCheckerVerdicts({content:rendered,names:candidates,
  value:keywordCheckerValueForNormalization(values.checker,{includeReasons:false})}) as {rows:KeywordProductionDecision[];duplicateVerdicts:number;conflicts:unknown[]};
 const boundary=applyKeywordBoundaryGuards({content:rendered,rows:normalized.rows}) as {rows:KeywordProductionDecision[];changes:unknown[]};
 return {chunk,candidates,rawRows:normalized.rows,rows:boundary.rows,boundaryChanges:boundary.changes,
  duplicateVerdicts:normalized.duplicateVerdicts,conflicts:normalized.conflicts};
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
  literalForms.sort((a,b)=>(a.occurrences[0]?.start??Infinity)-(b.occurrences[0]?.start??Infinity));
  const label=literalForms[0].label,originalRows=literalForms.flatMap(alias=>alias.originalRows);
  const kinds=[...new Set(originalRows.map(value=>value.row.kind))],dispositions=[...new Set(originalRows.map(value=>value.row.disposition))];
  const conflict=kinds.length!==1||dispositions.length!==1, literalKind=kinds.length===1?kinds[0]:null;
  let disposition:Disposition=conflict?'review':dispositions[0];
  if(conflict)crossChunkConflicts.push({name:label,kinds,dispositions,chunkIndices:originalRows.map(value=>value.chunkIndex)});
  const occurrences=literalForms.flatMap(alias=>alias.occurrences).sort((a,b)=>a.start-b.start);
  if(disposition==='rejected'){rejected.push({label,literalKind,disposition,originalRows,literalForms});continue;}
  if(!occurrences.length){unmatchedReview.push({label,literalKind,disposition:'review',reason:'literal_name_not_in_source',originalRows,literalForms});continue;}
  // A label found elsewhere in the full source cannot repair absent local
  // support in the chunk that proposed it. The raw verdict stays auditable.
  if(originalRows.some(value=>value.row.hostReviewReason==='literal_name_not_in_source'))disposition='review';
  const ranges=mergedRanges(occurrences), first=occurrences[0];
  const row={label,kind:legacyKind(literalKind),literalKind,disposition,key,
   literalForms:literalForms.map(form=>({label:form.label,occurrenceCount:form.occurrences.length,
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
   extractionMethods:['direct','type_sweep','focused_patterns'],extractorModel:KEYWORD_PRODUCTION_EXTRACTOR_MODEL,checkerModel:KEYWORD_PRODUCTION_CHECKER_MODEL,
   checkerReasons:false,confidenceOrigin:'legacy_acceptance_marker_not_model_score',
   rawGenerationEvidence:'Exact request payloads and provider responses remain in the bound durable call receipts; this publication proof avoids duplicating them.',
   chunks:results.map(({chunk,candidates,rows,boundaryChanges,duplicateVerdicts,conflicts})=>({index:chunk.index,start:chunk.start,end:chunk.end,chunkHash:chunk.chunkHash,
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
export async function analyzeProductionKeywords(update:SourceUpdate,generate:(call:KeywordProductionCall)=>Promise<GenerationResult>):Promise<AnalysisOutput> {
 const results:KeywordProductionChunkResult[]=[];
 for(const chunk of planKeywordProductionChunks(update)){
  const [directCall,typedCall]=keywordProductionExtractionCalls(update,chunk),direct=settled(await generate(directCall)),type_sweep=settled(await generate(typedCall));
  const checkerCall=keywordProductionCheckerCall(update,chunk,{direct,type_sweep}),checker=settled(await generate(checkerCall));
  results.push(finalizeKeywordProductionChunk(update,chunk,{direct,type_sweep,checker}));
 }
 return mergeKeywordProductionChunks(update,results);
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
