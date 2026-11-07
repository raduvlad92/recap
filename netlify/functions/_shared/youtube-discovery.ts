import type { Source, SourceUpdate } from '../../../src/lib/types';
import { watchPagePlayer } from '../../../src/lib/video-format';
import { plainText, safeLink, type Download } from './feed';
import { CollectionError, readTextLimited } from './security';
import { fetchNoRedirect } from './fetch-no-redirect';
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const DISCOVERY_ITEMS = 3;
export const DISCOVERY_MAX_USD = .02;
export interface YouTubeDiscovery { updates: SourceUpdate[]; gapPossible: boolean }
/** Preserve an exact supplied instant; reject local dates and calendar rollover. */
export function exactPublicationTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!parts) return;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHour = '0', offsetMinute = '0'] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return;
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
}
/** Parse one JSON assignment without evaluating any page script. */
export function pageJson(html: string, name: string): Record<string, any> {
  const re = new RegExp('(?:\\b' + name + '\\s*=\\s*|<script[^>]*id=["\\\']' + name + '["\\\'][^>]*>)', 'g');
  for (const match of html.matchAll(re)) {
    const start = match.index + match[0].length;
    let quoted = false, escaped = false, depth = 0;
    if (html[start] !== '{') continue;
    for (let end = start; end < html.length; end++) {
      const c = html[end];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return object(JSON.parse(html.slice(start, end + 1))); } catch { break; } }
    }
  }
  return {};
}
export async function downloadFixedPage(value: string, hosts: string[], fetcher: typeof fetch = fetch): Promise<Download> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new CollectionError(400, 'invalid_source_url', 'Unsupported public endpoint.');
  let response: Response;
  try { response = await fetchNoRedirect(url.href, { headers: { accept: 'text/html, application/json' }, signal: AbortSignal.timeout(8_000) }, fetcher); }
  catch (error) { throw new CollectionError(502, error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'source_timeout' : 'source_transport_failed', 'The public source request could not complete.'); }
  if (response.status !== 200) { await response.body?.cancel(); throw new CollectionError(422, 'source_unavailable', 'Public endpoint unavailable.', response.status); }
  const text = await readTextLimited(response, 2 * 1024 * 1024);
  return { text, url: url.href, status: response.status, contentType: response.headers.get('content-type') || '' };
}
export async function nativeYouTubeDiscovery(source: Source, channelId: string, seen: Set<string>, download: (url: string) => Promise<Download> = url => downloadFixedPage(url, ['www.youtube.com'])): Promise<YouTubeDiscovery> {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) throw new CollectionError(422, 'youtube_channel_unresolved', 'A stable channel identity is required.');
  const page = await download('https://www.youtube.com/channel/' + channelId + '/videos');
  const data = pageJson(page.text, 'ytInitialData');
  if (object(data.metadata?.channelMetadataRenderer).externalId !== channelId) throw new CollectionError(422, 'youtube_channel_mismatch', 'Channel identity was not confirmed.');
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
  const selected = Array.isArray(tabs) ? tabs.find(t => t.tabRenderer?.selected === true)?.tabRenderer?.content : undefined;
  if (!selected) throw new CollectionError(422, 'youtube_discovery_unavailable', 'The public uploads list was not supplied.');
  const ids = new Set<string>(); let nodes = 0;
  function visit(v: unknown, depth = 0) {
    if (++nodes > 20_000 || depth > 40) return;
    if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; }
    const row = object(v), renderer = object(row.videoRenderer || row.gridVideoRenderer);
    if (/^[A-Za-z0-9_-]{11}$/.test(renderer.videoId || '')) ids.add(renderer.videoId);
    for (const value of Object.values(row)) if (value && typeof value === 'object') visit(value, depth + 1);
  }
  visit(selected);
  // An unrecognized/empty page is not proof of an empty channel.
  if (!ids.size) throw new CollectionError(422, 'youtube_discovery_empty', 'No attributable uploads were supplied.');
  const updates: SourceUpdate[] = [];
  for (const id of [...ids].slice(0, DISCOVERY_ITEMS)) {
    if (seen.has('youtube:' + id)) continue;
    const watch = await download('https://www.youtube.com/watch?v=' + id), player = watchPagePlayer(watch.text);
    const details = object(player?.videoDetails), micro = object(object(player?.microformat).playerMicroformatRenderer);
    const publishedAt = exactPublicationTimestamp(micro.publishDate || micro.uploadDate);
    if (details.videoId !== id || details.channelId !== channelId || !publishedAt) throw new CollectionError(422, 'youtube_upload_unconfirmed', 'Upload identity and exact publication time were not confirmed.');
    updates.push({ id: 'native-youtube-' + id, sourceId: source.id, contributorIds: [], title: plainText(details.title, 240), summary: plainText(details.shortDescription, 700), url: 'https://www.youtube.com/watch?v=' + id, publishedAt, format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'metadata_only', ...(safeLink(details.thumbnail?.thumbnails?.at(-1)?.url, source.url) ? { image: safeLink(details.thumbnail.thumbnails.at(-1).url, source.url) } : {}), coverage: 'Bounded public Videos-tab discovery; Shorts, live streams and full history are not established.' });
  }
  return { updates, gapPossible: true };
}
