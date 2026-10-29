import type { Config } from '@netlify/functions';
import { dispatchAutomaticContent } from './_shared/automatic-content';

export default async()=>{console.info(JSON.stringify({event:'automatic_content_dispatch',...await dispatchAutomaticContent()}));};
export const config:Config={schedule:'*/5 * * * *'};
