import { ANALYSIS_JOB_STATES, isAnalysisModelId, isAnalysisModelSelection, type AnalysisJobState, type AnalysisModelSelection, type AnalysisOperations, type AnalysisSettings } from '../../../src/lib/analysis-settings-types';
import type { database } from './admin-data';
import { CollectionError, type Env } from './security';

type Database = ReturnType<typeof database>;
const LEDGER_PAGE_SIZE = 1000, LEDGER_ROW_LIMIT = 5000;
const CALL_COLUMNS = 'id,created_at,maximum_usd,observed_usd,actual_usd,state';
// Never echo arbitrary error strings, source details or private identifiers.
const SAFE_ERROR_CODES = new Set([
  'analysis_budget_exhausted', 'analysis_daily_budget_exhausted', 'analysis_call_limit', 'analysis_unknown_charge_hold',
  'analysis_lease_expired', 'analysis_worker_yield', 'analysis_source_changed', 'analysis_cached_input_changed', 'source_changed', 'follow_changed',
  'analysis_configuration_required', 'analysis_credentials_required', 'analysis_runtime_disabled', 'analysis_worker_not_configured',
  'analysis_model_not_allowed', 'analysis_model_policy_mismatch', 'analysis_gateway_not_verified', 'analysis_pricing_not_verified',
  'analysis_pricing_unverified', 'analysis_provider_not_verified', 'analysis_provider_cooldown', 'analysis_provider_rate_limited',
  'analysis_provider_retry_exhausted', 'analysis_provider_network_error', 'analysis_provider_timeout', 'analysis_generation_failed',
  'analysis_incomplete_generation', 'analysis_invalid_json', 'analysis_invalid_cost', 'analysis_input_limit', 'analysis_source_capacity',
  'analysis_invalid_output', 'analysis_invalid_takeaways', 'analysis_incomplete_coverage', 'analysis_unsupported_mention',
  'analysis_unsupported_quote', 'analysis_unsupported_reduction_quote', 'analysis_unsupported_takeaway_time',
  'analysis_correction_charge_unknown', 'analysis_correction_dropped_proposal', 'analysis_output_capacity', 'analysis_provider_refusal',
  'analysis_incomplete_summary_reduction', 'analysis_incomplete_summary_verification', 'analysis_invalid_summary_verification',
  'analysis_unsupported_summary_claim', 'analysis_unsupported_summary_number', 'analysis_unsupported_summary_unit', 'analysis_unsupported_passage', 'analysis_no_progress',
  'analysis_summary_omission', 'analysis_empty_summary_requires_review', 'analysis_generation_contract_changed',
  'empty_keyword_inventory_requires_manual_review', 'invalid_keyword_candidate', 'keyword_capacity_requires_review',
  'analysis_storage_unavailable', 'analysis_status_unavailable', 'analysis_dispatch_failed',
]);
interface FinancialRow { id: string; createdAt: string; maximum: number; observed: number | null; actual: number | null; state: string }
const precise = (value: number) => Math.round(value * 1e12) / 1e12;
function financialAmount(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid financial projection');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999) throw new Error('Invalid financial projection');
  return amount;
}
function exactCount(result: { count: number | null; error: unknown }): number {
  if (result.error || !Number.isSafeInteger(result.count) || result.count! < 0) throw new Error('Unavailable count');
  return result.count!;
}
async function readLedger(db: Database, checkedAt: string): Promise<{ rows: FinancialRow[]; total: number }> {
  const total = exactCount(await db.from('reader_content_analysis_calls').select('id', { count: 'exact', head: true }).lte('created_at', checkedAt));
  const rows: FinancialRow[] = [], seen = new Set<string>();
  let after: string | null = null;
  while (rows.length < Math.min(total, LEDGER_ROW_LIMIT)) {
    let query = db.from('reader_content_analysis_calls').select(CALL_COLUMNS).lte('created_at', checkedAt).order('id', { ascending: true }).limit(Math.min(LEDGER_PAGE_SIZE, LEDGER_ROW_LIMIT - rows.length));
    if (after) query = query.gt('id', after);
    const result = await query;
    if (result.error || !Array.isArray(result.data) || result.data.length > LEDGER_PAGE_SIZE) throw new Error('Unavailable ledger');
    if (!result.data.length) break;
    for (const row of result.data) {
      if (typeof row.id !== 'string' || !row.id || seen.has(row.id) || after !== null && row.id <= after || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) > Date.parse(checkedAt)) throw new Error('Invalid ledger projection');
      const maximum = financialAmount(row.maximum_usd), observed = row.observed_usd === null ? null : financialAmount(row.observed_usd), actual = row.actual_usd === null ? null : financialAmount(row.actual_usd);
      if (maximum <= 0 || maximum > 1 || !['reserved', 'unknown', 'settled'].includes(row.state) || (row.state === 'settled') !== (actual !== null)) throw new Error('Invalid ledger state');
      seen.add(row.id); after = row.id;
      rows.push({ id: row.id, createdAt: row.created_at, maximum, observed, actual, state: row.state });
    }
  }
  return { rows, total };
}

/** Service-only aggregate reads after requireAdmin. No originals, cached output,
 * usage payloads, account IDs or arbitrary error text are selected or returned.
 * Two bounded ordered passes detect a changing ledger; this monitor never
 * supplies authoritative budget headroom or changes execution policy. */
export async function readAnalysisOperations(db: Database, now = new Date()): Promise<AnalysisOperations> {
  const checkedAt = now.toISOString(), day = checkedAt.slice(0, 10);
  const [counts, reviews, leases, errors, firstLedger] = await Promise.all([
    Promise.resolve().then(() => Promise.all(ANALYSIS_JOB_STATES.map(async state => [state, exactCount(await db.from('reader_content_analysis_jobs').select('id', { count: 'exact', head: true }).eq('state', state))] as const))),
    Promise.resolve().then(() => db.from('admin_keyword_review_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    Promise.resolve().then(() => db.from('reader_content_analysis_jobs').select('id', { count: 'exact', head: true }).in('state', ['running', 'prepared']).lt('lease_until', checkedAt)),
    Promise.resolve().then(() => db.from('reader_content_analysis_jobs').select('error_code,updated_at').not('error_code', 'is', null).order('updated_at', { ascending: false }).limit(12)),
    readLedger(db, checkedAt),
  ]);
  const jobs = Object.fromEntries(counts) as Record<AnalysisJobState, number>, pendingKeywordReviews = exactCount(reviews), staleLeases = exactCount(leases);
  if (errors.error || !Array.isArray(errors.data) || errors.data.length > 12) throw new Error('Unavailable error projection');
  const recentErrors = errors.data.map(row => {
    if (typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('Invalid error projection');
    return { code: SAFE_ERROR_CODES.has(row.error_code) ? row.error_code as string : 'analysis_error_other', at: new Date(row.updated_at).toISOString() };
  });
  const ledger = await readLedger(db, checkedAt);
  const changed = firstLedger.total !== ledger.total || JSON.stringify(firstLedger.rows) !== JSON.stringify(ledger.rows);
  const complete = !changed && ledger.rows.length === ledger.total && ledger.total <= LEDGER_ROW_LIMIT;
  let observed = 0, observedCalls = 0, settled = 0, settledCalls = 0, unknownCommittedUsd = 0, unknownCalls = 0, committedUsd = 0, dailyCommittedUsd = 0;
  for (const row of ledger.rows) {
    const committed = Math.max(row.actual ?? row.maximum, row.observed ?? 0);
    if (row.observed !== null) { observed = precise(observed + row.observed); observedCalls++; }
    if (row.actual !== null) { settled = precise(settled + row.actual); settledCalls++; }
    else { unknownCommittedUsd = precise(unknownCommittedUsd + committed); unknownCalls++; }
    committedUsd = precise(committedUsd + committed);
    // Unsettled commitments consume today's allowance even on later UTC days.
    if (row.actual === null || Date.parse(row.createdAt) >= Date.parse(day)) dailyCommittedUsd = precise(dailyCommittedUsd + committed);
  }
  const alerts: AnalysisOperations['alerts'] = [];
  if (staleLeases) alerts.push('stale_leases');
  if (unknownCalls) alerts.push('unknown_charges');
  if (jobs.failed) alerts.push('failed_jobs');
  if (jobs.blocked) alerts.push('blocked_jobs');
  if (pendingKeywordReviews) alerts.push('pending_reviews');
  if (!complete) alerts.push('ledger_incomplete');
  if (changed) alerts.push('ledger_changed');
  return { checkedAt, jobs, pendingKeywordReviews, staleLeases,
    spending: { observedUsd: observedCalls ? precise(observed) : null, observedCalls, settledUsd: settledCalls ? precise(settled) : null, settledCalls, unknownCommittedUsd: precise(unknownCommittedUsd), unknownCalls, committedUsd: precise(committedUsd), dailyCommittedUsd: precise(dailyCommittedUsd), day },
    ledger: { rowsRead: ledger.rows.length, rowLimit: LEDGER_ROW_LIMIT, totalRows: ledger.total, complete }, recentErrors, alerts };
}
function unwrap<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error) {
    if (['PT409', '40001'].includes(result.error.code || '')) throw new CollectionError(409, 'analysis_settings_conflict', 'The analysis model changed elsewhere. Reload the latest selection before saving.');
    if (result.error.code === 'PT400') throw new CollectionError(400, 'invalid_input', 'Choose an approved model and reload its saved revision.');
    if (result.error.code === 'PT503') throw new CollectionError(503, 'analysis_settings_unavailable', 'The model was not saved because configuration or access logging is unavailable. Reload before trying again.');
    throw new CollectionError(502, 'analysis_settings_unavailable', 'The analysis settings could not be read or saved. Reload before trying again.');
  }
  return result.data;
}
function selectionFrom(row: unknown): AnalysisModelSelection {
  if (!row || typeof row !== 'object') throw new CollectionError(503, 'analysis_settings_unavailable', 'The analysis model is not configured. Reload after server configuration is complete.');
  const value = row as Record<string, unknown>;
  const selection = { selectedModel: value.selected_model, revision: value.revision, updatedAt: value.updated_at };
  if (!isAnalysisModelSelection(selection)) throw new CollectionError(503, 'analysis_settings_unavailable', 'The saved analysis model could not be verified. Reload after server configuration is complete.');
  // Explicit projection excludes updated_by and all other database fields.
  return selection;
}

/** All entry points are called only after the existing requireAdmin authorizer succeeds. */
export async function readAnalysisSettings(db: Database, env: Env): Promise<{ analysis: AnalysisSettings }> {
  const [settings, budgetResult] = await Promise.all([
    db.from('content_analysis_runtime_settings').select('selected_model,revision,updated_at').eq('id', true).maybeSingle(),
    db.from('content_analysis_budget').select('enabled,daily_limit_usd,lifetime_limit_usd').eq('id', true).maybeSingle(),
  ]);
  const selection = selectionFrom(unwrap(settings));
  const budgetRow = unwrap(budgetResult);
  let budget: AnalysisSettings['budget'] = null;
  if (budgetRow) {
    const dailyLimitUsd = Number(budgetRow.daily_limit_usd), lifetimeLimitUsd = Number(budgetRow.lifetime_limit_usd);
    if (typeof budgetRow.enabled !== 'boolean' || !Number.isFinite(dailyLimitUsd) || dailyLimitUsd <= 0 || !Number.isFinite(lifetimeLimitUsd) || lifetimeLimitUsd <= 0)
      throw new CollectionError(503, 'analysis_settings_unavailable', 'The analysis budget could not be verified. Reload after server configuration is complete.');
    budget = { enabled: budgetRow.enabled, dailyLimitUsd, lifetimeLimitUsd };
  }
  // Monitoring failure must not invent zeroes or prevent model administration.
  // Optional omission also preserves compatibility with older settings fixtures.
  let operations: AnalysisOperations | undefined;
  try { operations = await readAnalysisOperations(db); } catch { /* UI explicitly reports unavailable monitoring. */ }
  return { analysis: { ...selection, keyConfigured: !!env('OPENROUTER_API_KEY')?.trim(), runtimeEnabled: env('CONTENT_ANALYSIS_ENABLED') === 'true', budget, ...(operations ? { operations } : {}) } };
}

/** The RPC owns selection, policy updates and audit insertion in one transaction. */
export async function saveAnalysisModel(db: Database, body: Record<string, unknown>, adminId: string): Promise<{ selection: AnalysisModelSelection }> {
  if (Object.keys(body).some(key => !['action', 'model', 'revision'].includes(key)) || body.action !== 'save_analysis_model'
    || !isAnalysisModelId(body.model) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 1)
    throw new CollectionError(400, 'invalid_input', 'Send only an approved model and its saved revision.');
  const row = unwrap(await db.rpc('admin_set_analysis_model', { p_admin_id: adminId, p_model: body.model, p_expected_revision: body.revision }));
  return { selection: selectionFrom(row) };
}
