import { describe, expect, it, vi } from 'vitest';
import { assertPreparedMetadataScope, formatRequestPlan, normalizeMetadataObservation, pollMetadataProvider, preflightMetadataProvider, startMetadataProvider, readMetadataFeeEvidence } from '../netlify/functions/_shared/youtube-format-provider';
import { metadataFixture } from './helpers/metadata-provider';

function provider(options: { account?: string; price?: unknown; schema?: unknown; rows?: unknown[]; runChange?: Record<string, unknown>; rawRun?: string; dataset?: Response } = {}) {
 const f = metadataFixture();
 const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  expect(url.origin).toBe('https://api.apify.com');
  expect(init?.headers).toMatchObject({ authorization: 'Bearer synthetic-not-a-credential' });
  if (url.pathname.endsWith('/users/me')) return Response.json({ data: { id: options.account || f.contract.originalAccountId } });
  if (url.pathname.endsWith('/acts/' + f.contract.actorRef.replace('/', '~'))) return Response.json({ data: { id: f.contract.actorId, pricingInfos: [options.price || f.price] } });
  if (url.pathname.endsWith('/actor-builds/' + f.contract.buildId)) return Response.json({ data: { id: f.contract.buildId, actId: f.contract.actorId, buildNumber: f.contract.buildNumber, status: 'SUCCEEDED', inputSchema: options.schema || f.schema } });
  if (url.pathname.endsWith('/runs')) return Response.json({ data: { ...f.run, ...options.runChange } });
  if (url.pathname.includes('/actor-runs/')) return options.rawRun ? new Response(options.rawRun) : Response.json({ data: { ...f.run, ...options.runChange } });
  if (url.pathname.includes('/datasets/')) {
   expect(Object.fromEntries(url.searchParams)).toMatchObject({ clean: 'false', offset: '0', limit: '2' });
   expect(url.searchParams.get('fields')).not.toMatch(/subtitle|transcript|caption/i);
   return options.dataset || Response.json(options.rows || [f.row]);
  }
  throw new Error('Unexpected offline request');
 });
 return { ...f, fetcher: fetcher as typeof fetch & typeof fetcher };
}
describe('finite candidate provider transport and immutable request authority', () => {
 it('preflights actual account/build/schema/price without dispatch before admission', async () => {
  const f = provider();
  const result = await preflightMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher);
  expect(result).toMatchObject({ originalAccountId: f.contract.originalAccountId, buildNumber: '0.1.7', maximumUsd: '0.005', maximumItems: 1, requestSha256: f.plan.requestSha256 });
  expect(f.fetcher).toHaveBeenCalledTimes(3); expect(f.fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('/acts/admirala~youtube-scraper'))).toBe(true);
 });
 it.each(['account', 'price', 'schema'])('rejects changed %s before a paid request', async field => {
  const f = provider({ ...(field === 'account' ? { account: 'DifferentAccount123' } : field === 'price' ? { price: { startedAt: '2020-01-01T00:00:00.000Z', changed: true } } : { schema: { changed: true } }) });
  await expect(preflightMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher)).rejects.toMatchObject({ code: 'metadata_contract_changed' });
  expect(f.fetcher.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
 });
 it('requires exact frozen wholeplan and input bytes before sending ASR-OFF request exactly once', async () => {
  const f = provider();
  expect(() => assertPreparedMetadataScope({ ...f.intent, inputCanonical: f.intent.inputCanonical.replace('false', 'true') })).toThrow();
  await startMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = f.fetcher.mock.calls[0];
  expect(init?.method).toBe('POST'); expect(init?.body).toBe(f.plan.inputCanonical);
  expect(new URL(String(url)).searchParams.get('maxTotalChargeUsd')).toBe('0.005');
  expect(JSON.parse(String(init?.body))).toMatchObject({ includeTranscript: false, channelInfo: false, channels: [], playlists: [], searchQueries: [], channelVideos: false, channelShorts: false, channelStreams: false });
 });
 it('does not retry POST on a supplier failure and sanitizes its body', async () => {
  const f = provider(); const fetcher = vi.fn(async () => new Response('private supplier diagnostic', { status: 503 }));
  await expect(startMetadataProvider(f.intent, 'hourly-test-reader', f.env, fetcher)).rejects.toMatchObject({ code: 'provider_unavailable', upstreamStatus: 503 });
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('retains an accepted run ID before strict identity validation fails, rather than issuing another POST', async () => {
  const f = provider({ runChange: { buildId: 'WrongBuild123' } });
  expect(await startMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher)).toMatchObject({ providerRunId: f.run.id });
  await expect(pollMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher)).rejects.toMatchObject({ code: 'metadata_run_identity_changed' });
  expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
 });
 it('recovers only the stored run under its frozen contract despite another current legacy build', async () => {
  const f = provider(); const env = (k: string) => k === 'APIFY_YOUTUBE_BUILD_ID' ? 'DifferentLegacyBuild123' : f.env(k);
  const result = await pollMetadataProvider(f.intent, 'hourly-test-reader', env, f.fetcher);
  expect(result.fee).toMatchObject({ runId: f.intent.providerRunId, usageUsd: '0.0012', originalAccountId: f.contract.originalAccountId });
  expect(normalizeMetadataObservation(f.intent, result.run, result.rows)).toMatchObject({ format: { kind: 'regular' }, replayStatus: 'unknown' });
  expect(f.fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
 });
 it('retains zero as a usage observation, without claiming a free settled fee', async () => {
  const f = provider({ runChange: { usageTotalUsd: 0 } });
  expect((await pollMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher)).fee.usageUsd).toBe('0');
 });
 it('keeps exact fee evidence even when a metadata dataset is oversized or has extra rows', async () => {
  for (const options of [{ dataset: new Response('x'.repeat(2 * 1024 * 1024 + 1)) }, { rows: [{}, {}] }]) {
   const f = provider(options); const result = await pollMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher);
   expect(result.fee.usageUsd).toBe('0.0012'); expect(result.contentError).toBeTruthy(); expect(result.rows).toBeUndefined();
  }
 });
 it('rejects ignored projection and does not transport returned transcripts to the enrichment service', async () => {
  const f = metadataFixture(); const p = provider({ rows: [{ ...f.row, subtitles: 'Unexpected speech' }] });
  const result = await pollMetadataProvider(p.intent, 'hourly-test-reader', p.env, p.fetcher);
  expect(result).toMatchObject({ contentError: 'metadata_projection_invalid', fee: { usageUsd: '0.0012' } }); expect(result.rows).toBeUndefined();
 });
 it('keeps raw decimal tokens for native numeric accounting and the joined late-fee path', async () => {
  const f = metadataFixture(), rawRun = JSON.stringify({ data: f.run }).replace('0.0012', '0.00123456789123');
  const p = provider({ rawRun });
  expect((await pollMetadataProvider(p.intent, 'hourly-test-reader', p.env, p.fetcher)).fee.usageUsd).toBe('0.00123456789123');
  const fee = await readMetadataFeeEvidence({ userId: 'hourly-test-reader', providerRunId: p.run.id, actorId: p.contract.actorId, buildId: p.contract.buildId, originalAccountId: p.contract.originalAccountId, contractDigest: 'a'.repeat(64), maximumUsd: '0.005' }, p.env, p.fetcher);
  expect(fee).toMatchObject({ usage_usd: '0.00123456789123', consumer_account: p.contract.originalAccountId, authenticated_owner: true });
 });
 it('rejects run cap drift and malformed/conflicting result fields without trusting producer approval', async () => {
  const f = provider({ runChange: { options: { maxTotalChargeUsd: .006 } } });
  await expect(pollMetadataProvider(f.intent, 'hourly-test-reader', f.env, f.fetcher)).rejects.toMatchObject({ code: 'metadata_run_identity_changed' });
  const p = metadataFixture();
  for (const row of [{ ...p.row, isShort: undefined, passed: true }, { ...p.row, isShorts: true }, { ...p.row, channelId: 'WrongChannel123' }]) expect(() => normalizeMetadataObservation(p.intent, p.run, [row])).toThrow();
  expect(formatRequestPlan(p.contract, p.target).input).not.toHaveProperty('passed');
 });
 it('rejects sub-float cap drift while accepting exact trailing-zero or exponent spellings', async () => {
  for (const cap of ['0.0050000000000000001', '0.005000', '5e-3']) {
   const f = metadataFixture(), p = provider({ rawRun: JSON.stringify({ data: f.run }).replace('"maxTotalChargeUsd":0.005', '"maxTotalChargeUsd":' + cap) });
   const call = pollMetadataProvider(p.intent, 'hourly-test-reader', p.env, p.fetcher);
   if (cap.endsWith('1')) await expect(call).rejects.toMatchObject({ code: 'metadata_fee_invalid' });
   else expect((await call).fee.maximumUsd).toBe('0.005');
  }
 });
 it('allows noncreating frozen-run reconciliation when new provider execution is disabled', async () => {
  const p = provider(), env = (key: string) => key === 'APIFY_RUNTIME_ENABLED' ? 'false' : p.env(key);
  expect((await pollMetadataProvider(p.intent, 'hourly-test-reader', env, p.fetcher)).fee.usageUsd).toBe('0.0012');
  await expect(startMetadataProvider(p.intent, 'hourly-test-reader', env, p.fetcher)).rejects.toMatchObject({ code: 'metadata_provider_disabled' });
  expect(p.fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
 });
});
