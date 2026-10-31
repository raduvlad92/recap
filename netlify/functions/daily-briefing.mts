import type { Config } from '@netlify/functions';
import { dispatchDailyBriefings } from './_shared/daily-briefing';
export default async () => { console.info(JSON.stringify({ event: 'daily_briefing_dispatch', ...await dispatchDailyBriefings() })); };
export const config: Config = { schedule: '*/5 * * * *' };
