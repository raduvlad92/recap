import type { KeywordReviewPage, KeywordReviewRecord } from '../../../src/lib/keyword-review-types';
import { database, safeLink } from './admin-data';
import { CollectionError } from './security';

type Database = ReturnType<typeof database>;
const columns = 'id,user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,start_seconds,proposed_ranges,status,resolved_label,resolved_kind,updated_at,created_at,update_title,update_url';
const privateRecord = (record: KeywordReviewRecord): KeywordReviewRecord => ({ ...record, update_url: safeLink(record.update_url) });
function validRevision(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse accepts impossible dates such as February 30 by rolling forward.
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
}

function unwrap<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error) {
    if (['PT409', '40001'].includes(result.error.code || '')) throw new CollectionError(409, 'keyword_conflict', 'This review or its source content changed. Reload before saving.');
    if (result.error.code === 'PT400') throw new CollectionError(400, 'invalid_input', 'Check the keyword and review details.');
    if (result.error.code === 'PT503') throw new CollectionError(503, 'audit_unavailable', 'The review was not saved because access logging is unavailable.');
    throw new CollectionError(502, 'keyword_database_failed', 'The keyword reviews could not be read or saved. Try again.');
  }
  return result.data;
}

/** Called only after the existing requireAdmin authorizer succeeds. */
export async function listKeywordReviews(db: Database, url: URL, page: number, adminId: string): Promise<KeywordReviewPage> {
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new CollectionError(400, 'invalid_status', 'Choose pending, approved or rejected reviews.');
  const result = await db.from('admin_keyword_review_queue').select(columns, { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 50, page * 50 + 49);
  const rows = unwrap(result) as unknown as KeywordReviewRecord[] | null;
  // A queue read includes private quotes: withhold every row unless the audit succeeds.
  const audit = await db.from('admin_audit_events').insert({ admin_id: adminId, action: 'keywords.listed', target_id: null, details: { status, page } });
  if (audit.error) throw new CollectionError(503, 'audit_unavailable', 'Private keyword evidence was withheld because access logging is unavailable.');
  return { keywords: (rows || []).map(privateRecord), total: result.count ?? 0, page, pageSize: 50 };
}

/** Validation is repeated in the service-only transactional RPC. */
export async function reviewKeyword(db: Database, body: Record<string, unknown>, adminId: string): Promise<{ record: KeywordReviewRecord }> {
  const { id, expectedUpdatedAt, decision, label, kind } = body;
  const cleanLabel = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : '';
  if (typeof id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)
    || !validRevision(expectedUpdatedAt)
    || (decision !== 'approve' && decision !== 'reject')
    || (kind !== undefined && (typeof kind !== 'string' || !['brand','product','game','technology','category'].includes(kind)))
    || !cleanLabel || cleanLabel.length > 100 || /[\u0000-\u001f\u007f]/.test(cleanLabel)) {
    throw new CollectionError(400, 'invalid_input', 'Use a valid review, saved revision, decision and keyword of 1–100 characters.');
  }
  const record = unwrap(await db.rpc('admin_review_keyword', { p_id: id, p_expected: expectedUpdatedAt, p_admin: adminId, p_decision: decision, p_label: cleanLabel, p_kind: kind ?? null })) as KeywordReviewRecord;
  return { record: privateRecord(record) };
}
