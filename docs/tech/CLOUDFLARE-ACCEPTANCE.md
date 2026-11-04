# Cloudflare acceptance and remaining Netlify retirement

**Superseded retirement gate, 5 November Berlin:** the founder explicitly requested immediate Netlify removal without waiting. The site, hook/secret and exclusive deploy keys are now removed, with native absence and post-removal Cloudflare checks verified. The final retirement task is deleted; the first two cutoff checks remain read-only observations with updated instructions. The 72-hour/two-cutoff interval below was not completed or claimed passed. [Current retirement evidence](NETLIFY-RETIREMENT.md). The original checkpoint and schedule below remain historical evidence.

Checkpoint: **4 November 2026, 22:29 UTC.** Cloudflare serves the permanent origin, owns processing and receives automatic checked-main deployments. The maintenance correction is deployed and processing is restored. Active browser/API checks pass. **Acceptance started at 22:26:36.944 UTC; it is incomplete. Netlify is fenced, not deleted.**

## Checked release and restored processing

PR #9 has four successful jobs, two expected skips and two neutral transport probes on `0dd7abf`, with no comments/reviews. It merges as `80c3d6c34452137c9dfbeefaab0639625fc3f0d6`. Main application run `41920092192` and Cloudflare run `41920092072` succeed; the latter performs the normal **active** release. Native ZIP artifact `13367931126` has digest `sha256:d7c03751621413dcde23e857eb67786a2acbe9c2665b8ab7bee15719cb6aef9b`; the archive and every checked file rehash correctly. GitHub App release checkpoint `126896081640` is complete and inherits the exact acknowledged maintenance pause. [CI/archive/checkpoint receipt](evidence/cloudflare-patched-main-ci-2026-11-04.json).

The same maintenance operation `b0d222fb-e8e9-4caf-ae90-f3065b8d7ed8` records and acknowledges a new resume intent before the checked database operation. Its remote readback is acknowledged as resumed. Control is **Cloudflare / epoch 3 / `80c3d6c` / unpaused / old host fenced**, revision `2b7f630e-2f78-4223-9c35-5f207c460add`. The initial handover is not replayed. Before restoration, every original 56 tables / 21,115 rows / 296 definitions still matches. Normal authorized activity may subsequently add or reconcile data, so that frozen comparison is not represented as a post-resume snapshot. [Maintenance restoration](evidence/cloudflare-maintenance-restored-2026-11-04.json), [earlier switch history](CLOUDFLARE-CUTOVER.md).

Fresh native readback verifies exact serving Workers/assets, private enabled source version `ffed3cd5-addb-4240-adb8-42afe273615f`, original source image/namespace/bounds and execution policy, one bounded jobs consumer and crons `*/5 * * * *` / `0 * * * *`. `HOSTING_TARGET=cloudflare`, deployment workflow active, old database key **401**, dedicated Cloudflare key **200**. Reminders remain off. No old key is recreated and no cap is raised.

## Actual active checks

The real existing owner session in **external Chrome** passes administrator access/overview/analysis, private briefing and collection-activity reads; keyword learning correctly rejects GET with 405. The existing workspace visibly shows **Workspace synced**. The token stays in browser memory, its authorized party matches the permanent origin, no new session/admin role is created, and no private identity, follows or token is recorded. DevTools is closed and Recap is left in front. Backend-minted tokens lacking an authorized party are not used as positive application proof. The earlier ordinary-reader save/reload/isolation evidence remains release-specific. [Current owner/browser receipt](evidence/cloudflare-active-owner-browser-2026-11-04.json), [earlier ordinary-reader proof](evidence/cloudflare-private-workspace-browser-2026-11-04.json).

Twenty-two bounded HTTP cases plus six browser cases pass across the 14 HTTP handler families: public routes/catalogue/health, anonymous and background-route denials, private access, method guards, invalid signatures/tokens, valid signed **unmatched** webhook twice, and valid unmatched unsubscribe GET/POST. Disposable outbox identifiers are checked absent before and after; these fixtures write zero domain rows and send zero emails. Replaying a matched real outbox is covered only by isolated tests, not claimed as a native live test. The previous 204 completion-response failure is absent. These checks neither manually launch source/model work nor approve a real review. [Acceptance-start receipt](evidence/cloudflare-patched-active-acceptance-2026-11-04.json).

The actual encrypted reminder configuration also decrypts under **workerd** with its existing key; an incorrect key is rejected. No plaintext or provider request is returned by that offline probe. [Cipher receipt](evidence/cloudflare-actual-cipher-workerd-2026-11-04.json).

The one existing Resend webhook now targets `https://recap.filternode.dev/api/reminder-events`. Provider readback confirms it remains enabled with the same four events and signing secret, which matches the encrypted runtime configuration. No message is sent, consent changed or key rotated. [Callback receipt](evidence/cloudflare-resend-callback-2026-11-04.json).

## Early cadence and preserved finances

By 22:28 UTC, automatic-content, social-collection, social-content and daily-briefing hosting frames have each completed on three normal five-minute cycles. Native main/dead-letter queue backlogs are both zero; no queued/running/uncertain hosting frame remains in that observation. A hosting-frame completion does not establish useful content, a successful provider run or publication. The first post-restoration hourly boundary and the next normal daily cutoffs still need observation. The existing enabled daily schedule records 4 November's 07:00 UTC cutoff; this is not a normal cutoff observed since the new acceptance start. [Early cadence](evidence/cloudflare-acceptance-initial-cadence-2026-11-04.json).

All seven original unknown model-call financial records remain exact. All 19 original held source-reservation records remain present with original maxima and launch-attempt timestamps: 17 remain unchanged and two settle through normal scheduled reconciliation. Authenticated metadata GETs for those exact original runs confirm terminal runs finished on **2 November**, with reported fees rounding upward to USD `0.000073498976` and `0.000083211477` under the existing twelve-decimal rule. No manual financial write or new provider run is used for this verification. Missing costs are never replaced with zero; provider-reported fees are not final invoices. [Financial receipt](evidence/cloudflare-old-hold-reconciliation-2026-11-04.json).

The existing review-first behavior, source/model ceilings, uncertain outcomes and reminder opt-out remain authoritative. Existing content-quality, sparse-coverage or held-review problems are distinct from hosting acceptance. Workers Paid remains the already approved USD 5/account/month plus metered usage; current hosting/API/CI costs are unmeasured. Normal already-authorized processing can incur usage within its existing caps.

## Finite acceptance follow-ups

Acceptance requires **at least 72 hours and two actual normal daily cutoffs**. Earliest completion is **7 November, 22:26:36.944 UTC** (23:26 Berlin). Three enabled once-only tasks are bound to this thread:

| Check | UTC | Europe/Berlin | Scope |
| --- | --- | --- | --- |
| First normal cutoff | 5 November 07:15 | 5 November 08:15 | Read-only operational observation |
| Second normal cutoff | 6 November 07:15 | 6 November 08:15 | Read-only comparison of both cutoffs |
| Final gate | 7 November 22:40 | 7 November 23:40 | Fresh acceptance; site-only retirement if all gates pass |

[Actual scheduled-task receipt](evidence/cloudflare-acceptance-schedules-2026-11-04.json). These are finite migration checks, not a new supplier automation or spending allowance. Do not restart the window merely to replace its timestamps. A concrete hosting defect must be repaired and its healthy observation coverage assessed honestly.

At each observation:

1. Verify current exact checked-main release/checkpoint, canonical origin, private access/data and automatic deployment selection. A subsequent checked release must preserve the existing policy and record its own actual identity; do not relabel `80c3d6c` evidence or rerun an old exact-head operator against changed main.
2. Verify old-key rejection, private source bounds, both crons, bounded consumer, queue/dead-letter backlogs and lease outcomes. Observe actual hourly/five-minute domain receipts, not only scheduler metadata. Never purge/replay uncertain work to make a check green.
3. Read the existing daily schedule, job and dated snapshot outcomes after the real local cutoff. Keep empty, review-held, error and useful-publication states distinct; no manual generation, review approval or reminder send is part of acceptance.
4. Retain every original financial record and compare its fields. A normal settlement needs its exact authenticated provider receipt; unknown holds stay reserved. Check source/model limits, review state and reminder consent independently.
5. Confirm the migrated webhook and usable paused recovery candidate. Record sanitized evidence in this directory and update STATUS/PLAN/DECISIONS/DEMO-LOG. Current private baseline/operator material is under `.local/cloudflare-preflight/`; never commit it.

## Recovery and final retirement gate

The unserved paused `f6436ca` candidate retains its verified native archive, immutable jobs/web versions and all nine execution flags false. A new **post-fence** version-URL check returns its exact health identity and `503 hosting_execution_paused`, rather than a revoked-key/database-access error. Temporary previews are restored disabled; current control/revision, primary versions, source and delivery stay unchanged. Earlier private-workspace/reload proof remains dated to that candidate. **No native recovery promotion/failover has been performed.** [Post-fence receipt](evidence/cloudflare-recovery-after-fence-2026-11-04.json), [candidate and earlier private proof](evidence/cloudflare-paused-recovery-candidate-2026-11-04.json).

After the complete window and two normal cutoffs, retire only **`recap-v0-radu` / `522a0657-c191-4355-8d72-2ed19c580b81`** if the fresh gates pass. Remove its obsolete site build hook and GitHub `NETLIFY_BUILD_HOOK`; remove a repository deploy key only after proving it is exclusive to this site. Check remaining callback/origin dependencies, then delete only that site and verify absence. Preserve the shared Netlify account, other sites and credentials/providers still used by Cloudflare. Verify Cloudflare deployment/health and subsequent site usage separately from shared-account billing. A failed gate leaves retirement blocked with its specific repair recorded.

No new billing, OpenRouter key, administrator setup or owner sign-in is required. The previous pause and switch report remains historical evidence; this document is the current continuation.
