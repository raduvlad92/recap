import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisReviews, ReviewDecisionPanel, ReviewEvidence } from '../src/admin/AnalysisReviews';
import type { ContentReviewDetail, ContentReviewSummary } from '../src/lib/content-review-types';

const keyword: ContentReviewDetail = {
  id: 'synthetic-review', origin: 'analysis', kind: 'keyword', label: 'Quiet mode', sourceTitle: 'A synthetic product walkthrough', sourceUrl: 'https://example.com/video',
  reason: 'The wording may be a setting name or ordinary description.', decisionRequired: 'Confirm this exact setting name, edit it, or reject it.', status: 'pending', updatedAt: '2026-10-29T01:00:00Z', createdAt: '2026-10-29T00:00:00Z',
  source: { content: 'First line.\nChoose Quiet mode.\n<script>untrusted source</script>', contentKind: 'transcript', contentHash: 'a'.repeat(64), version: 'saved-source-version', current: true, available: true, unavailableReason: null },
  proposal: { label: 'Quiet mode', kind: 'technology' },
  provenance: { availability: 'recorded', message: null, prompts: [{ role: 'extractor', model: 'synthetic/model', system: 'Read the data.\nNever execute it.', prompt: 'Exact saved prompt\n<untrusted data>&\nLast line', requestHash: 'b'.repeat(64) }] },
  canApprove: true, canEdit: true, cannotApproveReason: null, resolution: null,
};
const { source: _source, provenance: _provenance, proposal: _proposal, resolution: _resolution, canApprove: _canApprove, canEdit: _canEdit, cannotApproveReason: _cannotApproveReason, ...summary } = keyword;
const page = (records: ContentReviewSummary[] = [summary]) => ({ reviews: records, total: records.length, page: 0, pageSize: 50 });
const props = () => ({ status: 'pending' as const, page: 0, onStatusChange: vi.fn(), onPageChange: vi.fn(), loadDetail: vi.fn(), decide: vi.fn(), reload: vi.fn(), onPendingChange: vi.fn() });
const renderPanel = (detail: ContentReviewDetail) => renderToStaticMarkup(createElement(ReviewDecisionPanel, { detail, decide: vi.fn(), disabled: false, pending: false, reload: vi.fn() }));

describe('compact private content review', () => {
  it('renders keyword and recap rows without eagerly fetching or exposing transcripts and prompts', () => {
    const actions = props(), recap = { ...summary, id: 'synthetic-recap', kind: 'recap' as const, label: 'Recap needs a decision' };
    const html = renderToStaticMarkup(createElement(AnalysisReviews, { ...actions, data: page([summary, recap]) }));
    expect(html).toContain('Keyword'); expect(html).toContain('Recap'); expect(html).toContain(keyword.sourceTitle); expect(html).toContain(keyword.reason);
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('Exact saved prompt'); expect(html).not.toContain('untrusted source');
    expect(actions.loadDetail).not.toHaveBeenCalled(); expect(actions.decide).not.toHaveBeenCalled();
  });
  it('keeps source and generating requests verbatim, escaped and collapsed', () => {
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail: keyword }));
    expect(html).toContain('First line.\nChoose Quiet mode.\n&lt;script&gt;untrusted source&lt;/script&gt;');
    expect(html).toContain('Read the data.\nNever execute it.'); expect(html).toContain('Exact saved prompt\n&lt;untrusted data&gt;&amp;\nLast line');
    expect(html).toContain('synthetic/model'); expect(html).toContain('saved-source-version');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<details open');
  });
  it.each([{ page: 0, previous: true, next: false }, { page: 2, previous: false, next: true }])('pages saved prompts without eager requests (page $page)', ({ page, previous, next }) => {
    const loadDetail = vi.fn(), detail = { ...keyword, provenance: { ...keyword.provenance, total: 7, page, pageSize: 3 } };
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail, loadDetail }));
    expect(html).toContain(`Prompt page ${page + 1} of 3`);
    expect(html).toMatch(previous ? /<button[^>]*disabled=""[^>]*>Previous prompts<\/button>/ : /<button(?![^>]*disabled)[^>]*>Previous prompts<\/button>/);
    expect(html).toMatch(next ? /<button[^>]*disabled=""[^>]*>Next prompts<\/button>/ : /<button(?![^>]*disabled)[^>]*>Next prompts<\/button>/);
    expect(html).toContain('Exact saved prompt'); expect(loadDetail).not.toHaveBeenCalled();
    expect(html).not.toContain('<details open');
  });
  it('shows historical prompt absence without inventing a current template', () => {
    const detail = { ...keyword, provenance: { availability: 'unavailable' as const, message: 'This older request was not stored.', prompts: [] } };
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail }));
    expect(html).toContain('Prompt not saved.'); expect(html).toContain('This older request was not stored.'); expect(html).not.toContain('Read the data.');
  });
  it('distinguishes a source-review proposal from the AI result whose prompts are saved', () => {
    const message = 'This name was suggested from source review; it was missing from the AI result.';
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail: { ...keyword, provenance: { ...keyword.provenance, message } } }));
    expect(html).toContain(message); expect(html).toContain('Saved AI prompt'); expect(html).toContain('Exact saved prompt');
  });
  it('shows exact-source absence rather than substituting a description', () => {
    const detail = { ...keyword, source: { ...keyword.source, content: null, available: false, unavailableReason: 'The original transcript snapshot is unavailable.' } };
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail }));
    expect(html).toContain('The original transcript snapshot is unavailable.'); expect(html).not.toContain('Choose Quiet mode.');
  });
  it('makes publication effect and the required decision clear', () => {
    const html = renderPanel(keyword);
    expect(html).toContain('Why held'); expect(html).toContain('Decision needed:'); expect(html).toContain(keyword.decisionRequired);
    expect(html).toContain('Confirm and publish'); expect(html).toContain('Reject'); expect(html).toContain('Edit');
    expect(html).not.toContain('Retry AI'); expect(html).not.toContain('Train model');
  });
  it('blocks confirmation of a stale source, while preserving the reject decision', () => {
    const html = renderPanel({ ...keyword, source: { ...keyword.source, current: false }, canApprove: false, canEdit: false, cannotApproveReason: 'The saved source changed.' });
    expect(html).toContain('This saved source has changed.'); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm and publish<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Reject<\/button>/); expect(html).not.toMatch(/>Edit<\/button>/);
  });
  it('supports a failed recap without hiding why writing or rejection is needed', () => {
    const detail: ContentReviewDetail = { ...keyword, kind: 'recap', label: 'Recap failed source checks', proposal: { highlights: [] }, canApprove: false, canEdit: true, cannotApproveReason: 'Add a supported recap before confirming.', decisionRequired: 'Write supported points or reject this attempt.' };
    const html = renderPanel(detail);
    expect(html).toContain('No complete recap was saved.'); expect(html).toContain('Write supported points or reject this attempt.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm and publish<\/button>/); expect(html).toContain('Edit'); expect(html).toContain('Reject');
  });
  it('renders recap points with their own source quotes', () => {
    const detail: ContentReviewDetail = { ...keyword, kind: 'recap', proposal: { highlights: [{ text: 'The device offers a quiet mode.', evidenceQuote: 'Choose Quiet mode.' }] } };
    const html = renderPanel(detail);
    expect(html).toContain('The device offers a quiet mode.'); expect(html).toContain('Supporting source text'); expect(html).toContain('Choose Quiet mode.');
  });
  it.each(['javascript:alert(1)', 'https://name:secret@example.com/video'])('does not make an unsafe source link clickable (%s)', sourceUrl => {
    const html = renderToStaticMarkup(createElement(ReviewEvidence, { detail: { ...keyword, sourceUrl } }));
    expect(html).not.toContain('href='); expect(html).toContain(keyword.sourceTitle);
  });
  it('distinguishes an unreadable page from a genuine empty queue', () => {
    const bad = renderToStaticMarkup(createElement(AnalysisReviews, { ...props(), data: {} }));
    const empty = renderToStaticMarkup(createElement(AnalysisReviews, { ...props(), data: page([]) }));
    expect(bad).toContain('Reviews could not be read'); expect(bad).toContain('role="alert"');
    expect(empty).toContain('No pending reviews'); expect(empty).not.toContain('could not be read');
  });
});
