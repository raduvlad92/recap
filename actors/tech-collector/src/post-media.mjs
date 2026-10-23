// Shared by the standalone Actor and the web importer. No I/O or Node dependencies.
const list = value => Array.isArray(value) ? value : [];
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const string = value => typeof value === 'string' ? value : '';
const firstText = (...values) => values.find(value => typeof value === 'string' && value.length) || '';
const dimension = value => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000 ? value : undefined;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const MAX_MEDIA = 30;
const MAX_VARIANTS = 16;

function mediaUrl(value, platform) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || value.length > 8_000 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return '';
    const host = url.hostname.toLowerCase();
    const allowed = platform === 'X' ? ['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com'].includes(host)
      : platform === 'Instagram' && ['cdninstagram.com', 'fbcdn.net'].some(domain => host === domain || host.endsWith('.' + domain));
    return allowed && url.pathname !== '/' ? url.href : '';
  } catch { return ''; }
}

function imageUrl(value, platform) {
  const safe = mediaUrl(value, platform);
  if (!safe) return '';
  const url = new URL(safe);
  const imagePath = /\.(?:jpe?g|png|webp|avif|gif)(?::(?:thumb|small|medium|large|orig))?$/i.test(url.pathname);
  const imageFormat = url.hostname === 'pbs.twimg.com' && /^\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) && /^(?:jpe?g|png|webp|avif|gif)$/i.test(url.searchParams.get('format') || '');
  if (!imagePath && !imageFormat) return '';
  if (platform === 'X' && url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/')) {
    url.pathname = url.pathname.replace(/:(?:thumb|small|medium|large|orig)$/i, '');
    url.searchParams.set('name', 'orig');
  }
  return url.href;
}

function playableVariant(raw, platform) {
  const value = record(raw), url = mediaUrl(value.url, platform);
  if (!url) return null;
  const path = new URL(url).pathname;
  const inferred = /\.mp4$/i.test(path) ? 'video/mp4' : /\.webm$/i.test(path) ? 'video/webm' : '';
  const contentType = firstText(value.contentType, value.content_type).split(';')[0].trim().toLowerCase() || inferred;
  // HLS playlists and JPEG posters are never playable MP4/WebM attachments.
  if (!inferred || !['video/mp4', 'video/webm'].includes(contentType) || contentType !== inferred) return null;
  const bitrate = nonnegative(value.bitrate);
  return { url, contentType, ...(bitrate === undefined ? {} : { bitrate }) };
}

function variantsFor(value, platform) {
  const candidates = [...list(value.videoVariants), ...list(value.video_variants), ...list(value.videoInfo?.variants), ...list(value.video_info?.variants)];
  const direct = firstText(value.videoUrl, value.video_url);
  if (direct) candidates.push({ url: direct });
  const variants = new Map();
  for (const candidate of candidates) {
    const variant = playableVariant(candidate, platform);
    if (!variant) continue;
    const previous = variants.get(variant.url);
    if (!previous || (variant.bitrate ?? -1) > (previous.bitrate ?? -1)) variants.set(variant.url, variant);
  }
  return [...variants.values()].sort((a, b) => (b.bitrate ?? -1) - (a.bitrate ?? -1) || Number(b.contentType === 'video/mp4') - Number(a.contentType === 'video/mp4')).slice(0, MAX_VARIANTS);
}

function postId(raw) {
  const explicit = raw.id_str ?? raw.id ?? raw.rest_id ?? raw.tweetId;
  if (typeof explicit === 'string' && /^\d+$/.test(explicit)) return explicit;
  return /\/status\/(\d+)(?:[/?#]|$)/.exec(firstText(raw.url, raw.twitterUrl))?.[1] || '';
}

function isRepost(raw) {
  return raw.isRetweet === true || raw.is_retweet === true || raw.isRepost === true || raw.is_repost === true
    || ['retweeted_status', 'retweetedStatus', 'retweeted_tweet', 'retweetedTweet', 'reposted_post'].some(key => !!raw[key]);
}

function ownXAttachment(value, raw) {
  const id = postId(raw);
  const sourceId = value.sourceStatusId ?? value.source_status_id_str ?? value.source_status_id ?? value.sourceTweetId ?? value.source_tweet_id;
  if (sourceId != null && (!id || String(sourceId) !== id)) return false;
  const authorId = raw.author?.id_str ?? raw.author?.id;
  const sourceUserId = value.sourceUserId ?? value.source_user_id_str ?? value.source_user_id;
  if (sourceUserId != null && (authorId == null || String(sourceUserId) !== String(authorId))) return false;
  const permalinkId = /\/status\/(\d+)(?:[/?#]|$)/.exec(firstText(value.expandedUrl, value.expanded_url))?.[1];
  return !permalinkId || !!id && permalinkId === id;
}

function xAttachmentGroups(raw) {
  if (isRepost(raw)) return [];
  return [raw.media, raw.extendedEntities?.media, raw.extended_entities?.media, raw.extended_tweet?.extended_entities?.media, raw.entities?.media, raw.extended_tweet?.entities?.media]
    .map(values => list(values).map(record).filter(value => ownXAttachment(value, raw)));
}

function xAttachments(raw) { return xAttachmentGroups(raw).flat(); }

function coalesceXAttachments(raw) {
  const ordered = [], ids = new Map(), previews = new Map();
  for (const [group, values] of xAttachmentGroups(raw).entries()) {
    const matched = new Set();
    for (const value of values) {
      const id = firstText(value.mediaKey, value.media_key, value.id_str, typeof value.id === 'string' ? value.id : '').replace(/^\d+_/, '');
      const preview = previewFor(value, 'X'), type = attachmentType(value, 'X');
      let index = id ? ids.get(id) : undefined;
      if (index === undefined && preview) index = list(previews.get(preview)).find(index => ordered[index].group !== group && !matched.has(index) && (!id || !ordered[index].id || id === ordered[index].id) && attachmentType(ordered[index].value, 'X') === type);
      if (index === undefined) {
        index = ordered.length;
        ordered.push({ value, group, id });
        if (preview) previews.set(preview, [...list(previews.get(preview)), index]);
      } else {
        const original = ordered[index].value;
        // Merge repeated representations in place without collapsing distinct
        // same-poster videos inside one provider attachment array.
        ordered[index].value = { ...value, ...original, videoVariants: [...variantsFor(original, 'X'), ...variantsFor(value, 'X')] };
      }
      matched.add(index);
      if (id) ids.set(id, index);
    }
  }
  return ordered.map(entry => entry.value);
}

function attachmentType(value, platform) {
  const type = string(value.type).toLowerCase();
  if (['animated_gif', 'gif'].includes(type)) return 'gif';
  if (['video', 'reel', 'clips'].includes(type) || platform === 'Instagram' && value.media_type === 2) return 'video';
  if (['photo', 'image'].includes(type) || platform === 'Instagram' && value.media_type === 1) return 'image';
  // Instagram's own post record can omit type while retaining a direct video.
  if (platform === 'Instagram') return value.videoUrl || value.video_url || value.isVideo === true ? 'video' : 'image';
  return '';
}

function instagramAttachments(raw) {
  if (isRepost(raw)) return [];
  const sidecar = string(raw.type).toLowerCase() === 'sidecar' || raw.media_type === 8 || !raw.type && list(raw.childPosts).length > 0;
  if (sidecar) {
    if (list(raw.childPosts).length) return raw.childPosts.map(record);
    const images = list(raw.images);
    if (images.length) return images.map(value => typeof value === 'string' ? { type: 'Image', displayUrl: value } : record(value));
  }
  return [raw];
}

function attachments(raw, platform) {
  return platform === 'X' ? coalesceXAttachments(raw) : platform === 'Instagram' ? instagramAttachments(raw) : [];
}

function previewFor(value, platform) {
  for (const candidate of [value.mediaUrl, value.media_url_https, value.media_url, value.displayUrl, value.display_url, value.thumbnailUrl, value.thumbnail_url, ...list(value.images), value.url]) {
    const safe = imageUrl(candidate, platform);
    if (safe) return safe;
  }
  return '';
}

function metadataFor(value) {
  const alt = firstText(value.altText, value.alt_text, value.extAltText, value.ext_alt_text, value.accessibilityCaption).trim().slice(0, 2_000);
  const width = dimension(value.width ?? value.dimensionsWidth ?? value.original_info?.width ?? value.originalInfo?.width);
  const height = dimension(value.height ?? value.dimensionsHeight ?? value.original_info?.height ?? value.originalInfo?.height);
  const millis = nonnegative(value.durationMillis ?? value.duration_millis ?? value.videoInfo?.durationMillis ?? value.video_info?.duration_millis);
  const durationSeconds = nonnegative(value.videoDuration ?? value.durationSeconds) ?? (millis === undefined ? undefined : millis / 1_000);
  return { ...(alt ? { alt } : {}), ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

/** Only the root post's own attachments; quoted/reposted post objects are never traversed. */
export function extractPostMedia(raw, platform) {
  const post = record(raw), media = [], seenUrls = new Set(), seenIds = new Set();
  for (const value of attachments(post, platform)) {
    const type = attachmentType(value, platform);
    const previewUrl = previewFor(value, platform);
    const variants = type === 'video' || type === 'gif' ? variantsFor(value, platform) : [];
    const url = type === 'image' ? previewUrl : variants[0]?.url;
    if (!type || !url) continue;
    const id = firstText(value.mediaKey, value.media_key, value.id_str, typeof value.id === 'string' ? value.id : '');
    if (seenUrls.has(url) || id && seenIds.has(id)) continue;
    seenUrls.add(url); if (id) seenIds.add(id);
    media.push({ type, url, ...(type !== 'image' && previewUrl ? { previewUrl } : {}), ...metadataFor(value), ...(variants.length ? { variants } : {}) });
    if (media.length === MAX_MEDIA) break;
  }
  return media;
}

/** A safe still preview may exist even when a video has no returned playable file. */
export function mediaPreviewUrl(raw, platform) {
  const post = record(raw);
  for (const value of attachments(post, platform)) {
    const preview = previewFor(value, platform);
    if (preview) return preview;
  }
  return platform === 'Instagram' && !isRepost(post) ? previewFor(post, platform) : '';
}

export function hasUnplayablePostMedia(raw, platform) {
  return attachments(record(raw), platform).some(value => ['video', 'gif'].includes(attachmentType(value, platform)) && !variantsFor(value, platform).length);
}

function selectedXText(raw) {
  const extended = record(raw.extended_tweet);
  const full = firstText(raw.fullText, raw.full_text), rootRange = raw.displayTextRange ?? raw.display_text_range;
  // A short legacy text field can carry offsets for its truncated body. Do not
  // apply those offsets to a separate full/Note Tweet body.
  if (full) return { text: full, range: typeof raw.text !== 'string' || raw.text === full || rootRange?.[1] > raw.text.length ? rootRange : undefined, entities: raw.entities, trustUnlabeledIndices: typeof raw.text !== 'string' || raw.text === full };
  if (typeof extended.full_text === 'string') return { text: extended.full_text, range: extended.display_text_range, entities: extended.entities, trustUnlabeledIndices: typeof raw.text !== 'string' || raw.text === extended.full_text };
  return { text: string(raw.text), range: raw.displayTextRange ?? raw.display_text_range, entities: raw.entities, trustUnlabeledIndices: true };
}

function validRange(value, length) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger) && value[0] >= 0 && value[1] >= value[0] && value[1] <= length;
}

function pointOffsets(text) {
  const offsets = [0]; let offset = 0;
  for (const character of text) { offset += character.length; offsets.push(offset); }
  return offsets;
}

function safeBoundary(text, offset) {
  return !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]));
}

function rangeCandidates(range, text, offsets) {
  const utf16 = validRange(range, text.length) && range.every(offset => safeBoundary(text, offset)) ? range : null;
  const points = validRange(range, offsets.length - 1) ? [offsets[range[0]], offsets[range[1]]] : null;
  return { utf16, points };
}

function matchingEntitySpans(entity, text, offsets, trustUnlabeledIndices) {
  const token = string(entity.url);
  if (!token && !trustUnlabeledIndices) return [];
  return Object.entries(rangeCandidates(entity.indices, text, offsets)).filter(([, range]) => range && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(text.slice(...range)) && (!token || text.slice(...range) === token));
}

function visibleRange(range, text, offsets, entities, trustUnlabeledIndices) {
  const { utf16, points } = rangeCandidates(range, text, offsets), full = [0, text.length];
  if (utf16 && points && utf16[0] === points[0] && utf16[1] === points[1]) return utf16;
  // Xquik's actual rich rows use Unicode code-point offsets. Some legacy
  // integrations convert them to UTF-16; exact entity tokens prove which.
  const modes = new Set();
  for (const entity of entities) {
    const matches = matchingEntitySpans(entity, text, offsets, trustUnlabeledIndices);
    if (matches.length === 1) modes.add(matches[0][0]);
  }
  if (modes.size > 1) return full;
  if (modes.size === 1) return (modes.has('points') ? points : utf16) || full;
  if (points && range[1] === offsets.length - 1 && range[1] !== text.length) return points;
  if (utf16 && !points) return utf16;
  if (utf16 && points && text.slice(...utf16).trim() === text.slice(...points).trim()) return points;
  // Ambiguous or split-surrogate ranges cannot justify dropping source text.
  return full;
}

function replyMentionSpans(post, selected, offsets) {
  if (post.isReply !== true && post.is_reply !== true && post.inReplyToStatusId == null && post.in_reply_to_status_id == null && post.in_reply_to_status_id_str == null) return [];
  const spans = [];
  for (const value of [...list(selected.entities?.userMentions), ...list(selected.entities?.user_mentions)]) {
    const mention = record(value), handle = firstText(mention.screenName, mention.screen_name, mention.username, mention.userName);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) continue;
    for (const range of Object.values(rangeCandidates(mention.indices, selected.text, offsets))) if (range && selected.text.slice(...range).toLowerCase() === '@' + handle.toLowerCase()) spans.push(range);
  }
  return spans;
}

function provenExclusion(text, start, end, spans) {
  let cursor = start;
  for (const [a, b] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (b <= cursor || a >= end) continue;
    if (text.slice(cursor, Math.max(cursor, a)).trim()) return false;
    cursor = Math.min(end, b);
  }
  return !text.slice(cursor, end).trim();
}

/** Resolve proven code-point/UTF-16 offsets without splitting authored Unicode. */
export function visiblePostText(raw, platform) {
  const post = record(raw);
  if (platform === 'Instagram') return string(post.caption).trim();
  if (platform !== 'X') return '';
  const selected = selectedXText(post), text = selected.text, offsets = pointOffsets(text);
  const entities = [...xAttachments(post)];
  // Ordinary entities.urls are authored external links. Only a link explicitly
  // identifying this post's photo/video is an attachment token.
  const id = postId(post);
  for (const value of list(selected.entities?.urls)) {
    const expanded = firstText(value?.expandedUrl, value?.expanded_url);
    if (id && new RegExp('^https://(?:www\\.)?(?:x|twitter)\\.com/[^/]+/status/' + id + '/(?:photo|video)/\\d+(?:[?#]|$)').test(expanded)) entities.push(record(value));
  }
  const spans = [];
  for (const entity of entities) {
    const token = string(entity.url);
    const matches = matchingEntitySpans(entity, text, offsets, selected.trustUnlabeledIndices);
    if (matches.length) {
      spans.push(matches[0][1]);
    } else if (/^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(token)) {
      for (const match of text.matchAll(/https:\/\/t\.co\/[A-Za-z0-9]+/g)) {
        const before = text[match.index - 1], after = text[match.index + match[0].length];
        if (match[0] === token && (!before || /\s/u.test(before)) && (!after || /[\s.,!?;:)\]}]/u.test(after))) spans.push([match.index, match.index + token.length]);
      }
    }
  }
  const anchors = [...entities, ...list(selected.entities?.urls).map(record)];
  let [start, end] = visibleRange(selected.range, text, offsets, anchors, selected.trustUnlabeledIndices);
  // A range is an offset hint, not evidence that omitted prose or links are
  // attachments. Drop only proven own media or identified reply mentions.
  const prefixProof = [...spans, ...replyMentionSpans(post, selected, offsets)];
  if (!provenExclusion(text, 0, start, prefixProof) || !provenExclusion(text, end, text.length, spans)) [start, end] = [0, text.length];
  if (start === end) return '';
  let visible = '', cursor = start;
  for (const [a, b] of spans.sort((a, b) => a[0] - b[0])) {
    if (b <= cursor || a >= end) continue;
    visible += text.slice(cursor, Math.max(cursor, a));
    cursor = Math.min(end, b);
  }
  return (visible + text.slice(cursor, end)).trim();
}

export function mediaOnlyTitle(media, sourceName) {
  const values = list(media), name = string(sourceName).trim().slice(0, 200) || 'this source';
  const kind = values.length > 1 ? 'Media update' : values[0]?.type === 'gif' ? 'GIF' : values[0]?.type === 'video' ? 'Video' : values[0]?.type === 'image' ? 'Photo' : 'Update';
  return kind + ' from ' + name;
}
