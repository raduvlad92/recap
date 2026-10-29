import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { ContentReviewDecision, ContentReviewDecisionResult, ContentReviewDetail, ContentReviewKeyword, ContentReviewPage, ContentReviewPoint, ContentReviewProposal, ContentReviewStatus, ContentReviewSummary } from '../lib/content-review-types';
import './analysis-reviews.css';

export type LoadContentReview = (record: Pick<ContentReviewSummary, 'id' | 'origin'>, promptPage?: number) => Promise<ContentReviewDetail>;
export type DecideContentReview = (body: ContentReviewDecision) => Promise<ContentReviewDecisionResult>;
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

export function AnalysisReviews({ data, status, page, onStatusChange, onPageChange, loadDetail, decide, reload, onPendingChange }: Props) {
  const [pendingKey, setPendingKey] = useState<string | null>(null), [openKey, setOpenKey] = useState<string | null>(null), locked = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onPendingChange(false); }; }, [onPendingChange]);
  const save: DecideContentReview = async body => {
    if (locked.current) throw { status: 0, message: 'A review decision is still being saved.' } satisfies ReviewProblem;
    locked.current = true; setPendingKey(body.origin + ':' + body.id); onPendingChange(true);
    try { const result = await decide(body); if (active.current) reload(); return result; }
    finally { locked.current = false; if (active.current) { setPendingKey(null); onPendingChange(false); } }
  };
  const validPage = Array.isArray(data.reviews) && Number.isInteger(data.total) && data.total! >= 0 && data.page === page && Number.isInteger(data.pageSize) && data.pageSize! > 0;
  if (!validPage) return <div className="ra-message ra-message-error" role="alert"><h2>Reviews could not be read</h2><p>The service did not return a complete list.</p><button className="ra-button" type="button" onClick={reload}>Retry</button></div>;
  const records = data.reviews!, total = data.total!, pageSize = data.pageSize!, busy = pendingKey !== null;
  const start = records.length ? page * pageSize + 1 : 0, end = records.length ? Math.min(page * pageSize + records.length, total) : 0;
  return <section className="ra-review-queue" aria-label="Keyword and recap reviews" aria-busy={busy}>
    <div className="ra-review-tools"><label htmlFor="ra-review-status">Status<select id="ra-review-status" value={status} disabled={busy} onChange={event => onStatusChange(event.target.value as ContentReviewStatus)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>{total.toLocaleString()} {status} {total === 1 ? 'item' : 'items'}</p></div>
    {records.length ? <ul className="ra-review-list">{records.map(record => {
      const key = record.origin + ':' + record.id;
      return <li key={key + ':' + record.updatedAt}><ReviewRow record={record} open={openKey === key} toggle={() => setOpenKey(value => value === key ? null : key)} loadDetail={loadDetail} decide={save} disabled={busy} pending={pendingKey === key} reload={reload} /></li>;
    })}</ul> : <div className="ra-review-empty"><h2>{page > 0 ? 'No items on this page' : `No ${status} reviews`}</h2><p>{page > 0 ? 'Go to the previous page or refresh the list.' : status === 'pending' ? 'Held keywords and recaps will appear here.' : `Items you marked ${status} will appear here.`}</p></div>}
    <div className="ra-pagination"><p>{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</p><div><button className="ra-button ra-button-small" type="button" disabled={busy || page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} aria-hidden="true" />Previous</button><button className="ra-button ra-button-small" type="button" disabled={busy || (page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}>Next<ChevronRight size={15} aria-hidden="true" /></button></div></div>
  </section>;
}

function ReviewRow({ record, open, toggle, loadDetail, decide, disabled, pending, reload }: { record: ContentReviewSummary; open: boolean; toggle: () => void; loadDetail: LoadContentReview; decide: DecideContentReview; disabled: boolean; pending: boolean; reload: () => void }) {
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
      <ChevronRight className="ra-review-chevron" size={15} aria-hidden="true" /><span className="ra-review-kind">{kindLabel(record.kind)}</span><span className="ra-review-label" dir="auto" title={record.label}>{record.label || (record.kind === 'recap' ? 'Recap needs a decision' : 'Keyword needs a decision')}</span><span className="ra-review-source" dir="auto" title={record.sourceTitle}>{record.sourceTitle || 'Untitled source'}</span><span className="ra-review-reason" dir="auto" title={record.reason}>{record.reason || record.decisionRequired}</span><span className="ra-review-state">{statuses[record.status]}</span>
    </button>
    {open && <div className="ra-review-detail" id={prefix + '-detail'}>
      {loading ? <div className="ra-loading" role="status"><RefreshCw size={15} aria-hidden="true" />Loading source and prompt…</div> : error ? <div className="ra-save-error" role="alert"><p>{error.message}</p><button className="ra-button ra-button-small" type="button" onClick={() => void load()}>Retry details</button></div> : detail ? <ReviewDecisionPanel detail={detail} loadDetail={loadDetail} decide={decide} disabled={disabled} pending={pending} reload={reload} /> : null}
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

export function ReviewDecisionPanel({ detail, loadDetail, decide, disabled, pending, reload }: { detail: ContentReviewDetail; loadDetail?: LoadContentReview; decide: DecideContentReview; disabled: boolean; pending: boolean; reload: () => void }) {
  const shown = detail.resolution ?? detail.proposal, keyword = 'label' in shown ? shown : null, recap = 'highlights' in shown ? shown : null;
  const [editing, setEditing] = useState(false), [label, setLabel] = useState(keyword?.label || ''), [kind, setKind] = useState<ContentReviewKeyword['kind']>(keyword?.kind || 'category'), [points, setPoints] = useState<ContentReviewPoint[]>(() => recap?.highlights.map(point => ({ ...point })) || []), [error, setError] = useState<ReviewProblem | null>(null);
  const prefix = useId(), active = useRef(true), editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (editing) editorRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus(); }, [editing]);
  const stale = error?.status === 409, needsReload = !!error && [0, 409, 502, 503].includes(error.status), blocked = disabled || needsReload, isPending = detail.status === 'pending';
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
      {error && <div className="ra-save-error ra-review-error" role="alert"><p>{stale ? 'This review or its source changed. Reload before deciding again.' : error.message}</p><button className="ra-button ra-button-small" type="button" disabled={disabled} onClick={reload}>Reload latest reviews</button></div>}
    </form> : <p className="ra-note">{detail.status === 'approved' ? 'Confirmed and published.' : 'Rejected; kept private.'}</p>}
  </>;
}
