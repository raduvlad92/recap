# Decisions and interview

Updated: 15 October 2026. Individual answers below are accepted directions. They do not imply approval of the entire specification.

## Accepted founder decisions

| ID | Decision | Evidence |
| --- | --- | --- |
| D01 | Aim for a business capable of rapid growth. | Q1: “A business aimed at rapid growth.” |
| D02 | Explore consultants, marketing/brand-monitoring buyers and general readers; pivot from evidence. | Q2: “all of them and then we pivot based on what we get.” |
| D03 | Broad source access must precede customer testing. | Q3: “Only test after broad platform access is secured.” |
| D04 | Following public creators must not require those creators to join. | Q4: “Yes — creators should not need to join.” |
| D05 | Usable content first; comments and audience statistics later. | Q5: “Yes — usable content first; richer analysis later.” |
| D06 | Investigate scraping through Apify, Bright Data and other suppliers. | Subsequent instruction: “we will scrape with apify, brighdata and others”. |

Original requested product behavior: topics rather than a simple post list; snippets and original references; profile-based relevance; daily updated-source counts; historical timeline; preserve credit to creators. Sponsors, brands, sentiment, reach and comment sentiment are part of the vision, with D05 deferring the richer access requirement.

## Recommendations superseded by those decisions

- A small profitable business as the primary goal: superseded by D01.
- Independent AI consultants as the sole initial customer group: superseded by D02.
- A limited RSS/newsletter-only customer concierge test before broad access: rejected by D03.
- Requiring creator partnerships as the universal collection route: incompatible with D04.
- Treating official API availability as the only feasible access route: superseded by D06. Platform documentation remains useful evidence of constraints and risks.

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
│   ├── Exact required platforms/account/content types [open]
│   ├── Scraper samples, completeness, costs and risks [research/proof pending]
│   └── Access proof budget and pass/fail criteria [proposal]
├── Daily product
│   ├── Topic-based recap, source links, relevance, history [requested]
│   ├── Date order vs priority within a recap [open]
│   ├── Length, languages, delivery time and notification choices [open]
│   └── Corrections, deletions, missing data and privacy [proposal/open]
├── Customer validation [blocked by access gate]
│   ├── Paid pilot across three groups [proposal]
│   └── Repeat use, willingness to pay, source coverage [not measured]
└── Implementation [blocked by approved scope and access evidence]
    ├── Approve versioned specification [pending]
    ├── Select technology against measured needs [not selected]
    ├── Milestones with demos and evidence [plan drafted]
    └── Retention and repeatable acquisition before scaling [proposal]
```

The current question frontier is the meaning of broad access and the acceptable cost of proving it. Product detail questions follow once the access scope is settled. Research facts should be supplied by the assistant, not requested from the founder.

## Current round — Q6, awaiting response

Approve docs/ACCESS-PROOF.md v0.1: all seven source families, five public sources each, seven days, at most 150 generated-audio minutes and a €50 total cash cap, using free credits first. Recommended answer: yes. Alternative: authorize free-credit-only execution or revise the brief. This question approves only the collection experiment, not SPEC.md or app implementation.

Execution also requires a signed-in provider account; both Apify and Bright Data currently show login pages in the shared browser. No credentials were requested in chat or saved in the project.

## Approval register

| Artifact | Version/status | Approval evidence |
| --- | --- | --- |
| Product specification | 0.1 — draft | None |
| Source proof brief | docs/ACCESS-PROOF.md v0.1 — approval candidate | None for execution/spending |
| Customer pilot | Conditional proposal | None; waits for broad access |
| Implementation plan | Draft with blocked milestones | None for app implementation |

Do not infer agreement from silence or convert recommendations into accepted decisions. Record the version, date and founder's response when approval is given.
