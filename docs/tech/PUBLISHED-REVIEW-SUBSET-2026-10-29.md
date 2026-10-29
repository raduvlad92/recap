# Keep published review results readable — 29 October 2026

**Deployed and verified.** The additive recap change and approved-keyword subset fix are live in functional `4e469ad22f42cb46ca89d9af26b85417b183a8ed`. Local, native, CI, exact hosted-asset and authenticated HTTP checks pass. [Sanitized release evidence](evidence/published-review-subset-2026-10-29.json).

## Founder flow

1. In [Review queue](https://recap-v0-radu.netlify.app/admin/?section=reviews), confirm or improve an individual keyword or cited recap proposal.
2. Read the published results on that same video. A published recap and at least one published keyword remain usable while further proposals await review.
3. Approve more material when ready. Keywords and distinct recap points append to the existing item. The open reader normally sees these changes on its next visible-page poll, about 60 seconds later.

Each new recap proposal still has at most six points with exact supporting quotes. Combined storage is bounded at 30 points; the card previews six and its native **Show more takeaways** control exposes all remaining points. Duplicate text is kept once. Reaching the limit refuses a new distinct addition atomically; existing points are never silently truncated.

## Scope and protections

Published display is independent of unfinished worker/review status. Worker progress, Shorts exclusions, followed sources, history and other feed preferences retain their existing behavior. This adds no strict filter requiring every feed item to be fully processed.

Approvals keep the same reader item and exact source version. Published recap text and valid timing survive later approvals; a refreshed caption cue can remove an unsupported timestamp without removing the finding. Current-source and review-revision checks remain. Original proposals, source quotes and individual decisions remain private and immutable. Rejecting a recap dismisses that attempt without removing already published points.

Updating recap provenance cannot make older keywords current. Before replacing or restoring the recap hash, the server preserves the separate keyword hash, including explicit unknown/null values. Old or unverified keyword inventories do not acquire freshness from a new recap.

For a mixed old/unknown keyword batch, a server-derived `keywordApprovals` field identifies only the names actually approved for this exact source version. The reader can show that approved subset while leaving old `videoKeywords`, topics, brands and batch hash intact. The field is rebuilt from private decisions, so provider/client input, pending items, rejected identities and changed sources cannot supply approval proof. Rejection refreshes that proof immediately. No unknown label is made public by certifying the whole batch.

Reader polling observes an archive change timestamp and cursor, so approval changes can appear without relying on a processing job changing. Collection time and job history remain separate. No new model call, training, broader processing activation or collection run is introduced.

## Verification obtained

- Final clean `npm run check` passes: **3,389 tests / 94 files**, catalogue validation, typecheck and production build (`full-check-clean.log`). Earlier failure logs are retained. The two old namespace comparisons were updated only for derived approval proof, with explicit current-hash/approved-label assertions and pending/rejected exclusions; original source, recap and history checks remain intact.
- Focused subset checks pass **98 tests / two files**, including 42 disposable PostgreSQL review tests. Actual legacy/inbox approvals, mixed unknown batches, forged proof, source changes, rejected aliases and combined recap/keyword backfill are covered alongside the earlier additive recap/cursor checks.
- Native fixture rollback QA and application pass for `20261029015509_additive_admin_recap_reviews.sql` (`1f3843cbeea76e53837938ad5d5bca1a36b52e9f3afadd920ba31727ebeaba10`) and the separate `20261029022238_approved_keyword_subset.sql` (`c2ad5caeb5887c956fe90f0b5859bc3e94cc6f3d00d1498362edda44a7aa7e0e`). The applied first migration was never edited.
- Native preservation comparisons pass across **16 groups** for each application. All original archive fields remain intact; the second comparison excludes only derived approval proof and the archive watermark. The existing **510 archives, 867 calls, 431 jobs, 140 legacy reviews and 257 inbox records** are preserved at that boundary.
- The narrow current-approval backfill affects **zero existing rows**: the four existing owner decisions were rejections. No approvals were invented or real decisions applied by verification.
- Latest CI **40807680198** succeeds for `4e469ad22f42cb46ca89d9af26b85417b183a8ed`. Ready Netlify deployment `6ae2b2f42a8acaf6561aad1c` is published **02:44:41.857 UTC**. The served main asset exactly matches the tested local build.
- Hosted checks at **02:46:18 UTC** pass owner/ordinary/anonymous access (200/403/401). Actual archive polling returns two consecutive 100-item pages without duplicate IDs, retaining the same polling window; anonymous status returns 401 and legacy job mode still returns 200. The review queue has **328 pending items**.
- Final readback preserves **867 calls, seven holds and US$9.270265626 committed**, with no new model call or spend. Runtime remains Off, with zero executing jobs/open scopes and 271 old queued jobs unchanged.

Release verification uses disposable fixtures and applies no real owner decision or model call. Hosted checks use authenticated HTTP and exact asset matching, not a new browser walkthrough. The founder can now use the existing review flow to add material to the same reader items while other proposals remain pending.
