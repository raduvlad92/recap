# Independent recap guard replay — 26 November 2026

**Wave 0 did not pass.** On 24 hand-labelled drafts authored from retained transcripts, [#63](https://github.com/raduvlad92/recap/pull/63) flagged **10 of 12 invalid recaps** and kept **1 of 12 valid recaps**. It falsely held **11 of 12 valid recaps**. This misses both 90% recap thresholds in the accepted [enablement plan](analysis-enablement-2026-11-26.md). Keep scheduling off and hold advancement to the paid wave on the quality gate.

## Sample and method

- **Archived-source cohort, A01–A24.** The frozen [November cost replay](VIDEO-ANALYSIS-REPLAY-2026-11-26.md) supplied the saved transcripts. Excluding every source represented in A2’s 50 nonempty drafts left 32 eligible videos. Within each of the three pilot channels, order by transcript length with a content-hash tie break. Take the shortest, the rows at zero-based indices `floor(n/3)` and `floor(2n/3)`, and the longest. This produced 12 distinct source videos, four per channel, from 516 to 60,964 characters. Check every transcript against its saved SHA-256. Write one supported recap and one unsupported variant per source using the same evidence. In two pairs, add a second supported takeaway to both drafts to test the whole-recap decision.
- **Public fixture, F01–F24.** Twelve fictional source passages with one supported and one unsupported recap each. Includes lexical contrasts, faithful paraphrases, an unrelated qualifier, a genuine correction and one German and one Spanish pair. The full text and pre-score labels ship in the [fixture](evidence/recap-guard-holdout-2026-11-26.json).
- One annotator authored and labelled each case against the exact attached quote and its surrounding transcript before scoring. A recap needed every point to preserve the actor, scope, figures, timing, modality and causal relation supported by the source. The evaluation uses 48 new test drafts. The archive cohort represents real **source material**, with new hand-authored drafts. It is a purposive paired challenge set with one annotator. The rates describe these samples.

Run the unchanged `recapDraftIssue` from PR head `9b103deb874bbeab99a0387e9691f2346351cb3c` against each draft and its entire saved source. A returned issue means **held**. Each input has 1–6 takeaways, all with literal attached quotations. This isolates #63’s additional guard. The rest of the generation and approval pipeline was outside the replay.

## Precision, recall and false holds

For **flagging invalid drafts**, precision is the share of held drafts that are invalid. Recall is the share of invalid drafts held. For **keeping valid drafts**, precision is the share of kept drafts that are valid. Recall is the share of valid drafts kept.

| Cohort | Invalid held | Invalid kept | Valid held | Valid kept |
| --- | ---: | ---: | ---: | ---: |
| Archived source | 10 | 2 | 11 | 1 |
| Public fictional fixture | 11 | 1 | 5 | 7 |

| Cohort | Flag precision | Flag recall | Keep precision | Valid retention | False-hold rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Archived source | 10/21 (47.6%) | 10/12 (83.3%) | 1/3 (33.3%) | 1/12 (8.3%) | 11/12 (91.7%) |
| Public fictional fixture | 11/16 (68.8%) | 11/12 (91.7%) | 7/8 (87.5%) | 7/12 (58.3%) | 5/12 (41.7%) |

| Cohort | Invalid held | Invalid missed | Valid held by mistake | Valid kept |
| --- | --- | --- | --- | --- |
| Archived source | A02, A04, A06, A08, A10, A12, A14, A16, A20, A24 | A18, A22 | A01, A03, A05, A07, A09, A11, A13, A15, A17, A19, A23 | A21 |
| Public fictional fixture | F04, F06, F08, F10, F12, F14, F16, F18, F20, F22, F24 | F02 | F03, F05, F07, F09, F17 | F01, F11, F13, F15, F19, F21, F23 |

The false holds included faithful paraphrases that fell below the ordered word-matching threshold, a qualifier on a separate sentence, and a nearby correction about an unrelated fact. The three misses reversed event order (A18), changed a reserve into an already completed payment (A22), or changed lower to higher (F02). The surrounding words were close enough to pass the lexical check.

The recap half of Wave 0 needs a revised guard and another unseen, independently labelled sample. Prioritize matching qualifiers to the claim they modify and checking changes in time, comparison and action status. Keep these fixtures unchanged as regression cases. This replay evaluated recap quality only. The keyword half of the gate needs its own holdout.

## Reproduce offline

Use Node 22 in a checkout with the public fixture and #63’s commit available locally. For the archived-source cohort, the access-restricted, Git-ignored working files contain the exact saved transcript snapshots and pre-score labels. The shared workspace holds them in `.local/recap-guard-holdout-20261126/`. The archive and label files have SHA-256 values `8bd7b35068a967ca9559def4ec7042ed7248b0d222f761c0fd8b940cec9a5e41` and `7b11f9217a5ff98f3242d1bbf0680836c29a864548bc0c1318365de2871e395a`, respectively. The public fixture SHA-256 is `385a41ad83ada570b8b8e028d4d0e6170990635d261f24b308845201bbb128b5`.

```sh
guard_dir=$(mktemp -d)
git archive 9b103deb874bbeab99a0387e9691f2346351cb3c \
  netlify/functions/_shared/draft-quality.ts scripts/lib/keyword-learning.mjs |
  tar -xf - -C "$guard_dir"
node --experimental-strip-types --input-type=module - "$guard_dir" <<'JS'
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

globalThis.fetch = () => { throw Error('Offline replay'); };
const { recapDraftIssue } = await import(pathToFileURL(
  process.argv[2] + '/netlify/functions/_shared/draft-quality.ts',
));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const cases = read('docs/tech/evidence/recap-guard-holdout-2026-11-26.json').cases;
const dir = '.local/recap-guard-holdout-20261126/';
const cohorts = { publicFixture: cases };
if (existsSync(dir + 'sources.json') && existsSync(dir + 'labels.json')) {
  const source = new Map(read(dir + 'sources.json').map(row => [row.id, row.content]));
  cohorts.archivedSource = read(dir + 'labels.json').map(row => ({ ...row, content: source.get(row.source) }));
}
for (const [name, rows] of Object.entries(cohorts)) {
  const count = { invalidHeld: 0, invalidKept: 0, validHeld: 0, validKept: 0 };
  for (const row of rows) {
    const issue = recapDraftIssue(row.content, row.highlights);
    count[row.expected + (issue ? 'Held' : 'Kept')]++;
  }
  console.log(name, count);
}
JS
rm -r "$guard_dir"
```

Production queries and writes, model calls, source retrieval and provider spend were all zero. The accepted plan and runtime code stay as they were.
