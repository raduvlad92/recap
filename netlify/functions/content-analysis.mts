import type { Config } from '@netlify/functions';
import { dispatchContentAnalysis } from './_shared/content-analysis';
export default async()=>{const result=await dispatchContentAnalysis();console.info(JSON.stringify({event:'content_analysis_dispatch',...result}));};
// Five-minute UTC queue scan catches new text and archive caption recovery. Runtime/policies remain off by default.
export const config:Config={schedule:'*/5 * * * *'};
