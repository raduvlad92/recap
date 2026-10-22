import type { Config } from '@netlify/functions';
import { createHourlyCollector, hourlyWorkerAuthorized } from './_shared/hourly-collection';

export default async (request: Request) => {
 if (!hourlyWorkerAuthorized(request)) {
  console.warn(JSON.stringify({ event: 'hourly_collection_unauthorized' }));
  return new Response(null, { status: 403 });
 }
 const result = await createHourlyCollector()();
 // Aggregate only: no reader identity, signed token, raw errors or source data.
 console.info(JSON.stringify({ event: 'hourly_collection_finished', ...result }));
 return new Response(null, { status: 204 });
};
export const config: Config = { background: true };
