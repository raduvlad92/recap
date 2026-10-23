import { describe, expect, it } from 'vitest';
import { extractPostMedia, hasUnplayablePostMedia, mediaOnlyTitle, mediaPreviewUrl, visiblePostText } from '../actors/tech-collector/src/post-media.mjs';

const photo = (name: string, patch: Record<string, unknown> = {}) => ({ type: 'photo', mediaUrl: `https://pbs.twimg.com/media/${name}.jpg`, ...patch });
const video = (name: string, patch: Record<string, unknown> = {}) => ({ type: 'video', mediaUrl: `https://pbs.twimg.com/ext_tw_video_thumb/${name}/preview.jpg`, videoVariants: [{ url: `https://video.twimg.com/ext_tw_video/${name}/clip.mp4`, contentType: 'video/mp4', bitrate: 832_000 }], ...patch });
const xpost = (patch: Record<string, unknown> = {}) => ({ id: '1234567890123456789', url: 'https://x.com/Example/status/1234567890123456789', text: '', author: { id: '111', username: 'Example' }, ...patch });

describe('provider media extraction', () => {
  it('preserves the exact structural Xquik animated GIF case as a silent MP4 without a text body', () => {
    const token = 'https://t.co/attachment';
    const raw = xpost({ text: token, displayTextRange: [0, 0], media: [video('gif', { type: 'animated_gif', width: 332, height: 250, indices: [0, token.length], url: token, durationMillis: 1840 })] });
    expect(visiblePostText(raw, 'X')).toBe('');
    expect(extractPostMedia(raw, 'X')).toEqual([{ type: 'gif', url: 'https://video.twimg.com/ext_tw_video/gif/clip.mp4', previewUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/gif/preview.jpg', width: 332, height: 250, durationSeconds: 1.84, variants: [{ url: 'https://video.twimg.com/ext_tw_video/gif/clip.mp4', contentType: 'video/mp4', bitrate: 832_000 }] }]);
    expect(mediaOnlyTitle(extractPostMedia(raw, 'X'), 'Example')).toBe('GIF from Example');
  });

  it('preserves mixed attachment order, requests full-size photos and deduplicates legacy representations', () => {
    const one = photo('one', { id_str: '1', ext_alt_text: 'First photo' });
    const two = video('two', { id_str: '2' });
    const three = photo('three', { id_str: '3', width: 1600, height: 900 });
    const raw = xpost({ media: [one, two, three, one], extended_entities: { media: [{ type: 'photo', id_str: '1', media_url_https: one.mediaUrl }, { ...three, media_url_https: three.mediaUrl }] } });
    const media = extractPostMedia(raw, 'X');
    expect(media.map(value => [value.type, value.url])).toEqual([['image', 'https://pbs.twimg.com/media/one.jpg?name=orig'], ['video', 'https://video.twimg.com/ext_tw_video/two/clip.mp4'], ['image', 'https://pbs.twimg.com/media/three.jpg?name=orig']]);
    expect(media[0].alt).toBe('First photo');
    expect(media[2]).toMatchObject({ width: 1600, height: 900 });
    expect(mediaOnlyTitle(media, 'Example')).toBe('Media update from Example');
    expect(extractPostMedia({ media: [photo('sized', { mediaUrl: 'https://pbs.twimg.com/media/sized.jpg:small' })] }, 'X')[0].url).toBe('https://pbs.twimg.com/media/sized.jpg?name=orig');
  });

  it('understands camelCase and snake_case legacy extended entities and selects the best actual file', () => {
    const legacy = { type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/legacy/thumb.jpg', video_info: { duration_millis: 2500, variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/legacy/master.m3u8', bitrate: 999_999_999 },
      { content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/legacy/low.mp4', bitrate: 256_000 },
      { content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/legacy/high.mp4', bitrate: 2_176_000 },
      { content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/legacy/fake.m3u8', bitrate: 9_999_999 },
      { content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/legacy/high.mp4', bitrate: 2_176_000 },
      { content_type: 'video/webm', url: 'https://video.twimg.com/ext_tw_video/legacy/other.webm' },
    ] } };
    for (const key of ['extendedEntities', 'extended_entities']) {
      const result = extractPostMedia(xpost({ [key]: { media: [legacy] } }), 'X')[0];
      expect(result).toMatchObject({ type: 'video', url: 'https://video.twimg.com/ext_tw_video/legacy/high.mp4', durationSeconds: 2.5 });
      expect(result.variants).toHaveLength(3);
      expect(result.variants?.some(value => value.url.endsWith('.m3u8'))).toBe(false);
    }
  });

  it('enriches a repeated media ID in its original position when legacy data supplies the playable variant', () => {
    const raw = xpost({ media: [video('first', { mediaKey: '7_111', videoVariants: [] }), photo('second')], extended_entities: { media: [video('first', { id_str: '111' })] } });
    expect(extractPostMedia(raw, 'X').map(value => value.type)).toEqual(['video', 'image']);
    expect(extractPostMedia(raw, 'X')[0].url).toBe('https://video.twimg.com/ext_tw_video/first/clip.mp4');
  });

  it('merges ID-less repeated representations by their validated preview without moving the attachment', () => {
    const raw = xpost({ media: [video('first', { videoVariants: [] }), photo('second')], extended_entities: { media: [video('first')] } });
    expect(extractPostMedia(raw, 'X').map(value => value.type)).toEqual(['video', 'image']);
    expect(hasUnplayablePostMedia(raw, 'X')).toBe(false);
    const low = video('same', { videoVariants: [{ url: 'https://video.twimg.com/low.mp4', contentType: 'video/mp4', bitrate: 1000 }] });
    const high = video('same', { videoVariants: [{ url: 'https://video.twimg.com/high.mp4', contentType: 'video/mp4', bitrate: 2000 }] });
    const media = extractPostMedia(xpost({ media: [low], extendedEntities: { media: [high] } }), 'X');
    expect(media).toHaveLength(1); expect(media[0].url).toBe('https://video.twimg.com/high.mp4'); expect(media[0].variants).toHaveLength(2);
    // Equal posters alone do not merge two distinct attachments in one array.
    expect(extractPostMedia(xpost({ media: [low, high] }), 'X')).toHaveLength(2);
  });

  it('keeps a still preview when a video has no playable variant without turning it into playable media', () => {
    const raw = xpost({ media: [video('unplayable', { videoVariants: [{ contentType: 'application/x-mpegURL', url: 'https://video.twimg.com/unplayable/playlist.m3u8' }] })] });
    expect(extractPostMedia(raw, 'X')).toEqual([]);
    expect(mediaPreviewUrl(raw, 'X')).toBe('https://pbs.twimg.com/ext_tw_video_thumb/unplayable/preview.jpg');
    expect(extractPostMedia({ type: 'Video', displayUrl: 'https://scontent.cdninstagram.com/preview.jpg' }, 'Instagram')).toEqual([]);
  });

  it('takes only the post’s own media without traversing quoted or retweeted rows', () => {
    const foreign = xpost({ id: '222', media: [photo('foreign')] });
    const raw = xpost({ isQuoteStatus: true, media: [photo('own'), photo('foreign-id', { sourceStatusId: '222' }), photo('foreign-user', { sourceUserId: '222' }), photo('foreign-permalink', { expandedUrl: 'https://x.com/Other/status/222/photo/1' }), photo('own-explicit', { sourceStatusId: '1234567890123456789', sourceUserId: '111', expandedUrl: 'https://x.com/Example/status/1234567890123456789/photo/2' })], quoted_tweet: foreign, quoted_status: foreign });
    expect(extractPostMedia(raw, 'X').map(value => value.url)).toEqual(['https://pbs.twimg.com/media/own.jpg?name=orig', 'https://pbs.twimg.com/media/own-explicit.jpg?name=orig']);
    expect(extractPostMedia(xpost({ quoted_tweet: foreign }), 'X')).toEqual([]);
    expect(mediaPreviewUrl(xpost({ quoted_status: foreign }), 'X')).toBe('');
    for (const patch of [{ isRetweet: true }, { retweeted_status: foreign }, { retweeted_tweet: foreign }, { isRepost: true }]) {
      expect(extractPostMedia(xpost({ ...patch, media: [photo('copied')] }), 'X')).toEqual([]);
      expect(mediaPreviewUrl(xpost({ ...patch, media: [photo('copied')] }), 'X')).toBe('');
    }
  });

  it('retains Instagram sidecar photo/video/photo order without repeating the cover or related posts', () => {
    const raw = { type: 'Sidecar', displayUrl: 'https://scontent.cdninstagram.com/first.jpg', childPosts: [
      { type: 'Image', displayUrl: 'https://scontent.cdninstagram.com/first.jpg', dimensionsWidth: 1080, dimensionsHeight: 1350, accessibilityCaption: 'First slide' },
      { type: 'Video', videoUrl: 'https://scontent.fra3-1.fna.fbcdn.net/second.mp4?oh=signed&oe=expiry', displayUrl: 'https://scontent.cdninstagram.com/second.jpg', videoDuration: 12.75 },
      { type: 'Image', displayUrl: 'https://scontent.cdninstagram.com/third.jpg' },
    ], images: ['https://scontent.cdninstagram.com/first.jpg'], relatedPosts: [{ type: 'Image', displayUrl: 'https://scontent.cdninstagram.com/foreign.jpg' }] };
    const media = extractPostMedia(raw, 'Instagram');
    expect(media.map(value => value.type)).toEqual(['image', 'video', 'image']);
    expect(media[0]).toMatchObject({ width: 1080, height: 1350, alt: 'First slide' });
    expect(media[1]).toMatchObject({ url: raw.childPosts[1].videoUrl, previewUrl: 'https://scontent.cdninstagram.com/second.jpg', durationSeconds: 12.75 });
    expect(mediaPreviewUrl(raw, 'Instagram')).toBe(raw.displayUrl);
    expect(JSON.stringify(media)).not.toContain('foreign');
  });

  it('supports Instagram image lists and reels with expiring public CDN signatures', () => {
    const urls = ['https://scontent.cdninstagram.com/one.jpg?signature=public-cdn-signature', 'https://scontent.cdninstagram.com/two.webp'];
    expect(extractPostMedia({ type: 'Sidecar', images: [...urls, urls[0]] }, 'Instagram').map(value => value.url)).toEqual(urls);
    expect(extractPostMedia({ type: 'Image', displayUrl: urls[0] }, 'Instagram')).toEqual([{ type: 'image', url: urls[0] }]);
    expect(extractPostMedia({ type: 'Video', videoUrl: 'https://scontent.cdninstagram.com/reel.mp4', displayUrl: urls[1] }, 'Instagram')[0]).toMatchObject({ type: 'video', url: 'https://scontent.cdninstagram.com/reel.mp4', previewUrl: urls[1] });
    expect(visiblePostText({ caption: '  A caption with an authored https://example.com link.\nSecond line.  ' }, 'Instagram')).toBe('A caption with an authored https://example.com link.\nSecond line.');
  });

  it('retains an Instagram sidecar root preview when its video children have no usable preview', () => {
    const raw = { type: 'Sidecar', displayUrl: 'https://scontent.cdninstagram.com/cover.jpg', childPosts: [{ type: 'Video', videoUrl: 'https://scontent.cdninstagram.com/master.m3u8' }] };
    expect(extractPostMedia(raw, 'Instagram')).toEqual([]);
    expect(mediaPreviewUrl(raw, 'Instagram')).toBe(raw.displayUrl);
    expect(hasUnplayablePostMedia(raw, 'Instagram')).toBe(true);
    expect(mediaPreviewUrl({ ...raw, isRepost: true }, 'Instagram')).toBe('');
  });

  it.each([
    'http://pbs.twimg.com/media/a.jpg', 'https:pbs.twimg.com/media/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAA', '/relative.jpg', '//pbs.twimg.com/media/a.jpg',
    'https://pbs.twimg.com.evil.example/a.jpg', 'https://evil.example/a.jpg', 'https://pbs.twimg.com@127.0.0.1/a.jpg', 'https://127.0.0.1/a.jpg',
    'https://[::1]/a.jpg', 'https://localhost/a.jpg', 'https://private.local/a.jpg', 'https://user:password@pbs.twimg.com/a.jpg',
    'https://pbs.twimg.com:8443/media/a.jpg', 'https://pbs.twimg.com/media/a.jpg#fragment', 'https://pbs.twimg.com/media/a%ZZ.jpg',
    'https://pbs.twimg.com/\\evil.example/a.jpg', 'https://pbs.twimg.com/media/a\n.jpg', 'https://pbs.twimg.com/media/index.html', 'https://pbs.twimg.com/media/a.m3u8?format=jpg',
  ])('rejects unsafe or nonmedia URLs: %s', url => {
    expect(extractPostMedia({ media: [photo('unsafe', { mediaUrl: url })] }, 'X')).toEqual([]);
    expect(mediaPreviewUrl({ media: [photo('unsafe', { mediaUrl: url })] }, 'X')).toBe('');
  });

  it('applies the same media host boundary to variants and Instagram CDN suffixes', () => {
    for (const url of ['https://arbitrary.example/clip.mp4', 'https://video.twimg.com.evil.example/clip.mp4', 'http://video.twimg.com/clip.mp4', 'https://video.twimg.com/clip.jpg']) expect(extractPostMedia({ media: [video('bad', { videoVariants: [{ url, contentType: 'video/mp4' }] })] }, 'X')).toEqual([]);
    for (const url of ['https://notcdninstagram.com/a.jpg', 'https://scontent.cdninstagram.com.evil.example/a.jpg', 'https://instagram.com/a.jpg', 'https://cdninstagram.com:8443/a.jpg']) expect(extractPostMedia({ type: 'Image', displayUrl: url }, 'Instagram')).toEqual([]);
    expect(extractPostMedia({ media: [photo('x')] }, 'YouTube')).toEqual([]);
  });

  it('ignores malformed optional data and caps output while retaining the highest bitrate file', () => {
    const variants = Array.from({ length: 25 }, (_, i) => ({ url: `https://video.twimg.com/clip-${i}.mp4`, contentType: 'video/mp4', bitrate: i * 1000 }));
    const raw = { media: [video('many', { width: -1, height: Infinity, aspectRatio: [16, 9], altText: null, durationMillis: NaN, videoVariants: variants }), ...Array.from({ length: 40 }, (_, i) => photo('p-' + i))] };
    const before = structuredClone(raw), media = extractPostMedia(raw, 'X');
    expect(media).toHaveLength(30);
    expect(media[0].variants).toHaveLength(16);
    expect(media[0].url).toBe('https://video.twimg.com/clip-24.mp4');
    expect(media[0]).not.toHaveProperty('width'); expect(media[0]).not.toHaveProperty('height'); expect(media[0]).not.toHaveProperty('durationSeconds'); expect(media[0]).not.toHaveProperty('alt');
    expect(raw).toEqual(before);
    for (const value of [undefined, null, [], '', 3, { media: [null, [], 5] }]) expect(extractPostMedia(value, 'X')).toEqual([]);
  });
});

describe('authored visible text', () => {
  it('maps the observed Xquik code-point shape to complete Unicode instead of cutting a final emoji', () => {
    // Same structural lengths/range as the actual offending rich row; text is synthetic.
    const authored = 'x'.repeat(59) + '😀', text = '@HiddenUser ' + authored;
    expect(text.length).toBe(73); expect([...text]).toHaveLength(72);
    expect(visiblePostText(xpost({ text, displayTextRange: [12, 72], isReply: true, entities: { userMentions: [{ screenName: 'HiddenUser', indices: [0, 11] }] } }), 'X')).toBe(authored);
    const body = 'x'.repeat(169) + '😀', token = 'https://t.co/0123456789', withMedia = body + ' ' + token;
    expect(withMedia.length).toBe(195); expect([...withMedia]).toHaveLength(194);
    const raw = xpost({ text: withMedia, displayTextRange: [0, 170], media: [photo('unicode', { url: token, indices: [171, 194] })] });
    expect(visiblePostText(raw, 'X')).toBe(body);
    expect(visiblePostText({ ...raw, displayTextRange: undefined }, 'X')).toBe(body);
  });

  it('uses proven UTF-16 legacy offsets and ignores ambiguous ranges that would drop authored characters', () => {
    const body = 'A 😀 authored tail.', token = 'https://t.co/photo', text = body + ' ' + token;
    const legacy = xpost({ text, display_text_range: [0, body.length], extended_entities: { media: [photo('utf16', { url: token, indices: [body.length + 1, text.length] })] } });
    expect(visiblePostText(legacy, 'X')).toBe(body);
    const ambiguous = xpost({ text, displayTextRange: [0, 3], media: [photo('ambiguous', { url: token })] });
    expect(visiblePostText(ambiguous, 'X')).toBe(body);
    expect(visiblePostText({ ...legacy, display_text_range: [0, 0] }, 'X')).toBe(body);
  });

  it('does not apply unlabeled attachment indices from a short legacy body to separate full text', () => {
    const fullText = 'Words https://t.co/story belong to the author.';
    const raw = xpost({ text: 'Photo https://t.co/image', fullText, media: [photo('own', { indices: [6, 24] })] });
    expect(visiblePostText(raw, 'X')).toBe(fullText);
  });

  it('does not discard unproven prose or external links merely because a display range excludes them', () => {
    const text = 'Report https://t.co/External123';
    expect(visiblePostText(xpost({ text, displayTextRange: [0, 6], media: [photo('one')] }), 'X')).toBe(text);
    expect(visiblePostText(xpost({ text: 'Authored words 😀', displayTextRange: [0, 0], media: [video('gif', { type: 'animated_gif' })] }), 'X')).toBe('Authored words 😀');
    const prefix = '@Authored prose and https://t.co/article';
    expect(visiblePostText(xpost({ text: prefix, displayTextRange: [10, [...prefix].length] }), 'X')).toBe(prefix);
  });
  it('honors UTF-16 display offsets before trimming while retaining an authored shortened external link', () => {
    const authored = '😀 Read https://t.co/article';
    const text = '@Hidden ' + authored + ' https://t.co/photo';
    const raw = xpost({ text, isReply: true, displayTextRange: [8, 8 + authored.length], entities: { userMentions: [{ screenName: 'Hidden', indices: [0, 7] }], urls: [{ url: 'https://t.co/article', expanded_url: 'https://example.com/story' }] }, media: [photo('one', { url: 'https://t.co/photo', indices: [text.indexOf('https://t.co/photo'), text.length] })] });
    expect(visiblePostText(raw, 'X')).toBe(authored);
    expect(visiblePostText({ ...raw, displayTextRange: undefined }, 'X')).toBe('@Hidden ' + authored);
  });

  it('strips only the known media token and handles duplicate attachment spans with non-BMP text', () => {
    const authored = ' 😀 https://t.co/article\nMore authored words.';
    const text = authored + ' https://t.co/photo';
    const media = Array.from({ length: 4 }, (_, i) => photo('image-' + i, { url: 'https://t.co/photo', indices: [authored.length + 1, text.length] }));
    const raw = xpost({ text, media, entities: { urls: [{ url: 'https://t.co/article', expandedUrl: 'https://example.com/article' }] } });
    expect(visiblePostText(raw, 'X')).toBe(authored.trim());
    expect(visiblePostText({ ...raw, media: media.map(value => ({ ...value, indices: undefined })) }, 'X')).toBe(authored.trim());
    expect(visiblePostText(xpost({ text: 'https://t.co/article', entities: { urls: [{ url: 'https://t.co/article', expanded_url: 'https://example.com' }] } }), 'X')).toBe('https://t.co/article');
    const nested = 'See https://example.com/?ref=https://t.co/photo and https://t.co/article';
    expect(visiblePostText(xpost({ text: nested, media: [photo('one', { url: 'https://t.co/photo' })] }), 'X')).toBe(nested);
  });

  it('recognizes a same-post photo entity without deleting a quoted-post or external URL entity', () => {
    const raw = xpost({ text: 'Body https://t.co/image https://t.co/quote https://t.co/external', entities: { urls: [
      { url: 'https://t.co/image', expanded_url: 'https://x.com/Example/status/1234567890123456789/photo/1' },
      { url: 'https://t.co/quote', expanded_url: 'https://x.com/Other/status/222/photo/1' },
      { url: 'https://t.co/external', expanded_url: 'https://example.com' },
    ] } });
    expect(visiblePostText(raw, 'X')).toBe('Body  https://t.co/quote https://t.co/external');
  });

  it('does not trust malformed ranges or indices and uses actual full text with its matching range', () => {
    const raw = xpost({ text: ' 😀 Full authored text. https://t.co/photo', media: [photo('one', { indices: [0, 2], url: 'https://t.co/photo' })] });
    for (const range of [[-1, 2], [0, 999], [20, 1], [0.5, 1], ['0', '0'], null]) expect(visiblePostText({ ...raw, displayTextRange: range }, 'X')).toBe('😀 Full authored text.');
    const extendedText = '😀 Full article https://t.co/external';
    expect(visiblePostText(xpost({ text: 'Truncated…', extended_tweet: { full_text: extendedText, display_text_range: [0, extendedText.length] } }), 'X')).toBe(extendedText);
    expect(visiblePostText(xpost({ text: 'Truncated…', fullText: 'Actual full source words.' }), 'X')).toBe('Actual full source words.');
    expect(visiblePostText(xpost({ text: 'Truncated…', displayTextRange: [0, 10], fullText: 'Actual full source words.' }), 'X')).toBe('Actual full source words.');
    expect(visiblePostText(null, 'X')).toBe('');
  });
});
