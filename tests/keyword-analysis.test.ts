import { describe, it, expect } from 'vitest';
// @ts-expect-error Offline annotation preparation is a standalone JS tool.
import { resolveKeywordPasses, keywordFields } from '../scripts/lib/keyword-analysis.mjs';
// @ts-expect-error Offline annotation preparation is a standalone JS tool.
import { captionHash, validateStoredVideoAnalysis } from '../scripts/lib/video-analysis.mjs';
// @ts-expect-error Offline annotation preparation is a standalone JS tool.
import { buildKeywordRevisionPlan, keywordRevisionSql } from '../scripts/review-keywords.mjs';
import { sanitizeSourceUpdate } from '../src/lib/domain';

const text = 'Nvidia RTX 5090 GPU DLSS 5. A game like Tape to Tape or Factorio.';
const input = (content = text) => ({ content, captionHash: captionHash(content), contentKind: 'transcript' });
const candidate = (label: string, kind = 'brand', confidence = 100, content = text) => ({ label, kind, confidence, reason: 'Explicit named mention, including casual examples.', evidenceQuote: content, start: content.indexOf(label), end: content.indexOf(label) + label.length, ranges: [] });
const pass = (role: string, candidates = [candidate('Nvidia'), candidate('RTX 5090', 'product'), candidate('GPU', 'category'), candidate('DLSS 5', 'technology'), candidate('Tape to Tape', 'game'), candidate('Factorio', 'game')], content = text) => ({ ruleVersion: 'entities-v2', role, contentHash: captionHash(content), coverage: [{ start: 0, end: content.length }], candidates });
const run = () => resolveKeywordPasses(input(), pass('extractor'), pass('checker'));
const record = () => ({ id: 'video-1', sourceId: 'source-1', title: 'Video', url: 'https://www.youtube.com/watch?v=abcDEFghijk', publishedAt: '2026-10-22T12:00:00Z', format: 'video', topics: [], brands: [], sponsors: [], references: [], insights: [], contributorIds: [], content: text, contentKind: 'transcript', videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: captionHash(text), timingBasis: 'none' } });
const snapshot = () => ({ workspace: { user_id: 'user_test', updated_at: '2026-10-22T12:00:00Z', state: { savedUpdateIds: ['video-1'] } }, keywordReviews: [], archiveRows: [{ user_id: 'user_test', id: 'video-1', source_id: 'source-1', record: record() }] });
const review = () => ({ id: 'video-1', input: input(), extraction: pass('extractor'), checker: pass('checker') });

describe('entity keywords with a full-content second check', () => {
  it('includes casual games and the final words independently of prominence or duration', () => {
    expect(run().accepted.map((item: { label: string }) => item.label)).toEqual(['Nvidia', 'RTX 5090', 'GPU', 'DLSS 5', 'Tape to Tape', 'Factorio']);
    expect(keywordFields(run()).brands).toContain('Tape to Tape');
    expect(keywordFields(run()).brands).not.toContain('GPU');
  });
  it('does not invent Factorio when absent from the content', () => {
    const content = 'Tape to Tape';
    const a = [candidate('Tape to Tape', 'game', 100, content)];
    expect(resolveKeywordPasses(input(content), pass('extractor', a, content), pass('checker', a, content)).accepted.map((item: { label: string }) => item.label)).toEqual(['Tape to Tape']);
  });
  it('keeps punctuation in names so C++ and C# remain distinct', () => {
    const content = 'C++ and C#';
    const candidates = ['C++', 'C#'].map(label => candidate(label, 'technology', 100, content));
    expect(resolveKeywordPasses(input(content), pass('extractor', candidates, content), pass('checker', candidates, content)).accepted).toHaveLength(2);
  });
  it('queues a summary masquerading as a label even when a source quote exists', () => {
    const a = { ...candidate('GPU', 'category'), label: 'Console performance stagnation' };
    expect(resolveKeywordPasses(input(), pass('extractor', [a]), pass('checker', [a])).accepted).toEqual([]);
  });
  it('queues below 50; 50 is eligible only with agreement and source-grounded names', () => {
    for (const score of [0, 49, 50, 100]) {
      const candidates = [candidate('Tape to Tape', 'game', score)];
      const out = resolveKeywordPasses(input(), pass('extractor', candidates), pass('checker', candidates));
      expect(out.pending).toHaveLength(score < 50 ? 1 : 0);
      expect(out.accepted).toHaveLength(score < 50 ? 0 : 1);
    }
  });
  it('routes names missed by one pass and kind disagreements to review instead of dropping them', () => {
    expect(resolveKeywordPasses(input(), pass('extractor', []), pass('checker')).pending).toHaveLength(6);
    expect(resolveKeywordPasses(input(), pass('extractor', [candidate('GPU', 'category')]), pass('checker', [candidate('GPU', 'brand')])).pending).toHaveLength(1);
  });
  it('routes an unknown score to review and refuses two empty inventories as a completeness claim', () => {
    const candidates = [{ ...candidate('Nvidia'), confidence: undefined }];
    expect(resolveKeywordPasses(input(), pass('extractor', candidates as never), pass('checker', candidates as never)).pending).toHaveLength(1);
    expect(() => resolveKeywordPasses(input(), pass('extractor', []), pass('checker', []))).toThrow('empty_keyword_inventory_requires_manual_review');
  });
  it('rejects incomplete end coverage, stale content, unsupported evidence and invented times', () => {
    const incomplete = pass('checker'); incomplete.coverage[0].end -= 1;
    expect(() => resolveKeywordPasses(input(), pass('extractor'), incomplete)).toThrow('incomplete_keyword_coverage');
    expect(() => resolveKeywordPasses({ ...input(), content: text + 'tail' }, pass('extractor'), pass('checker'))).toThrow('usable_keyword_content_required');
    const bad = pass('checker'); bad.candidates[0].evidenceQuote = 'invented quote';
    expect(() => resolveKeywordPasses(input(), pass('extractor'), bad)).toThrow('unsupported_keyword_evidence');
    const timed = pass('extractor'); (timed.candidates[0].ranges as unknown[]) = [{ startSeconds: 0, endSeconds: 500 }];
    expect(() => resolveKeywordPasses(input(), timed, pass('checker'))).toThrow('unsupported_keyword_timing');
  });
  it('does not truncate after ten keywords during annotation, storage or client sanitization', () => {
    const content = Array.from({ length: 80 }, (_, index) => 'Brand' + index).join(' ');
    const items = content.split(' ').map(label => candidate(label, 'brand', 100, content));
    const result = resolveKeywordPasses(input(content), pass('extractor', items, content), pass('checker', items, content));
    const value = { ...record(), content, videoSummary: { ...record().videoSummary, captionHash: captionHash(content) }, ...keywordFields(result) };
    expect(result.accepted).toHaveLength(80);
    expect(sanitizeSourceUpdate(value)?.videoKeywords).toHaveLength(80);
    expect(sanitizeSourceUpdate(value)?.topics).toHaveLength(80);
    expect(sanitizeSourceUpdate(value)?.brands).toHaveLength(80);
    expect(() => validateStoredVideoAnalysis(value)).not.toThrow();
    expect(() => validateStoredVideoAnalysis({ ...value, videoSummary: undefined })).not.toThrow();
    const complete = { ...value, videoKeywords: Array.from({ length: 1000 }, (_, index) => ({ label: 'Brand' + index, ranges: [] })) };
    expect(sanitizeSourceUpdate(complete)?.videoKeywords).toHaveLength(1000);
    expect(() => validateStoredVideoAnalysis(complete)).not.toThrow();
    const excessive = { ...complete, videoKeywords: [...complete.videoKeywords, { label: 'Brand1000', ranges: [] }] };
    expect(sanitizeSourceUpdate(excessive)).toBeNull();
    expect(() => validateStoredVideoAnalysis(excessive)).toThrow('invalid_archive_video_keywords');
  });
});

describe('bounded existing-record keyword revision', () => {
  it('preserves the exact source and workspace and excludes private evidence from published fields', () => {
    const before = snapshot(), plan = buildKeywordRevisionPlan(before, [review()]);
    expect(plan.patches[0].record.content).toBe(text);
    expect(plan.patches[0].record.videoSummary).toEqual(before.archiveRows[0].record.videoSummary);
    expect(plan.workspaceBefore).toEqual(before.workspace);
    expect(JSON.stringify(plan.patches[0].record)).not.toContain('evidenceQuote');
    expect(keywordRevisionSql(plan)).toContain('stale_keyword_record');
    expect(keywordRevisionSql(plan)).toContain('stale_keyword_workspace');
  });
  it('rejects stale or duplicated input instead of overwriting a changed original', () => {
    expect(() => buildKeywordRevisionPlan(snapshot(), [review(), review()])).toThrow('stale_or_duplicate_keyword_input');
    const r = review(); r.input.content += 'changed';
    expect(() => buildKeywordRevisionPlan(snapshot(), [r])).toThrow('stale_or_duplicate_keyword_input');
  });
  it('keeps uncertain names out of published filters and prepares a private queue record', () => {
    const r = review(); r.extraction.candidates[0].confidence = 49;
    const plan = buildKeywordRevisionPlan(snapshot(), [r]);
    expect(plan.queue[0].label).toBe('Nvidia');
    expect(plan.patches[0].record.topics).not.toContain('Nvidia');
    expect(plan.queue[0].content_hash).toBe(captionHash(text));
  });
  it('honors prior rejection and corrected approval for the same content hash on regeneration', () => {
    const before = snapshot() as ReturnType<typeof snapshot> & { keywordReviews: unknown[] };
    (before.keywordReviews as unknown[]).push({ id: 'a', user_id: 'user_test', update_id: 'video-1', content_hash: captionHash(text), label: 'Nvidia', kind: 'brand', status: 'rejected', resolved_label: 'Nvidia' });
    (before.keywordReviews as unknown[]).push({ id: 'b', user_id: 'user_test', update_id: 'video-1', content_hash: captionHash(text), label: 'Factorio', kind: 'game', status: 'approved', resolved_label: 'Factorio (game)', proposed_ranges: [] });
    const plan = buildKeywordRevisionPlan(before, [review()]);
    expect(plan.patches[0].record.topics).not.toContain('Nvidia');
    expect(plan.patches[0].record.topics).not.toContain('Factorio');
    expect(plan.patches[0].record.topics).toContain('Factorio (game)');
    expect(keywordRevisionSql(plan)).toContain('stale_keyword_decisions');
  });
  it('rechecks capacity after approved decisions are restored', () => {
    const before = snapshot() as ReturnType<typeof snapshot> & { keywordReviews: unknown[] };
    for (let index = 0; index < 500; index++) (before.keywordReviews as unknown[]).push({ id: String(index), user_id: 'user_test', update_id: 'video-1', content_hash: captionHash(text), label: 'Old' + index, kind: 'brand', status: 'approved', resolved_label: 'Approved' + index, proposed_ranges: [] });
    expect(() => buildKeywordRevisionPlan(before, [review()])).toThrow('keyword_capacity_requires_review');
  });
  it('preserves a corrected category instead of recreating a false brand', () => {
    const before = snapshot() as ReturnType<typeof snapshot> & { keywordReviews: unknown[] };
    (before.keywordReviews as unknown[]).push({ id: 'a', user_id: 'user_test', update_id: 'video-1', content_hash: captionHash(text), label: 'GPU', kind: 'brand', resolved_kind: 'category', status: 'approved', resolved_label: 'GPU', proposed_ranges: [] });
    const plan = buildKeywordRevisionPlan(before, [review()]);
    expect(plan.patches[0].record.topics).toContain('GPU');
    expect(plan.patches[0].record.brands).not.toContain('GPU');
  });
});
