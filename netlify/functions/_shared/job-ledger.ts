import type { Source } from '../../../src/lib/types';
import { database } from './admin-data';
import { CollectionError, publicHttpsUrl, runtimeEnv, type Env } from './security';

type Provider = 'feed' | 'apify' | 'brightdata';
type Status = 'requested' | 'running' | 'succeeded' | 'failed' | 'blocked';
type CostStatus = 'unknown' | 'provider_reported' | 'no_provider_charge';
export type JobSource = Source & { provider?: Provider; actorId?: string };
export interface JobPatch {
  status: Exclude<Status, 'requested'>;
  providerRunId?: string | null;
  actorId?: string | null;
  resultCount?: number | null;
  observedCostUsd?: number | null;
  costStatus?: CostStatus;
  errorCode?: string | null;
}
interface ExistingJob {
  id: string; status: Status; provider: Provider; provider_run_id: string | null;
  actor_id: string | null; observed_cost_usd: number | null; cost_status: CostStatus;
  finished_at: string | null; updated_at: string;
}

const terminal = new Set<Status>(['succeeded', 'failed', 'blocked']);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validActor = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+(?:[~/][A-Za-z0-9_-]+)?$/.test(value) && value.length <= 200;
const unavailable = () => new CollectionError(503, 'job_ledger_unavailable', 'Collection activity could not be recorded. No new collection can start until the activity service is available.');
const invalid = () => new CollectionError(400, 'invalid_job_record', 'The collection activity record is invalid.');

function identity(id: string, userId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !validId(userId)) throw invalid();
}

/** Persists the request and its reader before any source/provider request is made. */
export async function startJob(source: JobSource, userId: string, env: Env = runtimeEnv): Promise<string> {
  if (!validId(userId) || !source || !validId(source.id) || source.id.length > 120 || typeof source.name !== 'string' ||
      !['YouTube', 'X', 'Instagram', 'LinkedIn', 'Podcast', 'Substack', 'Blog'].includes(source.platform)) throw invalid();
  const url = publicHttpsUrl(source.url).href;
  const provider = source.provider ?? (['Blog', 'Podcast', 'Substack'].includes(source.platform) ? 'feed' : 'apify');
  if (!['feed', 'apify', 'brightdata'].includes(provider) || (source.actorId !== undefined && !validActor(source.actorId))) throw invalid();
  let db: ReturnType<typeof database>;
  try { db = database(env); } catch { throw unavailable(); }
  let id: string;
  try {
    const result = await db.from('collection_jobs').insert({
      user_id: userId, source_id: source.id, source_name: source.name.slice(0, 160), source_url: url,
      platform: source.platform, provider, actor_id: source.actorId ?? null,
      status: 'requested', result_count: null, observed_cost_usd: null, cost_status: 'unknown',
    }).select('id').single();
    if (result.error || !result.data || typeof result.data.id !== 'string') throw unavailable();
    id = result.data.id;
    identity(id, userId);
  } catch { throw unavailable(); }
  try {
    const result = await db.from('collection_job_consumers').insert({ job_id: id, user_id: userId });
    if (result.error) throw unavailable();
  } catch {
    // The failed linkage must not turn into an untracked supplier call. Preserve
    // a blocked request if the database is still writable; never expose its error.
    try {
      await db.from('collection_jobs').update({ status: 'blocked', error_code: 'ledger_link_failed', finished_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId).eq('status', 'requested');
    } catch { /* The caller still fails closed before contacting any supplier. */ }
    throw unavailable();
  }
  return id;
}

/** Only a server-confirmed outcome may change an owned ledger row. Never estimates an invoice. */
export async function finishJob(id: string, userId: string, patch: JobPatch, env: Env = runtimeEnv): Promise<void> {
  identity(id, userId);
  if (!patch || !['running', 'succeeded', 'failed', 'blocked'].includes(patch.status) ||
      (patch.providerRunId !== undefined && patch.providerRunId !== null && !validId(patch.providerRunId)) ||
      (patch.actorId !== undefined && patch.actorId !== null && !validActor(patch.actorId)) ||
      (patch.resultCount !== undefined && patch.resultCount !== null && (!Number.isInteger(patch.resultCount) || patch.resultCount < 0 || patch.resultCount > 2_147_483_647)) ||
      (patch.observedCostUsd !== undefined && patch.observedCostUsd !== null && (!Number.isFinite(patch.observedCostUsd) || patch.observedCostUsd < 0 || patch.observedCostUsd > 999_999.999999)) ||
      (patch.costStatus !== undefined && !['unknown', 'provider_reported', 'no_provider_charge'].includes(patch.costStatus)) ||
      (patch.errorCode !== undefined && patch.errorCode !== null && !/^[a-z][a-z0-9_]{0,79}$/.test(patch.errorCode))) throw invalid();
  let db: ReturnType<typeof database>;
  try { db = database(env); } catch { throw unavailable(); }
  let current: ExistingJob;
  try {
    const result = await db.from('collection_jobs').select('id,status,provider,provider_run_id,actor_id,observed_cost_usd,cost_status,finished_at,updated_at')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (result.error) throw unavailable();
    if (!result.data) throw new CollectionError(404, 'job_not_found', 'This collection activity is unavailable for this account.');
    current = result.data as ExistingJob;
  } catch (error) { if (error instanceof CollectionError) throw error; throw unavailable(); }

  if (terminal.has(current.status) && patch.status !== current.status) throw new CollectionError(409, 'job_state_changed', 'This collection activity has already finished.');
  if ((current.provider_run_id && patch.providerRunId !== undefined && patch.providerRunId !== current.provider_run_id) ||
      (current.actor_id && patch.actorId !== undefined && patch.actorId !== current.actor_id)) throw new CollectionError(409, 'job_identity_changed', 'The provider reference does not match this collection activity.');

  // Provider usage can lag or temporarily regress; never lower an already
  // observed charge while polling the same run.
  const cost = patch.observedCostUsd === undefined ? current.observed_cost_usd : patch.observedCostUsd === null ? current.observed_cost_usd : Math.max(current.observed_cost_usd ?? 0, patch.observedCostUsd);
  const costStatus = patch.costStatus ?? current.cost_status;
  if ((costStatus === 'unknown' && cost !== null) ||
      (costStatus === 'provider_reported' && (current.provider === 'feed' || cost === null || !(patch.providerRunId ?? current.provider_run_id))) ||
      (costStatus === 'no_provider_charge' && (current.provider !== 'feed' || cost !== 0)) ||
      (current.cost_status !== 'unknown' && costStatus === 'unknown')) throw invalid();

  const changes: Record<string, unknown> = { status: patch.status };
  if (patch.providerRunId !== undefined) changes.provider_run_id = patch.providerRunId;
  if (patch.actorId !== undefined) changes.actor_id = patch.actorId;
  if (patch.resultCount !== undefined) changes.result_count = patch.resultCount;
  if (patch.observedCostUsd !== undefined) changes.observed_cost_usd = cost;
  if (patch.costStatus !== undefined) changes.cost_status = patch.costStatus;
  if (patch.errorCode !== undefined) changes.error_code = patch.errorCode;
  if (terminal.has(patch.status) && !current.finished_at) changes.finished_at = new Date().toISOString();
  try {
    const result = await db.from('collection_jobs').update(changes)
      .eq('id', id).eq('user_id', userId).eq('status', current.status).eq('updated_at', current.updated_at).select('id').maybeSingle();
    if (result.error) throw unavailable();
    if (!result.data) throw new CollectionError(409, 'job_state_changed', 'Collection activity changed while it was being saved. Reload its status.');
  } catch (error) { if (error instanceof CollectionError) throw error; throw unavailable(); }
}
