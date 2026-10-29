import type { Config } from '@netlify/functions';
import { automaticContentWorkerAuthorized, createAutomaticContentWorker } from './_shared/automatic-content';

export default async(request:Request)=>{
 if(!automaticContentWorkerAuthorized(request))return new Response(null,{status:403});
 console.info(JSON.stringify({event:'automatic_content_finished',...await createAutomaticContentWorker()()}));
 return new Response(null,{status:204});
};
export const config:Config={background:true};
