import { createHash } from 'node:crypto';
import type { OriginalContent, Source, SourceUpdate } from '../../../src/lib/types';
import { downloadPublic, plainText, type DownloadFeed } from './feed';
import { articleText, feedPublicationTimestamp, ORIGINAL_BYTES_LIMIT, ORIGINAL_TEXT_LIMIT, textResult, type TextResult } from './public-text';
import { CollectionError, publicHttpsUrl } from './security';
import { retrievalAttempt, type AttemptParent, type RetrievalLog } from './retrieval-log';

export const ORIGINAL_REQUESTS_PER_SOURCE = 3;
type Segments = NonNullable<SourceUpdate['transcriptSegments']>;
type ParsedOriginal = TextResult & { segments?: Segments };
const invalidTranscript = (): ParsedOriginal => ({ text: '', usable: false, reason: 'transcript_invalid' });
const seconds = (value: string): number => {
  const match = /^(?:(\d{2,3}):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/.exec(value);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : NaN;
};
/** Exact publisher formats only, not arbitrary provider JSON or audio. A
 * malformed cue rejects the file instead of quietly certifying its prefix. */
export function publisherTranscript(text: string, mime: string): ParsedOriginal {
  if (Buffer.byteLength(text) > ORIGINAL_BYTES_LIMIT) return { text: '', usable: false, reason: 'response_too_large' };
  const segments: Segments = [];
  try {
    if (mime === 'text/plain') {
      if (/<(?:!doctype|html|script|body)\b/i.test(text)) return invalidTranscript();
      return textResult(text);
    }
    if (mime === 'application/json') {
      const data = JSON.parse(text);
      if (data?.version !== '1.0.0' || !Array.isArray(data.segments) || !data.segments.length || data.segments.length > 4000) return invalidTranscript();
      for (const item of data.segments) {
        if (!item || typeof item.body !== 'string' || typeof item.startTime !== 'number' || !Number.isFinite(item.startTime) || item.startTime < 0 || item.startTime > 86400
          || item.endTime !== undefined && (typeof item.endTime !== 'number' || !Number.isFinite(item.endTime) || item.endTime <= item.startTime || item.endTime > 86400)) return invalidTranscript();
        segments.push({ startSeconds: item.startTime, text: plainText(item.body, ORIGINAL_TEXT_LIMIT + 1), ...(item.endTime !== undefined ? { durationSeconds: item.endTime - item.startTime } : {}) });
      }
    } else if (['text/vtt','application/x-subrip','application/srt'].includes(mime)) {
      const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
      if (mime === 'text/vtt' && !/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(normalized)) return invalidTranscript();
      const blocks = normalized.split(/\n[ \t]*\n/);
      if (blocks.length > 4002) return { text: '', usable: false, reason: 'transcript_cue_limit' };
      for (const block of blocks) {
        const lines = block.split('\n');
        if (mime === 'text/vtt' && /^WEBVTT(?:\s|$)/.test(lines[0])) { if (block.includes('-->')) return invalidTranscript(); continue; }
        if (mime === 'text/vtt' && /^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
        const index = lines[0].includes('-->') ? 0 : 1;
        const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[index] || '');
        if (!timing) return invalidTranscript();
        const start = seconds(timing[1]), end = seconds(timing[2]);
        if (lines.slice(index + 1).some(line => line.includes('-->'))) return invalidTranscript();
        const body = plainText(lines.slice(index + 1).join(' '), ORIGINAL_TEXT_LIMIT + 1);
        if (!body || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 86400) return invalidTranscript();
        segments.push({ startSeconds: start, durationSeconds: end - start, text: body });
      }
    } else return invalidTranscript();
    if (!segments.length || segments.length > 4000 || segments.some((segment, index) => !segment.text || index > 0 && segment.startSeconds < segments[index - 1].startSeconds)) return invalidTranscript();
    const result = textResult(segments.map(segment => segment.text).join(' '));
    return { ...result, ...(result.usable ? { segments } : {}) };
  } catch { return invalidTranscript(); }
}

export function originalAttemptKey(update: SourceUpdate): string {
  return 'original:' + createHash('sha256').update(update.sourceId + '\n' + update.url).digest('hex');
}
export function needsPublicOriginal(update: SourceUpdate): boolean {
  return ['article','podcast'].includes(update.format) && !!update.originalContent && ['partial','deferred'].includes(update.originalContent.status)
    && (update.format === 'article' || !!update.originalContent.url);
}

/** Shared only for this bounded worker invocation. The key contains the exact
 * public source/item/format, never a reader identifier; no cross-reader record
 * or follow data is cached. Persisted seen identities suppress later fetches. */
export function createPublicOriginalExtractor(download: DownloadFeed = downloadPublic) {
  const shared = new Map<string, Promise<ParsedOriginal>>();
  const admitted = new Set<string>();
  return async (source: Source, update: SourceUpdate, feedUrl: string, log: RetrievalLog, parent: AttemptParent): Promise<SourceUpdate> => {
    if (!needsPublicOriginal(update)) return update;
    const original = update.originalContent!;
    const method = update.format === 'podcast' ? 'publisher_transcript' : 'public_article';
    const failure = (reason: string, status: OriginalContent['status'] = 'unavailable'): SourceUpdate => ({ ...update, contentKind: 'metadata_only',
      originalContent: { ...original, method, status, reason, contentHash: undefined },
      coverage: `${update.format === 'podcast' ? 'Publisher transcript' : 'Public article body'} ${status}: ${reason}. Descriptions, excerpts and incomplete text are not usable full source text; completeness is not verified.` });
    const blocked = async (reason: string): Promise<SourceUpdate> => {
      await retrievalAttempt(log, { ...parent, itemKey: originalAttemptKey(update) }, method, 'native', 'content', async () => reason, () => ({ status: 'blocked', result_count: 0, error_code: reason }));
      return failure(reason);
    };
    if (!feedPublicationTimestamp(update.publishedAt) || update.isSample || !['Blog','Substack','Podcast'].includes(source.platform) || update.sourceId !== source.id) return blocked('original_identity_invalid');
    let target: URL;
    try {
      const item = publicHttpsUrl(update.url);
      const origins = [publicHttpsUrl(source.url).origin, publicHttpsUrl(feedUrl).origin];
      if (!origins.includes(item.origin)) return blocked('foreign_article_url');
      target = publicHttpsUrl(update.format === 'podcast' ? original.url : update.url);
      // Conservative first contract: publisher/feed origins only. Third-party
      // transcript CDNs require a later explicit allowlist, not link crawling.
      if (!origins.includes(target.origin)) return blocked('foreign_transcript_url');
    } catch { return blocked('unsafe_original_url'); }
    const memoKey = `${source.platform}\n${source.url}\n${feedUrl}\n${update.url}\n${target.href}\n${original.mime || 'text/html'}`;
    if (!admitted.has(memoKey)) {
      if (admitted.size >= 64) throw new CollectionError(429, 'original_batch_limit', 'This worker reached its shared-original bound.');
      admitted.add(memoKey);
    }
    const parsed = await retrievalAttempt(log, { ...parent, itemKey: originalAttemptKey(update) }, method, 'native', 'content', async () => {
      let pending = shared.get(memoKey);
      if (!pending) {
        pending = (async () => {
          const response = await download(target.href);
          if (response.status !== undefined && response.status !== 200) throw new CollectionError(422, 'original_http_unavailable', 'Original text was unavailable.', response.status);
          if (publicHttpsUrl(response.url).origin !== target.origin) throw new CollectionError(422, 'original_redirect_changed', 'Original text redirected outside its publisher origin.');
          if (Buffer.byteLength(response.text) > ORIGINAL_BYTES_LIMIT || response.bytes !== undefined && response.bytes > ORIGINAL_BYTES_LIMIT) throw new CollectionError(413, 'response_too_large', 'Original text exceeded the byte bound.');
          const mime = response.contentType.split(';')[0].trim().toLowerCase();
          if (method === 'public_article') {
            if (!['text/html','application/xhtml+xml'].includes(mime)) return { text: '', usable: false, reason: 'article_type_unsupported' };
            return articleText(response.text);
          }
          if (mime !== original.mime && !(mime === 'text/plain' && ['text/vtt','application/x-subrip','application/srt'].includes(original.mime || ''))) return { text: '', usable: false, reason: 'transcript_type_mismatch' };
          return publisherTranscript(response.text, original.mime || '');
        })();
        // Cache failures too, so followers never amplify a failing request.
        shared.set(memoKey, pending);
      }
      return pending;
    }, result => ({ status: result.usable ? 'succeeded' : result.text ? 'partial' : 'empty', result_count: result.usable ? 1 : 0, error_code: result.usable ? null : result.reason }));
    if (!parsed.usable) return { ...failure(parsed.reason, parsed.text ? 'partial' : 'unavailable'), ...(parsed.text ? { content: parsed.text } : {}) };
    return { ...update, content: parsed.text, contentKind: method === 'publisher_transcript' ? 'transcript' : 'feed_text',
      ...(parsed.segments ? { transcriptSegments: parsed.segments } : {}),
      originalContent: { version: 1, method, status: 'usable', reason: 'usable_text', url: target.href, ...(original.mime ? { mime: original.mime } : {}), ...(original.language ? { language: original.language } : {}), contentHash: createHash('sha256').update(parsed.text).digest('hex') },
      coverage: method === 'publisher_transcript' ? 'Publisher-supplied transcript from the exact episode feed link; audio completeness and transcript accuracy are not independently verified.' : 'Public main-article body from the exact feed item link; no detected clipping, but publisher completeness is not independently verified.' };
  };
}
