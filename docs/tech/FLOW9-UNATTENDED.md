# Therecap unattended readiness score

The observer scores V1 Flow 6 (three genuine daily cutoffs) and Flow 9 (72 hours unattended) from retained production evidence. Run it after the release trains and checked restoration. Take the start from the accepted release receipt after the initial useful, approved cutoff. A live briefing or recovery run needs its own authorization.

## Run the observer

Use Node 22. For the default last 72 hours, omit `--start`. For a release observation, supply the recorded UTC start. Custom windows are bounded to seven days. For a fixed, past observation, supply both `--start` and `--end` in UTC. Health, policy and monthly budget remain readbacks at execution time. Mutable receipts reflect their retained state at execution time.

```sh
PGSERVICE=therecap_observer node scripts/flow9-readiness.mjs --start "$OBSERVATION_START_UTC"
```

The PostgreSQL connection must support reads of the private observation tables and the existing service-only budget snapshot function. Alternatively, supply the approved Supabase Management credential as `FLOW9_SUPABASE_TOKEN` in the private process environment. The Management API's restricted read-only role was denied execution of the budget function in this project. Both transports send a fixed SQL batch with `BEGIN READ ONLY`, bounded lock and statement timeouts, and `ROLLBACK`. The scorer requires readback of `transaction_read_only=on`. No PostgreSQL privileges need to change. [Supabase SQL endpoint](https://supabase.com/docs/reference/api/v1-run-a-query)

Public reads are limited to anonymous GETs of `/api/health` and `/` at `recap.filternode.dev`. Neither credentials nor private reader IDs, titles, citations, review text, or tokens are printed. Reader numbers are local to each result. A 429, 5xx or transient network error gets one retry. Exit `0` means both flows passed, `2` means one or both flow verdicts failed, and `1` means the observation could not run. The JSON includes evidence for every criterion. Keep the release receipt and start and end reports for handoff.

## How the score works

| Criterion | Required evidence |
| --- | --- |
| Flow 6 · Schedule | Database control and each eligible reader schedule are enabled, with valid timezone and cutoff settings. Current settings only establish cutoffs from their recorded start or latest change. |
| Flow 6 · Three cutoffs | At least three genuine cutoffs for each eligible reader. The score derives cutoffs in the selected window from local wall time, including the first repeated time or next valid time at DST. It matches the exact current and previous cutoff, the persisted job and snapshot, and a completed cron frame within 15 minutes. A cutoff still inside the grace window is pending. |
| Flow 6 · Timely, honest output | Each matured cutoff has an accepted snapshot. A quiet day needs complete, nonempty source coverage and no updates. A published partial day can pass with useful cited topics. Held, failed, missing, forced and late snapshots fail the acceptance check. |
| Flow 6 · Cited value | At least one genuine useful day for every scored reader. Each useful day has one to five topics. Every claim has a quote and a source citation whose item ID, HTTPS URL and publication timestamp match the frozen update inventory. |
| Flow 9 · Duration and release | At least 72 hours. Public health and home answer on the active application, current control stayed on the same epoch and release, and the persisted cron frames agree with that scope. |
| Flow 9 · Ingestion cadence | The hourly scheduler is currently enabled and the window contains at least 72 matured UTC hours, each with a completed frame within 15 minutes. An overdue non-completed frame or a failed scheduled source check fails the criterion. Partial and intentionally blocked source checks are shown separately. |
| Flow 9 · Transcript yield | At least one new archived transcript attributable to the scheduled path. The report keeps source check counts, reported new items and archive readback distinct. |
| Flow 9 · Analysis | At least one completed automatic analysis frame and valid recap **and** keyword drafts for at least 90% of the fresh scheduled cohort of regular videos with transcripts. Zero eligible videos yields an unknown percentage and fails the gate. The separate draft percentage counts structurally valid proposals against all saved proposal rows observed. |
| Flow 9 · Budget | The application's ledger snapshot for each touched UTC month is within the $20 combined Apify and OpenRouter cap, including unresolved commitments. OpenRouter call counts, recorded window charges and unknown-cost counts appear separately. |
| Flow 9 · Continuity | Flow 6 passes and there are no observed interventions or unattributed activities. The observer checks non-cron work, unmatched collection, archive, model and cutoff records, administrative mutations, identity events and explicit fee receipts. Known audit rows for read-only admin views are excluded. |

The hourly result includes each expected slot and the retained cron frame key, timestamps and outcome. The observer reports an admitted frame without a lease as unclaimed. An uncertain frame with a lease records an unknown outcome after claim. A slot without a frame requires independent release or scheduler evidence to explain its absence.

The saved transport schema has no common invocation ID on every source check, archive item or daily snapshot. Hourly checks must be inside a completed frame's actual lease interval, starting at its claim rather than its queue admission. For hourly archives the scorer matches reader and source, the exact enclosing source-check interval, and a positive recorded retrieval count. Social deliveries can be tied to their stored source job. Daily and analysis attribution uses the exact persisted timestamps and scheduled frames. A time match is operational evidence and cannot detect a concurrent, unlogged direct write. Unmatched events fail continuity and can represent either manual work or missing attribution. The scorer reports them separately so counts from overlapping signals are never added as a count of unique actions.

Draft checks revalidate frozen source hashes, review provenance, bounded nonempty recap points, exact quote support, and literal keyword mentions. The paired-video gate uses the current archived content hash. A structurally valid proposal says nothing about independent editorial verification or publication. Budget values are ledger readbacks as of the observation. Public health is an end-of-window sample. A pass does not recreate telemetry that was never recorded.

## Production baseline · 26 November 2026

Window **23 Nov 02:22:54.563573 UTC to 26 Nov 02:22:54.563573 UTC**, exactly 72 hours. The query reported a read-only transaction. Public health and home returned 200. Production served `6a794cb` at epoch 10 and the control record changed inside the window. A separate read of the active Cloudflare versions verified hourly collection on, automatic analysis off and daily briefing off on both Workers.

| Flow | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 6 | Schedule in the database | PASS | One enabled schedule at 08:00 Europe/Berlin. |
| 6 | Three genuine cutoffs | FAIL | 23, 24 and 25 November at 07:00 UTC were due. All three were missing. |
| 6 | Timely and honest output | FAIL | 0/3 accepted snapshots. |
| 6 | Useful cited output | FAIL | 0 topics and 0 citations across the expected cutoffs. |
| 9 | 72 hours elapsed | PASS | Exactly 72 hours. |
| 9 | Active unchanged release | FAIL | Current health passed. The restoration changed the hosting control inside the window. |
| 9 | Ingestion cadence | FAIL | 70 hourly frames, 23 completed and 47 retired without a claim. 23/72 hourly slots met the deadline. The 897 matched source checks included 23 partial, 874 blocked or unsupported, and zero failed. |
| 9 | Scheduled transcript yield | FAIL | Zero new items reported by the matched checks and zero scheduled archive additions or transcripts. Six archive additions had no scheduled attribution. |
| 9 | Analysis quality | FAIL | 218 observed analysis tasks and 3,406 proposal rows. 3,197 were structurally valid (93.86%). Zero jobs matched a completed scheduled analysis frame and no fresh scheduled video cohort qualified. The paired-video percentage is unknown. |
| 9 | $20 monthly cap | PASS | $9.668564441061 committed, including $4.420027191 unresolved. November recorded Apify and OpenRouter amounts were $3.315732458061 and $1.932804792. The window recorded 1,168 model calls, $1.283637962 in known model charges and 20 unknown costs. |
| 9 | Daily cutoffs | FAIL | Flow 6 failed. |
| 9 | No observed intervention | FAIL | One non-cron frame, 39 off-schedule source checks, six unattributed archive additions, 218 off-schedule analysis jobs, 1,168 model calls without scheduled attribution, two fee receipts, and zero audited admin mutations. |

**Flow 6 FAIL. Flow 9 FAIL.** The calls, archive additions and charges are history read by the observer. This lane started no jobs or providers, made no production writes, and incurred $0.
