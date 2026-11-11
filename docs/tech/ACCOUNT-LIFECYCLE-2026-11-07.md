# Account lifecycle backend — 7 November 2026

The final inactive PR17/PR19 integration and completed confirmation/cache/all-alias implementation are documented in [the combined flow handoff](ACCOUNT-DELETION-FLOW-2026-11-07.md). Earlier implementation checkpoints and their test counts below remain historical.

Implementation-only increment in `t3/account-lifecycle-backend`, prepared from `748216a` on `feat/free-first-retrieval`. This document does not attest a hosted release. Shared STATUS/PLAN/DECISIONS/DEMO remain parent-owned. The original backend checkpoint left frontend work to the parent; the subsequent delegated integration now implements it as recorded in the combined handoff. No production database/API/Clerk/provider/model requests, credentials, runtime/cap changes, email, account deletion, hosted migration application or deployment were performed. All identities, native replies and retention attestations exercised below are synthetic local fixtures.

## Request and access contract

`POST /api/account-deletion` accepts exactly:

```json
{"confirmation":"DELETE_ACCOUNT","requestId":"<client-generated UUID>"}
```

It requires an ordinary verified Clerk bearer session, exact configured request/Origin equality, JSON, `X-Recap-Account-Action: delete-account`, and same-origin Fetch Metadata when present. It rejects actor/impersonation tokens. Signed first-factor verification age plus time since JWT issuance must be within five minutes; a verified second factor, when present in the signed claim, must also be recent. Clerk's `fva` has minute granularity. Missing ages fail closed; refreshing a token alone does not reverify identity. A native GET of the exact signed session must still show the matching active owner and an unexpired session. Public documentation consulted: [Clerk session claims](https://clerk.com/docs/guides/sessions/session-tokens), [reverification](https://clerk.com/docs/guides/secure/reverification), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

The backend supplies the owner; no account, email or deletion target is accepted from the body. A durable accepted request returns 202, never a claim of completed erasure. Replays for the same account return its original request/status without another destructive identity. A UUID collision across accounts fails. `GET` exposes only the verified caller's deletion status. Replays/status can use an otherwise valid signed token after native revocation, solely to inspect the already accepted deletion; they do not recover reader access or initiate another request. After JWT expiry, the parent needs a signed-out acknowledgement/support flow; this backend does not publish an unauthenticated status capability.

`recap_internal.account_deletions` is the permanent server-private tombstone and resumable work record. It has no workspace FK and cannot be deleted, reassigned or directly written by the server role or a reader. Its RPCs are service-only with empty search paths. Existing application keys remain untouched. Migration application creates **zero deletion requests**.

Ordinary `authenticate()` now checks `account_access_allowed` without caching. This check stays mandatory even if request/worker feature flags are later disabled: an existing tombstone must never become an access bypass. A failed database lookup denies access. The migration must precede the new backend release; the RPC's absence deliberately fails closed for authenticated endpoints. The narrowly scoped deletion-status handler verifies identity separately.

Restrictive RLS denies stale valid JWTs on owner-scoped reader tables, alongside their existing owner predicates. Database write fences also cover the existing service-role paths, pending work, independent sessions and prompt receipts. No owner/reader privilege or JWT metadata can lift suppression. Existing public creator catalogue pages remain independent public data.

## Durable execution and races

The existing jobs worker gains `account-lifecycle`. Its normal five-minute dispatcher processes at most one due **already requested** account per invocation, using a durable two-minute lease. It never enumerates Clerk users for deletion, starts a supplier/model job, changes a ceiling or sends email. The existing worker secret and hosting admission boundary remain in use.

| State | Meaning |
| --- | --- |
| `requested` | Tombstone committed; access/new owner work denied; data and sign-in deletion still pending. |
| `in_progress` | Current leased cleanup/native attempt. Expired/interrupted leases may be reclaimed with a new token. |
| `blocked` | An explicit remaining dependency: payload retry, Clerk disabled/unavailable, unresolved external work, missing retention proof or changed external reference. Suppression remains active. |
| `completed` | Active-service erasure and frozen identity deletion are acknowledged, outstanding domain work is resolved, and a matching per-request external/restore attestation is present. It does **not** mean every backup medium was physically destroyed or all fees are final. |

The request transaction disables existing collection/model/automatic/social/daily/reminder admissions without changing financial limits or historical cutoffs. Writes take a nonblocking owner advisory barrier; request/erasure take its exclusive side. An already active writer makes the request return a retryable conflict before acceptance. Once accepted, delayed writes cannot recreate private payloads. Nonblocking acquisition prevents the policy/source/job lock inversion that a waiting deletion lock could introduce. Protected operations require READ COMMITTED, which is the current request transaction model; stale REPEATABLE READ/SERIALIZABLE writes fail closed. Replays must retain their request UUID.

Cleanup runs atomically inside PostgreSQL. Existing privacy triggers redact admissions/comparison manifests and close keyword production/evaluation sessions before workspace/archive cascades remove jobs, immutable prompt receipts, review evidence, automatic task source snapshots, briefings, briefing inputs, publications, outbox recipients/payloads and reminder events. Detached evaluation request/result caches are explicitly scrubbed as well. Original model job UUIDs are saved as immutable `erased_job_id` before the FK sets `job_id` null. Numeric token usage is allowlisted; raw result/prompt fields are erased. An interrupted SQL cleanup rolls back; it does not acquire a false payload-erased timestamp.

Clerk handling reuses the existing backend transport. It reads the frozen identity, then [bans the user](https://clerk.com/docs/reference/backend/user/ban-user) to revoke all sessions/prevent new sign-ins, deletes that exact user, and confirms absence with a fresh GET. Lease authority is checked before native mutation. A timeout is blocked/uncertain, not success. Repeated attempts safely recognize a confirmed 404 after a lost successful deletion response. No Clerk mutation was run by this task.

Previously admitted external requests cannot be recalled or unsent. Unknown model calls and active/ambiguous source/social jobs block completion, even after local payloads and Clerk are removed. Exact in-flight reminder/outbox and shared-social job identities are copied into private, payload-free custody records before payload cascades. Authenticated delayed reminder callbacks can add their exact provider identity to an append-only private receipt without recreating recipients/outbox data. Late new provider/run/dataset references invalidate a prior completion attestation and reopen the blocked state. The worker does not replay the original business job.

Late genuine fees remain recordable on the exact original call/reservation. Erased completed evaluation caches no longer make the original cached-result comparison roll back a valid delayed settlement. Incoming results and prompts stay erased. No unknown charge is converted to zero, no hold is released, no maximum is lowered and no original reservation/call/attempt is deleted. Terminal source work can retain unresolved financial custody; unknown model activity remains conservatively blocked. A terminal-but-unbilled model proof needs separate exact-call reconciliation rather than an age-based workaround.

Shared public social acquisitions remain usable by other active readers. Only the erased account's consumer/delivery links disappear; sole-consumer raw item caches are removed, and delayed inserts with no active consumers are discarded. Shared run/reservation identities remain. Public-source metadata is not itself a private reader account payload.

## Retention and restore contract

**No automatic raw/archive/backup expiry is activated. Seven-day raw and thirty-day backup targets remain proposed until production policy is chosen.**

| Material | This increment |
| --- | --- |
| Personal workspace, reader archive/history, source snapshots, prompts, output caches, email recipients/payloads | Erased from active application tables through the explicit request. Existing client downloads/browser caches, provider datasets/logs and backup media are separate custody. |
| Unresolved/settled money and necessary provenance | Retain private exact call/request/job/reservation/run/Actor/model identities, financial attempts/receipts, maxima, observed high-water values, actual/null fees and timestamps. No raw source/prompt is required as financial evidence. |
| Administrative audit | Preserve event identity/action/time and allowlisted source-free hashes, monetary/count/decision/model metadata. Remove arbitrary payload fields associated with the erased account. |
| Tombstone and restore evidence | Retain the stable application key, frozen identity locator, request/progress, reference digests and immutable external/backup attestations server-privately. There is no expiry or public read. |
| Existing provider-fee and hosting transport receipts | Preserve them unchanged. Their FK targets needed for custody are scrubbed rather than cascaded away. Transport key/token/state and immutable invocation/disposition history are not relabeled as completed. A queued private keyword-learning transport prompt is erased without replaying it. |
| Shared public catalogue/source metadata and independent delivery suppression hashes | Not a reader workspace; retained independently. This is not a claim that every potentially identifying datum everywhere has been destroyed. |

Completion is blocked with `retention_proof_required` until the private server/operator records a chosen policy version, the current **database-computed** external reference digest, and SHA-256 digests of private backup/restore and external-erasure manifests using `record_account_deletion_retention_proof`. These are trusted operator attestations, **not automatic verification of what a hash represents**. The operator must verify native terminal activity, provider payload erasure or absence, backup custody, independent tombstone preservation and restore suppression for every exact reference. No real attestation is supplied here. Identical attestations replay; changed attestations for the same restore generation fail rather than overwrite history.

Earlier workspace clears may already have removed legacy internal-job or reminder references. This increment does not reconstruct or invent missing identities. The operator must establish historical provider/sender inventory independently before attesting completeness; an incomplete reference inventory stays blocked. Current database absence alone is not external-erasure proof.

A safe restore requires all of the following before any traffic, schedules or queue consumers resume:

1. Keep the newest complete tombstone manifest outside the backup being restored, in existing approved private custody. Include every requested/blocked/completed stable key, request UUID/time and frozen identity locator, plus checkpoint/count/digest; exclude prompts/source data. Choose its storage/access, verification, refresh/failure policy and recovery owner; this increment does not create another service or promise that this independent copy already exists.
2. Restore into quarantine with all processing and serving disabled. Apply the current lifecycle schema/fences if the restored schema predates them. Replay and verify the latest tombstones **before** admitting restored owner data. Preserve every old application key and original external job identity. Normal inserts for tombstoned owners fail, including stale worker imports.
3. A full physical restore or superuser `pg_restore --disable-triggers` can bypass normal gates and can omit requests newer than the backup. This code cannot infer missing tombstones from that backup. Reconcile the independent latest manifest, validate counts/digests and fail the recovery if its completeness is unknown.
4. For each restored tombstone, call `requeue_account_deletion_after_restore` and rerun payload erasure/native absence verification while quarantined. This increments a restore generation and invalidates earlier retention attestations. It never removes suppression. Inspect restored global/shared caches and optional fee/transport tables as well as user tables.
5. Obtain fresh exact-reference external/restore attestations for that generation; verify ordinary-owner isolation, stale JWT/RLS denial and blocked/completed status before reopening the recovered system. Do not expire uncertain jobs or invent final fees to pass recovery.

Backup expiry duration, erasure schedule/SLO, provider dataset/log deletion APIs and custody, browser/download cleanup, tombstone export destination and operational retention enforcement still need a production decision/native proof. The contract is operational scope, not a legal-compliance claim.

## Stable keys and future authentication cutover

`user_id` in lifecycle and existing financial/job records is the **stable application account key**, not a promise that every future provider subject will equal it. Current legacy keys happen to be Clerk subjects and remain valid. The deletion request freezes `identity_issuer` and `identity_subject` separately; native Clerk operations use that locator, never a rewritten financial key. A changed configured issuer causes the native worker to refuse deletion rather than target a different identity system.

The concurrent parent preflight reports 35 typed account references, 11 direct-sub RLS policies and the clear-workspace RPC, with no mapping tables. That supplied inventory is not a production recheck by this child. Before the proposed private unique `(issuer, provider subject) -> stable application key` cutover, parent must resolve aliases in ordinary auth, deletion creation/status, backend access checks, all direct Supabase RLS predicates and clear-workspace authorization. All delayed workers and restore manifests must keep the same stable key. Revocation must cover every mapped sign-in identity/session; one frozen legacy Clerk deletion cannot certify removal of future aliases. Existing tombstones must suppress all aliases. Do not infer links from email/name, bulk rekey custody/history or enable mapped-subject traffic before those proofs. No mapping schema or auth-provider migration is implemented here.

## Flags, verification and integration gates

- `ACCOUNT_LIFECYCLE_ENABLED=true`: enables request/status endpoints and the request-only jobs sweep. Omission disables them; it does not disable existing tombstone access/write fences.
- `ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED=true`: additionally allows the leased native ban/delete step. Omission leaves an explicit blocked status while active-table payload cleanup may proceed for accepted requests.
- Reuse existing Supabase/Clerk configuration and the existing content-worker secret. No new subscription, service, database, spending flag or credential is required. No deployed setting was edited.

Migration `20261107203128_account_lifecycle.sql` was created with installed Supabase CLI `2.26.9` after reading `--help`/`migration new --help`. The current changelog was checked; CLI-v3 changes do not apply to this installed CLI. Its help has no `db advisors` command. `supabase migration list --local` fails because the Docker-backed localhost:54322 stack is absent; the tests instead apply the full ordered migration chain to a separate throwaway PostgreSQL cluster. Hosted advisors/history/readback were not requested.

Local verification includes signed-token suppression without caching/flag bypass, CSRF/recent/native-session ownership, durable replay/lease interruption, real RLS/ACL checks, two-process writer races, cascade/immutable-prompt/publication interactions, exact financial preservation, late settlements, shared-source removal, delayed authenticated webhook identity capture and restore-generation proof invalidation. The optional matrix additionally applies the actual PR13 fee and PR14 transport migration texts extracted from local Git objects to disposable PostgreSQL, including unchanged immutable receipt/FK evidence. These are local fixtures, not hosted/provider/backup proof.

Recorded local checks:

- `npx vitest run --maxWorkers=2`: **4,045 tests / 131 files passed**, 382.83 seconds. Earlier overlapping runs hit existing database deadlines; they were stopped/drained, with no deadline/assertion changes. The final exact-key audit correction is additionally covered by the final focused matrix below.
- `ACCOUNT_LIFECYCLE_TEST_EXTRA_MIGRATIONS=<local fee SQL>:<local transport SQL> npx vitest run tests/account-lifecycle-local-db.test.ts tests/account-lifecycle.test.ts tests/account-lifecycle-access.test.ts`: **49 passed**, including populated immutable fee/transport tables, on PostgreSQL **17.11**. Extra SQL came from local Git `6ea1efc` / `fbf79cf`, never a hosted migration/API.
- `npm run typecheck`, `npm run build`, `npm run catalogue:check` and `git diff --check`: passed. The existing large-client-chunk warning remains.
- `npm run check:cloudflare`: passed local dry-run bundles, **26 workerd web checks**, **seven jobs checks** and the disabled-source guard. Network destinations were fixture-controlled; no live provider requests or queue messages. A Workers-incompatible redirect mode caught during verification was corrected to explicit manual redirect refusal and rechecked.

GitHub CI, review, native identity/retention/restore proof and release are separate pending gates. Required parent work remains:

1. Integrate against current main/transport dependencies, refresh database/ACL/preservation baselines including the private lifecycle schema, obtain CI/review, and apply this migration before releasing the authentication change. Once a request is accepted, rollback/recovery must retain tombstone-aware authentication and database fences; an older artifact that ignores them is not a safe fallback. This child neither merges nor deploys. Resolve any jobs/runtime-check fixture conflicts with PR14 without dropping either boundary.
2. Add the final user-facing destructive confirmation/reverification, pending/blocked/signed-out acknowledgement and cache cleanup. Do not label the existing workspace-delete button account erasure. Phone/keyboard UI and real reader behavior remain unverified here.
3. Prepare the production retention/restore/external-provider policy and independent tombstone custody; keep deletion flags off until the backend migration/worker/configuration and final confirmation flow are reviewed. No existing reader should be selected for a demonstration. Native destructive proof needs a separately approved disposable test identity.
4. Prove native Clerk session revocation/deletion and lost-response recovery, exact served artifact, stale JWT API/RLS denial, delayed domain/webhook/provider cases, immutable fee/transport custody, external payload handling and quarantined backup restore on the chosen deployment. Do not claim financial finality, complete global erasure or production-auth cutover from these local checks.

## Parent integration checkpoint

Retargeted to main and integrated merged backend `1824574` (retrieval, fee receipts and transport recovery). The sole textual conflict was the jobs import block: retain both the lifecycle worker and recovery's `RuntimeControl` type. Automatic native message/revision guards, native 204 completion, and lifecycle dispatch remain intact. Independent read-only review found no material blocker in the lifecycle change or this merge resolution.

The parent combined run under supported Node 22 passes **153 tests / seven files**: lifecycle unit/access/disposable PostgreSQL, Cloudflare hosting, transport recovery PostgreSQL, late-fee PostgreSQL and automatic-content PostgreSQL. `npm run check:cloudflare` passes typecheck/build, **26 web / 11 jobs workerd cases** and the disabled-source guard with live networking blocked. The original 4,045 regression count belongs to the implementation stream; overlapping counts are not added, and exact integrated-head CI remains required.

Confirmation/reverification/cache cleanup, exact migration/ACL/row preservation, alias integration, native disposable-identity/external-erasure/restore proof and independent tombstone custody remain separate gates. No production migration, deletion, flag change or deployment occurred.
