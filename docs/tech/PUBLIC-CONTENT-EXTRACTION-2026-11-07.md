# Public original-content extraction — 7 November 2026

Scoped implementation on the prepared `t3/public-content-extraction` branch, based on merged retrieval parent `d1d4914f620227c80ed0387384c6b2c2bcda1f96`. This is local/disposable evidence and a draft review increment. The parent owns integration, production migrations, transport recovery, releases and native acceptance. Shared STATUS/PLAN/DECISIONS/DEMO documents are unchanged.

## Behavior

- Hourly Blog/Substack feeds reuse the existing RSS/Atom normalizer and stable hourly source/update/URL identities. Jobs add exact timestamp validation and structured `originalContent` provenance. RFC822 dates and zoned ISO timestamps are supported; missing dates, date-only/local times and invalid calendar dates never become collected midnight timestamps.
- Prefer an uncapped publisher body from `content:encoded`/Atom content. Descriptions and summaries remain excerpts. Detected clipping, short text and capped bodies are ineligible for the new analysis bridge. When that feed body is insufficient, fetch only the item’s exact public article URL. No references, bibliography, navigation, embedded resources or discovered article links are fetched.
- Extract one explicit main body: an `articleBody`, known post/body container, `article`, or `main`, in that priority. Exclude scripts, styles, navigation, forms, recommendations, comments and explicitly hidden content. Multiple best candidates, missing/unclosed bodies, detected paywalls and subscriber restrictions remain unavailable/partial. There is no JavaScript execution or rendering.
- Podcast show notes and audio enclosures remain metadata. An explicit item-level `podcast:transcript` supplies the exact transcript URL, declared MIME and optional language. Supported formats are WebVTT, SRT (`application/x-subrip`/`application/srt`), Podcasting 2.0 JSON **1.0.0** with `segments[].startTime/endTime/body`, and plain text. Preserve supplied timing; reject malformed, descending, invalid, clipped or over-limit transcripts rather than certifying a prefix. HTML transcripts, other JSON schemas, generated speech and OCR are outside this increment. One supplied supported format is selected; failures do not cause a format-fetch loop.
- Articles and transcript URLs must use the saved source or fetched-feed origin. A foreign article URL or foreign transcript CDN is blocked before fetching. Final redirects outside the requested publisher origin are rejected. The existing downloader can follow up to three validated public redirects before that final-origin check; this increment does not add a per-hop origin restriction to the protected native protocol.
- Private attempt records use existing authorized check IDs and constrained `original:<sha256(sourceId + newline + itemUrl)>` identities. Blocking, retrieval failures and usable/partial results have fixed codes and counts. URLs, raw text, follows and arbitrary upstream messages never enter diagnostic fields. Provenance URLs/text belong only to the existing private source record.

`usable` means bounded original text passed format and clipping checks. It does **not** certify that the publisher supplied the complete original or that a transcript matches all episode speech. Existing coverage UI still says completeness is unverified; no new frontend flow or translations were added. Nonusable prefixes keep `contentKind: metadata_only`; usable article/feed text uses `feed_text`, and supplied podcast speech uses `transcript`. The small shared type/sanitizer contract retains this evidence on archive reads and exports. The manual collector/native feed module is unchanged.

## Bounds and recovery

| Boundary | Limit |
| --- | --- |
| Existing feed window | First 100 current entries; no historical crawl |
| Linked-original work | At most three item attempts per reader/source/check, inside the existing source/worker deadlines |
| Shared extraction | At most 64 distinct exact source/item/format keys per worker invocation; reuse both results and failures across followers in that invocation |
| Deferred work | At most 100 private cursor records per source, without raw body/timed segments; process on the next claim even if the feed returns 304 or its hash is unchanged |
| Repeats | One durable attempt per reader/source/item, including failed or interrupted attempts; retained attempt blocks another network request across later checks |
| Native transport | Unchanged public HTTPS validation, no credentials/custom ports/private IPs, DNS validation/socket pinning, TLS identity, eight-second request / three-second DNS bounds, at most three redirects, 2 MiB response bound, private service timeout and existing daily source-service guard |
| Article parsing | 2 MiB input, 20,000 opening tags, depth 128, 16 body candidates; no DOM/resource loader |
| Imported usable text | 200–96,000 characters; existing feed-body cap remains 24,000 |
| Transcript parsing | At most 4,000 timed segments/cues; finite ordered timestamps within 24 hours; capped/malformed output is ineligible |

An attempt is durably logged before its network request. After an interrupted/uncertain attempt, the next check suppresses a repeat rather than pretending the download completed. Inspect the retained record before any separately scoped operator recovery; no automatic paid fallback or unbounded retry is introduced. The repeat guarantee lasts while the parent attempt history exists; deleting administrative evidence is not an authorized retry mechanism.

Deferred queue capacity/deadline exhaustion is reported as partial. If an old queue plus new feed items exceeds 100 deferred records, the excess stays metadata-only and `originalQueueLimit` reports the omission; historical backfill is not silently promised. A previously usable original is preserved. Pending payloads are cleared on archive deletion, source removal or workspace deletion, and fingerprint changes reset the existing source state. Current workspace/lease guards remain authoritative at import. No new database, deployed service, subscription, production policy/flag, follows or consent changes are introduced.

## Review-first handoff

The migration extends the existing **opt-in social/text review queue** to marked usable article/feed and publisher-transcript records. It does not enable a policy or dispatch a model. Existing policy start cutoffs, unique `(reader, update, content hash, task)` IDs, finite sessions, global/reader financial limits, unknown-charge holds and human approval remain in place. Sync/claim/call reservation/finalization recheck current reader, followed source, original text/hash and source revision. New public-original revisions also bind publication date and structured provenance; legacy revisions stay identical.

Only persisted usable originals qualify. Missing/partial/clipped/failed records, legacy unmarked feed text and forged/mismatched hashes cannot enter through this bridge. New suggestions remain pending administrator reviews; extraction never approves or publishes a finding. The existing worker owns any future model admission and shared processing; no new model endpoint or alternative budget is introduced. Analysis task reuse remains the existing reader/update/hash contract, not a newly claimed cross-reader AI cache.

Generated migration: `20261107204220_public_original_content_extraction.sql`, created with `supabase migration new public_original_content_extraction`. It expands constrained private attempt identities, adds current-parent/repeat guards, preserves guarded enrichment and extends the existing eligibility contract. It adds deletion cleanup without replacing the account-lifecycle stream. Parent integration must retain both streams’ deletion guards.

## Dependency and security review

`htmlparser2` is pinned to **12.0.0**, with lockfile. Its [primary callback API documentation](https://github.com/fb55/htmlparser2#usage) supports parsing without a DOM, browser, script evaluator or resource fetcher. Its [security policy](https://github.com/fb55/htmlparser2/security/policy) supports the current release; the npm registry reported 12.0.0 during this implementation. Production dependency audit returned zero advisories (`npm audit --omit=dev`); this does not claim the development dependency tree is advisory-free.

Format contracts were checked against [Podcasting 2.0 transcript tags](https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/transcript.md), [its transcript formats/JSON schema examples](https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/transcripts/transcripts.md) and [WebVTT](https://www.w3.org/TR/webvtt1/). Database changes follow the Supabase skill and [invoker function/access guidance](https://supabase.com/docs/guides/database/functions): existing invoker/ACL boundaries remain, and the new deletion trigger has a fixed empty search path, no caller-supplied identity and no callable public grant.

## Local evidence

Synthetic fixture tests cover realistic Blog/Substack HTML, RSS/Atom, all four transcript formats, clipping/caps, missing/invalid dates, foreign/unsafe URLs, redirects/MIME errors, shared successful/failed downloads, bounded/deferred extraction, unchanged-feed resume and duplicate attempt suppression. Disposable PostgreSQL uses local Unix sockets with TCP disabled, synthetic identities and all repository migrations; it tests exact persisted eligibility, deduplicated admissions, human-review-only results, date/provenance/source changes, unresolved financial holds, deletion/late-result suppression and private attempt ACLs. No actual model call is used for synthetic ledger/review fixtures.

Workerd fixtures exercise both parsers through the unchanged private downloader’s `kind: feed` request/reply contract. All network access is intercepted; foreign items cause no source request. The existing bundled runtime checks also exercise protected web APIs, native 204 completion, jobs and a disabled source gateway. The built source worker/container hashes still match the existing verified pins exactly:

- Source worker: `df652e8eb8f334939eb27cb25e6c289ba5a2061d327a636a62242585d1270b23`
- Source container: `82350aa896df6cea39ba99e28a4a36a20506efcc0ee1c56bb732736a7960e1a6`

Final local verification passed:

| Check | Result |
| --- | --- |
| Focused Vitest run, 18 files with `--maxWorkers=3` | **460 passed**, including PostgreSQL and both extraction/native workerd fixtures |
| `npm run typecheck` | Passed |
| `npm run check:cloudflare` with telemetry off and a synthetic Clerk publishable value | Passed; dry-run bundles, 26 web / seven jobs runtime checks, source gateway disabled |
| `npm run build` | Passed; existing large-chunk advisory only |
| `npm run catalogue:check` | Unchanged 560 creators / 600 channels, collection disabled |
| `npm audit --omit=dev` | Zero production dependency advisories |
| `git diff --check` | Passed |
| Built source worker/container versus existing verified pin | Both hashes identical |

Focused files: public-content, hourly-collection, social-content-local-db, hourly-caption-recovery-local-db, video-classification-db, hourly-provider-guards, hourly-clear-concurrency, automatic-content-local-db, automatic-content, domain, content-processing, processing-refresh, admin-analysis-review-local-db, daily-briefing-local-db, cloudflare-native-retrieval-runtime, cloudflare-public-content-runtime, collection and cloudflare-source-service. Tests use synthetic content and local/disposable services; no live credentials or source/provider/model/database endpoints are used.

 Intermediate regressions were corrected: date-changing database fixtures now respect archive date constraints, and the archive sanitizer retains the existing `contentKind` while preserving new provenance.

## Parent review correction

Independent read-only review of `b958337` found one P2 integration defect: the existing caption-independent video-format retry path also retained newly imported podcast transcripts. Podcast sources cannot service that YouTube queue; retaining whole episodes could eventually exhaust its existing 2 MB bound. The parent restricts that path to YouTube video updates. No second material blocker was found in the bounded review; SQL/ACL, current-source/hash/revision admission, financial holds and parser/downloader bounds were inspected separately from live acceptance.

A collector regression failed before the fix with a usable 24k-character podcast transcript marked partial and retained under `video_format_unconfirmed`. After the fix, collection is successful with no pending captions; a later 304 makes no transcript refetch, caption request or paid call. Under supported Node 22, **130 tests / five files pass**, including hourly collection, public parsers/workerd, disposable PostgreSQL caption recovery and video classification. Typecheck passes. The original parser/workerd repeat also passed 41 tests / two files before this correction; counts overlap and are not added. The earlier 460-test run belongs to the implementation head; exact updated-head CI remains required. No live source/provider/model/database operation occurred.

## Native acceptance left to the parent

1. Integrate with financial/transport/locale/lifecycle streams, preserve the explicit account-deletion guards, pass current CI and apply/verify the retrieval prerequisite plus this generated migration using the parent’s controlled migration process. No live schema was contacted here.
2. Keep existing model/supplier caps, held charges, policy cutoffs, review requirements, disabled plans and reminder preferences. Do not enable another pipeline or raise an allowance to make an acceptance example pass.
3. Under a separately bounded native check, use only exact items from already followed public feeds. Verify the exact original/date/source identity, private method attempts, usable text versus gaps, one-fetch behavior, deferred resume and persisted library readback. Confirm actual useful body/transcript coverage by inspecting the original; synthetic parser success is not supplier/source proof.
4. Verify the persisted item’s eligible queue IDs and current-source checks under existing financial admission. A budget-blocked queue is a valid stop. Model execution, supported semantic proposals, real human approval and a later ordinary daily snapshot are separate acceptance evidence; do not regenerate history or approve a real review for QA.

Live creator/provider/model/database requests, production migrations, production flags/plans, releases and deployment: **none** in this implementation. New metered supplier/model execution cost: **USD 0**; local/infrastructure overhead is not measured. Broad source completeness, third-party transcript CDNs, paywall/private access, render-only pages, speech generation/OCR and customer readiness remain unverified/outside this increment.
