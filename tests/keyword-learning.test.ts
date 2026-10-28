import { describe, expect, it } from 'vitest';
// @ts-expect-error Private evaluation preparation is a standalone JS tool.
import { validateLiteralInventory, findLiteralNameOccurrences, minePatternNames, combineKeywordInventories, resolveKeywordCheckerVerdicts, applyKeywordBoundaryGuards, scoreKeywordInventory, compareKeywordMethods } from '../scripts/lib/keyword-learning.mjs';

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
  it('retains exact Arabic names after one token-start conjunction or preposition', () => {
    const content = '🎥 وسارة بوضع التسلل وجي تي 2 وَليلى.';
    for (const name of ['سارة', 'وضع التسلل', 'جي تي 2', 'ليلى']) {
      const found = findLiteralNameOccurrences(content, name);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ start: content.indexOf(name), end: content.indexOf(name) + name.length, quote: name });
      expect(content.slice(found[0].start, found[0].end)).toBe(name);
    }
    expect(findLiteralNameOccurrences(content, 'سارة')[0].start).toBe(4); // UTF-16 emoji + space + conjunction.
  });
  it('does not split arbitrary Arabic words, articles, compound prefixes or short suffixes', () => {
    for (const content of ['سوبرسارة', 'سوبسارة', 'وبسارة', 'السارة', 'والسارة', 'بسارةx']) {
      expect(findLiteralNameOccurrences(content, 'سارة')).toEqual([]);
    }
    expect(findLiteralNameOccurrences('وضع التسلل', 'ضع التسلل')).toEqual([]);
    expect(findLiteralNameOccurrences('ورد', 'رد')).toEqual([]);
    expect(findLiteralNameOccurrences('وًَّسارة', 'سارة')).toEqual([]);
    expect(findLiteralNameOccurrences('وجي تي 2.1', 'جي تي 2')).toEqual([]);
    expect(findLiteralNameOccurrences('وجي تي 2.1', 'جي تي 2.1')).toHaveLength(1);
  });
  it('recognizes token-start non only for complete uppercase numeric designations', () => {
    const content = 'nonQPX8 nonQPX8.2 nonQPX80 xenonQPX8 nonQPX8Lite NonQPX9 nonAeroBox nonqpx8';
    expect(findLiteralNameOccurrences(content, 'QPX8')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'QPX8.2')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'QPX80')).toHaveLength(1);
    expect(findLiteralNameOccurrences(content, 'QPX9')).toHaveLength(1);
    for (const fragment of ['QPX', 'QPX8Lite', 'AeroBox', 'qpx8']) expect(findLiteralNameOccurrences(content, fragment)).toEqual([]);
    expect(findLiteralNameOccurrences('nonQPX8.2.1', 'QPX8.2')).toEqual([]);
    expect(findLiteralNameOccurrences('nonQPX8.2a.1', 'QPX8.2a')).toEqual([]);
    expect(findLiteralNameOccurrences('nonQPX8.2a', 'QPX8.2a')).toHaveLength(1);
  });
  it('aligns prefixed names across complete cues without moving or expanding their evidence', () => {
    const content = '🎥 بوضع التسلل ثم nonQPX8.';
    const cues = [{ text: '🎥 بوضع', startSeconds: 2, durationSeconds: 1 },
      { text: 'التسلل ثم nonQPX8.', startSeconds: 3, durationSeconds: 2 }];
    expect(findLiteralNameOccurrences(content, 'وضع التسلل', cues)).toEqual([
      { start: 4, end: 14, quote: 'وضع التسلل', ranges: [{ startSeconds: 2, endSeconds: 5 }] },
    ]);
    expect(findLiteralNameOccurrences(content, 'QPX8', cues)[0].ranges).toEqual([{ startSeconds: 3, endSeconds: 5 }]);
    expect(findLiteralNameOccurrences(content, 'QPX8', [{ text: 'unrelated', startSeconds: 5, durationSeconds: 1 }])[0].ranges).toEqual([]);
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
  it('supplies lowercase mixed-letter/digit candidates without guessing names or splitting their tokens', () => {
    const content = 'Try q9, ab17x and ö7. Compare q9x with rev4.2. ordinary words and 42 are not model candidates.';
    const names = minePatternNames(content).names;
    for (const name of ['q9', 'ab17x', 'ö7', 'q9x', 'rev4.2']) expect(names).toContain(name);
    expect(names).not.toContain('ordinary');
    expect(names).not.toContain('42');
    expect(minePatternNames('Only q9x is written.').names).not.toContain('q9');
    expect(names.every((name: string) => findLiteralNameOccurrences(content, name).length)).toBe(true);
  });
  it('optionally focuses patterns while retaining domains, handles, codes, acronyms, names and possessive owners', () => {
    const content = "Visit novapay.test and @AeroBox. Try q9 with USB and GPUs. AeroBox meets North Harbor, and Mira's tool follows Solara’s design. Finally ordinary filler.";
    const broad = minePatternNames(content), focused = minePatternNames(content, { precision: 'focused' });
    for (const name of ['novapay.test', '@AeroBox', 'q9', 'USB', 'GPUs', 'AeroBox', 'North Harbor', 'Mira', 'Solara']) expect(focused.names).toContain(name);
    for (const name of ['Visit', 'Try', 'Finally']) {
      expect(broad.names).toContain(name);
      expect(focused.names).not.toContain(name);
    }
    expect(focused.names.length).toBeLessThan(broad.names.length);
    expect(focused.names.every((name: string) => broad.names.includes(name) && findLiteralNameOccurrences(content, name).length)).toBe(true);
    expect(focused.uncertainNames).toEqual([]);
    expect(minePatternNames(content, { precision: 'broad' })).toEqual(broad);
    expect(() => minePatternNames(content, { precision: 'aggressive' })).toThrow('invalid_keyword_pattern_precision');
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

describe('optional source-only keyword boundary guards', () => {
  const row = (name: string, kind = 'brand', disposition = 'accepted') => ({ name, kind, disposition,
    reason: 'Original checker judgment.', originalVerdicts: [{ section: 'decisions', index: 0,
      verdict: { name, kind, disposition, reason: 'Original checker judgment.' } }] });
  it('rejects a prefix only when every exact occurrence starts a longer accepted name, preserving audit', () => {
    const rows = [row('Aero'), row('Aero Labs', 'organization')], before = JSON.stringify(rows);
    const result = applyKeywordBoundaryGuards({ content: 'Aero Labs tests units. Return to Aero Labs.', rows });
    expect(result.rows[0]).toMatchObject({ name: 'Aero', disposition: 'rejected',
      hostBoundaryOriginalDisposition: 'accepted', hostBoundaryGuard: {
        code: 'only_prefix_of_longer_accepted_name', occurrenceCount: 2, longerNames: ['Aero Labs'] } });
    expect(result.rows[0].originalVerdicts).toEqual(rows[0].originalVerdicts);
    expect(result.rows[0].originalVerdicts[0].verdict.disposition).toBe('accepted');
    expect(result.rows[1].disposition).toBe('accepted');
    expect(result.changes).toMatchObject([{ name: 'Aero', from: 'accepted', to: 'rejected' }]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('retains independently named parents and does not use rejected, review or nonexistent longer names', () => {
    expect(applyKeywordBoundaryGuards({ content: 'Aero runs Aero Labs.', rows: [row('Aero'), row('Aero Labs', 'organization')] }).changes).toEqual([]);
    for (const disposition of ['review', 'rejected']) {
      expect(applyKeywordBoundaryGuards({ content: 'Aero Labs runs.', rows: [row('Aero'), row('Aero Labs', 'organization', disposition)] }).changes).toEqual([]);
    }
    expect(applyKeywordBoundaryGuards({ content: 'Aero runs.', rows: [row('Aero'), row('Aero Labs', 'organization')] }).changes).toEqual([]);
    expect(applyKeywordBoundaryGuards({ content: 'Aero Labs runs.', rows: [row('Aero', 'brand', 'review'), row('Aero Labs', 'organization')] }).changes).toEqual([]);
  });
  it('preserves named processors, configurations, standards, numeric versions and possessive owners', () => {
    const content = "q9 FalconBook uses Link 4.2 and 12pin 4x8 cable. Mira's Studio tests them.";
    const rows = [row('q9', 'chip_model'), row('q9 FalconBook', 'product_variant'), row('FalconBook', 'product'),
      row('Link', 'standard'), row('Link 4.2', 'standard'), row('12pin 4x8', 'standard'), row('12pin 4x8 cable', 'product'),
      row('Mira', 'person'), row("Mira's Studio", 'organization')];
    expect(applyKeywordBoundaryGuards({ content, rows }).changes).toEqual([]);
  });
  it('does not exempt arbitrary product-family prefixes or technology fragments', () => {
    const rows = [row('Box7', 'product_family'), row('Box7 Pro', 'product'), row('Render', 'technology'), row('Render Super Resolution', 'technology')];
    const result = applyKeywordBoundaryGuards({ content: 'Box7 Pro uses Render Super Resolution.', rows });
    expect(result.changes.map((change: {name: string}) => change.name)).toEqual(['Box7', 'Render']);
  });
  it('drops only a domain-typed malformed wrapper when its source-exact bare host is separately accepted', () => {
    const rows = [row('novapay.test/sale', 'domain', 'review'), row('novapay.test', 'domain')];
    const result = applyKeywordBoundaryGuards({ content: 'Visit novapay.test/sale.', rows });
    expect(result.rows[0]).toMatchObject({ disposition: 'rejected', hostBoundaryOriginalDisposition: 'review',
      hostBoundaryGuard: { code: 'domain_wrapper_with_retained_host', retainedHost: 'novapay.test' } });
    expect(result.rows[1].disposition).toBe('accepted');
    expect(result.changes).toHaveLength(1);
    expect(applyKeywordBoundaryGuards({ content: 'novapay.test sale', rows: [row('novapay.test sale', 'domain'), row('novapay.test', 'domain')] }).changes).toHaveLength(1);
  });
  it('keeps unresolved hosts and other kinds instead of guessing a domain or removing an unsupported normalization', () => {
    for (const rows of [
      [row('novapay.test/sale', 'domain')],
      [row('novapay.test/sale', 'domain'), row('novapay.test', 'domain', 'review')],
      [row('novapay.test/sale', 'product'), row('novapay.test', 'domain')],
      [row('NovaPay Service', 'domain'), row('novapay.test', 'domain')],
    ]) expect(applyKeywordBoundaryGuards({ content: 'Visit novapay.test/sale.', rows }).changes).toEqual([]);
    expect(() => applyKeywordBoundaryGuards({ content: source, rows: [{ name: 'Aero', disposition: 'maybe' }] })).toThrow('invalid_keyword_boundary_input');
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
  it('does not publish an uncertain identity merely because finding it is optional', () => {
    const ref = { version: 'optional-review-v1', identities: [
      { id: 'known', surfaces: ['AeroBox'], disposition: 'accepted' },
      { id: 'alias', surfaces: ['Jax'], disposition: 'review', required: false },
    ] };
    const report = scoreKeywordInventory({ content: 'AeroBox thanks Jax.', rows: [{ name: 'AeroBox', disposition: 'accepted' }, { name: 'Jax', disposition: 'accepted' }], reference: ref });
    expect(report.missing).toEqual([]);expect(report.unsupportedAccepted).toEqual(['Jax']);expect(report.good).toBe(false);
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
