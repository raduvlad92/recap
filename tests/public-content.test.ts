import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { articleText, feedPublicationTimestamp, ORIGINAL_TEXT_LIMIT } from '../netlify/functions/_shared/public-text';
import { createPublicOriginalExtractor, originalAttemptKey, publisherTranscript } from '../netlify/functions/_shared/public-content';
import { normalizePublicFeed } from '../netlify/functions/_shared/public-feed';
import { sanitizeArchivedUpdate } from '../src/lib/domain';
import { sourceContentState, usableAnalysisContent } from '../src/lib/content-processing';
import { testRetrievalLog } from './helpers/retrieval-log';
import type { Source, SourceUpdate } from '../src/lib/types';

const prose = 'The publisher measured the laboratory instrument over three weeks. The newer design reduced background noise while preserving the original signal. These results apply to the tested configuration and do not establish the same result in every setting. ';
const source: Source = { id: 'fixture-publication', name: 'Synthetic publication', url: 'https://publication.example/', platform: 'Blog', creatorIds: [], status: 'ready' };
const rss = (item: string) => `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Fixture</title>${item}</channel></rss>`;
const item = (body = '<description>A short excerpt</description>', date = 'Sat, 07 Nov 2026 12:00:00 GMT') => `<item><title>Synthetic original</title><link>https://publication.example/articles/one</link><pubDate>${date}</pubDate>${body}</item>`;
const update = () => normalizePublicFeed(rss(item()), source, 'https://publication.example/feed').updates[0];
const response = (text: string, contentType = 'text/html') => ({ text, contentType, url: 'https://publication.example/articles/one', status: 200, bytes: Buffer.byteLength(text) });
const html = `<html><nav>Unrelated navigation</nav><article><h1>Synthetic original</h1><div class="body markup"><p>${prose}</p><p>The closing qualification remains in the body.</p><aside>Unrelated recommendation</aside><script>globalThis.mustNeverRun = true</script></div><section class="comments">Private comment</section></article></html>`;

describe('bounded public original text', () => {
  it('extracts the explicit main article without scripts, navigation, comments or a bibliography crawl', () => {
    const result = articleText(html);
    expect(result.usable).toBe(true); expect(result.text).toContain(prose.trim());
    expect(result.text).toContain('closing qualification');
    expect(result.text).not.toMatch(/Unrelated|mustNeverRun|Private comment/);
  });
  it.each([
    ['<article><p>' + prose + '[truncated]</p></article>', 'text_clipped'],
    ['<article><p>' + prose, 'article_body_unclosed'],
    ['<article>' + prose + '</article><article>' + prose + '</article>', 'ambiguous_article'],
    ['<article>' + prose + '<div class="paywall">Subscribe</div></article>', 'restricted_article'],
    ['<script type="application/ld+json">{"isAccessibleForFree":false}</script><article>' + prose + '</article>', 'restricted_article'],
    ['<article>' + 'x'.repeat(ORIGINAL_TEXT_LIMIT + 1) + '</article>', 'text_capped'],
    ['<html><body>Only the title</body></html>', 'article_body_missing'],
    ['<article>' + '<div>'.repeat(129) + prose, 'parse_limit'],
  ])('keeps partial/restricted/unsupported bodies out of usable text (%s)', (value, reason) => {
    expect(articleText(value)).toMatchObject({ usable: false, reason });
  });
  it.each(['2026-11-07','2026-11-07T12:00:00','2026-02-30T12:00:00Z','Mon, 30 Feb 2026 12:00:00 GMT','2026-11-07T25:00:00Z','2026-11-07T12:00:00+01:99',''])('does not invent an instant from %s', value => {
    expect(feedPublicationTimestamp(value)).toBe('');
    expect(normalizePublicFeed(rss(item(undefined, value)), source, source.url).updates[0].publishedAt).toBe('');
  });
  it('preserves the exact publisher instant in RSS and Atom, including timezone', () => {
    expect(feedPublicationTimestamp('Sat, 07 Nov 2026 12:00:00 +0100')).toBe('2026-11-07T11:00:00.000Z');
    const atom = `<feed><entry><title>Fixture</title><link href="https://publication.example/articles/one"/><published>2026-11-07T12:00:00+01:00</published><content type="html">${prose}</content></entry></feed>`;
    expect(normalizePublicFeed(atom, source, source.url).updates[0]).toMatchObject({ publishedAt: '2026-11-07T11:00:00.000Z', originalContent: { status: 'usable', method: 'publisher_feed' } });
  });
  it('prefers uncapped feed body text and leaves descriptions and clipped feeds distinct', async () => {
    const full = normalizePublicFeed(rss(item(`<content:encoded><![CDATA[<p>${prose}</p>]]></content:encoded>`)), source, source.url).updates[0];
    const download = vi.fn(), extract = createPublicOriginalExtractor(download);
    expect((await extract(source, full, source.url, testRetrievalLog(), { checkId: 'check' })).content).toBe(full.content);
    expect(download).not.toHaveBeenCalled(); expect(full.originalContent?.status).toBe('usable');
    const partial = normalizePublicFeed(rss(item(`<content:encoded><![CDATA[<p>${prose} Continue reading</p>]]></content:encoded>`)), source, source.url).updates[0];
    expect(partial).toMatchObject({ contentKind: 'metadata_only', originalContent: { status: 'partial' } });
    expect(usableAnalysisContent(partial)).toBe(false); expect(update().content).toBeUndefined();
  });
  it('keeps over-limit feed text partial even when a nonempty prefix exists', () => {
    const record = normalizePublicFeed(rss(item(`<content:encoded>${'x'.repeat(25_000)}</content:encoded>`)), source, source.url).updates[0];
    expect(record.content).toHaveLength(24_000); expect(record.originalContent?.status).toBe('partial'); expect(record.contentKind).toBe('metadata_only');
  });
  it('shares one exact safe download between followers, preserves identity/date and stores provenance outside diagnostics', async () => {
    const download = vi.fn(async () => response(html)), log = testRetrievalLog(), extract = createPublicOriginalExtractor(download), record = update();
    const results = await Promise.all([extract(source, record, source.url, log, { checkId: 'one' }), extract({ ...source, id: 'other-reader-source' }, { ...record, sourceId: 'other-reader-source' }, source.url, log, { checkId: 'two' })]);
    expect(download).toHaveBeenCalledExactlyOnceWith(record.url); expect(results[0]).toMatchObject({ id: record.id, sourceId: record.sourceId, publishedAt: record.publishedAt, contentKind: 'feed_text', originalContent: { method: 'public_article', status: 'usable', url: record.url } });
    expect(results[0].originalContent?.contentHash).toBe(createHash('sha256').update(results[0].content!).digest('hex'));
    expect(sanitizeArchivedUpdate(results[0])?.originalContent).toEqual(results[0].originalContent);
    expect(sourceContentState(results[0])).toBe('partial'); // usable is not a full-original completeness claim
    expect(JSON.stringify(vi.mocked(log.finish).mock.calls)).not.toContain(record.url);
    expect(originalAttemptKey(record)).toMatch(/^original:[a-f0-9]{64}$/);
  });
  it.each(['https://other.example/article','https://127.0.0.1/article','http://publication.example/article','https://user:secret@publication.example/article'])('rejects foreign/unsafe item links without fetching %s', async url => {
    const download = vi.fn(); const result = await createPublicOriginalExtractor(download)(source, { ...update(), url }, source.url, testRetrievalLog(), { checkId: 'one' });
    expect(download).not.toHaveBeenCalled(); expect(result.contentKind).toBe('metadata_only');
  });
  it('never fetches invalid/missing-date originals or follows article hyperlinks', async () => {
    const download = vi.fn(async () => response(html + '<a href="https://other.example/paper">Research</a>'));
    const extract = createPublicOriginalExtractor(download);
    await extract(source, { ...update(), publishedAt: '' }, source.url, testRetrievalLog(), { checkId: 'one' });
    expect(download).not.toHaveBeenCalled();
    await extract(source, update(), source.url, testRetrievalLog(), { checkId: 'two' }); expect(download).toHaveBeenCalledTimes(1);
  });
  it('rejects foreign final redirects, oversized replies and MIME mismatches', async () => {
    for (const bad of [{ ...response(html), url: 'https://other.example/article' }, { ...response(html), bytes: 3 * 1024 * 1024 }]) {
      await expect(createPublicOriginalExtractor(async () => bad)(source, update(), source.url, testRetrievalLog(), { checkId: 'one' })).rejects.toMatchObject({ code: expect.stringMatching(/original_redirect_changed|response_too_large/) });
    }
    const result = await createPublicOriginalExtractor(async () => response(html, 'application/json'))(source, update(), source.url, testRetrievalLog(), { checkId: 'one' });
    expect(result.originalContent?.status).toBe('unavailable');
  });
  it('shares failed downloads and stops at the bounded shared batch without opening another attempt', async () => {
    const broken = vi.fn(async () => { throw new Error('Synthetic transport failure'); }), log = testRetrievalLog(), extract = createPublicOriginalExtractor(broken);
    await expect(extract(source, update(), source.url, log, { checkId: 'one' })).rejects.toThrow();
    await expect(extract(source, update(), source.url, log, { checkId: 'two' })).rejects.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    const download = vi.fn(async (url: string) => ({ ...response(html), url })), boundedLog = testRetrievalLog(), bounded = createPublicOriginalExtractor(download);
    for (let index = 0; index < 64; index++) await bounded(source, { ...update(), url: source.url + 'article/' + index }, source.url, boundedLog, { checkId: 'one' });
    await expect(bounded(source, { ...update(), url: source.url + 'article/65' }, source.url, boundedLog, { checkId: 'two' })).rejects.toMatchObject({ code: 'original_batch_limit' });
    expect(download).toHaveBeenCalledTimes(64); expect(boundedLog.start).toHaveBeenCalledTimes(64);
  });
});

describe('publisher episode transcripts', () => {
  const cases = [
    ['text/vtt', `WEBVTT\n\n00:00.000 --> 00:10.000\n<v Speaker>${prose}\n\n00:10.000 --> 00:20.000\nThe closing qualification is included.`],
    ['application/x-subrip', `1\n00:00:00,000 --> 00:00:10,000\n${prose}\n\n2\n00:00:10,000 --> 00:00:20,000\nThe closing qualification is included.`],
    ['application/json', JSON.stringify({ version: '1.0.0', segments: [{ startTime: 0, endTime: 10, body: prose }, { startTime: 10, endTime: 20, body: 'The closing qualification is included.' }] })],
    ['text/plain', prose + 'The closing qualification is included.'],
  ];
  it.each(cases)('imports only explicitly linked %s, retaining episode citation and timings where supplied', async (mime, text) => {
    const podcast = { ...source, platform: 'Podcast' as const };
    const episode = normalizePublicFeed(rss(item(`<enclosure url="https://publication.example/audio.mp3"/><podcast:transcript url="https://publication.example/one.txt" type="${mime}" language="en"/>`)), podcast, source.url).updates[0];
    expect(episode.content).toBeUndefined(); expect(episode.originalContent?.status).toBe('deferred');
    const download = vi.fn(async () => ({ ...response(text, mime), url: 'https://publication.example/one.txt' }));
    const result = await createPublicOriginalExtractor(download)(podcast, episode, source.url, testRetrievalLog(), { checkId: 'one' });
    expect(download).toHaveBeenCalledExactlyOnceWith('https://publication.example/one.txt');
    expect(result).toMatchObject({ url: episode.url, publishedAt: episode.publishedAt, contentKind: 'transcript', originalContent: { method: 'publisher_transcript', status: 'usable', language: 'en' } });
    expect(result.content).toContain('closing qualification');
    if (mime !== 'text/plain') expect(result.transcriptSegments?.at(-1)).toMatchObject({ startSeconds: 10, durationSeconds: 10 });
  });
  it.each([
    ['text/vtt','WEBVTT\n\n00:00.000 --> 00:01.000\n' + prose + '\n\ninvalid tail'],
    ['text/vtt','WEBVTT\n00:00.000 --> 00:01.000\n' + prose],
    ['text/vtt','WEBVTT\n\n00:00.000 --> 00:01.000\n' + prose + '\n00:01.000 --> 00:02.000\nMissing cue separator'],
    ['application/x-subrip','1\n00:00:10,000 --> 00:00:00,000\n' + prose],
    ['application/json',JSON.stringify({ version: '1.0.0', segments: [{ startTime: -1, body: prose }] })],
    ['application/json',JSON.stringify({ transcript: prose })],
    ['text/plain','<html><body>' + prose + '</body></html>'],
    ['text/plain',prose + '[clipped]'],
  ])('never treats malformed/clipped %s as usable speech', (mime,text) => expect(publisherTranscript(text,mime).usable).toBe(false));
  it('does not infer speech from show notes, audio enclosures or unsupported transcript formats', () => {
    const episode = normalizePublicFeed(rss(item(`<content:encoded>${prose}</content:encoded><enclosure url="https://publication.example/audio.mp3"/><podcast:transcript url="https://publication.example/transcript.html" type="text/html"/>`)), { ...source, platform: 'Podcast' }, source.url).updates[0];
    expect(episode).toMatchObject({ format: 'podcast', contentKind: 'metadata_only', originalContent: { status: 'unavailable', reason: 'transcript_not_supplied' } }); expect(episode.content).toBeUndefined();
  });
});
