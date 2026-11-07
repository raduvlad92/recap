# Offline guarded reader migration plans

Prepared against `docs/delivery-operations-20261107` at `3c80dbe8924421ca386796be0cc4844edb04de3b`. This increment contains a pure SQL builder, pinned source fixtures, disposable tests and this handoff. It does not change application code, active migrations, workflows, production, main, current operations or the shared status/decision logs.

The [recovery handoff](RECOVERY-EXECUTION-2026-11-07.md) remains authoritative for completed native core recovery, release `182457410f7f8e979348d10347fe50b1e94b295b`, the separate fee correction and original delivery restoration. Do not repeat those writes. No native reader migration, deletion, alias linkage, provider/model/Clerk call, runtime flag change, key switch, retention expiry or cost-cap change occurred here. No provider/model spend was incurred by this work; local/GitHub infrastructure cost is not measured.

## Inputs and fixed scope

[The builder](../../scripts/reader-migration-plan.mjs) imports only Node assertion/crypto facilities and static SQL/contracts. It reads no files, environment, credentials or network and has no SQL execution, retry, repair or CLI entry point. The test harness separately starts its own private Unix-socket-only PostgreSQL cluster; it never connects to an existing server.

[Source pins](../../scripts/reader-migration-pins.mjs) include every one of the **53 core migration files** from `1824574`, with complete source SHA-256 values. The four reader files are copied verbatim under [test fixtures](../../tests/fixtures/reader-release); they are not installed in `supabase/migrations` by this PR. Source access used read-only `git show` from the supplied commits, without changing either supplied reader checkout.

Apply all four in this order, in **one atomic transaction** after the exact 53-version core chain:

| Migration | Exact source commit | Source SHA-256 | Body SHA-256 |
| --- | --- | --- | --- |
| `20261107203128_account_lifecycle.sql` | `590690511c2317271b3888a51e049c9556b71423` | `22de15e2d5de83707d0fb48d936ed9cb713470e282c200069ac6ceb267216658` | `5ac87e3d6dacb27b3becbc000cab3364f713cbcf1d9176f88c855022e12b417a` |
| `20261107204220_public_original_content_extraction.sql` | `7bb597a3d2a21ce9884bd621dba05eed370c26ce` | `50aab6c68767d3e9d1ab00fc06e9e2cecfe252d70d9db748aca2b2af257da9a3` | `6bc86a90b72e42b3efe484350f9db3561d96d4b23f614dd052c9836d9330ca96` |
| `20261107205636_stable_reader_ownership.sql` | `590690511c2317271b3888a51e049c9556b71423` | `a4e31d84de0b822c76bc0c030224b4f85c2b0d3bd081b42f2656857117cfc4e7` | `c3ababf1e29e234e9883330db9b66d551bb77d03937205178c8c05bab1647fbd` |
| `20261107224727_account_deletion_identity_flow.sql` | `590690511c2317271b3888a51e049c9556b71423` | `8ff319b91c9269a1c14ca6567502f166c010d12fef04c7cfb294c6c2e8599143` | `ed6b4b4381bc0970982b9cf18daa7f899366656e4c9d46d8b324858e307bb90a` |

The final PR17 commit includes the PR19 identity foundation. Only each known outer `BEGIN`/`COMMIT` wrapper is removed. Both the complete source and the resulting body must match their fixed hashes; even whitespace or line-ending edits are rejected. The builder returns SHA-256 of the complete generated transaction, the contract digest, source/body pins and parent gates. Save the actual SQL bytes and that hash in the parent's private durable operation intent before dispatch.

`buildReaderMigrationCapture()` returns bounded SQL ending in `ROLLBACK`, with temporary helpers and only three output digests: all managed objects/identities, all managed rows, and full migration-history rows. It takes the same ordered table/advisory locks as a plan. This is a capture mechanism, not approval of an unfamiliar baseline. The parent must compare native state with its accepted preservation evidence before supplying those digests as the approved baseline. Historical core statement-array layout is preserved exactly; it is not rewritten to resemble the offline fixture. Exact core version/name inventory and nonempty statement arrays are also required.

`buildReaderMigrationPlan({mode, operationId, expectedHosting, baseline, runtimeFlags, sources})` accepts only those fields. `sources` is the ordered four-element array of exact SQL strings. It requires an explicit durable-operation UUID, Cloudflare ownership, accepted core release `1824574`, exact positive epoch/pause revision, pause and old-host fence, zero queued/running/expired-running frames, and explicit false declarations for both `ACCOUNT_LIFECYCLE_ENABLED` and `ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED`. Retained uncertain frames and unknown financial holds are preserved, not drained or reclassified. Running automatic domain tasks independently block execution.

The SQL requires PostgreSQL 17 and read committed isolation, fixes UTC/date formatting, uses the existing migration advisory-lock identity, locks history and every managed table in stable order, and bounds lock/statement/idle times to 2/30/30 seconds, catalogue objects to 20,000, managed rows to 1,000,000, and generated SQL to under 1 MB. Native stop/quiet/drain evidence cannot be inferred from these database locks or counters.

## Explicit reviewed changes

[The fixed contract](../../scripts/reader-migration-contract.mjs) records **394 individual logical-object transitions: 23 existing replacements and 371 additions**. It was derived by applying the complete actual core chain followed by the exact reader files on disposable PostgreSQL 17, then inspecting the complete resulting catalogue and sources. Nothing exempts an entire schema, table, policy family or function family from comparison. The managed core object-name digest covers **2,631** individual objects, including implicit row/array types and internal foreign-key triggers. Native object OIDs are separately preserved; only the two explicitly recreated constraints may receive new identities.

The existing replacements are exactly:

- `public.hosting_work.hosting_work_kind_check`: add the gated `account-lifecycle` kind; preserve every hosting row and all other metadata.
- `public.collection_retrieval_attempts.collection_retrieval_attempts_item_key_check`: add `original:<64 lowercase hex>`; retain both existing YouTube forms and all attempts.
- Nine function definitions: `social_job_identity_guard()`, `record_recap_reminder_event(text,jsonb)`, `record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text)`, `merge_hourly_video_enrichment(jsonb,jsonb)`, `content_analysis_source_revision(jsonb)`, `social_content_eligible(jsonb,jsonb)`, `clear_reader_workspace(timestamptz,jsonb)`, `recap_internal.lock_own_hourly_policy()`, and `recap_internal.reset_own_daily_briefings()`. These add tombstone consumer/reference/settlement handling, bounded original-content eligibility/enrichment/revision behavior, and resolved-owner lookup while retaining the evolved clear lock order. Each entire resulting definition must match its reviewed hash; original function identity, signature, ACL and other attributes remain exact.
- Eleven existing ownership policies: the four `reader_workspace_*` policies; `reader_source_updates_own_select/delete`; `reader_collection_checks_own_select`; `reader_collection_policies_own_select`; `collection_jobs_own`; `collection_consumers_own`; and `daily_briefings_own_read`. Replace only direct JWT-subject ownership with the reviewed stable-owner resolver, retaining commands, roles, permissiveness and other predicates.
- Existing `recap_internal` schema ACL: reviewed service-role usage grant, with authenticated usage retained and public/anonymous access revoked as specified. The complete before/after ACLs must match the fixed contract; unexpected native ACLs stop the plan rather than being normalized.

The additions are exactly the objects enumerated in the contract and pinned sources:

- Nullable `reader_content_analysis_calls.erased_job_id` and its column comment. Every existing call must keep this field null. Every original column value is preserved; a digest of a whole call row that now includes the new null field naturally differs from its old shape. Preserve the original-column projection, not a fabricated hash equality across different schemas.
- Ten RLS-enabled private tables: `account_deletions`, `account_deletion_retention_proofs`, `account_deletion_external_work`, `account_deletion_external_receipts`, `account_deletion_identities`, `account_deletion_identity_steps`, `reader_identity_settings`, `reader_identity_issuers`, `reader_identity_aliases`, `reader_identity_events`, all in `recap_internal`. All must be empty except the single settings row `(singleton=true, mode='legacy', lifecycle_ready=false)`.
- Thirty-nine new functions across public wrappers and private lifecycle/identity/fence helpers. The contract binds each compiled definition, owner, exact execution ACL, definer/invoker mode, search path, argument/default/security metadata and comments. The four identity tables have service-role SELECT only; lifecycle tables have no ordinary/service direct grants. Privileged RPCs are service-only; the authenticated own-owner wrappers and private own-account predicate have only their reviewed grants. Trigger-only helpers are not exposed as reader RPCs.
- Thirty-five restrictive `account_access_fence` policies on the explicit table inventory in the lifecycle source, and corresponding `zz_account_write_fence` triggers. Other explicit triggers handle social consumers/items, hosting payloads, audit details, pending originals, and immutable deletion custody. There are 48 new explicit triggers plus 24 internal FK triggers. The contract separately pins all constraints, 13 indexes, 20 implicit row/array types, relation/column metadata and associated additions.

Every pre-existing public/`recap_internal` row is hashed with multiplicity under the locks. Original rows include all financials, unknown holds, policies/caps, workspaces, archives, task/provider/domain identities, cursors, transport records and unrelated audit data. Metadata comparison includes managed relations/views/sequences/rules, columns/defaults/comments/ACLs, constraints/indexes/triggers, all routine metadata and bodies, policies, schemas/types, the migration-history schema, and every default-privilege record. Planner/vacuum statistics are excluded. Platform schemas outside `public`, `recap_internal` and `supabase_migrations` are not migration targets or a claim of this catalogue snapshot.

## Modes, refusal and reconciliation

Rehearsal executes all four bodies and the full postconditions, then **ROLLBACK**. It inserts no history and sends no schema reload. Apply executes the same bodies, inserts precisely four history rows containing the exact bodies, verifies original rows/metadata/history plus the new history bytes, then queues **`NOTIFY pgrst,'reload schema'` and COMMIT**. History-trigger side effects are inside the preservation boundary. Temporary helpers are explicitly dropped; temporary comparison tables drop at commit.

Initial rollout only: reader tables/functions/policies/columns/history must not already exist, even empty. Any partial install, pre-existing tombstone/identity rows, unexpected managed object, stale baseline/control, changed reviewed prerequisite, missing history or already-complete apply refuses. There is no automatic repair, subset apply, continuation or idempotent retry path. Following a lost/ambiguous reply, keep the same parent operation identity and saved transaction hash, obtain read-only native row/schema/history evidence and reconcile outside this builder. Do not regenerate a fresh baseline merely to make a refusal pass.

## Disposable evidence and running the tests

[The test suite](../../tests/reader-migration-plan.node.mjs) passes **101/101, zero failures/skips**, on **Node 22.23.2 / PostgreSQL 17.11**, about 56 seconds. [Durable result and pins](evidence/reader-migration-plan-2026-11-08.json). The cluster is initialized per run, cloned from the complete 53-migration template, bound only to a fresh private Unix socket with TCP disabled, and removed afterward. Environment is restricted; password/service-file paths point into that disposable directory. PostgreSQL/Node prerequisites fail the suite rather than silently skipping it.

Run with Node 22 on PATH:

```sh
READER_TEST_PG_BIN=/opt/homebrew/opt/postgresql@17/bin node --test tests/reader-migration-plan.node.mjs
# Linux PG17 installation:
READER_TEST_PG_BIN=/usr/lib/postgresql/17/bin node --test tests/reader-migration-plan.node.mjs
```

Coverage includes the complete actual SQL chain, digest-only capture, rollback/apply/history/body hashes and committed notification, preservation with existing column/default grants, 19 synthetic unknown source holds plus a separate corrected fee receipt, seven synthetic unknown model rows, three workspaces/archives, real legacy-owner reads/writes and cross-owner denial, actual ACL/RLS denial, flags-off tombstone fences, source/metadata/control/history drift, fresh-baseline schema mismatches, partial/history-only installs, retry refusal, history-trigger side effects, many injected row/security/schema faults and a two-session writer/lock conflict. The only tombstone exercised is a disposable synthetic request; no erasure worker, native identity deletion, retention attestation or alias linkage is performed.

This `.node.mjs` suite is deliberately separate from Vitest and is **not automatically run by the unchanged existing CI workflows**. Parent/operator must run the explicit command when integrating or add a separately reviewed CI step using PG17 and Node22. Normal application/Cloudflare PR checks remain separate evidence; no whole application regression or native migration is claimed here.

## Parent-owned native gates

1. Keep the already completed core recovery/fee/restoration identities intact. Own a new exact deployment window; obtain fresh native workflow/source/worker/config receipts, acknowledged pause revision, removed schedules/consumers, admitted-work drain and the complete quiet bound. Preserve DLQ and all original bounded-delivery settings. A database counter, expired lease or boolean declaration is insufficient proof.
2. Verify the actual 53-core database/history and accepted preservation evidence, current object owner/default ACLs, current native source/config and both lifecycle flags off. Capture the fresh paused/drained baseline. Resolve a refusal by inspection/review, never by silently changing the contract or approving drift. This builder has not been qualified against the actual native catalogue.
3. Save durable operation identity, exact sources/commits, baseline/control receipts, full rehearsal SQL and transaction hash before dispatch through the parent's approved executor. Verify native rollback/preservation and absence of reader objects/history afterward. Then separately journal the apply SQL/hash and dispatch once. An ambiguous response needs read-only reconciliation of that same intent.
4. Read back all four exact history bodies, final schema/ACL/RLS and the original-column row projections, unknown holds and corrected fee custody. Verify native schema reload and source/config/flags unchanged. No deletion/retention/identity readiness, trusted issuer, alias, key or cap activation follows from successful migrations.
5. Complete the queued reader release's independent final-head CI/artifact/worker/asset/runtime acceptance before resuming/restoring original delivery. Native authority/disposable-account/all-alias deletion proof, external erasure, restore/retention/custody, useful-content acceptance and hosted language/mobile verification remain separate parent gates. No real reader is a deletion fixture.

Next action: parent reviews this draft and the exact per-object contract, integrates it with the queued reader sources, and performs the fresh native gates outside the pure builder. No watch, merge or deployment is requested by this handoff.
