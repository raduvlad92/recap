# Initial Cloudflare handover and recovery

Current checkpoint: 4 November 2026. The orchestration library and checked database guard are implemented and rehearsed. The live fence, parity/policy receipt adapters, durable handover journal and switch/rollback workflow are **not connected**. No initial switch has run. The website still serves isolated review release `ca43f97` with Netlify-owned/paused control.

## Current proof

The five reported checks on `5ae9fb9` comprise three successful jobs (`check`, `verify`, `checkpoint-storage`), one expected skipped PR deployment and the neutral `cloudflare-release-journal-probe`. Native check run `126553853774` belongs to `github-actions`, targets the exact head and records transport-only/no-processing metadata. This verifies actual GitHub App checkpoint write/read/update, separately from checked-main deployment, which remains unproved. A new credential-free PR `artifact-integrity` job also downloads the checked merge artifact onto a separate runner and verifies every manifest hash. Its first native result is pending the next push; a successful transport result would still be separate from main deployment. [CI evidence](evidence/cloudflare-checkpoint-ci-2026-11-04.json).

The real encrypted reminder settings authenticate/decrypt in native Node with the preserved original worker secret, and the wrong key is rejected. Ciphertext is unchanged; actual web/jobs reminder flags remain false. Plaintext and credentials are never recorded. This is actual stored-ciphertext/key continuity proof, not a newly hosted Worker decryption test or an email send. [Continuity evidence](evidence/cloudflare-reminder-secret-continuity-2026-11-04.json).

External Chrome again returns `cgWindowNotFound`; opening its controlled tab returns `The browser access host is unavailable`. The prior owner/admin/workspace-existence browser proof remains attached to `8fdfbae`. Current main-app save/reload and ordinary-user browser parity are unfinished. No replacement key, subscription or administrator setup is needed.

## Initial switch protocol

`scripts/cloudflare-handover-state.mjs` contains pure planning and explicit orchestration ports. It does not itself contact a host, rotate a key, activate jobs or delete Netlify. Its receipt digests identify evidence; caller booleans/hashes are not authorization or proof of external state. A future trusted adapter must independently obtain and revalidate those facts before every mutation.

The plan pins the exact artifact (including configuration/static assets), permanent domain, Therecap Netlify site ID, initial owner/epoch/release/revision, inert serving versions/binding hashes, verified source component, explicit existing execution policy and explicit resume choice. It refuses missing/wrong-release private parity, secret continuity, preservation, legacy drain or fence-readiness receipts. It also requires a separately proved usable **Cloudflare** rollback target; Netlify's unavailable origin is not an acceptable fallback. The current isolated shadow copy is not relabeled as that active rollback target. Reminders must remain off.

The sequence is:

1. Save intent, verify checked head/evidence/control, stop the old automatic deployment path and read back the paused target.
2. Apply an independently idempotent durable fence to the exact old host/credential; verify its receipt. Credit exhaustion alone is insufficient. No source/provider reservation is deleted to make this pass.
3. Stage exact active web/jobs versions without changing serving traffic. Keep processing paused and recheck the fence.
4. Commit initial ownership to Cloudflare using the checked database operation. This advances the epoch and leaves processing paused.
5. Promote the exact versions and configure delivery while paused. Verify routing/origin/assets/private boundaries, source identity and fence before selecting Cloudflare as the automatic deployment target.
6. Resume only under the explicit prior policy, after every readback and target check. If the selected policy is paused, retain the pause.

Every mutation has a saved pending phase. Transfer/resume UUIDs are saved before the request. A lost acknowledgement can reconcile only that operation's own applied revision. Any intervening operator update, including pausing an already paused runtime, stops recovery rather than overriding the operator. Changed evidence/head, unproved fencing, unresolved hosting work and failed readback stop progression. Completed retries recheck live state and never replay business work.

The library's `runHandoverRollback` separately verifies the known Cloudflare recovery proof and old-host fence, stops delivery, checks/drains hosting work, pauses with its own revision, restores the proved release/versions and verifies them. It leaves Cloudflare paused and Netlify fenced for controlled recovery. It cannot send traffic to Netlify or reactivate jobs. Interruption/operator changes are checked again. If work has not drained, restoration does not proceed; no lease or uncertain outcome is cleared automatically.

These are orchestration-port rehearsals, not native end-to-end handover/rollback execution. Live adapters must make fence/stage/routing/target operations independently idempotent, enforce their exact fixed resources and save receipts durably before this can become an apply workflow.

## Database guard and read-only readiness

Migration `20261104115513` adds only `commit_hosting_handover_checked`, with service-only execution, an empty search path and a two-second lock deadline. It compares the exact paused Netlify epoch/release/revision, requires the coordinator's fence assertion and rejects queued/running/uncertain hosting records. It changes ownership to Cloudflare **paused**, increments the epoch and installs the saved operation revision. It cannot resume processing. The database does not independently contact Netlify to establish the external fence.

Actual-project verification created the function and rehearsed the checked ownership change/replay inside a transaction that was then rolled back. The committed migration installs the function only. All 58 existing public tables / 21,116 rows / 310 existing definitions remain exact, including the original 56 tables / 21,115 rows / 296 definitions. Control and revision remain unchanged. [Native rollback/apply evidence](evidence/cloudflare-handover-checked-migration-2026-11-04.json). Real API readback returns 400 for an unfenced service request and 401 for anonymous access without changing control. [API evidence](evidence/cloudflare-handover-api-2026-11-04.json).

`npm run plan:cloudflare:handover` accepts no arguments or apply flag. It reads built artifact/current platform/database state and prints explicit blockers. It deliberately cannot accept caller-supplied evidence or activation policy. The [actual readiness result](evidence/cloudflare-handover-readiness-2026-11-04.json) is blocked even with a build matching its recorded repository head. No apply entrypoint is exposed.

Local verification passes **3,751 tests / 115 files**, including 35 focused handover/database cases. This covers stale/missing receipts, policy/isolation/source/domain gates, checkpoint failure, fencing/readback failures, lost transfer/resume/pause/restore replies, operator updates, pause retention, exact rollback versions, role permissions and blocked unresolved work. The 26 existing workerd checks and disabled-source gateway check also pass, separately from live browser proof.

[Current native readback](evidence/cloudflare-handover-live-state-2026-11-04.json) confirms review release `ca43f97`, all nine execution flags off, no schedules/queue consumers, the same disabled private source pin and inactive container. The advisor still reports 47 INFO RLS-without-policy notices and no new-function finding. No committed ownership transfer, durable fence/revocation, source/model job, review approval, email or Netlify deletion occurred. Metered hosting cost is unmeasured.

Next: complete latest-release private-account/browser parity and a usable Cloudflare recovery artifact, connect exact native policy/legacy-drain/fence/journal/workflow adapters, rehearse the complete switch/recovery without business execution, then perform checked-main delivery and gated handover. Bounded acceptance still precedes Therecap-only retirement. Preserve all original holds, references, reviews and reminder opt-out.
