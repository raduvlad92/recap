import { describe, expect, it, vi } from 'vitest';
import { createSourceDownloadHandler } from '../containers/source-handler';
import { downloadFromSourceService } from '../cloudflare/source-service';
import { CollectionError, publicHttpsUrl } from '../netlify/functions/_shared/security';
const payload = { text: '<feed/>', url: 'https://example.com/feed', contentType: 'application/xml', status: 200, bytes: 7 };
const request = (body: unknown) => new Request('http://source.internal/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const options = { kind: 'feed' as const, validate: publicHttpsUrl, headers: { 'if-none-match': '"existing"' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, redirects: 0 };
describe('private native Node source service', () => {
  it('preserves the download result and only forwards approved validators', async () => {
    const feed = vi.fn().mockResolvedValue(payload), handler = createSourceDownloadHandler({ feed });
    const response = await handler(request({ kind: 'feed', url: payload.url, validators: { etag: '"existing"' } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(payload);
    expect(feed).toHaveBeenCalledExactlyOnceWith(payload.url, 0, { etag: '"existing"' });
  });
  it.each(['https://127.0.0.1/feed', 'http://example.com/feed', 'https://name:password@example.com/feed', 'https://internal/feed'])('rejects unsafe targets using the original transport before DNS: %s', async url => {
    expect((await createSourceDownloadHandler()(request({ kind: 'feed', url }))).status).toBe(400);
  });
  it('rejects injected headers, unknown actions and credential-bearing payload fields', async () => {
    const feed = vi.fn(), handler = createSourceDownloadHandler({ feed });
    for (const body of [{ kind: 'shell', url: payload.url }, { kind: 'feed', url: payload.url, headers: { authorization: 'private' } }, { kind: 'feed', url: payload.url, validators: { secret: 'private' } }, null]) expect((await handler(request(body))).status).toBe(400);
    expect(feed).not.toHaveBeenCalled();
  });
  it('retains bounded known transport failures without exposing the original URL or body', async () => {
    const handler = createSourceDownloadHandler({ feed: async () => { throw new CollectionError(504, 'source_timeout', 'Sensitive upstream diagnostic'); } });
    const result = await handler(request({ kind: 'feed', url: payload.url }));
    expect(result.status).toBe(504); expect(await result.json()).toEqual({ error: 'source_timeout' });
  });
  it('uses a private service binding and keeps source/prompt data out of queue transport', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(payload));
    expect(await downloadFromSourceService({ fetch }, payload.url, options)).toEqual(payload);
    const sent = fetch.mock.calls[0][0] as Request; expect(sent.url).toBe('https://source.internal/download');
    expect(await sent.json()).toEqual({ kind: 'feed', url: payload.url, validators: { etag: '"existing"' } });
  });
  it('preserves the exact upstream HTTP failure through the private transport', async () => {
    const handler = createSourceDownloadHandler({ feed: async () => { throw new CollectionError(422, 'source_unavailable', 'Private source diagnostic', 404); } });
    await expect(downloadFromSourceService({ fetch: handler }, payload.url, options)).rejects.toMatchObject({ status: 422, code: 'source_unavailable', upstreamStatus: 404 });
  });
  it('fails closed on missing service, unsafe final URLs and oversized bodies', async () => {
    await expect(downloadFromSourceService(undefined, payload.url, options)).rejects.toMatchObject({ code: 'source_transport_unconfigured' });
    await expect(downloadFromSourceService({ fetch: async () => Response.json({ ...payload, url: 'https://127.0.0.1/private' }) }, payload.url, options)).rejects.toMatchObject({ code: 'unsafe_url' });
    await expect(downloadFromSourceService({ fetch: async () => Response.json({ ...payload, bytes: 3000000 }) }, payload.url, options)).rejects.toMatchObject({ code: 'source_response_invalid' });
  });
});
