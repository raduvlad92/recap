# Provider acquisition and independent verification

11 November 2026. The founder authorized implementation of the [focused repair plan](INGESTION-AND-QUALITY-REPAIR-2026-11-11.md), including parallel agents. This document distinguishes implemented code, offline checks and outstanding production acceptance. Backup work remains deferred.

## Implemented behavior

- Four private Cloudflare `WorkerEntrypoint` services separate collection, enrichment, generation and verification. They use real `ctx.exports` RPC inside the same checked jobs artifact. This preserves the normal release controller and immutable deployment bindings while providing separately invoked service boundaries. It does not create four independently deployed systems. [Cloudflare context API](https://developers.cloudflare.com/workers/runtime-apis/context/#ctxexports).
- Every private invocation checks the current native frame, lease token, epoch, release and revision. Automatic processing additionally requires its exact native message/frame and both deadlines. The public worker endpoint remains unavailable. Existing provider jobs and model receipts retain durable stage identity and financial authority.
- The opt-in `provider-only-v1` policy prevents app-side YouTube/Instagram fetching and silent native fallback. It is not activated by this code change. Existing delivery stays in place until the replacement has real acceptance.
- Separate hash-bound metadata jobs can repair video format without buying captions again. Explicit provider evidence is required; generic video types, duration and aspect ratio cannot establish regular-video eligibility. Import atomically rechecks the current transcript hash. Stale results preserve the current source, annotations and fees; missing source rows cannot be recreated by enrichment.
- The reviewed official Instagram Reel adapter separates caption and speech. Provenance survives reader sanitization; invalid or unbound provenance rejects the record. Speech is not visual/OCR coverage, and undocumented language/timing fields are not invented. Translations and OCR require separately qualified routes.
- Retry logic allows at most two retries within 15 seconds for explicitly known non-creating Apify reads, honoring Retry-After. Submission writes and unreviewed/billable GETs execute once. Permanent authentication/configuration failures do not retry. The same upstream run/intent and charges remain authoritative after ambiguity.
- Oversized provider results receive bounded complete-record reads where the documented API supports them. A single oversized original stays unimported. Caption text is no longer silently clipped into apparent complete analysis input; existing response/source/archive bounds remain.
- New `automatic-recap-atomic-v2` generation uses DeepSeek for drafting and Sol for independent verification. Exact source hashes, stable quote spans and complete atomic-claim coverage are checked. Context may veto attribution, qualifications or late corrections; it cannot supply positive evidence outside the chosen quote. A negative atom overrides an overall positive.
- New claims are at most 240 characters/38 words, without truncation. Full source context appears once in the checker request. Its conservative capacity is checked before draft spending, including escaped/Unicode input. One separately identified correction and full recheck require fresh finite scope for both calls; otherwise the checked draft stays held. Old requests and negative findings are retained.
- Both automatic video and social workers check their finite session/source/task identity, lease, exact settled charges and complete call plan before recap work. Current USD0.30 sessions hold multichunk plans requiring at least four USD0.10 reservations. Longer-source admission remains limited; this release must not claim general long-source readiness.
- Keyword extraction retains the full literal inventory and its existing independent checker. Review rows group the loaded page by source, with explicit keyword selection; selection itself publishes nothing. Reader display initially shows five approved keywords and can expand the complete saved list. Original spellings, proposals and owner approval requirements remain.

## Verification

The combined Vitest run passes **4,455 tests in154 files, zero skips**. After the final provenance guards,91 focused checks pass. The original102 reader,14 daily-use and11 new guarded migration-plan cases pass on disposable PostgreSQL17, zero skips. Twenty raw metadata/capability/race migration cases and real private RPC/default-queue workerd tests pass. Typecheck, application build, catalogue check, Cloudflare shadow bundles and37 workerd runtime checks pass. These are offline checks; no native migration or new semantic/provider proof is implied.

## New migration and release gate

The additive migration is `20261111211058_provider_metadata_stages.sql`, from schema 59 to 60. It adds metadata intent/import guards and the private native-capability check. It changes no financial rows, caps, schedules, publication decisions or lifecycle settings.

The pure [migration planner](../../scripts/provider-quality-migration-plan.mjs) pins the exact SQL, seven changed logical objects and four unchanged function metadata/ACL records. Only the explicitly replaced retrieval-key constraint may change an existing object identity. A new native operator must call `assertProviderQualityNativePredecessor` against the accepted schema/history hashes before freezing a fresh quiet-window data baseline. Rehearsal rolls back; apply checks every original project row, object identity/permission and history row. Completed migrations 53→59 are excluded.

As of the 21:33 UTC read-only preflight, production still serves accepted application `1947636`, epoch 6, unpaused; workers, source, delivery, lifecycle and controls match. The accepted schema/history predecessor hashes match exactly. **The new migration and application release have not been applied.** A new guarded native window, exact CI head and normal main archive/checkpoint acceptance remain required.

## Provider authority and live evidence

The first supplied replacement token authenticates to a different account and cannot read an exact old run (403). The founder explicitly chooses the original account. Its subsequently supplied token passes account authentication, matches every saved account pin, and reads the same exact old run with matching run/Actor/owner identity (200). The other-account key is removed from the project authority copy. No account rebinding or deployed credential change occurs.

Eleven fresh Actor/build metadata GETs under the original account succeed. Existing account, Actor, pinned build and current price fingerprints all match. This verifies metadata access only. The official Reel speech route, candidate transcript providers and provider-only collection remain unqualified in Therecap, with activation gates off. The token from the other account must not become runtime authority.

At the 21:10 UTC preservation read, all 967 original model rows and seven unknown holds remain exact. Total model commitment is USD9.998287986 under unchanged USD12 cumulative / USD5 day / USD0.10 call controls. Reader source commitment is USD0.099/day and USD0.523 lifetime, with USD0.001 day headroom and 12 older provider unknowns. USD0.02 discovery does not fit. Fresh native receipts must authorize any later run; UTC rollover alone does not release holds or admit work.

No implementation supplier/model job has been started and no production data/control/financial write has occurred. Hosting and API operating costs are not measured by these execution-ledger figures. The original two-call recap and later separate three-call keyword proofs remain completed and are never retried.

## Remaining acceptance

1. Apply the verified original-account credential renewal through a separately journaled controlled native operation, preserving exact old-run access. Prepare a finite provider comparison with verified account/build/schema/price, immutable targets/windows and actual budget admission. Do not buy content merely to classify an already-captioned source.
2. Finish combined CI/review, execute only the new migration under a fresh controlled window, and verify its rollback/preservation/native acceptance. Release through the existing normal controller; reconcile the same operation after any ambiguity.
3. Accept the exact successful normal main archive and GitHub-App checkpoint, real worker versions/assets/source/control and original delivery/settings. Then qualify the replacement provider paths before switching policy. No direct YouTube/Instagram fallback is permitted in that replacement mode.
4. Measure actual useful full text, explicit format accuracy, known-positive/window coverage, duplicates, latency and settled/unknown costs. Supplier metadata, fixtures, successful jobs and scheduling are separate evidence. Add real semantic evaluation of the new checker; the saved old false-positive result is not repaired retroactively.
5. Resolve longer-source affordability under existing controls or keep the limitation explicit. Do not raise caps or split work to evade an existing finite session limit.
6. Preserve the owner's **Keep held for review** decision. Useful eligible fresh acquisition, actual approved publication and a useful future ordinary daily cutoff must precede the 72-hour clock. No automated model verdict grants that approval; the clock remains stopped.

Existing genuine checks remain enabled for **12 November 00:20 UTC / 01:20 Berlin** and **07:05 UTC / 08:05 Berlin**. They must observe actual source/financial/daily results, avoid overlapping release mutations, and never manufacture a tick or rewrite a saved cutoff.
