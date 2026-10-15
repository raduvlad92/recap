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

## Required format for future entries

Date; milestone/task ID; demo file or URL; whether live/local/simulated; exact scenario; data provenance; checks performed; outcome; limitations; measured cost; related approval/spec version; next action. Save small, redacted evidence in docs/demos/ and keep credentials and participant identities out of Git.
