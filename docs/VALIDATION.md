# Cheapest useful validation, revised to the founder's choices

Status: Stage A approved in Q6 on 15 October 2026; Stages B/C remain proposals. **No customer trial before broad access is secured.** Scraping with Apify, Bright Data and alternatives is the selected route. The approved execution/spending brief is [ACCESS-PROOF.md v0.1](ACCESS-PROOF.md).

Latest steering D08: Stage A execution is deferred for all scrapers; assume they work while continuing product specification. Do not pursue provider login or spending now. This is not an actual access pass or authorization to run a customer trial. The earlier feed preflight remains valid point-in-time evidence.

## Stage A: prove access before building the app

The free public-document audit is complete. It identifies candidate products, fields, charges and restrictions. It does not establish that a scraper works or that broad access has been secured.

The next useful experiment is a small source-collection proof, separate from the application. No dashboard, login system, payment system or automated customer recap is needed to find out whether the core content can be collected.

Scope approved in Q6:

- All seven named source families: YouTube, X, Instagram, LinkedIn, podcasts, Substack/newsletters and blogs.
- Public creators, without those creators joining the app. Choose the sample ourselves rather than accepting only a vendor's showcase accounts.
- Approximately five public sources in each family, with representative text/video/audio formats where relevant. Podcasts/newsletters/blogs should not be counted as social-platform accounts merely to fit an actor's interface.
- Check recent items and new updates over seven days. An archive sample alone does not prove daily refresh.
- Use Apify/Bright Data candidates and a fallback only when it adds evidence. Do not run identical paid jobs unnecessarily.
- Initial focus is usable content for the recap; comments and audience metrics are deferred by founder decision.

### Define success before running

For every required family, save:

1. Exact supplier, actor/dataset version or identifier, maintenance owner, input parameters and account requirements.
2. Original item URL/ID, creator/source, publication time and observed collection time.
3. Usable content: full post/article text or sufficiently complete, accurate transcript/content representation. Describe omissions such as visuals, carousel text or embedded speech. Metadata-only output is partial, not a pass for content analysis.
4. A manual comparison with a known set of original public updates: what was found, missed, duplicated or misdated. Propose at least 90% capture within 24 hours for the agreed sample; this threshold is a proposed product constraint, not a measured vendor capability.
5. Error and retry behavior; unavailable/deleted posts; rate/size limits; a provider failure. Do not hide failures as quiet sources.
6. Billable items/runs/compute/proxy/transcript charges, retries, minimums, trial-credit treatment, and a projected 100-user scenario. No surprise subscription renewals.
7. Source and supplier restrictions affecting AI processing, brief snippets, user-facing display, reuse across readers, retention and deletion. Record unresolved risk honestly; using a scraper is not evidence of platform endorsement or permission.
8. A pass / conditional / fail result with the precise supported account/content types. Small samples never prove support for every creator.

Broad access passes only when every mandatory platform meets the agreed usable-content, freshness, reliability and cost criteria. A cheaper, title-only result must not quietly substitute for meaningful content. If a mandatory source fails, present the evidence and options; do not start a limited-source customer trial without the founder changing D03.

### Spending and execution

Public-document research and initial public-feed checks: €0 subscription spending. Actual scraper proof: **€50 total cash cap approved in Q6**. Supporting price arithmetic is in docs/RESEARCH.md; this is a bounded risk limit, not a complete quote. Account availability, currency, minimum charges and billable behavior must be checked before any metered run. No user account, annual contract, paid actor, proxy purchase, or vendor outreach has been initiated. Current evidence: [preflight report](access-proof/PREFLIGHT.md).

The former limited-source €100 concierge recommendation does not price this broader experiment. Unknown access costs are unknown, not zero.

## Stage B: later paid usefulness test across all three audiences

Only after Stage A passes, prepare a reviewable offer and seek approval for execution. Proposals below are not approved.

- Three labeled groups: consultants, marketing/brand-monitoring buyers and general readers.
- Start with five paying participants in each group, 15 total. Recruit more suitable prospects than this; do not assume every invitation converts.
- Ten weekday recaps over approximately two weeks. Offer a clear manually checked trial; proposed price €15 for the trial, then test an actual €12/month continuation. These are price hypotheses, not proven demand or a universal price for all buyers.
- Collect each participant's must-have sources before payment and verify that the passed collection scope serves them. Do not hide a missing essential source to keep the trial cheap.
- To control manual work, aim for at most 60 unique sources across participants. If essentials exceed that, revise scope/budget openly rather than excluding them silently.
- Deliver a short topic-based recap, what changed, why it may matter, supporting original links, coverage status and a feedback prompt.
- Compare the same source set against the participant's existing workflow and a relevant competitor. Time saved and useful decisions matter more than summary volume.

Proposed directional gates per original five-person audience group:

| Measure | Proposed result |
| --- | --- |
| Paid start | At least five people actually pay; a waitlist is insufficient. |
| Repeat usefulness | At least four use at least six of ten recaps, measured through feedback/useful actions; email opens alone are insufficient. |
| Payment after novelty | At least three actually pay for continuation; do not count stated intention. |
| Coverage | Meet the source-proof criteria for agreed must-have sources; report failures. |
| Trust | No unresolved serious invented claim or materially misleading citation. |
| Difference from alternatives | Record preference, reasons and useful outcomes against the existing workflow/competitor. |

Report separately by group, including dropouts. A pooled average can conceal the only promising group. Five participants per group provide direction, not proof of a large market. Use the results to choose the next focus or pivot with the founder.

Labor estimate for 15 participants: roughly 30–60 hours total, depending on source overlap and checking needs. At an assumed €30/hour, that is €900–1,800 of time cost, separate from cash. A defensible cash total depends on actual source charges and test scope.

## Stage C: test growth rather than only usefulness

After a useful small product, measure paid cohorts through two monthly renewals and test acquisition beyond the founder's contacts. Capped channel experiments can run alongside renewal observation; increasing spend waits for both. Proposed planning gates, not industry benchmarks: 30 paying users per audience selected for the next growth test, 80% of the original paid cohort retained at day 60, stable coverage, and acquisition spending recovered within three months of contribution after service/support costs. These thresholds remain open for approval and adjustment before execution.

Track each channel's qualified prospects, setup completion, first useful recap, paying customers, renewals, refunds, cash spend and founder hours. Repeat the best channel with a new cohort before scaling its budget. Do not estimate lifetime value from a two-week test.

The founder sends invitations or authorizes specific outreach separately. The assistant may research, draft, check and save artifacts; this plan does not itself authorize sending messages or collecting payments.
