import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));

import {
  createSourceMetadataHandler, downloadYouTubeChannelHtml, normalizeYouTubeChannelUrl,
  parseYouTubeChannelMetadata, safeYouTubeAvatarUrl,
} from '../netlify/functions/_shared/youtube-channel-metadata';

const channelUrl = 'https://www.youtube.com/@public-channel';
const avatar = 'https://yt3.googleusercontent.com/real-channel-profile=s900-c-k-c0x00ffffff-no-rj';
const ogHead = (name = 'Public Channel', image = avatar) => `<html><head><meta property="og:type" content="profile"><meta property="og:title" content="${name}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="900"><meta property="og:image:height" content="900"></head>`;
const initialPage = (data: unknown, head = '<meta property="og:type" content="profile">') => `<html><head>${head}</head><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
const get = (url: string = channelUrl) => new Request('https://recap.example/api/source-metadata?url=' + encodeURIComponent(url));

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
  complete = false;
  destroy = vi.fn(() => { this.emit('close'); return this; });
  chunk(text: string | Buffer) { this.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(text)); }
  end(text = '') { if (text) this.chunk(text); this.complete = true; this.emit('end'); this.emit('close'); }
}

class MockRequest extends EventEmitter {
  end = vi.fn();
  destroy = vi.fn(() => this);
}

interface Exchange { url: URL; options: RequestOptions; response: MockResponse; request: MockRequest; respond: () => void }
let exchanges: Exchange[];
function mockNetwork() {
  network.lookup.mockResolvedValue([{ address: '142.250.74.206', family: 4 }]);
  network.request.mockImplementation((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = new MockResponse(), request = new MockRequest();
    exchanges.push({ url, options, response, request, respond: () => callback(response as unknown as IncomingMessage) });
    return request;
  });
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => { vi.useRealTimers(); network.lookup.mockReset(); network.request.mockReset(); exchanges = []; mockNetwork(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('public YouTube channel URL validation', () => {
  it.each([
    ['https://youtube.com/@example', 'https://www.youtube.com/@example'],
    ['https://m.youtube.com/@example/?si=public#about', 'https://www.youtube.com/@example'],
    ['https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw', 'https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw'],
    ['https://www.youtube.com/c/Example', 'https://www.youtube.com/c/Example'],
    ['https://www.youtube.com/user/Example/', 'https://www.youtube.com/user/Example'],
    ['https://www.youtube.com/@café', 'https://www.youtube.com/@caf%C3%A9'],
  ])('normalizes the recognized channel %s', (input, expected) => expect(normalizeYouTubeChannelUrl(input)).toBe(expected));

  it.each([
    'http://www.youtube.com/@example', 'https://youtu.be/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/embed/abcdefghijk', 'https://www.youtube.com/playlist?list=abc',
    'https://www.youtube.com/@example/videos', 'https://www.youtube.com/@example/../watch', 'https://www.youtube.com/channel/UCinvalid',
    'https://www.youtube.com/channel/../@example', 'https://www.youtube.com/channel/%2e%2e/@example',
    'https://www.youtube.com', 'https://www.youtube.com/@', 'https://www.youtube.com/c/', 'https://www.youtube.com/user/..',
    'https://www.youtube.com.evil.example/@example', 'https://evil.youtube.com/@example', 'https://www.youtube.com./@example',
    'https://127.0.0.1/@example', 'https://[::1]/@example', 'https://localhost/@example', 'https://youtube.local/@example',
    'https://name:password@www.youtube.com/@example', 'https://www.youtube.com:8443/@example',
    'https://www.youtube.com:443/@example', 'https://www.youtube.com:0443/@example',
    'https://www.youtube.com/@example?token=private', 'https://www.youtube.com/@example?api_key=private',
    'https://www.youtube.com/@example%2Fvideos', 'https://www.youtube.com/@example%5Cwatch', 'https://www.youtube.com/@%zz',
    'https://www.youtube.com\\@example', ' https://www.youtube.com/@example', 'https://www.you\ntube.com/@example',
  ])('rejects a video, unsafe or unsupported address %s', input => expect(() => normalizeYouTubeChannelUrl(input)).toThrow());
});

describe('channel identity parser', () => {
  it('prefers the channel Open Graph title and square profile image', () => {
    expect(parseYouTubeChannelMetadata(ogHead('The Channel') + '<title>Other - YouTube</title>')).toEqual({ name: 'The Channel', avatarUrl: avatar });
  });
  it('accepts real YouTube SEO metadata placed after the closing head', () => {
    const html = '<html><head><script>const configuration = {};</script></head><body><div id="app"></div>' + ogHead('Outside the head').replace('<html><head>', '').replace('</head>', '');
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'Outside the head', avatarUrl: avatar });
  });
  it('handles attribute order, quotes, case, greater-than signs and unquoted attributes', () => {
    const html = `<head><META CONTENT='Science &gt; Hype' PROPERTY='og:title'><meta content="${avatar}" property=og:image><meta content=profile property=og:type></head>`;
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'Science > Hype', avatarUrl: avatar });
  });
  it('decodes HTML entities once, preserving literal brackets, accents, apostrophes and emoji', () => {
    expect(parseYouTubeChannelMetadata(ogHead('Caf&eacute; &amp; &#x1f600; &lt;Tech&gt; &amp;lt; &#39;OK&#39;'))).toEqual({ name: "Café & 😀 <Tech> &lt; 'OK'", avatarUrl: avatar });
  });
  it('uses the HTML title without decoding an escaped suffix twice', () => {
    const html = `<head><meta property="og:url" content="${channelUrl}"><title>A &amp;amp; B &lt;Lab&gt; - YouTube</title><meta property="og:image" content="${avatar}"></head>`;
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'A &amp; B <Lab>', avatarUrl: avatar });
  });
  it('ignores metadata-shaped text inside scripts, styles and comments', () => {
    const fake = `<meta property="og:title" content="Wrong"><meta property="og:image" content="${avatar}"><meta property="og:type" content="profile">`;
    expect(() => parseYouTubeChannelMetadata(`<head><!--${fake}--><script>const x='${fake}';</script><style>${fake}</style><title>YouTube</title></head>`)).toThrow();
  });
  it.each(['<head><title>YouTube</title></head>', '<head><title>Before you continue to YouTube</title></head>', '<head><title>Sign in - Google Accounts</title></head>', '<head><title>Not found</title></head>'])('rejects consent, generic and missing-channel pages', html => expect(() => parseYouTubeChannelMetadata(html)).toThrow());
  it('uses channelMetadataRenderer without decoding JSON strings as HTML', () => {
    const html = initialPage({ metadata: { channelMetadataRenderer: { title: 'A &amp; B "Quoted" }', avatar: { thumbnails: [{ url: avatar, width: 900, height: 900 }] } } } });
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'A &amp; B "Quoted" }', avatarUrl: avatar });
  });
  it('accepts a real channel named YouTube when explicit channel metadata proves its identity', () => {
    expect(parseYouTubeChannelMetadata(ogHead('YouTube'))).toEqual({ name: 'YouTube', avatarUrl: avatar });
    expect(parseYouTubeChannelMetadata(initialPage({ metadata: { channelMetadataRenderer: { title: 'YouTube', avatar: { thumbnails: [{ url: avatar }] } } } }))).toEqual({ name: 'YouTube', avatarUrl: avatar });
  });
  it('supports the legacy channel-header avatar and chooses the largest square profile', () => {
    const larger = avatar.replace('s900-', 's1200-');
    const html = initialPage({ header: { c4TabbedHeaderRenderer: { title: 'Legacy', avatar: { thumbnails: [{ url: avatar, width: 900, height: 900 }, { url: larger, width: 1200, height: 1200 }] } } } });
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'Legacy', avatarUrl: larger });
  });
  it('supports the modern page-header avatar without taking a banner or video author avatar', () => {
    const html = initialPage({ header: { pageHeaderRenderer: { content: { pageHeaderViewModel: { title: { dynamicTextViewModel: { text: { content: 'Modern' } } }, image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: avatar, width: 160, height: 160 }] } } } } } } } } }, contents: { avatar: { thumbnails: [{ url: avatar + '?wrong=1' }] } } });
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'Modern', avatarUrl: avatar });
  });
  it('accepts the bracketed window assignment but never executes JavaScript', () => {
    const html = `<head><title>Example - YouTube</title></head><script>window["ytInitialData"] = ${JSON.stringify({ metadata: { channelMetadataRenderer: { title: 'Example', avatar: { thumbnails: [{ url: avatar }] } } } })};</script>`;
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'Example', avatarUrl: avatar });
    expect(() => parseYouTubeChannelMetadata('<script>var ytInitialData = (() => { throw new Error("bad"); })();</script>')).toThrow();
  });
  it('omits the avatar when only video thumbnails or unrelated avatars are present', () => {
    const html = initialPage({ metadata: { channelMetadataRenderer: { title: 'No avatar' } }, contents: { avatar: { thumbnails: [{ url: avatar }] }, thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }] } } });
    expect(parseYouTubeChannelMetadata(html)).toEqual({ name: 'No avatar' });
  });
  it('rejects rectangular Open Graph artwork and falls back to an explicit channel avatar', () => {
    const head = `<meta property="og:title" content="Public Channel"><meta property="og:image" content="${avatar}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="400">`;
    const fallback = avatar.replace('s900-', 's88-');
    expect(parseYouTubeChannelMetadata(initialPage({ metadata: { channelMetadataRenderer: { title: 'Public Channel', avatar: { thumbnails: [{ url: fallback }] } } } }, head))).toEqual({ name: 'Public Channel', avatarUrl: fallback });
  });
  it('does not fall back to an arbitrary title or avatar in malformed JSON', () => {
    expect(() => parseYouTubeChannelMetadata(`<head><title>Wrong - YouTube</title></head><script>var ytInitialData = {bad: "json", "avatar": {"url": "${avatar}"}};</script>`)).toThrow();
  });
  it('bounds parser bytes including multibyte input', () => {
    expect(() => parseYouTubeChannelMetadata(ogHead() + 'é'.repeat(1_048_577))).toThrow(/size limit/);
  });
});

describe('avatar URL allowlist', () => {
  it.each([avatar, 'https://yt3.ggpht.com/ytc/real-profile=s88-c-k-c0x00ffffff-no-rj'])('accepts a genuine profile CDN %s', url => expect(safeYouTubeAvatarUrl(url)).toBe(url));
  it.each([
    'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', 'https://www.youtube.com/img/desktop/yt_1200.png',
    'https://www.gstatic.com/youtube/img/branding/youtubelogo/1x/youtubelogo_30.png',
    'https://yt3.googleusercontent.com.evil.example/avatar', 'https://evil.yt3.googleusercontent.com/avatar',
    'https://example.com/photo.jpg', 'http://yt3.googleusercontent.com/avatar', 'data:image/png;base64,xxx',
    'https://yt3.googleusercontent.com:443/avatar', 'https://user:pass@yt3.googleusercontent.com/avatar',
    'https://yt3.googleusercontent.com/avatar?token=private', 'https://yt3.googleusercontent.com/default_avatar.png',
    'https://yt3.ggpht.com/youtube-logo.png', 'https://yt3.googleusercontent.com/banner=w2120-h350-fcrop64',
    'https://yt3.googleusercontent.com/banner=w2120-fcrop64',
  ])('rejects a thumbnail, banner, generic artwork or unsafe URL %s', url => expect(safeYouTubeAvatarUrl(url)).toBeUndefined());
});

describe('bounded public metadata download', () => {
  it('pins the validated public DNS result and only downloads channel HTML', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl);
    await flush();
    expect(network.lookup).toHaveBeenCalledWith('www.youtube.com', { all: true, verbatim: true, family: 4 });
    const exchange = exchanges[0];
    const callback = vi.fn();
    exchange.options.lookup!('www.youtube.com', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '142.250.74.206', 4);
    expect(exchange.options.headers).toMatchObject({ accept: 'text/html', 'accept-encoding': 'identity', cookie: 'SOCS=CAI' });
    exchange.respond(); exchange.response.end(ogHead());
    expect(await work).toBe(ogHead());
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('stops after valid head metadata instead of downloading a large channel page', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl); await flush();
    const { response, respond, request } = exchanges[0];
    response.headers['content-length'] = '5000000'; respond();
    const head = ogHead(); response.chunk(head.slice(0, -4)); response.chunk(head.slice(-4) + 'body begins');
    expect(await work).toBe(head.slice(0, -4));
    expect(response.destroy).toHaveBeenCalled(); expect(request.destroy).toHaveBeenCalled();
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('stops for valid metadata streamed after the head without waiting for the rest of the body', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl); await flush();
    exchanges[0].respond(); exchanges[0].response.chunk('<html><head></head><body>');
    const metadata = ogHead().replace('<html><head>', '').replace('</head>', ''); exchanges[0].response.chunk(metadata);
    expect(await work).toContain(metadata); expect(exchanges[0].response.destroy).toHaveBeenCalled();
  });
  it('retains the bounded JSON fallback when the head has no avatar', async () => {
    const html = initialPage({ metadata: { channelMetadataRenderer: { title: 'Fallback', avatar: { thumbnails: [{ url: avatar }] } } } });
    const work = downloadYouTubeChannelHtml(channelUrl); await flush();
    exchanges[0].respond(); exchanges[0].response.end(html);
    expect(parseYouTubeChannelMetadata(await work)).toEqual({ name: 'Fallback', avatarUrl: avatar });
  });
  it.each(['127.0.0.1', '10.0.0.2', '169.254.169.254', '::1', '::ffff:127.0.0.1'])('rejects private DNS %s before opening a socket', async address => {
    network.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(downloadYouTubeChannelHtml(channelUrl)).rejects.toMatchObject({ code: 'unsafe_source_address' });
    expect(network.request).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private DNS answers', async () => {
    network.lookup.mockResolvedValue([{ address: '142.250.74.206', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(downloadYouTubeChannelHtml(channelUrl)).rejects.toMatchObject({ code: 'unsafe_source_address' });
    expect(network.request).not.toHaveBeenCalled();
  });
  it.each(['https://example.com/@example', 'https://127.0.0.1/@example', 'https://accounts.google.com/login', '/watch?v=abcdefghijk', 'https://www.youtube.com:443/@example', '//www.youtube.com:0443/@example', 'http://www.youtube.com/@example'])('blocks an unsafe redirect %s without another DNS request', async location => {
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'unsafe_metadata_redirect' }); await flush();
    exchanges[0].response.statusCode = 302; exchanges[0].response.headers.location = location; exchanges[0].respond();
    await failure; expect(network.lookup).toHaveBeenCalledTimes(1); expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('revalidates and repins a safe channel redirect', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl); await flush();
    exchanges[0].response.statusCode = 301; exchanges[0].response.headers.location = '/channel/UCXuqSBlHAE6Xw-yeJA0Tunw'; exchanges[0].respond();
    await flush(); exchanges[1].respond(); exchanges[1].response.end(ogHead());
    expect(await work).toBe(ogHead()); expect(network.lookup).toHaveBeenCalledTimes(2);
    expect(exchanges[1].url.href).toBe('https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw');
  });
  it('caps redirect loops', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_redirect_limit' });
    for (let index = 0; index < 4; index++) { await flush(); exchanges[index].response.statusCode = 302; exchanges[index].response.headers.location = '/@another'; exchanges[index].respond(); }
    await failure; expect(network.request).toHaveBeenCalledTimes(4);
  });
  it.each([undefined, '1'])('counts actual bytes despite an absent or false Content-Length (%s)', async length => {
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_response_too_large' }); await flush();
    if (length) exchanges[0].response.headers['content-length'] = length;
    exchanges[0].respond(); exchanges[0].response.chunk(Buffer.alloc(2 * 1024 * 1024 + 1));
    await failure; expect(exchanges[0].response.destroy).toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ 'content-type': 'application/json' }, { 'content-type': 'image/jpeg' }, { 'content-type': 'text/html', 'content-encoding': 'gzip' }])('rejects non-HTML/encoded responses', async headers => {
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_unavailable' }); await flush();
    exchanges[0].response.headers = headers; exchanges[0].respond(); await failure;
  });
  it('rejects an interrupted body rather than returning partial metadata', async () => {
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_unavailable' }); await flush();
    exchanges[0].respond(); exchanges[0].response.chunk('<head><title>Incomplete'); exchanges[0].response.emit('aborted'); await failure;
  });
  it('bounds stalled DNS and never opens a socket after the deadline', async () => {
    vi.useFakeTimers(); let resolveDns!: (value: unknown) => void;
    network.lookup.mockImplementation(() => new Promise(resolve => { resolveDns = resolve; }));
    const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ status: 504, code: 'metadata_timeout' });
    await vi.advanceTimersByTimeAsync(8_000); await failure;
    resolveDns([{ address: '142.250.74.206', family: 4 }]); await flush(); expect(network.request).not.toHaveBeenCalled();
  });
  it('bounds stalled response headers', async () => {
    vi.useFakeTimers(); const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_timeout' }); await flush();
    await vi.advanceTimersByTimeAsync(8_000); await failure; expect(exchanges[0].request.destroy).toHaveBeenCalled();
  });
  it('keeps one deadline across a delayed redirect and a stalled response body', async () => {
    vi.useFakeTimers(); const work = downloadYouTubeChannelHtml(channelUrl); const failure = expect(work).rejects.toMatchObject({ code: 'metadata_timeout' }); await flush();
    await vi.advanceTimersByTimeAsync(6_000);
    exchanges[0].response.statusCode = 302; exchanges[0].response.headers.location = '/@redirected'; exchanges[0].respond(); await flush();
    exchanges[1].respond(); exchanges[1].response.chunk('<head>still loading');
    await vi.advanceTimersByTimeAsync(2_000); await failure;
    expect(exchanges[1].response.destroy).toHaveBeenCalled(); expect(exchanges[1].request.destroy).toHaveBeenCalled();
  });
});

describe('public source metadata endpoint and modest channel cache', () => {
  it('serves guests without authentication, cookies, providers or image requests', async () => {
    const lookupMetadata = vi.fn().mockResolvedValue({ name: 'Public Channel', avatarUrl: avatar, privateField: 'discard' });
    const response = await createSourceMetadataHandler({ lookupMetadata })(get());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ metadata: { name: 'Public Channel', avatarUrl: avatar } });
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=900');
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(lookupMetadata).toHaveBeenCalledWith(channelUrl); expect(network.request).not.toHaveBeenCalled();
  });
  it('never forwards reader credentials or cookies to YouTube', async () => {
    const handler = createSourceMetadataHandler();
    const work = handler(new Request(get(), { headers: { authorization: 'Bearer private-reader-token', cookie: 'reader=private' } })); await flush();
    expect(exchanges[0].options.headers).not.toHaveProperty('authorization'); expect(exchanges[0].options.headers).toHaveProperty('cookie', 'SOCS=CAI');
    expect(JSON.stringify(exchanges[0].options.headers)).not.toContain('private');
    exchanges[0].respond(); exchanges[0].response.end(ogHead()); expect((await work).status).toBe(200);
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('returns a name without inventing an avatar', async () => {
    const response = await createSourceMetadataHandler({ lookupMetadata: async () => ({ name: 'No avatar' }) })(get());
    expect(await response.json()).toEqual({ metadata: { name: 'No avatar' } });
  });
  it('rejects non-GET, malformed queries and unsupported links before lookup', async () => {
    const lookupMetadata = vi.fn(), handler = createSourceMetadataHandler({ lookupMetadata });
    const post = await handler(new Request(get(), { method: 'POST' })); expect(post.status).toBe(405); expect(post.headers.get('allow')).toBe('GET');
    for (const request of [new Request('https://recap.example/api/source-metadata'), new Request(get().url + '&url=' + encodeURIComponent(channelUrl)), new Request(get().url + '&extra=1'), get('https://www.youtube.com/watch?v=abcdefghijk')]) {
      const response = await handler(request); expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(lookupMetadata).not.toHaveBeenCalled();
  });
  it('shares canonical cache keys and expires metadata after fifteen minutes', async () => {
    let now = 0;
    const lookupMetadata = vi.fn().mockResolvedValue({ name: 'Public Channel', avatarUrl: avatar });
    const handler = createSourceMetadataHandler({ lookupMetadata, now: () => now });
    await handler(get('https://youtube.com/@public-channel/?si=public#about')); await handler(get(channelUrl));
    expect(lookupMetadata).toHaveBeenCalledTimes(1);
    now = 15 * 60_000; await handler(get()); expect(lookupMetadata).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent requests for the same channel', async () => {
    let resolve!: (value: { name: string }) => void;
    const lookupMetadata = vi.fn(() => new Promise<{ name: string }>(done => { resolve = done; }));
    const handler = createSourceMetadataHandler({ lookupMetadata }); const first = handler(get()), second = handler(get()); await flush();
    expect(lookupMetadata).toHaveBeenCalledTimes(1); resolve({ name: 'Channel' }); expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  });
  it('bounds cache eviction and pending request cardinality', async () => {
    const lookupMetadata = vi.fn().mockResolvedValue({ name: 'Channel' });
    const handler = createSourceMetadataHandler({ lookupMetadata });
    for (let index = 0; index < 257; index++) await handler(get('https://youtube.com/@channel' + index));
    await handler(get('https://youtube.com/@channel0')); expect(lookupMetadata).toHaveBeenCalledTimes(258);
    let resolve!: (value: { name: string }) => void;
    const wait = new Promise<{ name: string }>(done => { resolve = done; });
    const busyHandler = createSourceMetadataHandler({ lookupMetadata: () => wait });
    const pending = Array.from({ length: 16 }, (_, index) => busyHandler(get('https://youtube.com/@pending' + index)));
    const busy = await busyHandler(get('https://youtube.com/@overflow')); expect(busy.status).toBe(503); resolve({ name: 'Channel' }); await Promise.all(pending);
  });
  it('sanitizes upstream errors and allows a later retry without caching failure', async () => {
    const lookupMetadata = vi.fn().mockRejectedValueOnce(new Error('private diagnostic')).mockResolvedValue({ name: 'Recovered' });
    const handler = createSourceMetadataHandler({ lookupMetadata });
    const failed = await handler(get()); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('private diagnostic'); expect(failed.headers.get('cache-control')).toBe('no-store');
    expect((await handler(get())).status).toBe(200); expect(lookupMetadata).toHaveBeenCalledTimes(2);
  });
});
