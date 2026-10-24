import { isAnalysisModelId, isAnalysisModelSelection, type AnalysisModelSelection, type AnalysisSettings } from '../../../src/lib/analysis-settings-types';
import type { database } from './admin-data';
import { CollectionError, type Env } from './security';

type Database = ReturnType<typeof database>;
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
  return { analysis: { ...selection, keyConfigured: !!env('OPENROUTER_API_KEY')?.trim(), runtimeEnabled: env('CONTENT_ANALYSIS_ENABLED') === 'true', budget } };
}

/** The RPC owns selection, policy updates and audit insertion in one transaction. */
export async function saveAnalysisModel(db: Database, body: Record<string, unknown>, adminId: string): Promise<{ selection: AnalysisModelSelection }> {
  if (Object.keys(body).some(key => !['action', 'model', 'revision'].includes(key)) || body.action !== 'save_analysis_model'
    || !isAnalysisModelId(body.model) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 1)
    throw new CollectionError(400, 'invalid_input', 'Send only an approved model and its saved revision.');
  const row = unwrap(await db.rpc('admin_set_analysis_model', { p_admin_id: adminId, p_model: body.model, p_expected_revision: body.revision }));
  return { selection: selectionFrom(row) };
}
