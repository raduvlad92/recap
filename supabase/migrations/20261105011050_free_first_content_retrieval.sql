begin;
-- Administrative method-level telemetry. Never store raw text, URLs, cookies,
-- credentials or arbitrary provider messages in diagnostic fields.
create table public.collection_retrieval_attempts (
 id uuid primary key default gen_random_uuid(),
 check_id uuid references public.reader_collection_checks(id) on delete cascade,
 job_id uuid references public.collection_jobs(id) on delete cascade,
 item_key text check(item_key ~ '^(youtube:[A-Za-z0-9_-]{11}|youtube-discovery:UC[A-Za-z0-9_-]{22}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
 method text not null check(method ~ '^[a-z][a-z0-9_]{0,79}$'),
 stage text not null check(stage in('discovery','content')),
 provider text not null check(provider in('native','apify')),
 status text not null default 'running' check(status in('running','succeeded','partial','empty','failed','blocked')),
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 http_status integer check(http_status between 100 and 599),
 error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 result_count integer check(result_count>=0),
 provider_run_id text check(provider_run_id ~ '^[A-Za-z0-9]{6,64}$'),
 diagnostics jsonb not null default '{}' check(jsonb_typeof(diagnostics)='object' and octet_length(diagnostics::text)<=4096),
 check(num_nonnulls(check_id,job_id)=1),
 check((status='running' and finished_at is null)or(status<>'running' and finished_at is not null))
);
create index retrieval_attempts_check on public.collection_retrieval_attempts(check_id,started_at,id) where check_id is not null;
create index retrieval_attempts_job on public.collection_retrieval_attempts(job_id,started_at,id) where job_id is not null;
alter table public.collection_retrieval_attempts enable row level security;
revoke all on public.collection_retrieval_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.collection_retrieval_attempts to service_role;

create function public.retrieval_attempt_identity_guard()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if old.status<>'running' or (new.id,new.check_id,new.job_id,new.item_key,new.method,new.stage,new.provider,new.started_at)is distinct from(old.id,old.check_id,old.job_id,old.item_key,old.method,old.stage,old.provider,old.started_at) then raise exception 'Immutable retrieval evidence changed'using errcode='PT409';end if;
 return new;
end;$$;
revoke all on function public.retrieval_attempt_identity_guard()from public,anon,authenticated,service_role;
create trigger retrieval_attempt_identity_guard before update on public.collection_retrieval_attempts for each row execute function public.retrieval_attempt_identity_guard();

-- Discovery reuses the existing reader/global caps with a distinct once-per-UTC-day channel key.
create or replace function public.reserve_hourly_provider(p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_actor_id text,p_maximum_usd numeric,p_parent_reservation_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; p public.reader_collection_policies; r public.collection_budget_reservations; j public.reader_collection_provider_jobs; daily numeric; lifetime numeric; claimed jsonb;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into p from public.reader_collection_policies where user_id=e.user_id for update;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if not coalesce(p.enabled and p.provider_enabled,false) or e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Provider disabled or lease changed' using errcode='PT409'; end if;
 if not exists(select 1 from public.reader_workspaces w where w.user_id=e.user_id and w.updated_at=s.workspace_revision and w.state->'followedSourceIds' ? e.source_id and exists(select 1 from jsonb_array_elements(w.state->'customSources') x where x->>'id'=e.source_id and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)) then raise exception 'Follow changed' using errcode='PT409'; end if;
 if p_item_key is null or not coalesce((
  p_item_key ~ '^youtube:[A-Za-z0-9_-]{11}$'
  or (e.platform='YouTube' and p_actor_id='h7sDV53CddomktSi5' and p_maximum_usd<=0.02
   and p_item_key='youtube-discovery:'||coalesce(s.channel_id,substring(e.source_url from '/channel/(UC[A-Za-z0-9_-]{22})'))||':'||(clock_timestamp()at time zone'UTC')::date::text)
 ),false) or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>0.10 then raise exception 'Invalid provider reservation' using errcode='PT400'; end if;
 if not exists(select 1 from public.collection_jobs where id=p_job_id and user_id=e.user_id and source_id=e.source_id and provider='apify' and actor_id=p_actor_id and status='requested') then raise exception 'Job unavailable' using errcode='PT409'; end if;
 select * into j from public.reader_collection_provider_jobs where user_id=e.user_id and source_id=e.source_id and item_key=p_item_key;
 if j.id is not null then return jsonb_build_object('claimed',false,'id',j.id); end if;
 select coalesce(sum(case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd) else greatest(actual_cost_usd,observed_cost_usd) end),0),
  coalesce(sum(case when created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or actual_cost_usd is null then case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd) else greatest(actual_cost_usd,observed_cost_usd) end else 0 end),0)
  into lifetime,daily from public.reader_collection_provider_jobs where user_id=e.user_id;
 if daily+p_maximum_usd>p.daily_limit_usd or lifetime+p_maximum_usd>p.lifetime_limit_usd then raise exception 'Reader budget exhausted' using errcode='PT402'; end if;
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

-- Existing paid jobs/holds are untouched. New normal jobs reserve only when free methods fail.
alter table public.social_collection_jobs alter column reservation_id drop not null;
create or replace function public.social_job_identity_guard()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if new.reservation_id is distinct from old.reservation_id and not(old.reservation_id is null and new.reservation_id is not null and old.state='claimed'and new.state='launch_claimed')then raise exception'Social reservation changed'using errcode='PT409';end if;
 if(new.id,new.source_key,new.platform,new.purpose,new.window_from,new.window_to,new.config,new.collection_job_id,new.consumers,new.created_at)is distinct from(old.id,old.source_key,old.platform,old.purpose,old.window_from,old.window_to,old.config,old.collection_job_id,old.consumers,old.created_at)
 or(old.provider_run_id is not null and new.provider_run_id is distinct from old.provider_run_id)or(old.dataset_id is not null and new.dataset_id is distinct from old.dataset_id)
 or(old.actual_usd is not null and(new.actual_usd is null or new.actual_usd<old.actual_usd))then raise exception'Immutable social job evidence changed'using errcode='PT409';end if;
 return new;
end;$$;
create or replace function public.claim_social_collection_job(p_allow_launch boolean default false)returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.social_collection_sources;p public.social_collection_platforms;j public.social_collection_jobs;r public.collection_budget_reservations;consumer jsonb;members jsonb;ledger uuid;cost numeric;daily numeric;token uuid;moment timestamptz:=clock_timestamp();
begin
 -- Accepted jobs remain reconcilable with the platform stopped. An ambiguous
 -- POST without a run reference is deliberately never automatically relaunched.
 select * into j from public.social_collection_jobs where provider_run_id is not null and(state='running'or(state='completed'and actual_usd is null))and lease_until<moment and next_poll_at<=moment order by next_poll_at,created_at for update skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning * into j;
  select * into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 if not p_allow_launch then return null;end if;
 -- A claim whose launch marker was never written is safe to resume using
 -- the same reservation. Once marked, an unknown POST is never relaunched.
 select q.*into j from public.social_collection_jobs q
 join public.social_collection_platforms reviewed_platform on reviewed_platform.platform=q.platform and reviewed_platform.enabled
 where q.purpose='collection'and q.state='claimed'and q.provider_run_id is null and q.lease_until<moment
 order by q.created_at,q.id for update of q skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning*into j;
  select*into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 -- One fresh-claim gate across all platforms and scheduler invocations. The
 -- organization currently allows five Actor jobs. At most three outstanding
 -- social admissions leave two nominal slots for the existing YouTube route.
 -- Reconciliation and a provably unlaunched claim above consume no new slot.
 if not pg_catalog.pg_try_advisory_xact_lock(734601,3101) then return null;end if;
 if(select count(*)from public.social_collection_jobs
   where state in('claimed','launch_claimed','running'))>=3 then return null;end if;
 -- Lock platform before source. All reservations serialize through the existing
 -- global account, without changing the old YouTube policy/caps.
 select q.* into p from public.social_collection_platforms q where enabled
 and exists(select 1 from public.social_collection_sources a where a.platform=q.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.purpose='collection'and z.state in('claimed','launch_claimed','running','ambiguous')))order by q.platform for update skip locked limit 1;
 if p.platform is null then return null;end if;
 select a.* into s from public.social_collection_sources a where a.platform=p.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.purpose='collection'and z.state in('claimed','launch_claimed','running','ambiguous'))order by a.next_check_at,a.source_key for update skip locked limit 1;
 if s.source_key is null then return null;end if;
 select jsonb_agg(to_jsonb(c)order by c.user_id,c.source_id)into members from public.social_collection_consumers c where c.source_key=s.source_key;
 consumer:=members->0;if consumer is null then return null;end if;
 token:=gen_random_uuid();
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status,cost_status)values(consumer->>'user_id',consumer->>'source_id',s.source_name,s.source_url,s.platform,'feed',null,'requested','no_provider_charge')returning id into ledger;
 insert into public.collection_job_consumers(job_id,user_id)select ledger,value->>'user_id'from jsonb_array_elements(members)on conflict do nothing;
 insert into public.social_collection_jobs(id,source_key,platform,window_from,window_to,config,reservation_id,collection_job_id,consumers)values(token,s.source_key,s.platform,greatest(moment-interval'24 hours',coalesce(s.last_discovered_until-interval'2 hours',moment-interval'24 hours')),moment,to_jsonb(p),null,ledger,members)returning * into j;
 return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
end;$$;
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
  if cost+p.maximum_usd>p.lifetime_limit_usd or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
  r:=public.reserve_collection_budget('social.'||j.id::text,p.maximum_usd,'job',null,'apify',p.actor_id);
  j.reservation_id:=r.id;
 end if;
 answer:=public.claim_collection_budget(j.reservation_id);
 if answer->'claimed'<>'true'::jsonb then return false;end if;
 update public.social_collection_jobs set state='launch_claimed',reservation_id=j.reservation_id where id=j.id;
 update public.collection_jobs set status='running',provider='apify',actor_id=p.actor_id,cost_status='unknown',observed_cost_usd=null where id=j.collection_job_id;return true;
end;$$;
create or replace function public.finish_social_collection_job(p_id uuid,p_lease uuid,p_items jsonb,p_coverage jsonb,p_actual_usd numeric,p_terminal boolean,p_error text default null)returns jsonb language plpgsql security invoker set search_path='' as $$
declare native_result boolean;j public.social_collection_jobs;member jsonb;w public.reader_workspaces;src jsonb;item jsonb;rec jsonb;k text;aid text;oldrec jsonb;sent public.social_collection_deliveries;inserted integer:=0;source_name text;current_revision text;finished timestamptz:=clock_timestamp();
begin
 select * into j from public.social_collection_jobs where id=p_id for update;
 if j.id is null or j.lease_token is distinct from p_lease or j.lease_until<finished then raise exception'Social lease changed'using errcode='PT409';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array'or jsonb_array_length(p_items)>coalesce((j.config->>'max_items')::integer,0)or jsonb_typeof(p_coverage)<>'object'or p_actual_usd<0 then raise exception'Invalid social result'using errcode='PT400';end if;
 -- Hourly collection and workspace clearing take reader policy locks before
 -- the shared financial account. Match that order before settlement/import.
 perform 1 from public.reader_collection_policies p
 where p.user_id in(select value->>'user_id'from jsonb_array_elements(j.consumers))
 order by p.user_id collate "C" for update;
 if j.provider_run_id is not null then perform public.settle_collection_budget(j.reservation_id,j.provider_run_id,p_actual_usd,p_terminal);end if;
 if j.state='claimed'and p_error is not null then
  if j.reservation_id is not null then perform public.release_collection_budget(j.reservation_id);end if;
  update public.social_collection_jobs set state='failed',error_code=p_error,coverage=p_coverage,finished_at=finished,lease_until=finished where id=j.id;
  update public.social_collection_sources set next_check_at=finished+interval'1 hour',last_coverage=p_coverage where source_key=j.source_key and j.purpose='collection';
  update public.collection_jobs set status='blocked',error_code=p_error,finished_at=finished where id=j.collection_job_id;
  return jsonb_build_object('imported',0);
 end if;
 if not p_terminal then
  update public.social_collection_jobs set state=case when provider_run_id is null then'ambiguous'else'running'end,error_code=p_error,coverage=p_coverage,lease_until=finished,next_poll_at=finished+interval'5 minutes'where id=j.id;
  return jsonb_build_object('imported',0);
 end if;
 native_result:=j.provider_run_id is null and j.state='claimed' and p_coverage->>'retrieval'='native' and p_actual_usd=0 and p_error is null;
 if j.provider_run_id is null and not coalesce(native_result,false) then raise exception'Missing actual run'using errcode='PT409';end if;
 if native_result and j.reservation_id is not null then if j.reservation_id is not null then perform public.release_collection_budget(j.reservation_id);end if;end if;
 for item in select value from jsonb_array_elements(p_items)loop
  rec:=item->'record';k:=public.social_item_key(j.platform,rec->>'url');
  if k is null or k is distinct from item->>'itemKey'or rec->'isSample'is distinct from'false'::jsonb or rec->>'format'<>'post'or item->>'revision'!~'^[a-f0-9]{64}$'or rec->>'sourceId' is distinct from j.source_key or(rec->>'publishedAt')::timestamptz<j.window_from or(rec->>'publishedAt')::timestamptz>=j.window_to then raise exception'Invalid source attribution'using errcode='PT400';end if;
  insert into public.social_collection_items(source_key,item_key,revision,record,job_id)values(j.source_key,k,item->>'revision',rec,j.id)on conflict do nothing;
 end loop;
 -- Match reset/provider lock order: owner policy, workspace, then archive.
 for member in select value from jsonb_array_elements(j.consumers)order by value->>'user_id',value->>'source_id'loop
  perform 1 from public.reader_collection_policies where user_id=member->>'user_id'and enabled for update;
  if not found then continue;end if;
  select * into w from public.reader_workspaces where user_id=member->>'user_id'for share;
  if w.user_id is null or w.updated_at is distinct from(member->>'workspace_revision')::timestamptz or not coalesce(w.state->'followedSourceIds','[]')?(member->>'source_id')then continue;end if;
  select x into src from jsonb_array_elements(coalesce(w.state->'customSources','[]'))x where x->>'id'=member->>'source_id'limit 1;
  if src is null or md5(src::text)is distinct from member->>'source_fingerprint'or public.social_source_key(src->>'platform',src->>'url')is distinct from j.source_key then continue;end if;
  -- A settings revision may have fenced a previous in-flight import, or a new
  -- follower may have joined an already shared source. Deliver bounded cached
  -- originals without paying to retrieve those older identities a second time.
  for item in
   select value from jsonb_array_elements(p_items)
   union all
   select jsonb_build_object('itemKey',cached.item_key,'revision',cached.revision,'record',cached.record)from(
    select distinct on(c.item_key)c.* from public.social_collection_items c join public.social_collection_jobs previous on previous.id=c.job_id
    where c.source_key=j.source_key and previous.purpose='collection'and c.collected_at>=finished-interval'24 hours'
     and not exists(select 1 from jsonb_array_elements(p_items)x where x->>'itemKey'=c.item_key)
     and not exists(select 1 from public.social_collection_deliveries d where d.user_id=w.user_id and d.source_id=member->>'source_id'and d.item_key=c.item_key)
    order by c.item_key,c.collected_at desc limit 100
   )cached
  loop
   rec:=item->'record';k:=item->>'itemKey';aid:=null;oldrec:=null;
   select * into sent from public.social_collection_deliveries where user_id=w.user_id and source_id=member->>'source_id'and item_key=k;
   if sent.deleted then continue;end if;
   select a.id,a.record into aid,oldrec from public.reader_source_updates a where a.user_id=w.user_id and a.source_id=member->>'source_id'and public.social_item_key(j.platform,a.record->>'url')=k order by a.collected_at limit 1;
   if aid is null then
    select x->>'id',x into aid,oldrec from jsonb_array_elements(coalesce(w.state->'importedUpdates','[]'))x where x->>'sourceId'=member->>'source_id'and x->'isSample'='false'::jsonb and public.social_item_key(j.platform,x->>'url')=k limit 1;
   end if;
   if sent.archive_id is not null and aid is null then continue;end if;
   aid:=coalesce(aid,'social-'||substr(md5((member->>'source_id')||chr(10)||k),1,32));
   if oldrec is null then
    rec:=rec||jsonb_build_object('id',aid,'sourceId',member->>'source_id');
    insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(w.user_id,aid,member->>'source_id','social',(rec->>'publishedAt')::timestamptz,rec)on conflict do nothing;
    if found then inserted:=inserted+1;end if;
   end if;
   -- Existing reader annotations/source versions are preserved. A changed public
   -- revision is retained above for explicit review rather than silently merged.
   insert into public.social_collection_deliveries(user_id,source_id,item_key,archive_id,source_key,revision)values(w.user_id,member->>'source_id',k,aid,j.source_key,item->>'revision')on conflict do nothing;
  end loop;
 end loop;
 update public.social_collection_jobs set state=case when p_error is null then'completed'else'failed'end,coverage=p_coverage,error_code=p_error,actual_usd=case when p_actual_usd is null then actual_usd else greatest(coalesce(actual_usd,0),p_actual_usd)end,finished_at=finished,lease_until=finished,next_poll_at=finished+interval'1 hour'where id=j.id;
 -- Progress records what was retrieved, not proven exhaustive coverage. A known
 -- cap freezes the source for reviewed recovery; never skip its unresolved tail.
 update public.social_collection_sources set next_check_at=finished+interval'1 hour',last_checked_at=finished,
  last_complete_until=case when p_coverage->'complete'='true'::jsonb then j.window_to else last_complete_until end,
  last_discovered_until=case when p_error is null and jsonb_array_length(p_items)>0 and coalesce(p_coverage->>'reason','')<>'result_limit_reached'then j.window_to else last_discovered_until end,
  paused_reason=case when p_coverage->>'reason'='result_limit_reached'then'result_limit_reached'else paused_reason end,last_coverage=p_coverage
 where source_key=j.source_key and j.purpose='collection';
 update public.collection_jobs set status=case when p_error is null then'succeeded'else'failed'end,result_count=jsonb_array_length(p_items),observed_cost_usd=case when p_actual_usd is null then observed_cost_usd else greatest(coalesce(observed_cost_usd,0),p_actual_usd)end,provider=case when native_result then'feed'else provider end,actor_id=case when native_result then null else actor_id end,cost_status=case when native_result then'no_provider_charge'when p_actual_usd is null then cost_status else'provider_reported'end,error_code=p_error,finished_at=coalesce(finished_at,finished)where id=j.collection_job_id;
 return jsonb_build_object('imported',inserted);
end;$$;
commit;
