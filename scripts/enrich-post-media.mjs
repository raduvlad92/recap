import { createHash } from 'node:crypto';
import { publicUrl, sourceKey } from '../actors/tech-collector/src/collector.mjs';
import { extractPostMedia, visiblePostText, mediaOnlyTitle, mediaPreviewUrl } from '../actors/tech-collector/src/post-media.mjs';

// Deliberately no CLI, filesystem, provider client or database client. Private
// snapshots, plans and SQL belong in the caller's ignored .local directory.
const TARGET = 'zlfdqzabsfndifxiqguo';
const ALLOWED = new Set(['media', 'image', 'title', 'summary', 'content', 'contentKind', 'coverage']);
const SOCIAL = new Set(['X', 'Instagram']);
const MAX_RECORD_BYTES = 1_000_000;
const EMPTY_SUMMARY = 'No usable content text returned; open the original update.';
const fail = code => Object.assign(new Error(code), { safeCode: code });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,249}$/.test(value);
const validOwner = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,100}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const changedFields = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => stable(before[key]) !== stable(after[key])).sort(order);
const sameOutside = (before, after) => changedFields(before, after).every(key => ALLOWED.has(key));

function assertJson(value, depth = 0) {
  if (depth > 80) throw fail('unsupported_private_json');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && !value.includes('\u0000') && value.isWellFormed()) return;
  if (Array.isArray(value)) { for (const item of value) assertJson(item, depth + 1); return; }
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) { assertJson(key, depth + 1); assertJson(item, depth + 1); }
    return;
  }
  throw fail('unsupported_private_json');
}

function profileKey(source) {
  try {
    const key = sourceKey(source.url, source.platform), handle = key.split('/')[1];
    if (!(source.platform === 'X' ? /^[A-Za-z0-9_]{1,15}$/ : /^[A-Za-z0-9_.]{1,30}$/).test(handle)) throw new Error();
    return key;
  } catch { throw fail('invalid_social_source_identity'); }
}

/** Canonicalization permits only the documented host/trailing-slash aliases. */
function original(value, source) {
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\]/u.test(value) || !publicUrl(value)) throw fail('invalid_social_original_url');
  const url = new URL(value), host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (url.search || url.hash) throw fail('invalid_social_original_url');
  if (source.platform === 'X') {
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,29})$/.exec(url.pathname);
    if (!['x.com', 'twitter.com'].includes(host) || !match || match[1].toLowerCase() !== profileKey(source).split('/')[1]) throw fail('social_original_source_mismatch');
    return { key: 'https://x.com/' + match[1].toLowerCase() + '/status/' + match[2], postId: match[2] };
  }
  const match = /^\/(p|reel)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname);
  if (host !== 'instagram.com' || !match) throw fail('invalid_social_original_url');
  return { key: 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/', postId: match[2] };
}

function allAgree(values, expected, pattern, code, required = false) {
  const present = values.filter(value => value !== undefined && value !== null);
  if (required && !present.length || present.some(value => typeof value !== 'string' || !pattern.test(value) || value.toLowerCase() !== expected.toLowerCase())) throw fail(code);
}

function rawIdentity(raw, source) {
  if (!object(raw) || raw.demo === true || raw.isDemo === true || raw.is_demo === true || raw.error || raw.errors?.length || raw.requestErrorMessages?.length) throw fail('unusable_saved_social_raw_row');
  assertJson(raw);
  const urls = [raw.url, raw.twitterUrl, raw.postUrl, raw.post_url].filter(value => value !== undefined && value !== null);
  if (!urls.length) throw fail('saved_social_original_url_required');
  const identity = original(urls[0], source);
  if (urls.some(value => original(value, source).key !== identity.key)) throw fail('conflicting_saved_social_original_urls');
  const expectedHandle = profileKey(source).split('/')[1];
  let rawId;
  if (source.platform === 'X') {
    const ids = [raw.id, raw.id_str, raw.rest_id, raw.tweetId, raw.tweet_id];
    allAgree(ids, identity.postId, /^[1-9]\d{0,29}$/, 'saved_x_raw_id_mismatch', true);
    rawId = identity.postId;
    allAgree([raw.author?.userName, raw.author?.username, raw.author?.screen_name, raw.user?.screen_name, raw.user?.username], expectedHandle, /^[A-Za-z0-9_]{1,15}$/, 'saved_x_author_mismatch', true);
    for (const [field, value] of [['website', raw.author?.url], ['profile', raw.author?.profileUrl], ['profile', raw.author?.profile_url], ['website', raw.user?.url]]) {
      if (value !== undefined && value !== null) {
        // Some providers use user.url for an author's external website. Only
        // explicit platform profile URLs are identity assertions.
        if (field === 'website' && typeof value === 'string' && !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(value)) continue;
        if (profileKey({ ...source, url: value }) !== profileKey(source)) throw fail('saved_x_author_profile_mismatch');
      }
    }
  } else {
    allAgree([raw.ownerUsername, raw.owner?.username, raw.owner?.userName, raw.owner?.screen_name], expectedHandle, /^[A-Za-z0-9_.]{1,30}$/, 'saved_instagram_owner_mismatch', true);
    allAgree([raw.shortCode, raw.shortcode, raw.code], identity.postId, /^[A-Za-z0-9_-]{1,80}$/, 'saved_instagram_shortcode_mismatch', true);
    if ([raw.shortCode, raw.shortcode, raw.code].some(value => value != null && value !== identity.postId)) throw fail('saved_instagram_shortcode_mismatch');
    // The numeric Instagram media ID and the URL shortcode are different IDs.
    if (typeof raw.id !== 'string' || !/^[1-9]\d{0,39}$/.test(raw.id)) throw fail('saved_instagram_raw_id_required');
    rawId = raw.id;
    for (const value of [raw.ownerUrl, raw.owner?.profileUrl]) if (value !== undefined && value !== null && profileKey({ ...source, url: value }) !== profileKey(source)) throw fail('saved_instagram_owner_profile_mismatch');
    const ownerIds = [raw.ownerId, raw.owner?.id, raw.owner?.id_str].filter(value => value !== undefined && value !== null);
    if (ownerIds.some(value => typeof value !== 'string' || !/^[1-9]\d{0,39}$/.test(value) || value !== ownerIds[0])) throw fail('conflicting_saved_instagram_owner_ids');
  }
  if (raw.sourceId !== undefined && raw.sourceId !== source.id || raw.source_id !== undefined && raw.source_id !== source.id || raw.platform !== undefined && raw.platform !== source.platform) throw fail('saved_social_source_mismatch');
  for (const value of [raw.inputUrl, raw.inputURL, raw.sourceUrl]) {
    if (value === undefined || value === null) continue;
    let matches = false;
    try { matches = profileKey({ ...source, url: value }) === profileKey(source); } catch { /* A post URL may be the exact lookup input. */ }
    if (!matches) try { matches = original(value, source).key === identity.key; } catch { /* Reject any unrelated lookup input. */ }
    if (!matches) throw fail('saved_social_input_source_mismatch');
  }
  const dates = [raw.date, raw.timestamp, raw.createdAt, raw.created_at].filter(value => value !== undefined && value !== null);
  if (!dates.length || dates.some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) !== Date.parse(dates[0]))) throw fail('invalid_saved_social_timestamp');
  return { ...identity, rawId, publishedAt: new Date(dates[0]).toISOString() };
}

function safeMediaUrl(value, platform, playable = false) {
  if (typeof value !== 'string' || !value || value.length > 8000 || /[\s\\\u0000-\u001f\u007f]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    const trusted = platform === 'X' ? ['pbs.twimg.com', 'video.twimg.com', 'ton.twimg.com'].includes(host) : ['cdninstagram.com', 'fbcdn.net'].some(domain => host === domain || host.endsWith('.' + domain));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && trusted && url.pathname !== '/' && (!playable || /\.(mp4|webm)$/i.test(url.pathname));
  } catch { return false; }
}

function assertMedia(media, platform) {
  if (!Array.isArray(media) || media.length > 30) throw fail('invalid_enriched_social_media');
  const urls = new Set();
  for (const item of media) {
    if (!object(item) || !['image', 'video', 'gif'].includes(item.type) || Object.keys(item).some(key => !['type', 'url', 'previewUrl', 'alt', 'width', 'height', 'durationSeconds', 'variants'].includes(key)) || !safeMediaUrl(item.url, platform, item.type !== 'image') || urls.has(item.url)) throw fail('invalid_enriched_social_media');
    urls.add(item.url);
    if (item.previewUrl !== undefined && !safeMediaUrl(item.previewUrl, platform) || item.alt !== undefined && (typeof item.alt !== 'string' || item.alt.length > 2000)) throw fail('invalid_enriched_social_media');
    for (const key of ['width', 'height']) if (item[key] !== undefined && (!Number.isInteger(item[key]) || item[key] < 1 || item[key] > 100000)) throw fail('invalid_enriched_social_media');
    if (item.durationSeconds !== undefined && (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds < 0)) throw fail('invalid_enriched_social_media');
    if (item.variants !== undefined) {
      if (item.type === 'image' || !Array.isArray(item.variants) || !item.variants.length || item.variants.length > 16 || new Set(item.variants.map(variant => variant?.url)).size !== item.variants.length) throw fail('invalid_enriched_social_media');
      for (const variant of item.variants) {
        if (!object(variant) || Object.keys(variant).some(key => !['url', 'contentType', 'bitrate'].includes(key)) || !safeMediaUrl(variant.url, platform, true) || variant.contentType !== (/\.webm$/i.test(new URL(variant.url).pathname) ? 'video/webm' : 'video/mp4') || variant.bitrate !== undefined && (typeof variant.bitrate !== 'number' || !Number.isFinite(variant.bitrate) || variant.bitrate < 0)) throw fail('invalid_enriched_social_media');
      }
    }
  }
}

function assertRecord(record, platform) {
  assertJson(record);
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECORD_BYTES) throw fail('enriched_archive_record_too_large');
  for (const key of ['title', 'summary', 'content', 'coverage', 'image']) if (record[key] !== undefined && typeof record[key] !== 'string') throw fail('invalid_enriched_social_record');
  if (record.media !== undefined) assertMedia(record.media, platform);
  if (record.contentKind !== undefined && !['feed_text', 'metadata_only'].includes(record.contentKind)) throw fail('invalid_enriched_social_content_kind');
}

function enrichRecord(before, raw, source) {
  const record = clone(before), extracted = extractPostMedia(raw, source.platform), preview = mediaPreviewUrl(raw, source.platform);
  if (before.media !== undefined) assertMedia(before.media, source.platform);
  const originalText = (source.platform === 'X' ? raw.text : raw.caption);
  const legacyText = typeof originalText === 'string' ? originalText.slice(0, 200000).trim() : '';
  const proposedText = safeSlice(visiblePostText(raw, source.platform), 200000).trim();
  const visible = attachmentOnlyText(raw, source.platform, legacyText, proposedText);
  // Incomplete raw media never erases previously saved valid attachments.
  if (extracted.length) {
    // An exact-post refresh is authoritative. Signed CDN URLs are not attachment
    // identities, so appending old URLs would duplicate and retain expired media.
    if (extracted.length < (before.media?.length || 0)) throw fail('partial_social_media_refresh_would_drop_attachments');
    record.media = extracted;
    assertMedia(record.media, source.platform);
  }
  if (preview) record.image = preview;
  const media = record.media || [], hasMediaEvidence = media.length > 0 || !!preview;
  const rawTitle = typeof raw.title === 'string' ? raw.title.slice(0, 500).trim() : '';
  const oldTitle = rawTitle || (legacyText ? legacyText.slice(0, 120) : 'Update from ' + source.name);
  const titleIsDerived = before.title === oldTitle && (!rawTitle || legacyText.startsWith(rawTitle));
  const summaryIsDerived = before.summary === (legacyText.slice(0, 700) || EMPTY_SUMMARY) || before.summary === '' && !legacyText;
  const contentIsDerived = before.content === legacyText || !before.content && !legacyText;
  const preservedText = (!summaryIsDerived && !!before.summary) || (!contentIsDerived && !!before.content);
  // A full-text provider field that differs from the historical raw.text is not
  // permission to expand/rewrite an archived text. Corrections only remove text.
  const canCorrect = visible !== legacyText || hasMediaEvidence;
  if (canCorrect) {
    if (titleIsDerived) record.title = visible ? safeSlice(visible, 120) : mediaOnlyTitle(media, source.name);
    if (summaryIsDerived) record.summary = safeSlice(visible, 700);
    if (contentIsDerived) record.content = visible;
    if (!preservedText && (contentIsDerived || summaryIsDerived)) {
      record.contentKind = visible ? 'feed_text' : 'metadata_only';
      record.coverage = visible ? 'Public post/caption text; linked articles, image text and media audio not collected.' : 'Post metadata only; no visible authored post text. Image text and media audio not analyzed.';
      if (hasMediaEvidence) record.coverage += media.length ? ' Original attached media retained; media content not analyzed.' : ' Still preview retained; playable media URL unavailable.';
      if (typeof originalText === 'string' && originalText.length > 200000) record.coverage += ' Source text was clipped at 200,000 characters; the remaining text is not included.';
    }
  }
  return { record, preservedText: !titleIsDerived || !summaryIsDerived || !contentIsDerived };
}

function safeSlice(value, limit) {
  const clipped = value.slice(0, limit);
  return clipped && /[\uD800-\uDBFF]/u.test(clipped.at(-1)) ? clipped.slice(0, -1) : clipped;
}

/** A display range is never permission to delete prose, emoji or external links. */
function attachmentOnlyText(raw, platform, before, after) {
  if (before === after) return after;
  if (platform !== 'X' || !after.isWellFormed()) return before;
  const tokenPattern = /https:\/\/t\.co\/[A-Za-z0-9]+/g;
  const oldTokens = [...before.matchAll(tokenPattern)].map(match => match[0]), nextTokens = [...after.matchAll(tokenPattern)].map(match => match[0]);
  if (before.replace(tokenPattern, '').trim() !== after.replace(tokenPattern, '').trim()) return before;
  const removed = [], retained = [...nextTokens];
  for (const token of oldTokens) { if (retained[0] === token) retained.shift(); else removed.push(token); }
  if (retained.length || !removed.length) return before;
  const entities = [...(Array.isArray(raw.entities?.urls) ? raw.entities.urls : []), ...(Array.isArray(raw.extended_tweet?.entities?.urls) ? raw.extended_tweet.entities.urls : [])];
  for (const token of removed) {
    for (const entity of entities.filter(entity => entity?.url === token)) {
      const expanded = entity.expandedUrl || entity.expanded_url || '';
      const postId = raw.id_str || raw.id || raw.rest_id || raw.tweetId || raw.tweet_id;
      if (!new RegExp('^https://(?:www\\.)?(?:x|twitter)\\.com/[^/]+/status/' + postId + '/(?:photo|video)/\\d+(?:[?#]|$)').test(expanded)) return before;
    }
  }
  {
    // Every removed token needs positive root-owned attachment entity proof,
    // independent of the provider's display range or presence of another asset.
    // Prove removal against the archived body, not a different provider fullText.
    // Index-only entities for another body cannot establish attachment identity.
    const proofEntities = values => Array.isArray(values) ? values.map(value => {
      if (!object(value) || typeof value.url === 'string' && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(value.url)) return value;
      const { indices, ...withoutIndices } = value;
      return withoutIndices;
    }) : values;
    const proofObject = value => object(value) ? { ...value, media: proofEntities(value.media), urls: proofEntities(value.urls) } : value;
    const unbounded = { ...raw, text: before, fullText: before, full_text: before, displayTextRange: [0, before.length], display_text_range: [0, before.length], media: proofEntities(raw.media), entities: proofObject(raw.entities), extendedEntities: proofObject(raw.extendedEntities), extended_entities: proofObject(raw.extended_entities), ...(raw.extended_tweet ? { extended_tweet: { ...raw.extended_tweet, full_text: before, display_text_range: [0, before.length], entities: proofObject(raw.extended_tweet.entities), extended_entities: proofObject(raw.extended_tweet.extended_entities) } } : {}) };
    const withoutRange = visiblePostText(unbounded, platform);
    if (removed.some(token => withoutRange.includes(token))) return before;
  }
  return after;
}

/** Build a private review plan solely from already-read snapshots and raw data. */
export function buildPostMediaPlan({ archiveRows, workspace, sources, datasets, now = new Date().toISOString() }) {
  if (!Array.isArray(archiveRows) || !archiveRows.length || archiveRows.some(row => !object(row) || !validOwner(row.user_id))) throw fail('private_archive_owner_required');
  const owners = new Set(archiveRows.map(row => row.user_id));
  if (owners.size !== 1) throw fail('ambiguous_archive_owner');
  const userId = [...owners][0];
  if (!object(workspace) || workspace.user_id !== userId || !object(workspace.state) || !Array.isArray(workspace.state.customSources) || !timestamp(workspace.updated_at) || !timestamp(now)) throw fail('matching_existing_owner_workspace_required');
  assertJson(workspace);
  if (!Array.isArray(sources) || !Array.isArray(datasets)) throw fail('social_sources_and_saved_datasets_required');
  const sourceMap = new Map(), anchors = new Set(), workspaceMap = new Map(), workspaceAnchors = new Set();
  for (const source of sources) {
    if (!object(source) || !validId(source.id) || sourceMap.has(source.id)) throw fail('invalid_or_duplicate_manifest_source');
    if (SOCIAL.has(source.platform)) {
      if (typeof source.name !== 'string' || !source.name.trim() || source.name.length > 200) throw fail('invalid_social_source_name');
      const key = profileKey(source);
      if (anchors.has(key)) throw fail('duplicate_manifest_social_identity');
      anchors.add(key);
    }
    sourceMap.set(source.id, source);
  }
  for (const source of workspace.state.customSources) {
    if (!object(source) || !validId(source.id) || workspaceMap.has(source.id)) throw fail('invalid_or_duplicate_workspace_source');
    if (SOCIAL.has(source.platform)) {
      const key = profileKey(source);
      if (workspaceAnchors.has(key)) throw fail('duplicate_workspace_social_identity');
      workspaceAnchors.add(key);
    }
    workspaceMap.set(source.id, source);
  }
  const rawByUrl = new Map(), rawIds = new Map();
  const stats = { archiveRows: archiveRows.length, socialRows: 0, rawSocialRows: 0, duplicateRawRows: 0, matchedRows: 0, mediaRows: 0, imageRows: 0, videoRows: 0, gifRows: 0, carouselRows: 0, previewOnlyRows: 0, preservedDifferentTextRows: 0, archiveRowsToPatch: 0, unchangedRows: 0, unmatchedRows: 0, unmatchedRawRows: 0 };
  for (const dataset of datasets) {
    if (!object(dataset) || !validId(dataset.sourceId) || !validId(dataset.providerRunId) || !Array.isArray(dataset.items)) throw fail('invalid_saved_social_dataset');
    const source = sourceMap.get(dataset.sourceId);
    if (!source) throw fail('saved_dataset_source_missing_from_manifest');
    if (!SOCIAL.has(source.platform)) continue;
    for (const raw of dataset.items) {
      const identity = rawIdentity(raw, source), key = source.id + ':' + identity.key, rawKey = source.platform + ':' + identity.rawId;
      const previousId = rawIds.get(rawKey);
      if (previousId && previousId !== key) throw fail('conflicting_saved_social_raw_identity');
      rawIds.set(rawKey, key);
      const previous = rawByUrl.get(key);
      if (previous) {
        if (hash(previous.raw) !== hash(raw)) throw fail('conflicting_duplicate_saved_social_row');
        stats.duplicateRawRows++;
        continue;
      }
      rawByUrl.set(key, { raw, identity, source, providerRunId: dataset.providerRunId });
      stats.rawSocialRows++;
    }
  }
  const archivePatches = [], seen = new Set(), seenUrls = new Set(), matched = new Set();
  for (const row of archiveRows) {
    if (!validId(row.id) || !validId(row.source_id) || seen.has(row.id) || !object(row.record) || row.record.id !== row.id || row.record.sourceId !== row.source_id) throw fail('invalid_or_duplicate_existing_archive_row');
    seen.add(row.id);
    const source = sourceMap.get(row.source_id);
    if (!source || !SOCIAL.has(source.platform)) continue;
    stats.socialRows++;
    if (row.record.format !== 'post' || row.record.isSample !== false || !timestamp(row.record.publishedAt)) throw fail('existing_social_archive_record_required');
    const savedSource = workspaceMap.get(source.id);
    if (!savedSource || savedSource.platform !== source.platform || profileKey(savedSource) !== profileKey(source)) throw fail('existing_workspace_source_identity_mismatch');
    const identity = original(row.record.url, source), key = source.id + ':' + identity.key;
    if (seenUrls.has(identity.key)) throw fail('duplicate_existing_social_original_url');
    seenUrls.add(identity.key);
    const saved = rawByUrl.get(key);
    if (!saved) continue;
    if (Date.parse(row.record.publishedAt) !== Date.parse(saved.identity.publishedAt)) throw fail('saved_social_publication_time_mismatch');
    matched.add(key); stats.matchedRows++;
    const { record, preservedText } = enrichRecord(row.record, saved.raw, source);
    assertRecord(record, source.platform);
    if (preservedText) stats.preservedDifferentTextRows++;
    if (record.media?.length) stats.mediaRows++;
    for (const [type, field] of [['image', 'imageRows'], ['video', 'videoRows'], ['gif', 'gifRows']]) if (record.media?.some(item => item.type === type)) stats[field]++;
    if (record.media?.length > 1) stats.carouselRows++;
    if (!record.media?.length && mediaPreviewUrl(saved.raw, source.platform)) stats.previewOnlyRows++;
    const fields = changedFields(row.record, record);
    if (fields.length) archivePatches.push({ id: row.id, sourceId: row.source_id, platform: source.platform, sourceUrl: source.url, originalUrl: saved.identity.key, rawId: saved.identity.rawId, providerRunId: saved.providerRunId, beforeHash: hash(row.record), afterHash: hash(record), beforeRecord: clone(row.record), record, changedFields: fields });
  }
  archivePatches.sort((a, b) => order(a.id, b.id));
  stats.archiveRowsToPatch = archivePatches.length;
  stats.unchangedRows = archiveRows.length - archivePatches.length;
  stats.unmatchedRows = stats.socialRows - stats.matchedRows;
  stats.unmatchedRawRows = rawByUrl.size - matched.size;
  return { version: 1, targetProject: TARGET, preparedAt: now, userId, stats, archivePatches, workspace: { before: clone(workspace), beforeHash: hash(workspace.state), afterHash: hash(workspace.state), state: clone(workspace.state) } };
}

const sqlString = value => "'" + value.replaceAll("'", "''") + "'";

/** Full-state/record compare-and-swap locks precede every archive-only update. */
export function buildPostMediaSql(plan) {
  if (!object(plan) || plan.version !== 1 || plan.targetProject !== TARGET || !validOwner(plan.userId) || !timestamp(plan.preparedAt) || !object(plan.workspace) || !object(plan.workspace.before) || plan.workspace.before.user_id !== plan.userId || !object(plan.workspace.before.state) || !timestamp(plan.workspace.before.updated_at) || !object(plan.workspace.state) || !Array.isArray(plan.archivePatches)) throw fail('invalid_post_media_plan');
  assertJson(plan);
  if (hash(plan.workspace.before.state) !== plan.workspace.beforeHash || hash(plan.workspace.state) !== plan.workspace.afterHash || stable(plan.workspace.before.state) !== stable(plan.workspace.state)) throw fail('post_media_workspace_must_remain_identical');
  if (plan.archivePatches.some(patch => !object(patch))) throw fail('invalid_post_media_archive_patch');
  const ids = new Set(), urls = new Set();
  const patches = [...plan.archivePatches].sort((a, b) => order(a.id, b.id));
  for (const patch of patches) {
    if (!object(patch) || !validId(patch.id) || !validId(patch.sourceId) || !validId(patch.providerRunId) || !SOCIAL.has(patch.platform) || ids.has(patch.id) || !object(patch.beforeRecord) || !object(patch.record) || patch.beforeRecord.id !== patch.id || patch.record.id !== patch.id || patch.beforeRecord.sourceId !== patch.sourceId || patch.record.sourceId !== patch.sourceId || patch.beforeRecord.format !== 'post' || patch.beforeRecord.isSample !== false || !timestamp(patch.beforeRecord.publishedAt) || hash(patch.beforeRecord) !== patch.beforeHash || hash(patch.record) !== patch.afterHash || !sameOutside(patch.beforeRecord, patch.record) || stable(changedFields(patch.beforeRecord, patch.record)) !== stable(patch.changedFields) || !patch.changedFields.length) throw fail('invalid_post_media_archive_patch');
    const source = { platform: patch.platform, url: patch.sourceUrl }, identity = original(patch.beforeRecord.url, source);
    const workspaceSource = plan.workspace.before.state.customSources?.filter(source => source.id === patch.sourceId);
    if (identity.key !== patch.originalUrl || urls.has(identity.key) || workspaceSource?.length !== 1 || workspaceSource[0].platform !== patch.platform || profileKey(workspaceSource[0]) !== profileKey(source) || typeof patch.rawId !== 'string' || !(patch.platform === 'X' ? patch.rawId === identity.postId : /^[1-9]\d{0,39}$/.test(patch.rawId))) throw fail('invalid_post_media_archive_identity');
    ids.add(patch.id); urls.add(identity.key);
    if (patch.beforeRecord.media !== undefined) assertMedia(patch.beforeRecord.media, patch.platform);
    if ((patch.record.media?.length || 0) < (patch.beforeRecord.media?.length || 0)) throw fail('partial_social_media_refresh_would_drop_attachments');
    assertRecord(patch.record, patch.platform);
    if (patch.record.image !== patch.beforeRecord.image && !safeMediaUrl(patch.record.image, patch.platform)) throw fail('invalid_enriched_social_preview');
  }
  const payload = { userId: plan.userId, workspace: { before: plan.workspace.before }, archivePatches: patches.map(({ id, sourceId, beforeRecord, record }) => {
    const fields = changedFields(beforeRecord, record);
    return { id, sourceId, beforeRecord, patch: Object.fromEntries(fields.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])), removedFields: fields.filter(key => !Object.hasOwn(record, key)) };
  }) };
  const workspaceCondition = "user_id=payload->>'userId' and updated_at=(payload#>>'{workspace,before,updated_at}')::timestamptz and state=payload#>'{workspace,before,state}'";
  const archiveCondition = "user_id=payload->>'userId' and id=item->>'id' and source_id=item->>'sourceId' and record=item->'beforeRecord'";
  const body = `declare
  payload jsonb := ${sqlString(JSON.stringify(payload))}::jsonb;
  item jsonb;
  affected integer;
begin
  perform 1 from public.reader_workspaces where ${workspaceCondition} for update;
  if not found then raise exception 'stale_post_media_workspace_plan'; end if;
  -- Check and lock ALL expected rows before the first mutation.
  for item in select value from jsonb_array_elements(payload->'archivePatches') order by (value->>'id') collate "C" loop
    perform 1 from public.reader_source_updates where ${archiveCondition} for update;
    if not found then raise exception 'stale_post_media_archive_plan'; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'archivePatches') order by (value->>'id') collate "C" loop
    update public.reader_source_updates set record=(record || (item->'patch')) - array(select jsonb_array_elements_text(item->'removedFields')) where ${archiveCondition};
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'stale_post_media_archive_plan'; end if;
  end loop;
end;`;
  let tag = '$recap_post_media$';
  while (body.includes(tag)) tag = '$recap_post_media_' + createHash('sha256').update(tag).digest('hex').slice(0, 12) + '$';
  return 'begin;\n-- Target project: ' + TARGET + '\nset local statement_timeout=\'60s\';\nset local lock_timeout=\'5s\';\nset local standard_conforming_strings=on;\ndo ' + tag + '\n' + body + '\n' + tag + ';\ncommit;\n';
}
