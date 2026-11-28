import { describe, expect, it } from 'vitest';
import { briefingCycle, composeDailyBriefing, dailyFindingKey, type DailyBriefingInput } from '../netlify/functions/_shared/daily-briefing';
import type { DailyBriefingSourceCoverage } from '../src/lib/daily-briefing-types';
import fixture from './fixtures/daily-briefing/archive-2026-11-25.json';

const mockApprovalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function replay(withMockApprovals: boolean) {
  const settings = { interests: ['3D printing', 'Storage'], timezone: 'Europe/Berlin', deliveryTime: '08:00', interfaceLanguage: 'en', recapLanguage: 'en', emailReminder: false };
  const cycle = briefingCycle(Date.parse(fixture.cutoffAt), settings.timezone, settings.deliveryTime);
  expect(cycle).toMatchObject({ localDate: fixture.localDate, periodStart: fixture.periodStart, cutoffAt: fixture.cutoffAt });
  const input: DailyBriefingInput = {
    settings, localDate: cycle.localDate, periodStart: cycle.periodStart, cutoffAt: cycle.cutoffAt,
    sources: fixture.sourceChecks as DailyBriefingSourceCoverage[], omittedUpdates: 0, missedCycles: 11,
    updates: fixture.archive.map(item => {
      const { id: updateId, sourceId, sourceName, title, url, publishedAt, contentHash } = item;
      const citation = { updateId, sourceId, sourceName, title, url, publishedAt, lateArrival: Date.parse(publishedAt) < Date.parse(cycle.periodStart) };
      const response = withMockApprovals && fixture.mockResponses.find(mock => mock.id === updateId);
      if (!response || !item.evidence) return { ...citation, state: 'awaiting_review', topics: [], findings: [] };
      return { ...citation, state: 'available', topics: [response.topic], findings: [{ text: response.text, citation: {
        ...citation, contentHash, evidenceQuote: item.evidence.quote, reviewId: mockApprovalId,
        findingKey: dailyFindingKey(updateId, contentHash, response.text),
      } }] };
    }),
  };
  return composeDailyBriefing(input);
}

describe('November 25 retained-archive replay', () => {
  it('holds all eight originals under their actual review state', () => {
    expect(fixture.archive).toHaveLength(8);
    expect(fixture.archive.every(item => item.realReviewStates.length === 0 && item.format === 'regular' && Date.parse(item.collectedAt) <= Date.parse(fixture.cutoffAt))).toBe(true);
    const held = replay(false);
    expect(held.status).toBe('awaiting_review');
    expect(held.snapshot.topics).toEqual([]);
    expect(held.snapshot.coverage.pendingReviewUpdates).toBe(8);
  });
  it('assembles the separately mocked approvals with citations and measured source coverage', () => {
    const { status, snapshot } = replay(true);
    expect(status).toBe('partial');
    expect(snapshot.topics.map(topic => topic.title)).toEqual(['Storage', '3D printing', 'PC gaming', 'Rugged phones', 'Networks']);
    expect(snapshot.coverage).toMatchObject({ followedSources: 3, includedUpdates: 5, pendingReviewUpdates: 3, availableUpdates: 8,
      sourceCounts: { checked: 0, quiet: 0, partial: 1, failed: 0, blocked: 2, unknown: 0 } });
    for (const topic of snapshot.topics) {
      const point = topic.points[0], citation = point.citations[0];
      const original = fixture.archive.find(item => item.id === citation.updateId)!;
      expect(citation).toMatchObject({ url: original.url, publishedAt: original.publishedAt, contentHash: original.contentHash, evidenceQuote: original.evidence?.quote, lateArrival: true });
    }
    if (process.env.DAILY_BRIEFING_REPLAY_PRINT === '1') {
      console.log(`Status: ${status}\nCoverage: ${JSON.stringify(snapshot.coverage.sourceCounts)}\n` + snapshot.topics.map(topic => {
        const point = topic.points[0], cite = point.citations[0];
        const start = fixture.archive.find(item => item.id === cite.updateId)!.evidence!.startSeconds;
        return `- **${topic.title}** — ${point.text} [${cite.sourceName}, ${new Date(cite.publishedAt).toISOString().slice(0, 16)} UTC](${cite.url}&t=${Math.floor(start)}s)`;
      }).join('\n'));
    }
  });
});
