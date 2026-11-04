import { downloadPublic, downloadYouTubeCaptions, type FeedValidators } from '../netlify/functions/_shared/feed';
import { downloadYouTubeChannelHtml, SourceMetadataError } from '../netlify/functions/_shared/youtube-channel-metadata';
import { CollectionError, readTextLimited } from '../netlify/functions/_shared/security';
interface Dependencies { feed: typeof downloadPublic; caption: typeof downloadYouTubeCaptions; metadata: typeof downloadYouTubeChannelHtml }
/** Private container endpoint. Uses the existing native Node HTTPS/DNS pinning
 * implementation, without any database, model, scraper or identity credential. */
export function createSourceDownloadHandler(overrides: Partial<Dependencies> = {}) {
  const deps = { feed: downloadPublic, caption: downloadYouTubeCaptions, metadata: downloadYouTubeChannelHtml, ...overrides };
  return async (request: Request): Promise<Response> => {
    try {
      if (new URL(request.url).pathname !== '/download' || request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
      if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'json_required' }, { status: 415 });
      const input: unknown = JSON.parse(await readTextLimited(new Response(request.body), 16000));
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CollectionError(400, 'invalid_source_request', 'Invalid request');
      const body = input as Record<string, unknown>;
      if (Object.keys(body).some(key => !['kind', 'url', 'validators'].includes(key)) || typeof body.url !== 'string' || body.url.length > 4096
        || !['feed', 'caption', 'metadata'].includes(String(body.kind)) || body.validators === null
        || (body.validators !== undefined && (typeof body.validators !== 'object' || Array.isArray(body.validators)
        || Object.keys(body.validators).some(key => !['etag', 'lastModified'].includes(key))))) throw new CollectionError(400, 'invalid_source_request', 'Invalid request');
      if (body.kind === 'metadata') {
        const text = await deps.metadata(body.url);
        return Response.json({ text, url: body.url, contentType: 'text/html', status: 200, bytes: Buffer.byteLength(text) });
      }
      const result = body.kind === 'caption' ? await deps.caption(body.url) : await deps.feed(body.url, 0, body.validators as FeedValidators | undefined);
      return Response.json(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') return Response.json({ error: 'source_tls_identity_invalid' }, { status: 422 });
      const known = error instanceof CollectionError || error instanceof SourceMetadataError;
      return Response.json({ error: known ? error.code : error instanceof SyntaxError ? 'invalid_source_request' : 'source_unavailable',
        ...(error instanceof CollectionError && error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}) }, { status: known ? error.status : error instanceof SyntaxError ? 400 : 502 });
    }
  };
}
