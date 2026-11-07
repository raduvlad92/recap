import { describe, it, expect, vi } from 'vitest';
import { exactPublicationTimestamp, nativeYouTubeDiscovery, pageJson } from '../netlify/functions/_shared/youtube-discovery';
import type { Source } from '../src/lib/types';
const channel = 'UCabcdefghijklmnopqrstuv', video = 'abcdefghijk';
const source: Source = { id: 'source', name: 'Channel', platform: 'YouTube', url: 'https://www.youtube.com/channel/' + channel, status: 'ready', creatorIds: [] };
const page = (identity = channel) => 'var ytInitialData = ' + JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: identity } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [{ videoRenderer: { videoId: video } }] } } } }] } } });
const watch = (identity = channel, date = '2026-11-04T12:34:56+00:00') => 'var ytInitialPlayerResponse = ' + JSON.stringify({ videoDetails: { videoId: video, channelId: identity, title: 'An upload', shortDescription: 'Publisher description' }, microformat: { playerMicroformatRenderer: { publishDate: date } } });
const download = (watchText = watch()) => vi.fn(async (url: string) => ({ text: url.includes('/watch?') ? watchText : page(), url, contentType: 'text/html', status: 200 }));
describe('free public YouTube discovery', () => {
 it('parses nested braces in quoted JSON without evaluating source scripts', () => expect(pageJson('var ytInitialData = {"text":"a } { \\\" value","ok":true}; throw Error()', 'ytInitialData')).toMatchObject({ ok: true }));
 it('requires channel and video identity plus an exact publication timestamp', async () => {
  const read = download(); const out = await nativeYouTubeDiscovery(source, channel, new Set(), read);
  expect(out).toMatchObject({ gapPossible: true, updates: [{ sourceId: source.id, url: 'https://www.youtube.com/watch?v=' + video, publishedAt: '2026-11-04T12:34:56.000Z', contentKind: 'metadata_only' }] });
  expect(read).toHaveBeenCalledTimes(2);
 });
 it('does not download metadata again for a known original', async () => { const read = download(); expect((await nativeYouTubeDiscovery(source, channel, new Set(['youtube:' + video]), read)).updates).toEqual([]); expect(read).toHaveBeenCalledTimes(1); });
 it.each([watch('UCxxxxxxxxxxxxxxxxxxxxxx'), watch(channel, '2026-11-04'), watch(channel, '2026-11-04T12:34:56'), watch(channel, '2026-02-30T12:34:56Z'), watch(channel, 'yesterday')])('rejects foreign identity and imprecise publication dates', async text => { await expect(nativeYouTubeDiscovery(source, channel, new Set(), download(text))).rejects.toMatchObject({ code: 'youtube_upload_unconfirmed' }); });
 it('does not turn an unrecognized page into quiet coverage', async () => { await expect(nativeYouTubeDiscovery(source, channel, new Set(), async url => ({ url, text: '<html>Sign in</html>', contentType: 'text/html' }))).rejects.toMatchObject({ code: 'youtube_channel_mismatch' }); });
});

describe('exact source publication timestamps', () => {
 it.each(['2026-11-04', '2026-11-04T12:34:56', '2026-02-29T12:00:00Z', '2026-04-31T12:00:00Z', '2026-11-04T24:00:00Z', '2026-11-04T12:60:00Z', '2026-11-04T12:00:60Z', '2026-11-04T12:00:00+24:00', '2026-11-04T12:00:00+00:60', '', null])('rejects imprecise or invalid date %s', value => expect(exactPublicationTimestamp(value)).toBeUndefined());
 it.each([['2024-02-29T23:59:59.123Z', '2024-02-29T23:59:59.123Z'], ['2026-11-04T12:34:56+02:30', '2026-11-04T10:04:56.000Z']])('preserves a valid supplied instant %s', (value, expected) => expect(exactPublicationTimestamp(value)).toBe(expected));
});
