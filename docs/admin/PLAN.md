# Admin and creator catalogue delivery plan

Authorized: 21 October 2026, founder requested a comprehensive admin panel and a separately researched catalogue of 120 accounts on each of five platforms, with one page per creator. This is a new scoped increment following the deployed v0. No creator collection, paid run, schedule, provider subscription or customer outreach is authorized by this task.

## Intended behavior

Admin at `/admin/` uses existing Clerk sign-in and server-enforced owner access. It shows registered Clerk users (including those who never created a workspace), signup/last-sign-in dates, their actual saved creator/channel follows, workspace activity, provider plans, distinct actors configured/used, jobs/status/results, cost observations vs estimates and missing telemetry. Reader email and follow data never appear in public catalogue/API/page output. No destructive user deletion or paid-run buttons are needed for this view.

Use existing Supabase, Clerk, GitHub and Netlify. No new infrastructure or purchases. Owner authorization comes from an explicit private allowlist and verified provider identity, never a browser flag, editable metadata or the first signup. Service credentials remain server-only. Anonymous and ordinary accounts must be tested for denied admin access.

The shared backend catalogue separates creator identities, platform channels and optional dated relationships, with research provenance and collection plans. Five platform lists contain120distinct accounts each. Cross-platform duplicates can map to one canonical creator only with identity evidence. No invented presenter affiliations. Versioned public pages provide original content-focus descriptions, exact original channel links, evidence, planned availability and an honest explanation of the intended recap; no fake collected posts/quotes or implied creator endorsement.

Public directory and creator pages are rendered as HTML with titles/descriptions/canonicals, crawlable links, JSON-LD and a sitemap. Indexability applies only to catalogue routes. App/admin/private APIs stay noindex. Page content must help someone choose sources; indexing is not a ranking or demand guarantee. No real source content has been collected by creating a page.

## Tracked tasks

| ID | Work | Exit evidence | State |
| --- | --- | --- | --- |
| AD01 | Scope/design/security plan and target preflight | This plan; existing recap resources verified | Complete |
| CA01 | 120 YouTube +120 Instagram accounts | Inspected account evidence, distinct URLs, original descriptions | Complete |
| CA02 | 120 X +120 LinkedIn accounts | Inspected account evidence, distinct URLs, original descriptions | Complete |
| CA03 | 120 Substack accounts and supplier cost comparison | Public primary-source prices, equivalent-unit caveats, 600 total validated | Complete |
| AD02 | Backend catalogue, plans, job/usage/audit telemetry | Three applied migrations, no advisor issues, 26 actual REST/RPC checks, SQL invariants | Complete |
| AD03 | Authenticated admin users/follows/operations/catalogue | Hosted verified-email admin accepted; ordinary account403/anonymous401; save/conflict UI exercised | Complete |
| CA04 | Import catalogue and publish creator pages/directory | 560 canonical pages/600 channels, five platform counts120, live public sitemap/canonical checks | Complete |
| AD04 | Verification, CI/deploy and durable handoff | 144 tests, screenshots, owner guide, hosted public/admin checks, owner-only deployment and actual QA403/cleanup evidence | Complete |

## Design plan

Reuse the founder's quiet workspace: off-white #f8f8f6, paper #ffffff, ink #20231f, muted #858b82, line #dedfd9, teal #519c8d; locally served Onest. Admin has a compact left navigation and a wide operational table/detail area, with readable counts and explicit zero/unavailable states. Directory is a searchable index; creator detail uses a large identity heading, a channel list, editorial context and collection coverage. Align copy left and keep reading widths bounded; avoid invented performance graphs. On phones navigation wraps and wide tables scroll within their container.

Plan review: a generic billing dashboard would misrepresent a pre-collection product. Use real signup/follow records and clearly distinguish zero runs, unconfigured credentials and modeled unit costs. Public pages use real research instead of sample posts to match the founder's request without suggesting collection has happened.

## Verification and next sessions

Record per-platform counts, canonical creator/page count, import hash, exact database target, test results, current public URL and admin authorization method without private account identifiers. Never commit user identities, credentials or private follows. Update STATUS, PLAN, decisions and demo log before handoff. No collection is started as part of verification; provider/job views can be verified with safe synthetic ledger records, labeled and removed or retained only as test records.

## Continuation work

| ID | Work | Current boundary |
| --- | --- | --- |
| D21-N01 | Resolve the one Ottolenghi same-name identity pair using a primary cross-link; keep separate until supported | Research and a reviewed catalogue correction, no collection required. |
| D21-N02 | Improve topic synonyms, editorial descriptions and public page language coverage | English catalogue pages are the current increment; broader multilingual product requirements remain in SPEC. |
| D21-N03 | Extend actor/run observability to future provider adapters and shared collection | Current ledger records actual manual requests; it does not implement shared scheduled jobs or an aggregate cash stop. |
| V0-N01 | Durable cumulative provider spending controls, then a separately resumed bounded access check | Do not activate jobs or schedules from D21. No Bright Data runtime was added. |

The founder can review the live admin/directory now. The guide has no API-token or dashboard-configuration task. Signup with the configured owner email may be needed on the first app visit; it is ordinary app use, separate from the Clerk dashboard login.
