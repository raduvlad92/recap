# Content retrieval investigation and proposed repairs

5 November 2026. Investigation requested by the founder; repairs and supplier changes below are recommendations, not an applied release or new spending authorization. Read-only database/provider evidence completed at **01:00 UTC**. [Sanitized evidence](evidence/content-retrieval-investigation-2026-11-05.json).

The app already uses specialist Apify Actors for X, Instagram and LinkedIn. YouTube is different: direct public RSS discovers videos, a direct watch-page/caption request attempts free text, and `streamers/youtube-scraper` supplies a bounded caption fallback for known video IDs. Calls to Apify's HTTP API are normal Actor integration; they are distinct from fetching platform HTML ourselves.

The main problems are missing discovery fallback, poor or blocked provider output, ignored provider diagnostics, and content formats the application does not yet extract. The inspected real datasets do not support a blanket claim that our parsers discard working Actor output.

## Evidence and limits

- Inspected current checkout `9e61b30ea58397f4cc5086161b8cc50c7c12b33f`; application files were unchanged locally. Read existing live records in recap Supabase `zlfdqzabsfndifxiqguo` using SELECT-only REST after both connected SQL accounts denied access. No database RPC, mutation or live control change was used.
- Read existing Apify run metadata, datasets, saved INPUT and key-value diagnostic records; replayed them through the current parsers offline. Raw content, saved targets and credentials stay in ignored `.local/retrieval-investigation-20261105/`, not Git.
- Database snapshots and provider reads have different timestamps while existing normal collection continues independently. Counts describe the observed records, not a transactionally frozen production census or complete source coverage.
- New provider launches, creator-source requests, model calls, emails, database writes and setting changes: **zero**. No new metered execution cost was incurred by this investigation; infrastructure/read overhead is unmeasured. Normal background activity is separate.
- No application repair, full application test run, deployment, semantic approval or source-completeness proof is claimed. Runtime remains on its existing authorization and caps, with reminders unchanged.

## YouTube: discovery fails, but the caption Actor and parser do work

The latest check for each of all **21** expected YouTube sources, at 00:00 UTC on 5 November, shows **10 HTTP 404**, **three HTTP 500** and **eight partial HTTP 200** checks. The older quoted eight-404/five-500 result was a real 1 November checkpoint, not a current count.

All these latest checks identify `youtube_rss`. The native downloader already tries a second HTTP transport for the fixed RSS endpoint. That is not an independent discovery method: there is no channel Actor or official uploads-playlist fallback after RSS fails. Previously discovered videos can still be enriched before that failure, so successful caption runs and failed channel checks can coexist.

Four existing recent runs of `streamers/youtube-scraper` **0.0.319** returned inline `subtitles[].srt`. Offline replay accepted all four as transcripts, producing **7,767 / 12,626 / 4,344 / 2,973 characters** and timed segments. These are actual retained Actor results, not invented fixtures. They establish parsing of that inspected output shape, not complete speech or visual understanding.

Current input explicitly selects `ALWAYS_SUBTITLES`; it does not transcribe videos without captions. The importer consumes inline SRT only. It ignores URL-only subtitle content and generated `transcriptionUrl` output. The [current Actor documentation](https://apify.com/streamers/youtube-scraper) distinguishes subtitles in dataset items from generated transcripts in its key-value store. Merely switching to `TRANSCRIPTION_AS_FALLBACK` would therefore be incomplete.

The caption queue also has 24 retained tasks: eight `provider_already_attempted`, eleven `provider_launch_ambiguous`, two `video_format_unconfirmed`, one `provider_pending`, one `provider_error` and one `collection_budget_exhausted`. These are stored queue reasons, not a fresh reconciliation or a finding that all eleven provider runs are executing. Preserve their IDs and financial holds while investigating.

Proposed repair:

1. Keep cheap RSS discovery, but use a separately budgeted channel-discovery fallback after persistent failure. Reuse `streamers/youtube-scraper` with an explicit recent-item/window bound; configure regular videos/Shorts/streams deliberately. The current per-video fallback and its one-item reservation cannot be silently repurposed as a channel sweep.
2. Alternatively use the official channel uploads playlist for discovery. [Playlist listing](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list) costs one quota unit per call. This needs a configured project/API key and quota controls; it does not solve transcript access. The official [caption-download API requires permission to edit the video](https://developers.google.com/youtube/data/reference/rest/v3/captions/download), so it does not meet our arbitrary-public-creator requirement.
3. Reconcile/replay existing caption jobs before creating replacements. Where no usable captions exist, implement duration-bounded speech-to-text fallback plus reading and validating the exact run-owned transcript record. Validate provider store/record/video identity, redirects, content type, bytes and text provenance; do not fetch arbitrary dataset-supplied URLs with provider credentials.
4. Keep generated transcripts distinct from existing captions and partial text. Transcription has per-minute pricing and cannot fit by assumption within the existing US$0.005 caption reservation. Preserve the current caps; prepare a separately bounded configuration before execution.

Code: [`hourly-collection.ts`](../../netlify/functions/_shared/hourly-collection.ts), [`feed.ts`](../../netlify/functions/_shared/feed.ts), [`apify.ts`](../../netlify/functions/_shared/apify.ts).

## X: mostly empty provider datasets, not proven parser loss

Current configuration is `xquik/x-tweet-scraper` **1.12.411**, search mode with `from:<account>`, a rolling timestamp window, newest-first order, rich camelCase output and 20-item cap. Stored Actor INPUT matches the supplied fields; Actor defaults add other fields. The saved reviewed input schema supports the structured `time.sinceTime/untilTime` input, so there is no basis to call those fields wrong from a flattened documentation view.

The database checkpoint has **431 completed normal runs**: **426 returned zero rows**, five returned/accepted a row, with no application rejection reasons. Overlap means these are **three distinct reader deliveries**, whose stored text lengths are 107, 216 and 15 characters. The older claim that X has never returned a post is now stale. Text presence alone does not establish useful substance.

An existing empty run really has an empty provider dataset and a status explaining that no tweets matched the search/window. An existing nonempty run replays successfully through our normalizer. Neither inspected run saved an additional diagnostic/report record. The evidence does not distinguish genuinely quiet accounts from gaps in the provider's search coverage across every followed source.

Proposed repair:

1. Add collection of existing run status, optional `diagnostics` and `run-report`, with provider-specific classification. Their absence must remain a valid possible state. [Xquik documents diagnostic records and profile/timeline retrieval](https://apify.com/xquik/x-tweet-scraper).
2. Use a small fixed control set: a known recent post ID, that author's profile timeline, and the same timestamp-bounded author search. Compare identity/date/full text and exact provider charges; test own replies/threads and long posts separately. Keep production's original window immutable; a wider diagnostic window is a separate test, not repaired production coverage.
3. Review a newer pinned build before testing. Metadata currently identifies **1.12.417** as latest; it was not run. Prefer an account timeline for recurring account monitoring if the control proves better coverage, retaining our exact date filter/deduplication. Do not switch blindly to unreviewed `latest`.
4. Evaluate a second Actor or Bright Data only against the same known-post control if the incumbent fails it. No new subscription is justified by the current evidence alone.

## Instagram: confirmed blocking evidence and missing media extraction

The active Actor is **`yugenox/instagram-post-scraper` 0.1.4**, not the originally planned generic Instagram Actor. At the database checkpoint, 391 normal completed runs comprise 369 empty responses and 22 nonempty responses; application rejections total 18 outside-window rows and three provider-error rows. One accepted reader delivery remains the **47-character caption**. Proof jobs are separate.

Two inspected existing `RUN_REPORT` records explain more than our saved coverage: `PolarisProfilePostsQuery` was blocked on all three attempts in each run and marked gated. Other logged-out routes responded. Reports state datacenter-only proxy use for the date-window runs. One run returned nothing; the other returned a post older than the requested window, correctly rejected by our parser. This proves blocking on that route in those runs, not failure of every route or a universal explanation of every empty check.

The importer reads datasets but never reads these `RUN_REPORT` records. This loses the distinction between provider blocking, successful no-new-posts checks, stale fallback results and request caps. Stored INPUT matches the application's intended Instagram fields; the inspected failure is not an input-field mismatch.

Proposed repair:

1. Import the report's blocked/walled query indicators and preserve partial-output status. Add an empty-output circuit breaker/backoff based on persistent retrieval errors, with a bounded recovery/control probe; do not relabel failures as quiet sources or poll an ineffective route indefinitely.
2. Test exact known recent post URLs separately from profile discovery. Review a current maintained discovery Actor and, if necessary, Bright Data on the same accounts/date window/useful-text criteria. A different network route is a candidate, not a verified fix or permission to buy a proxy subscription. [Bright Data documents public Instagram extraction](https://brightdata.com/products/web-scraper/Instagram); no Bright Data run was performed.
3. Add Reel speech extraction using the [Apify Reel Actor's `includeTranscript` option](https://apify.com/apify/instagram-reel-scraper/input-schema), which is documented as an audio-minute add-on. It is not enabled or imported by our current adapter, and was not run here.
4. For substantive image/carousel posts, retrieve the relevant images and extract visible text, retaining image/page provenance and uncertainty. This is separate from captions and does not prove comprehension of every visual. Keep speech, image text and caption coverage separate.

## LinkedIn, articles and podcasts

**LinkedIn:** `harvestapi/linkedin-profile-posts` has real limited proof, but no current consumer follows and no normal jobs. The shared item table holds two proof items, only one with text. This is not a recurring-parser failure. Before claiming broader support, use the same bounded profile/company/known-post checks and preserve any missing attachments/article/video coverage. Do not add follows or trigger collection during this investigation.

**Blog/Substack:** RSS can already contain publisher-provided article text; our importer uses it when present. It caps text at 24,000 characters and does not establish completeness. Description-only feeds still lack full articles. Prefer full feed content, otherwise fetch the exact public linked article through the existing safe downloader and extract its main body with [Mozilla Readability](https://github.com/mozilla/readability). For pages requiring rendering or a managed fallback, [Apify Website Content Crawler](https://apify.com/apify/website-content-crawler) is a documented candidate. Restrict it to explicit article URLs/page caps, not an unrestricted website crawl. Paid/private articles remain unavailable. Add the separate feed-to-analysis handoff after useful body extraction.

**Podcasts:** show notes and enclosure metadata are not episode speech. Prefer publisher-supplied [Podcasting 2.0 transcript links](https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md); otherwise use bounded audio retrieval/transcription, checking duration before reserving cost. Persist episode identity, language, timestamps where available and partial/error status. No podcast transcription was executed here.

## Recommended delivery order

1. **Diagnostics and offline recovery:** retain Actor reports/statuses, distinguish blocking/quiet/older/capped output, replay already-paid results, and recover exact ambiguous references without duplicate launches. Add only meaningful regression cases for actual contracts and failures.
2. **YouTube discovery fallback:** repair the most concrete recurring failure while keeping the working SRT parser. Verify known channel/video identity, fresh discovery, captions and final stored import; diagnose transport versus channel-ID/source failure without treating HTTP 404 as deletion.
3. **X/Instagram fixed controls:** prove known recent originals before choosing an updated Actor, timeline route or backup supplier. Bound tests under existing supplier accounting, preserving every unknown hold.
4. **Content enrichment:** Reel audio and image/carousel text, complete public article bodies, publisher/podcast transcripts and generated speech only under separate duration/item/cash bounds.
5. **Operational acceptance:** verify useful content reaches the private library with citations and honest coverage, then AI proposals/review. Hosting health, Actor `SUCCEEDED` and a parser pass are separate evidence.

This is a proposed repair sequence. The founder requested investigation and suggestions; no repair release, provider upgrade, budget increase or new recurring test is recorded as approved by implication.
