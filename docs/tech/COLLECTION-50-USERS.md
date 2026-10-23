# Collection design for 50 readers — 24 October 2026

Founder steering: “don't recommend for the current setup. assume we have 50 users, each with at least twice as many sources than I currently have”. This changes the planning baseline to **50 readers × at least 78 followed platform accounts = at least 3,900 follows**. It supersedes the one-reader sizing recommendation in [the earlier comparison](COLLECTION-RELIABILITY-OPTIONS.md). It does not authorize enrolling/enabling 50 real readers, new supplier subscriptions, quota applications or spending changes.

The exact future platform mix, cross-reader overlap and publication rates are unknown. Use the minimum 78 accounts/reader for arithmetic; larger accounts increase load. “Source” below means an exact public platform account/feed, not a person spanning several platforms. A creator's YouTube, X and Instagram channels remain distinct sources. [Interactive model](evidence/collection-50-users.html).

## Size the collection once per unique source

| Illustrative sharing scenario | Unique source accounts | Hourly check opportunities/day | Per 30-day month |
| --- | ---: | ---: | ---: |
| No follows can reuse a source check | 3,900 | 93,600 | 2,808,000 |
| 50% of follow-level checks eliminated by sharing | 1,950 | 46,800 | 1,404,000 |
| 90% eliminated by sharing | 390 | 9,360 | 280,800 |
| All 50 follow the same 78 accounts | 78 | 1,872 | 56,160 |

Reuse here is a reduction relative to 3,900 follow-level checks, not pairwise audience overlap. These are scheduled check opportunities, not guaranteed HTTP requests, API quota units or billed supplier jobs. Push signals/caching can change the requests actually needed. Retries, pagination and initial backfill are extra. Plan capacity and unit economics for no reuse; sharing is upside until measured. No-overlap discovery averages only 1.08 checks/second when spread through the hour, so dependable access, usable content and recovery matter more than building a large crawler fleet.

Every candidate architecture should normalize a shared public-source inventory; keep private reader follows/settings/annotations separate; discover each unique source once; retrieve each original item once; and reuse source facts across entitled followers. Analysis can reuse a result only when source hash, processing/version and output requirements match. Reader-specific interests, languages and daily briefings may still incur separate work. A new user's initial backfill should be a separate queue/cap from ongoing fresh arrivals.

## Three architectures

1. **Shared platform hybrid — recommended.** Use platform-specific discovery: official YouTube uploads-playlist checks with adequate quota, optional WebSub notifications, native feeds where reliable and managed minimal-result X/Instagram discovery. Feed unseen identities into a durable queue, validate usable content, then run shared source analysis and private delivery. Retain a tested secondary provider for confirmed retrieval failures, never parallel paid duplicate launches. Best expected cost/maintenance balance and makes costs follow unique sources/new items. Trade-offs: more integration, quota/access dependencies, separate platform adapters and a second provider to validate.
2. **Shared managed-provider collection.** Batch unique sources through managed suppliers for discovery/content, with one verified backup. Suppliers handle more blocking/parser maintenance; broad platform integration can be quicker. Trade-offs: quiet-period discovery, repeated results and run minima can dominate the bill, plus supplier dependence. Sharing/deduplication is still mandatory. Existing Apify runs are useful evidence, but do not prove recurring completeness across the future 50 readers. Bright Data is an advertised alternative, not verified access for this population.
3. **Own crawler/proxy workers.** Run our own platform parsers and networking/proxies with shared inventory and queues. Greater control and possible unit savings once volume is proven. Trade-offs: ongoing engineering, blocking, parser changes, content-validation and on-call duties. At 50 readers and roughly one baseline discovery check/second, this is unlikely to be the cheapest total-cost first choice.

Do not clone the existing per-reader hourly pipeline 50 times. Keep the existing backend stack unless measurements justify a move; a small worker pool, durable queue, per-platform limits and evenly spread source deadlines are sufficient starting primitives. Discovery, original-content retrieval, classification/analysis and reader delivery need separate retryable states and measurements. A collected title/description is not a transcript or completed analysis.

## YouTube quota is a real scaling dependency

For an illustration only, doubling the current source mix gives **42 YouTube  + 20 X + 16 Instagram per reader**. With no overlap this is **2,100 YouTube  + 1,000 X + 800 Instagram sources**.

One uploads-playlist page per YouTube source/hour costs one unit per call: **2,100 × 24 =50,400 units/day** before retries, pagination and metadata calls. This exceeds Google's documented 10,000-unit/day default shared allowance. At 50% reuse it is 25,200; at 90% it is 5,040. An all-YouTube 3,900-unique-source case would require 93,600/day. The prior 504/day one-reader argument cannot justify this rollout. [Current Google quota table](https://developers.google.com/youtube/data/determine_quota_cost).

WebSub can give prompt upload/update signals, but **WebSub plus hourly API reconciliation still uses 50,400 polling units/day** in the no-overlap illustrative mix. Six-hour API reconciliation would use 8,400/day, but a missed push could then wait about six hours for recovery; it does not provide a strict hourly catch-up guarantee. Google's push guide does not establish lossless delivery or a delivery-time SLA. [Notification guide](https://developers.google.com/youtube/data/guides/push_notifications).

For hourly API reconciliation at that size, obtain appropriate quota through Google's audit/extension process, with metadata/retry headroom, or price a managed discovery alternative. Approval/availability is not assumed. Extra keys do not expand one project's quota; do not shard the same service across projects to evade limits. [Quota extension](https://developers.google.com/youtube/data/guides/quota_and_compliance_audits), [policy clarification](https://developers.google.com/youtube/terms/developer-policies-guide).

## Costs: show the assumptions, not a false total

Monthly variable cost has at least four components:

`discovery checks × lookup fee + unique new usable items × retrieval fee + analysis/personalization + retries/infrastructure/storage`

Each platform needs its own publication rate, empty/unchanged-check billing and content success rate. A paid request made merely to learn whether a source changed may incur a fee. Deduplicating the result after paying for it does not undo that charge.

Illustrative YouTube **primary-result fees only**, using the current published US$4/1,000 event rate as a benchmark and the illustrative platform mix:

| Unique sources | New videos/YouTube source/day = 0.25 | =1 | =3 |
| --- | ---: | ---: | ---: |
| 3,900 | US$63/month | US$252/month | US$756/month |
| 1,950 | US$31.50 | US$126 | US$378 |
| 390 | US$6.30 | US$25.20 | US$75.60 |
| 78 | US$1.26 | US$5.04 | US$15.12 |

Every new YouTube video is assumed to incur exactly one primary-result charge in this benchmark; native successful retrieval could avoid it. These figures exclude X/Instagram, discovery charges, transcript add-ons, subscriptions/credits, AI, infrastructure, media renewal and backfill. They are not a full-content quote, price recommendation or forecast. Paid-plan discounts/minima change the actual bill. [Apify event pricing](https://apify.com/streamers/youtube-scraper/pricing). Bright Data's generic record pricing is a different billing unit and is not interchangeable with a per-check quote. [Bright Data pricing](https://brightdata.com/pricing/web-scraper).

For comparison, a hypothetical US$0.001 paid discovery lookup on every no-overlap hourly source opportunity would be **US$2,808/month before content**. This is sensitivity arithmetic, not a vendor quote. Source publication rate and empty-check charges must be measured before promising a low monthly operating budget. Do not multiply one reader's short-run US$0.076 observation by50: it includes a startup/backfill situation, native retrieval, missing content and a restrictive cap, not a stable production rate.

## Cost reporting and acceptance at this scale

Keep one authoritative provider fee per source job. Separately attribute that cost to readers using a documented rule. For example, a US$0.004 source pull serving 20 current followers is still US$0.004 platform spending; an equal allocation would show US$0.0002/user. These are internal attributed costs, not 20 invoices or authorization to charge readers. Private data and personalized processing remain reader-scoped.

Replace the current client/report-helper 10,000-row scan bound with database aggregation, daily source/reader rollups and server-paged details. At 3,900 hourly source checks, 10,000 records represent only about 2.6 hours: fetching a day's raw rows into an API helper cannot support accurate reporting. Preserve original-content history; choose diagnostic-log retention independently and keep cost totals reconcilable to authoritative jobs.

Proposed next increment: define the shared source/item model and allocation rule; establish quota and measured minimum-result provider access; benchmark no-overlap discovery/content volume; then run a hosted 50-reader/78-source capacity-and-failure trial with synthetic private identities and authorized source scope. Separate stale-source age, missing-content age, discovery, classification/Shorts, analysis and delivery readiness; test missed runs, duplicate notifications, provider failure, ambiguous launches, bursts, budget pauses and catch-up. Source freshness should have an explicit target and alert threshold. Literal zero external outages cannot be promised; recovery without silent loss/duplicate charges can be engineered and tested.

Research only. No 50-reader rollout, new quota request, supplier job, subscription or configuration/budget change was performed. Independent calculation review agrees with the scenario and quota arithmetic. Concurrent card/content implementation in the shared checkout is separate work.
