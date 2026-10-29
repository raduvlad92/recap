import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { ContentReviewDecision, ContentReviewDecisionResult, ContentReviewDetail, ContentReviewKeyword, ContentReviewPage, ContentReviewPoint, ContentReviewProposal, ContentReviewStatus, ContentReviewSummary } from '../lib/content-review-types';
import './analysis-reviews.css';

export type LoadContentReview = (record: Pick<ContentReviewSummary, 'id' | 'origin'>, promptPage?: number) => Promise<ContentReviewDetail>;
export type DecideContentReview = (body: ContentReviewDecision, options?: { silent?: boolean }) => Promise<ContentReviewDecisionResult>;
interface ReviewProblem { status: number; message: string }
interface Props {
  data: Partial<ContentReviewPage>; status: ContentReviewStatus; page: number;
  onStatusChange: (status: ContentReviewStatus) => void; onPageChange: (page: number) => void;
  loadDetail: LoadContentReview; decide: DecideContentReview; reload: () => void; onPendingChange: (pending: boolean) => void;
}
const statuses = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' } as const;
const keywordKinds = { brand: 'Brand', product: 'Product', game: 'Game', technology: 'Technology', category: 'Category' } as const;
const kindLabel = (kind: ContentReviewSummary['kind']) => kind === 'recap' ? 'Recap' : 'Keyword';
const problem = (value: unknown): ReviewProblem => value && typeof value === 'object' && 'status' in value && typeof value.status === 'number' && 'message' in value && typeof value.message === 'string' ? { status: value.status, message: value.message } : { status: 0, message: 'The request could not be confirmed. Reload before trying again.' };
const wasAborted = (value: unknown) => value instanceof DOMException && value.name === 'AbortError';
function OriginalLink({ url, children }: { url: string | null; children: ReactNode }) {
  try { if (url) { const parsed = new URL(url); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return <a className="ra-external" href={parsed.href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>; } } catch { /* Keep an unavailable original readable. */ }
  return <span>{children}</span>;
}

interface BulkReviewOutcome {
  record: ContentReviewSummary;
  result?: ContentReviewDecisionResult;
  error?: ReviewProblem;
  unattempted?: boolean;
}
const reviewKey = (record: Pick<ContentReviewSummary, 'id' | 'origin'>) => record.origin + ':' + record.id;
const uncertainDecision = (error: ReviewProblem) => error.status === 0 || error.status >= 500;

export function AnalysisReviews({ data, status, page, onStatusChange, onPageChange, loadDetail, decide, reload, onPendingChange }: Props) {
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set()), [openKey, setOpenKey] = useState<string | null>(null), [selected, setSelected] = useState<Set<string>>(() => new Set()), [outcomes, setOutcomes] = useState<Record<string, BulkReviewOutcome>>({}), [bulk, setBulk] = useState<{ decision: ContentReviewDecision['decision']; total: number; running: boolean; results: Record<string, BulkReviewOutcome> } | null>(null);
  const pending = useRef(new Set<string>()), bulkLocked = useRef(false), active = useRef(true), outcomesRef = useRef<Record<string, BulkReviewOutcome>>({}), selectPageRef = useRef<HTMLInputElement>(null);
  const records = Array.isArray(data.reviews) ? data.reviews : [], scope = status + ':' + page + ':' + records.map(record => reviewKey(record) + '@' + record.updatedAt).join('|'), currentScope = useRef(scope), selectionScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { active.current = true; return () => { active.current = false; onPendingChange(false); }; }, [onPendingChange]);
  useEffect(() => { setSelected(new Set()); setOutcomes({}); outcomesRef.current = {}; setBulk(null); setOpenKey(null); selectionScope.current = scope; }, [scope]);
  const needsRowReload = (key: string) => { const error = outcomesRef.current[key]?.error; return !!error && (uncertainDecision(error) || [401, 403, 409].includes(error.status)); };
  const shownRecords = records.map(record => outcomes[reviewKey(record)]?.result?.record ?? record).filter(record => record.status === status), eligible = status === 'pending' ? shownRecords.filter(record => !pendingKeys.has(reviewKey(record)) && !outcomes[reviewKey(record)]?.error) : [];
  const selectedCount = selectionScope.current === scope ? eligible.filter(record => selected.has(reviewKey(record))).length : 0, allSelected = eligible.length > 0 && selectedCount === eligible.length, mixed = selectedCount > 0 && !allSelected;
  useEffect(() => { if (selectPageRef.current) selectPageRef.current.indeterminate = mixed; }, [mixed]);
  const markPending = (key: string, value: boolean) => { if (value) pending.current.add(key); else pending.current.delete(key); if (active.current) { setPendingKeys(new Set(pending.current)); onPendingChange(pending.current.size > 0 || bulkLocked.current); } };
  const keep = (key: string, outcome: BulkReviewOutcome, savedScope: string) => {
    if (!active.current || currentScope.current !== savedScope) return;
    outcomesRef.current = { ...outcomesRef.current, [key]: outcome }; setOutcomes(outcomesRef.current);
    if (outcome.result || outcome.error) setSelected(previous => { const next = new Set(previous); next.delete(key); return next; });
  };
  const validateResult = (body: ContentReviewDecision, result: ContentReviewDecisionResult) => {
    if (result.record.id !== body.id || result.record.origin !== body.origin || result.record.status !== (body.decision === 'approve' ? 'approved' : 'rejected') || result.published !== (body.decision === 'approve')) throw { status: 502, message: 'The server did not confirm this decision. Reload to check its result.' } satisfies ReviewProblem;
    return result;
  };
  const save: DecideContentReview = async body => {
    const key = reviewKey(body), record = records.find(item => reviewKey(item) === key);
    if (bulkLocked.current || pending.current.has(key) || outcomesRef.current[key]?.result || needsRowReload(key) || currentScope.current !== scope || !record) throw { status: 409, message: 'This item is saving, already decided, or needs a reload.' } satisfies ReviewProblem;
    markPending(key, true); keep(key, { record }, scope);
    try { const result = validateResult(body, await decide(body, { silent: true })); keep(key, { record, result }, scope); return result; }
    catch (value) { keep(key, { record, error: problem(value) }, scope); throw value; }
    finally { markPending(key, false); }
  };
  const runBulk = async (decision: ContentReviewDecision['decision']) => {
    if (bulkLocked.current || pending.current.size > 0 || status !== 'pending' || selectionScope.current !== scope || currentScope.current !== scope) return;
    const targets = records.filter(record => record.status === 'pending' && selected.has(reviewKey(record)) && !outcomesRef.current[reviewKey(record)]?.result && !outcomesRef.current[reviewKey(record)]?.error).slice(0, 50).map(record => ({ ...record }));
    if (!targets.length) return;
    const frozenScope = scope, results: Record<string, BulkReviewOutcome> = {};
    bulkLocked.current = true; setBulk({ decision, total: targets.length, running: true, results: {} }); onPendingChange(true);
    const keepBulk = (key: string, outcome: BulkReviewOutcome) => { results[key] = outcome; keep(key, outcome, frozenScope); if (active.current && currentScope.current === frozenScope) setBulk(previous => previous ? { ...previous, results: { ...results } } : null); };
    try {
      for (let index = 0; index < targets.length; index++) {
        if (!active.current || currentScope.current !== frozenScope) break;
        const record = targets[index], key = reviewKey(record); markPending(key, true);
        try {
          const body: ContentReviewDecision = { action: 'review', id: record.id, origin: record.origin, expectedUpdatedAt: record.updatedAt, decision };
          const result = validateResult(body, await decide(body, { silent: true })); keepBulk(key, { record, result });
        } catch (value) {
          const error = problem(value); keepBulk(key, { record, error });
          if (uncertainDecision(error) || error.status === 401 || error.status === 403 || wasAborted(value)) {
            for (const remaining of targets.slice(index + 1)) keepBulk(reviewKey(remaining), { record: remaining, unattempted: true });
            break;
          }
        } finally { markPending(key, false); }
      }
    } finally {
      bulkLocked.current = false;
      if (active.current) { onPendingChange(pending.current.size > 0); if (currentScope.current === frozenScope) setBulk(previous => previous ? { ...previous, running: false } : null); }
    }
  };
  const validPage = Array.isArray(data.reviews) && Number.isInteger(data.total) && data.total! >= 0 && data.page === page && Number.isInteger(data.pageSize) && data.pageSize! > 0;
  if (!validPage) return <div className="ra-message ra-message-error" role="alert"><h2>Reviews could not be read</h2><p>The service did not return a complete list.</p><button className="ra-button" type="button" onClick={reload}>Retry</button></div>;
  const removed = records.filter(record => record.status === status && outcomes[reviewKey(record)]?.result && outcomes[reviewKey(record)]!.result!.record.status !== status).length;
  const pagingDirty = removed > 0 || Object.keys(outcomes).some(needsRowReload);
  const total = Math.max(0, data.total! - removed), pageSize = data.pageSize!, busy = pendingKeys.size > 0 || bulk?.running === true, batchBusy = bulk?.running === true;
  const start = shownRecords.length ? page * pageSize + 1 : 0, end = shownRecords.length ? Math.min(page * pageSize + shownRecords.length, total) : 0;
  const successes = Object.values(bulk?.results ?? {}).filter(outcome => outcome.result).length, failures = Object.values(bulk?.results ?? {}).filter(outcome => outcome.error).length, unattempted = Object.values(bulk?.results ?? {}).filter(outcome => outcome.unattempted).length;
  const toggleSelected = (key: string) => { if (bulkLocked.current || pending.current.has(key) || outcomesRef.current[key]?.result || outcomesRef.current[key]?.error) return; const sameScope = selectionScope.current === scope; selectionScope.current = scope; setSelected(previous => { const next = sameScope ? new Set(previous) : new Set<string>(); if (next.has(key)) next.delete(key); else next.add(key); return next; }); };
  return <section className="ra-review-queue" aria-label="Keyword and recap reviews" aria-busy={batchBusy}>
    <div className="ra-review-tools"><label htmlFor="ra-review-status">Status<select id="ra-review-status" value={status} disabled={busy} onChange={event => onStatusChange(event.target.value as ContentReviewStatus)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>{`${total.toLocaleString()} ${status} ${total === 1 ? 'item' : 'items'}`}</p></div>
    {status === 'pending' && records.length > 0 && <div className="ra-review-bulk-tools" role="group" aria-label="Bulk review decisions">
      <label className="ra-review-select-page"><input ref={selectPageRef} type="checkbox" aria-label="Select this page" aria-checked={mixed ? 'mixed' : allSelected} checked={allSelected} disabled={batchBusy || !eligible.length} onChange={() => { if (!bulkLocked.current) { selectionScope.current = scope; setSelected(allSelected ? new Set() : new Set(eligible.map(reviewKey))); } }} /><span>Select this page</span></label>
      <button className="ra-text-button" type="button" disabled={busy || selectedCount === 0} onClick={() => setSelected(new Set())}>Clear</button><span className="ra-review-selected-count" role="status">{selectedCount} selected</span>
      <div className="ra-review-bulk-actions"><button className="ra-button ra-button-primary ra-button-small" type="button" disabled={busy || selectedCount === 0} onClick={() => void runBulk('approve')}>Confirm and publish selected</button><button className="ra-button ra-button-small" type="button" disabled={busy || selectedCount === 0} onClick={() => void runBulk('reject')}>Reject selected</button></div>
      <p className="ra-review-bulk-note">Uses saved proposals; save edits individually.</p>
    </div>}
    {bulk && <div className="ra-review-bulk-report" role="status"><p>{bulk.running ? `Saving decisions: ${successes + failures} of ${bulk.total} checked.` : `${successes} ${bulk.decision === 'approve' ? 'confirmed and published' : 'rejected'}; ${failures} need attention; ${unattempted} not attempted.`}</p>{!bulk.running && <><p>You can continue with the remaining items.</p>{failures > 0 && <button className="ra-button ra-button-small" type="button" disabled={busy} onClick={reload}>Reload latest reviews</button>}</>}</div>}
    {shownRecords.length ? <ul className="ra-review-list">{shownRecords.map(record => {
      const key = reviewKey(record), outcome = outcomes[key];
      return <li aria-busy={pendingKeys.has(key)} key={key + ':' + record.updatedAt}><div className={status === 'pending' ? 'ra-review-select-row' : undefined}>{status === 'pending' && <label className="ra-review-row-selection">{record.status === 'pending' && <input type="checkbox" aria-label={'Select ' + kindLabel(record.kind).toLowerCase() + ' ' + (record.label || 'unnamed item') + ' from ' + (record.sourceTitle || 'untitled source')} checked={selectionScope.current === scope && selected.has(key)} disabled={batchBusy || pendingKeys.has(key) || !!outcome?.error} onChange={() => toggleSelected(key)} />}</label>}<div className="ra-review-row-content"><ReviewRow record={record} open={openKey === key} toggle={() => setOpenKey(value => value === key ? null : key)} loadDetail={loadDetail} decide={save} disabled={batchBusy || pendingKeys.has(key)} writeDisabled={needsRowReload(key)} reloadDisabled={busy} pending={pendingKeys.has(key)} reload={reload} />{outcome?.error && <p className="ra-review-row-result">{uncertainDecision(outcome.error) ? 'Decision not confirmed: ' : 'Not saved: '}{outcome.error.message}</p>}{outcome?.unattempted && <p className="ra-review-row-result ra-muted">Not attempted.</p>}</div></div></li>;
    })}</ul> : <div className="ra-review-empty"><h2>{removed > 0 ? 'This loaded page is done' : page > 0 ? 'No items on this page' : `No ${status} reviews`}</h2><p>{removed > 0 ? 'Load remaining reviews when you are ready to continue.' : page > 0 ? 'Go to the previous page or refresh the list.' : status === 'pending' ? 'Held keywords and recaps will appear here.' : `Items you marked ${status} will appear here.`}</p></div>}
    <div className="ra-pagination">{pagingDirty && <button className="ra-button ra-button-small" type="button" disabled={busy} onClick={reload}>Load remaining reviews</button>}<p>{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</p><div><button className="ra-button ra-button-small" type="button" disabled={busy || pagingDirty || page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} aria-hidden="true" />Previous</button><button className="ra-button ra-button-small" type="button" disabled={busy || pagingDirty || (page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}>Next<ChevronRight size={15} aria-hidden="true" /></button></div></div>
  </section>;
}

function ReviewRow({ record, open, toggle, loadDetail, decide, disabled, writeDisabled = false, reloadDisabled = false, pending, reload }: { record: ContentReviewSummary; open: boolean; toggle: () => void; loadDetail: LoadContentReview; decide: DecideContentReview; disabled: boolean; writeDisabled?: boolean; reloadDisabled?: boolean; pending: boolean; reload: () => void }) {
  const [detail, setDetail] = useState<ContentReviewDetail | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<ReviewProblem | null>(null), active = useRef(true), loadingRef = useRef(false), prefix = useId();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async () => {
    if (loadingRef.current || disabled) return;
    loadingRef.current = true; setLoading(true); setError(null);
    try {
      const value = await loadDetail(record);
      if (value.id !== record.id || value.origin !== record.origin) throw { status: 502, message: 'The service returned another review. Reload the latest list.' } satisfies ReviewProblem;
      if (active.current) setDetail(value);
    } catch (value) { if (active.current && !wasAborted(value)) setError(problem(value)); }
    finally { loadingRef.current = false; if (active.current) setLoading(false); }
  };
  const expand = () => { toggle(); if (!open && !detail && !loadingRef.current) void load(); };
  return <>
    <button type="button" className="ra-review-summary" disabled={disabled} onClick={expand} aria-expanded={open} aria-controls={open ? prefix + '-detail' : undefined}>
      <ChevronRight className="ra-review-chevron" size={15} aria-hidden="true" /><span className="ra-review-kind">{kindLabel(record.kind)}</span><span className="ra-review-label" dir="auto" title={record.label}>{record.label || (record.kind === 'recap' ? 'Recap needs a decision' : 'Keyword needs a decision')}</span><span className="ra-review-source" dir="auto" title={record.sourceTitle}>{record.sourceTitle || 'Untitled source'}</span><span className="ra-review-reason" dir="auto" title={record.reason}>{record.reason || record.decisionRequired}</span><span className="ra-review-state">{pending ? 'Saving…' : statuses[record.status]}</span>
    </button>
    {open && <div className="ra-review-detail" id={prefix + '-detail'}>
      {loading ? <div className="ra-loading" role="status"><RefreshCw size={15} aria-hidden="true" />Loading source and prompt…</div> : error ? <div className="ra-save-error" role="alert"><p>{error.message}</p><button className="ra-button ra-button-small" type="button" onClick={() => void load()}>Retry details</button></div> : detail ? <ReviewDecisionPanel detail={detail} loadDetail={loadDetail} decide={decide} disabled={disabled} writeDisabled={writeDisabled} reloadDisabled={reloadDisabled} pending={pending} reload={reload} /> : null}
    </div>}
  </>;
}

/** The raw transcript and recorded request text stay collapsed and verbatim. */
export function ReviewEvidence({ detail, loadDetail, disabled = false, onStale }: { detail: ContentReviewDetail; loadDetail?: LoadContentReview; disabled?: boolean; onStale?: () => void }) {
  const [provenance, setProvenance] = useState(detail.provenance), [promptBusy, setPromptBusy] = useState(false), [promptError, setPromptError] = useState<ReviewProblem | null>(null);
  const active = useRef(true), inFlight = useRef(false), attemptedPage = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const page = provenance.page ?? 0, pageSize = provenance.pageSize ?? 3, total = provenance.total ?? provenance.prompts.length;
  const changePage = async (nextPage: number) => {
    if (!loadDetail || inFlight.current || disabled || nextPage < 0) return;
    inFlight.current = true; attemptedPage.current = nextPage; setPromptBusy(true); setPromptError(null);
    try {
      const next = await loadDetail(detail, nextPage);
      if (next.id !== detail.id || next.origin !== detail.origin) throw { status: 502, message: 'These prompts could not be matched to this review.' } satisfies ReviewProblem;
      if (next.updatedAt !== detail.updatedAt || next.status !== detail.status || next.source.contentHash !== detail.source.contentHash || next.source.current !== detail.source.current || next.canEdit !== detail.canEdit) {
        if (active.current) onStale?.();
        throw { status: 409, message: 'This review or source changed. Reload the latest review before deciding.' } satisfies ReviewProblem;
      }
      if (next.provenance.page !== nextPage || !Number.isInteger(next.provenance.total) || !Number.isInteger(next.provenance.pageSize) || next.provenance.pageSize! < 1) throw { status: 502, message: 'The prompt page could not be confirmed. Try again.' } satisfies ReviewProblem;
      if (active.current) setProvenance(next.provenance);
    } catch (value) { if (active.current && !wasAborted(value)) setPromptError(problem(value)); }
    finally { inFlight.current = false; if (active.current) setPromptBusy(false); }
  };
  return <>
    <p className="ra-review-provenance"><OriginalLink url={detail.sourceUrl}>{detail.sourceTitle || 'Untitled source'}</OriginalLink></p>
    <details className="ra-review-disclosure"><summary>Exact transcript / source</summary>
      {!detail.source.current && <p className="ra-warning">This saved source has changed. It cannot be approved from this review.</p>}
      {detail.source.content !== null ? <pre dir="auto">{detail.source.content}</pre> : <p className="ra-note">{detail.source.unavailableReason || 'The exact source was not saved.'}</p>}
      <p className="ra-review-provenance">Source version: <code>{detail.source.version}</code></p>
    </details>
    <details className="ra-review-disclosure"><summary>Saved AI prompt{total > 1 ? 's' : ''}</summary>
      {provenance.availability === 'recorded' && provenance.message && <p className="ra-note">{provenance.message}</p>}
      {provenance.availability === 'unavailable' && <p className="ra-note">{total > 0 ? 'No prompt text saved on this page.' : 'Prompt not saved.'} {provenance.message || 'The historical request is unavailable.'}</p>}
      <div aria-busy={promptBusy}>{provenance.prompts.map((saved, index) => <section className="ra-review-prompt" key={page + ':' + index + ':' + (saved.requestHash || saved.role)}>
        <h4>{saved.role || 'Generation'} · {saved.model || 'Model not recorded'}</h4>
        <p className="ra-review-prompt-label">System instructions</p><pre className="ra-review-prompt-text" dir="auto">{saved.system}</pre>
        <p className="ra-review-prompt-label">Prompt</p><pre className="ra-review-prompt-text" dir="auto">{saved.prompt}</pre>
      </section>)}</div>
      {total > pageSize && <div className="ra-review-prompt-pager"><p>Prompt page {page + 1} of {Math.ceil(total / pageSize)}</p><div><button className="ra-button ra-button-small" type="button" disabled={disabled || promptBusy || !loadDetail || page === 0} onClick={() => void changePage(page - 1)}>Previous prompts</button><button className="ra-button ra-button-small" type="button" disabled={disabled || promptBusy || !loadDetail || (page + 1) * pageSize >= total} onClick={() => void changePage(page + 1)}>Next prompts</button></div></div>}
      {promptBusy && <p className="ra-note" role="status">Loading prompts…</p>}
      {promptError && <div className="ra-save-error ra-review-error" role="alert"><p>{promptError.message}</p>{promptError.status !== 409 && <button className="ra-button ra-button-small" type="button" disabled={disabled || promptBusy} onClick={() => void changePage(attemptedPage.current)}>Retry prompt page</button>}</div>}
    </details>
  </>;
}

export function ReviewDecisionPanel({ detail, loadDetail, decide, disabled, writeDisabled = false, reloadDisabled = false, pending, reload }: { detail: ContentReviewDetail; loadDetail?: LoadContentReview; decide: DecideContentReview; disabled: boolean; writeDisabled?: boolean; reloadDisabled?: boolean; pending: boolean; reload: () => void }) {
  const shown = detail.resolution ?? detail.proposal, keyword = 'label' in shown ? shown : null, recap = 'highlights' in shown ? shown : null;
  const [editing, setEditing] = useState(false), [label, setLabel] = useState(keyword?.label || ''), [kind, setKind] = useState<ContentReviewKeyword['kind']>(keyword?.kind || 'category'), [points, setPoints] = useState<ContentReviewPoint[]>(() => recap?.highlights.map(point => ({ ...point })) || []), [error, setError] = useState<ReviewProblem | null>(null);
  const prefix = useId(), active = useRef(true), editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (editing) editorRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus(); }, [editing]);
  const stale = error?.status === 409, needsReload = !!error && [0, 409, 502, 503].includes(error.status), blocked = disabled || writeDisabled || needsReload, isPending = detail.status === 'pending';
  const save = async (decision: ContentReviewDecision['decision']) => {
    if (blocked || decision === 'approve' && !(editing ? detail.canEdit : detail.canApprove)) return;
    let proposal: ContentReviewProposal | undefined;
    if (decision === 'approve' && editing) {
      if (detail.kind === 'keyword') {
        if (!label.trim()) { setError({ status: 400, message: 'Enter a keyword label.' }); return; }
        proposal = { label: label.trim(), kind };
      } else {
        if (!points.length || points.some(point => !point.text.trim() || point.evidenceQuote.trim().length < 15)) { setError({ status: 400, message: 'Each recap point needs text and at least 15 characters copied from its source.' }); return; }
        proposal = { highlights: points.map(point => ({ text: point.text.trim(), evidenceQuote: point.evidenceQuote.trim() })) };
      }
    }
    setError(null);
    try { await decide({ action: 'review', id: detail.id, origin: detail.origin, expectedUpdatedAt: detail.updatedAt, decision, ...(proposal ? { proposal } : {}) }); }
    catch (value) { if (active.current && !wasAborted(value)) setError(problem(value)); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save('approve'); };
  const changePoint = (index: number, change: Partial<ContentReviewPoint>) => setPoints(previous => previous.map((point, at) => at === index ? { ...point, ...change } : point));
  return <>
    <div className="ra-review-decision"><h3>Why held</h3><p>{detail.reason || 'A review is required.'}</p><p><strong>Decision needed:</strong> {detail.decisionRequired}</p></div>
    <div className="ra-review-content"><h3>{kindLabel(detail.kind)}</h3>{keyword ? <p dir="auto"><strong>{keyword.label || 'No keyword proposed'}</strong> <span className="ra-muted">· {keywordKinds[keyword.kind]}</span></p> : recap?.highlights.length ? <ul>{recap.highlights.map((point, index) => <li key={index} dir="auto">{point.text}<details className="ra-review-disclosure"><summary>Supporting source text</summary><blockquote dir="auto">{point.evidenceQuote || 'No supporting quote saved.'}</blockquote></details></li>)}</ul> : <p className="ra-note">No complete recap was saved. Write supported points to confirm it, or reject this item.</p>}</div>
    <ReviewEvidence detail={detail} loadDetail={loadDetail} disabled={blocked} onStale={() => setError({ status: 409, message: 'This review or source changed. Reload before deciding.' })} />
    {isPending ? <form onSubmit={submit}>
      {editing && <div className="ra-review-editor" ref={editorRef}>
        {detail.kind === 'keyword' ? <div className="ra-review-keyword-fields"><label htmlFor={prefix + '-label'}>Keyword<input id={prefix + '-label'} dir="auto" value={label} maxLength={100} required disabled={blocked} onChange={event => setLabel(event.target.value)} /></label><label htmlFor={prefix + '-kind'}>Type<select id={prefix + '-kind'} value={kind} disabled={blocked} onChange={event => setKind(event.target.value as ContentReviewKeyword['kind'])}>{Object.entries(keywordKinds).map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></label></div> : <>
          {points.map((point, index) => <fieldset className="ra-review-point" key={index}><legend>Point {index + 1}</legend><label htmlFor={prefix + '-text-' + index}>Recap text (up to 38 words)<textarea id={prefix + '-text-' + index} dir="auto" value={point.text} maxLength={500} required disabled={blocked} onChange={event => changePoint(index, { text: event.target.value })} /></label><label htmlFor={prefix + '-quote-' + index}>Exact supporting source text<textarea id={prefix + '-quote-' + index} dir="auto" value={point.evidenceQuote} maxLength={1000} minLength={15} required disabled={blocked} onChange={event => changePoint(index, { evidenceQuote: event.target.value })} /></label><div className="ra-review-point-actions"><button className="ra-text-button" type="button" disabled={blocked} onClick={() => setPoints(previous => previous.filter((_, at) => at !== index))}>Remove point</button></div></fieldset>)}
          <div><button className="ra-button ra-button-small" type="button" disabled={blocked || points.length >= 6} onClick={() => setPoints(previous => [...previous, { text: '', evidenceQuote: '' }])}>Add point</button></div>
        </>}
      </div>}
      {!detail.canApprove && !editing && <p className="ra-note">{detail.cannotApproveReason || 'This item needs a supported correction before it can be confirmed.'}</p>}
      <div className="ra-review-actions"><button className="ra-button ra-button-primary" type="submit" disabled={blocked || (editing ? !detail.canEdit : !detail.canApprove)}>{pending ? 'Saving decision…' : editing ? 'Save and publish' : 'Confirm and publish'}</button><button className="ra-button" type="button" disabled={blocked} onClick={() => void save('reject')}>Reject</button>{detail.canEdit && <button className="ra-button" type="button" disabled={blocked} onClick={() => { if (editing) { setLabel(keyword?.label || ''); setKind(keyword?.kind || 'category'); setPoints(recap?.highlights.map(point => ({ ...point })) || []); } setEditing(value => !value); setError(null); }}>{editing ? 'Cancel edit' : 'Edit'}</button>}</div>
      {(error || writeDisabled) && <div className="ra-save-error ra-review-error" role="alert"><p>{stale ? 'This review or its source changed. Reload before deciding again.' : error?.message || 'Reload the latest review before another decision on this item.'}</p><button className="ra-button ra-button-small" type="button" disabled={disabled || reloadDisabled} onClick={reload}>Reload latest reviews</button></div>}
    </form> : <p className="ra-note">{detail.status === 'approved' ? 'Confirmed and published.' : 'Rejected; kept private.'}</p>}
  </>;
}
