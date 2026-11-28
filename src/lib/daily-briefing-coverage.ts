import type { DailyBriefing, DailyBriefingSourceCounts, DailyBriefingSourceCoverage, DailyBriefingUpdate } from './daily-briefing-types';

export function countBriefingSources(sources: DailyBriefingSourceCoverage[], updates: DailyBriefingUpdate[], omittedUpdates: number): DailyBriefingSourceCounts {
  const counts = { checked: 0, quiet: 0, partial: 0, failed: 0, blocked: 0, unknown: 0 };
  const updated = new Set(updates.map(update => update.sourceId));
  for (const source of sources) {
    counts[source.state]++;
    if (source.state === 'checked' && omittedUpdates === 0 && !updated.has(source.sourceId)) counts.quiet++;
  }
  return counts;
}

/** The stored status controls publication and reminders. A private reader can
 * still distinguish failed and incomplete days in their own history. */
export function briefingDayOutcome(briefing: DailyBriefing): DailyBriefing['status'] | 'failed' {
  const { status, snapshot } = briefing;
  if (status !== 'awaiting_review') return status;
  // Existing failure snapshots are immutable and used this fixed notice prefix.
  if (snapshot.failureCode || snapshot.notice.startsWith('This daily briefing could not be completed safely (')) return 'failed';
  const { coverage } = snapshot;
  const counts = coverage.sourceCounts ?? countBriefingSources(coverage.sources, snapshot.allUpdates, coverage.omittedUpdates);
  if (coverage.followedSources > 0 && counts.failed === coverage.followedSources && coverage.availableUpdates === 0) return 'failed';
  if (coverage.followedSources === 0 || counts.checked < coverage.followedSources || coverage.missingContentUpdates || coverage.omittedUpdates || !coverage.pendingReviewUpdates) return 'partial';
  return status;
}
