# Collection v0

Prepared 21 October 2026. This document describes implemented code, not verified deployed integrations. The founder authorized the v0 build separately from the earlier specification candidate. No provider job, account change or spending was performed by this implementation agent.

## What works in code

- Authenticated manual collection of public RSS/Atom feeds, with bounded feed discovery from public blog/publication pages. Substack publication pages can use their public /feed endpoint. Podcast feeds import show notes and episode metadata; they do not retrieve or transcribe audio.
- An Apify-first YouTube adapter starts a bounded job and polls its signed result. Only the maintained streamers/youtube-scraper actor is allowed. YouTube @handle/channel URLs and individual watch/shorts links are accepted; search, playlists and legacy /c/ or /user/ routes are not accepted in v0.
- Up to five recent updates per collection; the default YouTube maximum is three. No continuous collector, scheduler, automatic retry or account-following import exists.
- X, Instagram and LinkedIn collection return an explicit not-configured result. Supporting their saved links is not a claim of live content support.
- Source text is extracted and sanitized. It is not presented as a generated recap. Topics, brands, sponsors and insights remain empty rather than being guessed. Original links and explicitly supplied description/feed links remain available; linked pages are not automatically fetched or independently verified.

## Frontend contract

The browser calls collectSource(source, getToken, options?) from src/lib/collection.ts. It returns CollectionResult, starts/polls a provider job when needed, and throws a readable Error for unavailable/failed collection. The caller owns source status and importing results into the workspace. Options accept an AbortSignal and progress callback. Browser cancellation stops polling; it does not promise that an already started provider job was cancelled.

POST /api/collect accepts a JSON object containing source. Source includes id, name, HTTPS url, platform, creatorIds and an optional feedUrl. Fields are validated and reduced to the accepted set. A feed returns status completed and result. An Apify start returns status running and jobToken with HTTP 202.

GET /api/collect checks the signed job from the X-Collection-Job header. The normal Clerk bearer token is also required. The server verifies that the job belongs to that same account, verifies the run/actor match, and obtains the dataset ID from that trusted run. Clients cannot choose arbitrary actors, runs or dataset IDs. Job capabilities expire after 20 minutes and are not placed in URL query logs.

GET /api/health returns configuration booleans, per-platform modes and automaticScheduling false. It exposes no token, issuer, account identifier, actor build, job ID or dataset ID. A configured flag is not an end-to-end verification result and does not assert that the current reader is the paid-collection operator.

## Runtime configuration

Feed collection requires CLERK_ISSUER_URL and APP_URL in the Netlify Functions environment. Verification uses the configured issuer's remote JWKS, RS256 signature, issuer, expiration/issued-at/subject claims and an allowed azp origin. APP_URL is the deployed app origin. Local development origins on ports 5173, 8888 and 4187 are allowed only outside the production context. Requests with an unrecognized Origin are rejected. No bearer token means no live fetch, even when the provider token is present.

YouTube collection is disabled by default. All these gates must be satisfied:

| Variable | Requirement |
| --- | --- |
| APIFY_RUNTIME_ENABLED | Exactly true, only when live work is intentionally enabled |
| APIFY_API_TOKEN | Server-side runtime token; never a VITE_ variable |
| COLLECTION_JOB_SECRET | Random signing secret of at least 32 characters |
| COLLECTION_ALLOWED_USER_IDS | Explicit comma-separated Clerk operator subject IDs |
| APIFY_YOUTUBE_BUILD | Reviewed numeric build number, such as a verified x.y.z; not latest |
| APIFY_MAX_TOTAL_CHARGE_USD | Explicit positive amount no greater than 0.10 per run |
| APIFY_MAX_ITEMS | Integer 1–5; defaults to 3 |

Every start sends the pinned build, a 120-second timeout, maxItems, maxTotalChargeUsd, restartOnError false and the bounded actor input. Input requests newest videos, zero channel Shorts/streams, available inline subtitles using ALWAYS_SUBTITLES and SRT, any available subtitle language, no key-value subtitle copy, no AI video summary and no AI visual description. Generated speech transcription is not requested. Provider-side maxItems is a charging limit for applicable pricing models, not a guaranteed response-size limit; the adapter separately limits normalized rows.

**The per-run charge limit is not a cumulative budget.** Repeated operator requests can add up. Keep paid runtime disabled until a cumulative account/ledger limit or explicitly bounded operator session is configured against the founder's authorized total. The previous experiment's global ceiling cannot be enforced by these per-run caps alone. There is no in-memory counter advertised as durable protection. Deployment configuration and real supplier execution require their own recorded evidence.

## Coverage and data limits

- contentKind feed_text means publisher-provided RSS/Atom body text. The publisher may still supply an excerpt; article completeness is not established.
- contentKind transcript means inline caption text was returned. Captions may be generated, incomplete or wrong, and do not describe all visual content. The adapter never treats YouTube's text/description field as a transcript.
- contentKind metadata_only means descriptions, excerpts or podcast show notes. No full article, spoken episode or video analysis is claimed. There is no title-only recap fallback.
- Extracted content is capped at 24,000 characters per update and previews at 700 characters. Dates missing or unparseable remain empty/unknown, never replaced with collection time. Empty importable results are not described as proof of a quiet source.
- Update IDs are stable hashes of source ID plus accepted original URL. Duplicate URLs within one source response are imported once; the same URL through different sources retains each source's provenance without overwriting the other record. A future canonical cross-source update needs a provenance list; this is not semantic cross-platform deduplication.
- Source creator mappings supplied by the reader are retained as organization choices, not verified identities. Every collected update starts with no inferred contributor IDs; ownership, employment or a mention is not treated as proof of participation.
- Members-only/private YouTube rows are excluded. Feeds are fetched without cookies, user credentials or custom authorization. Credential-bearing URLs and common token/signed-URL query fields are rejected. Public response accessibility alone does not establish reuse rights.
- No database schema or retention job was changed here. Extracted content returned to workspace persistence still needs the v0's explicit retention/export/deletion treatment; do not call the full specification's seven-day expiry or backup policy implemented on this evidence.

## Feed request protection

Only HTTPS domain URLs on port 443 are fetched. IP literals, local/special hostnames, user-info credentials and credential-like query keys are rejected. DNS resolves all addresses; any nonpublic result rejects the request. The validated address is pinned to the actual HTTPS socket with normal TLS hostname validation, closing the lookup/fetch rebinding gap. Every redirect is revalidated and resolved again, with at most three redirects. IPv6 validation deliberately accepts a conservative global range and may reject some legitimate uncommon feeds.

DNS has a three-second deadline; each HTTP request has an eight-second deadline. Responses are capped at 2 MB, unexpected compression is rejected, discovery examines at most 512,000 characters, XML document types/entity definitions are rejected, and fast-xml-parser parses RSS/Atom. Feed links are validated again. HTML/scripts/styles are removed into plain strings, never rendered as HTML. Function responses are no-store and do not add CORS headers. The collection route has a platform IP/domain rate limit; this does not replace the paid operator gate or a global spending budget.

## Evidence and remaining checks

Local automated checks use mocked provider/feed responses, including real-shaped API fields and cryptographically signed test JWTs. They test missing/expired sessions, unauthorized origins, malformed inputs, private network ranges, unsafe feed discovery, XML rejection, sanitized feed bodies, metadata/transcript distinction, no guessed sponsorship, owner-bound signed jobs and run caps. These checks do not prove live Clerk sign-in, deployed Netlify routing, real feed delivery or a successful Apify run.

Recorded implementation check: npm run test -- tests/collection.test.ts passed all 27 tests on 21 October 2026. The whole-project typecheck at this checkpoint reported only the frontend agent's missing lucide brand-icon exports; no collection-code errors were reported. The root agent owns the final integrated build/deployment check. Provider cash spent and generated audio minutes by this work: zero.

The Netlify coding-context tool was called and returned Authentication required. The installed netlify-functions skill was read; the root agent separately fetched the functions context. Modern .mts Request/Response handlers and runtime-only environment variables follow that guidance.

Official documentation checked on 21 October 2026:

- [Apify actor input](https://apify.com/streamers/youtube-scraper/input-schema): bounded results and subtitle/transcription modes.
- [Apify actor output](https://apify.com/streamers/youtube-scraper/output-schema): description text versus inline subtitles[].srt.
- [Run Actor API](https://docs.apify.com/api/v2/actors-runs-post): build, timeout, maxItems and maxTotalChargeUsd semantics.
- [Get Actor run](https://docs.apify.com/api/v2/actor-run-get): server-returned run state and dataset.
- [Clerk manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification): signature/session claim checks and authorized parties.

Next authorized verification is sign-in → public feed refresh → persisted extracted result, followed by an explicitly configured, capped provider check. Until that evidence exists, describe this as implemented and locally tested integration code.
