# Recap text before video timestamps — D29

23 October 2026. Founder requested each minute reference at the end of its takeaway and in a smaller font, with the recap as the primary content.

The existing video-card link now presents takeaway text first, then its timestamp. The accessible name follows the same order. Timestamps use regular weight, muted green and a 10–11px size, smaller than the 12–15px takeaway text across current breakpoints. Each timestamp stays together when a line wraps. Hover underlines the takeaway text. Actual seek URLs, takeaway wording, untimed points and Full transcript remain unchanged.

Independent source review passed. A synthetic component fixture using the supplied public takeaway text passed Chrome checks at 1496px and 320px: all six timestamps trail the text, use 10px versus 13px text, and retain their exact original seek URLs, without horizontal overflow. [Phone fixture](evidence/timestamp-phone-fixture.png), [sanitized checks](evidence/timestamp-hierarchy-checks.json). Native preview snapshots timed out twice; Chrome supplied visual proof. The isolated release source passed **602 tests / 18 files**, catalogue validation, typecheck and production build. Concurrent keyword/admin work was excluded from that local check.

Push, CI, deployment and actual hosted verification are pending. This is a presentation change; it performs no database writes, source collection, provider execution or new supplier spending. Hosting/build costs are unmeasured. Next: release verification and founder review.
