import { describe, expect, it, vi } from 'vitest';
import { readAnalysisOperations, readAnalysisSettings } from '../netlify/functions/_shared/analysis-settings-admin';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { ANALYSIS_JOB_STATES, DEFAULT_ANALYSIS_MODEL } from '../src/lib/analysis-settings-types';

const now = new Date('2026-10-25T12:00:00.000Z');
const old = '2026-10-24T08:00:00.000Z', today = '2026-10-25T08:00:00.000Z';
const call = (index: number, extra: Record<string, unknown> = {}) => ({
  id: String(index).padStart(8, '0'), created_at: today, maximum_usd: '0.01', observed_usd: null, actual_usd: null, state: 'unknown', ...extra,
});
interface Query { table: string; columns: string; options?: { count?: string; head?: boolean }; filters: Record<string, unknown>; limit?: number; orders: unknown[] }
function stub(options: { calls?: ReturnType<typeof call>[]; laterCalls?: ReturnType<typeof call>[]; errors?: Record<string, unknown>[]; counts?: Partial<Record<typeof ANALYSIS_JOB_STATES[number], number>>; reviews?: number; leases?: number; failTable?: string; total?: number; shortPage?: boolean } = {}) {
  const reads: Query[] = [], calls = options.calls || [];
  let ledgerPass = 0;
  const from = vi.fn((table: string) => {
    const read: Query = { table, columns: '', filters: {}, orders: [] }; reads.push(read);
    const execute = () => {
      if (options.failTable === table) return { data: null, count: null, error: { message: 'PRIVATE failure secret synthetic-owner' } };
      if (table === 'content_analysis_runtime_settings') return { data: { selected_model: DEFAULT_ANALYSIS_MODEL, revision: 1, updated_at: old, updated_by: 'synthetic-owner' }, error: null };
      if (table === 'content_analysis_budget') return { data: { enabled: false, daily_limit_usd: 5, lifetime_limit_usd: 5 }, error: null };
      if (table === 'admin_keyword_reviews') return { data: null, count: options.reviews ?? 0, error: null };
      if (table === 'reader_content_analysis_jobs') {
        if (!read.options?.head) return { data: options.errors || [], error: null };
        return { data: null, count: read.filters['lt:lease_until'] ? options.leases ?? 0 : options.counts?.[read.filters['eq:state'] as typeof ANALYSIS_JOB_STATES[number]] ?? 0, error: null };
      }
      if (table === 'reader_content_analysis_calls') {
        if (read.options?.head) ledgerPass++;
        const source = ledgerPass > 1 && options.laterCalls ? options.laterCalls : calls;
        if (read.options?.head) return { data: null, count: options.total ?? source.length, error: null };
        const rows = source.filter(row => !read.filters['gt:id'] || row.id > String(read.filters['gt:id']));
        return { data: rows.slice(0, options.shortPage ? 0 : read.limit), error: null };
      }
      throw new Error('Unexpected table');
    };
    const chain = {
      select: (columns: string, config?: Query['options']) => { read.columns = columns; read.options = config; return chain; },
      eq: (key: string, value: unknown) => { read.filters['eq:' + key] = value; return chain; },
      in: (key: string, value: unknown) => { read.filters['in:' + key] = value; return chain; },
      not: (key: string, operator: string, value: unknown) => { read.filters['not:' + key] = [operator, value]; return chain; },
      lt: (key: string, value: unknown) => { read.filters['lt:' + key] = value; return chain; },
      lte: (key: string, value: unknown) => { read.filters['lte:' + key] = value; return chain; },
      gt: (key: string, value: unknown) => { read.filters['gt:' + key] = value; return chain; },
      order: (...args: unknown[]) => { read.orders.push(args); return chain; },
      limit: (limit: number) => { read.limit = limit; return chain; },
      maybeSingle: async () => execute(),
      then: (resolve: (result: unknown) => unknown, reject: (failure: unknown) => unknown) => Promise.resolve().then(execute).then(resolve, reject),
    };
    return chain;
  });
  const rpc = vi.fn(() => { throw new Error('No operations mutation is allowed'); });
  const db = { from, rpc } as unknown as Parameters<typeof readAnalysisOperations>[0];
  return { db, from, rpc, reads };
}

describe('private read-only content analysis operations', () => {
  it('preserves unknown holds, separates observed from settled charges and carries holds across UTC days', async () => {
    const test = stub({
      calls: [call(1, { created_at: old, maximum_usd: '0.009178191' }), call(2, { created_at: old, observed_usd: '0.003', actual_usd: '0.002', state: 'settled' }), call(3, { observed_usd: '0.02' }), call(4, { observed_usd: '0.001', actual_usd: '0', state: 'settled' })],
      counts: { queued: 10, running: 2, prepared: 3, published: 8, evaluated: 9, failed: 1, blocked: 4, cancelled: 5, skipped: 6 }, reviews: 7, leases: 2,
      errors: [{ error_code: 'analysis_lease_expired', updated_at: today, user_id: 'synthetic-owner', result: 'PRIVATE raw original' }, { error_code: 'private_source_name', updated_at: old }],
    });
    const operations = await readAnalysisOperations(test.db, now);
    expect(operations.jobs).toEqual({ queued: 10, running: 2, prepared: 3, published: 8, evaluated: 9, failed: 1, blocked: 4, cancelled: 5, skipped: 6 });
    expect(operations.pendingKeywordReviews).toBe(7); expect(operations.staleLeases).toBe(2);
    expect(operations.spending).toEqual({ observedUsd: 0.024, observedCalls: 3, settledUsd: 0.002, settledCalls: 2, unknownCommittedUsd: 0.029178191, unknownCalls: 2, committedUsd: 0.033178191, dailyCommittedUsd: 0.030178191, day: '2026-10-25' });
    expect(operations.ledger).toEqual({ rowsRead: 4, totalRows: 4, rowLimit: 5000, complete: true });
    expect(operations.recentErrors).toEqual([{ code: 'analysis_lease_expired', at: today }, { code: 'analysis_error_other', at: old }]);
    expect(operations.alerts).toEqual(['stale_leases', 'unknown_charges', 'failed_jobs', 'blocked_jobs', 'pending_reviews']);
    const serialized = JSON.stringify(operations);
    expect(serialized).not.toMatch(/synthetic-owner|PRIVATE|private_source_name|0000000/);
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it('returns unreported costs for absent receipts and preserves an explicitly settled zero', async () => {
    const empty = await readAnalysisOperations(stub().db, now);
    expect(empty.spending.observedUsd).toBeNull(); expect(empty.spending.settledUsd).toBeNull();
    expect(empty.spending.committedUsd).toBe(0); expect(empty.ledger.complete).toBe(true); expect(empty.alerts).toEqual([]);
    const zero = await readAnalysisOperations(stub({ calls: [call(1, { state: 'settled', actual_usd: 0 })] }).db, now);
    expect(zero.spending.settledUsd).toBe(0); expect(zero.spending.settledCalls).toBe(1); expect(zero.spending.unknownCalls).toBe(0);
  });
  it('selects only head counts and bounded finance/error projections without content, identity or result payloads', async () => {
    const test = stub({ calls: [call(1)] }); await readAnalysisOperations(test.db, now);
    expect(new Set(test.reads.map(read => read.table))).toEqual(new Set(['reader_content_analysis_jobs', 'reader_content_analysis_calls', 'admin_keyword_reviews']));
    for (const read of test.reads) {
      expect(read.columns).not.toMatch(/user_id|update_id|source_id|result|usage|execution_identity|provider_id|call_key|\*/);
      if (read.options?.head) expect(read.options).toEqual({ count: 'exact', head: true });
      else expect(read.limit).toBeLessThanOrEqual(1000);
    }
    expect(test.reads.filter(read => read.table === 'reader_content_analysis_calls' && !read.options?.head)).toHaveLength(2);
    expect(test.reads.some(read => read.filters['lt:lease_until'] === now.toISOString())).toBe(true);
    expect(test.reads.filter(read => read.table === 'reader_content_analysis_calls').every(read => read.filters['lte:created_at'] === now.toISOString())).toBe(true);
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it('paginates by a stable projected ID and marks row-limit totals as incomplete', async () => {
    const calls = Array.from({ length: 5001 }, (_, index) => call(index));
    const test = stub({ calls }); const operations = await readAnalysisOperations(test.db, now);
    expect(operations.ledger).toEqual({ rowsRead: 5000, rowLimit: 5000, totalRows: 5001, complete: false });
    expect(operations.spending.unknownCommittedUsd).toBe(50);
    expect(operations.alerts).toContain('ledger_incomplete');
    const pages = test.reads.filter(read => read.table === 'reader_content_analysis_calls' && !read.options?.head);
    expect(pages).toHaveLength(10); expect(pages[1].filters['gt:id']).toBe('00000999');
    expect(pages.every(read => read.limit === 1000 && JSON.stringify(read.orders) === JSON.stringify([['id', { ascending: true }]]))).toBe(true);
  });
  it('flags an unsettled-to-settled change between reads and never claims an atomic total', async () => {
    const operations = await readAnalysisOperations(stub({ calls: [call(1)], laterCalls: [call(1, { state: 'settled', actual_usd: '0.001' })] }).db, now);
    expect(operations.ledger.complete).toBe(false); expect(operations.alerts).toEqual(['ledger_incomplete', 'ledger_changed']);
    expect(operations.spending.settledUsd).toBe(0.001); expect(operations.spending.unknownCalls).toBe(0);
  });
  it('flags a short result page instead of reporting the row subset as complete', async () => {
    const operations = await readAnalysisOperations(stub({ calls: [call(1)], shortPage: true }).db, now);
    expect(operations.ledger).toMatchObject({ rowsRead: 0, totalRows: 1, complete: false }); expect(operations.alerts).toContain('ledger_incomplete');
  });
  it.each([{ maximum_usd: -1 }, { observed_usd: 'NaN' }, { actual_usd: -1, state: 'settled' }, { maximum_usd: '' }, { maximum_usd: '1e2' }, { state: 'settled' }, { actual_usd: 0 }, { created_at: 'not a date' }, { created_at: '2027-01-01T00:00:00Z' }])('refuses malformed financial projections %j', async extra => {
    await expect(readAnalysisOperations(stub({ calls: [call(1, extra)] }).db, now)).rejects.toThrow();
  });
  it('keeps settings readable with optional unavailable monitoring and no private failure reflection', async () => {
    const test = stub({ failTable: 'reader_content_analysis_calls' });
    const result = await readAnalysisSettings(test.db, () => undefined);
    expect(result.analysis).toEqual({ selectedModel: DEFAULT_ANALYSIS_MODEL, revision: 1, updatedAt: old, keyConfigured: false, runtimeEnabled: false, budget: { enabled: false, dailyLimitUsd: 5, lifetimeLimitUsd: 5 } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret|synthetic-owner/); expect(test.rpc).not.toHaveBeenCalled();
  });
  it('exposes the safe projection only after the existing admin authorizer succeeds', async () => {
    const test = stub({ calls: [call(1, { created_at: old })] }), db = vi.fn(() => test.db);
    const request = () => new Request('https://synthetic.invalid/api/admin?section=analysis');
    const denied = await createAdminHandler({ db })(request());
    expect(denied.status).toBe(401); expect(db).not.toHaveBeenCalled();
    const authorize = vi.fn(async () => 'synthetic-private-admin');
    const response = await createAdminHandler({ db, authorize, env: () => undefined })(request());
    expect(authorize).toHaveBeenCalledOnce(); expect(response.status).toBe(200);
    expect((await response.json()).analysis.operations.ledger.complete).toBe(true);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(test.rpc).not.toHaveBeenCalled();
  });
});

describe('source-free content-v3 error visibility',()=>{
 it.each(['analysis_unsupported_summary_unit','analysis_summary_omission','analysis_empty_summary_requires_review','analysis_generation_contract_changed'])('retains the fixed %s diagnostic without private context',async code=>{
  const operations=await readAnalysisOperations(stub({errors:[{error_code:code,updated_at:today,user_id:'synthetic-private-owner',result:'PRIVATE source'}]}).db,now);
  expect(operations.recentErrors).toEqual([{code,at:today}]);expect(JSON.stringify(operations)).not.toMatch(/synthetic-private-owner|PRIVATE/);
 });
});
