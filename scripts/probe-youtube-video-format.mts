import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { watchPagePlayer } from '../src/lib/video-format.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE = 'https://www.youtube.com';
const MAX_SHORT_SECONDS = 180;
const PAGE_LIMIT = 8 * 1024 * 1024;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function classifyPublicYouTubePage(html: string, videoId: string) {
  if (!VIDEO_ID.test(videoId)) throw new Error('Invalid YouTube video ID');
  const player = watchPagePlayer(html);
  const details = object(player?.videoDetails);
  const microformat = object(object(player?.microformat).playerMicroformatRenderer);
  const playability = object(player?.playabilityStatus).status;
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(([tag]) => /\brel\s*=\s*["']canonical["']/i.test(tag))
    .map(([tag]) => /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.replaceAll('&amp;', '&'));
  const canonical = canonicals.length === 1 ? canonicals[0] : undefined;
  const seconds = typeof details.lengthSeconds === 'string' && /^\d{1,8}$/.test(details.lengthSeconds)
    ? Number(details.lengthSeconds) : undefined;
  const watch = YOUTUBE + '/watch?v=' + videoId;
  const shorts = YOUTUBE + '/shorts/' + videoId;
  const evidence = {
    canonical: canonical === watch || canonical === shorts ? canonical : undefined,
    seconds,
    playerMatches: details.videoId === videoId,
    playable: playability === 'OK',
  };
  const result = (kind: 'regular' | 'short' | 'unknown', reason: string) => ({ kind, reason, ...evidence });

  if (!evidence.playerMatches || !evidence.playable || !evidence.canonical) return result('unknown', 'exact_playable_original_unconfirmed');
  const marks = [details.isShort, details.isShorts, microformat.isShorts];
  if (canonical === shorts && !marks.includes(false) && (seconds === undefined || seconds > 0 && seconds <= MAX_SHORT_SECONDS)) {
    return result('short', 'exact_shorts_canonical');
  }
  if (canonical === watch && !marks.includes(true) && seconds !== undefined && seconds > MAX_SHORT_SECONDS) {
    return result('regular', 'exact_watch_canonical_and_duration_above_shorts_limit');
  }
  return result('unknown', 'insufficient_or_conflicting_format_evidence');
}

async function readPage(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > PAGE_LIMIT) {
    await response.body?.cancel();
    throw new Error('page_too_large');
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > PAGE_LIMIT) {
        await reader.cancel();
        throw new Error('page_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

export async function probeYouTubeVideoFormat(videoId: string, fetchPage: typeof fetch = fetch) {
  if (!VIDEO_ID.test(videoId)) throw new Error('Invalid YouTube video ID');
  const url = YOUTUBE + '/watch?v=' + videoId;
  const checkedAt = new Date().toISOString();
  let httpStatus: number | undefined;
  try {
    const response = await fetchPage(url, {
      redirect: 'manual', credentials: 'omit', headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(8_000),
    });
    httpStatus = response.status;
    if (httpStatus !== 200 || (response.url && response.url !== url)) {
      await response.body?.cancel();
      return { videoId, checkedAt, httpStatus, kind: 'unknown' as const, reason: 'watch_response_unavailable' };
    }
    const page = await readPage(response);
    const evidence = classifyPublicYouTubePage(page.toString('utf8'), videoId);
    return { videoId, checkedAt, httpStatus, ...evidence, pageSha256: createHash('sha256').update(page).digest('hex') };
  } catch (error) {
    const reason = error instanceof Error && error.message === 'page_too_large' ? 'page_too_large' : 'watch_request_failed';
    return { videoId, checkedAt, httpStatus, kind: 'unknown' as const, reason };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.slice(2);
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => !VIDEO_ID.test(id))) {
    console.error('Usage: node --experimental-strip-types scripts/probe-youtube-video-format.mts <1–50 unique YouTube video IDs>');
    process.exitCode = 2;
  } else {
    const results = [];
    for (const id of ids) results.push(await probeYouTubeVideoFormat(id));
    console.log(JSON.stringify(results, null, 2));
  }
}
