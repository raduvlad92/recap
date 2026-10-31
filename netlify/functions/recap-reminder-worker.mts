import type { Config } from '@netlify/functions';
import { createRecapReminderWorker, reminderWorkerAuthorized } from './_shared/recap-reminders';
export default async (request: Request) => {
  if (!reminderWorkerAuthorized(request)) return new Response(null, { status: 403 });
  console.info(JSON.stringify({ event: 'recap_reminder_finished', ...await createRecapReminderWorker()() }));
  return new Response(null, { status: 204 });
};
export const config: Config = { background: true };
