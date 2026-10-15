# Current status

Updated: 15 October 2026. Phase: research and specification. Overall specification: **DRAFT — NOT APPROVED**.

## Founder decisions recorded

1. Build toward rapid growth.
2. Explore all three audiences: independent consultants, marketing/brand-monitoring buyers, and general readers. Pivot based on evidence.
3. Run a customer trial only after broad platform access is secured.
4. Public creators must not need to join or authorize the app.
5. Require enough underlying content for an accurate recap first. Comment sentiment and audience statistics can be added later.
6. Use scraping services such as Apify and Bright Data as the proposed collection route. Research and compare specific options.

The original vision also includes daily topics, explicit relevance, original links and a historical timeline. See [SPEC.md](SPEC.md).

## Completed

- Inspected the repository: initial README and icon; no app, backend, tests or deployment.
- Researched direct competitors, adjacent demand, official platform limits, data vendors and conditional operating economics.
- Captured the founder's answers and revised the strategy after each answer.
- Saved the draft specification, tracked plan, glossary, validation proposal and research.
- Saved a research comparison at docs/demos/research-briefing.html, checked at desktop/mobile widths and in light/dark appearance. This is an explainer, not an app demo.
- Independently reviewed document consistency, costs and plan dependencies; checked local document links and whitespace.

## In progress / unresolved

- Scraper-specific public-document research is complete. Concrete candidates and price caveats are saved in docs/RESEARCH.md; their actual reliability is untested.
- What counts as “broad”: proposed interpretation is all seven named source families, with disclosed public-account and content-format exclusions. Not yet explicitly approved.
- Source-proof spending cap is proposed at €50 total in docs/ACCESS-PROOF.md v0.1; it has not been approved. Production access budgets remain unset.
- No candidate scraper has been run. Broad access is **not verified**.
- Both Apify and Bright Data show login pages in the shared browser's default profile. No compatible connector/token is available in the current tool environment. A signed-in account is needed for execution.
- Delivery details, relevance controls, history/retention, billing, privacy and final acceptance criteria still need decision rounds.

## Next action

Review docs/ACCESS-PROOF.md v0.1: all seven families, 35 public sources, seven days, 150 generated-audio minutes and a €50 total cash cap, free credits first. The founder's decision should settle that scope and any spending authorization. The proof is separate from the app build; customer testing waits for its result.

Q6 has been presented and is awaiting a response. After approval, obtain provider access through sign-in/secure connection and check the plan, credit balance and charging controls before any run.

## Evidence and approvals

- [Decision register](docs/DECISIONS.md)
- [Tracked work](PLAN.md)
- [Research](docs/RESEARCH.md)
- [Validation brief](docs/VALIDATION.md)
- [Demo/evidence log](docs/DEMO-LOG.md)

No app code, live collection, customer trial, outreach, purchase or deployment has occurred. External spending: **€0**. Founder labor has not been timed. Git has no remote configured at discovery; saving locally is not a remote backup.
