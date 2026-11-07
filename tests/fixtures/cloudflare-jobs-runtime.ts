import jobs, { workers } from '../../cloudflare/jobs';
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
      const automatic = path.startsWith('/automatic');
      if (automatic) workers['automatic-content'] = async () => new Response(null, { status: 204 });
      if (path === '/completed' || path === '/failed') workers['hourly-collection'] = async () => new Response(null, { status: path === '/completed' ? 202 : 503 });
      const body: JobMessage = { version: 1, kind: automatic ? 'automatic-content' : 'hourly-collection', epoch: path === '/stale' ? 1 : 2, release: env.RELEASE_SHA, key: automatic ? 'cron:automatic-content:2:1' : 'fixture:hourly-collection:2' };
      await jobs.queue({ messages: [{ id: path === '/automatic-missing-id' ? undefined : 'fixture-native-message', body, ack: () => { acknowledgements++; }, retry: options => { retries.push(options?.delaySeconds || 0); } }] }, automatic ? { ...env, AUTOMATIC_CONTENT_ENABLED: 'true', CONTENT_ANALYSIS_WORKER_SECRET: 'fixture-only-analysis-secret-32-characters' } : env);
    }
    return Response.json({ completed: true, acknowledgements, retries });
  } catch (error) {
    return Response.json({ completed: false, code: error instanceof CollectionError ? error.code : 'fixture_error' }, { status: 503 });
  }
} };
