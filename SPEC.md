# Product specification

Version: **0.1 — DRAFT**. Date: 15 October 2026. Owner: founder. Approval: **not yet requested for this complete version / not granted**.

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

Source families named by the founder: YouTube, X/Twitter, Instagram, LinkedIn, podcasts, Substack/newsletters and blogs. Q6 approves testing all seven under source-access proof v0.1. Private content, paid material, Stories/live streams and complete historical backfill are not implicitly promised. The proof approval does not approve this complete product specification.

Latest direction, D08: defer actual checks of Apify and all other scrapers; assume usable collection capability while completing the product specification. This is a planning assumption, not verified full-content coverage, reliable refresh or measured production cost. Supplier sign-in is not a prerequisite to continuing this document.

## Product behavior requested in the idea

1. The reader has an account and chooses sources to follow.
2. A daily recap groups updates by topic rather than listing every post or reproducing full originals.
3. The recap indicates how many followed sources updated.
4. The reader sees relevance based on their interests and preferences.
5. Useful snippets and references let them decide which originals deserve attention.
6. A dated history lets them trace developments over time.
7. The broader vision includes brand/sponsor mentions, source sentiment, reach and comment sentiment. D05 permits staging richer analysis later; exact first-release analysis fields remain open.

## Recommended first product, conditional on access and validation

These are proposals, not settled requirements:

- A responsive web app before separate mobile apps.
- Add public source URLs manually; optional automatic import of following lists only after separately proving that capability. Scraping public posts does not automatically provide a user's following list.
- Readers state a few interests and work/personal priorities. They can change them and give “more/less like this” feedback. Explain the reason for a relevant item; avoid unexplained numeric relevance scores.
- A dated recap with 3–5 main topics, a short account of what changed, disagreements when genuinely supported, a relevance explanation, and citations at the statement level.
- Days ordered by date. Within each day, show topics using an explicit, user-approved relevance rule. “No hidden engagement ranking” is a clearer promise than “no algorithms,” because grouping and relevance still use algorithms.
- Distinguish sources followed, checked successfully, updated and actually analyzed. Failed checks are never counted as “no update.”
- Show whether an update was analyzed in full, partly analyzed, or detected without enough content. Partial coverage must be visible.
- A reader can open originals, save a topic, inspect the day's source coverage and revisit earlier recaps.
- Support “nothing new,” late arrivals, provider failures, corrections and deleted originals. History retention must follow source restrictions; a permanent copy of all originals is not promised.
- Keep any private newsletter inputs and reader profiles separate between users. Reuse analysis only when the material and use permit it; do not share private subscription content.
- Treat collected content as untrusted material. It must not instruct the application, expose credentials or trigger external actions.
- Cancellation, account deletion, data export and usage limits should be designed before paid launch. Jurisdictions, retention periods and applicable privacy notices remain to be settled.

## Analysis rules proposed for later releases

- A brand mention is not sponsorship. Sponsor labels require explicit supporting disclosure.
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

## Still to decide

Production supported account/content types; daily frequency and freshness; production source/item limits; first-release analysis fields; default recap order; languages; history and deletion behavior; email vs app delivery; pricing by audience; privacy/retention; customer-test thresholds; technical architecture. The source-proof scope and €50 cap are approved separately in Q6.

## Approval procedure

Continue short decision rounds, revise this document and its acceptance criteria, and present a named final candidate version. Record explicit founder approval and the matching plan in docs/DECISIONS.md before app implementation. Later scope changes require a recorded decision and updated plan; ordinary implementation details can be handled autonomously within approved scope.

Deferred scraper verification must not block these decision rounds. Customer trials, paid launch and claims of complete working coverage are separate from specification approval.
