import type { Config } from '@netlify/functions';
import { socialContentWorkerAuthorized, createSocialContentWorker } from './_shared/social-content';

export default async(request:Request)=>{
 if(!socialContentWorkerAuthorized(request))return new Response(null,{status:403});
 console.info(JSON.stringify({event:'social_content_finished',...await createSocialContentWorker()()}));
 return new Response(null,{status:204});
};
export const config:Config={background:true};
