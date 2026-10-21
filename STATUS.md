# Current status

Updated: **21 October 2026**. Phase: **functioning v0 deployed and verified**. The founder explicitly authorized autonomous v0 implementation/deployment in D20. **SPEC/PLAN v1.1 remain the broader unapproved candidates**, not a claim that v0 completes every milestone.

## Current increment: admin and creator catalogue under D21

Founder explicitly authorized this increment: a comprehensive admin panel, 120 researched accounts on each of YouTube, Instagram, X, Substack and LinkedIn, backend import and public creator pages. The backend import is complete: **600 channels across 560 canonical creators, 33 with multiple evidenced channels, seven disabled collection plans**. One same-name Ottolenghi identity pair stays separate and visibly unconfirmed. [Import evidence](docs/catalogue/LIVE-IMPORT.md), [delivery plan](docs/admin/PLAN.md), [owner guide](docs/admin/README.md).

Implemented server-authorized admin views for signups (including readers without a workspace), actual follows, creators/channels, editable descriptions/listing, provider plans, jobs, observed costs and audit history. Public directory and creator pages are server-rendered, with provenance, original links, planned coverage, search/filter/pagination, metadata and a public-only sitemap. Local checks: **137 tests**, typecheck/build, **26 actual database authorization/import checks**, transactional invariants and no security-advisor issues. Hosted deployment and final browser evidence are being completed; see [verification](docs/admin/VERIFICATION.md).

**No source collection, paid job, schedule or subscription started for D21.** Costs are supplier price research rather than incurred bills. Prior v0 feed data remains historical. A CLI command unexpectedly printed two server credentials; both were replaced, both old keys return 401, ignored local and hosted variables were updated, and no values are in Git/public artifacts. [Sanitized replacement evidence](docs/admin/CREDENTIAL-REPLACEMENT.md). Owner access uses an explicit server-only allowlist and a verified Clerk primary email, never the first signup or client metadata.

## Current: working v0 under D20

The founder selected the existing recap Supabase/Clerk resources and explicitly asked for a working v0 matching the reference, using GitHub/Netlify and Cloudflare only if needed. [V0 plan](docs/v0/PLAN.md) records the authorized first increment and exact targets. Implemented React/Vite workspace, studio/presenter/channel navigation, search/filters/history views, bookmarks/read-later, preferences/export/workspace delete, native Clerk authentication and per-user Supabase saved state. All fictional examples are labeled. Actual source extracts remain distinct from AI synthesis.

The new recap database public schema was confirmed empty before applying the workspace schema; private ownership rules and stale-save protection are active. [Live token/database checks](docs/v0/live-auth-check.json): 11 passed using real Clerk-issued tokens and two synthetic development test accounts. Browser ticket sign-in succeeded, and authenticated UI collection imported five real public feed entries and persisted them to Supabase. No service-role key is used in the browser. Test identities and session credentials remain only in ignored local files.

**Live review app: https://recap-v0-radu.netlify.app.** Private [GitHub repository](https://github.com/raduvlad92/recap), pushed code `660784b`, [passing CI](https://github.com/raduvlad92/recap/actions/runs/39530314814), exact-commit Netlify deployment and hosted browser checks are independently verified. [Release evidence](docs/v0/VERIFICATION.md) records 69 passing tests, typecheck/build, the actual token/database checks, real deployed feed collection, cross-origin cloud reload and responsive checks down to 320px. [Morning checklist](docs/v0/MORNING.md) gives the founder a five-minute walkthrough and separates owner input from remaining assistant engineering work. Cloudflare was not needed. Apify adapter exists with signed jobs, owner/build/item/time/per-run-cost gates; paid runtime remains disabled because aggregate budget controls and credentials/build are not verified. No social scraper or generated transcription ran.

## 21 October: modular creator model

Founder clarified that a creator can be an entire studio/team with multiple presenters and channels, requiring drill-down and a modular product (D19). Updated [glossary](GLOSSARY.md), [creator model](docs/CREATOR-MODEL.md), SPEC/PLAN v1.1 and [approval brief](docs/APPROVAL.md). Separate group/person/source identities, optional shows, dated affiliations and update credits; support overlapping relationships rather than a fixed ownership tree. Proposed behavior includes studio/person/source follows with visible underlying coverage, source/update deduplication, new-channel confirmation and preserved historical attribution. Publishing teams do not add reader-team accounts.

Independent edge-case review completed. AC19 and M0–M5 demo scenarios now cover multiple presenters/channels, cross-group people, guests vs members/mentions, unknown identity, overlapping follows and changing affiliations. No new demo, identity extraction, backend code or source run. At that checkpoint the visitor demo predated this model and Supabase was only recommended. D20 subsequently selected Supabase/Clerk; the working v0 above now demonstrates modular drill-down.

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

D20 reopens Apify-first adapter implementation and scoped v0 integration. **Paid/social scraper execution remains off** until credentials, pinned actor and aggregate cost controls are verified; capability is not an all-platform pass. Real public-feed collection is now available and has been tested separately. Broad full-content access, production costs and reuse remain unverified.

The earlier source experiment retains its **global €50 / 150-generated-minute ceiling if resumed**. It is not a recurring budget or per-reader allowance. Formal seven-day observation has not started: **0/7**, no schedule running. Actual feed evidence must not be described as an all-platform pass.

No customer outreach, paid customer trial, payment or external email sending is authorized. The working v0 review deployment is authorized by D20. Cheapest useful business test is still access proof, then a separately approved manually checked daily briefing trial before full automation. The revised 14-day trial and prices/budgets are proposals.

## Next action

Founder reviews the [live v0](https://recap-v0-radu.netlify.app) using the [morning checklist](docs/v0/MORNING.md). Next assistant engineering task is V0-N01: durable cumulative Apify budget control, reviewed private configuration and then a bounded verified run; paid runtime remains off. [Continuation tasks](docs/v0/PLAN.md#continuation-work) track AI synthesis, broader platform proof, multilingual quality, scheduling and full history/privacy work. The wider SPEC/PLAN v1.1 goals remain incomplete. Do not reopen the old whole-spec permission loop for this authorized increment.

Actual new cash charged/plan purchases: **€0 observed**; existing hosting/build/database usage is not a measured production operating-cost estimate. Generated transcription: **0/150 experiment minutes**. Formal seven-day proof remains **0/7**, no recurring collection/reminder schedule. Private GitHub push, CI, exact-commit Netlify deployment and live browser verification all completed; see the separate evidence above.
