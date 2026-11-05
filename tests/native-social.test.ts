import { describe, expect, it } from 'vitest';
import { instagramPublicRows, xPublicRows } from '../netlify/functions/_shared/native-social';
const user = { id: '123', username: 'source', edge_owner_to_timeline_media: { edges: [{ node: { owner: { id: '123' }, shortcode: 'AbCd123', taken_at_timestamp: 1793750400, edge_media_to_caption: { edges: [{ node: { text: 'Public authored caption' } }] } } }] } };
describe('free public social contracts', () => {
 it('requires the profile username and matching per-post owner ID', () => {
  expect(instagramPublicRows({ data: { user } }, 'source')).toMatchObject([{ ownerUsername: 'source', caption: 'Public authored caption', timestamp: '2026-11-04T00:00:00.000Z' }]);
  expect(() => instagramPublicRows({ data: { user } }, 'foreign')).toThrow();
  expect(instagramPublicRows({ data: { user: { ...user, edge_owner_to_timeline_media: { edges: [{ node: { ...user.edge_owner_to_timeline_media.edges[0].node, owner: { id: 'foreign' } } }] } } } }, 'source')).toEqual([]);
 });
 it('does not treat a login page or absent post collection as quiet coverage', () => {
  expect(() => instagramPublicRows({}, 'source')).toThrow();
  expect(() => xPublicRows({}, 'source')).toThrow();
 });
 it('keeps exact string tweet IDs, original authors, dates and full text', () => {
  const tweet = { id_str: '1234567890123456789', created_at: 'Wed Nov 04 12:34:56 +0000 2026', user: { screen_name: 'Source' }, full_text: 'Full public post', text: 'Short' };
  const data = { props: { pageProps: { timeline: { entries: [{ content: { tweet } }, { content: { tweet: { ...tweet, user: { screen_name: 'foreign' } } } }] } } } };
  expect(xPublicRows(data, 'source')).toMatchObject([{ url: 'https://x.com/Source/status/1234567890123456789', text: tweet.full_text, createdAt: '2026-11-04T12:34:56.000Z' }]);
  expect(xPublicRows(data, 'source')).toHaveLength(1);
 });
});
