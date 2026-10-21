# Idea assessment: therecap

Research checked on **15 October 2026**. Prices are advertised web prices in their stated currency, before any unstated tax. This is desk research: products, scrapers, customers and paid workflows have not been tested.

## Recommendation in plain language

The problem is plausible, but the broad concept already has close competitors. The strongest version helps someone understand **what changed across their chosen sources**, including meaningful disagreements and why a topic matters to them. “AI summaries in one place” is not sufficient differentiation.

The founder wants rapid growth, all three audience groups explored, broad access before a customer trial, and scraping via Apify/Bright Data. Respecting those choices, the cheapest useful next experiment is a **small, capped collection proof across the required platforms**, before an app build. A scraping product page is evidence of a candidate tool, not proof of reliable or complete access.

## Demand: evidence versus assumptions

The Reuters Institute's 2026 Digital News Report finds 42% sometimes/often avoid news, and 17% in its 20-market payment basket pay for online news. That is adjacent evidence of fatigue and existing payment, not evidence that these people want a creator-recap subscription. Some may simply want less content. [Reuters 2026 executive summary](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/dnr-executive-summary)

Paid reader/briefing products below establish an existing category. Their pricing does not establish conversion, retention, profitability, or demand for this new product. No credible market-size or market-share estimate has been established here.

Unproven questions: will people set up their sources, trust the recap, find it more useful than alternatives, return after the novelty, pay at the proposed price, and recommend it? Broad source coverage may be necessary for the founder's promise, but it is not by itself proof of demand.

The founder chose to explore all three audiences. Analyze separately:

| Audience | Job to test | Main uncertainty |
| --- | --- | --- |
| Consultants | Arrive at client work knowing what changed in a relevant industry. | Enough value beyond existing newsletters/readers, with little setup. |
| Marketing/brand-monitoring buyers | Understand brands, sponsors, creators and conversations. | May need a different product and richer data than the first consumer recap. |
| General readers | Follow chosen interests without visiting every platform. | Low willingness to pay and many free substitutes. |

These are hypotheses, not validated customer descriptions. Do not pool the three groups' results into one misleading average.

## Competition

Official feature claims and prices, not hands-on evaluations:

| Product | Relevant offering | Advertised price | Consequence |
| --- | --- | --- | --- |
| Readless | Chosen newsletters, Substack and RSS combined into a themed, deduplicated briefing with inline citations. | Max $9/month; Pro $4.90/month. | Direct overlap with the core promise. [Synthesis](https://www.readless.app/features/ai-synthesis), [plans](https://www.readless.app/faq). |
| Inoreader | Feeds/newsletters/selected social sources; mentions, podcast/video analysis; scheduled cross-source reports and saved history. | Pro $7.50/month paid annually or $9.99 monthly; report add-on costs extra and exact price was not verified. | Rich analysis is already available elsewhere. [Pricing](https://www.inoreader.com/pricing), [scheduled reports](https://www.inoreader.com/blog/2026/03/automated-intelligence-reports-for-insights-delivered-to-you.html). |
| Readwise Reader | RSS/newsletters/articles, YouTube transcripts, saved X threads, AI reading tools and export. | $9.99/month annually or $12.99 monthly. | Strong existing habit for serious readers; saved X threads do not prove automatic account monitoring. [Product](https://readwise.io/read), [pricing](https://readwise.io/pricing/reader). |
| Twigest | Selected X accounts, feeds/YouTube/newsletters and a scheduled source-linked AI briefing. | Starter $9/month, Pro $19/month. | Direct overlap; its FAQ explicitly does not guarantee every matching post. [Official product](https://twigest.com/). |
| Folo, formerly Follow | Multi-format feeds, timeline summaries and scheduled briefings. | Comparable paid price not verified in this review. | Close overlap; RSSHub routes are not evidence of guaranteed all-platform access or a resale license. [Official repository](https://github.com/RSSNext/Folo), [product](https://folo.is/en). |
| UseDigest | Advertises a personalized daily briefing across newsletters, RSS and social sources, including X, YouTube and Instagram. | Comparable price not verified. | Broad-source positioning also exists; the homepage does not establish content completeness. [Official product](https://usedigest.com/). |
| Particle | Multi-source personalized general-news summaries and topic exploration. | Core free; Particle+ $2.99/month or $29.99/year. | A low-cost substitute for readers who mainly want general news. [Product](https://particle.news/landing), [plan announcement](https://particle.news/blog/particle-upgrades-dynamic-news-app-with-more-customizable-features). |
| Feedly Market Intelligence | AI topic/company monitoring, insights and newsletters for teams. | Standard $1,600/month annually up to 10 seats; Advanced $2,400 up to 25. | An established professional category, not proof of a consumer price. [Official pricing](https://feedly.com/market-intelligence/pricing). |

Huxe is discontinued, not current competition. Its official page says service ended 28 May 2026. The public notice does not establish why the business failed. [Shutdown notice](https://huxe.com/)

Potential differentiation to test: useful change-since-last-recap history, clear disagreements, transparent coverage and explicit reader priorities. No defensible moat has been demonstrated. Trusted distribution, reliable collection operations and feedback improving relevance could become advantages; each remains a hypothesis. Compare on the same sources and actual task, not feature-count checkboxes.

## Collection: the chosen scraping route

There are concrete public-content scrapers across the named families. Official API limits are not the sole technical gate under the founder's chosen route. Account types, formats, cost and actual completeness still need testing.

| Source family | Starting candidate | What public documentation supports | What the proof must establish |
| --- | --- | --- | --- |
| YouTube | [streamers/youtube-scraper](https://apify.com/streamers/youtube-scraper), maintained by Apify | Channel/video discovery, metadata, existing subtitles and optional paid speech transcription. | Actual caption/transcript coverage, language, timestamps, omitted visuals, restricted videos and repeat refresh. |
| Instagram | [apify/instagram-scraper](https://apify.com/apify/instagram-scraper) and [reel scraper](https://apify.com/apify/instagram-reel-scraper), maintained by Apify | Public post captions/media; reel actor offers optional audio transcripts. | Transcript option is off by default; captions do not explain all visuals/carousels. Private accounts are not assumed supported. |
| LinkedIn | [harvestapi/linkedin-profile-posts](https://apify.com/harvestapi/linkedin-profile-posts), maintained by partner HarvestAPI; [Bright Data](https://brightdata.com/products/web-scraper/linkedin) | Public profile/company posts without reader cookies, text/media/dates; optional engagement/comments. | Text truncation, article bodies, pagination, rich documents, edits and recent-post limits. Post media links are not video transcripts. |
| X | [apidojo/twitter-scraper-lite](https://apify.com/apidojo/twitter-scraper-lite), maintained by partner API Dojo; [Bright Data X](https://brightdata.com/products/web-scraper/twitter) | Account/search/post collection with text, authors, dates, media and engagement. | Search omissions, time filters, duplicates and query pricing. The cheaper tweet-scraper actor is unsuitable for repeated monitoring under its documented restrictions. |
| Substack/newsletters | [boundary/substack-newsletter-scraper](https://apify.com/boundary/substack-newsletter-scraper), community candidate; [Bright Data custom route](https://brightdata.com/products/web-scraper/substack) | Public post bodies/archives can be collected. | Low-usage community maintenance, custom domains, previews/paywalls, comments and full body quality. Web scraping does not capture email-only issues automatically. |
| Podcasts | Publisher RSS/transcript files, or [community episode actor](https://apify.com/themineworks/podcast-episode-scraper) | Episode metadata, show notes, audio links and publisher-supplied transcripts. | Missing transcripts need separate speech transcription; exclusives/no public RSS require another route. Actor does not create missing transcripts. |
| Blogs | RSS discovery and [apify/website-content-crawler](https://apify.com/apify/website-content-crawler), maintained by Apify | Public pages into article-like text/Markdown/HTML. | Navigation pollution, bylines/dates, pagination, previews and dynamic sites. Embedded media needs separate analysis. |

[Bright Data Instagram](https://brightdata.com/products/web-scraper/instagram) and [YouTube](https://brightdata.com/products/web-scraper/youtube) are useful fallback candidates. Complete public output schemas did not establish spoken transcripts for every format; test actual fields rather than relying on marketing copy.

Source discovery is separate from a user's following-list import. Adding public source URLs can work without assuming access to private following lists. Snapshots also do not guarantee a deletion stream: “not returned” does not automatically mean “deleted.”

### Relevant platform/provider constraints

Official YouTube caption download requires permission to edit a video; a viewer login is insufficient. That is why official captions alone do not establish arbitrary transcript access, although scraping providers offer other collection routes. [Caption endpoint](https://developers.google.com/youtube/v3/docs/captions/download)

LinkedIn's standard Community Management use restrictions disallow social-feed use and its overview says new `r_member_social` access is closed. This documents direct-API limitations, not proof that a public scraper cannot fetch a post. [Restricted uses](https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases), [overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)

Use scraping as selected, while recording terms/copyright/privacy restrictions relevant to commercial processing and display. A vendor returning content does not automatically resolve those questions. Do not label collection platform-endorsed without evidence. Private/paywalled access and use of personal login cookies are outside the current public-content proof.

Commercial alternatives were checked before the scraping direction was chosen. Phyllo now markets public, creator-independent content and transcript capabilities, but the fit and price need verification. Brandwatch excludes LinkedIn text in API downloads; Talkwalker restricts export of several social sources; Meltwater's standard API terms restrict use of its content in AI systems. These are vendor-specific limits, not a universal conclusion about scraping. [Phyllo](https://www.getphyllo.com/whats-new), [terms](https://www.getphyllo.com/terms-of-service), [Brandwatch](https://developers.brandwatch.com/docs/data-restrictions), [Talkwalker](https://developer.talkwalker.com/docs/getting-started/api-restrictions), [Meltwater](https://www.meltwater.com/en/product-specific-terms)

## Costs: collection can dominate AI

### Verified public prices

| Item | Public price / billing issue |
| --- | --- |
| Apify platform | Free $5 credit; Starter $19/month with $19 usage credit. Included credit is not an extra fee on top of covered usage. [Pricing](https://apify.com/pricing). |
| Apify billing | Most pay-per-event actors include compute/proxy costs, but some add platform usage; inspect the selected actor. Storage operations can add cost. [Billing documentation](https://docs.apify.com/actors/running/actors-in-store). |
| Instagram post results | Free-plan $2.70/1,000; Starter $2.30/1,000. Headline “from” is a different tier. [Actor pricing](https://apify.com/apify/instagram-scraper/pricing). |
| YouTube video records | Free $4/1,000; Starter $3/1,000. Optional generated transcription: Free $48/1,000 audio minutes; Starter $41/1,000. A 30-minute video costs $1.23 for Starter transcription alone. [Actor pricing](https://apify.com/streamers/youtube-scraper/pricing). |
| LinkedIn posts | HarvestAPI Free/Starter $2/1,000; optional comments/reactions and zero-result queries can also be billed. [Actor pricing](https://apify.com/harvestapi/linkedin-profile-posts/pricing). |
| X monitoring queries | Chosen API Dojo actor $0.016/profile/search query, about 40 tweets included; extras and single-post queries differ. Twenty profiles checked daily create a $9.60/month query floor. [Actor pricing](https://apify.com/apidojo/twitter-scraper-lite/pricing). |
| Bright Data ready-made scraper API | PAYG $1.50/1,000 delivered records, no monthly commitment. Advertised 5,000 monthly free credits are shared across the account/products, subject to eligibility. [Pricing](https://brightdata.com/pricing/web-scraper), [free-tier rules](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier). |
| Bright Data failed inputs | Pricing says failed deliveries are not charged, but the FAQ says incorrect-input errors can be billable. Empty/error output must be inspected. [FAQ](https://docs.brightdata.com/products/scrapers/scrapers-library/faqs). |
| Text AI example | Paid Gemini 3.5 Flash-Lite: $0.30/million input tokens, $2.50/million output tokens. Quality for this product is untested. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). |
| Separate audio transcription | AssemblyAI Universal-2 $0.15/audio hour. This is a separate service, not a way to obtain audio or a guarantee of equivalent accuracy/languages. [Pricing](https://www.assemblyai.com/pricing). |
| Example basic hosting/database | Workers paid starts $5/month, usage limits/overages apply; D1 has included limited paid usage. No stack selected. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/). |
| Example daily email | Postmark $15/10,000 emails plus $1.80/1,000 extra under the reviewed Basic tariff. 30,000 emails would be $51. [Pricing](https://postmarkapp.com/pricing). |

### Proposed access-proof cost envelope

Thirty-five sources checked daily for seven days means 245 source checks. At five returned items/check, that is at most 1,225 returned item records—many may be the same old items. At Bright Data's PAYG unit rate, 1,225 records would be $1.84 **if** the chosen endpoint bills at that item unit. RSS, custom crawls, query fees and transcripts have different units.

Five X profiles checked daily for seven days imply $0.56 of the selected actor's profile-query floor. Five selected 30-minute generated YouTube transcripts imply $6.15 of Starter transcription charges; existing captions may avoid that fee. These Apify events can fit inside the $19 included credit if the plan/actor is eligible. Do not add the entire included usage twice.

Recommendation: a **€50 total cash ceiling** for the seven-day proof, free credits first, at most **150 minutes of generated audio transcription**, no annual purchase and no automatic paid top-up. This is a risk limit grounded in a bounded example, **not an all-inclusive supplier quote**. Check account balances, funding minimums, taxes, currency and exact actor inputs before running. If a required tool cannot fit, stop and revise the brief. Native captions and generated speech-to-text must be reported separately.

Limit output to control spending without pretending this proves high-volume coverage: if a prolific sample source publishes beyond the cap, record the missed items and treat the result accordingly. Comments are deferred and receive no collection budget in the core proof.

### Conditional monthly operating example

Planning assumptions: 30 sources/user; average 0.2 updates/source/day, or six updates/user/day; 30 days; each unique source item shared by five users. Analyze an item once, then personalize the recap. Private subscription material must not be reused across readers merely to improve this arithmetic.

Assume 5,000 input and 500 output tokens/item ($0.00275 at the example model), plus 10,000 input and 800 output tokens/daily personal recap ($0.005).

| Monthly workload / subtotal | 100 users | 1,000 users |
| --- | ---: | ---: |
| Item deliveries across readers | 18,000 | 180,000 |
| Unique new items analyzed | 3,600 | 36,000 |
| Text AI | $24.90 | $249 |
| Example server + email + estimated logs/backups | $30 | $81 |
| Text processing/delivery, before collection | **$54.90** | **$330** |
| Optional separate transcription: 20% of items × 30 min at $0.15/hour | $54 | $540 |
| With that separate transcription, still before collection | **$108.90** | **$870** |

These subtotals exclude scraping/source fees, development, support, salaries, acquisition, professional services and vendor taxes. They are not an all-in price for broad access. The transcription line uses a separate service and assumes audio is obtainable and usable; do not substitute it for an Apify transcript bill.

Repeated collection changes the total. With five-user source overlap, 100 customers × 30 sources / 5 implies 600 unique sources. Daily checking returning five items/check yields 90,000 returned rows/month. At an illustrative $1.50/1,000, that alone is **$135/month**, compared with $5.40 if only the 3,600 genuinely new items were billable. At 1,000 users those scenarios are $1,350 versus $54. Actual endpoint units, date filters, repeat billing and platform mix must be measured; these are alternative scenarios, not charges to add together.

Generating transcripts through the Apify Starter rate for 720 thirty-minute items at 100 users would cost **$885.60/month**, rather than $54 at the separate transcription example. Existing captions, item selection and audio caps matter substantially. With no overlap, costs climb further. Four posts/source/day instead of 0.2 would increase the item workload twentyfold.

Build cost: not responsibly quoted while required formats, collectors, source reliability and the complete specification remain unresolved. After source proof, estimate fixed, reviewable build milestones with a cash/time cap. Hosting costs are not development costs.

## Revenue and acquisition

Start with a subscription hypothesis rather than advertising. Ads and paid placement would introduce incentives at odds with the reader-controlled promise; whether to add them is a later business decision. Proposed pilot €15 for two weeks and continuation €12/month remain unapproved. Professional team pricing should be tested separately from consumer pricing.

Example €12 consumer subscription, **assuming** German 19% VAT applies: net sales €10.08; standard EEA Stripe processing €0.43; recurring Billing €0.084; assumed 3% gross refund reserve €0.36. Approximately **€9.21 remains before collection, AI, delivery, support, acquisition and salaries**. This is not profit. Gross billed revenue would be €1,200/month at 100 paying users or €12,000 at 1,000. USD vendor costs have not been combined with EUR revenue using an unstated exchange rate. [Stripe](https://stripe.com/de/pricing), [Billing](https://stripe.com/de/billing/pricing), [EU VAT reference](https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/indexamp_en.htm)

Five minutes of support/customer/month becomes about eight hours at 100 customers or 83 hours at 1,000. Manual rescue of broken scrapers is service labor, even when the API bill is small.

Recommended acquisition experiments **after the access gate and test approval**:

- Consultants: relevant professional communities, work contacts and niche expert referrals.
- Marketing buyers: agency/brand communities and targeted demonstrations against their real monitoring question.
- General readers: interest communities and voluntary creator referrals.

No channel performance is established. Do not start with an uncapped free daily product or paid ads. Track each channel from qualified prospects to setup, first useful recap, payment and renewal. The founder may send invitations; no outreach is authorized by this document.

Cash acquisition cost = channel spending / new paying customers. Also count founder time: (€0 cash + four hours at an assumed €30/hour) / five paying customers = **€24/customer**, even though no advertising was bought. Conversely €100 advertising producing one paying user means €100/customer regardless of cheap clicks.

For the rapid-growth goal, a small paid pilot is only a first signal. Observe two renewals, measured service costs and a repeated channel before increasing spend. A proposed three-month payback target at €9.21 before service costs permits only €21.63 acquisition spending if actual delivery/support costs €2/month. Those thresholds and the €2 assumption are planning choices, not proven industry benchmarks. Do not invent lifetime value or market size from a tiny pilot.

## 19 October 2026 — larger allowances and multilingual planning update

The founder rejected English-only launch and the smaller allowance recommendation. SPEC v1.0 proposes six interface/recap/source languages and 50 sources (max 15 X), 200 analyzed updates/day, 3,000/month and 300 generated minutes/month. Exact list/limits are pending whole-version approval.

Public prices were rechecked without accounts, supplier execution or spending. [ALLOWANCES.md](ALLOWANCES.md) contains rates, complete arithmetic and limitations. At full use, displayed components total about $36.14/person without reuse or $7.64 with hypothetical five-reader reuse; a 50% text-token stress scenario gives $40.53 / $8.73. These are not all-in costs, measured sharing or hard cash ceilings. One chosen-language recap per reader avoids generating all six renditions. Translation quality and reviewer work remain separate.

The earlier €12 subscription and €15 pilot examples above remain historical hypotheses, not approved prices for the larger package. The revised proposed customer test is fourteen consecutive daily recaps, not ten weekdays. No demand, acquisition, renewal or actual supplier-cost result has been obtained since the original desk research.

## 21 October 2026 — creator workspace, retention and sharing assessment

The founder supplied a creator-led workspace reference. [VISION-COMPARISON.md](design/VISION-COMPARISON.md) separates observed design behavior, persona hypotheses and proposed additions. Creator navigation can complement the accepted daily briefing; a latest-first post feed alone does not establish the original analysis value. Current public feature pages confirm that [Readless](https://www.readless.app/features/ai-synthesis) documents thematic cited synthesis and [Inoreader](https://www.inoreader.com/features/intelligence) documents mentions and scheduled cross-article reports. These are vendor feature claims, not new hands-on evaluations or price checks.

Sharing precedents: [Reader](https://docs.readwise.io/reader/docs/faqs/sharing) documents public document bundles with import, annotated links and highlight images; its bundles are not creator-feed subscriptions. [Feedly](https://docs.feedly.com/article/715-what-is-a-personal-board) documents saved-topic boards, with [public/private sharing modes](https://docs.feedly.com/article/61-how-can-i-share-a-board). Adapting these patterns to editable creator-source collections and cited insight cards is a proposal. No retention, referral-conversion or growth improvement for therecap is established. Old Inoreader Bundles announcements are not a current precedent: the [official notice](https://www.inoreader.com/uk/blog/2014/10/bundles-collect-share-and-discover-best.html) says the feature was deprecated in 2024.

No source/provider execution, spending or customer testing occurred. Cross-day change detection, bookmarks/search, creator grouping and sharing remain unapproved scope proposals; daily timing and broad-access gates are unchanged.

## 21 October 2026 — backend platform assessment

[BACKEND-COMPARISON.md](BACKEND-COMPARISON.md) recommends Supabase for flexible historical queries/reporting and PostgreSQL portability, while recognizing Convex's integrated TypeScript, reactive-query and workflow strengths. Both support relationships, search and background scheduling. Current official capabilities, function limits and entry prices were checked; no actual workload cost/performance comparison was run. Platform selection, setup and M0 remain pending. No supplier execution or spending occurred.
