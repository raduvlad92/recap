# Native recovery execution and continuation

Checkpoint: **7 November 23:14 UTC / 8 November Berlin**. This records actual execution, not deployment acceptance. Current fixed core main is `182457410f7f8e979348d10347fe50b1e94b295b`. Keep main unchanged until the current normal release is accepted and original delivery is restored.

## Completed native gates

- Successful artifact-only run `42415988917`: active ZIP/native SHA-256, manifest, all checked files and committed configuration/source pins verified. This is preparation, not the normal deployment checkpoint.
- Owned deployment window `35a3fc0f-1df5-4741-a56c-a74fe9870bf4`: workflow disabled and all runs drained. Native schedules and consumer stopped. Cron propagation admitted later business ticks; original bounded consumer temporarily drained them. The unchanged pause intent then succeeded. Final consumer removal was acknowledged at **22:22:55.049137 UTC**; the full conservative quiet deadline was **22:39:55.050 UTC**.
- Recovery `bc313984-67d2-4416-bfc4-a366f2e6ef9b`: all **96** exact automatic frames have immutable uncertain dispositions. One expired outcome is unknown; 95 unstarted ticks are superseded. No business replay, invented legacy message ID, main/DLQ pull or purge occurred. Active hosting work is zero; 96 uncertain records remain evidence.
- Transport `20261107200416`, retrieval `20261105011050` and fee `20261107194452` migrations each passed guarded native rollback rehearsal and apply. Original public rows/security/signatures/ACLs/defaults/triggers/history were verified inside each transaction; only reviewed retrieval replacements/nullability were permitted. New tables are private.
- All **19 original source reservation rows**, **seven unknown model full rows** and **three workspaces** remain exact after all core migrations. There are 20 source holds, comprising 19 launched jobs and one envelope. Model commitment is **USD 9.918486404 / 10**; no cap was raised.
- Separate current database baseline: 62 public tables, 32,252 rows, 333 definitions, 53 migrations. Original cutover pin unchanged. Security advisors returned 51 INFO private-table/no-policy notices and no warning/error; exact grants were checked independently.
- During ordinary admitted draining, three recent reservations settled USD 0.003 and three new normal social jobs reserved USD 0.070 with fees unknown. No manual supplier/model start occurred. Preserve these new holds too.

[Sanitized native receipts](evidence/recovery-native-window-2026-11-07.json) retain hashes and chronology. Raw rows, tokens, provider references and native replies stay in ignored private operator files.

## Active release

The deployment window is **released**. Fresh durable operation `5f315c48-0650-4159-9f5b-404143c97f8d` selected `HOSTING_TARGET=cloudflare` and dispatched **one** supported normal workflow, `prepare_handover_artifact=false`, no checkpoint ID. Native run **42423118103** is identified. At the checkpoint its application/PostgreSQL verification is running; no new deployed release is claimed.

Database control remains Cloudflare epoch 3, old release `80c3d6c34452137c9dfbeefaab0639625fc3f0d6`, fenced, **paused**, revision `434666c5-2596-43dc-9023-cb26f2a398c5`. Native schedules and consumers remain absent. The normal controller preserves pause while changing to epoch 4/new release. Refresh actual native state before every next action.

The reviewed private operators live under `.local/retrieval-release-20261107/` in the root checkout:

1. `download-normal-release.mjs plan` reads exact run/jobs. `prepare` requires successful verify/deploy, downloads only its exact native archive without forwarding the GitHub bearer to signed storage, enforces archive bounds and checks all files/source/config pins. It saves `normal-release-artifacts.json`.
2. `verify-normal-release.mjs` binds that archive to the sole exact GitHub Actions normal checkpoint, completed journal, paused new control, 100%-serving workers, unchanged source/flags, all native asset hashes and public HTTP boundaries. It saves `normal-release-native-verification.json`. It performs no runtime mutation.
3. `late-fee-operator.mjs plan` has only found the exact historical saved YouTube job (old provider USD 0.004, ledger zero, maximum 0.005). No provider request/correction has run. After exact native release acceptance, its reviewed `apply` obtains fresh authenticated exact-run/build/owner/cap evidence through the existing library and stable request key, while still paused. Unknown model/source holds and original limits are outside its authority. `reconcile` verifies a saved receipt without provider/RPC replay; `replay` verifies the same economic receipt without another debit. Unresolved results remain unresolved. Preserve original history and prove all three cash projections. The strict original-row preservation script will intentionally flag the explicitly corrected reservation afterward; qualify that single difference through its immutable original receipt and continue comparing every other original row exactly.
4. `restore-normal-delivery.mjs plan` requires exact accepted native release. The reviewed sequence is `resume`, `consumer`, `crons`: separately journal checked resume nonce; restore only original bounded main consumer; restore only `*/5 * * * *` and `0 * * * *`. A saved unacknowledged intent requires `reconcile`, never a new identity or blind write. DLQ remains untouched, reminders off. Original settings are batch 1, concurrency 6, retries 3, maximum wait 1,000 ms, retry delay 60 seconds and existing DLQ.
5. Prove a new ordinary automatic message ID → invocation/frame/current revision → truthful completion. Budget-blocked tasks prove transport only. Retained dead letters are not a recovery-completion count. Native isolated interruption proof and useful-content outcomes remain separate.

Do **not** rerun completed migration/recovery/selection/dispatch writes, reuse failed paused deployment `42414617918`, promote artifact-only preparation into a normal checkpoint, use initial-cutover `HandoverDelivery` for this normal release, reset an ambiguous operation, or merge another head into main during acceptance. Native replies/journal hashes and original identities are retained privately for reconciliation.

## Reader queue

Ready PR #15 locales and #16 extraction remain behind core restoration. Final ready PR #17 `5906905` now includes inactive PR #19 identity and the full deletion flow. Independent final review is GO; final 97-case focused matrix and separate 268-case parent extraction/lifecycle/identity integration, public-originals workerd, typecheck/build/37 normal workerd checks pass. Exact-head application CI passes; Cloudflare CI remains pending at this checkpoint. [Reader evidence](evidence/reader-integration-checkpoint-2026-11-07.json).

Reader lifecycle/identity/extraction migrations are **not applied**. No linked identity, deletion flag, lifecycle readiness or retention expiry is enabled. Their guarded migration/release, native authority/disposable-account/all-alias proof, external erasure, retention/restore/custody and hosted language/interface checks remain. No current reader is a deletion fixture. Full specification approval, customer outreach, charging and new subscriptions remain outside this delivery.
