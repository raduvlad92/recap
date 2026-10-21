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

describe('extractive video highlights', () => {
  it('selects up to six points spanning the whole transcript, including its final section', () => {
    const subjects = ['processor throughput', 'camera focus', 'battery charging', 'display contrast', 'keyboard repair', 'network stability'];
    const transcriptSegments = subjects.flatMap((subject, section) => Array.from({ length: 12 }, (_, index) => ({ startSeconds: section * 600 + index * 20, text: `The ${subject} test ${index} found a measurable improvement under controlled conditions.` })));
    const points = getVideoHighlights(update({ transcriptSegments }));
    expect(points).toHaveLength(6);
    subjects.forEach(subject => expect(points.some(point => point.text.includes(subject))).toBe(true));
    expect(points.at(-1)?.startSeconds).toBeGreaterThanOrEqual(3000);
    expect(points.map(point => point.startSeconds)).toEqual(points.map(point => point.startSeconds).sort((a, b) => a! - b!));
    points.forEach(point => expect(transcriptSegments.some(segment => segment.text === point.text && segment.startSeconds === point.startSeconds)).toBe(true));
  });
  it('does not summarize a title, description or short saved summary as full video content', () => {
    expect(getVideoHighlights(update())).toEqual([]);
    expect(getVideoHighlights(update({ contentKind: 'metadata_only', content: 'The product launch description contains many detailed claims.' }))).toEqual([]);
    expect(getVideoHighlights(update({ contentKind: 'feed_text', content: 'A long publisher description with enough words for extraction.' }))).toEqual([]);
  });
  it('keeps the complete negative sentence and never invents times for plain transcripts', () => {
    const content = 'The replacement battery is not compatible with the earlier model despite using the same connector. The external display supports higher resolutions because the cable carries additional bandwidth.';
    const points = getVideoHighlights(update({ contentKind: 'transcript', content, duration: '130 min' }));
    expect(points.some(point => point.text === 'The replacement battery is not compatible with the earlier model despite using the same connector.')).toBe(true);
    expect(points.every(point => point.startSeconds === undefined)).toBe(true);
  });
  it('maps a sentence spanning multiple subtitle cues to the actual starting cue', () => {
    const points = getVideoHighlights(update({ transcriptSegments: [{ startSeconds: 120, text: 'The replacement battery is not compatible' }, { startSeconds: 124, text: 'with the earlier model despite using the same connector.' }] }));
    expect(points).toEqual([{ text: 'The replacement battery is not compatible with the earlier model despite using the same connector.', startSeconds: 120 }]);
  });
  it('retains the rest of the transcript when timed metadata only covers its introduction', () => {
    const content = 'The introduction explains the controlled processor performance tests. The final repair result confirms replacement parts are available from several independent suppliers.';
    const points = getVideoHighlights(update({ contentKind: 'transcript', content, transcriptSegments: [{ startSeconds: 0, text: 'The introduction explains the controlled processor performance tests.' }] }));
    expect(points.some(point => point.text.includes('final repair result'))).toBe(true);
    expect(points.every(point => point.startSeconds === undefined)).toBe(true);
  });
  it('does not repeat duplicate rolling captions or highlight greetings / sponsor calls', () => {
    const useful = 'The battery test found a substantial improvement in standby performance under controlled conditions.';
    const content = `Welcome back to our channel and thanks for joining the show. This video is brought to you by our sponsor and a special discount offer. ${useful} ${useful} ${useful} Do not forget to like and subscribe to our channel.`;
    const points = getVideoHighlights(update({ contentKind: 'transcript', content }));
    expect(points).toHaveLength(1);
    expect(points[0].text).toBe(useful);
  });
  it('extracts from punctuation-free captions with explicit excerpt ellipses', () => {
    const sections = ['processor throughput silicon architecture cache bandwidth', 'camera focus optical stabilisation photographic dynamic range', 'battery charging temperature electrical efficiency storage', 'display contrast brightness colour accuracy backlight uniformity', 'keyboard repair switches keycaps replacement layout', 'network stability ethernet wireless latency connection throughput'];
    const content = sections.map((section, i) => Array.from({ length: 12 }, () => `experiment section ${i} measured ${section}`).join(' ')).join(' ');
    const points = getVideoHighlights(update({ contentKind: 'transcript', content }));
    expect(points.length).toBeGreaterThan(0); expect(points.length).toBeLessThanOrEqual(6);
    expect(points.some(point => point.text.includes('…'))).toBe(true);
    expect(points.every(point => point.text.length <= 360)).toBe(true);
    expect(points.at(-1)?.text).toContain('network stability');
  });
  it('uses supplied publisher chapter points without title synthesis, and spreads long lists', () => {
    const videoHighlights = Array.from({ length: 12 }, (_, index) => ({ text: `Publisher chapter ${index}`, startSeconds: index * 300 }));
    const points = getVideoHighlights(update({ videoHighlights }));
    expect(points).toHaveLength(6); expect(points[0]).toEqual(videoHighlights[0]); expect(points.at(-1)).toEqual(videoHighlights.at(-1));
  });
});
