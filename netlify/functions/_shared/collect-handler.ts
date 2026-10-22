import type { Platform, Source } from '../../../src/lib/types';
import { apifyConfig, pollApify, startApify, YOUTUBE_ACTOR } from './apify';
import { startJob, finishJob } from './job-ledger';
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

interface Dependencies { env: Env; authenticate: typeof authenticate; collectFeed: typeof collectFeed; startApify: typeof startApify; pollApify: typeof pollApify; startJob: typeof startJob; finishJob: typeof finishJob }
export function createCollectHandler(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { env: runtimeEnv, authenticate, collectFeed, startApify, pollApify, startJob, finishJob, ...overrides };
  return async (request: Request): Promise<Response> => {
    let ledgerId: string | undefined;
    let owner: string | undefined;
    let providerStarted = false;
    try {
      if (!['POST', 'GET'].includes(request.method)) return json({ error: { code: 'method_not_allowed', message: 'Use POST to collect a source, or GET to check your job.' } }, 405);
      const userId = await deps.authenticate(request, deps.env);
      owner = userId;
      if (request.method === 'GET') {
        // Signed capability in a header avoids putting job tokens into URL logs.
        const token = request.headers.get('x-collection-job') || '';
        const result = await deps.pollApify(token, userId, deps.env);
        if (result.telemetry) {
          const {ledgerId:id,providerRunId,cost}=result.telemetry;
          const complete=result.status==='completed',failed=result.status==='failed';
          await deps.finishJob(id,userId,{status:complete?'succeeded':failed?'failed':'running',providerRunId,
            ...(complete?{resultCount:result.result?.updates.length ?? 0}:{}),
            ...(cost!==null?{observedCostUsd:cost,costStatus:'provider_reported' as const}:{})},deps.env);
        }
        const {telemetry:_private,...publicResult}=result;
        return json(publicResult);
      }
      if (!request.headers.get('content-type')?.includes('application/json')) throw new CollectionError(415, 'json_required', 'Send source details as JSON.');
      const text = await readTextLimited(new Response(request.body), 16_000);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { throw new CollectionError(400, 'invalid_json', 'Source details could not be read.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CollectionError(400, 'invalid_json', 'Send an object containing source details.');
      const source = validateSource(body.source);
      ledgerId = await deps.startJob({...source,...(source.platform==='YouTube'?{actorId:YOUTUBE_ACTOR}:{})},userId,deps.env);
      if (['Blog', 'Podcast', 'Substack'].includes(source.platform)) {
        const result=await deps.collectFeed(source);
        await deps.finishJob(ledgerId,userId,{status:'succeeded',resultCount:result.updates.length,observedCostUsd:0,costStatus:'no_provider_charge'},deps.env);
        ledgerId=undefined;
        return json({ status: 'completed', result });
      }
      if (source.platform === 'YouTube') {
        if (deps.env('HOURLY_COLLECTION_ENABLED') === 'true') {
          throw new CollectionError(503, 'managed_collection_only', 'YouTube updates are checked hourly with spending limits. This manual shortcut is disabled to keep those limits effective.');
        }
        const result=await deps.startApify(source,userId,deps.env,undefined,ledgerId);
        providerStarted=true;
        await deps.finishJob(ledgerId,userId,{status:'running',providerRunId:result.providerRunId},deps.env);
        return json(result,202);
      }
      throw new CollectionError(503, 'platform_not_configured', source.platform + ' collection is not configured in this version. Your source can stay saved for later.');
    } catch (error) {
      if(ledgerId && owner && !providerStarted) {
        try { await deps.finishJob(ledgerId,owner,{status:error instanceof CollectionError && [403,503].includes(error.status)?'blocked':'failed',errorCode:error instanceof CollectionError?error.code:'collection_failed'},deps.env); } catch { /* Original failure remains visible; no automatic provider retry. */ }
      }
      return errorResponse(error);
    }
  };
}

export function collectionHealth(env: Env = runtimeEnv) {
  const authConfigured = !!env('CLERK_ISSUER_URL') && !!env('APP_URL');
  const apifyEnabled = authConfigured && !!apifyConfig(env);
  return {
    authConfigured, feedEnabled: authConfigured, apifyEnabled,
    automaticScheduling: authConfigured && env('HOURLY_COLLECTION_ENABLED') === 'true' && (env('HOURLY_COLLECTION_WORKER_SECRET')?.length ?? 0) >= 32,
    platforms: Object.fromEntries(platforms.map((platform) => [platform, {
      configured: ['Blog', 'Podcast', 'Substack'].includes(platform) ? authConfigured : platform === 'YouTube' && apifyEnabled,
      mode: ['Blog', 'Podcast', 'Substack'].includes(platform) ? 'feed' : platform === 'YouTube' ? 'apify' : 'unavailable',
    }])),
  };
}
