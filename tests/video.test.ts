import { describe, expect, it } from 'vitest';
import { formatTimestamp, getVideoHighlights, getVideoTimestampUrl, getVideoTranscript, isYouTubeUrl, parseTimedTranscript } from '../src/lib/video';
import type { SourceUpdate } from '../src/lib/types';

const update = (extra: Partial<SourceUpdate> = {}): SourceUpdate => ({ id: 'video', sourceId: 'channel', contributorIds: [], title: 'Hardware tests and results', summary: 'A description is not the spoken content.', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', publishedAt: '2026-10-21T12:00:00Z', format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, ...extra });

describe('YouTube timestamp links', () => {
  it.each(['https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=tracking&t=2s#test', 'https://youtu.be/dQw4w9WgXcQ?si=tracking', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/live/dQw4w9WgXcQ', 'https://youtube.com/embed/dQw4w9WgXcQ'])('links the exact video at a real supplied second: %s', url => {
    expect(isYouTubeUrl(url)).toBe(true);
    expect(getVideoTimestampUrl(url, 7384.99)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=7384s');
  });
  it.each(['javascript:alert(1)', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://evil.example/?v=dQw4w9WgXcQ', 'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ', 'https://user:secret@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/@channel', 'https://youtu.be/bad', 'https://youtube.com/watch?v=dQw4w9WgXcQ%26evil'])('rejects unsafe / nonvideo URLs: %s', url => {
    expect(isYouTubeUrl(url)).toBe(false);
    expect(getVideoTimestampUrl(url, 60)).toBeUndefined();
  });
  it.each([-1, NaN, Infinity])('rejects invalid times: %s', seconds => { expect(getVideoTimestampUrl(update().url, seconds)).toBeUndefined(); expect(formatTimestamp(seconds)).toBe(''); });
  it('formats exact minute and multihour times', () => { expect(formatTimestamp(0)).toBe('0:00'); expect(formatTimestamp(65.8)).toBe('1:05'); expect(formatTimestamp(7384)).toBe('2:03:04'); });
});

describe('actual subtitle cues and full stored transcripts', () => {
  it('parses SRT and preserves source wording, negation and real multihour timing', () => {
    expect(parseTimedTranscript('1\n00:00:01,250 --> 00:00:03,750\nThis is not faster.\n\n2\n02:03:04,000 --> 02:03:08,000\nThe battery lasted longer.')).toEqual([{ startSeconds: 1.25, durationSeconds: 2.5, text: 'This is not faster.' }, { startSeconds: 7384, durationSeconds: 4, text: 'The battery lasted longer.' }]);
  });
  it('supports VTT voice tags / entities and cue settings without treating headers as content', () => {
    expect(parseTimedTranscript('WEBVTT\n\nintro\n00:01.500 --> 00:05.000 align:start\n<v Speaker>Repair &amp; replacement are different.</v>\n\n')).toEqual([{ startSeconds: 1.5, durationSeconds: 3.5, text: 'Repair & replacement are different.' }]);
  });
  it('rejects malformed times and prose rather than inventing timing', () => {
    expect(parseTimedTranscript('1\n00:60:00,000 --> 00:61:00,000\nBad minutes.\n\n2\n00:01:30,000 --> 00:01:00,000\nBackwards.')).toEqual([]);
    expect(parseTimedTranscript('00:10 Introduction\n06:10 Camera test')).toEqual([]);
  });
  it('returns every stored caption without the previous 1400-character clipping', () => {
    const content = `${'This is spoken content. '.repeat(300)}The ending remains available.`;
    expect(getVideoTranscript(update({ contentKind: 'transcript', content }))).toBe(content);
    expect(getVideoTranscript(update({ contentKind: 'metadata_only', content: 'Description only.' }))).toBe('');
    expect(getVideoTranscript(update({ transcriptSegments: [{ startSeconds: 5, text: 'Actual cue text.' }] }))).toBe('Actual cue text.');
  });
});

describe('saved video takeaways', () => {
  it('never turns plain or timed captions into synthesized-looking fallback bullets', () => {
    const content = 'The hardware test found lower power consumption under the same workload. '.repeat(150);
    const transcriptSegments = [{ startSeconds: 0, text: 'The opening test found lower power use.' }, { startSeconds: 600, text: 'The ending remains available in the transcript.' }];
    expect(getVideoHighlights(update({ contentKind: 'transcript', content, transcriptSegments }))).toEqual([]);
    expect(getVideoHighlights(update({ transcriptSegments }))).toEqual([]);
    expect(getVideoTranscript(update({ contentKind: 'transcript', content }))).toBe(content.trim());
  });
  it('does not summarize a title, description, insights or short saved summary', () => {
    expect(getVideoHighlights(update({ insights: ['A source-provided claim.'] }))).toEqual([]);
    expect(getVideoHighlights(update({ contentKind: 'metadata_only', content: 'Detailed publisher description.' }))).toEqual([]);
    expect(getVideoHighlights(update({ contentKind: 'feed_text', content: 'A publisher description is not the spoken video.' }))).toEqual([]);
  });
  it('keeps saved takeaways and actual zero/late timestamps without estimating untimed ones', () => {
    const videoHighlights = [{ text: 'The controlled test found lower power consumption.', startSeconds: 0 }, { text: 'Battery life under other workloads remains unverified.' }, { text: 'The final repair result confirms parts remain available.', startSeconds: 7384 }];
    expect(getVideoHighlights(update({ videoHighlights, duration: '4:00:00' }))).toEqual(videoHighlights);
  });
  it('does not replace a reviewed empty result or unavailable annotation with source excerpts', () => {
    const content = 'Promotional source text with enough words to resemble a useful statement. '.repeat(100);
    for (const status of ['ready', 'unavailable'] as const) {
      expect(getVideoHighlights(update({ contentKind: 'transcript', content, videoHighlights: [], videoSummary: { ruleVersion: 'takeaways-v1', status, captionHash: 'saved-hash', timingBasis: 'none' } }))).toEqual([]);
    }
  });
  it('deduplicates saved points and drops invalid timing without changing their claims', () => {
    const text = 'The replacement battery is not compatible with the earlier model.';
    expect(getVideoHighlights(update({ videoHighlights: [{ text, startSeconds: -1 }, { text }, { text: 'A separate repair result remains unverified.', startSeconds: Infinity }] }))).toEqual([{ text }, { text: 'A separate repair result remains unverified.' }]);
  });
  it('retains the existing six-point limit and the ending of a longer saved annotation', () => {
    const videoHighlights = Array.from({ length: 12 }, (_, index) => ({ text: `Saved finding ${index}`, startSeconds: index * 300 }));
    const points = getVideoHighlights(update({ videoHighlights }));
    expect(points).toHaveLength(6); expect(points[0]).toEqual(videoHighlights[0]); expect(points.at(-1)).toEqual(videoHighlights.at(-1));
    expect(getVideoHighlights(update({ videoHighlights }), { all: true })).toEqual(videoHighlights);
  });
});
