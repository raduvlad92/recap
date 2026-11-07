import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { CollectionResult, Source, SourceUpdate } from '../../../src/lib/types';
import { normalizeFeed, plainText, safeLink } from './feed';
import { feedPublicationTimestamp, textResult } from './public-text';
const CONTENT_LIMIT = 24_000;
const array = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : value ? [value] : []).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');

/** Jobs-only augmentation of the existing feed normalizer. Keep the protected
 * native downloader and its source pin unchanged. The base call validates XML
 * and preserves existing update/source/link identities and reference handling. */
export function normalizePublicFeed(xml: string, source: Source, fetchedUrl: string): CollectionResult {
  const result = normalizeFeed(xml, source, fetchedUrl);
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, trimValues: false }).parse(xml);
  const channel = parsed.rss?.channel ?? parsed['rdf:RDF'] ?? parsed.feed;
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of array(channel.item ?? channel.entry).slice(0, 100)) {
    const links = array(entry.link), atomLink = links.find(link => !link['@_rel'] || link['@_rel'] === 'alternate');
    const link = safeLink(typeof entry.link === 'string' ? entry.link : atomLink?.['@_href'], fetchedUrl);
    if (link && !entries.has(link)) entries.set(link, entry);
  }
  result.updates = result.updates.map(update => {
    const entry = entries.get(update.url);
    if (!entry) return { ...update, publishedAt: '', contentKind: 'metadata_only', content: undefined };
    const link = update.url;
    const body = entry['content:encoded'] ?? entry.content;
    const rawBody = typeof body === 'object' ? String((body as Record<string, unknown>)['#text'] ?? '') : String(body ?? '');
    const content = plainText(rawBody);
    const fullFeedText = plainText(rawBody, 96_001);
    const assessment = textResult(fullFeedText);
    const isPodcast = source.platform === 'Podcast' || !!entry.enclosure || !!entry['itunes:duration'];
    const transcript = array(entry['podcast:transcript']).find(item => ['text/vtt','application/x-subrip','application/srt','application/json','text/plain'].includes(String(item['@_type']).split(';')[0].trim().toLowerCase()) && safeLink(item['@_url'], link));
    const transcriptUrl = transcript && safeLink(transcript['@_url'], link);
    const originalContent: NonNullable<SourceUpdate['originalContent']> = isPodcast
      ? { version: 1, method: 'publisher_transcript', status: transcriptUrl ? 'deferred' : 'unavailable', reason: transcriptUrl ? 'transcript_pending' : 'transcript_not_supplied', ...(transcriptUrl ? { url: transcriptUrl, mime: String(transcript!['@_type']).split(';')[0].trim().toLowerCase() } : {}), ...(typeof transcript?.['@_language'] === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(transcript['@_language']) ? { language: transcript['@_language'] } : {}) }
      : { version: 1, method: 'publisher_feed', status: assessment.usable && fullFeedText.length <= CONTENT_LIMIT ? 'usable' : 'partial', reason: fullFeedText.length > CONTENT_LIMIT ? 'text_capped' : assessment.reason };
    if (originalContent.status === 'usable') originalContent.contentHash = createHash('sha256').update(content).digest('hex');
    const publishedAt = feedPublicationTimestamp(plainText(entry.pubDate ?? entry.published ?? entry.updated, 100));
    return { ...update, publishedAt, originalContent,
      contentKind: isPodcast || originalContent.status !== 'usable' ? 'metadata_only' : 'feed_text',
      ...(!isPodcast && content ? { content } : { content: undefined }) };
  });
  return result;
}
