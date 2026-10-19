# Tracked implementation and validation plan

Version: **1.0 — APPROVAL CANDIDATE**. Updated: 19 October 2026. Matches [SPEC v1.0](SPEC.md). **Not approved; local implementation has not started.**

Approving the named pair permits the local M0–M5 work below. All provider execution/authentication/spending remains deferred by D08; customer contact, paid trials and publication require their own approval. Local work uses explicitly labeled fixtures and supplier interfaces, not purported live integration. No fixed launch date is promised.

## Completed discovery and decisions

| ID | Work / owner | Status | Evidence |
| --- | --- | --- | --- |
| R01 | Demand and competition / assistant | Done: desk research | docs/RESEARCH.md; no demand proven. |
| R02 | Platform constraints and supplier comparison / assistant | Done: desk research | Apify, Bright Data and alternatives; documented capability is not a live pass. |
| P01 | Business, audience and access direction / founder + assistant | Done | D01–D08. |
| P02 | Source-proof design / founder + assistant | Done: Q6 approved | ACCESS-PROOF v0.1; execution subsequently deferred. |
| P03 | Website, onboarding, chronology/relevance / founder | Done | Q7–Q9, D09–D11. |
| P04 | Recap, delivery and analysis / founder | Done | Q10–Q12, D12–D14. |
| P05 | Multilingual launch, lasting history/references, larger limits / founder | Direction recorded | Q13–Q15, D15–D17. Exact languages/numbers await whole-version approval. |
| A01 | Source manifest and preflight tooling / assistant | Done | 35-source manifest; actual 15-feed/75-update preflight, two publisher-transcript checks. |
| S01 | Consolidated SPEC v1.0 + PLAN v1.0 / founder + assistant | Candidate ready; approval pending | docs/APPROVAL.md; docs/ALLOWANCES.md; saved review brief. |

## Local implementation after S01 approval

The assistant owns implementation and verification; the founder reviews saved demos and material scope changes. Each milestone must meet its exit criteria before the next depends on it. Routine fixes within scope need no fresh permission. Every demo records fixture/local/live provenance.

| ID | Deliverable and demo | Dependencies | Exit criteria / SPEC coverage | Status |
| --- | --- | --- | --- | --- |
| M0 | Choose a simple architecture and document the build/operating approach. Save data-flow sketch, fixture format, language matrix and a cost ledger/stop design. | S01 approved | Supports private accounts, history/deletion, six languages, scheduling and replaceable collection suppliers. Separate local tools from future paid dependencies; no provider signup or subscription. | Awaiting approval |
| M1 | Website shell, editable source collections/pasted links, explicit interests, independent interface/recap languages and truthful coverage. **Demo 1:** phone/desktop setup, duplicate/private/unsupported link, failed/pending source, six-language controls and labeled sample recap. | M0 | AC01/02/05/11/12/17. Full source families represented by labeled fixtures; no live-support claim. | Awaiting approval |
| M2 | Short expandable recap, citations, creator-linked references, brand/sponsor distinctions and explicit relevance. **Demo 2:** busy/quiet days, disagreement, same data/two profiles, extra topics in all updates; English/German inputs into Spanish recap. | M1 | AC03/04/06/13/14/16/17. Evaluate source fidelity on curated fixtures, not title-only placeholders. No metered model calls without a separately approved budget; use deterministic reviewed examples locally. | Awaiting approval |
| M3 | Private-account boundaries, lasting history/export/delete, corrections/availability notices, allowance accounting and raw-data expiry. **Demo 3:** multi-date archive, unfollow, original 404 vs timeout, export, deletion/restore attempt, exhausted daily/monthly/audio quotas, simulated cash stop and malicious source instructions. | M2 | AC05/07/08/09/18. Meaningful isolation/lifecycle tests. Raw expiry is measured from collection, including never-analyzed inputs; historical inventory persists. Local expiry/restore checks are separate from a future host's verified backups. | Awaiting approval |
| M4 | Daily local-time scheduling and optional reminder settings/templates. **Demo 4:** DST skipped/repeated time, settings change, retry, quiet/late day, reminder off/on, account deletion cancels pending reminders. | M3 | AC13/15. Simulated clock and local email preview; no emails sent or external scheduler activated. | Awaiting approval |
| M5 | Assemble and review the complete local experience. **Demo 5:** onboarding → daily recap → details/references → history/export/delete at 360px and desktop, all six interface locales. | M1–M4 | AC01–AC09/AC11–AC18 local criteria evidenced; outstanding live/model/language-review/deployment evidence listed explicitly. Summarize implemented, simulated and unverified separately. | Awaiting approval |

Local fixtures can prove navigation, rules and data boundaries. They cannot prove extraction quality, live freshness, real recurring delivery, measured cost, language quality for arbitrary content or willingness to pay. Do not mark those passed at M5. Real generation and supplier adapters need later authorized execution and evaluation; never sell deterministic demo recaps as the product.

## Access, cheapest business test and public readiness

The cheapest useful route remains access proof → manually checked briefing trial → audience decision before a full automated build. The founder currently defers the first step; local design/implementation can still proceed after S01 approval. Do not quietly reopen collection to unblock the business test.

| ID | Work / owner | Depends on | Status / required evidence |
| --- | --- | --- | --- |
| A02 | Bounded supplier proof / assistant | Founder explicitly reopens D08 | **Deferred.** Retain actual feed evidence; no social jobs/formal daily observations yet. Prior €50 total / 150 generated-minute ceiling still applies if resumed, not per-reader quotas. |
| A03 | Review each mandatory family's content/freshness/cost/constraints / founder + assistant | A02 | **Deferred.** Pass/conditional/fail against ACCESS-PROOF; no title-only substitutes. |
| V01 | Approve 14-day, three-audience manually checked trial / founder | A03 meets broad-access gate | **Not authorized.** Review sample, actual essential sources, language staffing, offer/price, cash/transcription ceiling and founder-time budget. |
| V02 | Deliver 14 daily recaps to five paying participants per audience / founder + assistant | V01 | **Not authorized.** Track use/payment/renewal, coverage, corrections and costs separately; no app build required for this test. |
| V03 | Compare audiences; choose focus/pivot and a costed offer / founder + assistant | V02 | **Pending evidence.** Pricing and acquisition hypotheses must fit larger allowances and low-overlap/audio-heavy use. |
| L01 | Integrate/evaluate real generation and collection, choose host and verify public/paid readiness / assistant + founder | Explicit resumption/budgets; approved scope; access and usefulness evidence before paid launch | **Not authorized.** Actual end-to-end collection→analysis→recap, qualified six-language review, account delivery/security, cash stop, backup/deletion, sender setup, price/cancellation/privacy and deployment checks. Local M5 is insufficient. |
| G01 | Observe paid cohorts through two renewals / founder + assistant | Approved useful paid offer and launch | **Pending.** Retention, service cost and support by audience/cohort. |
| G02 | Capped acquisition channel tests / founder + assistant | Approved outreach/marketing budget; useful paid offer | **Not authorized.** Can overlap G01. Track qualified prospects → setup → useful recap → paid/renewal, cash and time. |
| G03 | Decide whether to scale acquisition / founder | G01 + repeated G02 evidence | **Pending.** No invented lifetime value from a short pilot. |

## Progress saved between sessions

At each substantive checkpoint:

1. Update STATUS.md with completed work, what is simulated/unverified, actual cash/audio use, blockers and the next action.
2. Update this plan and docs/DECISIONS.md with approvals, changed scope and remaining gates. Do not promote a proposal to approved through silence.
3. Save demo source, redacted screenshots/evaluation evidence and reproduction steps under docs/demos/; index exact scenario/provenance/checks/limitations in docs/DEMO-LOG.md.
4. Run checks appropriate to the changes; record actual results rather than promises. Local code checks, deployment and live end-to-end proof remain separate.
5. Commit reviewable work locally. A commit is not deployment or remote backup; this repository currently has no remote.

Resume by reading STATUS.md, SPEC.md, PLAN.md and docs/DECISIONS.md, then taking the next authorized task. No recurring automation is currently running.
