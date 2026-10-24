import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeCollection, sanitizeArchivedUpdate, updatesForSourcePreferences } from '../src/lib/domain';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import { mergeVideoFormatFields, videoFormatKind } from '../src/lib/video-format';
import type { Source } from '../src/lib/types';

// A fresh socket-only local PostgreSQL cluster. No .env, saved connection,
// existing database, provider or creator source is read or contacted.
const available = (() => { try { return /\b17\./.test(execFileSync('initdb', ['--version'], { encoding: 'utf8' })) && process.getuid?.() !== 0; } catch { return false; } })();
const migration = '20261024001118_video_classification_caption_enrichment.sql';
const literal = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const original = { id: 'original-id', sourceId: 'format-db-source', format: 'video', url: 'https://youtu.be/abcdefghijk', publishedAt: '2026-10-22T12:00:00Z', title: 'Original title', summary: 'Curated description', isSample: false, contentKind: 'metadata_only', image: 'https://example.org/original.jpg', postContext: { untouched: 'context' }, privateFutureAnnotation: { keep: true }, videoHighlights: [{ text: 'Curated note' }], videoKeywords: [{ label: 'Original', ranges: [] }] };
const incoming = { ...original, id: 'different-hourly-id', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Replacement must not win', videoFormat: { kind: 'regular', basis: 'watch_page' }, isShort: false };

describe.skipIf(!available)('classification/caption migration on disposable PostgreSQL', () => {
  let root: string, args: string[], started = false, sequence = 0;
  const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const merge = (before: unknown, after: unknown) => JSON.parse(sql(`select public.merge_hourly_video_enrichment(${literal(before)},${literal(after)});`));
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'recap-format-db-')); const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
    execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55493`, 'start'], { stdio: 'ignore' }); started = true;
    args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55493', '-U', 'postgres', '-d', 'postgres'];
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.jwt() to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to service_role;`);
    const directory = resolve('supabase/migrations');
    for (const file of readdirSync(directory).filter(file => file.endsWith('.sql') && (file <= '20261023000813_hourly_check_hour_alignment.sql' || file === migration)).sort()) sql(readFileSync(join(directory, file), 'utf8'));
  }, 20_000);
  afterAll(() => { if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); if (root) rmSync(root, { recursive: true, force: true }); });

  it('merges metadata-only classification while preserving every original and annotation', () => {
    expect(merge(original, incoming)).toEqual({ ...original, videoFormat: incoming.videoFormat, isShort: false });
    const enriched = merge(original, incoming);
    expect(merge(enriched, incoming)).toEqual(enriched);
  });
  it('never downgrades positive legacy, canonical or stored Shorts evidence', () => {
    for (const before of [{ ...original, isShort: true }, { ...original, url: 'https://youtube.com/shorts/abcdefghijk', isShort: false }, { ...original, videoFormat: { kind: 'short', basis: 'provider' } }]) {
      expect(merge(before, incoming)).toMatchObject({ isShort: true, videoFormat: { kind: 'short' } });
    }
    expect(merge({ ...original, isShort: false }, { ...incoming, isShort: undefined, videoFormat: { kind: 'unknown', basis: 'watch_page' } })).toMatchObject({ isShort: false, videoFormat: { kind: 'unknown' } });
  });
  it('lets checked unknown replace weak legacy false even when the raw flag remains preserved', () => {
    const after = { ...incoming, isShort: false, videoFormat: { kind: 'unknown', basis: 'watch_page' } };
    expect(merge({ ...original, isShort: false }, after)).toMatchObject({ isShort: false, videoFormat: { kind: 'unknown', basis: 'watch_page' } });
    expect(merge({ ...original, isShort: false, videoFormat: { kind: 'regular', basis: 'watch_page' } }, after)).toMatchObject({ isShort: false, videoFormat: { kind: 'regular', basis: 'watch_page' } });
  });
  it('does not restore weak legacy regular when incoming classification is absent, null or malformed', () => {
    const before = { ...original, isShort: false };
    for (const format of [undefined, null, { kind: ['regular'], basis: 'provider' }, { kind: 'regular', basis: ['provider'] }, { kind: 'regular', basis: { toString: null } }, { kind: { toString: null }, basis: 'provider' }]) {
      const after = { ...original, ...(format === undefined ? {} : { videoFormat: format }) };
      const record = merge(before, after), client = mergeVideoFormatFields(sanitizeArchivedUpdate(before)!, sanitizeArchivedUpdate(after)!);
      expect(record).toMatchObject({ isShort: false, videoFormat: { kind: 'unknown', basis: 'legacy' } });
      expect(record.videoFormat).toEqual(client.videoFormat);
      expect(videoFormatKind(record)).toBe('unknown');
    }
  });
  it('keeps historical false flags unknown until checked regular proof arrives', () => {
    for (const videoFormat of [undefined, { kind: 'regular', basis: 'legacy' }]) {
      const before = { ...original, isShort: false, ...(videoFormat ? { videoFormat } : {}) };
      expect(videoFormatKind(sanitizeArchivedUpdate(before)!)).toBe('unknown');
      const record = merge(before, { ...original, isShort: false });
      expect(record).toMatchObject({ isShort: false, videoFormat: { kind: 'unknown', basis: 'legacy' } });
      expect(merge(before, incoming)).toMatchObject({ isShort: false, videoFormat: { kind: 'regular', basis: 'watch_page' } });
      expect(merge(before, incoming).title).toBe(original.title);
    }
  });
  it('normalizes both unresolved conflict markers before choosing the fallback', () => {
    const before = { ...original, isShort: true, videoFormat: { kind: 'unknown', basis: 'watch_page' } };
    const after = { ...original, isShort: true, videoFormat: { kind: 'regular', basis: 'provider' } };
    const record = merge(before, after), client = mergeVideoFormatFields(sanitizeArchivedUpdate(before)!, sanitizeArchivedUpdate(after)!);
    expect(record).toMatchObject({ isShort: true, videoFormat: { kind: 'unknown', basis: 'provider' } });
    expect(record.videoFormat).toEqual(client.videoFormat);
    expect(videoFormatKind(record)).toBe('unknown');
  });
  it('preserves checked provenance and timestamps against same-kind legacy fallbacks', () => {
    for (const kind of ['short', 'regular', 'unknown'] as const) {
      const format = { kind, basis: 'watch_page' as const, checkedAt: '2026-10-24T00:00:00.000Z' };
      const before = { ...original, ...(kind !== 'unknown' ? { isShort: kind === 'short' } : {}), videoFormat: format };
      const after = { ...original, ...(kind !== 'unknown' ? { isShort: kind === 'short' } : {}) };
      const record = merge(before, after), client = mergeVideoFormatFields(sanitizeArchivedUpdate(before)!, sanitizeArchivedUpdate(after)!);
      expect(record.videoFormat).toEqual(format);
      expect(client.videoFormat).toEqual(format);
    }
  });
  it('keeps unresolved positive evidence through real SQL, client import, refresh and No Shorts filtering', () => {
    const unknown = { kind: 'unknown', basis: 'watch_page' }, regular = { kind: 'regular', basis: 'watch_page' };
    const cases = [
      [{ ...original, isShort: true, videoFormat: unknown }, incoming],
      [{ ...original, isShort: false, videoFormat: regular }, { ...incoming, isShort: true, videoFormat: unknown }],
      [{ ...original, isShort: true, videoFormat: regular }, incoming],
      [{ ...original, url: 'https://youtube.com/shorts/abcdefghijk', isShort: false, videoFormat: unknown }, incoming],
    ];
    const source: Source = { id: original.sourceId, name: 'Disposable channel', platform: 'YouTube', url: 'https://youtube.com/@disposable', status: 'ready', creatorIds: [] };
    for (const [before, after] of cases) {
      const enriched = merge(before, after), update = sanitizeArchivedUpdate(enriched)!;
      expect(enriched).toMatchObject({ isShort: true, videoFormat: { kind: 'unknown' } });
      expect(mergeVideoFormatFields(sanitizeArchivedUpdate(before)!, sanitizeArchivedUpdate(after)!)).toMatchObject({ isShort: true, videoFormat: { kind: 'unknown' } });
      expect(videoFormatKind(update)).toBe('unknown');
      let state = { ...createDefaultWorkspace(), customSources: [source], importedUpdates: [update], sourcePreferences: { [source.id]: { showShorts: false } } };
      for (let iteration = 0; iteration < 2; iteration++) {
        state = mergeCollection(state, { source, updates: [iteration === 0 ? update : { ...update, isShort: false, videoFormat: { kind: 'regular', basis: 'provider' } }] }) as typeof state;
        expect(state.importedUpdates[0].isShort).toBe(true);
        expect(videoFormatKind(state.importedUpdates[0])).not.toBe('regular');
        expect(updatesForSourcePreferences(state.importedUpdates, state)).toEqual([]);
      }
    }
  });
  it('recovers missing speech and clears only a stale unavailable-summary marker', () => {
    const summary = { status: 'unavailable', captionHash: 'a'.repeat(64) };
    const recovered = merge({ ...original, videoSummary: summary }, { ...incoming, contentKind: 'transcript', content: 'Recovered source speech', transcriptSegments: [{ text: 'Recovered source speech', startSeconds: 2 }], coverage: 'Existing captions' });
    expect(recovered).toMatchObject({ ...original, contentKind: 'transcript', content: 'Recovered source speech', videoHighlights: original.videoHighlights, videoKeywords: original.videoKeywords });
    expect(recovered).not.toHaveProperty('videoSummary');
    expect(merge({ ...original, videoSummary: { ...summary, status: 'ready' } }, { ...incoming, contentKind: 'transcript', content: 'Recovered source speech' }).videoSummary.status).toBe('ready');
  });
  it('preserves existing usable transcripts, cues and ready annotations when provider content differs', () => {
    const before = { ...original, contentKind: 'transcript', content: 'Stored complete speech', transcriptSegments: [{ startSeconds: 3, text: 'Stored' }], videoSummary: { status: 'ready' } };
    expect(merge(before, { ...incoming, contentKind: 'transcript', content: 'Partial replacement' })).toEqual({ ...before, videoFormat: incoming.videoFormat, isShort: false });
  });
  it('rejects changed original/source identities and denies public helper execution', () => {
    expect(() => merge(original, { ...incoming, url: 'https://youtube.com/watch?v=lmnopqrstuv' })).toThrow();
    expect(() => merge(original, { ...incoming, sourceId: 'other-source' })).toThrow();
    expect(sql("select has_function_privilege('anon','public.merge_hourly_video_enrichment(jsonb,jsonb)','execute'),has_function_privilege('authenticated','public.merge_hourly_video_enrichment(jsonb,jsonb)','execute');")).toBe('f|f');
  });
  it('executes metadata-only enrichment through the real guarded finish RPC with the original ID', () => {
    const owner = `format-db-owner-${++sequence}`;
    const state = { version: 1, followedSourceIds: [original.sourceId], customSources: [{ id: original.sourceId, url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', platform: 'YouTube', name: 'Fixture', status: 'ready', creatorIds: [] }], importedUpdates: [], savedUpdateIds: [original.id], readLaterIds: [], settings: {}, sourcePreferences: { [original.sourceId]: { showShorts: false } } };
    sql(`insert into public.reader_collection_policies(user_id,enabled) values('${owner}',true);
      insert into public.reader_workspaces(user_id,state) values('${owner}',${literal(state)});
      insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('${owner}','${original.id}','${original.sourceId}','tech','${original.publishedAt}',${literal(original)});`);
    const claim = JSON.parse(sql(`select public.claim_hourly_source('${owner}','${original.sourceId}');`));
    const items = [{ itemKey: 'youtube:abcdefghijk', record: incoming }];
    expect(() => sql(`select public.finish_hourly_source('${claim.checkId}',gen_random_uuid(),'{}',${literal(items)});`)).toThrow();
    const result = JSON.parse(sql(`set role service_role; select public.finish_hourly_source('${claim.checkId}','${claim.leaseToken}','{"status":"collected"}',${literal(items)});`));
    expect(result).toEqual({ retrievedCount: 1, importAccepted: true });
    expect(JSON.parse(sql(`select record from public.reader_source_updates where user_id='${owner}';`))).toEqual({ ...original, videoFormat: incoming.videoFormat, isShort: false });
    expect(JSON.parse(sql(`select state from public.reader_workspaces where user_id='${owner}';`))).toEqual(state);
  });
  it('retains the existing budget, clearing, identity and workspace fences', () => {
    expect(sql(readFileSync(resolve('tests/hourly-collection-db.sql'), 'utf8'))).toContain('hourly_database_invariants_passed');
  });
});
