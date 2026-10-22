import type { CollectionResult, Platform, Source } from './types';

export interface CollectionHealth {
  authConfigured: boolean; feedEnabled: boolean; apifyEnabled: boolean; automaticScheduling: boolean;
  platforms: Record<Platform, { configured: boolean; mode: 'feed' | 'apify' | 'unavailable' }>;
}
export interface CollectionOptions { signal?: AbortSignal; onProgress?: (message: string) => void }

export function detectCollectionPlatform(value: string): Platform | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:') return null;
    if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return 'YouTube';
    if (['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) return 'X';
    if (host === 'instagram.com') return 'Instagram';
    if (host === 'linkedin.com') return 'LinkedIn';
    if (host.endsWith('.substack.com')) return 'Substack';
    return 'Blog';
  } catch { return null; }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new Error('The collection service is unavailable. Open the app through Netlify development or its deployed address.'); }
  if (!response.ok) {
    const error = data.error as { message?: string } | undefined;
    throw new Error(error?.message || 'Collection could not finish. Try again later.');
  }
  return data;
}

export async function getCollectionHealth(): Promise<CollectionHealth> {
  return await responseBody(await fetch('/api/health', { cache: 'no-store' })) as unknown as CollectionHealth;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason || new DOMException('Polling stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Aborting stops browser polling. A provider job already started keeps its server-side 120s/cost bounds. */
export async function collectSource(source: Source, getToken: () => Promise<string | null>, options: CollectionOptions = {}): Promise<CollectionResult> {
  async function headers(): Promise<Record<string, string>> {
    const token = await getToken();
    if (!token) throw new Error('Sign in to collect your sources.');
    return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  }
  let data = await responseBody(await fetch('/api/collect', { method: 'POST', headers: await headers(), body: JSON.stringify({ source }), signal: options.signal }));
  const jobToken = typeof data.jobToken === 'string' ? data.jobToken : '';
  for (let attempt = 0; attempt < 90; attempt++) {
    if (data.status === 'completed' && data.result) return data.result as CollectionResult;
    if (data.status === 'failed') throw new Error(typeof data.message === 'string' ? data.message : 'The provider job stopped. No automatic retry was started.');
    if (data.status !== 'running' || !jobToken) throw new Error('The collection service returned an invalid job.');
    options.onProgress?.(typeof data.message === 'string' ? data.message : 'Collection is running.');
    await pause(2000, options.signal);
    data = await responseBody(await fetch('/api/collect', { headers: { ...await headers(), 'x-collection-job': jobToken }, signal: options.signal }));
  }
  throw new Error('Collection has not finished. The provider run has a fixed time and cost limit; this page stopped polling.');
}
