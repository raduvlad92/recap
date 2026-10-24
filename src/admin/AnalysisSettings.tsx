import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, Save } from 'lucide-react';
import { ANALYSIS_MODEL_IDS, DEFAULT_ANALYSIS_MODEL, isAnalysisModelId, isAnalysisModelSelection, type AnalysisConnectionStatus, type AnalysisModelId, type AnalysisModelSelection, type AnalysisSettings as Settings, type SaveAnalysisModel } from '../lib/analysis-settings-types';
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
const problemFrom = (error: unknown): Problem => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && 'message' in error && typeof error.message === 'string'
  ? { status: error.status, message: error.message }
  : { status: 0, message: 'The save could not be confirmed. Reload the latest selection before trying again.' };

export function AnalysisSettings({ settings, request, checkConnection, reload, onPendingChange }: Props) {
  const [current, setCurrent] = useState<AnalysisModelSelection>(settings), [draft, setDraft] = useState(settings.selectedModel);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState<Problem | null>(null);
  const [checking, setChecking] = useState(false), [connection, setConnection] = useState<AnalysisConnectionStatus | null>(null), [connectionError, setConnectionError] = useState<string | null>(null);
  const prefix = useId(), locked = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onPendingChange(false); }; }, [onPendingChange]);
  const valid = isAnalysisModelSelection(current), changed = draft !== current.selectedModel;
  // A failed transport can mean the transaction committed but its response was lost.
  const mustReload = !!error && error.status !== 400, disabled = saving || checking || mustReload || !valid;
  const check = async () => {
    if (locked.current) return;
    locked.current = true; setChecking(true); setConnection(null); setConnectionError(null); onPendingChange(true);
    try {
      const result = await checkConnection();
      if (!result || typeof result.configured !== 'boolean' || typeof result.authenticated !== 'boolean' || !['missing', 'ready', 'invalid', 'unavailable'].includes(result.status) || (result.hasCredits !== undefined && typeof result.hasCredits !== 'boolean')) throw new Error('Invalid connection status');
      if (active.current) setConnection(result);
    } catch (failure) {
      if (active.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setConnectionError('The connection check could not be completed. Try again.');
    } finally {
      locked.current = false;
      if (active.current) { setChecking(false); onPendingChange(false); }
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || disabled || !changed || !isAnalysisModelId(draft)) return;
    locked.current = true; setSaving(true); setSaved(false); setError(null); onPendingChange(true);
    try {
      const selection = await request({ action: 'save_analysis_model', model: draft, revision: current.revision });
      if (!isAnalysisModelSelection(selection) || selection.selectedModel !== draft || selection.revision !== current.revision + 1)
        throw { status: 502, message: 'The server did not confirm this selection. Reload the latest selection before saving again.' } satisfies Problem;
      if (active.current) { setCurrent(selection); setDraft(selection.selectedModel); setSaved(true); }
    } catch (failure) {
      if (active.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(problemFrom(failure));
    } finally {
      locked.current = false;
      if (active.current) { setSaving(false); onPendingChange(false); }
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
  </section>;
}
