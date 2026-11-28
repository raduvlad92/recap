#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const hour = 3_600_000;
const grace = 15 * 60_000;
const iso = value => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value ?? '') || !Number.isFinite(Date.parse(value))) {
    throw new Error('Expected UTC ISO timestamps ending in Z.');
  }
  return new Date(value).toISOString();
};

export function watchPlan([start, release, epoch, previousCutoff, ...cutoffs], readerId) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(readerId ?? '') || !/^[a-f0-9]{40}$/.test(release ?? '') ||
      !/^[1-9]\d{0,14}$/.test(epoch ?? '') || cutoffs.length < 2 || cutoffs.length > 4) {
    throw new Error('Expected a reader ID, full release SHA, epoch and two to four scheduled UTC cutoffs.');
  }
  const startedAt = iso(start), endsAt = new Date(Date.parse(startedAt) + 72 * hour).toISOString();
  const boundaries = [previousCutoff, ...cutoffs].map(iso);
  const windows = boundaries.slice(1).map((cutoffAt, index) => ({ periodStart: boundaries[index], cutoffAt }));
  for (const { periodStart, cutoffAt } of windows) {
    const duration = Date.parse(cutoffAt) - Date.parse(periodStart);
    if (cutoffAt <= startedAt || cutoffAt > endsAt || duration < 20 * hour || duration > 28 * hour) {
      throw new Error('Expected consecutive local cutoffs after the start and within 72 hours.');
    }
  }
  if (boundaries[0] > startedAt || Date.parse(endsAt) - Date.parse(boundaries.at(-1)) >= 28 * hour) {
    throw new Error('Supply the cutoff immediately before the start and every cutoff within the observation.');
  }
  return { readerId, release, epoch, startedAt, endsAt, windows };
}

export function watchQuery(plan) {
  const { readerId, release, epoch, startedAt, windows } = watchPlan(
    [plan.startedAt, plan.release, plan.epoch, plan.windows[0].periodStart, ...plan.windows.map(w => w.cutoffAt)], plan.readerId);
  const times = windows.map(w => `('${w.periodStart}'::timestamptz,'${w.cutoffAt}'::timestamptz)`).join(',');
  return `begin read only;
set local statement_timeout='12s';
with windows(period_start,cutoff_at) as (values ${times}),
reader as (
  select w.user_id, w.state#>>'{settings,timezone}' timezone, w.state#>>'{settings,deliveryTime}' delivery_time,
    s.enabled and p.enabled schedule_enabled, greatest(s.starts_at,s.settings_changed_at) schedule_changed_at
  from public.reader_workspaces w join public.daily_briefing_schedules s on s.reader_id=w.user_id
  join public.reader_collection_policies p on p.user_id=w.user_id where w.user_id='${readerId}'
),
daily as (
  select d.*,r.timezone,r.delivery_time,r.schedule_enabled,r.schedule_changed_at,
    (select coalesce(jsonb_object_agg(status,n),'{}') from (
      select c.status,count(*) n from public.reader_collection_checks c
      where c.user_id=r.user_id and c.finished_at > d.period_start and c.finished_at <= d.cutoff_at group by c.status
    ) x) source_checks,
    (select jsonb_build_object('items',count(*),'usable',count(*) filter(
      where a.record->>'contentKind' in ('transcript','feed_text') and length(btrim(a.record->>'content'))>0))
      from public.reader_source_updates a where a.user_id=r.user_id and a.collected_at > d.period_start and a.collected_at <= d.cutoff_at
    ) ingestion,
    (select coalesce(jsonb_object_agg(kind || ':' || status,n),'{}') from (
      select task.kind,task.status,count(*) n from (
        select 'video' kind,t.state status,t.user_id,t.updated_at from public.automatic_content_tasks t
        union all select 'social',t.state,t.user_id,t.updated_at from public.social_content_tasks t
      ) task where task.user_id=r.user_id and task.updated_at > d.period_start and task.updated_at <= d.cutoff_at
      group by task.kind,task.status
    ) x) analysis_current_states,
    (select coalesce(jsonb_object_agg(kind || ':' || status,n),'{}') from (
      select v.kind,v.status,count(*) n from public.admin_analysis_reviews v
      where v.user_id=r.user_id and v.updated_at > d.period_start and v.updated_at <= d.cutoff_at group by v.kind,v.status
    ) x) review_current_states,
    (select coalesce(jsonb_object_agg(kind || ':' || state,n),'{}') from (
      select h.kind,h.state,count(*) n from public.hosting_work h where h.release='${release}' and h.epoch=${epoch}
        and h.kind in ('hourly-collection','automatic-content','social-collection','social-content','daily-briefing') and h.key like 'cron:%'
        and h.created_at >= greatest(d.period_start,'${startedAt}'::timestamptz)
        and h.created_at < d.cutoff_at + interval '15 minutes' group by h.kind,h.state
    ) x) scheduled_frames,
    (select count(*) from public.hosting_work h where h.release='${release}' and h.epoch=${epoch}
      and h.kind='daily-briefing' and h.state='completed'
      and case when h.key ~ '^cron:daily-briefing:[0-9]+:[0-9]{1,12}$' then
        to_timestamp(split_part(h.key,':',4)::bigint*300) between d.cutoff_at and d.cutoff_at + interval '10 minutes'
      else false end
      and h.created_at >= d.cutoff_at and h.updated_at <= d.cutoff_at + interval '15 minutes'
    ) completed_cutoff_frames,
    j.state job_state,
    (select jsonb_build_object('period_start',b.period_start,'status',b.status,'published_at',b.published_at,'created_at',b.created_at,
      'topics',jsonb_array_length(b.snapshot->'topics'),'coverage',(b.snapshot->'coverage')-'sources'::text,
      'source_checks', (select coalesce(jsonb_object_agg(state,n),'{}') from (
        select s->>'state' state,count(*) n from jsonb_array_elements(b.snapshot#>'{coverage,sources}') s group by 1
      ) x),
      'failure_code',b.snapshot->>'failureCode')
     from public.daily_briefings b where b.reader_id=r.user_id and b.cutoff_at=d.cutoff_at and b.deleted_at is null
     order by b.created_at desc limit 1) briefing
  from windows d left join reader r on true
  left join public.daily_briefing_jobs j on j.reader_id=r.user_id and j.cutoff_at=d.cutoff_at
)
select jsonb_build_object('observed_at',now(),'read_only',current_setting('transaction_read_only')='on',
 'control',public.read_hosting_runtime(),'budget',public.read_monthly_provider_budget(),
 'daily_enabled',(select enabled from public.daily_briefing_control where id),
 'cutoffs',(select jsonb_agg(to_jsonb(daily) order by cutoff_at) from daily));
rollback;`;
}

export function dailyWatchReport(plan, evidence) {
  const observedAt = Date.parse(evidence.observed_at);
  if (evidence.read_only !== true || !Number.isFinite(observedAt) || !Array.isArray(evidence.cutoffs) ||
      evidence.cutoffs.length !== plan.windows.length) throw new Error('Read-only observation is missing or incomplete.');
  const alerts = [];
  const control = evidence.control;
  if (!control || control.owner !== 'cloudflare' || control.paused !== false || control.old_host_fenced !== true ||
      control.release !== plan.release || String(control.epoch) !== plan.epoch) alerts.push('hosting_scope_changed_or_paused');
  if (evidence.daily_enabled !== true) alerts.push('daily_database_gate_disabled');
  if (!evidence.budget || evidence.budget.paused !== false) alerts.push('shared_provider_budget_unavailable_or_paused');
  const cutoffs = evidence.cutoffs.map((entry, index) => {
    const expected = plan.windows[index];
    const cutoff = Date.parse(entry.cutoff_at);
    if (cutoff !== Date.parse(expected.cutoffAt) || Date.parse(entry.period_start) !== Date.parse(expected.periodStart)) {
      throw new Error('Unexpected observed window.');
    }
    const due = observedAt >= cutoff + grace;
    const issues = [];
    if (entry.schedule_enabled !== true || Date.parse(entry.schedule_changed_at) > Date.parse(plan.startedAt)) {
      issues.push('reader_schedule_missing_disabled_or_changed');
    }
    if (due) {
      if (!entry.completed_cutoff_frames) issues.push('no_completed_scheduled_daily_frame');
      if (!Object.entries(entry.scheduled_frames).some(([key, count]) => /^(hourly|social)-collection:completed$/.test(key) && count > 0)) issues.push('no_completed_ingestion_frame');
      if (entry.job_state === 'failed' || entry.briefing?.failure_code) issues.push('daily_generation_failed');
      else if (!entry.briefing || entry.job_state !== 'finished') issues.push('daily_snapshot_missing_or_unfinished');
      else {
        const briefing = entry.briefing;
        if (Date.parse(briefing.period_start) !== Date.parse(expected.periodStart) ||
            Date.parse(briefing.created_at) < cutoff || Date.parse(briefing.created_at) > cutoff + grace) issues.push('daily_snapshot_outside_window_or_late');
        if (briefing.status === 'awaiting_review') issues.push('no_approved_daily_output');
        if (briefing.status === 'quiet' && (briefing.coverage?.availableUpdates !== 0 ||
            !briefing.coverage?.followedSources || briefing.coverage.checkedSources !== briefing.coverage.followedSources)) issues.push('quiet_without_complete_coverage');
        if (briefing.status !== 'quiet' && briefing.status !== 'awaiting_review' && (!briefing.published_at || !briefing.topics)) issues.push('daily_topics_or_publication_missing');
      }
      if (entry.ingestion?.usable > 0 && !Object.keys(entry.analysis_current_states).length &&
          !Object.keys(entry.review_current_states).length) issues.push('usable_archive_without_observed_analysis_activity');
    }
    return { ...entry, due, alerts: issues };
  });
  const complete = observedAt >= Date.parse(plan.endsAt) && cutoffs.every(day => day.due && day.alerts.length === 0) && alerts.length === 0;
  return { started_at: plan.startedAt, ends_at: plan.endsAt, release: plan.release, epoch: plan.epoch,
    observed_at: evidence.observed_at, read_only: true, complete, alerts, budget: evidence.budget, control, cutoffs };
}

if (import.meta.main) {
  try {
    const plan = watchPlan(process.argv.slice(2), process.env.DAILY_WATCH_READER_ID);
    const response = execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-w'], {
      input: watchQuery(plan), encoding: 'utf8', timeout: 20_000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const report = dailyWatchReport(plan, JSON.parse(response));
    console.log(JSON.stringify(report, null, 2));
    if (report.alerts.length || report.cutoffs.some(day => day.alerts.length)) process.exitCode = 2;
  } catch (error) {
    console.error(error.code || 'daily_watch_unavailable',
      'Use a configured read-only PostgreSQL connection and pass STARTED_AT RELEASE_SHA EPOCH PREVIOUS_CUTOFF CUTOFF [CUTOFF ...].');
    process.exitCode = 1;
  }
}
