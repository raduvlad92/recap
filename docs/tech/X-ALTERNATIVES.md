# X scraper alternatives — read-only research

Checked 21 October 2026. No run, build, purchase, subscription, account change or collection was performed in this research. The controller's API Dojo `demo:true` rows remain rejected; they are not tweets or source-access proof.

**Recommendation: try one single-account, 300-item capped proof with [xquik/x-tweet-scraper](https://apify.com/xquik/x-tweet-scraper).** Its README explicitly describes Free-plan use and says no separate Xquik subscription is needed. Setup requires only an Apify account/token; the pinned input schema has no external API key, cookie, session or credential fields. No separate Xquik account/key setup is documented. That is documentation/schema evidence, not an executed entitlement check. The [public Actor metadata](https://api.apify.com/v2/acts/xquik~x-tweet-scraper) corroborates an active **PAY_PER_EVENT** schedule from **2026-08-29** with **FREE $0.00015 per delivered tweet ($0.15/1,000)** and no start/rental fee in that schedule. Earlier historical schedules charged Free users more: select the latest schedule effective on the run date, not the first array entry. Platform usage is additional. [Apify Free](https://apify.com/pricing) includes $5 usage; this is a pool, not $5 available again for this proof.

Pin **Actor `wAusCMrm284Voaw86`, build `1.12.394`, build ID `0zYfRnonkqidzEkEF`**. The [inspected build metadata/input/output schema](https://api.apify.com/v2/actor-builds/0zYfRnonkqidzEkEF) is public and successful; this is build evidence, not a successful source run. Current API stats show 7,054 users, 2,809 monthly users and 16 reviews (~4.67/5), stronger adoption signals than the alternatives below, not guarantees of usable results.

Suggested **input only**, using the existing exact source and collection UTC bounds when executing:

```json
{
  "mode": "search",
  "searchTerms": ["from:LinusTech since:2026-09-21 until:2026-10-22"],
  "queryType": "Latest",
  "maxItems": 300,
  "outputVariant": "rich",
  "fieldStyle": "camelCase",
  "includeSearchTerms": true
}
```

All these fields were checked against the pinned schema. Date operators use an inclusive lower/exclusive upper bound; the day-level example is a superset of the existing exact UTC window, so keep the controller's timestamp validation. Alternatively its documented timestamp-form `since`/`until` fields can express UTC seconds. Do not use its uncapped defaults: the published default has 100,000 items and no runtime timeout. For a parent-approved proof, retain the shared durable reservation, use `build=1.12.394`, `memory=256`, `timeout=120` and `maxTotalChargeUsd=0.05`. The pinned Actor requires exactly256MB (minimum/default/maximum all256). Current `minimalMaxTotalChargeUsd` is null: no Actor-specific minimum charge ceiling is declared. Three hundred delivered tweets have a stated result fee of $0.045; platform usage and actual charges must be read back separately. Apify explains that [event fees can exclude platform usage](https://docs.apify.com/actors/running/actors-in-store).

The documented example/schema contain `id`, direct `url`, `text`, `createdAt` (X-native date string), nested `author.username`, and optional flat `authorUsername`, media/links and diagnostic/run-report fields. Illustrative output is not collected evidence. The current normalizer accepts `author.username`; still reject demo/diagnostic/error records, wrong author/URL, invalid dates, duplicates and out-of-window posts. Keep proof output private. A small run is only usable-content proof; it cannot establish complete 30-day coverage. Search omits native reposts unless requested; do not describe the proof as every profile update.

## Comparisons

| Candidate | Current Free result fee / fixed charge | Access/filter evidence and conclusion |
| --- | --- | --- |
| [FeedMiner advanced search](https://apify.com/feedminer/x-advanced-search-scraper) | $0.12/1,000; no start event in current API schedule | README explicitly describes Free credits; `from`, `since`, `until`, `sort: latest`, `maxItems`. Smaller adoption (65 users, no reviews). Credible fallback for another proof, not run here. Pin **1.0.49 / HYW8WgsCqDUifTc6U**, [Actor metadata](https://api.apify.com/v2/acts/feedminer~x-advanced-search-scraper), [build schema](https://api.apify.com/v2/actor-builds/HYW8WgsCqDUifTc6U). |
| [ScrapeSmith search](https://apify.com/scrapesmith/x-twitter-search-scraper) | $0.15/1,000 + $0.01 start per GB (minimum one event) | README claims a Free tier on every plan; exact author/date operators and full text. Less explicit eligibility wording than Xquik. 323 users/one review. Pin **0.0.4 / zxKccYphNTcHEyoC4**, [metadata](https://api.apify.com/v2/acts/scrapesmith~x-twitter-search-scraper), [schema](https://api.apify.com/v2/actor-builds/zxKccYphNTcHEyoC4). |
| [memo23 search](https://apify.com/memo23/x-twitter-search-scraper) | $0.40/1,000 + $0.005 start per GB; default4GB means four start events | README says Free runs stop at100tweets. Search supports author/date operators. More expensive small proof, explicit free cap, only43users/no reviews. Backup only. |
| [Feedd Labs search](https://apify.com/feeddlabs/x-twitter-search) | Advertised cheap results | **Exclude:** README explicitly says Free returns a fixed sample and custom queries require a paid Apify plan. |
| [Toolzerhub search](https://apify.com/toolzerhub/twitter-scraper) | $2/1,000 on Free | **Exclude for backfill:** README says Free permits50rows then a paid plan is needed. |
| `dami_studio/twitter-search-scraper` | Search index claimed $0.40/1,000 | **Do not use:** direct Store page and public Actor endpoint both returned404 during this check. |

**Evidence limit:** Xquik and FeedMiner are documented/API-price candidates for the current Free organization, not verified DeleteCookies executions. No organizational entitlement or real tweet response was tested. The parent should execute only its approved small reserved proof, inspect actual non-demo tweet rows/author/date/cost, then decide whether broader X backfill is justified without upgrading anything.

The parent-requested public review bundle is saved in ignored `.local/tech-xquik-review.json`: full active pricing, pinned Actor/build metadata, complete input/output/storage schemas, SHA-256 pricing fingerprint, 300-item proof input and API run options. It contains no provider token, private reader identity or collected tweets. Only public metadata GET requests were used.
