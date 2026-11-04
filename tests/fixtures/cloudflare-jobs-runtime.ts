import jobs from '../../cloudflare/jobs';
import { CollectionError } from '../../netlify/functions/_shared/security';
import type { Bindings, JobMessage } from '../../cloudflare/runtime';

// Local runtime harness only. This is never a deployment entrypoint.
export default { async fetch(request: Request, env: Bindings) {
  let acknowledgements = 0;
  const retries: number[] = [];
  const path = new URL(request.url).pathname;
  try {
    if (path === '/cron') await jobs.scheduled({ cron: '*/5 * * * *', scheduledTime: 300000 }, env);
    else {
      const body: JobMessage = { version: 1, kind: 'hourly-collection', epoch: path === '/stale' ? 1 : 2, release: env.RELEASE_SHA, key: 'fixture:hourly-collection:2' };
      await jobs.queue({ messages: [{ body, ack: () => { acknowledgements++; }, retry: options => { retries.push(options?.delaySeconds || 0); } }] }, env);
    }
    return Response.json({ completed: true, acknowledgements, retries });
  } catch (error) {
    return Response.json({ completed: false, code: error instanceof CollectionError ? error.code : 'fixture_error' }, { status: 503 });
  }
} };
