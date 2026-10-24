import type { SourceUpdate } from './types';

export type VideoFormat = NonNullable<SourceUpdate['videoFormat']>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

export function youtubeVideoId(value: unknown): string | undefined {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    const id = url.hostname === 'youtu.be' ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
      : hosts.includes(url.hostname) ? url.pathname === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v')
        : /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] : undefined;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch { return; }
}

function shortsUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) && /^\/shorts\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch { return false; }
}

export function sanitizeVideoFormat(value: unknown): VideoFormat | undefined {
  const row = object(value);
  if (typeof row.kind !== 'string' || !['short', 'regular', 'unknown'].includes(row.kind) || typeof row.basis !== 'string' || !['provider', 'canonical_url', 'watch_page', 'legacy'].includes(row.basis)) return;
  return { kind: row.kind as VideoFormat['kind'], basis: row.basis as VideoFormat['basis'],
    ...(typeof row.checkedAt === 'string' && row.checkedAt.length <= 40 && Number.isFinite(Date.parse(row.checkedAt)) ? { checkedAt: new Date(row.checkedAt).toISOString() } : {}) };
}

/** Checked conflicts remain unknown. Uncontradicted legacy Shorts evidence is retained. */
export function videoFormatKind(update: Pick<SourceUpdate, 'url' | 'isShort' | 'videoFormat'>): VideoFormat['kind'] {
  const format = sanitizeVideoFormat(update.videoFormat);
  if (format?.kind === 'unknown') return 'unknown';
  if (shortsUrl(update.url)) return 'short';
  if (update.isShort === true && format?.kind === 'regular') return 'unknown';
  if (update.isShort === true || format?.kind === 'short') return 'short';
  // Legacy false flags were inferred from generic provider type:'video'. Keep
  // the raw flag for history, but require checked evidence to call it regular.
  return format?.kind === 'regular' && format.basis !== 'legacy' ? 'regular' : 'unknown';
}

/** Narrow documented provider fields only; no title, description, aspect ratio or duration guesses. */
export function classifyProviderVideoFormat(value: unknown, url: string): VideoFormat {
  const row = object(value);
  const id = youtubeVideoId(url);
  if (id && [row.videoId, row.id].some(candidate => typeof candidate === 'string' && /^[A-Za-z0-9_-]{11}$/.test(candidate) && candidate !== id)) return { kind: 'unknown', basis: 'provider' };
  const short = shortsUrl(url) || row.isShort === true || row.isShorts === true || row.type === 'shorts';
  const regular = row.isShort === false || row.isShorts === false || row.type === 'stream' && (row.isLive === true || row.isLiveContent === true);
  return { kind: short ? 'short' : regular ? 'regular' : 'unknown', basis: shortsUrl(url) ? 'canonical_url' : 'provider' };
}

export function videoFormatFields(format: VideoFormat): Pick<SourceUpdate, 'videoFormat' | 'isShort'> {
  return { videoFormat: format, ...(format.kind !== 'unknown' ? { isShort: format.kind === 'short' } : {}) };
}

export function mergedVideoFormat(previous: Pick<SourceUpdate, 'url' | 'isShort' | 'videoFormat'>, incoming: Pick<SourceUpdate, 'url' | 'isShort' | 'videoFormat'>): VideoFormat {
  const evidence = (update: typeof previous): VideoFormat => {
    const format = sanitizeVideoFormat(update.videoFormat), kind = videoFormatKind(update);
    if (format?.kind === kind) return format;
    if (kind === 'short' && shortsUrl(update.url)) return { kind, basis: 'canonical_url' };
    return format ? { ...format, kind } : { kind, basis: 'legacy' };
  };
  const before = evidence(previous), after = evidence(incoming);
  if (before.kind === after.kind && before.basis !== 'legacy' && after.basis === 'legacy') return before;
  if (before.kind === 'short' || after.kind === 'short') return after.kind === 'short' ? after : before;
  if ((previous.isShort === true || incoming.isShort === true || shortsUrl(previous.url) || shortsUrl(incoming.url)) && (before.kind === 'regular' || after.kind === 'regular')) return { ...(after.kind === 'regular' ? after : before), kind: 'unknown' };
  return after.kind === 'unknown' && before.kind === 'regular' && before.basis !== 'legacy' ? before : after;
}

export function mergeVideoFormatFields(previous: Pick<SourceUpdate, 'url' | 'isShort' | 'videoFormat'>, incoming: Pick<SourceUpdate, 'url' | 'isShort' | 'videoFormat'>): Pick<SourceUpdate, 'videoFormat' | 'isShort'> {
  const format = mergedVideoFormat(previous, incoming);
  return { ...videoFormatFields(format), ...(format.kind === 'unknown' && (previous.isShort === true || incoming.isShort === true || shortsUrl(previous.url) || shortsUrl(incoming.url)) ? { isShort: true } : {}) };
}

/** Balanced JSON extraction only. Never evaluate scripts or scan recommendation trees for flags. */
export function watchPagePlayer(html: string): Record<string, unknown> | undefined {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/.exec(html);
  if (!marker) return;
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') return;
  let depth = 0, quoted = false, escaped = false;
  for (let end = start; end < Math.min(html.length, start + 1_500_000); end++) {
    const char = html[end];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { try { return object(JSON.parse(html.slice(start, end + 1))); } catch { return; } }
  }
}

/** The page and primary player must identify the requested original. Captions/playability are independent. */
export function classifyWatchPageVideoFormat(html: string, videoId: string, pageUrl: string): VideoFormat {
  const unknown: VideoFormat = { kind: 'unknown', basis: 'watch_page' };
  if (youtubeVideoId(pageUrl) !== videoId) return unknown;
  const player = watchPagePlayer(html), details = object(player?.videoDetails);
  if (details.videoId !== videoId) return unknown;
  const microformat = object(object(player?.microformat).playerMicroformatRenderer);
  let short = shortsUrl(pageUrl) || details.isShort === true || details.isShorts === true || microformat.isShorts === true;
  let regular = details.isShort === false || details.isShorts === false || microformat.isShorts === false;
  // Only exact canonical metadata, never arbitrary links or recommended Shorts.
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag[0])) continue;
    const canonical = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]?.replace(/&amp;/g, '&');
    if (youtubeVideoId(canonical) === videoId && shortsUrl(canonical)) short = true;
    else if (youtubeVideoId(canonical) === videoId && new URL(canonical!).pathname === '/watch' && microformat.isShortsEligible === false) regular = true;
  }
  if (short) return { kind: 'short', basis: 'watch_page' };
  if (regular) return { kind: 'regular', basis: 'watch_page' };
  return unknown;
}
