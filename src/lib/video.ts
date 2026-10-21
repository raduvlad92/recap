import type { SourceUpdate } from './types';

export type VideoHighlight = { text: string; startSeconds?: number };
export type TranscriptSegment = NonNullable<SourceUpdate['transcriptSegments']>[number];

const MAX_HIGHLIGHTS = 6;
const EXCERPT_LENGTH = 230;
const TRANSCRIPT_CHARACTERS_PER_POINT = 700;
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

const STOP_WORDS = new Set('a an and are as at be been being but by can could did do does for from had has have he her hers him his how i if in into is it its just may me more most my no not of on one or our ours out she so some than that the their theirs them then there these they this those to too up us very was we were what when where which who will with would you your yours'.split(' '));
const tokens = (value: string): string[] => (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) || []).filter(word => word.length > 2 && !STOP_WORDS.has(word));
const identity = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const boilerplate = (value: string): boolean => /^(?:\[(?:music|applause|laughter)\]|(?:hey|hi|hello)(?:\s+(?:everyone|guys|folks|there))?[,! .]|welcome(?: back)?\b|thanks? (?:you )?for watching\b)/i.test(value) || /(?:brought to you by|today'?s sponsor|sponsored by|don'?t forget to (?:like|subscribe)|like (?:and|&) subscribe|hit (?:the |that )?(?:like|subscribe) button|subscribe to (?:our|my|the) channel)/i.test(value);

type Candidate = VideoHighlight & { offset: number; words: Set<string>; score: number };

function sourceText(update: SourceUpdate): { text: string; cues: Array<{ offset: number; startSeconds: number }> } {
  const stored = update.contentKind === 'transcript' && typeof update.content === 'string' ? update.content.trim() : '';
  let segments = validSegments(update);
  const parsed = stored ? parseTimedTranscript(stored) : [];
  if (!segments.length) segments = parsed;
  // Incomplete cue metadata must not make us ignore the rest of the available transcript.
  if (stored && !parsed.length && cleanText(stored).length > segments.reduce((sum, segment) => sum + segment.text.length + 1, 0) * 1.2) return { text: cleanText(stored), cues: [] };
  if (!segments.length) return { text: cleanText(stored), cues: [] };
  let text = '';
  const cues: Array<{ offset: number; startSeconds: number }> = [];
  for (const segment of segments) {
    if (text) text += ' ';
    cues.push({ offset: text.length, startSeconds: segment.startSeconds });
    text += segment.text;
  }
  return { text, cues };
}

function cueAt(cues: Array<{ offset: number; startSeconds: number }>, offset: number): number | undefined {
  let low = 0, high = cues.length - 1, found: number | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].offset <= offset) { found = cues[middle].startSeconds; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}

function similarity(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

/**
 * Selects up to six chronological, extractive points across ALL available captions.
 * These are source excerpts, not AI-written summaries. Cue times are never estimated
 * from character position, word count, or the video's advertised duration.
 */
export function getVideoHighlights(update: SourceUpdate): VideoHighlight[] {
  const supplied = Array.isArray(update.videoHighlights) ? update.videoHighlights : [];
  if (supplied.length) {
    const seen = new Set<string>();
    const clean = supplied.filter(point => point && typeof point.text === 'string').flatMap(point => {
      const text = cleanText(point.text), key = identity(text);
      if (!key || seen.has(key) || boilerplate(text)) return [];
      seen.add(key);
      return [{ text, ...(validSeconds(point.startSeconds) ? { startSeconds: point.startSeconds } : {}) }];
    });
    // Publisher-provided chapter labels also need to span the whole video.
    if (clean.length) return clean.length <= MAX_HIGHLIGHTS ? clean : Array.from({ length: MAX_HIGHLIGHTS }, (_, index) => clean[Math.round(index * (clean.length - 1) / (MAX_HIGHLIGHTS - 1))]);
  }
  const { text, cues } = sourceText(update);
  if (!text) return [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const frequencies = new Map<string, number>();
  for (const word of tokens(text)) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  const titleWords = new Set(tokens(update.title));
  const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text);
  for (const sentence of sentences) {
    const value = sentence.segment.trim();
    const leadingSpace = sentence.segment.length - sentence.segment.trimStart().length;
    // Keep complete sentences intact, including their negations and qualifications.
    // Punctuation-free captions use explicitly marked contiguous excerpts instead.
    const parts: Array<{ value: string; offset: number }> = [];
    if (value.length <= 360) parts.push({ value, offset: sentence.index + leadingSpace });
    else {
      for (let start = 0; start < value.length;) {
        let end = Math.min(start + EXCERPT_LENGTH, value.length);
        if (end < value.length) {
          const boundary = value.lastIndexOf(' ', end);
          if (boundary > start) end = boundary;
          // Keep a nearby negative / contrast clause with the preceding words.
          const following = value.slice(end, end + 100);
          if (/^\s+(?:(?:is|are|was|were|do|does|did|can|could|would|will|should)\s+)?(?:not|never|no|but|however|unless|except)\b/i.test(following)) {
            const nextBoundary = value.indexOf(' ', Math.min(end + 100, value.length));
            end = nextBoundary === -1 ? value.length : nextBoundary;
          }
        }
        const excerpt = value.slice(start, end).trim();
        parts.push({ value: `${start ? '… ' : ''}${excerpt}${end < value.length ? ' …' : ''}`, offset: sentence.index + leadingSpace + start });
        start = end + (value[end] === ' ' ? 1 : 0);
      }
    }
    for (const part of parts) {
      const words = new Set(tokens(part.value));
      const key = identity(part.value);
      if (part.value.length < 35 || words.size < 4 || seen.has(key) || boilerplate(part.value)) continue;
      seen.add(key);
      const score = [...words].reduce((sum, word) => sum + Math.min(3, Math.log2(1 + (frequencies.get(word) || 0))) + (titleWords.has(word) ? 2 : 0), 0) / Math.sqrt(words.size)
        + (/\b(?:because|means|instead|however|costs?|supports?|results?|found|improved|changed)\b/i.test(part.value) ? 1 : 0)
        + (/\d/.test(part.value) ? .5 : 0);
      const startSeconds = cueAt(cues, part.offset);
      candidates.push({ text: part.value, offset: part.offset, words, score, ...(startSeconds === undefined ? {} : { startSeconds }) });
    }
  }
  const chosen: Candidate[] = [];
  // A Short should not receive the same six-point treatment as a substantial video.
  // Budget against the full caption text before choosing across chronological regions.
  const pointBudget = Math.min(MAX_HIGHLIGHTS, Math.ceil(text.length / TRANSCRIPT_CHARACTERS_PER_POINT));
  const windows = Math.min(pointBudget, candidates.length);
  if (!windows) return [];
  // One salient excerpt per chronological region prevents an introduction-only recap.
  for (let window = 0; window < windows; window++) {
    const start = Math.floor(window * candidates.length / windows);
    const end = Math.floor((window + 1) * candidates.length / windows);
    const eligible = candidates.slice(start, end).filter(candidate => chosen.every(other => similarity(candidate.words, other.words) < .85));
    eligible.sort((a, b) => (b.score - Math.max(0, ...chosen.map(other => similarity(b.words, other.words))) * 3) - (a.score - Math.max(0, ...chosen.map(other => similarity(a.words, other.words))) * 3) || a.offset - b.offset);
    if (eligible[0]) chosen.push(eligible[0]);
  }
  return chosen.sort((a, b) => a.offset - b.offset).map(({ text: excerpt, startSeconds }) => ({ text: excerpt, ...(startSeconds === undefined ? {} : { startSeconds }) }));
}
