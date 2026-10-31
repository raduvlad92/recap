import { describe, expect, it, vi } from 'vitest';
import type { ReaderSettings } from '../src/lib/types';
import { briefingCycle, composeDailyBriefing, createDailyBriefingWorker, createDailyBriefingsHandler, dailyBriefingWorkerAuthorized, dailyFindingKey, dispatchDailyBriefings, localBriefingCutoff, type DailyBriefingCandidate, type DailyBriefingInput } from '../netlify/functions/_shared/daily-briefing';

const settings: ReaderSettings = { interests: ['Devices'], interfaceLanguage: 'en', recapLanguage: 'de', timezone: 'Europe/Berlin', deliveryTime: '08:00', emailReminder: false };
const env = (key: string) => ({ APP_URL: 'https://recap.example', CONTENT_ANALYSIS_WORKER_SECRET: 's'.repeat(40) } as Record<string, string>)[key];
const reviewId = '11111111-1111-4111-8111-111111111111';
const contentHash = 'a'.repeat(64);
function input(): DailyBriefingInput {
  const text = 'The updated device uses less power in the reported test.';
  return { settings, localDate: '2026-10-31', periodStart: '2026-10-30T07:00:00.000Z', cutoffAt: '2026-10-31T07:00:00.000Z', sources: [{ sourceId: 'one', sourceName: 'Creator', platform: 'YouTube', state: 'checked', checkedAt: '2026-10-31T06:50:00Z', reason: null }], omittedUpdates: 0, missedCycles: 0,
    updates: [{ updateId: 'item-one', sourceId: 'one', sourceName: 'Creator', title: 'Actual update', url: 'https://www.youtube.com/watch?v=abcdEFGH123', publishedAt: '2026-10-31T05:00:00Z', state: 'available', lateArrival: false, topics: ['Devices'], findings: [{ text,
      citation: { updateId: 'item-one', sourceId: 'one', sourceName: 'Creator', title: 'Actual update', url: 'https://www.youtube.com/watch?v=abcdEFGH123', publishedAt: '2026-10-31T05:00:00Z', contentHash, evidenceQuote: 'The updated device uses less power in the reported test.', reviewId, findingKey: dailyFindingKey('item-one', contentHash, text), lateArrival: false } }] }] };
}

describe('chosen local daily cutoff', () => {
  it('resolves Berlin winter and summer without a fixed UTC offset', () => {
    expect(localBriefingCutoff('2026-01-12', '08:15', 'Europe/Berlin')).toBe('2026-01-12T07:15:00.000Z');
    expect(localBriefingCutoff('2026-07-12', '08:15', 'Europe/Berlin')).toBe('2026-07-12T06:15:00.000Z');
  });
  it('moves a nonexistent Berlin time to the next valid minute', () => {
    expect(localBriefingCutoff('2026-03-29', '02:30', 'Europe/Berlin')).toBe('2026-03-29T01:00:00.000Z');
  });
  it('chooses the first repeated time, leaving logical-day uniqueness to storage', () => {
    expect(localBriefingCutoff('2026-10-25', '02:30', 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z');
    expect(briefingCycle(Date.parse('2026-10-25T01:40:00Z'), 'Europe/Berlin', '02:30').localDate).toBe('2026-10-25');
  });
  it('handles New York gaps/repetitions', () => {
    expect(localBriefingCutoff('2026-03-08', '02:30', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z');
    expect(localBriefingCutoff('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });
  it('supports non-hour-offset and date-line zones', () => {
    expect(localBriefingCutoff('2026-10-31', '08:00', 'Asia/Kathmandu')).toBe('2026-10-31T02:15:00.000Z');
    expect(localBriefingCutoff('2026-10-31', '08:00', 'Pacific/Kiritimati')).toBe('2026-10-30T18:00:00.000Z');
  });
  it('uses consecutive cutoffs on short/long days, not a fixed 24-hour subtraction', () => {
    const spring = briefingCycle(Date.parse('2026-03-29T15:00:00Z'), 'Europe/Berlin', '08:00');
    const fall = briefingCycle(Date.parse('2026-10-25T15:00:00Z'), 'Europe/Berlin', '08:00');
    expect(Date.parse(spring.cutoffAt) - Date.parse(spring.periodStart)).toBe(23 * 3600000);
    expect(Date.parse(fall.cutoffAt) - Date.parse(fall.periodStart)).toBe(25 * 3600000);
  });
  it('selects yesterday before the chosen local time and rejects invalid settings', () => {
    expect(briefingCycle(Date.parse('2026-10-31T05:00:00Z'), 'Europe/Berlin', '08:00')).toMatchObject({ localDate: '2026-10-30', nextDueAt: '2026-10-31T07:00:00.000Z' });
    expect(() => localBriefingCutoff('2026-10-31', '25:00', 'UTC')).toThrow();
    expect(() => localBriefingCutoff('2026-10-31', '08:00', 'Mars/Unknown')).toThrow();
  });
});

describe('deterministic approved daily assembly', () => {
  it('preserves exact approved words/quotes and honestly labels requested versus original language', () => {
    const source = input(), before = structuredClone(source), result = composeDailyBriefing(source);
    expect(source).toEqual(before);
    expect(result.status).toBe('ready');
    expect(result.snapshot).toMatchObject({ recapLanguage: 'de', languageMode: 'original_approved_wording', mode: 'approved_findings' });
    expect(result.snapshot.topics[0].points[0]).toEqual({ text: source.updates[0].findings[0].text, citations: [source.updates[0].findings[0].citation] });
    expect(result.snapshot.allUpdates[0].state).toBe('included');
    expect(JSON.stringify(result.snapshot)).not.toContain('readerId');
  });
  it('does not call an unknown/empty check a quiet day', () => {
    const source = input(); source.updates = []; source.sources[0].state = 'unknown';
    expect(composeDailyBriefing(source).status).toBe('awaiting_review');
    source.sources[0].state = 'checked'; expect(composeDailyBriefing(source).status).toBe('quiet');
  });
  it('keeps source, review and content gaps distinct', () => {
    const source = input(); source.sources[0].state = 'partial';
    source.updates.push({ ...source.updates[0], updateId: 'pending', state: 'awaiting_review', findings: [] }, { ...source.updates[0], updateId: 'missing', state: 'content_missing', findings: [] });
    const result = composeDailyBriefing(source);
    expect(result.status).toBe('partial');
    expect(result.snapshot.coverage).toMatchObject({ pendingReviewUpdates: 1, missingContentUpdates: 1, includedUpdates: 1, checkedSources: 0 });
  });
  it('groups identical cross-post wording into one point while retaining each original', () => {
    const source = input(), other = structuredClone(source.updates[0]);
    other.updateId = 'other'; other.sourceId = 'other-source'; other.findings[0].citation.updateId = 'other'; other.findings[0].citation.sourceId = 'other-source'; other.findings[0].citation.findingKey = dailyFindingKey('other', contentHash, other.findings[0].text);
    source.updates.push(other);
    const result = composeDailyBriefing(source);
    expect(result.snapshot.topics[0].points).toHaveLength(1);
    expect(result.snapshot.topics[0].points[0].citations).toHaveLength(2);
    expect(result.snapshot.topics[0].updatedSourceCount).toBe(2);
  });
  it('keeps five topics and bounded main points, leaving other updates inspectable', () => {
    const source = input();
    for (let i = 0; i < 7; i++) {
      const other = structuredClone(source.updates[0]); other.updateId = 'item-' + i; other.topics = ['Topic ' + i]; other.findings[0].text = 'A separate approved finding ' + i + '.';
      other.findings[0].citation.findingKey = dailyFindingKey(other.updateId, contentHash, other.findings[0].text); source.updates.push(other);
    }
    const result = composeDailyBriefing(source);
    expect(result.snapshot.topics).toHaveLength(5); expect(result.snapshot.topics[0].title).toBe('Devices'); expect(result.snapshot.allUpdates).toHaveLength(8);
    expect(result.findingKeys).toHaveLength(8);
  });
  it('preserves late arrivals and missed-cycle notices', () => {
    const source = input(); source.updates[0].lateArrival = true; source.updates[0].findings[0].citation.lateArrival = true; source.missedCycles = 2;
    const result = composeDailyBriefing(source); expect(result.status).toBe('partial'); expect(result.snapshot.allUpdates[0].lateArrival).toBe(true); expect(result.snapshot.notice).toContain('Earlier scheduled cycles');
  });
  it('rejects invalid citations rather than making a readable fabricated briefing', () => {
    const source = input(); source.updates[0].findings[0].citation.url = 'http://localhost/internal';
    expect(() => composeDailyBriefing(source)).toThrow('daily briefing');
  });
});

describe('daily worker and private route', () => {
  const candidate = (): DailyBriefingCandidate => ({ readerId: 'private-reader', generation: reviewId, workspaceRevision: '2026-10-30T00:00:00Z', startsAt: '2026-10-30T00:00:00Z', settingsChangedAt: '2026-10-30T00:00:00Z', lastCutoffAt: null, lastLocalDate: null, settings });
  it('does not generate before first activation or twice for a consumed local day', async () => {
    const a = candidate(), b = { ...candidate(), readerId: 'second', lastLocalDate: '2026-10-31', lastCutoffAt: '2026-10-31T07:00:00Z' };
    a.startsAt = '2026-10-31T08:01:00Z';
    const store = { candidates: vi.fn().mockResolvedValue([a, b]), claim: vi.fn(), finish: vi.fn() };
    expect(await createDailyBriefingWorker({ env, now: () => Date.parse('2026-10-31T09:00:00Z'), store })()).toMatchObject({ examined: 2, skipped: 2, published: 0 });
    expect(store.claim).not.toHaveBeenCalled();
  });
  it('persists composition after a claim, with no provider/model call', async () => {
    const store = { candidates: vi.fn().mockResolvedValue([candidate()]), claim: vi.fn().mockResolvedValue({ id: reviewId, leaseToken: reviewId, input: input() }), finish: vi.fn() };
    expect(await createDailyBriefingWorker({ env, now: () => Date.parse('2026-10-31T09:00:00Z'), store })()).toMatchObject({ published: 1, failed: 0 });
    expect(store.finish).toHaveBeenCalledOnce(); expect(store.finish.mock.calls[0][1].status).toBe('ready');
  });
  it('honors the independent runtime stop', async () => {
    const store = { candidates: vi.fn(), claim: vi.fn(), finish: vi.fn() };
    expect(await createDailyBriefingWorker({ env: key => key === 'DAILY_BRIEFING_ENABLED' ? 'false' : env(key), store })()).toMatchObject({ enabled: false });
    expect(store.candidates).not.toHaveBeenCalled();
  });
  it('authenticates the worker origin and dispatches only to the fixed app endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    expect(await dispatchDailyBriefings(env, fetcher)).toEqual({ dispatched: true });
    expect(String(fetcher.mock.calls[0][0])).toBe('https://recap.example/.netlify/functions/daily-briefing-worker');
    expect(dailyBriefingWorkerAuthorized(new Request('https://evil.example/worker', { headers: { 'x-content-analysis-secret': 's'.repeat(40) } }), env)).toBe(false);
  });
  it('authenticates reads before accessing private storage', async () => {
    const db = vi.fn();
    const response = await createDailyBriefingsHandler({ env, db })(new Request('https://recap.example/api/daily-briefings'));
    expect(response.status).toBe(401); expect(db).not.toHaveBeenCalled();
  });
  it('rejects malformed mutations without making a database call', async () => {
    const rpc = vi.fn(), db = () => ({ rpc }) as any;
    const handler = createDailyBriefingsHandler({ env, db, verify: async () => 'reader' });
    expect((await handler(new Request('https://recap.example/api/daily-briefings', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'foreign', readerId: 'other' }) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('derives deletion ownership from the authenticated reader', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null }), db = () => ({ rpc }) as any;
    const handler = createDailyBriefingsHandler({ env, db, verify: async () => 'actual-reader' });
    const response = await handler(new Request('https://recap.example/api/daily-briefings', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: reviewId, expectedCreatedAt: '2026-10-31T08:00:00Z' }) }));
    expect(response.status).toBe(200); expect(rpc).toHaveBeenCalledWith('delete_daily_briefing', expect.objectContaining({ p_reader_id: 'actual-reader' }));
  });
});
