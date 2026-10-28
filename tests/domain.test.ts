import { describe, expect, it } from 'vitest';
import { applyFollowToggle, dateKey, filterUpdates, followReasons, groupTopics, isPublicWebUrl, mergeCollection, normalizeSourceUrl, resolveFollowedSources, sanitizeSettings, sanitizeSourceUpdate, sanitizeWorkspace, sourceCounts, sourceIdForUrl } from '../src/lib/domain';
import { createDefaultWorkspace } from '../src/lib/fixtures';
import { createSampleUpdates, sampleCreators, sampleSources } from './helpers/sample-fixtures';
import type { Source, SourceUpdate, WorkspaceState } from '../src/lib/types';

const empty = (): WorkspaceState => ({ ...createDefaultWorkspace(), followedSourceIds: [], followScopes: [] });
const fixedUpdates = createSampleUpdates(new Date('2026-10-21T16:00:00Z'));

describe('studios, people and overlapping follows', () => {
  it('deduplicates sources when a studio, presenter and source all include one channel', () => {
    const ids = resolveFollowedSources([{ kind: 'creator', id: 'northstar' }, { kind: 'creator', id: 'maya' }, { kind: 'source', id: 'northstar-main' }], sampleCreators, sampleSources);
    expect(ids).toHaveLength(4);
    expect(ids.filter(id => id === 'northstar-main')).toHaveLength(1);
    expect(ids).toContain('maya-letter');
  });
  it('removing a studio keeps channels included by the independently followed presenter', () => {
    let state = applyFollowToggle(empty(), { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    state = applyFollowToggle(state, { kind: 'creator', id: 'maya' }, sampleCreators, sampleSources);
    state = applyFollowToggle(state, { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    expect(state.followedSourceIds.sort()).toEqual(['maya-letter', 'northstar-main', 'northstar-podcast']);
    expect(followReasons(state, 'northstar-main', sampleCreators)).toEqual(['Maya Chen']);
  });
  it('an explicit source follow survives removing a creator', () => {
    let state = applyFollowToggle(empty(), { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    state = applyFollowToggle(state, { kind: 'source', id: 'northstar-lab' }, sampleCreators, sampleSources);
    state = applyFollowToggle(state, { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    expect(state.followedSourceIds).toEqual(['northstar-lab']);
  });
  it('a creator follow snapshots coverage instead of enabling future channels automatically', () => {
    const state = applyFollowToggle(empty(), { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    const newSource: Source = { ...sampleSources[0], id: 'new-northstar-channel' };
    const changedCreators = sampleCreators.map(creator => creator.id === 'northstar' ? { ...creator, sourceIds: [...creator.sourceIds, newSource.id] } : creator);
    expect(resolveFollowedSources(state.followScopes!, changedCreators, [...sampleSources, newSource])).not.toContain(newSource.id);
    const confirmed = applyFollowToggle(state, { kind: 'source', id: newSource.id }, changedCreators, [...sampleSources, newSource]);
    expect(confirmed.followedSourceIds).toContain(newSource.id);
  });
  it('counts a podcast with two presenters as one source and one update', () => {
    const state = { ...empty(), followedSourceIds: ['northstar-podcast'] };
    const counts = sourceCounts(state, sampleSources, fixedUpdates);
    expect(counts.followed).toBe(1); expect(counts.updates).toBe(1); expect(counts.updated).toBe(1);
  });
  it('migrates legacy source selections without inventing creator follows', () => {
    const state = { ...createDefaultWorkspace(), followedSourceIds: sampleSources.map(source => source.id) }; delete state.followScopes;
    const next = applyFollowToggle(state, { kind: 'creator', id: 'northstar' }, sampleCreators, sampleSources);
    expect(next.followedSourceIds).toHaveLength(9);
    expect(next.followScopes?.filter(scope => scope.kind === 'creator')).toHaveLength(1);
  });
});

describe('public pasted source URLs', () => {
  it('normalizes common X aliases, tracking and trailing slashes into the same identity', () => {
    const a = normalizeSourceUrl(' https://www.twitter.com/Example/?utm_source=test#bio ');
    const b = normalizeSourceUrl('x.com/example');
    expect(a).toEqual(b); expect(a.platform).toBe('X');
    expect(sourceIdForUrl(a.url)).toBe(sourceIdForUrl(b.url));
  });
  it.each(['http://localhost:3000', 'https://127.0.0.1', 'http://169.254.169.254/latest/meta-data', 'https://10.0.0.1', 'https://[::1]', 'http://2130706433', 'https://name:password@example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://router.local', 'https://company.internal'])('rejects unsafe or private input %s', input => {
    expect(() => normalizeSourceUrl(input)).toThrow();
    expect(isPublicWebUrl(input)).toBe(false);
  });
  it('accepts supported public creator pages without claiming access is verified', () => {
    expect(normalizeSourceUrl('https://youtube.com/@example').platform).toBe('YouTube');
    expect(normalizeSourceUrl('https://instagram.com/example').platform).toBe('Instagram');
    expect(normalizeSourceUrl('https://linkedin.com/company/example/posts').url).toBe('https://linkedin.com/company/example');
    expect(normalizeSourceUrl('https://example.substack.com').platform).toBe('Substack');
    expect(normalizeSourceUrl('https://feeds.simplecast.com/example').platform).toBe('Podcast');
    expect(normalizeSourceUrl('https://example.com/feed').platform).toBe('Blog');
  });
  it('keeps functional public feed parameters while removing tracking identifiers', () => {
    expect(normalizeSourceUrl('https://example.com/?feed=rss2&utm_source=test').url).toBe('https://example.com/?feed=rss2');
  });
  it.each(['https://x.com/example/status/123', 'https://instagram.com/p/abc', 'https://youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://linkedin.com/messaging', 'https://substack.com/inbox'])('rejects a post/private/platform page as a creator source: %s', input => {
    expect(() => normalizeSourceUrl(input)).toThrow();
  });
});

describe('clear source allowances', () => {
  const sources: Source[] = Array.from({ length: 51 }, (_, i) => ({ id: `source-${i}`, name: `Source ${i}`, platform: 'Blog', url: `https://example.com/${i}`, creatorIds: [], status: 'pending' }));
  it('blocks source 51 without changing existing follows', () => {
    let state = empty();
    for (const source of sources.slice(0, 50)) state = applyFollowToggle(state, { kind: 'source', id: source.id }, [], sources);
    expect(() => applyFollowToggle(state, { kind: 'source', id: sources[50].id }, [], sources)).toThrow('50');
    expect(state.followedSourceIds).toHaveLength(50);
  });
  it('blocks the sixteenth X source separately', () => {
    const xSources: Source[] = sources.slice(0, 16).map(source => ({ ...source, platform: 'X' }));
    let state = empty();
    for (const source of xSources.slice(0, 15)) state = applyFollowToggle(state, { kind: 'source', id: source.id }, [], xSources);
    expect(() => applyFollowToggle(state, { kind: 'source', id: xSources[15].id }, [], xSources)).toThrow('15 X');
  });
});

describe('history, search and honest sample content', () => {
  it('creates all seven platform families with invented, example.com-only sample links', () => {
    expect(new Set(sampleSources.map(source => source.platform)).size).toBe(7);
    for (const update of fixedUpdates) {
      expect(update.isSample).toBe(true); expect(update.coverage).toContain('Fictional');
      expect(new URL(update.url).hostname).toBe('example.com');
      expect(update.references.every(reference => new URL(reference.url).hostname === 'example.com')).toBe(true);
    }
  });
  it('anchors sample history to today and keeps three distinct dates', () => {
    expect([...new Set(fixedUpdates.map(update => dateKey(update.publishedAt)))]).toEqual(['2026-10-21', '2026-10-20', '2026-10-19']);
  });
  it('uses the reader timezone at day boundaries', () => {
    expect(dateKey('2026-10-21T00:30:00Z', 'America/Los_Angeles')).toBe('2026-10-20');
    expect(dateKey('2026-10-20T23:30:00Z', 'Europe/Berlin')).toBe('2026-10-21');
    expect(dateKey('bad date')).toBe('');
  });
  it('searches brands and sponsors as well as titles, with exact source/date filters', () => {
    expect(filterUpdates(fixedUpdates, sampleSources, { query: 'Papertrail' }).map(update => update.id)).toEqual(['sample-05']);
    expect(filterUpdates(fixedUpdates, sampleSources, { day: '2026-10-21', sourceIds: ['maya-letter'], timezone: 'UTC' }).map(update => update.id)).toEqual(['sample-02']);
    expect(filterUpdates(fixedUpdates, sampleSources, { query: 'no matching phrase' })).toEqual([]);
  });
  it('prioritizes explicit interests while preserving every topic in All updates', () => {
    const groups = groupTopics(fixedUpdates, ['Design & culture']);
    expect(groups[0].topic).toBe('Design & culture');
    expect(groups).toHaveLength(4);
    expect(groups.every(group => group.isSample)).toBe(true);
  });
  it('unknown analysis stays an unclassified update, not invented AI topics', () => {
    const update = { ...fixedUpdates[0], topics: [], isSample: false };
    expect(groupTopics([update])[0]).toMatchObject({ topic: 'Other updates', isSample: false });
  });
});

describe('workspace and collection integrity', () => {
  const source: Source = { id: 'real-source', name: 'A publisher', url: 'https://example.org/feed', platform: 'Blog', creatorIds: [], status: 'ready' };
  const update: SourceUpdate = { ...fixedUpdates[0], id: 'real-update', sourceId: source.id, url: 'https://example.org/post', isSample: false, contentKind: 'metadata_only', topics: [], brands: [], sponsors: [], coverage: 'Publisher description only; full-content coverage not verified.' };
  it('imports idempotently and preserves actual coverage and empty analysis', () => {
    let state = mergeCollection(empty(), { source, updates: [update] });
    state = mergeCollection(state, { source, updates: [update] });
    expect(state.importedUpdates).toHaveLength(1); expect(state.customSources).toHaveLength(1);
    expect(state.importedUpdates[0]).toMatchObject({ isSample: false, contentKind: 'metadata_only', topics: [], sponsors: [] });
  });
  it('keeps undated collected items visibly undated rather than silently dropping them', () => {
    const state = mergeCollection(empty(), { source, updates: [{ ...update, publishedAt: '' }] });
    expect(state.importedUpdates).toHaveLength(1);
    expect(state.importedUpdates[0].publishedAt).toBe('');
    expect(filterUpdates(state.importedUpdates, [source], { day: '2026-10-21' })).toHaveLength(0);
    expect(filterUpdates(state.importedUpdates, [source])).toHaveLength(1);
  });
  it('deduplicates the same source item URL even if the collector changes its ID', () => {
    let state = mergeCollection(empty(), { source, updates: [update] });
    state = mergeCollection(state, { source, updates: [{ ...update, id: 'changed-id', summary: 'Corrected' }] });
    expect(state.importedUpdates).toHaveLength(1); expect(state.importedUpdates[0].summary).toBe('Corrected');
  });
  it('rejects cross-source injection and unsafe reference links', () => {
    const state = mergeCollection(empty(), { source, updates: [{ ...update, id: 'wrong', sourceId: 'someone-else' }, { ...update, references: [{ title: 'unsafe', url: 'javascript:alert(1)' }] }] });
    expect(state.importedUpdates).toHaveLength(1); expect(state.importedUpdates[0].references).toEqual([]);
  });
  it('does not silently discard old collected updates at capacity', () => {
    const state = { ...empty(), importedUpdates: Array.from({ length: 3000 }, (_, i) => ({ ...update, id: `old-${i}`, url: `https://example.org/post-${i}` })) };
    expect(() => mergeCollection(state, { source, updates: [update] })).toThrow('3,000');
    expect(state.importedUpdates).toHaveLength(3000);
  });
  it('preserves every keyword through 1,000 and rejects 1,001 without truncating the inventory', () => {
    for (const count of [649, 1000, 1001]) {
      const labels = Array.from({ length: count }, (_, index) => `NamedItem${index}`);
      const input = { ...update, videoKeywords: labels.map(label => ({ label, ranges: [] })), topics: labels, brands: labels };
      const parsed = sanitizeSourceUpdate(input);
      if (count > 1000) expect(parsed).toBeNull();
      else {
        expect(parsed?.videoKeywords?.map(row => row.label)).toEqual(labels);
        expect(parsed?.topics).toEqual(labels); expect(parsed?.brands).toEqual(labels);
      }
      expect(input.videoKeywords).toHaveLength(count);
    }
  });
  it('rejects unsupported saved versions and unsafe source URLs', () => {
    expect(sanitizeWorkspace({ ...empty(), version: 2 })).toBeNull();
    const cleaned = sanitizeWorkspace({ ...empty(), customSources: [{ ...source, url: 'https://127.0.0.1' }] });
    expect(cleaned?.customSources).toEqual([]);
  });
  it('keeps stored custom data from replacing fictional source identities or sample update IDs', () => {
    const cleaned = sanitizeWorkspace({ ...empty(), customSources: [source, { ...source, id: 'northstar-main' }], importedUpdates: [update, { ...update, id: 'sample-01' }, { ...update, id: 'forged-sample', isSample: true }, { ...update, id: 'dangling', sourceId: 'northstar-main' }] });
    expect(cleaned?.customSources.map(item => item.id)).toEqual(['real-source']);
    expect(cleaned?.importedUpdates.map(item => item.id)).toEqual(['real-update']);
  });
  it('validates language, delivery time and timezone without changing unrelated choices', () => {
    const settings = sanitizeSettings({ ...createDefaultWorkspace().settings, recapLanguage: 'de', interfaceLanguage: 'es', deliveryTime: '99:99', timezone: 'not/a-zone', interests: ['Design & culture', 'Design & culture'] });
    expect(settings.recapLanguage).toBe('de'); expect(settings.interfaceLanguage).toBe('es');
    expect(settings.deliveryTime).toBe('08:00'); expect(settings.interests).toEqual(['Design & culture']);
    expect(() => new Intl.DateTimeFormat('en', { timeZone: settings.timezone })).not.toThrow();
  });
});
