import { describe, expect, it, vi } from 'vitest';
import { classifyProviderVideoFormat, classifyWatchPageVideoFormat, mergedVideoFormat, sanitizeVideoFormat, videoFormatKind, watchPagePlayer } from '../src/lib/video-format';
import { normalizeYouTubeItems } from '../netlify/functions/_shared/apify';
import { downloadHourlyWatchPage, HOURLY_WATCH_PAGE_MAX_BYTES, nativeHourlyCaptions } from '../netlify/functions/_shared/hourly-collection';
import { CollectionError } from '../netlify/functions/_shared/security';
import type { Source } from '../src/lib/types';
// @ts-expect-error Standalone Actor ESM.
import { normalizeItem, validateInput } from '../actors/tech-collector/src/collector.mjs';

const id = 'abcdefghijk', url = `https://www.youtube.com/watch?v=${id}`;
const source: Source = { id: 'format-source', platform: 'YouTube', url: 'https://www.youtube.com/@Format', name: 'Format', status: 'ready', creatorIds: [] };
const html = (patch: Record<string, unknown> = {}) => `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: id }, playabilityStatus: { status: 'OK' }, ...patch })};`;

describe('format evidence', () => {
  it.each([
    [{ isShort: true, type: 'video' }, 'short'], [{ isShort: false, type: 'shorts' }, 'short'], [{ isShort: true, isShorts: false }, 'short'],
    [{ isShorts: true }, 'short'], [{ type: 'shorts' }, 'short'], [{ type: 'video' }, 'unknown'],
    [{ type: 'stream' }, 'unknown'], [{ type: 'stream', isLiveContent: true }, 'regular'], [{ isShort: false }, 'regular'], [{ duration: '00:30', title: '#shorts', text: '#shorts' }, 'unknown'],
  ])('uses the same positive evidence in both importers: %j', (raw, kind) => {
    expect(classifyProviderVideoFormat(raw, url).kind).toBe(kind);
    expect(normalizeYouTubeItems([{ ...raw, url }], source)[0].videoFormat?.kind).toBe(kind);
    const input = validateInput({ sources: [source], dateFrom: '2026-10-01T00:00:00Z', dateTo: '2026-10-21T00:00:00Z', maxTotalChargeUsd: 45 }, Date.parse('2026-10-21T00:00:00Z'));
    const result = normalizeItem(input.sources[0], { ...raw, id, url, channelUrl: source.url, input: source.url, date: '2026-10-20T00:00:00Z', title: '#shorts' }, input);
    expect(result.update.videoFormat.kind).toBe(kind);
  });
  it('retains positive Shorts evidence over a conflicting generic/negative declaration', () => {
    const short = { url, isShort: true, videoFormat: { kind: 'short' as const, basis: 'provider' as const } };
    expect(mergedVideoFormat(short, { url, isShort: false }).kind).toBe('short');
    expect(mergedVideoFormat({ url, isShort: false }, { url }).kind).toBe('unknown');
    expect(mergedVideoFormat({ url, isShort: false }, { url, videoFormat: { kind: 'short', basis: 'watch_page' } }).kind).toBe('short');
    expect(mergedVideoFormat({ url, isShort: false, videoFormat: { kind: 'regular', basis: 'watch_page' } }, { url }).kind).toBe('regular');
    expect(videoFormatKind({ url: `https://youtube.com/shorts/${id}`, isShort: false })).toBe('short');
    expect(classifyProviderVideoFormat({ isShort: false }, `https://youtube.com/shorts/${id}`).kind).toBe('short');
  });
  it('requires checked regular evidence rather than a historical false flag', () => {
    const legacy = { url, isShort: false };
    expect(videoFormatKind(legacy)).toBe('unknown');
    expect(videoFormatKind({ ...legacy, videoFormat: { kind: 'regular', basis: 'legacy' } })).toBe('unknown');
    expect(legacy.isShort).toBe(false);
    for (const basis of ['provider', 'watch_page'] as const) expect(videoFormatKind({ ...legacy, videoFormat: { kind: 'regular', basis } })).toBe('regular');
    expect(mergedVideoFormat(legacy, { url })).toEqual({ kind: 'unknown', basis: 'legacy' });
  });
  it('rejects mismatched provider identity and malformed persisted metadata', () => {
    expect(classifyProviderVideoFormat({ videoId: 'lmnopqrstuv', isShort: false }, url).kind).toBe('unknown');
    expect(sanitizeVideoFormat({ kind: 'long', basis: 'duration' })).toBeUndefined();
    expect(sanitizeVideoFormat({ kind: 'regular', basis: 'watch_page', checkedAt: 'bad', private: 'discard' })).toEqual({ kind: 'regular', basis: 'watch_page' });
  });
  it('rejects enum objects and arrays without coercing untrusted JSON', () => {
    for (const malformed of [{ toString: null }, ['regular'], null, 1]) {
      expect(sanitizeVideoFormat({ kind: malformed, basis: 'provider' })).toBeUndefined();
      expect(sanitizeVideoFormat({ kind: 'regular', basis: malformed })).toBeUndefined();
    }
  });
  it('distinguishes primary Shorts eligibility from actual positive canonical Shorts identity', () => {
    const eligible = html({ videoDetails: { videoId: id }, microformat: { playerMicroformatRenderer: { isShortsEligible: true } } });
    const ineligible = html({ videoDetails: { videoId: id }, microformat: { playerMicroformatRenderer: { isShortsEligible: false } } });
    expect(classifyWatchPageVideoFormat(eligible, id, url).kind).toBe('unknown');
    expect(classifyWatchPageVideoFormat(eligible + `<link rel="canonical" href="https://www.youtube.com/shorts/${id}">`, id, url).kind).toBe('short');
    expect(classifyWatchPageVideoFormat(ineligible, id, url).kind).toBe('unknown');
    expect(classifyWatchPageVideoFormat(ineligible + `<link rel="canonical" href="${url}">`, id, url).kind).toBe('regular');
    expect(classifyWatchPageVideoFormat(ineligible + '<link rel="canonical" href="https://www.youtube.com/watch?v=lmnopqrstuv">', id, url).kind).toBe('unknown');
  });
  it('round-trips balanced JSON without executing quoted source instructions', () => {
    expect(watchPagePlayer(html({ videoDetails: { videoId: id, title: 'quoted } \\" {', isShort: false } }))?.videoDetails).toMatchObject({ videoId: id });
    expect(watchPagePlayer('ytInitialPlayerResponse = { broken')).toBeUndefined();
    expect(watchPagePlayer('ytInitialPlayerResponse = window.evil()')).toBeUndefined();
  });
  it('classifies only the exact primary video independently of playability/captions', () => {
    expect(classifyWatchPageVideoFormat(html({ videoDetails: { videoId: id, isShort: true }, playabilityStatus: { status: 'ERROR' } }), id, url).kind).toBe('short');
    expect(classifyWatchPageVideoFormat(html({ videoDetails: { videoId: id, isShort: false } }), id, url).kind).toBe('regular');
    expect(classifyWatchPageVideoFormat(html({ videoDetails: { videoId: 'lmnopqrstuv', isShort: false } }), id, url).kind).toBe('unknown');
    expect(classifyWatchPageVideoFormat(html({ videoDetails: { videoId: id, isShort: false } }), id, 'https://evil.example/watch?v=' + id).kind).toBe('unknown');
    const recommendations = html({ videoDetails: { videoId: id, lengthSeconds: '10', title: '#shorts' }, recommendations: { isShort: true, type: 'shorts' } });
    expect(classifyWatchPageVideoFormat(recommendations, id, url).kind).toBe('unknown');
  });
  it('retains exact canonical Shorts metadata over a conflicting negative flag', () => {
    const body = html({ videoDetails: { videoId: id, isShort: false } }) + `<link rel="canonical" href="https://www.youtube.com/shorts/${id}">`;
    expect(classifyWatchPageVideoFormat(body, id, url).kind).toBe('short');
  });
});

describe('caption-independent format recovery and capped transport', () => {
  it('keeps page evidence when captions are not supplied', async () => {
    const download = vi.fn(async () => ({ url, text: html({ videoDetails: { videoId: id, isShort: false } }), contentType: 'text/html' }));
    expect(await nativeHourlyCaptions(id, download)).toMatchObject({ videoFormat: { kind: 'regular', basis: 'watch_page' }, captionStatus: 'unavailable', reason: 'caption_tracks_not_supplied' });
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('keeps classification when the separate caption transport fails or is oversized', async () => {
    const download = vi.fn(async () => ({ url, text: html({ videoDetails: { videoId: id, isShort: true }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${id}` }] } } }), contentType: 'text/html' }));
    const captions = vi.fn(async () => { throw new CollectionError(413, 'response_too_large', 'too big'); });
    expect(await nativeHourlyCaptions(id, download, captions)).toMatchObject({ videoFormat: { kind: 'short' }, captionStatus: 'retry', reason: 'response_too_large' });
  });
  it('accepts a page larger than the retired feed cap with fixed-origin bounded fetch', async () => {
    const body = html() + ' '.repeat(3 * 1024 * 1024), fetcher = vi.fn(async () => new Response(body));
    expect((await downloadHourlyWatchPage(url, 0, {}, fetcher)).bytes).toBe(Buffer.byteLength(body));
    expect(fetcher.mock.calls[0]).toEqual([url, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })]);
  });
  it('rejects oversized declared and streaming bodies and never follows redirects', async () => {
    const declared = vi.fn(async () => new Response('x', { headers: { 'content-length': String(HOURLY_WATCH_PAGE_MAX_BYTES + 1) } }));
    await expect(downloadHourlyWatchPage(url, 0, {}, declared)).rejects.toMatchObject({ code: 'response_too_large' });
    const streaming = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(HOURLY_WATCH_PAGE_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } })));
    await expect(downloadHourlyWatchPage(url, 0, {}, streaming)).rejects.toMatchObject({ code: 'response_too_large' });
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    await expect(downloadHourlyWatchPage(url, 0, {}, redirect)).rejects.toMatchObject({ code: 'source_unavailable' });
    expect(redirect).toHaveBeenCalledTimes(1);
  });
  it.each(['https://evil.example/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&token=x', 'https://user:pass@www.youtube.com/watch?v=abcdefghijk', 'http://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv'])('rejects unsafe/non-exact watch addresses without fetching: %s', async value => {
    const fetcher = vi.fn();
    await expect(downloadHourlyWatchPage(value, 0, {}, fetcher)).rejects.toBeInstanceOf(CollectionError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
