# Decisions and interview

Updated: 18 October 2026. Individual answers below are accepted directions. They do not imply approval of the entire specification.

## Accepted founder decisions

| ID | Decision | Evidence |
| --- | --- | --- |
| D01 | Aim for a business capable of rapid growth. | Q1: “A business aimed at rapid growth.” |
| D02 | Explore consultants, marketing/brand-monitoring buyers and general readers; pivot from evidence. | Q2: “all of them and then we pivot based on what we get.” |
| D03 | Broad source access must precede customer testing. | Q3: “Only test after broad platform access is secured.” |
| D04 | Following public creators must not require those creators to join. | Q4: “Yes — creators should not need to join.” |
| D05 | Usable content first; comments and audience statistics later. | Q5: “Yes — usable content first; richer analysis later.” |
| D06 | Investigate scraping through Apify, Bright Data and other suppliers. | Subsequent instruction: “we will scrape with apify, brighdata and others”. |
| D07 | Execute source-access proof v0.1, all seven families, five public sources each, seven days, 150 generated-audio minutes and €50 total, free credits first. | Q6: “Yes — approve the proof, up to €50 total.” |
| D08 | Defer live checks of all scraping providers and assume they work for continued product planning. No provider authentication or spending now. | “ignore apify for now, assume that it works”; then “same for other scrapers”. |
| D09 | Release a phone-friendly website first; native apps later. | Q7, 17 October: “Yes — phone-friendly website first”. |
| D10 | Start source onboarding with editable starter collections and pasted creator links; following-list imports later. | Q8, 17 October: “Yes — starter collections and pasted links first”. |
| D11 | Keep history in date order; use explicitly chosen interests for within-day topic priority and offer all updates. | Q9, 17 October: “Yes — dated history and explicit interest controls”. |
| D12 | Short briefing, up to five main topics, expandable details, what changed/relevance, source counts, snippets and original links; quiet days stay short. | Q10, 18 October: “Yes — short briefing with expandable details”. |
| D13 | One daily recap at the reader's chosen local time with an optional email reminder linking to the website. | Q11, 18 October: “Yes — daily recap and optional email reminder”. |
| D14 | Topics, brand mentions and explicitly disclosed sponsors first; source sentiment labels later. | Q12, 18 October: “Yes — topics, brands and disclosed sponsors first”. |

Original requested product behavior: topics rather than a simple post list; snippets and original references; profile-based relevance; daily updated-source counts; historical timeline; preserve credit to creators. Sponsors, brands, sentiment, reach and comment sentiment are part of the vision, with D05 deferring the richer access requirement.

## Recommendations superseded by those decisions

- A small profitable business as the primary goal: superseded by D01.
- Independent AI consultants as the sole initial customer group: superseded by D02.
- A limited RSS/newsletter-only customer concierge test before broad access: rejected by D03.
- Requiring creator partnerships as the universal collection route: incompatible with D04.
- Treating official API availability as the only feasible access route: superseded by D06. Platform documentation remains useful evidence of constraints and risks.
- Completing supplier proof before continuing product specification: superseded by D08. Actual content access remains unverified; feasibility is assumed for planning. This does not turn the earlier feed preflight into an all-platform pass.

## Design tree

```text
Rapid-growth business [accepted]
├── Audiences: all three explored [accepted]
│   ├── Later: compare results separately for each audience [proposal]
│   ├── Later: choose initial focus/pivot from results [pending evidence]
│   └── Later: pricing and acquisition per buyer [open]
├── Broad access before customer trial [accepted]
│   ├── Public creators need not join [accepted]
│   ├── Content sufficient for a recap [accepted]
│   ├── Comments and audience statistics later [accepted]
│   ├── Scraping providers: Apify/Bright Data/alternatives [chosen route]
│   ├── All seven platform families, public-content proof scope [approved in D07]
│   ├── Scraper feasibility [assumed for planning in D08; live proof deferred]
│   └── Source proof v0.1 scope and €50 cap [approved in D07; execution deferred by D08]
├── Daily product
│   ├── Topic-based recap, source links, relevance, history [requested]
│   ├── Phone-friendly website first [accepted D09]
│   ├── Editable starter collections and pasted links [accepted D10]
│   ├── Date-ordered history; explicit within-day relevance and all updates [accepted D11]
│   ├── Short expandable recap, up to five main topics [accepted D12]
│   ├── Daily chosen local time and optional reminder email [accepted D13]
│   ├── Topics, brands and disclosed sponsors; sentiment later [accepted D14]
│   ├── Language, history/references and production allowances [final routine round]
│   └── Corrections, deletions, missing data and privacy [proposal/open]
├── Customer validation [blocked by access gate]
│   ├── Paid pilot across three groups [proposal]
│   └── Repeat use, willingness to pay, source coverage [not measured]
└── Implementation [awaiting approved product scope; supplier access assumed for planning]
    ├── Approve versioned specification [pending]
    ├── Select technology against measured needs [not selected]
    ├── Milestones with demos and evidence [plan drafted]
    └── Retention and repeatable acquisition before scaling [proposal]
```

The founder has deferred scraper verification. Continue the daily-product branch using explicit assumptions. Do not ask for supplier login again or treat the deferred proof as a prerequisite to discussing/approving the product specification. Actual customer testing remains unstarted and unapproved.

## Q6 — approved

The founder approved docs/ACCESS-PROOF.md v0.1: all seven source families, five public sources each, seven days, at most 150 generated-audio minutes and a €50 total cash cap, using free credits first. Response: “Yes — approve the proof, up to €50 total.” This approves only the collection experiment, not SPEC.md or app implementation.

At that checkpoint execution required a signed-in provider account. D08 subsequently deferred this requirement and all scraper execution for now. No credentials were requested in chat or saved in the project.

## Q7–Q9 — accepted on 17 October 2026

- Q7: first release as a phone-friendly website. Accepted.
- Q8: onboarding through editable starter source collections and pasted creator links. Accepted.
- Q9: date-ordered history, with topics inside each day prioritized using explicitly chosen interests and an all-updates view. Accepted.

These are approved individual requirements, recorded in SPEC.md v0.2. They do not approve the whole specification or authorize app implementation. The earlier provider-sign-in question remains withdrawn under D08.

## Q10–Q12 — accepted on 18 October 2026

- Q10: about five minutes, up to five main topics with expandable details, what changed, personal relevance, source counts, snippets and original links. Accepted; quiet days stay short.
- Q11: one daily recap at the reader's local chosen time, optional email reminder linking to the website. Accepted.
- Q12: topics, brand mentions and explicitly disclosed sponsors first; source sentiment later. Accepted. Original snippets/references remain; comment sentiment and audience statistics are already deferred by D05.

These answers are recorded in SPEC.md v0.3. No whole-version approval or implementation authorization is implied. Next, settle language scope, history/reference handling and bounded allowances, then present one consolidated named specification and tracked milestone plan for approval/change. Recommended account/privacy, correction and launch defaults must be visible in that candidate; do not create endless new interview rounds unless an objection or material contradiction appears. Routine technical choices should be researched and recommended by the assistant, not handed to the non-developer founder.

## Final routine round — Q13–Q15, awaiting answers

Presented on 18 October 2026, with yes recommended for each:

- Q13: English interface, English recaps and English-language sources first; other supported languages later.
- Q14: recap history until user deletion/account deletion; original-update citations and links explicitly included by creators; export/delete controls, visible corrections and unavailable-original notices. This does not promise a full original-content archive.
- Q15: provisional future-trial allowances: 15 sources/person (max 5 X), one check/day, max 50 new updates/day and 500/month analyzed, 60 generated-transcript minutes/month, visible omissions and no automatic overages. Supporting arithmetic and limitations: docs/ALLOWANCES.md. The earlier €50/150-minute experiment budget is separate.

These are proposals, not accepted decisions. No trial, supplier job or spending starts from the answers. After they are settled, provide one named full-spec and matching milestone-plan approval candidate; branch again only for a real objection or contradiction.

## Approval register

| Artifact | Version/status | Approval evidence |
| --- | --- | --- |
| Product specification | 0.3 — draft | Q7–Q12 individual choices accepted; no whole-version approval yet. |
| Source proof brief | v0.1 approved in Q6; execution DEFERRED by D08 | Supplier capability assumed for planning; no current sign-in/spending action. |
| Customer pilot | Conditional proposal | None; waits for broad access |
| Implementation plan | Draft with blocked milestones | None for app implementation |

Do not infer agreement from silence or convert recommendations into accepted decisions. Record the version, date and founder's response when approval is given.
