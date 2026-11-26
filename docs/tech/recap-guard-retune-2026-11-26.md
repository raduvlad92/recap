# Recap guard retune — 26 November 2026

The retuned guard met the agreed replay thresholds. It kept **12/12** valid archived-source recaps, flagged **11/12** invalid ones, and introduced **no fictional-fixture regressions**. Keep findings in individual review when support is unclear. Passing the guard establishes the absence of a detected conflict. It does not establish full source support.

## Blind agreement

The second annotator, Claude Opus 5.5, read only the randomized packet and rubric offline as reported by the PM. Both label sets contain 12 valid and 12 invalid drafts. There were no uncertain labels or disagreements. Each consensus label is the two annotators’ agreement. No adjudication or tie-break was needed.

| First label | Second valid | Second invalid |
| --- | ---: | ---: |
| Valid | 12 | 0 |
| Invalid | 0 | 12 |

Observed agreement was **24/24**, and chance agreement from the marginals was **0.50**. **Cohen’s κ = (1 − 0.50) / (1 − 0.50) = 1.00.** The closest call was blind item B11 (A21), where the draft omitted “about” before an attributed reserve amount. Both annotators kept it valid. The draft kept the same reported rounded figure and described money set aside, with no assertion that it was exact or already paid.

The packet and rubric are mode 0600 and outside the worktree. The original private archive, annotations and extraction notes were moved to the restricted evidence directory. Hashes matched before and after. The blind key and independent annotations remain there as separate private inputs. Raw source text and private IDs stay outside Git. [Independent sample and protocol at its original commit](https://github.com/raduvlad92/recap/blob/24fa422/docs/tech/recap-guard-holdout-2026-11-26.md)

## Eleven original false holds

| Case | Original guard | Why the draft was valid |
| --- | --- | --- |
| A01 | Quote-wide qualifier equality | The draft expresses “without third-party ads” as ad-free and retains viewer funding. The extra qualifier tokens do not change that claim. |
| A03 | Ordered word overlap | Recasting the speaker’s rate as an estimate preserves the software licence, amount, per-unit basis and annual period. |
| A05 | Ordered word overlap | The paraphrase moves the lobbying amount and time frame within the sentence while preserving the actor, figure and period. |
| A07 | Ordered word overlap | Reporting the condition and specific percentage remains supported despite a caption spelling error and different grammatical phrasing. |
| A09 | Quote-wide qualifier equality and ordered word overlap | The first point preserves the switch from resting to tapping without repeating “only”. The second paraphrases what the reviewer misses most. |
| A11 | Quote-wide qualifier equality | The qualifier “some” occurs in a later phrase about potential scanning improvements. It does not qualify the stated ability to scan without a computer. |
| A13 | Quote-wide qualifier equality | The draft preserves speculation and the lack of confirming markings, using “no marking” where the quote says it does not say anything. |
| A15 | Ordered word overlap | Reordering the touchscreen and Mac wording retains the same product-line scope. |
| A17 | Ordered word overlap | “A day after a forum request” preserves the order and duration of the original account. |
| A19 | Ordered word overlap | “Tampered copy” faithfully paraphrases a malicious version and preserves the attributed finding about the device compromise. |
| A23 | Ordered word overlap | The recap restates the reported pledge and retains both its voluntary status and the possibility of revocation. |

The revised guard drops blanket qualifier equality and the 80% ordered-word cutoff. It checks concrete conflicts in the cited passage, including comparable figures, aligned event order, reserve versus payment, narrower scope and opposing statements on the same subject. A clearly corrective nearby clause can flag a contradictory absolute claim when the quote occurs once. Missing or shortened exact quotes still trigger the citation check. A repeated quote supplies its text but lacks a unique location for a nearby correction.

## Exact replay against consensus

Precision and recall refer to flags for invalid drafts. Retention is the share of valid drafts kept.

| Drafts | Guard | Flag precision | Flag recall | Valid retention |
| --- | --- | ---: | ---: | ---: |
| Archived-source consensus | Original `9b103de` | 10/21 (47.6%) | 10/12 (83.3%) | 1/12 (8.3%) |
| Archived-source consensus | Retuned | 11/11 (100%) | 11/12 (91.7%) | 12/12 (100%) |
| Fictional fixture | Original `9b103de` | 11/16 (68.8%) | 11/12 (91.7%) | 7/12 (58.3%) |
| Fictional fixture | Retuned | 12/12 (100%) | 12/12 (100%) | 12/12 (100%) |

The retune catches the reversed event order (A18) and the claim that funds set aside had already been paid (A22). It now leaves A10 for individual review without a flag. That draft asserts a feature without evidence in its attached quote. The original flagged the draft by lexical mismatch. The fictional replay preserved every previously correct case and now flags the reversed comparison in F02 and keeps the five valid paraphrases or unrelated qualifications previously held.

The archived-source sample informed tuning. The blind annotator verified the labels on that same sample. A fresh sample is still needed to estimate performance outside these cases. This work establishes the requested replay result and leaves the release, paid wave and owner review decisions to their existing controls. The A2 totals in the [original draft quality report](flow5-draft-quality-2026-11-26.md) describe the original guard.

```sh
node --experimental-strip-types docs/tech/evidence/replay-recap-guard-retune.mts /Users/vladeeno/.config/pm-secrets
```

The command loads the original guard and fictional fixture from local Git objects and reads the two private label sets. It prints only counts, agreement and anonymized mismatch IDs. Typecheck, scorer typecheck, 203 focused tests and both replays passed. One existing private-fixture test was skipped. Production access, writes and provider spend were zero.
