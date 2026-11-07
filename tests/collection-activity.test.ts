import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { aggregateActivity, activityQuery, collectionCommitments, createCollectionActivityHandler, type CollectionCheckRow, type CollectionCommitmentRow, type PolicyRow } from '../netlify/functions/_shared/collection-activity';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { CollectionError } from '../netlify/functions/_shared/security';
import { CollectionCosts, CostFilterForm, validCostDates } from '../src/admin/CollectionCosts';
import type { CollectionJobRecord } from '../src/lib/admin-types';

const query = (params = '') => activityQuery(new URL('https://app.example/api/collection-activity?from=2026-10-21&to=2026-10-23' + params));
const check = (patch: Partial<CollectionCheckRow> = {}): CollectionCheckRow => ({ id: 'check-a', user_id: 'user_a', source_id: 'channel-a', source_name: 'Example channel', source_url: 'https://www.youtube.com/@example', platform: 'YouTube', status: 'unchanged', started_at: '2026-10-23T08:00:00Z', finished_at: '2026-10-23T08:00:01Z', duration_ms: 1000, new_count: 0, retrieved_count: 0, http_status: 304, error_code: null, provider: 'native', job_id: null, provider_run_id: null, observed_cost_usd: 0, cost_status: 'no_provider_charge', details: {}, ...patch });
const job = (patch: Partial<CollectionJobRecord> = {}): CollectionJobRecord => ({ id: 'job-a', user_id: 'user_a', source_id: 'channel-a', source_name: 'Example channel', source_url: 'https://www.youtube.com/@example', platform: 'YouTube', provider: 'apify', actor_id: 'example/captions', provider_run_id: 'run-a', status: 'succeeded', result_count: 9, observed_cost_usd: .005, cost_status: 'provider_reported', error_code: null, created_at: '2026-10-23T08:00:01Z', finished_at: '2026-10-23T08:01:00Z', ...patch });
const policy: PolicyRow = { user_id: 'user_a', enabled: true, provider_enabled: false, daily_limit_usd: .1, lifetime_limit_usd: 1, updated_at: '2026-10-23T07:00:00Z' };
const commitment = (patch: Partial<CollectionCommitmentRow> = {}): CollectionCommitmentRow => ({ user_id: 'user_a', job_id: 'job-a', created_at: '2026-10-23T08:00:00Z', maximum_usd: .005, actual_cost_usd: null, observed_cost_usd: null, ...patch });

describe('current UTC policy commitments', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  it('keeps the greater reserved maximum or running observation while final cost is unknown, including prior days', () => {
    const result = collectionCommitments([commitment({ created_at: '2026-10-20T08:00:00Z', observed_cost_usd: .007 }), commitment({ job_id: 'job-b', created_at: '2026-10-21T08:00:00Z', observed_cost_usd: .001 })], now).get('user_a');
    expect(result).toEqual({ day: '2026-10-23', dailyUsd: .012, lifetimeUsd: .012, unfinalizedJobs: 2 });
  });
  it('uses the greater final or observed cost, and includes old final costs only in lifetime commitment', () => {
    const result = collectionCommitments([commitment({ actual_cost_usd: .003, observed_cost_usd: .004 }), commitment({ job_id: 'job-b', created_at: '2026-10-22T23:59:59+00:00', actual_cost_usd: .006, observed_cost_usd: .002 })], now).get('user_a');
    expect(result).toEqual({ day: '2026-10-23', dailyUsd: .004, lifetimeUsd: .01, unfinalizedJobs: 0 });
  });
  it('preserves known zero final charges, distinct readers, and twelve-decimal observations', () => {
    const result = collectionCommitments([commitment({ actual_cost_usd: 0, observed_cost_usd: null }), commitment({ user_id: 'user_b', job_id: 'job-b', actual_cost_usd: .000000000001, observed_cost_usd: .000000000002 })], now);
    expect(result.get('user_a')).toMatchObject({ dailyUsd: 0, lifetimeUsd: 0, unfinalizedJobs: 0 });
    expect(result.get('user_b')?.dailyUsd).toBe(.000000000002);
  });
  it('deduplicates repeated job references without multiplying committed amounts', () => {
    expect(collectionCommitments([commitment(), commitment()], now).get('user_a')).toMatchObject({ dailyUsd: .005, lifetimeUsd: .005, unfinalizedJobs: 1 });
  });
});

describe('honest collection cost aggregation', () => {
  it('preserves the difference between no records, unknown fees and explicit zero supplier fees', () => {
    expect(aggregateActivity([], [], query()).summary.supplierCostUsd).toBeNull();
    const unknown = aggregateActivity([], [job({ observed_cost_usd: null, cost_status: 'unknown' })], query());
    expect(unknown.summary).toMatchObject({ supplierCostUsd: null, knownCostCount: 0, unknownCostCount: 1, noSupplierFeeCount: 0, costPerPullUsd: null });
    const zero = aggregateActivity([check()], [], query());
    expect(zero.summary).toMatchObject({ supplierCostUsd: 0, knownCostCount: 1, unknownCostCount: 0, noSupplierFeeCount: 1, checks: 1, costPerPullUsd: 0 });
    expect(zero.infrastructure).toBe('unmeasured');
  });
  it('adds each distinct run fee, including controller overhead, without inventing historical new-item totals', () => {
    const report = aggregateActivity([], [job(), job({ id: 'child-b', provider_run_id: 'run-b' }), job({ id: 'controller', provider_run_id: 'run-controller', source_id: 'tech-controller', platform: 'Collection', observed_cost_usd: .001, result_count: 18 })], query());
    expect(report.summary).toMatchObject({ supplierCostUsd: .011, providerRuns: 3, pulls: 2, newItems: 0, retrievedItems: 0 });
    expect(report.sources.find(source => source.key === 'unattributed')).toMatchObject({ supplierCostUsd: .001, pulls: 0, costPerPullUsd: null });
    expect(report.sources.find(source => source.label === 'Example channel')).toMatchObject({ supplierCostUsd: .01, pulls: 2, costPerPullUsd: .005 });
  });
  it('deduplicates repeated job/run references but never equal prices across distinct runs', () => {
    const report = aggregateActivity([], [job(), job(), job({ id: 'other-copy' }), job({ id: 'job-b', provider_run_id: 'run-b' })], query());
    expect(report.summary.supplierCostUsd).toBe(.01);
    expect(report.summary.providerRuns).toBe(2);
  });
  it('uses authoritative jobs for a multi-child check, ignoring all nested and check cost mirrors', () => {
    const details = { providerJobs: [{ jobId: 'job-a', providerRunId: 'run-a', observedCostUsd: 99 }, { jobId: 'job-b', providerRunId: 'run-b', observedCostUsd: 99 }, { jobId: 'job-a', providerRunId: 'run-a', observedCostUsd: 99 }] };
    const report = aggregateActivity([check({ provider: 'apify', cost_status: 'provider_reported', observed_cost_usd: 999, details, new_count: 2, retrieved_count: 2 })], [job(), job({ id: 'job-b', provider_run_id: 'run-b', observed_cost_usd: .003 })], query());
    expect(report.summary).toMatchObject({ supplierCostUsd: .008, knownCostCount: 2, unknownCostCount: 0, checks: 1, pulls: 1, providerRuns: 2, newItems: 2, retrievedItems: 2 });
    expect(report.events.find(event => event.kind === 'check')).toMatchObject({ supplierCostUsd: .008, linkedJobs: expect.any(Array) });
  });
  it('keeps a partially reported check subtotal with an unknown count, including missing linked jobs', () => {
    const report = aggregateActivity([check({ provider: 'apify', details: { providerJobs: [{ jobId: 'job-a' }, { jobId: 'job-b' }] } })], [job()], query());
    expect(report.summary).toMatchObject({ supplierCostUsd: .005, knownCostCount: 1, unknownCostCount: 1, costPerPullUsd: null });
    expect(report.events.find(event => event.kind === 'check')).toMatchObject({ supplierCostUsd: .005, unknownCostCount: 1 });
  });
  it('does not convert a paid mirror without a canonical job into a known fee', () => {
    const report = aggregateActivity([check({ provider: 'apify', observed_cost_usd: 10, cost_status: 'provider_reported' })], [], query());
    expect(report.summary).toMatchObject({ supplierCostUsd: null, unknownCostCount: 1 });
  });
  it('sums tiny observations before display rounding with twelve-decimal precision', () => {
    const report = aggregateActivity([], [job({ observed_cost_usd: .000000000001 }), job({ id: 'job-b', provider_run_id: 'run-b', observed_cost_usd: .000000000002 })], query());
    expect(report.summary.supplierCostUsd).toBe(.000000000003);
  });
  it('preserves known high-water observations over repeated stale or lower copies', () => {
    const report = aggregateActivity([], [job({ observed_cost_usd: .02 }), job({ observed_cost_usd: .01 }), job({ observed_cost_usd: null, cost_status: 'unknown' })], query());
    expect(report.summary.supplierCostUsd).toBe(.02); expect(report.summary.unknownCostCount).toBe(0);
  });
  it('requires actual paid-run evidence and validates no-provider-charge semantics', () => {
    const report = aggregateActivity([], [job({ provider_run_id: null }), job({ id: 'wrong-zero', provider_run_id: 'run-zero', observed_cost_usd: 0, cost_status: 'no_provider_charge' })], query());
    expect(report.summary.supplierCostUsd).toBeNull(); expect(report.summary.unknownCostCount).toBe(2);
  });
  it('compares timestamp instants rather than ISO string formatting at range boundaries', () => {
    const report = aggregateActivity([check({ provider: 'apify', job_id: 'job-a' })], [job({ created_at: '2026-10-24T00:00:00+00:00' })], query());
    expect(report.summary.supplierCostUsd).toBeNull(); expect(report.summary.providerRuns).toBe(0);
    const offset = aggregateActivity([check({ started_at: '2026-10-23T01:00:00+02:00' })], [], query());
    expect(offset.days[0].day).toBe('2026-10-22');
  });
  it('groups by UTC initiation day, keeps source names, and leaves old job results in their log', () => {
    const report = aggregateActivity([check({ started_at: '2026-10-22T23:59:59Z', new_count: 1, retrieved_count: 1, provider: 'apify', job_id: 'job-a' })], [job({ created_at: '2026-10-23T00:00:01Z', result_count: 34 })], query());
    expect(report.sourceDays.find(row => row.day === '2026-10-23')).toMatchObject({ label: 'Example channel', supplierCostUsd: .005 });
    expect(report.summary.newItems).toBe(1);
    expect(report.events.find(event => event.kind === 'provider_job')?.resultCount).toBe(34);
    expect(report.userDays).toHaveLength(2);
  });
  it('sanitizes private source URLs and explicitly allowlists check details', () => {
    const report = aggregateActivity([check({ source_url: 'https://example.com/feed?token=secret-sentinel', details: { mode: 'youtube_rss', gapPossible: true, deferredCount: 2, reservedUsd: .005, pollToken: 'secret-sentinel', privateState: { apiKey: 'secret-sentinel' } } })], [], query());
    expect(JSON.stringify(report)).not.toContain('secret-sentinel');
    expect(report.events[0].details).toEqual({ mode: 'youtube_rss', gapPossible: true, deferredCount: 2, reservedMaximumUsd: .005 });
    expect(report.summary.supplierCostUsd).toBe(0);
  });
  it('filters source and reader totals without attributing someone else’s same-source costs', () => {
    const report = aggregateActivity([], [job(), job({ id: 'job-b', user_id: 'user_b', provider_run_id: 'run-b', observed_cost_usd: .04 })], activityQuery(new URL('https://app.example/api/admin?from=2026-10-21&to=2026-10-23&user=user_a'), true));
    expect(report.summary.supplierCostUsd).toBe(.005);
    expect(report.events.every(event => event.userId === 'user_a')).toBe(true);
  });
  it('keeps window totals independent of the fifty-row event page', () => {
    const rows = Array.from({ length: 61 }, (_, index) => check({ id: 'check-' + index }));
    const report = aggregateActivity(rows, [], query('&page=1'));
    expect(report.summary.checks).toBe(61); expect(report.total).toBe(61); expect(report.events).toHaveLength(11);
  });
});

type Row = { [key: string]: unknown };
function dbStub(tables: Record<string, unknown[]> = {}, error = false) {
  const calls: Array<{ table: string; filters: Array<[string, string, unknown]>; range: number[]; columns: string }> = [];
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let columns = '';
    const builder = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn(), insert };
    builder.select.mockImplementation(value => { columns = value; return builder; }); builder.order.mockReturnValue(builder);
    for (const operation of ['eq', 'gte', 'lt', 'in'] as const) builder[operation].mockImplementation((column, value) => { filters.push([operation, column, value]); return builder; });
    builder.range.mockImplementation(async (start: number, end: number) => {
      calls.push({ table, filters: [...filters], range: [start, end], columns });
      const rows = (tables[table] || []).map(value => table === 'reader_collection_provider_jobs' ? { ...commitment(), ...value as Row } : value).filter(value => filters.every(([operation, column, target]) => {
        const row = value as Row;
        return operation === 'eq' ? row[column] === target : operation === 'in' ? (target as unknown[]).includes(row[column]) : operation === 'gte' ? String(row[column]) >= String(target) : String(row[column]) < String(target);
      }));
      return { data: rows.slice(start, end + 1), error: error ? { message: 'internal-secret-sentinel' } : null };
    });
    return builder;
  });
  const db = vi.fn(() => ({ from })) as unknown as NonNullable<Parameters<typeof createCollectionActivityHandler>[0]>['db'];
  return { db, calls, from, insert };
}
const ownRequest = (suffix = '') => new Request('https://app.example/api/collection-activity?from=2026-10-21&to=2026-10-23' + suffix);
const own = (stub: ReturnType<typeof dbStub>) => createCollectionActivityHandler({ db: stub.db, authenticate: async () => 'user_a', env: key => key === 'HOURLY_COLLECTION_ENABLED' ? 'true' : undefined, now: () => new Date('2026-10-23T12:00:00Z') });

describe('authenticated own-user collection activity', () => {
  it('returns 401 before opening a privileged database client', async () => {
    const stub = dbStub(); const response = await createCollectionActivityHandler({ db: stub.db })(ownRequest());
    expect(response.status).toBe(401); expect(stub.db).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
  it.each(['&user=user_b', '&user_id=user_b', '&id=user_b', '&email=other%40example.com'])('rejects caller-selected identities before any database access (%s)', async suffix => {
    const stub = dbStub(); const response = await own(stub)(ownRequest(suffix));
    expect(response.status).toBe(403); expect(stub.db).not.toHaveBeenCalled();
  });
  it('applies verified subject ownership to every table, related lookup, aggregate and policy', async () => {
    const stub = dbStub({ reader_collection_checks: [check({ job_id: 'foreign-job', provider: 'apify' }), check({ id: 'other-check', user_id: 'user_b' })], collection_jobs: [job(), job({ id: 'foreign-job', user_id: 'user_b', provider_run_id: 'private-other-run', observed_cost_usd: 20 })], reader_collection_policies: [policy, { ...policy, user_id: 'user_b' }] });
    const response = await own(stub)(ownRequest()); const result = await response.json();
    expect(response.status).toBe(200); expect(result.summary.supplierCostUsd).toBe(.005); expect(result.policies).toHaveLength(1);
    expect(stub.calls.every(call => call.table === 'collection_retrieval_attempts' ? call.filters.some(filter => filter[0] === 'in' && ['check_id','job_id'].includes(String(filter[1]))) : call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'user_id' && filter[2] === 'user_a'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-other-run'); expect(JSON.stringify(result)).not.toContain('user_b');
    expect(stub.calls.filter(call => call.table === 'reader_collection_provider_jobs').every(call => ['user_id,check_id,job_id', 'user_id,job_id,created_at,maximum_usd,actual_cost_usd,observed_cost_usd'].includes(call.columns))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('job_token'); expect(stub.insert).not.toHaveBeenCalled();
  });
  it('resolves checks outside the date range for in-range jobs while preserving own-user scope and source attribution', async () => {
    const previous = check({ provider: 'apify', started_at: '2026-10-20T23:59:59Z', job_id: 'job-a' });
    const stub = dbStub({ reader_collection_checks: [previous], collection_jobs: [job({ source_id: 'video-a', source_name: 'Example video', source_url: 'https://www.youtube.com/watch?v=abcdefghijk' })], reader_collection_provider_jobs: [{ user_id: 'user_a', check_id: previous.id, job_id: 'job-a', job_token: 'secret-token-sentinel' }, { user_id: 'user_b', check_id: 'foreign-check', job_id: 'job-a' }] });
    const response = await own(stub)(ownRequest('&source=' + encodeURIComponent(previous.source_url))); const result = await response.json();
    expect(response.status).toBe(200); expect(result.summary.supplierCostUsd).toBe(.005);
    expect(result.sources[0].label).toBe('Example channel'); expect(result.summary.checks).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/secret-token-sentinel|foreign-check|user_b/);
    expect(stub.calls.every(call => call.table === 'collection_retrieval_attempts' ? call.filters.some(filter => filter[0] === 'in' && ['check_id','job_id'].includes(String(filter[1]))) : call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'user_id' && filter[2] === 'user_a'))).toBe(true);
    expect(stub.calls.some(call => call.table === 'reader_collection_provider_jobs' && call.columns === 'user_id,check_id,job_id')).toBe(true);
  });
  it('keeps current policy commitments independent of the report source and date filters without leaking private rows', async () => {
    const stub = dbStub({ reader_collection_policies: [policy], collection_jobs: [job()], reader_collection_provider_jobs: [{ ...commitment({ created_at: '2026-10-20T08:00:00Z', observed_cost_usd: .007 }), job_token: 'secret-token-sentinel' }, commitment({ user_id: 'user_b', job_id: 'foreign-job', observed_cost_usd: .09 })] });
    const plain = await (await own(stub)(ownRequest())).json();
    const filtered = await (await own(stub)(ownRequest('&source=absent-source'))).json();
    expect(filtered.summary.supplierCostUsd).toBeNull(); expect(filtered.policies).toEqual(plain.policies);
    expect(filtered.policies[0].commitments).toEqual({ day: '2026-10-23', dailyUsd: .007, lifetimeUsd: .007, unfinalizedJobs: 1 });
    expect(plain.summary.supplierCostUsd).toBe(.005);
    expect(JSON.stringify(filtered)).not.toMatch(/secret-token-sentinel|foreign-job|user_b|maximum_usd|actual_cost_usd|observed_cost_usd/);
    const calls = stub.calls.filter(call => call.columns.includes('maximum_usd'));
    expect(calls.every(call => call.filters.length === 1 && call.filters[0][1] === 'user_id')).toBe(true);
  });
  it('retains the durable source association after an unfollow clears copied check references across midnight', async () => {
    const previous = check({ status: 'blocked', error_code: 'source_no_longer_followed', provider: 'native', started_at: '2026-10-20T23:59:59Z', job_id: null, provider_run_id: null, details: {} });
    const stub = dbStub({ reader_collection_checks: [previous], collection_jobs: [job({ source_id: 'video-a', source_name: 'Example video', source_url: 'https://www.youtube.com/watch?v=abcdefghijk' })], reader_collection_provider_jobs: [{ user_id: 'user_a', check_id: previous.id, job_id: 'job-a', job_token: 'secret-token-sentinel' }] });
    const response = await own(stub)(ownRequest('&source=' + encodeURIComponent(previous.source_url))); const result = await response.json();
    expect(response.status).toBe(200); expect(result.summary.supplierCostUsd).toBe(.005); expect(result.summary.providerRuns).toBe(1);
    expect(result.sources[0].label).toBe('Example channel'); expect(result.events[0].sourceUrl).toBe(previous.source_url);
    expect(JSON.stringify(result)).not.toContain('secret-token-sentinel'); expect(stub.insert).not.toHaveBeenCalled();
  });
  it('uses durable links for an in-range unfollowed check whose paid job starts in a later UTC day', async () => {
    const current = check({ status: 'blocked', error_code: 'source_no_longer_followed', job_id: null, details: {} });
    const stub = dbStub({ reader_collection_checks: [current], collection_jobs: [job({ created_at: '2026-10-24T00:00:00+00:00' })], reader_collection_provider_jobs: [{ user_id: 'user_a', check_id: current.id, job_id: 'job-a' }] });
    const response = await own(stub)(ownRequest()); const result = await response.json();
    expect(result.events[0].supplierCostUsd).toBe(.005); expect(result.events[0].noSupplierFee).toBe(false);
    expect(result.summary.supplierCostUsd).toBeNull(); expect(result.summary.providerRuns).toBe(0); expect(result.summary.unknownCostCount).toBe(0);
  });
  it('resolves an owned linked job outside the selected range without moving its cost to the check day', async () => {
    const stub = dbStub({ reader_collection_checks: [check({ provider: 'apify', job_id: 'job-a' })], collection_jobs: [job({ created_at: '2026-10-20T23:59:59Z' })] });
    const response = await own(stub)(ownRequest()); const result = await response.json();
    expect(result.events[0].supplierCostUsd).toBe(.005); expect(result.summary.supplierCostUsd).toBeNull();
    expect(result.summary.unknownCostCount).toBe(0);
    expect(stub.calls.some(call => call.table === 'collection_jobs' && call.filters.some(filter => filter[0] === 'in'))).toBe(true);
  });
  it('reads all database pages before aggregating and makes no supplier fetches', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected request'));
    try {
      const stub = dbStub({ reader_collection_checks: Array.from({ length: 1001 }, (_, index) => check({ id: 'check-' + index })) });
      const response = await own(stub)(ownRequest()); const result = await response.json();
      expect(result.summary.checks).toBe(1001); expect(result.events).toHaveLength(50); expect(result.total).toBe(1001);
      expect(stub.calls.filter(call => call.table === 'reader_collection_checks').map(call => call.range)).toEqual([[0, 999], [1000, 1999]]);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it('withholds raw database errors', async () => {
    const response = await own(dbStub({}, true))(ownRequest()); expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('internal-secret-sentinel');
  });
  it('rejects an overfull report instead of presenting a silently truncated cost subtotal', async () => {
    const stub = dbStub({ reader_collection_checks: Array.from({ length: 10001 }, (_, index) => check({ id: 'check-' + index })) });
    const response = await own(stub)(ownRequest()); const result = await response.json();
    expect(response.status).toBe(400); expect(result.error.code).toBe('activity_range_too_large'); expect(result.summary).toBeUndefined();
  });
  it.each(['&to=invalid', '&from=2026-02-30', '&from=2020-01-01', '&page=-1', '&source=a&source=b'])('rejects invalid or unbounded filters (%s)', async suffix => {
    // Repeated date keys are invalid too; no database request is made.
    const stub = dbStub(); const response = await own(stub)(ownRequest(suffix));
    expect(response.status).toBe(400); expect(stub.db).not.toHaveBeenCalled();
  });
  it('uses 400 for an invalid single end date rather than throwing a date serialization error', () => {
    expect(() => activityQuery(new URL('https://app.example/api/collection-activity?to=invalid'))).toThrow(CollectionError);
  });
  it('rejects mutation methods without querying or writing', async () => {
    const stub = dbStub(); const response = await own(stub)(new Request(ownRequest(), { method: 'POST' }));
    expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('GET'); expect(stub.db).not.toHaveBeenCalled();
  });
});

describe('private admin costs and compact rendering', () => {
  it('validates the 93-day limit locally and retains selected source controls without activity data', () => {
    expect(validCostDates('2026-01-01', '2026-04-03')).toBe(true);
    expect(validCostDates('2026-01-01', '2026-04-04')).toBe(false);
    expect(validCostDates('2026-10-23', '2026-10-21')).toBe(false);
    const html = renderToStaticMarkup(createElement(CostFilterForm, { filters: { from: '2026-10-21', to: '2026-10-23', source: 'absent-source', user: '', page: 0 }, onChange: () => undefined }));
    expect(html).toContain('Selected source'); expect(html).toContain('value="absent-source" selected'); expect(html).toContain('Clear filters');
  });
  it('uses the existing administrator gate and audits cost views before returning data', async () => {
    const stub = dbStub({ collection_jobs: [job()], reader_collection_policies: [policy] });
    const response = await createAdminHandler({ db: stub.db, authorize: async () => 'user_owner' })(new Request('https://app.example/api/admin?section=costs&from=2026-10-21&to=2026-10-23'));
    expect(response.status).toBe(200); expect((await response.json()).costs.summary.supplierCostUsd).toBe(.005);
    expect(stub.insert).toHaveBeenCalledWith(expect.objectContaining({ admin_id: 'user_owner', action: 'collection_costs.viewed' }));
  });
  it('fails closed when administrative access logging fails', async () => {
    const stub = dbStub({ collection_jobs: [job()] }); stub.insert.mockResolvedValue({ error: { message: 'private' } });
    const response = await createAdminHandler({ db: stub.db, authorize: async () => 'user_owner' })(new Request('https://app.example/api/admin?section=costs'));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('Example channel');
  });
  it('renders zero supplier fees, unknowns, exact details, date filters and overhead without claiming total operating cost', () => {
    const data = aggregateActivity([check()], [job({ observed_cost_usd: null, cost_status: 'unknown' }), job({ id: 'controller', provider_run_id: 'controller-run', platform: 'Collection', observed_cost_usd: .000000000003 })], query(), [policy]);
    const html = renderToStaticMarkup(createElement(CollectionCosts, { data, filters: { from: '', to: '', source: '', user: '', page: 0 }, onChange: () => undefined, openReader: () => undefined }));
    expect(html).toContain('No supplier fee'); expect(html).toContain('unreported'); expect(html).toContain('infrastructure costs are unmeasured');
    expect(html).toContain('Controller / unattributed overhead'); expect(html).toContain('$0.000000000003');
    expect(html).toContain('type="date"'); expect(html).toContain('Inspect log'); expect(html).toContain('Daily breakdown');
  });
});
