import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeywordReviewRecord } from '../lib/keyword-review-types';

type ReviewStatus = KeywordReviewRecord['status'];
type ReviewDecision = {
  action: 'keyword'; id: string; expectedUpdatedAt: string; decision: 'approve' | 'reject'; label: string; kind?: KeywordReviewRecord['kind'];
};
export type KeywordReviewRequest = (body: ReviewDecision) => Promise<KeywordReviewRecord>;
interface ReviewPage {
  keywords?: KeywordReviewRecord[]; total?: number; page?: number; pageSize?: number;
}
interface Props {
  data: ReviewPage; status: ReviewStatus; page: number;
  onStatusChange: (status: ReviewStatus) => void; onPageChange: (page: number) => void;
  request: KeywordReviewRequest; reload: () => void; onPendingChange: (pending: boolean) => void;
}
interface ReviewProblem { status: number; message: string }
const statuses = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' } as const;
const kinds = { brand: 'Brand', product: 'Product', game: 'Game', technology: 'Technology', category: 'Category' } as const;

function OriginalLink({ url, children }: { url: string; children: ReactNode }) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return <a className="ra-external" href={parsed.href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>;
  } catch { /* An unavailable original stays readable without an unsafe link. */ }
  return <span>{children}<span className="ra-keyword-unavailable">Original link unavailable</span></span>;
}
function timestamp(seconds: number) {
  const whole = Math.floor(seconds), hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = String(whole % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
function problemFrom(error: unknown): ReviewProblem {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && 'message' in error && typeof error.message === 'string') return { status: error.status, message: error.message };
  return { status: 0, message: 'The decision could not be confirmed. Reload the latest reviews before trying again.' };
}

export function KeywordReviews({ data, status, page, onStatusChange, onPageChange, request, reload, onPendingChange }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null), locked = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onPendingChange(false); }; }, [onPendingChange]);
  const decide: KeywordReviewRequest = async body => {
    if (locked.current) throw { status: 0, message: 'Another keyword decision is still being saved.' } satisfies ReviewProblem;
    locked.current = true; setPendingId(body.id); onPendingChange(true);
    try {
      const record = await request(body);
      if (active.current) reload();
      return record;
    } finally {
      locked.current = false;
      if (active.current) { setPendingId(null); onPendingChange(false); }
    }
  };
  const validPage = Array.isArray(data.keywords) && Number.isInteger(data.total) && data.total! >= 0 && Number.isInteger(data.page) && data.page === page && Number.isInteger(data.pageSize) && data.pageSize! > 0;
  if (!validPage) return <div className="ra-message ra-message-error" role="alert"><h2>Keyword reviews could not be read</h2><p className="ra-prose">The service did not return a complete review list. Reload to try again.</p><div className="ra-message-actions"><button className="ra-button" type="button" onClick={reload}>Retry</button></div></div>;
  const records = data.keywords!, total = data.total!, pageSize = data.pageSize!, busy = pendingId !== null;
  const start = records.length ? page * pageSize + 1 : 0, end = records.length ? Math.min(page * pageSize + records.length, total) : 0;
  return <section aria-label="Keyword reviews" className="ra-keyword-reviews" aria-busy={busy}>
    <div className="ra-job-filters ra-keyword-filters"><label htmlFor="ra-keyword-status">Status<select id="ra-keyword-status" value={status} disabled={busy} onChange={event => onStatusChange(event.target.value as ReviewStatus)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>{total.toLocaleString()} {status} {total === 1 ? 'keyword' : 'keywords'}</p></div>
    <p className="ra-note ra-keyword-score-note">Review scores indicate the strength of mention evidence, not probability or importance.</p>
    {records.length ? <ul className="ra-keyword-list">{records.map(record => <li key={record.id + ':' + record.updated_at}><KeywordReview record={record} request={decide} disabled={busy} pending={pendingId === record.id} reload={reload} /></li>)}</ul> : <div className="ra-message"><h2>{page > 0 ? 'No keywords on this page' : `No ${status} keywords`}</h2><p className="ra-prose">{page > 0 ? 'The list may have changed. Go to the previous page or reload the latest reviews.' : status === 'pending' ? 'There are no keyword suggestions waiting for review.' : `Keywords marked ${status} will appear here.`}</p></div>}
    <div className="ra-pagination ra-keyword-pagination"><p>{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</p><div><button className="ra-button ra-button-small" type="button" disabled={busy || page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} aria-hidden="true" />Previous</button><button className="ra-button ra-button-small" type="button" disabled={busy || (page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}>Next<ChevronRight size={15} aria-hidden="true" /></button></div></div>
  </section>;
}

function KeywordReview({ record, request, disabled, pending, reload }: { record: KeywordReviewRecord; request: KeywordReviewRequest; disabled: boolean; pending: boolean; reload: () => void }) {
  const [label, setLabel] = useState(record.resolved_label ?? record.label), [kind, setKind] = useState(record.resolved_kind ?? record.kind), [error, setError] = useState<ReviewProblem | null>(null);
  const prefix = useId(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const stale = error?.status === 409, hasTimestamp = typeof record.start_seconds === 'number' && Number.isFinite(record.start_seconds) && record.start_seconds >= 0;
  const submit = async (decision: ReviewDecision['decision']) => {
    if (disabled || stale) return;
    const cleaned = label.trim();
    if (!cleaned) { setError({ status: 400, message: 'Enter a keyword label before saving a decision.' }); return; }
    setError(null);
    try { await request({ action: 'keyword', id: record.id, expectedUpdatedAt: record.updated_at, decision, label: cleaned, kind }); }
    catch (problem) { if (active.current && !(problem instanceof DOMException && problem.name === 'AbortError')) setError(problemFrom(problem)); }
  };
  const approve = (event: FormEvent) => { event.preventDefault(); void submit('approve'); };
  return <article className="ra-paper ra-keyword-card" aria-labelledby={prefix + '-heading'}>
    <div className="ra-section-top"><div><h2 id={prefix + '-heading'}>{record.label}</h2><div className="ra-keyword-facts"><span>{kinds[record.resolved_kind ?? record.kind]}</span><span>Review score {record.confidence}/100</span></div></div><span className="ra-badge">{statuses[record.status]}</span></div>
    <div className="ra-keyword-original"><OriginalLink url={record.update_url}>{record.update_title || 'Untitled video or post'}</OriginalLink>{hasTimestamp && <p className="ra-keyword-time">At {timestamp(record.start_seconds!)}</p>}</div>
    <div className="ra-keyword-evidence"><h3>Supporting excerpt</h3>{record.evidence_quote ? <blockquote>{record.evidence_quote}</blockquote> : <p className="ra-muted">No supporting excerpt recorded.</p>}<h3>Reason</h3><p>{record.reason || 'No review reason recorded.'}</p></div>
    {record.status === 'pending' ? <form className="ra-form ra-keyword-form" onSubmit={approve}>
      <label htmlFor={prefix + '-kind'}>Keyword type<select id={prefix + '-kind'} value={kind} disabled={disabled || stale} onChange={event => setKind(event.target.value as KeywordReviewRecord['kind'])}>{Object.entries(kinds).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label htmlFor={prefix + '-label'}>Keyword label<input id={prefix + '-label'} type="text" required maxLength={100} value={label} disabled={disabled || stale} aria-invalid={error?.status === 400 || undefined} aria-describedby={error ? prefix + '-error' : undefined} onChange={event => { setLabel(event.target.value); if (error?.status === 400) setError(null); }} /></label>
      <div className="ra-form-actions"><button className="ra-button ra-button-primary" type="submit" disabled={disabled || stale || !label.trim()}>{pending ? 'Saving decision…' : 'Approve / correct'}</button><button className="ra-button" type="button" disabled={disabled || stale || !label.trim()} onClick={() => void submit('reject')}>Reject</button></div>
      {error && <div className="ra-save-error" role="alert" id={prefix + '-error'}><p>{stale ? 'This review changed elsewhere. Reload the latest reviews before deciding again.' : error.message}</p><button className="ra-button ra-button-small" type="button" onClick={reload} disabled={disabled}>Reload latest reviews</button></div>}
    </form> : <p className="ra-note">{statuses[record.status]} as <strong>{record.resolved_label || record.label}</strong>.</p>}
  </article>;
}
