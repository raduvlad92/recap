-- Retry only settled source acquisition less often; polling/unknown money stays unchanged.
-- Existing rows, approvals, source windows, policies and financial caps are untouched.
begin;

create index social_job_retry_history on public.social_collection_jobs(source_key,finished_at desc,id desc)
 where purpose='collection' and state in('completed','failed') and finished_at is not null;

create function public.social_collection_retry_delay(p_source_key text,p_job_id uuid,p_useful boolean,p_error text)
returns interval language plpgsql stable security invoker set search_path='' as $$
declare previous record;failures integer:=0;hours integer;
begin
 if p_useful then return interval '1 hour';end if;
 -- Five prior outcomes suffice for both finite caps. Proof jobs and other
 -- sources never influence a reader source's recurring collection cadence.
 for previous in
  select error_code,coverage from public.social_collection_jobs
  where source_key=p_source_key and id<>p_job_id and purpose='collection'
   and state in('completed','failed') and finished_at is not null
  order by finished_at desc,id desc limit 5
 loop
  if previous.error_code is null and jsonb_path_exists(coalesce(previous.coverage,'{}'),'$.accepted ? (@ > 0)')then exit;end if;
  failures:=failures+1;
 end loop;
 -- Empty output can mean a quiet account. Keep checking at least every six
 -- hours; persistent errors back off to one day. Useful content resets both.
 hours:=least(case when p_error is null then 6 else 24 end,
  (case when p_error is null then 1 else 2 end)*power(2,failures)::integer);
 return hours*interval '1 hour';
end;$$;
revoke all on function public.social_collection_retry_delay(text,uuid,boolean,text)from public,anon,authenticated;
grant execute on function public.social_collection_retry_delay(text,uuid,boolean,text)to service_role;

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
  update public.social_collection_sources set next_check_at=finished+public.social_collection_retry_delay(j.source_key,j.id,p_error is null and jsonb_array_length(p_items)>0,p_error),last_coverage=p_coverage where source_key=j.source_key and j.purpose='collection';
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
 update public.social_collection_sources set next_check_at=finished+public.social_collection_retry_delay(j.source_key,j.id,p_error is null and jsonb_array_length(p_items)>0,p_error),last_checked_at=finished,
  last_complete_until=case when p_coverage->'complete'='true'::jsonb then j.window_to else last_complete_until end,
  last_discovered_until=case when p_error is null and jsonb_array_length(p_items)>0 and coalesce(p_coverage->>'reason','')<>'result_limit_reached'then j.window_to else last_discovered_until end,
  paused_reason=case when p_coverage->>'reason'='result_limit_reached'then'result_limit_reached'else paused_reason end,last_coverage=p_coverage
 where source_key=j.source_key and j.purpose='collection';
 update public.collection_jobs set status=case when p_error is null then'succeeded'else'failed'end,result_count=jsonb_array_length(p_items),observed_cost_usd=case when p_actual_usd is null then observed_cost_usd else greatest(coalesce(observed_cost_usd,0),p_actual_usd)end,provider=case when native_result then'feed'else provider end,actor_id=case when native_result then null else actor_id end,cost_status=case when native_result then'no_provider_charge'when p_actual_usd is null then cost_status else'provider_reported'end,error_code=p_error,finished_at=coalesce(finished_at,finished)where id=j.collection_job_id;
 return jsonb_build_object('imported',inserted);
end;$$;
commit;
