# Larger allowances and conditional costs

Prepared: **19 October 2026**. Status: **recommended defaults in SPEC v1.0; exact package not approved**. Q15 accepted clear limits and requested larger allowances. The former 15-source / 500-update / 60-minute recommendation is superseded, not accepted. No trial or spending starts here; all provider execution remains deferred.

## Recommended package

- **50 followed sources/person, including up to 15 X accounts.** All seven families remain in the assumed design.
- At most one scheduled check per reader/source/local day, with successful shared checks reused only within six hours before cutoff; one personal recap/day in a chosen language; no paid manual-refresh loop or archive backfill.
- **Up to 200 new updates/day and 3,000 per monthly usage period analyzed**, both limits apply.
- **300 generated-transcription minutes per monthly usage period.** Existing usable captions/publisher transcripts do not consume generated minutes, but retrieval/analysis still cost work.
- Visible monthly reset date, usage and omissions; no automatic extra charges. Changing sources/language/timezone cannot reset usage. Retries/duplicates/corrections cannot consume the update allowance repeatedly.

This meaningfully increases the previous proposal: over three times as many sources, six times the monthly analyzed updates and five times the generated minutes. The X cap reflects the researched query-cost example, not a proven platform limit. These are configurable design allowances, not permanent ceilings or a public offer.

A 100-source / 20-X / 500-daily / 5,000-monthly / 600-minute package is a possible later tier, not part of v1.0. Recommend measuring the 50-source package before expanding again.

## Public unit prices and model assumptions

Public pages rechecked on 19 October 2026, without accounts, provider jobs or spending:

| Component | Example rate | Assumption / primary source |
| --- | --- | --- |
| X profile checks | $0.016/query | Selected actor's query tariff; further records/events can add cost. [API Dojo pricing](https://apify.com/apidojo/twitter-scraper-lite/pricing). |
| Other-source records | $1.50/1,000 | Bright Data ready-made PAYG example; not a universal quote for all actors/feeds/custom crawls. [Bright Data pricing](https://brightdata.com/pricing/web-scraper). |
| Generated speech transcripts | $0.041/minute | Selected Apify Starter add-on, separate from video-record charges. Free tier is a different rate; other audio routes differ. [YouTube scraper pricing](https://apify.com/streamers/youtube-scraper/pricing). |
| Text model | $0.30/million input; $2.50/million output tokens | Saved Gemini 3.5 Flash-Lite example; quality for this product unverified. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). |

Assume a 30-day month; five returned billable rows per check for non-X sources; 5,000 input/500 output tokens per update analysis; each personal recap reads that day's item analyses plus 1,000 tokens of context and produces 800 tokens. Full monthly usage is a stress case, not typical measured behavior. Five returned rows is a costing input, not an instruction to miss prolific sources: capture/pagination and extra billing must be measured later.

## Monthly arithmetic at full use

| Component | Recommended 50-source package | Possible 100-source tier |
| --- | --- | --- |
| X checks | 15 × 30 × $0.016 = **$7.20** | 20 × 30 × $0.016 = **$9.60** |
| Other-source rows | 35 × 30 × 5 × $0.0015 = **$7.875** | 80 × 30 × 5 × $0.0015 = **$18.00** |
| Update analysis | 3,000 × $0.00275 = **$8.25** | 5,000 × $0.00275 = **$13.75** |
| Generated transcription | 300 × $0.041 = **$12.30** | 600 × $0.041 = **$24.60** |
| Personal recaps | 1.53M input / 24k output = **$0.519** | 2.53M input / 24k output = **$0.819** |
| Displayed subtotal, no reuse | **$36.14/person** | **$66.77/person** |
| Illustrative five-reader reuse | ($35.625 ÷ 5) + $0.519 = **$7.64/person** | ($65.95 ÷ 5) + $0.819 = **$14.01/person** |

The reuse scenario divides collection, update extraction and generated transcription by five; personal recaps remain individual. Actual source overlap, delivery-time overlap within the proposed six-hour reuse window and permission to reuse are unmeasured. Do not divide private reader data or personalized summaries across users. Neither scenario is an all-in quote or hard cost ceiling. Minimum plans, additional events, pagination, repeated/old records, longer inputs, retries, hosting, storage, email, support, taxes, quality review and acquisition remain outside or uncertain. Plan-credit fees and usage must be reconciled rather than blindly added twice.

For multilingual planning, make one selected-language recap per reader, not six. A **50% increase in text token use**, as a deliberately hypothetical stress test, changes the displayed totals to **$40.53 without reuse / $8.73 with five-reader reuse** for the recommended package; **$74.05 / $15.79** for the larger tier. This is not a measured language multiplier. Translation/terminology review is additional work. The earlier fixed 10,000-token recap-input example understated this full-volume scenario and has been replaced here.

## Product and revenue implications

A source/query allowance and a processing allowance control different bills. An analyzed-update cap does not by itself cap repeated collection or long-input charges. Maintain an independent operator budget, bounded retries and a spending stop before live operation; that recurring budget is not yet approved.

Show followed/checked/updated/analyzed counts separately. In all updates, show available unprocessed items with reasons. If capture itself was capped, state “check incomplete / collection limit reached” rather than inventing an exact missing count. Generated-audio exhaustion cannot silently produce a partial episode recap presented as complete. One creator's multiple platform accounts count as separate sources; exact duplicate updates are deduplicated for usage.

The former €12/month subscription example is **not established as viable for this package**. Full-use, low-overlap and audio-heavy readers are material cost cases. Keep pricing open until measured costs and willingness to pay can support a specific offer; professional and general-reader prices may differ. Do not subtract USD vendor components from EUR revenue without a stated exchange rate, taxes and other service costs.

## Separate approvals

The source experiment's global **€50 / 150-generated-minute ceiling** remains deferred and unchanged. A 300-minute reader design allowance does not enlarge it. An eventual customer trial needs a separate aggregate cash/audio/labor budget; 15 readers × their maximum allowances is not automatically approved spending. Specification approval does not authorize provider subscriptions, customer recruitment, charging or publication.
