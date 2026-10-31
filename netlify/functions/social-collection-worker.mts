import type { Config } from '@netlify/functions';
import { createSocialCollector, socialWorkerAuthorized } from './_shared/social-collection';
export default async (request: Request) => {
 if (!socialWorkerAuthorized(request)) return new Response(null, { status: 403 });
 console.info(JSON.stringify({ event: 'social_collection_finished', ...await createSocialCollector()() }));
 return new Response(null, { status: 204 });
};
export const config: Config = { background: true };
