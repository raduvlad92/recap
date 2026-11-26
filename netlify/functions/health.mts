import type { Config } from '@netlify/functions';
import { collectionHealth } from './_shared/collect-handler';
import { clerkAuthorizedParties, errorResponse, json, runtimeEnv } from './_shared/security';

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json({ error: { code: 'method_not_allowed', message: 'Use GET.' } }, 405);
  try {
    clerkAuthorizedParties(runtimeEnv);
    return json(collectionHealth());
  } catch (error) {
    return errorResponse(error);
  }
};
export const config: Config = { path: '/api/health' };
