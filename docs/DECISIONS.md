# Decisions and interview

Updated: 21 October 2026. Individual answers below are accepted directions. They do not imply approval of the entire specification.

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
| D15 | Multiple interface and recap languages at launch; exact list not selected by the founder. | Q13, 19 October: “Multiple interface and recap languages at launch”. |
| D16 | Lasting recap history with original-update citations and creator-linked references; export/delete, visible corrections and unavailable-original notices. | Q14, 19 October: “Yes — lasting recap history and both kinds of references”, accepting the stated Q14 package. |
| D17 | Use clear limits with larger allowances; the previous numerical package was not approved. | Q15, 19 October: “Use clear limits, but I want larger allowances”. |
| D18 | Prepare a nonfunctional visitor-facing visual concept. | Explicit 19 October request; full entry below. Does not approve app implementation. |
| D19 | Creators may be studios/teams with multiple presenters and channels; support drill-down and a modular product model. | 21 October: “a creator can actually be an entire studio or team” and “drill down into each presenter ... or their multiple youtube channels”; “the whole thing has to be very modular”. |
| D20 | Implement a functioning v0 autonomously using founder-created recap Supabase + Clerk, GitHub/Netlify and Cloudflare only as needed; start with Apify adapters. | 21 October: “Prepare the plan and start implementing the v0 without my involvement”; match supplied screenshot and leave a morning task list. |

Original requested product behavior: topics rather than a simple post list; snippets and original references; profile-based relevance; daily updated-source counts; historical timeline; preserve credit to creators. Sponsors, brands, sentiment, reach and comment sentiment are part of the vision, with D05 deferring the richer access requirement.

## Recommendations superseded by those decisions

- A small profitable business as the primary goal: superseded by D01.
- Independent AI consultants as the sole initial customer group: superseded by D02.
- A limited RSS/newsletter-only customer concierge test before broad access: rejected by D03.
- Requiring creator partnerships as the universal collection route: incompatible with D04.
- Treating official API availability as the only feasible access route: superseded by D06. Platform documentation remains useful evidence of constraints and risks.
- English-only launch and the 15-source / 500-monthly-update / 60-minute package: superseded by D15 and D17.
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
│   ├── Multiple interface/recap languages [accepted D15; exact six-language set proposed]
│   ├── Lasting history, original/creator-linked references, export/delete/corrections [accepted D16]
│   ├── Larger clear allowances [accepted D17; exact package proposed]
│   └── Account/data, late items and detailed controls [v1.0 recommended defaults]
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

At that checkpoint these answers were recorded in SPEC.md v0.3, with no whole-version approval or implementation authorization. The next round on language/history/allowances is now answered below; its consolidated successor is SPEC v1.0 / PLAN v1.0. Recommended account/privacy, correction and launch defaults must be visible in that candidate; do not create endless new interview rounds unless an objection or material contradiction appears. Routine technical choices should be researched and recommended by the assistant, not handed to the non-developer founder.

## Q13–Q15 — answered on 19 October 2026

- Q13: multiple interface and recap languages at launch. Accepted direction; rejects English-only. The founder did not name languages.
- Q14: lasting history and both kinds of references. Accepted, including the question's export/delete, visible corrections and unavailable-original behavior. This is not a full original-content archive.
- Q15: clear limits with larger allowances. Accepted principle and request to enlarge; the old 15-source / max-5-X / 50-daily / 500-monthly / 60-minute numerical recommendation was not approved.

The routine interview is complete. SPEC v1.0 and PLAN v1.0 are the consolidated approval candidate. Do not introduce another routine round; surface changes or material contradictions in that candidate.

## Recommended defaults awaiting whole-version approval

- English, German, Spanish, French, Italian and Portuguese (Brazil) for interface/recap/supported source languages, with independent language choices and one selected-language recap/day.
- 50 sources (max 15 X), 200 new analyzed updates/day, 3,000/month and 300 generated-transcription minutes/month; once-daily reader/source checks with a proposed six-hour shared-check freshness window, visible gaps and no automatic overages. These are proposed design limits, not approved spending. Arithmetic: [ALLOWANCES.md](ALLOWANCES.md).
- Stable past recaps after profile/language edits; future-only changes, visible late items/corrections, one-level creator-linked references, private individual accounts and raw-input/backup expiry targets in SPEC v1.0.
- Subscription hypothesis with exact price open. Replace the earlier ten-weekday customer-test proposal with 14 consecutive daily recaps to match Q11; trial execution, offer and aggregate cash/audio/labor limits still require separate approval after access is secured.
- Local implementation M0–M5 after explicit approval of the named pair. Real supplier/generation execution, external delivery, customer outreach/trials and publication remain separate gates. D08 is not reopened.

These are recommendations being submitted, not founder approvals. The review brief is [APPROVAL.md](APPROVAL.md). No app implementation, source run or spending occurred from the Q13–Q15 answers.

## D18 — visual concept explicitly authorized on 19 October 2026

The founder asked: “prepare a demo on how it will look like (no need to make it functional), use the design skill” and wanted it to show visitors how the product works and make them want it. This authorizes a standalone local visual concept, including lightweight sample interactions, without waiting for whole-spec approval. It does not approve SPEC/PLAN v1.0, the full app, live suppliers, spending, outreach or publication.

Completed visual concept v0.1: [demo and handoff](demos/product-preview/README.md). The design direction, fictional content and local behavior are proposals for feedback, not newly approved product requirements. Saved checks/screenshots distinguish the prototype from actual access and operating evidence.

## 21 October 2026 — reference and recommendation, not a new approval

Founder steering: “I was thinking something more like this,” with a creator-led feed/workspace reference, then a request to compare designs, understand personas and recommend retention/viral features. Treat the image as design input; do not infer that every depicted control, live freshness claim, Threads support, team function or number is an accepted requirement.

Saved [assessment](design/VISION-COMPARISON.md). Assistant recommendation: founder's creator-led workspace as visual/navigation foundation; connected daily recap prominent/default; All updates and creator drill-downs for exploration; evidence-based signals instead of volume alone. Proposed retention priorities: creator continuity, change since last catch-up, history retrieval. Proposed distribution loops: editable source collections and deliberately shared cited insight cards. These are recommendations, not approved additions or demonstrated retention/growth.

The prior three-audience direction, daily cadence and explicit-interest/history decisions remain in force. No demo rebuild or full-spec approval was requested/given. Update a future named candidate if the founder adopts material changes; do not silently rewrite approved answers. Supplier work, customer trials and publication remain deferred/unauthorized.

## 21 October 2026 — positive vision feedback and backend question

Founder: “I like it. question, shall this be on convex or supabase/”. Record positive feedback on the preceding vision assessment, without interpreting it as approval of every optional feature or named SPEC/PLAN v1.0. No new routine interview is required.

Assistant recommends **Supabase** after current official-document research and independent reviews of the Convex case and costs. The reason is flexible historical queries/reporting and a standard PostgreSQL foundation for connected creator, topic, brand and reference records. Convex also supports relationships, search, scheduling and durable workflows; its integrated TypeScript experience could make initial delivery simpler. [Detailed assessment](BACKEND-COMPARISON.md) records prices, limitations and the proposed asynchronous pipeline.

**Platform selection remains open**: the founder asked for a recommendation, not setup. No backend provisioned, no M0 pass, no spending, and D08 remains deferred. Record the actual selection if/when given; do not create an accepted architecture ADR from an assistant recommendation alone.

## D19 — modular studios, people and channels, 21 October 2026

The founder explicitly clarified the creator structure and drill-down requirement. This is an accepted individual requirement, not a full-spec approval or instruction to provision a backend. “Team” here means a publishing group; reader-team workspaces remain deferred.

Recorded [creator model](CREATOR-MODEL.md) and updated the domain glossary. Recommended treatment separates groups, people, sources, optional shows, dated affiliations/ownership and per-update contribution roles. This handles shared channels, people working across groups, guests and changing affiliations without treating a mention or membership as a speaking credit. Follow scopes show actual supported sources; overlapping follows count once, new channels need confirmation, and missing attribution remains unknown. These detailed defaults are proposed in the revised candidate, not separately answered founder decisions.

**SPEC v1.1 + PLAN v1.1** supersede the unapproved v1.0 pair. Added AC19 and studio/person/channel scenarios to the future milestones; updated the approval brief. The old static demo and v1.0 review walkthrough remain historical, without a new modular-model demo. Independent edge-case review completed; no implementation, provider work or spending. Supabase remains recommended rather than selected. D08 is unchanged.

## Approval register

| Artifact | Version/status | Approval evidence |
| --- | --- | --- |
| Product specification | 1.1 — approval candidate, supersedes unapproved v1.0 | Q1–Q15 and D19 recorded; no whole-version approval. Exact languages/allowances and detailed modular follow/attribution defaults are proposed. |
| Source proof brief | v0.1 approved in Q6; execution DEFERRED by D08 | Supplier capability assumed for planning; no current sign-in/spending action. |
| Customer pilot | Conditional proposal | None; waits for broad access |
| Implementation plan | 1.1 — approval candidate, M0–M5 awaiting approval | No full implementation authorization; named SPEC/PLAN pair submitted together, including AC19 demos. |
| Visitor visual concept | v0.1 — local concept completed | Explicit request on 19 October, D18; static demo only, not S01 approval. |
| Working v0 | D20-authorized first increment; deployed and verified | Explicit 21 October autonomous build request and selected Supabase/Clerk/GitHub/Netlify stack. [Scope](v0/PLAN.md), [live evidence](v0/VERIFICATION.md); broader SPEC/PLAN v1.1 remains a candidate. |

Do not infer agreement from silence or convert recommendations into accepted decisions. Record the version, date and founder's response when approval is given.

## D20 — autonomous functioning v0 authorized, 21 October 2026

Founder selected the existing **recap** Supabase org/project and **recap** Clerk app, limited additional infrastructure to GitHub/Netlify/Cloudflare where needed, chose Apify as the first scraping supplier, and explicitly asked for a functioning v0 without further involvement. This instruction supersedes the earlier documentation-only/no-build boundary for the scoped v0; it is not a retrospective named approval or completion of full SPEC/PLAN v1.1.

[docs/v0/PLAN.md](v0/PLAN.md) records the concrete authorized first increment and exact account targets. Deploying the reviewable v0 to Netlify and creating its private GitHub repository are within this request. No public customer recruitment, paid launch, supplier-plan purchase or uncapped recurring collection follows from it. Apify-first adapter work is reopened, while metered runs remain gated until token, pinned actor and aggregate budget controls are verified. The old €50/150-minute source-proof ceiling is retained if that experiment resumes. No other supplier is added now.

Implementation includes the screenshot-based workspace, modular studio/person/channel navigation, private saved library/preferences, native Clerk/Supabase authentication and manual feed collection. Actual generation, seven-family proof, recurring briefing/email delivery and full deletion/retention targets remain separate incomplete work. First working deployment and precise verification results are recorded in STATUS and the demo log.


### D20 delivery checkpoint

The authorized first increment is live at https://recap-v0-radu.netlify.app, backed by the private GitHub repository and existing recap Clerk/Supabase resources. Code `660784b` passed 69 local/CI tests, typecheck/build and exact-commit Netlify deployment; actual browser sign-in, five-entry public feed refresh, cloud reload and separate guest state were exercised. Eleven backend authorization checks passed. [Verification](v0/VERIFICATION.md) retains exact IDs and limitations; [morning checklist](v0/MORNING.md) and [continuation plan](v0/PLAN.md#continuation-work) save the next session.

This does not approve or complete the broader candidate by inference. Paid Apify runtime is off, no actual social collection or AI synthesis/delivery occurred, no customer trial/outreach started, and no new cash charge/plan purchase was observed. Cloudflare was unnecessary. The deploy is a reachable review increment using development authentication, not a completed commercial launch.


## D22 — named tech collection and source backfill,21October2026

Founder explicitly requested the **tech** collection with all official public LTT/LMG channels, Marques Brownlee properties and GamersNexus, prioritizing YouTube and including X/Instagram where present; start building an Apify Actor and show actual last 30-day content on the signed-in homepage for the privately specified identity. This supersedes D21's no-collection direction for this bounded slice, within the existing global ceiling. It does not approve recurring jobs, new subscriptions, paid AI calls or an unrelated600-channel backfill. [Plan and readiness evidence](tech/PLAN.md). No duplicate resumption approval is needed for this request; supplier access, actual account binding and budget enforcement must still be verified before jobs.

Readiness check found working app/backend administration, no exact app user for the target email, no configured Apify runtime connection, and an Apify sign-in page in the shared browser. Required owner actions are ordinary app signup/sign-in and provider authentication if access cannot be reused. Channel research and Actor code can proceed independently. No source content collection or metered run has started at this checkpoint. Do not put the specified email or private user IDs in Git.

## D21 — admin and researched public creator catalogue,21October2026

Founder asked for a comprehensive admin panel showing signups, followed creators/channels, Apify usage and backend operations; separately120creators/accounts on each of YouTube,Instagram,X,Substack andLinkedIn, imported into the backend with one page per canonical creator for discovery/SEO and an honest account of planned collection. The explicit instruction is **do not start collection**, compare Apify andBrightData and choose the cheaper usable route. This authorizes scoped implementation/backendimport/publicpages on the existing stack; it does not start a customer trial, paid scraper job, subscription or daily schedule.

[Admin/catalogue plan](admin/PLAN.md) records architecture, exact deliverables and evidence. Public directory account evidence, full-content access, actual jobs and invoice costs must remain separate. Reuse canonical identities only with evidence; keep people,groups andchannels modular. Private reader emails/follows are admin-only and never included in public pages or Git.

### D21 delivery checkpoint

Implemented the admin increment and imported **600 channels, exactly120on each requested platform, across560canonical creator records**; 33 identities have multiple evidenced channels. One same-name Ottolenghi pair remains separate with an explicit uncertainty notice. Public pages link the actual channel and research references and state collection is planned. Server-rendered directory, canonicals, metadata and561public sitemap URLs were verified on the deployed review site; this is not proof of indexing, ranking or content access.

The admin panel uses existing Clerk/Supabase with a private server allowlist and trusted verified primary email. It covers signups without requiring a saved workspace, actual follows, creator/channel records, editable catalogue and provider plans, job/Actor/cost telemetry and administrative audit history. Actor plans, used Actors and actual runs are distinct; missing costs stay unknown. All collection plans remain disabled. Owner access does not depend on being the first signup or on browser/user-editable metadata.

The assistant's researched, disabled provider plans favor Bright Data for comparable Instagram/LinkedIn public text, Apify for the documented YouTube caption and X discovery route, and native Substack feed discovery with an Apify public-body candidate if needed. [Cost comparison](catalogue/COLLECTION-COSTS.md) records billing units and unproven equivalence; this does not approve spending or verify supplier extraction. No source collection, paid job, transcription or schedule started for D21. A new ledger does not reconstruct the earlier v0 feed refresh.

**144 tests**, typecheck/build,26actual database authorization/import checks, transactional invariants and security advisors passed. Hosted verified-email admin, ordinary-account denial, anonymous denial, sign-out clearing, stale-save rejection and phone layouts were exercised. [Release verification](admin/VERIFICATION.md) and [owner guide](admin/README.md) retain exact deployment and cleanup evidence. Both credentials unexpectedly printed by a CLI were replaced and their old values rejected; no secrets were committed. The broader SPEC/PLANv1.1 remains a candidate; D21 does not imply customer-launch approval.
