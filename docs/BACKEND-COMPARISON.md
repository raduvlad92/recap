# Backend recommendation: Supabase

Assessed: **21 October 2026**. Status: **assistant recommendation, not a founder-selected platform or implementation approval**. This is desk research against the current product requirements and creator-workspace direction, not a performance benchmark or a running backend.

## Recommendation and trade-off

Use **Supabase** as the primary backend. The product accumulates connected history: creators, their platform sources, updates, topics, brands, disclosed sponsors, citations, reader follows and dated recaps. PostgreSQL makes it straightforward to ask new questions across those records and time periods, using standard database/reporting tools. For example: “Which creators mentioned this brand this month, and which originals support that?” This is an architectural judgment about development flexibility, not a claim that Convex cannot store relationships.

Supabase supplies a full [PostgreSQL database](https://supabase.com/docs/guides/database/overview), [full-text search](https://supabase.com/docs/guides/database/full-text-search), and [semantic-search building blocks](https://supabase.com/docs/guides/ai/semantic-search). Account-scoped search, relevance, multilingual quality, permissions and readable exports still require product work. Merely selecting a platform does not deliver those features or add them to the approved scope.

The strongest case for **Convex** is faster delivery through an integrated TypeScript backend: database access, reactive updates and scheduling work closely together. Its [data model supports relationships](https://docs.convex.dev/database/overview); it also has [search](https://docs.convex.dev/search/overview), [exports](https://docs.convex.dev/database/import-export/export), [scheduling](https://docs.convex.dev/scheduling/overview) and a [durable workflow component](https://docs.convex.dev/agents/workflows). It is a sound alternative, especially if rapid TypeScript iteration becomes the deciding factor. Supabase can also support realtime updates and jobs; this is a trade-off in development style and database flexibility, not a capability prohibition.

For therecap, flexible historical analysis and portability receive more weight than Convex's integrated development convenience. That balance could change with an implementing team's strong Convex expertise or evidence that a working pipeline is materially easier there. Neither platform has been benchmarked for this workload, and neither choice establishes rapid growth or scalability on its own.

## Proposed simple operating shape

- Website for onboarding, the daily briefing, creator exploration and dated history.
- Supabase for accounts, structured records, access boundaries and storage/search where appropriate.
- An asynchronous processing pipeline: request collection, record the supplier job, receive results, normalize and deduplicate, analyze permitted reusable content, then assemble each reader's scheduled recap. Supabase [Cron](https://supabase.com/docs/guides/cron) and [Queues](https://supabase.com/docs/guides/queues) are available building blocks; their existence does not prove a completed workflow.
- Keep long browser scraping and audio processing with the collection/transcription supplier or a dedicated worker. Save job identifiers and handle callbacks or short status checks; do not hold one website request open. Both platforms have function/runtime limits: [Supabase](https://supabase.com/docs/guides/functions/limits), [Convex](https://docs.convex.dev/production/state/limits). Retries need duplicate-charge/delivery protection regardless of backend.

Use one primary backend; there is no current reason to combine Convex and Supabase. Exact hosting, worker, authentication, search/index and backup choices belong in the approved architecture work. No services were provisioned and no scheduler was activated.

## Current entry prices, not an operating quote

Official pages checked on 21 October 2026:

| Option | Public starting price | Qualification |
| --- | --- | --- |
| Supabase Free | $0 | Suitable for exploration; free projects can pause after inactivity. |
| Supabase Pro | From $25/month | First project included; $10/month compute credit covers one Micro project. Additional projects, larger compute, extra usage and add-ons can add cost. |
| Convex Free / Starter | Free or $0/month base plus usage | Starter permits pay-as-you-go use beyond included allowances; Professional is not the minimum paid route. |
| Convex Professional | $25/developer/month plus applicable usage | Developer seat price, not a fee per app customer. |

Sources: [Supabase pricing](https://supabase.com/pricing), [Convex pricing](https://www.convex.dev/pricing). No organisation billing configuration or current account entitlement was inspected. Taxes, source collection, AI, transcription, email and other services are outside these entry prices. No workload measurements establish that either backend is cheaper overall. Existing allowance cost scenarios remain conditional and are not replaced by this table.

## Evidence and next action

Reviewed official database, search, scheduling/queue, workflow, runtime and pricing documentation; obtained independent reviews of Convex's strongest case and pricing/operating trade-offs. No app code, runtime test, account access, supplier execution or spending. Actual new external cash: **€0**.

The founder's “I like it” is positive feedback on the preceding vision recommendation. It does not approve every optional sharing/search/change-tracking feature, SPEC/PLAN v1.0, or this backend choice. Record an explicit platform selection when given. Supplier proof remains deferred under D08; the platform recommendation does not reopen it.
