import type { Config } from '@netlify/functions';
import { dispatchSocial } from './_shared/social-collection';
export default async () => { console.info(JSON.stringify({ event: 'social_collection_dispatch', ...await dispatchSocial() })); };
// Frequent recovery dispatch; each shared source keeps an hourly due deadline.
export const config: Config = { schedule: '*/5 * * * *' };
