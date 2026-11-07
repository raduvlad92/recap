import type { Config } from '@netlify/functions';
import { analysisWorkerAuthorized } from './_shared/content-analysis';
import { createAccountLifecycleWorker } from './_shared/account-lifecycle';
export default async (request: Request) => {
  if (request.method !== 'POST' || !analysisWorkerAuthorized(request)) return new Response(null, { status: 403 });
  await createAccountLifecycleWorker()();
  return new Response(null, { status: 204 });
};
export const config: Config = { background: true };
