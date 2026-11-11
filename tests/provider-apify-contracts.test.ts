import { describe, expect, it, vi } from 'vitest';
import { captionsText, normalizeYouTubeItems, pollStoredApify, startYouTubeMetadata, youtubeInput, YOUTUBE_ACTOR_ID } from '../netlify/functions/_shared/apify';
import type { Source } from '../src/lib/types';
const source: Source = { id: 'contract-source', name: 'Contract source', platform: 'YouTube', url: 'https://www.youtube.com/watch?v=abcdefghijk', creatorIds: [], status: 'ready' };
const values: Record<string, string> = { APIFY_RUNTIME_ENABLED: 'true', APIFY_API_TOKEN: 'synthetic-token', COLLECTION_JOB_SECRET: 'synthetic-secret-of-more-than-32-characters', APIFY_YOUTUBE_BUILD: '0.0.319', APIFY_YOUTUBE_BUILD_ID: 'Build12345', APIFY_MAX_ITEMS: '1', APIFY_MAX_TOTAL_CHARGE_USD: '.005', COLLECTION_ALLOWED_USER_IDS: 'contract-user', HOURLY_COLLECTION_METADATA_VERIFIED: 'true' };
const env = (name: string) => values[name];
describe('bounded metadata-only Apify contract', () => {
 it('requests one exact original with every caption, ASR and generated summary feature disabled', () => {
  expect(youtubeInput(source, 1, 'metadata')).toMatchObject({ startUrls: [{ url: source.url }], maxResults: 1, maxResultsShorts: 0, maxResultStreams: 0, transcriptionAndSubtitle: 'NONE', aiVideoDescription: false, aiVideoSummary: false, saveSubsToKVS: false });
 });
 it('starts only the pinned reviewed run with the unchanged charge cap and no transport restart', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'Run12345', actId: YOUTUBE_ACTOR_ID, buildId: values.APIFY_YOUTUBE_BUILD_ID } })));
  await startYouTubeMetadata(source, 'contract-user', env, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).searchParams.get('maxTotalChargeUsd')).toBe('0.005');
  expect(new URL(url).searchParams.get('restartOnError')).toBe('false');
  expect(JSON.parse(String(request.body)).transcriptionAndSubtitle).toBe('NONE');
 });
 it('blocks without its separate contract gate and never starts a provider run', async () => {
  const fetcher = vi.fn();
  await expect(startYouTubeMetadata(source, 'contract-user', name => name === 'HOURLY_COLLECTION_METADATA_VERIFIED' ? undefined : env(name), fetcher)).rejects.toMatchObject({ code: 'provider_metadata_review_required' });
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('ignores unexpected captions in metadata results and rejects a different exact video', async () => {
  const run = { data: { id: 'Run12345', actId: YOUTUBE_ACTOR_ID, buildId: values.APIFY_YOUTUBE_BUILD_ID, status: 'SUCCEEDED', defaultDatasetId: 'Dataset12345', usageTotalUsd: .004 } };
  const retained = { providerRunId: 'Run12345', actorId: YOUTUBE_ACTOR_ID, source, maxItems: 1, ledgerId: '11111111-1111-4111-8111-111111111111', metadataOnly: true };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(run))).mockResolvedValueOnce(new Response(JSON.stringify([{ url: source.url, isShorts: false, subtitles: [{ srt: 'Unwanted replacement captions.' }] }])));
  const result = await pollStoredApify(retained, 'contract-user', env, fetcher);
  expect(result.result?.updates[0]).toMatchObject({ contentKind: 'metadata_only', videoFormat: { kind: 'regular', basis: 'provider' } });
  expect(result.result?.updates[0]).not.toHaveProperty('content');
  const wrong = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(run))).mockResolvedValueOnce(new Response(JSON.stringify([{ url: 'https://www.youtube.com/watch?v=lmnopqrstuv', isShorts: false }])));
  await expect(pollStoredApify(retained, 'contract-user', env, wrong)).resolves.toMatchObject({ contentError: 'provider_video_unconfirmed', telemetry: { cost: .004 } });
 });
 it('keeps exact upstream authentication status without leaking the provider response body', async () => {
  const fetcher = vi.fn(async () => new Response('private-token-and-provider-details', { status: 401 }));
  await expect(startYouTubeMetadata(source, 'contract-user', env, fetcher)).rejects.toMatchObject({ code: 'provider_authentication_failed', upstreamStatus: 401 });
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects oversized source text rather than importing a clipped transcript as usable content', () => {
  expect(() => captionsText([{ srt: 'x'.repeat(200_001) }])).toThrow();
  expect(() => normalizeYouTubeItems([{ url: source.url, subtitles: [{ srt: 'x'.repeat(200_001) }] }], source)).toThrow();
 });
});
