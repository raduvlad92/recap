# Planned collection costs: Apify vs Bright Data

Checked **21 October 2026** against primary vendor pages and read-only public Actor metadata. **Planning only: every catalogue channel stays “not started”; no supplier job, generated transcript, schedule, subscription or new spending was started.** Prices below are USD before tax/currency conversion. They are not measured production costs or a guarantee of complete content access.

## Recommendation

Use **the lowest cost route that returns enough underlying content**, selected per platform. Keep the existing Apify integration as the first runtime adapter. Plan Bright Data for cheaper equivalent Instagram-caption and LinkedIn-text collection; retain Apify when its transcript or discovery capability is needed. Use publisher RSS for Substack discovery where available, then compare body-extraction options. This is a route plan, not a limited-RSS customer trial or a change to the broad-source requirement.

| Platform | Planned first route | Comparable published cost | Why this route / unresolved check |
| --- | --- | --- | --- |
| YouTube | Apify `streamers/youtube-scraper` | Free $4 / 1,000 video records; Starter $3. Existing-caption retrieval is distinct from generated speech. | Explicit caption/transcript options. Bright Data is cheaper at $1.50 / 1,000 video records and advertises transcripts, but inspected sample fields do not establish equivalent transcript completeness or generated transcription. Switch if the same usable text is delivered for less. |
| Instagram | Bright Data public posts, Apify Reel adapter only when spoken content is needed | Bright Data $1.50 / 1,000 records; Apify generic post results $2.70 Free / $2.30 Starter. | Caption text is a comparable unit. A caption/media URL is not the complete meaning of a reel or carousel. Bright Data's inspected page does not document a transcript field. Apify Reel transcripts are separately metered. |
| X | Apify `apidojo/twitter-scraper-lite` for profile/search discovery; evaluate Bright Data for known post URLs | Apify $0.016 per profile/search query including roughly 40 results; further event tiers apply. Bright Data $1.50 / 1,000 delivered post records. | Bright Data is cheaper for sparse known-post work, but finding all new post URLs is an additional task. Its profile example accepts a post cap but the shown output is profile-shaped; verify actual post discovery before treating $1.50 / 1,000 as the whole monitoring cost. |
| Substack | Public RSS discovery; batch Apify body extraction where needed | RSS has no scraper-vendor fee. Candidate `hata1234/substack-scraper`: $1 / 1,000 articles + $0.005 start event per GB (minimum one event). Bright Data custom route: $1.50 / 1,000 **page loads**. | A sufficiently batched Apify run can be cheaper than one-page-per-article Bright Data. Small runs and archive-page overhead change the answer. Set `includeBody: true`; default metadata is insufficient. Neither route unlocks paid bodies. |
| LinkedIn | Bright Data public-post discovery/text, Apify fallback | Bright Data $1.50 / 1,000 records; Apify HarvestAPI $2 / 1,000 posts + tiny start/no-result events. | Lower equivalent text-record price. Bright Data documents recent public-profile limits, often around ten posts. Check long posts, articles, document slides and completeness; no video transcript is established by a media link. |

Primary capability pages: [Apify YouTube](https://apify.com/streamers/youtube-scraper), [Bright Data YouTube](https://brightdata.com/products/web-scraper/youtube), [Bright Data Instagram](https://brightdata.com/products/web-scraper/instagram), [Apify Reels](https://apify.com/apify/instagram-reel-scraper), [Apify X](https://apify.com/apidojo/twitter-scraper-lite), [Bright Data X](https://brightdata.com/products/web-scraper/twitter), [Bright Data LinkedIn](https://brightdata.com/products/web-scraper/linkedin), [Apify Substack candidate](https://apify.com/hata1234/substack-scraper), [official Substack RSS instructions](https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication).

“Cheapest” above is **conditional among inspected routes**. No global price winner or provider success has been measured. Developer effort, failure rate and content quality can cost more than fractions of a cent saved on rows.

## Current tariffs and extra events

[provider-plans.json](../../data/catalogue/provider-plans.json) preserves the public rate evidence, effective tariff dates, source URLs and disabled route recommendations for nine inspected Actors. These are public read-only `GET /v2/acts/...` metadata calls, not Actor runs. The latest tariff whose effective date precedes this check was used; historical prices in the response were not mistaken for current prices.

| Route / event | Free | Starter / Bronze | Billing detail |
| --- | ---: | ---: | --- |
| YouTube video | $0.004 | $0.003 | Per returned video. |
| YouTube date-range event | $0.0013 | $0.001 | Extra event when channel date filtering is used; confirm actual event count. |
| YouTube generated transcription | $0.048 / started minute | $0.041 / started minute | Rounded per video; separate from record charge. |
| YouTube AI summary or description | $0.015 / minute each | $0.010 / minute each | Optional; leave off. This is not included in the base video price. |
| Instagram generic result | $0.0027 | $0.0023 | Per result. |
| Instagram Reel | $0.0026 | $0.0023 | Plus $0.001 per run start. |
| Reel transcript | $0.048 / started minute | $0.041 / started minute | Per reel; optional, off by default in our plan. |
| Reel video download | $0.020 / started MB | $0.015 / started MB | Separate optional download event; shares-count also costs extra. |
| X profile/search query | $0.016 | $0.016 | Roughly 40 initial results included. Single known-tweet query is $0.05. Extra items have batch-dependent events of $0.0004–$0.002. |
| LinkedIn post | $0.002 | $0.002 | Optional comment/reaction records cost another $0.002 each; exclude them. Empty post-page event $0.001; start event $0.00005 per GB, at least one. |
| Substack hata1234 | $0.001/article | $0.001/article | Start $0.005 per GB, at least one; documented optional public-body extraction. Small-community candidate, actual reliability unverified. |
| Substack automation-lab, with body | $0.0023 | $0.002 | Plus $0.005/run; metadata-only headline is cheaper but insufficient for a recap. |
| Substack fatihtahta | $0.0025 | $0.00199 | Enriched public-record candidate; verify exact content/results. |
| Substack boundary | $0.003 | $0.003 | Plus $0.00005/GB start and **platform usage separately billed**. README says $2/1,000, but pricing page and effective public tariff say $3; use $3 for planning. |

Rates: [YouTube pricing](https://apify.com/streamers/youtube-scraper/pricing), [Instagram pricing](https://apify.com/apify/instagram-scraper/pricing), [Reel pricing](https://apify.com/apify/instagram-reel-scraper/pricing), [X pricing](https://apify.com/apidojo/twitter-scraper-lite/pricing), [LinkedIn pricing](https://apify.com/harvestapi/linkedin-profile-posts/pricing), [hata1234 pricing](https://apify.com/hata1234/substack-scraper/pricing), [automation-lab pricing](https://apify.com/automation-lab/substack-scraper/pricing), [fatihtahta pricing](https://apify.com/fatihtahta/substack-scraper/pricing), [boundary pricing](https://apify.com/boundary/substack-newsletter-scraper/pricing). Exact machine-readable tariff links are alongside each rate in the JSON.

The cheaper [API Dojo Tweet Scraper V2](https://apify.com/apidojo/tweet-scraper) advertises $0.40 / 1,000 tweets, but requires at least 50 results/query and explicitly rules out repeated monitoring in short intervals. It is excluded as a routine sparse daily-watch substitute. Its headline is not a valid price for our required workload.

## Plans, credits and minimums

[Apify Free](https://apify.com/pricing) includes $5/month of eligible usage. Starter is $19/month with $19 eligible credit and Bronze rates. Do not add $19 twice when usage consumes that credit. No selected Actor requires a separate monthly rental in the inspected tariff. Most selected pay-per-event Actors include run infrastructure; boundary explicitly passes platform usage to the user. Post-run storage reads/writes remain separately chargeable. [Apify billing details](https://docs.apify.com/actors/running/actors-in-store).

[Bright Data ready-made PAYG](https://brightdata.com/pricing/web-scraper) is $1.50 / 1,000 delivered records with no monthly commitment. [Substack's custom Studio route](https://brightdata.com/products/web-scraper/substack) is $1.50 / 1,000 page loads; archive requests, body requests and pagination can create several page loads per useful article. Managed custom-development prices are not established by that self-service tariff. [Studio billing definitions](https://docs.brightdata.com/datasets/scraper-studio/faqs).

The [current free-tier page](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier) advertises 5,000 monthly credits shared across eligible products, with eligibility rules. It is **not 5,000 separately for every platform**. Wallet funding, account-specific terms and auto-recharge must be checked before activation. Unfunded free credit exhaustion stops service; deposited funds can continue to be spent. No account eligibility or funding minimum was checked here.

The ready-made scraper marketing page says failed deliveries are free; the [technical FAQ](https://docs.brightdata.com/products/scrapers/scrapers-library/faqs) says incorrect-input records are billed. Budget invalid inputs conservatively. That FAQ also records the public-profile LinkedIn depth limit. Some older Studio FAQ text describes a different trial; use current account billing rather than assuming all pages agree.

Apify's `minimalMaxTotalChargeUsd` field in the saved metadata is the minimum accepted **spending-cap parameter**, not evidence of a minimum invoice. Provider-specific billable events and per-run starts are separate from deposits, subscription prices and our app's aggregate budget.

## Concrete cost examples — not jobs or approved spending

- **120 X profiles checked daily for 30 days:** 3,600 Apify profile queries × $0.016 = **$57.60** before extra events. A low update count does not remove this query floor. Known 18,000 post URLs on Bright Data would cost $27, **plus the unresolved discovery step**.
- **120 Instagram or LinkedIn sources returning five records/day for 30 days:** 18,000 returned rows. Bright Data **$27** per platform. Apify Instagram **$48.60 Free / $41.40 Starter**, LinkedIn **$36** before starts/empty inputs. These counts can include repeat records and are not a guarantee that five captures every new update.
- **120 YouTube channels at the same row count:** Apify **$72 Free / $54 Starter**, Bright Data **$27 for video rows**. A thousand newly generated transcript minutes adds **$48 / $41** to Apify; titles/descriptions alone cannot be used as a cheaper complete recap.
- **120 public Substack bodies in one low-memory batch:** hata1234 event subtotal **$0.125** (one $0.005 start + 120 × $0.001). Bright Data at exactly one page load/article would be **$0.18**, but archive navigation/body requests change it. One-article Apify runs instead total **$0.72**, making batching material. Free public RSS discovery has zero scraper-vendor fee, with ordinary app/network cost still present.

Examples exclude credits, tax, our AI processing, retention, engineering/support and failures unless expressly stated. They do not authorize daily scanning of the 600-entry catalogue. Public catalogue size is not active collection workload: collect shared sources only when needed by readers, and reuse eligible source fetches rather than charging one supplier run per follower.

## Activation plan for a later authorized step

1. Keep every imported channel `planned / disabled`; no immediate archive backfill or scheduled run.
2. Pin supplier/Actor build, exact input/output schema and tariff; distinguish discovery, returned record, usable body/transcript and generated minutes.
3. Add an app-wide durable spending ledger, reservation before start, per-run caps, bounded retries, duplicates/reuse handling and a manual stop. A per-user limit alone cannot bound 600 sources.
4. When collection is separately resumed, compare the same small public-source set and measure **total invoice / usable complete update**, including starts, discovery, empty results, repeat rows, download and transcript minutes. The older global **€50 / 150-generated-minute ceiling remains a ceiling**, not a new recurring budget. No run starts from this plan.
5. Store supplier plan, planned inputs, actual runs, affected readers, records, gaps and costs separately in admin. A creator with many followers can share a single eligible collection; count actual runs and unique Actors rather than multiplying them by follower count.
6. Publish creator-page descriptions and collection explanations now, but keep “collected”, “verified full content” and fresh recap claims absent until backed by real results. Public posts only; paid-post previews remain visibly partial. Do not infer sponsorship from a brand mention.
