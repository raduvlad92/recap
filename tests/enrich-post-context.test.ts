import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Offline ESM planner intentionally has no TS declaration.
import { buildPostContextPlan, buildPostContextSql, buildPostMediaSql } from '../scripts/enrich-post-media.mjs';

type Data = Record<string, any>;
const userId = 'user_syntheticowner', parentId = '1940000000000000001', childId = '1940000000000000003';
const date = '2026-10-01T12:00:00.000Z';
const source = { id: 'synthetic-child-source', name: 'Synthetic child', platform: 'X', url: 'https://x.com/example' };
const parentSource = { id: 'synthetic-parent-source', name: 'Synthetic parent', platform: 'X', url: 'https://x.com/original' };
const raw = () => ({ id: childId, author: { userName: 'example' }, url: 'https://x.com/example/status/' + childId, date, text: '@original Reply.', isReply: true, inReplyToId: parentId, inReplyToUsername: 'original' });
const record = (patch: Data = {}): Data => ({ id: 'existing-child', sourceId: source.id, url: raw().url, publishedAt: date, format: 'post', isSample: false, title: 'Editorial title', summary: 'Editorial summary', content: 'Existing child content.', contentKind: 'feed_text', topics: ['Keep topic'], brands: [], sponsors: [], insights: ['Keep insight'], contributorIds: [], references: [{ title: 'Original update', url: raw().url }], ...patch });
function input(): Data {
  const child = record(), parent = record({ id: 'existing-parent', sourceId: parentSource.id, url: 'https://x.com/original/status/' + parentId, content: 'Archived parent authored text.' });
  return { now: '2026-10-24T00:00:00.000Z', sources: [source, parentSource], archiveRows: [child, parent].map(record => ({ user_id: userId, id: record.id, source_id: record.sourceId, record })), datasets: [{ sourceId: source.id, providerRunId: 'existing-provider-run', items: [raw()] }], workspace: { user_id: userId, updated_at: '2026-10-23T00:00:00.000Z', state: { version: 1, customSources: [source, parentSource], followedSourceIds: [source.id, parentSource.id], importedUpdates: [], savedUpdateIds: ['existing-child'], settings: { interests: ['Keep interest'] } } } };
}
const stable = (value: any): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = (value: any) => createHash('sha256').update(stable(value)).digest('hex');

describe('context-only archived post enrichment', () => {
  it('requires explicit context-only scope at the context SQL entry point', () => {
    const plan = buildPostContextPlan(input());
    expect(buildPostContextSql(plan)).toContain('stale_post_context_parent_plan');
    const unscoped = structuredClone(plan); delete unscoped.scope;
    expect(() => buildPostContextSql(unscoped)).toThrow('post_context_scope_required');
    expect(() => buildPostContextSql({ ...plan, scope: 'post-media' })).toThrow('post_context_scope_required');
  });
  it('copies only explicit immediate-parent context, with unchanged records/workspace and zero network calls', () => {
    const data = input(), before = structuredClone(data), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      const plan = buildPostContextPlan(data), patch = plan.archivePatches[0];
      expect(plan.scope).toBe('post-context');
      expect(patch.changedFields).toEqual(['postContext']);
      expect(patch.record.postContext.reply).toMatchObject({ status: 'available', postId: parentId, text: 'Archived parent authored text.', provenance: 'archive' });
      const { postContext, ...unchanged } = patch.record;
      expect(unchanged).toEqual(before.archiveRows[0].record);
      expect(plan.contextDependencies).toEqual([{ id: 'existing-parent', sourceId: parentSource.id, beforeHash: hash(before.archiveRows[1].record), beforeRecord: before.archiveRows[1].record }]);
      expect(data).toEqual(before); expect(plan.workspace.state).toEqual(before.workspace.state); expect(fetch).not.toHaveBeenCalled();
      data.archiveRows[0].record = patch.record;
      expect(buildPostContextPlan(data).archivePatches).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps the reply labeled unavailable when the immediate parent is not archived', () => {
    const data = input(); data.archiveRows = [data.archiveRows[0]];
    const plan = buildPostContextPlan(data);
    expect(plan.archivePatches[0].record.postContext.reply).toMatchObject({ status: 'unavailable', postId: parentId });
    expect(plan.contextDependencies).toEqual([]);
    expect(buildPostMediaSql(plan)).toContain('stale_post_media_archive_plan');
  });
  it('does not use the conversation root or a leading mention as evidence', () => {
    const data = input(); data.datasets[0].items[0] = { ...raw(), isReply: false, inReplyToId: undefined, inReplyToUsername: undefined, conversationId: parentId };
    delete data.datasets[0].items[0].inReplyToId; delete data.datasets[0].items[0].inReplyToUsername;
    expect(buildPostContextPlan(data).archivePatches).toEqual([]);
  });
  it('locks and compares the copied parent snapshot before updating the child, so stale/deleted originals abort', () => {
    const plan = buildPostContextPlan(input()), sql = buildPostMediaSql(plan);
    expect(sql).toContain('stale_post_context_parent_plan');
    expect(sql.indexOf("payload->'contextDependencies'")).toBeLessThan(sql.indexOf('update public.reader_source_updates set'));
    expect(sql).toContain("record=item->'beforeRecord' for update");
    expect(sql).toContain('Archived parent authored text.');
    const missing = structuredClone(plan); missing.contextDependencies = [];
    expect(() => buildPostMediaSql(missing)).toThrow('post_context_parent_dependency_required');
    const tampered = structuredClone(plan); tampered.contextDependencies[0].beforeRecord.content = 'Changed original';
    expect(() => buildPostMediaSql(tampered)).toThrow('invalid_post_context_dependency');
  });
  it('enforces context-only scope even if a plan is recomputed after a forbidden text change', () => {
    const plan = buildPostContextPlan(input()), patch = plan.archivePatches[0];
    patch.record.summary = 'Unexpected replacement'; patch.afterHash = hash(patch.record); patch.changedFields = ['postContext', 'summary'];
    expect(() => buildPostMediaSql(plan)).toThrow('post_context_plan_must_preserve_other_fields');
  });
  it('refuses cross-owner archives, foreign raw identity and existing conflicting reply identity', () => {
    const mixed = input(); mixed.archiveRows[1].user_id = 'user_foreign';
    expect(() => buildPostContextPlan(mixed)).toThrow('ambiguous_archive_owner');
    const foreign = input(); foreign.datasets[0].items[0].author.userName = 'foreign';
    expect(() => buildPostContextPlan(foreign)).toThrow('saved_x_author_mismatch');
    const conflict = input(); conflict.archiveRows[0].record.postContext = { reply: { status: 'unavailable', postId: '1940000000000000002', url: 'https://x.com/original/status/1940000000000000002', authorHandle: 'original' } };
    expect(() => buildPostContextPlan(conflict)).toThrow('conflicting_existing_post_context');
  });
  it('preserves both quote and reply and does not replace a reviewed original with different provider text', () => {
    const data = input(), quotedId = '1940000000000000002';
    data.datasets[0].items[0].quotedTweetId = quotedId;
    data.datasets[0].items[0].quotedTweet = { id: quotedId, url: 'https://x.com/quoted/status/' + quotedId, author: { userName: 'quoted' }, text: 'Quoted authored text.' };
    const plan = buildPostContextPlan(data), context = plan.archivePatches[0].record.postContext;
    expect(context.reply.postId).toBe(parentId); expect(context.quote.postId).toBe(quotedId); expect(context.quote.text).toBe('Quoted authored text.');
    data.archiveRows[0].record = plan.archivePatches[0].record;
    data.datasets[0].items[0].quotedTweet.text = 'Different revised text.';
    expect(() => buildPostContextPlan(data)).toThrow('conflicting_existing_post_context_text');
  });
  it('accepts later provider media enrichment over a previously copied archived original', () => {
    const data = input(), first = buildPostContextPlan(data);
    data.archiveRows[0].record = first.archivePatches[0].record;
    data.datasets[0].items[0].inReplyToStatus = { id: parentId, url: data.archiveRows[1].record.url, author: { userName: 'original' }, text: data.archiveRows[1].record.content, media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/new.jpg' }] };
    const second = buildPostContextPlan(data);
    expect(second.archivePatches[0].record.postContext.reply.media).toHaveLength(1);
    expect(() => buildPostContextSql(second)).not.toThrow();
  });
  it('reconstructs mixed context from provider evidence and exactly its stated parent snapshots', () => {
    const data = input();
    data.datasets[0].items[0].inReplyToStatus = { id: parentId, url: data.archiveRows[1].record.url, author: { userName: 'original' }, text: '', media: [{ type: 'photo', mediaUrl: 'https://pbs.twimg.com/media/provider.jpg' }] };
    const plan = buildPostContextPlan(data), patch = plan.archivePatches[0];
    expect(patch.contextEvidence.providerContext.reply.text).toBeUndefined();
    expect(patch.record.postContext.reply).toMatchObject({ provenance: 'archive', text: 'Archived parent authored text.' });
    expect(patch.contextEvidence.dependencyIds).toEqual(['existing-parent']);
    expect(() => buildPostContextSql(plan)).not.toThrow();
    const missing = structuredClone(plan); missing.contextDependencies = []; missing.archivePatches[0].contextEvidence.dependencyIds = [];
    expect(() => buildPostContextSql(missing)).toThrow('post_context_evidence_mismatch');
    const relabeled = structuredClone(plan); relabeled.archivePatches[0].record.postContext.reply.provenance = 'provider'; relabeled.archivePatches[0].afterHash = hash(relabeled.archivePatches[0].record);
    expect(() => buildPostContextSql(relabeled)).toThrow('post_context_evidence_mismatch');
    const forged = structuredClone(plan); forged.archivePatches[0].record.postContext.reply.text = 'Unproven original'; forged.archivePatches[0].afterHash = hash(forged.archivePatches[0].record);
    expect(() => buildPostContextSql(forged)).toThrow('post_context_evidence_mismatch');
  });
});
