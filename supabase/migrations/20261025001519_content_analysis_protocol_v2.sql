-- D38 private content-v2 rollout. Additive only; no source/model/provider call,
-- budget/policy activation, annotation rewrite or historical financial change.
-- Existing v3 request identity, billing and authenticated-zero 429 logic stays
-- unchanged. Lock order: workspace -> archive -> job -> budget -> policy -> call.
begin;
alter table public.reader_content_analysis_jobs drop constraint reader_content_analysis_jobs_rule_version_check;
alter table public.reader_content_analysis_jobs add constraint reader_content_analysis_jobs_rule_version_check
 check(rule_version in ('content-v1','content-v2'));
alter table public.reader_content_analysis_jobs
 add column continuation_result_count integer not null default 0 check(continuation_result_count>=0),
 add column continuation_stalls integer not null default 0 check(continuation_stalls between 0 and 3);
alter table public.reader_content_analysis_calls
 add column validation_error_code text check(validation_error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 add column validation_result_hash text check(validation_result_hash ~ '^[a-f0-9]{64}$'),
 add constraint content_analysis_validation_pair check((validation_error_code is null)=(validation_result_hash is null));

create table public.content_analysis_rollout_scopes (
 user_id text primary key references public.reader_workspaces(user_id) on delete cascade,
 update_ids text[], -- NULL = all eligible originals; empty array = no originals.
 phase text not null default 'paused' check(phase in ('paused','evaluation','backfill','active')),
 updated_at timestamptz not null default clock_timestamp(),
 check(update_ids is null or (cardinality(update_ids)<=1000 and array_ndims(update_ids) is not distinct from 1
  and array_position(update_ids,null) is null) or update_ids='{}'::text[])
);
alter table public.content_analysis_rollout_scopes enable row level security;
revoke all on public.content_analysis_rollout_scopes from public,anon,authenticated,service_role;
grant select on public.content_analysis_rollout_scopes to service_role;

-- The only service write path takes the same source locks as the worker before
-- touching a scope row. No worker locks scope -> workspace in the reverse order.
create function public.set_content_analysis_rollout_scope(p_user_id text,p_update_ids text[],p_phase text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.content_analysis_rollout_scopes;
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200 or p_phase is null
  or p_phase not in ('paused','evaluation','backfill','active')
  or (p_update_ids is not null and (cardinality(p_update_ids)>1000
   or (array_ndims(p_update_ids) is distinct from 1 and cardinality(p_update_ids)<>0)
   or exists(select 1 from unnest(p_update_ids) x where x is null or length(btrim(x)) not between 1 and 200))) then
  raise exception 'Invalid analysis rollout scope' using errcode='PT400'; end if;
 perform 1 from public.reader_workspaces where user_id=p_user_id for update;
 if not found then raise exception 'Workspace unavailable' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates where user_id=p_user_id order by id for update;
 perform 1 from public.reader_content_analysis_jobs where user_id=p_user_id order by id for update;
 -- Historical v1 outcomes, errors, leases, results and all calls remain exact.
 -- Scope/version fences below stop v1 sync/claim/continuation from competing.
 -- The new v2 job records explicit protocol supersession without history edits.
 insert into public.content_analysis_rollout_scopes(user_id,update_ids,phase)
  values(p_user_id,p_update_ids,p_phase) on conflict(user_id) do update
  set update_ids=excluded.update_ids,phase=excluded.phase,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end;
$$;

create function public.content_analysis_v2_in_scope(p_user_id text,p_update_id text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=p_user_id
  and s.phase in ('evaluation','backfill','active') and (s.update_ids is null or p_update_id=any(s.update_ids)));
$$;

-- Cross-protocol unresolved commitments survive version changes, cancelled jobs
-- and even deletion. An orphan hold cannot safely be attributed to a new task,
-- so it conservatively fences that owner's new v2 spending until reconciliation.
create function public.content_analysis_v2_unknown_hold(p_user_id text,p_update_id text,p_task text,p_except_job uuid default null) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reader_content_analysis_calls c
  left join public.reader_content_analysis_jobs j on j.id=c.job_id
  where c.user_id=p_user_id and c.actual_usd is null
   and (c.job_id is null or (j.user_id=p_user_id and j.update_id=p_update_id and j.task=p_task
    and (p_except_job is null or j.id<>p_except_job))));
$$;

-- Job protocol is private. Existing public takeaways-v1/entities-v2 shapes and
-- matching-hash admin-reviewed/published inventories are not regenerated.
create function public.content_analysis_task_completed(p_record jsonb,p_hash text,p_task text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case when p_task='summary' then coalesce(
  p_record#>>'{videoSummary,ruleVersion}'='takeaways-v1'
  and p_record#>>'{videoSummary,captionHash}'=p_hash and p_record#>>'{videoSummary,status}'='ready'
  and jsonb_typeof(p_record->'videoHighlights')='array'
  and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_record->'videoHighlights')='array' then p_record->'videoHighlights' else '[]'::jsonb end) point
   where (p_record#>>'{videoSummary,timingBasis}'='none' and point ? 'startSeconds')
    or (point ? 'startSeconds' and not exists(select 1 from jsonb_array_elements(coalesce(p_record->'transcriptSegments','[]'::jsonb)) cue where cue->'startSeconds'=point->'startSeconds'))),false)
 when p_task='keywords' then coalesce(
  (public.content_analysis_keyword_provenance(p_record)#>>'{}')=p_hash and p_record->>'keywordRuleVersion'='entities-v2'
  and jsonb_typeof(p_record->'videoKeywords')='array'
  and p_record#>>'{processing,keywords}' in ('ready','empty','review'),false)
 else false end;
$$;


create or replace function public.lock_content_analysis_job(p_job_id uuid,p_lease_token uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; w public.reader_workspaces; a public.reader_source_updates;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if not found then raise exception 'Analysis job unavailable' using errcode='PT409'; end if;
 select * into w from public.reader_workspaces where user_id=j.user_id for share;
 if not found then raise exception 'Workspace deleted' using errcode='PT409'; end if;
 select * into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id for update;
 if not found then raise exception 'Source deleted' using errcode='PT409'; end if;
 select * into j from public.reader_content_analysis_jobs where id=p_job_id for update;
 if not found or j.state in ('cancelled','blocked','skipped')
  or not coalesce(public.content_analysis_eligible(w.state,a.record),false)
  or j.source_id is distinct from a.source_id
  or j.content_hash is distinct from encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
  or j.source_revision is distinct from public.content_analysis_source_revision(a.record)
  or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(w.state,a.source_id)
  or (p_lease_token is not null and (j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp())) then
  raise exception 'Analysis lease or source changed' using errcode='PT409';
 end if;
 if j.rule_version='content-v2' and not public.content_analysis_v2_in_scope(j.user_id,j.update_id) then
  raise exception 'Analysis rollout scope paused or changed' using errcode='PT409'; end if;
 if j.rule_version='content-v1' and j.state<>'published'
  and exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=j.user_id) then
  raise exception 'Analysis protocol superseded' using errcode='PT409'; end if;
 if j.rule_version='content-v2' and public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) then
  raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
 return jsonb_build_object('job',to_jsonb(j),'record',a.record);
end;
$$;

create or replace function public.sync_content_analysis_jobs(p_user_id text,p_limit integer default 200,p_config_epoch text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.reader_workspaces; a public.reader_source_updates; task_name text; h text; rev text; n integer:=0; changed integer; legacy boolean;
begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 1000 or p_config_epoch is null or length(p_config_epoch)>200 then raise exception 'Invalid queue request' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for share;
 if not found or exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=p_user_id) then return jsonb_build_object('synchronized',0); end if;
 -- Scan the durable archive, including later caption recovery; newest eligible
 -- items precede old backfill. Lock every archive before touching its job rows.
 for a in select r.* from public.reader_source_updates r where r.user_id=p_user_id
  and public.content_analysis_eligible(w.state,r.record)
  and exists(select 1 from unnest(array['summary','keywords']) t where not exists(
   select 1 from public.reader_content_analysis_jobs j where j.user_id=r.user_id and j.update_id=r.id
    and j.content_hash=encode(sha256(convert_to(r.record->>'content','UTF8')),'hex') and j.rule_version='content-v1' and j.task=t
    and j.source_revision=public.content_analysis_source_revision(r.record) and j.state<>'cancelled'
    and not (j.state='blocked' and j.config_epoch<>p_config_epoch and j.error_code in
     ('analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'))))
  -- Hourly enrichment may lock archives in provider item order. Skip locked
  -- rows so our newest-first scan cannot wait while holding a newer row that
  -- hourly needs next. Skipped rows remain eligible for the next queue sync.
  order by r.published_at desc,r.id limit p_limit for share of r skip locked
 loop
  h:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'); rev:=public.content_analysis_source_revision(a.record);
  foreach task_name in array array['summary','keywords'] loop
   legacy:=task_name='summary' and a.record#>>'{videoSummary,ruleVersion}'='takeaways-v1'
    and a.record#>>'{videoSummary,captionHash}'=h and a.record#>>'{videoSummary,status}'='ready'
    and jsonb_typeof(a.record->'videoHighlights')='array'
    and not exists(select 1 from jsonb_array_elements(coalesce(a.record->'videoHighlights','[]'::jsonb)) point
     where (a.record#>>'{videoSummary,timingBasis}'='none' and point ? 'startSeconds')
      or (point ? 'startSeconds' and not exists(select 1 from jsonb_array_elements(coalesce(a.record->'transcriptSegments','[]'::jsonb)) cue where cue->'startSeconds'=point->'startSeconds')));
   insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,task,source_revision,source_fingerprint,workspace_revision,config_epoch,state)
    values(p_user_id,a.id,a.source_id,h,task_name,rev,public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,p_config_epoch,
     case when legacy then 'skipped' else 'queued' end)
    on conflict(user_id,update_id,content_hash,rule_version,task) do update set
     source_revision=excluded.source_revision,source_fingerprint=excluded.source_fingerprint,workspace_revision=excluded.workspace_revision,
     config_epoch=excluded.config_epoch,
     attempts=0,
     state=excluded.state,lease_token=null,lease_until=null,result=null,error_code=null,next_attempt_at='-infinity',updated_at=clock_timestamp()
    where reader_content_analysis_jobs.state='cancelled' or (reader_content_analysis_jobs.state='blocked'
     and reader_content_analysis_jobs.config_epoch<>excluded.config_epoch and reader_content_analysis_jobs.error_code in
      ('analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'));
   get diagnostics changed=row_count; n:=n+changed;
  end loop;
 end loop;
 return jsonb_build_object('synchronized',n);
end;
$$;

create or replace function public.claim_content_analysis_job(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 for candidate in select q.id,q.user_id,q.update_id from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  join public.reader_source_updates r on r.user_id=q.user_id and r.id=q.update_id
  where q.rule_version='content-v1' and not exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=q.user_id)
   and (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared','failed') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
   and q.next_attempt_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
   -- Expired running leases MUST reach the under-lock terminal cleanup even
   -- after attempt three. Daily pauses resume independently of that counter.
   and (q.attempts<3 or q.state in ('running','prepared') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
  order by r.published_at desc,q.created_at,q.id limit 100
 loop
  select * into w from public.reader_workspaces where user_id=candidate.user_id for share;
  if not found or exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=candidate.user_id) then continue; end if;
  -- UPDATE rather than SHARE: claiming also publishes truthful running state.
  -- Sibling tasks cannot deadlock by each upgrading an archive SHARE lock.
  select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.reader_content_analysis_jobs where id=candidate.id for update skip locked;
  if not found then continue; end if;
  if not (j.state in ('queued','running','prepared','failed') or (j.state='blocked' and j.error_code='analysis_daily_budget_exhausted'))
   or j.next_attempt_at>clock_timestamp() or j.lease_until>clock_timestamp() then continue; end if;
  if not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or j.source_revision<>public.content_analysis_source_revision(a.record)
   or j.source_fingerprint<>public.content_analysis_source_fingerprint(w.state,a.source_id) then
   update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp() where id=j.id;
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
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token);
 end loop;
 return null;
end;
$$;

create function public.sync_content_analysis_jobs_v2(p_user_id text,p_limit integer default 200,p_config_epoch text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.reader_workspaces; a public.reader_source_updates; task_name text; h text; rev text;
 n integer:=0; changed integer; held boolean;
begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 1000
  or p_config_epoch is null or length(p_config_epoch)>200 then raise exception 'Invalid queue request' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for share;
 if not found or not exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=p_user_id and s.phase<>'paused'
  and (s.update_ids is null or cardinality(s.update_ids)>0)) then return jsonb_build_object('synchronized',0); end if;
 for a in select r.* from public.reader_source_updates r where r.user_id=p_user_id
  and public.content_analysis_v2_in_scope(p_user_id,r.id) and public.content_analysis_eligible(w.state,r.record)
  and exists(select 1 from unnest(array['summary','keywords']) t
   where not public.content_analysis_task_completed(r.record,encode(sha256(convert_to(r.record->>'content','UTF8')),'hex'),t)
    and not exists(select 1 from public.reader_content_analysis_jobs done where done.user_id=r.user_id and done.update_id=r.id
     and done.task=t and done.content_hash=encode(sha256(convert_to(r.record->>'content','UTF8')),'hex')
     and done.source_revision=public.content_analysis_source_revision(r.record) and done.state in ('published','skipped'))
    and not exists(select 1 from public.reader_content_analysis_jobs j where j.user_id=r.user_id and j.update_id=r.id
     and j.content_hash=encode(sha256(convert_to(r.record->>'content','UTF8')),'hex') and j.rule_version='content-v2' and j.task=t
     and j.source_revision=public.content_analysis_source_revision(r.record) and j.state<>'cancelled'
     and not (j.state='blocked' and (
      (j.error_code in ('analysis_unknown_charge_hold','analysis_correction_charge_unknown') and not public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task))
      or (j.config_epoch<>p_config_epoch and j.error_code in ('analysis_credentials_required','analysis_runtime_disabled',
       'analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified',
       'analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'))))))
  order by r.published_at desc,r.id limit p_limit for share of r skip locked
 loop
  h:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'); rev:=public.content_analysis_source_revision(a.record);
  foreach task_name in array array['summary','keywords'] loop
   if public.content_analysis_task_completed(a.record,h,task_name) or exists(select 1 from public.reader_content_analysis_jobs done
    where done.user_id=p_user_id and done.update_id=a.id and done.content_hash=h and done.task=task_name
     and done.source_revision=rev and done.state in ('published','skipped')) then continue; end if;
   held:=public.content_analysis_v2_unknown_hold(p_user_id,a.id,task_name);
   insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,rule_version,task,source_revision,
    source_fingerprint,workspace_revision,config_epoch,state,error_code)
    values(p_user_id,a.id,a.source_id,h,'content-v2',task_name,rev,public.content_analysis_source_fingerprint(w.state,a.source_id),
     w.updated_at,p_config_epoch,case when held then 'blocked' else 'queued' end,case when held then 'analysis_unknown_charge_hold' else null end)
    on conflict(user_id,update_id,content_hash,rule_version,task) do update set
     source_revision=excluded.source_revision,source_fingerprint=excluded.source_fingerprint,workspace_revision=excluded.workspace_revision,
     config_epoch=excluded.config_epoch,state=excluded.state,error_code=excluded.error_code,attempts=0,
     lease_token=null,lease_until=null,result=null,next_attempt_at='-infinity',continuation_result_count=0,continuation_stalls=0,updated_at=clock_timestamp()
    where reader_content_analysis_jobs.state='cancelled' or (reader_content_analysis_jobs.state='blocked' and (
     (reader_content_analysis_jobs.error_code in ('analysis_unknown_charge_hold','analysis_correction_charge_unknown') and not public.content_analysis_v2_unknown_hold(p_user_id,a.id,task_name))
     or (reader_content_analysis_jobs.config_epoch<>excluded.config_epoch and reader_content_analysis_jobs.error_code in
      ('analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified',
       'analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch',
       'analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'))));
   get diagnostics changed=row_count; n:=n+changed;
  end loop;
 end loop;
 -- Locks follow all archive/job work, never before a subsequent archive wait.
 -- Preparation remains possible with policies off; no claim or spending follows.
 perform 1 from public.content_analysis_budget where id for share;
 perform 1 from public.reader_content_analysis_policies where user_id=p_user_id for share;
 return jsonb_build_object('synchronized',n);
end;
$$;

create function public.claim_content_analysis_job_v2(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 for candidate in select q.id,q.user_id,q.update_id from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  join public.reader_source_updates r on r.user_id=q.user_id and r.id=q.update_id
  where q.rule_version='content-v2' and public.content_analysis_v2_in_scope(q.user_id,q.update_id)
   and exists(select 1 from public.content_analysis_budget b where b.id and b.enabled)
   and (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared','failed') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
   and q.next_attempt_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
   -- Expired running leases MUST reach the under-lock terminal cleanup even
   -- after attempt three. Daily pauses resume independently of that counter.
   and (q.attempts<3 or q.state in ('running','prepared') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
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
  if not (j.state in ('queued','running','prepared','failed') or (j.state='blocked' and j.error_code='analysis_daily_budget_exhausted'))
   or j.next_attempt_at>clock_timestamp() or j.lease_until>clock_timestamp() then continue; end if;
  if not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or j.source_revision<>public.content_analysis_source_revision(a.record)
   or j.source_fingerprint<>public.content_analysis_source_fingerprint(w.state,a.source_id) then
   update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if not public.content_analysis_v2_in_scope(j.user_id,j.update_id) then continue; end if;
  if public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) then
   update public.reader_content_analysis_jobs set state='blocked',error_code='analysis_unknown_charge_hold',
    lease_token=null,lease_until=null,next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if public.content_analysis_task_completed(a.record,j.content_hash,j.task) or exists(select 1 from public.reader_content_analysis_jobs done
   where done.user_id=j.user_id and done.update_id=j.update_id and done.content_hash=j.content_hash and done.task=j.task
    and done.source_revision=j.source_revision and done.state in ('published','skipped') and done.id<>j.id) then
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
  -- Recheck actual gates under the established financial lock order. Return
  -- rather than scan another archive while holding these financial locks.
  perform 1 from public.content_analysis_budget where id and enabled for share;
  if not found then return null; end if;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id and enabled for update;
  if not found then return null; end if;
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
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token);
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
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state not in ('running','prepared') then raise exception 'Job not active' using errcode='PT409'; end if;
 if j.rule_version='content-v2' and p_yield then
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
  state_name:=case when p_error_code='analysis_provider_http_429' then 'blocked' when p_yield then 'queued'
   when p_error_code in ('analysis_provider_http_429','analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_correction_charge_unknown','analysis_cached_input_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
   else 'failed' end;
 end if;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_error_code='analysis_provider_http_429' then 'infinity'::timestamptz when due is not null then case when state_name='queued' then due else 'infinity'::timestamptz end
   when p_yield then clock_timestamp()+interval '1 second'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  -- Queue claim attempts are separate from monetary attempts on a stable key.
  -- Known429 attempt limits live in calls; unrelated claim/yield pauses cannot
  -- prematurely exhaust a safe, due monetary retry.
  attempts=case when due is not null and state_name='queued' then greatest(0,attempts-1)
   else greatest(0,attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end) end,
  updated_at=clock_timestamp() where id=j.id;
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield or controlled then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name,'retryAt',case when state_name='queued' then due else null end);
end;
$$;

-- Bounded reconstruction only, never provider permission. Deterministic key
-- windows avoid downloading every prior output (up to hundreds of MB) on every
-- continuation. Each page returns <=64 rows and <=1 MiB, including its envelope;
-- a result alone is already capped at 500000 bytes by the original ledger.
-- Source/scope/delete/lease checks use the authoritative lock-source contract.
create function public.read_content_analysis_cached_calls_v2(p_job_id uuid,p_lease_token uuid,
 p_call_keys text[],p_after_key text,p_model text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; item record;
 rows jsonb:='[]'::jsonb; used_bytes integer:=1024; item_bytes integer;
 last_key text; next_key text; response jsonb;
begin
 if p_lease_token is null or p_model is null or length(p_model) not between 1 and 200
  or p_call_keys is null or array_ndims(p_call_keys) is distinct from 1 or cardinality(p_call_keys) not between 1 and 64
  or exists(select 1 from unnest(p_call_keys) k where k is null or length(k)>160
   or k !~ '^(summary:v2:chunk:(0|[1-9][0-9]*)|summary-reduce:v2:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v2:verify:0|extractor:v2:chunk:(0|[1-9][0-9]*)|checker:v2:chunk:(0|[1-9][0-9]*))(:repair:1)?$')
  or (select count(distinct k) from unnest(p_call_keys) k)<>cardinality(p_call_keys)
  or (p_after_key is not null and not p_after_key=any(p_call_keys)) then
  raise exception 'Invalid cached analysis page' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.rule_version<>'content-v2' or j.state<>'running'
  or exists(select 1 from unnest(p_call_keys) k where
   (j.task='summary' and k !~ '^summary') or (j.task='keywords' and k !~ '^(extractor|checker):')) then
  raise exception 'Current content-v2 task lease required' using errcode='PT409'; end if;
 -- Same source -> budget -> policy order as reservation. This read cannot
 -- enable gates, spend, settle unknown charges or authorize a new call key.
 perform 1 from public.content_analysis_budget where id and enabled for share;
 if not found then raise exception 'Analysis runtime disabled' using errcode='PT403'; end if;
 perform 1 from public.reader_content_analysis_policies where user_id=j.user_id and enabled and model=p_model for share;
 if not found then raise exception 'Analysis runtime or model disabled' using errcode='PT403'; end if;
 for item in select c.call_key,c.user_id,c.source_revision,jsonb_build_object(
   'id',c.id,'call_key',c.call_key,'model',c.model,'execution_identity',c.execution_identity,
   'request_hash',c.request_hash,'result',c.result,'state',c.state,'actual_usd',c.actual_usd,'observed_usd',c.observed_usd) payload
  from public.reader_content_analysis_calls c where c.job_id=j.id and c.call_key=any(p_call_keys)
   and (p_after_key is null or c.call_key collate "C">p_after_key collate "C")
  order by c.call_key collate "C" limit 64
 loop
  if item.user_id is distinct from j.user_id or item.source_revision is distinct from j.source_revision then
   raise exception 'Cached analysis source changed' using errcode='PT409'; end if;
  item_bytes:=octet_length(item.payload::text)+2;
  if used_bytes+item_bytes>1048576 then
   if last_key is null then raise exception 'Cached analysis row too large' using errcode='PT400'; end if;
   next_key:=last_key; exit;
  end if;
  rows:=rows||jsonb_build_array(item.payload);used_bytes:=used_bytes+item_bytes;last_key:=item.call_key;
 end loop;
 -- Natural lease expiry during either lock waits or page construction denies
 -- the entire response. Publication and every fresh reservation fence again.
 if j.lease_until is null or j.lease_until<=clock_timestamp() then
  raise exception 'Analysis lease expired while reading cache' using errcode='PT409'; end if;
 response:=jsonb_build_object('calls',rows,'nextAfterKey',next_key);
 if octet_length(response::text)>1048576 then raise exception 'Cached analysis page too large' using errcode='PT400'; end if;
 return response;
end;
$$;

-- This marker is an explicit trusted-server assertion of deterministic engine
-- invalidity. Bind it to immutable raw output, never to observed cost alone.
create function public.mark_content_analysis_call_invalid(p_job_id uuid,p_lease_token uuid,p_call_key text,p_request_hash text,p_error_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; c public.reader_content_analysis_calls; digest text;
begin
 if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' or p_request_hash is null
  or p_request_hash !~ '^[a-f0-9]{64}$' or p_call_key is null or strpos(p_call_key,':v2:')=0 or strpos(p_call_key,':repair:')>0 then
  raise exception 'Invalid analysis invalidity marker' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if p_lease_token is null or j.rule_version<>'content-v2' or j.state<>'running' then
  raise exception 'Current content-v2 lease required' using errcode='PT409'; end if;
 -- Same financial order as reservation/settlement, and fresh recheck after waits.
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
 select * into c from public.reader_content_analysis_calls where job_id=j.id and call_key=p_call_key for update;
 if not found or c.source_revision is distinct from j.source_revision or c.request_hash is distinct from p_request_hash
  or c.result is null or jsonb_typeof(c.result) is distinct from 'object' or not (c.result ? 'value')
  or c.actual_usd is null or c.state<>'settled' or c.execution_identity is null
  or j.lease_until<=clock_timestamp() then
  raise exception 'Known settled materialized base required' using errcode='PT409'; end if;
 digest:=encode(sha256(convert_to(c.result::text,'UTF8')),'hex');
 if c.validation_error_code is not null and (c.validation_error_code is distinct from p_error_code or c.validation_result_hash is distinct from digest) then
  raise exception 'Analysis invalidity evidence changed' using errcode='PT409'; end if;
 update public.reader_content_analysis_calls set validation_error_code=p_error_code,validation_result_hash=digest
  where id=c.id returning * into c;
 return to_jsonb(c);
end;
$$;

create function public.fence_content_analysis_v2_call() returns trigger
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; base public.reader_content_analysis_calls; base_key text; locked jsonb;
begin
 if tg_op='UPDATE' then
  if old.validation_error_code is not null and (new.validation_error_code is distinct from old.validation_error_code
   or new.validation_result_hash is distinct from old.validation_result_hash) then
   raise exception 'Analysis invalidity evidence is immutable' using errcode='PT409'; end if;
  -- v3 reuses the original row for a verified-zero retry. Its UPDATE is a
  -- fresh spending decision too; another unresolved chunk must fence it.
  -- Do not gate ordinary cache/result/settlement updates on other holds.
  if new.attempt_number is distinct from old.attempt_number then
   select * into j from public.reader_content_analysis_jobs where id=new.job_id;
   if j.rule_version='content-v2' and exists(select 1 from public.reader_content_analysis_calls c
    where c.job_id=j.id and c.id<>new.id and c.actual_usd is null) then
    raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
  end if;
  return new;
 end if;
 select * into j from public.reader_content_analysis_jobs where id=new.job_id;
 if j.rule_version is distinct from 'content-v2' then return new; end if;
 -- All reservation entry points, including the legacy RPC, reach this fence.
 locked:=public.lock_content_analysis_job(j.id,new.lease_token);
 if new.request_hash is null or new.execution_identity is null or new.maximum_usd>0.01
  or new.call_key !~ '^(summary:v2:chunk:(0|[1-9][0-9]*)|summary-reduce:v2:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v2:verify:0|extractor:v2:chunk:(0|[1-9][0-9]*)|checker:v2:chunk:(0|[1-9][0-9]*))(:repair:1)?$'
  or (j.task='summary' and new.call_key !~ '^summary')
  or (j.task='keywords' and new.call_key !~ '^(extractor|checker):') then
  raise exception 'Invalid content-v2 call protocol' using errcode='PT400'; end if;
 -- Fresh inserts occur under the v3 global budget lock. A new prefix/version
 -- must never side-step an unresolved source/task or same-job commitment.
 if public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task)
  or exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and c.actual_usd is null) then
  raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
 if new.call_key like '%:repair:1' then
  base_key:=left(new.call_key,length(new.call_key)-length(':repair:1'));
  select * into base from public.reader_content_analysis_calls where job_id=j.id and call_key=base_key for update;
  if not found or base.result is null or jsonb_typeof(base.result) is distinct from 'object' or not (base.result ? 'value')
   or base.actual_usd is null or base.state<>'settled'
   or base.request_hash is null or base.source_revision is distinct from new.source_revision
   or base.execution_identity is distinct from new.execution_identity
   or base.validation_error_code is null
   or base.validation_result_hash is distinct from encode(sha256(convert_to(base.result::text,'UTF8')),'hex') then
   raise exception 'Known settled invalid content-v2 base required' using errcode='PT409'; end if;
 end if;
 return new;
end;
$$;
create trigger fence_content_analysis_v2_call before insert or update on public.reader_content_analysis_calls
 for each row execute function public.fence_content_analysis_v2_call();

revoke all on function public.set_content_analysis_rollout_scope(text,text[],text),
 public.content_analysis_v2_in_scope(text,text),public.content_analysis_v2_unknown_hold(text,text,text,uuid),
 public.content_analysis_task_completed(jsonb,text,text),public.sync_content_analysis_jobs_v2(text,integer,text),
 public.claim_content_analysis_job_v2(text,integer),public.mark_content_analysis_call_invalid(uuid,uuid,text,text,text),
 public.read_content_analysis_cached_calls_v2(uuid,uuid,text[],text,text),
 public.fence_content_analysis_v2_call() from public,anon,authenticated,service_role;
grant execute on function public.set_content_analysis_rollout_scope(text,text[],text),
 public.content_analysis_v2_in_scope(text,text),public.content_analysis_v2_unknown_hold(text,text,text,uuid),
 public.content_analysis_task_completed(jsonb,text,text),public.sync_content_analysis_jobs_v2(text,integer,text),
 public.claim_content_analysis_job_v2(text,integer),public.mark_content_analysis_call_invalid(uuid,uuid,text,text,text) to service_role;
grant execute on function public.read_content_analysis_cached_calls_v2(uuid,uuid,text[],text,text) to service_role;
comment on table public.content_analysis_rollout_scopes is 'Private owner rollout. No row denies content-v2. Use guarded setter; NULL IDs all eligible, empty IDs none. Phases never enable global/reader/runtime spending gates.';
comment on column public.reader_content_analysis_calls.validation_error_code is 'Private explicit deterministic engine rejection of a materialized known-settled base. Does not settle, refund or release any unknown charge.';
commit;
