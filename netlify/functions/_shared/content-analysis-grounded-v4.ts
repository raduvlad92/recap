import type { SourceUpdate } from '../../../src/lib/types';
import { contentHash, sourceContentState, usableAnalysisContent } from '../../../src/lib/content-processing';
// @ts-expect-error Existing reviewed domain rules are shared with the legacy engine.
import { canonicalKeywordKey, resolveKeywordPasses } from '../../../scripts/lib/keyword-analysis.mjs';
import { AnalysisError, analysisFailure, type AnalysisGenerator, type AnalysisLimits, type AnalysisRole, type GenerationRequest, type GenerationResult } from './content-analysis-model';
import type { AnalysisOutput } from './content-analysis-engine';
import { ANALYSIS_SYSTEM_V4, ANALYSIS_V4_SUMMARY_POLICY as summaryPolicy, ANALYSIS_V4_KEYWORD_POLICY as keywordPolicy, ANALYSIS_V4_REDUCTION_INSTRUCTION, ANALYSIS_V4_VERIFIER_INSTRUCTION, ANALYSIS_V4_REPAIR_INSTRUCTION, ANALYSIS_V4_GENERATION_CONTRACT_HASH, analysisV4ResponseSchema, analysisV4VerificationSchema, analysisV4CorrectionSchema, analysisV4ReductionSchema, canonicalAnalysisV4Json, ANALYSIS_V4_KINDS, ANALYSIS_V4_PROTOCOL, ANALYSIS_V4_REDUCE_FINDINGS, ANALYSIS_V4_RESULT_BYTES, hasKnownSettledAnalysisV4Charge, parseAnalysisV4CallKey } from './content-analysis-grounded-v4-protocol';
import { analysisLexicalUnitsV4, analysisMentionV4, alignAnalysisCuesV4, analysisEvidenceV4, literalMentionOffsetsV4, planAnalysisV4Chunks, type AlignedAnalysisCueV4, type AnalysisChunkV4, type AnalysisPassageV4 } from './content-analysis-grounded-v4-source';

type ObjectValue=Record<string,unknown>;
interface Range { startSeconds:number; endSeconds:number }
interface MentionEvidence { offsets:number[]; ranges:Range[] }
interface Candidate { proposalId:string; lineage:AnalysisProposalV4[]; firstUnitId:string; lastUnitId:string; label:string; kind:string; confidence:number|null; reason:string; mention:string; evidenceQuote:string; start:number; end:number; ranges:Range[]; passageIds:string[] }
interface Inventory { ruleVersion:'entities-v2'; role:'extractor'|'checker'; contentHash:string; coverage:Array<{start:number;end:number}>; candidates:Candidate[]; proposals:Candidate[] }
interface Point { proposalId:string; lineage:AnalysisProposalV4[]; text:string; evidenceQuote:string; start:number; end:number; passageIds:string[]; startSeconds?:number }
export interface AnalysisV4Context {
 /** Trusted caller attests review of the ENTIRE saved source, not metadata or prior summaries. */
 emptyDisposition?:'findings_expected'|'no_findings_reviewed'|'unreviewed';
 protocolVersion?:'content-v4'; generationContractHash?:string; predecessorJobId?:string|null; sourceReviewDigest?:string|null;
}
export interface AnalysisProposalV4 { proposalId:string; originalResponseHash:string; originalProposalHash:string; originalText:string|null; originalPassageIds:unknown; corrected:boolean; correctionReason?:string; opaqueParent?:boolean }
export interface AnalysisProposalContextV4 { proposals:AnalysisProposalV4[] }
export interface AnalysisDiagnosticV4 { errorCode:string; fieldPath:string; constraint:string }
export interface AnalysisValidationAuditV4 { key:string; errorCode:string; repairKey?:string; diagnostics:AnalysisDiagnosticV4[]; proposalLineage?:AnalysisProposalV4[] }
export class AnalysisV4ValidationError extends AnalysisError {
 constructor(public diagnostics:AnalysisDiagnosticV4[]){super(diagnostics[0].errorCode);}
}
function checkContext(context:AnalysisV4Context):void {
 if(context.protocolVersion!==undefined&&context.protocolVersion!==ANALYSIS_V4_PROTOCOL
  ||context.generationContractHash!==undefined&&context.generationContractHash!==ANALYSIS_V4_GENERATION_CONTRACT_HASH)return analysisFailure('analysis_generation_context_mismatch');
 if(context.emptyDisposition!==undefined&&!['findings_expected','no_findings_reviewed','unreviewed'].includes(context.emptyDisposition))return analysisFailure('analysis_generation_context_mismatch');
}
type GenerationIssueV4='analysis_invalid_json'|'analysis_output_capacity'|'analysis_provider_refusal';
function generationIssue(result:GenerationResult):GenerationIssueV4|undefined {
 const code=(result as GenerationResult&{validationError?:GenerationIssueV4}).validationError;
 if(code!==undefined&&!['analysis_invalid_json','analysis_output_capacity','analysis_provider_refusal'].includes(code))return analysisFailure('analysis_invalid_output');
 return code;
}
const object=(v:unknown):ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:analysisFailure('analysis_invalid_output');
const keys=(v:ObjectValue,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))return analysisFailure('analysis_invalid_output');};
const nonempty=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);

/** Diagnostics contain only fixed constraint prose and structural array indices.
 * Never echo an unknown property name, source string, label or model error text. */
class Validation {
 diagnostics:AnalysisDiagnosticV4[]=[];
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
 evidence(ids:unknown,path:string,passages:AnalysisPassageV4[],content:string,min=1):ReturnType<typeof analysisEvidenceV4>|undefined {
  if(!this.require(Array.isArray(ids)&&ids.length>=1&&ids.length<=3,'analysis_unsupported_passage',path,'Exactly one to three supplied passage IDs are required, in original adjacent order.'))return;
  const selected=(ids as unknown[]).map((id,index)=>{
   const passage=typeof id==='string'?passages.find(p=>p.id===id):undefined;
   this.require(!!passage,'analysis_unsupported_passage',`${path}[${index}]`,'Must be an exact passage ID supplied in this request, not another chunk or an invented ID.');
   return passage;
  });
  for(let index=1;index<selected.length;index++)if(selected[index-1]&&selected[index]) {
   this.require(selected[index-1]!.end===selected[index]!.start,'analysis_unsupported_passage',`${path}[${index}]`,'Must immediately follow the preceding cited passage in the saved original: no gaps, duplicates or reversed order. Known IDs alone are insufficient.');
  }
  try{return analysisEvidenceV4(content,passages,ids,min);}catch(error){
   if(!(error instanceof AnalysisError))throw error;
   if(error.code!=='analysis_unsupported_passage')this.require(false,error.code,path,'The cited one-to-three passage span must reconstruct unchanged saved original text, at least the required evidence length and at most 1000 characters.');
   return;
  }
 }
 finish():void {if(this.diagnostics.length)throw new AnalysisV4ValidationError(this.diagnostics);}
}

function proposalField(request:GenerationRequest):'highlights'|'candidates' {
 return request.role==='extractor'||request.role==='checker'?'candidates':'highlights';
}
function proposalContext(request:GenerationRequest,value:unknown,rawParentHash?:string):AnalysisProposalContextV4 {
 const body=value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:{},field=proposalField(request),rows=body[field];
 if(!Array.isArray(rows))return {proposals:[]};
 const originalResponseHash=rawParentHash??contentHash(canonicalAnalysisV4Json(value));
 return {proposals:rows.map((raw,index)=>{
  const row=raw!==null&&typeof raw==='object'&&!Array.isArray(raw)?raw as ObjectValue:{};
  const originalProposalHash=contentHash(canonicalAnalysisV4Json(raw)),proposalId=`q${index}_${contentHash(canonicalAnalysisV4Json([request.key,index,originalResponseHash,originalProposalHash])).slice(0,20)}`;
  return {proposalId,originalResponseHash,originalProposalHash,originalText:typeof row.text==='string'?row.text:null,
   originalPassageIds:row.passageIds??null,corrected:!!rawParentHash,...(rawParentHash?{opaqueParent:true}:{} )};
 })};
}
function correctionValue(request:GenerationRequest,invalid:unknown,corrected:unknown,context:AnalysisProposalContextV4) {
 if(!context.proposals.length)return {value:corrected,context:proposalContext(request,corrected,contentHash(canonicalAnalysisV4Json(invalid)))};
 const before=object(invalid),after=object(corrected),field=proposalField(request),old=before[field] as unknown[],next=after[field];
 if(!Array.isArray(next)||next.length!==context.proposals.length)return analysisFailure('analysis_correction_dropped_proposal');
 const proposals:AnalysisProposalV4[]=[],rows:unknown[]=[];
 for(const [index,raw] of next.entries()) {
  const row=object(raw),parent=context.proposals[index];
  if(row.proposalId!==parent.proposalId||!nonempty(row.correctionReason,240))return analysisFailure('analysis_correction_dropped_proposal');
  if(field==='candidates') {
   const original=object(old[index]);
   if(typeof original.label!=='string'||row.label!==original.label||row.kind!==original.kind)return analysisFailure('analysis_correction_dropped_proposal');
  }
  const {proposalId:_id,correctionReason,...domain}=row;
  rows.push(domain);proposals.push({...parent,corrected:true,correctionReason:correctionReason as string});
 }
 return {value:{...after,[field]:rows},context:{proposals}};
}

/** ONE correction of an already settled materialized base. Trusted proposal
 * identities and immutable parent hashes are separate from the model response.
 * The terminal verifier never enters repair, including malformed negatives. */
export async function generateValidatedAnalysisV4<T>(request:GenerationRequest,generate:AnalysisGenerator,validate:(value:unknown,context?:AnalysisProposalContextV4)=>T,audit:AnalysisValidationAuditV4[]=[]):Promise<T> {
 const parsed=parseAnalysisV4CallKey(request.key);
 if(!parsed||parsed.repairAttempt)return analysisFailure('analysis_invalid_protocol_key');
 request={...request,prompt:canonicalAnalysisV4Json(JSON.parse(request.prompt))};
 const result=await generate(request),context=proposalContext(request,result.value);
 try {
  // Preserve recognizable terminal negatives even when a materialization marker
  // also exists. Other output reports its exact persisted format marker first.
  if(parsed.baseKey==='summary:v4:verify:0') {
   const validated=validate(result.value,context),issue=generationIssue(result);
   if(issue)return analysisFailure(issue);
   return validated;
  }
  const issue=generationIssue(result);if(issue)return analysisFailure(issue);
  return validate(result.value,context);
 } catch(error) {
  if(!(error instanceof AnalysisError))throw error;
  if(error.code==='analysis_unsupported_summary_claim'||error.code==='analysis_correction_changed_finding')throw error;
  const issue=generationIssue(result),errorCode=issue||error.code;
  if(issue==='analysis_provider_refusal'||parsed.baseKey==='summary:v4:verify:0')return analysisFailure(errorCode);
  const diagnostics=error instanceof AnalysisV4ValidationError?[...error.diagnostics]:[{errorCode:error.code,fieldPath:'$',constraint:'The complete response must satisfy the original schema and all source-evidence constraints.'}];
  if(issue)diagnostics.unshift({errorCode:issue,fieldPath:'$',constraint:'Return one complete valid JSON response without refusal or truncation; retain the unmodified original response.'});
  const entry:AnalysisValidationAuditV4={key:request.key,errorCode,diagnostics,proposalLineage:context.proposals};audit.push(entry);
  if(!Object.prototype.hasOwnProperty.call(result,'value')||result.value===undefined||!hasKnownSettledAnalysisV4Charge(result))return analysisFailure('analysis_correction_charge_unknown');
  const field=proposalField(request),maximum=field==='candidates'?500:6;
  if(context.proposals.length>maximum)return analysisFailure('analysis_output_capacity');
  const repairKey=request.key+':repair:1';entry.repairKey=repairKey;
  const originalRequest=JSON.parse(request.prompt);
  if(field==='candidates'&&Array.isArray(originalRequest.lexicalUnits)) {
   // Same IDs and text, less repeated JSON scaffolding. Full parent hashes and
   // raw proposals stay in the durable call and host audit, not every prompt row.
   originalRequest.lexicalUnitFormat='[id,text] tuples';
   originalRequest.lexicalUnits=originalRequest.lexicalUnits.map(({id,text}:{id:string;text:string})=>[id,text]);
  }
  const repair:GenerationRequest&{correction:{baseKey:string;errorCode:string}}={...request,key:repairKey,correction:{baseKey:request.key,errorCode},
   schema:analysisV4CorrectionSchema(request.schema,field,context.proposals.map(proposal=>proposal.proposalId)),
   prompt:canonicalAnalysisV4Json({protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,task:'correct_invalid_response',instruction:ANALYSIS_V4_REPAIR_INSTRUCTION,
    originalRequest,invalidResponse:result.value,proposalLineage:field==='candidates'?context.proposals.map(({proposalId})=>({proposalId})):context.proposals,errors:diagnostics})};
  const corrected=await generate(repair),correctionIssue=generationIssue(corrected);
  if(correctionIssue)return analysisFailure(correctionIssue);
  const normalized=correctionValue(request,result.value,corrected.value,context);
  entry.proposalLineage=normalized.context.proposals;
  return validate(normalized.value,normalized.context);
 }
}

const coverage=(chunks:AnalysisChunkV4[])=>chunks.map(({start,end})=>({start,end}));
/** Match the existing SQL storage guard before completion, without dropping identities. */
function boundedResult(result:AnalysisOutput):AnalysisOutput {
 // Indented JSON conservatively includes more whitespace than jsonb::text.
 if(new TextEncoder().encode(JSON.stringify(result,null,1)).length>ANALYSIS_V4_RESULT_BYTES)return analysisFailure('analysis_output_capacity');
 return result;
}
function compactCandidate({proposalId,lineage,firstUnitId,lastUnitId,label,kind,confidence,mention,start,end,passageIds}:Candidate) {
 return {proposalId,lineage:lineage.map(({originalText,originalPassageIds,...parent})=>({...parent,
  ...(originalText!==null?{originalText}:{}),...(originalPassageIds!==null?{originalPassageIds}:{})})),
  firstUnitId,lastUnitId,label,kind,confidence,mention,start,end,passageIds};
}
function compactInventory(pass:Inventory) {
 const variants=new Map<string,Candidate>();
 for(const candidate of pass.proposals) {
  const key=canonicalAnalysisV4Json([canonicalKeywordKey(candidate.label),candidate.kind,candidate.mention,candidate.confidence]);
  if(!variants.has(key))variants.set(key,candidate);
 }
 // The worker retains every original call proposal unchanged. Repeated literal
 // occurrences use one deterministic proof per identity/mention variant here.
 return {ruleVersion:pass.ruleVersion,role:pass.role,contentHash:pass.contentHash,coverage:pass.coverage,proposalCount:pass.proposals.length,
  candidates:pass.candidates.map(compactCandidate),proposals:[...variants.values()].map(compactCandidate)};
}
const compactPoint=({evidenceQuote:_quote,...point}:Point)=>point;
function sourceRequest(role:AnalysisRole,chunk:AnalysisChunkV4,hash:string,limits:AnalysisLimits,content:string):GenerationRequest {
 const units=role==='summary'?[]:analysisLexicalUnitsV4(content,chunk.start,chunk.end);
 return {role,key:`${role}:v4:chunk:${chunk.index}`,system:ANALYSIS_SYSTEM_V4,maxOutputTokens:limits.maxOutputTokens,schema:analysisV4ResponseSchema(role==='summary'?'summary':'keywords',chunk.passages.map(p=>p.id),chunk.passages.at(-1)!.id,units.map(unit=>unit.id)),
  prompt:canonicalAnalysisV4Json({protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,task:role,policy:role==='summary'?summaryPolicy:keywordPolicy,sourceHash:hash,
   interval:{start:chunk.start,end:chunk.end},requiredLastPassageId:chunk.passages.at(-1)!.id,
   acknowledgement:'readComplete=true means every supplied passage was read and the COMPLETE requested output fits. Echo requiredLastPassageId.',passages:chunk.passages.map(({id,text})=>({id,text})),...(role==='summary'?{}:{lexicalUnits:units.map(({id,text})=>({id,text}))})})};
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
function mentionRanges(offsets:number[],mention:string,cues:AlignedAnalysisCueV4[]):Range[] {
 return rangesUnion(cues.filter(c=>{const at=atOrAfter(offsets,c.start);return c.durationSeconds!==undefined&&at!==undefined&&at+mention.length<=c.end;})
  .map(c=>({startSeconds:c.startSeconds,endSeconds:c.startSeconds+c.durationSeconds!})));
}
function mentionLookup(content:string,cues:AlignedAnalysisCueV4[]) {
 const cache=new Map<string,MentionEvidence>();
 return (mention:string):MentionEvidence=>{
  let value=cache.get(mention);
  if(!value){const offsets=literalMentionOffsetsV4(content,mention);value={offsets,ranges:mentionRanges(offsets,mention,cues)};cache.set(mention,value);}
  return value;
 };
}
function evidenceTime(content:string,start:number,end:number,cues:AlignedAnalysisCueV4[]):number|undefined {
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
function readCandidates(value:unknown,chunk:AnalysisChunkV4,content:string,mentions:(mention:string)=>MentionEvidence,context?:AnalysisProposalContextV4):Candidate[] {
 const validation=new Validation(),rows=validation.envelope(value,chunk.passages.at(-1)!.id,'candidates'),candidates:Candidate[]=[],units=analysisLexicalUnitsV4(content,chunk.start,chunk.end);
 for(const [index,raw] of rows.entries()) {
  const path=`$.candidates[${index}]`,candidate=validation.object(raw,path,['label','kind','confidence','reason','firstUnitId','lastUnitId']);
  if(!candidate)continue;
  const labelOk=validation.require(nonempty(candidate.label,100)&&!/[\u0000-\u001f\u007f]/u.test(candidate.label as string)&&candidate.label===(candidate.label as string).trim(),'invalid_keyword_candidate',path+'.label','A canonical identity/category label of at most 100 characters without surrounding whitespace or controls is required.');
  const kindOk=validation.require(ANALYSIS_V4_KINDS.includes(candidate.kind as typeof ANALYSIS_V4_KINDS[number]),'invalid_keyword_candidate',path+'.kind','Must be brand, product, game, technology or category.');
  const confidenceOk=validation.require(candidate.confidence===null||typeof candidate.confidence==='number'&&Number.isInteger(candidate.confidence)&&candidate.confidence>=0&&candidate.confidence<=100,'invalid_keyword_candidate',path+'.confidence','Must be null or an integer from 0 through 100.');
  const reasonOk=validation.require(nonempty(candidate.reason,160),'invalid_keyword_candidate',path+'.reason','A nonempty support/identity reason of at most 160 characters is required.');
  let mention:ReturnType<typeof analysisMentionV4>|undefined;
  try{mention=analysisMentionV4(content,units,candidate.firstUnitId,candidate.lastUnitId);}catch(error){
   if(!(error instanceof AnalysisError))throw error;
   validation.require(false,error.code,path+'.firstUnitId','Both IDs must identify one whole contiguous source identity in THIS chunk, in source order, at most 100 characters; no split identities or invented IDs.');
  }
  const ids=mention?chunk.passages.filter(p=>p.end>mention!.start&&p.start<mention!.end).map(p=>p.id):[],evidence=mention?validation.evidence(ids,path+'.firstUnitId',chunk.passages,content):undefined;
  if(!labelOk||!kindOk||!confidenceOk||!reasonOk||!mention||!evidence)continue;
  const literal=mentions(mention.mention),start=mention.start;
  if(!validation.require(literal.offsets.includes(start),'analysis_unsupported_mention',path+'.firstUnitId','Reconstructed source mention must have exact whole-identity boundaries.'))continue;
  const parent=context?.proposals[index];
  if(!validation.require(!!parent,'analysis_proposal_lineage_missing',path,'Trusted materialized proposal lineage is required.'))continue;
  let confidence=candidate.confidence as number|null,reason=candidate.reason as string;
  if(/\b(?:stagnation|discontinuation|rumou?r|roadmap|improved|conclusion|faster|slower|better|worse)\b/iu.test(candidate.label as string)) {
   confidence=0;reason='Claim fragment requires an identity/category label. '+reason;
  }
  let quoteStart=Math.max(evidence.start,start-40),quoteEnd=Math.min(evidence.end,mention.end+40);
  if(/[\uDC00-\uDFFF]/u.test(content[quoteStart]))quoteStart--;
  if(quoteEnd<content.length&&/[\uD800-\uDBFF]/u.test(content[quoteEnd-1]))quoteEnd++;
  candidates.push({...evidence,evidenceQuote:content.slice(quoteStart,quoteEnd),label:displayLabel(candidate.label as string,mention.mention),kind:candidate.kind as string,confidence,reason,
   mention:mention.mention,start,end:mention.end,ranges:literal.ranges,proposalId:parent!.proposalId,lineage:[parent!],firstUnitId:candidate.firstUnitId as string,lastUnitId:candidate.lastUnitId as string});
 }
 validation.finish();return candidates;
}

function mergeCandidates(proposals:Candidate[]):Candidate[] {
 const merged=new Map<string,Candidate>();
 for(const candidate of proposals) {
  const key=canonicalKeywordKey(candidate.label) as string,previous=merged.get(key);
  if(!previous)merged.set(key,{...candidate,ranges:[...candidate.ranges]});
  else {
   // Lookup already includes every real cue for the retained literal mention.
   // Other aliases keep their own evidence in proposals; mixing their timing
   // here would attach a different phrase's cue to this mention and quote.
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
async function inventory(update:SourceUpdate,chunks:AnalysisChunkV4[],role:'extractor'|'checker',limits:AnalysisLimits,generate:AnalysisGenerator,mentions:(mention:string)=>MentionEvidence,audit:AnalysisValidationAuditV4[]):Promise<Inventory> {
 const proposals:Candidate[]=[],content=update.content!,hash=contentHash(content);
 for(const chunk of chunks)proposals.push(...await generateValidatedAnalysisV4(sourceRequest(role,chunk,hash,limits,content),generate,(value,context)=>readCandidates(value,chunk,content,mentions,context),audit));
 return {ruleVersion:'entities-v2',role,contentHash:hash,coverage:coverage(chunks),candidates:mergeCandidates(proposals),proposals};
}
export async function analyzeKeywordsV4(update:SourceUpdate,limits:AnalysisLimits,generate:AnalysisGenerator,context:AnalysisV4Context={}):Promise<AnalysisOutput> {
 checkContext(context);
 if(!usableAnalysisContent(update))return analysisFailure('usable_keyword_content_required');
 const content=update.content!,chunks=planAnalysisV4Chunks(content,limits,'keywords'),mentions=mentionLookup(content,alignAnalysisCuesV4(content,update.transcriptSegments||[])),audit:AnalysisValidationAuditV4[]=[];
 const extraction=await inventory(update,chunks,'extractor',limits,generate,mentions,audit);
 // The second pass sees ONLY the original passages and the same policy, never extraction or its repairs.
 const checker=await inventory(update,chunks,'checker',limits,generate,mentions,audit);
 if(!extraction.candidates.length&&!checker.candidates.length)return analysisFailure('empty_keyword_inventory_requires_manual_review');
 let result;
 try{result=resolveKeywordPasses({content,contentKind:update.contentKind,captionHash:contentHash(content),transcriptSegments:update.transcriptSegments},extraction,checker);}
 catch(error){if(error&&typeof error==='object'&&'safeCode'in error&&typeof error.safeCode==='string')return analysisFailure(error.safeCode);throw error;}
 return boundedResult({state:result.pending.length?'review':'ready',patch:{keywordRuleVersion:'entities-v2'},pending:result.pending,
  evidence:{...result,protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,sourceContentState:sourceContentState(update),coverage:coverage(chunks),extraction:compactInventory(extraction),checker:compactInventory(checker),validationAudit:audit}});
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
export function analysisV4Numbers(text:string):string[]{return quantities(text).map(value=>value.number);}
function readPoints(value:unknown,lastId:string,passages:AnalysisPassageV4[],content:string,cues:AlignedAnalysisCueV4[],allowed?:Point[],context?:AnalysisProposalContextV4):Point[] {
 const validation=new Validation(),rows=validation.envelope(value,lastId,'highlights'),seen=new Set<string>(),points:Point[]=[];
 for(const [index,raw] of rows.entries()) {
  const path=`$.highlights[${index}]`,point=validation.object(raw,path,allowed?['text','passageIds','parentProposalId']:['text','passageIds']);
  if(!point)continue;
  const textOk=validation.require(nonempty(point.text,500)&&point.text.trim().split(/\s+/u).length<=38,'analysis_invalid_takeaways',path+'.text','One nonempty atomic finding of at most 38 words/500 characters without forbidden controls is required. Split compound claims into independently supported findings.');
  if(textOk){validation.require(!seen.has((point.text as string).trim()),'analysis_invalid_takeaways',path+'.text','Each finding must be distinct; repeated identical sentences are invalid.');seen.add((point.text as string).trim());}
  const evidence=validation.evidence(point.passageIds,path+'.passageIds',passages,content,15);
  const inherited=allowed?.find(old=>old.proposalId===point.parentProposalId);
  if(evidence&&allowed)validation.require(!!inherited&&inherited.passageIds.join('|')===evidence.passageIds.join('|'),'analysis_unsupported_reduction_quote',path+'.parentProposalId','A reduced finding must name ONE supplied trusted finding ID and retain EXACTLY its whole passage span.');
  if(textOk&&evidence) {
   const source=quantities(evidence.evidenceQuote),claimed=quantities(point.text as string);
   validation.require(claimed.every(value=>source.some(original=>original.number===value.number)),'analysis_unsupported_summary_number',path+'.text','EVERY whole numeric value in this sentence must occur in its own cited one-to-three passage span. Source-wide values, integer prefixes and unrelated distant measurements cannot supply support.');
   validation.require(claimed.every(value=>value.unit===null||source.some(original=>original.number===value.number&&original.unit===value.unit)),'analysis_unsupported_summary_unit',path+'.text','Every stated numeric unit/dimension must be supported for that SAME whole value inside the cited span. Only unambiguous written-unit/spacing equivalents are allowed; never infer missing temperatures/dimensions, convert ms to mV, restore map to MP or guess garbled units.');
   const startSeconds=evidenceTime(content,evidence.start,evidence.end,cues);
   const parent=context?.proposals[index];
   if(!validation.require(!!parent,'analysis_proposal_lineage_missing',path,'Trusted materialized proposal lineage is required.'))continue;
   points.push({text:(point.text as string).trim(),...evidence,...(startSeconds!==undefined?{startSeconds}:{}),proposalId:parent!.proposalId,lineage:[...(inherited?.lineage??[]),parent!]});
  }
 }
 validation.finish();return points;
}
function reductionRequest(points:Point[],level:number,group:number,limits:AnalysisLimits,hash:string,passages:AnalysisPassageV4[]):GenerationRequest {
 const ids=new Set(points.flatMap(point=>point.passageIds)),evidence=passages.filter(p=>ids.has(p.id));
 return {role:'summary-reduce',key:`summary-reduce:v4:level:${level}:group:${group}`,system:ANALYSIS_SYSTEM_V4,maxOutputTokens:limits.maxOutputTokens,schema:analysisV4ReductionSchema(evidence.map(p=>p.id),evidence.at(-1)!.id,points.map(point=>point.proposalId)),
  prompt:canonicalAnalysisV4Json({protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,task:'reduce_findings',policy:summaryPolicy,sourceHash:hash,
   instruction:ANALYSIS_V4_REDUCTION_INSTRUCTION,
   requiredLastPassageId:evidence.at(-1)!.id,findings:points.map(({proposalId,text,passageIds})=>({proposalId,text,passageIds})),passages:evidence.map(({id,text})=>({id,text}))})};
}
async function verifySummary(points:Point[],limits:AnalysisLimits,generate:AnalysisGenerator,audit:AnalysisValidationAuditV4[]) {
 const request:GenerationRequest={role:'summary',key:'summary:v4:verify:0',system:ANALYSIS_SYSTEM_V4,maxOutputTokens:limits.maxOutputTokens,schema:analysisV4VerificationSchema(points.map((_point,index)=>`s${index}`)),
  prompt:canonicalAnalysisV4Json({protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,task:'verify_summary',
   instruction:ANALYSIS_V4_VERIFIER_INSTRUCTION,
   claims:points.map((point,index)=>({id:`s${index}`,proposalId:point.proposalId,text:point.text,passageIds:point.passageIds,evidenceQuote:point.evidenceQuote,originalProposals:point.lineage.filter((parent,ancestor)=>!parent.opaqueParent&&(parent.corrected||ancestor<point.lineage.length-1)).map(parent=>({proposalId:parent.proposalId,text:parent.originalText,passageIds:parent.originalPassageIds,correctionReason:parent.correctionReason??null})),opaqueParentHashes:point.lineage.filter(parent=>parent.opaqueParent).map(parent=>parent.originalResponseHash)}))})};
 const verdicts=await generateValidatedAnalysisV4(request,generate,value=>{
  const body=object(value);
  // A recognizable rejection stays terminal even if another verdict is missing
  // or malformed. Shape repair must never turn a negative into agreement.
  if(Array.isArray(body.verdicts)&&body.verdicts.some(raw=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as ObjectValue).supported===false))return analysisFailure('analysis_unsupported_summary_claim');
  if(Array.isArray(body.verdicts)&&body.verdicts.some(raw=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as ObjectValue).sameFinding===false))return analysisFailure('analysis_correction_changed_finding');
  keys(body,['readComplete','verdicts']);
  if(body.readComplete!==true||!Array.isArray(body.verdicts)||body.verdicts.length!==points.length)return analysisFailure('analysis_incomplete_summary_verification');
  const seen=new Set<string>(),expected=new Set(points.map((_point,index)=>`s${index}`));
  return body.verdicts.map(raw=>{
   const verdict=object(raw);keys(verdict,['id','supported','sameFinding','reason']);
   if(typeof verdict.id!=='string'||!expected.has(verdict.id)||seen.has(verdict.id)
    ||typeof verdict.supported!=='boolean'||typeof verdict.sameFinding!=='boolean'||!nonempty(verdict.reason,240))return analysisFailure('analysis_invalid_summary_verification');
   seen.add(verdict.id);return {id:verdict.id,supported:verdict.supported,sameFinding:verdict.sameFinding,reason:verdict.reason};
  });
 },audit);
 // A negative verdict is a material semantic failure, NOT a malformed verdict to retry until it agrees.
 if(verdicts.some(verdict=>!verdict.supported))return analysisFailure('analysis_unsupported_summary_claim');
 return verdicts;
}
export async function analyzeSummaryV4(update:SourceUpdate,limits:AnalysisLimits,generate:AnalysisGenerator,context:AnalysisV4Context={}):Promise<AnalysisOutput> {
 checkContext(context);
 if(!usableAnalysisContent(update))return analysisFailure('usable_summary_content_required');
 const content=update.content!,hash=contentHash(content),chunks=planAnalysisV4Chunks(content,limits,'summary'),passages=[...new Map(chunks.flatMap(c=>c.passages).map(p=>[p.id,p])).values()],
  cues=alignAnalysisCuesV4(content,update.transcriptSegments||[]),audit:AnalysisValidationAuditV4[]=[],findings:Point[]=[];
 for(const chunk of chunks)findings.push(...await generateValidatedAnalysisV4(sourceRequest('summary',chunk,hash,limits,content),generate,
  (value,proposalContext)=>readPoints(value,chunk.passages.at(-1)!.id,chunk.passages,content,cues,undefined,proposalContext),audit));
 let selected=findings;const reductions:Array<{key:string;selected:Point[]}>=[];
 if(chunks.length>1&&findings.length) {
  let level=0;
  let groups=0;
  do {
   const reduced:Point[]=[];
   groups=Math.ceil(selected.length/ANALYSIS_V4_REDUCE_FINDINGS);
   for(let from=0,group=0;from<selected.length;from+=ANALYSIS_V4_REDUCE_FINDINGS,group++) {
    const inputs=selected.slice(from,from+ANALYSIS_V4_REDUCE_FINDINGS),request=reductionRequest(inputs,level,group,limits,hash,passages),prompt=JSON.parse(request.prompt),allowedIds=new Set(inputs.flatMap(p=>p.passageIds));
    const output=await generateValidatedAnalysisV4(request,generate,(value,proposalContext)=>{
     const result=readPoints(value,prompt.requiredLastPassageId,passages.filter(p=>allowedIds.has(p.id)),content,cues,inputs,proposalContext);
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
  evidence:{ruleVersion:'takeaways-v1',protocolVersion:ANALYSIS_V4_PROTOCOL,generationContractHash:ANALYSIS_V4_GENERATION_CONTRACT_HASH,contentHash:hash,sourceContentState:sourceContentState(update),coverage:coverage(chunks),
   emptyDisposition:selected.length?'findings_present':context.emptyDisposition,emptyReview:!selected.length?{basis:'trusted_full_saved_source',contentHash:hash,sourceReviewDigest:context.sourceReviewDigest??null}:null,
   findings:findings.map(compactPoint),selected,reductions:reductions.map(({key,selected:points})=>({key,selected:points.map(compactPoint)})),verification,validationAudit:audit}});
}

export { analysisV4CallPlan, planAnalysisV4Chunks } from './content-analysis-grounded-v4-source';
