import { extractPostMedia, mediaPreviewUrl, visiblePostText } from './post-media.mjs';

// Pure data helpers shared by the Actor, archive planner and reader. No fetching.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const text = (value, limit) => { const result = typeof value === 'string' ? value.trim().slice(0, limit) : ''; return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result; };
const id = value => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : '';
const handle = value => typeof value === 'string' && /^@?[A-Za-z0-9_]{1,15}$/.test(value) ? value.replace(/^@/, '').toLowerCase() : '';
const date = value => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const present = values => values.filter(value => value !== undefined && value !== null && value !== '');
const agreement = (values, parse) => { const parsed = present(values).map(parse); return parsed.length && parsed.every(value => value && value === parsed[0]) ? parsed[0] : ''; };

/** Accept exact public X status routes; never retain credentials or query strings. */
export function xPostIdentity(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?![\da-f]{2})/i.test(value) || /\/(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(value)) return;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    const originalPath = /^https:\/\/[^/?#]+([^?#]*)/i.exec(value)?.[1];
    if (originalPath !== url.pathname) return;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(host)) return;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,29})\/?$/.exec(url.pathname);
    const generic = /^\/i\/(?:web\/)?status\/([1-9]\d{0,29})\/?$/.exec(url.pathname);
    if (generic) return { postId: generic[1], url: 'https://x.com/i/web/status/' + generic[1] };
    if (!match || ['i', 'intent', 'home', 'search', 'explore', 'settings', 'messages'].includes(match[1].toLowerCase())) return;
    return { postId: match[2], authorHandle: match[1].toLowerCase(), url: 'https://x.com/' + match[1].toLowerCase() + '/status/' + match[2] };
  } catch { return; }
}

function image(value) {
  if (typeof value !== 'string' || value.length > 8000 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && ['pbs.twimg.com', 'ton.twimg.com'].includes(url.hostname) && (/\.(?:jpe?g|png|webp|avif|gif)(?::(?:thumb|small|medium|large|orig))?$/i.test(url.pathname) || /^\/media\/[^/.]+$/.test(url.pathname) && /^(?:jpe?g|png|webp|avif|gif)$/i.test(url.searchParams.get('format') || '')) ? url.href : '';
  } catch { return ''; }
}

function normalizedMedia(value) {
  // Reuse attachment URL/type validation without traversing any quoted objects.
  return extractPostMedia({ media: list(value).slice(0, 30).filter(object).map(item => ({ ...item, ...(item.type !== 'image' ? { videoUrl: item.url, videoVariants: item.variants } : {}), mediaUrl: item.previewUrl || item.url, altText: item.alt })) }, 'X');
}

/** Every supplied root/legacy identity assertion must agree, including aliases. */
export function xProviderPostIdentity(raw) {
  if (!object(raw)) return;
  const layers = [raw, ...(object(raw.legacy) ? [raw.legacy] : [])];
  const urls = layers.flatMap(layer => present([layer.url, layer.twitterUrl, layer.postUrl, layer.post_url]));
  const parsed = urls.map(xPostIdentity);
  if (parsed.some(value => !value)) return;
  const postId = agreement([...layers.flatMap(layer => present([layer.id, layer.id_str, layer.rest_id, layer.tweetId, layer.tweet_id])), ...parsed.map(value => value.postId)], id);
  const handles = parsed.map(value => value.authorHandle).filter(Boolean), authorHandle = agreement(handles, handle);
  if (!postId || handles.length && !authorHandle) return;
  return { postId, ...(authorHandle ? { authorHandle } : {}), url: 'https://x.com/' + (authorHandle || 'i/web') + '/status/' + postId };
}

function sanitizeReference(value, ownId, sanitizeMedia) {
  if (!object(value) || !['available', 'unavailable'].includes(value.status)) return;
  const parsedUrl = value.url === undefined ? undefined : xPostIdentity(value.url);
  const postId = value.postId === undefined ? parsedUrl?.postId : id(value.postId);
  const authorHandle = value.authorHandle === undefined ? parsedUrl?.authorHandle : handle(value.authorHandle);
  // Reject conflicting identities as a whole, rather than displaying another post's text.
  if (value.postId !== undefined && !postId || value.url !== undefined && !parsedUrl || parsedUrl && postId !== parsedUrl.postId || parsedUrl?.authorHandle && authorHandle && parsedUrl.authorHandle !== authorHandle || value.authorHandle !== undefined && !authorHandle || postId && postId === ownId) return;
  const url = parsedUrl?.url || (postId ? 'https://x.com/' + (authorHandle || 'i/web') + '/status/' + postId : '');
  const body = postId ? text(value.text, 100_000) : '';
  const media = postId ? sanitizeMedia(value.media) : [];
  const preview = postId ? image(value.image) : '';
  const publishedAt = date(value.publishedAt), authorName = text(value.authorName, 200);
  return { status: body || media.length || preview ? 'available' : 'unavailable', ...(postId ? { postId } : {}), ...(url ? { url } : {}), ...(authorHandle ? { authorHandle } : {}), ...(authorName ? { authorName } : {}), ...(publishedAt ? { publishedAt } : {}), ...(body ? { text: body } : {}), ...(media.length ? { media } : {}), ...(preview ? { image: preview } : {}), ...(['provider', 'archive'].includes(value.provenance) ? { provenance: value.provenance } : {}) };
}

export function sanitizePostContext(value, ownUrl, sanitizeMedia = normalizedMedia) {
  if (!object(value)) return;
  const own = xPostIdentity(ownUrl);
  if (!own) return;
  const reply = sanitizeReference(value.reply, own.postId, sanitizeMedia), quote = sanitizeReference(value.quote, own.postId, sanitizeMedia);
  return reply || quote ? { ...(reply ? { reply } : {}), ...(quote ? { quote } : {}) } : undefined;
}

function parentData(raw, expectedId) {
  if (!object(raw) || raw.demo === true || raw.isDemo === true || raw.error || raw.tombstone || /unavailable|tombstone/i.test(raw.__typename || '')) return;
  const post = object(raw.legacy) ? { ...raw.legacy, ...raw } : raw;
  const identity = xProviderPostIdentity(raw);
  const postId = identity?.postId;
  if (!postId || expectedId && postId !== expectedId) return;
  const layers = [raw, ...(object(raw.legacy) ? [raw.legacy] : [])];
  const authors = layers.flatMap(layer => [layer.author, layer.user, layer.core?.user_results?.result?.legacy].filter(object));
  const authorIds = authors.flatMap(author => present([author.id, author.id_str, author.rest_id]));
  if (authorIds.length && !agreement(authorIds, id)) return;
  const handles = present([...authors.flatMap(author => [author.userName, author.username, author.screen_name]), ...layers.map(layer => layer.authorHandle), identity.authorHandle]);
  const authorHandle = agreement(handles, handle);
  if (handles.length && !authorHandle) return;
  const names = present(authors.map(author => author.name));
  if (names.length && !agreement(names, value => text(value, 200))) return;
  const author = Object.assign({}, ...authors);
  const dates = present(layers.flatMap(layer => [layer.date, layer.timestamp, layer.createdAt, layer.created_at]));
  const publishedAt = agreement(dates, date);
  if (dates.length && !publishedAt) return;
  const authoredPost = { ...post, author };
  const note = post.noteTweet?.text || post.note_tweet?.text || post.note_tweet_results?.result?.text;
  const fullPost = typeof note === 'string' && note ? { ...authoredPost, fullText: note } : authoredPost;
  const body = text(visiblePostText(fullPost, 'X'), 100_000), media = extractPostMedia(authoredPost, 'X'), preview = mediaPreviewUrl(authoredPost, 'X');
  return { postId, ...(authorIds.length ? { authorId: agreement(authorIds, id) } : {}), ...(authorHandle ? { authorHandle } : {}), ...(text(author.name || post.authorName, 200) ? { authorName: text(author.name || post.authorName, 200) } : {}), ...(publishedAt ? { publishedAt } : {}), ...(body ? { text: body } : {}), ...(media.length ? { media } : {}), ...(preview ? { image: preview } : {}), provenance: 'provider' };
}

function unwrap(value) { return value?.tweet_results?.result || value?.tweetResult?.result || value?.result || value; }

function relationship(raw, kind, ownId) {
  const layers = [raw, ...(object(raw.legacy) ? [raw.legacy] : [])];
  const reply = kind === 'reply';
  const keys = reply ? ['inReplyToStatusId', 'inReplyToStatusIdStr', 'in_reply_to_status_id_str', 'in_reply_to_status_id', 'inReplyToId', 'in_reply_to_id', 'replyToTweetId'] : ['quotedStatusId', 'quotedStatusIdStr', 'quoted_status_id_str', 'quoted_status_id', 'quotedTweetId', 'quoted_tweet_id'];
  const references = layers.flatMap(layer => [...list(layer.referenced_tweets), ...list(layer.referencedTweets)]).filter(value => object(value) && value.type === (reply ? 'replied_to' : 'quoted'));
  const permalinks = layers.flatMap(layer => [layer.quotedTweetPermalink, layer.quoted_tweet_permalink, layer.quotedStatusPermalink, layer.quoted_status_permalink]);
  const urls = present(reply ? layers.flatMap(layer => [layer.inReplyToUrl, layer.inReplyToStatusUrl, layer.in_reply_to_status_url, layer.replyToTweetUrl]) : [...layers.flatMap(layer => [layer.quotedStatusUrl, layer.quoted_status_url, layer.quotedTweetUrl, layer.quoted_tweet_url]), ...permalinks.flatMap(permalink => [typeof permalink === 'string' ? permalink : undefined, permalink?.expandedUrl, permalink?.expanded_url, permalink?.expanded, xPostIdentity(permalink?.url) ? permalink.url : undefined])]);
  const urlIdentities = urls.map(xPostIdentity);
  const ids = present([...layers.flatMap(layer => keys.map(key => layer[key])), ...references.map(value => value.id), ...urlIdentities.map(value => value?.postId || 'invalid')]);
  const expectedId = agreement(ids, id);
  const objectKeys = reply ? ['inReplyToStatus', 'in_reply_to_status', 'replyToTweet', 'reply_to_tweet', 'repliedToTweet', 'replied_to_tweet', 'inReplyTo', 'in_reply_to'] : ['quotedStatus', 'quoted_status', 'quotedTweet', 'quoted_tweet', 'quoted_status_result'];
  const embedded = layers.flatMap(layer => objectKeys.map(key => unwrap(layer[key]))).filter(object);
  const flag = layers.some(layer => (reply ? ['isReply', 'is_reply'] : ['isQuote', 'isQuoteStatus', 'is_quote_status', 'is_quote']).some(key => layer[key] === true));
  if (!flag && !ids.length && !embedded.length) return;
  if (ids.length && !expectedId || expectedId === ownId) return { status: 'unavailable' };
  const expansions = expectedId ? layers.flatMap(layer => list(layer.includes?.tweets).filter(value => id(value?.id) === expectedId).map(value => {
    const users = list(layer.includes?.users).filter(user => id(user?.id) && id(user.id) === id(value.author_id));
    if (users.length > 1) return { id: value.id, error: 'ambiguous_expanded_author' };
    const user = users[0];
    const media = list(value.attachments?.media_keys || value.attachments?.mediaKeys).flatMap(key => {
      if (typeof key !== 'string' || key.length > 100) return [];
      const matches = list(layer.includes?.media).filter(item => (item?.media_key || item?.mediaKey) === key);
      return matches.length === 1 ? [{ ...matches[0], videoVariants: matches[0].variants || matches[0].videoVariants }] : [];
    });
    return { ...value, ...(user ? { author: user } : {}), ...(media.length ? { media } : {}) };
  })) : [];
  const suppliedCandidates = [...embedded, ...expansions].map(value => parentData(value, expectedId));
  const candidates = suppliedCandidates.every(Boolean) ? suppliedCandidates : [];
  // Merge missing fields in compatible snapshots; contradictions never select a winner.
  let parent = candidates.length ? {} : undefined;
  for (const candidate of candidates) for (const [key, value] of Object.entries(candidate)) {
    if (!parent) break;
    if (parent[key] !== undefined && JSON.stringify(parent[key]) !== JSON.stringify(value)) { parent = undefined; break; }
    parent[key] = value;
  }
  const postId = expectedId || parent?.postId;
  if (postId === ownId) return { status: 'unavailable' };
  const handles = present([...(reply ? layers.flatMap(layer => [layer.inReplyToScreenName, layer.in_reply_to_screen_name, layer.inReplyToUsername, layer.inReplyToUserName, layer.in_reply_to_username]) : []), ...urlIdentities.map(value => value?.authorHandle)]);
  const authorHandle = agreement(handles, handle);
  if (handles.length && !authorHandle) return { status: 'unavailable', ...(postId ? { postId } : {}) };
  const authorIds = present(layers.flatMap(layer => reply ? [layer.inReplyToUserId, layer.in_reply_to_user_id_str, layer.in_reply_to_user_id] : [layer.quotedUserId, layer.quoted_user_id]));
  const authorId = agreement(authorIds, id);
  if (authorIds.length && !authorId) return { status: 'unavailable', ...(postId ? { postId } : {}) };
  const parentMatches = parent && (!authorHandle || !parent.authorHandle || authorHandle === parent.authorHandle) && (!authorId || !parent.authorId || authorId === parent.authorId);
  const details = parentMatches ? parent : {};
  return { status: details.text || details.media?.length || details.image ? 'available' : 'unavailable', ...(postId ? { postId } : {}), ...(authorHandle ? { authorHandle } : {}), ...details };
}

/** Only explicit provider relationships count; mentions/conversation IDs never do. */
export function extractPostContext(raw, platform = 'X') {
  if (platform !== 'X' || !object(raw) || raw.demo === true || raw.isDemo === true || raw.is_demo === true || raw.error) return;
  const identity = xProviderPostIdentity(raw);
  if (!identity) return;
  const ownId = identity.postId;
  const reply = relationship(raw, 'reply', ownId), quote = relationship(raw, 'quote', ownId);
  return sanitizePostContext({ ...(reply ? { reply } : {}), ...(quote ? { quote } : {}) }, identity.url);
}

/** Hydrate only exact original IDs, never an @mention, thread/conversation ID or title. */
export function resolveArchivedPostContext(update, archivedUpdates, sources = []) {
  const context = sanitizePostContext(update?.postContext, update?.url);
  if (!context) return;
  const own = xPostIdentity(update.url);
  const result = { ...context };
  // Callers supply only this reader's archive. Missing/ambiguous source bindings
  // are not permission to borrow text from an arbitrary row with an X URL.
  if (!Array.isArray(sources) || !sources.length) return result;
  for (const kind of ['reply', 'quote']) {
    const reference = context[kind];
    if (!reference?.postId) continue;
    const candidates = list(archivedUpdates).filter(value => {
      const identity = xPostIdentity(value?.url);
      if (!identity || value.id === update.id || value.isSample !== false || value.format !== 'post' || !date(value.publishedAt) || identity.postId === own.postId || identity.postId !== reference.postId || reference.authorHandle && identity.authorHandle && reference.authorHandle !== identity.authorHandle) return false;
      const matches = sources.filter(source => source.id === value.sourceId);
      const source = matches[0];
      if (matches.length !== 1 || source.platform !== 'X') return false;
      if (source) {
        try { const profile = new URL(source.url); if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(profile.hostname) || profile.protocol !== 'https:' || profile.username || profile.password || profile.search || profile.hash || profile.port || profile.pathname.replace(/\/$/, '').toLowerCase() !== '/' + identity.authorHandle) return false; } catch { return false; }
      }
      return true;
    });
    if (candidates.length !== 1) continue;
    const saved = candidates[0], identity = xPostIdentity(saved.url), source = sources.find(source => source.id === saved.sourceId);
    const hydrated = sanitizeReference({ status: 'available', postId: identity.postId, url: identity.url, ...(identity.authorHandle ? { authorHandle: identity.authorHandle } : {}), ...(source?.name ? { authorName: source.name } : {}), publishedAt: saved.publishedAt, ...(saved.contentKind === 'feed_text' && typeof saved.content === 'string' ? { text: saved.content } : {}), media: saved.media, image: saved.image, provenance: 'archive' }, own.postId, normalizedMedia);
    if (!hydrated || hydrated.status !== 'available') continue;
    // Keep explicit provider content; the archive only fills absent fields.
    if (reference.text && hydrated.text && reference.text !== hydrated.text || reference.publishedAt && hydrated.publishedAt && reference.publishedAt !== hydrated.publishedAt || reference.authorHandle && hydrated.authorHandle && reference.authorHandle !== hydrated.authorHandle) continue;
    const copied = ['text', 'media', 'image', 'authorName', 'authorHandle', 'publishedAt', 'url'].some(key => reference[key] === undefined && hydrated[key] !== undefined);
    result[kind] = { ...hydrated, ...reference, status: 'available', provenance: copied ? 'archive' : reference.provenance || 'provider' };
  }
  return result;
}
