-- Purpose-bound H3 finalization and opt-in v4 cohorts. No existing data, gates,
-- provider configuration, original scope or historical call is changed.
-- Lock order: workspace -> sorted archives -> sorted jobs -> admission ->
-- global budget -> owner policy -> calls/attempts -> reviews/audits.
begin;
create table public.content_analysis_admissions (
 id uuid primary key, user_id text, owner_digest text not null check(owner_digest ~ '^[a-f0-9]{64}$'),
 purpose text not null check(purpose in ('summary_finalization','content_v4_evaluation')),
 predecessor_digest text not null check(predecessor_digest ~ '^[a-f0-9]{64}$'),
 manifest jsonb, manifest_digest text not null check(manifest_digest ~ '^[a-f0-9]{64}$'),
 idempotency_key text, state text not null default 'staged' check(state in ('staged','released','paused','closed')),
 revision bigint not null default 1 check(revision>0), review_digest text,
 acceptance_digest text check(acceptance_digest ~ '^[a-f0-9]{64}$'), accepted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 redacted_at timestamptz,
 unique(owner_digest,purpose,predecessor_digest),
 check((manifest is null)=(redacted_at is not null)),
 check(manifest is null or (jsonb_typeof(manifest)='object' and octet_length(manifest::text)<=131072)),
 check(manifest is not null or (state='closed' and user_id is null and idempotency_key is null and review_digest is null)),
 check((acceptance_digest is null)=(accepted_at is null))
);
alter table public.content_analysis_admissions enable row level security;
revoke all on public.content_analysis_admissions from public,anon,authenticated,service_role;
grant select on public.content_analysis_admissions to service_role;
alter table public.reader_content_analysis_jobs add column generation_admission_id uuid references public.content_analysis_admissions(id) on delete restrict;
alter table public.reader_content_analysis_jobs drop constraint reader_content_analysis_jobs_rule_version_check;
alter table public.reader_content_analysis_jobs add constraint reader_content_analysis_jobs_rule_version_check check(rule_version in ('content-v1','content-v2','content-v3','content-v4'));
-- Pinned to the independently frozen v4 engine descriptor; not operator-supplied.
create function public.content_analysis_generation_v4_contract_hash() returns text
language sql immutable security invoker set search_path='' as $$ select 'e5b7e8411c040ab6f12c064829601936faa147b1e44901fb8ff05390e80b1561'::text; $$;
alter table public.reader_content_analysis_jobs drop constraint content_analysis_generation_v3_identity;
alter table public.reader_content_analysis_jobs add constraint content_analysis_generation_v3_identity check(
 (rule_version='content-v3' and generation_predecessor_job_id is not null and generation_contract_hash is not null and generation_contract_hash=public.content_analysis_generation_v3_contract_hash())
 or (rule_version='content-v4' and generation_admission_id is not null and generation_contract_hash is not null and generation_contract_hash=public.content_analysis_generation_v4_contract_hash())
 or (rule_version in ('content-v1','content-v2') and generation_predecessor_job_id is null and generation_contract_hash is null and generation_admission_id is null));
alter table public.reader_content_analysis_jobs add constraint content_analysis_admission_exclusive check(generation_admission_id is null or generation_comparison_id is null);
drop index public.content_analysis_original_logical_job;
create unique index content_analysis_original_logical_job on public.reader_content_analysis_jobs(user_id,update_id,content_hash,rule_version,task)
 where generation_comparison_id is null and generation_admission_id is null;
create unique index content_analysis_admission_logical_job on public.reader_content_analysis_jobs(generation_admission_id,user_id,update_id,content_hash,task)
 where generation_admission_id is not null;
-- Matching accepted annotations are protected independently of stale processing
-- overrides. Malformed matching payloads require review, not automatic overwrite.
create function public.content_analysis_admission_task_completed(p_record jsonb,p_hash text,p_task text) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_task_completed(p_record,p_hash,p_task) or coalesce(case when p_task='summary' then
  p_record#>>'{videoSummary,captionHash}'=p_hash and p_record#>>'{videoSummary,ruleVersion}'='takeaways-v1'
  and p_record#>>'{videoSummary,status}'='ready' and jsonb_typeof(p_record->'videoHighlights')='array'
  and jsonb_array_length(case when jsonb_typeof(p_record->'videoHighlights')='array' then p_record->'videoHighlights' else '[]'::jsonb end)>0
 when p_task='keywords' then
  public.content_analysis_keyword_provenance(p_record)#>>'{}'=p_hash and p_record->>'keywordRuleVersion'='entities-v2'
  and jsonb_typeof(p_record->'videoKeywords')='array' and jsonb_array_length(case when jsonb_typeof(p_record->'videoKeywords')='array' then p_record->'videoKeywords' else '[]'::jsonb end)>0 else false end,false);
$$;
create function public.content_analysis_admission_slot(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then jsonb_agg(x)->0 else null end from public.reader_content_analysis_jobs j
 join public.content_analysis_admissions d on d.id=j.generation_admission_id and d.user_id=j.user_id,
 lateral jsonb_array_elements(d.manifest->'slots') x where j.id=p_job_id and x->>'jobId'=j.id::text;
$$;
create function public.content_analysis_admission_runtime_review_hash(p_job_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb))
 from public.reader_content_analysis_jobs j join public.admin_keyword_reviews r on r.user_id=j.user_id and r.update_id=j.update_id
 where j.id=p_job_id and not (j.task='summary' and r.status='pending' and r.resolved_label is null and r.resolved_kind is null
  and exists(select 1 from public.reader_content_analysis_jobs sibling,
   lateral jsonb_array_elements(sibling.result->'pending') proposal
   where sibling.generation_admission_id=j.generation_admission_id and sibling.user_id=j.user_id and sibling.update_id=j.update_id
    and sibling.content_hash=j.content_hash and sibling.task='keywords' and sibling.state='published'
    and r.content_hash=sibling.content_hash and r.source_id=sibling.source_id
    and r.created_at>=sibling.created_at and r.updated_at<=sibling.published_at
    and r.label=proposal->>'label' and r.kind=proposal->>'kind' and r.confidence is not distinct from (proposal->>'confidence')::integer
    and r.reason=proposal->>'reason' and r.evidence_quote=proposal->>'evidenceQuote' and r.proposed_ranges=proposal->'ranges'));
$$;
create function public.content_analysis_admission_current(p_job_id uuid,p_require_released boolean default true) returns boolean
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
  and (j.state='published' or (not public.content_analysis_admission_task_completed(a.record,j.content_hash,j.task)
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
create function public.lock_content_analysis_admission_job(p_job_id uuid,p_lease_token uuid default null) returns jsonb
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
 if j.id is null or j.state in ('cancelled','blocked','skipped','failed')
  or public.content_analysis_admission_current(j.id) is distinct from true
  or (p_lease_token is not null and (j.lease_token is distinct from p_lease_token or j.lease_until is null or j.lease_until<=clock_timestamp())) then
  raise exception 'analysis_admission_changed' using errcode='PT409'; end if;
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
   select 1 from public.reader_content_analysis_jobs j where j.generation_admission_id is null and j.user_id=r.user_id and j.update_id=r.id
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
    on conflict(user_id,update_id,content_hash,rule_version,task) where generation_comparison_id is null and generation_admission_id is null do update set
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

create or replace function public.sync_content_analysis_jobs_v2(p_user_id text,p_limit integer default 200,p_config_epoch text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.reader_workspaces; a public.reader_source_updates; task_name text; h text; rev text;
 n integer:=0; changed integer; held boolean;
begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 1000
  or p_config_epoch is null or length(p_config_epoch)>200 then raise exception 'Invalid queue request' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for share;
 if found and exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=p_user_id and s.generation_rule_version='content-v3') then
  -- Staging alone creates the bounded v3 cohort. No reset, config epoch,
  -- cancellation recovery, new source or task may fan out another generation.
  return jsonb_build_object('synchronized',0);
 end if;
 if not found or not exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=p_user_id and s.phase<>'paused'
  and (s.update_ids is null or cardinality(s.update_ids)>0)) then return jsonb_build_object('synchronized',0); end if;
 for a in select r.* from public.reader_source_updates r where r.user_id=p_user_id
  and public.content_analysis_v2_in_scope(p_user_id,r.id) and public.content_analysis_eligible(w.state,r.record)
  and exists(select 1 from unnest(array['summary','keywords']) t
   where not public.content_analysis_task_completed(r.record,encode(sha256(convert_to(r.record->>'content','UTF8')),'hex'),t)
    and not exists(select 1 from public.reader_content_analysis_jobs done where done.user_id=r.user_id and done.update_id=r.id
     and done.task=t and done.content_hash=encode(sha256(convert_to(r.record->>'content','UTF8')),'hex')
     and done.source_revision=public.content_analysis_source_revision(r.record) and done.state in ('published','skipped'))
    and not exists(select 1 from public.reader_content_analysis_jobs j where j.generation_admission_id is null and j.user_id=r.user_id and j.update_id=r.id
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
    on conflict(user_id,update_id,content_hash,rule_version,task) where generation_comparison_id is null and generation_admission_id is null do update set
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

create or replace function public.preserve_content_analysis_generation_v3_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slot jsonb; prior public.reader_content_analysis_jobs; manifest jsonb;
begin
 if new.generation_admission_id is not null or (tg_op='UPDATE' and old.generation_admission_id is not null) then
  if tg_op='UPDATE' then
   if (to_jsonb(new)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls'])
    is distinct from (to_jsonb(old)-array['state','lease_token','lease_until','attempts','next_attempt_at','result','error_code','updated_at','published_at','continuation_result_count','continuation_stalls'])
    or (old.state in ('failed','published','skipped','cancelled') and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then
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
   if old.state in ('failed','published','skipped','cancelled')
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

create or replace function public.content_analysis_generation_job_in_scope(p_job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reader_content_analysis_jobs admitted where admitted.id=p_job_id and admitted.generation_admission_id is not null and public.content_analysis_admission_current(admitted.id)) or exists(select 1 from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
  where j.id=p_job_id and j.generation_admission_id is null and j.rule_version=s.generation_rule_version and s.phase<>'paused'
   and (s.update_ids is null or j.update_id=any(s.update_ids))
   and (j.rule_version='content-v2' or (j.generation_contract_hash=public.content_analysis_generation_v3_contract_hash()
    and public.content_analysis_generation_v3_slot(j.id) is not null
    and (j.generation_comparison_id is null or public.content_analysis_model_comparison_current(j.id)))));
$$;

create or replace function public.lock_content_analysis_job(p_job_id uuid,p_lease_token uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; w public.reader_workspaces; a public.reader_source_updates;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if not found then raise exception 'Analysis job unavailable' using errcode='PT409'; end if;
 if j.generation_admission_id is not null then return public.lock_content_analysis_admission_job(p_job_id,p_lease_token); end if;
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
 if j.rule_version in ('content-v2','content-v3') and not public.content_analysis_generation_job_in_scope(j.id) then
  raise exception 'Analysis rollout scope paused or changed' using errcode='PT409'; end if;
 if j.rule_version='content-v1' and j.state<>'published'
  and exists(select 1 from public.content_analysis_rollout_scopes s where s.user_id=j.user_id) then
  raise exception 'Analysis protocol superseded' using errcode='PT409'; end if;
 if j.rule_version in ('content-v2','content-v3') and public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) then
  raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
 if j.rule_version='content-v3' and j.state<>'published' then
  if public.content_analysis_generation_job_completed(j.id,a.record) then
   raise exception 'Current analysis already complete' using errcode='PT409'; end if;
  if not public.content_analysis_generation_v3_withhold_valid(j.id,a.record) then
   raise exception 'Withheld annotation changed' using errcode='PT409'; end if;
 end if;
 if j.generation_comparison_id is not null then
  -- Also serialize publication/cache/prepare against gate and selection saves.
  -- UPDATE avoids a SHARE-to-UPDATE upgrade deadlock when reserve follows lock.
  perform 1 from public.content_analysis_budget where id for update;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
  if public.content_analysis_model_comparison_current(j.id) is distinct from true
   or (p_lease_token is not null and (j.lease_until is null or j.lease_until<=clock_timestamp())) then
   raise exception 'Comparison permission or lease changed' using errcode='PT409'; end if;
 end if;
 return jsonb_build_object('job',to_jsonb(j),'record',a.record);
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
  proc:=public.content_analysis_processing(a.record,j.content_hash);
  proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"running"'::jsonb)||jsonb_build_object('updatedAt',clock_timestamp());
  update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
  update public.reader_content_analysis_policies set last_served_at=clock_timestamp() where user_id=j.user_id;
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token,'generationContext',jsonb_build_object(
   'protocolVersion',j.rule_version,'generationContractHash',j.generation_contract_hash,'predecessorJobId',j.generation_predecessor_job_id,
   'admissionId',j.generation_admission_id,'purpose',(select purpose from public.content_analysis_admissions where id=j.generation_admission_id))
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

create or replace function public.read_content_analysis_cached_calls_v2(p_job_id uuid,p_lease_token uuid,
 p_call_keys text[],p_after_key text,p_model text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; item record;
 rows jsonb:='[]'::jsonb; used_bytes integer:=1024; item_bytes integer;
 last_key text; next_key text; response jsonb;
begin
 if p_lease_token is null or p_model is null or length(p_model) not between 1 and 200
  or p_call_keys is null or array_ndims(p_call_keys) is distinct from 1 or cardinality(p_call_keys) not between 1 and 64
  or exists(select 1 from unnest(p_call_keys) k where k is null or length(k)>160
   or k !~ '^(summary:v[234]:chunk:(0|[1-9][0-9]*)|summary-reduce:v[234]:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v[234]:verify:0|extractor:v[234]:chunk:(0|[1-9][0-9]*)|checker:v[234]:chunk:(0|[1-9][0-9]*))(:repair:1)?$')
  or (select count(distinct k) from unnest(p_call_keys) k)<>cardinality(p_call_keys)
  or (p_after_key is not null and not p_after_key=any(p_call_keys)) then
  raise exception 'Invalid cached analysis page' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.rule_version not in ('content-v2','content-v3','content-v4') or j.state<>'running'
  or (j.rule_version in ('content-v3','content-v4') and (case when j.rule_version='content-v4' then 'summary:v4:verify:0:repair:1' else 'summary:v3:verify:0:repair:1' end)=any(p_call_keys))
  or exists(select 1 from unnest(p_call_keys) k where strpos(k,case when j.rule_version='content-v4' then ':v4:' when j.rule_version='content-v3' then ':v3:' else ':v2:' end)=0)
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
  from public.reader_content_analysis_calls c where (c.job_id=j.id or (j.generation_admission_id is not null and exists(
   select 1 from jsonb_array_elements(public.content_analysis_admission_slot(j.id)->'prefixCalls') prefix
   where prefix->>'callId'=c.id::text and prefix->>'callKey'=c.call_key and prefix->>'requestHash'=c.request_hash
    and prefix->>'callHash'=public.content_analysis_generation_v3_digest(to_jsonb(c))))) and c.call_key=any(p_call_keys)
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

create or replace function public.mark_content_analysis_call_invalid(p_job_id uuid,p_lease_token uuid,p_call_key text,p_request_hash text,p_error_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; c public.reader_content_analysis_calls; digest text;
begin
 if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' or p_request_hash is null
  or p_request_hash !~ '^[a-f0-9]{64}$' or p_call_key is null or p_call_key !~ ':v[234]:' or strpos(p_call_key,':repair:')>0 then
  raise exception 'Invalid analysis invalidity marker' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if p_lease_token is null or j.rule_version not in ('content-v2','content-v3','content-v4') or strpos(p_call_key,case when j.rule_version='content-v4' then ':v4:' when j.rule_version='content-v3' then ':v3:' else ':v2:' end)=0 or j.state<>'running' then
  raise exception 'Current content-v2 lease required' using errcode='PT409'; end if;
 if j.rule_version in ('content-v3','content-v4') and (p_call_key in ('summary:v3:verify:0','summary:v4:verify:0') or p_error_code in ('analysis_provider_refusal','analysis_unsupported_summary_claim','analysis_invalid_summary_verification','analysis_incomplete_summary_verification')) then
  raise exception 'Analysis verifier or refusal cannot authorize correction' using errcode='PT409'; end if;
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
  if rec is not null and encode(sha256(convert_to(rec->>'content','UTF8')),'hex')=j.content_hash
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
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield or controlled or (j.rule_version in ('content-v3','content-v4') and state_name='queued') then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name,'retryAt',case when state_name='queued' then due else null end);
end;
$$;

create or replace function public.fence_content_analysis_v2_call() returns trigger
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; base public.reader_content_analysis_calls; base_key text; locked jsonb;
 manifest jsonb; committed numeric; fresh boolean; version_key text;
begin
 fresh:=tg_op='INSERT';
 if tg_op='UPDATE' then
  if old.validation_error_code is not null and (new.validation_error_code is distinct from old.validation_error_code
   or new.validation_result_hash is distinct from old.validation_result_hash) then
   raise exception 'Analysis invalidity evidence is immutable' using errcode='PT409'; end if;
  fresh:=new.attempt_number is distinct from old.attempt_number;
  if not fresh then return new; end if;
 end if;
 select * into j from public.reader_content_analysis_jobs where id=new.job_id;
 if j.generation_admission_id is not null then
  perform public.fence_content_analysis_admitted_call(to_jsonb(new),case when tg_op='UPDATE' then to_jsonb(old) else null end);
  return new;
 end if;
 if j.rule_version is null or j.rule_version not in ('content-v2','content-v3') then return new; end if;
 if tg_op='UPDATE' and j.rule_version='content-v2' then
  if exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and c.id<>new.id and c.actual_usd is null) then
   raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
  return new;
 end if;
 locked:=public.lock_content_analysis_job(j.id,new.lease_token);
 version_key:=case when j.rule_version='content-v3' then ':v3:' else ':v2:' end;
 if new.request_hash is null or new.execution_identity is null or new.maximum_usd>.01
  or strpos(new.call_key,version_key)=0
  or new.call_key !~ '^(summary:v[23]:chunk:(0|[1-9][0-9]*)|summary-reduce:v[23]:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v[23]:verify:0|extractor:v[23]:chunk:(0|[1-9][0-9]*)|checker:v[23]:chunk:(0|[1-9][0-9]*))(:repair:1)?$'
  or (j.task='summary' and new.call_key !~ '^summary') or (j.task='keywords' and new.call_key !~ '^(extractor|checker):')
  or (j.rule_version='content-v3' and new.call_key='summary:v3:verify:0:repair:1') then
  raise exception 'Invalid content analysis call protocol' using errcode='PT400'; end if;
 if public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task)
  or exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and c.actual_usd is null and (tg_op='INSERT' or c.id<>new.id)) then
  raise exception 'Unresolved prior analysis charge' using errcode='PT409'; end if;
 if j.rule_version='content-v3' then
  -- Every INSERT and verified-zero retry UPDATE is fresh spend. This lock is
  -- the SAME singleton used by every reservation/settlement RPC, not a new cap.
  perform 1 from public.content_analysis_budget where id for update;
  perform 1 from public.reader_content_analysis_policies where user_id=j.user_id for update;
  manifest:=public.content_analysis_generation_v3_manifest(j.id);
  if new.user_id is distinct from j.user_id or new.source_revision is distinct from j.source_revision
   or new.execution_identity is distinct from manifest->'executionIdentity' or new.model is distinct from manifest#>>'{executionIdentity,model}'
   or j.config_epoch is distinct from manifest->>'configEpoch' then
   raise exception 'Analysis generation execution identity changed' using errcode='PT409'; end if;
  if not exists(select 1 from public.content_analysis_budget where id and enabled)
   or not exists(select 1 from public.reader_content_analysis_policies p where p.user_id=j.user_id and p.enabled and p.model=new.model and p.per_call_limit_usd>=new.maximum_usd)
   or j.lease_until<=clock_timestamp() then
   raise exception 'Analysis generation runtime or lease disabled' using errcode='PT403'; end if;
  select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
  -- The original .018365907 + .25 ceiling never refreshes at stage, midnight,
  -- model/config changes or restoration of the outer $5 lifetime allowance.
  if manifest->'budget' is distinct from '{"originalCommittedUsd":0.018365907,"incrementalAllowanceUsd":0.25,"smokeLifetimeCeilingUsd":0.268365907}'::jsonb
   or greatest(committed,(manifest->>'expectedCommittedUsd')::numeric)+new.maximum_usd>.268365907 then
   raise exception 'Original analysis smoke lifetime ceiling exhausted' using errcode='PT402'; end if;
  if j.generation_comparison_id is not null then
   if public.content_analysis_model_comparison_current(j.id) is distinct from true then
    raise exception 'Comparison release, selection or source changed' using errcode='PT409'; end if;
   select coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))),0)
    into committed from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs q on q.id=c.job_id
    where q.generation_comparison_id=j.generation_comparison_id;
   if committed+new.maximum_usd>(manifest#>>'{callBound,maximumFreshUsd}')::numeric
    or (select coalesce(sum(c.attempt_number),0) from public.reader_content_analysis_calls c
     join public.reader_content_analysis_jobs q on q.id=c.job_id where q.generation_comparison_id=j.generation_comparison_id)+1
      >(manifest#>>'{callBound,maximumCalls}')::integer then
    raise exception 'Sealed comparison fresh bound exhausted' using errcode='PT402'; end if;
   -- The finite preflight also bounds base versus correction work. Verified-
   -- zero retries consume an additional attempt in their original category.
   select coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))),0)
    into committed from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs q on q.id=c.job_id
    where q.generation_comparison_id=j.generation_comparison_id
     and (strpos(c.call_key,':repair:1')>0)=(strpos(new.call_key,':repair:1')>0);
   if committed+new.maximum_usd>(manifest#>>array['callBound',case when strpos(new.call_key,':repair:1')>0 then 'correctionMaximumUsd' else 'baseMaximumUsd' end])::numeric
    or (select coalesce(sum(c.attempt_number),0) from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs q on q.id=c.job_id
     where q.generation_comparison_id=j.generation_comparison_id
      and (strpos(c.call_key,':repair:1')>0)=(strpos(new.call_key,':repair:1')>0))+1
       >(manifest#>>array['callBound',case when strpos(new.call_key,':repair:1')>0 then 'correctionCalls' else 'baseCalls' end])::integer then
    raise exception 'Sealed comparison category bound exhausted' using errcode='PT402'; end if;
  end if;
 end if;
 if new.call_key like '%:repair:1' then
  base_key:=left(new.call_key,length(new.call_key)-length(':repair:1'));
  select * into base from public.reader_content_analysis_calls where job_id=j.id and call_key=base_key for update;
  if not found or base.result is null or jsonb_typeof(base.result) is distinct from 'object' or not (base.result ? 'value')
   or base.actual_usd is null or base.state<>'settled' or base.request_hash is null or base.source_revision is distinct from new.source_revision
   or base.execution_identity is distinct from new.execution_identity or base.validation_error_code is null
   or base.validation_result_hash is distinct from encode(sha256(convert_to(base.result::text,'UTF8')),'hex') then
   raise exception 'Known settled invalid analysis base required' using errcode='PT409'; end if;
 end if;
 return new;
end;
$$;

create or replace function public.validate_content_analysis_generation_v3_result(p_job_id uuid,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; slot jsonb;verifier public.reader_content_analysis_calls;verdicts jsonb;points integer;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if j.generation_admission_id is not null then
  if public.content_analysis_admission_current(j.id) is distinct from true
   or p_result#>>'{evidence,protocolVersion}' is distinct from j.rule_version
   or p_result#>>'{evidence,generationContractHash}' is distinct from j.generation_contract_hash
   or exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and (c.actual_usd is null or c.state<>'settled' or c.result is null)) then
   raise exception 'Admission result or settlement changed' using errcode='PT409'; end if;
  slot:=public.content_analysis_admission_slot(j.id);
  if j.task='summary' and (p_result->>'state'='empty' or p_result#>'{patch,videoHighlights}'='[]'::jsonb)
   and (slot->>'emptyDisposition' is distinct from 'no_findings_reviewed' or slot->>'sourceReviewDigest' is null) then
   raise exception 'Independent no-findings review required' using errcode='PT409'; end if;
  if j.task='keywords' and (p_result->>'state'='empty' or (p_result#>'{evidence,accepted}'='[]'::jsonb and p_result->'pending'='[]'::jsonb))
   and (slot->>'emptyDisposition' is distinct from 'no_findings_reviewed' or slot->>'sourceReviewDigest' is null) then
   raise exception 'Independent empty-keyword review required' using errcode='PT409'; end if;
  if j.task='summary' and jsonb_array_length(p_result#>'{patch,videoHighlights}')>0 then
   points:=jsonb_array_length(p_result#>'{patch,videoHighlights}');
   select * into verifier from public.reader_content_analysis_calls where job_id=j.id and call_key=case when j.rule_version='content-v4' then 'summary:v4:verify:0' else 'summary:v3:verify:0' end;
   verdicts:=verifier.result#>'{value,verdicts}';
   if verifier.id is null or verifier.state<>'settled' or verifier.actual_usd is null or verifier.validation_error_code is not null
    or verifier.result->>'validationError' is not null or verifier.result#>'{value,readComplete}' is distinct from 'true'::jsonb
    or jsonb_typeof(verdicts) is distinct from 'array' or jsonb_array_length(verdicts)<>points
    or p_result#>'{evidence,verification}' is distinct from verdicts
    or ((verifier.result->'value')-array['readComplete','verdicts'])<>'{}'::jsonb
    or (select count(distinct v->>'id') from jsonb_array_elements(verdicts) v)<>points
    or exists(select 1 from jsonb_array_elements(verdicts) v where v->'supported' is distinct from 'true'::jsonb
     or (j.rule_version='content-v4' and v->'sameFinding' is distinct from 'true'::jsonb)
     or v->>'id' not in (select 's'||n from generate_series(0,points-1) n)
     or jsonb_typeof(v->'reason') is distinct from 'string' or length(btrim(v->>'reason')) not between 1 and 240
     or v-case when j.rule_version='content-v4' then array['id','supported','sameFinding','reason'] else array['id','supported','reason'] end<>'{}'::jsonb) then
    raise exception 'Complete positive settled terminal verification required' using errcode='PT409'; end if;
  end if;
  if j.rule_version='content-v3' and not exists(select 1 from public.reader_content_analysis_calls c
   where c.job_id=j.id and c.call_key='summary:v3:verify:0' and c.request_hash=slot#>>'{allowedFreshRequest,requestHash}'
    and c.state='settled' and c.actual_usd is not null and c.result is not null) then
   raise exception 'Finalization verifier settlement required' using errcode='PT409'; end if;
  return;
 end if;
 if j.rule_version is distinct from 'content-v3' then return; end if;
 if j.generation_comparison_id is not null and public.content_analysis_model_comparison_current(j.id) is distinct from true then
  raise exception 'Comparison result permission changed' using errcode='PT409'; end if;
 if j.generation_comparison_id is not null and exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and c.actual_usd is null) then
  raise exception 'Unresolved same-job comparison charge' using errcode='PT409'; end if;
 if j.generation_comparison_id is not null and j.task='keywords' and
  (p_result->>'state'='empty' or (p_result#>'{evidence,accepted}'='[]'::jsonb and p_result->'pending'='[]'::jsonb)) then
  raise exception 'Empty comparison keyword inventories remain withheld' using errcode='PT409'; end if;
 slot:=public.content_analysis_generation_v3_slot(j.id);
 if slot is null or p_result#>>'{evidence,protocolVersion}' is distinct from 'content-v3'
  or p_result#>>'{evidence,generationContractHash}' is distinct from j.generation_contract_hash then
  raise exception 'Analysis generation result protocol changed' using errcode='PT409'; end if;
 if j.task='summary' and (p_result->>'state'='empty' or p_result#>'{patch,videoHighlights}'='[]'::jsonb)
  and (slot->>'emptyDisposition' is distinct from 'no_findings_reviewed' or slot->>'sourceReviewDigest' is null) then
  raise exception 'Independent full-source no-findings review required' using errcode='PT409'; end if;
end;
$$;

create or replace function public.content_analysis_model_comparison_job_digest(p_value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(
  (case when p_value->'generation_comparison_id'='null'::jsonb then p_value-'generation_comparison_id' else p_value end)
  -case when p_value->'generation_admission_id'='null'::jsonb then array['generation_admission_id'] else '{}'::text[] end);
$$;
create function public.fence_content_analysis_admitted_call(p_new jsonb,p_old jsonb default null) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs;d public.content_analysis_admissions;n public.reader_content_analysis_calls;
 base public.reader_content_analysis_calls;slot jsonb;committed numeric;fresh numeric;attempts integer;policy public.reader_content_analysis_policies;b public.content_analysis_budget;
 daily numeric;owner_daily numeric;owner_total numeric;utc_day timestamptz;key text;
begin
 select * into n from jsonb_populate_record(null::public.reader_content_analysis_calls,p_new);
 select * into j from public.reader_content_analysis_jobs where id=n.job_id;
 perform public.lock_content_analysis_admission_job(j.id,n.lease_token);
 select * into d from public.content_analysis_admissions where id=j.generation_admission_id;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=j.user_id for update;
 slot:=public.content_analysis_admission_slot(j.id);key:=n.call_key;
 if n.request_hash is null or n.request_hash !~ '^[a-f0-9]{64}$' or n.execution_identity is distinct from d.manifest->'executionIdentity'
  or n.user_id is distinct from j.user_id or n.source_revision is distinct from j.source_revision
  or n.model is distinct from d.manifest#>>'{executionIdentity,model}'
  or n.state<>'reserved' or n.actual_usd is not null or n.observed_usd is not null or n.result is not null or n.maximum_usd is null or n.maximum_usd<=0
  or n.maximum_usd>least(.10,(d.manifest->>'perCallMaximumUsd')::numeric,policy.per_call_limit_usd)
  or key !~ '^(summary:v[34]:chunk:(0|[1-9][0-9]*)|summary-reduce:v[34]:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v[34]:verify:0|extractor:v4:chunk:(0|[1-9][0-9]*)|checker:v4:chunk:(0|[1-9][0-9]*))(:repair:1)?$'
  or strpos(key,case when j.rule_version='content-v4' then ':v4:' else ':v3:' end)=0
  or key in ('summary:v3:verify:0:repair:1','summary:v4:verify:0:repair:1')
  or (j.task='summary' and key !~ '^summary') or (j.task='keywords' and key !~ '^(extractor|checker):') then
  raise exception 'Invalid admitted request protocol or identity' using errcode='PT400'; end if;
 if d.purpose='summary_finalization' and (key is distinct from slot#>>'{allowedFreshRequest,key}'
  or n.request_hash is distinct from slot#>>'{allowedFreshRequest,requestHash}' or p_old is not null or n.attempt_number<>1) then
  raise exception 'Only the sealed final verifier attempt is permitted' using errcode='PT409'; end if;
 if public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id)
  or exists(select 1 from public.reader_content_analysis_calls c where c.job_id=j.id and c.actual_usd is null and c.id<>n.id) then
  raise exception 'Unresolved admitted charge' using errcode='PT409'; end if;
 utc_day:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))) filter(where c.created_at>=utc_day or c.actual_usd is null),0)
  into committed,daily from public.reader_content_analysis_calls c;
 select coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))) filter(where c.created_at>=utc_day or c.actual_usd is null),0)
  into owner_total,owner_daily from public.reader_content_analysis_calls c where c.user_id=j.user_id;
 select coalesce(sum(greatest(coalesce(c.actual_usd,c.maximum_usd),coalesce(c.observed_usd,0))),0),coalesce(sum(c.attempt_number),0)
  into fresh,attempts from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs q on q.id=c.job_id where q.generation_admission_id=d.id;
 if not b.enabled or not policy.enabled or policy.model<>n.model or public.content_analysis_admission_current(j.id) is distinct from true
  or j.lease_until<=clock_timestamp() then raise exception 'Admission runtime disabled' using errcode='PT403'; end if;
 if greatest(committed,(d.manifest->>'expectedCommittedUsd')::numeric)+n.maximum_usd>least(b.lifetime_limit_usd,(d.manifest->>'overallCommitmentCeilingUsd')::numeric)
  or daily+n.maximum_usd>b.daily_limit_usd or owner_total+n.maximum_usd>policy.lifetime_limit_usd or owner_daily+n.maximum_usd>policy.daily_limit_usd
  or fresh+n.maximum_usd>(d.manifest->>'maximumFreshUsd')::numeric or attempts+1>(d.manifest->>'maximumCalls')::integer then
  raise exception 'Sealed admission budget or attempt ceiling exhausted' using errcode='PT402'; end if;
 if key like '%:repair:1' then
  key:=left(key,length(key)-length(':repair:1'));
  select * into base from public.reader_content_analysis_calls where job_id=j.id and call_key=key for update;
  if base.id is null or base.actual_usd is null or base.state<>'settled' or base.result is null or not (base.result ? 'value')
   or base.execution_identity is distinct from n.execution_identity or base.source_revision is distinct from n.source_revision
   or base.validation_error_code is null or base.validation_result_hash is distinct from public.content_analysis_generation_v3_digest(base.result) then
   raise exception 'Settled invalid original required for one correction' using errcode='PT409'; end if;
 end if;
end;
$$;

create function public.stage_content_analysis_admission(p_user_id text,p_expected_workspace_revision timestamptz,p_admission_id uuid,p_idempotency_key text,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reader_workspaces;a public.reader_source_updates;prior public.reader_content_analysis_jobs;d public.content_analysis_admissions;
 b public.content_analysis_budget;policy public.reader_content_analysis_policies;settings public.content_analysis_runtime_settings;slot jsonb;prefix jsonb;call public.reader_content_analysis_calls;
 purpose text;protocol text;phase text;contract text;digest text;predecessors text;committed numeric;fresh_bound numeric;max_calls integer;ceiling numeric;per_call numeric;
 accepted public.content_analysis_admissions;job_ids jsonb:='[]'::jsonb;scope_count integer;
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200 or p_expected_workspace_revision is null or p_admission_id is null
  or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200 or jsonb_typeof(p_manifest) is distinct from 'object'
  or octet_length(p_manifest::text)>131072
  or not (p_manifest ?& array['purpose','phase','runtimeDisabled','workersDrained','protocolVersion','generationContractHash','executionIdentity','selectionRevision','configEpoch','expectedLedgerHash','expectedCommittedUsd','overallCommitmentCeilingUsd','maximumFreshUsd','maximumCalls','perCallMaximumUsd','sourceReviewDigest','slots'])
  or p_manifest->'runtimeDisabled' is distinct from 'true'::jsonb or p_manifest->'workersDrained' is distinct from 'true'::jsonb
  or jsonb_typeof(p_manifest->'slots') is distinct from 'array' or jsonb_array_length(p_manifest->'slots') not between 1 and 6 then
  raise exception 'Invalid sealed admission manifest' using errcode='PT400'; end if;
 purpose:=p_manifest->>'purpose';protocol:=p_manifest->>'protocolVersion';phase:=p_manifest->>'phase';
 contract:=case when purpose='summary_finalization' then public.content_analysis_generation_v3_contract_hash() else public.content_analysis_generation_v4_contract_hash() end;
 fresh_bound:=(p_manifest->>'maximumFreshUsd')::numeric;max_calls:=(p_manifest->>'maximumCalls')::integer;ceiling:=(p_manifest->>'overallCommitmentCeilingUsd')::numeric;per_call:=(p_manifest->>'perCallMaximumUsd')::numeric;
 if purpose is null or purpose not in ('summary_finalization','content_v4_evaluation') or phase is null or phase not in ('smoke','evaluation')
  or protocol is distinct from (case when purpose='summary_finalization' then 'content-v3' else 'content-v4' end)
  or p_manifest->>'generationContractHash' is distinct from contract or contract !~ '^[a-f0-9]{64}$'
  or p_manifest->>'sourceReviewDigest' is null or p_manifest->>'sourceReviewDigest' !~ '^[a-f0-9]{64}$' or p_manifest->>'configEpoch' is null or length(p_manifest->>'configEpoch') not between 1 and 200
  or fresh_bound is null or fresh_bound<=0 or fresh_bound>5 or max_calls is null or max_calls not between 1 and 10000
  or ceiling is null or ceiling<=0 or ceiling>5 or per_call is null or per_call<=0 or per_call>.10
  or fresh_bound::text in ('NaN','Infinity','-Infinity') or ceiling::text in ('NaN','Infinity','-Infinity')
  or (phase='smoke' and ceiling>.268365907)
  or (purpose='summary_finalization' and (phase<>'smoke' or jsonb_array_length(p_manifest->'slots')<>1 or max_calls<>1 or fresh_bound>.10))
  or (select count(distinct x->>'jobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct (x->>'updateId',x->>'task')) from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct x->>'updateId') from jsonb_array_elements(p_manifest->'slots') x)>3 then
  raise exception 'Admission contract, cohort or financial bound invalid' using errcode='PT400'; end if;
 perform public.validate_content_analysis_execution_identity(p_manifest->'executionIdentity',p_manifest#>>'{executionIdentity,model}');
 select * into w from public.reader_workspaces where user_id=p_user_id for update;
 if not found or w.updated_at is distinct from p_expected_workspace_revision then raise exception 'Workspace revision changed' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates r where r.user_id=p_user_id and exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where x->>'updateId'=r.id) order by r.id for update;
 perform 1 from public.reader_content_analysis_jobs j where j.user_id=p_user_id and exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where x->>'predecessorJobId'=j.id::text) order by j.id for update;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=p_user_id for update;
 select * into settings from public.content_analysis_runtime_settings where id;
 if b.id is null or policy.user_id is null or b.enabled or exists(select 1 from public.reader_content_analysis_policies where enabled)
  or exists(select 1 from public.reader_content_analysis_jobs where state in ('running','prepared'))
  or (settings.selected_model,settings.revision) is distinct from (p_manifest#>>'{executionIdentity,model}',(p_manifest->>'selectionRevision')::bigint)
  or policy.model is distinct from settings.selected_model or per_call>policy.per_call_limit_usd
  or ceiling>least(b.lifetime_limit_usd,policy.lifetime_limit_usd) then
  raise exception 'Off drained matching-model admission checkpoint required' using errcode='PT409'; end if;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
 if p_manifest->>'expectedLedgerHash' is distinct from public.content_analysis_generation_v3_ledger_hash()
  or (p_manifest->>'expectedCommittedUsd')::numeric is distinct from committed or committed+fresh_bound>ceiling then
  raise exception 'Admission financial snapshot or headroom changed' using errcode='PT409'; end if;
 if phase='evaluation' then
  select * into accepted from public.content_analysis_admissions where id=(p_manifest->>'acceptedSmokeAdmissionId')::uuid;
  if accepted.user_id is distinct from p_user_id or accepted.purpose<>'content_v4_evaluation' or accepted.manifest->>'phase' is distinct from 'smoke'
   or accepted.acceptance_digest is null or accepted.manifest->>'generationContractHash' is distinct from contract
   or accepted.manifest->'executionIdentity' is distinct from p_manifest->'executionIdentity'
   or jsonb_array_length(accepted.manifest->'slots')<>6 or p_manifest->>'hostedPublicationReviewDigest' is null
   or p_manifest->>'hostedPublicationReviewDigest' !~ '^[a-f0-9]{64}$'
   or (select count(*) from public.reader_content_analysis_jobs where generation_admission_id=accepted.id and state='published')<>6 then
   raise exception 'Accepted six-task quality and hosted publication proof required' using errcode='PT409'; end if;
 end if;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'updateId',value->>'task' loop
  if not (slot ?& array['jobId','predecessorJobId','updateId','sourceId','task','contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','sourceReviewDigest','emptyDisposition'])
   or slot->>'task' is null or slot->>'task' not in ('summary','keywords') or slot->>'sourceReviewDigest' is null or slot->>'sourceReviewDigest' !~ '^[a-f0-9]{64}$'
   or slot->>'emptyDisposition' is null or slot->>'emptyDisposition' not in ('findings_expected','no_findings_reviewed','unreviewed') then
   raise exception 'Invalid admission task slot' using errcode='PT400'; end if;
  perform (slot->>'jobId')::uuid;
  select * into a from public.reader_source_updates where user_id=p_user_id and id=slot->>'updateId';
  if a.id is null or public.content_analysis_eligible(w.state,a.record) is distinct from true
   or slot->>'sourceId' is distinct from a.source_id or slot->>'contentHash' is distinct from encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
   or slot->>'sourceRevision' is distinct from public.content_analysis_source_revision(a.record)
   or slot->>'sourceFingerprint' is distinct from public.content_analysis_source_fingerprint(w.state,a.source_id)
   or slot->>'currentAnnotationHash' is distinct from public.content_analysis_model_comparison_annotation_hash(a.record,slot->>'task')
   or slot->>'adminReviewHash' is distinct from public.content_analysis_model_comparison_review_hash(p_user_id,a.id)
   or public.content_analysis_admission_task_completed(a.record,slot->>'contentHash',slot->>'task')
   or public.content_analysis_v2_unknown_hold(p_user_id,a.id,slot->>'task') then
   raise exception 'Admission source, annotation, review or hold changed' using errcode='PT409'; end if;
  prior:=null;
  if slot->>'predecessorJobId' is not null then
   select * into prior from public.reader_content_analysis_jobs where id=(slot->>'predecessorJobId')::uuid;
   if prior.id is null or prior.state<>'failed' or prior.rule_version='content-v4' or prior.user_id<>p_user_id
    or (prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
     is distinct from (a.id,a.source_id,slot->>'task',slot->>'contentHash',slot->>'sourceRevision',slot->>'sourceFingerprint')
    or slot->>'predecessorLedgerHash' is distinct from public.content_analysis_generation_v3_ledger_hash(prior.id) then
    raise exception 'Exact failed-task predecessor required' using errcode='PT409'; end if;
  elsif exists(select 1 from public.reader_content_analysis_jobs j where j.user_id=p_user_id and j.update_id=a.id and j.task=slot->>'task'
    and j.content_hash=slot->>'contentHash' and j.rule_version in ('content-v3','content-v4')) then
   raise exception 'Existing generation needs exact predecessor' using errcode='PT409'; end if;
  if purpose='summary_finalization' then
   if slot->>'task'<>'summary' or prior.rule_version is distinct from 'content-v3' or prior.generation_comparison_id is null
    or not exists(select 1 from public.content_analysis_model_comparisons where id=prior.generation_comparison_id and state='closed')
    or slot#>>'{allowedFreshRequest,key}' is distinct from 'summary:v3:verify:0' or slot#>>'{allowedFreshRequest,requestHash}' is null
    or slot#>>'{allowedFreshRequest,requestHash}' !~ '^[a-f0-9]{64}$' or jsonb_typeof(slot->'prefixCalls') is distinct from 'array'
    or jsonb_array_length(slot->'prefixCalls') not between 1 and 1024
    or (select count(distinct x->>'callKey') from jsonb_array_elements(slot->'prefixCalls') x)<>jsonb_array_length(slot->'prefixCalls') then
    raise exception 'Single closed-comparison finalization prefix required' using errcode='PT409'; end if;
   for prefix in select value from jsonb_array_elements(slot->'prefixCalls') loop
    select * into call from public.reader_content_analysis_calls where id=(prefix->>'callId')::uuid;
    if call.id is null or call.job_id is distinct from prior.id or call.call_key is distinct from prefix->>'callKey'
     or call.call_key !~ '^summary(-reduce)?:v3:' or call.call_key like '%:verify:%' or call.state<>'settled' or call.actual_usd is null
     or call.result is null or not (call.result ? 'value') or call.request_hash is distinct from prefix->>'requestHash'
     or prefix->>'callHash' is distinct from public.content_analysis_generation_v3_digest(to_jsonb(call))
     or call.execution_identity is distinct from p_manifest->'executionIdentity' then
     raise exception 'Sealed settled prefix mismatch' using errcode='PT409'; end if;
   end loop;
  elsif slot ? 'prefixCalls' or slot ? 'allowedFreshRequest' then
   raise exception 'Cross-contract prefix reuse forbidden' using errcode='PT400';
  end if;
 end loop;
 digest:=public.content_analysis_generation_v3_digest(p_manifest);
 select public.content_analysis_generation_v3_digest(jsonb_agg(jsonb_build_array(x->>'updateId',x->>'task',x->>'predecessorJobId',x->>'contentHash') order by x->>'updateId',x->>'task')) into predecessors from jsonb_array_elements(p_manifest->'slots') x;
 select * into d from public.content_analysis_admissions where id=p_admission_id;
 if found then
  if d.user_id=p_user_id and d.idempotency_key=p_idempotency_key and d.manifest_digest=digest then return jsonb_build_object('staged',true,'admission',to_jsonb(d)); end if;
  raise exception 'Admission identity already consumed' using errcode='PT409'; end if;
 insert into public.content_analysis_admissions(id,user_id,owner_digest,purpose,predecessor_digest,manifest,manifest_digest,idempotency_key)
  values(p_admission_id,p_user_id,public.content_analysis_generation_v3_digest(to_jsonb(p_user_id)),purpose,predecessors,p_manifest,digest,p_idempotency_key) returning * into d;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'jobId' loop
  insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,rule_version,task,source_revision,source_fingerprint,
   workspace_revision,config_epoch,generation_predecessor_job_id,generation_contract_hash,generation_admission_id)
   values((slot->>'jobId')::uuid,p_user_id,slot->>'updateId',slot->>'sourceId',slot->>'contentHash',protocol,slot->>'task',slot->>'sourceRevision',slot->>'sourceFingerprint',
    w.updated_at,p_manifest->>'configEpoch',(slot->>'predecessorJobId')::uuid,contract,d.id);
  job_ids:=job_ids||jsonb_build_array(slot->>'jobId');
 end loop;
 return jsonb_build_object('staged',true,'admission',to_jsonb(d),'jobIds',job_ids);
end;
$$;

create function public.set_content_analysis_admission_state(p_admission_id uuid,p_expected_revision bigint,p_action text,p_manifest_digest text,p_review_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.content_analysis_admissions;w public.reader_workspaces;slot jsonb;j public.reader_content_analysis_jobs;
begin
 select * into d from public.content_analysis_admissions where id=p_admission_id;
 if d.id is null or d.manifest is null then raise exception 'Admission unavailable' using errcode='PT409'; end if;
 select * into w from public.reader_workspaces where user_id=d.user_id for update;
 perform 1 from public.reader_source_updates a where a.user_id=d.user_id and exists(select 1 from jsonb_array_elements(d.manifest->'slots') x where x->>'updateId'=a.id) order by a.id for update;
 perform 1 from public.reader_content_analysis_jobs q where q.generation_admission_id=d.id order by q.id for update;
 select * into d from public.content_analysis_admissions where id=p_admission_id for update;
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=d.user_id for update;
 if d.revision is distinct from p_expected_revision or d.manifest_digest is distinct from p_manifest_digest
  or p_review_digest is null or p_review_digest !~ '^[a-f0-9]{64}$' or d.state='closed'
  or p_action is null or p_action not in ('release','pause','close','accept') then
  raise exception 'Admission revision, review or state changed' using errcode='PT409'; end if;
 if exists(select 1 from public.content_analysis_budget where id and enabled)
  or exists(select 1 from public.reader_content_analysis_policies where enabled)
  or exists(select 1 from public.reader_content_analysis_jobs where state in ('running','prepared')) then
  raise exception 'Stop spending and drain before admission transition' using errcode='PT409'; end if;
 if p_action='release' then
  if d.state not in ('staged','paused') or d.acceptance_digest is not null
   or exists(select 1 from public.content_analysis_admissions other where other.user_id=d.user_id and other.id<>d.id and other.state='released') then raise exception 'Admission cannot release' using errcode='PT409'; end if;
  for j in select * from public.reader_content_analysis_jobs where generation_admission_id=d.id loop
   if public.content_analysis_admission_current(j.id,false) is distinct from true then raise exception 'Admission source or settings changed' using errcode='PT409'; end if;
  end loop;
 elsif p_action='accept' then
  if d.purpose<>'content_v4_evaluation' or d.manifest->>'phase'<>'smoke' or jsonb_array_length(d.manifest->'slots')<>6
   or (select count(distinct update_id) from public.reader_content_analysis_jobs where generation_admission_id=d.id)<>3
   or (select count(*) from public.reader_content_analysis_jobs where generation_admission_id=d.id and state='published')<>6
   or exists(select 1 from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs q on q.id=c.job_id where q.generation_admission_id=d.id and c.actual_usd is null)
   or exists(select 1 from public.reader_content_analysis_jobs q where q.generation_admission_id=d.id and public.content_analysis_admission_current(q.id,false) is distinct from true) then
   raise exception 'Six published settled smoke tasks required' using errcode='PT409'; end if;
 end if;
 update public.content_analysis_admissions set state=case p_action when 'release' then 'released' when 'pause' then 'paused' else 'closed' end,
  revision=revision+1,review_digest=p_review_digest,
  acceptance_digest=case when p_action='accept' then p_review_digest else acceptance_digest end,
  accepted_at=case when p_action='accept' then clock_timestamp() else accepted_at end,updated_at=clock_timestamp()
  where id=d.id returning * into d;
 return to_jsonb(d);
end;
$$;

create function public.erase_content_analysis_admission_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.content_analysis_admissions d set manifest=null,user_id=null,idempotency_key=null,review_digest=null,
  state='closed',revision=revision+1,updated_at=clock_timestamp(),redacted_at=clock_timestamp()
  where d.manifest is not null and d.user_id=old.user_id and (tg_table_name='reader_workspaces' or exists(
   select 1 from jsonb_array_elements(d.manifest->'slots') x where case when tg_table_name='reader_content_analysis_jobs' then (to_jsonb(old)->>'id') in (x->>'jobId',x->>'predecessorJobId') else x->>'updateId'=(to_jsonb(old)->>'id') end));
 return old;
end;
$$;
create trigger erase_content_analysis_admission_source before delete on public.reader_source_updates for each row execute function public.erase_content_analysis_admission_evidence();
create trigger erase_content_analysis_admission_workspace before delete on public.reader_workspaces for each row execute function public.erase_content_analysis_admission_evidence();
create trigger erase_content_analysis_admission_job before delete on public.reader_content_analysis_jobs for each row execute function public.erase_content_analysis_admission_evidence();

-- Durable monetary identity is not an operator-resettable queue record.
-- Privacy deletes the job/source cache; FK SET NULL retains financial rows.
revoke delete on public.reader_content_analysis_calls,public.reader_content_analysis_call_attempts from service_role;
create function public.preserve_content_analysis_call_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.source_revision is distinct from old.source_revision or new.maximum_usd is distinct from old.maximum_usd
  or (new.job_id is distinct from old.job_id and not (new.job_id is null and old.job_id is not null
   and not exists(select 1 from public.reader_content_analysis_jobs where id=old.job_id))) then
  raise exception 'Analysis monetary source and job identity is immutable' using errcode='PT409'; end if;
 return new;
end;
$$;
create trigger preserve_content_analysis_call_binding before update of job_id,source_revision,maximum_usd on public.reader_content_analysis_calls
 for each row execute function public.preserve_content_analysis_call_binding();
revoke all on function public.preserve_content_analysis_call_binding() from public,anon,authenticated,service_role;

-- No new RPC is a public or ordinary-reader endpoint. The admission table has
-- no service mutation grant; only the checked owner-context staging/state RPCs
-- write it. Existing worker functions keep their prior service-only ACLs.
revoke all on function public.content_analysis_admission_task_completed(jsonb,text,text),public.content_analysis_generation_v4_contract_hash(),public.content_analysis_admission_slot(uuid),
 public.content_analysis_admission_runtime_review_hash(uuid),public.content_analysis_admission_current(uuid,boolean),
 public.lock_content_analysis_admission_job(uuid,uuid),public.fence_content_analysis_admitted_call(jsonb,jsonb),
 public.stage_content_analysis_admission(text,timestamptz,uuid,text,jsonb),public.set_content_analysis_admission_state(uuid,bigint,text,text,text),
 public.erase_content_analysis_admission_evidence() from public,anon,authenticated,service_role;
grant execute on function public.content_analysis_admission_task_completed(jsonb,text,text),public.content_analysis_generation_v4_contract_hash(),public.content_analysis_admission_slot(uuid),
 public.content_analysis_admission_runtime_review_hash(uuid),public.content_analysis_admission_current(uuid,boolean),
 public.lock_content_analysis_admission_job(uuid,uuid),public.fence_content_analysis_admitted_call(jsonb,jsonb),
 public.stage_content_analysis_admission(text,timestamptz,uuid,text,jsonb),public.set_content_analysis_admission_state(uuid,bigint,text,text,text)
 to service_role;
create or replace function public.invalidate_content_analysis_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.content_analysis_source_revision(new.record) is distinct from public.content_analysis_source_revision(old.record) then
  update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp()
   where user_id=old.user_id and update_id=old.id
    and not public.content_analysis_model_comparison_history(id)
   and (rule_version not in ('content-v3','content-v4') or state not in ('failed','published','skipped','cancelled'));
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
   and (j.rule_version not in ('content-v3','content-v4') or j.state not in ('failed','published','skipped','cancelled'))
   and (not coalesce(new.state->'followedSourceIds' ? j.source_id,false)
    or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(new.state,j.source_id)
    or exists(select 1 from public.reader_source_updates a where a.user_id=j.user_id and a.id=j.update_id and not coalesce(public.content_analysis_eligible(new.state,a.record),false)));
 return new;
end;
$$;
commit;
