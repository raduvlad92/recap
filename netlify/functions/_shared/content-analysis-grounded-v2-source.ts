import type { SourceUpdate } from '../../../src/lib/types';
import { analysisFailure, type AnalysisLimits } from './content-analysis-model';
import { ANALYSIS_V2_PASSAGE_CHARS, ANALYSIS_V2_PROTOCOL, ANALYSIS_V2_REDUCE_FINDINGS } from './content-analysis-grounded-v2-protocol';

export interface AnalysisPassageV2 { id:string; start:number; end:number; text:string }
export interface AnalysisChunkV2 { index:number; start:number; end:number; passages:AnalysisPassageV2[] }
export type AnalysisTaskV2='summary'|'keywords';
type Cue=NonNullable<SourceUpdate['transcriptSegments']>[number];
export interface AlignedAnalysisCueV2 { start:number; end:number; startSeconds:number; durationSeconds?:number }
export const nonnegativeFiniteV2=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const highSurrogate=(s:string)=>/[\uD800-\uDBFF]/.test(s);

/** Never normalize, trim, omit, or split a surrogate pair in the saved original. */
export function analysisPassagesV2(content:string):AnalysisPassageV2[] {
 const passages:AnalysisPassageV2[]=[];
 for(let start=0;start<content.length;) {
  let end=Math.min(content.length,start+ANALYSIS_V2_PASSAGE_CHARS);
  if(end<content.length&&highSurrogate(content[end-1]))end--;
  if(end<content.length) {
   // Prefer a natural boundary, but retain the boundary character verbatim.
   const floor=Math.max(start+Math.floor(ANALYSIS_V2_PASSAGE_CHARS*.75),end-60);
   for(let at=end-1;at>=floor;at--)if(/\s/u.test(content[at])){end=at+1;break;}
  }
  passages.push({id:`p${start}_${end}`,start,end,text:content.slice(start,end)});
  start=end;
 }
 return passages;
}

/** Deterministic input/output capacity plan. Overflow stops before the first paid request. */
export function planAnalysisV2Chunks(content:string,limits:AnalysisLimits,task:AnalysisTaskV2):AnalysisChunkV2[] {
 if(!content.trim()||!Number.isSafeInteger(limits.maxSourceChars)||content.length>limits.maxSourceChars
  ||!Number.isSafeInteger(limits.chunkChars)||limits.chunkChars<ANALYSIS_V2_PASSAGE_CHARS*2
  ||!Number.isSafeInteger(limits.maxChunks)||limits.maxChunks<1)return analysisFailure('analysis_source_capacity');
 if(!Number.isSafeInteger(limits.maxOutputTokens)||limits.maxOutputTokens<1024)return analysisFailure('analysis_output_capacity');
 const cap=task==='keywords'?Math.min(limits.chunkChars,Math.floor(limits.maxOutputTokens/2)):limits.chunkChars;
 const passages=analysisPassagesV2(content),chunks:AnalysisChunkV2[]=[];
 for(let from=0;from<passages.length;) {
  let to=from;
  while(to<passages.length&&passages[to].end-passages[from].start<=cap)to++;
  if(to===from)return analysisFailure('analysis_source_capacity');
  const selected=passages.slice(from,to);
  chunks.push({index:chunks.length,start:selected[0].start,end:selected.at(-1)!.end,passages:selected});
  if(chunks.length>limits.maxChunks)return analysisFailure('analysis_source_capacity');
  if(to===passages.length)break;
  from=to-Math.min(2,to-from-1);
 }
 return chunks;
}

/** Counts are conservative planning bounds, never claimed provider executions. */
export function analysisV2CallPlan(content:string,limits:AnalysisLimits) {
 const summaryChunks=planAnalysisV2Chunks(content,limits,'summary').length,keywordChunks=planAnalysisV2Chunks(content,limits,'keywords').length;
 let findings=summaryChunks*6,reductions=0;
 if(summaryChunks>1)do {const groups=Math.ceil(findings/ANALYSIS_V2_REDUCE_FINDINGS);reductions+=groups;findings=groups*6;}while(findings>6);
 const summaryBaseCallsMax=summaryChunks+reductions+1,keywordBaseCalls=keywordChunks*2;
 return {protocolVersion:ANALYSIS_V2_PROTOCOL,summaryChunks,keywordChunks,summaryBaseCallsMax,keywordBaseCalls,
  summaryCallsIncludingRepairsMax:summaryBaseCallsMax*2,keywordCallsIncludingRepairsMax:keywordBaseCalls*2};
}

const identityChar=(c:string|undefined)=>!!c&&/[\p{L}\p{N}_+#]/u.test(c);
/** Test the actual surrounding original, not only the shorter quoted substring. */
export function literalMentionOffsetsV2(content:string,mention:string):number[] {
 if(!mention)return [];
 const offsets:number[]=[];
 for(let at=content.indexOf(mention);at>=0;at=content.indexOf(mention,at+1)) {
  const before=at?[...content.slice(Math.max(0,at-2),at)].at(-1):undefined;
  const after=[...content.slice(at+mention.length,at+mention.length+2)][0];
  if(!identityChar(before)&&!identityChar(after))offsets.push(at);
 }
 return offsets;
}

function normalizedOffsets(text:string) {
 let normalized='';const starts:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(/\s/u.test(c)) {
   if(!normalized)continue;
   if(normalized.endsWith(' ')){ends[ends.length-1]=i+1;continue;}
   normalized+=' ';starts.push(i);ends.push(i+1);
  }else{normalized+=c;starts.push(i);ends.push(i+1);}
 }
 if(normalized.endsWith(' ')){normalized=normalized.slice(0,-1);starts.pop();ends.pop();}
 return {text:normalized,starts,ends};
}
/** Full cue alignment or unique literal normalized matches only. Ambiguous partial timing stays unknown. */
export function alignAnalysisCuesV2(content:string,cues:Cue[]):AlignedAnalysisCueV2[] {
 const original=normalizedOffsets(content),rows=cues.filter(c=>typeof c.text==='string'&&c.text.trim()).map(c=>({cue:c,text:normalizedOffsets(c.text).text}));
 const complete=rows.map(row=>row.text).join(' ')===original.text;
 const aligned:AlignedAnalysisCueV2[]=[];let cursor=0;
 for(const {cue,text}of rows) {
  const at=complete?cursor:original.text.indexOf(text);
  cursor+=text.length+1;
  if(at<0||!nonnegativeFiniteV2(cue.startSeconds)||!complete&&original.text.indexOf(text,at+1)>=0)continue;
  const start=original.starts[at],end=original.ends[at+text.length-1];
  if(start===undefined||end===undefined)continue;
  aligned.push({start,end,startSeconds:cue.startSeconds,...(nonnegativeFiniteV2(cue.durationSeconds)&&cue.durationSeconds>0?{durationSeconds:cue.durationSeconds}:{})});
 }
 // Two partial cues mapped to the same words cannot establish which time is real.
 // Keep ambiguous rows in this comparison: removing a conflicting pair first
 // would let a nested third cue incorrectly survive with invented certainty.
 const unambiguous=[...new Map(aligned.map(row=>[`${row.start}:${row.end}:${row.startSeconds}:${row.durationSeconds??'unknown'}`,row])).values()].sort((a,b)=>a.start-b.start);
 const conflicts=new Set<AlignedAnalysisCueV2>();
 for(let i=0;i<unambiguous.length;i++)for(let j=i+1;j<unambiguous.length&&unambiguous[j].start<unambiguous[i].end;j++) {
  if(unambiguous[i].startSeconds!==unambiguous[j].startSeconds||unambiguous[i].durationSeconds!==unambiguous[j].durationSeconds) {
   conflicts.add(unambiguous[i]);conflicts.add(unambiguous[j]);
  }
 }
 return unambiguous.filter(row=>!conflicts.has(row));
}

export function analysisEvidenceV2(content:string,passages:AnalysisPassageV2[],ids:unknown,min=1) {
 if(!Array.isArray(ids)||ids.length<1||ids.length>3||ids.some(id=>typeof id!=='string'))return analysisFailure('analysis_unsupported_passage');
 const selected=ids.map(id=>passages.find(p=>p.id===id));
 if(selected.some(p=>!p))return analysisFailure('analysis_unsupported_passage');
 const found=selected as AnalysisPassageV2[];
 if(found.some((p,i)=>i>0&&found[i-1].end!==p.start))return analysisFailure('analysis_unsupported_passage');
 const start=found[0].start,end=found.at(-1)!.end,quote=content.slice(start,end);
 if(quote.trim().length<min||quote.length>1000||found.map(p=>p.text).join('')!==quote)return analysisFailure('analysis_unsupported_quote');
 return {evidenceQuote:quote,start,end,passageIds:ids as string[]};
}
