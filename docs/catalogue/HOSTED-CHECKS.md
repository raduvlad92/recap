# Hosted public catalogue checks

**Final HTTP retest passed on 21 October 2026 at 03:13:47 UTC.** The earlier `/robots.txt` failure was corrected and retested on the exact ready production deployment below.

## Final deployment checked

- Production: <https://recap-v0-radu.netlify.app>
- Netlify site: `522a0657-c191-4355-8d72-2ed19c580b81`.
- Ready deployment: `6ad82db593863cb2b6ac87b0`, published `2026-10-21T03:13:19.290Z`; no deployment error reported.
- Commit: `b6b50a47d4a2bfc73b5309b54473cb0910ee476f`.
- [GitHub CI run 39537260858](https://github.com/raduvlad92/recap/actions/runs/39537260858): success/completed before verification.
- The immutable deployment URL and production `/creators/` returned identical HTML. Netlify adds `noindex` on the immutable deployment hostname; the production hostname correctly returns the public index headers below.

## Final results

| HTTP check | Observed result |
| --- | --- |
| `/creators/` | 200; server-rendered count **560 creators / 600 channels**; 36 visible page-one cards; structured-data count 560. |
| Five platform filters | Each returns 200 and **120** results for YouTube, Instagram, X, Substack and LinkedIn; matching structured-data counts. |
| MKBHD creator page | 200; three channel cards and three `sameAs` references: YouTube, Instagram and X. Each card states collection is planned. |
| Ottolenghi Substack page | 200; one channel retained; visible unconfirmed-shared-identity notice links to the separate Instagram entry. |
| `/creators/%E0%A4/` and missing creator | Both 404, `no-store`, and `noindex, follow`; neither becomes a 503. |
| Missing trailing slash | Directory and MKBHD routes return 301 to their exact canonical slash URL. |
| Production public crawler headers | Unfiltered directory, sampled creator pages and sitemap: `X-Robots-Tag: index, follow`. HTML meta agrees where applicable. The global static `noindex` rule does not override function pages. |
| Filter crawler headers | `noindex, follow` in HTTP and HTML meta, as intended for filtered duplicates. |
| `/admin/` | 200 static app shell; HTTP `noindex, nofollow`, matching HTML meta. |
| Anonymous `/api/admin?action=overview` | 401 JSON, `no-store`, `noindex, nofollow`; no user/email fields. This verifies rejection, not an authenticated owner session. |
| `/sitemap.xml` | 200 XML; **561 unique URLs**, exactly matching the compiled directory plus 560 creator slugs. No admin/API URLs. |
| `/robots.txt` | **200**, expected plaintext policy and canonical production sitemap. Allows `/creators`, catalogue CSS, fonts and favicon; otherwise disallows the workspace. Its own static response has `noindex, nofollow`; public catalogue HTML continues to have `index, follow`. |
| Public-output scan | **18 responses, 953,390 bytes**, including the 670,162-byte main browser bundle. Zero Clerk secret, Supabase secret/PAT, Apify token, private-key block or full JWT patterns. The only two email-pattern occurrences are Clerk dependency support contacts in library error messages; no unclassified email matches. The earlier check of the same bundle found no private admin allowlist email match. Values were not emitted or saved in this report. |

Representative public pages checked:

- [Directory](https://recap-v0-radu.netlify.app/creators/)
- [Marques Brownlee: three channels](https://recap-v0-radu.netlify.app/creators/marques-brownlee-b138206f/)
- [Ottolenghi: unresolved identity notice](https://recap-v0-radu.netlify.app/creators/ottolenghi-5ce629a7/)
- [Sitemap](https://recap-v0-radu.netlify.app/sitemap.xml)
- [Crawler rules](https://recap-v0-radu.netlify.app/robots.txt)

## Earlier failed checkpoint and resolution

The initial check at 03:10–03:11 UTC used ready deployment `6ad82c2e3852294a5febf109`, commit `6abf9bacd721f10eedd251aadd4a8518680e84e1`, published `2026-10-21T03:06:49.691Z`, after [successful CI 39536659960](https://github.com/raduvlad92/recap/actions/runs/39536659960). All requested checks passed except `/robots.txt`: it returned 500 with an empty body on the first request and two repeats, including a cache-busting request. Repeat request IDs were `01M5E71A3XD80AKPDGKDY2KE07` and `01M5E71AAQ660C2C5X0XK0DVWY`.

The subsequent fix serves robots as a static file with the canonical sitemap and removes the robots path from the catalogue function. The final retest above confirms 200 and correct contents on the fixed deployment; the original failure is preserved here as a separate checkpoint.

## Evidence limits

These are actual hosted HTTP checks after the named deployment became ready. They do not establish search-engine indexing, authenticate an owner in the browser, fetch all 560 individual hosted pages, or run any collection provider. Creator-detail HTTP sampling covers the grouped MKBHD identity and the unresolved Ottolenghi case; all public URL membership was checked against the live sitemap. The leak scan covers the requested public responses and main browser module, not all authenticated, provider or database paths.

No database writes, provider jobs, paid collection or browser use occurred in this verification. Existing hosting usage was not independently priced. Local test, live HTTP and authenticated owner-browser evidence remain distinct.
