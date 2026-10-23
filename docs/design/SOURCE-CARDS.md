# Shared source panels and X reply context

Authorized by the founder on **24 October 2026**, D34. Both Compact and Regular cards keep the preview/image, avatar, channel name, publication date, platform icon and save/read-later actions in a left source panel. The right column contains video takeaways and keywords, the actual social post, or the existing article summary. This is scoped work on the functioning v0; the broader specification remains a candidate.

## Design and behavior

Keep the existing Onest typeface and paper/ink/teal palette: page `#f8f8f6`, paper `#ffffff`, ink `#20231f`, muted `#6a7467`, divider `#e9ece5`, teal `#519c8d`. The source panel uses a quiet `#fafbf8` background. Text stays left aligned. A single shared grid aligns all content types; density changes spacing and source width without changing the information hierarchy.

Regular source panels are 156–224px on desktop; Compact uses 116–170px. On small phones they use 94px and 84px respectively, keeping the source on the left and usable reading space on the right. Long names/titles wrap. Real attachments remain uncropped and retain their carousel/playback controls; **View larger** opens the existing detail view. A text-only post gets a neutral **Text post** preview rather than an invented image. Articles with no image retain an honest source placeholder.

Video titles, original takeaways, exact seek links, full transcripts and the single-row keyword strip remain. This presentation change does not generate missing summaries/keywords or repair the separate hourly content-analysis backlog.

## Original posts and replies

The parser preserves explicit reply and quote relationships independently. It accepts actual Xquik, legacy/camelCase and expanded-v2 shapes, verifies original identity/author/URL compatibility, and never treats a leading `@mention`, conversation root or unrelated status link as a reply. Exact parent IDs may resolve against the reader’s existing archive; this lookup does not fetch or mutate records.

A confirmed reply has a **Reply** label, with the original post above the response. Quoted posts are identified separately. Captured originals show their available author, date, text, media and original link. Preview-only originals are labeled as previews. Missing originals say **The original post wasn’t included in this collection**; this does not claim deletion or fabricate the missing text. All source wording is rendered as text.

The shared cloud Actor source, reader/archive sanitizers and future ingestion validation retain context. The cloud Actor has not been rebuilt or run for D34. Historical repair reuses saved provider datasets and permits only `postContext` changes, with full workspace/record compare-and-swap guards and parent dependencies. No new collection is needed for this repair.

## Verification and delivery

Local synthetic demo: [source](../demos/source-cards/preview.tsx), [instructions](../demos/source-cards/README.md). Both densities pass 1496/1051/560/390/320px layout checks with side-by-side panels and no page/card overflow. Transcript opening, keyword activation and carousel navigation were exercised. [Desktop](evidence/source-cards-desktop-fixture.png), [phone](evidence/source-cards-phone-fixture.png), [matrix](evidence/source-cards-local-checks.json). Synthetic content is not live source evidence.

Independent UI review found preview-only originals, replacement-image failure state and unbroken titles; all three were corrected. Data review found conflicting identity/alias/layer evidence and plan validation gaps; all reproduced cases were fixed with regression tests. The exact archive repair and release checkpoints follow.

**Data/local checkpoint:** **1,019 tests / 32 files**, catalogue validation, typecheck and production build pass. The actual repair applied exactly **36 postContext-only patches** among **485 records**: **30 replies, five available originals; six quotes, six available originals**. All 485 IDs, original content/media/annotations, other identity columns and the complete owner workspace/revision remain identical except the intended nested context. The other 449 rows were not updated. A repeated plan returns zero patches. Actual rollback, stale-workspace and stale-parent checks passed. [Sanitized readback](evidence/source-cards-archive-readback.json). Push, CI, deployment and hosted verification remain pending.

Costs initiated by D34: **zero new supplier runs, provider subscriptions or supplier-run charges**. Ordinary hosting/build/database usage is unmeasured. Existing hourly collection is independent and its policy/budgets remain unchanged.
