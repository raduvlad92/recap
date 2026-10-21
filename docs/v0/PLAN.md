# Working v0 delivery plan

Authorized: **21 October 2026**, founder: “Prepare the plan and start implementing the v0 without my involvement.” This supersedes the previous documentation-only boundary for **v0** and selects the existing recap Supabase project and recap Clerk app. The full SPEC/PLAN v1.1 remains a broader candidate; this plan defines the first functioning increment.

## Intended result

A reachable website matching the supplied creator-workspace screenshot, with actual controls and saved reader state. Studio/person/channel identities are modular. Example content is explicitly labeled; live collected content carries its real coverage/provenance. Account and deployment setup should be completed autonomously using existing access; genuine remaining owner actions go in MORNING.md.

## Stack and targets

- React/TypeScript and Vite; Netlify website/functions; private GitHub repository.
- Founder-created Supabase **recap**, org **recap** (`gnckhcrpnqqhlloqyvbw`), project `zlfdqzabsfndifxiqguo`, London/eu-west-2; public schema confirmed empty before creating v0 records.
- Founder-created Clerk **recap**, app `app_3Kz2AkpHvnp0Y5RfcmllEARrYcE`, development instance. Native Supabase integration; publishable frontend key and per-reader token, no service-role key in browser.
- Netlify **recap-v0-radu**, site `522a0657-c191-4355-8d72-2ed19c580b81`, existing `radu-vlad-92` team. `.netlify/` is ignored; no new plan purchase.
- Apify-first provider adapter. No other paid suppliers or infrastructure added. Cloudflare only if a concrete DNS/security need arises; none identified for the Netlify test URL.

## Tracked work

| ID | Deliverable | Exit evidence | Status |
| --- | --- | --- | --- |
| V0-01 | Record authorization, scope, targets and scaffold | This plan; exact target preflight; pinned dependencies/lockfile | Done |
| V0-02 | Screenshot-matched responsive workspace | Desktop/mobile screenshots; functional creator/source navigation, search, format/date filters, recap/detail views | Done |
| V0-03 | Real personal library and preferences | Bookmark/read-later/follows/settings persist; guest/account states separated; export; visible save/error/conflict state | Done |
| V0-04 | Clerk and Supabase | Login controls; own-row RLS; cross-account/anonymous-denial checks; persistence verification provenance stated | Done |
| V0-05 | Modular collection | Authenticated safe feed retrieval; bounded Apify start/poll integration with owner/cost gates; actual live checks distinguished from unit tests | Done |
| V0-06 | Tests, GitHub, Netlify and release review | Meaningful domain/collection tests, typecheck/build, remote commit, CI, exact deploy and browser checks separately recorded | Done |
| V0-07 | Durable handoff | MORNING.md with exact remaining owner tasks, working URL, verification evidence and limitations; STATUS/PLAN/decisions/demo log updated | Done |

V0-01–V0-07 are complete for the first increment. Live URL: https://recap-v0-radu.netlify.app. [Verification](VERIFICATION.md), [morning checklist](MORNING.md) and the demo log distinguish real source/account checks from fixtures and disabled paid adapters.

## First-increment boundaries

Implement real navigation, selection, saved state and collection plumbing now. The wider six-language content-quality promise, automatic five-minute AI synthesis, transcription, sentiment/comments/statistics, recurring multi-timezone generation/reminder sending, full account/provider deletion and paid launch remain tracked work rather than falsely completed v0 features. A saved preference is not proof of automated delivery. The first version may use labeled editorial fixtures to demonstrate synthesis while real feed items show source-provided extracts.

No customer outreach or broad-access customer trial begins. The original seven-day access proof is not a pass. Apify runtime remains off until credential, actor input/pricing and total-budget controls are verified; preparing its adapter does not authorize an uncapped service. The prior approved €50 total /150 generated-minute ceiling still bounds a resumed source experiment; no subscription upgrade or recurring paid spend is authorized. Accountless paid collection is blocked.

## Verification and handoff

Use appropriate unit/integration tests plus rendered desktop/mobile/keyboard checks. Test RLS independently from a real Clerk browser login and report which happened. Commit/push and deployment are separate. Record exact evidence and costs, including what could not be verified. Save a functioning URL even if further provider/owner setup remains; do not substitute the old static mockup for the app.

Account management in v0 exposes sign-in/sign-out and workspace deletion. Clerk account deletion is not offered inside the app until a verified cross-service deletion flow exists; do not claim full account/provider erasure from the workspace-delete action.

## Continuation work

| ID | Assistant-owned next deliverable | Current state / evidence needed |
| --- | --- | --- |
| V0-N01 | Durable aggregate paid-collection ledger/stop; privately provision reviewed Apify build, signing secret and operator allowlist; run a bounded real-caption check | D22 manual bounded path completed: durable aggregate holds, reviewed private Actor and actual captions verified. Hosted web paid runtime remains off; no recurring collection. See ../tech/VERIFICATION.md. |
| V0-N02 | Expand the Apify adapter to the founder's essential social creators and verify useful content per family | D22 imported 278 real items from 20 of 39 selected YouTube/X/Instagram sources. All coverage incomplete; 19 sources returned no accepted items. Other source families and broad access remain unfinished. |
| V0-N03 | Genuine cross-source analysis and cited daily recap generation | Examples only; select model and approve bounded execution costs before paid calls; evaluate fidelity, disclosed sponsorship and multilingual output. |
| V0-N04 | Daily scheduling, reminder delivery and usage/coverage accounting | Preferences saved only; no schedule or sender active. Test retries, DST and quiet/late days. |
| V0-N05 | Stable snapshots, corrections, expiry and full cross-service deletion | Workspace state/export/reset/delete present; full history/privacy promises incomplete. |
| V0-N06 | Production auth/domain/readiness and customer validation | Development Clerk review app. Broad access still precedes a separately authorized customer trial; no outreach or paid launch started. |

Do not hand these engineering tasks to the non-developer founder. Ask only for private access that cannot be obtained from existing authorization, material product direction or spending beyond the authorized ceiling. The wider candidate's unmet goals stay visible; completion of this v0 table does not mark M0–M5 complete.
