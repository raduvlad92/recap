import type { Config } from '@netlify/functions';
import { collectionHealth } from './_shared/collect-handler';
import { json } from './_shared/security';

export default async (request: Request): Promise<Response> => request.method === 'GET'
  ? json(collectionHealth()) : json({ error: { code: 'method_not_allowed', message: 'Use GET.' } }, 405);
export const config: Config = { path: '/api/health' };
