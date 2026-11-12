// Private, finite native admission is required before any candidate POST.
import { createHash } from 'node:crypto';
import { youtubeVideoId } from '../../../src/lib/video-format';
import { CollectionError, readTextLimited, type Env } from './security';
import { fetchNoRedirect } from './fetch-no-redirect';
import { retryKnownApifyRead } from './provider-read-retry';
import type { ApifyFeeEvidence } from './apify';

export const FORMAT_ADAPTER = 'apify-youtube-format-v2' as const;
export type FormatActorRef = 'admirala/youtube-scraper' | 'tenfoldfleet/youtube-video-details-lookup';
export interface FormatProviderContract {
 version: typeof FORMAT_ADAPTER;
 actorRef: FormatActorRef;
 actorId: string;
 buildId: string;
 buildNumber: string;
 originalAccountId: string;
 pricingSha256: string;
 inputSchemaSha256: string;
 maximumUsd: '0.005';
 maximumItems: 1;
}
export interface FormatTarget { url: string; channelId: string; contentHash: string; sourceFingerprint: string }
export interface SavedFormatIntent {
 providerRunId: string;
 sourceHash: string;
 contractDigest: string;
 target: FormatTarget;
 contract: FormatProviderContract;
 purpose: 'qualification' | 'repair';
}
export interface PreparedMetadataScope {
 scopeId: string; purpose: 'qualification' | 'repair'; contract: FormatProviderContract; target: FormatTarget;
 preparedDigest: string; itemKey: string; requestSha256: string; requestCanonical: string; inputCanonical: string; archiveId: string; archiveRevision: string;
}
export interface JoinedMetadataIntent extends PreparedMetadataScope {
 id: string; jobId: string; reservationId: string; providerRunId: string | null;
 state: 'launch_claimed' | 'running' | 'completed' | 'failed' | 'ambiguous';
 actualCostUsd: string | number | null; observedCostUsd: string | number | null;
}
export interface MetadataPreflight {
 contractDigest: string; requestSha256: string; actorId: string; buildId: string; buildNumber: string; originalAccountId: string; maximumUsd: '0.005'; maximumItems: 1;
 pricingSha256: string; inputSchemaSha256: string; observedAt: string; responseSha256: string;
}
export interface MetadataFeeEvidence {
 runId: string; actorId: string; buildId: string; originalAccountId: string; status: string;
 maximumUsd: '0.005'; usageUsd: string | null; finishedAt: string | null; observedAt: string; responseSha256: string;
}
export interface MetadataPoll {
 status: 'running' | 'completed' | 'failed'; run: unknown; fee: MetadataFeeEvidence;
 rows?: unknown[]; datasetSha256?: string; contentError?: string;
}
export interface ObservedFormatEvidence {
 videoId: string;
 sourceHash: string;
 contractDigest: string;
 explicitShort: boolean;
 format: { kind: 'short' | 'regular'; basis: 'provider' };
 currentlyLive: boolean | null;
 // isLive=false does not establish that the original was never a live stream.
 replayStatus: 'unknown';
}
const canonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
 : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v) ?? 'null';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const providerId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{6,64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (code: string): never => { throw new CollectionError(502, code, 'The checked metadata contract could not be established.'); };
export function formatContractDigest(contract: FormatProviderContract): string {
 if (!contract || Object.keys(contract).sort().join(',') !== ['version','actorRef','actorId','buildId','buildNumber','originalAccountId','pricingSha256','inputSchemaSha256','maximumUsd','maximumItems'].sort().join(',')
  || contract.version !== FORMAT_ADAPTER || !['admirala/youtube-scraper','tenfoldfleet/youtube-video-details-lookup'].includes(contract.actorRef)
  || ![contract.actorId,contract.buildId,contract.originalAccountId].every(providerId) || !/^\d+\.\d+\.\d+$/.test(contract.buildNumber)
  || !digest(contract.pricingSha256) || !digest(contract.inputSchemaSha256) || contract.maximumUsd !== '0.005' || contract.maximumItems !== 1) return fail('metadata_contract_unreviewed');
 return sha(canonical(contract));
}
function exactTarget(target: FormatTarget): string {
 const id = youtubeVideoId(target?.url);
 if (!id || !/^UC[A-Za-z0-9_-]{22}$/.test(target.channelId) || !digest(target.contentHash) || !/^[a-f0-9]{32,64}$/.test(target.sourceFingerprint)) return fail('metadata_source_changed');
 const url = new URL(target.url);
 if (url.hash || [...url.searchParams.keys()].some(k => k !== 'v')) return fail('metadata_source_changed');
 return id;
}
/** Opaque digest keeps the existing hourly.<UUID>.<key> reservation <=160 chars.
 * Full source hash + contract remain in the private intent side table. */
export function formatStageKey(contract: FormatProviderContract, target: FormatTarget, purpose: SavedFormatIntent['purpose']): string {
 const id = exactTarget(target), contractDigest = formatContractDigest(contract);
 if (!['qualification','repair'].includes(purpose)) return fail('metadata_contract_unreviewed');
 return 'youtube-format-v2:' + id + ':' + sha(canonical({ sourceHash: target.contentHash, sourceFingerprint: target.sourceFingerprint, contractDigest, purpose }));
}
/** Pure request plan only. It neither reserves money nor sends HTTP. Caller
 * must obtain the SAME native finite intent before the single POST. */
export function formatRequestPlan(contract: FormatProviderContract, target: FormatTarget) {
 exactTarget(target); const contractDigest = formatContractDigest(contract);
 const input = contract.actorRef === 'admirala/youtube-scraper'
  ? { videoUrls: [target.url], searchQueries: [], channels: [], playlists: [], videoDetails: true, channelInfo: false,
    includeTranscript: false, channelVideos: false, channelShorts: false, channelStreams: false,
    maxResultsPerQuery: 1, maxResultsPerChannel: 1, maxResultsPerPlaylist: 1, allowResidentialProxy: false }
  : { videos: [target.url], monitorMode: false, maxConcurrency: 1, proxyConfiguration: { useApifyProxy: false } };
 const params = new URLSearchParams({ build: contract.buildNumber, memory: '128', timeout: '120', maxItems: '1', maxTotalChargeUsd: contract.maximumUsd, restartOnError: 'false', waitForFinish: '0' });
 const path = 'acts/' + contract.actorId + '/runs?' + params;
 const requestCanonical = canonical({ contractDigest, target, input, params: params.toString() });
 return { contractDigest, method: 'POST' as const, path, input, requestCanonical, inputCanonical: canonical(input), requestSha256: sha(requestCanonical) };
}
export function assertFormatRun(intent: SavedFormatIntent, value: unknown) {
 if (formatContractDigest(intent.contract) !== intent.contractDigest || intent.sourceHash !== intent.target.contentHash || !providerId(intent.providerRunId)) return fail('metadata_intent_changed');
 if (!object(value) || value.id !== intent.providerRunId || value.actId !== intent.contract.actorId || value.buildId !== intent.contract.buildId || value.userId !== intent.contract.originalAccountId
  || !['READY','RUNNING','TIMING-OUT','ABORTING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(String(value.status))
  || !object(value.options) || value.options.maxTotalChargeUsd !== Number(intent.contract.maximumUsd)) return fail('metadata_run_identity_changed');
 return value;
}
/** Exact positive fields under a reviewed vendor contract; never infer regular
 * from duration, a watch URL, generic type:video or absence from a Shorts list.
 * This observes evidence only. Native qualification/purpose controls decide
 * whether a later guarded archive merge is allowed. */
export function observedFormatEvidence(intent: SavedFormatIntent, runValue: unknown, rows: unknown): ObservedFormatEvidence {
 const run = assertFormatRun(intent, runValue), id = exactTarget(intent.target);
 if (run.status !== 'SUCCEEDED' || !Array.isArray(rows) || rows.length !== 1 || !object(rows[0])) return fail('metadata_result_incomplete');
 const row = rows[0];
 if (row.demo === true || row.error || (row.videoId === undefined && row.id === undefined) || [row.videoId,row.id].some(v => v !== undefined && v !== id)
  || youtubeVideoId(row.url) !== id || row.channelId !== intent.target.channelId) return fail('metadata_result_identity_changed');
 if (typeof row.isShort !== 'boolean' || row.isShorts !== undefined && row.isShorts !== row.isShort || row.isLive !== undefined && row.isLive !== null && typeof row.isLive !== 'boolean') return fail('metadata_explicit_format_missing');
 return { videoId: id, sourceHash: intent.sourceHash, contractDigest: intent.contractDigest, explicitShort: row.isShort,
  format: { kind: row.isShort ? 'short' : 'regular', basis: 'provider' }, currentlyLive: typeof row.isLive === 'boolean' ? row.isLive : null, replayStatus: 'unknown' };
}

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
/** RPC authority supplies the stage key. Its digest bytes are not inferred from
 * PostgreSQL JSON serialization; exact request bytes have their own digest. */
export function assertPreparedMetadataScope(value: PreparedMetadataScope): void {
 const videoId = exactTarget(value?.target), plan = formatRequestPlan(value.contract, value.target);
 if (!uuid(value.scopeId) || !['qualification','repair'].includes(value.purpose) || !digest(value.preparedDigest)
  || typeof value.itemKey !== 'string' || !new RegExp('^youtube-format-v2:' + videoId + ':[a-f0-9]{64}$').test(value.itemKey)
  || ('hourly.' + '0'.repeat(36) + '.' + value.itemKey).length > 160
  || value.requestSha256 !== plan.requestSha256 || value.requestCanonical !== plan.requestCanonical || value.inputCanonical !== plan.inputCanonical
  || typeof value.archiveId !== 'string' || !value.archiveId || value.archiveId.length > 500
  || typeof value.archiveRevision !== 'string' || !Number.isFinite(Date.parse(value.archiveRevision))) fail('metadata_source_changed');
}
function configured(env: Env, userId: string, creating = false): { token: string } {
 const token = env('APIFY_API_TOKEN');
 if (creating && env('APIFY_RUNTIME_ENABLED') !== 'true' || !token || !(env('COLLECTION_ALLOWED_USER_IDS') || '').split(',').map(v => v.trim()).includes(userId)) {
  throw new CollectionError(503, 'metadata_provider_disabled', 'Metadata provider admission is unavailable.');
 }
 return { token };
}
export async function metadataApiRead(path: string, env: Env, userId: string, fetcher: typeof fetch = fetch): Promise<{ value: unknown; raw: string; sha256: string; total: number | null }> {
 return metadataApiRequest(path, configured(env, userId), fetcher);
}
async function metadataApiRequest(path: string, config: { token: string }, fetcher: typeof fetch, init: RequestInit = {}): Promise<{ value: unknown; raw: string; sha256: string; total: number | null }> {
 const url = new URL('https://api.apify.com/v2/' + path), method = init.method || 'GET';
 if (url.origin !== 'https://api.apify.com' || url.username || url.password || url.hash
  || method === 'GET' && !/^\/v2\/(?:users\/me|acts\/[A-Za-z0-9_~.-]+|actor-builds\/[A-Za-z0-9]+|actor-runs\/[A-Za-z0-9]+|datasets\/[A-Za-z0-9]+\/items)$/.test(url.pathname)
  || method === 'POST' && !/^\/v2\/acts\/[A-Za-z0-9]+\/runs$/.test(url.pathname) || !['GET','POST'].includes(method)) fail('metadata_request_invalid');
 const response = await fetchNoRedirect(url.href, { ...init, signal: AbortSignal.timeout(12_000), headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' } }, (input, options) => retryKnownApifyRead(input, options, fetcher));
 if (!response.ok) {
  await response.body?.cancel();
  const code = response.status === 401 || response.status === 403 ? 'provider_authentication_failed' : response.status === 429 ? 'provider_rate_limited' : response.status >= 500 ? 'provider_unavailable' : 'provider_error';
  throw new CollectionError(502, code, 'The metadata provider did not accept this request.', response.status);
 }
 const raw = await readTextLimited(response, 2 * 1024 * 1024);
 let value: unknown; try { value = JSON.parse(raw); } catch { return fail('metadata_response_invalid'); }
 const totalRaw = response.headers.get('x-apify-pagination-total');
 const total = totalRaw !== null && /^\d+$/.test(totalRaw) && Number.isSafeInteger(Number(totalRaw)) ? Number(totalRaw) : null;
 return { value, raw, sha256: sha(raw), total };
}
const data = (value: unknown): Record<string, unknown> => object(value) && object(value.data) ? value.data : fail('metadata_response_invalid');
/** Raw unique decimal tokens go to native numeric accounting, never through a
 * JS float. Duplicate/missing fields and nested ambiguity fail closed. */
function exactMoney(raw: string, key: string, parsed: unknown): string | null {
 const matches = [...raw.matchAll(new RegExp('"' + key + '"\\s*:\\s*(null|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?=\\s*[,}])', 'g'))];
 if (matches.length !== 1) return fail('metadata_fee_invalid');
 const token = matches[0][1];
 if (token === 'null' && parsed === null) return null;
 if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0 || Number(token) !== parsed || token.length > 80 || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(token)) return fail('metadata_fee_invalid');
 return token;
}
function exactFiveMillis(token: string): boolean {
 const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/.exec(token);
 if (!match || token.length > 80) return false;
 const digits = BigInt(match[1] + (match[2] || '')), exponent = Number(match[3] || 0) - (match[2]?.length || 0);
 return exponent >= -3 ? digits * 10n ** BigInt(exponent + 3) === 5n : digits === 5n * 10n ** BigInt(-3 - exponent);
}
/** Non-creating metadata only, before native financial reservation. */
export async function preflightMetadataProvider(prepared: PreparedMetadataScope, userId: string, env: Env, fetcher: typeof fetch = fetch): Promise<MetadataPreflight> {
 assertPreparedMetadataScope(prepared); configured(env, userId, true); const c = prepared.contract;
 const [actorReceipt, buildReceipt, accountReceipt] = await Promise.all([
  metadataApiRead('acts/' + c.actorRef.replace('/', '~'), env, userId, fetcher), metadataApiRead('actor-builds/' + c.buildId, env, userId, fetcher), metadataApiRead('users/me', env, userId, fetcher),
 ]);
 const actor = data(actorReceipt.value), build = data(buildReceipt.value), account = data(accountReceipt.value);
 let schema: unknown = build.inputSchema;
 if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { return fail('metadata_schema_changed'); } }
 const prices = Array.isArray(actor.pricingInfos) ? actor.pricingInfos : [];
 const price = prices.filter(v => object(v) && typeof v.startedAt === 'string' && Date.parse(v.startedAt) <= Date.now()).sort((a, b) => String((a as Record<string, unknown>).startedAt).localeCompare(String((b as Record<string, unknown>).startedAt))).at(-1);
 if (actor.id !== c.actorId || build.id !== c.buildId || build.actId !== c.actorId || build.buildNumber !== c.buildNumber || build.status !== 'SUCCEEDED'
  || account.id !== c.originalAccountId || !price || sha(canonical(price)) !== c.pricingSha256 || !object(schema) || sha(canonical(schema)) !== c.inputSchemaSha256) fail('metadata_contract_changed');
 const properties = object(schema) && object(schema.properties) ? schema.properties : {};
 if (Object.keys(formatRequestPlan(c, prepared.target).input).some(k => !(k in properties))) fail('metadata_schema_changed');
 return { contractDigest: formatContractDigest(c), requestSha256: prepared.requestSha256, actorId: c.actorId, buildId: c.buildId, buildNumber: c.buildNumber, originalAccountId: c.originalAccountId, maximumUsd: c.maximumUsd, maximumItems: c.maximumItems,
  pricingSha256: c.pricingSha256, inputSchemaSha256: c.inputSchemaSha256, observedAt: new Date().toISOString(), responseSha256: sha(canonical([actorReceipt.sha256, buildReceipt.sha256, accountReceipt.sha256])) };
}
/** Exactly one POST. A valid known ID is returned for durable acknowledgement
 * before strict run/cap validation, so a mismatched accepted run is not retried. */
export async function startMetadataProvider(prepared: PreparedMetadataScope, userId: string, env: Env, fetcher: typeof fetch = fetch): Promise<{ providerRunId: string; run: unknown; responseSha256: string; observedAt: string }> {
 assertPreparedMetadataScope(prepared); const plan = formatRequestPlan(prepared.contract, prepared.target);
 const receipt = await metadataApiRequest(plan.path, configured(env, userId, true), fetcher, { method: 'POST', body: prepared.inputCanonical });
 const run = data(receipt.value); if (!providerId(run.id)) return fail('metadata_launch_ambiguous');
 return { providerRunId: run.id, run, responseSha256: receipt.sha256, observedAt: new Date().toISOString() };
}
function savedIntent(intent: JoinedMetadataIntent): SavedFormatIntent {
 assertPreparedMetadataScope(intent);
 if (!uuid(intent.id) || !uuid(intent.jobId) || !uuid(intent.reservationId) || !providerId(intent.providerRunId)) return fail('metadata_intent_changed');
 return { providerRunId: intent.providerRunId, sourceHash: intent.target.contentHash, contractDigest: formatContractDigest(intent.contract), target: intent.target, contract: intent.contract, purpose: intent.purpose };
}
/** Same retained run only. Current live build/price selection is intentionally
 * not a prerequisite for recording an older immutable intent's final fee. */
export async function pollMetadataProvider(intent: JoinedMetadataIntent, userId: string, env: Env, fetcher: typeof fetch = fetch): Promise<MetadataPoll> {
 const saved = savedIntent(intent);
 const [receipt, accountReceipt] = await Promise.all([metadataApiRead('actor-runs/' + saved.providerRunId, env, userId, fetcher), metadataApiRead('users/me', env, userId, fetcher)]);
 const run = data(receipt.value), account = data(accountReceipt.value);
 assertFormatRun(saved, run); if (account.id !== intent.contract.originalAccountId) return fail('metadata_account_changed');
 const maximum = exactMoney(receipt.raw, 'maxTotalChargeUsd', object(run.options) ? run.options.maxTotalChargeUsd : undefined);
 if (maximum === null || !exactFiveMillis(maximum)) return fail('metadata_fee_invalid');
 const fee: MetadataFeeEvidence = { runId: saved.providerRunId, actorId: intent.contract.actorId, buildId: intent.contract.buildId, originalAccountId: intent.contract.originalAccountId,
  status: String(run.status), maximumUsd: intent.contract.maximumUsd, usageUsd: run.usageTotalUsd === undefined ? null : exactMoney(receipt.raw, 'usageTotalUsd', run.usageTotalUsd), finishedAt: typeof run.finishedAt === 'string' ? run.finishedAt : null, observedAt: new Date().toISOString(), responseSha256: receipt.sha256 };
 if (['READY','RUNNING','TIMING-OUT','ABORTING'].includes(fee.status)) return { status: 'running', run, fee };
 if (fee.status !== 'SUCCEEDED') return { status: 'failed', run, fee };
 try {
  if (!providerId(run.defaultDatasetId)) return fail('metadata_dataset_missing');
  const fields = 'id,videoId,url,channelId,isShort,isShorts,isLive,error,demo';
  const result = await metadataApiRead('datasets/' + run.defaultDatasetId + '/items?' + new URLSearchParams({ format: 'json', clean: 'false', fields, offset: '0', limit: '2' }), env, userId, fetcher);
  if (!Array.isArray(result.value) || result.value.length !== 1 || result.total !== null && result.total !== 1) return { status: 'completed', run, fee, contentError: 'metadata_result_incomplete', datasetSha256: result.sha256 };
  if (result.value.some(row => !object(row) || Object.keys(row).some(k => !fields.split(',').includes(k)))) return { status: 'completed', run, fee, contentError: 'metadata_projection_invalid', datasetSha256: result.sha256 };
  return { status: 'completed', run, fee, rows: result.value, datasetSha256: result.sha256 };
 } catch (error) { return { status: 'completed', run, fee, contentError: error instanceof CollectionError ? error.code : 'metadata_result_unavailable' }; }
}
export function normalizeMetadataObservation(intent: JoinedMetadataIntent, run: unknown, rows: unknown): ObservedFormatEvidence {
 return observedFormatEvidence(savedIntent(intent), run, rows);
}
/** Explicit joined-intent late-fee path, never arbitrary actor authority or a
 * dispatch. The native prepare receipt supplies these immutable identifiers. */
export async function readMetadataFeeEvidence(job: { userId: string; providerRunId: string; actorId: string; buildId: string; originalAccountId: string; contractDigest: string; maximumUsd: string }, env: Env, fetcher: typeof fetch = fetch): Promise<ApifyFeeEvidence & { consumer_account: string }> {
 if (![job.providerRunId, job.actorId, job.buildId, job.originalAccountId].every(providerId) || !digest(job.contractDigest) || !exactFiveMillis(job.maximumUsd)) return fail('metadata_intent_changed');
 const [receipt, accountReceipt] = await Promise.all([metadataApiRead('actor-runs/' + job.providerRunId, env, job.userId, fetcher), metadataApiRead('users/me', env, job.userId, fetcher)]);
 const run = data(receipt.value), account = data(accountReceipt.value);
 if (run.id !== job.providerRunId || run.actId !== job.actorId || run.buildId !== job.buildId || run.userId !== job.originalAccountId || account.id !== job.originalAccountId
  || !['READY','RUNNING','TIMING-OUT','ABORTING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(String(run.status))) return fail('metadata_run_identity_changed');
 const cap = exactMoney(receipt.raw, 'maxTotalChargeUsd', object(run.options) ? run.options.maxTotalChargeUsd : undefined);
 if (cap === null || !exactFiveMillis(cap)) return fail('metadata_fee_invalid');
 return { run_id: job.providerRunId, actor_id: job.actorId, build_id: job.buildId, consumer_account: job.originalAccountId, status: String(run.status),
  usage_usd: run.usageTotalUsd === undefined ? null : exactMoney(receipt.raw, 'usageTotalUsd', run.usageTotalUsd), maximum_usd: cap,
  observed_at: new Date().toISOString(), finished_at: typeof run.finishedAt === 'string' ? run.finishedAt : null, response_sha256: receipt.sha256, authenticated_owner: true };
}
