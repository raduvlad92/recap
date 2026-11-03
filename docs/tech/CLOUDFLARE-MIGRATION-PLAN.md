# Full Netlify → Cloudflare migration

Version **0.1 — implementation proposal**, 3 November 2026. Founder direction: duplicate Therecap on Cloudflare, keep the database where it is, switch when the duplicate is ready, then remove the Netlify project. This session audits and plans that move; it does not provision, change DNS, enable jobs, purchase a plan or delete hosting. Existing product, financial, review and reminder controls remain authoritative.

## Recommended result

Cloudflare serves the existing website, public creator pages, APIs and background processing. GitHub still checks changes before automatically deploying them. The **same recap Supabase project `zlfdqzabsfndifxiqguo`** retains all readers, catalogue records, content, jobs, reviews, schedules and financial history; the **same Clerk app** retains authentication. No data copy, replacement database, D1, Hyperdrive or R2 is required for this move. A small additive runtime-ownership control in the existing database is proposed; application data and existing IDs stay in place.

Use two deployable Workers initially:

1. **Web/API Worker + Static Assets:** Vite `dist`, application routes, catalogue HTML/XML, public metadata, authenticated APIs, webhook and unsubscribe handling.
2. **Private jobs Worker + Queues:** UTC cron dispatcher, durable queue consumers and the eight existing background task kinds. No public worker execution URL; authorized manual work goes through guarded admission in the API. Separate queues/concurrency limits by workload where needed to preserve fairness and avoid one slow pipeline blocking the others.

This keeps the public interface and job execution separate without creating a new database or rewriting domain logic. Pages is an alternative static host, but Workers Static Assets avoids a second hosting product and permits one explicit routing policy for APIs, SPA navigation and catalogue HTML. Architecture remains proposed until implemented and verified.

[Visual plan](demos/cloudflare-migration-plan.html) is a planning diagram, not a deployed duplicate.

## Live audit and current outage

[Sanitized audit](evidence/cloudflare-migration-audit-2026-11-03.json), captured around **08:15–08:27 UTC / 09:15–09:27 Berlin; durable refresh at 08:26:35 UTC**, separates provider metadata, actual HTTP responses, repository findings and unknowns.

| Area | Verified current state | Migration treatment |
| --- | --- | --- |
| Netlify project | `recap-v0-radu`, site `522a0657-c191-4355-8d72-2ed19c580b81`; no custom domain or aliases | Replace this project only; other team projects are outside scope |
| Availability | Site `disabled=true`, reason **Account usage exceeded for credits**; account exceeded at **2 November 09:14:53.365 UTC**; `/`, `/api/health`, `/creators/` all return **503** | Plan against an unavailable old host; do not assume rollback or redirects currently work |
| Published artifact | Deploy `6ae548a5b1de3ee251abb9bb` still reports ready, functional SHA `f955398088a9c911693c3e7e1ccd33d4a972c170` | A ready artifact does not override the disabled-site state |
| Build | GitHub private `raduvlad92/recap`, `main`; Node 22, `npm run build`, publish `dist`, esbuild functions | Build/test exact SHA in Actions; upload that artifact |
| Runtime | **29 functions: 14 HTTP, seven scheduled dispatchers, eight background workers**; deployed Node 22/1,024 MB functions | Port all behaviors, not just `dist`; measure Workers memory/CPU |
| Deployment trigger | One hook, **GitHub main after checks**, targeting `main`; GitHub workflow checks PRs/main and POSTs `NETLIFY_BUILD_HOOK` after a passing main check | Replace with coordinated Cloudflare deployment after checks |
| Other Git build controls | Allowed branches `[main]`; `stop_builds=false`; `build_filter`, `skip_prs`, `skip_automatic_builds` null | Native Git trigger/PR-preview suppression is not positively proved; prevent a second controller on target |
| Runtime configuration | 35 site variables; no shared team variables returned; three marked secret; production model route `openrouter` | Build a complete private manifest by scope/context; `.env.example` is incomplete |
| Dormant services | `has_database=false`, no Identity instance, no Edge Functions in deploy, no snippets/plugins/service instances; forms ignored; source audit finds no Blobs/Images/Storage dependency | No corresponding data migration indicated; recheck project add-ons/extensions before deletion |
| Observability | All deployed functions name `netlify-observability-extension`; request/error telemetry is host-specific | Replace with structured Worker/Queue logs, availability and lease-gap alerts; preserve audit/financial records in Supabase |
| Authentication | Clerk development app; direct browser → Supabase with Clerk tokens; server administrator allowlist | Preserve issuer/RLS and private authorization; separately verify new origin |
| Account/billing | Netlify Free, 300 credits, recharge off, usage exceeded; itemized usage/invoice not obtained | Do not invent a Therecap bill or savings percentage |
| Cloudflare access | Account/zone/Workers/Queues listing reads work; no `recap`-named Worker or Queue found | Reuse existing account; do not infer write/deploy rights from reads |
| Cloudflare gaps | Pages, subscriptions and candidate DNS-record reads return **403 Authentication error** | Billing tier, exact DNS availability and CI deployment permissions remain unverified |

The outage timing closely follows the observation's last matching social execution at 2 November 09:10 UTC. This is a confirmed hosting availability failure and a plausible explanation for the invocation gap; the individual stale jobs and upstream extraction failures have not been diagnosed or repaired here. Earlier status entries describing a ready deployment remain historical artifact evidence.

## Full behavior inventory

Source of truth: [Netlify config](../../netlify.toml), [workflow](../../.github/workflows/check.yml), [function entrypoints](../../netlify/functions/), [runtime helpers](../../netlify/functions/_shared/).

| HTTP entrypoint | Route / required behavior |
| --- | --- |
| `health` | `/api/health`; bounded public configuration health, plus proposed safe release SHA |
| `collect` | `/api/collect`; authenticated collection admission and signed job polling |
| `source-metadata` | `/api/source-metadata`; bounded public YouTube identity/image lookup |
| `collection-activity` | `/api/collection-activity`; private checks/jobs/costs |
| `admin` | `/api/admin`; verified owner reads, edits and guarded review decisions |
| `content-analysis-status` | `/api/content-analysis-status`; private analysis progress |
| `content-analysis-reconciliation` | `/api/content-analysis-reconciliation`; existing receipt reconciliation |
| `keyword-learning` | `/api/keyword-learning`; finite evaluation/preflight/generation/read operations |
| `keyword-production` | `/api/keyword-production`; guarded planning/rollout/publication operations |
| `keyword-recovery` | `/api/keyword-recovery`; exact-source recovery operations |
| `daily-briefings` | `/api/daily-briefings`; private snapshot reads/deletion |
| `reminder-events` | `/api/reminder-events`; signed sender webhook, replay protection |
| `reminder-unsubscribe` | `/api/reminder-unsubscribe`; signed confirmation and unsubscribe |
| `catalogue` | `/creators`, `/creators/*`, `/sitemap.xml`; dynamic public HTML/XML, canonical redirects, search/filter rules, 404/503 |

| Existing dispatcher | UTC cadence | Background task | Current batch bound |
| --- | --- | --- | --- |
| `hourly-collection` | `0 * * * *` | `hourly-collection-worker` | 12 minutes; three concurrent sources |
| `content-analysis` | `*/5 * * * *` | `content-analysis-worker` | 11 minutes; owner fairness |
| `automatic-content` | `*/5 * * * *` | `automatic-content-worker` | 10 minutes; bounded model calls |
| `social-collection` | `*/5 * * * *` | `social-collection-worker` | 10 minutes; six concurrent consumers |
| `social-content` | `*/5 * * * *` | `social-content-worker` | 10 minutes |
| `daily-briefing` | `*/5 * * * *` | `daily-briefing-worker` | Eight minutes; due readers from database |
| `recap-reminders` | `*/5 * * * *` | `recap-reminder-worker` | At most five claims |
| Private manual dispatch | No cron | `keyword-learning-worker` | Generation-only; 120-second call timeout |

Two Cloudflare cron expressions can preserve these seven logical schedules: every five minutes dispatch the six corresponding kinds; on the hourly trigger dispatch collection. Keep reader-local cutoff/timezone/DST logic and unique daily slots in Supabase. Do not turn the manual worker into an automatic schedule.

Preserve `/api/*` behavior and required `/.netlify/functions/*` compatibility aliases, especially unsubscribe links and private operator tools. Scheduled endpoints must not become unauthenticated runnable HTTP APIs. Existing dispatchers POST their own `APP_URL` and expect platform HTTP 202; replace this with durable internal enqueueing, retaining 202 only as **accepted**, never completed.

## Work that must precede duplication acceptance

**Routing, appearance and SEO.** Keep the current UI and all user controls. Serve hashed JS/CSS/fonts/images directly as static assets. Explicit Worker-first routes must cover `/api/*`, `/creators`, `/creators/*`, sitemap and compatibility paths before SPA fallback; unknown APIs must never return an HTML app shell. Preserve creator canonical redirects, valid HTML/XML, five-minute public caching, errors/filtered-page noindex, static security headers, and private no-store/noindex responses. `_headers` alone does not configure Worker-generated responses. Preserve rate limits: admin 90/min, catalogue 120/min, collect 40/min, collection activity 60/min and metadata 40/min. Cloudflare's native limiter is approximate/per-location; document that trade-off or implement equivalent shared enforcement. Financial admission stays transactionally enforced in Supabase regardless.

**Source networking is a hard compatibility gate.** [feed.ts](../../netlify/functions/_shared/feed.ts) and [youtube-channel-metadata.ts](../../netlify/functions/_shared/youtube-channel-metadata.ts) resolve public DNS and pin the selected address into `node:https` using custom `lookup`. Workers documents `dns.lookup` as unimplemented and its HTTP client does not support custom `lookup`. `nodejs_compat` cannot make this code equivalent. First prove a Cloudflare-supported transport with equivalent public-address/redirect/rebinding protections, TLS hostname validation, deadlines and body bounds. Use hostile local DNS/redirect fixtures; no live creator contact is needed for the initial proof. Do not silently weaken safety or drop arbitrary feeds. If native Workers cannot meet the contract, evaluate a Cloudflare-hosted Node container for this narrow downloader and explicitly revise cost/runtime assumptions before implementation proceeds.

**Runtime compatibility.** Introduce a host adapter around existing handlers, passing explicit environment/dependencies; keep domain logic and immutable job/request identities. Test actual workerd output with `nodejs_compat` and a pinned compatibility date: crypto/HMAC/AES, timing-safe checks, `Buffer`, `isIP`, deep equality, JOSE/JWKS, Supabase HTTP client, XML parsing, OpenAI SDK, streams and timers. Workers currently documents 128 MB per isolate, unlike Netlify's deployed 1,024 MB. Measure largest retained-source processing, bundle/startup and concurrent fetches. Page large responses and checkpoint long batches rather than assuming limits fit.

**Durable execution.** HTTP `waitUntil` after response has a 30-second extension and cannot replace 10–12-minute background jobs. Use Queues, whose consumer wall time is 15 minutes and CPU can be configured up to 5 minutes. Small messages carry only job/task IDs, source revision, owner epoch and release/schema version. Preserve database claims, lease renewal, budget reservations, request hashes, exact provider run references and receipts. Delivery is at least once: replay must detect already completed/reserved/dispatched work; unknown billed outcomes go to reconciliation, never automatic re-billing. Define bounded retries, dead-letter handling and explicit per-kind concurrency; reserve headroom for the six-connection Workers limit. Continuations must finish below provider wall/CPU limits.

**Production isolation.** Shadow and PR environments must have **no production cron or queue consumer**, no paid/manual side effects, no write-capable production credential, and no binding to a production job Worker. Supply explicit false execution flags; omission permits work for several newer paths. `SOCIAL_COLLECTION_ENABLED=false` alone still permits reconciliation/mutation. Read-only production QA, if needed, gets a separately restricted read adapter; test writes on local/disposable data. Cloudflare preview service bindings can call production unless explicitly isolated.

**Authentication and browser state.** Keep Clerk issuer/app and Supabase integration unchanged. Configure exact `APP_URL`, explicit production `CONTEXT`, JWT `azp`, Origin rules, Clerk redirect/allowed-origin configuration, webhook URLs and ordinary/owner/anonymous boundaries. Do not make the preview hostname a broad production origin. A hostname change requires sign-in and cloud reload; device-only caches, preferences and unsaved drafts do not migrate through DNS. Check save state/export options before transition; do not promise recovery of unsaved state from the currently unavailable origin.

**Secrets and configuration.** Build-public variables are only `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep Clerk/Supabase service credentials, provider tokens, signing keys and allowlists server-only, narrowly scoped to the Worker that needs them. Inventory all 35 live variables, code-only defaults and private database-backed settings, contexts and overrides. Preserve Apify pinned builds/pricing, model/provider/pricing identity, caps/holds and reconciliation controls. Current route is OpenRouter; Netlify AI Gateway code is legacy compatibility, not a verified current provider dependency. Keep historical route identities intact while removing future Netlify routing.

**Secret continuity gate:** `COLLECTION_JOB_SECRET` signs outstanding polling tokens; unsubscribe signing keys protect issued links. `CONTENT_ANALYSIS_WORKER_SECRET` also derives the AES-GCM key for encrypted reminder runtime settings already in Supabase. Securely provision the same decryption key from an approved private source, or perform an explicitly verified private re-encryption before rotation. Netlify-marked secret values are not assumed exportable; a successful environment-list call is not proof of recoverability. OpenRouter can use an appropriately provisioned replacement credential without changing the financial ledger. If keys are unavailable, stop that handover; do not discard encrypted settings, expose values in Git/logs or reactivate the old host by buying credits without authorization. Reminders remain off throughout.

## Automatic deployment after migration

Replace the final hook step in `.github/workflows/check.yml` with a coordinated release pipeline:

1. PR: catalogue checks, meaningful Node tests, TypeScript/build, workerd routing/auth/network/queue tests. Untrusted PRs receive no production secrets; any preview is isolated and has schedules absent.
2. Main: the same checks, then build and store the **exact checked SHA/artifacts**. Pin Actions/Wrangler dependencies. Ignore documentation-only changes for deployment while retaining appropriate document checks. CI's current local-Postgres skips must remain visible; run the database/fencing checks explicitly in disposable PostgreSQL when those paths change.
3. One production deploy controller, using a project-scoped Cloudflare token in GitHub secrets and a nonsecret account target variable. Verify Workers, Queues and required DNS permissions separately. An interactive OAuth login is not a durable CI credential. No native Workers Builds production trigger alongside Actions.
4. Serialize releases; recheck that the commit is the intended current main head before promotion. Deploy compatible private job code first, then web/assets, then verify both release IDs and safe public/authenticated reads. Worker deployments are not a multi-Worker atomic transaction: preserve backward-compatible queue messages/API contracts and prevent mixed-release job admission. No migration or real paid test runs automatically as a deploy smoke check.
5. Record release SHA, asset hashes, Worker version/deployment IDs, queue config and health proof. CI success, deploy acceptance, actual routing/auth and useful collected content are separate results. Fail deployment on unsafe smoke results and use the pinned prior Cloudflare release as the normal rollback after cutover.

Do not copy the current hook's race: it requests a build of `main`, does not name the exact checked commit and does not wait for Netlify readiness. Disable/remove the old hook controller only at the planned handover. Main branch protection is currently unavailable on this private repo/plan (GitHub API 403); workflow checks and stale-head verification help but are not equivalent to enforced branch protection.

## Duplication, switch and retirement

| Stage | Deliverable / exit gate | Current state |
| --- | --- | --- |
| CF0 — preflight | Verify selected `recap.filternode.dev` hostname/DNS rights, paid-tier state, scoped CI token and secure secret continuity; resolve downloader design | Hostname selected; execution gates unresolved |
| CF1 — portable runtime | Worker adapters, guarded transport, routes/headers/auth parity and queue dispatch; no external production execution | Not started |
| CF2 — isolated duplicate | Deploy exact artifacts to Cloudflare; prove read/write behaviors with disposable data, no production jobs; prepare ownership gate on both hosts | Not started |
| CF3 — release rehearsal | Test handover/rollback, duplicate delivery, stale owners, key decryption and preservation with synthetic state; capture production read-only baseline | Not started |
| CF4 — switch | Stop old admission, drain/reconcile, transfer execution ownership, route readers and move webhook/origin configuration; verify | Not started |
| CF5 — acceptance | Hosting/auth/SEO parity, exact preserved state and at least 72 hours of bounded operation/two normal daily cutoffs; preserve known product defects | Not started |
| CF6 — retire | Disable/remove old schedules/build hooks/credentials, delete only Therecap Netlify site, verify absence and billing cessation | Not started |

**Hostname — selected by the founder on 3 November 2026: `recap.filternode.dev`.** The audit found `filternode.dev` active in the existing Cloudflare account; exact record availability and DNS permissions remain unverified (403). No domain purchase is needed. Use `https://recap.filternode.dev` for production `APP_URL`, Clerk origins/redirects, canonical/OG/sitemap/robots links, reminder links, webhook targets and operator scripts when implementing the move. The selection does not mean DNS or TLS has been configured. A new `workers.dev` address can host isolated review first. `recap-v0-radu.netlify.app` belongs to Netlify and cannot be moved by editing Cloudflare DNS. Preserve old unsubscribe paths as aliases on the new host. A Netlify redirect would require the old site to serve again; the audit returned 503, so neither redirects nor a live Netlify fallback are proved available without separately resolving its credit block. Deleting Netlify ends every old `netlify.app` link. A zero-interruption move at that exact hostname is impossible; the app was already unavailable at audit time.

**Execution ownership is the real switch.** Add a private Supabase host owner/monotonic epoch and paused-admission state, checked by both host adapters and all manual/queue entrypoints. Owner and epoch must be validated atomically during claim/reservation; persist the epoch in admitted work. Recheck ownership immediately before provider/model/email side effects, require valid leases, and use database uniqueness for idempotent requests. A flag read alone cannot cancel an external request that already left the old host: pause admission, drain active work and account for every in-flight dispatch before transferring ownership. Do not reset any job, hold, quota, due timestamp or previously consumed daily slot.

During handover, retain the signed old runtime settings and exact provider references. Reconcile uncertain starts under their existing reservation; do not rescrape or regenerate merely to test Cloudflare. If the old host cannot accept a maintenance deployment because of credits, never treat its current pause as a permanent fence: before enabling Cloudflare, establish a verified durable stop for old execution (including future credit reset), or enforce an equivalent boundary at the shared database/provider permissions. If that cannot be proved, the switch is blocked. Preserve a written one-active-runtime receipt. Cloudflare cron changes may take 15 minutes to propagate, reinforcing the need for a server-side fence.

**One switch operation.** Implement a proposed `workflow_dispatch` migration workflow with `prepare`, `switch`, `rollback` and `retire` actions. The switch takes the expected current host/epoch and pinned Cloudflare release, validates every gate, then records durable phase receipts for pause → drain → configure routing/origins → transfer owner → verify. It must be resumable without duplicate jobs, fail closed on any uncertain phase, and refuse retirement before acceptance. Once the target is selected, ordinary main pushes deploy to Cloudflare automatically. DNS, authentication settings and database ownership are separate systems, so the workflow coordinates them with verified checkpoints rather than claiming a globally atomic switch. The retire action follows the acceptance window and removes only the old project. These are proposed workflow interfaces, not commands already available.

**Cutover runbook.** Capture native protected-row/schema/control baselines, old config and immutable release metadata privately; review only sanitized hashes/counts into Git. Verify both runtimes reject new side effects while paused, drain/reconcile known in-flight attempts, deploy/promote the target release, update the selected domain/Clerk exact origins/webhooks, then atomically transfer owner epoch and enable only the previously authorized Cloudflare policies. Reminders stay disabled and publication stays human-reviewed. Record DNS/TLS, login, owner/ordinary/anonymous checks, actual saved cloud state, catalogue HTML/XML and next due job/slot. Rollback rehearsal must include DNS caches and delayed old crons.

**Rollback.** Pause new admission on Cloudflare, drain/reconcile, bump the ownership epoch and restore only a proven usable release/host. Prefer the prior Cloudflare version while Netlify is unavailable. Never route traffic to Netlify 503 as a fallback, and never restore an old Supabase snapshot over new reader/review/financial data. The additive ownership migration remains backward compatible for the rollback window. Re-enable an old runner only after proving the new one cannot dispatch. Keep old credentials only as long as a concrete rollback need requires them.

**Acceptance.** Exercise login/cloud persistence, owner versus ordinary/anonymous access, all 14 handler families, signed webhook/unsubscribe behavior with fixtures, full catalogue/sitemap/canonical/cache rules, health/error/fallback behavior and static assets. Verify exact preservation of protected source text, reviews, requests/receipts, budgets/unknown holds, saved settings and next cutoffs; allow only enumerated migration/job changes against native baselines. Run duplicate/reordered/retried/stale-epoch/expired-lease/uncertain-charge cases in isolation. Observe real authorized cadence without increasing spend or replaying the backlog. If budgets/approvals block a job, prove the correct held state, not a useful-content success. The existing 18-source stall, pending review, sparse coverage and absent published briefing remain recorded product defects until independently resolved. No real reminder email is required or authorized for hosting acceptance.

**Retirement.** After acceptance and the chosen link-transition window, stop old cron/background admission and native Git builds, delete its build hook and GitHub `NETLIFY_BUILD_HOOK`, retire the site's read-only Git deploy key only after checking it is exclusive, remove unused webhook/monitor targets and any project-specific gateway/deploy credentials, then delete the **Therecap site only**. Do not delete the Netlify team, other sites or shared credentials. Remove `netlify.toml`, Netlify Vite/function adapters, CLI/SDK dependencies, `dev:netlify`, hardcoded operator hosts and active guides after the Cloudflare replacement is proven; retain dated historical evidence. Confirm site absence, obsolete callbacks/builds/jobs absent, Cloudflare releases still automatic and no new site usage. Account billing and other projects are checked separately; project deletion is not proof that an account bill stopped.

## Cost and operating controls

Cloudflare is also metered. Its current Workers Paid starting price is **US$5/account/month**, including 10 million dynamic requests and 30 million CPUms; static requests bypassing Worker code are free. Queues includes 1 million operations on the paid plan. This is an advertised allowance, **not a confirmed subscription or a hard monthly ceiling**. Other projects share it. Retain existing Supabase/Clerk/scraper/model/email charges and all financial holds independently.

The current seven logical schedules imply 52,560 pipeline ticks per 30-day month (six × 288/day plus 24/day). Combining them into two cron expressions gives 9,360 dispatcher invocations. At one small queue message per tick and one write/read/delete, that is 157,680 operations before retries/continuations. An illustrative 1 million API/catalogue requests averaging 10 ms CPU, jobs averaging 100 ms CPU and dispatchers 5 ms totals 15.303 million CPUms, within the quoted Workers allowance; jobs averaging 1,000 ms instead produce 62.607 million CPUms and about US$0.65 CPU overage. This is a sizing example, not measured demand or a price guarantee; split-stage tasks, logging, tests/previews, other projects and GitHub Actions usage add cost.

Netlify currently charges 15 credits per production deploy and 10 credits per GB-hour of compute; bandwidth/requests also consume the shared balance. No invoice or itemized Therecap consumption was obtained, so no exact savings claim is justified. Production docs deploys and long I/O-heavy 1 GB functions are identifiable potential cost drivers, not a measured attribution of this outage.

Set explicit per-job CPU/concurrency/batch/retry limits, queue backlog/dead-letter alerts, invocation-gap and expired-lease alerts, safe HTTP availability checks, and hosting budget alerts. Financial admission must remain a database transaction; approximate HTTP limiting and billing alerts are not spend stops. Sample successful logs, redact bodies/private IDs/tokens, and retain financial/audit history in Supabase. Measure actual target CPU/queue operations after duplication, then publish a separate hosting estimate. Recheck pricing before rollout, including the documented Workers Logs change on 1 December 2026. No new supplier/model execution cost was incurred in this audit; ordinary read/hosting usage is unmeasured.

## Verified documentation and remaining decisions

Official sources checked 3 November 2026:

- [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [static headers](https://developers.cloudflare.com/workers/static-assets/headers/), [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- [Workers Node DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/), [HTTP custom-lookup restriction](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/), [process/environment compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/), [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [rate limiter scope](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- [GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [preview isolation](https://developers.cloudflare.com/workers/previews/), [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [logs pricing/retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Netlify credit metering](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).

The founder selected `recap.filternode.dev` as the permanent address; the hostname decision is settled. Engineering preflight must verify billing tier/CI/DNS permissions, secret continuity and the downloader contract before promising a complete duplicate. This planning request does not itself activate Cloudflare, change old policies, repair stalled tasks or top up Netlify. Next action: execute CF0/CF1 under a subsequent implementation instruction, then work through the gates above. The broader SPEC/PLAN remains a candidate.
