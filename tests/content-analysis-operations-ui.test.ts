import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalysisOperationsStatus, AnalysisSettings } from '../src/admin/AnalysisSettings';
import { DEFAULT_ANALYSIS_MODEL, type AnalysisOperations, type AnalysisSettings as Settings } from '../src/lib/analysis-settings-types';

const operations = (extra: Partial<AnalysisOperations> = {}): AnalysisOperations => ({
  checkedAt: '2026-10-25T12:00:00Z', jobs: { queued: 10, running: 1, prepared: 2, published: 3, evaluated: 9, failed: 4, blocked: 5, cancelled: 6, skipped: 7 }, pendingKeywordReviews: 8, staleLeases: 1,
  spending: { day: '2026-10-25', observedUsd: null, observedCalls: 0, settledUsd: 0, settledCalls: 1, unknownCommittedUsd: 0.009178191, unknownCalls: 3, committedUsd: 0.009178191, dailyCommittedUsd: 0.009178191 },
  ledger: { rowsRead: 12, rowLimit: 5000, totalRows: 12, complete: true }, recentErrors: [{ code: 'analysis_lease_expired', at: '2026-10-25T11:00:00Z' }], alerts: ['stale_leases', 'unknown_charges', 'pending_reviews'], ...extra,
});
const render = (value?: AnalysisOperations) => renderToStaticMarkup(createElement(AnalysisOperationsStatus, { operations: value }));

describe('private analysis operations presentation', () => {
  it('shows truthful work states, distinct review units and full unknown-hold precision', () => {
    const html = render(operations());
    for (const label of ['Queued jobs', 'Running jobs', 'Prepared jobs', 'Published jobs', 'Model comparison tests', 'Keywords to review', 'Failed jobs', 'Blocked jobs', 'Expired leases', 'Unreported', '$0.009178191', 'analysis_lease_expired']) expect(html).toContain(label);
    expect(html).toContain('pending candidates, not jobs or videos'); expect(html).toContain('Prepared output has not yet been published');
    expect(html).toContain('do not add them'); expect(html).toContain('holds across days'); expect(html).toContain('cumulative evaluation ceiling does not reset');
    expect(html).toContain('Read only'); expect(html).not.toContain('<button');
  });
  it('makes absent monitoring and partial totals explicit without inventing a healthy zero', () => {
    const unavailable = render();
    expect(unavailable).toContain('Operational status is unavailable'); expect(unavailable).not.toContain('$0'); expect(unavailable).not.toContain('Published jobs');
    const html = render(operations({ ledger: { rowsRead: 5000, rowLimit: 5000, totalRows: 5001, complete: false }, alerts: ['ledger_incomplete', 'ledger_changed'] }));
    expect(html).toContain('incomplete observation'); expect(html).toContain('not authoritative totals'); expect(html).toContain('ledger changed during this read');
    expect(html).not.toContain('two bounded reads agreed');
  });
  it('keeps normal caps, the four approved choices and the existing accessible model controls', () => {
    const settings: Settings = { selectedModel: DEFAULT_ANALYSIS_MODEL, revision: 1, updatedAt: '2026-10-25T12:00:00Z', keyConfigured: true, runtimeEnabled: false, budget: { enabled: false, dailyLimitUsd: 5, lifetimeLimitUsd: 5 }, operations: operations() };
    const html = renderToStaticMarkup(createElement(AnalysisSettings, { settings, request: async () => settings, checkConnection: async () => ({ configured: true, authenticated: true, status: 'ready' as const }), reload: () => undefined, onPendingChange: () => undefined }));
    expect(html.match(/<option /g)).toHaveLength(4); expect(html).toContain('DeepSeek V4.1 Flash (default)');
    expect(html.match(/\$5\.00/g)).toHaveLength(2); expect(html).toContain('aria-describedby='); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Save model'); expect(html).toContain('Check connection'); expect(html).toContain('Analysis operations');
    expect(html).not.toMatch(/Clear hold|Reset budget|Activate analysis/);
  });
});
