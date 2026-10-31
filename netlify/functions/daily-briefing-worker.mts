import type { Config } from '@netlify/functions';
import { createDailyBriefingWorker, dailyBriefingWorkerAuthorized } from './_shared/daily-briefing';
export default async (request: Request) => {
  if (!dailyBriefingWorkerAuthorized(request)) return new Response(null, { status: 403 });
  console.info(JSON.stringify({ event: 'daily_briefing_finished', ...await createDailyBriefingWorker()() }));
  return new Response(null, { status: 204 });
};
export const config: Config = { background: true };
