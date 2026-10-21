# Public catalogue browser checks

21 October 2026. Local SSR at `http://127.0.0.1:5173`. These are local functional/HTML checks; they are not deployment or collection proof. No creator source was added or collected during these checks.

## Exercised behavior

- Directory reports 560 canonical creators, 36 cards on the first page and 16 pages. Actual browser viewport was **1067 × 667 CSS pixels**, with document width 1052px and no horizontal overflow.
- Searching `Marques` returns one Marques Brownlee entry and keeps the query in the URL. Search result pages have `noindex, follow`.
- Selecting YouTube returns 120 creators across four pages. Next page preserves the platform filter, changes the first card and exposes the Previous link. Selecting Science then submitting resets pagination and returns 12 YouTube creators.
- An unmatched name produces an explicit empty state and Clear filters / See all creators links.
- Marques Brownlee's canonical page shows three original channels: Instagram, X and YouTube. Each has the planned collection state, original link, format, intended useful material, coverage gaps and honest untested-content notice.
- Expanding account references exposes three distinct evidence URLs. Original links remain external links with `noopener noreferrer`.
- Creator HTML includes a specific title/description, canonical URL, `index, follow` and valid `ProfilePage` JSON-LD.
- Local fonts are loaded (`document.fonts.check('16px Onest')`), with Onest and canvas RGB(248,248,246) matching the established visual system.
- Keyboard Tab reveals the Skip to content link with a visible teal 3px focus outline. Enter scrolls to the main content; the next Tab reaches the main breadcrumb.

## HTTP and indexing boundaries

Actual GET requests for an unknown slug, dotted malformed slug, deep path beneath a real creator, malformed UTF-8 escape and invalid percent escape all returned **404**, the proper unavailable page and `noindex, follow`.

`/robots.txt` returns the catalogue/assets allow rules with a default disallow. `/sitemap.xml` returns valid XML containing **561 URLs** (directory plus 560 creator pages); no app root, admin or API URL was present.

## Findings and fixes

1. **Source-list handoff fixed in `src/App.tsx`.** The original addSource mount effect filled the source field and opened the dialog, but the later account-reset effect immediately cleared both. Actual click removed the query and left no dialog after a 10-second wait. The fixed effect waits for auth loading to complete, clears the previous account's transient UI, then fills the explicitly chosen public channel. The pending public query remains through sign-in/navigation until explicit Add or dismissal; it is never automatically added or collected.
2. **Muted public copy corrected in `public/catalogue.css`.** #737c6e on white measured 4.34:1; #71796e/#727a6c on the canvas measured 4.24/4.19:1; related small text #7a8275 measured 3.74:1. These now use existing #687163, with contrast **5.08:1 on white** and **4.78:1 on the canvas**. Browser-computed lead, tile-description and notice colors confirm the updated RGB(104,113,99).

## Focused handoff regression checks

The following actual local browser checks passed after the fix; neither Add nor Collect was pressed:

- Already signed-in synthetic QA account: the creator-page YouTube CTA opens the native source dialog with the exact researched channel URL prefilled. The chosen channel is absent from saved source rows, and the browser recorded zero `/api/collect` requests.
- Explicit Close dismisses the dialog and removes only the pending handoff query.
- Separate incognito guest: the same actual creator-page CTA opens the correct prefilled dialog, without adding the channel or collecting.
- Guest → sign-in: a five-minute Clerk ticket for existing synthetic QA B was minted and consumed entirely through ignored private tooling. Successful real Clerk sign-in leaves/reopens the dialog with the same exact pending channel. No new hosted QA account was used; no private identity or credential is retained in this report.
- A full page navigation with the retained query and signed-in session reopens the correct form after account loading. Escape dismisses it and clears the query. Every checked stage still recorded zero collection requests.

This directly exercises the original effect-order/auth transition failure under the actual React development runtime, rather than a parser-only test that would miss the race. `npm run typecheck` passed after the change, and `npm test` passed **137 tests in five files**. The parent owns the final build/CI/deployment gates.

## Browser-tool limitation

The T3 preview snapshot repeatedly reported `Preview automation snapshot timed out after 15000ms.` Functional clicks, typing, selects, navigation and evaluation worked. Both the iPhone preset and freeform resize returned new settings but left actual `innerWidth/innerHeight` at 1067 × 667 and the phone media query false. Requested dimensions are not mobile proof. No screenshot or successful phone-width visual verification is claimed by this checker; the parent is handling separate screenshots/mobile evidence. No Chrome/CUA was used by this checker.

## Separate parent visual checkpoint

The parent subsequently reported completed Chrome visual checks of the local directory and Marques Brownlee page at **actual 390 × 844 CSS pixels**, document scroll width 375px, with no horizontal overflow. This is the parent's separate browser observation, not a successful T3 resize by this checker. Hosted screenshots and final deployment evidence remain separate release work.
