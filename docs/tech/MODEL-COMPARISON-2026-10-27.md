# Three-model recap and keyword comparison — 27 October 2026

The founder requested testing the three other available models, recording each result, then deciding together about the twenty videos. The founder clarified that this comparison must cover **recaps and keywords on the same three frozen videos**. The first two keyword trials were completed before that answer arrived; their results are retained without repeating those paid calls. Recaps use a separate suite on those same sources. No twenty-video generation, publication or backfill follows automatically.

Models: MiniMax M3.1 Flash / Together, GPT-6 Luna Pro / OpenAI, GPT-6.1 Sol Pro / OpenAI. Each uses the existing v4 prompts, schemas and checking rules for its task. DeepSeek's earlier trial is a historical baseline; its larger limits differ and it is not a controlled fourth run.

| Frozen video | Saved transcript characters |
| --- | ---: |
| Vetroo 850W Power Supply — LABS Test Report | 3,322 |
| Everything Apple Announced last week — M4 Macs | 6,441 |
| Understanding graphics upscalers like DLSS and FSR | 7,781 |

All three use a plan covering the complete saved transcripts, with common limits of 1,250 chunk characters, 3,072 output tokens and a 27,700-byte conservative input guard. Early failures mean some tasks received only a prefix. Keyword chunking requires 8, 18 and 22 base calls respectively; one eligible correction per call gives at most 96 calls per model. These bounds do not promise that every job needs or finishes all calls. Completeness beyond the saved transcripts remains unverified.

## Budget and result rules

US$0.10 per call, US$5/day and the **existing US$5 cumulative evaluation total**, including previous costs and holds. Starting commitment: US$0.069253760, including US$0.009178191 historical holds. MiniMax has a finite US$0.55 stop-cap; Luna US$0.46. Sol receives one finite cap sealed from remaining shared headroom after those trials. No consumed scope, failed job or historical charge is reset. Actual charges and holds will be reported separately.

The combined conservative keyword base-call reservation bound is US$4.729798805. Repairs can require more than the remaining allowance, especially for Sol. Calls exceeding input, output or cost bounds stop; those results are capacity-limited, not proof of poor semantic quality. Provider failures and unknown charges stay distinct from rejected content.

Recap suites have 41 base calls and at most 79 calls per model. MiniMax's finite recap cap is US$0.41 and Luna's US$0.34. Sol's recap cap is sealed from fresh remaining shared headroom with US$0.30 protected for its unstarted keyword suite; the keyword cap is sealed afterward from the then-current remainder. Neither cap promises complete worst-case execution. Complete saved transcripts and the same frozen v4 contract are retained throughout.

The unresolved Luna charge remains fully reserved. A first comparison run of a different requested model may proceed only when every relevant earlier unknown belongs to the exact same closed/drained suite, round, source cohort, reference and limits, with valid immutable model/job/call bindings. Same-model retries and unrelated/malformed/orphaned holds stay blocked. All monetary sums continue to include the full reservation. No historical cost, result or terminal job changes, and no ordinary processing guard is relaxed.

Comparison jobs store results privately as `evaluated`. Database claim, failure, revoked-permission cleanup and completion preserve existing source annotations, processing states and administrative reviews. Publication is denied. Model changes use the existing audited selection while spending is off; the default returns to DeepSeek afterward.

## Results

**Comparison finished; twenty-video generation remains off.** Sol completed three private recaps and one keyword inventory. All eighteen selected recap claims have support in the saved sources, but independent assistant review requests changes before automatic use. The completed keyword inventory also needs review. MiniMax and Luna did not finish a final recap or keyword inventory. No comparison output was published.

| Model | Recaps completed | Keywords completed | Reported recap cost | Reported keyword cost | New unresolved hold |
| --- | ---: | ---: | ---: | ---: | ---: |
| MiniMax M3.1 Flash | 0/3 | 0/3 | US$0.011107350 | US$0.017829600 | US$0 |
| GPT-6 Luna Pro | 0/3 | 0/3 | US$0.027437605 | US$0.048408970 | US$0.004574875 |
| GPT-6.1 Sol Pro | 3/3, review needed | 1/3, review needed | US$0.624544400 | US$2.731517000 | US$0 |

“Completed” means the full task produced a private final result under the unchanged rules. A failed task is not a score of zero factual accuracy, and a successful model verifier is not independent quality approval. Incomplete final inventories have no final precision/recall score.

### Recaps, per video

| Model | Video | Calls | Reported cost | What happened |
| --- | --- | ---: | ---: | --- |
| MiniMax | Power supply | 7 | US$0.003639900 | A correction duplicated a proposal identity and lost the required original mapping. |
| MiniMax | M4 Macs | 7 | US$0.002461650 | The 8 GB fact exists, but its chosen citation begins after the number. |
| MiniMax | Upscalers | 13 | US$0.005005800 | A correction cut required supporting passage spans. |
| Luna | Power supply | 2 | US$0.001456230 | The correction explicitly said it had not read everything and returned no points. |
| Luna | M4 Macs | 14 | US$0.012444025 | The final correction contained extra text after the JSON object and could not be parsed. |
| Luna | Upscalers | 17 | US$0.013537350 | A reduction added a passage outside its selected parent; the correction repeated that mapping error. |
| Sol | Power supply | 8 | US$0.126341100 | Six supported points. Lead with the negative recommendation and explicitly limit conclusions to the tested sample. |
| Sol | M4 Macs | 14 | US$0.214882800 | Six supported points. Its chosen Apple Intelligence criticism loses the gradual/first-phase rollout caveat. |
| Sol | Upscalers | 19 | US$0.283320500 | Six supported points, but the main spatial/temporal/ML explanation and their tradeoffs are missing. |

The first six stops occurred before final recap completion, without a budget or input-size stop. Citation failures do not establish that the cited factual statement is false. Sol's remaining issues concern selection, scope and important context. The power-supply recap is closest to usable; the upscaler recap needs a stronger revision. No comparison recap was published.

### Keywords, per video

| Model | Video | Calls | Reported cost | What happened |
| --- | --- | ---: | ---: | --- |
| MiniMax | Power supply | 7 | US$0.005600190 | “3.3 volt” selected a span beginning “.3 volt”. Its correction exceeded the common input guard. |
| MiniMax | M4 Macs | 10 | US$0.010915710 | “Mac Mini” selected a 966-character span. Its correction exceeded the guard. |
| MiniMax | Upscalers | 1 | US$0.001313700 | “Video games” selected 1,170 characters. Its correction exceeded the guard. |
| Luna | Power supply | 8 | US$0.014671230 | A host merge retained a longer mention but combined ranges from a shorter variant, causing a timing rejection. Extra model wording also needs repair. |
| Luna | M4 Macs | 5 | US$0.009507300 | One request has no saved complete response; US$0.004574875 remains reserved separately. |
| Luna | Upscalers | 10 | US$0.024230440 | “machine learning” selected a span ending “machine learning-”. Its correction exceeded the guard. |
| Sol | Power supply | 8 | US$0.414633600 | The host kept “Private Internet Access” but attached a range quoting “pia.com”, rejecting the whole inventory. |
| Sol | M4 Macs | 18 | US$1.026815900 | Completed privately: 65 mechanically accepted labels and 49 pending. Important chip names remain pending; generic words and duplicate forms clutter the accepted set. |
| Sol | Upscalers | 22 | US$1.290067500 | The host kept “machine learning-based upscalers” but attached a range quoting “ML-based upscalers”, rejecting the whole inventory. |

No oversized correction above was reserved or charged. The MiniMax correction requests measured 30,859 / 29,493 / 33,329 bytes; Luna's upscaler correction measured 34,641 bytes, exceeding the common 27,700-byte guard. Those stops combine a real grounding error with insufficient correction capacity. They do not prove that every proposed keyword was wrong.

Model confidence is not a truth test: MiniMax assigned 161 zeros, 48 ones and 20 missing scores to its raw proposals; Luna assigned scores of at least 50 to 264 of 272 raw proposals, including some incorrect spans. Final accepted inventories are absent for these two models. The earlier DeepSeek sixty-candidate result contains 48 suitable entries, six category-review entries, two uncertain identities and four unsuitable entries under the frozen assistant rubric. All sixty labels occur literally. Withholding zero-confidence entries did not establish sixty false labels.

Sol's two timing failures reproduce the same host defect as Luna's power-supply result: `mergeCandidates` retains one literal mention while combining cue ranges from different mention variants. The endpoints are real; the model did not invent timestamps. Some affected candidates were already held for alias review, but their mismatched evidence still aborted the whole task. This prevents a final keyword-quality ranking across all three videos. The validation check correctly rejects the inconsistent bundle; the merge must preserve each phrase's own evidence.

Sol's completed Mac inventory contains real source-present terms, including Mac Mini, Apple and Apple Intelligence. All 65 mechanically accepted labels were individually assistant-reviewed: 29 named identities/technologies, 24 useful technical/concrete categories and twelve generic/incidental items needing a usefulness-policy decision. Source presence alone does not make a useful keyword: terms such as Desk/Table and duplicate Video/Videos forms are accepted, while M4/M4 Pro/M4 Max/M2 remain pending because of type disagreements. The complete website identity squarespace.com is missing even though the Squarespace brand is accepted. These are usefulness, category, deduplication and withholding issues, not a precision score or a claim that all 65 labels are fabricated. All labels and pending items are saved privately for review.

## Final accounting and controls

| Model, both tasks | Reservations | Settled responses | Reported settled cost | Unresolved held maximum |
| --- | ---: | ---: | ---: | ---: |
| MiniMax | 45 | 45 | US$0.028936950 | US$0 |
| Luna | 56 | 55 | US$0.075846575 | US$0.004574875 |
| Sol | 89 | 89 | US$3.356061400 | US$0 |
| **New comparison total** | **190** | **189** | **US$3.460844925** | **US$0.004574875** |

New commitment is **US$3.465419800**. Added to the original US$0.069253760 commitment, the evaluation now totals **US$3.534673560**, leaving **US$1.465326440** under the original US$5 ceiling. The whole 255-call ledger comprises US$3.520920494 reported settled and US$0.013753066 held: three unchanged historical holds totaling US$0.009178191 plus Luna's new hold. These are model usage records, not a reconciled invoice or total infrastructure/supplier cost. Unknown actual charges remain null. Largest new reserved call: US$0.093495000; largest reported charge: US$0.074492300. Every call remains below US$0.10.

Spending was stopped first; jobs drained; all eight admissions closed. DeepSeek is restored at selection revision 16. Global/owner daily and cumulative caps remain US$5, with US$0.10/call, both disabled. The production runtime flag is false and exact off-deploy **`6ae0266042a5d8a336ff640a`**, functional **`59324ce495f9eb9aa3761216113297d2e2f601ea`**, published **04:20:19.228 UTC**. Current-deploy metadata and a post-build flag read confirm this configuration. This comparison did not repeat a signed-in hosted UI check; the configuration proof is recorded separately from earlier reader/reload evidence.

### Suggested next decision

Keep twenty-video generation and backfill paused. First fix the demonstrated mention/range merge defect, make citation selection more dependable, and make corrections fit the existing call guard. Then use the saved responses to check those fixes without rebilling, followed by a separately bounded three-video proof if jointly agreed. Improve recap selection to preserve the main conclusion and chosen-topic caveats. Sol is the strongest recap candidate in this small trial, but its higher cost and incomplete editorial coverage do not establish that it is ready for the twenty videos.

## Evidence and status

The keyword source rubric was frozen before these fresh keyword outputs; the recap source rubric was frozen before fresh recap outputs, after the MiniMax/Luna keyword trials and earlier DeepSeek evidence had been seen. These are assistant references, not a wholly blind human standard. Current public provider prices and structured-output support were refreshed; offline request/correction capacity checks passed. The rubric covers evidence, entity eligibility/category, duplicates, omissions and ending coverage. Assistant review is not human approval or an exhaustive human gold standard.

The provider has no completed generation record for Luna's incomplete keyword call, which does not prove a zero charge. Its hold remains reserved. Raw transcripts, private identities, responses, source rubrics and operator proofs stay in ignored private paths. The ignored private `RESULTS-COMPLETE.md` in `.local/model-comparison-20261027/` retains all completed outputs, mechanically accepted/pending keywords and per-video failures.

The final all-six offline replay matches all 190 requests and all four completed outputs, with zero network/provider/database calls and zero verification issues. Missing results stay missing. Native server row-text preservation passes for all 65 old calls, 407 old jobs, three workspaces, 96 old reviews, old admissions/comparison and all 496 archive rows; the twenty frozen source hashes and protected editorial/recovered recaps are exact. Seven new model-selection audit events and eighteen new comparison jobs are accounted for. A private verifier initially omitted Sol recap's deliberately protected US$0.30 keyword reserve; correcting that expectation resolves its sole failure without a database or financial change. The failed verification artifact is retained.

Existing hourly operation continued separately: the final native comparison lists 117 added check records, twelve changed provider-state rows, 39 changed source-state rows and one changed pre-existing supplier-job row. Those operational deltas are not model-comparison results or a newly measured supplier invoice. No archive row changed and no manual supplier launch was part of this comparison.

Implementation release checks: **2,795 local tests / 78 files**, typecheck, production build and catalogue checks pass; [CI 40443945143](https://github.com/raduvlad92/recap/actions/runs/40443945143) passes for functional `59324ce`. Both additive migrations passed actual production rollback, separate absence/readback, apply and 22-group preservation/ACL checks. Migration history is registered; final explicit-project dry-run is up to date. Local tests, CI, deployment, mechanical output completion and semantic quality are separate claims. [Sanitized final evidence](evidence/model-comparison-2026-10-27.json).
