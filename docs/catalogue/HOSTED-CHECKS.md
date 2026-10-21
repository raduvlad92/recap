# Hosted public catalogue checks

Checked 21 October 2026, 03:10–03:11 UTC by independent HTTP requests. This is an initial checkpoint; one crawler-file failure remains pending the next deployment.

## Deployment checked

- Production: <https://recap-v0-radu.netlify.app>
- Netlify site: `522a0657-c191-4355-8d72-2ed19c580b81`.
- Ready deployment: `6ad82c2e3852294a5febf109`, published `2026-10-21T03:06:49.691Z`.
- Commit: `6abf9bacd721f10eedd251aadd4a8518680e84e1`.
- [GitHub CI run 39536659960](https://github.com/raduvlad92/recap/actions/runs/39536659960): success/completed before deployment.
- The immutable deployment URL and production `/creators/` returned identical HTML. Netlify adds `noindex` on the immutable deployment hostname; the production hostname correctly returns the public index headers below.

## Results

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
| **`/robots.txt` — FAIL** | **500, empty body** on the initial request and two independent repeats, including a cache-busting query. Root is preparing a static-file route fix; retest required. |
| Public-output scan | 18 responses, 953,235 bytes, including the 670,162-byte main browser bundle. No Clerk secret, Supabase secret/PAT, Apify token, private-key block or full JWT patterns. The only two email-pattern matches are Clerk dependency support contacts in library error messages; no private admin allowlist email matched. Values were not emitted or saved in this report. |

Repeated robots failure request IDs: `01M5E71A3XD80AKPDGKDY2KE07` and `01M5E71AAQ660C2C5X0XK0DVWY`.

## Limits and next check

This verifies actual hosted HTTP responses after the named deployment became ready. It does not establish search-engine indexing, authenticate an owner in the browser, fetch all 560 individual hosted pages, or run any collection provider. Creator-detail HTTP sampling covers the grouped MKBHD identity and the unresolved Ottolenghi case; all public URL membership was checked against the live sitemap. No database writes, provider jobs, paid collection or browser use occurred.

Next action: wait for the robots fix deployment, record its exact ready deployment and commit, and repeat `/robots.txt` plus production public/admin crawler-header checks. The failed checkpoint remains recorded rather than being represented as a pass.
