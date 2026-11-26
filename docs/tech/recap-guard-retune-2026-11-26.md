# Recap guard retune — 26 November 2026

**The fresh production holdout failed the release gate.** The frozen retune kept all **11/11** valid drafts and held **2/13** invalid drafts. Its 15.4% recall falls below the 80% gate. The two evaluations below used the same code. Passing the guard establishes the absence of a detected conflict. It does not establish full source support.

The PM superseded [#63](https://github.com/raduvlad92/recap/pull/63) for V1. Recaps remain held for individual approval and the batch shortcut admits only exact-cited keywords. The [revised labelling rubric](recap-claim-rubric-2026-11-26.md) uses these cases as calibration examples. The replay command runs from the [archived experiment checkout](https://github.com/raduvlad92/recap/tree/817222387adcfddbc4b1abf8288367da549a00d4). [Train 3 review change](https://github.com/raduvlad92/recap/pull/67)

## Fresh production holdout

The sample contains **24 unchanged production drafts from 24 distinct sources**. It includes 21 stored review proposals, two complete saved extraction outputs and one saved analysis-job draft. The 107 takeaways include 23 transcript-based drafts and one feed-text draft. The saved extraction and analysis drafts broaden the positive-candidate pool. The table also reports the review queue subset.

The three exports used explicit `BEGIN READ ONLY` transactions and `ROLLBACK`. Production returned `transaction_read_only = on` at 06:43:50, 06:46:20 and 06:46:26 UTC on November 26. The sampler excluded the prior tuning sources by video ID and content hash, and excluded source URLs and draft IDs from both A2 samples. Each selected draft retained its original complete proposal and cited text, and each bound transcript or post matched its saved hash. The two recruitment strata each held 12 likely cases before labelling. They used editorial screening without guard output. Final labels follow the rubric. No production writes, provider calls or provider spend occurred.

The randomized packet used only case alias, complete source text and quoted draft inputs. The two annotators labelled it separately before replay. The packet, reused rubric, initial labels and adjudication remain mode 0600 outside the worktree. The frozen packet SHA-256 is `8c94936a949f4ba9e0cb90a0ffc82eb1a39228ac1cb88bb50af1ab04b2e7c95f`. The frozen production originals SHA-256 is `db2b33378254606da1f2ee025eaf4eeb1c663821759215df12d96f35a83cc3b9`.

### Label agreement and adjudication

| First label | Second valid | Second invalid |
| --- | ---: | ---: |
| Valid | 10 | 0 |
| Invalid | 8 | 6 |

The first annotator labelled 10 valid and 14 invalid. The second labelled 18 valid and six invalid. Observed agreement was **16/24 (66.7%)**. Expected agreement from the marginals was **11/24 (45.8%)**, giving **Cohen’s κ = 0.385**. Neither annotator used the uncertain label. Before scoring, adjudication resolved the quote’s own referents and explicit contrasts using the surrounding passage. Additional factual assertions still needed support in the attached quote.

| Case | First review | Second review | Consensus and reason |
| --- | --- | --- | --- |
| C01 | Invalid. The excerpt omits the gaming and multimedia comparison. | Valid. The preceding remarks establish the comparison, with a slightly ambiguous referent. | **Valid.** The cited sentence opens with an explicit contrast and refers back to the screen just discussed for general use, gaming and multimedia. The context resolves that contrast. |
| C03 | Invalid. The draft applies a software lineage claim to the device. | Valid. The attributed description and the narrator’s hyperbole fit the transcript. | **Invalid.** The quote attributes iPad lineage to the operating system. It separately calls the device a similar consumption device. The recap conflates them. |
| C06 | Invalid. Least affected by the update does not establish no downsides. | Valid. The full passage describes the update as least impactful and says there were no downsides. | **Invalid.** The no-downsides conclusion follows the attached excerpt and a caveat about personal usage. The quoted relative judgment alone leaves that conclusion out. |
| C12 | Invalid. The draft gives a specific unit for an ambiguous caption token. | Valid. The figures and lab results read as millivolts. | **Invalid.** All three quoted units are transcribed as “molts.” The surrounding text leaves the units unconfirmed. |
| C14 | Invalid. The excerpt establishes the lost sport-mode sound and omits the sound that remained. | Valid. The translated and original-language points accurately describe the review. | **Invalid.** The comparison to a vacuum is a distinct later observation outside the attached quote. The language mix does not affect the label. |
| C17 | Invalid. The attached quote is about reopening a force-closed app. | Valid. The statements and speaker attribution fit the interview. | **Invalid.** The quote ends before the separate explanation of a suspended app’s retained context. |
| C18 | Invalid. The attached quote omits the older camera’s aperture count. | Valid. The aperture and other event details match the discussion overall. | **Invalid.** The older camera’s count is outside this quote. The passage gives the new count and compares aperture movement and sensor size. |
| C21 | Invalid. The attached quote gives the measured efficiency but leaves out the peer comparison. | Valid. The figures and tested performance match the full lab review. | **Invalid.** The efficiency comparison and the claim that dropout performance is high each appear after their attached quotes. Those separate judgments matter to the draft. |

Both agreed C10 was invalid because it comments on the absence of substantive content and supplies no useful takeaway. C13 expands a proposal about making metadata available into compulsory storage and transfer of broader sensitive data. C20 assigns a specific anchor and mounting method to a quote that only explains why the speaker wanted to avoid the studs. Both remain invalid.

### Guard result

The replay used the exact runtime at `535c437adc5bfce89b3f1378ece6fed4ac2406f5`. The 24 consensus labels were frozen before the first replay. The gate requires at least 90% valid retention and 80% recall of invalid drafts.

| Cohort | Flag precision | Invalid recall | Valid retention | Result |
| --- | ---: | ---: | ---: | --- |
| Prior consensus used for tuning | 11/11 (100%) | 11/12 (91.7%) | 12/12 (100%) | Meets thresholds on the tuning sample |
| Fresh production consensus | 2/2 (100%) | 2/13 (15.4%) | 11/11 (100%) | **Fails recall** |
| Fresh review-queue subset | 2/2 (100%) | 2/13 (15.4%) | 8/8 (100%) | **Fails recall** |

The guard held C05 and C18. It missed **C02, C03, C06, C08, C10, C12, C13, C14, C17, C20 and C21**. These misses include added or uncited device specifications, a software lineage claim expanded to hardware, an omitted qualification or contrast, an inferred measurement unit, overstated data handling, and a draft with no useful finding. Most failures came from extra or weakly cited claims without the kind of direct contradiction the retune recognizes. The fresh result also shows substantial disagreement between annotators over which nearby facts the quote supports. The sample is purposefully enriched and small.

The frozen code received no further tuning. The fresh result is the basis for excluding #63 from V1.

## Prior tuning replay

The retuned guard cleared both thresholds on the sample used for tuning and introduced no fictional-fixture regressions.

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

The archived-source sample informed tuning. The blind annotator verified the labels on that same sample. The fresh evaluation above measures performance outside those cases. The A2 totals in the [original draft quality report](flow5-draft-quality-2026-11-26.md) describe the original guard.

```sh
node --experimental-strip-types docs/tech/evidence/replay-recap-guard-retune.mts /Users/vladeeno/.config/pm-secrets
```

The command loads the original guard and fictional fixture from local Git objects and reads the two private label sets. It prints only counts, agreement and anonymized mismatch IDs. Typecheck, scorer typecheck, 203 focused tests and both replays passed. One existing private-fixture test was skipped. Production access, writes and provider spend were zero.
