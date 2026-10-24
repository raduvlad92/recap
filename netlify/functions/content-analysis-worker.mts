import type { Config } from '@netlify/functions';
import { analysisWorkerAuthorized,createAnalysisWorker } from './_shared/content-analysis';
export default async(request:Request)=>{
 if(!analysisWorkerAuthorized(request))return new Response(null,{status:403});
 const result=await createAnalysisWorker()();
 console.info(JSON.stringify({event:'content_analysis_finished',...result}));
 return new Response(null,{status:204});
};
export const config:Config={background:true};
