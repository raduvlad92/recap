import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone offline enrichment module has no TS declaration.
import { buildPostMediaPlan, buildPostMediaSql } from '../scripts/enrich-post-media.mjs';

type Data = Record<string, any>;
const owner = 'user_syntheticowner', postId = '1940000000000000001', token = 'https://t.co/Attachment123';
const date = '2026-10-01T12:00:00.000Z';
const source = { id: 'synthetic-x', platform: 'X', name: 'Synthetic publisher', url: 'https://x.com/example' };
const gif = () => ({ type: 'animated_gif', url: token, mediaUrl: 'https://pbs.twimg.com/tweet_video_thumb/example.jpg', videoVariants: [{ url: 'https://video.twimg.com/tweet_video/example.mp4', contentType: 'video/mp4', bitrate: 0 }] });
const rawPost = () => ({ id: postId, url: 'https://x.com/example/status/' + postId, author: { userName: 'example', url: 'http://example.org/' }, text: token, date, displayTextRange: [0, 0], media: [gif()] });
const record = (raw: Data, id = 'existing-post', sourceId = source.id) => ({ id, sourceId, title: (raw.text || raw.caption || '').slice(0, 120), summary: (raw.text || raw.caption || '').slice(0, 700), content: raw.text || raw.caption || '', contentKind: 'feed_text', coverage: 'Public post/caption text; linked articles, image text and media audio not collected.', url: raw.url, publishedAt: date, format: 'post', isSample: false, contributorIds: ['synthetic-presenter'], topics: ['Research'], brands: ['Example'], sponsors: [], references: [{ title: 'Original update', url: raw.url }], insights: ['Keep editorial annotation'], videoHighlights: [{ text: 'Keep this text', startSeconds: 12 }], videoSummary: { status: 'unavailable' } });
function input(): Data {
  const raw = rawPost(), archived = record(raw);
  return { now: '2026-10-23T12:00:00.000Z', sources: [source], datasets: [{ sourceId: source.id, providerRunId: 'synthetic-run', items: [raw] }], archiveRows: [{ user_id: owner, id: archived.id, source_id: source.id, record: archived }], workspace: { user_id: owner, updated_at: '2026-10-23T10:00:00.123456+00:00', state: { version: 1, customSources: [{ ...source, status: 'ready', creatorIds: [] }], followedSourceIds: [source.id], savedUpdateIds: [archived.id], readLaterIds: [archived.id], importedUpdates: [], settings: { timezone: 'Europe/Berlin', interests: ['Research'] }, sourcePreferences: { [source.id]: { showShorts: false } }, keywordReviews: [{ label: 'Keep review', status: 'pending' }] } } };
}
function replaceRaw(data: Data, raw: Data) { data.datasets[0].items = [raw]; data.archiveRows[0].record = record(raw); }
const stable = (value: any): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = (value: any) => createHash('sha256').update(stable(value)).digest('hex');
function rehash(patch: Data) { patch.afterHash = hash(patch.record); patch.changedFields = [...new Set([...Object.keys(patch.beforeRecord), ...Object.keys(patch.record)])].filter(key => stable(patch.beforeRecord[key]) !== stable(patch.record[key])).sort(); }

describe('offline existing-post enrichment', () => {
  it('restores a GIF without changing history identity, annotations or the workspace, and repeats safely', () => {
    const data = input(), before = structuredClone(data), fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const plan = buildPostMediaPlan(data), patch = plan.archivePatches[0];
      expect(data).toEqual(before);
      expect(plan.stats).toMatchObject({ matchedRows: 1, mediaRows: 1, gifRows: 1, imageRows: 0, videoRows: 0, carouselRows: 0, archiveRowsToPatch: 1, unchangedRows: 0 });
      expect(patch.record).toMatchObject({ id: 'existing-post', title: 'GIF from Synthetic publisher', summary: '', content: '', contentKind: 'metadata_only', publishedAt: date, media: [{ type: 'gif', url: 'https://video.twimg.com/tweet_video/example.mp4' }] });
      for (const field of ['url', 'sourceId', 'publishedAt', 'topics', 'brands', 'sponsors', 'references', 'insights', 'contributorIds', 'videoHighlights', 'videoSummary']) expect(patch.record[field]).toEqual(before.archiveRows[0].record[field]);
      expect(plan.workspace.state).toEqual(before.workspace.state);
      expect(plan.workspace.before).toEqual(before.workspace);
      data.archiveRows[0].record = structuredClone(patch.record);
      expect(buildPostMediaPlan(data).stats).toMatchObject({ archiveRowsToPatch: 0, unchangedRows: 1, matchedRows: 1 });
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('removes only known attachments while retaining Unicode and genuine post-text links', () => {
    const data = input(), text = '🧑🏽‍💻 Café 東京 https://t.co/External123 ' + token;
    replaceRaw(data, { ...rawPost(), text, displayTextRange: [0, text.length], entities: { urls: [{ url: 'https://t.co/External123', expanded_url: 'https://example.org/report' }] } });
    const next = buildPostMediaPlan(data).archivePatches[0].record;
    expect(next.content).toBe('🧑🏽‍💻 Café 東京 https://t.co/External123');
    expect(next.summary).toBe(next.content); expect(next.contentKind).toBe('feed_text');
    expect(next.content.isWellFormed()).toBe(true);
  });

  it('preserves a t.co external link even when a display range hides it and an image exists', () => {
    const data = input(), raw = { ...rawPost(), text: 'Report https://t.co/External123', displayTextRange: [0, 6], media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/example.jpg' }] };
    replaceRaw(data, raw);
    expect(buildPostMediaPlan(data).archivePatches[0].record.content).toBe(raw.text);
  });

  it('requires attachment proof in the archived body when provider full text omits a link', () => {
    for (const indices of [undefined, [7, 31]]) for (const url of [undefined, '', null, 'not-a-token']) {
      const data = input(), raw = { ...rawPost(), text: 'Report https://t.co/External123', fullText: 'Report', displayTextRange: [0, 6], media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/example.jpg', ...(url !== undefined ? { url } : {}), ...(indices ? { indices } : {}) }] };
      replaceRaw(data, raw);
      const plan = buildPostMediaPlan(data), next = plan.archivePatches[0].record;
      expect(next.content).toBe(raw.text);
      expect(next.summary).toBe(raw.text);
      expect(buildPostMediaSql(plan)).toContain('record=item');
    }
  });

  it('preserves each editorial text field independently', () => {
    const data = input();
    data.archiveRows[0].record.title = 'Editorial headline'; data.archiveRows[0].record.summary = 'Editorial synopsis';
    const next = buildPostMediaPlan(data).archivePatches[0].record;
    expect(next).toMatchObject({ title: 'Editorial headline', summary: 'Editorial synopsis', content: '' });
    const edited = input(); edited.archiveRows[0].record.content = 'Corrected authored body';
    expect(buildPostMediaPlan(edited).archivePatches[0].record.content).toBe('Corrected authored body');
  });

  it('retains untrusted range-hidden prose and never expands archived text from a different fullText field', () => {
    for (const [raw, expected] of [[{ ...rawPost(), text: 'Authored introduction ' + token, displayTextRange: [0, 0] }, 'Authored introduction'], [{ ...rawPost(), text: 'Short original', fullText: 'Different complete body ' + token }, 'Short original']] as Array<[Data, string]>) {
      const data = input(); replaceRaw(data, raw);
      expect(buildPostMediaPlan(data).archivePatches[0].record.content).toBe(expected);
    }
  });

  it('keeps every unrelated YouTube row untouched without assuming an archive size', () => {
    const data = input();
    for (let n = 0; n < 484; n++) data.archiveRows.push({ user_id: owner, id: 'existing-video-' + n, source_id: 'youtube-source', record: { id: 'existing-video-' + n, sourceId: 'youtube-source', url: 'https://www.youtube.com/watch?v=abcdef12345', content: 'Full captions', videoHighlights: [{ text: 'Editorial takeaway' }] } });
    const plan = buildPostMediaPlan(data);
    expect(plan.stats).toMatchObject({ archiveRows: 485, archiveRowsToPatch: 1, unchangedRows: 484 });
    expect(plan.archivePatches.map((patch: Data) => patch.id)).toEqual(['existing-post']);
  });

  it('accepts exact Instagram post lookup inputs and mixed carousels, replacing equal-count signed refreshes', () => {
    const data = input(), instagram = { id: 'synthetic-instagram', platform: 'Instagram', name: 'Synthetic photographer', url: 'https://www.instagram.com/example/' };
    const raw = { id: '1940000000000000002', shortCode: 'AbC123', url: 'https://www.instagram.com/p/AbC123/', inputUrl: 'https://www.instagram.com/p/AbC123/', ownerUsername: 'example', caption: 'Authored caption', timestamp: date, type: 'Sidecar', childPosts: [{ type: 'Image', displayUrl: 'https://scontent.cdninstagram.com/photo.jpg?sig=new' }, { type: 'Video', displayUrl: 'https://scontent.cdninstagram.com/cover.jpg', videoUrl: 'https://scontent.cdninstagram.com/video.mp4?sig=new' }] };
    data.sources = [instagram]; data.workspace.state.customSources = [instagram]; data.datasets = [{ sourceId: instagram.id, providerRunId: 'synthetic-refresh', items: [raw] }];
    data.archiveRows = [{ user_id: owner, id: 'existing-instagram', source_id: instagram.id, record: record(raw, 'existing-instagram', instagram.id) }];
    const plan = buildPostMediaPlan(data);
    expect(plan.stats).toMatchObject({ imageRows: 1, videoRows: 1, carouselRows: 1 });
    const previous = structuredClone(plan.archivePatches[0].record);
    previous.media.forEach((media: Data) => { media.url = media.url.replace('sig=new', 'sig=old'); });
    data.archiveRows[0].record = previous;
    expect(buildPostMediaPlan(data).archivePatches[0].record.media).toHaveLength(2);
    expect(buildPostMediaPlan(data).archivePatches[0].record.media[0].url).toContain('sig=new');
    data.datasets[0].items[0].ownerUsername = 'foreign'; expect(() => buildPostMediaPlan(data)).toThrow('owner_mismatch');
    data.datasets[0].items[0].ownerUsername = 'example'; data.datasets[0].items[0].shortCode = 'abc123'; expect(() => buildPostMediaPlan(data)).toThrow('shortcode_mismatch');
    data.datasets[0].items[0].shortCode = 'AbC123'; data.datasets[0].items[0].inputUrl = 'https://www.instagram.com/p/Foreign/'; expect(() => buildPostMediaPlan(data)).toThrow('input_source_mismatch');
  });

  it('does not label a thumbnail-only video playable, and retains media when extraction is absent', () => {
    const data = input(); delete data.datasets[0].items[0].media[0].videoVariants;
    const next = buildPostMediaPlan(data).archivePatches[0].record;
    expect(next.media).toBeUndefined(); expect(next.image).toContain('example.jpg');
    expect(next.contentKind).toBe('metadata_only'); expect(next.coverage).toContain('playable media URL unavailable');
    const complete = buildPostMediaPlan(input()).archivePatches[0].record;
    data.archiveRows[0].record = complete; data.datasets[0].items[0].media = [];
    expect(buildPostMediaPlan(data).archivePatches).toEqual([]);
  });

  it('rejects partial refreshes before losing an existing carousel attachment', () => {
    const data = input();
    data.archiveRows[0].record.media = [{ type: 'image', url: 'https://pbs.twimg.com/media/first.jpg' }, { type: 'image', url: 'https://pbs.twimg.com/media/second.jpg' }];
    expect(() => buildPostMediaPlan(data)).toThrow('would_drop_attachments');
  });

  it.each([
    (data: Data) => { data.datasets[0].items[0].demo = true; },
    (data: Data) => { data.datasets[0].items[0].error = 'provider_failure'; },
    (data: Data) => { data.datasets[0].items[0].id = '1940000000000000002'; },
    (data: Data) => { data.datasets[0].items[0].id = 1940000000000000001; },
    (data: Data) => { data.datasets[0].items[0].author.username = 'foreign'; },
    (data: Data) => { data.datasets[0].items[0].author.url = 'https://x.com/foreign'; },
    (data: Data) => { data.datasets[0].items[0].twitterUrl = 'https://x.com/example/status/1940000000000000002'; },
    (data: Data) => { data.datasets[0].items[0].sourceId = 'foreign-source'; },
    (data: Data) => { data.datasets[0].items[0].url += '?token=private'; },
    (data: Data) => { data.workspace.state.customSources[0].url = 'https://x.com/foreign'; },
    (data: Data) => { data.archiveRows[0].record.publishedAt = '2026-10-02T12:00:00Z'; },
    (data: Data) => { data.archiveRows[0].user_id = 'user_different'; },
  ])('refuses unverified or contradictory social evidence (%#)', mutate => { const data = input(); mutate(data); expect(() => buildPostMediaPlan(data)).toThrow(); });

  it('deduplicates identical raw rows but rejects conflicting raw rows and ambiguous archive/source identities', () => {
    const data = input(); data.datasets[0].items.push(structuredClone(data.datasets[0].items[0]));
    expect(buildPostMediaPlan(data).stats).toMatchObject({ matchedRows: 1, duplicateRawRows: 1 });
    data.datasets[0].items[1].text = 'Conflicting content'; expect(() => buildPostMediaPlan(data)).toThrow('conflicting_duplicate');
    const duplicate = input(); duplicate.archiveRows.push({ ...duplicate.archiveRows[0], id: 'another-existing', record: { ...duplicate.archiveRows[0].record, id: 'another-existing' } });
    expect(() => buildPostMediaPlan(duplicate)).toThrow('duplicate_existing_social_original_url');
    const sources = input(); sources.sources.push({ ...source, id: 'another-source' }); expect(() => buildPostMediaPlan(sources)).toThrow('duplicate_manifest_social_identity');
    const workspace = input(); workspace.workspace.state.customSources.push(structuredClone(workspace.workspace.state.customSources[0])); expect(() => buildPostMediaPlan(workspace)).toThrow('duplicate_workspace_source');
  });
});

describe('complete guarded SQL transaction', () => {
  it('locks full workspace JSON/revision first and all deterministic archive records before the first update', () => {
    const data = input(), second = { ...rawPost(), id: '1940000000000000002', url: 'https://x.com/example/status/1940000000000000002' };
    data.datasets[0].items.push(second); data.archiveRows.push({ user_id: owner, id: 'aaa-existing', source_id: source.id, record: record(second, 'aaa-existing') });
    const plan = buildPostMediaPlan(data), sql = buildPostMediaSql(plan);
    expect(plan.archivePatches.map((patch: Data) => patch.id)).toEqual(['aaa-existing', 'existing-post']);
    plan.archivePatches.reverse(); expect(buildPostMediaSql(plan)).toBe(sql);
    expect(sql.startsWith('begin;\n')).toBe(true); expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain('zlfdqzabsfndifxiqguo');
    expect(sql).toContain("updated_at=(payload#>>'{workspace,before,updated_at}')::timestamptz and state=payload#>'{workspace,before,state}'");
    expect(sql).toContain("record=item->'beforeRecord'"); expect(sql).toContain('collate "C"');
    expect(sql.indexOf('from public.reader_workspaces')).toBeLessThan(sql.indexOf('from public.reader_source_updates'));
    expect(sql.indexOf("raise exception 'stale_post_media_archive_plan'")).toBeLessThan(sql.indexOf('update public.reader_source_updates'));
    expect(sql).toContain('if affected<>1'); expect(sql).not.toMatch(/\b(?:insert|upsert|delete from|create table|create function)\b/i);
    expect(sql).not.toContain('update public.reader_workspaces');
  });

  it('rejects bad before/after hashes, changedFields, foreign fields, workspace edits and duplicate patches', () => {
    const mutations = [
      (plan: Data) => { plan.archivePatches[0].beforeHash = 'bad'; },
      (plan: Data) => { plan.archivePatches[0].record.title = 'Tampered'; },
      (plan: Data) => { plan.archivePatches[0].changedFields = ['media']; },
      (plan: Data) => { plan.archivePatches[0].record.insights = []; rehash(plan.archivePatches[0]); },
      (plan: Data) => { plan.archivePatches[0].record.publishedAt = '2026-01-01T00:00:00Z'; rehash(plan.archivePatches[0]); },
      (plan: Data) => { plan.workspace.state.savedUpdateIds = []; plan.workspace.afterHash = hash(plan.workspace.state); },
      (plan: Data) => { plan.archivePatches.push(structuredClone(plan.archivePatches[0])); },
      (plan: Data) => { plan.archivePatches[0].platform = 'YouTube'; },
      (plan: Data) => { plan.archivePatches[0].record.media[0].url = 'https://127.0.0.1/private.mp4'; rehash(plan.archivePatches[0]); },
    ];
    for (const mutate of mutations) { const plan = buildPostMediaPlan(input()); mutate(plan); expect(() => buildPostMediaSql(plan)).toThrow(); }
  });

  it('rechecks the no-attachment-loss invariant even with consistent tampered hashes', () => {
    const plan = buildPostMediaPlan(input()), patch = plan.archivePatches[0];
    patch.beforeRecord.media = [{ type: 'image', url: 'https://pbs.twimg.com/media/first.jpg' }, { type: 'image', url: 'https://pbs.twimg.com/media/second.jpg' }];
    patch.beforeHash = hash(patch.beforeRecord); rehash(patch);
    expect(() => buildPostMediaSql(plan)).toThrow('would_drop_attachments');
  });

  it('escapes SQL text/dollar delimiters and refuses unsupported NUL/unpaired-surrogate JSON', () => {
    const data = input(); data.workspace.state.note = "Editor's \\ literal $recap_post_media$ text";
    const sql = buildPostMediaSql(buildPostMediaPlan(data));
    expect(sql).toContain("Editor''s"); expect(sql).toContain('set local standard_conforming_strings=on');
    expect(sql).toMatch(/do \$recap_post_media_[a-f0-9]+\$/);
    for (const invalid of ['\u0000', '\uD83D']) { const broken = input(); broken.workspace.state.note = invalid; expect(() => buildPostMediaPlan(broken)).toThrow('unsupported_private_json'); }
  });
});
