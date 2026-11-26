# Release train 2 checklist · 26 November 2026

The PM owns this production window. Start after train 1 is accepted at its exact deployed main SHA and its approved scope is restored. R1 is the owner's project-scoped Supabase Management API credential with `database_migrations_read` for the existing `CLOUDFLARE_MIGRATION_READ_TOKEN` Actions secret. Confirm the checked deploy can read the migration journal with it.

## Pinned PRs and order

| Order | PR | Reviewed source head | Release role |
| --- | --- | --- | --- |
| Prerequisite | [#46](https://github.com/raduvlad92/recap/pull/46) | `68a71c9ea59965e5d4fad2301147bfe8dc84ac21` | Frozen train 1. Record its accepted main squash SHA, which is the serving predecessor for train 2. |
| 1 | [#53](https://github.com/raduvlad92/recap/pull/53) | `a45c0be1d103ba8a31b0115a5f93bd5683654cac` | Grouped review, analysis recovery and proof guard, reader changes and Clerk guard. |
| 2 | [#58](https://github.com/raduvlad92/recap/pull/58) | `a075200892387231eeb81a876a344f797dafe4f7` | Expire overdue unclaimed hourly frames. Preserve both HTTP expiry paths. |
| 3 | [#56](https://github.com/raduvlad92/recap/pull/56) | `9e60ce53345093d1a3baa75d70f44a4fedf3cf81` | Read-only Flow 6 and 9 scorer. Its scripts and tests trigger a checked main release. |
| 4 | [#61](https://github.com/raduvlad92/recap/pull/61) | `0a6daf8b0f96237960db38f665f74f35ae5c0aea` | Shared $18 UTC-month operating stop, tested on the current #57 base. |
| After restoration | Checklist | Exact head in the checklist PR's checks | Replay its Markdown commit onto accepted main. |

[#57](https://github.com/raduvlad92/recap/pull/57) at `76350d3fad64cd5ffb3c4b475c6f08735ed9b54e` is the integration witness on frozen #46. Keep it out of the merge sequence. The original #47 → #50 → #51 → #52 → #54 → #55 changes ship through #53. The 271-candidate video stays in train 2: stage the full group, explicitly apply up to 250, then explicitly apply the remaining 21. An unconfirmed response requires reload and reconciliation before further apply. Owner-held cases and review history remain fenced. [Review procedure](VIDEO-REVIEW-QUEUE-2026-11-26.md)

The single HTTP expiry implementation ships in #46 as `20261125181000_expire_unleased_http_hosting_work.sql`. [#42](https://github.com/raduvlad92/recap/pull/42) has the same migration blob and stays out of the release. Its historical dry run found zero rows. #58 replaces the shared claim function for hourly retirement and keeps its calls to #46's HTTP helpers. The disposable PG17 regression covers both stale HTTP paths, fresh and payload-bearing requests, expired running leases and pause/role fences.

The PM's separate Markdown PRs can land after train 1 and before the first train 2 code merge, in this rehearsed order.

| PR | Reviewed head |
| --- | --- |
| [#59](https://github.com/raduvlad92/recap/pull/59) | `9be0d740b73b9546b595c6c7636ab8a19513837f` |
| [#60](https://github.com/raduvlad92/recap/pull/60) | `ff3d7533110cb651081a3cf99165eca009acb5d9` |
| [#62](https://github.com/raduvlad92/recap/pull/62) | `6a46410992b52683f4121350abcf2a686d42f8eb` |

### Replay before opening the pause

- Fetch and verify each pinned source head, check the final release deltas and record the actual main predecessor. The frozen replay and the simulated #46 squash plus #59/#60/#62 both applied cleanly. The latter matched #61 across the Worker, application, tests, scripts, workflow and migrations. Keep any actual main drift outside the rehearsed patches under review.
- Prepare each PR delta against its accepted predecessor. The replay bases to exclude are #46 for #53, reviewed #53 for #58, `de01bfca2bc71f0d1fccb55c72bb45c976b46135` for #56 and #57 for #61. For a squash merge, rebase only that delta using `git rebase --onto <accepted-predecessor> <recorded-replay-base> <recorded-source-head>` in a disposable checkout. Retarget to main, use an exact force-with-lease if needed, compare the staged diff against the reviewed layer and require green checks on the resulting head. Prepare #53 before quiescing. Changes to later squash SHAs can require fresh checks within the pause. Keep the exact proposed and merged SHAs in the release record.
- After #61 is accepted, replay just the checklist's Markdown commit. Its draft PR uses #57 as its base so the existing path-filtered workflow tests the full candidate with #61. Before landing the document, verify the retargeted diff is Markdown-only. Mark any replayed checklist head and its earlier hosted check evidence separately.

## Migrations and exact readback

The digests are SHA-256 of the committed source bytes and the single statement recorded in the Supabase migration journal. Use the diff from the actual serving predecessor to each exact main candidate to verify the migration set.

| Before serving | SQL file | SHA-256 |
| --- | --- | --- |
| Train 1 catch-up from `6a794cb` | `20261125174500_automatic_video_analysis_recovery.sql` | `c6558e4a9ddaa410823eac567d57115ffa9deeb9efd68e65cc608cca3906c898` |
| #46 | `20261125181000_expire_unleased_http_hosting_work.sql` | `3d33dbcb87894c456a4a940107d1e6d5e43e75581c3de791d67d9f5fc22956ce` |
| #46 | `20261125230323_checked_youtube_collection_pilot.sql` | `ddd44ddd4f6c1c88e65f9871755c887f8a6512613f22c81ae09c21a0ab667a4e` |
| #46 | `20261125232024_provider_generation_ack.sql` | `5aacb827754236ab1cf7e263444be5029e46b7b6d8f4967b3180c0d75a33cc7c` |
| #53 first | `20261126004139_admin_video_review_batches.sql` | `0b96fe8b736b10c3c2e9eaa1d516a480b5ae59a3ca028996a465445766cc1064` |
| #53 second | `20261126010136_capped_video_analysis_proof.sql` | `15298f264efb40d70c8b6b74429b580991875de4b06b964fd16919ad100019ff` |
| #58 | `20261126032659_expire_queued_hourly_cron_slots.sql` | `0b818e18a2301f57b3b22a063f64015053e80947ade627c37e6fec9835a99ba7` |
| #61 | `20261126034741_monthly_provider_operating_stop.sql` | `3bfa3876083653154ff2d64f244abd5db5259ad8609bf571094bad9cc9cfc958` |

Verify a decryptable backup of the application and migration schemas. Read back train 1's entries first. For each absent, approved train 2 entry, generate the atomic transaction with `node scripts/prepare-reviewed-release-migration.mjs supabase/migrations/<file.sql> <sha256>`, review it and apply once through the approved database path. Read back version, name, statement count of one and digest. If acknowledgement is ambiguous, read the same journal entry before any further action. A different digest or unexpected function definition stops the release. The controller verifies the journal again before promotion. #56 adds zero migrations. [Checked migration procedure](CLOUDFLARE-RELEASE-CONTROLLER.md#migration-and-failure-gates)

## Single pause and checked restoration

1. **Capture the baseline.** Record main and serving SHA, both Worker version IDs and traffic, health, hosting epoch and revision, source pin, Clerk build/runtime tuple, flags, schedules and consumer configuration. Capture scope and envelope plus settled, unresolved and committed provider amounts. Keep the approved Cloudflare deployment path clear, review rollback artifacts, and finish #53's PR checks while scheduling remains active. The two #53 migrations may be applied and verified in the approved database window before quiesce.
2. **Quiesce once.** Save the PM's pause UUID before using `quiesce_hosting_release_checked` with the accepted #46 epoch, release and revision. Read back that exact revision and paused state. Require the checked drain view to show no queued business work, running work or expired running leases before advancing. Keep cron and consumers configured. An expired leased HTTP frame or stale business frame requires the existing reviewed exact-row procedure and separate authority. Preserve original row and lease evidence. [HTTP expiry and drain](CLOUDFLARE-RELEASE-CONTROLLER.md#unleased-http-requests) · [Scoped recovery](CHECKED-YOUTUBE-PILOT.md#installation-and-rollback)
3. **Advance in order.** #53 → #58 → #56 → #61. Apply and read back the #58 and #61 migrations before the corresponding main merges. For each layer, wait for the exact main push, successful active artifact build and `deploy`, the acknowledged `complete` checkpoint, both matching Worker versions at 100%, healthy exact-SHA response, and the matching paused control revision. Record run ID, merged SHA, artifact and checkpoint IDs, versions, epoch and revision. Move main only after those reads. A push or build could otherwise invalidate the in-progress checked release.
4. **Restore once.** On the final #61 deployment, verify the last completed checkpoint and unchanged saved scope/flags. Save a fresh resume UUID and restore using the final epoch, release and revision. For ordinary TechLinked with no installed pilot use the existing checked resume through `advance_hosting_release_checked`. For an already approved and installed pilot, use `restore_hourly_youtube_pilot_checked` with the saved reviewed channels, reader, recurring flag and proof date so the scope binds to the new release. An expired one-day proof needs a PM restoration decision. Read back the exact resume revision, active control, versions, cron, consumer, scope, caps and holds. New paid activation, automatic analysis, daily briefing and Clerk L2 have separate gates.

**Estimated pause: 30–60 minutes** for drain, four sequential checked main runs, migration witnesses and restoration. Reserve up to 75 minutes if rebased PR checks must complete inside the pause. This is a planning estimate. The next genuine hourly slot may take up to an additional hour after restoration.

## Acceptance readbacks

- **Flow 2.** Require public health HTTP 200 with final SHA and mode `active`, matching served versions, and anonymous admin HTTP 401. With approved headless sessions, verify the existing reader's saved sources/history and unsaved source preview, ordinary reader admin HTTP 403 and owner admin HTTP 200. Read-only production preparation uses no authenticated route that writes access-audit or work records. The PM's live acceptance must account for ordinary HTTP admission and admin access audit writes. Keep authenticated native tracing and HAR disabled. [Clerk audit and L2 procedure](CLERK-PRODUCTION-CUTOVER-2026-11-26.md)
- **Flows 4 and 5.** Read the grouped owner review queue, verify the migration and reviewed draft eligibility, and leave the owner hold in place. Use synthetic fixtures for the 250+21 apply and uncertain-response recovery. Verify the paid-proof migration and separate $0.75 guard by journal and read-only inspection. Paid proof, publishing and draft writes require their own approval.
- **Flows 6 and 9.** Use read-only database/server metadata to match the first genuine hourly frame to the final epoch and release, its claim/completion, source scope, archive/transcript outcome and fee receipts. Record zero or partial yield as observed. Read the $18 operating limit and $20 accounting backstop, existing envelope, caps and holds. Validate $18 refusal and concurrency using disposable database tests. Never create a paid reservation for readback. Use `node scripts/flow9-readiness.mjs --start <UTC> --end <UTC>` for a fixed observation window. A new 72-hour acceptance clock needs approved analysis and briefing activation plus the first useful cutoff. [Scorer](FLOW9-UNATTENDED.md) · [Activation gates](flow69-switch-on-plan.md)
- Record credential scope, lifetime and revocation for any short-lived audit access. Leave secret values and private identities in their approved custody. Preparation used local Git, GitHub and disposable PostgreSQL with zero production access, provider spend or temporary credentials.

## Stop and recover

On unexpected writes, billing, authorization, missing evidence or drift, stop advancing main. Reconcile the exact saved revision, checkpoint, serving versions and any pending action. For an expected transient read, retry once at the operator level. The checked controller's existing exact-identity acknowledgement handling remains part of its normal execution. Resume an interrupted deployment only with its existing checkpoint and checked artifact after readback confirms the pending phase. Never blindly repeat a mutation.

The rollback target is the accepted #46 release and exact saved Worker versions, or a later fully accepted pair if the PM authorizes it. Establish a checked paused revision and use the existing recovery path to verify both versions, source pin, control and health. Worker rollback leaves SQL installed. A regression in the #58 claim function or #61 capacity functions requires a reviewed forward migration with its own journal digest while paused. Retain applied history, reader decisions, leases and spend holds. Preserve the $18 gate for any new paid activation. Rebind or roll back the three-channel pilot through the checked TechLinked restoration procedure, then verify the ordinary scope, caps, schedules and consumer before resuming. [Recovery precedent](YOUTUBE-BUDGET-RELEASE-2026-11-25.md)
