-- Nonpublishing, individually sealed v4 model comparisons. Existing H3/H4
-- admissions, financial history, source records, reviews and gates are unchanged.
-- Lock order remains workspace -> archives -> jobs -> admission -> budget -> policy.
begin;
alter table public.content_analysis_admissions drop constraint content_analysis_admissions_purpose_check;
alter table public.content_analysis_admissions add constraint content_analysis_admissions_purpose_check
 check(purpose in ('summary_finalization','content_v4_evaluation','content_model_comparison'));
alter table public.reader_content_analysis_jobs drop constraint reader_content_analysis_jobs_state_check;
alter table public.reader_content_analysis_jobs add constraint reader_content_analysis_jobs_state_check
 check(state in ('queued','running','prepared','published','failed','blocked','cancelled','skipped','evaluated'));

create function public.content_analysis_is_comparison_job(p_job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reader_content_analysis_jobs j
  join public.content_analysis_admissions d on d.id=j.generation_admission_id
  where j.id=p_job_id and d.purpose='content_model_comparison');
$$;

create or replace function public.content_analysis_admission_current(p_job_id uuid,p_require_released boolean default true) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(d.manifest is not null and d.state<>'closed' and (not p_require_released or d.state='released')
  and d.manifest_digest=public.content_analysis_generation_v3_digest(d.manifest)
  and j.generation_comparison_id is null and slot is not null and j.rule_version=d.manifest->>'protocolVersion'
  and j.generation_contract_hash=d.manifest->>'generationContractHash'
  and j.generation_contract_hash=case when d.purpose='summary_finalization' then public.content_analysis_generation_v3_contract_hash() else public.content_analysis_generation_v4_contract_hash() end
  and slot->>'jobId'=j.id::text and slot->>'updateId'=j.update_id and slot->>'sourceId'=j.source_id and slot->>'task'=j.task
  and slot->>'contentHash'=j.content_hash and slot->>'sourceRevision'=j.source_revision and slot->>'sourceFingerprint'=j.source_fingerprint
  and slot->>'predecessorJobId' is not distinct from j.generation_predecessor_job_id::text
  and j.config_epoch=d.manifest->>'configEpoch'
  and (settings.selected_model,settings.revision)=(d.manifest#>>'{executionIdentity,model}',(d.manifest->>'selectionRevision')::bigint)
  and policy.model=settings.selected_model and (not p_require_released or (budget.enabled and policy.enabled))
  and a.source_id=j.source_id and public.content_analysis_eligible(w.state,a.record)
  and public.content_analysis_source_revision(a.record)=j.source_revision
  and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=j.content_hash
  and public.content_analysis_source_fingerprint(w.state,a.source_id)=j.source_fingerprint
  and (j.state='published' or ((d.purpose='content_model_comparison' or not public.content_analysis_admission_task_completed(a.record,j.content_hash,j.task))
   and slot->>'currentAnnotationHash'=public.content_analysis_model_comparison_annotation_hash(a.record,j.task)
   and slot->>'adminReviewHash'=public.content_analysis_admission_runtime_review_hash(j.id)))
  and not public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id)
  and (j.generation_predecessor_job_id is null or (prior.id is not null and prior.state='failed'
   and (prior.user_id,prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
    =(j.user_id,j.update_id,j.source_id,j.task,j.content_hash,j.source_revision,j.source_fingerprint)
   and public.content_analysis_generation_v3_ledger_hash(prior.id)=slot->>'predecessorLedgerHash'))
  and (d.purpose<>'summary_finalization' or (j.task='summary' and prior.rule_version='content-v3'
   and prior.generation_comparison_id is not null and comparison.state='closed'
   and jsonb_array_length(slot->'prefixCalls')>0 and not exists(
    select 1 from jsonb_array_elements(slot->'prefixCalls') prefix
    left join public.reader_content_analysis_calls call on call.id=(prefix->>'callId')::uuid
    where call.id is null or call.job_id is distinct from prior.id or call.call_key is distinct from prefix->>'callKey'
     or call.user_id is distinct from j.user_id or call.source_revision is distinct from j.source_revision
     or call.state<>'settled' or call.actual_usd is null or call.result is null
     or call.request_hash is distinct from prefix->>'requestHash'
     or public.content_analysis_generation_v3_digest(to_jsonb(call)) is distinct from prefix->>'callHash'
     or call.execution_identity is distinct from d.manifest->'executionIdentity'))),false)
 from public.reader_content_analysis_jobs j join public.content_analysis_admissions d on d.id=j.generation_admission_id and d.user_id=j.user_id
 join public.reader_workspaces w on w.user_id=j.user_id
 join public.reader_source_updates a on a.user_id=j.user_id and a.id=j.update_id
 join public.reader_content_analysis_policies policy on policy.user_id=j.user_id
 cross join public.content_analysis_budget budget cross join public.content_analysis_runtime_settings settings
 left join public.reader_content_analysis_jobs prior on prior.id=j.generation_predecessor_job_id
 left join public.content_analysis_model_comparisons comparison on comparison.id=prior.generation_comparison_id,
 lateral (select public.content_analysis_admission_slot(j.id) slot) selected where j.id=p_job_id and budget.id and settings.id;
$$;

create or replace function public.lock_content_analysis_admission_job(p_job_id uuid,p_lease_token uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs;w public.reader_workspaces;a public.reader_source_updates;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 select * into w from public.reader_workspaces where user_id=j.user_id for share;
 if not found then raise exception 'analysis_source_changed' using errcode='PT409'; end if;
 select * into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id for update;
 if not found then raise exception 'analysis_source_changed' using errcode='PT409'; end if;
 select * into j from public.reader_content_analysis_jobs where id=p_job_id for update;
 -- Lifecycle transitions lock every admitted job first; this held job lock
 -- serializes state changes without granting service mutation on admissions.
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
 if j.id is null or j.state in ('cancelled','blocked','skipped','failed','evaluated')
  or public.content_analysis_admission_current(j.id) is distinct from true
  or (p_lease_token is not null and (j.lease_token is distinct from p_lease_token or j.lease_until is null or j.lease_until<=clock_timestamp())) then
  raise exception 'analysis_admission_changed' using errcode='PT409'; end if;
 return jsonb_build_object('job',to_jsonb(j),'record',a.record);
end;
$$;

create or replace function public.preserve_content_analysis_generation_v3_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slot jsonb; prior public.reader_content_analysis_jobs; manifest jsonb;
begin
 if (new.state='evaluated' and not public.content_analysis_is_comparison_job(new.id))
  or (new.state='published' and public.content_analysis_is_comparison_job(new.id)) then
  raise exception 'Comparison output cannot publish or cross terminal purposes' using errcode='PT409'; end if;
 if new.generation_admission_id is not null or (tg_op='UPDATE' and old.generation_admission_id is not null) then
  if tg_op='UPDATE' then
   if new.state='evaluated' and old.state<>'evaluated' then
    if old.state<>'prepared' or old.result is null or new.result is distinct from old.result
     or new.lease_token is not null or new.lease_until is not null or new.published_at is not null then
     raise exception 'Only prepared comparison output can finish evaluation' using errcode='PT409'; end if;
    perform public.validate_content_analysis_generation_v3_result(old.id,old.result);
    perform public.validate_content_analysis_result(old.task,old.result,
     (select record from public.reader_source_updates where user_id=old.user_id and id=old.update_id),old.content_hash);
   end if;
   if (to_jsonb(new)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls'])
    is distinct from (to_jsonb(old)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls'])
    or (old.state in ('failed','published','skipped','cancelled','evaluated') and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then
    raise exception 'Admission job identity and terminal history are immutable' using errcode='PT409'; end if;
   return new;
  end if;
  if current_user<>(select pg_get_userbyid(proowner) from pg_proc where oid='public.stage_content_analysis_admission(text,timestamptz,uuid,text,jsonb)'::regprocedure) then
   raise exception 'Use explicit admission staging' using errcode='PT403'; end if;
  select d.manifest into manifest from public.content_analysis_admissions d where d.id=new.generation_admission_id and d.user_id=new.user_id and d.state='staged';
  select x into slot from jsonb_array_elements(manifest->'slots') x where x->>'jobId'=new.id::text;
  if slot is null or new.generation_comparison_id is not null or new.rule_version is distinct from manifest->>'protocolVersion'
   or new.generation_contract_hash is distinct from manifest->>'generationContractHash'
   or new.config_epoch is distinct from manifest->>'configEpoch'
   or (new.update_id,new.source_id,new.task,new.content_hash,new.source_revision,new.source_fingerprint)
    is distinct from (slot->>'updateId',slot->>'sourceId',slot->>'task',slot->>'contentHash',slot->>'sourceRevision',slot->>'sourceFingerprint')
   or new.generation_predecessor_job_id::text is distinct from slot->>'predecessorJobId'
   or new.state<>'queued' or new.attempts<>0 or new.result is not null or new.lease_token is not null or new.lease_until is not null then
   raise exception 'Admission job identity mismatch' using errcode='PT409'; end if;
  return new;
 end if;
 if tg_op='UPDATE' then
  if new.generation_comparison_id is distinct from old.generation_comparison_id then
   raise exception 'Comparison association is immutable' using errcode='PT409'; end if;
  if old.rule_version='content-v3' or new.rule_version='content-v3' then
   if (to_jsonb(new)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls'])
    is distinct from (to_jsonb(old)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls']) then
    raise exception 'Analysis generation identity is immutable' using errcode='PT409'; end if;
   -- Admin decisions use updated_at only to notify the owner poll. They may
   -- advance that notification without rewriting the terminal outcome/evidence.
   if old.state in ('failed','published','skipped','cancelled','evaluated')
    and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    raise exception 'Terminal analysis generation is immutable' using errcode='PT409'; end if;
  end if;
  return new;
 end if;
 if new.generation_comparison_id is not null then
  if new.rule_version<>'content-v3' or current_user<>(select pg_get_userbyid(proowner) from pg_proc
   where oid='public.stage_content_analysis_model_comparison(text,text,timestamptz,uuid,text,jsonb)'::regprocedure) then
   raise exception 'Use sealed model comparison staging' using errcode='PT403'; end if;
  select c.manifest into manifest from public.content_analysis_model_comparisons c where c.id=new.generation_comparison_id
   and c.user_id=new.user_id and c.state='staged';
  select x into slot from jsonb_array_elements(manifest->'slots') x where x->>'successorJobId'=new.id::text;
  select * into prior from public.reader_content_analysis_jobs where id=new.generation_predecessor_job_id;
  if slot is null or prior.id is null or prior.rule_version<>'content-v3' or prior.generation_comparison_id is not null or prior.state<>'failed'
   or slot->>'predecessorJobId' is distinct from prior.id::text or slot->>'rootJobId' is distinct from prior.generation_predecessor_job_id::text
   or (new.user_id,new.update_id,new.source_id,new.task,new.content_hash,new.source_revision,new.source_fingerprint)
    is distinct from (prior.user_id,prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
   or (new.update_id,new.source_id,new.task,new.content_hash,new.source_revision,new.source_fingerprint)
    is distinct from (slot->>'updateId',slot->>'sourceId',slot->>'task',slot->>'contentHash',slot->>'sourceRevision',slot->>'sourceFingerprint')
   or new.generation_contract_hash is distinct from public.content_analysis_generation_v3_contract_hash()
   or new.config_epoch is distinct from manifest->>'configEpoch' or new.state<>'queued' or new.attempts<>0
   or new.continuation_result_count<>0 or new.continuation_stalls<>0 or new.lease_token is not null or new.lease_until is not null
   or new.result is not null or new.error_code is not null then
   raise exception 'Sealed comparison job identity mismatch' using errcode='PT409'; end if;
  return new;
 end if;
 if new.rule_version<>'content-v3' then return new; end if;
 -- Only the service-only definer staging RPC may create v3 rows. The ordinary
 -- service role keeps its existing v1/v2 INSERT grant, without a v3 bypass.
 if current_user<>(select pg_get_userbyid(proowner) from pg_proc where oid='public.stage_content_analysis_generation_v3(text,text,timestamptz,text,jsonb)'::regprocedure) then
  raise exception 'Use explicit analysis generation staging' using errcode='PT403'; end if;
 select generation_revision_manifest into manifest from public.content_analysis_rollout_scopes where user_id=new.user_id and generation_rule_version='content-v3' and phase='paused';
 select x into slot from jsonb_array_elements(manifest->'slots') x where x->>'successorJobId'=new.id::text;
 select * into prior from public.reader_content_analysis_jobs where id=new.generation_predecessor_job_id;
 if slot is null or prior.id is null or prior.rule_version<>'content-v2'
  or slot->>'predecessorJobId' is distinct from prior.id::text or slot->>'updateId' is distinct from new.update_id
  or slot->>'sourceId' is distinct from new.source_id or slot->>'task' is distinct from new.task
  or slot->>'contentHash' is distinct from new.content_hash or slot->>'sourceRevision' is distinct from new.source_revision
  or slot->>'sourceFingerprint' is distinct from new.source_fingerprint
  or new.generation_contract_hash is distinct from public.content_analysis_generation_v3_contract_hash()
  or new.config_epoch is distinct from manifest->>'configEpoch'
  or (new.user_id,new.update_id,new.source_id,new.task,new.content_hash,new.source_revision,new.source_fingerprint)
   is distinct from (prior.user_id,prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
  or new.state<>'queued' or new.attempts<>0 or new.continuation_result_count<>0 or new.continuation_stalls<>0
  or new.lease_token is not null or new.lease_until is not null or new.result is not null or new.error_code is not null then
  raise exception 'Analysis generation slot mismatch' using errcode='PT409'; end if;
 return new;
end;
$$;

create or replace function public.claim_content_analysis_job_v2(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 -- Admission claim has independent scope; the old manifest remains paused/unchanged.
 for candidate in select q.* from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  where q.generation_admission_id is not null and (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted')) and q.next_attempt_at<=clock_timestamp()
   and (q.lease_until is null or q.lease_until<=clock_timestamp()) and public.content_analysis_admission_current(q.id)
  order by q.created_at,q.id limit 100
 loop
  select * into w from public.reader_workspaces where user_id=candidate.user_id for share;
  select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.reader_content_analysis_jobs where id=candidate.id for update skip locked;
  if not found or not (j.state in ('queued','running','prepared') or (j.state='blocked' and j.error_code='analysis_daily_budget_exhausted'))
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
   and (q.state in ('queued','running','prepared','failed') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
   and not (q.rule_version='content-v3' and q.state='failed')
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
   when p_error_code in ('analysis_provider_http_429','analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_correction_charge_unknown','analysis_cached_input_changed','analysis_state_conflict','analysis_admission_changed','analysis_admin_decision_changed','analysis_annotation_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
   else 'failed' end;
 end if;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_error_code='analysis_provider_http_429' then 'infinity'::timestamptz when due is not null then case when state_name='queued' then due else 'infinity'::timestamptz end
   when p_yield then clock_timestamp()+interval '1 second'
   when j.rule_version in ('content-v3','content-v4') and state_name='queued' and p_error_code='analysis_storage_unavailable' then clock_timestamp()+interval '1 minute'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when j.rule_version not in ('content-v3','content-v4') and state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  -- Queue claim attempts are separate from monetary attempts on a stable key.
  -- Known429 attempt limits live in calls; unrelated claim/yield pauses cannot
  -- prematurely exhaust a safe, due monetary retry.
  attempts=case when due is not null and state_name='queued' then greatest(0,attempts-1)
   else greatest(0,attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end) end,
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

create or replace function public.publish_content_analysis_job(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; rec jsonb; next_record jsonb; proc jsonb;
 candidate jsonb; prior public.admin_keyword_reviews; item jsonb; k text; label text; kind text; ranges jsonb;
 entries jsonb:='{}'; keywords jsonb; topics jsonb; brands jsonb; final_state text; content_state text;
begin
 if p_lease_token is null then raise exception 'Lease required' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if public.content_analysis_is_comparison_job(j.id) then raise exception 'Comparison publication forbidden' using errcode='PT409'; end if;
 if j.state='published' then return true; end if;
 if j.state<>'prepared' or j.result is null then raise exception 'No prepared result' using errcode='PT409'; end if;
 perform public.validate_content_analysis_generation_v3_result(j.id,j.result);
 rec:=locked->'record';
 perform public.validate_content_analysis_result(j.task,j.result,rec,j.content_hash);
 next_record:=rec; final_state:=j.result->>'state';
 if j.task='summary' then
  -- Capture the PRE-replacement legacy hash (or explicit unknown) before a
  -- fresh summary replaces the only previous provenance for unchanged labels.
  -- Never confer this summary job's new hash on a separate keyword inventory.
  next_record:=rec||jsonb_build_object('keywordContentHash',public.content_analysis_keyword_provenance(rec),
   'videoSummary',j.result#>'{patch,videoSummary}','videoHighlights',j.result#>'{patch,videoHighlights}');
 else
  -- Archive is locked before review rows. An admin approval/rejection that
  -- won the archive lock is reread here; one that follows us patches our result.
  perform 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash order by q.id for update;
  for candidate in select value from jsonb_array_elements(j.result->'pending') loop
   k:=public.content_analysis_keyword_key(candidate->>'label');
   if not exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash
    and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then
    insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
     values(j.user_id,j.update_id,j.source_id,j.content_hash,candidate->>'label',candidate->>'kind',(candidate->>'confidence')::integer,
      candidate->>'reason',candidate->>'evidenceQuote',candidate->'ranges',coalesce(rec->>'title',''),coalesce(rec->>'url',''))
     on conflict(user_id,update_id,content_hash,normalized_label) do nothing;
   end if;
  end loop;
  for candidate in select value from jsonb_array_elements(j.result#>'{evidence,accepted}') loop
   k:=public.content_analysis_keyword_key(candidate->>'label');
   -- Pending/rejected identities override a model acceptance, including aliases
   -- and admin-corrected names. Do not recreate or resolve an existing review.
   if exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash
    and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then continue; end if;
   entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',candidate->>'kind','keyword',public.content_analysis_public_keyword(candidate->>'label',candidate->'ranges')));
  end loop;
  -- Every approved decision for this hash survives, even if neither new pass
  -- rediscovered it. Corrected labels/types and current merged ranges win.
  for prior in select q.* from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='approved' order by q.updated_at,q.id loop
   label:=prior.resolved_label; kind:=prior.resolved_kind; k:=public.content_analysis_keyword_key(label); ranges:=prior.proposed_ranges;
   for item in select value from jsonb_array_elements(coalesce(rec->'videoKeywords','[]'::jsonb)) loop
    if (public.content_analysis_keyword_provenance(rec)#>>'{}')=j.content_hash
     and public.content_analysis_keyword_key(item->>'label') in (k,public.content_analysis_keyword_key(prior.label)) then ranges:=ranges||coalesce(item->'ranges','[]'::jsonb); end if;
   end loop;
   entries:=entries-public.content_analysis_keyword_key(prior.label);
   entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',kind,'keyword',public.content_analysis_public_keyword(label,ranges)));
  end loop;
  -- A later explicit rejection also fences a prior corrected alias.
  for prior in select q.* from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='rejected' loop
   entries:=entries-public.content_analysis_keyword_key(prior.label)-coalesce(public.content_analysis_keyword_key(prior.resolved_label),'');
  end loop;
  if (select count(*) from jsonb_each(entries))>500 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
  select coalesce(jsonb_agg(value->'keyword' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
   coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
   coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key) filter(where value->>'kind' in ('brand','product','game')),'[]'::jsonb)
   into keywords,topics,brands from jsonb_each(entries);
  next_record:=rec||jsonb_build_object('topics',topics,'brands',brands,'keywordRuleVersion','entities-v2','keywordContentHash',j.content_hash);
  if rec->>'format'='video' then next_record:=next_record||jsonb_build_object('videoKeywords',keywords); end if;
  final_state:=case when exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='pending') then 'review'
   when jsonb_array_length(topics)=0 then 'empty' else 'ready' end;
 end if;
 proc:=public.content_analysis_processing(rec,j.content_hash);
 content_state:=case when j.result#>>'{evidence,sourceContentState}'='partial' then 'partial' else proc->>'content' end;
 proc:=(proc-'reason')||jsonb_build_object('content',content_state,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(final_state));
 next_record:=next_record||jsonb_build_object('processing',proc);
 -- DB CAS over the LOCKED LATEST record. No caller record replacement/upsert;
 -- preserve new records, originals, unrelated annotations, media and workspace.
 update public.reader_source_updates set record=next_record where user_id=j.user_id and id=j.update_id and record=rec;
 if not found then raise exception 'Archive changed' using errcode='PT409'; end if;
 update public.reader_content_analysis_jobs set state='published',published_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null where id=j.id and lease_token=p_lease_token;
 return true;
end;
$$;

create or replace function public.invalidate_content_analysis_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.content_analysis_source_revision(new.record) is distinct from public.content_analysis_source_revision(old.record) then
  update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp()
   where user_id=old.user_id and update_id=old.id
    and not public.content_analysis_model_comparison_history(id)
   and (rule_version not in ('content-v3','content-v4') or state not in ('failed','published','skipped','cancelled','evaluated'));
 end if;
 return new;
end;
$$;

create or replace function public.invalidate_content_analysis_follow() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.reader_content_analysis_jobs j set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='follow_changed',updated_at=clock_timestamp()
  where j.user_id=new.user_id
   and not public.content_analysis_model_comparison_history(j.id)
   and (j.rule_version not in ('content-v3','content-v4') or j.state not in ('failed','published','skipped','cancelled','evaluated'))
   and (not coalesce(new.state->'followedSourceIds' ? j.source_id,false)
    or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(new.state,j.source_id)
    or exists(select 1 from public.reader_source_updates a where a.user_id=j.user_id and a.id=j.update_id and not coalesce(public.content_analysis_eligible(new.state,a.record),false)));
 return new;
end;
$$;

-- Cohort identity excludes job IDs, rounds and retry keys. Changing a round
-- cannot buy a second run of an already consumed suite/model/cohort.
create function public.content_analysis_comparison_cohort_digest(p_slots jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(jsonb_agg(
  x-array['jobId','predecessorJobId','predecessorLedgerHash'] order by x->>'updateId',x->>'task'))
 from jsonb_array_elements(p_slots) x;
$$;

create function public.stage_content_analysis_comparison(p_user_id text,p_expected_workspace_revision timestamptz,p_admission_id uuid,p_idempotency_key text,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reader_workspaces;a public.reader_source_updates;d public.content_analysis_admissions;
 b public.content_analysis_budget;policy public.reader_content_analysis_policies;settings public.content_analysis_runtime_settings;
 slot jsonb;digest text;consumed text;cohort text;committed numeric;fresh_bound numeric;ceiling numeric;max_calls integer;
 job_ids jsonb:='[]'::jsonb;
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200 or p_expected_workspace_revision is null or p_admission_id is null
  or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 or jsonb_typeof(p_manifest) is distinct from 'object'
  or octet_length(p_manifest::text)>131072
  or not (p_manifest ?& array['purpose','phase','suiteId','round','spendingDisabled','workersDrained','protocolVersion','generationContractHash','commonLimits','executionIdentity','selectionRevision','configEpoch','expectedLedgerHash','expectedCommittedUsd','overallCommitmentCeilingUsd','maximumFreshUsd','maximumCalls','perCallMaximumUsd','sourceReviewDigest','slots'])
  or p_manifest->>'purpose' is distinct from 'content_model_comparison' or p_manifest->>'phase' is distinct from 'comparison'
  or p_manifest->'spendingDisabled' is distinct from 'true'::jsonb or p_manifest->'workersDrained' is distinct from 'true'::jsonb
  or jsonb_typeof(p_manifest->'suiteId') is distinct from 'string' or length(btrim(p_manifest->>'suiteId')) not between 1 and 200
  or jsonb_typeof(p_manifest->'round') is distinct from 'number' or p_manifest->>'round' !~ '^[1-9][0-9]{0,5}$'
  or p_manifest->>'protocolVersion' is distinct from 'content-v4'
  or p_manifest->>'generationContractHash' is distinct from public.content_analysis_generation_v4_contract_hash()
  or p_manifest->'commonLimits' is distinct from '{"chunkChars":1250,"maxOutputTokens":3072,"maxInputTokens":27700,"overlapChars":256,"maxChunks":800,"maxSourceChars":1000000,"maxCallUsd":0.10}'::jsonb
  or p_manifest->>'sourceReviewDigest' is null or p_manifest->>'sourceReviewDigest' !~ '^[a-f0-9]{64}$'
  or p_manifest->>'configEpoch' is null or length(p_manifest->>'configEpoch') not between 1 and 200
  or jsonb_typeof(p_manifest->'slots') is distinct from 'array' or jsonb_array_length(p_manifest->'slots') not in (3,6) then
  raise exception 'Invalid sealed comparison manifest' using errcode='PT400'; end if;
 fresh_bound:=(p_manifest->>'maximumFreshUsd')::numeric;ceiling:=(p_manifest->>'overallCommitmentCeilingUsd')::numeric;max_calls:=(p_manifest->>'maximumCalls')::integer;
 if fresh_bound is null or fresh_bound<=0 or fresh_bound>5 or ceiling is null or ceiling<=0 or ceiling>5
  or fresh_bound::text in ('NaN','Infinity','-Infinity') or ceiling::text in ('NaN','Infinity','-Infinity')
  or max_calls is null or max_calls not between 1 and 10000 or (p_manifest->>'perCallMaximumUsd')::numeric is distinct from .10::numeric
  or p_manifest#>>'{executionIdentity,model}' not in ('minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro')
  or (select count(distinct x->>'jobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct (x->>'updateId',x->>'task')) from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct x->>'updateId') from jsonb_array_elements(p_manifest->'slots') x)<>3
  or exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where x->>'task' not in ('keywords','summary'))
  or (jsonb_array_length(p_manifest->'slots')=3 and exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where x->>'task'<>'keywords')) then
  raise exception 'Comparison cohort or financial bound invalid' using errcode='PT400'; end if;
 perform public.validate_content_analysis_execution_identity(p_manifest->'executionIdentity',p_manifest#>>'{executionIdentity,model}');
 select * into w from public.reader_workspaces where user_id=p_user_id for update;
 if not found or w.updated_at is distinct from p_expected_workspace_revision then raise exception 'Workspace revision changed' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates r where r.user_id=p_user_id and exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where x->>'updateId'=r.id) order by r.id for update;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=p_user_id for update;
 select * into settings from public.content_analysis_runtime_settings where id;
 if b.id is null or policy.user_id is null or b.enabled or exists(select 1 from public.reader_content_analysis_policies where enabled)
  or exists(select 1 from public.reader_content_analysis_jobs where state in ('running','prepared'))
  or (settings.selected_model,settings.revision) is distinct from (p_manifest#>>'{executionIdentity,model}',(p_manifest->>'selectionRevision')::bigint)
  or policy.model is distinct from settings.selected_model or .10>policy.per_call_limit_usd
  or ceiling>least(b.lifetime_limit_usd,policy.lifetime_limit_usd) then
  raise exception 'Off drained matching-model comparison checkpoint required' using errcode='PT409'; end if;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
 if p_manifest->>'expectedLedgerHash' is distinct from public.content_analysis_generation_v3_ledger_hash()
  or (p_manifest->>'expectedCommittedUsd')::numeric is distinct from committed or committed+fresh_bound>ceiling then
  raise exception 'Comparison financial snapshot or headroom changed' using errcode='PT409'; end if;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'updateId',value->>'task' loop
  if not (slot ?& array['jobId','predecessorJobId','updateId','sourceId','task','contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','sourceReviewDigest','emptyDisposition'])
   or slot->>'task' is null or slot->>'task' not in ('summary','keywords') or slot->>'predecessorJobId' is not null
   or slot ? 'prefixCalls' or slot ? 'allowedFreshRequest' or slot ? 'commonLimits'
   or slot->>'sourceReviewDigest' is null or slot->>'sourceReviewDigest' !~ '^[a-f0-9]{64}$'
   or slot->>'emptyDisposition' is null or slot->>'emptyDisposition' not in ('findings_expected','no_findings_reviewed','unreviewed') then
   raise exception 'Invalid comparison task slot' using errcode='PT400'; end if;
  perform (slot->>'jobId')::uuid;
  select * into a from public.reader_source_updates where user_id=p_user_id and id=slot->>'updateId';
  if a.id is null or public.content_analysis_eligible(w.state,a.record) is distinct from true
   or slot->>'sourceId' is distinct from a.source_id or slot->>'contentHash' is distinct from encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
   or slot->>'sourceRevision' is distinct from public.content_analysis_source_revision(a.record)
   or slot->>'sourceFingerprint' is distinct from public.content_analysis_source_fingerprint(w.state,a.source_id)
   or slot->>'currentAnnotationHash' is distinct from public.content_analysis_model_comparison_annotation_hash(a.record,slot->>'task')
   or slot->>'adminReviewHash' is distinct from public.content_analysis_model_comparison_review_hash(p_user_id,a.id)
   or public.content_analysis_v2_unknown_hold(p_user_id,a.id,slot->>'task') then
   raise exception 'Comparison source, annotation, review or hold changed' using errcode='PT409'; end if;
 end loop;
 digest:=public.content_analysis_generation_v3_digest(p_manifest);
 cohort:=public.content_analysis_comparison_cohort_digest(p_manifest->'slots');
 consumed:=public.content_analysis_generation_v3_digest(jsonb_build_array(p_manifest->>'suiteId',p_manifest#>>'{executionIdentity,model}',cohort));
 if exists(select 1 from public.content_analysis_admissions other where other.user_id=p_user_id and other.purpose='content_model_comparison'
   and other.manifest->>'suiteId'=p_manifest->>'suiteId'
   and (public.content_analysis_comparison_cohort_digest(other.manifest->'slots') is distinct from cohort
    or other.manifest->'commonLimits' is distinct from p_manifest->'commonLimits'
    or other.manifest->>'sourceReviewDigest' is distinct from p_manifest->>'sourceReviewDigest')) then
  raise exception 'Comparison suite cohort or common limits changed' using errcode='PT409'; end if;
 select * into d from public.content_analysis_admissions where id=p_admission_id;
 if found then
  if d.user_id=p_user_id and d.idempotency_key=p_idempotency_key and d.manifest_digest=digest and d.state='staged' then
   return jsonb_build_object('staged',true,'admission',to_jsonb(d)); end if;
  raise exception 'Comparison identity already consumed' using errcode='PT409'; end if;
 if exists(select 1 from public.content_analysis_admissions where owner_digest=public.content_analysis_generation_v3_digest(to_jsonb(p_user_id)) and purpose='content_model_comparison' and predecessor_digest=consumed) then
  raise exception 'Comparison suite and model already consumed' using errcode='PT409'; end if;
 insert into public.content_analysis_admissions(id,user_id,owner_digest,purpose,predecessor_digest,manifest,manifest_digest,idempotency_key)
  values(p_admission_id,p_user_id,public.content_analysis_generation_v3_digest(to_jsonb(p_user_id)),'content_model_comparison',consumed,p_manifest,digest,p_idempotency_key) returning * into d;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'jobId' loop
  insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,rule_version,task,source_revision,source_fingerprint,
   workspace_revision,config_epoch,generation_predecessor_job_id,generation_contract_hash,generation_admission_id)
   values((slot->>'jobId')::uuid,p_user_id,slot->>'updateId',slot->>'sourceId',slot->>'contentHash','content-v4',slot->>'task',slot->>'sourceRevision',slot->>'sourceFingerprint',
    w.updated_at,p_manifest->>'configEpoch',null,public.content_analysis_generation_v4_contract_hash(),d.id);
  job_ids:=job_ids||jsonb_build_array(slot->>'jobId');
 end loop;
 return jsonb_build_object('staged',true,'admission',to_jsonb(d),'jobIds',job_ids);
end;
$$;

create function public.complete_content_analysis_comparison_job(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare locked jsonb;j public.reader_content_analysis_jobs;
begin
 if p_lease_token is null then raise exception 'Lease required' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if not public.content_analysis_is_comparison_job(j.id) or j.state<>'prepared' or j.result is null then
  raise exception 'Prepared comparison result required' using errcode='PT409'; end if;
 perform public.validate_content_analysis_generation_v3_result(j.id,j.result);
 perform public.validate_content_analysis_result(j.task,j.result,locked->'record',j.content_hash);
 update public.reader_content_analysis_jobs set state='evaluated',lease_token=null,lease_until=null,next_attempt_at='infinity',error_code=null,updated_at=clock_timestamp()
  where id=j.id and lease_token=p_lease_token and state='prepared';
 if not found then raise exception 'Comparison completion lease changed' using errcode='PT409'; end if;
 return true;
end;
$$;

revoke all on function public.content_analysis_is_comparison_job(uuid),public.content_analysis_comparison_cohort_digest(jsonb),
 public.stage_content_analysis_comparison(text,timestamptz,uuid,text,jsonb),public.complete_content_analysis_comparison_job(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.content_analysis_is_comparison_job(uuid),public.content_analysis_comparison_cohort_digest(jsonb),
 public.stage_content_analysis_comparison(text,timestamptz,uuid,text,jsonb),public.complete_content_analysis_comparison_job(uuid,uuid) to service_role;
commit;
