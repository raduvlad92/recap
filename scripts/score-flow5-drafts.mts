import { readFileSync } from 'node:fs';
import { createKeywordDraftGuard, recapDraftIssue } from '../netlify/functions/_shared/draft-quality.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --experimental-strip-types scripts/score-flow5-drafts.mts <private fixture.json>');
  process.exit(2);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sample: unknown = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(sample) || sample.length !== 50) throw new Error('Expected the 50 Flow 5 audit rows.');

const outcomes = sample.map((row: unknown, index) => {
  const id = 'D' + String(index + 1).padStart(2, '0');
  const kind = index < 35 ? 'keyword' : 'recap';
  if (!isObject(row) || row.id !== id || row.kind !== kind
    || (row.expected !== 'pass' && row.expected !== 'fail')
    || !isObject(row.source) || typeof row.source.content !== 'string' || !row.source.content
    || typeof row.source.title !== 'string' || !isObject(row.proposal)) {
    throw new Error(`${id}: missing or out-of-order audit data.`);
  }

  let held;
  if (kind === 'keyword') {
    const { label, kind: type } = row.proposal;
    if (typeof label !== 'string' || typeof type !== 'string') throw new Error(`${id}: invalid keyword fixture.`);
    held = Boolean(createKeywordDraftGuard({content: row.source.content, title: row.source.title})({label, kind: type}));
  } else {
    const { highlights } = row.proposal;
    if (!Array.isArray(highlights) || !highlights.length || highlights.some(point =>
      !isObject(point) || typeof point.text !== 'string' || typeof point.evidenceQuote !== 'string')) {
      throw new Error(`${id}: invalid recap fixture.`);
    }
    held = Boolean(recapDraftIssue(row.source.content, highlights));
  }
  return { id, kind, expected: row.expected, held };
});

const rate = (count: number, total: number) => total ? Number((100 * count / total).toFixed(1)) : null;
const report = ['keyword', 'recap', 'all'].map(kind => {
  const rows = outcomes.filter(row => kind === 'all' || row.kind === kind);
  const passes = rows.filter(row => row.expected === 'pass');
  const failures = rows.filter(row => row.expected === 'fail');
  const passingKept = passes.filter(row => !row.held).length;
  const failingHeld = failures.filter(row => row.held).length;
  return {
    kind, total: rows.length,
    before: { valid: passes.length, invalid: failures.length, validPct: rate(passes.length, rows.length) },
    after: {
      held: rows.filter(row => row.held).length,
      kept: rows.filter(row => !row.held).length,
      failingHeld, failingHeldPct: rate(failingHeld, failures.length),
      passingKept, passingKeptPct: rate(passingKept, passes.length),
      keptValidPct: rate(passingKept, rows.filter(row => !row.held).length),
    },
    failingKeptIds: failures.filter(row => !row.held).map(row => row.id),
    passingHeldIds: passes.filter(row => row.held).map(row => row.id),
  };
});
console.log(JSON.stringify(report, null, 2));
if (report.some(result => (result.after.failingHeldPct ?? 100) < 90 || (result.after.passingKeptPct ?? 100) < 90)) {
  process.exitCode = 1;
}
