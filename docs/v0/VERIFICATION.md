# Working v0 verification

Checked: 21 October 2026. Authorization: founder D20. Review URL: https://recap-v0-radu.netlify.app. This records a functioning first increment, not full SPEC/PLAN v1.1 completion or seven-platform proof.

## Release evidence

| Layer | Actual evidence |
| --- | --- |
| Local integrated checks | `npm run check`: **69 tests passed**, TypeScript passed, production build passed. Domain/account-state and collection tests include mocked feeds/provider jobs; those do not prove real supplier access. |
| Dependencies | Production-dependency npm audit reported **0 vulnerabilities** at release. This is dependency advisory output, not a comprehensive security certification. |
| Repository | Private https://github.com/raduvlad92/recap; code commit **660784b93d358def1a4a58e75ea0f9391446b9e9** pushed. Documentation/evidence may be committed later without application changes. |
| CI | [Run 39530314814](https://github.com/raduvlad92/recap/actions/runs/39530314814) passed the full checks for that exact code commit and triggered the Netlify build. |
| Deployment | Netlify deploy **6ad81c4ab014a80cb23f797e**, exact commit **660784b93d358def1a4a58e75ea0f9391446b9e9**, state ready, published **2026-10-21 01:58:53 UTC**. Public HTTPS app loaded and was exercised separately. |
| Continuous delivery | Main-branch GitHub checks trigger a scoped Netlify build hook. Netlify clones the private repository using a read-only deploy key. The second actual deploy verifies this path; a settings screen alone was not used as proof. |
| Native authentication | Existing recap Clerk development app and recap Supabase project connected using native Clerk integration. Real supported ticket sign-in completed in the browser with synthetic development accounts, not the founder's personal account. |
| Database isolation | [11 actual Clerk-token/Supabase checks](live-auth-check.json) passed: anonymous denial, own save/reload, second-account read/update/delete denial, spoofed-owner denial, stale-save rejection and invalid-signature denial. No service-role key in the browser. Supabase security advisors reported no issues after schema application. |

## Live browser scenarios

The following were actually exercised, rather than inferred from source code or health flags:

1. Local app signed in through Clerk, added the public Simon Willison Atom feed, collected five real entries, and persisted them to the actual Supabase account workspace.
2. Search reduced the view; bookmark and Read later were saved. Direct own-token database reads confirmed one saved item, one read-later item and five collected entries.
3. The hosted app signed in as that same synthetic account, on a separate origin, and loaded its cloud state: **14 items = nine fictional examples plus five collected entries**, with the real source and saved lists restored.
4. Hosted **Collect** refreshed the real feed through the deployed Netlify Function and saved the result; the count stayed at 14 instead of duplicating those entries. This proves one feed's path, not arbitrary-feed completeness or social collection.
5. Northstar Studio and presenter Maya Chen drill-down displayed distinct identities and underlying channels. Membership is not automatically treated as a speaking credit. New-channel coverage is not silently enabled.
6. Preferences switched the core interface to German and saved successfully; content remained in its source language. The app states that recap-language/time/email settings are preferences for future functionality.
7. Signing out returned to the separate English guest workspace, without exposing account sources or saved lists.
8. A guest collection attempt closed the native source dialog and opened Clerk sign-in without a modal trapping the other. Guest-only QA state was subsequently reset to the nine-example starter collection.
9. Native dialogs closed with Escape. Dialog transitions focus their heading. The preferences dialog fit the narrow viewport. No full assistive-technology audit is claimed.

## Responsive evidence

Actual evaluated CSS dimensions, rather than the preview tool's stale viewport metadata:

| Surface | Actual viewport | Result |
| --- | --- | --- |
| Local and hosted desktop | 1440 × 900 | Three-column workspace; no horizontal document overflow. |
| Local and hosted Chrome phone | 390 × 844 | Reading controls and vertical cards fit; hosted Chrome screenshot saved, document scroll width 375px. |
| Hosted phone | 360 × 800 | Header actions fit, preferences fit without horizontal overflow. |
| Hosted narrow phone, German core UI | 320 × 750 | Longer navigation labels fit; no horizontal overflow or clipped header actions. |

These are browser viewport checks, not physical-device tests. Not all six interface locales or every possible failure path were exhaustively exercised. The preview capture tool produced duplicated narrow screenshots and twice timed out saving the final desktop capture; those capture artifacts are not described as app defects. Any final saved Chrome screenshots are indexed separately below.

## Provenance, limitations and costs

- Fictional nine-item starter collection and abstract local cover artwork demonstrate the experience and carry sample labels. Real feed items carry collected-source labels and publisher text. No live AI synthesis, sponsor/brand extraction, generated transcript or automatically translated recap is claimed.
- Apify YouTube integration is implemented and unit tested, **paid runtime disabled**. Per-run caps do not implement a cumulative budget. No Apify job, X/Instagram/LinkedIn collection, seven-day observation or all-platform access pass occurred.
- Saved time/email settings are not working scheduling/reminder delivery. No email or customer outreach was sent.
- Workspace export/reset/delete is implemented; full Clerk-account deletion, upstream-provider cleanup, timed raw-data expiry, stable corrected recap snapshots and backup-erasure targets remain incomplete.
- Modular identities are separate in the domain model, persisted in each reader's versioned JSON workspace for v0. A shared normalized creator catalogue, large-scale ingestion/reporting and production operating limits remain future work.
- Authentication uses the founder's **development** Clerk instance. The review URL is reachable and marked noindex; this is not a completed customer launch.
- **€0 new cash charges observed**, no plan purchase, no paid provider/AI execution, no generated audio. Hosting/build/database usage used the existing free plans and was not independently metered into a production cost estimate. The earlier experiment remains 0/7 days and 0/150 generated minutes.
- Build passes with a nonblocking JavaScript bundle-size warning (about 666 kB before compression); optimizing loading is future work, not a failed release check.

## Saved visual evidence

[Desktop live app](screenshots/desktop.jpg), [studio drill-down](screenshots/studio.jpg) and [daily recap](screenshots/daily-recap.jpg) and [390px phone](screenshots/mobile.jpg), captured in Chrome on 21 October 2026. Guest starter content is fictional and visibly labeled. These screenshots demonstrate the deployed reference-matched workspace and sample recap, not real social collection or AI generation.
