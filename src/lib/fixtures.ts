import type { ReaderSettings, WorkspaceState } from './types';

/** Historical identifiers are retained only to remove the retired fictional starter data. */
export const LEGACY_SAMPLE_SOURCE_IDS = ['northstar-main', 'northstar-lab', 'northstar-podcast', 'maya-letter', 'leo-blog', 'fieldwork-linkedin', 'fieldwork-blog', 'signal-x', 'nia-instagram'] as const;
export const LEGACY_SAMPLE_CREATOR_IDS = ['northstar', 'maya', 'leo', 'fieldwork', 'signal', 'nia'] as const;
export const LEGACY_SAMPLE_UPDATE_IDS = ['sample-01', 'sample-02', 'sample-03', 'sample-04', 'sample-05', 'sample-06', 'sample-07', 'sample-08', 'sample-09'] as const;
const legacySources = new Set<string>(LEGACY_SAMPLE_SOURCE_IDS);
const legacyCreators = new Set<string>(LEGACY_SAMPLE_CREATOR_IDS);
const legacyUpdates = new Set<string>(LEGACY_SAMPLE_UPDATE_IDS);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function isLegacySampleUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['example.com', 'www.example.com'].includes(url.hostname.toLowerCase()) && (url.pathname === '/sample' || url.pathname.startsWith('/sample/'));
  } catch { return false; }
}

export function isFictionalSource(value: unknown): boolean {
  return object(value) && ((typeof value.id === 'string' && legacySources.has(value.id)) || value.status === 'sample' || isLegacySampleUrl(value.url));
}

export function isFictionalUpdate(value: unknown): boolean {
  return object(value) && (value.isSample === true || (typeof value.id === 'string' && legacyUpdates.has(value.id)) || (typeof value.sourceId === 'string' && legacySources.has(value.sourceId)) || isLegacySampleUrl(value.url));
}

/**
 * Remove only evidenced fictional records/references. No name matching, prefix deletion,
 * source re-selection or collection reset. Copy on change keeps all unrelated fields intact,
 * including longer source text and metadata unknown to this version of the reader.
 * This accepts raw stored JSON so removed update IDs can be cleaned before validation.
 */
export function removeFictionalWorkspaceContent<T>(value: T): T {
  if (!object(value) || value.version !== 1) return value;
  const removedSources = new Set(legacySources);
  const removedUpdates = new Set(legacyUpdates);
  if (Array.isArray(value.customSources)) for (const source of value.customSources) {
    if (isFictionalSource(source) && object(source) && typeof source.id === 'string') removedSources.add(source.id);
  }
  const fictionalUpdate = (update: unknown) => isFictionalUpdate(update) || (object(update) && typeof update.sourceId === 'string' && removedSources.has(update.sourceId));
  for (const key of ['importedUpdates', 'archivedUpdates']) if (Array.isArray(value[key])) for (const update of value[key]) {
    if (fictionalUpdate(update) && object(update) && typeof update.id === 'string') removedUpdates.add(update.id);
  }
  const keepSource = (id: unknown) => typeof id !== 'string' || !removedSources.has(id);
  const keepCreator = (id: unknown) => typeof id !== 'string' || !legacyCreators.has(id);
  const keepUpdate = (id: unknown) => typeof id !== 'string' || !removedUpdates.has(id);
  const filter = (input: unknown, keep: (item: unknown) => boolean): unknown => {
    if (!Array.isArray(input)) return input;
    const next = input.filter(keep);
    return next.length === input.length ? input : next;
  };
  const cleanRecordLists = (input: unknown, fields: Record<string, (item: unknown) => boolean>): unknown => {
    if (!object(input)) return input;
    let next = input;
    for (const [key, keep] of Object.entries(fields)) {
      const list = filter(input[key], keep);
      if (list !== input[key]) next = { ...next, [key]: list };
    }
    return next;
  };
  const map = (input: unknown, change: (item: unknown) => unknown): unknown => {
    if (!Array.isArray(input)) return input;
    const next = input.map(change);
    return next.every((item, index) => item === input[index]) ? input : next;
  };
  const next: Record<string, unknown> = { ...value };
  next.followedSourceIds = filter(value.followedSourceIds, keepSource);
  next.savedUpdateIds = filter(value.savedUpdateIds, keepUpdate);
  next.readLaterIds = filter(value.readLaterIds, keepUpdate);
  next.customSources = map(filter(value.customSources, source => !isFictionalSource(source)), source => cleanRecordLists(source, { creatorIds: keepCreator }));
  next.customCreators = map(filter(value.customCreators, creator => !object(creator) || keepCreator(creator.id)), creator => cleanRecordLists(creator, { sourceIds: keepSource, presenterIds: keepCreator }));
  next.sourceCollections = map(value.sourceCollections, collection => cleanRecordLists(collection, { sourceIds: keepSource }));
  for (const key of ['importedUpdates', 'archivedUpdates']) next[key] = map(filter(value[key], update => !fictionalUpdate(update)), update => cleanRecordLists(update, { contributorIds: keepCreator, references: reference => !object(reference) || !isLegacySampleUrl(reference.url) }));
  if (Array.isArray(value.followScopes)) {
    const previousScopes = value.followScopes;
    const scopes: unknown[] = [];
    for (const scope of value.followScopes) {
      if (!object(scope)) { scopes.push(scope); continue; }
      if (scope.kind === 'source' && !keepSource(scope.id)) continue;
      if (scope.kind === 'creator' && !keepCreator(scope.id)) {
        // Preserve real channels explicitly included in a retired creator's snapshot.
        if (Array.isArray(scope.sourceIds)) for (const id of scope.sourceIds) if (typeof id === 'string' && keepSource(id)) scopes.push({ kind: 'source', id });
        continue;
      }
      scopes.push(cleanRecordLists(scope, { sourceIds: keepSource }));
    }
    next.followScopes = scopes.length === previousScopes.length && scopes.every((scope, index) => scope === previousScopes[index]) ? previousScopes : scopes;
  }
  if (object(value.sourcePreferences)) {
    const preferences = Object.entries(value.sourcePreferences).filter(([id]) => keepSource(id));
    next.sourcePreferences = preferences.length === Object.keys(value.sourcePreferences).length ? value.sourcePreferences : Object.fromEntries(preferences);
  }
  // Do not add optional fields to historical documents while cleaning their references.
  for (const key of Object.keys(next)) if (!(key in value)) delete next[key];
  return Object.keys(next).every(key => next[key] === value[key]) ? value : next as T;
}

export const defaultSettings: ReaderSettings = {
  interests: ['AI & technology', 'Work & productivity'], interfaceLanguage: 'en', recapLanguage: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', deliveryTime: '08:00', emailReminder: false,
};

export function createDefaultWorkspace(): WorkspaceState {
  return { version: 1, followedSourceIds: [], followScopes: [], savedUpdateIds: [], readLaterIds: [], settings: { ...defaultSettings, interests: [...defaultSettings.interests] }, customSources: [], importedUpdates: [] };
}
