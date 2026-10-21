import type { CollectionResult, Creator, FollowScope, Platform, ReaderSettings, Source, SourceUpdate, WorkspaceState } from './types';
import { createDefaultWorkspace, sampleSources } from './fixtures';

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
  if (!object(value) || typeof value.id !== 'string' || typeof value.url !== 'string' || !isPublicWebUrl(value.url) || !PLATFORMS.includes(value.platform as Platform)) return null;
  return { id: value.id.slice(0, 200), name: typeof value.name === 'string' ? value.name.slice(0, 200) : value.url, url: value.url.slice(0, 2000), platform: value.platform as Platform, creatorIds: stringList(value.creatorIds, 30), status: ['pending', 'ready', 'failed', 'sample'].includes(value.status as string) ? value.status as Source['status'] : 'pending', ...(typeof value.description === 'string' ? { description: value.description.slice(0, 2000) } : {}), ...(typeof value.feedUrl === 'string' && isPublicWebUrl(value.feedUrl) ? { feedUrl: value.feedUrl.slice(0, 2000) } : {}) };
}

function sanitizeUpdate(value: unknown): SourceUpdate | null {
  if (!object(value) || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.url !== 'string' || !isPublicWebUrl(value.url) || typeof value.publishedAt !== 'string' || (value.publishedAt !== '' && !dateKey(value.publishedAt))) return null;
  return { id: value.id.slice(0, 250), sourceId: value.sourceId.slice(0, 200), title: typeof value.title === 'string' ? value.title.slice(0, 1000) : 'Untitled update', summary: typeof value.summary === 'string' ? value.summary.slice(0, 10000) : '', url: value.url.slice(0, 2000), publishedAt: value.publishedAt ? new Date(value.publishedAt).toISOString() : '', format: ['video', 'article', 'podcast', 'post'].includes(value.format as string) ? value.format as SourceUpdate['format'] : 'article', contributorIds: stringList(value.contributorIds, 30), topics: stringList(value.topics, 30), brands: stringList(value.brands, 50), sponsors: stringList(value.sponsors, 30), insights: stringList(value.insights, 30), references: Array.isArray(value.references) ? value.references.filter(object).filter(reference => typeof reference.url === 'string' && isPublicWebUrl(reference.url)).slice(0, 30).map(reference => ({ title: typeof reference.title === 'string' ? reference.title.slice(0, 500) : 'Reference', url: reference.url as string })) : [], isSample: value.isSample === true, ...(typeof value.coverage === 'string' ? { coverage: value.coverage.slice(0, 2000) } : {}), ...(typeof value.content === 'string' ? { content: value.content.slice(0, 100000) } : {}), ...(['feed_text', 'transcript', 'metadata_only'].includes(value.contentKind as string) ? { contentKind: value.contentKind as SourceUpdate['contentKind'] } : {}), ...(typeof value.duration === 'string' ? { duration: value.duration.slice(0, 100) } : {}), ...(typeof value.image === 'string' && isPublicWebUrl(value.image) ? { image: value.image.slice(0, 2000) } : {}) };
}

export function sanitizeWorkspace(value: unknown): WorkspaceState | null {
  if (!object(value) || value.version !== 1 || !object(value.settings) || !Array.isArray(value.followedSourceIds) || !Array.isArray(value.customSources) || !Array.isArray(value.importedUpdates)) return null;
  const followScopes: FollowScope[] | undefined = Array.isArray(value.followScopes) ? value.followScopes.filter(object).filter(scope => ['source', 'creator'].includes(scope.kind as string) && typeof scope.id === 'string').slice(0, 200).map(scope => ({ kind: scope.kind as FollowScope['kind'], id: (scope.id as string).slice(0, 200), ...(scope.kind === 'creator' && Array.isArray(scope.sourceIds) ? { sourceIds: stringList(scope.sourceIds, 50) } : {}) })) : undefined;
  const reservedSourceIds = new Set(sampleSources.map(source => source.id));
  const customSources = [...new Map(value.customSources.map(sanitizeSource).filter((source): source is Source => !!source && !reservedSourceIds.has(source.id)).slice(0, 200).map(source => [source.id, source])).values()];
  const customIds = new Set(customSources.map(source => source.id));
  const importedUpdates = [...new Map(value.importedUpdates.map(sanitizeUpdate).filter((update): update is SourceUpdate => !!update && !update.isSample && !update.id.startsWith('sample-') && customIds.has(update.sourceId)).slice(0, 3000).map(update => [update.id, update])).values()];
  return { version: 1, followedSourceIds: stringList(value.followedSourceIds, 50), ...(followScopes ? { followScopes } : {}), savedUpdateIds: stringList(value.savedUpdateIds, 3000), readLaterIds: stringList(value.readLaterIds, 3000), settings: sanitizeSettings(value.settings), customSources, importedUpdates };
}

export function mergeCollection(state: WorkspaceState, result: CollectionResult): WorkspaceState {
  const source = sanitizeSource(result.source);
  if (!source) throw new Error('The collector returned an invalid source. Nothing was imported.');
  const nextUpdates = result.updates.map(sanitizeUpdate).filter((update): update is SourceUpdate => !!update && update.sourceId === source.id);
  const updates = new Map(state.importedUpdates.map(update => [update.id, update]));
  const existingByUrl = new Map(state.importedUpdates.map(update => [`${update.sourceId}:${update.url}`, update.id]));
  for (const update of nextUpdates) {
    const key = `${update.sourceId}:${update.url}`;
    const previousId = existingByUrl.get(key);
    if (previousId && previousId !== update.id) updates.delete(previousId);
    updates.set(update.id, update); existingByUrl.set(key, update.id);
  }
  const importedUpdates = [...updates.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (importedUpdates.length > 3000) throw new Error('This early version can store 3,000 collected updates. Export or reset the workspace before collecting more; nothing was silently removed.');
  return { ...state, customSources: [...state.customSources.filter(item => item.id !== source.id), source], importedUpdates };
}
