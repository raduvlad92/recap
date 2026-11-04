import { handlers, limits, routeName } from './handlers';
import { assertActive, hostingRpc, readControl, runWithBindings, type Bindings } from './runtime';
import { randomUUID, createHash } from 'node:crypto';
import { enqueue } from './jobs';
import { database, requireAdmin } from '../netlify/functions/_shared/admin-data';
import { analysisWorkerAuthorized } from '../netlify/functions/_shared/content-analysis';
import { parseKeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import { authenticate, CollectionError, runtimeEnv, readTextLimited } from '../netlify/functions/_shared/security';
import { errorResponse, json } from '../netlify/functions/_shared/security';

const staticHeaders: Record<string, string> = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
export function secureResponse(response: Response, app = false): Response {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(staticHeaders)) if (!result.headers.has(key)) result.headers.set(key, value);
  if (runtimeEnv('HOSTING_MODE') === 'shadow') result.headers.set('x-robots-tag', 'noindex, nofollow');
  if (app) result.headers.set('cache-control', 'no-store');
  return result;
}
export async function handleWeb(request: Request, bindings: Bindings): Promise<Response> {
  return runWithBindings(bindings, async () => {
    try {
      const url = new URL(request.url), name = routeName(url.pathname);
      if (url.pathname === '/api/migration-verification') {
        if (bindings.HOSTING_MODE !== 'shadow') return secureResponse(json({ error: { code: 'not_found' } }, 404), true);
        if (request.method !== 'GET') return secureResponse(json({ error: { code: 'method_not_allowed' } }, 405), true);
        const limiter = bindings.LIMIT_ADMIN as { limit(options: { key: string }): Promise<{ success: boolean }> } | undefined;
        if (limiter && !(await limiter.limit({ key: 'migration:' + (request.headers.get('cf-connecting-ip') || 'unknown') })).success) return secureResponse(json({ error: { code: 'rate_limited' } }, 429), true);
        const userId = await requireAdmin(request);
        const control = await readControl(bindings);
        if (!control.paused) throw new CollectionError(503, 'verification_unavailable', 'The isolated account check is unavailable.');
        const { count, error } = await database().from('reader_workspaces').select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
        if (error) throw new Error('Workspace verification failed');
        return secureResponse(json({ authenticated: true, administrator: true, workspacePresent: count === 1, processingPaused: control.paused, release: bindings.RELEASE_SHA }), true);
      }
      if (url.pathname === '/robots.txt') return secureResponse(new Response('User-agent: *\nDisallow: /\nAllow: /creators\nAllow: /catalogue.css\nAllow: /fonts/\nAllow: /favicon.svg\nSitemap: ' + bindings.APP_URL + '/sitemap.xml\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } }));
      if (name) {
        const handler = handlers[name];
        // Background/scheduler URLs have no public execution path here.
        if (!handler && name !== 'keyword-learning-worker') return secureResponse(json({ error: { code: 'not_found' } }, 404), true);
        if (name === 'health' && request.method === 'GET') {
          const original = await (await handler(request)).json();
          return secureResponse(json({ ...original, hosting: { provider: 'cloudflare', mode: bindings.HOSTING_MODE, release: bindings.RELEASE_SHA, jobsConfigured: bindings.HOSTING_MODE === 'active' } }), true);
        }
        const limiter = bindings['LIMIT_' + name.replace(/-/g, '_').toUpperCase()] as { limit(options: { key: string }): Promise<{ success: boolean }> } | undefined;
        if (limiter && limits[name]) {
          // The native limiter supplies an additional approximate per-location
          // ceiling. Database admission, not this limiter, controls spending.
          const ip = request.headers.get('cf-connecting-ip') || 'unknown';
          const bucket = Math.floor(Date.now() / 60000);
          const limit = await limiter.limit({ key: name + ':' + url.hostname + ':' + ip + ':' + bucket });
          if (!limit.success) return secureResponse(json({ error: { code: 'rate_limited' } }, 429), true);
        }
        // Several nominal GET operations reconcile jobs/audit admin access.
        // Shadow is intentionally limited to public catalogue/health/static.
        if (bindings.HOSTING_MODE !== 'active' && name !== 'catalogue' && name !== 'source-metadata') {
          return secureResponse(json({ error: { code: 'hosting_shadow_read_only', message: 'The duplicate is being verified.' } }, 503), true);
        }
        if (bindings.HOSTING_MODE === 'active' && name !== 'catalogue' && name !== 'source-metadata') {
          const control = await readControl(bindings); assertActive(bindings, control);
          if (name === 'keyword-learning-worker') {
            if (request.method !== 'POST') return secureResponse(json({ error: { code: 'method_not_allowed' } }, 405), true);
            if (!analysisWorkerAuthorized(request)) await requireAdmin(request);
            if (new URL(request.url).origin !== bindings.APP_URL || !request.headers.get('content-type')?.includes('application/json')) return secureResponse(json({ error: { code: 'invalid_request' } }, 400), true);
            const body = JSON.parse(await readTextLimited(new Response(request.body), 220000));
            const input = parseKeywordLearningInput(body);
            if (input.action !== 'generate' || bindings.KEYWORD_LEARNING_ENABLED !== 'true') return secureResponse(json({ error: { code: 'generation_disabled' } }, 503), true);
            const key = 'manual:keyword-learning:' + createHash('sha256').update(JSON.stringify(body)).digest('hex');
            await enqueue(bindings, { version: 1, key, kind: 'keyword-learning', epoch: control.epoch, release: bindings.RELEASE_SHA }, body);
            return secureResponse(json({ accepted: true }, 202), true);
          }
          if (!['reminder-events', 'reminder-unsubscribe'].includes(name) && !analysisWorkerAuthorized(request)) await authenticate(request, runtimeEnv);
          const key = 'http:' + randomUUID();
          await hostingRpc(bindings, 'admit_hosting_work', { p_key: key, p_kind: 'http', p_epoch: control.epoch, p_release: bindings.RELEASE_SHA, p_payload: null });
          const claim = await hostingRpc<{ token: string } | null>(bindings, 'begin_hosting_work', { p_key: key, p_kind: 'http', p_epoch: control.epoch, p_release: bindings.RELEASE_SHA });
          if (!claim) return secureResponse(json({ error: { code: 'hosting_execution_paused' } }, 503), true);
          let completed = false;
          try { const result = await handler(request); completed = result.status < 500; return secureResponse(result, true); }
          finally { await hostingRpc(bindings, 'finish_hosting_work', { p_key: key, p_token: claim.token, p_epoch: control.epoch, p_completed: completed }); }
        }
        // Catalogue routing depends on its original path rather than its alias.
        if (name === 'catalogue' && url.pathname.startsWith('/.netlify/')) return secureResponse(json({ error: { code: 'not_found' } }, 404), true);
        const response = await handler(request);
        return secureResponse(response, name !== 'catalogue');
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return secureResponse(json({ error: { code: 'not_found' } }, 404), true);
      if (!bindings.ASSETS) return secureResponse(json({ error: { code: 'assets_unconfigured' } }, 503), true);
      return secureResponse(await bindings.ASSETS.fetch(request));
    } catch (error) { return secureResponse(errorResponse(error), true); }
  });
}
export default { fetch: handleWeb };
