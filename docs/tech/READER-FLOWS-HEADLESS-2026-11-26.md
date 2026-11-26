# Reader flows 2 and 7 · 26 November 2026

Production was serving `6a794cbd85a960afcf6153ab78889fd2a4d046e8` at the 01:19 UTC check. Isolated headless Google Chrome signed in as the verified owner through the 25 November admin audit's Clerk ticket flow. Each ticket had a 240-second lifetime and was consumed once. The audit sessions were revoked and their status was checked. [Clerk sign-in ticket documentation](https://clerk.com/docs/expressjs/guides/development/custom-flows/authentication/embedded-email-links)

| Flow | Production | Evidence |
| --- | --- | --- |
| **2 · Tech collection, coverage and source preview** | **FAIL** | Opened the Tech collection editor and navigated studio → nested person → YouTube channel. The channel showed **Collected**. Studio and person views offered no direct coverage details. Pasting a public YouTube channel link exposed **Add source** with no separate preview. The form stopped there. [Live paste form](evidence/reader-flow-audit-2026-11-26/live-source-paste-masked.png) |
| **7 · Dated history, originals and library persistence** | **PASS** | Selected 23 November 2026 in **All updates** and opened two originals in separate tabs. Bookmarked one item and marked another read later. Both controls remained selected after reload and both items appeared in their respective library views. Undid both from the reader UI. [Live dated history](evidence/reader-flow-audit-2026-11-26/live-history-masked.png) · [Live library after undo](evidence/reader-flow-audit-2026-11-26/live-library-after-undo-masked.png) |

The two saves and two undos were the only accepted application writes. Each returned HTTP 200 and was followed by a remote workspace read. After the undos, the full server workspace state matched its pre-test value and both controls were cleared after reload. No source was added. No collection, analysis or metered provider call was triggered.

## Release candidate

The candidate passed flow 2 in the browser. **Source coverage** lists the studio's in-collection channels, the person's in-collection channels, or the single selected channel. The panel reports stored collection states and available transcript, text and metadata counts. **Preview** validates the pasted URL locally and shows the normalized source identity. A separate **Add source** button confirms saving. Repeating Enter in the URL field stayed in preview.

The screenshots and accessibility checks below used the built candidate frontend with authenticated production reads in an isolated browser. The candidate passed with both libraries empty after undo. The populated-library check injected one existing archive item into the browser's workspace response. The browser blocked application writes and source metadata requests during candidate checks. No candidate code was deployed.

[Studio coverage](evidence/reader-flow-audit-2026-11-26/candidate-studio-coverage.png) · [Person coverage](evidence/reader-flow-audit-2026-11-26/candidate-person-coverage.png) · [Channel coverage](evidence/reader-flow-audit-2026-11-26/candidate-channel-coverage.png) · [Unsaved source preview](evidence/reader-flow-audit-2026-11-26/candidate-source-preview.png)

## Design bar

Small muted text on the `#f8f8f6` canvas went from **3.28:1** (`#858b82`) to **5.10:1** (`#626d60`). At 1440 px, production axe found 96 serious node findings on the feed and 36 each on history and library. The rules were color contrast and visible labels missing from accessible names.

| Width | Feed | Dated history | Library | Horizontal overflow | Header and source drawer |
| --- | ---: | ---: | ---: | --- | --- |
| [1440 px](evidence/reader-flow-audit-2026-11-26/candidate-feed-1440.png) | 0 | 0 | 0 | None | Desktop header and rail |
| [390 px](evidence/reader-flow-audit-2026-11-26/candidate-feed-390.png) | 0 | 0 | 0 | None | Compact header and drawer |
| [360 px](evidence/reader-flow-audit-2026-11-26/candidate-feed-360.png) | 0 | 0 | 0 | None | Compact header and drawer |
| [320 px](evidence/reader-flow-audit-2026-11-26/candidate-feed-320.png) | 0 | 0 | 0 | None | Compact header and [drawer](evidence/reader-flow-audit-2026-11-26/candidate-drawer-320.png) |

Counts are serious and critical node findings from axe-core 4.14.0. Library checks covered a populated saved list, an empty saved list and an empty read-later list at each width. At every tested phone width the rail was collapsed, the menu opened the drawer, and Escape closed it and restored focus to the menu button. Document and body widths matched the viewport. The header, tabs, feed, cards and open drawer also passed nested overflow checks.

[Candidate dated history](evidence/reader-flow-audit-2026-11-26/candidate-history-1440.png) · [Candidate library with a browser-only saved item](evidence/reader-flow-audit-2026-11-26/candidate-library-390.png). Screenshots mask account details, followed sources and item content.

Flow 2 and the design-bar fixes still need a production readback after the release window.
