import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspace, isFictionalSource, isFictionalUpdate, isLegacySampleUrl, LEGACY_SAMPLE_CREATOR_IDS, LEGACY_SAMPLE_SOURCE_IDS, LEGACY_SAMPLE_UPDATE_IDS, removeFictionalWorkspaceContent } from '../src/lib/fixtures';
import { mergeCollection, sanitizeSettings, sanitizeWorkspace } from '../src/lib/domain';
import { prepareWorkspaceLoad, readArchiveRecords, readWorkspaceCache, workspaceForPersistence } from '../src/lib/workspace';
import { translator } from '../src/components/ui';
import { createSampleUpdates, sampleCreators, sampleSources } from './helpers/sample-fixtures';
import type { Creator, Source, SourceUpdate, WorkspaceState } from '../src/lib/types';

const source: Source = { id: 'real-channel', name: 'Existing channel', platform: 'YouTube', url: 'https://www.youtube.com/@existing', creatorIds: ['real-studio'], status: 'ready', avatarUrl: 'https://yt3.googleusercontent.com/existing' };
const creator: Creator = { id: 'real-studio', name: 'Existing studio', kind: 'studio', handle: '@existing', bio: 'An existing publishing group.', initials: 'ES', color: '#aabbcc', sourceIds: [source.id], presenterIds: [] };
const update = (id = 'real-item', patch: Partial<SourceUpdate> = {}): SourceUpdate => ({ id, sourceId: source.id, contributorIds: [], title: 'Existing collected item', summary: 'A reviewed takeaway.', url: `https://www.youtube.com/watch?v=${id}`, publishedAt: '2026-10-21T10:00:00.000Z', format: 'video', topics: ['GPU'], brands: ['Nvidia'], sponsors: [], references: [{ title: 'Original evidence', url: 'https://example.org/research' }], insights: ['A source-supported takeaway.'], isSample: false, content: 'Original source text. '.repeat(9000), contentKind: 'transcript', videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: 'a'.repeat(64), timingBasis: 'captions' }, videoHighlights: [{ text: 'A reviewed finding.', startSeconds: 42 }], videoKeywords: [{ label: 'GPU', seconds: 20, ranges: [{ startSeconds: 40, endSeconds: 60 }] }], ...patch });
const realWorkspace = (): WorkspaceState => ({ ...createDefaultWorkspace(), followedSourceIds: [source.id], followScopes: [{ kind: 'source', id: source.id }], savedUpdateIds: ['real-item', 'archive-only', 'temporarily-unavailable'], readLaterIds: ['archive-only'], settings: { interests: ['Hardware'], interfaceLanguage: 'de', recapLanguage: 'fr', timezone: 'Europe/Berlin', deliveryTime: '07:30', emailReminder: true }, customSources: [source], customCreators: [creator], importedUpdates: [update()], sourceCollections: [{ id: 'tech', name: 'My tech', sourceIds: [source.id], createdAt: '2026-10-01T10:00:00.000Z' }, { id: 'my-empty-collection', name: 'For later', sourceIds: [], createdAt: '2026-10-02T10:00:00.000Z' }], activeCollectionId: 'tech', sourcePreferences: { [source.id]: { showShorts: false } } });
const mixedWorkspace = () => {
  const real = realWorkspace();
  return { ...real, followedSourceIds: [...LEGACY_SAMPLE_SOURCE_IDS, ...real.followedSourceIds], followScopes: [...sampleSources.map(item => ({ kind: 'source' as const, id: item.id })), { kind: 'creator' as const, id: 'northstar', sourceIds: ['northstar-main', source.id] }, ...real.followScopes!], savedUpdateIds: ['sample-01', 'marked-demo', ...real.savedUpdateIds], readLaterIds: ['sample-09', ...real.readLaterIds], customSources: [...sampleSources, ...real.customSources], customCreators: [...sampleCreators, ...real.customCreators!], importedUpdates: [...createSampleUpdates(new Date('2026-10-21T12:00:00Z')), update('marked-demo', { isSample: true }), ...real.importedUpdates], sourceCollections: real.sourceCollections!.map(collection => collection.id === 'tech' ? { ...collection, sourceIds: ['northstar-main', ...collection.sourceIds] } : collection), sourcePreferences: { ...real.sourcePreferences, 'northstar-main': { showShorts: false } }, futurePreference: { preserve: true }, annotationReview: { status: 'reviewed', revision: 7 } };
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const cacheKey = (owner: string) => `therecap.workspace.v1.${encodeURIComponent(owner)}`;
function storage() {
  const entries = new Map<string, string>();
  const mock = { getItem: vi.fn((key: string) => entries.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }) };
  vi.stubGlobal('localStorage', mock);
  return { entries, mock };
}
afterEach(() => vi.unstubAllGlobals());

describe('retired fictional reader content', () => {
  it('starts every fresh workspace with no seeded follows, saves, sources, creators or updates', () => {
    const first = createDefaultWorkspace(), second = createDefaultWorkspace();
    expect(first).toMatchObject({ followedSourceIds: [], followScopes: [], savedUpdateIds: [], readLaterIds: [], customSources: [], importedUpdates: [] });
    expect(first.customCreators ?? []).toEqual([]);
    first.settings.interests.push('My choice');
    expect(second.settings.interests).not.toContain('My choice');
  });

  it('keeps the exact historical ID manifest independent from production defaults', () => {
    expect(sampleSources.map(item => item.id)).toEqual(LEGACY_SAMPLE_SOURCE_IDS);
    expect(sampleCreators.map(item => item.id)).toEqual(LEGACY_SAMPLE_CREATOR_IDS);
    expect(createSampleUpdates().map(item => item.id)).toEqual(LEGACY_SAMPLE_UPDATE_IDS);
  });

  it('removes mixed fictional references without resetting real settings, collections, history or annotations', () => {
    const original = freeze(mixedWorkspace()), snapshot = structuredClone(original);
    const cleaned = removeFictionalWorkspaceContent(original);
    expect(original).toEqual(snapshot);
    expect(cleaned.followedSourceIds).toEqual([source.id]);
    expect(cleaned.followScopes).toEqual([{ kind: 'source', id: source.id }, { kind: 'source', id: source.id }]);
    expect(cleaned.savedUpdateIds).toEqual(['real-item', 'archive-only', 'temporarily-unavailable']);
    expect(cleaned.readLaterIds).toEqual(['archive-only']);
    expect(cleaned.customSources).toEqual([source]);
    expect(cleaned.customCreators).toEqual([creator]);
    expect(cleaned.importedUpdates).toEqual([original.importedUpdates.at(-1)]);
    expect(cleaned.importedUpdates[0]).toBe(original.importedUpdates.at(-1));
    expect(cleaned.settings).toBe(original.settings);
    expect(cleaned.sourceCollections).toEqual(realWorkspace().sourceCollections);
    expect(cleaned.activeCollectionId).toBe('tech');
    expect(cleaned.sourcePreferences).toEqual({ [source.id]: { showShorts: false } });
    expect(cleaned.futurePreference).toBe(original.futurePreference);
    expect(cleaned.annotationReview).toBe(original.annotationReview);
    expect(removeFictionalWorkspaceContent(cleaned)).toBe(cleaned);
  });

  it('leaves a real workspace byte-for-byte unchanged, including archive-only bookmarks and unknown fields', () => {
    const original = freeze({ ...realWorkspace(), futurePreference: { preserve: true } });
    expect(removeFictionalWorkspaceContent(original)).toBe(original);
    expect(JSON.stringify(removeFictionalWorkspaceContent(original))).toBe(JSON.stringify(original));
  });

  it('cleans nested identity references and sample references without removing a real record', () => {
    const state = { ...realWorkspace(), customSources: [{ ...source, creatorIds: ['northstar', creator.id] }], customCreators: [{ ...creator, sourceIds: ['northstar-main', source.id], presenterIds: ['maya', 'real-person'] }], followScopes: [{ kind: 'creator' as const, id: creator.id, sourceIds: ['northstar-main', source.id] }], importedUpdates: [update('real-item', { contributorIds: ['leo', 'real-person'], references: [{ title: 'Retired reference', url: 'https://example.com/sample/references/sample-01' }, { title: 'Actual reference', url: 'https://example.org/research' }] })] };
    const cleaned = removeFictionalWorkspaceContent(state);
    expect(cleaned.customSources[0].creatorIds).toEqual([creator.id]);
    expect(cleaned.customCreators[0]).toMatchObject({ sourceIds: [source.id], presenterIds: ['real-person'] });
    expect(cleaned.followScopes).toEqual([{ kind: 'creator', id: creator.id, sourceIds: [source.id] }]);
    expect(cleaned.importedUpdates[0]).toMatchObject({ contributorIds: ['real-person'], references: [{ title: 'Actual reference', url: 'https://example.org/research' }] });
    expect(cleaned.importedUpdates[0].content).toBe(state.importedUpdates[0].content);
    expect(cleaned.importedUpdates[0].videoSummary).toBe(state.importedUpdates[0].videoSummary);
  });

  it('recognizes explicit sample records under other IDs and removes their saved/source references', () => {
    const state = { ...realWorkspace(), followedSourceIds: [source.id, 'copied-demo'], savedUpdateIds: ['real-item', 'copied-demo-item', 'placeholder'], customSources: [source, { ...source, id: 'copied-demo', status: 'sample' as const }], importedUpdates: [update(), update('copied-demo-item', { sourceId: 'copied-demo' }), update('placeholder', { url: 'https://example.com/sample/updates/placeholder' })], sourceCollections: [{ id: 'mine', name: 'Keep this collection', sourceIds: ['copied-demo', source.id], createdAt: '2026-10-01T10:00:00Z' }] };
    const cleaned = removeFictionalWorkspaceContent(state);
    expect(cleaned.customSources).toEqual([source]);
    expect(cleaned.followedSourceIds).toEqual([source.id]);
    expect(cleaned.savedUpdateIds).toEqual(['real-item']);
    expect(cleaned.importedUpdates.map(item => item.id)).toEqual(['real-item']);
    expect(cleaned.sourceCollections).toEqual([{ ...state.sourceCollections[0], sourceIds: [source.id] }]);
  });

  it('preserves real records with similar names, sample-prefixed IDs or unrelated example.com links', () => {
    const state = { ...realWorkspace(), customSources: [{ ...source, id: 'northstar-main-real', name: 'Northstar', url: 'https://example.com/samples/research' }], customCreators: [{ ...creator, id: 'northstar-real', name: 'Northstar Studio' }], importedUpdates: [update('sample-real-record', { sourceId: 'northstar-main-real' })], savedUpdateIds: ['sample-real-record', 'archive-only'] };
    expect(removeFictionalWorkspaceContent(state)).toBe(state);
    expect(sanitizeWorkspace(state)?.importedUpdates.map(item => item.id)).toEqual(['sample-real-record']);
    expect(isFictionalSource(state.customSources[0])).toBe(false);
    expect(isFictionalUpdate(state.importedUpdates[0])).toBe(false);
    expect(isLegacySampleUrl('https://example.com.evil.org/sample/updates/sample-01')).toBe(false);
    expect(isLegacySampleUrl('https://example.org/sample/research')).toBe(false);
  });

  it('does not migrate unknown versions or malformed state into a new empty workspace', () => {
    const unknown = { ...mixedWorkspace(), version: 2 };
    expect(removeFictionalWorkspaceContent(unknown)).toBe(unknown);
    expect(sanitizeWorkspace(unknown)).toBeNull();
    for (const value of [null, [], 'invalid', { version: 1 }]) expect(sanitizeWorkspace(value)).toBeNull();
  });

  it('rejects new fictional collection results while accepting real similarly named records', () => {
    expect(() => mergeCollection(realWorkspace(), { source: sampleSources[0], updates: createSampleUpdates() })).toThrow('invalid source');
    const result = mergeCollection(realWorkspace(), { source, updates: [update('sample-01'), update('new-demo', { isSample: true }), update('sample-real-item')] });
    expect(result.importedUpdates.map(item => item.id)).toEqual(['real-item', 'sample-real-item']);
  });
});

describe('sample migration through browser and cloud persistence', () => {
  it('rewrites only the current owner cache while retaining real raw content, revision and dirty status', () => {
    const { entries } = storage();
    const initial = { state: mixedWorkspace(), updatedAt: 'revision-1', dirty: true };
    const other = JSON.stringify({ state: mixedWorkspace(), updatedAt: 'other-revision', dirty: true });
    entries.set(cacheKey('reader/one'), JSON.stringify(initial));
    entries.set(cacheKey('reader-two'), other);
    entries.set('therecap.feed-density.v1', 'regular');
    const loaded = readWorkspaceCache('reader/one')!;
    expect(loaded).toMatchObject({ updatedAt: 'revision-1', dirty: true });
    expect(loaded.storedState.importedUpdates[0].content).toBe(initial.state.importedUpdates.at(-1)!.content);
    expect(JSON.parse(entries.get(cacheKey('reader/one'))!)).toEqual({ state: removeFictionalWorkspaceContent(initial.state), updatedAt: 'revision-1', dirty: true });
    expect(entries.get(cacheKey('reader-two'))).toBe(other);
    expect(entries.get('therecap.feed-density.v1')).toBe('regular');
    expect(readWorkspaceCache('no-cache')).toBeNull();
  });

  it('cleans a guest or offline backup without turning a clean cache into a conflicting local draft', () => {
    const { entries } = storage();
    entries.set(cacheKey('guest'), JSON.stringify({ state: mixedWorkspace(), updatedAt: null, dirty: false }));
    const loaded = readWorkspaceCache('guest')!;
    expect(loaded.dirty).toBe(false);
    expect(loaded.state.followedSourceIds).toEqual([source.id]);
    expect(JSON.parse(entries.get(cacheKey('guest'))!).dirty).toBe(false);
  });

  it('keeps cleaned data available if browser migration storage fails', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ state: mixedWorkspace(), updatedAt: 'revision-1', dirty: true }), setItem: () => { throw new Error('Full storage'); } });
    expect(readWorkspaceCache('reader')?.state.followedSourceIds).toEqual([source.id]);
    expect(readWorkspaceCache('reader')?.dirty).toBe(true);
  });

  it('marks a cloud-only sample cleanup for conditional saving and preserves the exact raw real payload', () => {
    const raw = freeze(mixedWorkspace());
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-2' }, null);
    expect(loaded).toMatchObject({ dirty: true, conflict: false, updatedAt: 'revision-2' });
    expect(loaded.storedState).toEqual(removeFictionalWorkspaceContent(raw));
    expect(loaded.storedState.importedUpdates[0].content!.length).toBeGreaterThan(100_000);
    expect(loaded.storedState.importedUpdates[0]).toBe(raw.importedUpdates.at(-1));
    const reloaded = prepareWorkspaceLoad({ state: loaded.storedState, updated_at: 'revision-3' }, null);
    expect(reloaded).toMatchObject({ dirty: false, conflict: false });
  });

  it('retains pending local edits at a matching revision and blocks stale drafts from overwriting newer cloud state', () => {
    const { entries } = storage();
    const local = { ...mixedWorkspace(), savedUpdateIds: ['sample-01', 'unsaved-local-bookmark'] };
    entries.set(cacheKey('reader'), JSON.stringify({ state: local, updatedAt: 'revision-1', dirty: true }));
    const cache = readWorkspaceCache('reader')!;
    const matching = prepareWorkspaceLoad({ state: mixedWorkspace(), updated_at: 'revision-1' }, cache);
    expect(matching).toMatchObject({ dirty: true, conflict: false });
    expect(matching.storedState.savedUpdateIds).toEqual(['unsaved-local-bookmark']);
    const changedCloud = { ...realWorkspace(), settings: { ...realWorkspace().settings, deliveryTime: '09:00' } };
    const stale = prepareWorkspaceLoad({ state: changedCloud, updated_at: 'revision-2' }, cache);
    expect(stale).toMatchObject({ dirty: false, conflict: true, updatedAt: 'revision-2' });
    expect(stale.storedState.savedUpdateIds).toEqual(['unsaved-local-bookmark']);
    expect(cache.updatedAt).toBe('revision-1');
    expect(changedCloud.settings.deliveryTime).toBe('09:00');
  });

  it('lets a newer clean cloud workspace replace a migrated clean cache', () => {
    const { entries } = storage();
    entries.set(cacheKey('reader'), JSON.stringify({ state: mixedWorkspace(), updatedAt: 'revision-1', dirty: false }));
    const remote = { ...realWorkspace(), savedUpdateIds: ['new-cloud-save'] };
    const loaded = prepareWorkspaceLoad({ state: remote, updated_at: 'revision-2' }, readWorkspaceCache('reader'));
    expect(loaded).toMatchObject({ dirty: false, conflict: false });
    expect(loaded.storedState).toBe(remote);
    expect(loaded.state.savedUpdateIds).toEqual(['new-cloud-save']);
  });

  it('preserves unchanged raw content and unknown metadata when a reader edits during cleanup', () => {
    const loaded = prepareWorkspaceLoad({ state: mixedWorkspace(), updated_at: 'revision-1' }, null);
    const next = { ...loaded.state, savedUpdateIds: [...loaded.state.savedUpdateIds, 'new-save'] };
    const stored = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(stored.savedUpdateIds).toContain('new-save');
    expect(stored.importedUpdates).toBe(loaded.storedState.importedUpdates);
    expect(stored.importedUpdates[0].content!.length).toBeGreaterThan(100_000);
    expect(stored.settings).toBe(loaded.storedState.settings);
    expect(stored).toMatchObject({ futurePreference: { preserve: true }, annotationReview: { status: 'reviewed', revision: 7 } });
    const selected = { ...next }; delete selected.activeCollectionId;
    expect(workspaceForPersistence(stored, next, selected)).not.toHaveProperty('activeCollectionId');
  });

  it('does not replace unsupported remote data and initializes a genuinely new account empty', () => {
    expect(() => prepareWorkspaceLoad({ state: { version: 2 }, updated_at: 'revision-1' }, null)).toThrow('not been overwritten');
    const fresh = prepareWorkspaceLoad(null, null);
    expect(fresh).toMatchObject({ dirty: true, conflict: false, updatedAt: null });
    expect(fresh.state.followedSourceIds).toEqual([]);
    expect(fresh.state.importedUpdates).toEqual([]);
  });

  it('keeps unrelated raw source fields and future settings when a nested metadata field changes', () => {
    const raw = { ...mixedWorkspace(), customSources: [{ ...source, description: 'Source coverage. '.repeat(200), operatorMetadata: { preserve: true } }], settings: { ...realWorkspace().settings, futurePreference: 'keep' } };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    const next = { ...loaded.state, customSources: loaded.state.customSources.map(item => ({ ...item, avatarUrl: 'https://yt3.googleusercontent.com/new-image' })), settings: { ...loaded.state.settings, deliveryTime: '10:00' } };
    const persisted = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(persisted.customSources).toEqual([{ ...raw.customSources[0], avatarUrl: 'https://yt3.googleusercontent.com/new-image' }]);
    expect(persisted.settings).toEqual({ ...raw.settings, deliveryTime: '10:00' });
    expect(persisted.importedUpdates).toBe(loaded.storedState.importedUpdates);
  });

  it('keeps real sources beyond the view limit when editing one channel and removing a visible record', () => {
    const raw = { ...realWorkspace(), customSources: Array.from({ length: 201 }, (_, index) => ({ ...source, id: `real-source-${index}`, url: `https://example.org/source/${index}`, operatorMetadata: { index } })) };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    expect(loaded.state.customSources).toHaveLength(200);
    const next = { ...loaded.state, customSources: loaded.state.customSources.filter(item => item.id !== 'real-source-1').map(item => item.id === 'real-source-0' ? { ...item, avatarUrl: 'https://example.org/new-avatar' } : item) };
    const persisted = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(persisted.customSources).toHaveLength(200);
    expect(persisted.customSources[0]).toEqual({ ...raw.customSources[0], avatarUrl: 'https://example.org/new-avatar' });
    expect(persisted.customSources).not.toContainEqual(raw.customSources[1]);
    expect(persisted.customSources.at(-1)).toBe(raw.customSources[200]);
    expect(persisted.importedUpdates).toBe(raw.importedUpdates);
  });

  it('keeps every stored interest when saving a different setting through the real settings sanitizer', () => {
    const raw = { ...realWorkspace(), settings: { ...realWorkspace().settings, interests: Array.from({ length: 21 }, (_, index) => `Interest ${index}`) } };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    expect(loaded.state.settings.interests).toHaveLength(20);
    const next = { ...loaded.state, settings: sanitizeSettings({ ...loaded.state.settings, deliveryTime: '11:00' }) };
    const persisted = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(persisted.settings).toEqual({ ...raw.settings, deliveryTime: '11:00' });
    expect(persisted.settings.interests).toBe(raw.settings.interests);
  });

  it('keeps archive-only bookmarks beyond the view limit while applying a visible save toggle', () => {
    const raw = { ...realWorkspace(), savedUpdateIds: Array.from({ length: 3001 }, (_, index) => `archive-only-${index}`) };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    expect(loaded.state.savedUpdateIds).toHaveLength(3000);
    const next = { ...loaded.state, savedUpdateIds: [...loaded.state.savedUpdateIds.slice(1), 'new-bookmark'] };
    const persisted = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(persisted.savedUpdateIds).toHaveLength(3001);
    expect(persisted.savedUpdateIds).not.toContain('archive-only-0');
    expect(persisted.savedUpdateIds).toContain('new-bookmark');
    expect(persisted.savedUpdateIds.at(-1)).toBe('archive-only-3000');
  });

  it('keeps a collection beyond the view limit when renaming another collection', () => {
    const raw = { ...realWorkspace(), sourceCollections: Array.from({ length: 31 }, (_, index) => ({ id: `collection-${index}`, name: `Collection ${index}`, sourceIds: [source.id], createdAt: '2026-10-01T10:00:00.000Z' })) };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    expect(loaded.state.sourceCollections).toHaveLength(30);
    const next = { ...loaded.state, sourceCollections: loaded.state.sourceCollections!.map(item => item.id === 'collection-0' ? { ...item, name: 'Renamed' } : item) };
    const persisted = workspaceForPersistence(loaded.storedState, loaded.state, next);
    expect(persisted.sourceCollections).toHaveLength(31);
    expect(persisted.sourceCollections?.[0]).toEqual({ ...raw.sourceCollections[0], name: 'Renamed' });
    expect(persisted.sourceCollections?.at(-1)).toBe(raw.sourceCollections[30]);
  });

  it.each(['reset', 'delete'] as const)('fully replaces guest storage on explicit %s without retaining or resurrecting unseen records', intent => {
    const raw = { ...realWorkspace(), customSources: Array.from({ length: 201 }, (_, index) => ({ ...source, id: `real-source-${index}`, url: `https://example.org/source/${index}` })), savedUpdateIds: Array.from({ length: 3001 }, (_, index) => `saved-${index}`), settings: { ...realWorkspace().settings, interests: Array.from({ length: 21 }, (_, index) => `Interest ${index}`) }, futureData: { private: 'cleared by explicit reader request' } };
    const loaded = prepareWorkspaceLoad({ state: raw, updated_at: 'revision-1' }, null);
    expect(loaded.state.customSources).toHaveLength(200);
    const empty = intent === 'reset' ? { ...createDefaultWorkspace(), sourceCollections: [] } : createDefaultWorkspace();
    const replacement = workspaceForPersistence(loaded.storedState, loaded.state, empty, 'replace');
    expect(replacement).toBe(empty);
    expect(replacement.customSources).toEqual([]);
    expect(replacement.savedUpdateIds).toEqual([]);
    expect(replacement).not.toHaveProperty('futureData');
    const reloaded = prepareWorkspaceLoad({ state: JSON.parse(JSON.stringify(replacement)), updated_at: 'revision-2' }, null);
    const edited = { ...reloaded.state, settings: { ...reloaded.state.settings, deliveryTime: '10:00' } };
    const savedAgain = workspaceForPersistence(reloaded.storedState, reloaded.state, edited);
    expect(savedAgain.customSources).toEqual([]);
    expect(savedAgain.savedUpdateIds).toEqual([]);
    expect(savedAgain.settings.interests).toEqual(createDefaultWorkspace().settings.interests);
    expect(savedAgain).not.toHaveProperty('futureData');
  });

  it('filters fictional archive records while retaining full real transcripts, annotations and similar IDs', async () => {
    const real = update('sample-real-record');
    const records = [real, update('sample-01'), update('renamed-demo', { sourceId: 'northstar-main' }), update('marked-demo', { isSample: true })];
    const loaded = await readArchiveRecords(async () => records, [source.id, 'northstar-main'], new AbortController().signal);
    expect(loaded.rejected).toBe(3);
    expect(loaded.updates).toEqual([real]);
    expect(loaded.updates[0].content).toBe(real.content);
    expect(loaded.updates[0].videoSummary).toEqual(real.videoSummary);
  });

  it('offers an empty reset without promising any fictional starter collection in every interface language', () => {
    for (const language of ['en', 'de', 'es', 'fr', 'it', 'pt-BR']) expect(translator(language)('resetConfirm')).not.toMatch(/sample|starter|Beispiel|colección inicial|collection initiale|raccolta iniziale|coleção inicial/i);
    expect(translator('en')('coverageBody')).not.toContain('Sample');
    expect(translator('en')('languageNote')).not.toContain('sample');
    expect(translator('en')('guest')).not.toContain('demo');
  });
});
