# Free-first retrieval implementation

5 November 2026. The founder authorized implementation in this order: **YouTube, Instagram, X**, preferring cheap/free methods and using paid Actors only after failure, with failures and successes visible in the backend. This increment implements discovery and source-provided text/captions. Generated speech transcription, Reel audio/image extraction and complete-history guarantees remain separate unfinished work.

## Behavior

| Platform | Free methods | Bounded paid fallback |
| --- | --- | --- |
| YouTube | Existing RSS; then the public Videos page with stable channel/video identity and exact watch-page publication timestamps; existing native captions | Existing reviewed YouTube Actor, at most three recent uploads per channel/UTC day, maximum US$0.02 reserved through the same reader/global budgets; available subtitles included to avoid buying the same retrieval again |
| Instagram | Public profile JSON; then public page data; strict profile and per-post owner matching | Existing reviewed platform Actor. The backup requests only its capped newest posts and applies the immutable timestamp window locally, avoiding its observed blocked datacenter-only date-window route |
| X | Public syndicated profile timeline, with exact author/string-ID/date validation | Existing reviewed Xquik build in profile-tweets mode, with the same explicit time/item/cash limits and local window validation |

Free public endpoints can be blocked or change format. Missing identity, login pages, empty/unusable output and stale dates do not establish quiet/complete coverage. No new supplier subscription, external account login, reader cookie or credential forwarding is introduced.

YouTube discovery fallback is separate from existing per-video caption jobs. It has a durable channel/day identity, preserves ambiguous launch holds and does not advance the failed RSS validator/cursor. Later polling reuses the actual stored run ID. Current build/price verification, reader admission and the aggregate source-proof ceiling still apply. The three-item fallback is an explicitly incomplete recent sample; Shorts/live-tab coverage is not inferred from the Videos page.

Social jobs are now created before reserving paid money. Free retrieval therefore remains possible when the paid allowance is exhausted. Only a verified paid launch reserves/claims money. Existing paid jobs, reservations, unknown charges, proof ownership, concurrency limits, current source membership/window checks and deleted-reader-history protection remain in place.

## Backend inspection

`collection_retrieval_attempts` records each method's start before requesting data, then its success/partial/empty/failure/blocked outcome, HTTP/error code, count and actual provider reference where available. Unfinished attempts remain visibly running with no completion recorded. Parent/method/start identity and final outcomes cannot be rewritten. A failed log write prevents progression to an unlogged paid fallback.

Only the server can access the table. The admin's existing **Collection jobs → Details** and **Collection costs → Inspect log** show attempt history in the existing rows. An authenticated reader's own activity remains scoped through authorized parent IDs; other readers' attempts are not queried. Diagnostics contain allowlisted counts/flags, never raw source content, arbitrary provider messages, private follows, reader identities or credentials.

Instagram's uppercase `RUN_REPORT` and Xquik's optional `diagnostics`/`run-report` records are read from the exact stored run's own key-value store. Blocked requests, unavailable targets and filtering counts are retained; an absent optional report is distinguished from a failed report read. Empty blocked runs are marked as failures, while any valid partial source text remains usable with its gap notice. Optional diagnostic-read failure does not discard already retrieved data or manufacture a known final charge.

The provider run ID is saved before completing the launch-attempt log. A subsequent telemetry failure therefore leaves recovery with its exact run reference rather than encouraging another POST.

## Verification and release boundary

[Implementation evidence](evidence/free-first-retrieval-2026-11-05.json) records actual local checks, hashes and limitations. Unit checks cover native success, free-failure/paid ordering, no HTTP after failed telemetry, owner/date rejection, immutable paid identities, fixed Actor bounds and parser behavior. Disposable PostgreSQL checks exercise the full migrations, cash/lease concurrency, native import at an exhausted paid allowance, source deletion, log privacy and immutable outcomes. The Cloudflare workerd checks remain isolated from production/provider calls.

A small direct local probe of public NASA endpoints produced no verified free content: YouTube transport failure, Instagram HTTP 404/unrecognized public page, and X HTTP 429. These are real local failure-path observations, not successful free-service proof or a hosted-platform acceptance test. The implementation does not advertise these endpoints as reliable coverage. No paid provider run, production worker invocation, production database write, review approval or email was made by this implementation session.

Migration **20261105011050_free_first_content_retrieval.sql** must be applied and verified before this application release is activated. It adds the private attempt table, extends the existing hourly reservation validator for the distinct bounded channel/day scope and defers new social reservations until launch. Existing data/financial records must be preserved, and the database baseline/checked release evidence refreshed through the existing release process. The current checkout builds on the Netlify-retirement branch; the code PR is stacked on that existing cleanup PR.

Production migration, merge/deployment, hosted admin rendering, real paid-fallback results and measured content-yield improvement are separate pending claims. Current provider builds, historical uncertainty, human review and reminder opt-out remain unchanged. No owner setup action or new credential flow is needed to review this increment.
