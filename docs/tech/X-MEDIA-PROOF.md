# X GIF retrieval proof

Checked **23 October 2026 (Europe/Berlin)**, using read-only provider requests and direct media GETs. The founder asked whether an Apify Actor could retrieve the original Fry reaction GIF where the app displayed only a shortened link. This investigation does not change the app or its archive.

**Yes: the existing [Xquik Actor](https://apify.com/xquik/x-tweet-scraper) already returned this exact GIF.** A provider switch and another paid run are unnecessary for this example. [Sanitized evidence](evidence/x-gif-proof.json).

## Exact evidence

- Original: [MKBHD post 2110901083585269926](https://x.com/MKBHD/status/2110901083585269926), published 16 October 2026.
- Existing actual run: `8Jz51XGuPOxvJCGC0`, Actor `wAusCMrm284Voaw86`, pinned build **1.12.394** / `0zYfRnonkqidzEkEF`, dataset `naY9gqQeVa5EvSwi7`. Organization and run/build/dataset ownership were verified privately. This is the existing 21 October collection, read back now; no new source run was started.
- The exact attributable, non-demo row contains `media[0].type: animated_gif`, its thumbnail in `media[0].mediaUrl`, and an MP4 in `media[0].videoVariants[0].url` with `contentType: video/mp4`.
- Both asset requests returned HTTP 200. Thumbnail: 11,108 bytes. Video: 20,811 bytes; ffprobe verified H.264, 332 by 250 pixels, 46 frames, 1.84 seconds. Visual inspection of the thumbnail and a decoded MP4 frame matches the founder's Fry screenshot. X serves this GIF as a silent MP4.
- The row's `displayTextRange` is `[0,0]`: there is no visible text body. The shortened URL is an attachment token, not an authored headline or summary.

The raw provider row, thumbnail, MP4 and decoded frame remain in ignored `.local/x-gif-*` paths. They are not committed. The evidence JSON saves only structural findings, public source/provider references, dimensions, HTTP results and hashes; no private reader identity, follows or credentials.

## Why the app loses it

[`normalizeItem`](../../actors/tech-collector/src/collector.mjs) looks for `thumbnailUrl`, `displayUrl` or `extendedEntities.media[0].media_url_https`. This Xquik rich-output row instead uses **`media[0].mediaUrl`**. The function does not preserve its media array or video variants. It also treats a nonempty raw `text` string as usable `feed_text`, even when that string contains only the attachment token. The normalized item consequently has no image and repeats the shortened URL as title and summary; the UI falls back to its illustration.

Recommendation: keep Xquik for this case, preserve structured photos/videos/GIFs, honor visible text ranges without deleting genuine external links, and render GIF-only updates honestly. Restore the already-collected media with guarded same-ID archive enrichment rather than an unrelated recollection. Review quoted/reposted media attribution, multiple attachments, URL validation and unavailable assets when implementing. This research has not implemented, imported or deployed that correction.

## Actor alternatives and limits

Xquik's current primary documentation explicitly lists images, videos and GIFs in `media`, consistent with the actual row above. [Xtracto post detail](https://apify.com/xtracto/x-post-detail-scraper) documents `extended_entities.media` and video/GIF variants; [Seemu video and image downloader](https://apify.com/seemuapps/x-video-image-downloader) documents direct GIF MP4 URLs. Those alternatives are documented candidates, not executions verified by this investigation. Current prices/entitlements must be checked before a future run.

No new Actor run/build, supplier subscription, schedule, database mutation or AI analysis was started. New supplier run spending: **US$0**. Read/storage/network/development infrastructure costs are unmeasured. The existing broad-access and incomplete-history limitations remain; one successful GIF does not prove every X media format or automatic understanding of the GIF's meaning.
