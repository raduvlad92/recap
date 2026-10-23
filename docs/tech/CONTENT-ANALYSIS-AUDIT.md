# Latest content: recap, keywords and Shorts audit

Reviewed **24 October 2026, Europe/Berlin**, using actual archive readback at **23 October, 22:01 UTC**, collection logs at **22:02 UTC**, the signed-in hosted page and current code. This is an investigation, not an implemented correction. [Sanitized evidence](evidence/content-analysis-audit.json).

## Findings

The archive contains 485 records, including 391 videos. The hourly collector added 207 videos: **92 with transcripts and 115 metadata-only**. All 207 lack `videoSummary`, stored `videoHighlights`, `videoKeywords` and `isShort`. All 21 followed YouTube sources have a saved `showShorts:false` preference.

1. **Missing recaps:** hourly collection retrieves metadata/captions but never invokes synthesized video analysis. Of the new arrivals, 115 lack the underlying transcript too. The signed-in Today view groups existing source descriptions under “Other updates”; it visibly includes sponsor/merchandise copy. Its rendering selects existing insights or `summary` strings, rather than generating a daily cross-source briefing. Daily generation remains unfinished.
2. **Missing keywords:** the new-content pipeline never generates `videoKeywords`. Keywords on 132 older videos came from the one-off D25 LMG analysis batch, with the D28 reference correction. The current missing rows have no keywords to display; no evidence attributes this to the scrolling footer or pending admin review.
3. **Shorts despite the preference:** the preference is saved correctly. Hourly RSS normalization constructs `/watch?v=…` URLs and omits Shorts classification. The reader hides an item only when `isShort:true` or a canonical `/shorts/…` URL identifies it. Unknown items therefore pass the filter. All 207 newly imported videos have that unknown classification. The live Today view even includes a source description containing `#shorts`. Duration alone does not establish a YouTube Short.
4. **Bullets without keywords:** `getVideoHighlights()` independently falls back to selected transcript sentences, while `getVideoKeywords()` only reads saved keywords. Replaying the actual renderer helpers produces bullets on all 92 new captioned videos and keywords on none. The live “Nintendo might be cooked too” card has six such excerpts, no stored analysis and no keywords. These are not the concise synthesized findings requested in D25.

## Code evidence

- [Hourly RSS normalization](../../netlify/functions/_shared/hourly-collection.ts#L143) creates metadata-only records with empty topics/brands/insights and no classification or analysis. [Caption recovery](../../netlify/functions/_shared/hourly-collection.ts#L319) adds captions and an initial text slice, without analysis.
- [Shorts filtering](../../src/lib/domain.ts#L173) requires positive flag/URL evidence. [Apify normalization](../../netlify/functions/_shared/apify.ts#L141) also misses `type:'shorts'` when the URL is a watch link and no boolean exists. The [bounded collector](../../actors/tech-collector/src/collector.mjs#L217) can ignore `raw.isShort:true`. Existing-row [hourly archive enrichment](../../supabase/migrations/20261022235056_hourly_reader_collection.sql#L150) cannot repair classification.
- [Video highlight fallback](../../src/lib/video.ts#L133) extracts sentences; [keyword rendering](../../src/lib/video.ts#L210) requires stored keywords. [Today rendering](../../src/App.tsx#L322) groups existing source strings.

Two independent read-only code reviews corroborated these paths. They also found secondary issues: duplicate-add can reset a source preference, and recovered captions can retain an older `videoSummary.status:'unavailable'` marker. Neither is needed to explain this snapshot, where all YouTube preferences are already off and all 207 arrivals lack analysis markers.

## Caption retrieval limits

All 21 YouTube checks in the latest 22:00 UTC hour returned HTTP 200; the earlier universal feed-block diagnosis does not explain this snapshot. The durable caption queue contains 115 items. Logs include `collection_budget_exhausted`, `response_too_large` and `provider_launch_ambiguous`; four provider jobs remain unfinalized. These are observed blockers, not proof that the creators have no captions. Do not increase budgets or repeat ambiguous launches to hide the backlog. The 98 hourly provider-job records show US$0.076 in finalized known fees; unreported final charges stay unknown. This is not a complete operating invoice.

## Recommended repair order

1. Repair classification consistently in all collection paths and guarded archive enrichment; preserve preferences and existing positive evidence. Reuse existing stored supplier evidence where available. Give unknown classification an explicit state rather than silently promising that “No Shorts” is enforced.
2. Add a bounded, retryable analysis stage after usable content arrives, keyed by content hash/rule version. Generate concise takeaways and independently reviewed full-content keywords; retain admin decisions. Backfill the already-collected captions without recollecting them.
3. Distinguish captions pending/unavailable, analysis pending/failed, reviewed summaries and source excerpts. Reconcile unresolved caption jobs and the 115-item backlog within the existing caps.
4. Implement actual cited cross-source daily briefing assembly separately from video-card analysis.

These are recommendations, not a new provider/model/budget authorization. No app, schema, archive, settings, supplier runtime or spending limits were changed. No supplier/model job was started by the review; existing hourly automation continues independently. The browser was returned to its original search/view. Raw archive, private identities, follows and credentials are excluded from the saved evidence. Supabase connector accounts did not expose this project; readback used existing local server credentials after verifying the exact project and verified owner. No new authentication was requested.
