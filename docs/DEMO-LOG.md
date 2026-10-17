# Demo and evidence log

## 15 October 2026 — discovery checkpoint

Type: documentation and public-source research. No application demo or live scraper proof exists yet.

- Specification: SPEC.md, version 0.1, draft.
- Decisions: docs/DECISIONS.md, founder answers Q1–Q5 and scraper route recorded.
- Research: docs/RESEARCH.md, checked official pages and conditional calculations.
- Test proposal: docs/VALIDATION.md, source proof before customer testing.
- Tracking: PLAN.md and STATUS.md.

Not demonstrated: working collection from any platform, transcript completeness, source refresh, generated recaps, account login, payment, deployment or customer demand.

## 15 October 2026 — saved research comparison

Type: research explainer, not a product prototype. File: [research-briefing.html](demos/research-briefing.html).

It compares demand/competition, documented collection routes, illustrative monthly costs and the proposed access-first experiment. Its 100/1,000-user controls are calculations using stated assumptions, not measurements or vendor quotations. All interactions are local; it makes no API calls.

Checked with T3 HTML preview at 728px/dark and 360px/light and dark. Inspected rendered collection/cost panels; checked all four panels for horizontal overflow at 360px; verified that the cost control updates to $190/$1,680 text-and-record subtotals and $1,076/$10,536 with the stated generated-transcript scenario. Console assertions passed. This is visual/document verification; no application tests exist.

Provider readiness check: Apify and Bright Data both show login pages in the shared browser's default profile. No account was created, authenticated or charged.

## 15 October 2026 — approved source-proof preflight

Tasks: P02/A01/A02. Approval: Q6, ACCESS-PROOF.md v0.1, €50 total cap. The app specification remains unapproved.

Actual live data: 35-source sample fixed, 15 public feeds fetched/parsed, five recent updates retained per feed (75 total). Publisher transcripts verified for two selected podcast episodes; social collection remains unrun. [Readable report](access-proof/PREFLIGHT.md), [final reviewed metadata](access-proof/results/preflight-2026-10-15-final.json), [evidence walkthrough](demos/source-proof-preflight.html).

Checks: RSS/Atom parsing, GUID vs shared-link identity, timezone handling, CDATA declarations, image/audio MIME distinction, query-specific episode links, duplicate handling, manifest counts/hash and raw response hashes. Original diagnostics remain saved. Reprocessing reused local responses; only the initial GitHub parse rejection required another public GET.

Cost: €0 external cash, no provider credits, no generated transcription, no downloaded audio body. Limitations: original-coverage completeness and all-platform collection unverified; 0/7 formal daily observations, no running schedule. Next action: provider sign-in and billing controls, then bounded social smoke jobs and all-platform baseline.

The saved evidence walkthrough was visually checked at 728px/dark and 360px/light with the podcast detail expanded. No console errors or horizontal overflow were found. These are report-display checks, not app or scraper passes.

## 15 October 2026 — supplier checks deferred

Founder steering D08: ignore Apify for now, assume it works, and apply the same assumption to other scrapers. Further live supplier checks, authentication requests and spending are deferred. The 15-feed preflight remains actual evidence; all-provider feasibility is an assumption. No daily scheduler was started and spending remains €0. Work returns to product decisions Q7–Q9 and specification approval.

## 17 October 2026 — product specification v0.2

Type: decision/documentation checkpoint, not an application demo. Q7–Q9 are accepted: phone-friendly website, editable starter source collections/pasted links, dated history with explicit within-day relevance and an all-updates option. Updated SPEC.md v0.2, glossary, ADR 0002, task P03 and the future demo scenarios.

Q10–Q12 are proposed and awaiting answers: recap depth, daily delivery and first-release analysis scope. The complete specification remains draft. No app implementation, supplier run, sign-in, spending or external communication occurred. The prior source evidence is retained without rerunning it or claiming it is current to 17 October. Next action: record the founder's Q10–Q12 answers and continue toward a named full-spec approval candidate.

## 18 October 2026 — recap experience accepted, specification v0.3

Type: documentation/decision checkpoint, not a product demo. Q10–Q12 are accepted: short expandable briefing (up to five main topics), one daily local-time recap with optional reminder email, and topics/brands/explicitly disclosed sponsors in the first release. Source sentiment remains deferred. Updated accepted scope, first-release rules, glossary and acceptance/demo scenarios.

Prepared final routine questions Q13–Q15 on language, history/reference handling and bounded allowances. The allowance recommendation uses public price rechecks and explicit assumptions in docs/ALLOWANCES.md; it is not an all-in operating quote or an approved offer. Answers are pending, then one named specification/plan candidate will be presented for consolidated approval/change.

No new UI/demo, app code, supplier authentication, source collection, generated transcription, customer contact, purchase or deployment. External spending remains €0; scraper capability remains assumed for planning. The 15 October source preflight is retained as historical evidence and was not rerun.

## Required format for future entries

Date; milestone/task ID; demo file or URL; whether live/local/simulated; exact scenario; data provenance; checks performed; outcome; limitations; measured cost; related approval/spec version; next action. Save small, redacted evidence in docs/demos/ and keep credentials and participant identities out of Git.
