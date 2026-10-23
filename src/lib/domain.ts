import type { CollectionResult, Creator, FollowScope, Platform, ReaderSettings, Source, SourceCollection, SourceUpdate, WorkspaceState } from './types';
import { sanitizePostMedia } from './post-media';
import { sanitizePostContext } from './post-context';
import { createDefaultWorkspace, isFictionalSource, isFictionalUpdate, removeFictionalWorkspaceContent } from './fixtures';

export const LIMITS = { sources: 50, xSources: 15, dailyUpdates: 200, monthlyUpdates: 3000, generatedAudioMinutes: 300 } as const;
export const LANGUAGES = ['en', 'de', 'es', 'fr', 'it', 'pt-BR'] as const;
export const PLATFORMS: Platform[] = ['YouTube', 'X', 'Instagram', 'LinkedIn', 'Podcast', 'Substack', 'Blog'];
export const unique = <T,>(items: T[]): T[] => [...new Set(items)];
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringList = (value: unknown, max = 100): string[] => Array.isArray(value) ? unique(value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.slice(0, 500))).slice(0, max) : [];

export function isPublicWebUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.startsWith('[') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return false;
    // Reject numeric addresses, including alternate forms URL normalizes to IPv4.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return true;
  } catch { return false; }
}

export function normalizeSourceUrl(input: string): { url: string; platform: Platform; name: string } {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!isPublicWebUrl(candidate)) throw new Error('Paste a public website or creator link. Private addresses, passwords and unsupported link types are not accepted.');
  const url = new URL(candidate);
  if([...url.searchParams.keys()].some(key=>/^(?:access_token|token|auth|authorization|api[_-]?key|secret|password|x-amz-.+|signature)$/i.test(key))) throw new Error('Use a public source link without an access token, password or signed-link credential.');
  url.protocol = 'https:'; url.port = ''; url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort();
  let host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (['twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(host)) host = 'x.com';
  if (['m.youtube.com'].includes(host)) host = 'youtube.com';
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const parts = url.pathname.split('/').filter(Boolean);
  let platform: Platform = 'Blog';
  if (host === 'youtube.com') {
    platform = 'YouTube';
    if(parts.length>1 && ['videos','featured','shorts','streams'].includes(parts.at(-1)!) && (parts[0].startsWith('@') || ['channel','user','c'].includes(parts[0]))) { parts.pop(); url.pathname='/'+parts.join('/'); }
    const named=parts.length===1 && /^[A-Za-z0-9_@.-]+$/.test(parts[0]||'') && !['watch','results','feed','playlist','shorts','gaming','premium','account','upload','live','subscriptions'].includes(parts[0].toLowerCase());
    const prefixed=parts.length===2 && ['channel','user','c'].includes(parts[0]) && /^[A-Za-z0-9_.-]+$/.test(parts[1]);
    if (!(named || prefixed)) throw new Error('Paste a public YouTube channel link, rather than a video, playlist or account page.');
  } else if (host === 'youtu.be') throw new Error('Paste the YouTube channel link, rather than a video link.');
  else if (host === 'x.com') {
    platform = 'X';
    if (parts.length !== 1 || ['home', 'search', 'explore', 'i', 'messages', 'settings', 'intent'].includes(parts[0].toLowerCase())) throw new Error('Paste a public X profile link, rather than a post or private page.');
    url.pathname = `/${parts[0].toLowerCase()}`;
  } else if (host === 'instagram.com') {
    platform = 'Instagram';
    if (parts.length !== 1 || ['p', 'reel', 'reels', 'stories', 'direct', 'accounts', 'explore'].includes(parts[0].toLowerCase())) throw new Error('Paste a public Instagram profile link. Posts, Stories and private inboxes are not supported.');
    url.pathname = `/${parts[0].toLowerCase()}`;
  } else if (host === 'linkedin.com') {
    platform = 'LinkedIn';
    if (parts.length < 2 || !['in', 'company', 'school'].includes(parts[0])) throw new Error('Paste a public LinkedIn person or company page.');
    url.pathname = `/${parts[0]}/${parts[1]}`;
  } else if (host.endsWith('.substack.com') || host === 'substack.com') {
    platform = 'Substack';
    if (host === 'substack.com') throw new Error('Paste the publication’s public Substack website, rather than the Substack reader.');
  } else if (/podcasts?\./.test(host) || ['feeds.megaphone.fm', 'feeds.simplecast.com', 'feeds.buzzsprout.com', 'anchor.fm', 'feeds.acast.com', 'podcasts.apple.com', 'open.spotify.com'].includes(host) || /podcast/i.test(url.pathname)) platform = 'Podcast';
  if (['YouTube', 'X', 'Instagram', 'LinkedIn'].includes(platform)) url.search = '';
  const namePart = url.pathname.split('/').filter(Boolean).at(-1)?.replace(/^@/, '') || host.split('.')[0];
  let name = namePart;
  try { name = decodeURIComponent(namePart); } catch { /* Keep the URL-safe spelling. */ }
  return { url: url.toString().replace(/\/$/, ''), platform, name: name.replace(/[-_]/g, ' ').slice(0, 100) };
}

/** Stable non-secret identifiers; URL equality, rather than the hash alone, handles deduplication. */
export function sourceIdForUrl(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index++) hash = Math.imul(hash ^ url.charCodeAt(index), 16777619);
  return `source-${(hash >>> 0).toString(36)}`;
}

export function scopesFor(state: WorkspaceState): FollowScope[] {
  return state.followScopes ?? unique(state.followedSourceIds).map(id => ({ kind: 'source' as const, id }));
}

export function resolveFollowedSources(scopes: FollowScope[], creators: Creator[], sources: Source[]): string[] {
  const available = new Set(sources.map(source => source.id));
  return unique(scopes.flatMap(scope => scope.kind === 'source' ? [scope.id] : scope.sourceIds ?? creators.find(creator => creator.id === scope.id)?.sourceIds ?? [])).filter(id => available.has(id));
}

export function applyFollowToggle(state: WorkspaceState, scope: FollowScope, creators: Creator[], sources: Source[]): WorkspaceState {
  const scopes = scopesFor(state);
  const exists = scopes.some(item => item.kind === scope.kind && item.id === scope.id);
  const newScope = scope.kind === 'creator' ? { ...scope, sourceIds: [...(creators.find(creator => creator.id === scope.id)?.sourceIds ?? [])] } : scope;
  const nextScopes = exists ? scopes.filter(item => item.kind !== scope.kind || item.id !== scope.id) : [...scopes, newScope];
  const followedSourceIds = resolveFollowedSources(nextScopes, creators, sources);
  if (followedSourceIds.length > LIMITS.sources) throw new Error(`This workspace allows ${LIMITS.sources} followed sources. Remove a source before adding another.`);
  if (sources.filter(source => followedSourceIds.includes(source.id) && source.platform === 'X').length > LIMITS.xSources) throw new Error(`This workspace allows up to ${LIMITS.xSources} X sources.`);
  return { ...state, followScopes: nextScopes, followedSourceIds };
}

export function followReasons(state: WorkspaceState, sourceId: string, creators: Creator[]): string[] {
  return scopesFor(state).flatMap(scope => scope.kind === 'source' ? scope.id === sourceId ? ['Followed directly'] : [] : (scope.sourceIds ?? creators.find(creator => creator.id === scope.id)?.sourceIds)?.includes(sourceId) ? [creators.find(creator => creator.id === scope.id)?.name ?? 'Creator follow'] : []);
}

export function dateKey(value: string | Date, timezone = 'UTC'): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
  } catch { return date.toISOString().slice(0, 10); }
}

/** Use an actual channel identity unless the update explicitly credits a known contributor. */
export function updateIdentity(update: SourceUpdate, sources: Source[], creators: Creator[]): { name: string; source?: Source; contributor?: Creator; publisher?: Creator } {
  const source = sources.find(item => item.id === update.sourceId);
  const contributor = update.contributorIds.map(id => creators.find(creator => creator.id === id)).find((creator): creator is Creator => !!creator);
  const publisher = source ? source.creatorIds.map(id => creators.find(creator => creator.id === id)).find((creator): creator is Creator => !!creator) : undefined;
  return { name: contributor?.name || source?.name || 'Unknown source', source, contributor, publisher };
}

/** Channel ownership is enough to navigate a creator; it does not assert a presenter credit. */
export function creatorMatchesUpdate(creator: Creator, update: SourceUpdate): boolean {
  return creator.sourceIds.includes(update.sourceId) || update.contributorIds.includes(creator.id);
}

/** Collection windows use reader calendar days or exact rolling hours and keep source membership. */
export function updatesForCollection(updates: SourceUpdate[], collection: SourceCollection | undefined, options: { days?: number; hours?: number; timezone?: string; now?: Date } = {}): SourceUpdate[] {
  if (!collection) return updates;
  const sourceIds = new Set(collection.sourceIds);
  if (options.hours !== undefined) {
    const now = (options.now ?? new Date()).getTime();
    const firstInstant = now - options.hours * 60 * 60 * 1000;
    return updates.filter(update => {
      if (!sourceIds.has(update.sourceId)) return false;
      const publishedAt = Date.parse(update.publishedAt);
      return Number.isFinite(publishedAt) && publishedAt >= firstInstant && publishedAt <= now;
    });
  }
  if (!options.days) return updates.filter(update => sourceIds.has(update.sourceId));
  const today = dateKey(options.now ?? new Date(), options.timezone);
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - options.days + 1);
  const firstDay = start.toISOString().slice(0, 10);
  return updates.filter(update => {
    const day = dateKey(update.publishedAt, options.timezone);
    return sourceIds.has(update.sourceId) && !!day && day >= firstDay && day <= today;
  });
}

export function saveSourceCollection(state: WorkspaceState, collection: SourceCollection, sources: Source[]): WorkspaceState {
  const name = collection.name.trim().slice(0, 80);
  if (!name) throw new Error('Give this collection a name.');
  const existing = state.sourceCollections ?? [];
  if (!existing.some(item => item.id === collection.id) && existing.length >= 30) throw new Error('This workspace allows 30 collections.');
  const available = new Set(sources.map(source => source.id));
  const saved = { ...collection, name, sourceIds: unique(collection.sourceIds).filter(id => available.has(id)).slice(0, 200) };
  return { ...state, sourceCollections: [...existing.filter(item => item.id !== saved.id), saved], activeCollectionId: saved.id };
}

export function removeSourceCollection(state: WorkspaceState, id: string): WorkspaceState {
  const { activeCollectionId, ...rest } = state;
  return { ...rest, sourceCollections: (state.sourceCollections ?? []).filter(item => item.id !== id), ...(activeCollectionId && activeCollectionId !== id ? { activeCollectionId } : {}) };
}

/** Shorts remain collected and exportable; these preferences affect presentation only. */
export function sourceShowsShorts(state: WorkspaceState, sourceId: string): boolean {
  return state.sourcePreferences?.[sourceId]?.showShorts !== false;
}

export function withSourceShortsPreference(state: WorkspaceState, sourceId: string, showShorts: boolean): WorkspaceState {
  if (!state.customSources.some(source => source.id === sourceId)) throw new Error('This source no longer exists.');
  return { ...state, sourcePreferences: { ...state.sourcePreferences, [sourceId]: { showShorts } } };
}

/** Provider flags and canonical Shorts links are evidence; duration alone is not. */
export function isShortUpdate(update: SourceUpdate): boolean {
  if (update.isShort === true) return true;
  try {
    const url = new URL(update.url);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase()) && /^\/shorts\/[^/]+\/?$/.test(url.pathname);
  } catch { return false; }
}

export function updatesForSourcePreferences(updates: SourceUpdate[], state: WorkspaceState): SourceUpdate[] {
  return updates.filter(update => sourceShowsShorts(state, update.sourceId) || !isShortUpdate(update));
}

export interface UpdateFilter { query?: string; sourceIds?: string[]; creatorId?: string; day?: string; timezone?: string; platform?: Platform | 'all'; savedIds?: string[]; }
export function filterUpdates(updates: SourceUpdate[], sources: Source[], filter: UpdateFilter = {}): SourceUpdate[] {
  const query = (filter.query ?? '').trim().toLocaleLowerCase();
  return updates.filter(update => {
    const source = sources.find(item => item.id === update.sourceId);
    if (filter.sourceIds && !filter.sourceIds.includes(update.sourceId)) return false;
    if (filter.savedIds && !filter.savedIds.includes(update.id)) return false;
    if (filter.day && dateKey(update.publishedAt, filter.timezone) !== filter.day) return false;
    if (filter.platform && filter.platform !== 'all' && source?.platform !== filter.platform) return false;
    if (filter.creatorId && !source?.creatorIds.includes(filter.creatorId) && !update.contributorIds.includes(filter.creatorId)) return false;
    return !query || [update.title, update.summary, update.content ?? '', source?.name ?? '', ...update.topics, ...update.brands, ...update.sponsors].join(' ').toLocaleLowerCase().includes(query);
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export interface TopicGroup { topic: string; updates: SourceUpdate[]; sourceCount: number; relevance: number; isSample: boolean }
export function groupTopics(updates: SourceUpdate[], interests: string[] = []): TopicGroup[] {
  const groups = new Map<string, SourceUpdate[]>();
  for (const update of updates) for (const topic of unique(update.topics.length ? update.topics : ['Other updates'])) groups.set(topic, [...(groups.get(topic) ?? []), update]);
  return [...groups].map(([topic, items]) => ({ topic, updates: items, sourceCount: unique(items.map(update => update.sourceId)).length, relevance: interests.some(interest => interest.toLocaleLowerCase() === topic.toLocaleLowerCase()) ? 1 : 0, isSample: items.every(update => update.isSample) })).sort((a, b) => b.relevance - a.relevance || b.updates.length - a.updates.length || a.topic.localeCompare(b.topic));
}

export function sourceCounts(state: WorkspaceState, sources: Source[], updates: SourceUpdate[]) {
  const followed = sources.filter(source => state.followedSourceIds.includes(source.id));
  return { followed: followed.length, sample: followed.filter(source => source.status === 'sample').length, pending: followed.filter(source => source.status === 'pending').length, ready: followed.filter(source => source.status === 'ready').length, failed: followed.filter(source => source.status === 'failed').length, updated: unique(updates.filter(update => state.followedSourceIds.includes(update.sourceId)).map(update => update.sourceId)).length, updates: updates.filter(update => state.followedSourceIds.includes(update.sourceId)).length };
}

export function sanitizeSettings(value: unknown): ReaderSettings {
  const fallback = createDefaultWorkspace().settings;
  if (!object(value)) return fallback;
  let timezone = typeof value.timezone === 'string' ? value.timezone : fallback.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { timezone = fallback.timezone; }
  return { interests: Array.isArray(value.interests) ? stringList(value.interests, 20) : fallback.interests, interfaceLanguage: LANGUAGES.includes(value.interfaceLanguage as typeof LANGUAGES[number]) ? value.interfaceLanguage as string : fallback.interfaceLanguage, recapLanguage: LANGUAGES.includes(value.recapLanguage as typeof LANGUAGES[number]) ? value.recapLanguage as string : fallback.recapLanguage, timezone, deliveryTime: typeof value.deliveryTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.deliveryTime) ? value.deliveryTime : fallback.deliveryTime, emailReminder: value.emailReminder === true };
}

function sanitizeSource(value: unknown): Source | null {
  if (!object(value) || isFictionalSource(value) || typeof value.id !== 'string' || typeof value.url !== 'string' || !isPublicWebUrl(value.url) || !PLATFORMS.includes(value.platform as Platform)) return null;
  return { id: value.id.slice(0, 200), name: typeof value.name === 'string' ? value.name.slice(0, 200) : value.url, url: value.url.slice(0, 2000), platform: value.platform as Platform, creatorIds: stringList(value.creatorIds, 30), status: ['pending', 'ready', 'failed', 'sample'].includes(value.status as string) ? value.status as Source['status'] : 'pending', ...(typeof value.description === 'string' ? { description: value.description.slice(0, 2000) } : {}), ...(typeof value.feedUrl === 'string' && isPublicWebUrl(value.feedUrl) ? { feedUrl: value.feedUrl.slice(0, 2000) } : {}), ...(typeof value.avatarUrl === 'string' && isPublicWebUrl(value.avatarUrl) ? { avatarUrl: value.avatarUrl.slice(0, 2000) } : {}) };
}

function sanitizeCreator(value: unknown, sourceIds: Set<string>): Creator | null {
  if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim() || !['person', 'studio'].includes(value.kind as string)) return null;
  return { id: value.id.slice(0, 200), name: value.name.slice(0, 200), kind: value.kind as Creator['kind'], handle: typeof value.handle === 'string' ? value.handle.slice(0, 200) : '', bio: typeof value.bio === 'string' ? value.bio.slice(0, 2000) : '', color: typeof value.color === 'string' && /^#[a-f0-9]{6}$/i.test(value.color) ? value.color : '#e3e9e4', initials: typeof value.initials === 'string' ? value.initials.slice(0, 6) : value.name.slice(0, 2), sourceIds: stringList(value.sourceIds, 200).filter(id => sourceIds.has(id)), ...(value.kind === 'studio' ? { presenterIds: stringList(value.presenterIds, 100) } : {}), ...(typeof value.avatarUrl === 'string' && isPublicWebUrl(value.avatarUrl) ? { avatarUrl: value.avatarUrl.slice(0, 2000) } : {}) };
}

export function sanitizeSourceUpdate(value: unknown): SourceUpdate | null {
  if (!object(value) || isFictionalUpdate(value) || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.url !== 'string' || !isPublicWebUrl(value.url) || typeof value.publishedAt !== 'string' || (value.publishedAt !== '' && !dateKey(value.publishedAt))) return null;
  const media = sanitizePostMedia(value.media);
  const postContext = value.format === 'post' ? sanitizePostContext(value.postContext, value.url) : undefined;
  const nonnegativeSeconds = (seconds: unknown): seconds is number => typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= Number.MAX_SAFE_INTEGER;
  const transcriptSegments = Array.isArray(value.transcriptSegments) ? value.transcriptSegments.filter(object).filter(segment => nonnegativeSeconds(segment.startSeconds) && typeof segment.text === 'string' && !!segment.text.trim()).slice(0, 10000).map(segment => ({ startSeconds: segment.startSeconds as number, text: (segment.text as string).slice(0, 10000), ...(nonnegativeSeconds(segment.durationSeconds) ? { durationSeconds: segment.durationSeconds } : {}) })) : undefined;
  const videoHighlights = Array.isArray(value.videoHighlights) ? value.videoHighlights.filter(object).filter(highlight => typeof highlight.text === 'string' && !!highlight.text.trim()).slice(0, 30).map(highlight => ({ text: (highlight.text as string).slice(0, 2000), ...(nonnegativeSeconds(highlight.startSeconds) ? { startSeconds: highlight.startSeconds } : {}) })) : undefined;
  const videoSummary = object(value.videoSummary) && value.videoSummary.ruleVersion === 'takeaways-v1' && ['ready', 'unavailable'].includes(value.videoSummary.status as string) && typeof value.videoSummary.captionHash === 'string' && /^[a-f0-9]{64}$/.test(value.videoSummary.captionHash) && ['captions', 'publisher-chapters', 'none'].includes(value.videoSummary.timingBasis as string) ? { ruleVersion: 'takeaways-v1' as const, status: value.videoSummary.status as 'ready' | 'unavailable', captionHash: value.videoSummary.captionHash, timingBasis: value.videoSummary.timingBasis as 'captions' | 'publisher-chapters' | 'none' } : undefined;
  if (Array.isArray(value.videoKeywords) && value.videoKeywords.length > 500) return null;
  if ((Array.isArray(value.topics) && value.topics.length > 1000) || (Array.isArray(value.brands) && value.brands.length > 1000)) return null;
  const videoKeywords = Array.isArray(value.videoKeywords) ? value.videoKeywords.filter(object).filter(keyword => typeof keyword.label === 'string' && keyword.label.trim()).map(keyword => {
    const ranges = Array.isArray(keyword.ranges) ? keyword.ranges.filter(object).filter(range => nonnegativeSeconds(range.startSeconds) && nonnegativeSeconds(range.endSeconds) && range.endSeconds > range.startSeconds).slice(0, 200).map(range => ({ startSeconds: range.startSeconds as number, endSeconds: range.endSeconds as number })).sort((a, b) => a.startSeconds - b.startSeconds) : [];
    const merged: typeof ranges = [];
    for (const range of ranges) { const last = merged.at(-1); if (last && range.startSeconds <= last.endSeconds) last.endSeconds = Math.max(last.endSeconds, range.endSeconds); else merged.push({ ...range }); }
    return { label: (keyword.label as string).trim().slice(0, 100), ranges: merged, ...(merged.length ? { seconds: merged.reduce((total, range) => total + range.endSeconds - range.startSeconds, 0) } : {}) };
  }) : undefined;
  return { id: value.id.slice(0, 250), sourceId: value.sourceId.slice(0, 200), title: typeof value.title === 'string' ? value.title.slice(0, 1000) : 'Untitled update', summary: typeof value.summary === 'string' ? value.summary.slice(0, 10000) : '', url: value.url.slice(0, 2000), publishedAt: value.publishedAt ? new Date(value.publishedAt).toISOString() : '', format: ['video', 'article', 'podcast', 'post'].includes(value.format as string) ? value.format as SourceUpdate['format'] : 'article', contributorIds: stringList(value.contributorIds, 30), topics: stringList(value.topics, 1000), brands: stringList(value.brands, 1000), sponsors: stringList(value.sponsors, 30), insights: stringList(value.insights, 30), references: Array.isArray(value.references) ? value.references.filter(object).filter(reference => typeof reference.url === 'string' && isPublicWebUrl(reference.url)).slice(0, 30).map(reference => ({ title: typeof reference.title === 'string' ? reference.title.slice(0, 500) : 'Reference', url: reference.url as string })) : [], isSample: value.isSample === true, ...(postContext ? { postContext } : {}), ...(media.length ? { media } : {}), ...(typeof value.coverage === 'string' ? { coverage: value.coverage.slice(0, 2000) } : {}), ...(typeof value.content === 'string' ? { content: value.content.slice(0, 100000) } : {}), ...(['feed_text', 'transcript', 'metadata_only'].includes(value.contentKind as string) ? { contentKind: value.contentKind as SourceUpdate['contentKind'] } : {}), ...(typeof value.duration === 'string' ? { duration: value.duration.slice(0, 100) } : {}), ...(typeof value.image === 'string' && isPublicWebUrl(value.image) ? { image: value.image.slice(0, 2000) } : {}), ...(typeof value.isShort === 'boolean' ? { isShort: value.isShort } : {}), ...(transcriptSegments ? { transcriptSegments } : {}), ...(videoHighlights ? { videoHighlights } : {}), ...(videoSummary ? { videoSummary } : {}), ...(videoKeywords ? { videoKeywords } : {}) };
}

/** Private archive content is already stored separately; do not shorten transcripts to fit workspace JSON. */
export function sanitizeArchivedUpdate(value: unknown): SourceUpdate | null {
  const update = sanitizeSourceUpdate(value);
  if (update && object(value) && typeof value.content === 'string') update.content = value.content;
  return update;
}

export function sanitizeWorkspace(value: unknown): WorkspaceState | null {
  value = removeFictionalWorkspaceContent(value);
  if (!object(value) || value.version !== 1 || !object(value.settings) || !Array.isArray(value.followedSourceIds) || !Array.isArray(value.customSources) || !Array.isArray(value.importedUpdates)) return null;
  const followScopes: FollowScope[] | undefined = Array.isArray(value.followScopes) ? value.followScopes.filter(object).filter(scope => ['source', 'creator'].includes(scope.kind as string) && typeof scope.id === 'string').slice(0, 200).map(scope => ({ kind: scope.kind as FollowScope['kind'], id: (scope.id as string).slice(0, 200), ...(scope.kind === 'creator' && Array.isArray(scope.sourceIds) ? { sourceIds: stringList(scope.sourceIds, 50) } : {}) })) : undefined;
  const customSources = [...new Map(value.customSources.map(sanitizeSource).filter((source): source is Source => !!source).slice(0, 200).map(source => [source.id, source])).values()];
  const customIds = new Set(customSources.map(source => source.id));
  const importedUpdates = [...new Map(value.importedUpdates.map(sanitizeSourceUpdate).filter((update): update is SourceUpdate => !!update && customIds.has(update.sourceId)).slice(0, 3000).map(update => [update.id, update])).values()];
  const knownSourceIds = customIds;
  const sourcePreferences = object(value.sourcePreferences) ? Object.fromEntries(Object.entries(value.sourcePreferences).filter(([id, preference]) => knownSourceIds.has(id) && object(preference) && typeof preference.showShorts === 'boolean').map(([id, preference]) => [id, { showShorts: (preference as Record<string, unknown>).showShorts as boolean }])) : undefined;
  const customCreators = Array.isArray(value.customCreators) ? [...new Map(value.customCreators.map(creator => sanitizeCreator(creator, knownSourceIds)).filter((creator): creator is Creator => !!creator).slice(0, 200).map(creator => [creator.id, creator])).values()] : undefined;
  const people = new Set((customCreators ?? []).filter(creator => creator.kind === 'person').map(creator => creator.id));
  customCreators?.forEach(creator => { if (creator.presenterIds) creator.presenterIds = creator.presenterIds.filter(id => people.has(id)); });
  const sourceCollections: SourceCollection[] | undefined = Array.isArray(value.sourceCollections) ? [...new Map(value.sourceCollections.filter(object).filter(collection => typeof collection.id === 'string' && !!collection.id.trim() && typeof collection.name === 'string' && !!collection.name.trim() && typeof collection.createdAt === 'string' && !!dateKey(collection.createdAt)).slice(0, 30).map(collection => { const item: SourceCollection = { id: (collection.id as string).slice(0, 200), name: (collection.name as string).trim().slice(0, 80), createdAt: new Date(collection.createdAt as string).toISOString(), sourceIds: stringList(collection.sourceIds, 200).filter(id => knownSourceIds.has(id)) }; return [item.id, item] as const; })).values()] : undefined;
  const activeCollectionId = typeof value.activeCollectionId === 'string' && sourceCollections?.some(collection => collection.id === value.activeCollectionId) ? value.activeCollectionId : undefined;
  return { version: 1, followedSourceIds: stringList(value.followedSourceIds, 50), ...(followScopes ? { followScopes } : {}), savedUpdateIds: stringList(value.savedUpdateIds, 3000), readLaterIds: stringList(value.readLaterIds, 3000), settings: sanitizeSettings(value.settings), customSources, importedUpdates, ...(customCreators ? { customCreators } : {}), ...(sourceCollections ? { sourceCollections } : {}), ...(activeCollectionId ? { activeCollectionId } : {}), ...(sourcePreferences ? { sourcePreferences } : {}) };
}

/** Archive records are authoritative when the same imported ID exists in both stores. */
export function mergeWorkspaceUpdates(imported: SourceUpdate[], archived: SourceUpdate[]): SourceUpdate[] {
  return [...new Map([...imported, ...archived].map(update => [update.id, update])).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function mergeCollection(state: WorkspaceState, result: CollectionResult): WorkspaceState {
  const source = sanitizeSource(result.source);
  if (!source) throw new Error('The collector returned an invalid source. Nothing was imported.');
  const nextUpdates = result.updates.map(sanitizeSourceUpdate).filter((update): update is SourceUpdate => !!update && update.sourceId === source.id);
  const updates = new Map(state.importedUpdates.map(update => [update.id, update]));
  const existingByUrl = new Map(state.importedUpdates.map(update => [`${update.sourceId}:${update.url}`, update.id]));
  for (const update of nextUpdates) {
    const key = `${update.sourceId}:${update.url}`;
    const previousId = existingByUrl.get(key);
    const previous = updates.get(update.id) ?? (previousId ? updates.get(previousId) : undefined);
    if (previousId && previousId !== update.id) updates.delete(previousId);
    updates.set(update.id, { ...update, ...(update.isShort === undefined && typeof previous?.isShort === 'boolean' ? { isShort: previous.isShort } : {}) }); existingByUrl.set(key, update.id);
  }
  const importedUpdates = [...updates.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (importedUpdates.length > 3000) throw new Error('This early version can store 3,000 collected updates. Export or reset the workspace before collecting more; nothing was silently removed.');
  const previousSource = state.customSources.find(item => item.id === source.id);
  const updatedSource = { ...source, ...(!source.avatarUrl && previousSource?.avatarUrl ? { avatarUrl: previousSource.avatarUrl } : {}) };
  return { ...state, customSources: [...state.customSources.filter(item => item.id !== source.id), updatedSource], importedUpdates };
}
