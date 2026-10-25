/** Private execution protocol. Public annotation rules deliberately remain unchanged. */
export const ANALYSIS_V2_PROTOCOL = 'content-v2' as const;
export const ANALYSIS_V2_REPAIR_LIMIT = 1 as const;
export const ANALYSIS_V2_PASSAGE_CHARS = 240;
export const ANALYSIS_V2_MAX_CITATION_PASSAGES = 3;
export const ANALYSIS_V2_REDUCE_FINDINGS = 18;
export const ANALYSIS_V2_RESULT_BYTES = 480000;

export interface AnalysisV2CallKey { baseKey:string; repairAttempt:0|1 }
/** Keep this grammar shared with the financial fence. Nested/unversioned repairs are forbidden. */
export function parseAnalysisV2CallKey(key:string):AnalysisV2CallKey|null {
 const match=/^((?:(?:summary|extractor|checker):v2:chunk:\d+|summary-reduce:v2:level:\d+:group:\d+|summary:v2:verify:0))(:repair:1)?$/.exec(key);
 return match?{baseKey:match[1],repairAttempt:match[2]?1:0}:null;
}
export const isAnalysisV2CallKey=(key:string):boolean=>parseAnalysisV2CallKey(key)!==null;

/** observedUsd is deliberately insufficient. Only durable settlement permits correction. */
export function hasKnownSettledAnalysisCharge(result:{actualUsd?:number|null}):boolean {
 return Object.prototype.hasOwnProperty.call(result,'actualUsd') && typeof result.actualUsd==='number'
  && Number.isFinite(result.actualUsd) && result.actualUsd>=0;
}
