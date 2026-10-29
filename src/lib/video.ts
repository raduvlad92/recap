import type { SourceUpdate, VideoKeyword } from './types';
import { contentHash, usableAnalysisContent, getKeywordContentHash } from './content-processing';

export type VideoHighlight = { text: string; startSeconds?: number };
export type TranscriptSegment = NonNullable<SourceUpdate['transcriptSegments']>[number];

const MAX_HIGHLIGHTS = 6;
const validSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const cleanText = (value: string): string => value.replace(/<\/?[a-z][^>]*>|<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>/gi, '').replace(/&(?:amp|quot|apos|nbsp|lt|gt|#39);/gi, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&#39;': "'" })[entity.toLowerCase()] || entity).replace(/\s+/g, ' ').trim();

function youtubeVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.split('/').filter(Boolean);
    let id: string | undefined;
    if (host === 'youtu.be' || host === 'www.youtu.be') id = path.length === 1 ? path[0] : undefined;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || undefined;
      if (['shorts', 'live', 'embed'].includes(path[0]) && path.length === 2) id = path[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch { return; }
}

/** Only recognized public YouTube video URLs qualify; channel pages do not. */
export function isYouTubeUrl(value: string): boolean { return !!youtubeVideoId(value); }

/** Canonicalizes the video identity and drops tracking / unrelated query parameters. */
export function getVideoTimestampUrl(value: string, startSeconds: number): string | undefined {
  const id = youtubeVideoId(value);
  return id && validSeconds(startSeconds) ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(startSeconds)}s` : undefined;
}

export function formatTimestamp(value: number): string {
  if (!validSeconds(value)) return '';
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function cueSeconds(value: string): number | undefined {
  const parts = value.replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return;
  const values = parts.map(Number);
  const seconds = values.at(-1)!;
  const minutes = values.at(-2)!;
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return;
  const result = parts.length === 3 ? values[0] * 3600 + minutes * 60 + seconds : minutes * 60 + seconds;
  return validSeconds(result) ? result : undefined;
}

/** Parses actual SRT / WebVTT cues. Plain prose and chapter lists are not timed captions. */
export function parseTimedTranscript(value: string): TranscriptSegment[] {
  const lines = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].trim().match(/^(\d{1,}:\d{2}(?::\d{2})?[.,]\d{1,3})\s+-->\s+(\d{1,}:\d{2}(?::\d{2})?[.,]\d{1,3})(?:\s+.*)?$/);
    if (!match) continue;
    const startSeconds = cueSeconds(match[1]);
    const endSeconds = cueSeconds(match[2]);
    if (startSeconds === undefined || endSeconds === undefined || endSeconds < startSeconds) continue;
    const textLines: string[] = [];
    while (index + 1 < lines.length && lines[index + 1].trim() && !lines[index + 1].includes('-->')) textLines.push(lines[++index]);
    const text = cleanText(textLines.join(' '));
    if (text) segments.push({ startSeconds, durationSeconds: endSeconds - startSeconds, text });
  }
  return segments.sort((a, b) => a.startSeconds - b.startSeconds);
}

function validSegments(update: SourceUpdate): TranscriptSegment[] {
  if (!Array.isArray(update.transcriptSegments)) return [];
  return update.transcriptSegments.filter(segment => segment && validSeconds(segment.startSeconds) && typeof segment.text === 'string' && cleanText(segment.text)).map(segment => ({ ...segment, text: cleanText(segment.text) })).sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Returns all the stored transcript text, never a description or the card's short summary. */
export function getVideoTranscript(update: SourceUpdate): string {
  const content = update.contentKind === 'transcript' && typeof update.content === 'string' ? update.content.trim() : '';
  if (content) {
    const parsed = parseTimedTranscript(content);
    return parsed.length ? parsed.map(segment => segment.text).join('\n') : content;
  }
  return validSegments(update).map(segment => segment.text).join('\n');
}

const identity = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const boilerplate = (value: string): boolean => /^(?:\[(?:music|applause|laughter)\]|(?:hey|hi|hello)(?:\s+(?:everyone|guys|folks|there))?[,! .]|welcome(?: back)?\b|thanks? (?:you )?for watching\b)/i.test(value) || /(?:brought to you by|today'?s sponsor|sponsored by|don'?t forget to (?:like|subscribe)|like (?:and|&) subscribe|hit (?:the |that )?(?:like|subscribe) button|subscribe to (?:our|my|the) channel)/i.test(value);

/** Reads saved takeaways only. Unprocessed captions remain in the transcript. */
export function getVideoHighlights(update: SourceUpdate, options: { all?: boolean } = {}): VideoHighlight[] {
  if (update.videoSummary?.status === 'unavailable') return [];
  const supplied = Array.isArray(update.videoHighlights) ? update.videoHighlights : [];
  if (supplied.length) {
    const published = usableAnalysisContent(update) && update.videoSummary?.status === 'ready' && update.videoSummary.captionHash === contentHash(update.content!);
    const seen = new Set<string>();
    const clean = supplied.filter(point => point && typeof point.text === 'string').flatMap(point => {
      const text = cleanText(point.text), key = identity(text);
      if (!key || seen.has(key) || !published && boilerplate(text)) return [];
      seen.add(key);
      return [{ text, ...(validSeconds(point.startSeconds) ? { startSeconds: point.startSeconds } : {}) }];
    });
    // Preserve the existing six-point layout for saved annotations.
    if (clean.length) return options.all ? clean.slice(0, 30) : clean.length <= MAX_HIGHLIGHTS ? clean : Array.from({ length: MAX_HIGHLIGHTS }, (_, index) => clean[Math.round(index * (clean.length - 1) / (MAX_HIGHLIGHTS - 1))]);
  }
  return [];
}

export function getVideoKeywords(update: SourceUpdate): VideoKeyword[] {
  if (!usableAnalysisContent(update)) return [];
  const hash = contentHash(update.content!);
  const savedHash = getKeywordContentHash(update);
  if (!savedHash || savedHash !== hash) return [];
  const seen = new Set<string>();
  return (update.videoKeywords ?? []).filter(keyword => {
    const key = keyword.label.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => (b.seconds ?? -1) - (a.seconds ?? -1));
}

export function formatDiscussionTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '';
  return seconds < 60 ? '<1 min' : `~${Math.round(seconds / 60)} min`;
}
