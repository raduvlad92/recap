// Lossless source segmentation, literal boundaries and real cue alignment are
// deliberately shared with immutable v2. No v2 request, key or protocol is reused.
export {
 analysisPassagesV2 as analysisPassagesV4, alignAnalysisCuesV2 as alignAnalysisCuesV4,
 analysisEvidenceV2 as analysisEvidenceV4, literalMentionOffsetsV2 as literalMentionOffsetsV4,
 planAnalysisV2Chunks as planAnalysisV4Chunks,
 type AnalysisPassageV2 as AnalysisPassageV4, type AnalysisChunkV2 as AnalysisChunkV4,
 type AlignedAnalysisCueV2 as AlignedAnalysisCueV4,
} from './content-analysis-grounded-v2-source';
import type { AnalysisLimits } from './content-analysis-model';
import { analysisFailure } from './content-analysis-model';
import { planAnalysisV2Chunks } from './content-analysis-grounded-v2-source';
import { literalMentionOffsetsV2 } from './content-analysis-grounded-v2-source';
import { ANALYSIS_V4_PROTOCOL, ANALYSIS_V4_REDUCE_FINDINGS } from './content-analysis-grounded-v4-protocol';

export interface AnalysisLexicalUnitV4 { id:string; start:number; end:number; text:string }
/** Stable global UTF-16 identities. Whitespace remains in the supplied passages
 * and in every reconstructed range; source spelling is never normalized. Keep
 * C/C++/C# and Unicode combining marks inside their whole lexical identity. */
export function analysisLexicalUnitsV4(content:string,start=0,end=content.length):AnalysisLexicalUnitV4[] {
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>content.length
  ||start>0&&/[\uDC00-\uDFFF]/u.test(content[start])&&/[\uD800-\uDBFF]/u.test(content[start-1])
  ||end<content.length&&/[\uD800-\uDBFF]/u.test(content[end-1])&&/[\uDC00-\uDFFF]/u.test(content[end]))return analysisFailure('analysis_unsupported_mention');
 const units:AnalysisLexicalUnitV4[]=[];
 // Scan only this chunk, while consulting the complete original at its edges.
 // This has the same whole-unit identities as a complete-original scan, without
 // rescanning a million-character source for every resumable chunk/pass.
 const identityChar=(value:string|undefined)=>!!value&&/[\p{L}\p{M}\p{N}_+#]/u.test(value);
 for(const match of content.slice(start,end).matchAll(/[\p{L}\p{M}\p{N}_+#]+|[^\s\p{L}\p{M}\p{N}_+#]/gu)) {
  const at=start+match.index!,after=at+match[0].length;
  if(/^[\p{L}\p{M}\p{N}_+#]+$/u.test(match[0])
   &&(identityChar([...content.slice(Math.max(0,at-2),at)].at(-1))||identityChar([...content.slice(after,after+2)][0])))continue;
  units.push({id:`u${at}_${after}`,start:at,end:after,text:match[0]});
 }
 return units;
}
export function analysisMentionV4(content:string,units:AnalysisLexicalUnitV4[],firstId:unknown,lastId:unknown) {
 if(typeof firstId!=='string'||typeof lastId!=='string')return analysisFailure('analysis_unsupported_mention');
 const first=units.findIndex(unit=>unit.id===firstId),last=units.findIndex(unit=>unit.id===lastId);
 if(first<0||last<first)return analysisFailure('analysis_unsupported_mention');
 const selected=units.slice(first,last+1),start=selected[0].start,end=selected.at(-1)!.end,mention=content.slice(start,end);
 if(!mention||mention.length>100||mention!==mention.trim()||!/[\p{L}\p{N}]/u.test(mention)
  ||selected.some(unit=>content.slice(unit.start,unit.end)!==unit.text)
  ||!literalMentionOffsetsV2(content,mention).includes(start))return analysisFailure('analysis_unsupported_mention');
 return {mention,start,end};
}

/** Conservative fresh-call bounds; the terminal verifier cannot be repaired. */
export function analysisV4CallPlan(content:string,limits:AnalysisLimits) {
 const summaryChunks=planAnalysisV2Chunks(content,limits,'summary').length,keywordChunks=planAnalysisV2Chunks(content,limits,'keywords').length;
 let findings=summaryChunks*6,reductions=0;
 if(summaryChunks>1)do{const groups=Math.ceil(findings/ANALYSIS_V4_REDUCE_FINDINGS);reductions+=groups;findings=groups*6;}while(findings>6);
 const summaryBaseCallsMax=summaryChunks+reductions+1,keywordBaseCalls=keywordChunks*2;
 return {protocolVersion:ANALYSIS_V4_PROTOCOL,summaryChunks,keywordChunks,summaryBaseCallsMax,keywordBaseCalls,
  summaryCallsIncludingRepairsMax:(summaryBaseCallsMax-1)*2+1,keywordCallsIncludingRepairsMax:keywordBaseCalls*2};
}
