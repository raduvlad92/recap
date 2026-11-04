import hourly from '../netlify/functions/hourly-collection-worker.mts';
import analysis from '../netlify/functions/content-analysis-worker.mts';
import automatic from '../netlify/functions/automatic-content-worker.mts';
import social from '../netlify/functions/social-collection-worker.mts';
import socialContent from '../netlify/functions/social-content-worker.mts';
import briefing from '../netlify/functions/daily-briefing-worker.mts';
import reminder from '../netlify/functions/recap-reminder-worker.mts';
import learning from '../netlify/functions/keyword-learning-worker.mts';
import { assertActive, hostingRpc, readControl, runWithBindings, validMessage, type Bindings, type JobKind, type JobMessage } from './runtime';
import { json } from '../netlify/functions/_shared/security';

export const workers = { 'hourly-collection': hourly, 'content-analysis': analysis, 'automatic-content': automatic,
  'social-collection': social, 'social-content': socialContent, 'daily-briefing': briefing,
  'recap-reminders': reminder, 'keyword-learning': learning };
const flags: Record<JobKind, string> = {
  'hourly-collection': 'HOURLY_COLLECTION_ENABLED', 'content-analysis': 'CONTENT_ANALYSIS_ENABLED',
  'automatic-content': 'AUTOMATIC_CONTENT_ENABLED', 'social-collection': 'SOCIAL_COLLECTION_ENABLED',
  'social-content': 'SOCIAL_CONTENT_ENABLED', 'daily-briefing': 'DAILY_BRIEFING_ENABLED',
  'recap-reminders': 'REMINDER_EMAIL_ENABLED', 'keyword-learning': 'KEYWORD_LEARNING_ENABLED',
};
export interface QueueItem { body: unknown; ack(): void; retry(options?: { delaySeconds?: number }): void }
export async function enqueue(bindings: Bindings, message: JobMessage, payload: unknown = null): Promise<boolean> {
  if (!bindings.JOBS) throw new Error('Queue binding is missing');
  const accepted = await hostingRpc<boolean>(bindings, 'admit_hosting_work', {
    p_key: message.key, p_kind: message.kind, p_epoch: message.epoch, p_release: message.release, p_payload: payload,
  });
  if (!accepted) return false;
  await bindings.JOBS.send(message); return true;
}
export async function scheduleJobs(event: { cron: string; scheduledTime: number }, bindings: Bindings): Promise<void> {
  if (bindings.HOSTING_MODE !== 'active') return;
  const control = await readControl(bindings); assertActive(bindings, control);
  const kinds: JobKind[] = event.cron === '0 * * * *' ? ['hourly-collection']
    : event.cron === '*/5 * * * *' ? ['content-analysis', 'automatic-content', 'social-collection', 'social-content', 'daily-briefing', 'recap-reminders'] : [];
  const slot = Math.floor(event.scheduledTime / 300000);
  for (const kind of kinds) {
    // Preserve positive runtime gates. Omission never enables a new pipeline.
    if (bindings[flags[kind]] !== 'true') continue;
    await enqueue(bindings, { version: 1, kind, epoch: control.epoch, release: bindings.RELEASE_SHA, key: 'cron:' + kind + ':' + control.epoch + ':' + slot });
  }
}
export async function consumeJobs(batch: { messages: QueueItem[] }, bindings: Bindings): Promise<void> {
  for (const message of batch.messages) {
    if (!validMessage(message.body)) { console.warn(JSON.stringify({ event: 'hosting_invalid_message' })); message.ack(); continue; }
    const item = message.body;
    // A shadow deployment does not claim, reconcile or acknowledge real work.
    if (bindings.HOSTING_MODE !== 'active') { message.retry({ delaySeconds: 300 }); continue; }
    let control;
    try { control = await readControl(bindings); } catch { message.retry({ delaySeconds: 60 }); continue; }
    if (item.epoch !== control.epoch || item.release !== control.release) { message.ack(); continue; }
    try { assertActive(bindings, control); } catch { message.retry({ delaySeconds: 300 }); continue; }
    if (bindings[flags[item.kind]] !== 'true') { message.retry({ delaySeconds: 300 }); continue; }
    const claim = await hostingRpc<{ token: string; payload: unknown; busy?: boolean } | null>(bindings, 'begin_hosting_work', {
      p_key: item.key, p_kind: item.kind, p_epoch: item.epoch, p_release: item.release,
    });
    if (!claim) { message.ack(); continue; }
    if (claim.busy) { message.retry({ delaySeconds: 60 }); continue; }
    let completed = false;
    try {
      // A final owner check before entering domain code; domain-level leases,
      // source hashes and financial reservations remain the paid-call authority.
      assertActive(bindings, await readControl(bindings));
      const hourlySecret = item.kind === 'hourly-collection' || item.kind === 'social-collection';
      const header = hourlySecret ? 'x-hourly-collection-secret' : 'x-content-analysis-secret';
      const secret = bindings[hourlySecret ? 'HOURLY_COLLECTION_WORKER_SECRET' : 'CONTENT_ANALYSIS_WORKER_SECRET'];
      if (typeof secret !== 'string' || secret.length < 32) throw new Error('Worker authentication is not configured');
      const body = item.kind === 'keyword-learning' ? JSON.stringify(claim.payload) : '{}';
      const result = await runWithBindings(bindings, () => workers[item.kind](new Request(bindings.APP_URL + '/.netlify/functions/' + (item.kind === 'recap-reminders' ? 'recap-reminder' : item.kind) + '-worker', {
        method: 'POST', headers: { 'content-type': 'application/json', [header]: secret }, body,
      })));
      completed = result.status >= 200 && result.status < 300;
      await result.body?.cancel();
    } catch { console.warn(JSON.stringify({ event: 'hosting_work_uncertain', kind: item.kind })); }
    // Never replay an uncertain batch blindly. Exact underlying provider/model
    // receipts and reservations are reconciled by their existing domain paths.
    await hostingRpc(bindings, 'finish_hosting_work', { p_key: item.key, p_token: claim.token, p_epoch: item.epoch, p_completed: completed });
    message.ack();
  }
}
export default {
  fetch: async () => json({ error: { code: 'not_found' } }, 404),
  scheduled: scheduleJobs,
  queue: consumeJobs,
};
