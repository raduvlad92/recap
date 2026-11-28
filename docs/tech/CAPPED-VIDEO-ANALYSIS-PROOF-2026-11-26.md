# Operator runbook for the $0.75 video analysis proof

The proof uses one frozen, ordered manifest of up to ten current YouTube transcript revisions, with one recap and one keyword task per video. The first sample needs **ten** videos and both acceptable drafts on at least nine. Choose eligible revisions with neither task previously attempted. The routine does not reopen historical task IDs or purchase against unresolved charges.

No wave has been prepared, authorized, or run in production. Keep automatic analysis disabled on both Workers and schedule this one-off check after the PM accepts the exact release and authorizes the launch.

## Prepare and authorize

1. Apply the additive proof migration through the checked release process. Verify the accepted release SHA, active Cloudflare ownership, old-host fence, exact deployment revision, both automatic-analysis flags off, monthly and owner/global daily headroom, and deferred collection scope. Coordinate a clear release window so no further cutover overlaps the proof.
2. Select ten short, exact archived videos within the approved pilot. Verify source freshness, usable transcript, workspace eligibility and the reader’s opt-in cutoff, absence of prior tasks or unresolved calls on either source hash, and an offline estimate that leaves the next full $0.10 reservation available. Use the existing source fingerprint and the exact archive revision. The three-channel cost and first-wave choice are in the [November proposal](VIDEO-ANALYSIS-REPLAY-2026-11-26.md).
3. As a service operator, call `prepare_video_analysis_proof(p_id, p_user_id, p_release, p_videos)`. Use a pre-recorded UUID and the accepted release SHA, and supply a JSON array ordered as approved. Each entry contains `updateId`, `sourceHash` (SHA-256 of the exact UTF-8 transcript), and `sourceRevision` (the result of `public.content_analysis_source_revision(record)`). Save the returned manifest digest and read back the ten video IDs and twenty unstarted task slots using `read_video_analysis_proof(p_id, p_manifest)`. Preparation creates no sessions or model reservations.
4. After explicit launch authorization, record its opaque reference UUID and call `authorize_video_analysis_proof(p_id, p_manifest, p_authorization_ref)` with those exact values. This action binds the serving release, epoch and revision for up to six hours. Read back the authorized receipt. A different manifest or revision fails closed. Use the same UUID and digest if an acknowledgement is ambiguous.

## Execute and read back

From the clean checkout at the accepted release SHA, load the existing private backend credentials into the process using the approved operator path. The runner uses the existing Supabase service configuration, `APP_URL`, `CONTENT_ANALYSIS_WORKER_SECRET` and `OPENROUTER_API_KEY`. Keep credentials and the manifest outside Git.

```sh
mkdir -p .local
node_modules/.bin/esbuild scripts/run-capped-video-analysis-proof.mts --bundle --packages=external --platform=node --format=esm --outfile=.local/run-capped-video-analysis-proof.mjs
node .local/run-capped-video-analysis-proof.mjs --launch-authorized-proof <proof-uuid> <manifest-sha256> <accepted-release-sha>
```

The operator claims one task at a time and uses the same generation, verification and review-only finish functions as automatic drafts. The existing transaction reserves each complete $0.10 allowance. A private trigger locks the proof and checks its exact current source, task, model role, release fence and running commitment before the normal reservation becomes visible to the provider caller. Every retry pays from the same $0.75 ceiling. The combined monthly, global and owner daily and finite per-task limits still apply. An unresolved or in-flight request stops further admission. The receipt preserves any higher observed billing, including external billing changes received after closure.

The runner returns a closed receipt with all target states, per-call amounts, aggregate commitment and unresolved calls. Read `read_video_analysis_proof` again after settling any known provider evidence. If an RPC result cannot be confirmed, read the receipt and use `close_video_analysis_proof` to end admission when needed. Do not repeat an ambiguous task or launch. Closing the wave permits late financial reconciliation and preserves the original charge evidence.

Require exact pending recap and keyword drafts and independent review for usefulness and source grounding before counting each video. An incomplete, unstarted or budget-held pair still counts in the fixed sample denominator. Preserve the founder's existing held decision. Publication and general runtime enablement require separate decisions.

## Offline evidence

Disposable PostgreSQL exercises exact binding and authorization, native role denial, one-at-a-time claim, concurrent reservations, permission and source/revision drift, pending-only draft persistence, late billing after close, and a refusal whose call row rolls back. The test settles one full reservation partially, books the larger of actual and observed fees, admits the next call below the ceiling, and refuses the following call at $0.74 committed. The synthetic operator tests cover a review-only finish, unresolved-call stop and ambiguous acknowledgement. Production writes, provider calls and spend were zero.
