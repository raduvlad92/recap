import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recapDraftIssue } from '../../../netlify/functions/_shared/draft-quality.ts';

type Label = 'valid' | 'invalid';
type Point = { text: string; evidenceQuote: string };
type Review = { id: string; expected: Label; highlights: Point[] };
type Case = Review & { content: string };

const root = process.argv[2];
if (!root) throw new Error('Pass the private holdout directory that contains the blind key and both label sets.');
globalThis.fetch = () => { throw new Error('Offline holdout replay'); };

const archive = join(root, 'recap-holdout-2026-11-26');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const sources: { id: string; content: string; content_hash: string }[] = read(join(archive, 'sources.json'));
const sourceById = new Map(sources.map(row => [row.id, row.content]));
assert.equal(sourceById.size, 12);
for (const row of sources) assert.equal(createHash('sha256').update(row.content).digest('hex'), row.content_hash);

const first: (Review & { source: string })[] = read(join(archive, 'labels.json'));
const second: { id: string; label: Label | 'uncertain' }[] = read(join(root, 'recap-holdout-annotator2-2026-11-26.json'));
const key: Record<string, string> = read(join(root, 'recap-holdout-blind-key-2026-11-26.json'));
const secondById = new Map(second.map(row => [key[row.id], row.label]));
assert.equal(first.length, 24);
assert.equal(second.length, first.length);
assert.equal(secondById.size, first.length);
assert.ok(first.every(row => secondById.has(row.id)));
const disagreementIds = first.filter(row => row.expected !== secondById.get(row.id)).map(row => row.id);
const observed = (first.length - disagreementIds.length) / first.length;
const chance = (['valid', 'invalid'] as const).reduce((sum, label) => sum
  + first.filter(row => row.expected === label).length * second.filter(row => row.label === label).length / first.length ** 2, 0);
const kappa = chance < 1 ? (observed - chance) / (1 - chance) : null;
console.log(JSON.stringify({ agreement: { observed, chance, kappa, disagreementIds } }));
assert.equal(disagreementIds.length, 0, 'Resolve any disagreements independently before replaying consensus.');

const consensus = first.map(row => ({ ...row, content: sourceById.get(row.source)! }));
const fictional: Case[] = JSON.parse(execFileSync('git', [
  'show', '24fa422:docs/tech/evidence/recap-guard-holdout-2026-11-26.json',
], { encoding: 'utf8' })).cases;

function score(rows: Case[], guard: typeof recapDraftIssue) {
  const counts = { validKept: 0, validHeld: 0, invalidKept: 0, invalidHeld: 0 };
  const kept = new Set<string>();
  for (const { id, expected, content, highlights } of rows) {
    assert.ok(content && highlights.length && highlights.every(point => content.includes(point.evidenceQuote)));
    const held = Boolean(guard(content, highlights));
    counts[expected + (held ? 'Held' : 'Kept') as keyof typeof counts]++;
    if (!held) kept.add(id);
  }
  return { counts, kept };
}

const baseline = '9b103deb874bbeab99a0387e9691f2346351cb3c';
const scratch = mkdtempSync(join(tmpdir(), 'therecap-recap-guard-'));
try {
  const guardPath = 'netlify/functions/_shared/draft-quality.ts';
  for (const path of [guardPath, 'scripts/lib/keyword-learning.mjs']) {
    const destination = join(scratch, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, execFileSync('git', ['show', baseline + ':' + path]));
  }
  const original = (await import(pathToFileURL(join(scratch, guardPath)).href)).recapDraftIssue as typeof recapDraftIssue;
  for (const [name, rows] of [['consensus', consensus], ['fictional', fictional]] as const) {
    const before = score(rows, original), after = score(rows, recapDraftIssue);
    const regressions = rows.filter(row => (row.expected === 'valid') === before.kept.has(row.id)
      && (row.expected === 'valid') !== after.kept.has(row.id)).map(row => row.id);
    console.log(JSON.stringify({ name, before: before.counts, after: after.counts, regressions }));
    assert.equal(rows.length, 24);
    assert.equal(after.counts.validKept + after.counts.validHeld, 12);
    assert.equal(after.counts.invalidKept + after.counts.invalidHeld, 12);
    assert.ok(after.counts.validKept >= 11 && after.counts.invalidHeld >= 10);
    if (name === 'fictional') assert.equal(regressions.length, 0);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
