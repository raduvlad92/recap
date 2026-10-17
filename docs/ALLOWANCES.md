# Initial trial allowances — proposal

Prepared: 18 October 2026. Status: **Q15 pending**, not an approved offer or spending instruction. This concerns future trial design; source-provider execution remains deferred.

## Recommended starting package

- 15 followed sources/person, with at most 5 X accounts under the researched query-priced collection route.
- One scheduled check/day and one daily recap. No repeated paid manual refresh or historical backfill in this initial package.
- At most 50 new source updates/day and 500/month analyzed. Both limits apply; they are not a claim about how much people actually publish.
- 60 minutes/month of content that requires generated transcripts. Existing usable captions/publisher transcripts do not consume that particular allowance, but retrieving and analyzing them still has costs.
- Optional daily reminder email/link, as already accepted in Q11.
- No automatic extra charges. Exhausted allowances and items not analyzed must be visible. A long episode is not silently summarized from its first few minutes and presented as complete.

All seven source families remain in the assumed design. These are a configurable first-trial package, not a permanent ceiling or a promise that every followed source fits. The public offer/price can change after actual costs and use are measured. Changes require clear notice rather than hidden omissions.

## Why use limits

Using the saved estimate of 0.2 new items/source/day, 15 sources would average about 90 items/month. That average is a planning assumption, not an observed user distribution; prolific sources can exceed it substantially.

The collection bill depends on checking sources and returning repeated records as well as genuinely new items. A monthly item-analysis limit alone does not cap source-query charges. Generated speech transcription adds a separate cost.

Public prices rechecked on 18 October 2026, with no accounts, paid jobs or collection:

- Five X accounts checked daily: 5 × 30 × $0.016 = $2.40/month before extras at the selected actor's query tariff. Thirty would be $14.40 without reuse. [API Dojo pricing](https://apify.com/apidojo/twitter-scraper-lite/pricing)
- Ten other sources returning five billable rows/check: 10 × 30 × 5 × $0.0015 = $2.25 at the example record rate. Actual actors, feeds and custom crawls have different billing units; this is conditional. [Bright Data pricing](https://brightdata.com/pricing/web-scraper)
- Five hundred item analyses: 500 × $0.00275 = $1.375 using the saved 5,000-input/500-output-token assumption. Thirty personal recaps add $0.15 using 10,000-input/800-output tokens each. Actual lengths, quality settings and retries can change this. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Sixty generated audio minutes at the selected Starter add-on rate: 60 × $0.041 = $2.46. Doubling the allowance doubles that component. [Apify YouTube pricing](https://apify.com/streamers/youtube-scraper/pricing)

Those displayed components sum to about $8.64 without shared work. If collection, item analysis and transcripts were each reused by five readers, keeping personal recaps individual, the same example becomes about $1.85/person. Neither is an all-in quote or guaranteed ceiling. Five-reader overlap has not been measured; fees/minimum plans, platform mix, long text, retries, hosting, email, support, taxes and acquisition remain outside or uncertain. Do not mix these USD components with EUR subscription revenue using an unstated exchange rate or call the remainder profit.

## Product behavior proposed for limits

Show sources checked, updates detected and updates analyzed separately. If more content was detected than could be processed, show the gap and its reason. “All updates” stays independent of interest filtering, but cannot be described as unlimited collection or processing. Source capture/processing limits must be apparent there too.

At a limit, keep the usable recap and make the affected items visible where metadata is available; do not label them quiet or analyzed. Do not collect more billable data simply to display an exact missing count when the capture limit itself prevents knowing that count. Use an honest “collection limit reached” state instead.

## Separate from the earlier experiment

The €50/150-generated-minute source-proof ceiling is a global, deferred experiment limit. It is not a recurring production budget or per-reader allowance. Q15 approves only a planning package if accepted; customer recruitment, paid trial execution, provider spending and public launch remain separate authorization decisions.
