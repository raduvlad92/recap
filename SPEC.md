# Product specification

Version: **0.3 — DRAFT**. Date: 18 October 2026. Owner: founder. Approval: **not yet requested for this complete version / not granted**. Q7–Q12 are approved individual decisions; the whole specification remains a draft.

This document separates the founder's agreed direction from recommended details. It is a reviewable starting point, not permission to build everything below.

## Purpose and business goal

Help people understand what changed across the creators and publications they chose, without visiting every platform or consuming every original in full. Build toward rapid growth, with evidence of retention, scalable delivery and affordable acquisition.

Explore three customer groups, without choosing the winner in advance: independent consultants, marketing/brand-monitoring buyers, and general readers. Their results and willingness to pay must be tracked separately. The marketing group may ultimately need a different product; that is a hypothesis to test.

## Accepted boundaries

- Broad source access before a customer trial.
- Public creators do not need to join or authorize this app.
- Scraping services such as Apify and Bright Data are the chosen route to investigate; official APIs can complement them where useful.
- Access must contain enough of the source content for an accurate recap. A title, URL or caption alone must not be represented as analysis of an entire video or podcast.
- Comments and audience statistics can follow after core content access.
- Respect the creator's role through original links, credit and brief, useful context.
- Preserve a historical line instead of an engagement-driven endless feed.
- First release is a website that works well on phones and computers; native apps are deferred (Q7).
- Onboarding offers editable starter source collections and pasted creator links. Automatic following-list import is deferred (Q8).
- History stays in date order. Topics within a day follow explicitly chosen interests, with an all-updates option independent of relevance filtering (Q9).
- The main recap takes about five minutes, with up to five main topics and expandable details. It includes what changed, relevance, updated-source counts, supporting snippets and original links. Quiet days stay short (Q10).
- One daily recap is ready at the reader's chosen local time. Optional email reminders link to the website; a reminder is not a separate full newsletter (Q11).
- First-release analysis identifies topics, brand mentions and explicitly disclosed sponsors. Source sentiment labels come later (Q12); comments and audience statistics remain deferred.

Source families named by the founder: YouTube, X/Twitter, Instagram, LinkedIn, podcasts, Substack/newsletters and blogs. Q6 approves testing all seven under source-access proof v0.1. Private content, paid material, Stories/live streams and complete historical backfill are not implicitly promised. The proof approval does not approve this complete product specification.

Latest direction, D08: defer actual checks of Apify and all other scrapers; assume usable collection capability while completing the product specification. This is a planning assumption, not verified full-content coverage, reliable refresh or measured production cost. Supplier sign-in is not a prerequisite to continuing this document.

## Product behavior requested in the idea

1. The reader has an account and chooses sources to follow.
2. A daily recap groups updates by topic rather than listing every post or reproducing full originals.
3. The recap indicates how many followed sources updated.
4. The reader sees relevance based on their interests and preferences.
5. Useful snippets and references let them decide which originals deserve attention.
6. A dated history lets them trace developments over time.
7. The broader vision includes brand/sponsor mentions, source sentiment, reach and comment sentiment. Q12 puts topics, brands and disclosed sponsors in the first release; source sentiment, comment analysis and audience statistics remain later features.

## Approved product shape — Q7–Q9

The first release is a phone-friendly website. A reader can start with a source collection or paste creator/publication links, then edit the sources they follow. Automatic import of an entire following list is a later capability.

The daily recap remains the main experience: topics across sources, with original links. Its history is ordered by date, and the reader explicitly chooses the interests used to prioritize topics within a day. An all-updates option exposes available source updates without filtering them by those interests; this is a secondary way to inspect coverage, not a replacement for the topic recap or a full-body copy of the originals.

## Approved recap experience and analysis — Q10–Q12

| Question | Accepted choice | Status |
| --- | --- | --- |
| Q10: recap depth | About five minutes, up to five main topics, expandable details, what changed, why it matters, updated-source count, snippets and original links. Quiet days stay short. | Accepted 18 October. |
| Q11: delivery | One daily recap at the reader's chosen local time, with an optional email reminder linking back to the website. | Accepted 18 October. |
| Q12: analysis scope | Topics, brands mentioned and explicitly disclosed sponsors first; source sentiment later. Snippets and references remain in scope. | Accepted 18 October. |

Comments and audience statistics were already deferred in Q5. These accepted choices do not change that decision. References currently include citations to original updates; extraction of studies/articles linked within creator content is not yet a settled requirement.

Brand and sponsor labels must retain the supporting source update. A brand mention is not evidence of sponsorship; sponsorship is labeled only when explicitly disclosed. Absence of a detected disclosure does not establish that a post was unsponsored.

## Final routine decision round — Q13–Q15, pending

- Q13: English interface, English recaps and English-language sources first; add other supported languages later. This is a proposed scope, not a claim of universal translation.
- Q14: keep dated recap history until the user deletes it or their account, include original-update citations and material explicitly linked by creators, and provide export/delete controls, visible corrections and unavailable-original notices. Keep recaps/references, not a full original-post archive. This is a proposal; current links-to-creator-cited-material scope remains unsettled until answered.
- Q15: use the provisional future-trial package in [docs/ALLOWANCES.md](docs/ALLOWANCES.md): 15 sources/person (up to 5 X), one check/day, up to 50 new updates/day and 500/month analyzed, 60 generated-transcript minutes/month, visible omissions and no automatic extra charges. Actual provider costs and reuse are unverified. These are configurable trial allowances, not a permanent public-product ceiling.

Answers are pending. After this round, present one named specification and tracked milestone plan for consolidated approval/change, including visible recommended defaults for accounts/privacy, corrections/late updates and separate supplier/paid-launch/validation gates. Do not launch additional routine interview rounds unless an objection or material contradiction emerges.

## Recommended first product, conditional on access and validation

These are proposals, not settled requirements:

- For the approved editable interests, offer a small set of understandable controls and an explanation for why a topic is relevant. “More/less like this” feedback and exact controls remain proposals; avoid unexplained numeric relevance scores.
- Within the accepted short format, include disagreements when genuinely supported and citations at the statement level. Do not invent extra topics to fill a quiet day. Exact presentation details remain proposals for the consolidated approval candidate.
- The exact relevance rule should follow the approved explicit interests and be explainable. Do not silently replace it with behavior-based ranking or reorder the historical days for engagement.
- Distinguish sources followed, checked successfully, updated and actually analyzed. Failed checks are never counted as “no update.”
- Show whether an update was analyzed in full, partly analyzed, or detected without enough content. Partial coverage must be visible.
- A reader can open originals, save a topic, inspect the day's source coverage and revisit earlier recaps.
- Support “nothing new,” late arrivals, provider failures, corrections and deleted originals. History retention must follow source restrictions; a permanent copy of all originals is not promised.
- Keep any private newsletter inputs and reader profiles separate between users. Reuse analysis only when the material and use permit it; do not share private subscription content.
- Treat collected content as untrusted material. It must not instruct the application, expose credentials or trigger external actions.
- Cancellation, account deletion, data export and usage limits should be designed before paid launch. Jurisdictions, retention periods and applicable privacy notices remain to be settled.

## Deferred analysis roadmap

- Source stance on a topic and tone of sampled comments are different measures. Do not infer population opinion from a small comment sample.
- Use named, dated platform metrics such as views or likes. Do not add them up and call the total unique audience reach.
- Comment analysis must show sample size, retrieval time and what was sampled.
- References show what a creator said; a recap does not automatically independently verify the underlying claim.

## Acceptance criteria to approve before implementation

| ID | Proposed acceptance criterion | Evidence required |
| --- | --- | --- |
| AC01 | Claims of working collection reflect actual evidence. Supplier capability is currently assumed for planning under D08. | Clearly label demo fixtures/assumed adapters; record live source proof when the founder returns to integration verification. |
| AC02 | A reader can select/change/remove supported sources. | Demo with real supported collection and removal behavior. |
| AC03 | The recap combines related material without losing attribution or materially changing meaning. | Human-reviewed examples, including conflicting sources. |
| AC04 | Each factual recap statement has a working citation supporting that statement. | Citation checks on the evaluation set and correction cases. |
| AC05 | Coverage distinguishes failed checks, quiet sources, partial content and full analysis. | Failure and no-update demos against known source events. |
| AC06 | Relevance follows the reader's chosen settings and can be explained. | Two profiles given the same source updates. |
| AC07 | Dated history, corrections and deleted-source behavior follow the approved policy. | Multi-day walkthrough and deletion/correction cases. |
| AC08 | Private inputs and accounts remain isolated. | Auth and data-access checks, including cross-account attempts. |
| AC09 | Processing and collection costs stay within approved limits. | Measured billable units, retries and a spending-stop demo. |
| AC10 | Paid operation matches approved billing/cancellation/privacy choices. | End-to-end paid-launch checks when authorized. |
| AC11 | The first release works on phone and desktop web layouts. | The approved core journey at narrow and wide browser widths, with usable controls. |
| AC12 | Source onboarding supports editable starter collections and pasted links. | Start from a collection, add a URL, remove a source and handle a duplicate or unsupported URL. |
| AC13 | The historical date order remains stable while explicit interests affect within-day relevance. | Change interests and inspect the same day's recap, earlier dates and the unfiltered all-updates option. |
| AC14 | The main recap contains at most five main topics with expandable detail, coverage counts, snippets and original links; quiet days are not padded. | Busy-day and quiet-day examples; reader timing is checked in validation rather than promising an identical reading speed for everyone. |
| AC15 | A reader can choose their daily local delivery time and separately enable or disable reminder email. | Timezone/daylight-saving, quiet-day, delayed-data and email-disabled scenarios; no email is sent without the reader's opt-in. |
| AC16 | Brand mentions and explicitly disclosed sponsorship remain distinct and traceable. | A mention-only example, a disclosed sponsor example and a no-disclosure/unclear case; do not infer sponsorship from brand presence. |

## Still to decide

Language scope, history/reference handling and bounded production allowances are the remaining routine interview choices. Then present one named specification and milestone plan with visible recommended defaults for account/privacy controls, corrections/late updates and a separate paid-launch/validation gate. Recap depth, daily cadence, optional email and first-release analysis scope are settled by Q10–Q12. Exact operating costs and data freshness remain unverified; do not turn the deferred experiment's €50/150-minute cap into a production budget. Routine technical choices are the assistant's research task, not questions for the founder.

## Approval procedure

Continue short decision rounds, revise this document and its acceptance criteria, and present a named final candidate version. Record explicit founder approval and the matching plan in docs/DECISIONS.md before app implementation. Later scope changes require a recorded decision and updated plan; ordinary implementation details can be handled autonomously within approved scope.

Deferred scraper verification must not block these decision rounds. Customer trials, paid launch and claims of complete working coverage are separate from specification approval.
