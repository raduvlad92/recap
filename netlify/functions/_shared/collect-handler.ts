import type { Platform, Source } from '../../../src/lib/types';
import { apifyConfig, pollApify, startApify } from './apify';
import { collectFeed, plainText } from './feed';
import { authenticate, CollectionError, errorResponse, json, publicHttpsUrl, readTextLimited, runtimeEnv, type Env } from './security';

const platforms: Platform[] = ['YouTube', 'X', 'Instagram', 'LinkedIn', 'Podcast', 'Substack', 'Blog'];

export function validateSource(value: unknown): Source {
  if (!value || typeof value !== 'object') throw new CollectionError(400, 'invalid_source', 'Choose a source to collect.');
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(input.id) || !platforms.includes(input.platform as Platform)) {
    throw new CollectionError(400, 'invalid_source', 'This source has an invalid identifier or platform.');
  }
  const url = publicHttpsUrl(input.url);
  const host = url.hostname.replace(/^www\./, '');
  const knownPlatform: Platform | undefined = ['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) ? 'YouTube' :
    ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host) ? 'X' : host === 'instagram.com' ? 'Instagram' :
    host === 'linkedin.com' ? 'LinkedIn' : undefined;
  if (knownPlatform && knownPlatform !== input.platform) throw new CollectionError(400, 'platform_mismatch', 'The source link does not match its selected platform.');
  const feedUrl = input.feedUrl === undefined ? undefined : publicHttpsUrl(input.feedUrl).href;
  return {
    id: input.id, name: plainText(input.name, 120) || url.hostname, url: url.href, platform: input.platform as Platform,
    creatorIds: Array.isArray(input.creatorIds) ? input.creatorIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id)).slice(0, 10) : [],
    status: 'pending', ...(feedUrl ? { feedUrl } : {}),
  };
}

interface Dependencies { env: Env; authenticate: typeof authenticate; collectFeed: typeof collectFeed; startApify: typeof startApify; pollApify: typeof pollApify }
export function createCollectHandler(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { env: runtimeEnv, authenticate, collectFeed, startApify, pollApify, ...overrides };
  return async (request: Request): Promise<Response> => {
    try {
      if (!['POST', 'GET'].includes(request.method)) return json({ error: { code: 'method_not_allowed', message: 'Use POST to collect a source, or GET to check your job.' } }, 405);
      const userId = await deps.authenticate(request, deps.env);
      if (request.method === 'GET') {
        // Signed capability in a header avoids putting job tokens into URL logs.
        const token = request.headers.get('x-collection-job') || '';
        return json(await deps.pollApify(token, userId, deps.env));
      }
      if (!request.headers.get('content-type')?.includes('application/json')) throw new CollectionError(415, 'json_required', 'Send source details as JSON.');
      const text = await readTextLimited(new Response(request.body), 16_000);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { throw new CollectionError(400, 'invalid_json', 'Source details could not be read.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CollectionError(400, 'invalid_json', 'Send an object containing source details.');
      const source = validateSource(body.source);
      if (['Blog', 'Podcast', 'Substack'].includes(source.platform)) {
        return json({ status: 'completed', result: await deps.collectFeed(source) });
      }
      if (source.platform === 'YouTube') return json(await deps.startApify(source, userId, deps.env), 202);
      throw new CollectionError(503, 'platform_not_configured', source.platform + ' collection is not configured in this version. Your source can stay saved for later.');
    } catch (error) { return errorResponse(error); }
  };
}

export function collectionHealth(env: Env = runtimeEnv) {
  const authConfigured = !!env('CLERK_ISSUER_URL') && !!env('APP_URL');
  const apifyEnabled = authConfigured && !!apifyConfig(env);
  return {
    authConfigured, feedEnabled: authConfigured, apifyEnabled, automaticScheduling: false,
    platforms: Object.fromEntries(platforms.map((platform) => [platform, {
      configured: ['Blog', 'Podcast', 'Substack'].includes(platform) ? authConfigured : platform === 'YouTube' && apifyEnabled,
      mode: ['Blog', 'Podcast', 'Substack'].includes(platform) ? 'feed' : platform === 'YouTube' ? 'apify' : 'unavailable',
    }])),
  };
}
