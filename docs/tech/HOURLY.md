# Hourly collection and real-only workspace — D32

Authorized 23 October 2026. The founder asked to remove all fictional website/account samples, enable cheap hourly new-content collection for their account, check whether a source has new content first, and show costs per pull/source/day/user. This increment uses the existing recap Supabase, Clerk, Netlify and DeleteCookies Apify resources. No new supplier plan, generated transcription, paid AI, outreach or paid launch is included.

## Actual account cleanup and historical cost reconciliation

The actual owner workspace was selectively updated with its saved revision. **48 follows became 39**, removing the nine exact retired fictional sources. All **278 real private archive rows**, **36 keyword reviews**, preferences and saved items were read back unchanged. No reset, delete/recreate, catalogue reseed or annotation overwrite was used. Other readers' cloud workspaces were not edited; the website migrates retired sample references on their next load. Historical fixture bodies now exist only in test helpers and dated documentation, outside the production app.

All **53 historical provider runs** were re-read in the selected existing Apify organization and matched against the complete account run inventory, exact Actor/run identities and terminal states. Their old unresolved budget reservations were settled and the encompassing hold was closed after complete inventory reconciliation. Recorded run fees: **US$1.296381212221**; eight separately recorded build fees bring the global budget commitment to **US$1.303248323343**, leaving **US$43.696751676657** of the existing US$45 ceiling before D32 execution. This reconciliation made no source or paid-run requests. Provider observations can differ from a final invoice; the hold was never represented as spending.

## Runtime behavior

An hourly Netlify dispatcher (`0 * * * *`, UTC) calls an authenticated background worker. Only explicit enabled database policies participate. The worker loads that reader's current saved followed sources on every invocation; no catalogue-wide sweep and no first-user auto-enablement. Native RSS/Atom and YouTube RSS detect unseen original identities. ETag/Last-Modified validators and content hashes avoid redundant retrieval. Original identities deduplicate older `tech-`/`live-` IDs, including YouTube watch/Shorts/live aliases.

New YouTube videos try public existing captions first. The fallback uses the reviewed `streamers/youtube-scraper` build **0.0.319**, exact unseen video URL, maximum one item, **US$0.005/run** and 120 seconds. Current effective pricing and the actual pinned build are checked using free provider metadata before a paid launch reservation. AI description, AI summary and generated transcription remain off. Spoken content is distinct from RSS/video descriptions; metadata-only and unavailable-caption gaps stay labeled. The new collector preserves real timed captions and does not invent editorial summaries or topic keywords.

Initial owner limits are **US$0.10 per UTC day** and **US$1 cumulative supplier allowance for this new automation**, within the existing shared US$45 ceiling. Both limits include unresolved launched maximum holds; unknown charges do not expire at midnight. A database claim is recorded before the supplier POST, so uncertain launches cannot automatically duplicate paid work. Native checks have no scraping-supplier fee; that is not a claim of zero hosting/database cost. The old manual paid shortcut is blocked while managed hourly collection is enabled.

X, Instagram and LinkedIn currently have no reliable inexpensive freshness adapter in this increment. They log `unsupported` / `freshness_check_unavailable`, with no paid discovery job. Existing collected material remains available. An unsupported check does not mean a source was quiet, and this increment does not prove broad platform coverage.

## Logs and cost views

Preferences shows the signed-in reader's actual policy, hourly availability, daily/total supplier limits, today's checks/pulls/fees by source and latest check outcomes. Administration → **Collection costs** provides source, reader and day grouping, optional daily breakdown, date/source/reader filters and paged detailed logs. Checks record source/platform, status, times/duration, HTTP result, discovered/imported counts, provider run references, errors and known/unreported supplier costs. Private worker tokens are never exposed through public or reader APIs.

Job fees are authoritative; a check's mirrored linked-job cost is never added again. Distinct controller fees remain real but repeated controller item counts do not become unique-source/update totals. Unknown fees remain unknown and known subtotals are labeled. Historical source jobs remain per-job observations rather than invented historical hourly checks.

Reporting days use UTC and the check/job initiation timestamp. Date windows allow up to 93 inclusive days, with an explicit narrow-range error above 10,000 records per table; partial totals are not silently presented. Event pages contain 50 rows while totals cover the full accepted window. Hosting, database, model and other infrastructure/build invoice allocation are not measured in the supplier-fee subtotal.

## Verification and deployment state

Current implementation and activation evidence are being completed in this session. The actual-project schema/ACL/budget/integrity tests were exercised inside rolled-back transactions, preserving all real records and leaving no temporary schema/fixtures/holds. Local unit/typecheck/build and independent security, sample migration and reporting reviews are separate from deployed execution. The final release evidence will record migration application, the explicit owner policy, first real check, actual provider charge observations, GitHub push/CI, exact published Netlify deployment and signed-in/guest UI checks independently.

Technical contract: [hourly-contract.md](../hourly-contract.md). Database tests: [hourly-collection-db.sql](../../tests/hourly-collection-db.sql). No private reader ID, email, raw private content or credential belongs in this document or its public evidence.
