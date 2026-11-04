import type { HostDownload, HostSourceRequest } from '../netlify/functions/_shared/host-runtime';
import { CollectionError, readTextLimited } from '../netlify/functions/_shared/security';
export async function downloadFromSourceService(service: { fetch(request: Request): Promise<Response> } | undefined, value: string, options: HostSourceRequest): Promise<HostDownload> {
  const url = options.validate(value);
  if (!service) throw new CollectionError(503, 'source_transport_unconfigured', 'Source transport is not configured.');
  const response = await service.fetch(new Request('https://source.internal/download', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(50000),
    body: JSON.stringify({ kind: options.kind, url: url.href, validators: { etag: options.headers['if-none-match'], lastModified: options.headers['if-modified-since'] } }),
  }));
  if (!response.ok) {
    let code = 'source_unavailable', upstreamStatus: number | undefined;
    try {
      const body = JSON.parse(await readTextLimited(response, 1024));
      if (typeof body.error === 'string' && /^[a-z_]{1,80}$/.test(body.error)) code = body.error;
      if (Number.isInteger(body.upstreamStatus) && body.upstreamStatus >= 100 && body.upstreamStatus <= 599) upstreamStatus = body.upstreamStatus;
    } catch { /* Keep bounded generic failure. */ }
    if (code === 'metadata_timeout') code = 'source_timeout';
    throw new CollectionError([400, 413, 422, 429, 502, 503, 504].includes(response.status) ? response.status : 422, code, 'The public source could not be retrieved safely.', upstreamStatus);
  }
  let result: HostDownload;
  try { result = JSON.parse(await readTextLimited(response, 3 * 1024 * 1024)); } catch { throw new CollectionError(502, 'source_response_invalid', 'The source transport response was invalid.'); }
  if (!result || typeof result.text !== 'string' || typeof result.url !== 'string' || typeof result.contentType !== 'string'
    || ![200, 304].includes(result.status || 0) || !Number.isSafeInteger(result.bytes) || result.bytes! < 0 || result.bytes! > options.maxBytes
    || Buffer.byteLength(result.text) > options.maxBytes * 2) throw new CollectionError(502, 'source_response_invalid', 'The source transport response exceeded its contract.');
  options.validate(result.url);
  return result;
}
