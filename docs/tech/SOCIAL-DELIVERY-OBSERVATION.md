# Bounded social-delivery observation

This is the read-only follow-up to the [31 October release](SOCIAL-DELIVERY-2026-10-31.md). Three daily checks cover the first 72 hours after deployment. Scheduling a check does not establish that those hours or delivery cycles have passed.

Read the current release evidence and application state before assessing each checkpoint. The private `.local/social-delivery-20261031/observe-readonly.sql` contains a bounded read-only query against the existing recap Supabase project. The accompanying `aggregate.mts` reads the owner's saved reminder preference and aggregate supplier evidence. Neither starts a supplier job or sends mail. Keep credentials, reader identifiers, follows and source bodies private.

Each check records:

1. The published deployment and functional commit, source jobs with actual run references, accepted text and unknown/partial coverage. Distinguish proof jobs from normal followed-reader imports. A successful or empty Actor run is not exhaustive access or a quiet-source result.
2. Supplier charges and reservations against the existing US$45 aggregate ceiling and US$5 platform pilot limits. The release checkpoint retains four new uncertain starts totalling US$0.20, in addition to 12 historical unknown jobs. Never release or replace them merely because they are old.
3. New social analysis tasks, pending review outcomes and the shared US$10 lifetime / US$5 UTC-day / US$0.10-per-call model bounds. Administrator approval remains required for publication.
4. Actual local-time daily snapshots, their ready/partial/awaiting-review state, source coverage and exact original citations when findings are available. Check at least two due cycles. No review may be approved merely to create a ready-briefing test result.
5. The owner's reminder preference stays off, with no enabled reader sending policy or email activity attributable to this verification. Provider acceptance, delivery and Inbox proof remain deferred.

Compare each result with the release baseline and prior checkpoint. Flag new failures, new uncertainty, long-expired leases, persistent overdue active sources, unexpected publication or email, or breached limits. Existing ambiguous jobs and proof-only source records must not be mistaken for a new regression. Record what needs recovery without performing it.

The observation may read database/application/hosting state and write sanitized checkpoint notes. It may not contact creator sources, start/retry supplier or model jobs, approve content, change settings or limits, release holds, deploy code, send email or create subscriptions. Existing application schedules continue under their previously authorized finite policies.

At 72 hours, save a final verdict separating runtime liveness, useful platform content, daily publication and deferred email proof, then disable the observation task. If a new material failure blocks a trustworthy verdict, save a precise handoff and stop the observation early. A further paid recovery or wider rollout requires its own concrete scope; this observation adds no allowance.
