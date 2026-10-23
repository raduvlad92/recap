import { describe, expect, it, vi } from 'vitest';
import { downloadYouTubeFeed, youtubeFeedUrl } from '../netlify/functions/_shared/feed';
import { CollectionError } from '../netlify/functions/_shared/security';

const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv';
const unavailable = () => vi.fn().mockRejectedValue(new CollectionError(422, 'source_unavailable', 'Restricted response', 503));

describe('bounded first-party YouTube feed transport', () => {
  it.each([
    url.replace('www.youtube.com', 'evil.example'), url.replace('www.youtube.com', 'youtube.com'),
    url.replace('/feeds/videos.xml', '/redirect'), url + '&next=https://127.0.0.1',
    url + '&channel_id=UCabcdefghijklmnopqrstuv', url.replace('https:', 'http:'),
    url.replace('www.youtube.com', 'www.youtube.com:8443'), url.replace('channel_id=UC', 'channel_id='),
    url.replace('www.youtube.com', 'user:pass@www.youtube.com'),
  ])('rejects any target outside the exact trusted feed contract: %s', async (target) => {
    const primary = unavailable(), fetcher = vi.fn();
    expect(() => youtubeFeedUrl(target)).toThrow();
    await expect(downloadYouTubeFeed(target, {}, primary, fetcher)).rejects.toBeInstanceOf(CollectionError);
    expect(primary).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the original pinned response without another network request', async () => {
    const response = { text: '<feed/>', url, contentType: 'application/atom+xml', status: 200 };
    const primary = vi.fn().mockResolvedValue(response), fetcher = vi.fn();
    expect(await downloadYouTubeFeed(url, { etag: '"v2"' }, primary, fetcher)).toBe(response);
    expect(primary).toHaveBeenCalledWith(url, 0, { etag: '"v2"' }); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['unsafe_address', 'dns_timeout', 'source_timeout', 'redirect_limit', 'feed_too_large'])('never retries a failed safety or resource boundary: %s', async (code) => {
    const error = new CollectionError(400, code, 'Stopped');
    const primary = vi.fn().mockRejectedValue(error), fetcher = vi.fn();
    await expect(downloadYouTubeFeed(url, {}, primary, fetcher)).rejects.toBe(error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retries only once at the fixed origin, refusing redirects and preserving validated conditions', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<feed/>', { headers: { 'content-type': 'application/atom+xml', etag: '"v3"' } }));
    const primary = unavailable();
    expect(await downloadYouTubeFeed(url, { etag: '"v2"', lastModified: 'invalid' }, primary, fetcher)).toMatchObject({ text: '<feed/>', url, status: 200, etag: '"v3"', bytes: 7 });
    expect(primary).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal), headers: { accept: 'application/atom+xml, application/xml, text/xml', 'if-none-match': '"v2"' } }));
  });

  it('accepts a conditional 304 without attempting to read content', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"v2"' } }));
    expect(await downloadYouTubeFeed(url, {}, unavailable(), fetcher)).toMatchObject({ status: 304, text: '', bytes: 0, etag: '"v2"' });
  });

  it('records the exact final upstream HTTP failure and never retries twice', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('restricted', { status: 429 }));
    await expect(downloadYouTubeFeed(url, {}, unavailable(), fetcher)).rejects.toMatchObject({ code: 'source_unavailable', upstreamStatus: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caps both declared and streamed response bytes at 2 MiB', async () => {
    const declared = vi.fn().mockResolvedValue(new Response('small', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }));
    await expect(downloadYouTubeFeed(url, {}, unavailable(), declared)).rejects.toMatchObject({ code: 'response_too_large' });
    const streamed = vi.fn().mockResolvedValue(new Response('a'.repeat(2 * 1024 * 1024 + 1)));
    await expect(downloadYouTubeFeed(url, {}, unavailable(), streamed)).rejects.toMatchObject({ code: 'response_too_large' });
  });
});
