import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Save } from 'lucide-react';
import { ANALYSIS_MODEL_IDS, DEFAULT_ANALYSIS_MODEL, isAnalysisModelId, isAnalysisModelSelection, type AnalysisConnectionStatus, type AnalysisHealthAlert, type AnalysisModelId, type AnalysisModelSelection, type AnalysisOperations, type AnalysisSettings as Settings, type SaveAnalysisModel } from '../lib/analysis-settings-types';
import './analysis-settings.css';

export type SaveAnalysisModelRequest = (body: SaveAnalysisModel) => Promise<AnalysisModelSelection>;
export type CheckAnalysisConnectionRequest = () => Promise<AnalysisConnectionStatus>;
interface Props { settings: Settings; request: SaveAnalysisModelRequest; checkConnection: CheckAnalysisConnectionRequest; reload: () => void; onPendingChange: (pending: boolean) => void }
interface Problem { status: number; message: string }
const labels: Record<AnalysisModelId, string> = {
  'deepseek/deepseek-v4.1-flash-1017': 'DeepSeek V4.1 Flash (default)',
  'minimax/minimax-m3.1-flash': 'MiniMax M3.1 Flash',
  'openai/gpt-6-luna-pro': 'GPT-6 Luna Pro',
  'openai/gpt-6.1-sol-pro': 'GPT-6.1 Sol Pro',
};
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
const operationalDollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 9 }).format(value);
const healthMessages: Record<AnalysisHealthAlert, string> = {
  stale_leases: 'Some running or prepared jobs have expired leases. A worker recovery check is needed.',
  unknown_charges: 'Unsettled calls retain their commitments, including across UTC days. A failed request does not clear a hold.',
  failed_jobs: 'Some analysis jobs failed. Reader processing states remain separate from successful publication.',
  blocked_jobs: 'Some jobs are paused by a configuration, source, provider or spending safeguard.',
  pending_reviews: 'Keyword candidates are waiting for private review.',
  ledger_incomplete: 'The ledger read is incomplete. Displayed amounts cover only the rows read; do not use them as remaining allowance.',
  ledger_changed: 'The ledger changed during this read. Refresh for a new observation.',
};
const problemFrom = (error: unknown): Problem => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && 'message' in error && typeof error.message === 'string'
  ? { status: error.status, message: error.message }
  : { status: 0, message: 'The save could not be confirmed. Reload the latest selection before trying again.' };

export function AnalysisSettings({ settings, request, checkConnection, reload, onPendingChange }: Props) {
  const [current, setCurrent] = useState<AnalysisModelSelection>(settings), [draft, setDraft] = useState(settings.selectedModel);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState<Problem | null>(null);
  const [checking, setChecking] = useState(false), [connection, setConnection] = useState<AnalysisConnectionStatus | null>(null), [connectionError, setConnectionError] = useState<string | null>(null);
  const prefix = useId(), locked = useRef(false), active = useRef(true), generation = useRef(0), observedSettings = useRef(settings);
  // Invalidate synchronously when a reload supplies a new observation, before
  // an older asynchronous response can overwrite it. Account changes also
  // unmount this panel through PrivateAdmin's existing keyed account boundary.
  if (observedSettings.current !== settings) { observedSettings.current = settings; generation.current++; }
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; onPendingChange(false); }; }, [onPendingChange]);
  useEffect(() => {
    setCurrent(settings); setDraft(settings.selectedModel); setSaving(false); setSaved(false); setError(null);
    setChecking(false); setConnection(null); setConnectionError(null); locked.current = false; onPendingChange(false);
  }, [settings, onPendingChange]);
  const valid = isAnalysisModelSelection(current), changed = draft !== current.selectedModel;
  // A failed transport can mean the transaction committed but its response was lost.
  const mustReload = !!error && error.status !== 400, disabled = saving || checking || mustReload || !valid;
  const check = async () => {
    if (locked.current) return;
    const token = ++generation.current, isCurrent = () => active.current && generation.current === token;
    locked.current = true; setChecking(true); setConnection(null); setConnectionError(null); onPendingChange(true);
    try {
      const result = await checkConnection();
      if (!result || typeof result.configured !== 'boolean' || typeof result.authenticated !== 'boolean' || !['missing', 'ready', 'invalid', 'unavailable'].includes(result.status) || (result.hasCredits !== undefined && typeof result.hasCredits !== 'boolean')) throw new Error('Invalid connection status');
      if (isCurrent()) setConnection(result);
    } catch (failure) {
      if (isCurrent() && !(failure instanceof DOMException && failure.name === 'AbortError')) setConnectionError('The connection check could not be completed. Try again.');
    } finally {
      if (isCurrent()) { locked.current = false; setChecking(false); onPendingChange(false); }
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || disabled || !changed || !isAnalysisModelId(draft)) return;
    const token = ++generation.current, isCurrent = () => active.current && generation.current === token;
    locked.current = true; setSaving(true); setSaved(false); setError(null); onPendingChange(true);
    try {
      const selection = await request({ action: 'save_analysis_model', model: draft, revision: current.revision });
      if (!isAnalysisModelSelection(selection) || selection.selectedModel !== draft || selection.revision !== current.revision + 1)
        throw { status: 502, message: 'The server did not confirm this selection. Reload the latest selection before saving again.' } satisfies Problem;
      if (isCurrent()) { setCurrent(selection); setDraft(selection.selectedModel); setSaved(true); }
    } catch (failure) {
      if (isCurrent() && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(problemFrom(failure));
    } finally {
      if (isCurrent()) { locked.current = false; setSaving(false); onPendingChange(false); }
    }
  };
  if (!valid) return <div className="ra-message ra-message-error" role="alert"><h2>Analysis selection unavailable</h2><p>The saved model could not be verified.</p><button type="button" className="ra-button" onClick={reload}>Reload latest selection</button></div>;
  return <section className="ra-analysis" aria-label="Analysis model settings" aria-busy={saving || checking}>
    <div className="ra-paper ra-analysis-card">
      <div className="ra-section-top"><h2>Model for content analysis</h2><span className="ra-badge">OpenRouter</span></div>
      <p className="ra-note" id={prefix + '-help'}>Choose the model for future analysis. Saving changes the selection only. Analysis activation and spending limits stay unchanged.</p>
      <dl className="ra-analysis-current"><dt>Current selection</dt><dd><strong>{labels[current.selectedModel]}</strong><code>{current.selectedModel}</code></dd></dl>
      <form className="ra-form ra-analysis-form" onSubmit={event => void submit(event)}>
        <label htmlFor={prefix + '-model'}>Analysis model<select id={prefix + '-model'} value={draft} disabled={disabled} aria-describedby={prefix + '-help'} onChange={event => { if (isAnalysisModelId(event.target.value)) { setDraft(event.target.value); setSaved(false); setError(null); } }}>{ANALYSIS_MODEL_IDS.map(model => <option key={model} value={model}>{labels[model]} · {model}</option>)}</select></label>
        <p className="ra-note">Default: <code>{DEFAULT_ANALYSIS_MODEL}</code>. Completed recaps stay as they are. Changing models can pause unfinished analysis.</p>
        <div className="ra-form-actions"><button type="submit" className="ra-button ra-button-primary" disabled={disabled || !changed}><Save size={15} aria-hidden="true" />{saving ? 'Saving…' : 'Save model'}</button><span className="ra-analysis-save-status" role="status" aria-live="polite">{saving ? 'Saving selection…' : saved ? <><Check size={15} aria-hidden="true" />Model selection saved.</> : changed ? 'Unsaved selection' : 'Selection is saved.'}</span></div>
        {error && <div className="ra-save-error" role="alert"><p>{error.status === 409 ? 'This selection changed in another tab. Reload the latest selection, then choose your model again.' : error.message}</p>{mustReload && <button type="button" className="ra-button" onClick={reload}>Reload latest selection</button>}</div>}
      </form>
    </div>
    <div className="ra-paper ra-analysis-status"><h2>Current safeguards</h2><dl className="ra-inline-facts"><div><dt>OpenRouter key</dt><dd>{(connection?.configured ?? settings.keyConfigured) ? 'Configured' : 'Not configured'}</dd></div><div><dt>Analysis runtime</dt><dd>{settings.runtimeEnabled ? 'On' : 'Off'}</dd></div><div><dt>Global spending gate</dt><dd>{settings.budget?.enabled ? 'On' : 'Off'}</dd></div>{settings.budget && <><div><dt>Global daily limit</dt><dd>{dollars(settings.budget.dailyLimitUsd)}</dd></div><div><dt>Global lifetime limit</dt><dd>{dollars(settings.budget.lifetimeLimitUsd)}</dd></div></>}</dl>{!settings.budget && <p className="ra-note">No global analysis budget is configured.</p>}<p className="ra-note">More expensive models may pause at the current spending limits.</p><div className="ra-analysis-connection"><button type="button" className="ra-button" disabled={saving || checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check connection'}</button><p role="status" aria-live="polite">{checking ? 'Checking the server connection…' : connection ? ({ missing: 'OpenRouter key is not configured.', ready: connection.hasCredits === false ? 'Connected. This key has no paid model allowance.' : 'OpenRouter connection verified.', invalid: 'OpenRouter did not accept the configured key.', unavailable: 'OpenRouter is unavailable. Retry the check.' })[connection.status] : 'Connection has not been checked in this view.'}</p></div>{connectionError && <p role="alert" className="ra-warning">{connectionError}</p>}<p className="ra-note">The connection check reads account access only. Reader eligibility, budget limits and runtime checks still apply. No content is generated by these controls.</p></div>
    <AnalysisOperationsStatus operations={settings.operations} />
  </section>;
}

/** Read-only aggregate status. It deliberately offers no activation or ledger controls. */
export function AnalysisOperationsStatus({ operations }: { operations?: AnalysisOperations }) {
  if (!operations) return <section className="ra-paper ra-analysis-operations" aria-label="Analysis operations"><h2>Analysis operations</h2><p className="ra-note" role="status">Operational status is unavailable. Refresh this page to read it again.</p></section>;
  const { jobs, spending, ledger } = operations;
  const counts = [
    ['Queued jobs', jobs.queued], ['Running jobs', jobs.running], ['Prepared jobs', jobs.prepared], ['Published jobs', jobs.published],
    ['Keywords to review', operations.pendingKeywordReviews], ['Failed jobs', jobs.failed], ['Blocked jobs', jobs.blocked],
    ['Cancelled jobs', jobs.cancelled], ['Skipped jobs', jobs.skipped], ['Expired leases', operations.staleLeases],
  ] as const;
  return <section className="ra-paper ra-analysis-operations" aria-label="Analysis operations">
    <div className="ra-section-top"><h2>Analysis operations</h2><span className="ra-badge">Read only</span></div>
    <p className="ra-note">Observed <time dateTime={operations.checkedAt}>{new Date(operations.checkedAt).toLocaleString()}</time>. Counts are read during this observation and can change while workers run. Use Refresh above for a new read.</p>
    <dl className="ra-analysis-metrics">{counts.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>
    <p className="ra-note">Job counts describe independent summary and keyword tasks. Keywords to review counts pending candidates, not jobs or videos. Prepared output has not yet been published.</p>
    <h3>Analysis spending{!ledger.complete && ' · incomplete observation'}</h3>
    <dl className="ra-analysis-metrics ra-analysis-money">
      <div><dt>Observed charges</dt><dd>{spending.observedUsd === null ? 'Unreported' : operationalDollars(spending.observedUsd)}</dd><p>{spending.observedCalls.toLocaleString()} calls reported usage</p></div>
      <div><dt>Settled charges</dt><dd>{spending.settledUsd === null ? 'Unreported' : operationalDollars(spending.settledUsd)}</dd><p>{spending.settledCalls.toLocaleString()} calls settled</p></div>
      <div><dt>Unsettled commitments</dt><dd>{operationalDollars(spending.unknownCommittedUsd)}</dd><p>{spending.unknownCalls.toLocaleString()} calls with unknown final charges</p></div>
      <div><dt>Total committed</dt><dd>{operationalDollars(spending.committedUsd)}</dd></div>
      <div><dt>Committed for {spending.day} UTC</dt><dd>{operationalDollars(spending.dailyCommittedUsd)}</dd></div>
    </dl>
    <p className="ra-note">Observed and settled amounts can describe the same calls; do not add them. A commitment uses the settled charge when known, otherwise the reserved maximum. Observed usage can raise that amount. Unknown charges keep their holds across days. Daily accounting resets at 00:00 UTC; the cumulative evaluation ceiling does not reset.</p>
    <p className="ra-note">Ledger: {ledger.rowsRead.toLocaleString()} of {ledger.totalRows.toLocaleString()} rows read, up to {ledger.rowLimit.toLocaleString()}. {ledger.complete ? 'The two bounded reads agreed.' : 'Amounts cover only the rows read and are not authoritative totals.'}</p>
    {operations.alerts.length > 0 ? <div className="ra-analysis-alerts" role="status"><h3>Needs attention</h3><ul>{operations.alerts.map(alert => <li key={alert}>{healthMessages[alert]}</li>)}</ul></div> : <p className="ra-note" role="status">No configured health alert was observed. This does not establish output quality.</p>}
    <h3>Recent safe error codes</h3>
    {operations.recentErrors.length ? <ul className="ra-analysis-errors">{operations.recentErrors.map((error, index) => <li key={index}><code>{error.code}</code><time dateTime={error.at}>{new Date(error.at).toLocaleString()}</time></li>)}</ul> : <p className="ra-note">No recorded job error was found in this read.</p>}
  </section>;
}
