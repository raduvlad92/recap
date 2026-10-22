# Compact and Regular card density — D30

23 October 2026. Founder requested a more compact optional card: reduce the left image by at least half its height and make it narrower, give the recap more width, halve padding above the title and below the keywords, tighten line spacing, and add a Compact/Regular dropdown beside Filter.

Compact is the default. The dropdown applies to update feeds, including Saved and Read later. Regular keeps the preceding card layout. The choice is saved in this browser, independently of the account/workspace; it does not sync across devices. Storage failures leave the layout switch usable. Today's grouped recap has no card-density dropdown.

Compact YouTube thumbnails keep their 16:9 shape on desktop, with channel/date and save/read-later controls below the image. On phones, an 88×90px image sits beside those controls and the recap uses the full card width below. Generic card artwork is also shorter, and compact article summaries display their complete text. Recap wording, trailing smaller timestamps, real seek links, transcript access, keywords and their scrolling/focus/reduced-motion behavior are preserved.

## Local verification

Synthetic fixture with the supplied public takeaway text; no private reader data or new content collection. Chrome checks at 1920, 1496, 1051, 560, 390 and 320px passed without horizontal overflow. [Desktop fixture](evidence/density-desktop-fixture.png), [phone fixture](evidence/density-phone-fixture.png), [sanitized checks](evidence/card-density-checks.json).

| Same fixture | Regular | Compact |
| --- | --- | --- |
| 1920px thumbnail height | 518px | 113px |
| 1920px recap-body width | 782px | 982px |
| 1920px card height | 520px | 377px |
| 1920px top/bottom padding | 20/24px | 10/12px |
| 320px thumbnail height | 190px | 90px |
| 320px top/bottom padding | 20/18px | 10/9px |

Regular and Compact both survive reload. Six exact timestamp links, Full transcript open/close, Filter open/apply, saving and the Saved feed passed. Long channel names keep channel and save controls separate. An article with over three lines retains its ending. Phone keywords continue to loop. One independent review finding—an unnecessary toolbar row in simpler phone views—was fixed and confirmed by a fresh review and 320px checks. Collection views wrap four controls when needed; simpler views remain on one row. Native preview snapshots timed out twice; Chrome supplied visual proof.

`npm run check` passed **655 tests / 20 files**, catalogue validation, typecheck and production build. The final CSS build also passed. Temporary viewport restored, isolated test storage restored and development server stopped. Functional **`33ae7d3`** is pushed, passed [CI 39866295572](https://github.com/raduvlad92/recap/actions/runs/39866295572), and exact Netlify deploy **`6ada905fbde976d8fbdfcf7a`** published at **22 October, 22:38:47 UTC** (23 October local). Actual signed-in reference checks at **1496/390px** passed: Compact/Regular switching, live Regular choice surviving reload, Compact restored, six exact seek links, nine keywords, Full transcript, no overflow and zero browser errors. At 1496px the actual image changes 492→93px and recap width 577→706px; at 390px Compact uses a 90px image and full-width recap. Hosted asset: `index-B2lKemmM.js`. [Live card](evidence/density-live-card.png), [live phone](evidence/density-live-phone.png). Screenshots exclude private follows/account identity; the normal viewport is restored.

No database/schema changes, source collection, provider execution, subscriptions or new supplier spending. Hosting/build costs are unmeasured. Complete for D30. Next: founder review.
