import { describe, expect, it, vi } from 'vitest';
import { expectedCutoffs, readPublicHealth, readinessQuery, scoreReadiness } from '../scripts/flow9-readiness.mjs';

const since = '2026-11-23T09:00:00Z', until = '2026-11-26T09:00:00Z';
const hour = 3_600_000;
const release = 'a'.repeat(40), epoch = 10;
const reader = { reader: 1, timezone: 'Europe/Berlin', delivery_time: '08:00', schedule_enabled: true, settings_since: '2026-11-10T00:00:00Z' };
const health = { status: 200, homeStatus: 200, mode: 'active', release, jobsConfigured: true, automaticScheduling: true };

function fixture() {
  const frames = Array.from({ length: 72 }, (_, i) => {
    const slot = Date.parse(since) + i * hour;
    return { kind: 'hourly-collection', slot: new Date(slot).toISOString(), finished: new Date(slot + 60_000).toISOString(),
      state: 'completed', release, epoch };
  });
  const briefings = expectedCutoffs(reader, Date.parse(since), Date.parse(until)).map((cutoff, i) => {
    const quiet = i === 1, at = new Date(Date.parse(cutoff.cutoffAt) + 120_000).toISOString();
    return { reader: 1, local_date: cutoff.localDate, period_start: cutoff.periodStart, cutoff_at: cutoff.cutoffAt,
      created_at: at, published_at: at, job_state: 'finished', status: quiet ? 'quiet' : i === 0 ? 'ready' : 'partial', genuine: true,
      coverage: { followedSources: 3, checkedSources: i === 2 ? 2 : 3, availableUpdates: quiet ? 0 : 3,
        pendingReviewUpdates: 0, missingContentUpdates: 0, omittedUpdates: 0 },
      topics: quiet ? 0 : 2, points: quiet ? 0 : 2, citations: quiet ? 0 : 3, bad_points: 0, all_topics_have_points: true };
  });
  return {
    since, until, readOnly: true, dailyEnabled: true, readers: [reader], briefings,
    frames: [...frames, { ...frames[2], kind: 'automatic-content' }],
    control: { owner: 'cloudflare', paused: false, old_host_fenced: true, epoch, release, updated_at: '2026-11-23T08:00:00Z' },
    ingestion: { checks: 144, failedChecks: 0, failedSocialJobs: 0, transcriptsDuringScheduledChecks: 10 },
    analysis: { drafts: 20, validDrafts: 18, eligibleVideos: 10, videosWithBothDrafts: 9 },
    intervention: { nonCronWork: 0, offScheduleSourceChecks: 0, unattributedArchiveItems: 0, adminWrites: {} },
    budget: [{ month_start: '2026-11-01', limit_usd: '20', committed_usd: '9.669' }],
  };
}

describe('read-only flow readiness', () => {
  it('pins the observation transaction and validates caller timestamps', () => {
    const query = readinessQuery(since);
    expect(query).toMatch(/^begin read only;[\s\S]+rollback;\s*$/);
    expect(query).toContain("'2026-11-23T09:00:00.000Z'::timestamptz");
    expect(readinessQuery()).toContain("now() - interval '72 hours'");
    expect(() => readinessQuery('2026-02-30T09:00:00Z')).toThrow();
    expect(() => readinessQuery('last Tuesday')).toThrow();
    expect(() => scoreReadiness({ ...fixture(), readOnly: false }, health)).toThrow('Read-only');
  });
  it('passes an intact window with a cited partial day and a genuinely quiet day', () => {
    const r = scoreReadiness(fixture(), health);
    expect(r.flow6).toMatchObject({ status: 'PASS', criteria: { threeGenuineCutoffs: { evidence: { due: 3, genuine: 3 } } } });
    expect(r.flow9.status).toBe('PASS');
    expect(r.readers[0].cutoffs.map(c => [c.label, c.accepted])).toEqual([['ready', true], ['quiet', true], ['partial', true]]);
    expect(r.analysis).toMatchObject({ validDraftPercent: 90, pairedVideoPercent: 90 });
  });
  it('does not turn an empty calendar or missing analysis into a pass', () => {
    const r = scoreReadiness({ ...fixture(), frames: [], briefings: [], dailyEnabled: false,
      analysis: { drafts: 0, validDrafts: 0, eligibleVideos: 0, videosWithBothDrafts: 0 } }, health);
    expect(r.flow6.status).toBe('FAIL');
    expect(r.flow9).toMatchObject({ status: 'FAIL', criteria: { analysisQuality: { status: 'FAIL' }, ingestionCadence: { status: 'FAIL' } } });
    expect(r.analysis).toMatchObject({ validDraftPercent: null, pairedVideoPercent: null });
    expect(r.readers[0].cutoffs.every(c => c.label === 'missing')).toBe(true);
  });
  it.each([
    ['early creation', b => { b.created_at = '2026-11-24T06:55:00Z'; }],
    ['late creation', b => { b.created_at = '2026-11-24T07:16:00Z'; }],
    ['wrong previous cutoff', b => { b.period_start = '2026-11-23T06:00:00Z'; }],
    ['unbound citation', b => { b.bad_points = 1; }],
    ['unpublished', b => { b.published_at = null; }],
    ['empty topic', b => { b.all_topics_have_points = false; }],
    ['quiet with incomplete coverage', b => { b.status = 'quiet'; b.coverage.checkedSources = 0; }],
    ['failed', b => { b.job_state = 'failed'; }],
    ['held partial', b => { b.status = 'awaiting_review'; b.coverage.checkedSources = 1; }],
  ])('fails Flow 6 for %s', (_label, mutate) => {
    const data = fixture();
    mutate(data.briefings[0]);
    expect(scoreReadiness(data, health).flow6.status).toBe('FAIL');
  });
  it('holds a just-due missing cutoff during its grace period without claiming three cutoffs', () => {
    const data = fixture();
    data.until = '2026-11-26T07:05:00Z';
    data.briefings.pop();
    const r = scoreReadiness(data, health);
    expect(r.readers[0].cutoffs.at(-1)).toMatchObject({ label: 'pending', due: false });
    expect(r.flow6.criteria.threeGenuineCutoffs.status).toBe('FAIL');
    expect(r.flow9.criteria.elapsed.status).toBe('FAIL');
  });
  it('blocks the unattended verdict for epoch changes, over-cap commitment and observed intervention', () => {
    const data = fixture();
    data.frames[0].epoch = 9;
    data.budget.unshift({ month_start: '2026-10-01', limit_usd: '20', committed_usd: '20.01' });
    data.intervention.adminWrites['analysis.review.approved'] = 1;
    const r = scoreReadiness(data, health);
    expect(r.flow6.status).toBe('PASS');
    expect(r.flow9.criteria).toMatchObject({
      activeUnchangedRelease: { status: 'FAIL' }, cap: { status: 'FAIL' }, noObservedIntervention: { status: 'FAIL' },
    });
  });
  it('fails the quality gate when few videos receive both drafts despite valid individual proposals', () => {
    const data = fixture();
    data.analysis.videosWithBothDrafts = 8;
    expect(scoreReadiness(data, health).flow9.criteria.analysisQuality).toMatchObject({ status: 'FAIL', evidence: { pairedVideoPercent: 80 } });
  });

  it.each([
    ['2026-03-29', '2026-03-29T01:00:00.000Z'],
    ['2026-10-25', '2026-10-25T00:30:00.000Z'],
  ])('uses the daily worker DST rule on %s', (date, expected) => {
    const cutoffs = expectedCutoffs({ ...reader, delivery_time: '02:30', settings_since: null },
      Date.parse(date + 'T00:00:00Z'), Date.parse(date + 'T12:00:00Z'));
    expect(cutoffs[0].cutoffAt).toBe(expected);
  });
  it('uses only public GET probes, rejects redirects and retries a transient endpoint failure once', async () => {
    const fetcher = vi.fn(async url => url.endsWith('/api/health') ? new Response(null, { status: 503 }) : new Response('home'));
    const r = await readPublicHealth(fetcher);
    expect(r).toMatchObject({ status: 503, homeStatus: 200, release: null });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/api/health'))).toHaveLength(2);
    expect(fetcher.mock.calls.every(([, opts]) => opts.method === 'GET' && opts.redirect === 'error')).toBe(true);
  });
});
