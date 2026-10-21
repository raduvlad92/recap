# recap tech collector

Private Apify Actor for the explicitly authorized D22 public tech-source backfill. It orchestrates reviewed, pinned providers; it is not a general web crawler. Creating or building this project does not run collection. No schedule, subscription, AI call, generated transcript or Supabase credential is included.

## Operator handoff

Prepare a JSON inventory containing `sources: [{ id, name, url, platform, channelId?, aliases? }]`. Identity research supplies the exact channel URLs, optional directly observed YouTube channel IDs and official aliases. Studios and presenters are not inferred from post mentions. Only YouTube, X and Instagram are accepted. Keep the explicit inventory separate from a claim that every related account has been found.

`node scripts/tech-backfill-input.mjs --sources <inventory.json> --output <ignored-input.json>` prepares the last 30 UTC days offline. Execution defaults false. `--execute --reservation <opaque-reservation-id>` changes that input only; it does not launch a job. Reserve the whole envelope in the application budget ledger before an operator starts this private Actor. Never put a reader email, private account ID or token in the input.

The parent must be launched with API `memory=256`, `timeout=3600` and `maxTotalChargeUsd=2` (or a lower positive cap matching `parentMaxChargeUsd`). The combined input ceiling is at most $45; $2 is reserved for parent compute/storage and the rest is available for child reservations. The input ceiling does not raise account quotas or buy a plan. Stop and report partial coverage if account credit or any cap is exhausted.

## Reviewed providers

Read-only public Actor/build metadata, input schemas, output schemas and the effective pricing record were retrieved on 21 October 2026 and are saved in [reviewed-metadata.json](providers/reviewed-metadata.json). A cloud run rechecks the effective pricing fingerprint and pinned build before a child request. It refuses monthly-rental/changed pricing. An operator must review and rebuild before accepting provider changes.

| Platform | Actor | Pinned build | Conservative reservation |
| --- | --- | --- | --- |
| YouTube | `streamers/youtube-scraper` | `0.0.319`, `kOLogYtrERZU9YfGW` | $0.004 per video + $0.0013 per dated result; Free rates |
| X | `apidojo/twitter-scraper-lite` | `0.0.1037`, `yaoXYYsyMoS92pVsj` | $0.016 one-query charge + $0.0004 per allowed item, including a conservative reservation for the included first approximately 40 |
| Instagram | `apify/instagram-scraper` | `0.0.827`, `f15AnzQQyjtSsCgl0` | $0.0027 per public post record; Free rate |

One serial child run per source preserves attribution. For X it keeps the smallest batch tier; YouTube/Instagram pricing is per delivered record rather than per channel batch. The date filters are provider inputs and are independently enforced against returned UTC dates. YouTube divides the per-source allowance among regular videos, Shorts and streams; individual format caps appear in coverage. A capped tab is not a complete month. No paid transcription, AI enrichment or media download option is enabled. Existing YouTube subtitles are requested inline; missing subtitles remain metadata-only. Instagram captions and X public post text are text coverage, not media transcripts or linked-article bodies.

## Spending, failures and resumption

`CHECKPOINT` in the parent run's default key-value store records an immutable input fingerprint, parent run ID and each worst-case child reservation **before** the non-idempotent launch request. Each child launch has its own API dollar cap, pinned build number, 1GB memory and ten-minute timeout. The parent cap covers its own platform charges; children are separately reserved inside the combined ceiling. The API documents `maxTotalChargeUsd` across pricing models. The application must still reserve against other concurrent/root runs; this Actor's KVS is not a cross-run transactional budget database.

After a terminal child, authenticated `usageTotalUsd` is the reported charge. Missing costs remain null, and their full reservation stays committed. A reported zero is distinct from an unavailable charge. This does not establish the app's total operating cost. A response-lost start keeps its reservation and is not retried; an operator must reconcile it. A resumed same-run checkpoint polls recorded child IDs and never starts an ambiguous submission again. Different input/run IDs cannot reuse this checkpoint. Provider build mismatches are aborted and never ingested.

`OUTPUT` is the authoritative `{manifest, coverage, updates}` JSON record. Every normalized update uses the app's `SourceUpdate` fields, real original link, source ID and explicit content level. It contains no AI-written topics, brands, sponsors or invented presenters. Coverage includes provider status, earliest observed date, cutoff evidence, rejected dates/identities, caps, content levels, actual run/build references and reported/unknown costs. **`complete` remains false**: neither success nor a short result set proves exhaustive public-platform history.

The default dataset contains `recordType: source-update`, `coverage` and `manifest` records. Final publication is checkpointed. If dataset publication is interrupted, it is not blindly replayed; use canonical KVS OUTPUT and its publication warning. Upstream provider datasets can contain additional raw fields; they are not copied into our normalized dataset. Raw-input retention and upstream deletion remain application/operator responsibilities.

## Local checks and primary documentation

`npx vitest run tests/tech-collector.test.ts` uses mocks only. `npm ci --ignore-scripts` and `npm run check` inside this folder install/check the runtime package without launching it. A local check, cloud build and actual extraction are separate evidence.

Primary references: [run limits and build-number API](https://docs.apify.com/api/v2/actors-runs-post), [resource limits](https://docs.apify.com/actors/running/usage-and-resources), [YouTube input](https://apify.com/streamers/youtube-scraper/input-schema), [YouTube output](https://apify.com/streamers/youtube-scraper/output-schema), [X input](https://apify.com/apidojo/twitter-scraper-lite/input-schema), [Instagram input](https://apify.com/apify/instagram-scraper/input-schema). Exact per-platform pricing URLs are saved in the metadata and run manifest.
