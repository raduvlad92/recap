import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { CollectionResult, Reference, Source, SourceUpdate } from '../../../src/lib/types';
import { CollectionError, isPublicAddress, publicHttpsUrl, readTextLimited } from './security';
import { hostRuntime } from './host-runtime';

const MAX_BYTES = 2 * 1024 * 1024;
const CONTENT_LIMIT = 24_000;
export interface Download { text: string; url: string; contentType: string; status?: number; etag?: string; lastModified?: string; bytes?: number }
export type DownloadFeed = (url: string) => Promise<Download>;
export interface FeedValidators { etag?: string; lastModified?: string }

/** Validators originate in response headers, but are still checked before reuse. */
export function conditionalFeedHeaders(validators: FeedValidators = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof validators.etag === 'string' && validators.etag.length <= 512 && !/[\r\n\u0000]/.test(validators.etag)) headers['if-none-match'] = validators.etag;
  if (typeof validators.lastModified === 'string' && validators.lastModified.length <= 128 && Number.isFinite(Date.parse(validators.lastModified)) && !/[\r\n\u0000]/.test(validators.lastModified)) headers['if-modified-since'] = validators.lastModified;
  return headers;
}

/** Only the publisher's exact caption endpoint may carry its short-lived
 * signature. This never relaxes the ordinary public-source URL rules. */
export function youtubeCaptionUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new CollectionError(400, 'unsafe_caption_url', 'Invalid public caption address.'); }
  if (!['www.youtube.com', 'youtube.com'].includes(url.hostname) || url.pathname !== '/api/timedtext' ||
      url.searchParams.getAll('v').length !== 1 || !/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') || '')) {
    throw new CollectionError(400, 'unsafe_caption_url', 'Only the public YouTube caption endpoint is supported.');
  }
  const checked = new URL(url.href);
  checked.searchParams.delete('signature');
  publicHttpsUrl(checked.href);
  if (url.href.length > 4096) throw new CollectionError(400, 'unsafe_caption_url', 'The caption address is too long.');
  url.hash = '';
  return url;
}

export async function downloadYouTubeCaptions(url: string): Promise<Download> {
  return downloadPinned(url, 0, {}, youtubeCaptionUrl);
}

/** DNS is checked AND pinned to the HTTPS socket; fetch-after-lookup would permit rebinding. */
export async function downloadPublic(urlString: string, redirects = 0, validators: FeedValidators = {}): Promise<Download> {
  return downloadPinned(urlString, redirects, validators, publicHttpsUrl);
}

/** A fixed first-party endpoint, not an arbitrary reader-supplied fetch target. */
export function youtubeFeedUrl(value: string): URL {
  const url = publicHttpsUrl(value);
  if (url.hostname !== 'www.youtube.com' || url.pathname !== '/feeds/videos.xml' ||
      url.searchParams.size !== 1 || url.searchParams.getAll('channel_id').length !== 1 ||
      !/^UC[A-Za-z0-9_-]{22}$/.test(url.searchParams.get('channel_id') || '')) {
    throw new CollectionError(400, 'unsafe_youtube_feed', 'Only the exact public YouTube channel feed is supported.');
  }
  return url;
}

/** Some hosting networks receive a restricted response on the raw HTTPS
 * transport. Retry once with the platform transport for this fixed origin.
 * Unsafe DNS, timeouts, redirects and arbitrary feeds never enter this path. */
export async function downloadYouTubeFeed(urlString: string, validators: FeedValidators = {}, primary = downloadPublic, fetcher: typeof fetch = fetch): Promise<Download> {
  const url = youtubeFeedUrl(urlString);
  try { return await primary(url.href, 0, validators); }
  catch (error) {
    if (!(error instanceof CollectionError) || error.code !== 'source_unavailable') throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url.href, {
      redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/atom+xml, application/xml, text/xml', ...conditionalFeedHeaders(validators) },
    });
    const metadata = {
      status: response.status, etag: response.headers.get('etag')?.slice(0, 512),
      lastModified: response.headers.get('last-modified')?.slice(0, 128),
    };
    if (response.status === 304) { await response.body?.cancel(); return { text: '', url: url.href, contentType: response.headers.get('content-type') || '', bytes: 0, ...metadata }; }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new CollectionError(422, 'source_unavailable', 'The public YouTube feed returned an unavailable or restricted response.', response.status);
    }
    const text = await readTextLimited(response, MAX_BYTES);
    return { text, url: url.href, contentType: response.headers.get('content-type') || '', bytes: Buffer.byteLength(text), ...metadata };
  } catch (error) {
    if (controller.signal.aborted) throw new CollectionError(504, 'source_timeout', 'This source took too long to respond.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function downloadHourlySource(urlString: string, redirects = 0, validators: FeedValidators = {}): Promise<Download> {
  const url = publicHttpsUrl(urlString);
  return url.hostname === 'www.youtube.com' && url.pathname === '/feeds/videos.xml'
    ? downloadYouTubeFeed(url.href, validators) : downloadPublic(url.href, redirects, validators);
}

async function downloadPinned(urlString: string, redirects: number, validators: FeedValidators, validate: (value: string) => URL): Promise<Download> {
  const host = hostRuntime();
  if (host?.download) return host.download(urlString, {
    kind: validate === youtubeCaptionUrl ? 'caption' : 'feed',
    validate, redirects, maxBytes: MAX_BYTES, timeoutMs: 8000,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5', 'user-agent': 'therecap-source-check/0.1', ...conditionalFeedHeaders(validators) },
  });
  const url = validate(urlString);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new CollectionError(504, 'dns_timeout', 'This source hostname took too long to resolve.')), 3000); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new CollectionError(400, 'unsafe_address', 'This source does not resolve to a public website.');
  }
  const selected = addresses.find(({ family }) => family === 4) || addresses[0];
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options?.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      lookup: pinnedLookup, family: selected.family,
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5', 'accept-encoding': 'identity', 'user-agent': 'therecap-source-check/0.1', ...conditionalFeedHeaders(validators) },
    }, (response) => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 3) { reject(new CollectionError(400, 'redirect_limit', 'This source redirects too many times.')); return; }
        let next: URL;
        try { next = validate(new URL(response.headers.location, url).href); } catch (error) { reject(error); return; }
        // The next request repeats hostname validation, DNS validation and socket pinning.
        // Conditional headers apply to the exact representation, never another origin.
        void downloadPinned(next.href, redirects + 1, next.origin === url.origin ? validators : {}, validate).then(resolve, reject);
        return;
      }
      const metadata = {
        status, etag: typeof response.headers.etag === 'string' ? response.headers.etag.slice(0, 512) : undefined,
        lastModified: typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'].slice(0, 128) : undefined,
      };
      if (status === 304) {
        response.resume(); resolve({ text: '', url: url.href, contentType: String(response.headers['content-type'] ?? ''), bytes: 0, ...metadata }); return;
      }
      if (status !== 200) { response.resume(); reject(new CollectionError(422, 'source_unavailable', 'The public feed returned an unavailable or restricted response.', status)); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(new CollectionError(422, 'encoding_not_supported', 'This source requires an unsupported response encoding.')); return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { response.destroy(new CollectionError(413, 'feed_too_large', 'This feed is larger than the 2 MB collection limit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: url.href, contentType: String(response.headers['content-type'] ?? ''), bytes, ...metadata }));
    });
    const timer = setTimeout(() => req.destroy(new CollectionError(504, 'source_timeout', 'This source took too long to respond.')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

export function plainText(value: unknown, limit = CONTENT_LIMIT): string {
  if (value === undefined || value === null) return '';
  const raw = typeof value === 'object' ? (value as Record<string, unknown>)['#text'] ?? '' : value;
  return String(raw).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function array(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
}

export function safeLink(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try { return publicHttpsUrl(new URL(value, base).href).href; } catch { return; }
}

export function linkedReferences(raw: string, base: string): Reference[] {
  const found = new Map<string, Reference>();
  for (const match of raw.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeLink(match[1].replace(/&amp;/g, '&'), base);
    if (url && found.size < 10) found.set(url, { title: plainText(match[2], 160) || new URL(url).hostname, url });
  }
  return [...found.values()];
}

export function normalizeFeed(xml: string, source: Source, fetchedUrl: string): CollectionResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new CollectionError(422, 'unsafe_xml', 'Feeds containing document types or entity definitions are not supported.');
  if (XMLValidator.validate(xml) !== true) throw new CollectionError(422, 'invalid_feed', 'This address did not return a valid RSS or Atom feed.');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, trimValues: false }).parse(xml);
  const channel = parsed.rss?.channel ?? parsed['rdf:RDF'] ?? parsed.feed;
  if (!channel || typeof channel !== 'object') throw new CollectionError(422, 'feed_not_found', 'No public RSS or Atom feed was found at this address.');
  const entries = array(channel.item ?? channel.entry);
  const updates = new Map<string, SourceUpdate>();
  const sorted = entries.map((entry) => {
    const date = plainText(entry.pubDate ?? entry.published ?? entry.updated, 100);
    const timestamp = Date.parse(date);
    return { entry, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '' };
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  for (const { entry, publishedAt } of sorted) {
    if (updates.size >= 5) break;
    const links = array(entry.link);
    const atomLink = links.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate');
    const link = safeLink(typeof entry.link === 'string' ? entry.link : atomLink?.['@_href'], fetchedUrl);
    if (!link || updates.has(link)) continue;
    const body = entry['content:encoded'] ?? entry.content;
    const rawBody = typeof body === 'object' ? String((body as Record<string, unknown>)['#text'] ?? '') : String(body ?? '');
    const description = plainText(entry.description ?? entry.summary ?? entry['itunes:summary']);
    const content = plainText(rawBody);
    const isPodcast = source.platform === 'Podcast' || !!entry.enclosure || !!entry['itunes:duration'];
    const usableFeedText = !!content && !isPodcast;
    const coverage = usableFeedText
      ? 'Publisher-provided feed text; completeness is not verified' + (rawBody.length > CONTENT_LIMIT ? '; text capped' : '')
      : isPodcast ? 'Metadata only: podcast show notes; audio not collected or analyzed' : 'Metadata only: feed excerpt or description; article body not collected';
    updates.set(link, {
      id: 'live-' + createHash('sha256').update(source.id + '\n' + link).digest('hex').slice(0, 24), sourceId: source.id, contributorIds: [],
      title: plainText(entry.title, 240) || 'Untitled source update', summary: (content || description).slice(0, 700),
      ...(usableFeedText ? { content, contentKind: 'feed_text' as const } : { contentKind: 'metadata_only' as const }),
      url: link, publishedAt, format: isPodcast ? 'podcast' : 'article', topics: [], brands: [], sponsors: [],
      references: linkedReferences(rawBody || String(entry.description ?? ''), link), insights: [], isSample: false, coverage,
    });
  }
  const imported = [...updates.values()];
  return {
    source: { ...source, name: plainText(channel.title, 120) || source.name, feedUrl: fetchedUrl, status: 'ready',
      ...(source.platform === 'Blog' && imported.length > 0 && imported.every((item) => item.format === 'podcast') ? { platform: 'Podcast' } : {}),
    }, updates: imported,
    notice: imported.length ? 'Collected up to five recent feed entries. Text is a source extract, not an AI recap. Missing dates remain unknown; feed completeness and older updates are not verified.'
      : 'The feed was retrieved, but no importable HTTPS update links were found. This does not establish that the source was quiet.',
  };
}

export async function collectFeed(source: Source, download: DownloadFeed = downloadPublic): Promise<CollectionResult> {
  let result = await download(source.feedUrl || source.url);
  if (!/<(?:rss\b|feed\b|rdf:RDF\b)/i.test(result.text)) {
    let feedUrl: string | undefined;
    for (const match of result.text.slice(0, 512_000).matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      if (!/\brel\s*=\s*["'][^"']*alternate[^"']*["']/i.test(tag) || !/\btype\s*=\s*["']application\/(?:rss|atom)\+xml["']/i.test(tag)) continue;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      feedUrl = safeLink(href?.replace(/&amp;/g, '&'), result.url);
      if (feedUrl) break;
    }
    if (!feedUrl && new URL(result.url).hostname.endsWith('.substack.com')) feedUrl = new URL('/feed', result.url).href;
    if (!feedUrl) throw new CollectionError(422, 'feed_not_found', 'No public feed was found. Paste the RSS or Atom feed URL directly.');
    result = await download(feedUrl);
  }
  return normalizeFeed(result.text, source, result.url);
}
