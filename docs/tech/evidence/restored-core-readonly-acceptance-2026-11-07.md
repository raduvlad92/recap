# Restored core: bounded native read-only acceptance

Checked **2026-11-07 23:51:43.393867+00**, serving/main **`182457410f7f8e979348d10347fe50b1e94b295b`**. Observation began 23:25:21 UTC, hard stop 23:55:21 UTC. Metadata check: 2026-11-07T23:51:46.751Z.

Observation ended with that metadata read after 26 minutes 25.751 seconds. Five successful ordinary ticks were proved. The three remaining X jobs are not due to poll until 23:56:04.760748–23:56:07.404819 UTC, beyond the original hard stop; they remain pending without extending this run.

**Native transport: PASS. Useful new content: NOT PROVEN.** 5 new ordinary automatic invocations were recorded; all 96 historical uncertain frames are excluded. No manual production/provider/model action occurred. Existing automation continued under the unchanged policy.

## Native chain

Epoch 4, Cloudflare owner, unpaused, fenced old host; revision `6dcf2afb-d4c7-4e3b-b546-532eb43d543a`. Native Actions run 42423118103 and checkpoint 128559404688 remain successful for this exact head; artifact 13595275488 is unexpired and retains the accepted digest. Both worker versions remain 100% serving. Source pin, flags, original bounded consumer and both crons are unchanged; reminders stay off, DLQ consumers remain absent.

| Registered UTC | Finished UTC | Seconds | State | Message ID SHA-256 |
| --- | --- | ---: | --- | --- |
| 2026-11-07T23:30:55.875927+00:00 | 2026-11-07T23:30:57.84708+00:00 | 1.971153 | completed | `ed7c82023cc9a0ebae89338c56b0c181beba96e54c03119d45eb1046896d94d1` |
| 2026-11-07T23:35:55.518935+00:00 | 2026-11-07T23:35:57.33908+00:00 | 1.820145 | completed | `8b726a27bd94930adcb04fb066918653acf4065431ec052bbbd79a9614c081ee` |
| 2026-11-07T23:40:57.08793+00:00 | 2026-11-07T23:40:59.33518+00:00 | 2.24725 | completed | `79e2483cccc7a04c8d694f1c4a0c47af8a00a6ac83aef735599e115dd12890b1` |
| 2026-11-07T23:45:55.657393+00:00 | 2026-11-07T23:45:57.558252+00:00 | 1.900859 | completed | `a29cd2da4906065898d8b9d418b003052b7b592bddf84ad4ce7c1e654846d96a` |
| 2026-11-07T23:50:55.22437+00:00 | 2026-11-07T23:50:56.950336+00:00 | 1.725966 | completed | `00efdbb77d4fd59ccfdd9b56c26da1e39ba90483372b65e54277597c8eaf994f` |

Each native message ID is persisted by the accepted worker via `begin_automatic_hosting_queue_work`. Exact key, current revision, release, epoch, token, immutable frame fields, null payload, running registration, 17-minute bound and finish-before-both-deadlines comparisons all pass for the completed invocations. The native begin/finish routine bodies exactly match the reviewed migration. Raw IDs, frames and tokens are retained only in the ignored receipt directory. This proves ordinary queue transport/completion, not model generation or interruption recovery.

## Useful-content qualification

New attempt records: **78**. New reader archive rows: **0**. New social item rows: **0**. New model calls: **0**. Methods/statuses below are retrieval telemetry, not source coverage.

| Platform | Method | Status | Error | Attempts |
| --- | --- | --- | --- | ---: |
| Instagram | `instagram_apify_dataset` | empty | - | 2 |
| Instagram | `instagram_apify_dataset` | partial | - | 6 |
| Instagram | `instagram_apify_diagnostics` | blocked | - | 8 |
| Instagram | `instagram_apify_launch` | partial | - | 6 |
| Instagram | `instagram_apify_poll` | partial | - | 6 |
| Instagram | `instagram_apify_poll` | succeeded | - | 8 |
| Instagram | `instagram_apify_preflight` | succeeded | - | 6 |
| Instagram | `instagram_apify_validation` | empty | - | 8 |
| Instagram | `instagram_public_page` | failed | source_transport_failed | 6 |
| Instagram | `instagram_public_profile` | failed | source_unavailable | 6 |
| X | `x_apify_dataset` | empty | - | 1 |
| X | `x_apify_diagnostics` | succeeded | - | 1 |
| X | `x_apify_launch` | partial | - | 3 |
| X | `x_apify_poll` | partial | - | 3 |
| X | `x_apify_poll` | succeeded | - | 1 |
| X | `x_apify_preflight` | succeeded | - | 3 |
| X | `x_apify_validation` | empty | - | 1 |
| X | `x_public_timeline` | failed | source_unavailable | 3 |

Attempt counts by platform: `{"Blog":0,"Instagram":62,"LinkedIn":0,"Podcast":0,"Substack":0,"X":16,"YouTube":0}`. No hourly YouTube tick falls inside this window.

Exact observed failures: six Instagram profile attempts returned HTTP404, six public-page attempts failed with `source_transport_failed`, and three X public-timeline attempts returned HTTP429. Eight Instagram jobs ultimately reported `provider_blocked`; all 16 returned rows were rejected outside their exact requested windows. The one settled X job returned no rows. No accepted item exists on which to claim new underlying text, captions or exact-item/date coverage.

| Platform | State | Source SHA-256 | Requested window start | Requested window end | Accepted | Reported USD |
| --- | --- | --- | --- | --- | ---: | ---: |
| Instagram | failed | `d6d902f521c1ac96a99e5c950216fb88a032109b4104626bf42037f013f30673` | 2026-11-06T22:14:59.761888+00:00 | 2026-11-07T22:14:59.761888+00:00 | 0 | 0.001 |
| Instagram | failed | `162f542aed663f598a68827566fe12a9b755ece134d99c20d8566d465ef85ef0` | 2026-11-06T22:15:00.11711+00:00 | 2026-11-07T22:15:00.11711+00:00 | 0 | 0.0022 |
| Instagram | failed | `628a16c0fa3945a8c3043fa4deebe99c37466eef58f8fb07248e393248c90066` | 2026-11-06T23:31:01.907999+00:00 | 2026-11-07T23:31:01.907999+00:00 | 0 | 0.0046 |
| Instagram | failed | `ad5d3fe13f5d01f792f183f3730217d1b11686d9bcfdaeda0fe187359b618456` | 2026-11-06T23:31:02.396762+00:00 | 2026-11-07T23:31:02.396762+00:00 | 0 | 0.001 |
| X | completed | `b184ddb3865c6b5d7e90684f1dd293f11174fbdea7b77ef4787477a2146d12b4` | 2026-11-07T15:15:25.82138+00:00 | 2026-11-07T22:15:00.313408+00:00 | 0 | 0.00008175482 |
| Instagram | failed | `b56c42392df9ddb2ad0970eeeec8d05c595b9386ddba9726951a8a30c7e9be9e` | 2026-11-06T23:31:01.956665+00:00 | 2026-11-07T23:31:01.956665+00:00 | 0 | 0.0046 |
| Instagram | failed | `78d2e8fde711c2c5b06e593a2666825a84b4bfa70f57cc4b4b0858615c4aa463` | 2026-11-06T23:41:04.090512+00:00 | 2026-11-07T23:41:04.090512+00:00 | 0 | 0.0046 |
| X | running | `a2b894aca150934c1cfe65f30fb1481dc8371206aa17cea8b2411acde2c0401c` | 2026-11-06T23:51:01.787792+00:00 | 2026-11-07T23:51:01.787792+00:00 | 0 | unknown |
| Instagram | failed | `ed6e6388df6a7e941363d4236ab7a0ec1134edae7448fc20f87a0af5134a76b2` | 2026-11-06T23:41:04.271769+00:00 | 2026-11-07T23:41:04.271769+00:00 | 0 | 0.0046 |
| X | running | `59a4fc13625eb10c834b5d4600b15f0ecc8c3b7b2134e9dd66693da05af6de42` | 2026-11-06T23:51:01.52108+00:00 | 2026-11-07T23:51:01.52108+00:00 | 0 | unknown |
| Instagram | failed | `8ef31c1d6dea679a5425ebb1c5c50500059d071f3f1c80f29474c5909aedcdc3` | 2026-11-06T23:41:03.807977+00:00 | 2026-11-07T23:41:03.807977+00:00 | 0 | 0.0046 |
| X | running | `5c94a268e1844aba03611ebcb3aa51e5a35e638af670facf8d48d1be4b258068` | 2026-11-06T23:51:04.950858+00:00 | 2026-11-07T23:51:04.950858+00:00 | 0 | unknown |

Ordinary jobs retain exact source identities and requested date windows privately. Empty data, blocked requests and rejected out-of-window rows remain negative/partial evidence; accepted content is not inferred from provider success or raw result counts. Pending jobs and unknown fees stay pending. No manual collection was used to create proof.

## Preservation, privacy and money

All **19 original source reservation full rows**, **seven original unknown model full rows**, and **three workspaces** remain exact using native PostgreSQL comparisons/hashes. Six budget/policy table hashes match the post-core baseline. Source ceiling USD45; model USD10 lifetime/USD5 day/USD0.10 call unchanged. Model commitment is USD9.918486404, with seven unknown calls. The model remainder cannot admit the next USD0.10 automatic step; unchanged existing blocked tasks are not successful generation.

The original USD0.004 correction still has one receipt and matching reservation/job/ledger projections; original history and unrelated fields remain exact. Prior replay verification was read, never rerun. Observed ordinary social jobs settled USD0.02728175482; this is separate from the earlier correction and from manual acceptance work. New-reservation counts/holds: `{"count":9,"heldMaximumUsd":"0.15","settledActualUsd":"0.0240","unknownCount":3}`. Charges still unknown are not zeroed.

Attempt/invocation tables retain RLS, no public-reader policies, no anon/authenticated SELECT; begin/finish EXECUTE is denied to both. Actual anonymous database GETs return 401/42501, anonymous admin GET401, public worker GET404. The initial invalid-column invocation-table probe returned400 and is excluded; corrected-field requests provide the denial evidence.

Last native work counts: `{"expired_running":0,"queued":0,"running":0,"uncertain":96}`. No cap/flag/source/review/workspace change, retry, provider request, queue pull/purge/replay, email or main change was made by this observer. No new generation, ready-recap or broad content-coverage claim follows.

Private receipt: `.local/native-acceptance-20261107/acceptance-receipt.json` in this checkout, mode0600. Its raw-evidence inventory records hashes of every native snapshot. Parent can continue rollout with transport acceptance separated from unresolved content outcomes.
