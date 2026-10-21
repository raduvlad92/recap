import { database } from './admin-data';
import { CollectionError, runtimeEnv, type Env } from './security';

export const COLLECTION_BUDGET_ACCOUNT = 'source-proof';
export const COLLECTION_BUDGET_CEILING_USD = 45;
export interface BudgetReservation {
  id: string; account_id: typeof COLLECTION_BUDGET_ACCOUNT; request_key: string;
  kind: 'envelope' | 'job'; parent_id: string | null; maximum_usd: number;
  provider: 'apify' | 'brightdata' | null; actor_id: string | null;
  provider_run_id: string | null; state: 'held' | 'settled' | 'released';
  actual_cost_usd: number | null; launch_attempted_at: string | null;
  completed_at: string | null; provider_inventory_complete: boolean;
}
export interface BudgetStatus {
  accountId: typeof COLLECTION_BUDGET_ACCOUNT; currency: 'USD'; ceilingUsd: number;
  committedUsd: number; availableUsd: number; overCeiling: boolean;
  heldEnvelopes: number; unknownCostJobs: number;
}
export type BudgetRequest = {
  requestKey: string; maximumUsd: number;
} & ({ kind: 'envelope'; parentReservationId?: never; provider?: never; actorId?: never }
  | { kind: 'job'; parentReservationId?: string; provider: 'apify' | 'brightdata'; actorId: string });
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const runId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const money = (v: unknown, allowZero = false, precision = 12): v is number => typeof v === 'number' && Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) && v < 1_000_000_000 && Number(v.toFixed(precision)) === v;
const invalid = () => new CollectionError(400, 'invalid_budget_record', 'The spending reservation is invalid.');
const unavailable = () => new CollectionError(503, 'budget_ledger_unavailable', 'Spending controls are unavailable. No paid collection can start.');

/** Server-only: never accept this module's authority or maximum from a browser. */
async function rpc<T>(name: string, args: Record<string, unknown>, env: Env): Promise<T> {
  try {
    const result = await database(env).rpc(name, args);
    if (result.error) {
      const code = result.error.code;
      if (code === 'PT402') throw new CollectionError(402, 'collection_budget_exhausted', 'The shared collection spending limit has been reached.');
      if (code === 'PT409') throw new CollectionError(409, 'budget_state_changed', 'The spending reservation changed or still has unresolved charges.');
      if (code === 'PT400') throw invalid();
      throw unavailable();
    }
    if (!result.data || typeof result.data !== 'object') throw unavailable();
    return result.data as T;
  } catch (error) { if (error instanceof CollectionError) throw error; throw unavailable(); }
}
function reservation(value: BudgetReservation): BudgetReservation {
  if (!uuid(value.id) || value.account_id !== COLLECTION_BUDGET_ACCOUNT || !['envelope', 'job'].includes(value.kind) ||
      !['held', 'settled', 'released'].includes(value.state) || !money(value.maximum_usd, false, 6) || value.maximum_usd > COLLECTION_BUDGET_CEILING_USD) throw unavailable();
  return value;
}

/** Reserve once with a stable request key. A repeated key is NOT a new launch. */
export async function reserveBudget(request: BudgetRequest, env: Env = runtimeEnv): Promise<BudgetReservation> {
  if (!request || (typeof request.requestKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(request.requestKey)) || !money(request.maximumUsd, false, 6) || request.maximumUsd > COLLECTION_BUDGET_CEILING_USD) throw invalid();
  if (request.kind === 'envelope') {
    if (request.parentReservationId !== undefined || request.provider !== undefined || request.actorId !== undefined) throw invalid();
  } else if (request.kind !== 'job' || !['apify', 'brightdata'].includes(request.provider) || typeof request.actorId !== 'string' || !/^[A-Za-z0-9_-]+(?:[~/][A-Za-z0-9_-]+)?$/.test(request.actorId) || request.actorId.length > 200 || (request.parentReservationId !== undefined && !uuid(request.parentReservationId))) throw invalid();
  return reservation(await rpc<BudgetReservation>('reserve_collection_budget', {
    p_request_key: request.requestKey, p_maximum_usd: request.maximumUsd, p_kind: request.kind,
    p_parent_id: request.parentReservationId ?? null, p_provider: request.provider ?? null, p_actor_id: request.actorId ?? null,
  }, env));
}

/** Call before a paid POST; claimed=false means do not launch it again. */
export async function claimBudgetLaunch(id: string, env: Env = runtimeEnv): Promise<{ claimed: boolean; reservation: BudgetReservation }> {
  if (!uuid(id)) throw invalid();
  const result = await rpc<{ claimed: boolean; reservation: BudgetReservation }>('claim_collection_budget', { p_id: id }, env);
  if (typeof result.claimed !== 'boolean' || !result.reservation) throw unavailable();
  return { claimed: result.claimed, reservation: reservation(result.reservation) };
}

/** Provider-final costs only. A terminal null cost retains the maximum hold. */
export async function settleBudget(id: string, outcome: { providerRunId: string; actualUsd: number | null; terminal: boolean }, env: Env = runtimeEnv): Promise<BudgetReservation> {
  if (!uuid(id) || !outcome || !runId(outcome.providerRunId) || typeof outcome.terminal !== 'boolean' || (outcome.actualUsd !== null && (!outcome.terminal || !money(outcome.actualUsd, true)))) throw invalid();
  return reservation(await rpc<BudgetReservation>('settle_collection_budget', {
    p_id: id, p_provider_run_id: outcome.providerRunId, p_actual_usd: outcome.actualUsd, p_terminal: outcome.terminal,
  }, env));
}

/** Never use a timeout/TTL to release an ambiguous supplier start. */
export async function releaseUnlaunchedBudget(id: string, env: Env = runtimeEnv): Promise<BudgetReservation> {
  if (!uuid(id)) throw invalid();
  return reservation(await rpc<BudgetReservation>('release_collection_budget', { p_id: id }, env));
}

/** The caller must reconcile the complete root + child run inventory first. */
export async function closeBudgetEnvelope(id: string, providerInventoryComplete: true, env: Env = runtimeEnv): Promise<BudgetReservation> {
  if (!uuid(id) || providerInventoryComplete !== true) throw invalid();
  return reservation(await rpc<BudgetReservation>('close_collection_budget_envelope', { p_id: id, p_provider_inventory_complete: true }, env));
}
export async function collectionBudgetStatus(env: Env = runtimeEnv): Promise<BudgetStatus> {
  const value = await rpc<BudgetStatus>('collection_budget_status', {}, env);
  if (value.accountId !== COLLECTION_BUDGET_ACCOUNT || value.currency !== 'USD' || !money(value.ceilingUsd) || value.ceilingUsd > COLLECTION_BUDGET_CEILING_USD ||
      !money(value.committedUsd, true) || !money(value.availableUsd, true) || typeof value.overCeiling !== 'boolean' ||
      !Number.isInteger(value.heldEnvelopes) || value.heldEnvelopes < 0 || !Number.isInteger(value.unknownCostJobs) || value.unknownCostJobs < 0) throw unavailable();
  return value;
}
