// Lossless source segmentation, literal boundaries and real cue alignment are
// deliberately shared with immutable v2. No v2 request, key or protocol is reused.
export {
 analysisPassagesV2 as analysisPassagesV3, alignAnalysisCuesV2 as alignAnalysisCuesV3,
 analysisEvidenceV2 as analysisEvidenceV3, literalMentionOffsetsV2 as literalMentionOffsetsV3,
 planAnalysisV2Chunks as planAnalysisV3Chunks,
 type AnalysisPassageV2 as AnalysisPassageV3, type AnalysisChunkV2 as AnalysisChunkV3,
 type AlignedAnalysisCueV2 as AlignedAnalysisCueV3,
} from './content-analysis-grounded-v2-source';
import type { AnalysisLimits } from './content-analysis-model';
import { planAnalysisV2Chunks } from './content-analysis-grounded-v2-source';
import { ANALYSIS_V3_PROTOCOL, ANALYSIS_V3_REDUCE_FINDINGS } from './content-analysis-grounded-v3-protocol';

/** Conservative fresh-call bounds; the terminal verifier cannot be repaired. */
export function analysisV3CallPlan(content:string,limits:AnalysisLimits) {
 const summaryChunks=planAnalysisV2Chunks(content,limits,'summary').length,keywordChunks=planAnalysisV2Chunks(content,limits,'keywords').length;
 let findings=summaryChunks*6,reductions=0;
 if(summaryChunks>1)do{const groups=Math.ceil(findings/ANALYSIS_V3_REDUCE_FINDINGS);reductions+=groups;findings=groups*6;}while(findings>6);
 const summaryBaseCallsMax=summaryChunks+reductions+1,keywordBaseCalls=keywordChunks*2;
 return {protocolVersion:ANALYSIS_V3_PROTOCOL,summaryChunks,keywordChunks,summaryBaseCallsMax,keywordBaseCalls,
  summaryCallsIncludingRepairsMax:(summaryBaseCallsMax-1)*2+1,keywordCallsIncludingRepairsMax:keywordBaseCalls*2};
}
