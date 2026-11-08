import { describe, expect, it, vi } from 'vitest';
import { nativeSocialRows } from '../netlify/functions/_shared/native-social';
import { createSocialCollector, normalizeSocialDataset, type SocialJob, type SocialStore } from '../netlify/functions/_shared/social-collection';
import { blockedInstagramReport, olderInstagramRows } from './fixtures/retained-social-outcomes';
import { testRetrievalLog } from './helpers/retrieval-log';

const instagram: SocialJob = {
  id: 'fixture-job', collection_job_id: 'fixture-ledger', source_key: 'instagram.com/fixture_source',
  platform: 'Instagram', source_url: 'https://www.instagram.com/fixture_source/', source_name: 'Fixture',
  window_from: '2026-10-30T12:00:00Z', window_to: '2026-10-31T12:00:00Z',
  state: 'running', lease_token: 'fixture-lease', reservation_id: 'fixture-reservation',
  provider_run_id: 'FixtureRun123', dataset_id: 'FixtureDataset123',
  config: {
    platform: 'Instagram', enabled: true, actor_ref: 'yugenox/instagram-post-scraper',
    actor_id: 'FixtureActor123', build_id: 'FixtureBuild123', build_number: '0.1.4', apify_user_id: 'FixtureOwner123',
    pricing_fingerprint: 'a'.repeat(64), max_items: 3, maximum_usd: .01, memory_mb: 256,
    timeout_seconds: 120, reviewed_at: '2026-10-01T00:00:00Z',
  },
};

function retainedCollector(job: SocialJob, rows: unknown[]) {
  let claimed = false;
  const store: SocialStore = {
    sync: vi.fn(async () => 0), claim: vi.fn(async () => claimed ? null : (claimed = true, job)),
    launch: vi.fn(async () => { throw Error('No launch allowed'); }),
    run: vi.fn(async () => { throw Error('No new run allowed'); }), finish: vi.fn(async () => {}),
  };
  const log = testRetrievalLog(), native = vi.fn();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method || 'GET').toBe('GET');
    expect(init?.redirect).toBe('error');
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.apify.com');
    if (url.pathname === '/v2/actor-runs/FixtureRun123') return Response.json({ data: {
      id: job.provider_run_id, actId: job.config.actor_id, buildId: job.config.build_id, userId: job.config.apify_user_id,
      status: 'SUCCEEDED', defaultDatasetId: job.dataset_id, defaultKeyValueStoreId: 'FixtureStore123', usageTotalUsd: .001,
    } });
    if (url.pathname === '/v2/datasets/FixtureDataset123/items') return Response.json(rows);
    if (url.pathname === '/v2/key-value-stores/FixtureStore123/records/RUN_REPORT') return Response.json(blockedInstagramReport);
    if (['/v2/key-value-stores/FixtureStore123/records/diagnostics', '/v2/key-value-stores/FixtureStore123/records/run-report'].includes(url.pathname)) return Response.json({}, { status: 404 });
    throw Error('Unexpected fixture request');
  });
  return { store, log, native, fetcher, run: () => createSocialCollector({ store, log, native, fetcher, env: name => name === 'APIFY_API_TOKEN' ? 'fixture-token' : 'false' })() };
}

describe('retained social outcome diagnosis with constructed fixtures', () => {
  it('rejects a capped older Instagram sample without claiming quiet or freezing a current window', () => {
    expect(normalizeSocialDataset(instagram, olderInstagramRows)).toMatchObject({
      items: [], coverage: { accepted: 0, returned: 3, rejected: { outside_window: 3 }, status: 'unknown', complete: false, reason: 'provider_returned_older_window' },
    });
  });

  it('accepts the same field shape inside the exact window while retaining owner, code and boundary checks', () => {
    const valid = { ...olderInstagramRows[0], createdAt: '2026-10-30T13:00:00Z' };
    const result = normalizeSocialDataset(instagram, [valid,
      { ...valid, owner: { username: 'foreign' } },
      { ...valid, code: 'MismatchedCode' },
      { ...valid, createdAt: instagram.window_to },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].record).toMatchObject({ contentKind: 'feed_text', content: valid.caption, publishedAt: '2026-10-30T13:00:00.000Z' });
    expect(result.coverage.rejected).toEqual({ unattributed: 1, identity_mismatch: 1, outside_window: 1 });
    expect(result.coverage.complete).toBe(false);
  });

  it('combines successful provider status, old rows and blocked diagnostics into failure without another launch', async () => {
    const fixture = retainedCollector(instagram, olderInstagramRows);
    await fixture.run();
    expect(fixture.store.finish).toHaveBeenCalledExactlyOnceWith(instagram, [], expect.objectContaining({
      status: 'blocked', reason: 'provider_blocked', complete: false, accepted: 0, rejected: { outside_window: 3 },
      diagnostics: { report_present: true, blocked_requests: 3, requests: 9, empty_targets: 0 },
    }), .001, true, 'provider_blocked');
    expect(fixture.native).not.toHaveBeenCalled();
    expect(fixture.store.launch).not.toHaveBeenCalled();
    expect(fixture.store.run).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(fixture.log.finish).mock.calls)).not.toContain('private-');
    expect(fixture.fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps an empty successful X run with absent optional reports unknown rather than proven quiet', async () => {
    const x: SocialJob = { ...instagram, platform: 'X', source_key: 'x.com/fixture_source', source_url: 'https://x.com/fixture_source',
      config: { ...instagram.config, platform: 'X', actor_ref: 'xquik/x-tweet-scraper', max_items: 20 } };
    const fixture = retainedCollector(x, []);
    await fixture.run();
    expect(fixture.store.finish).toHaveBeenCalledExactlyOnceWith(x, [], expect.objectContaining({
      status: 'unknown', complete: false, accepted: 0, returned: 0, rejected: {},
      reason: 'empty_or_unusable_response', diagnostics: { report_present: false },
    }), .001, true);
    expect(fixture.store.launch).not.toHaveBeenCalled();
    expect(fixture.native).not.toHaveBeenCalled();
    expect(fixture.fetcher).toHaveBeenCalledTimes(4);
  });

  it('retains method-specific 404 and transport failures without logging a thrown upstream message', async () => {
    const log = testRetrievalLog(), fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 1) return new Response(null, { status: 404 });
      throw new TypeError('private-network-url-sentinel');
    });
    await expect(nativeSocialRows(instagram, log, fetcher)).rejects.toMatchObject({ code: 'source_transport_failed' });
    expect(vi.mocked(log.start).mock.calls.map(call => call[1])).toEqual(['instagram_public_profile', 'instagram_public_page']);
    expect(vi.mocked(log.finish).mock.calls.map(call => call[1])).toEqual([
      { status: 'failed', error_code: 'source_unavailable', http_status: 404 },
      { status: 'failed', error_code: 'source_transport_failed' },
    ]);
    expect(JSON.stringify(vi.mocked(log.finish).mock.calls)).not.toContain('private-');
  });

  it('retains X rate limiting separately from an empty timeline', async () => {
    const log = testRetrievalLog();
    await expect(nativeSocialRows({ ...instagram, platform: 'X', source_key: 'x.com/fixture_source' }, log,
      async () => new Response(null, { status: 429 }))).rejects.toMatchObject({ code: 'source_unavailable', upstreamStatus: 429 });
    expect(log.finish).toHaveBeenCalledWith('attempt-1', { status: 'failed', error_code: 'source_unavailable', http_status: 429 });
  });
});
