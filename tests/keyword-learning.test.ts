import { describe, expect, it } from 'vitest';
// @ts-expect-error Private evaluation preparation is a standalone JS tool.
import { validateLiteralInventory, findLiteralNameOccurrences, minePatternNames, combineKeywordInventories, resolveKeywordCheckerVerdicts, scoreKeywordInventory, compareKeywordMethods } from '../scripts/lib/keyword-learning.mjs';

const inventory = (names: string[], uncertainNames: string[] = []) => ({ names, uncertainNames });
const source = 'AeroBox supports C++ and C#. AeroBox 2 sponsors this. Finally NovaPay.';
const reference = { version: 'synthetic-v1', exhaustive: true, identities: [
  { id: 'aero', canonicalLabel: 'AeroBox', surfaces: ['AeroBox'], kind: 'brand', disposition: 'accepted' },
  { id: 'aero2', surfaces: ['AeroBox 2'], kind: 'product', disposition: 'accepted' },
  { id: 'cpp', surfaces: ['C++'], kind: 'technology', disposition: 'accepted' },
  { id: 'cs', surfaces: ['C#'], kind: 'technology', disposition: 'accepted' },
  { id: 'nova', surfaces: ['NovaPay'], kind: 'brand', disposition: 'accepted' },
] };
const completeRows = () => reference.identities.map(identity => ({ name: identity.surfaces[0], kind: identity.kind, disposition: 'accepted' }));

describe('literal keyword inventories and source evidence', () => {
  it('preserves duplicates for scoring and fails instead of truncating capacity', () => {
    expect(validateLiteralInventory(inventory(['AeroBox', 'AeroBox']))).toEqual(inventory(['AeroBox', 'AeroBox']));
    expect(() => validateLiteralInventory(inventory(['A', 'B']), { maxNames: 1 })).toThrow('literal_inventory_capacity');
    expect(() => validateLiteralInventory({ names: ['A'] })).toThrow('invalid_literal_inventory');
    expect(() => validateLiteralInventory({ ...inventory(['A']), hidden: true })).toThrow('invalid_literal_inventory');
    for (const name of ['', ' AeroBox', 'AeroBox\n', 'x'.repeat(101)]) expect(() => validateLiteralInventory(inventory([name]))).toThrow('invalid_literal_name');
  });
  it('matches all real occurrences including sponsor and final mentions', () => {
    expect(findLiteralNameOccurrences(source, 'AeroBox').map((x: {start: number}) => x.start)).toEqual([0, 29]);
    expect(findLiteralNameOccurrences(source, 'NovaPay').map((x: {quote: string}) => x.quote)).toEqual(['NovaPay']);
    expect(findLiteralNameOccurrences(source, 'Missing')).toEqual([]);
    expect(findLiteralNameOccurrences(source, 'aerobox')).toEqual([]);
  });
  it('keeps punctuation, longer model identities, Unicode combining marks and versions intact', () => {
    const content = 'C C++ C# R9X R9 DLSS 3.5 DLSS 3. Cafe\u0301 Café AeroBox’s AeroBox\'s';
    expect(findLiteralNameOccurrences(content, 'C')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'C++')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'C#')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'R9')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'DLSS 3')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'Cafe')).toHaveLength(0);
    expect(findLiteralNameOccurrences(content, 'Café')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'AeroBox')).toHaveLength(2);
  });
  it('rejects control-bearing model labels instead of silently rewriting them', () => {
    const content = 'AeroBox\n  Plus is here. AeroBox returns.';
    const cues = [{ text: 'AeroBox', startSeconds: 2, durationSeconds: 1 },
      { text: 'Plus is here.', startSeconds: 3, durationSeconds: 2 },
      { text: 'AeroBox returns.', startSeconds: 9, durationSeconds: 3 }];
    expect(() => findLiteralNameOccurrences(content, 'AeroBox\n  Plus', cues)).toThrow('invalid_literal_name_source');
  });
  it('keeps UTF-16 offsets and aligns normalized whitespace without inventing a name spelling', () => {
    const content = '🎥 AeroBox Plus is here. AeroBox returns.';
    const cues = [{ text: '🎥 AeroBox', startSeconds: 2, durationSeconds: 1 },
      { text: 'Plus is here.', startSeconds: 3, durationSeconds: 2 },
      { text: 'AeroBox returns.', startSeconds: 9, durationSeconds: 3 }];
    expect(findLiteralNameOccurrences(content, 'AeroBox Plus', cues)).toEqual([{ start: 3, end: 15, quote: 'AeroBox Plus', ranges: [{ startSeconds: 2, endSeconds: 5 }] }]);
    expect(findLiteralNameOccurrences(content, 'AeroBox', cues).map((x: {ranges: unknown}) => x.ranges)).toEqual([[{ startSeconds: 2, endSeconds: 3 }], [{ startSeconds: 9, endSeconds: 12 }]]);
  });
  it('leaves ambiguous partial cues, absent durations and unrelated cues untimed', () => {
    const content = 'AeroBox is here. AeroBox is here. NovaPay closes.';
    expect(findLiteralNameOccurrences(content, 'AeroBox', [{ text: 'AeroBox is here.', startSeconds: 5, durationSeconds: 2 }]).every((x: {ranges: unknown[]}) => x.ranges.length === 0)).toBe(true);
    expect(findLiteralNameOccurrences(content, 'NovaPay', [{ text: 'NovaPay closes.', startSeconds: 8 }])[0].ranges).toEqual([]);
    expect(findLiteralNameOccurrences(content, 'NovaPay', [{ text: 'Other material.', startSeconds: 8, durationSeconds: 1 }])[0].ranges).toEqual([]);
    expect(findLiteralNameOccurrences(content, 'NovaPay', [{ text: 'NovaPay closes.', startSeconds: 8, durationSeconds: 1 }, { text: 'NovaPay closes.', startSeconds: 18, durationSeconds: 1 }])[0].ranges).toEqual([]);
  });
  it('mines domains, handles, model codes and deliberately unclassified capitals', () => {
    const content = 'Visit novapay.com or @AeroBox. Try RTX 5090, DLSS 3.5 and C++. Finally thanks.';
    const names = minePatternNames(content).names;
    expect(names).toContain('novapay.com');
    expect(names).toContain('@AeroBox');
    expect(names).toContain('RTX 5090');
    expect(names).toContain('DLSS 3.5');
    expect(names).toContain('C++');
    expect(names).toContain('Finally'); // A checker, not capitalization, decides eligibility.
    expect(names.every((name: string) => content.includes(name))).toBe(true);
    expect(minePatternNames('Visit https://novapay.com/offer.').names).toContain('novapay.com');
  });
  it('unions singleton and uncertain names without merging model families or guessing aliases', () => {
    const union = combineKeywordInventories(source, [{ method: 'direct', output: inventory(['AeroBox', 'AeroBox 2']) },
      { method: 'types', output: inventory(['AeroBox'], ['NovaPay']) }, { method: 'patterns', output: inventory(['C#', 'Nonexistent']) }]);
    expect(union.map((x: {name: string}) => x.name)).toEqual(['AeroBox', 'AeroBox 2', 'NovaPay', 'C#', 'Nonexistent']);
    expect(union[0].methods).toEqual(['direct', 'types']);
    expect(union[2].uncertainMethods).toEqual(['types']);
    expect(union[4].occurrences).toEqual([]);
    expect(union.every((x: {disposition: string}) => x.disposition === 'review')).toBe(true);
    expect(() => combineKeywordInventories(source, [{ method: 'same', output: inventory([]) }, { method: 'same', output: inventory([]) }])).toThrow('invalid_keyword_method');
  });
});

describe('checker verdict normalization with preserved original judgments', () => {
  const verdict = (name: string, disposition = 'accepted', kind = 'brand', reason = 'Literal named mention.') => ({ name, disposition, kind, reason });
  it('coalesces consistent repeats, including a missing-name repeat, while retaining every verdict and origin', () => {
    const value = { readComplete: true, decisions: [verdict('AeroBox'), verdict('AeroBox', 'accepted', 'brand', 'Named in the ad.')],
      missingNames: [verdict('AeroBox'), verdict('NovaPay')] };
    const before = JSON.stringify(value);
    const resolved = resolveKeywordCheckerVerdicts({ content: source, value, names: ['AeroBox'] });
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.duplicateVerdicts).toBe(2);
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.rows[0]).toMatchObject({ name: 'AeroBox', disposition: 'accepted', kind: 'brand', verdictCount: 3 });
    expect(resolved.rows[0].originalVerdicts).toEqual([
      { section: 'decisions', index: 0, verdict: value.decisions[0] },
      { section: 'decisions', index: 1, verdict: value.decisions[1] },
      { section: 'missingNames', index: 0, verdict: value.missingNames[0] },
    ]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('retains conflicting judgments as review without choosing a type or a majority winner', () => {
    const value = { readComplete: true, decisions: [verdict('AeroBox'), verdict('AeroBox'), verdict('AeroBox', 'rejected', 'product')], missingNames: [] };
    const resolved = resolveKeywordCheckerVerdicts({ content: source, value, names: ['AeroBox'] });
    expect(resolved.rows[0]).toMatchObject({ name: 'AeroBox', disposition: 'review', kind: null, verdictCount: 3 });
    expect(resolved.rows[0].originalVerdicts).toHaveLength(3);
    expect(resolved.conflicts).toEqual([{ name: 'AeroBox', kinds: ['brand', 'product'], dispositions: ['accepted', 'rejected'], verdictCount: 3 }]);
    const statusConflict = resolveKeywordCheckerVerdicts({ content: source, names: ['AeroBox'], value: {
      readComplete: true, decisions: [verdict('AeroBox')], missingNames: [verdict('AeroBox', 'review')] } });
    expect(statusConflict.rows[0]).toMatchObject({ disposition: 'review', kind: 'brand' });
  });
  it('requires exact candidate coverage and valid complete judgments, and withholds an unsupported acceptance', () => {
    const run = (value: unknown, names = ['AeroBox']) => resolveKeywordCheckerVerdicts({ content: source, value, names });
    expect(() => run({ readComplete: false, decisions: [verdict('AeroBox')], missingNames: [] })).toThrow('checker_incomplete');
    expect(() => run({ readComplete: true, decisions: [], missingNames: [verdict('AeroBox')] })).toThrow('checker_candidate_decisions_incomplete');
    expect(() => run({ readComplete: true, decisions: [verdict('NovaPay')], missingNames: [] })).toThrow('checker_candidate_decisions_incomplete');
    expect(() => run({ readComplete: true, decisions: [{ ...verdict('AeroBox'), disposition: 'maybe' }], missingNames: [] })).toThrow('checker_invalid_decision');
    expect(() => run({ readComplete: true, decisions: [{ ...verdict('AeroBox'), reason: null }], missingNames: [] })).toThrow('checker_invalid_decision');
    const resolved = run({ readComplete: true, decisions: [verdict('AbsentName')], missingNames: [] }, ['AbsentName']);
    expect(resolved.rows[0]).toMatchObject({ disposition: 'review', hostReviewReason: 'literal_name_not_in_source', verdictCount: 1 });
    expect(resolved.rows[0].originalVerdicts[0].verdict.disposition).toBe('accepted');
  });
});

describe('fixed reference keyword quality scoring', () => {
  it('awards 10 only to complete grounded correctly typed retained names', () => {
    const report = scoreKeywordInventory({ content: source, rows: completeRows(), reference });
    expect(report.score).toBe(10);
    expect(report.good).toBe(true);
    expect(report.components).toEqual({ coverage: 1, correctness: 1, identityAndVersion: 1, duplicateHandling: 1 });
    expect(report.referenceSurfaceCoverage).toBe(1);
  });
  it('keeps technical failure unscored and a completed empty result at 1', () => {
    const failed = scoreKeywordInventory({ content: source, rows: completeRows().slice(0, 1), reference, deliveryStatus: 'truncated' });
    expect(failed.semanticScore).toBeNull();
    expect(failed.status).toBe('delivery_failure');
    expect(scoreKeywordInventory({ content: source, rows: [], reference }).score).toBe(1);
    expect(scoreKeywordInventory({ content: source, rows: completeRows(), reference, provisional: true }).good).toBe(false);
  });
  it('marks a high-scoring inventory bad when even one known brief/ad name is missing', () => {
    const report = scoreKeywordInventory({ content: source, rows: completeRows().filter(row => row.name !== 'NovaPay'), reference });
    expect(report.score).toBe(9.2);
    expect(report.good).toBe(false);
    expect(report.missing).toMatchObject([{ id: 'nova', candidatePresent: false }]);
  });
  it('does not treat every name queued for review as production-ready coverage', () => {
    const report = scoreKeywordInventory({ content: source, rows: completeRows().map(row => ({ ...row, disposition: 'review' })), reference });
    expect(report.candidateCoverage).toBe(1);
    expect(report.acceptedCoverage).toBe(0);
    expect(report.reviewRate).toBe(1);
    expect(report.components.coverage).toBe(0);
    expect(report.good).toBe(false);
  });
  it('retains an ambiguous reference identity in review and penalizes guessing its identity', () => {
    const ref = { version: 'ambiguous-v1', identities: [{ id: 'name', surfaces: ['Jax'], disposition: 'review' }] };
    expect(scoreKeywordInventory({ content: 'Jax closes.', rows: [{ name: 'Jax', disposition: 'review' }], reference: ref }).score).toBe(10);
    expect(scoreKeywordInventory({ content: 'Jax closes.', rows: [{ name: 'Jax', disposition: 'accepted' }], reference: ref }).good).toBe(false);
    expect(scoreKeywordInventory({ content: 'Jax closes.', rows: [{ name: 'Jax', disposition: 'review', identityId: 'invented-full-person' }], reference: ref }).components.coverage).toBe(0);
  });
  it('separates false names, unexpected literal names requiring reference audit and duplicates', () => {
    const rows = [...completeRows(), { name: 'Invented', kind: 'brand', disposition: 'accepted' }, { name: 'Finally', kind: 'brand', disposition: 'accepted' }, completeRows()[0]];
    const report = scoreKeywordInventory({ content: source, rows, reference });
    expect(report.unsupportedAccepted).toEqual(['Invented', 'Finally']);
    expect(report.unexpected).toEqual([{ name: 'Finally', disposition: 'accepted', reason: 'reference_audit_required' }]);
    expect(report.duplicateRows).toBe(1);
    expect(report.good).toBe(false);
    expect(report.components.correctness).toBe(5 / 7);
  });
  it('does not count a rejected raw extractor prediction as correct just because it was filtered later', () => {
    const rows = completeRows().map(row => row.name === 'NovaPay' ? { ...row, disposition: 'rejected' } : row);
    const report = scoreKeywordInventory({ content: source, rows, reference });
    expect(report.rejected).toEqual(['NovaPay']);
    expect(report.components.correctness).toBe(4 / 5);
    expect(report.candidateCoverage).toBe(1);
    expect(report.missing).toMatchObject([{ id: 'nova' }]);
  });
  it('grades identity/type separately and gives no unearned type point to untyped outputs', () => {
    expect(scoreKeywordInventory({ content: source, rows: completeRows().map(row => ({ ...row, kind: 'wrong' })), reference }).components.identityAndVersion).toBe(0);
    expect(scoreKeywordInventory({ content: source, rows: completeRows().map(row => row.name), reference }).score).toBe(9);
  });
  it('groups only audited aliases for identity coverage while reporting surface omissions', () => {
    const ref = { version: 'aliases-v1', identities: [{ id: 'aa', surfaces: ['Aero Analysis', 'AA'], disposition: 'accepted' }] };
    const content = 'Aero Analysis (AA) is here.';
    const one = scoreKeywordInventory({ content, rows: [{ name: 'AA' }], reference: ref });
    expect(one.components.coverage).toBe(1);
    expect(one.referenceSurfaceCoverage).toBe(0.5);
    const both = scoreKeywordInventory({ content, rows: [{ name: 'AA' }, { name: 'Aero Analysis' }], reference: ref });
    expect(both.duplicateRows).toBe(0);
    expect(both.returnedIdentityCount).toBe(1);
    expect(both.referenceSurfaceCoverage).toBe(1);
  });
  it('allows known optional technical terms without adding them to required named-mention coverage', () => {
    const ref = { version: 'optional-v1', identities: [{ id: 'aero', surfaces: ['AeroBox'], kind: 'brand' }],
      technicalTerms: [{ surface: 'GPU' }] };
    const report = scoreKeywordInventory({ content: 'AeroBox GPU', rows: [{ name: 'AeroBox', kind: 'brand' }, { name: 'GPU', kind: 'category' }], reference: ref });
    expect(report.requiredIdentityCount).toBe(1);
    expect(report.components.coverage).toBe(1);
    expect(report.components.correctness).toBe(1);
    expect(report.unexpected).toEqual([]);
    expect(report.good).toBe(true);
  });
  it('rejects stale/unusable references and ambiguous alias ownership rather than inventing a denominator', () => {
    expect(() => scoreKeywordInventory({ content: source, rows: [], reference: { version: 'bad', identities: [{ id: 'a', surfaces: ['Missing'] }] } })).toThrow('ungrounded_keyword_reference');
    expect(() => scoreKeywordInventory({ content: source, rows: [], reference: { version: 'bad', identities: [{ id: 'a', surfaces: ['AeroBox'] }, { id: 'b', surfaces: ['AeroBox'] }] } })).toThrow('ambiguous_keyword_reference_surface');
  });
  it('reports each method, checked union and the unique useful contribution of a specialist', () => {
    const methods = [{ method: 'direct', output: inventory(['AeroBox', 'AeroBox 2', 'C++', 'C#']), rows: completeRows().slice(0, 4), costUsd: 0.01 },
      { method: 'patterns', output: inventory(['AeroBox', 'NovaPay']), rows: completeRows().filter(row => ['AeroBox', 'NovaPay'].includes(row.name)), costUsd: 0 }];
    const result = compareKeywordMethods({ content: source, methods, reference, checkedRows: completeRows() });
    expect(result.methods[0].good).toBe(false);
    expect(result.methods[1].uniqueCorrectIdentityIds).toEqual(['nova']);
    expect(result.methods[1].costUsd).toBe(0);
    expect(result.union.good).toBe(true);
    expect(result.candidates).toHaveLength(5);
  });
  it('retains a failed method without inventing a zero semantic quality score or losing successful candidates', () => {
    const result = compareKeywordMethods({ content: source, methods: [
      { method: 'direct', deliveryStatus: 'network_failure', costUsd: 0.01 },
      { method: 'types', output: inventory(completeRows().map(row => row.name)), rows: completeRows() },
    ], reference, checkedRows: completeRows() });
    expect(result.methods[0].score).toBeNull();
    expect(result.methods[0].status).toBe('delivery_failure');
    expect(result.methods[0].costUsd).toBe(0.01);
    expect(result.candidates).toHaveLength(5);
    expect(result.union.good).toBe(true);
  });
});
