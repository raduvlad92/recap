import { database } from './admin-data';
import { readApifyFeeEvidence } from './apify';
import { readMetadataFeeEvidence } from './youtube-format-provider';
import { CollectionError, runtimeEnv, type Env } from './security';

export interface LateFeeSnapshot {
  provider_job_id: string; reservation_id: string; user_id: string;
  provider_run_id: string; actor_id: string; revision: string;
  metadata_contract_digest?: string; build_id?: string; original_account_id?: string; max_usd?: string;
}
export interface LateFeeReceipt {
  id: string; request_key: string; outcome: string; previous_usd: string;
  reported_usd: string | null; corrected_usd: string; delta_usd: string;
}

/** Explicit server/operator entry point; no route, cron, launch or retry loop. */
export async function reconcileLateProviderFee(providerJobId: string, requestKey: string, env: Env = runtimeEnv, fetcher: typeof fetch = fetch): Promise<LateFeeReceipt> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(providerJobId) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(requestKey)) {
    throw new CollectionError(400, 'invalid_provider_fee_receipt', 'A saved provider job and stable receipt key are required.');
  }
  const db = database(env);
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await db.rpc(name, args);
    if (result.error || !result.data || typeof result.data !== 'object') {
      throw new CollectionError(result.error?.code === 'PT409' ? 409 : 503,
        result.error?.code === 'PT409' ? 'provider_fee_state_changed' : 'provider_fee_store_unavailable', 'Provider fee reconciliation could not safely continue.');
    }
    return result.data as T;
  }
  const expected = await rpc<LateFeeSnapshot>('prepare_late_provider_fee', { p_job_id: providerJobId });
  if (expected.provider_job_id !== providerJobId || !expected.reservation_id || !expected.revision) {
    throw new CollectionError(503, 'provider_fee_store_unavailable', 'Saved provider fee identity is unavailable.');
  }
  const evidence = expected.metadata_contract_digest
    ? await readMetadataFeeEvidence({ userId: expected.user_id, providerRunId: expected.provider_run_id, actorId: expected.actor_id, buildId: expected.build_id || '', originalAccountId: expected.original_account_id || '', contractDigest: expected.metadata_contract_digest, maximumUsd: expected.max_usd || '' }, env, fetcher)
    : await readApifyFeeEvidence({ userId: expected.user_id, providerRunId: expected.provider_run_id, actorId: expected.actor_id }, env, fetcher);
  return rpc<LateFeeReceipt>('record_late_provider_fee', { p_job_id: providerJobId, p_request_key: requestKey, p_expected: expected, p_evidence: evidence });
}
