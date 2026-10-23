# Provider-based collection plan — 24 October 2026

## Accepted planning direction

The founder explicitly directed planning around third-party parsing through Apify, Bright Data, RapidAPI and comparable services, with specialized Actors/jobs triggered only when needed by schedules, new data or errors. Do not depend on YouTube, X or Instagram granting sufficient direct API or scraping capacity. This supersedes the official-API-first recommendation in [the earlier 50-reader comparison](COLLECTION-50-USERS.md).

The sizing baseline remains **50 readers with at least 78 sources each: at least 3,900 follows**. Distinct public sources, platform mix, publication rates and actual overlap remain unknown. Plan for 3,900 distinct sources at that floor; sharing reduces work when it actually exists. Native feeds or official APIs can be optional optimizations, but the operating design and cost model must work without them.

This instruction authorizes planning. It does not start new provider jobs, subscriptions, credentials, schedules, a 50-reader rollout, generated transcription or model spending. Current production behavior is unchanged. [Trigger diagram](evidence/provider-collection-plan.html).

## System shape

`saved follows → shared source inventory → our controller/queue → specialist provider jobs → validated shared content → reusable analysis → private reader views/daily recaps`

Our application owns scheduling, routing, checkpoints, validation, duplicate prevention, recovery and costs. Third parties perform the external parsing/retrieval. A capability is not permanently bound to one supplier: a YouTube discovery role could use an Apify Actor, a Bright Data scraper or a particular RapidAPI publisher's endpoint through a versioned adapter.

Keep private follows, preferences, saves, annotations and personalized outputs reader-scoped. Share public originals and analysis only when content hash, processing version and output requirements match. One source followed by 20 readers should not cause 20 paid discovery/content jobs. Adding a reader to an existing source reuses the existing checkpoint/cache; genuinely new sources enter separately capped onboarding/backfill work.

### Specialist jobs and triggers

| Role | Trigger | Required result | Execution boundary |
| --- | --- | --- | --- |
| **Source discovery**, with platform-specific adapters | Hourly due time for an actively followed unique source; first follow of a genuinely new source; bounded catch-up | Stable original item IDs, original URLs, publication/update times when available, checkpoint/pagination, explicit per-source outcome | Small external lookup; batch compatible inputs where supported |
| **Original-content retrieval** | Validated unseen item, meaningful edited revision, or a known content gap | Usable original text/context, source attribution, metadata and original media references | External specialist; skip when discovery already supplies a complete validated payload |
| **Video captions** | Eligible new video or pending caption task without usable stored captions | Existing public transcript, real timing/coverage when available, typed temporary/unavailable outcome | External specialist; separate from metadata and generated speech transcription |
| **Validation, classification and analysis** | New/revised validated metadata or usable text | Safe normalized record, format/Shorts evidence, coverage, supported takeaways/keywords and processing state | Prefer our own workers; model calls only where needed and separately budgeted |
| **Media repair** | New media requires enrichment, or a relevant stored reference expires/fails while needed | Refreshed reference for the same exact original item, preserving text/history | Targeted external retrieval; does not trigger full archive recollection or reanalysis of unchanged text |
| **Provider reconciliation/recovery** | Provider callback, ambiguous submission, overdue result, unknown fee, or classified recoverable failure | Verified existing-run result/cost, safe retry time or eligible backup route | Internal controller first; external retry/fallback only after acceptance and spending gates |
| **Reader delivery/recap assembly** | Shared analysis ready, changed reader preferences, or chosen daily delivery time | Reader-private view/recap with citations and appropriate language/interests | Internal reader jobs; does not recollect an unchanged source |

These are capability boundaries, not a requirement to deploy a server or start a paid Actor for every row. Normalization, deduplication, budget decisions, callback handling and ordinary state transitions belong in inexpensive application jobs. Metadata classification can run before expensive caption retrieval; text analysis waits for usable content. Analysis and daily synthesis remain separate from parsing and have their own readiness/cost criteria. The unresolved unknown-format presentation policy remains tracked in [the content audit](CONTENT-ANALYSIS-AUDIT.md); this plan does not silently choose it.

## Scheduling and data-driven triggers

1. **Hourly scheduler:** mark due active sources and enqueue work; distribute deadlines through the hour rather than launching all 3,900 targets at the same instant. Keep one scheduling authority. Any vendor-side schedule must enter the same deduplication/reservation controls rather than start paid child jobs outside our ledger. Keep the requested hourly cadence. Slower quiet-source tiers require an explicit later product choice, not an automatic cost-saving downgrade.
2. **Small discovery lookup:** request only what establishes new/changed identities and a safe checkpoint. A reliable quiet outcome ends the path. An empty, partial or blocked response is not automatically proof nothing changed.
3. **Validated item event:** canonical deduplication/checkpoint checks run inside our application before any further paid operation. Reuse existing content and suitable analysis. Paginate until the last known checkpoint or an explicit bounded/deferred state, with an overlap window for delayed/edited posts.
4. **Content-ready event:** fetch captions/context only when missing, then trigger analysis only for new/revised usable input. A title/description-only video must not be labeled a completed spoken-content analysis.
5. **Completion callback:** authenticate/verify the notification using the provider's supported mechanism, validate its shape and correlate it to our server-owned job. Persist a durable receipt and acknowledge promptly. Retrieve the expected provider account/run/Actor or endpoint/input manifest using our stored references, validate outputs and create the next internal event transactionally. Ignore callback-supplied reader identities or arbitrary source/endpoint URLs. Do not let raw provider webhook payloads directly create paid work.
6. **Recovery timer:** inspect stuck jobs, unknown costs and stale sources independently from new-source discovery. A missed callback does not strand accepted work indefinitely.

Use idempotent consumers and a transactional event/outbox pattern. One stage has one active lease for the same source/item/revision; account switches, unfollow and deletion must retain their existing late-result fences. Preserve old identities, history, annotations and user-created collections through migration to shared collection. Do not bulk-reset/reseed reader archives.

## Error-specific recovery

| Observed condition | Planned response |
| --- | --- |
| Request times out without a known outcome | Keep the submission ambiguous; recover/poll the existing run or request reference. Do not POST another paid job merely because our HTTP request ended. If identification is impossible, retain the hold and require reconciliation. |
| Accepted job remains running or lacks final cost | Poll/reconcile that same job using trusted stored references; retain unknown-charge reservation. |
| Confirmed transient network/provider 5xx or throttling | Honor provider retry timing, apply bounded backoff/jitter and a small attempt limit. A validated alternate provider may be used within the same global spending controls. |
| Provider says succeeded but required content is absent, misattributed or malformed | Reject downstream completeness, retain diagnostics, then choose a gap-specific retry/backup if the original is still eligible. Never generate an analysis from metadata while claiming full content. |
| One provider returns 404 for an apparently public original | Treat deletion as unconfirmed; validate identity and distinguish a provider failure from source unavailability. A bounded confirmation route may be appropriate. |
| Confirmed unavailable/private/deleted original, or confirmed absent captions | Mark the appropriate coverage/unavailable state. Do not rotate suppliers indefinitely. New-video caption readiness can have a bounded grace/retry window. Generated transcription remains a separate product/budget decision. |
| Authentication/configuration failure, exhausted budget or disabled policy | Pause the route and surface the reason. Do not use fallback to bypass a disabled route or spending gate. |
| Stored media reference expires | Run exact-item media repair when relevant; keep the original record and link if recovery fails. An authorized reader request must still pass per-item deduplication, cooldown and spending gates; anonymous public-page traffic must not directly launch paid repair. |

A backup is another provider approved for the same capability, not just a second hostname. Track underlying services: two Actors or marketplace APIs can wrap the same upstream and fail together. After repeated provider failures, open a circuit, stop new calls to that route, and use bounded health probes/cooldown. Exhausted retry work remains visible with an operator review path.

## Provider adapters and selection

Maintain a registry per **platform × capability**: primary and eligible backup, exact Actor/endpoint/build/schema version, supported inputs and limits, output/coverage contract, underlying dependency, concurrency/rate limits, job/callback support, unit/minimum/empty-response charges and last measured quality/cost.

- **Apify:** candidate specialist Actors or our wrappers. Its documented webhooks can signal run completion/failure; our controller still verifies and validates results. Where supported, use exact reviewed builds and provider-enforced total-charge caps. A maximum item setting is not a general promise about output length or complete useful content. [Asynchronous runs/limits](https://docs.apify.com/api/v2/actors-runs-post), [webhook events](https://docs.apify.com/integrations/webhooks/events), [delivery/retry behavior](https://docs.apify.com/integrations/webhooks/actions).
- **Bright Data:** candidate scraper capability behind the same contract. Its async trigger returns a snapshot reference; notification and actual-data delivery are distinct. A synchronous 202 can continue as an existing snapshot rather than another submission. Preserve per-input errors. [Async requests](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests), [data delivery](https://docs.brightdata.com/products/scrapers/scrapers-library/data-delivery).
- **RapidAPI:** evaluate the exact publisher/API/endpoint, not the marketplace name alone. Billing units, endpoint coverage, subscriptions, overages and hard limits vary. A common marketplace does not imply a common job/webhook protocol or independent parser backend. [Plans and billing configuration](https://docs.rapidapi.com/docs/hub-listing-monetize-tab).

Do not select providers solely from advertised record prices. Compare incremental discovery, empty/unchanged checks, pagination, edits, deleted/private responses, Shorts/live metadata, full transcripts, post context/media, retry behavior and output quality. Headline title/description success is not usable full-content coverage. Existing bounded Apify evidence is a starting point, not proof of every future capability or throughput level. Bright Data/RapidAPI roles remain candidates until the exact endpoint has been assessed.

## Costs and batching at 50-reader scale

At the minimum 78-source baseline with no reuse, hourly discovery produces **93,600 check opportunities/day or 2,808,000 per 30-day month**, before retries/backfill. Discovery itself can be paid even when no new item exists. Sharing avoids duplicate lookups across followers; checking first avoids unnecessary deep content retrieval. Neither guarantees free quiet-day operation.

Batch compatible due sources by platform, supplier, capability and deadline. For illustration, if a provider safely accepted 25 inputs/run, 3,900 due sources would need 156 launches/hour instead of 3,900 single-source launches. That can reduce startup/coordination overhead; it does not automatically reduce billed source requests, returned rows or pricing events. Actual batch sizes must be measured against provider contracts and partial-failure behavior.

Reserve bounded worst-case cost before every paid operation, including discovery, pagination, captions, repair and fallback. Enforce job, capability/provider and global daily/monthly limits across all child Actors. Provider hard caps are useful additional enforcement; an HTTP timeout is not a billing cap. Reject an unbounded route or use a sufficiently bounded fixed-price operation. Unknown costs retain their holds and observed fees use the existing nondecreasing rule.

Keep one actual fee per external job/source and a separate, explicit reader cost-allocation rule. Report discovery fees even on quiet sources; show retrieval, caption, repair and analysis costs separately. Preserve both supplier job accounting and allocated source/reader/day totals without double counting. Use database aggregation/rollups and server-paged details; the existing 10,000-row scan bound cannot support a full day at the no-overlap baseline. Private tokens, account identifiers and raw reader follow graphs never belong in public logs or provider callback responses.

Estimate monthly cost from unique sources, platform-specific publication rates, paid quiet checks, usable-content success rate, transcript duration, retries, fixed subscriptions and infrastructure. Do not inherit one reader's temporary daily cap as the budget for 50 readers, and do not quote the full service from a primary-result-only price.

## Implementation sequence and acceptance — proposed, not executed

1. Freeze capability contracts and build a provider comparison matrix for discovery, full originals, captions and repair. Identify a qualified primary/backup per required capability. Measure a small approved sample before buying new subscriptions or scaling metered work.
2. Design shared source/item/job records with reader-private associations and safe migration from the current per-reader state. Preserve existing run references, charges, archives, annotations and deletion fences.
3. Implement our dispatcher, durable queue/outbox, per-stage leases, cost reservation, callback receipts, polling reconciliation, per-input validation and typed errors. External runs are only launched after these controls pass.
4. Add platform-specific discovery and original retrieval; then caption/format readiness, exact-item media repair and independently budgeted analysis. Cache validated results and skip already-satisfied work.
5. Add bounded retries, capability-specific provider failover, circuit breaking and visible stale/pending/budget-paused states. Provider changes should not change the reader's source/item identities.
6. Verify a 50-reader/78-source no-overlap workload through synthetic queue/load/failure tests without sending synthetic readers into production. Separately validate bounded real provider requests for representative coverage and actual billing; do not run a paid50-reader collection as a surprise test.
7. Observe hosted scheduled/event-driven operation over 48–72 hours: fresh publications, quiet checks, bursts, missing callbacks, duplicate callbacks, ambiguous starts, incomplete output, recovery, budget stops and catch-up. Check discovery freshness, usable-content delay, analysis readiness and exact cost reconciliation independently.

This is the revised planning baseline, replacing official-platform quota as an architectural requirement. No live collection trigger, provider configuration, supplier subscription, quota application or new spending was performed while preparing it.
