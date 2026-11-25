import { describe, expect, it, vi } from 'vitest';
import { classifyPublicYouTubePage, probeYouTubeVideoFormat } from '../scripts/probe-youtube-video-format.mts';

const id = 'abcdefghijk';
const watch = 'https://www.youtube.com/watch?v=' + id;
const shorts = 'https://www.youtube.com/shorts/' + id;
const canonical = (url: string) => `<link rel="canonical" href="${url}">`;
function page(url: string, details: Record<string, unknown> = {}, status = 'OK') {
  return canonical(url) + 'var ytInitialPlayerResponse = ' + JSON.stringify({
    videoDetails: { videoId: id, lengthSeconds: '181', ...details }, playabilityStatus: { status },
  });
}

describe('public video format evidence', () => {
  it('resolves an exact playable canonical original beyond the Shorts limit', () => {
    expect(classifyPublicYouTubePage(page(watch), id)).toMatchObject({
      kind: 'regular', canonical: watch, seconds: 181, playerMatches: true, playable: true,
    });
  });

  it('resolves a Short from the exact Shorts canonical, including a three-minute Short', () => {
    expect(classifyPublicYouTubePage(page(shorts, { lengthSeconds: '180' }), id))
      .toMatchObject({ kind: 'short', canonical: shorts, seconds: 180 });
  });

  it.each([
    page(watch, { lengthSeconds: '180' }),
    page(watch, { lengthSeconds: '29', title: '#shorts' }),
    page(watch, { lengthSeconds: 181 }),
    page(watch, { isShort: true }),
    page(shorts),
    page(shorts, { lengthSeconds: '90', isShort: false }),
    page(watch, { videoId: 'lmnopqrstuv' }),
    page(watch, {}, 'LOGIN_REQUIRED'),
    page(watch + '&list=lmnopqrstuv'),
    page('https://www.youtube.com.evil.invalid/watch?v=' + id),
    page(watch) + canonical(shorts),
    canonical(shorts),
    'var ytInitialPlayerResponse = window.evil()',
  ])('leaves insufficient, conflicting or mismatched evidence unknown (%#)', html => {
    expect(classifyPublicYouTubePage(html, id).kind).toBe('unknown');
  });
});

describe('read-only public watch probe', () => {
  it('uses one fixed unauthenticated request and records the evidence digest', async () => {
    const fetchPage = vi.fn(async () => new Response(page(watch)));
    const result = await probeYouTubeVideoFormat(id, fetchPage);
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(watch, expect.objectContaining({ redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ videoId: id, kind: 'regular', httpStatus: 200, pageSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it.each([302, 404, 429])('leaves HTTP %s unknown without following a redirect or retrying', async status => {
    const fetchPage = vi.fn(async () => new Response('', { status, headers: { location: shorts } }));
    expect(await probeYouTubeVideoFormat(id, fetchPage)).toMatchObject({ kind: 'unknown', httpStatus: status });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('rejects bad IDs without a request', async () => {
    const fetchPage = vi.fn();
    await expect(probeYouTubeVideoFormat(id + '?v=evil', fetchPage)).rejects.toThrow('Invalid YouTube video ID');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('bounds both declared and streamed response bodies', async () => {
    const declared = new Response('x', { headers: { 'content-length': String(9 * 1024 * 1024) } });
    const streamed = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
      controller.close();
    } }));
    for (const response of [declared, streamed]) {
      expect(await probeYouTubeVideoFormat(id, async () => response))
        .toMatchObject({ kind: 'unknown', reason: 'page_too_large' });
    }
  });
});
