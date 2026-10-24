import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Offline ESM planner intentionally has no TS declaration.
import { assertVideoClassificationSnapshot, buildVideoClassificationPlan, buildVideoClassificationSql, loadClassificationEvidence, main } from '../scripts/enrich-video-classification.mjs';

type Data = Record<string, any>;
const owner = 'user_syntheticowner', sourceId = 'synthetic-youtube', videoId = 'AbCdEf12345';
const now = '2026-10-24T12:00:00.000Z', capturedAt = '2026-10-24T10:00:00.000Z';
const source = { id: sourceId, platform: 'YouTube', name: 'Synthetic source', url: 'https://www.youtube.com/@synthetic' };
const originalUrl = 'https://www.youtube.com/watch?v=' + videoId;
const stable = (value: any): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = (value: any) => createHash('sha256').update(stable(value)).digest('hex');
const bytesHash = (value: string) => createHash('sha256').update(value).digest('hex');
const artifactItem = { id: videoId, url: originalUrl, channelUrl: source.url, isShort: false };
const artifact = JSON.stringify({ items: [artifactItem] });

function record(patch: Data = {}): Data {
  return { id: 'existing-video', sourceId, format: 'video', isSample: false, publishedAt: '2026-10-23T12:00:00.000Z', url: originalUrl, title: 'Keep original title #shorts', summary: 'Keep summary', content: "Creator's original captions \\ with $recap_video_classification$ and €.", contentKind: 'transcript', duration: 20, media: [{ type: 'video', url: 'https://example.com/video.mp4' }], transcriptSegments: [{ startSeconds: 0, text: 'Original captions.' }], videoSummary: { status: 'ready', ruleVersion: 'takeaways-v1' }, videoHighlights: [{ text: 'Reviewed finding' }], videoKeywords: [{ label: 'Keep brand', kind: 'brand' }], processing: { ruleVersion: 'content-v1', content: 'ready', recap: 'ready' }, postContext: { reply: { status: 'unavailable' } }, topics: ['Keep topic'], brands: ['Keep brand'], sponsors: ['Keep sponsor'], references: [{ title: 'Original', url: originalUrl }], contributorIds: [], ...patch };
}

function evidence(patch: Data = {}): Data {
  return { updateId: 'existing-video', sourceId, sourceUrl: source.url, originalUrl, videoId, validated: true, classification: { kind: 'regular', basis: 'provider' }, provenance: { validator: 'video-format-v1', artifactPath: 'captured.json', artifactSha256: bytesHash(artifact), itemPointer: '/items/0', itemSha256: hash(artifactItem), capturedAt, provider: 'apify', providerRunId: 'saved-synthetic-run', datasetId: 'saved-synthetic-dataset' }, ...patch };
}

function input(): Data {
  const saved = record();
  return { now, archiveRows: [{ user_id: owner, id: saved.id, source_id: sourceId, collection_id: 'tech', published_at: saved.publishedAt, collected_at: '2026-10-23T13:00:00.123456Z', record: saved }], workspace: { user_id: owner, updated_at: '2026-10-23T00:00:00.123456Z', state: { version: 1, customSources: [structuredClone(source)], followedSourceIds: [sourceId], importedUpdates: [], savedUpdateIds: [saved.id], sourcePreferences: { [sourceId]: { showShorts: false } }, settings: { interests: ['Keep interest'], language: 'en' } } }, evidence: [evidence()] };
}

function freeze(value: any): any {
  if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
  return value;
}

const temporary: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'recap-classification-')); temporary.push(path); return path; }
async function savedEvidence(root: string, entries = [evidence()], text = artifact) {
  await writeFile(join(root, 'captured.json'), text);
  await writeFile(join(root, 'evidence.json'), JSON.stringify(entries));
  return join(root, 'evidence.json');
}

describe('offline guarded video classification plan', () => {
  it('changes only classification, with exact originals, context, annotations and workspace retained', () => {
    const data = input(), before = structuredClone(data), fetch = vi.fn(() => { throw new Error('Network forbidden'); }); vi.stubGlobal('fetch', fetch);
    const plan = buildVideoClassificationPlan(freeze(data)), patch = plan.archivePatches[0];
    expect(plan).toMatchObject({ version: 1, scope: 'video-classification', targetProject: 'zlfdqzabsfndifxiqguo', userId: owner, stats: { matchedRows: 1, regularRows: 1, archiveRowsToPatch: 1 } });
    expect(patch.changedFields).toEqual(['isShort', 'videoFormat']);
    expect(patch.record.videoFormat).toEqual({ kind: 'regular', basis: 'provider', checkedAt: capturedAt });
    expect(patch.record.isShort).toBe(false);
    const { videoFormat, isShort, ...originals } = patch.record;
    expect(originals).toEqual(before.archiveRows[0].record);
    expect(patch.beforeRow).toEqual(before.archiveRows[0]); expect(patch.beforeRecord).toEqual(before.archiveRows[0].record);
    expect(patch.beforeHash).toBe(hash(before.archiveRows[0].record)); expect(patch.afterHash).toBe(hash(patch.record));
    expect(patch.originalUrl).toBe(originalUrl); expect(patch.classificationEvidence).toEqual(before.evidence[0]);
    expect(plan.workspace.before).toEqual(before.workspace); expect(plan.workspace.state).toEqual(before.workspace.state);
    expect(data).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('is idempotent, does not churn checkedAt and returns detached patch copies', () => {
    const data = input(), first = buildVideoClassificationPlan(data);
    data.archiveRows[0].record = structuredClone(first.archivePatches[0].record);
    data.evidence[0].classification.checkedAt = now;
    expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
    first.archivePatches[0].record.content = 'Plan copy changed';
    expect(data.archiveRows[0].record.content).toBe(record().content);
  });

  it.each([
    ['regular', 'provider'], ['regular', 'watch_page'],
    ['short', 'provider'], ['short', 'watch_page'], ['short', 'canonical_url'],
  ])('upgrades same-kind legacy %s to checked %s once without changing originals', (kind, basis) => {
    const data = input();
    data.archiveRows[0].record.isShort = kind === 'short';
    data.archiveRows[0].record.videoFormat = { kind, basis: 'legacy', checkedAt: '2026-10-23T12:00:00.000Z' };
    data.evidence[0].classification = { kind, basis };
    if (basis === 'canonical_url') data.evidence[0].originalUrl = 'https://youtube.com/shorts/' + videoId;
    const before = structuredClone(data), plan = buildVideoClassificationPlan(freeze(structuredClone(data)));
    expect(plan.archivePatches).toHaveLength(1);
    const patch = plan.archivePatches[0];
    expect(patch.changedFields).toEqual(['videoFormat']);
    expect(patch.record).toEqual({ ...before.archiveRows[0].record, videoFormat: { kind, basis, checkedAt: capturedAt } });
    expect(patch.beforeRow).toEqual(before.archiveRows[0]);
    expect(patch.classificationEvidence).toEqual(before.evidence[0]);
    expect(plan.workspace.before).toEqual(before.workspace); expect(plan.workspace.state).toEqual(before.workspace.state);
    expect(data).toEqual(before); expect(() => buildVideoClassificationSql(plan)).not.toThrow();
    data.archiveRows[0].record = structuredClone(patch.record);
    const checked = structuredClone(data.archiveRows[0].record);
    expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
    data.evidence[0].classification.checkedAt = now;
    expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
    expect(data.archiveRows[0].record).toEqual(checked);
  });

  it.each([
    ['regular', 'provider', 'watch_page'], ['regular', 'watch_page', 'provider'],
    ['short', 'provider', 'canonical_url'], ['short', 'canonical_url', 'watch_page'], ['short', 'watch_page', 'provider'],
  ])('retains checked %s/%s against same-kind %s or unknown proof', (kind, basis, incomingBasis) => {
    const data = input();
    data.archiveRows[0].record.isShort = kind === 'short';
    data.archiveRows[0].record.videoFormat = { kind, basis, checkedAt: capturedAt };
    const before = structuredClone(data.archiveRows[0].record);
    for (const classification of [{ kind, basis: incomingBasis, checkedAt: now }, { kind: 'unknown', basis: 'watch_page', checkedAt: now }]) {
      data.evidence[0] = evidence({ classification });
      if (classification.basis === 'canonical_url') data.evidence[0].originalUrl = 'https://youtube.com/shorts/' + videoId;
      expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
      expect(data.archiveRows[0].record).toEqual(before);
    }
  });

  it('rejects weak legacy evidence without changing a checked classification', () => {
    const data = input();
    data.archiveRows[0].record.videoFormat = { kind: 'regular', basis: 'provider', checkedAt: capturedAt };
    data.evidence[0].classification = { kind: 'regular', basis: 'legacy', checkedAt: now };
    const before = structuredClone(data);
    expect(() => buildVideoClassificationPlan(data)).toThrow('invalid_supplied_video_classification');
    expect(data).toEqual(before);
  });

  it('does not classify by duration, title hashtags, descriptions or an ordinary watch URL', () => {
    const data = input(); data.evidence = [];
    expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
    data.evidence = [evidence({ classification: { kind: 'unknown', basis: 'watch_page' } })];
    const patch = buildVideoClassificationPlan(data).archivePatches[0];
    expect(patch.changedFields).toEqual(['videoFormat']); expect(patch.record.isShort).toBeUndefined();
    expect(patch.record.videoFormat.kind).toBe('unknown');
  });

  it('accepts explicit provider Shorts or a validated canonical Shorts original, preserving saved URLs', () => {
    for (const basis of ['provider', 'canonical_url']) {
      const data = input(); data.evidence[0].classification = { kind: 'short', basis };
      if (basis === 'canonical_url') data.evidence[0].originalUrl = 'https://youtube.com/shorts/' + videoId;
      const patch = buildVideoClassificationPlan(data).archivePatches[0];
      expect(patch.record).toMatchObject({ url: originalUrl, isShort: true, videoFormat: { kind: 'short', basis } });
    }
  });

  it.each([{ isShort: true }, { videoFormat: { kind: 'short', basis: 'legacy' } }, { videoFormat: { kind: 'regular', basis: 'provider', checkedAt: capturedAt } }])('never downgrades established format to unknown (%j)', previous => {
    const data = input(); Object.assign(data.archiveRows[0].record, previous);
    data.evidence[0].classification = { kind: 'unknown', basis: 'watch_page' };
    const plan = buildVideoClassificationPlan(data);
    expect(plan.archivePatches).toEqual([]); expect(plan.stats.preservedKnownRows).toBe(1);
  });

  it.each([false, true])('repairs weak legacy false with checked unknown, preserving its old flag (legacy marker %s)', marker => {
    const data = input(); data.archiveRows[0].record.isShort = false;
    if (marker) data.archiveRows[0].record.videoFormat = { kind: 'regular', basis: 'legacy' };
    data.evidence[0].classification = { kind: 'unknown', basis: 'watch_page' };
    const plan = buildVideoClassificationPlan(data), patch = plan.archivePatches[0];
    expect(patch.changedFields).toEqual(['videoFormat']);
    expect(patch.record.videoFormat).toEqual({ kind: 'unknown', basis: 'watch_page', checkedAt: capturedAt });
    expect(patch.record.isShort).toBe(false); expect(plan.stats.unknownRows).toBe(1);
  });

  it.each([[false, 'watch_page'], [true, 'watch_page'], [false, 'canonical_url'], [true, 'canonical_url']])('allows checked Shorts to override weak legacy false (marker %s, basis %s)', (marker, basis) => {
    const data = input(); data.archiveRows[0].record.isShort = false;
    if (marker) data.archiveRows[0].record.videoFormat = { kind: 'regular', basis: 'legacy' };
    data.evidence[0].classification = { kind: 'short', basis };
    if (basis === 'canonical_url') data.evidence[0].originalUrl = 'https://youtube.com/shorts/' + videoId;
    const plan = buildVideoClassificationPlan(data), patch = plan.archivePatches[0];
    expect(patch.record.videoFormat).toEqual({ kind: 'short', basis, checkedAt: capturedAt });
    expect(patch.record.isShort).toBe(true); expect(patch.record.url).toBe(originalUrl);
    expect(() => buildVideoClassificationSql(plan)).not.toThrow();
    data.archiveRows[0].record = patch.record;
    expect(buildVideoClassificationPlan(data).archivePatches).toEqual([]);
  });

  it.each([{ isShort: true }, { videoFormat: { kind: 'short', basis: 'provider' } }, { url: 'https://youtube.com/shorts/' + videoId }])('rejects regular evidence that conflicts with existing positive Shorts evidence (%j)', previous => {
    const data = input(); Object.assign(data.archiveRows[0].record, previous);
    expect(() => buildVideoClassificationPlan(data)).toThrow(/conflicts_with/);
  });

  it('refuses contradictory legacy/structured classification instead of clearing evidence', () => {
    const data = input(); data.archiveRows[0].record.isShort = true; data.archiveRows[0].record.videoFormat = { kind: 'regular', basis: 'provider' };
    expect(() => buildVideoClassificationPlan(data)).toThrow('conflicting_existing_video_classification');
    data.archiveRows[0].record.videoFormat = { kind: 'short', basis: 'invented' };
    expect(() => buildVideoClassificationPlan(data)).toThrow('invalid_existing_video_classification');
  });

  it.each([true, false])('keeps explicit unknown with a preserved raw flag (%s) unknown, without promoting regular', flag => {
    const data = input(); data.archiveRows[0].record.isShort = flag;
    data.archiveRows[0].record.videoFormat = { kind: 'unknown', basis: 'provider', checkedAt: capturedAt };
    expect(() => buildVideoClassificationPlan(data)).toThrow('classification_conflicts_with_existing_evidence');
    data.evidence[0].classification = { kind: 'unknown', basis: 'provider' };
    const plan = buildVideoClassificationPlan(data);
    expect(plan.archivePatches).toEqual([]); expect(plan.stats.unknownRows).toBe(1); expect(plan.stats.regularRows).toBe(0);
    expect(data.archiveRows[0].record.isShort).toBe(flag);
  });

  it.each([
    ['mixed owner', (data: Data) => data.archiveRows.push({ ...data.archiveRows[0], user_id: 'user_other' }), 'ambiguous_archive_owner'],
    ['workspace owner', (data: Data) => data.workspace.user_id = 'user_other', 'matching_existing_owner_workspace'],
    ['duplicate row', (data: Data) => data.archiveRows.push(structuredClone(data.archiveRows[0])), 'invalid_or_duplicate_existing_archive_row'],
    ['record ID', (data: Data) => data.archiveRows[0].record.id = 'changed-id', 'invalid_or_duplicate_existing_archive_row'],
    ['record source', (data: Data) => data.archiveRows[0].record.sourceId = 'wrong-source', 'invalid_or_duplicate_existing_archive_row'],
    ['sample', (data: Data) => data.archiveRows[0].record.isSample = true, 'invalid_or_duplicate_existing_archive_row'],
    ['duplicate source', (data: Data) => data.workspace.state.customSources.push(source), 'invalid_or_duplicate_workspace_source'],
    ['missing target', (data: Data) => data.evidence[0].updateId = 'missing-id', 'classification_requires_existing_youtube_record'],
    ['wrong platform', (data: Data) => data.workspace.state.customSources[0].platform = 'X', 'classification_requires_existing_youtube_record'],
    ['wrong source URL', (data: Data) => data.evidence[0].sourceUrl = 'https://youtube.com/@another', 'validated_classification_identity'],
    ['unvalidated', (data: Data) => data.evidence[0].validated = false, 'validated_classification_identity'],
    ['ambiguous alias', (data: Data) => data.evidence[0].source_id = 'different', 'validated_classification_identity'],
    ['duplicate evidence', (data: Data) => data.evidence.push(structuredClone(data.evidence[0])), 'invalid_or_duplicate_classification_evidence'],
    ['case-sensitive video', (data: Data) => data.evidence[0].videoId = videoId.toLowerCase(), 'classification_video_identity_mismatch'],
    ['foreign original', (data: Data) => data.evidence[0].originalUrl = 'https://youtu.be/ZyXwVu98765', 'classification_video_identity_mismatch'],
    ['spoofed host', (data: Data) => data.evidence[0].originalUrl = 'https://youtube.com.evil.example/watch?v=' + videoId, 'invalid_video_original_url'],
    ['duplicate query ID', (data: Data) => data.evidence[0].originalUrl += '&v=' + videoId, 'invalid_video_original_url'],
    ['URL credentials', (data: Data) => data.evidence[0].originalUrl = 'https://secret@youtube.com/watch?v=' + videoId, 'invalid_video_original_url'],
    ['bad provenance', (data: Data) => delete data.evidence[0].provenance.validator, 'classification_artifact_provenance'],
    ['missing run', (data: Data) => delete data.evidence[0].provenance.providerRunId, 'classification_provider_run'],
    ['missing item', (data: Data) => delete data.evidence[0].provenance.itemSha256, 'classification_artifact_item_binding'],
    ['missing pointer', (data: Data) => delete data.evidence[0].provenance.itemPointer, 'classification_artifact_item_binding'],
    ['guessed classification', (data: Data) => data.evidence[0].classification = { kind: 'short', basis: 'duration' }, 'invalid_supplied_video_classification'],
    ['watch URL as regular proof', (data: Data) => data.evidence[0].classification.basis = 'canonical_url', 'canonical_url_requires_explicit_shorts_original'],
    ['checked before capture', (data: Data) => data.evidence[0].classification.checkedAt = '2026-10-23T00:00:00Z', 'classification_artifact_provenance'],
    ['row publication', (data: Data) => data.archiveRows[0].published_at = now, 'invalid_existing_archive_row_metadata'],
  ])('rejects %s', (_name, mutate, code) => {
    const data = input(); (mutate as (data: Data) => void)(data);
    expect(() => buildVideoClassificationPlan(data)).toThrow(code as string);
  });

  it('rejects duplicate archive identities even when only one ID has supplied evidence', () => {
    const data = input(), second = structuredClone(data.archiveRows[0]); second.id = second.record.id = 'duplicate-video'; data.archiveRows.push(second);
    expect(() => buildVideoClassificationPlan(data)).toThrow('duplicate_existing_video_identity');
  });

  it.each(['\u0000', '\ud800'])('rejects unsupported private JSON without clipping captions (%j)', invalid => {
    const data = input(); data.archiveRows[0].record.content = invalid;
    expect(() => buildVideoClassificationPlan(data)).toThrow('unsupported_private_json');
  });

  it('measures multibyte record size and refuses a patch instead of deleting original content', () => {
    const data = input(); data.archiveRows[0].record.content = '€'.repeat(340_000);
    expect(() => buildVideoClassificationPlan(data)).toThrow('classified_archive_record_too_large');
    expect(data.archiveRows[0].record.content.length).toBe(340_000);
  });
});

describe('exact snapshot guards and classification-only SQL', () => {
  it('accepts reordered exports but rejects edits, additions, deletions and metadata-only revision changes', () => {
    const data = input(), unrelated = record({ id: 'unrelated', sourceId: 'social', format: 'post', url: 'https://example.com/post' });
    data.archiveRows.push({ user_id: owner, id: unrelated.id, source_id: unrelated.sourceId, record: unrelated });
    const plan = buildVideoClassificationPlan(data);
    expect(assertVideoClassificationSnapshot(plan, { ...data, archiveRows: [...data.archiveRows].reverse() })).toBe(true);
    for (const mutate of [
      (copy: Data) => copy.workspace.state.savedUpdateIds.push('another-save'),
      (copy: Data) => copy.workspace.updated_at = now,
      (copy: Data) => copy.archiveRows[0].record.videoKeywords.push({ label: 'New admin decision' }),
      (copy: Data) => copy.archiveRows[0].collected_at = now,
      (copy: Data) => copy.archiveRows.pop(),
      (copy: Data) => copy.archiveRows.push({ ...copy.archiveRows[1], id: 'another', record: { ...copy.archiveRows[1].record, id: 'another' } }),
    ]) {
      const copy = structuredClone(data); mutate(copy);
      expect(() => assertVideoClassificationSnapshot(plan, copy)).toThrow('stale_video_classification_snapshot');
    }
  });

  it('locks workspace and every target before writes with exact record equality and supplied row metadata', () => {
    const plan = buildVideoClassificationPlan(input()), sql = buildVideoClassificationSql(plan);
    expect(sql.startsWith('begin;\n')).toBe(true); expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain("updated_at=(payload#>>'{workspace,updated_at}')::timestamptz and state=payload#>'{workspace,state}'");
    expect(sql).toContain('2026-10-23T00:00:00.123456Z');
    expect(sql).toContain("archive.record=item->'beforeRecord'"); expect(sql).toContain("archive.source_id=item->>'sourceId'");
    expect(sql).toContain("archive.collection_id=item#>>'{beforeRow,collection_id}'");
    expect(sql).toContain("archive.published_at=(item#>>'{beforeRow,published_at}')::timestamptz");
    expect(sql).toContain("archive.collected_at=(item#>>'{beforeRow,collected_at}')::timestamptz");
    expect(sql).toContain('order by (value->>\'id\') collate "C"');
    expect(sql.indexOf("raise exception 'stale_video_classification_archive_plan'")).toBeLessThan(sql.indexOf('update public.reader_source_updates'));
    expect(sql).toContain('if affected<>1'); expect(sql).toContain('set local standard_conforming_strings=on');
    expect(sql).toContain("Creator''s original captions"); expect(sql).not.toContain('do $recap_video_classification$');
    expect(sql).not.toMatch(/\b(?:insert into|delete from|upsert|update public.reader_workspaces)\b/i);
    expect(sql).not.toMatch(/count\(\*\)/i);
  });

  it('sorts patch targets independently of input/evidence order and tolerates compact row exports', () => {
    const data = input(); delete data.archiveRows[0].collection_id; delete data.archiveRows[0].published_at; delete data.archiveRows[0].collected_at;
    const second = structuredClone(data.archiveRows[0]), secondEvidence = structuredClone(data.evidence[0]);
    second.id = second.record.id = 'aaa-video'; second.record.url = 'https://youtu.be/ZyXwVu98765'; secondEvidence.updateId = second.id; secondEvidence.originalUrl = second.record.url; secondEvidence.videoId = 'ZyXwVu98765';
    data.archiveRows.push(second); data.evidence.push(secondEvidence);
    const plan = buildVideoClassificationPlan(data);
    expect(plan.archivePatches.map((patch: Data) => patch.id)).toEqual(['aaa-video', 'existing-video']);
    expect(() => buildVideoClassificationSql(plan)).not.toThrow();
    expect(buildVideoClassificationPlan({ ...data, archiveRows: [...data.archiveRows].reverse() }).archivePatches).toEqual(plan.archivePatches);
  });

  it.each(['content', 'media', 'postContext', 'videoKeywords', 'videoSummary', 'processing', 'url'])('rejects a tampered %s even with recomputed afterHash and changedFields', field => {
    const plan = buildVideoClassificationPlan(input()), patch = plan.archivePatches[0];
    patch.record[field] = field === 'url' ? 'https://youtube.com/watch?v=ZyXwVu98765' : 'Unexpected replacement';
    patch.afterHash = hash(patch.record); patch.changedFields.push(field); patch.changedFields.sort();
    expect(() => buildVideoClassificationSql(plan)).toThrow('video_classification_plan_evidence_or_snapshot_mismatch');
  });

  it('reconstructs patches from supplied evidence and rejects tampering with scope, CAS, workspace or decision', () => {
    for (const mutate of [
      (plan: Data) => plan.scope = 'post-media',
      (plan: Data) => plan.archivePatches[0].beforeHash = '0'.repeat(64),
      (plan: Data) => plan.archivePatches[0].beforeRow.collected_at = now,
      (plan: Data) => plan.archivePatches[0].record.isShort = true,
      (plan: Data) => { plan.workspace.state.sourcePreferences[sourceId].showShorts = true; plan.workspace.afterHash = hash(plan.workspace.state); },
      (plan: Data) => plan.archivePatches[0].classificationEvidence.provenance.artifactSha256 = 'a'.repeat(64),
      (plan: Data) => plan.archivePatches = [],
    ]) {
      const plan = buildVideoClassificationPlan(input()); mutate(plan);
      expect(() => buildVideoClassificationSql(plan)).toThrow();
    }
  });
});

describe('private local artifact loading and CLI', () => {
  it('verifies raw file and canonical selected-item hashes independently', async () => {
    const root = await directory(), manifest = await savedEvidence(root);
    expect(await loadClassificationEvidence(manifest)).toEqual([evidence()]);
    await writeFile(join(root, 'captured.json'), artifact + '\n');
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_hash_mismatch');
    await writeFile(join(root, 'captured.json'), artifact);
    const wrong = evidence(); wrong.provenance.itemSha256 = 'a'.repeat(64);
    await writeFile(manifest, JSON.stringify([wrong]));
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_item_hash_mismatch');
    wrong.provenance.itemPointer = '/items/9'; await writeFile(manifest, JSON.stringify([wrong]));
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_item_missing');
  });

  it('supports whole captured watch HTML and RFC6901 escaped item selectors', async () => {
    const root = await directory(), html = '<html><meta property="og:url" content="' + originalUrl + '"></html>';
    const watch = evidence({ classification: { kind: 'unknown', basis: 'watch_page' } });
    delete watch.provenance.itemPointer; watch.provenance.artifactSha256 = watch.provenance.itemSha256 = bytesHash(html);
    const manifest = await savedEvidence(root, [watch], html);
    expect(await loadClassificationEvidence(manifest)).toEqual([watch]);
    const selected = evidence(), special = { 'saved/items': { '~item': artifactItem } }, text = JSON.stringify(special);
    selected.provenance.itemPointer = '/saved~1items/~0item'; selected.provenance.artifactSha256 = bytesHash(text);
    await savedEvidence(root, [selected], text);
    expect(await loadClassificationEvidence(manifest)).toEqual([selected]);
  });

  it.each(['length', '01', '-', '0.0'])('rejects non-index JSON Pointer array token %s', async token => {
    const root = await directory(), entry = evidence();
    entry.provenance.itemPointer = '/items/' + token; entry.provenance.itemSha256 = hash(1);
    const manifest = await savedEvidence(root, [entry]);
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_item_missing');
  });

  it('rejects a scalar item as provider content even with its matching canonical hash', async () => {
    const root = await directory(), entry = evidence(), text = JSON.stringify({ items: [42] });
    entry.provenance.itemSha256 = hash(42); entry.provenance.artifactSha256 = bytesHash(text);
    const manifest = await savedEvidence(root, [entry], text);
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_item_missing');
  });

  it('rejects missing captures, traversal and symlink escape', async () => {
    const root = await directory(), outside = await directory(), manifest = await savedEvidence(root);
    const entry = evidence(); entry.provenance.artifactPath = '../captured.json'; await writeFile(manifest, JSON.stringify([entry]));
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('invalid_classification_artifact_path');
    entry.provenance.artifactPath = 'absent.json'; await writeFile(manifest, JSON.stringify([entry]));
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_missing');
    await writeFile(join(outside, 'captured.json'), artifact); await symlink(join(outside, 'captured.json'), join(root, 'linked.json'));
    entry.provenance.artifactPath = 'linked.json'; await writeFile(manifest, JSON.stringify([entry]));
    await expect(loadClassificationEvidence(manifest)).rejects.toThrow('classification_artifact_outside_private_directory');
  });

  it('requires local inputs and rejects apply, duplicate, unknown and incomplete arguments', async () => {
    for (const args of [[], ['--snapshot', 'file'], ['--snapshot', '--evidence'], ['--live'], ['--apply'], ['--snapshot', 'one', '--snapshot', 'two']]) await expect(main(args)).rejects.toThrow();
  });

  it('writes only private review artifacts, never connects to a service, and refuses overwrites', async () => {
    const root = await directory(), data = input(); await mkdir(join(root, '.local'));
    await writeFile(join(root, '.local', 'snapshot.json'), JSON.stringify({ archiveRows: data.archiveRows, workspace: data.workspace }));
    await savedEvidence(join(root, '.local'));
    const fetch = vi.fn(() => { throw new Error('No network'); }); vi.stubGlobal('fetch', fetch);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const args = ['--root', root, '--snapshot', '.local/snapshot.json', '--evidence', '.local/evidence.json', '--output-dir', '.local/review'];
    const result = await main(args);
    expect(result).toMatchObject({ mode: 'offline-preview', databaseReads: 0, databaseWrites: 0, providerCalls: 0, archiveRowsToPatch: 1 });
    expect(fetch).not.toHaveBeenCalled();
    const logged = stdout.mock.calls.map(call => call[0]).join(''); expect(logged).not.toContain(owner); expect(logged).not.toContain(videoId); expect(logged).not.toContain(source.url);
    const plan = JSON.parse(await readFile(join(root, '.local', 'review', 'plan.json'), 'utf8'));
    expect(assertVideoClassificationSnapshot(plan, data)).toBe(true);
    expect(await readFile(join(root, '.local', 'review', 'classification.sql'), 'utf8')).toBe(buildVideoClassificationSql(plan));
    expect((await stat(join(root, '.local', 'review'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, '.local', 'review', 'plan.json'))).mode & 0o777).toBe(0o600);
    await expect(main(args)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(root, '.local', 'review', 'plan.json'), 'utf8'))).toEqual(plan);
  });

  it('refuses output outside .local or through a symlinked private directory', async () => {
    const root = await directory(), outside = await directory();
    const args = ['--root', root, '--snapshot', 'missing', '--evidence', 'missing', '--output-dir', 'public-review'];
    await expect(main(args)).rejects.toThrow('private_local_output_directory_required');
    await symlink(outside, join(root, '.local')); args[args.length - 1] = '.local/review';
    await expect(main(args)).rejects.toThrow('private_local_directory_must_not_be_symlink');
  });
});
