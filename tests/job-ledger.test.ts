import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Source } from '../src/lib/types';
import { database } from '../netlify/functions/_shared/admin-data';
import { finishJob, startJob } from '../netlify/functions/_shared/job-ledger';

vi.mock('../netlify/functions/_shared/admin-data', () => ({ database: vi.fn() }));
const id = 'a9a43a2a-c01a-40eb-ae1e-a1d41b52b901';
const env = () => undefined;
const feed: Source = { id: 'public-blog', name: 'Public writing', url: 'https://example.com/feed', platform: 'Blog', creatorIds: [], status: 'pending' };
interface Result { data?: unknown; error?: unknown }
interface Call { table: string; operation?: string; value?: unknown; filters: Array<[string, unknown]> }
function mockDatabase(results: Result[]) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, filters: [] }; calls.push(call);
    const result = results[calls.length - 1] ?? { data: null };
    const query = {
      insert: (value: unknown) => { call.operation = 'insert'; call.value = value; return query; },
      update: (value: unknown) => { call.operation = 'update'; call.value = value; return query; },
      select: () => { call.operation ??= 'select'; return query; },
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  });
  vi.mocked(database).mockReturnValue({ from } as unknown as ReturnType<typeof database>);
  return calls;
}
function current(overrides: Record<string, unknown> = {}) {
  return { id, status: 'running', provider: 'apify', provider_run_id: 'runActual123', actor_id: 'streamers~youtube-scraper', observed_cost_usd: null, cost_status: 'unknown', finished_at: null, updated_at: '2026-10-21T01:00:00.000001Z', ...overrides };
}
beforeEach(() => { vi.mocked(database).mockReset(); });

describe('collection job creation before supplier work', () => {
  it('records a requested job and its reader while leaving unknown usage null', async () => {
    const calls = mockDatabase([{ data: { id } }, {}]);
    expect(await startJob(feed, 'user_one', env)).toBe(id);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: 'collection_jobs', operation: 'insert', value: { user_id: 'user_one', source_id: feed.id, provider: 'feed', actor_id: null, status: 'requested', observed_cost_usd: null, result_count: null, cost_status: 'unknown' } });
    expect(calls[1]).toMatchObject({ table: 'collection_job_consumers', operation: 'insert', value: { job_id: id, user_id: 'user_one' } });
  });
  it('supports an explicit future provider without pretending a run already exists', async () => {
    const calls = mockDatabase([{ data: { id } }, {}]);
    await startJob({ ...feed, platform: 'Instagram', provider: 'brightdata' }, 'user_one', env);
    expect(calls[0].value).toMatchObject({ provider: 'brightdata', actor_id: null, status: 'requested' });
    expect(calls[0].value).not.toHaveProperty('provider_run_id');
  });
  it('fails closed if the service is unconfigured without revealing credentials', async () => {
    vi.mocked(database).mockImplementation(() => { throw new Error('database key secret-not-for-readers'); });
    await expect(startJob(feed, 'user_one', env)).rejects.toMatchObject({ status: 503, code: 'job_ledger_unavailable' });
    await expect(startJob(feed, 'user_one', env)).rejects.not.toThrow('secret-not-for-readers');
  });
  it('fails closed and marks its owned request blocked if consumer persistence fails', async () => {
    const calls = mockDatabase([{ data: { id } }, { error: { message: 'secret-in-database-error' } }, {}]);
    await expect(startJob(feed, 'user_one', env)).rejects.toMatchObject({ status: 503, code: 'job_ledger_unavailable' });
    expect(calls[2]).toMatchObject({ table: 'collection_jobs', operation: 'update', value: { status: 'blocked', error_code: 'ledger_link_failed' }, filters: [['id', id], ['user_id', 'user_one'], ['status', 'requested']] });
  });
  it('rejects credential-bearing source URLs before the database is accessed', async () => {
    await expect(startJob({ ...feed, url: 'https://example.com/feed?api_key=secret' }, 'user_one', env)).rejects.toMatchObject({ status: 400 });
    expect(database).not.toHaveBeenCalled();
  });
  it('does not return an identifier when the job insert fails', async () => {
    const calls = mockDatabase([{ error: { message: 'private error text' } }]);
    await expect(startJob(feed, 'user_one', env)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });
});

describe('owned collection outcomes and truthful accounting', () => {
  it('filters both the read and conditional update by authenticated reader', async () => {
    const calls = mockDatabase([{ data: current() }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'succeeded', resultCount: 3 }, env);
    expect(calls[0].filters).toEqual([['id', id], ['user_id', 'user_one']]);
    expect(calls[1].filters).toEqual([['id', id], ['user_id', 'user_one'], ['status', 'running'], ['updated_at', '2026-10-21T01:00:00.000001Z']]);
    expect(calls[1].value).toMatchObject({ status: 'succeeded', result_count: 3 });
    expect(calls[1].value).not.toHaveProperty('observed_cost_usd');
    expect(calls[1].value).not.toHaveProperty('cost_status');
  });
  it('cannot update an activity absent from that reader scope', async () => {
    const calls = mockDatabase([{ data: null }]);
    await expect(finishJob(id, 'user_other', { status: 'succeeded' }, env)).rejects.toMatchObject({ status: 404, code: 'job_not_found' });
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toContainEqual(['user_id', 'user_other']);
  });
  it('records zero only for an explicitly fee-free publisher feed', async () => {
    const calls = mockDatabase([{ data: current({ provider: 'feed', provider_run_id: null, actor_id: null }) }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'succeeded', resultCount: 5, observedCostUsd: 0, costStatus: 'no_provider_charge' }, env);
    expect(calls[1].value).toMatchObject({ observed_cost_usd: 0, cost_status: 'no_provider_charge', result_count: 5 });
  });
  it('never labels an unobserved paid-provider outcome as free', async () => {
    const calls = mockDatabase([{ data: current() }]);
    await expect(finishJob(id, 'user_one', { status: 'succeeded', observedCostUsd: 0, costStatus: 'no_provider_charge' }, env)).rejects.toMatchObject({ code: 'invalid_job_record' });
    expect(calls).toHaveLength(1);
  });
  it('requires an explicit provider-reported label for observed paid cost', async () => {
    const calls = mockDatabase([{ data: current() }]);
    await expect(finishJob(id, 'user_one', { status: 'succeeded', observedCostUsd: 0.012 }, env)).rejects.toMatchObject({ code: 'invalid_job_record' });
    expect(calls).toHaveLength(1);
  });
  it('accepts a provider-confirmed charge with its actual run reference', async () => {
    const calls = mockDatabase([{ data: current() }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'succeeded', observedCostUsd: 0.012, costStatus: 'provider_reported', providerRunId: 'runActual123' }, env);
    expect(calls[1].value).toMatchObject({ observed_cost_usd: 0.012, cost_status: 'provider_reported', provider_run_id: 'runActual123' });
  });
  it('does not claim reported costs for an activity with no supplier run', async () => {
    mockDatabase([{ data: current({ provider_run_id: null }) }]);
    await expect(finishJob(id, 'user_one', { status: 'failed', observedCostUsd: 0, costStatus: 'provider_reported' }, env)).rejects.toMatchObject({ code: 'invalid_job_record' });
  });
  it('prevents a late running poll from regressing a completed activity', async () => {
    const calls = mockDatabase([{ data: current({ status: 'succeeded' }) }]);
    await expect(finishJob(id, 'user_one', { status: 'running' }, env)).rejects.toMatchObject({ status: 409, code: 'job_state_changed' });
    expect(calls).toHaveLength(1);
  });
  it('cannot reassign an activity to a different supplier run', async () => {
    const calls = mockDatabase([{ data: current() }]);
    await expect(finishJob(id, 'user_one', { status: 'running', providerRunId: 'otherRun123' }, env)).rejects.toMatchObject({ status: 409, code: 'job_identity_changed' });
    expect(calls).toHaveLength(1);
  });
  it('keeps a repeated terminal poll idempotent without rewriting its finish time', async () => {
    const calls = mockDatabase([{ data: current({ status: 'succeeded', finished_at: '2026-10-21T01:00:00Z' }) }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'succeeded', resultCount: 3 }, env);
    expect(calls[1].value).not.toHaveProperty('finished_at');
  });
  it('reports a status race instead of overwriting a newer terminal result', async () => {
    mockDatabase([{ data: current() }, { data: null }]);
    await expect(finishJob(id, 'user_one', { status: 'succeeded' }, env)).rejects.toMatchObject({ status: 409, code: 'job_state_changed' });
  });
  it('prevents a concurrent older running poll from replacing a newer reported charge', async () => {
    let stored: Record<string, unknown> = { ...current(), user_id: 'user_one' };
    let readCount = 0;
    let releaseReads: () => void = () => {};
    const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
    const from = () => {
      const filters: Array<[string, unknown]> = [];
      let changes: Record<string, unknown> | undefined;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        update: (value: Record<string, unknown>) => { changes = value; return query; },
        maybeSingle: async () => {
          if (!changes) {
            const snapshot = { ...stored };
            if (++readCount === 2) releaseReads();
            await bothRead;
            return { data: snapshot, error: null };
          }
          if (!filters.every(([key, value]) => stored[key] === value)) return { data: null, error: null };
          stored = { ...stored, ...changes, updated_at: '2026-10-21T01:00:00.000002Z' };
          return { data: { id }, error: null };
        },
      };
      return query;
    };
    vi.mocked(database).mockReturnValue({ from } as unknown as ReturnType<typeof database>);
    const results = await Promise.allSettled([
      finishJob(id, 'user_one', { status: 'running', observedCostUsd: 0.02, costStatus: 'provider_reported' }, env),
      finishJob(id, 'user_one', { status: 'running', observedCostUsd: 0.01, costStatus: 'provider_reported' }, env),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 409, code: 'job_state_changed' } });
    expect(stored).toMatchObject({ status: 'running', observed_cost_usd: 0.02, cost_status: 'provider_reported' });
  });
  it.each([-1, NaN, Infinity, 1_000_000])('rejects invalid cost %s before database access', async (cost) => {
    await expect(finishJob(id, 'user_one', { status: 'succeeded', observedCostUsd: cost, costStatus: 'provider_reported' }, env)).rejects.toMatchObject({ status: 400 });
    expect(database).not.toHaveBeenCalled();
  });
  it('accepts only a safe error code rather than storing raw exception secrets', async () => {
    await expect(finishJob(id, 'user_one', { status: 'failed', errorCode: 'Bearer private-token in failed URL' }, env)).rejects.toMatchObject({ status: 400 });
    expect(database).not.toHaveBeenCalled();
  });
  it('sanitizes database failures at the update boundary', async () => {
    mockDatabase([{ data: current() }, { error: { message: 'service secret is private' } }]);
    await expect(finishJob(id, 'user_one', { status: 'failed', errorCode: 'provider_error' }, env)).rejects.toMatchObject({ status: 503, code: 'job_ledger_unavailable' });
  });
});

describe('provider usage high-water accounting', () => {
  it('retains a larger known fee when a later poll reports a lower amount', async () => {
    const calls = mockDatabase([{ data: current({ status: 'succeeded', observed_cost_usd: 0.012, cost_status: 'provider_reported', finished_at: '2026-10-21T01:01:00Z' }) }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'succeeded', observedCostUsd: 0.004, costStatus: 'provider_reported' }, env);
    expect(calls[1].value).toMatchObject({ observed_cost_usd: 0.012, cost_status: 'provider_reported' });
  });
  it('retains a known fee when a later response omits its usage', async () => {
    const calls = mockDatabase([{ data: current({ observed_cost_usd: 0.012, cost_status: 'provider_reported' }) }, { data: { id } }]);
    await finishJob(id, 'user_one', { status: 'running', observedCostUsd: null }, env);
    expect(calls[1].value).toMatchObject({ observed_cost_usd: 0.012 });
  });
});
