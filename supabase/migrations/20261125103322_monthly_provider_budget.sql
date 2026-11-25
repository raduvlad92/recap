-- S2: one USD 20 UTC-calendar-month allowance for Therecap's Apify and
-- OpenRouter work. Original provider records and unresolved holds stay intact.
begin;

create table recap_internal.monthly_provider_budget_alerts (
 month_start date not null,
 threshold smallint not null check (threshold in (50,80,100)),
 reached_at timestamptz not null,
 primary key(month_start,threshold)
);
alter table recap_internal.monthly_provider_budget_alerts enable row level security;
revoke all on recap_internal.monthly_provider_budget_alerts from public,anon,authenticated,service_role;
grant select,insert on recap_internal.monthly_provider_budget_alerts to service_role;

-- One common transaction lock, including across midnight. The old ledgers
-- remain authoritative. Read Committed takes a fresh snapshot after the wait.
create function public.lock_monthly_provider_budget() returns void
language sql volatile security invoker set search_path='' as $$
 select pg_advisory_xact_lock(20261125,20);
$$;

create function public.monthly_provider_budget_snapshot(p_at timestamptz)
returns table(month_start date, resets_at timestamptz, limit_usd numeric, apify_usd numeric,
 openrouter_usd numeric, committed_usd numeric, unresolved_usd numeric)
language sql stable security invoker set search_path='' as $$
 with month as (
  select date_trunc('month',p_at at time zone 'UTC') as start_at
 ), apify as (
  select coalesce(r.launch_attempted_at,r.created_at) as charge_at,r.state,r.actual_cost_usd,
   greatest(coalesce(r.actual_cost_usd,r.maximum_usd),coalesce(j.observed_cost_usd,0),
    coalesce((select max(f.reported_usd) from public.collection_provider_fee_receipts f where f.reservation_id=r.id),0)) as commitment
  from public.collection_budget_reservations r
  left join public.reader_collection_provider_jobs j on j.reservation_id=r.id
  where r.provider='apify' and r.state<>'released'
  union all
  -- The old manual path wrote only the run ledger. A known run without a
  -- reported price retains the largest allowance that path could have used.
  select l.created_at,case when l.observed_cost_usd is null then 'held' else 'settled' end,
   l.observed_cost_usd,coalesce(l.observed_cost_usd,.10)
  from public.collection_jobs l
  where l.provider='apify' and l.provider_run_id is not null
   and not exists(select 1 from public.collection_budget_reservations r where r.provider='apify' and r.provider_run_id=l.provider_run_id)
   and not exists(select 1 from public.reader_collection_provider_jobs j where j.job_id=l.id)
   and not exists(select 1 from public.social_collection_jobs j where j.collection_job_id=l.id and j.reservation_id is not null)
  -- Standalone proof controllers reserve their envelope before dispatch.
  -- Count only unused capacity here so child charges are counted once.
  union all
  select r.created_at,'held',null,
   greatest(0,r.maximum_usd-coalesce((select sum(coalesce(j.actual_cost_usd,j.maximum_usd))
    from public.collection_budget_reservations j where j.parent_id=r.id and j.state<>'released'),0))
  from public.collection_budget_reservations r
  where r.kind='envelope' and r.state='held'
 ), analysis as (
  select c.created_at,c.actual_usd,greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0)) as commitment
  from public.reader_content_analysis_calls c
 ), source_totals as (
  select coalesce(sum(actual_cost_usd) filter(where charge_at >= m.start_at at time zone 'UTC'
    and charge_at < (m.start_at+interval '1 month') at time zone 'UTC'),0) as spend,
   coalesce(sum(case when state='held' or (charge_at >= m.start_at at time zone 'UTC'
    and charge_at < (m.start_at+interval '1 month') at time zone 'UTC') then commitment
    else greatest(0,commitment-actual_cost_usd) end),0) as committed
  from month m cross join apify
 ), model_totals as (
  select coalesce(sum(actual_usd) filter(where created_at >= m.start_at at time zone 'UTC'
    and created_at < (m.start_at+interval '1 month') at time zone 'UTC'),0) as spend,
   coalesce(sum(case when actual_usd is null or (created_at >= m.start_at at time zone 'UTC'
    and created_at < (m.start_at+interval '1 month') at time zone 'UTC') then commitment
    else greatest(0,commitment-actual_usd) end),0) as committed
  from month m cross join analysis
 )
 select start_at::date,(start_at+interval '1 month') at time zone 'UTC',20::numeric,
  s.spend,a.spend,s.committed+a.committed,s.committed+a.committed-s.spend-a.spend
 from month cross join source_totals s cross join model_totals a;
$$;

create function public.require_monthly_provider_capacity(p_additional_usd numeric, p_existing_allocation boolean default false)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare used numeric; ceiling numeric;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Provider admissions require read committed' using errcode='PT409';
 end if;
 perform public.lock_monthly_provider_budget();
 select committed_usd,limit_usd into strict used,ceiling from public.monthly_provider_budget_snapshot(clock_timestamp());
 if used+p_additional_usd>ceiling or (used>=ceiling and not p_existing_allocation) then
  raise exception 'Monthly provider budget exhausted' using errcode='PT402',detail='provider_monthly_budget_exhausted';
 end if;
end;
$$;

create function public.guard_monthly_apify_reservation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare unused numeric:=0;
begin
 if new.provider is distinct from 'apify' and new.kind<>'envelope' and new.parent_id is null then
  return new;
 end if;
 perform public.lock_monthly_provider_budget();
 if tg_op='INSERT' and new.state='held' and (new.provider='apify' or new.kind='envelope') then
  if new.parent_id is not null then
   select greatest(0,r.maximum_usd-coalesce((select sum(coalesce(j.actual_cost_usd,j.maximum_usd))
    from public.collection_budget_reservations j where j.parent_id=r.id and j.state<>'released'),0))
   into unused from public.collection_budget_reservations r where r.id=new.parent_id and r.state='held';
  end if;
  perform public.require_monthly_provider_capacity(greatest(0,new.maximum_usd-coalesce(unused,0)));
 elsif tg_op='UPDATE' and new.provider='apify' and old.launch_attempted_at is null and new.launch_attempted_at is not null then
  -- A pre-existing hold is already included. Refuse launching if a later
  -- provider receipt put the combined ledger over the cap.
  perform public.require_monthly_provider_capacity(0,true);
 end if;
 return new;
end;
$$;

create function public.guard_monthly_openrouter_reservation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform public.lock_monthly_provider_budget();
 if new.state='reserved' and (tg_op='INSERT' or old.state<>'reserved') then
  -- The known-zero rejection protocol reopens a settled call as reserved.
  -- Unknown and settled observations record money and never need admission.
  perform public.require_monthly_provider_capacity(new.maximum_usd);
 end if;
 return new;
end;
$$;

create function public.record_monthly_provider_budget_alerts() returns trigger
language plpgsql security invoker set search_path='' as $$
declare at_time timestamptz:=clock_timestamp();
begin
 insert into recap_internal.monthly_provider_budget_alerts(month_start,threshold,reached_at)
 select s.month_start, thresholds.percent,at_time
 from public.monthly_provider_budget_snapshot(at_time) s
 cross join (values (50),(80),(100)) thresholds(percent)
 where s.committed_usd>=s.limit_usd*thresholds.percent/100.0
 on conflict do nothing;
 return null;
end;
$$;

create trigger monthly_apify_reservation before insert or update of state,actual_cost_usd,launch_attempted_at
 on public.collection_budget_reservations for each row execute function public.guard_monthly_apify_reservation();
create trigger monthly_apify_alert after insert or update of state,actual_cost_usd,launch_attempted_at
 on public.collection_budget_reservations for each statement execute function public.record_monthly_provider_budget_alerts();
create trigger monthly_openrouter_reservation before insert or update of state,maximum_usd,actual_usd,observed_usd
 on public.reader_content_analysis_calls for each row execute function public.guard_monthly_openrouter_reservation();
create trigger monthly_openrouter_alert after insert or update of state,maximum_usd,actual_usd,observed_usd
 on public.reader_content_analysis_calls for each statement execute function public.record_monthly_provider_budget_alerts();

-- The hourly ledger can observe an amount before the central reservation is
-- final. Serialize that update as well so its larger amount cannot be missed.
create function public.lock_monthly_apify_observation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform public.lock_monthly_provider_budget();
 return new;
end;
$$;
create trigger monthly_apify_observation before update of observed_cost_usd
 on public.reader_collection_provider_jobs for each row when (old.observed_cost_usd is distinct from new.observed_cost_usd)
 execute function public.lock_monthly_apify_observation();
create trigger monthly_apify_observation_alert after update of observed_cost_usd
 on public.reader_collection_provider_jobs for each row when (old.observed_cost_usd is distinct from new.observed_cost_usd)
 execute function public.record_monthly_provider_budget_alerts();
create trigger monthly_legacy_apify_observation before update of observed_cost_usd,provider_run_id
 on public.collection_jobs for each row when (new.provider='apify' and new.provider_run_id is not null
  and (old.observed_cost_usd,old.provider_run_id) is distinct from (new.observed_cost_usd,new.provider_run_id))
 execute function public.lock_monthly_apify_observation();
create trigger monthly_legacy_apify_alert after update of observed_cost_usd,provider_run_id
 on public.collection_jobs for each row when (new.provider='apify' and new.provider_run_id is not null
  and (old.observed_cost_usd,old.provider_run_id) is distinct from (new.observed_cost_usd,new.provider_run_id))
 execute function public.record_monthly_provider_budget_alerts();
create trigger monthly_provider_fee_observation before insert
 on public.collection_provider_fee_receipts for each row execute function public.lock_monthly_apify_observation();
create trigger monthly_provider_fee_alert after insert
 on public.collection_provider_fee_receipts for each statement execute function public.record_monthly_provider_budget_alerts();

create function public.read_monthly_provider_budget() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('monthStart',s.month_start,'resetsAt',s.resets_at,'limitUsd',s.limit_usd,
  'apifyUsd',s.apify_usd,'openrouterUsd',s.openrouter_usd,'spentUsd',s.apify_usd+s.openrouter_usd,
  'committedUsd',s.committed_usd,'unresolvedUsd',s.unresolved_usd,'paused',s.committed_usd>=s.limit_usd,
  'alerts',coalesce((select jsonb_agg(q.percent order by q.percent)
   from (values (50),(80),(100)) q(percent)
   where s.committed_usd>=s.limit_usd*q.percent/100.0 or exists(
    select 1 from recap_internal.monthly_provider_budget_alerts a where a.month_start=s.month_start and a.threshold=q.percent)),'[]'::jsonb))
 from public.monthly_provider_budget_snapshot(statement_timestamp()) s;
$$;

-- Keep threshold notifications for amounts already recorded at activation.
insert into recap_internal.monthly_provider_budget_alerts(month_start,threshold,reached_at)
select s.month_start,q.percent,statement_timestamp()
from public.monthly_provider_budget_snapshot(statement_timestamp()) s
cross join (values (50),(80),(100)) q(percent)
where s.committed_usd>=s.limit_usd*q.percent/100.0;

revoke all on function public.lock_monthly_provider_budget(),public.monthly_provider_budget_snapshot(timestamptz),
 public.require_monthly_provider_capacity(numeric,boolean),public.record_monthly_provider_budget_alerts(),
 public.guard_monthly_apify_reservation(),public.guard_monthly_openrouter_reservation(),
 public.lock_monthly_apify_observation(),public.read_monthly_provider_budget() from public,anon,authenticated;
grant execute on function public.lock_monthly_provider_budget(),public.monthly_provider_budget_snapshot(timestamptz),
 public.require_monthly_provider_capacity(numeric,boolean),public.read_monthly_provider_budget() to service_role;


create or replace function public.reserve_collection_budget(p_request_key text,p_maximum_usd numeric,p_kind text,p_parent_id uuid default null,p_provider text default null,p_actor_id text default null)
returns public.collection_budget_reservations language plpgsql security invoker set search_path = '' as $$
declare a public.collection_budget_accounts; r public.collection_budget_reservations; parent public.collection_budget_reservations; allocated numeric; recurring_apify boolean;
begin
 select * into a from public.collection_budget_accounts where id='source-proof' for update;
 if a.id is null then raise exception 'Budget unavailable' using errcode='PT503'; end if;
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' or p_maximum_usd is null or p_maximum_usd <= 0 or p_maximum_usd > a.ceiling_usd or scale(p_maximum_usd)>6
   or p_kind is null or p_kind not in ('envelope','job') then raise exception 'Invalid budget reservation' using errcode='PT400'; end if;
 if (p_kind='envelope' and (p_parent_id is not null or p_provider is not null or p_actor_id is not null))
   or (p_kind='job' and (p_provider is null or p_provider not in ('apify','brightdata') or p_actor_id is null or length(p_actor_id)>200 or p_actor_id !~ '^[A-Za-z0-9_-]+([~/][A-Za-z0-9_-]+)?$')) then
   raise exception 'Invalid budget reservation' using errcode='PT400'; end if;
 select * into r from public.collection_budget_reservations where account_id=a.id and request_key=p_request_key;
 if r.id is not null then
   if r.maximum_usd<>p_maximum_usd or r.kind<>p_kind or r.parent_id is distinct from p_parent_id or r.provider is distinct from p_provider or r.actor_id is distinct from p_actor_id then
     raise exception 'Budget request identity changed' using errcode='PT409'; end if;
   return r;
 end if;
 recurring_apify:=p_kind='job' and p_provider='apify' and p_parent_id is null;
 if not recurring_apify and public.collection_budget_committed()>a.ceiling_usd then raise exception 'Budget ceiling exceeded' using errcode='PT402'; end if;
 if p_parent_id is null then
   if not recurring_apify and public.collection_budget_committed()+p_maximum_usd>a.ceiling_usd then raise exception 'Budget exhausted' using errcode='PT402'; end if;
 else
   select * into parent from public.collection_budget_reservations where id=p_parent_id;
   if parent.id is null or parent.kind<>'envelope' or parent.state<>'held' or parent.account_id<>a.id then raise exception 'Budget envelope unavailable' using errcode='PT409'; end if;
   select coalesce(sum(case when state='held' then maximum_usd when state='settled' then actual_cost_usd else 0 end),0) into allocated from public.collection_budget_reservations where parent_id=parent.id;
   if allocated+p_maximum_usd>parent.maximum_usd then raise exception 'Envelope budget exhausted' using errcode='PT402'; end if;
 end if;
 insert into public.collection_budget_reservations(request_key,kind,parent_id,maximum_usd,provider,actor_id)
   values(p_request_key,p_kind,p_parent_id,p_maximum_usd,p_provider,p_actor_id) returning * into r;
 return r;
end;
$$;

create or replace function public.claim_collection_budget(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.collection_budget_reservations; a public.collection_budget_accounts;
begin
 select * into a from public.collection_budget_accounts where id='source-proof' for update;
 select * into r from public.collection_budget_reservations where id=p_id;
 if r.id is null or r.kind<>'job' or r.state<>'held' then raise exception 'Budget job unavailable' using errcode='PT409'; end if;
 if r.launch_attempted_at is not null then return jsonb_build_object('claimed',false,'reservation',to_jsonb(r)); end if;
 if (r.provider is distinct from 'apify' or r.parent_id is not null) and public.collection_budget_committed()>a.ceiling_usd then raise exception 'Budget ceiling exceeded' using errcode='PT402'; end if;
 if r.parent_id is not null and not exists(select 1 from public.collection_budget_reservations where id=r.parent_id and kind='envelope' and state='held') then raise exception 'Budget envelope unavailable' using errcode='PT409'; end if;
 update public.collection_budget_reservations set launch_attempted_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
 return jsonb_build_object('claimed',true,'reservation',to_jsonb(r));
end;
$$;

create or replace function public.reserve_hourly_provider(p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_actor_id text,p_maximum_usd numeric,p_parent_reservation_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; p public.reader_collection_policies; r public.collection_budget_reservations; j public.reader_collection_provider_jobs; daily numeric; claimed jsonb;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into p from public.reader_collection_policies where user_id=e.user_id for update;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if not coalesce(p.enabled and p.provider_enabled,false) or e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Provider disabled or lease changed' using errcode='PT409'; end if;
 if not exists(select 1 from public.reader_workspaces w where w.user_id=e.user_id and w.updated_at=s.workspace_revision and w.state->'followedSourceIds' ? e.source_id and exists(select 1 from jsonb_array_elements(w.state->'customSources') x where x->>'id'=e.source_id and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)) then raise exception 'Follow changed' using errcode='PT409'; end if;
 if p_item_key is null or not coalesce((
  p_item_key ~ '^youtube:[A-Za-z0-9_-]{11}$'
  or (e.platform='YouTube' and p_actor_id='h7sDV53CddomktSi5' and p_maximum_usd<=0.005
   and p_item_key ~ '^youtube-format:[A-Za-z0-9_-]{11}:[a-f0-9]{64}$'
   and exists(select 1 from public.reader_source_updates a where a.user_id=e.user_id and a.source_id=e.source_id
    and public.hourly_item_key(a.record->>'url')='youtube:'||split_part(p_item_key,':',2)
    and a.record->>'contentKind'='transcript' and length(btrim(a.record->>'content'))>0
    and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=split_part(p_item_key,':',3)
    and coalesce(a.record#>>'{videoFormat,kind}','unknown')='unknown'))
  or (e.platform='YouTube' and p_actor_id='h7sDV53CddomktSi5' and p_maximum_usd<=0.02
   and p_item_key='youtube-discovery:'||coalesce(s.channel_id,substring(e.source_url from '/channel/(UC[A-Za-z0-9_-]{22})'))||':'||(clock_timestamp()at time zone'UTC')::date::text)
 ),false) or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>0.10 then raise exception 'Invalid provider reservation' using errcode='PT400'; end if;
 if not exists(select 1 from public.collection_jobs where id=p_job_id and user_id=e.user_id and source_id=e.source_id and provider='apify' and actor_id=p_actor_id and status='requested') then raise exception 'Job unavailable' using errcode='PT409'; end if;
 select * into j from public.reader_collection_provider_jobs where user_id=e.user_id and source_id=e.source_id and item_key=p_item_key;
 if j.id is not null then return jsonb_build_object('claimed',false,'id',j.id); end if;
 select coalesce(sum(case when created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or actual_cost_usd is null then case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd) else greatest(actual_cost_usd,observed_cost_usd) end else 0 end),0)
  into daily from public.reader_collection_provider_jobs where user_id=e.user_id;
 if daily+p_maximum_usd>p.daily_limit_usd then raise exception 'Reader budget exhausted' using errcode='PT402'; end if;
 r:=public.reserve_collection_budget('hourly.'||e.id::text||'.'||p_item_key,p_maximum_usd,'job',p_parent_reservation_id,'apify',p_actor_id);
 claimed:=public.claim_collection_budget(r.id);
 if claimed->>'claimed'<>'true' then raise exception 'Launch already claimed' using errcode='PT409'; end if;
 insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd)
  values(e.user_id,e.source_id,p_item_key,s.fingerprint,e.id,p_job_id,r.id,p_actor_id,p_maximum_usd) returning * into j;
 -- Durable pre-POST unknown-cost reference, even if the process dies next.
 update public.reader_collection_checks set provider='apify',observed_cost_usd=null,cost_status='unknown',job_id=p_job_id,
  details=jsonb_set(details,'{providerJobs}',coalesce(details->'providerJobs','[]'::jsonb)||jsonb_build_array(jsonb_build_object('jobId',p_job_id,'providerRunId',null,'actorId',p_actor_id,'itemKey',p_item_key,'reservedUsd',p_maximum_usd,'observedCostUsd',null,'costStatus','unknown'))) where id=e.id;
 return jsonb_build_object('claimed',true,'id',j.id,'reservationId',r.id);
end;
$$;

create or replace function public.mark_social_collection_launch(p_id uuid,p_lease uuid)returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.social_collection_jobs;p public.social_collection_platforms;answer jsonb;r public.collection_budget_reservations;cost numeric;daily numeric;
begin
 select * into p from public.social_collection_platforms where platform=(select platform from public.social_collection_jobs where id=p_id)for update;
 select * into j from public.social_collection_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed'or j.lease_token is distinct from p_lease or j.lease_until<clock_timestamp()then return false;end if;
 if not p.enabled or to_jsonb(p)is distinct from j.config then raise exception'Social configuration changed'using errcode='PT409';end if;
 if j.purpose<>'proof'and not exists(select 1 from public.social_collection_consumers c join public.reader_workspaces w on w.user_id=c.user_id join public.reader_collection_policies cp on cp.user_id=c.user_id and cp.enabled where c.source_key=j.source_key and w.updated_at=c.workspace_revision and coalesce(w.state->'followedSourceIds','[]')?c.source_id)then raise exception'No current source consumers'using errcode='PT409';end if;
 if j.reservation_id is null then
  select coalesce(sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end),0),
   coalesce(sum(case when a.created_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC' or (b.state='held'and b.launch_attempted_at is not null)then case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end else 0 end),0)
   into cost,daily from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=p.platform;
  if (j.purpose='proof' and cost+p.maximum_usd>p.lifetime_limit_usd) or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
  r:=public.reserve_collection_budget('social.'||j.id::text,p.maximum_usd,'job',null,'apify',p.actor_id);
  j.reservation_id:=r.id;
 end if;
 answer:=public.claim_collection_budget(j.reservation_id);
 if answer->'claimed'<>'true'::jsonb then return false;end if;
 update public.social_collection_jobs set state='launch_claimed',reservation_id=j.reservation_id where id=j.id;
 update public.collection_jobs set status='running',provider='apify',actor_id=p.actor_id,cost_status='unknown',observed_cost_usd=null where id=j.collection_job_id;return true;
end;$$;

create or replace function public.reserve_keyword_learning_call(p_session_id uuid,p_call_key text,p_source_ordinal integer,p_source_hash text,
 p_model text,p_execution_identity jsonb,p_request_hash text,p_maximum_usd numeric,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions;r public.keyword_learning_requests;c public.reader_content_analysis_calls;
 b public.content_analysis_budget;p public.reader_content_analysis_policies;a public.reader_source_updates;slot jsonb;
 global_total numeric;global_day numeric;owner_total numeric;owner_day numeric;session_total numeric;calls integer;utc_day timestamptz; recurring boolean;
begin
 perform public.validate_content_analysis_execution_identity(p_execution_identity,p_model);
 if p_session_id is null or p_call_key is null or p_call_key !~ '^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$'
  or p_source_ordinal is null or p_source_ordinal not between 1 and 1000 or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
  or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>.10
  or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>220000
  or p_request#>>'{request,key}' is distinct from p_call_key then
  raise exception 'Invalid private evaluation reservation' using errcode='PT400';end if;
 -- Source lock precedes financial locks, as in the production lock helper.
 -- Budget -> policy -> session then serializes money, caps and idempotency.
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 if d.id is null or d.user_id is null then raise exception 'Evaluation session unavailable' using errcode='PT403';end if;
 select value into slot from jsonb_array_elements(d.sources) where value->>'ordinal'=p_source_ordinal::text;
 if slot is null or slot->>'sourceHash' is distinct from p_source_hash or slot->>'updateId' is null or length(slot->>'updateId') not between 1 and 200
  or (select count(*) from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1 then
  raise exception 'Frozen evaluation source missing' using errcode='PT409';end if;
 select * into a from public.reader_source_updates where user_id=d.user_id and id=slot->>'updateId' for share;
 if a.id is null or jsonb_typeof(a.record->'content') is distinct from 'string'
  or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from p_source_hash then
  raise exception 'Frozen evaluation source changed' using errcode='PT409';end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into p from public.reader_content_analysis_policies where user_id=d.user_id for update;
 select * into d from public.keyword_learning_sessions where id=p_session_id for update;
 if b.id is null or p.user_id is null or d.user_id is distinct from a.user_id or d.user_id is distinct from p.user_id
  or d.state<>'released' or d.expires_at<=clock_timestamp()
  or (p_model=any(d.models)) is distinct from true or p_maximum_usd>p.per_call_limit_usd then
  raise exception 'Finite released evaluation session required' using errcode='PT403';end if;
 if not exists(select 1 from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text
  and s->>'sourceHash'=p_source_hash and s->>'updateId'=a.id) then
  raise exception 'Evaluation source binding changed while locking' using errcode='PT409';end if;
 select * into r from public.keyword_learning_requests where session_id=d.id and call_key=p_call_key;
 if found then
  select * into c from public.reader_content_analysis_calls where id=r.call_id;
  if r.request_hash is distinct from p_request_hash or r.source_hash is distinct from p_source_hash or r.source_ordinal is distinct from p_source_ordinal
   or r.request_payload is distinct from p_request or c.model is distinct from p_model or c.execution_identity is distinct from p_execution_identity
   or c.maximum_usd is distinct from p_maximum_usd then
   raise exception 'Evaluation request binding changed' using errcode='PT409';end if;
  return public.read_keyword_learning_call(d.id,p_call_key);
 end if;
 if exists(select 1 from public.keyword_learning_requests q join public.reader_content_analysis_calls l on l.id=q.call_id where q.session_id=d.id and l.actual_usd is null) then
  raise exception 'Unresolved evaluation call remains held' using errcode='PT409';end if;
 if exists(select 1 from public.content_analysis_provider_cooldowns q where q.identity_key=public.content_analysis_provider_key(p_execution_identity) and q.cooldown_until>clock_timestamp()) then
  raise exception 'Provider cooldown remains active' using errcode='PT409';end if;
 utc_day:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into global_total,global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_total,owner_day from public.reader_content_analysis_calls where user_id=d.user_id;
 select count(*),coalesce(sum(greatest(coalesce(l.actual_usd,l.maximum_usd),coalesce(l.observed_usd,0))),0)
  into calls,session_total from public.keyword_learning_requests q join public.reader_content_analysis_calls l on l.id=q.call_id where q.session_id=d.id;
 recurring:=exists(select 1 from public.automatic_content_tasks t where t.session_id=d.id and t.state='running')
  or exists(select 1 from public.social_content_tasks t where t.session_id=d.id and t.state='running');
 if (not recurring and (global_total+p_maximum_usd>least(b.lifetime_limit_usd,12) or owner_total+p_maximum_usd>least(p.lifetime_limit_usd,12)))
  or session_total+p_maximum_usd>d.maximum_usd or calls>=d.max_calls then
  raise exception 'Finite evaluation lifetime budget exhausted' using errcode='PT402';end if;
 if global_day+p_maximum_usd>least(b.daily_limit_usd,5) or owner_day+p_maximum_usd>least(p.daily_limit_usd,5) then
  raise exception 'Evaluation daily budget exhausted' using errcode='PT429';end if;
 insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,execution_identity,request_hash)
  values(null,d.user_id,p_call_key,gen_random_uuid(),p_model,p_source_hash,p_maximum_usd,p_execution_identity,p_request_hash) returning * into c;
 insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id)
  values(d.id,p_call_key,p_source_ordinal,p_source_hash,p_request_hash,p_request,c.id);
 return jsonb_build_object('claimed',true,'call',to_jsonb(c)-'result'-'usage','result',null,'errorCode',null,'requestHash',p_request_hash,'completed',false);
end;
$$;

-- A queued recurring task can renew its own expired session after a budget
-- pause. The original creation time, request identity and finite call allowance
-- remain fixed. Ordinary private evaluations keep their original 24-hour bound.
alter table public.keyword_learning_sessions
 add column budget_resumed_at timestamptz,
 drop constraint keyword_learning_sessions_check1,
 add constraint keyword_learning_sessions_expiry_check
 check ((budget_resumed_at is null or budget_resumed_at>=created_at)
  and expires_at>created_at and expires_at<=greatest(created_at,budget_resumed_at)+interval '24 hours');


create or replace function public.claim_automatic_content_task(p_lease_seconds integer default 900) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;p public.automatic_content_policies;
 a public.reader_source_updates;w public.reader_workspaces;b public.content_analysis_budget;
 op public.reader_content_analysis_policies;s public.keyword_learning_sessions;
 utc_day timestamptz;global_day numeric;owner_day numeric;reason text; resumed_at timestamptz;
begin
 if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then raise exception 'Invalid automatic lease'using errcode='PT400';end if;
 if exists(select 1 from public.monthly_provider_budget_snapshot(clock_timestamp()) where committed_usd+.10>limit_usd)then
  return jsonb_build_object('claimed',false,'reason','provider_monthly_budget_exhausted');
 end if;
 select q.*into t from public.automatic_content_tasks q join public.automatic_content_policies ap using(user_id)
 where ap.enabled and(q.state='queued' or(q.state='running'and q.lease_until<=clock_timestamp()))
 order by q.created_at,q.update_id,case q.task when'recap'then 0 else 1 end,q.id limit 1;
 if t.id is null then return jsonb_build_object('claimed',false);end if;
 -- Keep the existing workspace -> archive -> global budget -> owner ordering.
 select *into w from public.reader_workspaces where user_id=t.user_id for key share;
 select *into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select *into b from public.content_analysis_budget where id for update;
 select *into op from public.reader_content_analysis_policies where user_id=t.user_id for update;
 select *into p from public.automatic_content_policies where user_id=t.user_id for share;
 select *into t from public.automatic_content_tasks where id=t.id for update skip locked;
 if t.id is null or p.enabled is distinct from true or t.state not in('queued','running')or(t.state='running'and t.lease_until>clock_timestamp())then
  return jsonb_build_object('claimed',false);end if;
 if b.enabled is distinct from true or op.enabled is distinct from true then return jsonb_build_object('claimed',false,'reason','automatic_processing_paused');end if;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 end if;
 utc_day:=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_day from public.reader_content_analysis_calls where user_id=t.user_id;
 if reason is null then
  if global_day+.10>least(b.daily_limit_usd,5)or owner_day+.10>least(op.daily_limit_usd,5)then reason:='analysis_daily_budget_exhausted';
  elsif op.per_call_limit_usd<.10 then reason:='analysis_call_limit';end if;
 end if;
 if t.session_id is not null then
  select *into s from public.keyword_learning_sessions where id=t.session_id for update;
  if reason is null and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=t.session_id and c.actual_usd is null)then reason:='analysis_unknown_charge_hold';
  elsif reason is null and(s.id is null or s.state<>'released'or s.expires_at<=clock_timestamp())then
   if t.state='queued' and t.error_code='provider_monthly_budget_exhausted' and s.state='released' then
    resumed_at:=clock_timestamp();
    update public.keyword_learning_sessions set budget_resumed_at=resumed_at,expires_at=resumed_at+interval '24 hours'
     where id=s.id returning * into s;
   else reason:='automatic_session_expired';end if;
  end if;
 end if;
 if reason is not null then
  update public.automatic_content_tasks set state='blocked',error_code=reason,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then
   update public.keyword_learning_sessions set state='closed'where id=t.session_id and state<>'closed';
  end if;
  return jsonb_build_object('claimed',false,'reason',reason,'taskId',t.id);
 end if;
 if t.session_id is null then
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values(t.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',t.update_id,'sourceHash',t.content_hash,'sourceRevision',t.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],
    p.session_budget_usd,
    p.max_calls,clock_timestamp()+interval'24 hours')returning*into s;
 end if;
 update public.automatic_content_tasks set state='running',session_id=s.id,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_claims=lease_claims+1,error_code=null
  where id=t.id returning*into t;
 return jsonb_build_object('claimed',true,'task',to_jsonb(t),'record',t.source_snapshot,'leaseToken',t.lease_token);
end;
$$;

create or replace function public.finish_automatic_content_task(p_task_id uuid,p_lease_token uuid,p_result jsonb default null,p_error_code text default null)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;a public.reader_source_updates;w public.reader_workspaces;
 s public.keyword_learning_sessions;keys jsonb;entry jsonb;point jsonb;chosen jsonb;provenance jsonb;reason text;label text;kind text;
 amount integer:=0;inserted integer;unknown_call boolean;key_count integer;
begin
 if p_task_id is null or p_lease_token is null or(p_error_code is null and p_result is null)
  or(p_error_code is not null and(p_error_code!~'^[a-z][a-z0-9_]{0,79}$'or p_result is not null))
  or(p_result is not null and(jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>2000000))then
  raise exception 'Invalid automatic task result'using errcode='PT400';end if;
 select*into t from public.automatic_content_tasks where id=p_task_id;
 if not found then raise exception 'Automatic task unavailable'using errcode='PT409';end if;
 select*into w from public.reader_workspaces where user_id=t.user_id for key share;
 select*into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select*into t from public.automatic_content_tasks where id=p_task_id for update;
 if t.state<>'running'or t.lease_token is distinct from p_lease_token or t.lease_until<=clock_timestamp()then
  raise exception 'Automatic task lease changed'using errcode='PT409';end if;
 select*into s from public.keyword_learning_sessions where id=t.session_id for update;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 elsif not exists(select 1 from public.automatic_content_policies p where p.user_id=t.user_id and p.enabled)then reason:='automatic_processing_paused';
 elsif s.state is distinct from'released'or s.expires_at<=clock_timestamp()then reason:='automatic_session_expired';end if;
 select coalesce(jsonb_agg(r.call_key order by r.created_at,r.call_key),'[]'::jsonb),count(*),coalesce(bool_or(c.actual_usd is null),false)
  into keys,key_count,unknown_call from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
  where r.session_id=t.session_id and r.source_ordinal=1 and r.source_hash=t.content_hash and c.user_id=t.user_id;
 if reason is null and p_error_code in ('automatic_worker_yield','provider_monthly_budget_exhausted') and not unknown_call then
  update public.automatic_content_tasks set state='queued',error_code=p_error_code,lease_token=null,lease_until=null where id=t.id;
  return jsonb_build_object('state','queued','reviewCount',0,'sessionId',s.id);
 end if;
 if reason is null then reason:=case when unknown_call then'analysis_unknown_charge_hold'else p_error_code end;end if;
 provenance:=jsonb_build_object('origin','automatic_content','sessionId',s.id,'callKeys',keys,'sourceRevision',t.source_revision,
  'message','Automatically generated draft. Administrator confirmation is required; nothing was published.');
 if reason is not null then
  -- Operational stops stay in task monitoring. Real attempted provider failures
  -- retain one inspectable inbox row, with no invented empty generated finding.
  if reason not in('automatic_worker_yield','automatic_source_changed','automatic_processing_paused','automatic_session_expired',
    'analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_input_limit')
   and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
    where r.session_id=s.id and r.completed and c.result_at is not null)then
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,case when t.task='recap'then'recap'else'keyword'end,
     'automatic:'||t.id::text||':failure',t.source_snapshot,'{}',
     'Automatic generation could not provide a validated draft ('||reason||'). Inspect the saved source and prompt, then edit or reject.',provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics amount=row_count;
  end if;
  update public.automatic_content_tasks set state=case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,
   error_code=reason,review_count=amount,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then update public.keyword_learning_sessions set state='closed'where id=s.id;end if;
  return jsonb_build_object('state',case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,'errorCode',reason,'reviewCount',amount);
 end if;
 if key_count=0 or jsonb_typeof(p_result->'callKeys')is distinct from'array'
  or jsonb_array_length(p_result->'callKeys')<>key_count or not((p_result->'callKeys')@>keys and keys@>(p_result->'callKeys'))
  or exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=s.id and(not r.completed or r.result is null or r.error_code is not null or r.source_ordinal<>1 or r.source_hash<>t.content_hash or c.user_id<>t.user_id or c.actual_usd is null))then
  raise exception 'Exact completed automatic call evidence is required'using errcode='PT409';end if;
 if t.task='keywords'then
  if p_result->>'kind'is distinct from'keywords'or jsonb_typeof(p_result->'proposals')is distinct from'array'or jsonb_array_length(p_result->'proposals')>5000 then
   raise exception 'Invalid automatic keyword proposals'using errcode='PT400';end if;
  for entry in select value from jsonb_array_elements(p_result->'proposals')loop
   label:=btrim(entry->>'label');kind:=entry->>'kind';
   if jsonb_typeof(entry)is distinct from'object'or(entry-array['label','kind','reason'])<>'{}'::jsonb
    or jsonb_typeof(entry->'label')is distinct from'string'or char_length(label)not between 1 and 100 or label~'[[:cntrl:]]'
    or kind is null or kind not in('brand','product','game','technology','category')then
    raise exception 'Invalid automatic keyword proposal'using errcode='PT400';end if;
   reason:=coalesce(nullif(btrim(entry->>'reason'),''),'AI keyword draft; confirm its relevance and identity, edit or reject.');
   if strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    reason:='Name does not occur literally in the saved source. Correct it from that source or reject. '||reason;
   end if;
   if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,'keyword','automatic:'||t.id::text||':keyword:'||encode(sha256(convert_to(public.keyword_review_label_key(label),'UTF8')),'hex'),
     t.source_snapshot,jsonb_build_object('label',label,'kind',kind),reason,provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics inserted=row_count;amount:=amount+inserted;
  end loop;
 else
  chosen:=p_result->'proposal';
  if p_result->>'kind'is distinct from'recap'or jsonb_typeof(chosen)is distinct from'object'or(chosen-'highlights')<>'{}'::jsonb
   or jsonb_typeof(chosen->'highlights')is distinct from'array'or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'Automatic recap needs one to six cited points'using errcode='PT400';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb
    or jsonb_typeof(point->'text')is distinct from'string'or char_length(btrim(point->>'text'))not between 1 and 500
    or cardinality(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'))>38
    or jsonb_typeof(point->'evidenceQuote')is distinct from'string'or char_length(btrim(point->>'evidenceQuote'))not between 15 and 1000
    or strpos(a.record->>'content',point->>'evidenceQuote')=0 then
    raise exception 'Automatic recap needs exact supporting source quotes'using errcode='PT400';end if;
  end loop;
  reason:=coalesce(nullif(btrim(p_result->>'reason'),''),'AI recap draft; check the cited source, then confirm, edit or reject.');
  if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
  insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
   values(t.user_id,t.update_id,t.source_id,t.content_hash,'recap','automatic:'||t.id::text||':recap',t.source_snapshot,chosen,reason,provenance)
   on conflict(dedupe_key)do nothing;
  get diagnostics amount=row_count;
 end if;
 update public.automatic_content_tasks set state='review',review_count=amount,error_code=null,lease_token=null,lease_until=null where id=t.id;
 update public.keyword_learning_sessions set state='closed'where id=s.id;
 return jsonb_build_object('state','review','reviewCount',amount);
end;
$$;

create or replace function public.claim_social_content_task(p_lease_seconds integer default 900) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.social_content_tasks;p public.social_content_policies;
 a public.reader_source_updates;w public.reader_workspaces;b public.content_analysis_budget;
 op public.reader_content_analysis_policies;s public.keyword_learning_sessions;
 utc_day timestamptz;global_day numeric;owner_day numeric;reason text; resumed_at timestamptz;
begin
 if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then raise exception 'Invalid automatic lease'using errcode='PT400';end if;
 if exists(select 1 from public.monthly_provider_budget_snapshot(clock_timestamp()) where committed_usd+.10>limit_usd)then
  return jsonb_build_object('claimed',false,'reason','provider_monthly_budget_exhausted');
 end if;
 select q.*into t from public.social_content_tasks q join public.social_content_policies ap using(user_id)
 where ap.enabled and(q.state='queued' or(q.state='running'and q.lease_until<=clock_timestamp()))
 order by q.created_at,q.update_id,case q.task when'recap'then 0 else 1 end,q.id limit 1;
 if t.id is null then return jsonb_build_object('claimed',false);end if;
 -- Keep the existing workspace -> archive -> global budget -> owner ordering.
 select *into w from public.reader_workspaces where user_id=t.user_id for key share;
 select *into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select *into b from public.content_analysis_budget where id for update;
 select *into op from public.reader_content_analysis_policies where user_id=t.user_id for update;
 select *into p from public.social_content_policies where user_id=t.user_id for share;
 select *into t from public.social_content_tasks where id=t.id for update skip locked;
 if t.id is null or p.enabled is distinct from true or t.state not in('queued','running')or(t.state='running'and t.lease_until>clock_timestamp())then
  return jsonb_build_object('claimed',false);end if;
 if b.enabled is distinct from true or op.enabled is distinct from true then return jsonb_build_object('claimed',false,'reason','automatic_processing_paused');end if;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.social_content_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 end if;
 utc_day:=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_day from public.reader_content_analysis_calls where user_id=t.user_id;
 if reason is null then
  if global_day+.10>least(b.daily_limit_usd,5)or owner_day+.10>least(op.daily_limit_usd,5)then reason:='analysis_daily_budget_exhausted';
  elsif op.per_call_limit_usd<.10 then reason:='analysis_call_limit';end if;
 end if;
 if t.session_id is not null then
  select *into s from public.keyword_learning_sessions where id=t.session_id for update;
  if reason is null and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=t.session_id and c.actual_usd is null)then reason:='analysis_unknown_charge_hold';
  elsif reason is null and(s.id is null or s.state<>'released'or s.expires_at<=clock_timestamp())then
   if t.state='queued' and t.error_code='provider_monthly_budget_exhausted' and s.state='released' then
    resumed_at:=clock_timestamp();
    update public.keyword_learning_sessions set budget_resumed_at=resumed_at,expires_at=resumed_at+interval '24 hours'
     where id=s.id returning * into s;
   else reason:='automatic_session_expired';end if;
  end if;
 end if;
 if reason is not null then
  update public.social_content_tasks set state='blocked',error_code=reason,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then
   update public.keyword_learning_sessions set state='closed'where id=t.session_id and state<>'closed';
  end if;
  return jsonb_build_object('claimed',false,'reason',reason,'taskId',t.id);
 end if;
 if t.session_id is null then
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values(t.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',t.update_id,'sourceHash',t.content_hash,'sourceRevision',t.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],
    p.session_budget_usd,
    p.max_calls,clock_timestamp()+interval'24 hours')returning*into s;
 end if;
 update public.social_content_tasks set state='running',session_id=s.id,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_claims=lease_claims+1,error_code=null
  where id=t.id returning*into t;
 return jsonb_build_object('claimed',true,'task',to_jsonb(t),'record',t.source_snapshot,'leaseToken',t.lease_token);
end;
$$;

create or replace function public.finish_social_content_task(p_task_id uuid,p_lease_token uuid,p_result jsonb default null,p_error_code text default null)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.social_content_tasks;a public.reader_source_updates;w public.reader_workspaces;
 s public.keyword_learning_sessions;keys jsonb;entry jsonb;point jsonb;chosen jsonb;provenance jsonb;reason text;label text;kind text;
 amount integer:=0;inserted integer;unknown_call boolean;key_count integer;
begin
 if p_task_id is null or p_lease_token is null or(p_error_code is null and p_result is null)
  or(p_error_code is not null and(p_error_code!~'^[a-z][a-z0-9_]{0,79}$'or p_result is not null))
  or(p_result is not null and(jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>2000000))then
  raise exception 'Invalid automatic task result'using errcode='PT400';end if;
 select*into t from public.social_content_tasks where id=p_task_id;
 if not found then raise exception 'Social task unavailable'using errcode='PT409';end if;
 select*into w from public.reader_workspaces where user_id=t.user_id for key share;
 select*into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select*into t from public.social_content_tasks where id=p_task_id for update;
 if t.state<>'running'or t.lease_token is distinct from p_lease_token or t.lease_until<=clock_timestamp()then
  raise exception 'Social task lease changed'using errcode='PT409';end if;
 select*into s from public.keyword_learning_sessions where id=t.session_id for update;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.social_content_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 elsif not exists(select 1 from public.social_content_policies p where p.user_id=t.user_id and p.enabled)then reason:='automatic_processing_paused';
 elsif s.state is distinct from'released'or s.expires_at<=clock_timestamp()then reason:='automatic_session_expired';end if;
 select coalesce(jsonb_agg(r.call_key order by r.created_at,r.call_key),'[]'::jsonb),count(*),coalesce(bool_or(c.actual_usd is null),false)
  into keys,key_count,unknown_call from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
  where r.session_id=t.session_id and r.source_ordinal=1 and r.source_hash=t.content_hash and c.user_id=t.user_id;
 if reason is null and p_error_code in ('automatic_worker_yield','provider_monthly_budget_exhausted') and not unknown_call then
  update public.social_content_tasks set state='queued',error_code=p_error_code,lease_token=null,lease_until=null where id=t.id;
  return jsonb_build_object('state','queued','reviewCount',0,'sessionId',s.id);
 end if;
 if reason is null then reason:=case when unknown_call then'analysis_unknown_charge_hold'else p_error_code end;end if;
 provenance:=jsonb_build_object('origin','automatic_content','purpose','social_text','sessionId',s.id,'callKeys',keys,'sourceRevision',t.source_revision,
  'message','Automatically generated draft. Administrator confirmation is required; nothing was published.');
 if reason is not null then
  -- Operational stops stay in task monitoring. Real attempted provider failures
  -- retain one inspectable inbox row, with no invented empty generated finding.
  if reason not in('automatic_worker_yield','automatic_source_changed','automatic_processing_paused','automatic_session_expired',
    'analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_input_limit')
   and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
    where r.session_id=s.id and r.completed and c.result_at is not null)then
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,case when t.task='recap'then'recap'else'keyword'end,
     'social:'||t.id::text||':failure',t.source_snapshot,'{}',
     'Social generation could not provide a validated draft ('||reason||'). Inspect the saved source and prompt, then edit or reject.',provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics amount=row_count;
  end if;
  update public.social_content_tasks set state=case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,
   error_code=reason,review_count=amount,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then update public.keyword_learning_sessions set state='closed'where id=s.id;end if;
  return jsonb_build_object('state',case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,'errorCode',reason,'reviewCount',amount);
 end if;
 if key_count=0 or jsonb_typeof(p_result->'callKeys')is distinct from'array'
  or jsonb_array_length(p_result->'callKeys')<>key_count or not((p_result->'callKeys')@>keys and keys@>(p_result->'callKeys'))
  or exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=s.id and(not r.completed or r.result is null or r.error_code is not null or r.source_ordinal<>1 or r.source_hash<>t.content_hash or c.user_id<>t.user_id or c.actual_usd is null))then
  raise exception 'Exact completed automatic call evidence is required'using errcode='PT409';end if;
 if t.task='keywords'then
  if p_result->>'kind'is distinct from'keywords'or jsonb_typeof(p_result->'proposals')is distinct from'array'or jsonb_array_length(p_result->'proposals')>5000 then
   raise exception 'Invalid automatic keyword proposals'using errcode='PT400';end if;
  for entry in select value from jsonb_array_elements(p_result->'proposals')loop
   label:=btrim(entry->>'label');kind:=entry->>'kind';
   if jsonb_typeof(entry)is distinct from'object'or(entry-array['label','kind','reason'])<>'{}'::jsonb
    or jsonb_typeof(entry->'label')is distinct from'string'or char_length(label)not between 1 and 100 or label~'[[:cntrl:]]'
    or kind is null or kind not in('brand','product','game','technology','category')then
    raise exception 'Invalid automatic keyword proposal'using errcode='PT400';end if;
   reason:=coalesce(nullif(btrim(entry->>'reason'),''),'AI keyword draft; confirm its relevance and identity, edit or reject.');
   if strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    reason:='Name does not occur literally in the saved source. Correct it from that source or reject. '||reason;
   end if;
   if char_length(reason)>2000 then raise exception 'Social reason is too long'using errcode='PT400';end if;
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,'keyword','social:'||t.id::text||':keyword:'||encode(sha256(convert_to(public.keyword_review_label_key(label),'UTF8')),'hex'),
     t.source_snapshot,jsonb_build_object('label',label,'kind',kind),reason,provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics inserted=row_count;amount:=amount+inserted;
  end loop;
 else
  chosen:=p_result->'proposal';
  if p_result->>'kind'is distinct from'recap'or jsonb_typeof(chosen)is distinct from'object'or(chosen-'highlights')<>'{}'::jsonb
   or jsonb_typeof(chosen->'highlights')is distinct from'array'or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'Social recap needs one to six cited points'using errcode='PT400';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb
    or jsonb_typeof(point->'text')is distinct from'string'or char_length(btrim(point->>'text'))not between 1 and 500
    or cardinality(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'))>38
    or jsonb_typeof(point->'evidenceQuote')is distinct from'string'or char_length(btrim(point->>'evidenceQuote'))not between 15 and 1000
    or strpos(a.record->>'content',point->>'evidenceQuote')=0 then
    raise exception 'Social recap needs exact supporting source quotes'using errcode='PT400';end if;
  end loop;
  reason:=coalesce(nullif(btrim(p_result->>'reason'),''),'AI recap draft; check the cited source, then confirm, edit or reject.');
  if char_length(reason)>2000 then raise exception 'Social reason is too long'using errcode='PT400';end if;
  insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
   values(t.user_id,t.update_id,t.source_id,t.content_hash,'recap','social:'||t.id::text||':recap',t.source_snapshot,chosen,reason,provenance)
   on conflict(dedupe_key)do nothing;
  get diagnostics amount=row_count;
 end if;
 update public.social_content_tasks set state='review',review_count=amount,error_code=null,lease_token=null,lease_until=null where id=t.id;
 update public.keyword_learning_sessions set state='closed'where id=s.id;
 return jsonb_build_object('state','review','reviewCount',amount);
end;
$$;

create or replace function public.claim_content_analysis_job_v2(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 if exists(select 1 from public.monthly_provider_budget_snapshot(clock_timestamp()) where committed_usd>=limit_usd) then return null; end if;
 -- Admission claim has independent scope; the old manifest remains paused/unchanged.
 for candidate in select q.* from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  where q.generation_admission_id is not null and (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared') or (q.state='blocked' and q.error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted'))) and q.next_attempt_at<=clock_timestamp()
   and (q.lease_until is null or q.lease_until<=clock_timestamp()) and public.content_analysis_admission_current(q.id)
  order by q.created_at,q.id limit 100
 loop
  select * into w from public.reader_workspaces where user_id=candidate.user_id for share;
  select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.reader_content_analysis_jobs where id=candidate.id for update skip locked;
  if not found or not (j.state in ('queued','running','prepared') or (j.state='blocked' and j.error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted')))
   or j.next_attempt_at>clock_timestamp() or j.lease_until>clock_timestamp() then continue; end if;
  -- Lifecycle transitions lock every admitted job first; this held job lock
 -- serializes state changes without granting service mutation on admissions.
  perform 1 from public.content_analysis_budget where id for update;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
  if public.content_analysis_admission_current(j.id) is distinct from true then return null; end if;
  if j.attempts>=3 and j.state='running' then
   update public.reader_content_analysis_jobs set state='failed',lease_token=null,lease_until=null,error_code='analysis_lease_expired',next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   return null;
  end if;
  token:=gen_random_uuid();
  update public.reader_content_analysis_jobs set state=case when state='prepared' then 'prepared' else 'running' end,
   lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=attempts+case when state='prepared' then 0 else 1 end,
   error_code=null,updated_at=clock_timestamp() where id=j.id returning * into j;
  if not public.content_analysis_is_comparison_job(j.id) then
  proc:=public.content_analysis_processing(a.record,j.content_hash);
  proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"running"'::jsonb)||jsonb_build_object('updatedAt',clock_timestamp());
  update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
  end if;
  update public.reader_content_analysis_policies set last_served_at=clock_timestamp() where user_id=j.user_id;
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token,'generationContext',jsonb_build_object(
   'protocolVersion',j.rule_version,'generationContractHash',j.generation_contract_hash,'predecessorJobId',j.generation_predecessor_job_id,
   'admissionId',j.generation_admission_id,'purpose',(select purpose from public.content_analysis_admissions where id=j.generation_admission_id))
   ||case when public.content_analysis_is_comparison_job(j.id) then jsonb_build_object('commonLimits',(select manifest->'commonLimits' from public.content_analysis_admissions where id=j.generation_admission_id)) else '{}'::jsonb end
   ||(public.content_analysis_admission_slot(j.id)-array['jobId','predecessorJobId','updateId','sourceId','task','contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','predecessorLedgerHash']));
 end loop;
 for candidate in select q.id,q.user_id,q.update_id from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  join public.reader_source_updates r on r.user_id=q.user_id and r.id=q.update_id
  where q.generation_admission_id is null and q.rule_version in ('content-v2','content-v3') and public.content_analysis_generation_job_in_scope(q.id)
   and exists(select 1 from public.content_analysis_budget b where b.id and b.enabled)
   and (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared','failed') or (q.state='blocked' and q.error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted')))
   and not (q.rule_version='content-v3' and q.state='failed')
   and q.next_attempt_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
   -- Expired running leases MUST reach the under-lock terminal cleanup even
   -- after attempt three. Daily pauses resume independently of that counter.
   and (q.attempts<3 or q.state in ('running','prepared') or (q.state='blocked' and q.error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted')))
  order by r.published_at desc,q.created_at,q.id limit 100
 loop
  select * into w from public.reader_workspaces where user_id=candidate.user_id for share;
  if not found then continue; end if;
  -- UPDATE rather than SHARE: claiming also publishes truthful running state.
  -- Sibling tasks cannot deadlock by each upgrading an archive SHARE lock.
  select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.reader_content_analysis_jobs where id=candidate.id for update skip locked;
  if not found then continue; end if;
  if not (j.state in ('queued','running','prepared','failed') or (j.state='blocked' and j.error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted')))
   or (j.rule_version='content-v3' and j.state='failed')
   or j.next_attempt_at>clock_timestamp() or j.lease_until>clock_timestamp() then continue; end if;
  if not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or j.source_revision<>public.content_analysis_source_revision(a.record)
   or j.source_fingerprint<>public.content_analysis_source_fingerprint(w.state,a.source_id) then
   update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if not public.content_analysis_generation_job_in_scope(j.id) then continue; end if;
  if public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) then
   update public.reader_content_analysis_jobs set state='blocked',error_code='analysis_unknown_charge_hold',
    lease_token=null,lease_until=null,next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if public.content_analysis_generation_job_completed(j.id,a.record) then
   update public.reader_content_analysis_jobs set state='skipped',lease_token=null,lease_until=null,
    error_code=null,updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if j.state='running' and j.attempts>=3 then
   -- A crashed third worker can no longer publish or reserve. Close its lease
   -- and reader-visible state; caches/unknown monetary commitments survive.
   update public.reader_content_analysis_jobs set state='failed',error_code='analysis_lease_expired',
    lease_token=null,lease_until=null,next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   proc:=public.content_analysis_processing(a.record,j.content_hash);
   proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"failed"'::jsonb)
    ||jsonb_build_object('reason','analysis_lease_expired','updatedAt',clock_timestamp());
   update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
   continue;
  end if;
  if j.attempts>=3 and j.state not in ('prepared','blocked') then continue; end if;
  if j.rule_version='content-v3' and not public.content_analysis_generation_v3_withhold_valid(j.id,a.record) then
   update public.reader_content_analysis_jobs set state='failed',error_code='analysis_annotation_changed',lease_token=null,lease_until=null,next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  -- Recheck actual gates under the established financial lock order. Return
  -- rather than scan another archive while holding these financial locks.
  perform 1 from public.content_analysis_budget where id and enabled for share;
  if not found then return null; end if;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id and enabled for update;
  if not found then return null; end if;
  if j.generation_comparison_id is not null and public.content_analysis_model_comparison_current(j.id) is distinct from true then return null; end if;
  token:=gen_random_uuid();
  update public.reader_content_analysis_jobs set lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   state=case when state='prepared' then 'prepared' else 'running' end,
   attempts=attempts+case when state='prepared' then 0 else 1 end,error_code=null,updated_at=clock_timestamp()
   where id=j.id returning * into j;
  proc:=public.content_analysis_processing(a.record,j.content_hash);
  proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"running"'::jsonb)
   ||jsonb_build_object('updatedAt',clock_timestamp());
  update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
  -- Persist fairness only after a real claim. Empty queues and terminal-lease
  -- cleanup never move a reader behind others or reserve any model budget.
  update public.reader_content_analysis_policies set last_served_at=clock_timestamp() where user_id=j.user_id;
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token)||case when j.rule_version='content-v3' then jsonb_build_object('generationContext',jsonb_build_object(
   'protocolVersion','content-v3','generationContractHash',j.generation_contract_hash,'predecessorJobId',j.generation_predecessor_job_id,
   'emptyDisposition',public.content_analysis_generation_v3_slot(j.id)->>'emptyDisposition',
   'sourceReviewDigest',public.content_analysis_generation_v3_slot(j.id)->'sourceReviewDigest')
   ||case when j.generation_comparison_id is null then '{}'::jsonb else jsonb_build_object('comparisonId',j.generation_comparison_id) end) else '{}'::jsonb end;
 end loop;
 return null;
end;
$$;

create or replace function public.fail_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false,p_yield boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; state_name text; rec jsonb; proc jsonb;
 due timestamptz; known public.reader_content_analysis_calls; controlled boolean:=false; materialized integer;
begin
 if p_lease_token is null or p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$'
  or p_retryable is null or p_yield is null then raise exception 'Invalid failure' using errcode='PT400'; end if;
 -- Revoked permission can stop work but must not strand a running lease.
 -- This branch only closes that exact lease; it never reserves/publishes and
 -- never modifies source text, decisions, results or monetary evidence.
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if j.generation_admission_id is not null and public.content_analysis_admission_current(j.id) is distinct from true then
  perform 1 from public.reader_workspaces where user_id=j.user_id for share;
  select record into rec from public.reader_source_updates where user_id=j.user_id and id=j.update_id for update;
  select * into j from public.reader_content_analysis_jobs where id=p_job_id for update;
  if j.id is null or j.lease_token is distinct from p_lease_token or j.state not in ('running','prepared') then
   raise exception 'Analysis failure lease changed' using errcode='PT409'; end if;
  update public.reader_content_analysis_jobs set state='blocked',error_code='analysis_admission_changed',lease_token=null,lease_until=null,
   next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
  if not public.content_analysis_is_comparison_job(j.id) and rec is not null and encode(sha256(convert_to(rec->>'content','UTF8')),'hex')=j.content_hash
   and not public.content_analysis_admission_task_completed(rec,j.content_hash,j.task) then
   proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason','analysis_admission_changed','updatedAt',clock_timestamp());
   proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"blocked"'::jsonb);
   update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
  end if;
  return jsonb_build_object('failed',true,'jobId',j.id,'state','blocked','retryAt',null);
 end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state not in ('running','prepared') then raise exception 'Job not active' using errcode='PT409'; end if;
 if j.rule_version in ('content-v2','content-v3','content-v4') and p_yield then
  select count(*) into materialized from public.reader_content_analysis_calls where job_id=j.id and result is not null;
  update public.reader_content_analysis_jobs set continuation_result_count=materialized,
   continuation_stalls=case when materialized>continuation_result_count then 0 else least(3,continuation_stalls+1) end
   where id=j.id returning * into j;
  if j.continuation_stalls>=3 then
   p_yield:=false; p_retryable:=false; p_error_code:='analysis_no_progress';
  end if;
 end if;
 if p_error_code in ('analysis_provider_rate_limited','analysis_provider_retry_exhausted','analysis_provider_cooldown') then
  -- Same ordering as reserve and receipt; do not take a call lock first.
  perform 1 from public.content_analysis_budget where id for update;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
  select * into known from public.reader_content_analysis_calls
   where job_id=j.id and rejection_receipt is not null
    and (lease_token=p_lease_token or (p_error_code='analysis_provider_retry_exhausted' and attempt_number=3))
   order by retry_not_before desc limit 1 for update;
  if p_error_code in ('analysis_provider_rate_limited','analysis_provider_retry_exhausted') then
   if not found or known.generation_receipt is null or known.actual_usd is distinct from 0::numeric
    or (p_error_code='analysis_provider_retry_exhausted' and known.attempt_number<>3)
    or (known.attempt_number<3 and not known.retry_authorized) then raise exception 'Verified zero generation receipt required' using errcode='PT409'; end if;
   due:=greatest(known.retry_not_before,(select cooldown_until from public.content_analysis_provider_cooldowns
    where identity_key=public.content_analysis_provider_key(known.execution_identity)));
   state_name:=case when known.attempt_number<3 and p_retryable then 'queued' else 'failed' end;
  else
   -- Only the exact prior circuit denial for this job/lease can yield it.
   select greatest(q.retry_at,d.cooldown_until) into due
    from public.content_analysis_provider_pauses q
    join public.content_analysis_provider_cooldowns d on d.identity_key=q.identity_key
    where q.job_id=j.id and q.lease_token=p_lease_token;
   if due is null or due<=clock_timestamp() then raise exception 'Provider cooldown unavailable' using errcode='PT409'; end if;
   state_name:='queued'; controlled:=true;
  end if;
 else
  state_name:=case when j.rule_version in ('content-v3','content-v4') and p_error_code='analysis_storage_unavailable' and p_retryable and j.attempts<3 then 'queued'
   when p_error_code='analysis_provider_http_429' then 'blocked' when p_yield then 'queued'
   when p_error_code in ('analysis_provider_http_429','provider_monthly_budget_exhausted','analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_correction_charge_unknown','analysis_cached_input_changed','analysis_state_conflict','analysis_admission_changed','analysis_admin_decision_changed','analysis_annotation_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
   else 'failed' end;
 end if;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_error_code='analysis_provider_http_429' then 'infinity'::timestamptz when due is not null then case when state_name='queued' then due else 'infinity'::timestamptz end
   when p_yield then clock_timestamp()+interval '1 second'
   when j.rule_version in ('content-v3','content-v4') and state_name='queued' and p_error_code='analysis_storage_unavailable' then clock_timestamp()+interval '1 minute'
   when p_error_code='provider_monthly_budget_exhausted' then (date_trunc('month',clock_timestamp() at time zone 'UTC')+interval '1 month') at time zone 'UTC'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when j.rule_version not in ('content-v3','content-v4') and state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  -- Queue claim attempts are separate from monetary attempts on a stable key.
  -- Known429 attempt limits live in calls; unrelated claim/yield pauses cannot
  -- prematurely exhaust a safe, due monetary retry.
  attempts=case when due is not null and state_name='queued' then greatest(0,attempts-1)
   else greatest(0,attempts-case when p_yield or p_error_code in ('analysis_daily_budget_exhausted','provider_monthly_budget_exhausted') then 1 else 0 end) end,
  updated_at=clock_timestamp() where id=j.id;
 if not public.content_analysis_is_comparison_job(j.id) then
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield or controlled or (j.rule_version in ('content-v3','content-v4') and state_name='queued') then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 end if;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name,'retryAt',case when state_name='queued' then due else null end);
end;
$$;

commit;
