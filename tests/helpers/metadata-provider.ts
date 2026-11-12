import { createHash } from 'node:crypto';
import { FORMAT_ADAPTER, formatRequestPlan, formatStageKey, type FormatProviderContract, type JoinedMetadataIntent } from '../../netlify/functions/_shared/youtube-format-provider';

const canonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v);
export const metadataHash = (v: string) => createHash('sha256').update(v).digest('hex');
/** Synthetic identities/pricing only; no retained private source or account. */
export function metadataFixture(purpose: 'qualification' | 'repair' = 'qualification') {
 const target = { url: 'https://www.youtube.com/watch?v=abcdefghijk', channelId: 'UCabcdefghijklmnopqrstuv', contentHash: metadataHash('Retained original words for offline testing.'), sourceFingerprint: 'c'.repeat(32) };
 const price = { startedAt: '2020-01-01T00:00:00.000Z', pricingModel: 'PAY_PER_EVENT', synthetic: true };
 const contract: FormatProviderContract = { version: FORMAT_ADAPTER, actorRef: 'admirala/youtube-scraper', actorId: 'ActorMock123', buildId: 'BuildMock123', buildNumber: '0.1.7', originalAccountId: 'AccountMock123', pricingSha256: metadataHash(canonical(price)), inputSchemaSha256: 'a'.repeat(64), maximumUsd: '0.005', maximumItems: 1 };
 const schema = { type: 'object', properties: Object.fromEntries(Object.keys(formatRequestPlan(contract, target).input).map(key => [key, {}])) };
 contract.inputSchemaSha256 = metadataHash(canonical(schema));
 const plan = formatRequestPlan(contract, target);
 const intent: JoinedMetadataIntent = { scopeId: '55555555-5555-4555-8555-555555555555', purpose, contract, target, preparedDigest: 'd'.repeat(64), itemKey: formatStageKey(contract, target, purpose), requestSha256: plan.requestSha256, requestCanonical: plan.requestCanonical, inputCanonical: plan.inputCanonical, archiveId: 'old-tech-id', archiveRevision: '2026-10-22T12:00:00.000Z', id: '66666666-6666-4666-8666-666666666666', jobId: '44444444-4444-4444-8444-444444444444', reservationId: '33333333-3333-4333-8333-333333333333', providerRunId: 'RunMock123', state: 'running', actualCostUsd: null, observedCostUsd: null };
 const run = { id: 'RunMock123', actId: contract.actorId, buildId: contract.buildId, userId: contract.originalAccountId, status: 'SUCCEEDED', options: { maxTotalChargeUsd: .005 }, usageTotalUsd: .0012, finishedAt: '2020-01-01T00:00:00.000Z', defaultDatasetId: 'DatasetMock123' };
 const row = { id: 'abcdefghijk', videoId: 'abcdefghijk', url: target.url, channelId: target.channelId, isShort: false, isLive: false };
 const env = (key: string) => ({ APIFY_RUNTIME_ENABLED: 'true', APIFY_API_TOKEN: 'synthetic-not-a-credential', COLLECTION_ALLOWED_USER_IDS: 'hourly-test-reader' } as Record<string, string>)[key];
 return { target, contract, price, schema, plan, intent, run, row, env };
}
