import { describe, expect, it, vi } from 'vitest';
import { extractPostContext, xPostIdentity } from '../actors/tech-collector/src/post-context.mjs';
// @ts-expect-error Standalone Actor module.
import { normalizeItem, sourceCoverage } from '../actors/tech-collector/src/collector.mjs';
import { resolvePostContext, sanitizePostContext } from '../src/lib/post-context';
import { sanitizeArchivedUpdate, sanitizeSourceUpdate, sanitizeWorkspace } from '../src/lib/domain';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import type { Source, SourcePostContext, SourceUpdate } from '../src/lib/types';

const childId = '1940000000000000003', parentId = '1940000000000000001', quoteId = '1940000000000000002';
const publishedAt = '2026-10-01T12:00:00.000Z';
const childUrl = 'https://x.com/example/status/' + childId, parentUrl = 'https://x.com/original/status/' + parentId;
const raw = (patch: Record<string, unknown> = {}) => ({ id: childId, url: childUrl, text: '@original My reply.', author: { userName: 'example' }, createdAt: publishedAt, ...patch });
const parent = (patch: Record<string, unknown> = {}) => ({ id: parentId, url: parentUrl, text: 'Original authored text.', author: { userName: 'original', name: 'Original author' }, createdAt: publishedAt, ...patch });
const source: Source = { id: 'original-source', platform: 'X', name: 'Original publisher', url: 'https://x.com/original', status: 'ready', creatorIds: [] };
const update = (patch: Partial<SourceUpdate> = {}): SourceUpdate => ({ id: 'existing-child', sourceId: 'example-source', title: 'Existing title', summary: 'Existing summary', content: 'Existing child text', contentKind: 'feed_text', url: childUrl, publishedAt, format: 'post', isSample: false, contributorIds: [], topics: [], brands: [], sponsors: [], references: [], insights: [], ...patch });
const archivedParent = (patch: Partial<SourceUpdate> = {}): SourceUpdate => update({ id: 'existing-parent', sourceId: source.id, url: parentUrl, content: 'Archived original text.', ...patch });
const context = (): SourcePostContext => ({ reply: { status: 'unavailable', postId: parentId, authorHandle: 'original', url: parentUrl } });

describe('explicit X reply and quote context', () => {
  it('preserves the actual Xquik reply identity without treating the conversation root as its parent', () => {
    expect(extractPostContext(raw({ isReply: true, inReplyToId: parentId, inReplyToUsername: 'Original', conversationId: quoteId }))).toEqual({ reply: { status: 'unavailable', postId: parentId, authorHandle: 'original', url: parentUrl } });
  });
  it('preserves simultaneous reply A and quoted B, including object-shaped Xquik permalinks', () => {
    const quoted = parent({ id: quoteId, url: 'https://x.com/quoted/status/' + quoteId, author: { userName: 'quoted', name: 'Quoted author' }, text: 'Quoted text.' });
    const result = extractPostContext(raw({ isReply: true, inReplyToId: parentId, inReplyToUsername: 'original', isQuoteStatus: true, quotedTweetId: quoteId, quotedTweet: quoted, quotedTweetPermalink: { url: 'https://t.co/example', expandedUrl: quoted.url, displayUrl: 'x.com/quoted' } }));
    expect(result?.reply).toMatchObject({ status: 'unavailable', postId: parentId });
    expect(result?.quote).toMatchObject({ status: 'available', postId: quoteId, url: quoted.url, text: 'Quoted text.', authorHandle: 'quoted', authorName: 'Quoted author', publishedAt, provenance: 'provider' });
  });
  it.each([
    { in_reply_to_status_id_str: parentId, in_reply_to_screen_name: 'original', in_reply_to_status: parent() },
    { inReplyToStatusId: parentId, inReplyToScreenName: 'original', inReplyToStatus: parent() },
    { replyToTweetId: parentId, replyToTweet: parent() },
    { referenced_tweets: [{ type: 'replied_to', id: parentId }], includes: { tweets: [{ id: parentId, author_id: '99', text: 'Original authored text.', created_at: publishedAt }], users: [{ id: '99', username: 'original', name: 'Original author' }] } },
  ])('supports explicit legacy, camelCase and v2 expansion shapes %#', fields => {
    expect(extractPostContext(raw(fields))?.reply).toMatchObject({ status: 'available', postId: parentId, authorHandle: 'original', text: 'Original authored text.', authorName: 'Original author', publishedAt });
  });
  it('supports GraphQL legacy bodies and full note text without reusing truncated display offsets', () => {
    const result = extractPostContext(raw({ legacy: { in_reply_to_status_id_str: parentId }, inReplyToStatus: { rest_id: parentId, legacy: { full_text: 'Short…', created_at: publishedAt, display_text_range: [0, 6] }, noteTweet: { text: 'Full original text, including 東京 and 🧑🏽‍💻.' }, author: { userName: 'original' } } }));
    expect(result?.reply?.text).toBe('Full original text, including 東京 and 🧑🏽‍💻.');
  });
  it('keeps only media keys attached to the expanded original, excluding the replying post media', () => {
    const result = extractPostContext(raw({ referenced_tweets: [{ type: 'replied_to', id: parentId }], includes: {
      tweets: [{ id: parentId, author_id: '99', text: '', attachments: { media_keys: ['3_parent'] } }], users: [{ id: '99', username: 'original' }],
      media: [{ media_key: '3_parent', type: 'photo', url: 'https://pbs.twimg.com/media/parent.jpg' }, { media_key: '3_child', type: 'photo', url: 'https://pbs.twimg.com/media/child.jpg' }],
    } }));
    expect(result?.reply?.media).toEqual([{ type: 'image', url: 'https://pbs.twimg.com/media/parent.jpg?name=orig' }]);
    expect(result?.reply?.status).toBe('available');
    expect(JSON.stringify(result)).not.toContain('child.jpg');
  });
  it.each([
    { text: '@original An ordinary mention.' }, { conversationId: parentId }, { conversation_id: parentId },
    { text: 'A status link ' + parentUrl }, { entities: { user_mentions: [{ screen_name: 'original' }] } }, { isReply: 'true' }, { isReply: false },
  ])('never infers reply identity from unrelated signals %#', fields => expect(extractPostContext(raw(fields))).toBeUndefined());
  it('does not turn a quote into a reply or vice versa', () => {
    expect(extractPostContext(raw({ quotedTweetId: parentId, quotedTweet: parent() }))).toHaveProperty('quote');
    expect(extractPostContext(raw({ quotedTweetId: parentId, quotedTweet: parent() }))).not.toHaveProperty('reply');
    expect(extractPostContext(raw({ inReplyToId: parentId }))).not.toHaveProperty('quote');
  });
  it('merges compatible missing parent fields without rejecting the available original', () => {
    const result = extractPostContext(raw({ inReplyToId: parentId, inReplyToStatus: { id: parentId, text: 'Hello' }, in_reply_to_status: { id: parentId, text: 'Hello', author: { userName: 'original' } } }));
    expect(result?.reply).toMatchObject({ status: 'available', text: 'Hello', authorHandle: 'original' });
  });
  it.each([{ isReply: true }, { inReplyToId: parentId }, { inReplyToId: parentId, inReplyToStatus: { id: parentId, __typename: 'TweetTombstone' } }])('retains an explicit unavailable original without claiming deletion %#', fields => expect(extractPostContext(raw(fields))?.reply?.status).toBe('unavailable'));
  it('keeps a validated quote permalink when the original body is absent', () => {
    expect(extractPostContext(raw({ isQuoteStatus: true, quotedTweetId: parentId, quotedTweetPermalink: { expandedUrl: parentUrl } }))?.quote).toEqual({ status: 'unavailable', postId: parentId, authorHandle: 'original', url: parentUrl });
  });
  it('supports legacy expanded permalinks and rejects contradictory expanded aliases', () => {
    expect(extractPostContext(raw({ quoted_status_id_str: parentId, quoted_status_permalink: { expanded: parentUrl } }))?.quote).toMatchObject({ status: 'unavailable', postId: parentId, authorHandle: 'original', url: parentUrl });
    const conflict = extractPostContext(raw({ quotedTweetId: parentId, quotedTweet: parent(), quotedTweetPermalink: { expandedUrl: parentUrl }, quoted_status_permalink: { expanded: 'https://x.com/original/status/' + quoteId } }));
    expect(conflict?.quote?.status).toBe('unavailable'); expect(conflict?.quote?.text).toBeUndefined();
  });
  it('preserves original-only media, and legacy user ownership, without leaking child attachments into it', () => {
    const result = extractPostContext(raw({ inReplyToId: parentId, media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/child.jpg' }], inReplyToStatus: parent({ author: undefined, user: { id_str: '77', screen_name: 'original', name: 'Original author' }, text: '', extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/parent.jpg', source_status_id_str: parentId, source_user_id_str: '77' }] } }) }));
    expect(result?.reply).toMatchObject({ status: 'available', media: [{ type: 'image', url: 'https://pbs.twimg.com/media/parent.jpg?name=orig' }] });
    expect(JSON.stringify(result)).not.toContain('child.jpg');
  });
  it.each([
    { inReplyToId: Number(parentId) },
    { inReplyToId: parentId, in_reply_to_status_id_str: quoteId },
    { inReplyToId: parentId, inReplyToUsername: 'original', in_reply_to_screen_name: 'foreign', inReplyToStatus: parent() },
    { inReplyToId: parentId, inReplyToStatus: parent({ id: quoteId }) },
    { inReplyToId: parentId, inReplyToStatus: { id: parentId, legacy: { id: quoteId, text: 'Body from another post' } } },
    { inReplyToId: parentId, inReplyToStatus: parent({ url: 'https://x.com/original/status/' + quoteId }) },
    { inReplyToId: parentId, inReplyToStatus: parent({ author: { userName: 'foreign' } }) },
    { inReplyToId: parentId, inReplyToStatus: parent({ user: { screen_name: 'foreign' } }) },
    { inReplyToId: parentId, inReplyToStatus: parent({ author: { id: '77', userName: 'original' }, user: { id_str: '88', screen_name: 'original' } }) },
    { inReplyToId: parentId, inReplyToUserId: '88', inReplyToStatus: parent({ author: { id: '77', userName: 'original' } }) },
    { inReplyToId: parentId, inReplyToUserId: '77', in_reply_to_user_id_str: '88', inReplyToStatus: parent() },
    { inReplyToId: parentId, inReplyToStatus: parent({ date: '2026-10-02T12:00:00Z' }) },
    { inReplyToId: parentId, inReplyToStatus: parent(), in_reply_to_status: parent({ text: 'Conflicting original.' }) },
    { inReplyToId: parentId, inReplyToStatus: parent(), in_reply_to_status: parent({ id: quoteId }) },
    { referenced_tweets: [{ type: 'replied_to', id: parentId }], referencedTweets: [{ type: 'replied_to', id: quoteId }], inReplyToStatus: parent() },
    { referenced_tweets: [{ type: 'replied_to', id: parentId }], includes: { tweets: [{ id: parentId, text: 'Parent text', author_id: '99' }], users: [{ id: '99', username: 'original' }, { id: '99', username: 'foreign' }] } },
    { inReplyToId: childId, inReplyToStatus: parent({ id: childId, url: childUrl }) },
  ])('fails closed on conflicting or unsafe original identities %#', fields => {
    const result = extractPostContext(raw(fields));
    expect(result?.reply?.status).toBe('unavailable');
    expect(result?.reply?.text).toBeUndefined();
    expect(result?.reply?.media).toBeUndefined();
  });
  it.each([{ demo: true }, { isDemo: true }, { is_demo: true }, { error: 'unavailable' }])('does not treat supplier placeholders/errors as original context %#', fields => expect(extractPostContext(raw({ isReply: true, inReplyToId: parentId, ...fields }))).toBeUndefined());
});

describe('original identity and storage validation', () => {
  it.each(['http://x.com/original/status/123', 'https://x.com.evil.test/original/status/123', 'https://u:p@x.com/original/status/123', 'https://x.com:444/original/status/123', 'https://x.com/original/status/123?token=secret', 'https://x.com/original/status/123#x', 'https://x.com/a/../original/status/123', 'https://x.com/original/status/1%32%33', 'https://127.0.0.1/original/status/123', 'javascript:alert(1)'])('rejects unsafe or ambiguous original URL %s', url => {
    expect(xPostIdentity(url)).toBeUndefined();
    expect(sanitizePostContext({ reply: { status: 'available', postId: '123', url, text: 'Wrong original' } }, childUrl)).toBeUndefined();
  });
  it('accepts documented X URL aliases and generic routes', () => {
    expect(xPostIdentity('https://mobile.twitter.com/Original/status/' + parentId + '/')).toEqual({ postId: parentId, authorHandle: 'original', url: parentUrl });
    expect(xPostIdentity('https://x.com/i/status/' + parentId)).toEqual({ postId: parentId, url: 'https://x.com/i/web/status/' + parentId });
  });
  it('drops forged nested fields, bounds text and cannot turn another platform into X context', () => {
    const safe = sanitizePostContext({ reply: { status: 'available', postId: parentId, authorName: 'Name', text: 'a'.repeat(120000), credentials: 'secret', media: [{ type: 'image', url: 'https://127.0.0.1/private.jpg' }], extraNestedPost: { text: 'wrong' } }, private: 'secret' }, childUrl);
    expect(safe?.reply?.text).toHaveLength(100000);
    expect(safe?.reply?.media).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(sanitizePostContext(context(), 'https://instagram.com/p/123/')).toBeUndefined();
    expect(sanitizePostContext({ reply: { status: 'available', postId: parentId, url: parentUrl, authorHandle: 'foreign', text: 'Wrong' } }, childUrl)).toBeUndefined();
    expect(sanitizePostContext({ reply: { status: 'available', postId: parentId, media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/foreign.jpg' }] } }, childUrl)?.reply?.status).toBe('unavailable');
  });
  it('never clips a parent text or author name through a Unicode surrogate pair', () => {
    const safe = sanitizePostContext({ reply: { status: 'available', postId: parentId, text: 'a'.repeat(99999) + '😀', authorName: 'a'.repeat(199) + '😀' } }, childUrl);
    expect(safe?.reply?.text).toBe('a'.repeat(99999));
    expect(safe?.reply?.authorName).toBe('a'.repeat(199));
  });
  it('preserves legacy records without context and persists new context through archive, workspace and export data', () => {
    expect(sanitizeSourceUpdate(update())).not.toHaveProperty('postContext');
    const withContext = update({ postContext: extractPostContext(raw({ inReplyToId: parentId, inReplyToStatus: parent() })) });
    expect(sanitizeSourceUpdate(withContext)?.postContext).toEqual(withContext.postContext);
    expect(sanitizeArchivedUpdate(withContext)?.postContext).toEqual(withContext.postContext);
    const state = { ...createDefaultWorkspace(), customSources: [{ ...source, id: withContext.sourceId, url: 'https://x.com/example' }], followedSourceIds: [withContext.sourceId], importedUpdates: [withContext] };
    expect(sanitizeWorkspace(JSON.parse(JSON.stringify(state)))?.importedUpdates[0].postContext).toEqual(withContext.postContext);
  });
});

describe('safe existing archive original lookup', () => {
  it('uses one exact source-bound archived parent, preserving the child and all input records', () => {
    const child = update({ postContext: context() }), original = archivedParent(), before = structuredClone({ child, original });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      expect(resolvePostContext(child, [original], [source])?.reply).toMatchObject({ status: 'available', text: original.content, authorName: source.name, authorHandle: 'original', publishedAt, provenance: 'archive' });
      expect({ child, original }).toEqual(before); expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    { sources: [] }, { sources: [{ ...source, platform: 'Blog' }] }, { sources: [{ ...source, url: 'https://x.com/foreign' }] }, { sources: [source, source] },
    { parents: [archivedParent(), archivedParent({ id: 'duplicate-original' })] }, { parents: [archivedParent({ isSample: true })] }, { parents: [archivedParent({ url: 'https://x.com/foreign/status/' + parentId })] },
    { parents: [archivedParent({ content: '', contentKind: 'metadata_only' })] }, { parents: [archivedParent({ publishedAt: 'invalid' })] },
  ])('keeps original unavailable for missing, ambiguous or conflicting bindings %#', options => {
    const result = resolvePostContext(update({ postContext: context() }), options.parents || [archivedParent()], (options.sources || [source]) as Source[]);
    expect(result?.reply?.status).toBe('unavailable');
  });
  it('does not replace explicit provider content with conflicting archived prose', () => {
    const postContext = extractPostContext(raw({ inReplyToId: parentId, inReplyToStatus: parent() }));
    expect(resolvePostContext(update({ postContext }), [archivedParent()], [source])).toEqual(postContext);
  });
  it('can display a media-only parent without substituting a generated headline or summary', () => {
    const original = archivedParent({ content: '', contentKind: 'metadata_only', title: 'Generated title', summary: 'Generated summary', media: [{ type: 'gif', url: 'https://video.twimg.com/parent.mp4' }] });
    const result = resolvePostContext(update({ postContext: context() }), [original], [source]);
    expect(result?.reply).toMatchObject({ status: 'available', media: [{ type: 'gif', url: 'https://video.twimg.com/parent.mp4' }] });
    expect(result?.reply?.text).toBeUndefined();
  });
  it('marks mixed provider media and copied archive text as containing archive provenance', () => {
    const postContext = extractPostContext(raw({ inReplyToId: parentId, inReplyToStatus: parent({ text: '', media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/provider.jpg' }] }) }));
    const result = resolvePostContext(update({ postContext }), [archivedParent()], [source]);
    expect(result?.reply).toMatchObject({ text: 'Archived original text.', provenance: 'archive', media: [{ type: 'image' }] });
  });
});

describe('collector integration', () => {
  const collectorSource = { ...source, id: 'example-source', name: 'Example', url: 'https://x.com/example', key: 'x.com/example', aliases: [] };
  const input = { dateFrom: '2026-09-21T00:00:00Z', dateTo: '2026-10-21T00:00:00Z' };
  it.each([
    { inReplyToId: parentId, inReplyToStatus: parent(), legacy: { inReplyToId: quoteId } },
    { referenced_tweets: [{ type: 'replied_to', id: parentId }], inReplyToStatus: parent(), legacy: { referenced_tweets: [{ type: 'replied_to', id: quoteId }] } },
    { inReplyToStatus: parent(), legacy: { inReplyToStatus: parent({ id: quoteId, url: 'https://x.com/original/status/' + quoteId }) } },
    { inReplyToId: parentId, inReplyToStatus: parent(), legacy: { inReplyToStatus: parent({ text: 'A contradictory original body.' }) } },
    { inReplyToId: parentId, inReplyToStatus: parent(), inReplyToUsername: 'original', legacy: { inReplyToUsername: 'different' } },
  ])('does not discard conflicting root/legacy relationship evidence %#', fields => {
    const value = raw(fields);
    expect(extractPostContext(value)?.reply?.status).toBe('unavailable');
    expect(extractPostContext(value)?.reply?.text).toBeUndefined();
    expect(normalizeItem(collectorSource, value, input).update.postContext?.reply?.status).toBe('unavailable');
  });
  it('keeps compatible relationships from both layers and rejects contradictory quote originals', () => {
    expect(extractPostContext(raw({ inReplyToId: parentId, legacy: { inReplyToStatus: parent() } }))?.reply?.text).toBe('Original authored text.');
    expect(extractPostContext(raw({ quotedTweet: parent(), legacy: { quotedTweet: parent({ text: 'Different quoted body.' }) } }))?.quote?.status).toBe('unavailable');
  });
  it('retains context separately from the replying post text and attachments', () => {
    const result = normalizeItem(collectorSource, raw({ isReply: true, inReplyToId: parentId, inReplyToStatus: parent() }), input).update;
    expect(result.postContext.reply.text).toBe('Original authored text.');
    expect(result.content).toBe('@original My reply.');
    expect(result.url).toBe(childUrl);
  });
  it.each([
    { id: parentId }, { id_str: parentId }, { twitterUrl: 'https://x.com/example/status/' + parentId }, { postUrl: 'https://x.com/foreign/status/' + childId }, { legacy: { id: parentId } },
  ])('rejects every conflicting supplied child ID or URL assertion before import %#', fields => {
    const value = raw({ inReplyToId: parentId, ...fields });
    expect(extractPostContext(value)).toBeUndefined();
    expect(normalizeItem(collectorSource, value, input)).toMatchObject({ reason: 'invalid_original_url' });
  });
  it('fills an explicit immediate parent from accepted same-source batch items', () => {
    const selfParent = raw({ id: parentId, url: 'https://x.com/example/status/' + parentId, text: 'Own previous post.' });
    const result = sourceCoverage(collectorSource, { status: 'SUCCEEDED', maxItems: 20 }, [raw({ inReplyToId: parentId }), selfParent], input);
    expect(result.updates[0].postContext.reply).toMatchObject({ text: 'Own previous post.', provenance: 'archive' });
    expect(result.coverage.complete).toBe(false);
  });
});
