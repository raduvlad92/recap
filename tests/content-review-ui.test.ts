import { createElement } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null as any }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual,
    useState: (initial: any) => hooks.current ? hooks.current.useState(initial) : actual.useState(initial),
    useRef: (initial: any) => hooks.current ? hooks.current.useRef(initial) : actual.useRef(initial),
    useEffect: (fn: any, deps: any) => hooks.current ? hooks.current.useEffect(fn, deps) : actual.useEffect(fn, deps),
  };
});
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

// Exercise the actual component handlers with the same lightweight hook pattern
// used by the workspace race tests, without a DOM dependency or real requests.
afterEach(() => { hooks.current = null; vi.restoreAllMocks(); });
function reviewHarness(input: Parameters<typeof AnalysisReviews>[0]) {
  const slots: any[] = [], effects: Array<() => void> = []; let index = 0, current = input, mounted = true, lateUpdates = 0;
  hooks.current = {
    useState: (initial: any) => {
      const at = index++, slot = slots[at] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, (next: any) => { if (!mounted) lateUpdates++; slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => slots[index++] ??= { current: initial },
    useEffect: (fn: any, deps: any[]) => {
      const at = index++, previous = slots[at];
      if (!previous || deps?.length !== previous.deps?.length || deps?.some((value, n) => !Object.is(value, previous.deps[n]))) {
        const next = { deps, cleanup: previous?.cleanup }; slots[at] = next;
        effects.push(() => { next.cleanup?.(); next.cleanup = fn(); });
      }
    },
  };
  const render = (runEffects = true) => { index = 0; const tree = AnalysisReviews(current); if (runEffects) effects.splice(0).forEach(fn => fn()); return tree; };
  return { render, update: (next: Partial<typeof input>, runEffects = true) => { current = { ...current, ...next }; return render(runEffects); }, unmount: () => { slots.forEach(slot => slot?.cleanup?.()); mounted = false; }, lateUpdates: () => lateUpdates };
}
function nodes(tree: any): any[] { if (Array.isArray(tree)) return tree.flatMap(nodes); return tree?.props ? [tree, ...nodes(tree.props.children)] : []; }
function nodeText(tree: any): string { if (Array.isArray(tree)) return tree.map(nodeText).join(''); return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree?.props ? nodeText(tree.props.children) : ''; }
function button(tree: any, label: string) { const value = nodes(tree).find(node => node.type === 'button' && nodeText(node) === label); if (!value) throw Error('Missing button: ' + label); return value; }
function checkbox(tree: any, label: string) { const value = nodes(tree).find(node => node.type === 'input' && (node.props['aria-label'] === label || node.props['aria-label']?.startsWith(label + ' from '))); if (!value) throw Error('Missing checkbox: ' + label); return value; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const row = (id: string): ContentReviewSummary => ({ ...summary, id, label: id });
const confirmed = (record: ContentReviewSummary, decision = 'approve') => ({ record: { ...record, status: decision === 'approve' ? 'approved' as const : 'rejected' as const, updatedAt: '2026-10-29T02:00:00Z' }, published: decision === 'approve' });

describe('visible-page bulk review decisions', () => {
  it('selects pending rows, reports mixed selection and clears it', () => {
    const records = [row('first'), row('second'), { ...row('decided'), status: 'approved' as const }], actions = props(), h = reviewHarness({ ...actions, data: page(records) });
    let tree = h.render(); const selectPage = checkbox(tree, 'Select this page'), input = { indeterminate: false }; selectPage.props.ref.current = input;
    expect(nodes(tree).filter(n => n.type === 'input').length).toBe(3);
    checkbox(tree, 'Select keyword first').props.onChange(); tree = h.render();
    expect(nodeText(tree)).toContain('1 selected'); expect(checkbox(tree, 'Select this page').props['aria-checked']).toBe('mixed'); expect(input.indeterminate).toBe(true);
    checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); expect(nodeText(tree)).toContain('2 selected'); expect(checkbox(tree, 'Select this page').props.checked).toBe(true);
    button(tree, 'Clear').props.onClick(); tree = h.render(); expect(nodeText(tree)).toContain('0 selected'); expect(button(tree, 'Confirm and publish selected').props.disabled).toBe(true);
  });
  it('uses saved CAS revisions sequentially, preserves partial failures and does not blindly retry', async () => {
    const records = [row('first'), row('invalid'), row('stale'), row('last')], first = deferred<ReturnType<typeof confirmed>>(), actions = props(); let calls = 0;
    actions.decide.mockImplementation(async body => { calls++; if (calls === 1) return first.promise; if (body.id === 'invalid') throw { status: 400, message: 'This recap needs supporting quotes.' }; if (body.id === 'stale') throw { status: 409, message: 'The source changed.' }; return confirmed(records.find(r => r.id === body.id)!); });
    const h = reviewHarness({ ...actions, data: page(records) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); button(tree, 'Confirm and publish selected').props.onClick(); tree = h.render();
    expect(actions.decide).toHaveBeenCalledTimes(1); expect(button(tree, 'Reject selected').props.disabled).toBe(true);
    const expanded = nodes(tree).find(node => typeof node.type === 'function' && node.props.record?.id === 'last');
    await expect(expanded.props.decide({ action: 'review', id: 'last', origin: 'analysis', expectedUpdatedAt: records[3].updatedAt, decision: 'reject' })).rejects.toMatchObject({ status: 409 });
    first.resolve(confirmed(records[0])); await tick(); tree = h.render();
    expect(actions.decide).toHaveBeenCalledTimes(4); expect(actions.decide.mock.calls.every(([body, options]) => body.expectedUpdatedAt === summary.updatedAt && options?.silent === true && !('proposal' in body))).toBe(true);
    expect(nodeText(tree)).toContain('2 confirmed and published; 2 need attention; 0 not attempted.'); expect(nodeText(tree)).toContain('This recap needs supporting quotes.'); expect(nodeText(tree)).toContain('The source changed.');
    expect(checkbox(tree, 'Select keyword invalid').props.checked).toBe(true); expect(checkbox(tree, 'Select keyword stale').props.checked).toBe(true); expect(checkbox(tree, 'Select keyword invalid').props.disabled).toBe(true);
    expect(actions.reload).not.toHaveBeenCalled(); expect(nodeText(tree)).toContain('Uses saved proposals; save edits individually.');
    expect(button(tree, 'Previous').props.disabled).toBe(true); expect(button(tree, 'Next').props.disabled).toBe(true);
    button(tree, 'Confirm and publish selected').props.onClick(); await tick(); expect(actions.decide).toHaveBeenCalledTimes(4);
  });
  it.each([0, 401, 403, 502, 503])('stops after an uncertain or unauthorized response (%s)', async status => {
    const records = [row('first'), row('blocked'), row('not-started')], actions = props();
    actions.decide.mockImplementation(async body => { if (body.id === 'blocked') throw { status, message: 'The decision could not be confirmed.' }; return confirmed(records.find(r => r.id === body.id)!); });
    const h = reviewHarness({ ...actions, data: page(records) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); button(tree, 'Confirm and publish selected').props.onClick(); await tick(); tree = h.render();
    expect(actions.decide).toHaveBeenCalledTimes(2); expect(nodeText(tree)).toContain('1 confirmed and published; 1 need attention; 1 not attempted.');
    expect(nodeText(tree)).toContain('Not attempted. Reload before deciding.'); expect(checkbox(tree, 'Select keyword not-started').props.checked).toBe(true);
    expect(actions.onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });
  it('confirms two bulk rejections across analysis and legacy origins', async () => {
    const records = [row('analysis-item'), { ...row('legacy-item'), origin: 'legacy_keyword' as const }], actions = props();
    actions.decide.mockImplementation(async body => confirmed(records.find(r => r.id === body.id)!, 'reject'));
    const h = reviewHarness({ ...actions, data: page(records) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); button(tree, 'Reject selected').props.onClick(); await tick(); tree = h.render();
    expect(actions.decide).toHaveBeenCalledTimes(2); expect(actions.decide.mock.calls.map(([body]) => [body.origin, body.decision, body.expectedUpdatedAt])).toEqual([['analysis', 'reject', summary.updatedAt], ['legacy_keyword', 'reject', summary.updatedAt]]);
    expect(nodeText(tree)).toContain('2 rejected; 0 need attention; 0 not attempted.'); expect(nodeText(tree)).toContain('0 selected'); expect(actions.reload).not.toHaveBeenCalled();
  });
  it('does not reuse a selection for a replacement revision before reset effects run', async () => {
    const records = [row('same-id')], actions = props(), h = reviewHarness({ ...actions, data: page(records) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); const oldAction = button(tree, 'Confirm and publish selected');
    tree = h.update({ data: page([{ ...records[0], updatedAt: '2026-10-29T03:00:00Z' }]) }, false);
    expect(nodeText(tree)).toContain('0 selected'); button(tree, 'Confirm and publish selected').props.onClick(); oldAction.props.onClick(); await tick(); expect(actions.decide).not.toHaveBeenCalled();
  });
  it('resets visible selection on page and status changes without carrying hidden choices', async () => {
    const actions = props(), h = reviewHarness({ ...actions, data: page([row('first')]) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); expect(nodeText(tree)).toContain('1 selected');
    tree = h.update({ page: 1, data: { ...page([row('second')]), page: 1 } }); tree = h.render(); expect(nodeText(tree)).toContain('0 selected');
    tree = h.update({ status: 'approved', data: page([{ ...row('approved'), status: 'approved' }]), page: 0 }); expect(nodes(tree).filter(n => n.type === 'input').length).toBe(0); expect(actions.decide).not.toHaveBeenCalled();
  });
  it('stops remaining writes after unmount and ignores the late response', async () => {
    const records = [row('first'), row('second')], first = deferred<ReturnType<typeof confirmed>>(), actions = props(); actions.decide.mockReturnValue(first.promise);
    const h = reviewHarness({ ...actions, data: page(records) }); let tree = h.render(); checkbox(tree, 'Select this page').props.onChange(); tree = h.render(); button(tree, 'Reject selected').props.onClick(); expect(actions.decide).toHaveBeenCalledTimes(1);
    h.unmount(); first.resolve(confirmed(records[0], 'reject')); await tick(); expect(actions.decide).toHaveBeenCalledTimes(1); expect(h.lateUpdates()).toBe(0);
  });
});
