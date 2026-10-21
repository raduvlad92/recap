import { describe, expect, it } from 'vitest';
import { isShortUpdate, mergeCollection, mergeWorkspaceUpdates, sanitizeArchivedUpdate, sanitizeSourceUpdate, sanitizeWorkspace, sourceShowsShorts, updatesForSourcePreferences, withSourceShortsPreference } from '../src/lib/domain';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import { readArchiveRecords } from '../src/lib/workspace';
import type { Source, SourceUpdate, WorkspaceState } from '../src/lib/types';

const source: Source = { id: 'channel', name: 'Video channel', platform: 'YouTube', url: 'https://www.youtube.com/@channel', creatorIds: [], status: 'ready', avatarUrl: 'https://yt3.ggpht.com/channel-photo' };
const update = (id: string, overrides: Partial<SourceUpdate> = {}): SourceUpdate => ({ id, sourceId: source.id, title: 'Video', summary: '', content: 'The original complete transcript.', contentKind: 'transcript', url: `https://www.youtube.com/watch?v=${id}`, publishedAt: '2026-10-21T10:00:00.000Z', format: 'video', contributorIds: [], topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, ...overrides });
const workspace = (): WorkspaceState => ({ ...createDefaultWorkspace(), customSources: [source], importedUpdates: [] });

describe('per-source Shorts visibility', () => {
  it('shows Shorts by default in legacy workspaces and allows preferences for sample sources', () => {
    const restored = sanitizeWorkspace(JSON.parse(JSON.stringify(workspace())))!;
    expect(restored.sourcePreferences).toBeUndefined();
    expect(sourceShowsShorts(restored, source.id)).toBe(true);
    const edited = withSourceShortsPreference(restored, 'northstar-main', false);
    expect(sourceShowsShorts(edited, 'northstar-main')).toBe(false);
    expect(sourceShowsShorts(edited, source.id)).toBe(true);
    expect(edited.customSources).toBe(restored.customSources);
  });

  it('hides only explicit Shorts for the disabled source, preserving unknown short videos', () => {
    const state = withSourceShortsPreference(workspace(), source.id, false);
    const entries = [update('flagged', { isShort: true }), update('linked', { url: 'https://www.youtube.com/shorts/linked' }), update('short-duration', { duration: '00:30' }), update('unknown'), update('explicit-long', { isShort: false }), update('other-channel', { sourceId: 'another-channel', isShort: true })];
    expect(updatesForSourcePreferences(entries, state).map(item => item.id)).toEqual(['short-duration', 'unknown', 'explicit-long', 'other-channel']);
    expect(entries).toHaveLength(6);
    expect(updatesForSourcePreferences(entries, withSourceShortsPreference(state, source.id, true))).toEqual(entries);
  });

  it.each(['https://youtube.com/shorts/abc', 'https://www.youtube.com/shorts/abc/', 'https://m.youtube.com/shorts/abc?t=3'])('recognizes the explicit Shorts URL %s', url => {
    expect(isShortUpdate(update('url', { url }))).toBe(true);
  });

  it.each(['https://youtube.com/watch?v=shorts', 'https://youtu.be/abc', 'https://youtube.com.evil.example/shorts/abc', 'https://example.com/shorts/abc', 'https://youtube.com/@shorts', 'bad url'])('does not guess a Shorts identity from %s', url => {
    expect(isShortUpdate(update('url', { url, duration: '20 seconds' }))).toBe(false);
  });

  it('persists a false preference through JSON export/load and drops malformed or unrelated preferences', () => {
    const state = withSourceShortsPreference(workspace(), source.id, false);
    const restored = sanitizeWorkspace(JSON.parse(JSON.stringify({ ...state, sourcePreferences: { ...state.sourcePreferences, 'northstar-main': { showShorts: false }, missing: { showShorts: false }, 'northstar-lab': { showShorts: 'false' } } })))!;
    expect(restored.sourcePreferences).toEqual({ channel: { showShorts: false }, 'northstar-main': { showShorts: false } });
    expect(sourceShowsShorts(restored, 'northstar-lab')).toBe(true);
    expect(() => withSourceShortsPreference(state, 'missing', false)).toThrow('no longer exists');
  });

  it('retains collection, source follows, bookmarks and complete source content when disabled and refreshed', () => {
    const original = mergeCollection({ ...workspace(), savedUpdateIds: ['short'], readLaterIds: ['short'] }, { source, updates: [update('short', { isShort: true })] });
    const disabled = withSourceShortsPreference(original, source.id, false);
    const refreshed = mergeCollection(disabled, { source: { ...source, avatarUrl: undefined, status: 'ready' }, updates: [update('short', { title: 'Corrected title' }), update('new-short', { isShort: true })] });
    expect(refreshed.sourcePreferences).toBe(disabled.sourcePreferences);
    expect(refreshed.followedSourceIds).toBe(original.followedSourceIds);
    expect(refreshed.savedUpdateIds).toEqual(['short']);
    expect(refreshed.readLaterIds).toEqual(['short']);
    expect(refreshed.importedUpdates).toHaveLength(2);
    expect(refreshed.importedUpdates.find(item => item.id === 'short')).toMatchObject({ isShort: true, title: 'Corrected title', content: 'The original complete transcript.' });
    expect(refreshed.customSources[0].avatarUrl).toBe(source.avatarUrl);
    expect(updatesForSourcePreferences(refreshed.importedUpdates, refreshed)).toEqual([]);
    const restored = sanitizeWorkspace(JSON.parse(JSON.stringify(refreshed)))!;
    expect(restored.importedUpdates).toEqual(refreshed.importedUpdates);
    expect(updatesForSourcePreferences(restored.importedUpdates, withSourceShortsPreference(restored, source.id, true))).toHaveLength(2);
  });

  it('keeps disabled Shorts in archive loads, archive merges and exports for immediate re-enabling', async () => {
    const fullTranscript = 'An original transcript. '.repeat(8000);
    const state = withSourceShortsPreference(workspace(), source.id, false);
    const archived = await readArchiveRecords(async () => [update('archive-short', { isShort: true, content: fullTranscript })], [source.id], new AbortController().signal);
    expect(archived.rejected).toBe(0);
    expect(archived.updates[0].content).toBe(fullTranscript);
    const complete = mergeWorkspaceUpdates(state.importedUpdates, archived.updates);
    expect(updatesForSourcePreferences(complete, state)).toEqual([]);
    const exported = JSON.parse(JSON.stringify({ ...state, archivedUpdates: archived.updates }));
    expect(exported.archivedUpdates[0]).toMatchObject({ isShort: true, content: fullTranscript });
    expect(updatesForSourcePreferences(complete, withSourceShortsPreference(state, source.id, true))).toEqual(complete);
  });
});

describe('video card metadata integrity', () => {
  it('round-trips trusted timestamps, channel images and provider Shorts flags', () => {
    const item = update('timed', { isShort: false, transcriptSegments: [{ startSeconds: 0, durationSeconds: 2.5, text: 'Opening.' }, { startSeconds: 123.5, text: 'Later detail.' }], videoHighlights: [{ text: 'A source-backed detail.', startSeconds: 123.5 }] });
    const state = mergeCollection(workspace(), { source, updates: [item] });
    const restored = sanitizeWorkspace(JSON.parse(JSON.stringify(state)))!;
    expect(restored.customSources[0].avatarUrl).toBe(source.avatarUrl);
    expect(restored.importedUpdates[0]).toMatchObject({ isShort: false, transcriptSegments: item.transcriptSegments, videoHighlights: item.videoHighlights });
    expect(sanitizeArchivedUpdate(item)).toMatchObject({ transcriptSegments: item.transcriptSegments, videoHighlights: item.videoHighlights });
  });

  it('removes unsafe images and invalid timestamps instead of manufacturing time links', () => {
    const raw = { ...update('invalid'), isShort: 'yes', transcriptSegments: [{ startSeconds: -1, text: 'Negative.' }, { startSeconds: Infinity, text: 'Infinite.' }, { startSeconds: '12', text: 'String.' }, { startSeconds: 10, text: '  ' }, { startSeconds: 12, durationSeconds: -5, text: 'Valid start.' }], videoHighlights: [{ text: 'Untimed.', startSeconds: -1 }, { text: '' }, { text: 'Timed.', startSeconds: 15 }] };
    const cleaned = sanitizeSourceUpdate(raw)!;
    expect(cleaned.isShort).toBeUndefined();
    expect(cleaned.transcriptSegments).toEqual([{ startSeconds: 12, text: 'Valid start.' }]);
    expect(cleaned.videoHighlights).toEqual([{ text: 'Untimed.' }, { text: 'Timed.', startSeconds: 15 }]);
    for (const avatarUrl of ['javascript:alert(1)', 'https://127.0.0.1/private', 'https://user:password@example.org/photo', 'data:image/png;base64,abc']) {
      expect(sanitizeWorkspace({ ...workspace(), customSources: [{ ...source, avatarUrl }] })?.customSources[0].avatarUrl).toBeUndefined();
    }
  });
});
