# Hosting transport recovery — 7 November 2026

Implementation-only handoff for the parent. No production recovery, migration, deployment, source/provider/model request, cap change, approval or email was performed by this stream. No shared STATUS/PLAN/DECISIONS/DEMO file was changed. This checkout starts at `748216a` and targets `feat/free-first-retrieval` as a draft stack layer. PR #12 now targets main; PR #11 merged as `6906406` (parent-supplied context, not a new release claim).

## Evidence and diagnosis

The parent supplied the fixed-project **7 November 19:57 UTC** read: Cloudflare / epoch 3 / unpaused / fenced / release `80c3d6c`; automatic-content has the 14:10 UTC running frame with an expired 15-minute lease and 69 later queued frames. Earlier native counts are main 1 / dead-letter 67, a different observation, not a one-to-one message/frame mapping. Other kinds continued. No automatic domain task is running; 54 keyword/recap tasks are budget-blocked. Existing review/error states remain. There are 967 model calls, seven unknown records, USD 9.918486404 commitment against 10, and no model call since 4 November 23:12 UTC. This stream did not refresh those changing production values.

Repository contracts confirm:

- `begin_hosting_work` serializes a kind against **any** running frame, without expiry handling. A crashed invocation leaves the kind blocked indefinitely.
- A later queued tick receives `busy`, retries, and can reach the existing DLQ. The original frame is not a business task or a model request.
- The checked normal release refuses queued work. Bypassing this gate, expiring financial reservations, or replaying all old ticks would not prove domain safety.
- Automatic ticks call `sync_automatic_content_tasks` then claim the existing durable tasks. The task has immutable source/session identity; model requests retain stable keys and their existing financial admission. A missed tick contains no independent source/time-cutoff intent.
- Queue invocation wall time is documented as **15 minutes**. CPU time and the database lease are different bounds. [Cloudflare Queues limits](https://developers.cloudflare.com/queues/platform/limits/). The new recorded bound adds two conservative minutes. It is valid only for this native queue entrypoint, not an HTTP/background worker or an external provider's continued processing.

## Implemented choice

Migration `20261107200416_hosting_transport_recovery.sql` was created with `supabase migration new hosting_transport_recovery`. It adds two private, RLS-enabled, append-only evidence tables and seven service/internal functions; it changes no existing function definition or domain/financial record during installation.

1. `pause_hosting_transport_checked` compares exact Cloudflare owner/fence/epoch/release/revision and installs a recorded next revision, even with queued work. It pauses admission without claiming a drain, changing ownership, or disposing a frame. Exact replay uses its own nonce; any intervening control write invalidates it.
2. `recover_automatic_hosting_frame_checked` operates only while paused/fenced, on the exact current epoch/release/revision and exact full original automatic cron frame. It requires fresh native stop/bound/message evidence and an exact database domain fingerprint with **zero running automatic tasks, including expired tasks**. It takes table SHARE locks to wait for domain/call writers and check their committed evidence. Changed source/task/request/call data aborts the disposition.
3. A running legacy frame becomes `uncertain`, with disposition `expired_outcome_unknown`. An unstarted automatic cron frame also becomes `uncertain`, distinguished by `superseded_unstarted`. Both save the complete original frame, exact control, native evidence, domain hashes, recovery ID and timestamp before changing only `state` and `updated_at`. Token, lease, original timestamps and payload remain in immutable evidence; no frame is deleted or called completed. Lost replies reconcile only the same ID/input/current resulting frame and control revision. A competing different recovery ID loses CAS.
4. `begin_automatic_hosting_queue_work` requires a native message ID and exact canonical automatic cron key/body identity. It records the original running frame, control revision, queue/message identity and server time plus **17 minutes**. Other kinds keep their existing path. No queue send, retry-policy increase or domain/model call is added.
5. When a later tick finds a running automatic frame, the new RPC can retire it as uncertain only if its immutable recorded native bound has passed, its full frame and control revision still match, and no automatic domain task is running. Legacy frames without that receipt, changed leases/control, and still-running domain tasks require explicit recovery; age alone is insufficient. A busy **unstarted** tick is durably superseded and acknowledged, avoiding repeated retries into DLQ. The next ordinary tick services the same durable task queue; no business task/session is reset.
6. `finish_automatic_hosting_queue_work` binds completion to the original native message, token, epoch and release. An expired lease/bound or changed, unfenced or paused control can only yield `uncertain`, even after a successful handler response. A mismatched invocation rejects completion. The consumer rechecks the exact epoch and claim revision before entering domain code and accepts the native void 204 finish response.

Superseding automatic ticks deliberately trades historical scheduler attempts for at-most-one active sweep of the same durable queue. These ticks contain neither a private payload nor an independent cutoff, so replaying 69 missed sweeps has no recovery advantage. This rule is **not** applied to hourly discovery, daily cutoffs, reminders, HTTP requests or manual keyword-learning payloads. Broader stale-kind recovery is outside this increment.

The evidence RPC hashes all automatic tasks, keyword requests and model-call rows without returning their contents. Unknown charges, their maxima and observed amounts still count in commitment; no financial hold is cleared, inferred settled, or reset. There is no new service or supplier.

## Parent execution and native proof

These are future parent operations, not instructions executed by this stream. Reuse the existing fixed-project management/operator modules under the original checkout's `.local`; do not copy credentials into this branch or commit private journals. Confirm project `zlfdqzabsfndifxiqguo`, repository `raduvlad92/recap`, permanent origin `recap.filternode.dev`, and the exact native queue IDs before each mutation. Stop on any drift.

1. **Freeze delivery and deployment first.** Use the existing acknowledged deployment window to disable/drain the exact production delivery/preparation workflows. Record 100%-serving jobs/web version IDs, immutable code/release/config, queue/consumer identities, native bounds, crons, execution flags and current control/revision. `/settings` alone may describe an unserved upload. Keep all existing finite caps/unknown records/review/reminder settings exact.
2. Save a durable operation intent, then stop the exact jobs schedules and its worker consumer, with native GET readback showing no jobs schedules and no main/DLQ consumers. This recovery stop includes the consumer, unlike ordinary drain-by-consumption. Preserve the native stop acknowledgement timestamp; never purge, replay or acknowledge DLQ messages. Retain main/DLQ counts with their separate observation times. Inspect the current API contract before any pull-consumer operation: pulling is itself a visibility/lease mutation and is **not** a read-only diagnostic. [Cloudflare pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/).
3. **Apply the migration while native execution/deployment is stopped.** Capture every original table's row/definition/ACL fingerprint first. Apply only this pending migration through the established fixed-project migration process, with rollback rehearsal before committed apply. Verify original table rows/definitions/control remain exact after installation, plus new table RLS/grants and function ACLs. New schemas are local-only until this parent evidence exists. CLI here is 2.26.9; `db advisors` is unavailable, so use the connected native advisor after parent apply and record its actual output. Do not issue a production advisor claim from local ACL tests. Current Supabase function-security guidance: [database functions](https://supabase.com/docs/guides/database/functions).
4. Capture `read_hosting_release_status()` and persist a pause intent/nonce. Call the new pause function with **that** epoch/release/revision. Read back the exact same owner/epoch/release/fence, paused=true, intended next revision and untouched frames. A lost reply reuses the original arguments; a new revision requires a new inspected plan. Do not use ordinary release quiescence to skip its backlog guard.
5. Wait until at least **17 minutes after acknowledged native consumer/schedule stop**, retaining the exact serving-code maximum wall-time evidence. Verify no new deployment/consumer/schedule or domain invocation could have been admitted. Capture fresh native GETs. An expired database lease, old creation time, queue counts, or absence of a log line is insufficient. This bounds local native execution only; unresolved external model/provider results remain unknown.
6. Capture full exact hosting rows for this epoch/release privately and `read_automatic_hosting_domain_evidence()`. Require zero running automatic tasks. Preserve all seven original unknown-call rows/holds and all financial/task/request/source fingerprints, not merely their count or total. Running tasks, changed money/source evidence, changed control or a new native delivery surface stop the plan; do not repair domain rows here.
7. Build a durable per-frame plan, **not** a wildcard UPDATE. Each plan contains its own UUID `p_id`, exact full `p_expected` JSON, paused `p_revision`, complete evidence object below, and exact domain evidence. Prove that each queued frame is an unstarted null-payload canonical automatic tick with null lease/token, rather than a business payload. The old running frame uses the unknown-outcome disposition. Save acknowledged intent before applying each plan; after each reply compare audit row, resulting frame and domain fingerprints. The evidence's `observed_at` must be within two minutes; refresh actual native evidence for unapplied plans when necessary, retaining original inputs for lost-reply reconciliation.

The service-only call shapes are:

```sql
select public.pause_hosting_transport_checked(
  :expected_epoch, :expected_release, :expected_revision, :saved_pause_nonce);

select public.read_automatic_hosting_domain_evidence();

select public.recover_automatic_hosting_frame_checked(
  :expected_epoch, :expected_release, :paused_revision,
  :exact_original_frame_json, :saved_recovery_uuid,
  :native_evidence_json, :exact_domain_evidence_json);
```

`native_evidence_json` uses actual fixed-resource receipts:

```json
{
  "worker": "therecap-jobs",
  "worker_version": "<actual 100%-serving version UUID>",
  "release": "<exact original 40-character release SHA>",
  "queue": "therecap-jobs",
  "queue_id": "<actual fixed 32-character native queue ID>",
  "receipt_hash": "<SHA-256 of retained sanitized native proof bundle>",
  "delivery_stopped_at": "<acknowledged native stop time with zone>",
  "observed_at": "<fresh actual native readback time with zone>",
  "max_wall_ms": 900000,
  "schedules_absent": true,
  "consumers_absent": true,
  "deployment_workflows_drained": true,
  "message_id": "<actual native message ID, only if observed>",
  "message": {
    "version": 1,
    "kind": "automatic-content",
    "epoch": 3,
    "release": "<exact same release SHA>",
    "key": "<exact original canonical cron key>"
  }
}
```

The message object must equal the original frame's opaque transport identity exactly. If the legacy message ID was not recorded/observed, **omit** `message_id` and supply `"message_status":"not_observed"`. Do not invent an ID from a key/count, imply a message-to-frame mapping, or acknowledge an unidentified message. This route authorizes only database disposition after the global native drain; it does not attest that a missing message was received or processed. Supplied booleans/hashes are **operator attestations**: SQL validates shape, freshness, identity, native quiet interval and database CAS, but cannot independently query or authenticate Cloudflare receipts. The parent must obtain and retain those actual receipts; JSON-shaped assertions alone are not production proof.

8. After every intended frame is audited, require effective database queued=0/running=0 and exact retained uncertain/disposition counts. Preserve the original DLQ and export only sanitized evidence into `docs/tech/evidence`; keep exact lease tokens/native per-message journals private. Verify native execution still stopped, revision exact and all domain/call/source/workspace data unchanged. A DLQ backlog is retained evidence, not completed business work or a drained native queue.
9. Refresh the existing checked-release artifact/baseline and run its unchanged normal gates. Keep processing paused across release, deploy the exact checked artifact using the existing controller, and independently verify active web/jobs versions, source pin and private/public behavior. Do not restore an old Worker that lacks the new RPC path. No release/deploy was attempted here.
10. After the parent acknowledges controlled restoration, restore **only** the original bounded delivery policy: one-message batches, maximum six consumers, three retries, 60-second default delay, existing DLQ, original crons/flags, reminders off. Recheck exact control/native settings afterward. Native unstarted old-epoch messages can subsequently be acknowledged as obsolete without domain execution by the existing consumer; do not purge/replay DLQ for a cosmetic zero backlog.
11. Observe an ordinary scheduled automatic tick: native ID → invocation row → exact frame/control revision → truthful finish, with domain/financial readback. An unchanged exhausted model allowance may produce only blocked tasks; call that transport liveness, not successful AI generation. For native interruption proof, use a separately scoped isolated credential-free queue fixture/receipt backend to interrupt before/after fixture domain work, retain real serving-code/bound/message receipts, wait beyond the full bound and verify one uncertain original plus one next claim. The local workerd and real-PostgreSQL tests below are not this native proof. Never induce a real paid crash or unhold a real model call to test transport.

## Verification and limits

Focused checks cover full-schema disposable PostgreSQL, concurrent recovery and domain-writer races, exact lost-reply replay, stale control/epoch/release/revision/lease rejection, immutable originals/audits, missing/mismatched message/native proof, queue coalescing, bounded recovery, native 204 handling, crash after paid fixture domain completion, truthful late completion, and running-domain/unknown-charge preservation. Fixture model responses are local database evidence; they are not real model requests. Focused commands and final totals are recorded below after completion.

No new native adapter executes recovery automatically. The only automatic retirement path applies to newly recorded native automatic queue invocations under the pinned wall-time policy. Legacy frames, changed controls/leases and running domain tasks stay fail-closed until separately inspected recovery. Other kinds retain existing behavior; this is not a universal stale-job sweeper or proof that every recurring pipeline is healthy. If the native queue wall-time contract changes or cannot be verified for the deployed path, stop automatic delivery and use the inspected paused recovery path; do not infer this bound from CPU/lease settings.

Final local validation: **115 focused tests / five files pass**, including a full migration replay on disposable PostgreSQL. `npm run check:cloudflare` passes TypeScript, the Cloudflare dry-run build, **37 workerd cases (26 web / 11 jobs)** and the separate disabled-source check. The four added jobs cases exercise automatic success/native 204, audited supersession, missing native ID and duplicate no-execution. Outbound provider networking is blocked and no queue messages are sent by this harness. `git diff --check` passes.

Commands:

```sh
npx vitest run tests/hosting-transport-recovery-local-db.test.ts tests/cloudflare-hosting.test.ts tests/hosting-runtime-local-db.test.ts tests/automatic-content-local-db.test.ts tests/keyword-learning-local-db.test.ts
npm run check:cloudflare
git diff --check
```

The local runtime is Node 25.8.0; npm warns that the pinned Vitest supports Node 22/24/26. All reported checks nevertheless completed. CI/native production proof is still separate. The Supabase CLI installed locally is 2.26.9; its migration-new command was discovered via `--help`. No production migration/advisor, native recovery or new supplier/model fee was incurred.
