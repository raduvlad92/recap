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
  it('shows the automatic draft pipeline independently of the paused standard worker and keeps approval and limits explicit',()=>{
    const settings:Settings={selectedModel:DEFAULT_ANALYSIS_MODEL,revision:1,updatedAt:'2026-10-29T12:00:00Z',keyConfigured:true,runtimeEnabled:false,
      budget:{enabled:true,dailyLimitUsd:5,lifetimeLimitUsd:10},automatic:{runtimeEnabled:true,enabledReaders:1,tasks:{queued:12,running:1,review:9,blocked:2,failed:3}}};
    const html=renderToStaticMarkup(createElement(AnalysisSettings,{settings,request:async()=>settings,checkConnection:async()=>({configured:true,authenticated:true,status:'ready' as const}),reload:()=>undefined,onPendingChange:()=>undefined}));
    expect(html).toContain('Standard analysis runtime</dt><dd>Off');
    expect(html).toContain('Enabled for new usable content, within the remaining budget.');
    expect(html).toContain('New recap and keyword suggestions wait in the review queue for approval.');
    expect(html).toContain('$5.00');expect(html).toContain('$10.00');
    expect(html).toContain('daily, total and per-call spending limits apply');
    expect(html).toContain('Missing transcripts stay visible as collection gaps.');
    expect(html).toContain('Keywords use two DeepSeek passes, source patterns and a Sol check.');
    expect(html).toContain('Recaps use a DeepSeek draft and check.');
    for(const [label,count] of [['Queued',12],['Running',1],['Drafts sent for review',9],['Blocked',2],['Failed',3]])expect(html).toContain(`<dt>${label}</dt><dd>${count}</dd>`);
    expect(html).toContain('href="/admin/?section=reviews"');
    expect(html).not.toMatch(/Clear hold|Reset budget|Activate analysis/);
  });
  it.each(['runtime','readers','budget'])('shows automatic drafts paused when the %s gate is closed',gate=>{
    const settings:Settings={selectedModel:DEFAULT_ANALYSIS_MODEL,revision:1,updatedAt:'2026-10-29T12:00:00Z',keyConfigured:true,runtimeEnabled:true,
      budget:{enabled:gate!=='budget',dailyLimitUsd:5,lifetimeLimitUsd:10},automatic:{runtimeEnabled:gate!=='runtime',enabledReaders:gate==='readers'?0:1,tasks:{queued:12,running:0,review:9,blocked:2,failed:3}}};
    const html=renderToStaticMarkup(createElement(AnalysisSettings,{settings,request:async()=>settings,checkConnection:async()=>({configured:true,authenticated:true,status:'ready' as const}),reload:()=>undefined,onPendingChange:()=>undefined}));
    expect(html).toContain('Paused.');expect(html).not.toContain('Enabled for new usable content');
    expect(html).toContain('Drafts sent for review');expect(html).toContain('Open review queue');
  });
});
