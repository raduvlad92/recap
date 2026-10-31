import type { Config } from '@netlify/functions';
import { dispatchSocialContent } from './_shared/social-content';

export default async()=>{console.info(JSON.stringify({event:'social_content_dispatch',...await dispatchSocialContent()}));};
export const config:Config={schedule:'*/5 * * * *'};
