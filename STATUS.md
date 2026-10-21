# Current status

Updated: **21 October 2026**. Phase: **modular studio/person/source requirement recorded; revised specification review remains open**. **SPEC v1.1 and PLAN v1.1 are approval candidates, not approved**, superseding the unapproved v1.0 pair. A separately authorized static visual concept is ready; no production application has been built.

## 21 October: modular creator model

Founder clarified that a creator can be an entire studio/team with multiple presenters and channels, requiring drill-down and a modular product (D19). Updated [glossary](GLOSSARY.md), [creator model](docs/CREATOR-MODEL.md), SPEC/PLAN v1.1 and [approval brief](docs/APPROVAL.md). Separate group/person/source identities, optional shows, dated affiliations and update credits; support overlapping relationships rather than a fixed ownership tree. Proposed behavior includes studio/person/source follows with visible underlying coverage, source/update deduplication, new-channel confirmation and preserved historical attribution. Publishing teams do not add reader-team accounts.

Independent edge-case review completed. AC19 and M0–M5 demo scenarios now cover multiple presenters/channels, cross-group people, guests vs members/mentions, unknown identity, overlapping follows and changing affiliations. No new demo, identity extraction, backend code or source run. Existing visitor demo predates this model and does not demonstrate it. Supabase remains recommended; no platform has been selected/provisioned.

## 21 October: backend recommendation

The founder said “I like it” about the preceding vision assessment and asked whether to use Convex or Supabase. Recommend **Supabase**, giving more weight to flexible queries/reporting across connected creator/topic/reference history and standard PostgreSQL portability. Convex is a credible alternative with integrated TypeScript development, reactive queries and durable scheduling/workflow tools; relationships and search are supported by both. Saved [comparison, current prices and proposed processing shape](docs/BACKEND-COMPARISON.md).

This is a researched recommendation, not a selected platform, running backend or M0 completion. No account provisioning, code, supplier execution or spending. Positive design feedback does not constitute named SPEC/PLAN approval or adoption of every optional feature.

## 21 October: founder reference assessed

The founder supplied a creator-led workspace reference and asked how it compares with the existing concept, who it serves, and what could support return use/sharing. Saved [comparison and recommendation](docs/design/VISION-COMPARISON.md) with the [reference image](docs/design/founder-reference-2026-10-21.png). Compared both images, completed independent persona/scope reviews and refreshed relevant primary product documentation.

Recommendation, **not newly approved scope**: use the founder's creator-led navigation and visual foundation; keep the short daily topic recap prominent/default, with All updates/creator exploration alongside it. Prioritize creator continuity, meaningful change since the previous catch-up and useful history retrieval. Test editable source-collection sharing and small cited insight cards as distribution hypotheses. The three audience groups remain separate hypotheses; no winner is selected from a screenshot.

No demo redesign or product implementation was performed. SPEC/PLAN v1.0 remain unapproved. The local port-4187 server was cancelled by the reported T3 restart and was not needed/restarted for this review. The self-contained demo and screenshots remain saved.

## New: visitor visual demo

The founder explicitly requested a nonfunctional design demo while away. Completed [product-preview/index.html](docs/demos/product-preview/index.html): a polished visitor page with an explorable fictional daily recap, source details/references/sponsor disclosure, dates/quiet day, all updates and preferences previews. Created with the frontend-design skill. It is self-contained and can be opened directly, or served locally after restarting the temporary server described in its handoff.

[Demo handoff](docs/demos/product-preview/README.md) includes four saved screenshots, design rationale and exact browser-check evidence. Reviewed at 1440/728/390/360px CSS widths and in inline preview; local controls, source/day consistency and overflow checked. No actual collection, generation, signup, delivery or publication is demonstrated. This request approves the visual concept only, not SPEC/PLAN v1.0 or M0–M5.

## Latest decisions

Q13–Q15 are answered, completing the routine interview:

- Multiple interface and recap languages at launch. English-only rejected; exact list not selected.
- Lasting recap history with original citations and creator-linked references, export/delete, visible corrections and unavailable-original notices.
- Clear limits with larger allowances. The previous 15-source / 500-monthly-update / 60-minute package was not approved.

All earlier direction remains: rapid growth; explore consultants, marketing buyers and general readers separately; broad usable public-source access before customer testing; creators need not join; seven source families; phone-friendly website; editable starter collections/pasted links; dated history and explicit interests/all updates; short expandable recap; daily chosen local time/optional reminder; topics, brands and disclosed sponsors first. See [decision register](docs/DECISIONS.md).

## Ready for one approval review

[docs/APPROVAL.md](docs/APPROVAL.md) summarizes the complete [SPEC v1.1](SPEC.md) and [PLAN v1.1](PLAN.md). Recommended defaults include:

- Separate studios/teams, people, sources and update credits, with drill-down, explicit coverage and dated relationships; see [creator model](docs/CREATOR-MODEL.md).
- English, German, Spanish, French, Italian and Portuguese (Brazil); interface/recap languages independent, one chosen-language recap/day.
- 50 sources (max 15 X), 200 analyzed updates/day, 3,000/month and 300 generated-transcript minutes/month; no automatic overages.
- Stable recap snapshots, creator-linked references one level deep, private individual accounts, raw-input expiry/backup deletion targets and honest coverage/usage states.
- Local M0–M5 implementation with five saved demos after named approval; live integration, spending, external delivery and public/customer launch remain separate.

These exact defaults are proposed, not recorded as founder-selected. No further routine interview is planned. Pricing remains open; the larger allowance has conditional full-use components of about $36 without reuse or $8 with hypothetical five-reader reuse before omitted operating costs. See [cost arithmetic](docs/ALLOWANCES.md). The earlier €12 example is not a viable-price finding.

## Completed and saved

- Demand/competition, supplier and conditional cost research; validated doc consistency in earlier checkpoints.
- Recorded Q1–Q15 directions and prepared the named consolidated specification/plan pair.
- Updated larger-package economics with public price rechecks on 19 October, without provider accounts/execution.
- Saved research/source-preflight explainers and [v1.0 review walkthrough](docs/demos/specification-review-v1.html) under docs/demos/. Checked the review at phone/desktop widths and light/dark appearances. This is documentation, not an application demo.
- Independent cost/scope review completed; fixed scheduling reuse freshness, expiry for unprocessed inputs and retained historical update inventory. Local document links/whitespace and cost arithmetic checked.
- Actual historical source evidence: 15 feeds fetched/parsed, 75 updates sampled on 15 October, two publisher transcripts verified. Manifest contains 35 sources, five per family. Parser fixes and exact evidence remain in [PREFLIGHT.md](docs/access-proof/PREFLIGHT.md).

## Deferred / unverified

D08 still defers **all scraper execution, supplier authentication requests and spending**. Assume capability only for planning. No paid/social scraper ran; broad full-content access, freshness, production costs and reuse remain unverified. Do not resume supplier work or request sign-in unless the founder reopens it.

The earlier source experiment retains its **global €50 / 150-generated-minute ceiling if resumed**. It is not a recurring budget or per-reader allowance. Formal seven-day observation has not started: **0/7**, no schedule running. Actual feed evidence must not be described as an all-platform pass.

No customer outreach, trial, payment, external email sending, deployment or publication is authorized. Cheapest useful business test is still access proof, then a separately approved manually checked daily briefing trial before full automation. The revised 14-day trial and prices/budgets are proposals.

## Next action

The founder's studio/person/channel requirement is included in the revised **SPEC v1.1 + PLAN v1.1** candidate; whole-version approval or requested changes is still pending. Search/saves, change tracking and sharing additions from the vision assessment are not blanket-approved. Supabase remains the backend recommendation, with platform selection open. Record the actual response/date before implementation. If approved, start M0 using the backend assessment and creator model as inputs, then the local milestones with fixtures labeled; do not reopen D08. For another session, read this file, SPEC.md, PLAN.md and docs/DECISIONS.md first. The saved v1.0 review walkthrough is historical and does not include AC19.

Actual new external spending: **€0**. Generated transcription: **0/150 experiment minutes**. Founder labor not timed. No app tests exist yet. Repository has no Git remote; local saving/commits do not provide remote backup.
