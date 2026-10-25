import type { SourceUpdate } from '../../../src/lib/types';
import { contentHash, sourceContentState, usableAnalysisContent } from '../../../src/lib/content-processing';
// @ts-expect-error Existing reviewed domain rules are shared with the legacy engine.
import { canonicalKeywordKey, resolveKeywordPasses } from '../../../scripts/lib/keyword-analysis.mjs';
import { AnalysisError, analysisFailure, type AnalysisGenerator, type AnalysisLimits, type AnalysisRole, type GenerationRequest, type GenerationResult } from './content-analysis-model';
import type { AnalysisOutput } from './content-analysis-engine';
import { ANALYSIS_SYSTEM_V3, ANALYSIS_V3_SUMMARY_POLICY as summaryPolicy, ANALYSIS_V3_KEYWORD_POLICY as keywordPolicy, ANALYSIS_V3_REDUCTION_INSTRUCTION, ANALYSIS_V3_VERIFIER_INSTRUCTION, ANALYSIS_V3_REPAIR_INSTRUCTION, ANALYSIS_V3_GENERATION_CONTRACT_HASH, analysisV3ResponseSchema, analysisV3VerificationSchema, canonicalAnalysisV3Json, ANALYSIS_V3_KINDS, ANALYSIS_V3_PROTOCOL, ANALYSIS_V3_REDUCE_FINDINGS, ANALYSIS_V3_RESULT_BYTES, hasKnownSettledAnalysisV3Charge, parseAnalysisV3CallKey } from './content-analysis-grounded-v3-protocol';
import { alignAnalysisCuesV3, analysisEvidenceV3, literalMentionOffsetsV3, planAnalysisV3Chunks, type AlignedAnalysisCueV3, type AnalysisChunkV3, type AnalysisPassageV3 } from './content-analysis-grounded-v3-source';

type ObjectValue=Record<string,unknown>;
interface Range { startSeconds:number; endSeconds:number }
interface MentionEvidence { offsets:number[]; ranges:Range[] }
interface Candidate { label:string; kind:string; confidence:number|null; reason:string; mention:string; evidenceQuote:string; start:number; end:number; ranges:Range[]; passageIds:string[] }
interface Inventory { ruleVersion:'entities-v2'; role:'extractor'|'checker'; contentHash:string; coverage:Array<{start:number;end:number}>; candidates:Candidate[]; proposals:Candidate[] }
interface Point { text:string; evidenceQuote:string; start:number; end:number; passageIds:string[]; startSeconds?:number }
export interface AnalysisV3Context {
 /** Trusted caller attests review of the ENTIRE saved source, not metadata or prior summaries. */
 emptyDisposition?:'findings_expected'|'no_findings_reviewed'|'unreviewed';
 protocolVersion?:'content-v3'; generationContractHash?:string; predecessorJobId?:string; sourceReviewDigest?:string|null;
}
export interface AnalysisDiagnosticV3 { errorCode:string; fieldPath:string; constraint:string }
export interface AnalysisValidationAuditV3 { key:string; errorCode:string; repairKey?:string; diagnostics:AnalysisDiagnosticV3[] }
export class AnalysisV3ValidationError extends AnalysisError {
 constructor(public diagnostics:AnalysisDiagnosticV3[]){super(diagnostics[0].errorCode);}
}
function checkContext(context:AnalysisV3Context):void {
 if(context.protocolVersion!==undefined&&context.protocolVersion!==ANALYSIS_V3_PROTOCOL
  ||context.generationContractHash!==undefined&&context.generationContractHash!==ANALYSIS_V3_GENERATION_CONTRACT_HASH)return analysisFailure('analysis_generation_context_mismatch');
 if(context.emptyDisposition!==undefined&&!['findings_expected','no_findings_reviewed','unreviewed'].includes(context.emptyDisposition))return analysisFailure('analysis_generation_context_mismatch');
}
type GenerationIssueV3='analysis_invalid_json'|'analysis_output_capacity'|'analysis_provider_refusal';
function generationIssue(result:GenerationResult):GenerationIssueV3|undefined {
 const code=(result as GenerationResult&{validationError?:GenerationIssueV3}).validationError;
 if(code!==undefined&&!['analysis_invalid_json','analysis_output_capacity','analysis_provider_refusal'].includes(code))return analysisFailure('analysis_invalid_output');
 return code;
}
const object=(v:unknown):ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:analysisFailure('analysis_invalid_output');
const keys=(v:ObjectValue,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))return analysisFailure('analysis_invalid_output');};
const nonempty=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);

/** Diagnostics contain only fixed constraint prose and structural array indices.
 * Never echo an unknown property name, source string, label or model error text. */
class Validation {
 diagnostics:AnalysisDiagnosticV3[]=[];
 require(ok:unknown,errorCode:string,fieldPath:string,constraint:string):boolean {
  if(!ok)this.diagnostics.push({errorCode,fieldPath,constraint});
  return !!ok;
 }
 object(value:unknown,path:string,fields:string[]):ObjectValue|undefined {
  if(!this.require(value!==null&&typeof value==='object'&&!Array.isArray(value),'analysis_invalid_output',path,'An object with exactly the requested fields is required.'))return;
  const body=value as ObjectValue;
  this.require(Object.keys(body).every(key=>fields.includes(key)),'analysis_invalid_output',path,'Only the fields declared in the original response schema are allowed.');
  return body;
 }
 envelope(value:unknown,lastId:string,field:'candidates'|'highlights'):unknown[] {
  const body=this.object(value,'$',['readComplete','lastPassageId',field]);
  if(!body)return [];
  this.require(body.readComplete===true,'analysis_incomplete_coverage','$.readComplete','Must be true only after every supplied passage including the tail was read and every requested proposal can be retained and grounded. Unresolved proposals require private review, not silent removal.');
  this.require(body.lastPassageId===lastId,'analysis_incomplete_coverage','$.lastPassageId','Must equal requiredLastPassageId from the SAME original request.');
  if(!this.require(Array.isArray(body[field]),field==='candidates'?'keyword_capacity_requires_review':'analysis_invalid_takeaways',`$.${field}`,'The requested proposal field must be an array.'))return [];
  const rows=body[field] as unknown[];
  this.require(rows.length<=(field==='candidates'?500:6),field==='candidates'?'keyword_capacity_requires_review':'analysis_invalid_takeaways',`$.${field}`,field==='candidates'?'At most 500 candidates fit this response; never truncate an exhaustive inventory to claim complete coverage.':'At most six atomic findings fit this response.');
  return rows;
 }
 evidence(ids:unknown,path:string,passages:AnalysisPassageV3[],content:string,min=1):ReturnType<typeof analysisEvidenceV3>|undefined {
  if(!this.require(Array.isArray(ids)&&ids.length>=1&&ids.length<=3,'analysis_unsupported_passage',path,'Exactly one to three supplied passage IDs are required, in original adjacent order.'))return;
  const selected=(ids as unknown[]).map((id,index)=>{
   const passage=typeof id==='string'?passages.find(p=>p.id===id):undefined;
   this.require(!!passage,'analysis_unsupported_passage',`${path}[${index}]`,'Must be an exact passage ID supplied in this request, not another chunk or an invented ID.');
   return passage;
  });
  for(let index=1;index<selected.length;index++)if(selected[index-1]&&selected[index]) {
   this.require(selected[index-1]!.end===selected[index]!.start,'analysis_unsupported_passage',`${path}[${index}]`,'Must immediately follow the preceding cited passage in the saved original: no gaps, duplicates or reversed order. Known IDs alone are insufficient.');
  }
  try{return analysisEvidenceV3(content,passages,ids,min);}catch(error){
   if(!(error instanceof AnalysisError))throw error;
   if(error.code!=='analysis_unsupported_passage')this.require(false,error.code,path,'The cited one-to-three passage span must reconstruct unchanged saved original text, at least the required evidence length and at most 1000 characters.');
   return;
  }
 }
 finish():void {if(this.diagnostics.length)throw new AnalysisV3ValidationError(this.diagnostics);}
}

function preserveRepairProposals(role:AnalysisRole,invalid:unknown,corrected:unknown) {
 const before=invalid!==null&&typeof invalid==='object'&&!Array.isArray(invalid)?invalid as ObjectValue:{};
 const after=corrected!==null&&typeof corrected==='object'&&!Array.isArray(corrected)?corrected as ObjectValue:{};
 const field=role==='extractor'||role==='checker'?'candidates':role==='summary-reduce'||Array.isArray(before.highlights)?'highlights':'verdicts';
 if(!Array.isArray(before[field]))return;
 const old=before[field] as unknown[],next=after[field];
 if(!Array.isArray(next)||next.length<old.length)return analysisFailure('analysis_correction_dropped_proposal');
 if(field!=='candidates') {
  // Conservative claim accountability: repair references/shape, never replace a
  // failed claim with unrelated prose while preserving only the array length.
  for(const [index,raw] of old.entries())if(object(raw).text!==object(next[index]).text)return analysisFailure('analysis_correction_dropped_proposal');
  return;
 }
 for(const [index,raw] of old.entries()) {
  const candidate=object(raw),value=object(next[index]);
  // A placeholder shared by unrelated proposals is NEVER an identity anchor.
  // Keep the original index, exact label and kind; only evidence may be repaired.
  if(typeof candidate.label!=='string'||candidate.label!==value.label||candidate.kind!==value.kind)return analysisFailure('analysis_correction_dropped_proposal');
 }
}

/** Only a known settled, materialized invalid response authorizes ONE explicit correction.
 * The worker persists the unmodified base response and marks its invalidity before
 * reserving correction. Transport failures/unknown charges never enter this path. */
export async function generateValidatedAnalysisV3<T>(request:GenerationRequest,generate:AnalysisGenerator,validate:(value:unknown)=>T,audit:AnalysisValidationAuditV3[]=[]):Promise<T> {
 const parsed=parseAnalysisV3CallKey(request.key);
 if(!parsed||parsed.repairAttempt)return analysisFailure('analysis_invalid_protocol_key');
 request={...request,prompt:canonicalAnalysisV3Json(JSON.parse(request.prompt))};
 const result=await generate(request);
 try{
  // Check semantic negatives before any transport-materialization marker.
  const value=validate(result.value),issue=generationIssue(result);
  if(issue)return analysisFailure(issue);
  return value;
 }catch(error) {
  if(!(error instanceof AnalysisError))throw error;
  if(error.code==='analysis_unsupported_summary_claim')throw error;
  const issue=generationIssue(result),errorCode=issue||error.code;
  if(issue==='analysis_provider_refusal')return analysisFailure(issue);
  // Semantic verification is a final verdict, never an agreement-seeking
  // correction task. Malformed/truncated JSON may hide a negative verdict.
  if(parsed.baseKey==='summary:v3:verify:0')return analysisFailure(errorCode);
  const diagnostics=error instanceof AnalysisV3ValidationError?[...error.diagnostics]:[{errorCode:error.code,fieldPath:'$',constraint:'The complete response must satisfy the original request schema and all source evidence constraints.'}];
  if(issue)diagnostics.unshift({errorCode:issue,fieldPath:'$',constraint:'Return complete valid JSON without refusal or truncation; the materialized original response is retained unchanged.'});
  audit.push({key:request.key,errorCode,diagnostics});
  if(!Object.prototype.hasOwnProperty.call(result,'value')||result.value===undefined||!hasKnownSettledAnalysisV3Charge(result))return analysisFailure('analysis_correction_charge_unknown');
  const repairKey=request.key+':repair:1';audit[audit.length-1].repairKey=repairKey;
  const repair:GenerationRequest&{correction:{baseKey:string;errorCode:string}}={...request,key:repairKey,correction:{baseKey:request.key,errorCode},
   prompt:canonicalAnalysisV3Json({protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,task:'correct_invalid_response',instruction:ANALYSIS_V3_REPAIR_INSTRUCTION,
    originalRequest:JSON.parse(request.prompt),invalidResponse:result.value,errors:diagnostics})};
  // No catch, SDK retry, recursive repair, new base identity or swallowed failure.
  const corrected=await generate(repair),validated=validate(corrected.value),correctionIssue=generationIssue(corrected);
  if(correctionIssue)return analysisFailure(correctionIssue);
  preserveRepairProposals(request.role,result.value,corrected.value);
  return validated;
 }
}

const coverage=(chunks:AnalysisChunkV3[])=>chunks.map(({start,end})=>({start,end}));
/** Match the existing SQL storage guard before completion, without dropping identities. */
function boundedResult(result:AnalysisOutput):AnalysisOutput {
 // Indented JSON conservatively includes more whitespace than jsonb::text.
 if(new TextEncoder().encode(JSON.stringify(result,null,1)).length>ANALYSIS_V3_RESULT_BYTES)return analysisFailure('analysis_output_capacity');
 return result;
}
function compactCandidate({label,kind,confidence,mention,start,end,passageIds}:Candidate) {
 return {label,kind,confidence,mention,start,end,passageIds};
}
function compactInventory(pass:Inventory) {
 const variants=new Map<string,Candidate>();
 for(const candidate of pass.proposals) {
  const key=canonicalAnalysisV3Json([canonicalKeywordKey(candidate.label),candidate.kind,candidate.mention,candidate.confidence]);
  if(!variants.has(key))variants.set(key,candidate);
 }
 // The worker retains every original call proposal unchanged. Repeated literal
 // occurrences use one deterministic proof per identity/mention variant here.
 return {ruleVersion:pass.ruleVersion,role:pass.role,contentHash:pass.contentHash,coverage:pass.coverage,proposalCount:pass.proposals.length,
  candidates:pass.candidates.map(compactCandidate),proposals:[...variants.values()].map(compactCandidate)};
}
const compactPoint=({evidenceQuote:_quote,...point}:Point)=>point;
function sourceRequest(role:AnalysisRole,chunk:AnalysisChunkV3,hash:string,limits:AnalysisLimits):GenerationRequest {
 return {role,key:`${role}:v3:chunk:${chunk.index}`,system:ANALYSIS_SYSTEM_V3,maxOutputTokens:limits.maxOutputTokens,schema:analysisV3ResponseSchema(role==='summary'?'summary':'keywords',chunk.passages.map(p=>p.id),chunk.passages.at(-1)!.id),
  prompt:canonicalAnalysisV3Json({protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,task:role,policy:role==='summary'?summaryPolicy:keywordPolicy,sourceHash:hash,
   interval:{start:chunk.start,end:chunk.end},requiredLastPassageId:chunk.passages.at(-1)!.id,
   acknowledgement:'readComplete=true means every supplied passage was read and the COMPLETE requested output fits. Echo requiredLastPassageId.',passages:chunk.passages.map(({id,text})=>({id,text}))})};
}
function rangesUnion(ranges:Range[]):Range[] {
 const union:Range[]=[];
 for(const range of [...ranges].sort((a,b)=>a.startSeconds-b.startSeconds)) {
  const previous=union.at(-1);
  if(previous&&range.startSeconds<=previous.endSeconds)previous.endSeconds=Math.max(previous.endSeconds,range.endSeconds);
  else union.push({...range});
 }
 if(union.length>200)return analysisFailure('keyword_capacity_requires_review');
 return union;
}
function atOrAfter(offsets:number[],minimum:number):number|undefined {
 let low=0,high=offsets.length;
 while(low<high){const mid=(low+high)>>>1;if(offsets[mid]<minimum)low=mid+1;else high=mid;}
 return offsets[low];
}
function mentionRanges(offsets:number[],mention:string,cues:AlignedAnalysisCueV3[]):Range[] {
 return rangesUnion(cues.filter(c=>{const at=atOrAfter(offsets,c.start);return c.durationSeconds!==undefined&&at!==undefined&&at+mention.length<=c.end;})
  .map(c=>({startSeconds:c.startSeconds,endSeconds:c.startSeconds+c.durationSeconds!})));
}
function mentionLookup(content:string,cues:AlignedAnalysisCueV3[]) {
 const cache=new Map<string,MentionEvidence>();
 return (mention:string):MentionEvidence=>{
  let value=cache.get(mention);
  if(!value){const offsets=literalMentionOffsetsV3(content,mention);value={offsets,ranges:mentionRanges(offsets,mention,cues)};cache.set(mention,value);}
  return value;
 };
}
function evidenceTime(content:string,start:number,end:number,cues:AlignedAnalysisCueV3[]):number|undefined {
 const matching=cues.filter(c=>c.end>start&&c.start<end).sort((a,b)=>a.start-b.start);
 if(!matching.length)return undefined;
 let cursor=start;
 for(const cue of matching) {
  if(content.slice(cursor,Math.min(end,cue.start)).trim())return undefined;
  cursor=Math.max(cursor,cue.end);
  if(cursor>=end)return matching[0].startSeconds;
 }
 return content.slice(cursor,end).trim()?undefined:matching[0].startSeconds;
}
const displayNames=new Map([['nvidia','Nvidia'],['amd','AMD'],['gpu','GPU'],['cpu','CPU'],['rtx 5090','RTX 5090'],['rtx pro','RTX Pro'],['dlss 5','DLSS 5'],['c','C'],['c++','C++'],['c#','C#'],['playstation','PlayStation'],['playstation 2','PlayStation 2'],['playstation 4','PlayStation 4'],['playstation 5','PlayStation 5'],['nintendo 64','Nintendo 64'],['volkswagen','Volkswagen']]);
function displayLabel(label:string,mention:string):string {
 const key=canonicalKeywordKey(label) as string;
 if(key===(canonicalKeywordKey(mention) as string))return displayNames.get(key)||(label===label.toLocaleLowerCase('en')&&mention!==mention.toLocaleLowerCase('en')?mention:label);
 return label;
}
function readCandidates(value:unknown,chunk:AnalysisChunkV3,content:string,mentions:(mention:string)=>MentionEvidence):Candidate[] {
 const validation=new Validation(),rows=validation.envelope(value,chunk.passages.at(-1)!.id,'candidates'),candidates:Candidate[]=[];
 for(const [index,raw] of rows.entries()) {
  const path=`$.candidates[${index}]`,candidate=validation.object(raw,path,['label','kind','confidence','reason','mention','passageIds']);
  if(!candidate)continue;
  const labelOk=validation.require(nonempty(candidate.label,100)&&!/[\u0000-\u001f\u007f]/u.test(candidate.label as string)&&candidate.label===(candidate.label as string).trim(),'invalid_keyword_candidate',path+'.label','A nonempty canonical identity/category label of at most 100 characters with no surrounding whitespace or controls is required.');
  const kindOk=validation.require(ANALYSIS_V3_KINDS.includes(candidate.kind as typeof ANALYSIS_V3_KINDS[number]),'invalid_keyword_candidate',path+'.kind','Must be one of brand, product, game, technology, category.');
  const confidenceOk=validation.require(candidate.confidence===null||typeof candidate.confidence==='number'&&Number.isInteger(candidate.confidence)&&candidate.confidence>=0&&candidate.confidence<=100,'invalid_keyword_candidate',path+'.confidence','Must be null or an integer from 0 through 100. Unknown identity support remains private review.');
  const reasonOk=validation.require(nonempty(candidate.reason,160),'invalid_keyword_candidate',path+'.reason','A nonempty reason of at most 160 characters without forbidden controls is required.');
  const mentionOk=validation.require(nonempty(candidate.mention,100)&&/[\p{L}\p{N}]/u.test(candidate.mention as string)&&candidate.mention===(candidate.mention as string).trim(),'invalid_keyword_candidate',path+'.mention','A nonempty exact source identity/category spelling of at most 100 characters with no surrounding whitespace is required; never counts, IDs, punctuation placeholders or paraphrases.');
  const evidence=validation.evidence(candidate.passageIds,path+'.passageIds',chunk.passages,content);
  const literal=mentionOk?mentions(candidate.mention as string):undefined;
  const start=evidence&&literal?atOrAfter(literal.offsets,evidence.start):undefined;
  // Diagnose malformed mentions even if a different field/citation also fails.
  if(mentionOk) {
   const ids=Array.isArray(candidate.passageIds)?candidate.passageIds:[],supplied=chunk.passages.filter(p=>ids.includes(p.id));
   const runs:Array<{start:number;end:number}>=[];
   for(const passage of supplied){const last=runs.at(-1);if(last&&last.end===passage.start)last.end=passage.end;else runs.push({start:passage.start,end:passage.end});}
   const supported=runs.some(run=>{const at=atOrAfter(literal!.offsets,run.start);return at!==undefined&&at+(candidate.mention as string).length<=run.end;});
   validation.require(supported,'analysis_unsupported_mention',path+'.mention','Copy the exact original surface spelling/casing of the proposed identity/category inside its cited adjacent span, with whole-identity boundaries. A label, count, passage ID/list, punctuation placeholder or paraphrase cannot substitute for that mention.');
  }
  if(!labelOk||!kindOk||!confidenceOk||!reasonOk||!mentionOk||!evidence||start===undefined||start+(candidate.mention as string).length>evidence.end)continue;
  let confidence=candidate.confidence as number|null,reason=candidate.reason as string;
  if(/\b(?:stagnation|discontinuation|rumou?r|roadmap|improved|conclusion|faster|slower|better|worse)\b/iu.test(candidate.label as string)) {
   confidence=0;reason='Claim fragment requires an identity/category label. '+reason;
  }
  let quoteStart=Math.max(evidence.start,start-40),quoteEnd=Math.min(evidence.end,start+(candidate.mention as string).length+40);
  if(/[\uDC00-\uDFFF]/u.test(content[quoteStart]))quoteStart--;
  if(quoteEnd<content.length&&/[\uD800-\uDBFF]/u.test(content[quoteEnd-1]))quoteEnd++;
  candidates.push({...evidence,evidenceQuote:content.slice(quoteStart,quoteEnd),label:displayLabel(candidate.label as string,candidate.mention as string),kind:candidate.kind as string,confidence,reason,
   mention:candidate.mention as string,start,end:start+(candidate.mention as string).length,ranges:literal!.ranges});
 }
 validation.finish();return candidates;
}
function mergeCandidates(proposals:Candidate[]):Candidate[] {
 const merged=new Map<string,Candidate>();
 for(const candidate of proposals) {
  const key=canonicalKeywordKey(candidate.label) as string,previous=merged.get(key);
  if(!previous)merged.set(key,{...candidate,ranges:[...candidate.ranges]});
  else {
   previous.ranges=rangesUnion([...previous.ranges,...candidate.ranges]);
   previous.confidence=Math.min(previous.confidence??0,candidate.confidence??0);
   if(previous.kind!==candidate.kind){previous.confidence=0;previous.reason='Within-pass entity-type disagreement requires review. '+previous.reason;}
   if(canonicalKeywordKey(previous.label)!==canonicalKeywordKey(previous.mention)||canonicalKeywordKey(candidate.label)!==canonicalKeywordKey(candidate.mention)) {
    previous.confidence=0;previous.reason='Within-pass alias/identity disagreement requires review. '+previous.reason;
   }
  }
 }
 if(merged.size>500)return analysisFailure('keyword_capacity_requires_review');
 return [...merged.values()];
}
async function inventory(update:SourceUpdate,chunks:AnalysisChunkV3[],role:'extractor'|'checker',limits:AnalysisLimits,generate:AnalysisGenerator,mentions:(mention:string)=>MentionEvidence,audit:AnalysisValidationAuditV3[]):Promise<Inventory> {
 const proposals:Candidate[]=[],content=update.content!,hash=contentHash(content);
 for(const chunk of chunks)proposals.push(...await generateValidatedAnalysisV3(sourceRequest(role,chunk,hash,limits),generate,value=>readCandidates(value,chunk,content,mentions),audit));
 return {ruleVersion:'entities-v2',role,contentHash:hash,coverage:coverage(chunks),candidates:mergeCandidates(proposals),proposals};
}
export async function analyzeKeywordsV3(update:SourceUpdate,limits:AnalysisLimits,generate:AnalysisGenerator,context:AnalysisV3Context={}):Promise<AnalysisOutput> {
 checkContext(context);
 if(!usableAnalysisContent(update))return analysisFailure('usable_keyword_content_required');
 const content=update.content!,chunks=planAnalysisV3Chunks(content,limits,'keywords'),mentions=mentionLookup(content,alignAnalysisCuesV3(content,update.transcriptSegments||[])),audit:AnalysisValidationAuditV3[]=[];
 const extraction=await inventory(update,chunks,'extractor',limits,generate,mentions,audit);
 // The second pass sees ONLY the original passages and the same policy, never extraction or its repairs.
 const checker=await inventory(update,chunks,'checker',limits,generate,mentions,audit);
 if(!extraction.candidates.length&&!checker.candidates.length)return analysisFailure('empty_keyword_inventory_requires_manual_review');
 let result;
 try{result=resolveKeywordPasses({content,contentKind:update.contentKind,captionHash:contentHash(content),transcriptSegments:update.transcriptSegments},extraction,checker);}
 catch(error){if(error&&typeof error==='object'&&'safeCode'in error&&typeof error.safeCode==='string')return analysisFailure(error.safeCode);throw error;}
 return boundedResult({state:result.pending.length?'review':'ready',patch:{keywordRuleVersion:'entities-v2'},pending:result.pending,
  evidence:{...result,protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,sourceContentState:sourceContentState(update),coverage:coverage(chunks),extraction:compactInventory(extraction),checker:compactInventory(checker),validationAudit:audit}});
}

interface Quantity { number:string; unit:string|null }
const quantityUnits=new Map<string,string>([
 ['V','voltage'],['volt','voltage'],['volts','voltage'],['voltage','voltage'],
 ['mV','millivoltage'],['millivolt','millivoltage'],['millivolts','millivoltage'],
 ['µV','microvoltage'],['μV','microvoltage'],['uV','microvoltage'],['microvolt','microvoltage'],['microvolts','microvoltage'],
 ['ms','milliseconds'],['millisecond','milliseconds'],['milliseconds','milliseconds'],
 ['s','seconds'],['second','seconds'],['seconds','seconds'],
 ['W','watts'],['watt','watts'],['watts','watts'],['kW','kilowatts'],['kilowatt','kilowatts'],['kilowatts','kilowatts'],
 ['A','amps'],['amp','amps'],['amps','amps'],['ampere','amps'],['amperes','amps'],['mA','milliamps'],
 ['mm','millimeters'],['millimeter','millimeters'],['millimeters','millimeters'],['millimetre','millimeters'],['millimetres','millimeters'],
 ['cm','centimeters'],['centimeter','centimeters'],['centimeters','centimeters'],['centimetre','centimeters'],['centimetres','centimeters'],
 ['m','meters'],['meter','meters'],['meters','meters'],['metre','meters'],['metres','meters'],
 ['°C','celsius'],['C','celsius'],['Celsius','celsius'],['celsius','celsius'],
 ['°F','fahrenheit'],['F','fahrenheit'],['Fahrenheit','fahrenheit'],['fahrenheit','fahrenheit'],['K','kelvin'],['kelvin','kelvin'],['kelvins','kelvin'],
 ['MP','megapixels'],['megapixel','megapixels'],['megapixels','megapixels'],
 ['GB','gigabytes'],['gigabyte','gigabytes'],['gigabytes','gigabytes'],['MB','megabytes'],['megabyte','megabytes'],['megabytes','megabytes'],
 ['FPS','fps'],['fps','fps'],['Hz','hertz'],['hertz','hertz'],['MHz','megahertz'],['GHz','gigahertz'],
 ['%','percent'],['percent','percent'],['percentage','percent'],
]);
/** No trailing boundary assertion: it must NEVER backtrack 0.166V to 0.
 * Greedy whole decimals (including exponent notation) remain exact strings.
 * Unit equivalence is conservative and never restores garbled transcriptions. */
function quantities(text:string):Quantity[] {
 const result:Quantity[]=[];
 for(const match of text.matchAll(/[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/gu)) {
  const after=text.slice(match.index!+match[0].length),adjacent=/^(?:\s*)(°\s*[\p{L}]+|[%\p{L}µμ]+)/u.exec(after),raw=adjacent?.[1].replace(/\s+/gu,''),attached=!!adjacent&&!/^\s/u.test(after);
  const degreePhrase=/^\s*degrees?\s+(celsius|fahrenheit|kelvins?)\b/iu.exec(after);
  const currency=/[$€£¥]\s*$/u.exec(text.slice(Math.max(0,match.index!-4),match.index!));
  const unit=degreePhrase?degreePhrase[1].toLocaleLowerCase('en').replace(/^kelvins$/u,'kelvin'):currency?'currency:'+currency[0].trim():raw&&(quantityUnits.get(raw)||(attached?'literal:'+raw:null));
  result.push({number:match[0],unit:unit||null});
 }
 return result;
}
export function analysisV3Numbers(text:string):string[]{return quantities(text).map(value=>value.number);}
function readPoints(value:unknown,lastId:string,passages:AnalysisPassageV3[],content:string,cues:AlignedAnalysisCueV3[],allowed?:Point[]):Point[] {
 const validation=new Validation(),rows=validation.envelope(value,lastId,'highlights'),seen=new Set<string>(),points:Point[]=[];
 for(const [index,raw] of rows.entries()) {
  const path=`$.highlights[${index}]`,point=validation.object(raw,path,['text','passageIds']);
  if(!point)continue;
  const textOk=validation.require(nonempty(point.text,500)&&point.text.trim().split(/\s+/u).length<=38,'analysis_invalid_takeaways',path+'.text','One nonempty atomic finding of at most 38 words/500 characters without forbidden controls is required. Split compound claims into independently supported findings.');
  if(textOk){validation.require(!seen.has((point.text as string).trim()),'analysis_invalid_takeaways',path+'.text','Each finding must be distinct; repeated identical sentences are invalid.');seen.add((point.text as string).trim());}
  const evidence=validation.evidence(point.passageIds,path+'.passageIds',passages,content,15);
  if(evidence&&allowed)validation.require(allowed.some(old=>old.passageIds.join('|')===evidence.passageIds.join('|')),'analysis_unsupported_reduction_quote',path+'.passageIds','A reduced finding must retain EXACTLY the complete passageIds of ONE supplied finding. Never combine spans or substitute distant evidence.');
  if(textOk&&evidence) {
   const source=quantities(evidence.evidenceQuote),claimed=quantities(point.text as string);
   validation.require(claimed.every(value=>source.some(original=>original.number===value.number)),'analysis_unsupported_summary_number',path+'.text','EVERY whole numeric value in this sentence must occur in its own cited one-to-three passage span. Source-wide values, integer prefixes and unrelated distant measurements cannot supply support.');
   validation.require(claimed.every(value=>value.unit===null||source.some(original=>original.number===value.number&&original.unit===value.unit)),'analysis_unsupported_summary_unit',path+'.text','Every stated numeric unit/dimension must be supported for that SAME whole value inside the cited span. Only unambiguous written-unit/spacing equivalents are allowed; never infer missing temperatures/dimensions, convert ms to mV, restore map to MP or guess garbled units.');
   const startSeconds=evidenceTime(content,evidence.start,evidence.end,cues);
   points.push({text:(point.text as string).trim(),...evidence,...(startSeconds!==undefined?{startSeconds}:{})});
  }
 }
 validation.finish();return points;
}
function reductionRequest(points:Point[],level:number,group:number,limits:AnalysisLimits,hash:string,passages:AnalysisPassageV3[]):GenerationRequest {
 const ids=new Set(points.flatMap(point=>point.passageIds)),evidence=passages.filter(p=>ids.has(p.id));
 return {role:'summary-reduce',key:`summary-reduce:v3:level:${level}:group:${group}`,system:ANALYSIS_SYSTEM_V3,maxOutputTokens:limits.maxOutputTokens,schema:analysisV3ResponseSchema('summary',evidence.map(p=>p.id),evidence.at(-1)!.id),
  prompt:canonicalAnalysisV3Json({protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,task:'reduce_findings',policy:summaryPolicy,sourceHash:hash,
   instruction:ANALYSIS_V3_REDUCTION_INSTRUCTION,
   requiredLastPassageId:evidence.at(-1)!.id,findings:points.map(({text,passageIds})=>({text,passageIds})),passages:evidence.map(({id,text})=>({id,text}))})};
}
async function verifySummary(points:Point[],limits:AnalysisLimits,generate:AnalysisGenerator,audit:AnalysisValidationAuditV3[]) {
 const request:GenerationRequest={role:'summary',key:'summary:v3:verify:0',system:ANALYSIS_SYSTEM_V3,maxOutputTokens:limits.maxOutputTokens,schema:analysisV3VerificationSchema(points.map((_point,index)=>`s${index}`)),
  prompt:canonicalAnalysisV3Json({protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,task:'verify_summary',
   instruction:ANALYSIS_V3_VERIFIER_INSTRUCTION,
   claims:points.map((point,index)=>({id:`s${index}`,text:point.text,passageIds:point.passageIds,evidenceQuote:point.evidenceQuote}))})};
 const verdicts=await generateValidatedAnalysisV3(request,generate,value=>{
  const body=object(value);
  // A recognizable rejection stays terminal even if another verdict is missing
  // or malformed. Shape repair must never turn a negative into agreement.
  if(Array.isArray(body.verdicts)&&body.verdicts.some(raw=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as ObjectValue).supported===false))return analysisFailure('analysis_unsupported_summary_claim');
  keys(body,['readComplete','verdicts']);
  if(body.readComplete!==true||!Array.isArray(body.verdicts)||body.verdicts.length!==points.length)return analysisFailure('analysis_incomplete_summary_verification');
  const seen=new Set<string>(),expected=new Set(points.map((_point,index)=>`s${index}`));
  return body.verdicts.map(raw=>{
   const verdict=object(raw);keys(verdict,['id','supported','reason']);
   if(typeof verdict.id!=='string'||!expected.has(verdict.id)||seen.has(verdict.id)
    ||typeof verdict.supported!=='boolean'||!nonempty(verdict.reason,240))return analysisFailure('analysis_invalid_summary_verification');
   seen.add(verdict.id);return {id:verdict.id,supported:verdict.supported,reason:verdict.reason};
  });
 },audit);
 // A negative verdict is a material semantic failure, NOT a malformed verdict to retry until it agrees.
 if(verdicts.some(verdict=>!verdict.supported))return analysisFailure('analysis_unsupported_summary_claim');
 return verdicts;
}
export async function analyzeSummaryV3(update:SourceUpdate,limits:AnalysisLimits,generate:AnalysisGenerator,context:AnalysisV3Context={}):Promise<AnalysisOutput> {
 checkContext(context);
 if(!usableAnalysisContent(update))return analysisFailure('usable_summary_content_required');
 const content=update.content!,hash=contentHash(content),chunks=planAnalysisV3Chunks(content,limits,'summary'),passages=[...new Map(chunks.flatMap(c=>c.passages).map(p=>[p.id,p])).values()],
  cues=alignAnalysisCuesV3(content,update.transcriptSegments||[]),audit:AnalysisValidationAuditV3[]=[],findings:Point[]=[];
 for(const chunk of chunks)findings.push(...await generateValidatedAnalysisV3(sourceRequest('summary',chunk,hash,limits),generate,
  value=>readPoints(value,chunk.passages.at(-1)!.id,chunk.passages,content,cues),audit));
 let selected=findings;const reductions:Array<{key:string;selected:Point[]}>=[];
 if(chunks.length>1&&findings.length) {
  let level=0;
  let groups=0;
  do {
   const reduced:Point[]=[];
   groups=Math.ceil(selected.length/ANALYSIS_V3_REDUCE_FINDINGS);
   for(let from=0,group=0;from<selected.length;from+=ANALYSIS_V3_REDUCE_FINDINGS,group++) {
    const inputs=selected.slice(from,from+ANALYSIS_V3_REDUCE_FINDINGS),request=reductionRequest(inputs,level,group,limits,hash,passages),prompt=JSON.parse(request.prompt),allowedIds=new Set(inputs.flatMap(p=>p.passageIds));
    const output=await generateValidatedAnalysisV3(request,generate,value=>{
     const result=readPoints(value,prompt.requiredLastPassageId,passages.filter(p=>allowedIds.has(p.id)),content,cues,inputs);
     // A reducer cannot erase a nonempty finding inventory and claim a complete empty recap.
     if(!result.length)return analysisFailure('analysis_incomplete_summary_reduction');
     return result;
    },audit);
    reductions.push({key:request.key,selected:output});reduced.push(...output);
   }
   selected=reduced;level++;
   // Even if several groups each produced only one point, run a final global
   // selection to combine repetition and reconcile late corrections across them.
  }while(selected.length>6||groups>1);
 }
 if(!selected.length&&context.emptyDisposition!=='no_findings_reviewed')return analysisFailure(context.emptyDisposition==='findings_expected'?'analysis_summary_omission':'analysis_empty_summary_requires_review');
 const verification=selected.length?await verifySummary(selected,limits,generate,audit):[];
 return boundedResult({state:selected.length?'ready':'empty',pending:[],patch:{videoHighlights:selected.map(({text,startSeconds})=>({text,...(startSeconds!==undefined?{startSeconds}:{})})),
  videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:selected.some(point=>point.startSeconds!==undefined)?'captions':'none'}},
  evidence:{ruleVersion:'takeaways-v1',protocolVersion:ANALYSIS_V3_PROTOCOL,generationContractHash:ANALYSIS_V3_GENERATION_CONTRACT_HASH,contentHash:hash,sourceContentState:sourceContentState(update),coverage:coverage(chunks),
   emptyDisposition:selected.length?'findings_present':context.emptyDisposition,emptyReview:!selected.length?{basis:'trusted_full_saved_source',contentHash:hash,sourceReviewDigest:context.sourceReviewDigest??null}:null,
   findings:findings.map(compactPoint),selected,reductions:reductions.map(({key,selected:points})=>({key,selected:points.map(compactPoint)})),verification,validationAudit:audit}});
}

export { analysisV3CallPlan, planAnalysisV3Chunks } from './content-analysis-grounded-v3-source';
