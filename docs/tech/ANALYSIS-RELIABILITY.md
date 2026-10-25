# D38 reliable per-video analysis — implementation and release plan

Authorized 25 October 2026: founder requested implementation of all five D37 steps, with parallel work. This includes bounded live quality evaluation and a small monitored backfill on the existing stack. It does not add a daily cross-source briefing, a subscription, unlimited spending or a new model outside the four approved IDs.

## Operating contract

- Preserve US$5/day, US$5 cumulative evaluation and US$0.01/call limits. Existing unknown commitments remain included. DeepSeek is default; no automatic model/provider fallback. No key extraction or additional credential request.
- Start with runtime/global/reader gates off. Apply reviewed migrations only after rollback/preservation checks. Scope the first live run to three smoke videos, then the twenty-video evaluation cohort. The smoke allocation is at most US$0.25 within the same total cap. No next stage before evidence review.
- Keep full originals/media/context, workspace/preferences/bookmarks, prior annotation decisions and all financial rows. Unknown charges and old request identities are never bypassed by a protocol or call-key change.
- Keep legacy output schemas for reader compatibility. Internal unfinished jobs move to content-v2 deliberately; old results/calls remain auditable. An unresolved old source/task charge blocks its replacement.

## Parallel implementation

| Track | Owner | Deliverable |
| --- | --- | --- |
| Grounded engine | delegated engine task | Stable lossless passage references; exact quotes/offsets and real-cue timing; independent exhaustive keyword passes; bounded correction and semantic summary check; bounded hierarchical reduction. |
| Queue and recovery | delegated database task | Service-only content-v2 synchronization/claim/scopes; legacy-charge fences; explicit invalid-output marker before one repair; fair resumable jobs and actual PostgreSQL safety tests. |
| Monitoring and evaluation | delegated operations task | Private read-only queue/cost/health panel; source-free metrics; offline sanitized report and private human-review template. |
| Integration and real proof | parent | Worker/store/adapter contract, complete source/input review, sample selection, guarded live operations, quality review, hosted flow, documentation and release. |

## Interfaces and recovery

Engine exports analyzeSummaryV2/analyzeKeywordsV2 with the existing AnalysisOutput shape. Existing four generation roles remain; v2 keys distinguish source chunks, hierarchical reduction, verification and a single :repair:1 suffix. A repair includes correction:{baseKey,errorCode}; the worker replays/generates and persists the base first, then marks it invalid through the service-only RPC. Only a materialized, explicitly settled base can authorize a repair. Cached actual cost comes from the durable financial row; observed cost is insufficient. Final semantic verification is terminal on any rejection, invalid shape, malformed JSON or truncation; it is never corrected into agreement. Raw failed verdicts and charges remain saved.

Queue interfaces: sync_content_analysis_jobs_v2(user,limit,config_epoch) and claim_content_analysis_job_v2(user,lease_seconds), plus mark_content_analysis_call_invalid and a guarded set_content_analysis_rollout_scope RPC. Explicit rollout phases paused/evaluation/backfill/active and selected update IDs constrain execution. Existing reservation, settlement, prepare/publish and private review contracts retain their safety fences.

## Release gates

1. Local semantic/coverage/correction and worker-cache tests, full required checks, and independent code/security review. Include real disposable PostgreSQL concurrency, source/deletion/admin conflicts, ACLs, original unknown holds, invalid/ambiguous financial states and long resumptions.
2. Actual rollback then guarded apply/readback. Confirm every original archive/workspace/ledger field; changes outside authorized annotations/processing are rejected. Reconfirm pinned endpoint capabilities/pricing, key access, no-BYOK charge reporting and deployed commit without extracting the key.
3. Run three selected real videos within a US$0.25 smoke allowance, still subject to the US$5 cumulative cap. Stop on source-evidence, billing or provider failures. Preserve cached paid work.
4. Expand to twenty representative saved originals: varied duration, dense entity lists, sponsor/outro mentions, partial timing and empty-finding cases. Document original completeness separately from coverage of all saved characters. Review all generated claims and keyword inventories against the full original, including missed entities. Require zero unsupported published claims, exact evidence, real-cue-only links and no duplicate charges for cached successes. Empty/unavailable states must be truthful.
5. Verify actual source/captions → generation → validation → publication → hosted reader → reload, both densities/phone where available, private review, independent output failure, No Shorts and source-change/delete/restart/budget behavior. Release a new small backfill cohort only after the evaluation passes, observe completion/latency/cost, then expand within the same caps.

## Evidence

Raw originals, private cohort identities, outputs and operator SQL stay in ignored .local/analysis-reliability. Sanitized artifacts in docs/tech/evidence distinguish fixture/local PostgreSQL checks, real inference and costs, applied migrations, push/CI/deployment and hosted behavior. Human semantic verdicts stay unreviewed until actually inspected. No overall success or flawless-operation claim follows from valid JSON or passing unit tests.

Implementation and evaluation evidence will be appended as obtained. Current stage: code checks and all scoped release/operator reviews pass; actual guarded migrations are applied with spending still disabled. The full local check passes **2,022 tests / 64 files**, typecheck, build and catalogue. R4 semantic/reporter review passes 222 checks; R5 cache review passes 268, including actual worker/PostgreSQL completion of a 3,200-response repaired job across nineteen continuation turns; R5 caption review passes 200 checks. Counts overlap and must not be added. These are deterministic/local database checks, not actual model quality.

Root operator plans enforce exact old-field preservation across eighteen table groups inside the rollback/apply transaction. Workspace EXCLUSIVE precedes source-state/provider-job DDL locks and archive locking. A three-video smoke scope is serialized against policy/scope changes; no other reader policy or rollout scope is allowed. Daily allowance stays US$5, and the first smoke temporarily lowers total headroom to existing US$0.018365907 commitment plus US$0.25. Stop spending before pausing scope, retain in-flight receipts, verify worker drain, then restore the US$5 evaluation total. Explicit comparisons stop on failed preservation; a successful readback command alone is insufficient.

Twenty saved videos across fifteen sources are selected privately; three form the initial smoke cohort. Both migrations are applied: actual rollback, committed preservation assertions and a separate exact eighteen-group readback pass. Their history was registered only after the readback and a dry-run reports no pending migrations. The CLI initially returned only the last of two readback results; the comparator stopped, the readback was combined into one result and passed before history registration. Security advisors report zero WARN/ERROR and seventeen INFO notes for intentionally private tables. No D38 model call has occurred; spending gates are off and rollout scopes empty while deployment is prepared. [Source-free evidence](evidence/analysis-reliability.json) keeps live results separate from local checks.
