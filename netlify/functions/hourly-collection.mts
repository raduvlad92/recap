import type { Config } from '@netlify/functions';
import { dispatchHourly } from './_shared/hourly-collection';

export default async () => {
 const result = await dispatchHourly();
 console.info(JSON.stringify({ event: 'hourly_collection_dispatch', ...result }));
};
// Minute zero every hour, UTC. Only dispatches; 39-source work runs in background.
export const config: Config = { schedule: '0 * * * *' };
