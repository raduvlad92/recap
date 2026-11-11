import { createHash } from 'node:crypto';
import { contentHash } from '../../../src/lib/content-processing';
import type { SourceUpdate } from '../../../src/lib/types';
import { AnalysisError } from './content-analysis-model';
import { planKeywordProductionChunks } from './keyword-production';

export const RECAP_QUALITY_CONTRACT = 'automatic-recap-atomic-v2';
export const RECAP_GENERATED_POINT_CHARACTERS = 240;
export interface RecapPoint { text:string; evidenceQuote:string }
export interface RecapCorrectionAdmission { sourceHash:string; contractVersion:typeof RECAP_QUALITY_CONTRACT; remainingUsd:number; remainingCalls:number; completedStages?:string[] }
export interface RecapQualityOptions { baseAdmission?:()=>Promise<RecapCorrectionAdmission|null>; correctionAdmission?:()=>Promise<RecapCorrectionAdmission|null> }
export interface RecapVerdict { index:number; supported:boolean; reason:string; status:'entailed'|'contradicted'|'insufficient' }
const fail=():never=>{throw new AnalysisError('automatic_recap_invalid_check');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const status=(v:unknown):v is RecapVerdict['status']=>v==='entailed'||v==='contradicted'||v==='insufficient';
const integer=(v:unknown):v is number=>Number.isSafeInteger(v);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');

/** Worst-case selection count is known before spending, even though drafts may
 * contain fewer findings. This is a bounded call plan, not a price estimate. */
export function planAutomaticRecap(record:SourceUpdate) {
 const chunks=planKeywordProductionChunks(record,'context-roles-v2');
 let findings=chunks.length*6,selectionCalls=0;
 while(findings>6){let remaining=0;for(let i=0;i<findings;i+=24){const group=Math.min(24,findings-i);if(group>6)selectionCalls++;remaining+=Math.min(6,group);}findings=remaining;}
 return {contractVersion:RECAP_QUALITY_CONTRACT,sourceHash:contentHash(record.content!),chunkCount:chunks.length,
  generationMaximumCalls:chunks.length+selectionCalls,verificationCalls:1,baseMaximumCalls:chunks.length+selectionCalls+1,
  correctionMaximumCalls:2,maximumCalls:chunks.length+selectionCalls+3,maximumPerCallUsd:.10,pointMaximumCharacters:RECAP_GENERATED_POINT_CHARACTERS};
}

/** UTF-16 offsets bind exact text (the same offsets as String.slice). Stable
 * passage IDs prevent context from being substituted for a support quote. */
export function recapEvidence(point:RecapPoint,content:string,sourceHash:string,index:number){
 const start=content.indexOf(point.evidenceQuote);if(start<0||contentHash(content)!==sourceHash)return fail();
 const end=start+point.evidenceQuote.length,quoteHash=hash(point.evidenceQuote);
 return {index,...point,evidenceSpan:{unit:'utf16',start,end,quoteHash,passageId:hash(sourceHash+':'+start+':'+end+':'+quoteHash)}};
}

export function recapVerificationSchema(count:number){
 const span={type:'object',additionalProperties:false,required:['start','end','text'],properties:{start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},text:{type:'string',minLength:1,maxLength:1000}}};
 const atom={type:'object',additionalProperties:false,required:['start','end','text','status','supportBasis','supportingSpans'],properties:{start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},text:{type:'string',minLength:1,maxLength:500},status:{type:'string',enum:['entailed','contradicted','insufficient']},supportBasis:{type:'string',enum:['quote','context','unknown']},supportingSpans:{type:'array',maxItems:8,items:span}}};
 return {type:'object',additionalProperties:false,required:['sourceHash','readComplete','verdicts'],properties:{sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},readComplete:{type:'boolean',const:true},verdicts:{type:'array',minItems:count,maxItems:count,items:{type:'object',additionalProperties:false,required:['index','quoteHash','status','wholeClaimSupported','contextConflict','reason','atoms'],properties:{index:{type:'integer',minimum:0,maximum:count-1},quoteHash:{type:'string',pattern:'^[a-f0-9]{64}$'},status:{type:'string',enum:['entailed','contradicted','insufficient']},wholeClaimSupported:{type:'boolean'},contextConflict:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:1000},atoms:{type:'array',minItems:1,maxItems:12,items:atom}}}}}};
}

/** This checks binding, complete claim coverage and quote-only supporting
 * spans. Entailment itself remains an independent model judgment, never proof
 * of external truth or owner publication approval. Any negative atom wins. */
export function validateRecapVerification(value:unknown,points:RecapPoint[],content:string,sourceHash:string):RecapVerdict[]{
 if(contentHash(content)!==sourceHash||!object(value)||!exact(value,['sourceHash','readComplete','verdicts'])||value.sourceHash!==sourceHash||value.readComplete!==true||!Array.isArray(value.verdicts)||value.verdicts.length!==points.length)return fail();
 const seen=new Set<number>();
 return value.verdicts.map(raw=>{
  if(!object(raw)||!exact(raw,['index','quoteHash','status','wholeClaimSupported','contextConflict','reason','atoms'])||!integer(raw.index)||raw.index<0||raw.index>=points.length||seen.has(raw.index)||!status(raw.status)||typeof raw.wholeClaimSupported!=='boolean'||typeof raw.contextConflict!=='boolean'||typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>4000||!Array.isArray(raw.atoms)||raw.atoms.length<1||raw.atoms.length>12)return fail();
  seen.add(raw.index);const point=points[raw.index],quote=point.evidenceQuote;
  if(!content.includes(quote)||raw.quoteHash!==hash(quote))return fail();
  const covered=new Uint8Array(point.text.length);let entailed=true,contradicted=raw.status==='contradicted';
  for(const atom of raw.atoms){
   if(!object(atom)||!exact(atom,['start','end','text','status','supportBasis','supportingSpans'])||!integer(atom.start)||!integer(atom.end)||atom.start<0||atom.end<=atom.start||atom.end>point.text.length||atom.text!==point.text.slice(atom.start,atom.end)||!status(atom.status)||!['quote','context','unknown'].includes(String(atom.supportBasis))||!Array.isArray(atom.supportingSpans)||atom.supportingSpans.length>8)return fail();
   covered.fill(1,atom.start,atom.end);if(atom.status==='contradicted')contradicted=true;
   if(atom.status!=='entailed'||atom.supportBasis!=='quote'||!atom.supportingSpans.length)entailed=false;
   const spans=new Set<string>();
   for(const span of atom.supportingSpans){
    if(!object(span)||!exact(span,['start','end','text'])||!integer(span.start)||!integer(span.end)||span.start<0||span.end<=span.start||span.end>quote.length||span.text!==quote.slice(span.start,span.end)||spans.has(span.start+':'+span.end))return fail();
    spans.add(span.start+':'+span.end);
   }
  }
  // Every letter/number must belong to an atom. An overall positive cannot
  // hide an unsupported second clause or omit an inconvenient qualifier.
  let offset=0;for(const character of point.text){if(/[\p{L}\p{N}]/u.test(character)&&!covered.slice(offset,offset+character.length).every(Boolean))entailed=false;offset+=character.length;}
  const supported=raw.status==='entailed'&&raw.wholeClaimSupported&&!raw.contextConflict&&entailed;
  return {index:raw.index,supported,status:supported?'entailed':contradicted?'contradicted':'insufficient',reason:(!supported&&raw.wholeClaimSupported?'Quote-only atomic support was incomplete or contradicted; the overall positive was rejected. ':'')+raw.reason.trim()};
 });
}

export function correctionAdmitted(scope:RecapCorrectionAdmission|null|undefined,sourceHash:string):boolean {
 const completed=new Set(scope?.completedStages?.filter(stage=>stage==='correct:1'||stage==='recheck:1'));
 const required=2-completed.size;
 return !!scope&&scope.sourceHash===sourceHash&&scope.contractVersion===RECAP_QUALITY_CONTRACT&&Number.isSafeInteger(scope.remainingCalls)&&scope.remainingCalls>=required&&Number.isFinite(scope.remainingUsd)&&scope.remainingUsd>=required/10;
}
