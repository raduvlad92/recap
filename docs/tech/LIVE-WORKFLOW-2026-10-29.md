# New-content workflow — 29 October 2026

The founder requested live collection, reviewing, recaps and keywords. The live audit found that collection and review were deployed, but improved keyword extraction was still a finite operator-run workflow and ordinary generation remained paused. This increment connects new usable video transcripts to automatic drafts and the existing administrator decision flow. It does not turn a failed quality benchmark into permission to publish unchecked output.

## Behavior

- The existing hourly collector continues to discover YouTube uploads. Native RSS/Atom adapters also exist; X, Instagram and LinkedIn do not have automatic freshness adapters in this implementation.
- Every five minutes, a separate worker finds new eligible followed video transcripts after the owner's fixed cutoff. The first activation includes the three newly checked regular videos collected on 29 October. Old evaluation scopes and 271 historical queued jobs are preserved.
- Keywords use the current `context-roles-v2` process: two DeepSeek extraction passes, source patterns and numeric-family candidates, followed by a Sol check. Recaps use a DeepSeek draft, bounded selection when needed, and a separate quote-support check.
- The first live mode holds all resulting recap and keyword suggestions for administrator approval, including suggestions the checker accepted. Clearly rejected keyword candidates remain in original receipts. They are not added as hundreds of extra queue rows.
- Each review retains its exact source and references its actual saved requests. Prompts are paginated without copying every large request into every keyword row. Old production keyword reviews can also show their original prompts when one exact immutable publication establishes their provenance; missing or ambiguous evidence stays unavailable.
- Existing single/bulk decisions, in-place saves and additive publication remain the only publication path. A published recap and keyword stay readable during further review. Open readers see archive changes about every 60 seconds.
- The admin analysis screen shows automatic draft queue counts separately from the standard worker. Changing the standard model selector does not change the fixed reviewed keyword extraction/checking models.

## Collection correction

Successful caption retrieval previously removed the retry task even when the video format was still unknown. With Shorts excluded, those transcripts could never become eligible for analysis. The collector now retains a free format-only retry and preserves the saved transcript and annotations. It does not purchase captions again just to classify the original. A confirmed Short still follows the existing Shorts preference.

The three newest originals were checked directly against their public watch pages with the existing strict primary-player/canonical classifier. All three were confirmed regular, then updated through exact-record guarded database writes. Their saved source text was unchanged. This was a free source metadata check, not a supplier/model call or a full-video coverage proof.

## Controls and proof

New private tables track explicit reader opt-in/cutoff and one durable task per saved update, content hash and task kind. Each task reuses the existing finite source-bound call session and shared money ledger. Leases, stable request keys and cached settled receipts prevent duplicate generation after interruptions. Unknown charges stay held. Source changes, unfollows and disabled policies block new reservations. A daily-budget stop can resume the same still-valid session after UTC midnight; expired sessions and unknown calls are not automatically renewed.

The existing global and reader limits remain **US$10 cumulative / US$5 per UTC day / US$0.10 per call**. Automatic task sessions add a smaller US$0.30 ceiling and 100-call bound, without resetting or replacing global accounting. The standard `CONTENT_ANALYSIS_ENABLED` runtime remains false. The new private automatic policy and financial gates control this workflow; an optional `AUTOMATIC_CONTENT_ENABLED=false` override can stop it. No extra hosting environment variable is required. Attempts to create that additional variable returned 403; none was created.

The pinned migration is `20261029123923_automatic_content_review_tasks.sql`, SHA256 `b48e53559d7eb73c8e972edfedf71d6b3ca9f5f15854731604273c11031552c3`. Its actual-project test used a single transaction rolled back in full. Synthetic requests exercised existing reservations, pending drafts and subsequent approval onto the same item; no provider was called. The exact migration was then applied atomically with its history entry. Security advisors report no issues. Local PostgreSQL regressions include 24 new cases and 60 existing review/session cases.

All **3,485 local tests / 96 files**, catalogue validation, typecheck and production build pass. Independent reviews covered source/lease/budget guards, settled-call replay, exact request provenance and format-only retries. Before activation, all 16 original native row groups remained exact except the three authorized format updates: 513 archives, 867 calls, 431 old jobs, reviews, workspaces, histories and controls were preserved.

## Live release readback

Functional `6f4f4400b59a0ad66c0cc125d0595727ed384f67` first deployed the bridge at 13:00 UTC. Three real newly collected videos then ran through 19 paid calls: 15 DeepSeek calls for **US$0.003858236** and four Sol calls for **US$0.148281500**, all settled. Total new model cost is **US$0.152139736**; the highest single call is **US$0.049033200**. All native request/source/reader bindings match.

The real run created **182 pending keyword proposals** and two completed, checked recap drafts. One recap draft contained three exact quotes and three unsupported quotes. Its strict check stopped that attempt; the failure and all original receipts remain. Three exact-quoted model points were recovered without another model call into an additional pending recap review, explicitly marked as incomplete and without a completed AI checker. No real review decision or publication was made. There are four new recap queue rows including the original failure; 186 new reviews total, 514 pending combined. The original failed task remains blocked rather than being rewritten into an automatic success.

A simple follow-up now retains valid exact-quoted draft points when other points fail, reports the number withheld and warns that the recap may be incomplete. The checker sees only retained valid points; no paid repair loop was added. Latest functional **`1aaa7e514a78d152aaf64351827d983e8d81258d`**, CI **40878828153** succeeds with 2,682 passing / 803 environment-skipped tests; all 3,485 pass locally. Ready Netlify **`6ae3456141f1acade23b2a49`**, published **13:09:36.716 UTC**, serves that commit. The actual automatic five-minute dispatcher and background worker are registered alongside the unchanged hourly collection schedule. Netlify request telemetry separately confirms unattended scheduler invocations at 13:05 and 13:10 UTC, both 204; the 13:05 function log reports dispatched:true. This is actual schedule execution in addition to the manually observed three-video worker run.

At 13:09:41 UTC, cumulative commitment is **US$9.422405362 / US$10**, including the same seven original unknown holds of **US$0.125827191**; **US$0.577594638 remains**. UTC-day commitment is US$0.277966927. No automatic task is queued or running, all six new finite sessions are closed, and the existing opted-in policy remains enabled for subsequent eligible content until its limits stop it. All 867 old call rows, 431 old jobs, 22 old sessions, nine production releases, 20 published keyword inventories, old reviews and three workspaces remain exact; the only intended original-row changes are three format classifications and the two financial enable gates. No supplier limit or unknown hold was changed.

Release, real generation receipts, exact costs and hosted review readback are recorded in the companion [sanitized evidence](evidence/live-workflow-2026-10-29.json). Private raw source/request/charge/native evidence is in `.local/live-readiness-20261029/`; no credentials or source datasets belong in the committed evidence.

## Remaining limits

This is a budget-limited, review-first video workflow. It does not establish exhaustive keyword quality, complete transcript/video coverage, catalogue-wide collection, automatic X/Instagram/LinkedIn ingestion, daily cross-source briefing generation, email delivery or paid-launch readiness. Missing transcripts and unresolved supplier launches remain collection gaps. The existing supplier caps and unknown supplier holds were not raised or released.
