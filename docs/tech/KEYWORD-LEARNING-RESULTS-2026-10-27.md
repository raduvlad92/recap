# Five-video keyword learning — measured results

27 October 2026. **Implemented and tested; useful private results, strict quality gate not passed.** The selected v3 process completes all five saved transcripts, retains **122 of 125 known required named identities** as accepted or review candidates, and averages **9.38/10**. Only **one of five** passes the full frozen good/bad rule. Every one of the **138 accepted label rows** occurs literally in its source; the remaining failures concern name boundaries, review decisions and three absent labels, rather than four lists of fabricated names.

Status: **`best_candidate_bad_strict_gate_not_approved`**. No output was published, no production default changed, and no twenty-video generation or backfill started. The finite evaluation session is closed; production runtime and global/owner spending remain Off.

[Sanitized results and cost evidence](evidence/keyword-learning-results-2026-10-27.json) · [Versioned prompt registry](keyword-learning-prompts-2026-10-27.json) · [Original plan](KEYWORD-LEARNING-PLAN-2026-10-27.md)

## What was implemented

- **A — direct reading:** DeepSeek lists literal names from the complete saved transcript.
- **B — type sweep:** a separate DeepSeek call checks brands, products/models, services, people, named technologies, domains and other explicit proper names.
- **C — pattern mining:** code supplies source-present domains, model codes and possible proper names, with no model charge.
- **One additional checker role:** GPT-6 Luna Pro reads the full saved source and the candidate union, with method/model labels hidden, checks suggestions and searches for omissions.
- **D — section sweep:** tested as a fourth method in v4, then rejected because the combined result worsened on two development cases.

AI returns names instead of calculated word IDs. Code finds literal occurrences and saved cue timings. The union retains discoveries from a single method; agreement is not required to reach checking. Private receipts preserve exact source/request/prompt/model bindings, output, charges and operational errors. All calls use the existing server-side provider adapter; the provider key was not copied into the local runner.

The test runner and versioned prompts retain scored mistakes and proposed improvements. This is a bounded prompt-feedback loop, not model-weight training or an unlimited production process that rewrites itself.

## Five-source comparison

A/B/C are **raw individual method scores before the checker**. The final column scores their checked union. Numeric scores and strict good/bad are separate: the rule requires at least 8/10, complete delivery, no known required omissions/disposition failures, and no unresolved accepted identity claims outside the frozen reference.

| Ordinal / saved video | Current process | A: direct | B: type sweep | C: patterns | Selected v3 + checker | Strict result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 — Vetroo 850W Power Supply - LABS Test Report | No complete output | 7.5 | 7.8 | 4.3 | **9.5** | Bad |
| 2 — Everything Apple Announced last week - M4 Macs | No complete output | 7.2 | 6.6 | 5.4 | **8.9** | Bad |
| 6 — Understanding graphics upscalers like DLSS and FSR | No complete output | 7.1 | 8.3 | 5.6 | **9.5** | Bad |
| 10 — Linus Got Fooled by AI Music | No complete output | 8.7 | 9.0 | 4.7 | **9.7** | **Good** |
| 20 — Everything to know about SteamOS | 4.0 | 8.2 | 8.2 | 6.2 | **9.3** | Bad |

Current-process cases 1/2/6 use exact settled-response replay from the prior failed run, with no new charge. Their completion failures reproduce as incomplete coverage, incomplete coverage and input limit. Cases 10/20 were newly run: 10 stops at an input limit after three paid replies; 20 completes after 21 replies but places all 44 rows into review, with zero accepted-name coverage. Failed deliveries receive no invented semantic score. This is one completed matched baseline comparison, not evidence that five baseline keyword lists scored 4/10.

| Ordinal | Required identities | Retained as accepted/review | Correct expected disposition | Accepted rows / exact source matches |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 10 | 10 | 11 / 11 |
| 2 | 44 | 41 | 38 | 41 / 41 |
| 6 | 34 | 34 | 33 | 42 / 42 |
| 10 | 11 | 11 | 11 | 13 / 13 |
| 20 | 26 | 26 | 25 | 31 / 31 |
| **Total** | **125** | **122** | **117** | **138 / 138** |

Optional generic technical terms are not additional required proper-name identities. A naive count of all candidate IDs would overstate named-identity coverage.

## What still failed

Three required output labels are absent, all in the Apple case:

- **MacBook Air:** the bare family label is missing, while the more specific **M2 MacBook Air** is retained.
- **Mac address:** an ambiguous source phrase was rejected instead of kept for review.
- **bm4:** a noisy literal chip-context spelling was omitted; another M4 occurrence does not satisfy that exact source-spelled identity.

Five required names are present but remain in review when the frozen reference expects acceptance of the literal name: **usba, Clara, Max studio, EXSS and Gabe**. Acceptance would preserve what the text names; it would not justify guessing corrected spelling or a surname.

Five additional accepted prefixes—**LTT, FidelityFX, Snapdragon, PS5 and Steam**—are literal and relevant to longer names, but the frozen policy requires evidence that the parent identity is independently named. These are boundary/reference-audit disagreements, not proof that the model invented those words. They still fail the recorded strict gate. Kind disagreements, such as product versus family or standard versus technology, also reduce scores.

One extra review-only spelling, **SteamOS 3.8**, is not an exact source string; the saved source says **Steam OS 3.8**. The exact source-spelled version is already accepted. No accepted label lacks literal source support.

The separate source-and-result audit left prompts, reference and results unchanged. Its saved evidence hash is `a2e4bc75e0591b215ffadf657fbc6dd0cfa9d7e4ade34da9a43673167f946388`.

## What the improvement rounds taught us

All development scores below use reference v2, uniformly applied to every method/version. Cases 1/2/6 informed revisions; cases 10/20 stayed withheld until selection was frozen.

| Version | Change | Checked development scores: 1 / 2 / 6 | Decision | New calls / actual USD |
| --- | --- | --- | --- | ---: |
| v1 | A/B/C plus original checker | 9.2 / 8.2 / 9.0 | Initial extraction baseline | 9 / $0.012709210 |
| v2 | Model-written general extraction lessons | 8.4 / 8.1 / 9.0 | Rejected: regressed or tied | 10 / $0.014096730 |
| v3 | Reuse v1 extractions; improve checker instructions about wrappers, domains, parent names and noisy spelling | 9.5 / 8.9 / 9.5 | Selected before final validation | 3 / $0.010883975 |
| v4 | Add independent section extraction; keep v3 checker | 9.5 / 8.8 / 8.9 | Rejected: added cost and worse results | 15 / $0.010193246 |

V2 includes one paid prompt-improvement call. V3's held-out validation then adds six calls costing **$0.006937673**; exact development replies are reused without rebilling. After three improvement rounds, the earlier v3 candidate wins. More methods and a longer prompt did not automatically improve quality.

The final five-case mean is **9.38**, worst case **8.9**, with **one strict Good / four strict Bad**. The earlier current-process 4/10 versus proposed-process 8/10 assessments were design judgments; they are not substituted for these measured prompt results. Held-out failures have not been used for another revision. A further tuning round must replace those validation cases.

## Spending and closed controls

The founder increased the cumulative allowance to **$10**, keeping **$5/day** and **$0.10/call**. The finite experiment itself retained a **$1 / 120-call ceiling**. All 67 new calls settled, adding **$0.066610170**, with zero new unknown holds.

| Model | New calls | Actual reported charge |
| --- | ---: | ---: |
| DeepSeek V4.1 Flash | 54 | $0.017389190 |
| GPT-6 Luna Pro | 13 | $0.049220980 |
| **Total** | **67** | **$0.066610170** |

MiniMax and Sol received no new calls in this experiment. This tests the methods and checker combination, not all four models again.

The 24 new baseline calls cost **$0.011789336**; development, optimization and final validation account for the rest. Every charge is counted once, including calls replayed across later versions. The largest new actual call is **$0.005508920**, and the largest reservation is **$0.006460211**.

Final cumulative commitment: **$3.618057920**, consisting of **$3.604304854 settled** plus the unchanged four historical holds totaling **$0.013753066**. Remaining cumulative headroom: **$6.381942080**. The experiment session is closed, global/owner spending and production runtime are Off, and there are zero active AI jobs. No renewed allowance or automatic retry follows.

## Verification and limitations

All **2,892 local tests**, typecheck, build and catalogue checks pass. Final client/runner commit `d48ca9bb944387deec33386ee68f4714670177f9` is pushed with passing [CI 40553826540](https://github.com/raduvlad92/recap/actions/runs/40553826540). Exact production deploy `6ae0e42bdef7821e774e9c33` is ready, matches that commit and was published at **2026-10-27T17:50:06.503Z**. The earlier server release `4688622` also passed [CI 40548728462](https://github.com/raduvlad92/recap/actions/runs/40548728462). These checks establish release correctness, separately from the strict semantic failures above.

Native readback preserves all **300 old calls** exactly, plus **498 source archives, 431 AI jobs, three workspaces and 96 reviews**. Seventeen other native groups match exactly. Four pre-existing collection telemetry groups changed concurrently; they are not represented as frozen or as new collection started by this keyword experiment. All 67 new ledger rows are private evaluation calls with no production job.

Hosted readback after closure returns the exact saved result and cost (HTTP 200); a fresh preflight is refused (HTTP 403), with zero new provider calls. Earlier hosted attempts failed before reservation because build-only `CONTEXT` was unavailable at runtime. Binding the authenticated endpoint to configured HTTPS `APP_URL` fixed this; those blocked attempts cost $0. Repeated compatible checker verdicts were normalized host-side and replayed without rebilling. The initial reference audit was corrected as a new version and applied uniformly, not changed to favor the winner.

References remain **assistant-audited, not exhaustive human gold**. Saved captures are partial/unverified against complete original videos, and these five English technology examples do not establish performance across subjects, languages or platforms. The checker can make mistakes and is not ground truth.

## Reusing the runner

The CLI uses an ignored private config and the existing worker-secret file. The provider key remains on the server. Reporting requires no paid execution:

```sh
npx esbuild scripts/keyword-learning.mts --bundle --platform=node --format=esm --packages=external --outfile=.local/keyword-learning-runner.mjs
node .local/keyword-learning-runner.mjs --config .local/keyword-learning-config.json --phase report
```

The runner supports baseline, development, improve, validate and report phases. Generation additionally requires `--execute`, a freshly reviewed finite released session, immutable source hashes and financial headroom; the closed session from this experiment authorizes no new calls. Preserve old receipts rather than deleting failed attempts to bypass idempotency or holds.

Recommended next: retain v3 privately, resolve parent/family boundaries and conservative noisy-name review decisions, then run a small proof with replacement held-out cases. Decide together before processing the twenty videos or promoting a production prompt.
