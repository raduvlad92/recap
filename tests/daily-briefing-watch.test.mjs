import { describe, expect, it } from 'vitest';
import { dailyWatchReport, watchPlan, watchQuery } from '../scripts/watch-daily-briefing.mjs';

const release = 'a'.repeat(40);
const args = ['2026-11-25T13:01:35Z', release, '10', '2026-11-25T07:00:00Z',
  '2026-11-26T07:00:00Z', '2026-11-27T07:00:00Z', '2026-11-28T07:00:00Z'];
const plan = watchPlan(args, 'fixture_reader');

function evidence(observed_at) {
  return {
    observed_at, read_only: true, control: { owner: 'cloudflare', release, epoch: 10, paused: false, old_host_fenced: true },
    budget: { paused: false }, daily_enabled: true,
    cutoffs: plan.windows.map(({ periodStart, cutoffAt }) => ({
      period_start: periodStart, cutoff_at: cutoffAt, schedule_enabled: true, schedule_changed_at: '2026-11-24T00:00:00Z',
      scheduled_frames: { 'hourly-collection:completed': 1 }, completed_cutoff_frames: 1, job_state: 'finished',
      ingestion: { items: 0, usable: 0 }, analysis_current_states: {}, review_current_states: {},
      briefing: { period_start: periodStart, status: 'quiet', coverage: { availableUpdates: 0, followedSources: 3, checkedSources: 3 },
        topics: 0, created_at: cutoffAt, published_at: cutoffAt },
    })),
  };
}

describe('read-only daily cutoff watch', () => {
  it('bounds the time window and constructs a read-only statement without side effects', () => {
    expect(() => watchPlan(args.slice(0, -1), 'fixture_reader')).toThrow();
    expect(() => watchPlan(args, 'invalid-id\'' )).toThrow();
    expect(watchQuery(plan)).toMatch(/^begin read only;[\s\S]+rollback;$/);
  });
  it('waits for the cutoff grace and for the full 72 hours even when all cutoffs are quiet', () => {
    const early = evidence('2026-11-26T07:05:00Z');
    early.cutoffs[0].briefing = null;
    expect(dailyWatchReport(plan, early)).toMatchObject({ complete: false, alerts: [], cutoffs: [{ due: false, alerts: [] }, { due: false }, { due: false }] });
    const settled = evidence('2026-11-28T13:01:35Z');
    expect(dailyWatchReport(plan, settled)).toMatchObject({ complete: true, alerts: [], read_only: true });
  });
  it('distinguishes transport, review, failed generation and missing analysis', () => {
    const receipts = evidence('2026-11-28T13:10:00Z');
    receipts.cutoffs[0].completed_cutoff_frames = 0;
    receipts.cutoffs[0].briefing.status = 'awaiting_review';
    receipts.cutoffs[1].job_state = 'failed';
    receipts.cutoffs[2].ingestion.usable = 1;
    const report = dailyWatchReport(plan, receipts);
    expect(report.complete).toBe(false);
    expect(report.cutoffs.map(day => day.alerts)).toEqual([
      ['no_completed_scheduled_daily_frame', 'no_approved_daily_output'],
      ['daily_generation_failed'],
      ['usable_archive_without_observed_analysis_activity'],
    ]);
  });
});
