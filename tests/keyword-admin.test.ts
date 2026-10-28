import { describe, expect, it, vi } from 'vitest';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { requireAdmin, type ClerkUser } from '../netlify/functions/_shared/admin-data';
import { CollectionError } from '../netlify/functions/_shared/security';
import type { KeywordReviewRecord } from '../src/lib/keyword-review-types';

const id = '4512201e-c177-4c27-a7ac-e1f319765d48';
const revision = '2026-10-22T12:34:56.123456+00:00';
const record: KeywordReviewRecord = {
  id, user_id: 'user_private_reader', update_id: 'archived-update', source_id: 'source-1', content_hash: 'a'.repeat(64),
  label: 'A product', kind: 'product', confidence: 67, reason: 'Needs an identity check.', evidence_quote: 'A private archived quote.',
  start_seconds: null, proposed_ranges: [], status: 'pending', resolved_label: null, updated_at: revision, created_at: revision,
  update_title: 'Original title', update_url: 'https://example.com/original',
};
const decision = { action: 'keyword', id, expectedUpdatedAt: revision, decision: 'approve', label: 'A product' };
const get = (query = '') => new Request('https://app.example/api/admin?section=keywords' + query);
const patch = (body: unknown = decision) => new Request('https://app.example/api/admin', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function databaseStub() {
  const result = { data: [record], count: 73, error: null as null | { code: string; message: string } };
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue(result) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const insert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: { ...record, status: 'approved', resolved_label: record.label }, error: null });
  const from = vi.fn((table: string) => table === 'admin_keyword_review_queue' ? query : { insert });
  const db = vi.fn(() => ({ from, rpc })) as unknown as NonNullable<Parameters<typeof createAdminHandler>[0]>['db'];
  return { db, from, rpc, query, insert, result };
}
const authorized = async () => 'user_actual_admin';

describe('private keyword administration', () => {
  it.each([get(), patch()])('requires a real signed-in session before any privileged database access ($method)', async request => {
    const stub = databaseStub();
    const response = await createAdminHandler({ db: stub.db })(request);
    expect(response.status).toBe(401); expect(stub.db).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(JSON.stringify(await response.json())).not.toContain(record.evidence_quote);
  });

  it.each([get(), patch()])('denies a signed-in ordinary reader through requireAdmin ($method)', async request => {
    const stub = databaseStub();
    const reader = { id: 'user_reader', banned: false, locked: false, email_addresses: [], primary_email_address_id: null } as unknown as ClerkUser;
    const authorize = (req: Request) => requireAdmin(req, () => undefined, async () => reader.id, async () => reader);
    const response = await createAdminHandler({ authorize, db: stub.db })(request);
    expect(response.status).toBe(403); expect(stub.db).not.toHaveBeenCalled();
  });

  it('defaults to pending, returns exact counts and pages fifty records, then audits private access', async () => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get('&page=1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ keywords: [record], total: 73, page: 1, pageSize: 50 });
    expect(stub.query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(stub.query.order.mock.calls).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(stub.query.range).toHaveBeenCalledWith(50, 99);
    expect(stub.insert).toHaveBeenCalledWith({ admin_id: 'user_actual_admin', action: 'keywords.listed', target_id: null, details: { status: 'pending', page: 1 } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it.each(['approved', 'rejected'])('accepts the %s filter', async status => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get('&status=' + status));
    expect(response.status).toBe(200); expect(stub.query.eq).toHaveBeenCalledWith('status', status);
  });

  it.each(['all', '', 'pending%27%29'])('rejects invalid status %s before reading private evidence', async status => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get('&status=' + status));
    expect(response.status).toBe(400); expect(stub.from).not.toHaveBeenCalled();
  });

  it('fails closed if the private-read audit insert fails', async () => {
    const stub = databaseStub(); stub.insert.mockResolvedValue({ error: { message: 'private database details' } });
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get());
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(record.evidence_quote); expect(body).not.toContain('private database details');
    expect(body).toContain('audit_unavailable');
  });

  it('withholds database diagnostics and private quotes on queue read failure', async () => {
    const stub = databaseStub(); stub.result.error = { code: '42501', message: 'private internal diagnostics' };
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get());
    expect(response.status).toBe(502); expect(stub.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toMatch(/private internal|archived quote/);
  });

  it('uses the verified admin, preserves microsecond CAS revisions, and normalizes the edited label', async () => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(patch({ ...decision, label: '  A   product  ', p_admin: 'user_forged_admin', adminId: 'user_forged_admin' }));
    expect(response.status).toBe(200);
    expect(stub.rpc).toHaveBeenCalledWith('admin_review_keyword', { p_id: id, p_expected: revision, p_admin: 'user_actual_admin', p_decision: 'approve', p_label: 'A product', p_kind: null });
    expect((await response.json()).record.status).toBe('approved'); expect(stub.from).not.toHaveBeenCalled();
  });

  it('passes rejection through the same transactional RPC', async () => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(patch({ ...decision, decision: 'reject' }));
    expect(response.status).toBe(200); expect(stub.rpc.mock.calls[0][1].p_decision).toBe('reject');
  });

  it('passes an explicit corrected kind to the transaction', async () => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(patch({ ...decision, kind: 'category' }));
    expect(response.status).toBe(200);
    expect(stub.rpc.mock.calls[0][1].p_kind).toBe('category');
  });
  it.each([
    { kind: 'sponsor' }, { kind: null }, { id: 'not-a-uuid' }, { expectedUpdatedAt: null }, { expectedUpdatedAt: '2026-10-22' }, { expectedUpdatedAt: 'not-a-date' },
    { expectedUpdatedAt: '2026-02-30T12:00:00Z' }, { expectedUpdatedAt: '2026-10-22T24:00:00Z' },
    { decision: 'approve-and-collect' }, { decision: null }, { decision: { toString: null } }, { label: '' }, { label: '   ' }, { label: 'x'.repeat(101) }, { label: 123 }, { label: 'bad\u0000label' },
  ])('rejects malformed keyword decisions without RPC calls: %j', async edit => {
    const stub = databaseStub();
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(patch({ ...decision, ...edit }));
    expect(response.status).toBe(400); expect(stub.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['PT409', 409, 'keyword_conflict'], ['40001', 409, 'keyword_conflict'], ['PT400', 400, 'invalid_input'],
    ['PT503', 503, 'audit_unavailable'], ['42501', 502, 'keyword_database_failed'],
  ])('maps RPC %s safely to HTTP %i', async (code, status, safeCode) => {
    const stub = databaseStub(); stub.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL row and evidence' } });
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(patch());
    expect(response.status).toBe(status);
    const body = await response.json(); expect(body.error.code).toBe(safeCode); expect(JSON.stringify(body)).not.toContain('private SQL');
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('never publishes credential-bearing update links', async () => {
    const stub = databaseStub(); stub.result.data = [{ ...record, update_url: 'https://example.com/article?token=private-secret' }];
    const response = await createAdminHandler({ authorize: authorized, db: stub.db })(get());
    expect((await response.json()).keywords[0].update_url).toBe('');
  });

  it('does not bypass requireAdmin when passed an administrator field', async () => {
    const stub = databaseStub();
    const authorize = async () => { throw new CollectionError(403, 'admin_required', 'Administrator access required.'); };
    const response = await createAdminHandler({ authorize, db: stub.db })(patch({ ...decision, admin: true }));
    expect(response.status).toBe(403); expect(stub.rpc).not.toHaveBeenCalled(); expect(stub.db).not.toHaveBeenCalled();
  });
});
