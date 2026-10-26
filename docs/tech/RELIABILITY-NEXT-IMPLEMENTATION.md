# Useful recap recovery, correction reliability and publication proof

Research and implementation plan, **26 October 2026**. Status: **planned, not implemented or activated**. Implements the founder's requested planning for handoff points 1–3. The [previous handoff](SESSION-HANDOFF-2026-10-26.md) remains the historical release record. Small backfill, recurring AI activation and the daily cross-source briefing are outside this task.

## Recommendation and current evidence

Recover the one promising saved recap through one tightly bounded final verification. Separately introduce a new generation contract for accountable wording corrections and source-derived keyword mentions. Prove useful publication and a fresh cloud reload before evaluating the frozen twenty-video sample.

The current adapter already requests strict JSON Schema, requires supported parameters, pins its provider and disables fallback. Adding those settings again will not fix the observed failures. Retain the whole-message parser and semantic checks.

| Finding | Evidence and consequence |
| --- | --- |
| Two misleading source-conflict errors came from a forbidden verifier-repair cache key | Already fixed in `1d4636e`; saved worker/store/PostgreSQL replay is documented. Do not repeat that repair or reinterpret it as actual source drift. |
| One four-point saved recap provisionally passes independent assistant source inspection | Only its final verifier is missing. The other candidate remains withheld for a qualifier and uncertain measurement. Neither has human approval or full-original coverage proof. |
| Summary correction freezes exact sentence text | `content-analysis-grounded-v3.ts:84–101` preserves text by index. A same-count rewrite can therefore fail legitimately. A new contract must preserve finding identity without requiring identical wording. |
| Keyword rejections include real unsupported mentions, wrong evidence spans and incomplete coverage | Exact saved replay reproduces them. Both two-chunk keyword jobs stopped before later chunks and the blind checker; a successful first chunk would not prove completeness. |
| Two malformed responses contain multiple complete JSON envelopes plus extra text | They ended normally, rather than reaching the token limit. Selecting the first envelope would conceal invalid output. |
| Publication, polling and independent output states exist | Missing evidence is useful accepted model output travelling through these paths and surviving fresh cloud loading. A frontend redesign is not presently indicated. |
| Frozen sample: 20 videos, 15 sources, 18 partial and two unverified captures | Zero verified full-original captures and zero genuine whole-task empty examples. One item already has editorial output and must remain a protected baseline. |

Private evidence inspected: `.local/analysis-reliability/post-luna-recovery-plan-r1.md`, `CONTINUATION-V3.md`, `luna-output-error-r1/README.md`, `luna-source-error-r1/REPORT.md`, `luna-summary-review-parent-r1/REVIEW.md`, `twenty-readiness-r1.md`, its companion JSON and `post-smoke-rollout-plan.md`. Private source ordinals differ between reports: select recovery by exact source hash/job/call identity, never by “source 1.” Original text, private identities and raw calls stay ignored.

### Safety and cost checkpoint

The last successful hosted safety check remains **26 October, approximately 01:43–01:44 UTC**. This session attempted read-only Supabase project/aggregate access; both connected accounts rejected project reads and the aggregate SQL read was denied with `You do not have permission to perform this action`. No database change occurred. The installed CLI has no `db query` subcommand. Credentials were not extracted and no authentication/setup flow was started. Live runtime, ledger, sources and scopes have **not** been refreshed here.

Historical checkpoint: runtime/global/reader analysis spending off; zero running/prepared jobs; scope paused; comparison closed; DeepSeek default. Forty-six calls comprised US$0.041366384 settled plus three historical holds totalling US$0.009178191: **US$0.050544575 committed**. Existing caps are US$5/day, US$5 cumulative evaluation and US$0.01/call. Original shared smoke ceiling: **US$0.268365907**, leaving US$0.217821332 at that checkpoint. These are existing ceilings, not new allocations. This research started no model inference, supplier job, caption recovery, migration or activation; additional metered execution cost is zero. Hosting/database totals are unmeasured.

## Work package A — finalize one saved useful recap

Use unchanged H3 (`content-v3`) and exactly one selected four-point candidate. The original comparison remains consumed/closed. A failed terminal job cannot be reset to queued.

1. Add a service-only, single-use **summary-finalization admission** and an immutable successor job whose predecessor is the failed comparison job. It is a separate purpose, not a new comparison or general retry button. Enforce one finalization admission for this selected predecessor; changing an idempotency key cannot renew it.
2. Seal owner/update/source identities, complete content/cue fingerprint, H3 hash, old annotation/admin-decision digests, independent assistant-review digest, current selection revision/epoch and exact execution profile/limits. Bind each settled prefix call by original ID plus request/result/execution hashes.
3. Read the existing paid prefix through guarded reference associations. Never copy financial rows, change their job IDs, assign their costs to a new job, edit saved outputs or regenerate a missing prefix. Prefix reads require current source/lease/owner/admission/profile checks.
4. Replay H3 in the real worker. Every old request must reproduce its sealed hash. Permit only the exact missing `summary:v3:verify:0` request/hash as fresh work, through independent worker and SQL guards. Cache misses for every other key stop before reservation/provider access.
5. Permit **at most one new provider attempt, costing at most US$0.01**. Even an authenticated zero-charge rejection does not grant a second attempt for this admission. Negative, refused, malformed, truncated, missing/duplicate-ID or recognizably negative mixed-shape verdicts are terminal; there is no verifier repair.
6. A saved final response may replay after an interrupted worker without another provider call. An ambiguous attempt retains its hold and cannot be retried. If the positive response is valid and settled, use existing prepare/publish grounding checks and verify useful output through package C.
7. Stop spending, drain, close the admission, pause its scope and restore DeepSeek/default caps. Record outcome and preservation even if no publication succeeds. No keyword task is admitted by this finalizer.

The cached prefix was generated with the Luna/OpenAI execution profile. Reusing it with DeepSeek would fail identity checks. Select that same approved Luna profile under off gates for this one admission, then restore DeepSeek. A new selection revision is permitted only if effective request identity remains exact: selection revision is outside `analysisExecutionIdentity`, but must be sealed independently in the new admission. Never rewrite a historical settings revision. If current endpoint terms, prices or effective limits no longer reproduce the prefix, withhold recovery instead of changing H3 or silently falling back.

At the historical commitment, a full US$0.01 reservation would bring commitment to at most US$0.060544575 and leave US$0.207821332 under the original smoke ceiling. Recompute from live state before admission. Do not treat either number as a fresh authorization.

### Recovery implementation touchpoints

All SQL changes belong in a **new additive migration**; applied migrations are reference material only.

| Touchpoint | Required change |
| --- | --- |
| `netlify/functions/_shared/content-analysis.ts:14–16,127–225` | Typed admission context, guarded prefix references, same-profile/hash replay and single fresh-key allowlist; check prepared results too. |
| `createAnalysisStore` in `content-analysis.ts:40–60` | Replace the blanket PT409 → source-changed diagnosis with safe typed conflict reasons. Unknown conflicts remain blocked; do not parse/expose raw database error text or automatically retry. |
| `20261025220548_content_analysis_model_comparison.sql:40–49,342–472,746–805` | Extend logical uniqueness, slot/manifest/scope resolution and insertion protection for the new purpose. Preserve the unique predecessor fence; do not spoof `generation_comparison_id`. |
| `20261025195400_content_analysis_generation_v3.sql:616–667` | Add narrowly authorized settled-prefix reads; current cache is same-job only. Keep pagination, current-source checks and financial ownership. |
| `20261025220548_content_analysis_model_comparison.sql:930–1084` | Enforce one exact fresh verifier and one attempt under existing lock order at reservation, call-attempt, result, prepare and publication boundaries. |
| New admission/reference tables and deletion handling | Deny public/ordinary-reader reads and mutation. Source/workspace deletion removes private payloads while preserving lawful minimal financial holds/tombstones; no recreated job can reset spend. |
| Existing worker/store and local PostgreSQL suites | Add dedicated finalization suites using actual worker/store plus a disposable database, with no network generation. |

Keep `content-analysis-grounded-v3.ts`, its H3 prompts/schemas and old request hashes unchanged. The new admission adds execution authority; it does not turn an old failure into success.

## Work package B — a distinct correction and keyword contract

Proposed name: **`content-v4`**, with its own descriptor/hash, namespaces, immutable predecessors and admission manifest. Preserve v1/v2/v3 and all paid records. Do not replay H3 responses as v4 or change a hash to bypass an unknown charge. DeepSeek remains the default for new evaluation; no automatic model/provider fallback.

### Accountable recap wording corrections

- For an initially parseable inventory, trusted code assigns stable proposal IDs and stores each original text/evidence digest. Correction records carry parent ID, original response hash and a bounded reason.
- Permit supported narrowing/wording changes while retaining every original ID. Missing, duplicate or substituted proposals fail. Changed wording must still describe the same source finding, with correct subject, relation, scope, attribution, uncertainty, values and units.
- Extend terminal verification to test both complete source support and finding continuity against the original proposal. Keep deterministic numeric/unit/negation/evidence checks. A same-count unrelated replacement must fail.
- A proposal that cannot be grounded remains unresolved in the private audit; the initial strict contract does not publish around it. Do not guess intended measurement units or silently discard a rejected qualifier/claim to clear the queue.
- For wholly malformed output, retain the complete opaque response and raw-parent lineage. Do not parse fragments to invent IDs or a proposal count. One financially settled structural correction may produce the first valid inventory; normal final verification still applies.
- Retain one known-settled correction maximum. Unknown costs, network failure and final semantic verdicts never authorize correction. Raw negative verifier evidence stays terminal.

### Source-derived keyword evidence

Build a versioned lossless lexical-unit map with exact original UTF-16 offsets. The model selects first/last unit IDs within the supplied chunk; trusted code reconstructs the exact contiguous source slice. Preserve casing, punctuation and separators. Validate whole-identity boundaries, order, the existing 100-character mention bound, and C/C++/C# distinctions. A missing, reversed, out-of-chunk or split-identity range fails.

Canonical display label and literal evidence remain separate. Unsupported aliases, label/type disagreement and below-50/unknown confidence retain private review. Confidence is an uncalibrated review judgment. Derive all times from actual saved cues; gaps keep untimed links and honest coverage. A mention alone does not establish sponsorship.

Keep two blind full-content inventories, every saved suffix and explicit completeness acknowledgements. Neither inventory sees the other's answers. Their agreement reduces omissions but is not proof of exhaustive recall. Reconcile all candidates and retain prior source-hash-scoped admin approvals, corrections and rejections. Unsupported evidence or incomplete coverage still blocks preparation; existing grounded agreed labels/private disputed-label behavior stays intact.

Token maps, schemas, proposal lineage, blind checks, reductions, verifiers and eligible corrections all enter capacity and financial preflight. Split losslessly before execution when necessary. Do not use top-N truncation or silently drop sponsor/outro names to fit output. A chunk acknowledgement does not establish all-source or semantic completeness.

### Format diagnostics and implementation surfaces

Keep whole-message parsing. Preserve raw response, finish reason, settlement, execution identity and materialization marker. Report invalid JSON/capacity/refusal as the primary format reason, with domain diagnostics separately; current corrected-output validation can mask the saved invalid-JSON marker as generic invalid output. Response healing and first-JSON extraction stay disabled.

Create `content-analysis-grounded-v4.ts`, `content-analysis-grounded-v4-protocol.ts` and a tested source-reference module. Integrate dispatch/admission/cache and the inline `createAnalysisStore` in `content-analysis.ts`; preserve output compatibility through `src/lib/content-processing.ts`. Extend the new SQL migration's rule-version, immutable predecessor, source/deletion, unknown-charge, result-validation and reserve/publish fences deliberately. Extend `scripts/analysis-quality-report.mjs` to report v4 lineage, replayed versus fresh calls, both output tasks and semantic review provenance. No new service or frontend redesign is required by the present evidence.

## Work package C — publication, reload and twenty-video evaluation

### Publication acceptance

First add one integrated deterministic scenario: actual disposable-PostgreSQL prepare/publish → authenticated owner archive read → production sanitizer/read model → rendered card/details. Exercise both task-completion orders. Existing tests cover portions separately, rather than a useful hosted result across the entire path.

For actually accepted bounded live results, capture exact deployed commit, source/job/result hashes, settlement and before/after annotations. Verify:

1. Useful recap appears independently of failed/pending keyword processing; accepted keywords remain independent of failed recap processing. Private candidates and evidence never enter reader/catalogue responses.
2. Original/transcript access, actual cue links, partial/unverified coverage, source changes and true reviewed-empty versus missing/failed states stay honest.
3. Visible-tab polling updates the card; browser reload and a fresh cloud archive load after discarding local cached history retain accepted text/keywords. Polling/reload produce **zero additional model calls**.
4. Compact/Regular on desktop and 320px show the same accepted content, with correct details and no overflow. Preserve saved follows/bookmarks/settings, No Shorts and separate unknown-format inspection. Anonymous/ordinary-reader access checks protect private admin records.
5. Prior admin label/type decisions survive processing and a reload. Exercise approve/reject/correction with disposable fixtures, remove them and preserve real pending decisions. A real source change makes stale output unavailable; interruption after publication cannot charge or publish twice.

Use `src/lib/workspace.ts:431–480`, `src/lib/processing-refresh.ts`, `src/lib/content-processing.ts:69–97`, `src/components/YouTubeCard.tsx:26–50`, `src/App.tsx:315–318` and `content-analysis.ts:296–323` as existing interfaces. Add meaningful integration checks; change reader code only for a demonstrated defect.

### Small revised-contract quality gate

One accepted H3 recap proves that finalization path, not v4 keyword reliability. The old unimplemented rollout proposal requires the original three-video/six-task smoke to pass, and all six old tasks failed. It cannot be satisfied retroactively.

Prepare an explicit **v4 successor-quality manifest** for three frozen-cohort videos with no currently ready output, six independent tasks. Prefer the two other original failed smoke videos plus one dense/long candidate, subject to current annotation and budget checks. Ensure sponsor/outro names, measurement uncertainty and full saved tails are represented. Protect the recovered H3 recap and historical editorial baseline. If those identities cannot satisfy coverage or fit the conservative budget, retain the gate as pending; do not silently lower it.

This is a proposed replacement acceptance gate for the new contract, not a modification of the closed comparison/original manifest. Require useful accepted results for all six tasks, independent source/omission review, and at least one actual accepted recap and keyword publication/reload through the hosted reader before expansion. Record every failed attempt under its real contract. Keep this pre-expansion work inside the original shared smoke ceiling. An explicit reviewed successor admission is required; no terminal reset or automatic fallback is allowed.

Replay all six historical failure paths as offline regressions and include actual output-failure cases, not only the repaired cache-window defect. Freeze the new identities and expected findings/entities before seeing generation; never swap a difficult case after failure. Carry every original failed video into the twenty assessments with exact task lineage. Changing both cohort and contract prevents a clean causal before/after comparison; report that limitation instead of attributing every improvement solely to v4.

### Frozen twenty-video evaluation

Keep the existing twenty IDs and private source hashes. Report **20 assessments, at most 19 newly generated video results**, with actual fresh/reused task counts. Sample 4 already has six editorial highlights and ten keywords; preserve both outputs/reviews and assess it as a historical baseline. A blocked processing override allowed it into the old selector. Fix eligibility to examine valid current annotations as well as processing overrides; do not regenerate it to manufacture twenty new successes.

Admission must distinguish a successor of an actual failed task from first analysis of an untouched task. Preserve real predecessor links and use a separate reviewed first-analysis purpose where needed; never invent v3 predecessor jobs to satisfy a schema. Any valid output accepted during the preceding proof remains protected and is counted as reuse/baseline in later batches.

| Dimension | Existing sample and required treatment |
| --- | --- |
| Short/long saved text | Six short-text / three long-text cases; “short” is not YouTube Shorts. Keep the difficult cases. |
| Dense names / sponsor / outro tags | Four / thirteen / seven heuristic tags. Inspect all endings and explicit disclosure evidence; tags are not ground truth. |
| Timing | Nineteen partial-timing tags; one no-cue baseline and one start-only cue case. Never invent durations or seek times. |
| Original completeness | Eighteen declared partial / two unverified, zero verified complete. Report saved-text processing separately from whole-original capture. |
| Genuine empty | Zero whole-task examples. Add deterministic true-empty fixtures now. A separately documented live supplementary case is needed before claiming real empty-case coverage; do not replace a frozen item or infer emptiness from narrow category absences. |
| Historical output | One protected editorial baseline. Previously accepted smoke/finalization outputs remain protected; count reuse honestly. |

Before model output is seen, freeze independent expected findings, entity occurrences/types, explicit sponsor wording, endings, measurement/uncertainty cases and cue references. Keep reviewer type `assistant` distinct from an actual human verdict. Existing assistant references are evidence to inspect, not automatic human gold or calibrated recall. Evaluate both false claims and missed findings/entities, not just validity of what survived.

Run at most three eligible videos per released batch; inspect output, completion, real elapsed latency and costs before the next. Resume settled cached work without charging again. Recompute plans for v4: old v3's 804 maximum calls across all twenty include 329 for the protected baseline and are **not** v4 reservations or an affordability claim.

Acceptance requires zero unsupported published claims; exact literal evidence and real-cue-only links; useful recap findings with no unresolved critical factual omission; all independently evidenced qualifying names, including sponsor/outro mentions, accounted for as accepted or explicit private review; truthful empty/partial/missing states; and preserved annotations/admin decisions/holds. Report per-video/task failures and reasons. Do not hide an important failure behind an aggregate score. Missing full-original and real-empty evidence remain explicit gaps even if saved-text quality passes. Supplier recovery is a separate activity within unchanged supplier limits, never an implied action from an AI evaluation manifest.

## Delivery order and release gates

| Order | Deliverable | Exit evidence |
| --- | --- | --- |
| R0 | Fresh read-only safety/cohort capture and sanitized baseline | Actual off/drained runtime, budget/holds, settings, source/cue/annotation/admin hashes and current deployment; current connector permission issue resolved through existing authorized access. Historical snapshots never authorize activation. |
| R1 | Offline one-summary finalization + additive schema | Exact saved-prefix replay reaches only one missing verifier; fresh-call traps; source/admin/privacy/budget/concurrency tests; independent review. |
| R2 | Offline v4 engine + queue integration | Corrected same-finding succeeds; unrelated replacement fails; source-derived mentions, blind full-tail checks and lossless continuation pass; new contract is sealed. R1 and engine work can proceed in parallel with separate code ownership; SQL integration stays sequential. |
| R3 | Publication integration + scoped admissions | Actual local PostgreSQL→reader integration passes; protected baseline and historical evidence preserved; bounded v4 smoke/evaluation manifests reviewed. |
| R4 | Guarded application and off deployment | Rollback, external absence/preservation checks, fresh baseline, single apply, separate complete native readback, migration history and exact off deployment verified. Never rerun old applied migrations. |
| R5 | One-verifier useful recovery, then small v4 proof | One actual finalization attempt maximum; stop/drain/close/restore; six useful revised-contract task outcomes and hosted accepted recap+keyword reload proof. Failure stops expansion. |
| R6 | Twenty assessments in reviewed batches | Source-bound independent review, useful/omission outcomes, preservation, actual settled/held spend and latency; complete-original/genuine-empty gaps reported honestly. Stop and hand off here; no backfill. |

Offline R1–R3 development, private replay and disposable-database checks can proceed while live access is unavailable. R0 is mandatory before live database application or activation, not a dependency that blocks offline engineering. Refresh it again before each metered release; concrete live manifests cannot be finalized from historical snapshots alone.

For each new batch, conservative maximum additional commitment must fit **all** remaining limits: admission/batch ceiling, global and owner daily ceilings, US$5 cumulative evaluation ceiling, US$0.01 per call, and the original shared smoke ceiling wherever applicable. Count settled costs plus unresolved maximum holds exactly once. Include every base, reduction, blind checker, verifier and eligible single correction, using uncached input bounds and current pricing/cache-write terms. No guessed cache discount. Refuse a batch that cannot fit; do not raise caps, shrink the frozen sample or weaken evidence to clear the gate. After explicit v4 quality acceptance, twenty-cohort batches can use only the remaining existing US$5 total, not US$5 more. That expansion admission is new implementation, not an already available capability.

Required targeted regressions include: missing/altered prefix; old-closed comparison; wrong owner/profile/revision/hash; parallel claim/reservation and single-attempt races; pause/delete/source/admin edits during work; unknown-charge tombstones; negative/malformed final verdicts; same-count unrelated replacement; duplicate/lost proposal IDs; multiple JSON envelopes and precise error reporting; Unicode/C/C++/C# and out-of-chunk mention ranges; sponsor/final-word names; true empty versus omitted findings; capacity stops; resume after thousands of saved responses; independent output order; cloud-refresh/account-switch races; and baseline/admin preservation. Test direct ACL bypasses and real multi-session PostgreSQL races, not only mocked RPC results.

Run focused meaningful tests, then `npm run check` with disposable PostgreSQL suites available and `git diff --check`. Record local tests, CI skips/passes, push, exact deployment, live inference quality and hosted browser proof separately. Publication/reload checks are later execution work. No fresh model-quality or test-suite pass is claimed by this research document.

## Primary-source research

Public OpenRouter documentation and unauthenticated endpoint metadata were rechecked on 26 October; no inference request was made. A [source-free research record](evidence/reliability-research-2026-10-26.json) records exact endpoint bindings and limits of this session's evidence.

- [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs): support is endpoint-specific; strict schema behavior varies. Keep `require_parameters` and local validation. Schema compliance cannot establish truthful evidence or completeness.
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection): pin the qualified endpoint and disable fallback; provider order alone can permit fallback. Existing code already applies these controls.
- [Response healing](https://openrouter.ai/docs/guides/features/plugins/response-healing): middleware can extract JSON from surrounding text and does not fix token-truncated output. **Design inference:** exclude it here because whole-message rejection and unmodified failed evidence are part of the audit contract.
- [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting): returned usage and generation-ID metadata support cost accounting. An unavailable/404 receipt does not prove a free attempt; retain existing holds and require authenticated financial evidence.
- [DeepSeek endpoint metadata](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints): exact `relace` advertises structured output and current US$0.07 input / US$0.50 output per million tokens, matching the local profile.
- [Luna endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-pro/endpoints): exact normal `openai` endpoint advertises structured output and US$0.10 input / US$0.50 output per million below its long-input threshold, matching the local profile. Other endpoint variants are not substitutes for the sealed execution identity.

These are public capabilities/prices, not current authenticated access, actual charging, our inference reliability or useful-output proof. Refresh the exact profile before later activation. No new founder product decision or credential setup is required for the offline work described here; this request itself remains research/planning.
