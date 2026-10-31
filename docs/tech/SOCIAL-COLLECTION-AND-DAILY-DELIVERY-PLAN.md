# Automatic social collection and daily delivery

**31 October execution update:** the founder approved implementation with “ok, do it” and parallel agents. [The execution record](SOCIAL-DELIVERY-2026-10-31.md) now tracks implemented components, real supplier outcomes and remaining release/operational gates. The owner explicitly keeps reminders off. The original proposal below is retained as the planning baseline; its planning-only status and unperformed actions describe that earlier checkpoint. This approval does not approve the wider SPEC/PLAN v1.1.

Version **0.1 — proposed implementation plan**, prepared **29 October 2026**. Requested: finish automatic X, Instagram and LinkedIn collection, daily briefings and optional reminder email, preferably using separate Apify Actors per platform.

This extends the [provider collection direction](PROVIDER-COLLECTION-PLAN.md) and the separately authorized v0. It is planning, not activation, a new spending allowance or approval of the whole SPEC/PLAN v1.1. Code was inspected at `561c2e298bdf225f2bf7d8ab61c4edaa90242acf`. Hosted behavior and financial balances below come from dated project evidence, not a fresh production/account read.

## Recommended approach

Use **three independently configured Apify integrations**, one each for X, Instagram and LinkedIn. Start with existing specialist Store Actors rather than maintaining three new platform scrapers. Our Netlify application owns scheduling, validation, budgets, retries and reader delivery; Supabase holds durable jobs and history. Actors receive public source targets, without private reader settings or our database credentials.

Keep the requested **hourly discovery cadence** for actively followed unique sources, spreading bounded batches through the hour. Fetch each public source once for all its followers; retrieve additional content only when missing. Preserve the existing YouTube collector and new-video review workflow while adding social routes separately.

Daily briefing generation and email sending belong in application workers: they use private preferences, consent, publication decisions and reader history. The sequence is **shared scheduling/budgets → platform adapters → social analysis/review → saved daily briefing → local-time delivery and optional email → unattended verification**. Daily storage and the email outbox can be built alongside adapters.

## Existing work and missing pieces

| Area | Current implementation | Required increment |
| --- | --- | --- |
| Scheduling | Hourly collection and five-minute new-video draft workers | Shared social-source scheduling and separate daily briefing/reminder jobs |
| Social collection | Automatic collector returns `freshness_check_unavailable` for X/Instagram/LinkedIn | Recurring discovery, pagination, checkpoints and imports per platform |
| Apify | Hosted adapter assumes YouTube; historical private controller supports Xquik and Instagram | Independent reviewed Actor/build/schema/pricing configurations; LinkedIn adapter |
| Accounting | Pre-launch reservations, run references, unknown-cost holds, leases and admin telemetry | Recurring discovery-window identities, batch attribution and shared-source accounting |
| Analysis | Eligible **video transcripts** generate proposals for administrator review | Separate usable-social-text eligibility and source-grounded analysis/review |
| Daily recap | Browser groups currently filtered updates under up to five topic labels | Genuine saved, cited daily briefing with frozen inputs and coverage |
| Preferences | Timezone, delivery time, languages, interests and reminder preference are saved | Server scheduling, email sender/outbox, opt-out and delivery receipts |

Code evidence: [automatic collection](../../netlify/functions/_shared/hourly-collection.ts), [hosted Apify adapter](../../netlify/functions/_shared/apify.ts), [historical controller](../../actors/tech-collector/src/collector.mjs), [video eligibility](../../supabase/migrations/20261024001046_content_analysis.sql), [automatic review tasks](../../supabase/migrations/20261029123923_automatic_content_review_tasks.sql), [recap screen](../../src/App.tsx), [live video workflow report](LIVE-WORKFLOW-2026-10-29.md).

Historical manual collection accepted 278 items from 20 of 39 selected sources; all source coverage reports remained incomplete and 19 sources were empty/blocked. Real Xquik posts were accepted; API Dojo `demo:true` records were rejected. LinkedIn has no corresponding verified run in this evidence. These are useful starting points, not recurring-platform proof. [Original verification](VERIFICATION.md).

## Actor candidates to qualify first

Public documentation checked **29 October 2026**. These are recommendations; immutable build identity, account entitlement, actual charges and useful output must be checked before execution. Documentation does not establish verified access or permission for our intended retention/reuse.

| Platform | First candidate | Required contract/proof |
| --- | --- | --- |
| X | [`xquik/x-tweet-scraper`](https://apify.com/xquik/x-tweet-scraper) | Target-authored posts, IDs/URLs, dates, full available text and reply/quote context. Reuse prior actual project experience; verify long posts, own threads, quiet checks and pagination. |
| Instagram | [`apify/instagram-scraper`](https://apify.com/apify/instagram-scraper) | Profile posts, captions, IDs/shortcodes, dates and media/carousel references. Verify incremental discovery, pinned posts and mixed formats. |
| LinkedIn | [`harvestapi/linkedin-profile-posts`](https://apify.com/harvestapi/linkedin-profile-posts) | Public authored post text, IDs/URLs, dates and repost/quote context without reader cookies. README accepts profile/company URLs; prove both kinds. If company support fails, qualify [`harvestapi/linkedin-company-posts`](https://apify.com/harvestapi/linkedin-company-posts) behind the same LinkedIn integration. |

Xquik documents date-bounded retrieval and global/per-target limits. Use newest-first retrieval with explicit caps, validating ownership and exact UTC bounds ourselves. Its advertised base is **US$0.15/1,000 delivered tweets**, with platform usage additional. Do not inherit its large defaults. [Actor](https://apify.com/xquik/x-tweet-scraper), [input](https://apify.com/xquik/x-tweet-scraper/input-schema).

Apify's Instagram documentation describes `resultsType: "posts"` and `onlyPostsNewerThan`. Use explicit bounds supported by the reviewed build. Documented base: **US$2.70/1,000 results on Free**, **US$2.30 on Starter**. A result is not always a post: disable unnecessary comment/profile/statistic collection and reconcile actual event types. [Documentation](https://apify.com/apify/instagram-scraper).

HarvestAPI documents `targetUrls`, `maxPosts` and `postedLimitDate`. Keep comments/reactions off; `maxPosts: 0` means unbounded. Pricing lists **US$2/1,000 posts on Starter**; the headline **from US$1.50** belongs to another tier. Empty-check costs and complete profile/company timelines remain unproved. [README/input](https://apify.com/harvestapi/linkedin-profile-posts), [pricing](https://apify.com/harvestapi/linkedin-profile-posts/pricing).

Qualify one primary per platform first. Keep a replaceable provider interface, adding a measured backup only if necessary. Do not automatically run two suppliers per source or add subscriptions. Earlier Bright Data comparisons stay historical research, not verified fallback access.

## Useful-content contract

Track **discovery coverage** separately from **content coverage**. Each source check records checked/no new items, imported, partial/capped, blocked, provider error or budget paused. An empty dataset establishes no-new-items only when attributable per-source evidence proves the requested check completed; otherwise retain unknown/partial/blocked status, including the historical Instagram empty/private ambiguity. Each item records usable text, media and context gaps independently.

- **X:** preserve target-authored replies and quote context where available. A missing parent is a labeled gap. Keep repost attribution separate from original authorship; deduplicate underlying evidence during composition.
- **Instagram:** captions do not prove understanding of photos, carousels or Reel speech. Test media-led posts explicitly. Where media carries the substance, retrieve available transcripts or implement separately bounded extraction before calling it analyzed. The [Reel Actor](https://apify.com/apify/instagram-reel-scraper) is a documented enrichment candidate, not a tested transcript solution. Missing material stays visible; generated transcription/OCR needs explicit scope/cost controls.
- **LinkedIn:** distinguish authored text, shares and original authors. Prove personal/company sources separately. Linked articles/newsletters remain references until bodies are actually retrieved; post text is not article-body coverage.

Initial scope is public timeline content and explicitly available text/context. Private accounts, paid editions, Stories/live streams, comment analysis, audience statistics and full historical backfill remain outside this increment. If the benchmark shows media enrichment is essential, implement and verify it before advertising that format; do not declare full coverage on caption-only evidence.

## Work packages

All packages are **planned**, not completed. Suggested effort: **8–12 focused engineering days plus at least 72 hours of unattended observation**, assuming candidate qualification succeeds and no new media parser is required. This is an estimate, not a delivery commitment.

| ID | Work/dependency | Completion evidence |
| --- | --- | --- |
| SD01 | Freeze contracts, targets and finite pilot envelopes; inspect builds/schemas/pricing. First. | Reviewed platform configuration, representative source matrix and bounded run contract |
| SD02 | Shared source/job state, reader associations, fair hourly dispatch and accounting. After SD01. | Native concurrency/budget/lifecycle checks, preserved old data, synthetic 50-reader capacity proof |
| SD03 | X/Instagram adapters and parallel LinkedIn work. After shared contract. | Stored fixtures, then separately authorized bounded real runs proving attribution, text, pagination/quiet/error states and charges |
| SD04 | Social-text analysis and existing review queue. After normalization. | Exact prompts/receipts, supported claims, authorized decisions and approved-post hosted readback |
| SD05 | Daily snapshot storage, topics/citations/coverage, corrections and real recap screen. Storage can parallel SD02; composition follows SD04. | Stable snapshots, citation/quality checks, isolation, history/export/delete |
| SD06 | Chosen-local-time scheduling, bounded catch-up and readiness. Alongside SD05. | DST/settings/outage checks and actual unattended due cycles |
| SD07 | Localized optional reminder, sender/outbox, opt-out and signed events. Can parallel adapters; sends depend on ready SD05/06. | Preview, authorized opted-in owner send, provider receipt and Inbox/link check; retry/opt-out/deletion proof |
| SD08 | Release, 72-hour observation, reconciled costs and operating-envelope recommendation. After applicable gates. | Exact CI/deploy identity; source freshness, daily output, delivery and recovery evidence; actual versus held costs |

### SD01–SD03: shared collection

Reuse the existing Supabase project, Clerk app and Netlify site. Keep configuration/job writes server-only under existing trusted owner authorization. Editing collection-plan notes must continue to have no execution effect.

Add or extend these logical records; names/design are proposals, not applied SQL:

- Shared public source identity and collection state: next due, last successful check, last complete window, cursor and unresolved gaps.
- Discovery jobs: platform/source/window/page or batch manifest, lease, reviewed configuration, price fingerprint, reservation and actual run/dataset references.
- Shared native item identities/revisions and private eligible-reader associations. Public catalogue/API/page reads remain metadata-only and exclude collected bodies/private follows.
- Durable completion receipts/events and database cost rollups with paged details.

The current paid hourly RPC accepts `youtube:<video-id>` with per-item uniqueness. **Do not reuse that identity for recurring profile discovery.** A source/window check may have several bounded pages; post identity stays independent. Canonicalize X IDs, Instagram IDs/shortcodes and LinkedIn activity identities while preserving existing archive IDs/annotations.

Batch compatible due sources conservatively, increasing size only after per-input limits/attribution pass. Persist each input's outcome. One failed input must not advance the whole batch. Use bounded overlap around successful checkpoints for late arrivals/edits, measuring rebilling. Partial/capped runs leave unresolved windows and bounded continuations; cursor progress is not completeness. Edits create source revisions rather than replacing approved findings silently.

Reuse reservation-before-POST, leases, trusted polling and conservative accounting. Ambiguous starts require reconciliation before another paid launch. Terminal provider status is not import acceptance or coverage proof. Unknown charges remain held; observed fees never decrease. Count each real job fee once, with source/reader allocation separately. Preserve the existing [reservation lock order](../hourly-contract.md).

Start Actors asynchronously, persist expected account/run/build identity and validate retrieved results against it. Authenticated callbacks durably record receipts and wake internal work; polling recovers missed callbacks. Never trust callback-supplied fetch URLs, reader IDs or completeness claims. Apify documents duplicate deliveries/retries; import must be idempotent. [Run API](https://docs.apify.com/api/v2/actors-runs-post), [webhooks](https://docs.apify.com/platform/integrations/webhooks/actions).

### SD04: social analysis/review

Add a separately enabled analysis purpose for usable post/caption text and exact source revisions. Preserve every-named-mention keyword extraction, including brief/ad mentions. Posts use supporting text anchors rather than invented video timing. Topics, brands and explicit sponsor disclosures remain distinct.

Reuse grounded draft/checking patterns, cached settled receipts, the shared money ledger and compact review. Retain actual prompts and original failures. Keep video prompts/eligibility, publications, frozen scopes and 271 historical queued jobs untouched; widening the old video predicate could admit unintended backlog.

New social proposals initially wait for administrator approval, matching the current live rule. Published items stay readable while additional proposals await review. Share analysis only for matching source hash, processing version and compatible use. Reader-private decisions remain private unless an explicitly global editorial decision exists; do not implicitly publish one reader's edits to everyone.

### SD05–SD06: daily website briefing

Persist reader, logical delivery cycle/date, IANA timezone, scheduled cutoff UTC, settings/follow revision, recap language, frozen item revisions, source approvals and coverage. Store topic claims with original-update citations/evidence anchors and generation receipts. Enforce one durable reader/cycle job and deletion tombstones so retry cannot recreate deleted recaps.

Resolve overlapping studio/person/channel follows once. Create **one briefing across collections**: about five minutes, up to five main topics, explicit-interest priority, expandable details, updated-source counts and original links. Repeated cross-posts are not independent corroboration. Preserve disagreement, numbers, uncertainty and sponsorship evidence. Keep All updates and truthful omitted/pending/failed states.

Consume published current-source findings. First automated publication mode should assemble approved wording/citations deterministically without adding claims. Genuine cross-source synthesis then produces a reviewable draft: source approval does not approve new wording. Qualify the composer on overlapping, conflicting, multilingual, quiet, partial and late examples. **Unattended publication of newly synthesized wording needs an explicit later policy decision after that evidence; human review is not silently removed.** Automatic scheduling/delivery can operate on ready approved briefings meanwhile.

A short UTC dispatcher, proposed every five minutes, finds readers due at their local chosen time. Reuse scheduled/background worker patterns; long Actor/model work must not block dispatch. Netlify schedules run in UTC, so one fixed daily cron cannot handle every timezone/DST setting. [Scheduling documentation](https://docs.netlify.com/build/functions/scheduled-functions/).

Use consecutive real cutoff instants, not `now - 24h`. Missing DST times move to the next valid local time; repeated times trigger once. Keep logical cycles stable through retries/settings changes, with a monotonic consumed-cutoff guard against duplicate/overlapping delivery. Settings affect the next uncreated cycle. Previously unbriefed late items and later approvals carry forward with original dates, rather than being lost.

Freeze coverage and approved inputs at cutoff. Partial briefings identify delayed, blocked, capped or review-pending material; zero approved material is not automatically a quiet day. Under healthy conditions target ready deterministic output by the next five-minute dispatch interval; measure model/review delays separately. This is a proposed target, not a precise-time guarantee. Bound outage catch-up to the latest due cycle with a visible gap notice; retain missed-cycle records without a flood of old reminders. Past wording stays fixed; corrections are explicit revisions with no second daily reminder.

Reuse language preferences and localize reminders. Verify names/numbers/citations across source-to-recap languages. The exact six-language rollout remains proposed in SPEC v1.1; unsupported combinations are explicit, without silent English substitution.

### SD07: optional email

Recommend **Resend** for a localized HTML/text message with date, readiness/coverage note, private briefing link and opt-out. Check existing account/sender access first; plugin availability is not configured app access. Use an owned verified sending domain/subdomain with SPF/DKIM/DMARC; no domain/plan purchase by inference. [Domain setup](https://resend.com/docs/dashboard/domains/introduction).

Opt-in stays off by default. Resolve the recipient server-side from current verified Clerk primary identity, never an arbitrary browser address. Clerk authentication emails are not the recap sender. Record consent; recheck opt-in, identity, suppression and deletion immediately before sending. Opt-out/deletion cancels pending work and fences claimed workers. Already provider-accepted mail cannot be recalled; keep its receipt honestly.

Insert one outbox entry transactionally with ready publication. Use a unique briefing/reminder key and **the same frozen payload/provider idempotency key on retries**. Track pending, claimed, accepted, delivered-to-server, bounced, complained, suppressed and uncertain outcomes. If identity changes during an ambiguous send, reconcile first rather than sending again to a new address.

Resend retains idempotency keys for **24 hours**. Keep permanent app uniqueness/receipts, bound automatic retries inside that window and reconcile uncertainty before expiry instead of blindly resending afterward. Verify signatures, deduplicate/out-of-order events and suppress hard bounces/complaints. Delivered-to-server is distinct from actual Inbox observation. [Idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [events](https://resend.com/docs/webhooks/introduction).

Include an accessible text alternative and scoped opt-out token. Opt-out disables reminders, leaving the website available. Keep tracking off initially; exclude full scraped originals, operational IDs and credentials from email. Email failure leaves the website briefing readable. A later real owner send needs explicit sending authorization and opt-in; none occurs during planning.

## Budgets and sizing

Preserve **50 readers × at least 78 sources = at least 3,900 follows**. Unique sources, platform mix, publication rates and overlap are unknown. Plan capacity for 3,900 distinct sources at this floor. The catalogue's 600 planned accounts are neither an active follow roster nor the entire future source universe. Collect only enabled followed sources; cap onboarding/backfill separately.

No-overlap hourly discovery gives **93,600 source-check opportunities/day** before retries. Batching reduces launches, not necessarily billed lookups. Measure quiet checks, returned duplicates and useful-content coverage; headline result rates cannot price operation.

Per-platform cost model:

`checks × measured minimum/empty/compute cost + all billed results × applicable event rates + enrichment + retries/repair`

Add source analysis, private daily composition, email, hosting/database/storage, subscriptions and tax/currency effects. Count paid overlap results even if discarded during import. Report cost per checked source, accepted unique item, usable item and ready briefing. Use authoritative database job rollups, not a 10,000-row client scan.

For first source qualification, propose an **incremental supplier envelope of at most US$5**, only if it fits reconciled remaining capacity inside the existing US$45 source-proof ledger/€50 ceiling. This is a sub-envelope, not a top-up. Use five representative sources/platform where already authorized, strict input/result/time/charge bounds and capped continuations. A missing followed LinkedIn cohort needs an explicit test roster, not a catalogue sweep. Preserve the historical 150-minute ceiling; generated transcription is not automatically enabled.

Existing hourly supplier controls are **US$0.10/day, US$1 cumulative and US$0.005/exact-video fallback**, including a US$0.10 database daily-policy maximum. They are not a recurring social operating budget. Add scoped pilot/operating policies rather than weakening YouTube controls or treating an item key as a recurring profile allowance. If provider limits cannot bound every charge category, reserve conservatively or decline the route.

Last verified model checkpoint: **US$9.422405362 committed of US$10**, including seven historical holds, with **US$0.577594638 remaining at 13:09:41 UTC on 29 October**. Existing video processing can consume it; refresh before admitting new work. Keep US$5/UTC-day and US$0.10/call. Social analysis/composition need a finite allowance fitting the reconciled balance or a separately approved increase, without resetting costs/holds. Supplier and model envelopes are separate.

At 50 opted-in readers, one reminder/day is 50 messages/day before other traffic. Resend publishes a Free daily limit of 100; check actual account-wide daily/monthly headroom. This is not proof of available app sending capacity. [Email limits](https://resend.com/pricing).

After proof, recommend a separately approved **seven-day operating envelope** based on measured hourly/usable-content costs and a fixed total stop. Set platform/aggregate supplier, analysis and email stops with visible paused coverage. Do not convert bounded proof ceilings into indefinite spend or quote a monthly total from unmeasured per-post arithmetic.

## Verification and release

1. **Local/fixtures:** stored real captures plus adversarial output; synthetic 50-reader/78-source load without external source traffic. Cover overlap, quiet/bursty sources, pinned/edited/long posts, missing media, replies, company/person sources, pagination and caps.
2. **Native database:** one claim/reservation under concurrency, shared retrieval across followers, private view isolation, preservation of archives/annotations/controls. Exercise stale revisions, reset/unfollow/delete races, tombstones, unknown fees, build/price drift and duplicate callbacks. Verify rollback/preservation before applying migration.
3. **Bounded providers:** only admitted sources within finite budget. Save actual run/build/dataset identities, per-input results, useful-content inspection and charges, including quiet/partial/error cases. `SUCCEEDED` is insufficient. Raw datasets stay private; Git receives sanitized receipts/coverage.
4. **Analysis/publication:** one real item/platform reaches review; an authorized actual decision publishes it and hosted readback matches. No real approvals as a QA shortcut. Unsupported media/languages remain gaps.
5. **Briefings:** real approved multi-platform inputs produce one persistent private daily briefing with exact working citations and truthful coverage. Check Berlin/New York DST, non-hour-offset/date-line zones, settings edits, late items, pending reviews, quiet versus failed days and multi-day outage.
6. **Email:** preview, then explicitly authorized opted-in owner send. Record provider acceptance/events separately from actual Inbox/authenticated-link proof. Verify opt-out, suppression, deletion, interruption and the idempotency-window boundary.
7. **Release/observation:** separate local checks, native apply, push/CI, exact Netlify deployment, hosted reads and unattended jobs. Observe at least 72 hours including two actual daily cycles and controlled failure/recovery. Reconcile fees/holds; claim operation only for the proven roster and publication mode.

Expose compact admin state: next due/last success, Actor/build, source gaps, review backlog, briefing readiness, reminder outcome, actual cost and held commitments. Keep separate collection/analysis/composition/email stops. Pause a failing new route while reconciling accepted work; preserve healthy YouTube collection and history.

Extend export and recap/workspace deletion to new records/queues. Implement actual raw-input retention/provider-dataset cleanup before broad operation; SPEC's seven-day raw/30-day-backup targets remain proposals, not guarantees. Full Clerk/account erasure and paid-launch readiness remain separate work.

## Next action and evidence boundary

On a later implementation instruction, start SD01/SD02 and offline adapters; daily storage/scheduling and templates/outbox can proceed in parallel. Refresh live identities, Actor contracts and budgets before the bounded-run boundary. Use a concrete reviewed roster/envelope for any necessary approval; routine engineering setup stays assistant-owned.

This planning pass made **no application/schema change, production/account query, supplier/model call, source collection, email send, deployment or subscription**. Public documentation research and local code review are the evidence obtained; incremental metered execution cost **US$0**.
