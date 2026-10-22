import type { Creator, Source, SourceMetadata, WorkspaceState } from './types';
import { normalizeSourceUrl } from './domain';

export function isChannelImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['yt3.googleusercontent.com', 'yt3.ggpht.com'].includes(url.hostname) && url.pathname.length > 1;
  } catch { return false; }
}

/** A studio uses its own image when known, otherwise an associated channel. */
export function creatorImageUrl(creator: Creator, sources: Source[]): string | undefined {
  if (creator.avatarUrl) return creator.avatarUrl;
  const channels = creator.sourceIds.map(id => sources.find(source => source.id === id)).filter((source): source is Source => !!source?.avatarUrl);
  const identity = (name: string) => name.toLowerCase().replace(/\bstudio\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return channels.find(source => source.platform === 'YouTube' && identity(source.name) === identity(creator.name))?.avatarUrl
    ?? channels.find(source => source.platform === 'YouTube')?.avatarUrl
    ?? channels[0]?.avatarUrl;
}

/** Enrich only the same saved channel; replies cannot replace its identity or state. */
export function withSourceMetadata(state: WorkspaceState, source: Pick<Source, 'id' | 'url'>, metadata: SourceMetadata): WorkspaceState {
  if (!isChannelImageUrl(metadata.avatarUrl)) return state;
  const current = state.customSources.find(item => item.id === source.id && item.url === source.url && item.platform === 'YouTube');
  if (!current || current.avatarUrl) return state;
  let name = current.name;
  try {
    if (current.name === normalizeSourceUrl(current.url).name) name = metadata.name.trim().slice(0, 200) || current.name;
  } catch { /* Preserve existing operator names and legacy source identities. */ }
  return { ...state, customSources: state.customSources.map(item => item === current ? { ...item, name, avatarUrl: metadata.avatarUrl } : item) };
}

export async function fetchSourceMetadata(source: Source, signal: AbortSignal): Promise<SourceMetadata> {
  const response = await fetch('/api/source-metadata?url=' + encodeURIComponent(source.url), { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error('The channel image could not be loaded.');
  const { metadata } = await response.json();
  if (!metadata || typeof metadata.name !== 'string' || !isChannelImageUrl(metadata.avatarUrl)) throw new Error('The channel did not provide a profile image.');
  return { name: metadata.name.trim().slice(0, 200), avatarUrl: metadata.avatarUrl };
}
