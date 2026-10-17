# Current status

Updated: 18 October 2026. Phase: **product specification — Q7–Q12 accepted; scraper capability assumed, live proof deferred**. Overall app specification: **v0.3 DRAFT — NOT APPROVED**.

## Founder decisions recorded

1. Build toward rapid growth.
2. Explore all three audiences: independent consultants, marketing/brand-monitoring buyers, and general readers. Pivot based on evidence.
3. Run a customer trial only after broad platform access is secured.
4. Public creators must not need to join or authorize the app.
5. Require enough underlying content for an accurate recap first. Comment sentiment and audience statistics can be added later.
6. Use scraping services such as Apify and Bright Data as the proposed collection route. Research and compare specific options.
7. Q6 approved source-proof v0.1: seven families, five public sources each, seven days, up to 150 generated-audio minutes and €50 total, free credits first.
8. Subsequently defer Apify and every other scraper check; assume they work for continued product planning. No provider sign-in or spending now.
9. First release is a phone-friendly website (Q7).
10. Start with editable source collections and pasted creator links; following-list import later (Q8).
11. Date-ordered history, within-day priority from explicit interests and an all-updates option (Q9).
12. Short expandable recap, up to five main topics, what changed/relevance, source counts, snippets and original links (Q10).
13. One daily recap at the reader's chosen local time, with optional email reminder linking to the website (Q11).
14. Topics, brand mentions and explicitly disclosed sponsors first; source sentiment later (Q12).

The original vision also includes daily topics, explicit relevance, original links and a historical timeline. See [SPEC.md](SPEC.md).

## Completed

- Inspected the repository: initial README and icon; no app, backend, tests or deployment.
- Researched direct competitors, adjacent demand, official platform limits, data vendors and conditional operating economics.
- Captured the founder's answers and revised the strategy after each answer.
- Saved the draft specification, tracked plan, glossary, validation proposal and research.
- Saved a research comparison at docs/demos/research-briefing.html, checked at desktop/mobile widths and in light/dark appearance. This is an explainer, not an app demo.
- Independently reviewed document consistency, costs and plan dependencies; checked local document links and whitespace.
- Recorded Q6 approval and fixed the 35-source sample, with five sources per family.
- Prepared pinned social-scraper inputs and the shared cash/transcription ledger.
- Ran actual public-feed checks: 15 feeds fetched and parsed, 75 updates sampled. Verified publisher transcripts separately for two selected podcast episodes. See docs/access-proof/PREFLIGHT.md.
- Corrected parser issues found in real feeds; preserved original evidence, used cached responses for reprocessing, and completed independent review.
- Recorded Q7–Q9 in SPEC.md v0.2, the decision register, glossary and chronology/relevance ADR on 17 October.
- Recorded Q10–Q12 in SPEC.md v0.3, first-release analysis rules, reminder terminology and future acceptance/demo scenarios on 18 October.

## In progress / unresolved

- Scraper-specific public-document research is complete. Concrete candidates and price caveats are saved in docs/RESEARCH.md; their actual reliability is untested.
- The all-seven-family public-content experiment and €50 total cap are approved. Production access budgets remain unset.
- No paid/social scraper has been run. Fifteen public feeds have been checked; broad/full-content access is **not verified**.
- Supplier authentication and live verification are deferred by the founder. Do not request sign-in or wait for it to continue specification work.
- Remaining routine choices: language scope, history/reference handling and bounded production allowances. Account/privacy, corrections, validation and paid-launch defaults will be visible in one consolidated approval candidate; routine technical choices are the assistant's responsibility.

## Next action

Q13–Q15 have been presented and are awaiting answers: English-first scope; lasting recap history with original and creator-linked references; provisional trial allowances and visible limits/no automatic charges. See SPEC.md v0.3, docs/DECISIONS.md and docs/ALLOWANCES.md. Then assemble one named full-spec approval candidate and matching milestone plan. Use the founder's scraper-feasibility assumption and leave supplier work deferred.

Q7–Q12 are accepted, not pending. Do not ask them again. The earlier provider sign-in request remains withdrawn.

No app build is authorized by the individual answers so far. Present the consolidated candidate after the next round; open another branch only for a real objection or material contradiction.

Formal seven-day window is deferred and has not started; 0/7 daily observations complete. Do not count the feed preflight as a completed all-platform observation day. No daily schedule is running.

## Evidence and approvals

- [Decision register](docs/DECISIONS.md)
- [Tracked work](PLAN.md)
- [Research](docs/RESEARCH.md)
- [Validation brief](docs/VALIDATION.md)
- [Demo/evidence log](docs/DEMO-LOG.md)

Source-proof collection tooling and live public-feed preflight exist; no app build, social/provider run, customer trial, outreach, purchase or deployment has occurred. External spending: **€0**; generated audio: **0/150 minutes**. Founder labor has not been timed. Git has no remote configured at discovery; saving locally is not a remote backup.
