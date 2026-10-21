# Tech collection — scoped D22 delivery plan

Requested 21 October 2026. Create an editable source collection named **tech** for the founder's specified account, research and follow all official public LTT/LMG channels, Marques Brownlee properties and GamersNexus properties. Prioritize YouTube, including the relevant public video formats; include official X and Instagram accounts where evidenced. The signed-in homepage should show the creator/group hierarchy, actual channels and collected items published during the preceding 30days, with original links and explicit gaps. Keep private account identifiers/email out of Git.

This request reopens collection for this bounded tech slice; it does not authorize unrelated catalogue-wide collection, a recurring schedule, a new supplier subscription, customer outreach or an increased budget. The existing global **€50 total /150 generated-transcription minutes** ceiling remains an upper bound. First use existing public captions; account for actual supplier charges and reservation/stop behavior before execution. Paid AI synthesis is a separate scope/budget and is not needed merely to show source items.

## Readiness checkpoint

- Existing recap app, Supabase and Clerk access are available; the backend target is unchanged.
- Exact verified-email lookup found no app account for the specified identity. A Clerk dashboard login is separate from an app signup. The founder needs to sign up/sign in to the live app once so the private collection can be bound to the correct actual user; do not create an impersonated verified owner account or overwrite another reader's workspace.
- No Apify API token, pinned build or collection signing secret is currently configured locally or in the hosted runtime. The shared T3 browser opened the Apify Console sign-in page. An authenticated provider connection has not been established; another browser's saved login is not yet verified. App-generated signing secrets and build selection are assistant-owned work, not a token checklist for the founder.
- The current YouTube adapter is deliberately capped at five items and excludes Shorts/streams. It must be expanded or replaced for a dated backfill. Existing source rows and fixture creator navigation are not a named, persistent researched collection.
- Initial primary-site research confirms several LMG YouTube properties and LTT social accounts, four Marques YouTube properties with main X/Instagram, and GamersNexus YouTube/X. Complete the channel inventory from primary cross-links, keeping unresolved and historical accounts explicit. No creator content has been backfilled at this checkpoint.

## Tracked work

| ID | Deliverable | State |
| --- | --- | --- |
| TECH01 | Primary evidence for every official brand channel and supported format | In progress; see CHANNEL-RESEARCH.md when available |
| TECH02 | Actual founder app identity and authenticated Apify account/connection | Access steps pending |
| TECH03 | Persistent editable tech collection, real creator/source binding and homepage navigation | Planned |
| TECH04 | Private Apify Actor, reviewed supplier modules, date pagination, deduplication and durable aggregate budget stop | Planned; local code can be prepared without provider access |
| TECH05 | Capped 30-day backfill, persistence and per-source coverage/error/cost report | Not run |
| TECH06 | Deployed signed-in homepage proof, private-account isolation and durable handoff | Pending actual collection; no fixture or metadata-only pass |

## Acceptance

The founder's verified account sees the named collection on the homepage after a reload, with real creator/channel groupings and dated original-linked content from the last 30days. Pagination must reach the cutoff or report that source's incomplete coverage; caps/errors must never be silently represented as a complete month. No title/description is called a transcript or full-content analysis. Missing/private/deleted content remains explicitly unavailable. Publish the reviewed Actor privately; no public Actor Store release or automatic schedule is implied.
