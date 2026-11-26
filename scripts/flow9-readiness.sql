begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
set local timezone = 'UTC';

with bounds as materialized (
  select coalesce(__FLOW9_START__, now() - interval '72 hours') as since,
    coalesce(__FLOW9_END__, now()) as until
), work as (
  select h.key, h.kind, h.epoch, h.release, h.state, h.created_at, h.updated_at,
    h.lease_token is not null as claimed,
    case when h.lease_token is not null and h.kind = 'hourly-collection'
      then h.lease_until - interval '15 minutes' end as hourly_claimed_at,
    case when h.key ~ ('^cron:' || h.kind || ':' || h.epoch::text || ':[0-9]{1,10}$')
    then to_timestamp(split_part(h.key, ':', 4)::bigint * 300) end as slot
  from public.hosting_work h cross join bounds b
  where h.created_at >= b.since and h.created_at <= b.until
), scheduled as (
  select * from work where slot is not null
), readers as (
  select w.user_id, row_number() over (order by w.user_id) as reader,
    w.state#>>'{settings,timezone}' as timezone, w.state#>>'{settings,deliveryTime}' as delivery_time,
    coalesce(s.enabled, false) as schedule_enabled,
    greatest(s.starts_at, s.settings_changed_at, p.created_at) as settings_since
  from public.reader_collection_policies p
  join public.reader_workspaces w on w.user_id = p.user_id
  left join public.daily_briefing_schedules s on s.reader_id = p.user_id
  where p.enabled
), source_checks as (
  select c.*, exists (
    select 1 from scheduled f where f.kind = 'hourly-collection' and f.state = 'completed'
      and c.started_at >= f.hourly_claimed_at and c.finished_at <= least(f.updated_at,b.until)
  ) as scheduled
  from public.reader_collection_checks c cross join bounds b
  where c.started_at >= b.since and c.started_at <= b.until
), social_jobs as (
  select j.*, j.purpose = 'collection' and exists (
    select 1 from scheduled f where f.kind = 'social-collection' and f.state = 'completed'
      and j.created_at between f.created_at and f.updated_at
  ) as scheduled
  from public.social_collection_jobs j cross join bounds b where j.created_at between b.since and b.until
), archive as (
  select a.user_id, a.id, a.record->>'format' as format, a.record->>'contentKind' as content_kind,
    length(btrim(a.record->>'content')) > 0 as has_content,
    a.record#>>'{videoFormat,kind}' = 'regular' as is_regular,
    encode(sha256(convert_to(a.record->>'content', 'UTF8')), 'hex') as content_hash,
    (exists (select 1 from source_checks c
       where c.scheduled and c.user_id = a.user_id and c.source_id = a.source_id and c.retrieved_count > 0
         and a.collected_at between c.started_at and c.finished_at)
     or exists (select 1 from public.social_collection_deliveries d
       join public.social_collection_items si on (si.source_key,si.item_key,si.revision) = (d.source_key,d.item_key,d.revision)
       join social_jobs j on j.id = si.job_id and j.scheduled
       where d.user_id = a.user_id and d.archive_id = a.id and not d.deleted)) as scheduled
  from public.reader_source_updates a cross join bounds b
  where a.collected_at between b.since and b.until
), tasks as (
  select 'automatic' as origin, 'automatic-content' as worker, id, user_id, update_id, content_hash,
    source_snapshot, task, state, session_id, created_at, updated_at, lease_claims
  from public.automatic_content_tasks t cross join bounds b
  where t.created_at between b.since and b.until or t.updated_at between b.since and b.until
  union all
  select 'social', 'social-content', id, user_id, update_id, content_hash,
    source_snapshot, task, state, session_id, created_at, updated_at, lease_claims
  from public.social_content_tasks t cross join bounds b
  where t.created_at between b.since and b.until or t.updated_at between b.since and b.until
), task_receipts as (
  select t.*, exists (
    select 1 from public.keyword_learning_sessions s join scheduled f on f.kind = t.worker and f.state = 'completed'
      and s.created_at between f.created_at and f.updated_at
    where s.id = t.session_id
  ) and exists (
    select 1 from scheduled f where f.kind = t.worker and f.state = 'completed' and t.updated_at between f.created_at and f.updated_at
  ) as scheduled
  from tasks t
), review_window as materialized (
  select r.user_id, r.update_id, r.content_hash, r.status, r.provenance, r.kind, r.proposal,
    split_part(r.dedupe_key, ':', 1) as origin, split_part(r.dedupe_key, ':', 2) as task_id
  from public.admin_analysis_reviews r cross join bounds b
  where r.created_at between b.since and b.until and (r.dedupe_key like 'automatic:%' or r.dedupe_key like 'social:%')
), draft_sources as materialized (
  select t.id, t.origin, t.user_id, t.update_id, t.content_hash, t.task, t.session_id,
    t.source_snapshot->>'content' as source_text,
    case when t.task = 'keywords' then regexp_replace(t.source_snapshot->>'content','[[:space:]]+',' ','g') end as keyword_text,
    t.content_hash = encode(sha256(convert_to(t.source_snapshot->>'content', 'UTF8')), 'hex') as hash_matches
  from tasks t
  where exists (select 1 from review_window r where r.origin = t.origin and r.task_id = t.id::text)
), draft_checks as (
  select t.id, t.origin,
    count(*) as drafts,
    count(*) filter (where r.status = 'rejected') as rejected,
    count(*) filter (where r.status in ('pending','approved') and t.hash_matches
      and r.provenance->>'sessionId' = t.session_id::text
      and case when t.task = 'recap' and r.kind = 'recap' and jsonb_typeof(r.proposal->'highlights') = 'array'
        then jsonb_array_length(r.proposal->'highlights') between 1 and 6 and not exists (
          select 1 from jsonb_array_elements(r.proposal->'highlights') pt
          where jsonb_typeof(pt->'text') is distinct from 'string'
            or char_length(btrim(pt->>'text')) not between 1 and 500
            or cardinality(regexp_split_to_array(btrim(pt->>'text'),'[[:space:]]+')) > 38
            or jsonb_typeof(pt->'evidenceQuote') is distinct from 'string'
            or char_length(btrim(pt->>'evidenceQuote')) not between 15 and 1000
            or strpos(t.source_text, pt->>'evidenceQuote') < 1
        )
        when t.task = 'keywords' and r.kind = 'keyword' then
          jsonb_typeof(r.proposal->'label') = 'string' and char_length(btrim(r.proposal->>'label')) between 1 and 100
          and r.proposal->>'kind' in ('brand','product','game','technology','category')
          and strpos(t.keyword_text, r.proposal->>'label') > 0
        else false end
      ) as valid_drafts
  from draft_sources t
  join review_window r on r.origin = t.origin and r.task_id = t.id::text
    and (r.user_id,r.update_id,r.content_hash) = (t.user_id,t.update_id,t.content_hash)
  group by t.id,t.origin
), draft_receipts as (
  select t.origin, t.task, t.user_id, t.update_id, t.content_hash, t.state, t.scheduled,
    coalesce(d.drafts,0) as drafts, coalesce(d.rejected,0) as rejected, coalesce(d.valid_drafts,0) as valid_drafts
  from task_receipts t left join draft_checks d using (id,origin)
), good_tasks as (
  select * from draft_receipts where scheduled and drafts = valid_drafts and state = 'review'
    and case when task = 'recap' then drafts = 1 else drafts between 1 and 15 end
), eligible_videos as (
  select a.* from archive a where a.scheduled and a.has_content and a.content_kind = 'transcript' and a.format = 'video' and a.is_regular
), good_videos as (
  select a.id from eligible_videos a
  join good_tasks t on (t.user_id,t.update_id,t.content_hash) = (a.user_id,a.id,a.content_hash) and t.origin = 'automatic'
  group by a.user_id,a.id having count(distinct t.task) = 2
), briefings as (
  select r.reader, s.local_date, s.period_start, s.cutoff_at, s.created_at, s.published_at, s.status,
    j.state as job_state, j.created_at as job_created_at,
    (s.snapshot->>'failureCode' is not null or coalesce(s.snapshot->>'notice' like 'This daily briefing could not be completed safely (%',false)) as generation_failed,
    (s.snapshot->'coverage')-'sources' as coverage,
    jsonb_array_length(s.snapshot->'topics') as topics, points.total as points, points.citations as citations, points.bad as bad_points,
    not exists (select 1 from jsonb_array_elements(s.snapshot->'topics') t
      where jsonb_array_length(t->'points') is null or jsonb_array_length(t->'points') = 0) as all_topics_have_points,
    exists (
      select 1 from scheduled f where f.kind = 'daily-briefing' and f.state = 'completed'
        and f.slot >= s.cutoff_at and f.slot < s.cutoff_at + interval '15 minutes'
        and f.updated_at <= s.cutoff_at + interval '15 minutes'
        and j.created_at between f.created_at and f.updated_at and s.created_at between j.created_at and f.updated_at
    ) as genuine
  from public.daily_briefings s
  join readers r on r.user_id = s.reader_id
  left join public.daily_briefing_jobs j on j.id = s.id
  cross join bounds b
  cross join lateral (
    select count(*) as total, coalesce(sum(q.citations),0) as citations,
      count(*) filter(where q.citations = 0 or q.bad > 0) as bad
    from jsonb_array_elements(s.snapshot->'topics') t cross join lateral jsonb_array_elements(t->'points') p
    cross join lateral (
      select count(*) as citations, count(*) filter(where
        coalesce(c->>'url','') not like 'https://%' or nullif(btrim(c->>'evidenceQuote'),'') is null
        or not exists(select 1 from jsonb_array_elements(s.snapshot->'allUpdates') u
          where u->>'updateId' = c->>'updateId' and u->>'url' = c->>'url' and u->>'publishedAt'=c->>'publishedAt')
      ) as bad from jsonb_array_elements(p->'citations') c
    ) q
  ) points
  where s.deleted_at is null and (s.cutoff_at between b.since and b.until or s.created_at between b.since and b.until)
), admin_writes as (
  select case when a.action ~ '^[a-z][a-z0-9_.-]{0,90}$' then a.action else 'other_action' end as action, count(*) as total
  from public.admin_audit_events a cross join bounds b
  where a.created_at between b.since and b.until
    and a.action not in ('collection_costs.viewed','reader.viewed','readers.listed','keywords.listed',
      'analysis_reviews.listed','analysis_reviews.viewed')
  group by 1
), month_budget as (
  select s.* from (
    select date_trunc('month',since) as month from bounds
    union select date_trunc('month',until) from bounds
  ) m cross join lateral public.monthly_provider_budget_snapshot(m.month) s
)
select jsonb_build_object(
  'since',b.since,'until',b.until,'readOnly',current_setting('transaction_read_only')='on',
  'control',(select to_jsonb(c)-'release_revision'-'singleton' from public.hosting_runtime_control c where c.singleton),
  'dailyEnabled',(select enabled from public.daily_briefing_control where id),
  'readers',(select coalesce(jsonb_agg(to_jsonb(r)-'user_id' order by reader),'[]') from readers r),
  'briefings',(select coalesce(jsonb_agg(s order by reader,cutoff_at),'[]') from briefings s),
  'frames',(select coalesce(jsonb_agg(jsonb_build_object('key',key,'kind',kind,'slot',slot,'created',created_at,'updated',updated_at,'claimed',claimed,'state',state,'release',release,'epoch',epoch) order by slot,kind),'[]') from scheduled),
  'ingestion',jsonb_build_object(
    'checks',(select count(*) from source_checks where scheduled),
    'failedChecks',(select count(*) from source_checks where scheduled and status in ('failed','abandoned')),
    'partialChecks',(select count(*) from source_checks where scheduled and status = 'partial'),
    'blockedChecks',(select count(*) from source_checks where scheduled and status in ('blocked','unsupported')),
    'reportedNewItems',(select coalesce(sum(new_count),0) from source_checks where scheduled),
    'scheduledSocialJobs',(select count(*) from social_jobs where scheduled),
    'failedSocialJobs',(select count(*) from social_jobs where scheduled and state in ('failed','ambiguous')),
    'archived',(select count(*) from archive),
    'archivedDuringScheduledChecks',(select count(*) from archive where scheduled),
    'transcriptsDuringScheduledChecks',(select count(*) from archive where scheduled and has_content and content_kind = 'transcript')
  ),
  'analysis',jsonb_build_object(
    'jobs',(select count(*) from tasks),
    'started',(select count(*) from tasks where lease_claims > 0 or session_id is not null),
    'scheduledJobs',(select count(*) from draft_receipts where scheduled),
    'drafts',(select coalesce(sum(drafts),0) from draft_receipts),
    'rejectedDrafts',(select coalesce(sum(rejected),0) from draft_receipts),
    'validDrafts',(select coalesce(sum(valid_drafts),0) from draft_receipts),
    'scheduledValidDrafts',(select coalesce(sum(valid_drafts),0) from draft_receipts where scheduled),
    'validScheduledJobs',(select count(*) from good_tasks),
    'eligibleVideos',(select count(*) from eligible_videos),
    'videosWithBothDrafts',(select count(*) from good_videos),
    'modelCalls',(select count(*) from public.reader_content_analysis_calls c where c.created_at between b.since and b.until),
    'modelCallsUnknownCost',(select count(*) from public.reader_content_analysis_calls c where c.created_at between b.since and b.until and c.actual_usd is null),
    'modelRecordedUsd',(select coalesce(sum(actual_usd),0) from public.reader_content_analysis_calls c where c.created_at between b.since and b.until)
  ),
  'intervention',jsonb_build_object(
    'nonCronWork',(select count(*) from work where slot is null and kind <> 'http'),
    'unlinkedCollectionJobs',(select count(*) from public.collection_jobs j where j.created_at between b.since and b.until
      and not exists(select 1 from public.reader_collection_provider_jobs p where p.job_id = j.id)
      and not exists(select 1 from public.social_collection_jobs s where s.collection_job_id = j.id and s.purpose = 'collection')),
    'offScheduleSourceChecks',(select count(*) from source_checks where not scheduled and status <> 'running'),
    'offScheduleSocialJobs',(select count(*) from social_jobs where not scheduled),
    'unattributedArchiveItems',(select count(*) from archive where not scheduled),
    'offScheduleAnalysisJobs',(select count(*) from task_receipts where not scheduled and (session_id is not null or lease_claims > 0)),
    'unlinkedModelCalls',(select count(*) from public.reader_content_analysis_calls c where c.created_at between b.since and b.until
      and not exists(select 1 from public.keyword_learning_requests k join task_receipts t on t.session_id = k.session_id and t.scheduled where k.call_id = c.id)
      and not exists(select 1 from scheduled f where f.kind = 'content-analysis' and f.state = 'completed' and c.created_at between f.created_at and f.updated_at
        and not exists(select 1 from public.keyword_learning_requests k where k.call_id = c.id))),
    'offScheduleDailyJobs',(select count(*) from public.daily_briefing_jobs j where j.created_at between b.since and b.until
      and not exists(select 1 from scheduled f where f.kind = 'daily-briefing' and j.created_at between f.created_at and f.updated_at)),
    'feeReceipts',(select count(*) from public.collection_provider_fee_receipts f where f.created_at between b.since and b.until),
    'identityChanges',(select count(*) from recap_internal.reader_identity_events i where i.created_at between b.since and b.until),
    'adminWrites',(select coalesce(jsonb_object_agg(action,total),'{}') from admin_writes)
  ),
  'budget',(select coalesce(jsonb_agg(m order by month_start),'[]') from month_budget m)
) as evidence
from bounds b
where b.since < b.until and b.until <= now() and b.since >= b.until - interval '7 days';
rollback;
