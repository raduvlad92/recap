import { describe, expect, it } from 'vitest';
import { applyFollowToggle, creatorMatchesUpdate, mergeCollection, mergeWorkspaceUpdates, removeSourceCollection, resolveFollowedSources, sanitizeArchivedUpdate, sanitizeWorkspace, saveSourceCollection, updatesForCollection } from '../src/lib/domain';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import { createSampleUpdates, sampleCreators, sampleSources } from './helpers/sample-fixtures';
import type { Creator, Source, SourceCollection, SourceUpdate, WorkspaceState } from '../src/lib/types';

const sources: Source[] = [
  { id: 'tech-main', name: 'Main channel', url: 'https://youtube.com/@exampletech', platform: 'YouTube', creatorIds: ['tech-studio'], status: 'ready' },
  { id: 'tech-person', name: 'Presenter channel', url: 'https://youtube.com/@examplepresenter', platform: 'YouTube', creatorIds: ['tech-presenter'], status: 'ready' },
];
const person: Creator = { id: 'tech-presenter', kind: 'person', name: 'Example presenter', handle: '@examplepresenter', initials: 'EP', color: '#bedacf', bio: 'A test identity.', sourceIds: ['tech-main', 'tech-person'] };
const studio: Creator = { id: 'tech-studio', kind: 'studio', name: 'Example studio', handle: '@exampletech', initials: 'ES', color: '#bedacf', bio: 'A test studio.', sourceIds: ['tech-main'], presenterIds: ['tech-presenter'] };
const collection: SourceCollection = { id: 'tech', name: 'Tech', sourceIds: ['tech-main', 'tech-person'], createdAt: '2026-10-21T10:00:00.000Z' };
const item = (id: string, sourceId: string, publishedAt: string): SourceUpdate => ({ id, sourceId, publishedAt: publishedAt ? new Date(publishedAt).toISOString() : '', contributorIds: [], title: id, summary: 'A test update.', url: `https://example.org/${id}`, format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, contentKind: 'metadata_only' });
const workspace = (): WorkspaceState => ({ ...createDefaultWorkspace(), customCreators: [studio, person], customSources: sources, importedUpdates: [item('new', 'tech-main', '2026-10-21T10:00:00Z')], sourceCollections: [collection], activeCollectionId: 'tech' });

describe('persistent reader collections and real creator hierarchy', () => {
  it('loads older v1 workspaces without changing follows, settings or saved history', () => {
    const old = { ...createDefaultWorkspace(), savedUpdateIds: ['saved-real-update'], readLaterIds: ['later-real-update'] };
    const loaded = sanitizeWorkspace(JSON.parse(JSON.stringify(old)));
    expect(loaded).toEqual(old);
    expect(loaded?.activeCollectionId).toBeUndefined();
  });
  it('round trips seeded collection and hierarchy IDs while preserving existing reader data', () => {
    const state = { ...workspace(), savedUpdateIds: ['new'], readLaterIds: ['later-real-update'] };
    const loaded = sanitizeWorkspace(JSON.parse(JSON.stringify(state)));
    expect(loaded).toEqual(state);
    expect(loaded?.customCreators?.find(creator => creator.id === studio.id)?.presenterIds).toEqual([person.id]);
  });
  it('rejects fixture impersonation and dangling channel or presenter references', () => {
    const loaded = sanitizeWorkspace({ ...workspace(), customCreators: [studio, person, { ...person, id: sampleCreators[0].id }, { ...studio, id: 'other', sourceIds: ['missing', 'tech-main'], presenterIds: ['missing', studio.id, person.id] }], sourceCollections: [{ ...collection, sourceIds: ['tech-main', 'tech-main', 'missing'] }], activeCollectionId: 'missing' });
    expect(loaded?.customCreators?.some(creator => creator.id === sampleCreators[0].id)).toBe(false);
    expect(loaded?.customCreators?.find(creator => creator.id === 'other')).toMatchObject({ sourceIds: ['tech-main'], presenterIds: [person.id] });
    expect(loaded?.sourceCollections?.[0].sourceIds).toEqual(['tech-main']);
    expect(loaded?.activeCollectionId).toBeUndefined();
  });
  it('follows a custom studio and keeps an independently followed presenter after studio removal', () => {
    const inventory = [...sampleSources, ...sources];
    const creators = [...sampleCreators, studio, person];
    let state: WorkspaceState = { ...workspace(), followScopes: [], followedSourceIds: [] };
    state = applyFollowToggle(state, { kind: 'creator', id: studio.id }, creators, inventory);
    state = applyFollowToggle(state, { kind: 'creator', id: person.id }, creators, inventory);
    state = applyFollowToggle(state, { kind: 'creator', id: studio.id }, creators, inventory);
    expect(resolveFollowedSources(state.followScopes!, creators, inventory)).toEqual(person.sourceIds);
    expect(state.activeCollectionId).toBe('tech');
  });
  it('navigates owned channels even when an update has no credited presenter, without inventing credits', () => {
    const update = item('uncredited', 'tech-person', '2026-10-21T10:00:00Z');
    expect(creatorMatchesUpdate(person, update)).toBe(true);
    expect(creatorMatchesUpdate(studio, update)).toBe(false);
    expect(update.contributorIds).toEqual([]);
  });
  it('renames and edits membership without changing follows, saved items or collected history', () => {
    const state = workspace();
    const edited = saveSourceCollection(state, { ...collection, name: '  Hardware  ', sourceIds: ['tech-person', 'missing', 'tech-person'] }, sources);
    expect(edited.sourceCollections).toEqual([{ ...collection, name: 'Hardware', sourceIds: ['tech-person'] }]);
    expect(edited.followedSourceIds).toEqual(state.followedSourceIds);
    expect(edited.importedUpdates).toBe(state.importedUpdates);
    expect(edited.settings).toBe(state.settings);
  });
  it('removes a collection without deleting its sources, follows or history', () => {
    const state = workspace();
    const removed = removeSourceCollection(state, 'tech');
    expect(removed.sourceCollections).toEqual([]);
    expect(removed.activeCollectionId).toBeUndefined();
    expect(removed.customSources).toBe(state.customSources);
    expect(removed.importedUpdates).toBe(state.importedUpdates);
    expect(removed.followScopes).toBe(state.followScopes);
  });
  it('imports new content without losing the active collection or hierarchy', () => {
    const state = workspace();
    const updated = mergeCollection(state, { source: sources[0], updates: [item('another', 'tech-main', '2026-10-20T10:00:00Z')] });
    expect(updated.sourceCollections).toBe(state.sourceCollections);
    expect(updated.customCreators).toBe(state.customCreators);
    expect(updated.activeCollectionId).toBe('tech');
  });
});

describe('collection-specific history windows', () => {
  const history = [
    item('today', 'tech-main', '2026-10-21T10:00:00Z'),
    item('first-day', 'tech-main', '2026-09-21T23:30:00Z'), // Sep 22 in Berlin, day 30.
    item('too-old', 'tech-main', '2026-09-21T21:59:00Z'),
    item('future', 'tech-main', '2026-10-22T10:00:00Z'),
    item('undated', 'tech-main', ''),
    item('unrelated', 'other-channel', '2026-10-21T10:00:00Z'),
    ...createSampleUpdates(new Date('2026-10-21T10:00:00Z')),
  ];
  it('includes exactly the reader’s last 30 calendar days and only the selected channels', () => {
    const selected = updatesForCollection(history, collection, { days: 30, timezone: 'Europe/Berlin', now: new Date('2026-10-21T12:00:00Z') });
    expect(selected.map(update => update.id)).toEqual(['today', 'first-day']);
    expect(selected.some(update => update.isSample)).toBe(false);
  });
  it('shows older and undated items in all available history while keeping collection isolation', () => {
    expect(updatesForCollection(history, collection).map(update => update.id)).toEqual(['today', 'first-day', 'too-old', 'future', 'undated']);
    expect(updatesForCollection(history, undefined)).toBe(history);
  });
  it('leaves an empty real collection empty instead of substituting sample items', () => {
    expect(updatesForCollection(history, { ...collection, sourceIds: [] })).toEqual([]);
  });
  it.each([
    { days: 30, now: '2026-10-21T12:00:00Z', firstInstant: '2026-09-22T00:00:00+02:00' },
    { days: 14, now: '2026-10-21T12:00:00Z', firstInstant: '2026-10-08T00:00:00+02:00' },
    { days: 7, now: '2026-10-21T12:00:00Z', firstInstant: '2026-10-15T00:00:00+02:00' },
    { days: 3, now: '2026-10-21T12:00:00Z', firstInstant: '2026-10-19T00:00:00+02:00' },
    { days: 3, now: '2027-01-02T12:00:00Z', firstInstant: '2026-12-31T00:00:00+01:00' },
    { days: 3, now: '2026-03-30T10:00:00Z', firstInstant: '2026-03-28T00:00:00+01:00' },
    { days: 3, now: '2026-10-26T11:00:00Z', firstInstant: '2026-10-24T00:00:00+02:00' },
  ])('starts $days calendar days at Berlin midnight for $now', ({ days, now, firstInstant }) => {
    const first = new Date(firstInstant);
    const entries = [
      item('before-window', 'tech-main', new Date(first.getTime() - 1).toISOString()),
      item('first-instant', 'tech-main', first.toISOString()),
      item('now', 'tech-person', now),
      item('next-day', 'tech-main', new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString()),
      item('other-source', 'other-channel', now),
      { ...item('invalid', 'tech-main', ''), publishedAt: 'not-a-date' },
    ];
    expect(updatesForCollection(entries, collection, { days, timezone: 'Europe/Berlin', now: new Date(now) }).map(update => update.id)).toEqual(['first-instant', 'now']);
  });
  it('uses an inclusive exact 24-hour window and rejects invalid, future and unrelated items', () => {
    const entries = [
      item('too-old', 'tech-main', '2026-10-20T12:34:56.788Z'),
      item('boundary', 'tech-main', '2026-10-20T12:34:56.789Z'),
      item('recent', 'tech-person', '2026-10-21T10:00:00Z'),
      item('now', 'tech-main', '2026-10-21T12:34:56.789Z'),
      item('future', 'tech-main', '2026-10-21T12:34:56.790Z'),
      item('other-source', 'other-channel', '2026-10-21T10:00:00Z'),
      item('undated', 'tech-main', ''),
      { ...item('invalid', 'tech-main', ''), publishedAt: 'not-a-date' },
    ];
    expect(updatesForCollection(entries, collection, { hours: 24, timezone: 'Europe/Berlin', now: new Date('2026-10-21T12:34:56.789Z') }).map(update => update.id)).toEqual(['boundary', 'recent', 'now']);
    expect(updatesForCollection(entries, { ...collection, sourceIds: [] }, { hours: 24, now: new Date('2026-10-21T12:34:56.789Z') })).toEqual([]);
  });
  it.each([
    { now: '2027-01-01T12:00:00Z', firstInstant: '2026-12-31T12:00:00Z' },
    { now: '2026-03-29T10:00:00Z', firstInstant: '2026-03-28T10:00:00Z' },
    { now: '2026-10-25T11:00:00Z', firstInstant: '2026-10-24T11:00:00Z' },
  ])('keeps 24 elapsed hours across year and clock changes for $now', ({ now, firstInstant }) => {
    const first = new Date(firstInstant);
    const entries = [
      item('too-old', 'tech-main', new Date(first.getTime() - 1).toISOString()),
      item('boundary', 'tech-main', firstInstant),
      item('now', 'tech-main', now),
    ];
    for (const timezone of ['Europe/Berlin', 'America/New_York', 'UTC']) {
      expect(updatesForCollection(entries, collection, { hours: 24, timezone, now: new Date(now) }).map(update => update.id)).toEqual(['boundary', 'now']);
    }
  });
});


describe('separate collected archive', () => {
  it('keeps long transcript content intact in the separate archive', () => {
    const transcript = 'a'.repeat(180000);
    expect(sanitizeArchivedUpdate({ ...item('long', 'tech-main', '2026-10-20T10:00:00Z'), content: transcript })?.content).toBe(transcript);
  });
  it('uses the archive correction for duplicate IDs, preserves manual feed imports and never mutates saved JSON', () => {
    const imported = [item('shared', 'tech-main', '2026-10-20T10:00:00Z'), item('manual', 'tech-person', '2026-10-19T10:00:00Z')];
    const state = { ...workspace(), importedUpdates: imported };
    const before = JSON.stringify(state);
    const archived = [{ ...imported[0], summary: 'Corrected archive record.' }, item('archive-only', 'tech-main', '2026-10-21T10:00:00Z')];
    const merged = mergeWorkspaceUpdates(state.importedUpdates, archived);
    expect(merged.map(update => update.id)).toEqual(['archive-only', 'shared', 'manual']);
    expect(merged.find(update => update.id === 'shared')?.summary).toBe('Corrected archive record.');
    expect(JSON.stringify(state)).toBe(before);
    expect(state.importedUpdates).not.toContain(archived[1]);
  });
});
