# Tracked plan

Updated: 17 October 2026. The whole build plan remains a proposal. “Blocked” describes a dependency, not a claim that research must stop.

| ID | Work / owner | Status | Depends on | Demo or reviewable evidence |
| --- | --- | --- | --- | --- |
| R01 | Demand and competitor research / assistant | Done | — | docs/RESEARCH.md, dated primary links. |
| R02 | Official platform and commercial-provider audit / assistant | Done | — | Access findings in research; no live access claimed. |
| R03 | Compare Apify, Bright Data and scraper alternatives / assistant | Done: desk research | Founder decision D06 | docs/RESEARCH.md; no live scraper result claimed. |
| P01 | Record business goal, audiences and access direction / founder + assistant | Done | Interview Q1–Q5 and scraper instruction | docs/DECISIONS.md. |
| P02 | Define broad coverage and source-proof cost envelope / founder + assistant | Done: approved in Q6 | R03 | docs/ACCESS-PROOF.md v0.1, €50 total cap. |
| P03 | Settle first-release surface, source onboarding and chronology/relevance / founder + assistant | Done: Q7–Q9 accepted | Founder decisions D09–D11 | SPEC.md v0.2 and ADR 0002. |
| A01 | Prepare source-proof scope, manifest and checklist / assistant | Done | Research, P02 | docs/access-proof/sources.json: five per family; pinned social inputs, ledger and evidence tooling. |
| A02 | Run bounded scraper proof / assistant | Deferred by founder D08; feed preflight retained | Resume only when founder returns to supplier verification | docs/access-proof/PREFLIGHT.md: 15 feeds / 75 updates; social runs and formal 7-day checks not started. |
| A03 | Review pass/conditional/fail for every required platform / founder + assistant | Deferred by D08 | A02 when resumed | Supplier capability is assumed for planning, not passed. |
| V01 | Approve three-audience paid customer test / founder | Blocked | A03 passes | Offer, sample recap, recruitment plan, cost cap and metrics. |
| V02 | Run 10-weekday manually checked recap trial / founder + assistant | Blocked | V01 | Consent-aware aggregate results per audience, useful recap examples. |
| V03 | Compare audiences and choose focus/pivot / founder + assistant | Blocked | V02 | Usage, actual payment/renewal, missing sources, service time and recruitment costs. |
| S01 | Resolve remaining product decisions and approve SPEC version / founder + assistant | v0.2 draft; Q10–Q12 awaiting answers | Founder decision rounds; no supplier-login prerequisite | Named spec with testable acceptance criteria, explicit assumptions and approval record. |
| B01 | Choose architecture, estimate and cap first build milestones / assistant | Blocked | S01 | Costed milestone proposal grounded in actual collector behavior. |
| B02 | Build approved web source onboarding and truthful collection status / assistant | Blocked | B01 | Demo 1: phone/desktop, editable collection, pasted link, duplicate/unsupported URL, add/remove source, failed source and empty day; distinguish live data from fixtures. |
| B03 | Build topic synthesis, citations and explicit relevance / assistant | Blocked | B02 | Demo 2: overlapping/contradictory sources, two reading profiles, stable date order, all-updates option and correction. |
| B04 | Build history, operational limits and account isolation / assistant | Blocked | B03 | Demo 3: several dates, deletion, source failure, spending stop, account boundaries. |
| B05 | Complete approved delivery and billing / assistant | Blocked | B04 | Demo 4: full approved user journey and cancel/delete behavior. |
| G01 | Observe paid cohorts through two renewals / founder + assistant | Blocked | Useful paid product, audience selection from V03 | Retention, quality, costs and support by selected audience/cohort. |
| G02 | Test repeatable acquisition in capped channels / founder + assistant | Blocked | Useful paid product + approved marketing budget; can overlap G01 | Cash/time acquisition cost, activation and contribution payback. |
| G03 | Decide whether to increase acquisition spending / founder + assistant | Blocked | G01 and G02 | Repeatable channel and renewal/contribution evidence. |

No fixed delivery dates are promised before source proof and approved scope. A polished interface cannot resolve missing content access.

## Working rhythm

Every meaningful milestone ends with a demonstration, the exact tests/evidence, known limitations, cost incurred, updated task statuses and the next action. Save demo files and screenshots in docs/demos/; list them in docs/DEMO-LOG.md. Record what is live, local, simulated or documentation-only.

At the end of a session update STATUS.md and approvals. Commit reviewable work when appropriate. A Git commit is local history, not a deployment or remote backup. This repository has no remote configured at discovery.
