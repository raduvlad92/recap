# Switch on scheduled briefings and analysis after train 2

**Decision requested.** Approve the staged switches below and a hard **$18 UTC month-to-date commitment stop** across Apify and OpenRouter. The shared $20 ceiling stays in effect. Keep automatic analysis off through November. The earliest proposed activation is after **December 1 at 00:00 UTC**, subject to the budget, scope and quality checks below. This plan authorizes no production change or provider run.

Train 2 must include the queued-hourly expiry and the read-only observer. The earlier baseline had 47 hourly admissions blocked by an expired claim, two slots lost to a release pause and three missing daily cutoffs while daily briefing was disabled. The completed frames produced zero scheduled transcripts. [Root-cause evidence](https://github.com/raduvlad92/recap/blob/48d14c3bae2b1f3b6714bab34c5d0b38bdb5d184/docs/tech/FLOW6-9-ROOT-CAUSE-2026-11-26.md) · [Fixed-window observer](https://github.com/raduvlad92/recap/pull/56)

## Required switches and order

| Order | Control | Start value | Approved end state and readback |
| --- | --- | --- | --- |
| 1 | Train 2 release and $18 admission stop | Last checked baseline `6a794cb`, epoch 10, existing $20 enforcement | Accept the exact train 2 SHA, migration hashes and checkpoint. Verify both Workers have one 100% serving version, the same release and policy values, the old host is fenced and the primary queue consumer is attached. Ship and verify the transaction-level $18 stop before admitting new paid pilot or proof work. |
| 2 | Scheduled transcripts | `APIFY_RUNTIME_ENABLED=true`, `HOURLY_COLLECTION_ENABLED=true` on both Workers. Jobs cron `0 * * * *`. Existing TechLinked-only fallback. | Keep both flags true. Through #46's checked restoration, call `restore_hourly_youtube_pilot_checked` with the current paused revision, accepted epoch/SHA, approved reader and exact channel allowlist. Set `p_recurring=false` for the approved UTC proof date. The list is TechLinked `UCeeFfhMcJa1kjtfZAGskOCA`, ShortCircuit `UCdBK94H6oZT2Q7l0-b0xmMg` and GamersNexus `UChIs72whgZI9w6d6FhwGGHA`. Start early enough to see two distinct scheduled slots before UTC midnight. Require a fresh regular video with an archived transcript from an ordinary scheduled frame, exact supplier and fee receipts, and a second tick without duplicate admission or archive rows. Then restore the same list with `p_recurring=true` under a fresh checked revision. |
| 3 | Automatic analysis | `AUTOMATIC_CONTENT_ENABLED=false` on jobs and web. Existing enabled reader enrollment starts 2026-10-29 and covers older retained items. | Keep it false until December headroom passes and the separately approved #51 ten-video proof produces both acceptable pending drafts for at least nine videos under $0.75. Require representative follow-up and a checked admission limited to the approved reader's exact three channels and fresh regular transcripts acquired under the accepted schedule. Freeze the eligibility instant at activation. Verify that older queued or retained tasks cannot enter that cohort. Then set `AUTOMATIC_CONTENT_ENABLED=true` on both Workers with Jobs cron `*/5 * * * *`; observe two genuine five-minute frames and both review-bound draft types. Keep `CONTENT_ANALYSIS_ENABLED=false` and `KEYWORD_LEARNING_ENABLED=false` on both. |
| 4 | Daily briefing | `DAILY_BRIEFING_ENABLED=false` on jobs and web. Database control and the eligible reader's 08:00 Europe/Berlin schedule are already enabled. | After approved findings are available for the intended period, set `DAILY_BRIEFING_ENABLED=true` on both Workers through checked release operations. Keep the same database schedule and five-minute Jobs trigger. Verify the first natural cutoff has a finished job and an on-time, useful snapshot with original citations. Keep `REMINDER_EMAIL_ENABLED=false`. |

Keep the existing manual review requirement. The $0.75 manifest guard covers its exact proof only. The normal scheduler needs its own checked freshness and source restriction before step 3. Apply flag changes through the normal release and checked restoration path. Reattach the approved pilot to the new release identity when the release changes. Confirm `APIFY_RUNTIME_ENABLED` and the hourly flag on both Workers after each restoration. [Checked pilot and rollback](https://github.com/raduvlad92/recap/blob/68a71c9ea59965e5d4fad2301147bfe8dc84ac21/docs/tech/CHECKED-YOUTUBE-PILOT.md) · [Capped analysis proof](https://github.com/raduvlad92/recap/pull/51) · [Analysis cost model](VIDEO-ANALYSIS-REPLAY-2026-11-26.md)

## Daily projection and stop

Use **committed USD**, which includes settled costs and pending or unknown holds. The November readback was **$9.668564** committed, of which **$4.420027** was unresolved. Adding the full $2.50 collection envelope, the $0.75 proof and $6.70 stress model usage yields **$19.618564**. That fails the $18 stop.

| Line | Base per UTC day | Stress planning per UTC day | Binding limit |
| --- | ---: | ---: | --- |
| Scheduled collection, three channels | Up to $0.075 reserved | Up to $0.075 reserved | $0.020 discovery and $0.005 caption fallback per channel/day; $2.50 envelope, $0.20 reader/day, $3.50 reader lifetime |
| Scheduled model generation and verification | $0.142 | $0.224 | Existing $0.30/task, $0.10/call, $5 model day gate and shared $18 operational stop |
| Daily composition | $0 | $0 | Reads and composes approved findings with zero provider calls |
| **Recurring total** | **$0.217** | **$0.299** | Planning rates only; providers can bill unevenly by day |

Stress is rounded up from $6.70 per 30 days at 36 transcripted videos. For a 31-day December activation, assume the current $4.420027 unresolved balance all carries, the $2.50 collection envelope is held in full on day 0, and the $0.75 proof is reserved on day 0 for planning. Count collection children within that envelope once. Actual rollover amounts and proof settlement require readback.

| UTC point | Increment since previous row | Projected commitment |
| --- | ---: | ---: |
| Day 0, preflight and bounded proof | $4.420027 carried + $2.50 envelope + $0.75 proof | $7.670027 |
| End of day 1 | $0.224 | $7.894027 |
| End of day 2 | $0.224 | $8.118027 |
| End of day 3 | $0.224 | $8.342027 |
| End of day 31 | 28 × $0.224 | $14.614027 |

For activation, compare the **actual** month's committed balance plus any uncounted envelope or proof, plus $0.224 times the remaining UTC days, with $18. Where all 31 days and both allocations remain, the opening balance must be **at most $7.806**. A reservation can consume headroom sooner than the daily average. Raise the $16 existing alert to the PM for a fresh projection. No increase in scope or limits follows from a low readback.

**Enforcement is a release gate.** The current database guard uses $20, and train 2's $0.75 proof guard does not lower the shared admission threshold. A separately reviewed change must enforce $18 within the existing `public.lock_monthly_provider_budget()` transaction on both providers, across worker and operator admission paths. Admit new paid work only when commitment is below $18 and commitment plus the next incremental maximum is at most $18. At $18, also block new billable launches funded by an already-held parent envelope. Continue provider status reads and ordinary settlement of already-started work. Preserve unknown holds and actual charges, including any late amount that exceeds its reservation. Keep free briefing composition available. Verify concurrency, funded children, idempotent replay, late fees and UTC rollover offline before accepting the guard. An alert or periodic read cannot enforce this limit. Until the guard and scoped scheduled admission are accepted, keep the corresponding paid switches closed. [Current monthly budget and alerts](MONTHLY-PROVIDER-BUDGET.md)

## Clock start and restart

- Qualify one useful ordinary 08:00 Berlin cutoff on the accepted release first. Confirm the upcoming observation can contain three genuine cutoffs, at least one useful cited in-window day and full fresh source coverage for any quiet day. Pending review or partial empty days fail. Check the selected reader's entire followed set in the six hours before cutoff. Keep the clock stopped if an incomplete source set cannot yield accepted cited briefings. Complete any manual editorial work before the clock. If needed editorial work or missing coverage would invalidate the trial, defer the start.
- Set a new `T0` after the cutoff grace period, after the last restore, scope change or intervention, and at minute 15 or later within a UTC hour. Record the accepted release SHA, epoch, serving version IDs, scope, budget and UTC timestamp. Set the end to `T0 + 72 hours`. Confirm that all 72 hourly slots and three daily cutoffs mature by that end. Start and end receipts use the same release.
- End the attempt on a release or pause, a settings/scope change, manual recovery or review, a missed hourly deadline, a missing or unusable cutoff, or an $18 stop. Keep the failed interval. Once the PM accepts recovery, obtains another useful genuine cutoff and re-verifies admission and coverage, choose a fresh `T0` and measure all 72 hours from it. Do not combine pieces of separate windows.

## Readback commands

For serving policy, GET Cloudflare account paths `/workers/scripts/therecap-jobs/deployments` and `/workers/scripts/therecap-web/deployments`. Read `/versions/<version_id>` under each script and filter `resources.bindings` to the seven flags in the table, `HOSTING_MODE` and `RELEASE_SHA`. The Jobs `/schedules` endpoint must show `0 * * * *` and `*/5 * * * *`. Resolve the `therecap-jobs` queue through `/queues` and verify its `/queues/<queue_id>/consumers` entry. Fetch `GET https://recap.filternode.dev/api/health` and require active mode, the same release and configured jobs. Preserve the evidence privately without secret values.

Use the approved private SQL connection. The examples below are for `psql`. Replace `from_utc` and `to_utc` with the selected proof or observation bounds. Keep the final observer report private. Run the pilot RPC read only after restoration, when it can prove serving scope.

```sql
\set ON_ERROR_STOP on
\set from_utc '2026-12-02T07:20:00Z'
\set to_utc '2026-12-05T07:20:00Z'
begin read only;
set local timezone = 'UTC';
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select now() as observed_at, current_setting('transaction_read_only') as read_only,
       owner, epoch, paused, release, old_host_fenced, updated_at
from public.hosting_runtime_control where singleton;

select version from supabase_migrations.schema_migrations
where version in ('20261125103322','20261125230323','20261126004139',
                  '20261126010136','20261126032659') order by version;

select public.read_monthly_provider_budget() as monthly_provider_budget;
select public.read_hourly_youtube_pilot() - 'readerId' as serving_pilot;
select pg_get_functiondef('public.require_monthly_provider_capacity(numeric,boolean)'::regprocedure)
       as admission_guard;

select (select enabled from public.daily_briefing_control where id) as database_enabled,
       count(*) filter (where s.enabled) as enabled_reader_schedules,
       max(s.last_cutoff_at) as latest_processed_cutoff
from public.daily_briefing_schedules s;

select key, kind, epoch, release, state, created_at, updated_at,
       lease_token is not null as claimed
from public.hosting_work
where kind in ('hourly-collection','automatic-content','daily-briefing')
  and created_at >= :'from_utc'::timestamptz and created_at < :'to_utc'::timestamptz
  and key like 'cron:%'
order by created_at, kind;

select f.key, count(distinct c.id) as checks_with_new_transcripts,
       count(distinct (a.user_id,a.id)) as regular_transcripts
from public.hosting_work f
join public.reader_collection_checks c
  on c.started_at >= f.lease_until - interval '15 minutes'
 and c.finished_at <= f.updated_at and c.retrieved_count > 0
join public.reader_source_updates a
  on a.user_id=c.user_id and a.source_id=c.source_id
 and a.collected_at between c.started_at and c.finished_at
where f.kind='hourly-collection' and f.state='completed' and f.key like 'cron:%'
  and f.created_at >= :'from_utc'::timestamptz and f.created_at < :'to_utc'::timestamptz
  and a.record->>'contentKind'='transcript' and a.record->>'format'='video'
  and a.record#>>'{videoFormat,kind}'='regular' and length(btrim(a.record->>'content'))>0
group by f.key order by f.key;

select j.cutoff_at, j.state as job_state, j.created_at as job_created_at,
       b.status as snapshot_state, b.created_at as snapshot_created_at,
       b.published_at, jsonb_array_length(b.snapshot->'topics') as topics
from public.daily_briefing_jobs j
left join public.daily_briefings b on b.id=j.id and b.deleted_at is null
where j.cutoff_at >= :'from_utc'::timestamptz and j.cutoff_at < :'to_utc'::timestamptz
order by j.cutoff_at;

rollback;
```

Inspect the verified $18 implementation as deployed, including the lock, both reservation trigger paths and the funded-child refusal. The SQL text and $20 ledger alone cannot prove the $18 settlement and concurrency behavior. Keep exact proof evidence from the checked release. During the bounded model proof, read `public.read_video_analysis_proof(p_id,p_manifest)` with the private approved proof ID and manifest and record its cap, commitment and both task outcomes.

For the scheduled end-to-end check, the [observer](https://github.com/raduvlad92/recap/pull/56) ties archive checks to claimed frames, eligible regular transcripts to the same content hashes and both draft types, and daily citations to the frozen cutoff inventory. Run it after the cutoff and at the end with the exact recorded bounds.

```sh
PGSERVICE=therecap_observer node scripts/flow9-readiness.mjs --start "$T0_UTC" --end "$END_UTC"
```

Require 72/72 hourly frames within 15 minutes, scheduled transcript yield, both valid draft types on at least 90% of the eligible fresh cohort, three genuine accepted cutoffs, no recorded interventions and the separate $18 gate evidence. The observer's original $20 cap verdict is necessary but does not certify the tighter stop.
