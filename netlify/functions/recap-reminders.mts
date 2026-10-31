import type { Config } from '@netlify/functions';
import { dispatchRecapReminders } from './_shared/recap-reminders';
export default async () => { console.info(JSON.stringify({ event: 'recap_reminder_dispatch', ...await dispatchRecapReminders() })); };
export const config: Config = { schedule: '*/5 * * * *' };
