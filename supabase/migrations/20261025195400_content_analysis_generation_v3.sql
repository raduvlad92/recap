-- Bounded, explicit content-v3 successor support. Schema/functions only.
-- No historical rows, annotations, policies, scopes, gates or ledgers are changed.
-- Lock order: workspace -> stable archives -> stable jobs -> scope -> budget
-- -> owner policy -> calls/attempts -> audit. Settlement remains budget -> policy -> call.
begin;
alter table public.reader_content_analysis_jobs drop constraint reader_content_analysis_jobs_rule_version_check;
alter table public.reader_content_analysis_jobs add constraint reader_content_analysis_jobs_rule_version_check
 check(rule_version in ('content-v1','content-v2','content-v3'));
alter table public.reader_content_analysis_jobs
 add column generation_predecessor_job_id uuid references public.reader_content_analysis_jobs(id) on delete cascade,
 add column generation_contract_hash text;
create unique index content_analysis_generation_v3_predecessor on public.reader_content_analysis_jobs(generation_predecessor_job_id)
 where generation_predecessor_job_id is not null;
alter table public.content_analysis_rollout_scopes
 add column generation_rule_version text not null default 'content-v2' check(generation_rule_version in ('content-v2','content-v3')),
 add column generation_revision_manifest jsonb;

-- Pinned to the engine's fixed canonical descriptor; never supplied by an operator epoch.
create function public.content_analysis_generation_v3_contract_hash() returns text
language sql immutable security invoker set search_path='' as $$ select '8b45295994cadc1798f29d61675f169687c5cf187de289c48eb117b5b62d0946'::text; $$;
create function public.content_analysis_generation_v3_digest(p_value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;
create function public.content_analysis_generation_v3_ledger_hash(p_job_id uuid default null) returns text
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(jsonb_build_object(
  'calls',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.reader_content_analysis_calls c where p_job_id is null or c.job_id=p_job_id),'[]'::jsonb),
  'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.call_id,a.attempt_number) from public.reader_content_analysis_call_attempts a
   where p_job_id is null or exists(select 1 from public.reader_content_analysis_calls c where c.id=a.call_id and c.job_id=p_job_id)),'[]'::jsonb)));
$$;
alter table public.reader_content_analysis_jobs add constraint content_analysis_generation_v3_identity check(
 (rule_version='content-v3' and generation_predecessor_job_id is not null
  and generation_contract_hash is not null and generation_contract_hash=public.content_analysis_generation_v3_contract_hash())
 or (rule_version<>'content-v3' and generation_predecessor_job_id is null and generation_contract_hash is null));
alter table public.content_analysis_rollout_scopes add constraint content_analysis_generation_v3_scope check(
 (generation_rule_version='content-v2' and generation_revision_manifest is null)
 or (generation_rule_version='content-v3' and generation_revision_manifest is not null
  and jsonb_typeof(generation_revision_manifest)='object' and octet_length(generation_revision_manifest::text)<=32768
  and update_ids is not null and cardinality(update_ids)<=3 and phase in ('paused','evaluation')));

create function public.content_analysis_generation_v3_slot(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select slot from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id,
 lateral jsonb_array_elements(s.generation_revision_manifest->'slots') slot
 where j.id=p_job_id and j.rule_version='content-v3' and s.generation_rule_version='content-v3'
  and slot->>'successorJobId'=j.id::text and slot->>'predecessorJobId'=j.generation_predecessor_job_id::text;
$$;
create function public.content_analysis_generation_job_in_scope(p_job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
  where j.id=p_job_id and j.rule_version=s.generation_rule_version and s.phase<>'paused'
   and (s.update_ids is null or j.update_id=any(s.update_ids))
   and (j.rule_version='content-v2' or (j.generation_contract_hash=public.content_analysis_generation_v3_contract_hash()
    and public.content_analysis_generation_v3_slot(j.id) is not null)));
$$;

-- Recheck the private assistant audit after staging as well as its annotation.
-- Processing timestamps may progress; the withheld summary itself may not.
create function public.content_analysis_generation_v3_withhold_valid(p_job_id uuid,p_record jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(slot->>'reason'<>'audited_empty_omission' or (
  slot->>'currentAnnotationHash'=public.content_analysis_generation_v3_digest(jsonb_build_object('videoSummary',p_record->'videoSummary','videoHighlights',p_record->'videoHighlights'))
  and exists(select 1 from public.admin_audit_events e where e.id=(slot->>'withholdAuditId')::uuid
   and e.admin_id='system:analysis-quality-review' and e.action='analysis.summary.withheld' and e.target_id=j.update_id
   and e.details->>'predecessorJobId'=j.generation_predecessor_job_id::text and e.details->>'contentHash'=j.content_hash
   and e.details->>'sourceRevision'=j.source_revision and e.details->>'sourceReviewDigest'=slot->>'sourceReviewDigest'
   and e.details->>'reason'='analysis_summary_omission' and e.details->>'actorType'='assistant' and e.details->'humanApproval'='false'::jsonb)),false)
 from public.reader_content_analysis_jobs j,lateral (select public.content_analysis_generation_v3_slot(j.id) slot) selected where j.id=p_job_id;
$$;

-- Only the exact audited, quarantined empty predecessor loses completion status.
create function public.content_analysis_generation_job_completed(p_job_id uuid,p_record jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_task_completed(p_record,j.content_hash,j.task)
  or exists(select 1 from public.reader_content_analysis_jobs d where d.user_id=j.user_id and d.update_id=j.update_id
   and d.content_hash=j.content_hash and d.source_revision=j.source_revision and d.task=j.task
   and d.state in ('published','skipped') and d.id<>j.id
   and not (j.rule_version='content-v3' and d.id=j.generation_predecessor_job_id
    and public.content_analysis_generation_v3_slot(j.id)->>'reason'='audited_empty_omission'))
 from public.reader_content_analysis_jobs j where j.id=p_job_id;
$$;

create function public.preserve_content_analysis_generation_v3_scope() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.generation_rule_version='content-v3' and (new.generation_rule_version is distinct from old.generation_rule_version
  or new.generation_revision_manifest is distinct from old.generation_revision_manifest) then
  raise exception 'Analysis generation manifest is immutable' using errcode='PT409'; end if;
 if new.generation_rule_version='content-v3' and (new.update_ids is null or new.phase not in ('paused','evaluation')
  or exists(select 1 from unnest(new.update_ids) id where not exists(
   select 1 from jsonb_array_elements(new.generation_revision_manifest->'slots') x where x->>'updateId'=id))) then
  raise exception 'Analysis generation scope expansion denied' using errcode='PT409'; end if;
 return new;
end;
$$;
create trigger preserve_content_analysis_generation_v3_scope before update on public.content_analysis_rollout_scopes
 for each row execute function public.preserve_content_analysis_generation_v3_scope();

create function public.preserve_content_analysis_generation_v3_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slot jsonb; prior public.reader_content_analysis_jobs; manifest jsonb;
begin
 if tg_op='UPDATE' then
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
create trigger preserve_content_analysis_generation_v3_job before insert or update on public.reader_content_analysis_jobs
 for each row execute function public.preserve_content_analysis_generation_v3_job();

-- Source/follow changes cancel active work, while terminal v3 evidence remains
-- historical. Blanket cancellation must not roll back caption recovery or an
-- owner's unfollow merely because a prior generation has already finished.
create or replace function public.invalidate_content_analysis_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.content_analysis_source_revision(new.record) is distinct from public.content_analysis_source_revision(old.record) then
  update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp()
   where user_id=old.user_id and update_id=old.id
    and (rule_version<>'content-v3' or state not in ('failed','published','skipped','cancelled'));
 end if;
 return new;
end;
$$;
create or replace function public.invalidate_content_analysis_follow() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.reader_content_analysis_jobs j set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='follow_changed',updated_at=clock_timestamp()
  where j.user_id=new.user_id
   and (j.rule_version<>'content-v3' or j.state not in ('failed','published','skipped','cancelled'))
   and (not coalesce(new.state->'followedSourceIds' ? j.source_id,false)
    or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(new.state,j.source_id)
    or exists(select 1 from public.reader_source_updates a where a.user_id=j.user_id and a.id=j.update_id and not coalesce(public.content_analysis_eligible(new.state,a.record),false)));
 return new;
end;
$$;

create function public.stage_content_analysis_generation_v3(p_user_id text,p_expected_scope_hash text,
 p_expected_workspace_revision timestamptz,p_contract_hash text,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reader_workspaces; s public.content_analysis_rollout_scopes; a public.reader_source_updates;
 prior public.reader_content_analysis_jobs; b public.content_analysis_budget; policy public.reader_content_analysis_policies;
 slot jsonb; ids text[]; successors jsonb; committed numeric; digest_key text; withheld public.admin_audit_events;
 keys text[]:=array['predecessorJobId','successorJobId','updateId','sourceId','task','contentHash','sourceRevision','sourceFingerprint',
  'predecessorJobHash','predecessorLedgerHash','emptyDisposition','sourceReviewDigest','reason','withholdAuditId','currentAnnotationHash'];
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200
  or p_expected_scope_hash is null or p_expected_scope_hash !~ '^[a-f0-9]{64}$' or p_expected_workspace_revision is null
  or p_contract_hash is distinct from public.content_analysis_generation_v3_contract_hash()
  or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>32768
  or not (p_manifest ?& array['protocolVersion','generationContractHash','executionIdentity','configEpoch','runtimeDisabled','workersDrained',
   'expectedBudgetHash','expectedPolicyHash','expectedLedgerHash','expectedCommittedUsd','budget','slots'])
  or (p_manifest-array['protocolVersion','generationContractHash','executionIdentity','configEpoch','runtimeDisabled','workersDrained',
   'expectedBudgetHash','expectedPolicyHash','expectedLedgerHash','expectedCommittedUsd','budget','slots'])<>'{}'::jsonb
  or p_manifest->>'protocolVersion' is distinct from 'content-v3' or p_manifest->>'generationContractHash' is distinct from p_contract_hash
  or p_manifest->'runtimeDisabled' is distinct from 'true'::jsonb or p_manifest->'workersDrained' is distinct from 'true'::jsonb
  or jsonb_typeof(p_manifest->'configEpoch') is distinct from 'string' or length(p_manifest->>'configEpoch')>200
  or jsonb_typeof(p_manifest->'expectedCommittedUsd') is distinct from 'number'
  or p_manifest->'budget' is distinct from '{"originalCommittedUsd":0.018365907,"incrementalAllowanceUsd":0.25,"smokeLifetimeCeilingUsd":0.268365907}'::jsonb
  or jsonb_typeof(p_manifest->'slots') is distinct from 'array' then
  raise exception 'Invalid bounded analysis generation manifest' using errcode='PT400'; end if;
 if jsonb_array_length(p_manifest->'slots') not between 1 and 6 then
  raise exception 'Bounded analysis generation requires one to six slots' using errcode='PT400'; end if;
 foreach digest_key in array array['expectedBudgetHash','expectedPolicyHash','expectedLedgerHash'] loop
  if jsonb_typeof(p_manifest->digest_key) is distinct from 'string' or p_manifest->>digest_key !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid analysis generation snapshot digest' using errcode='PT400'; end if;
 end loop;
 perform public.validate_content_analysis_execution_identity(p_manifest->'executionIdentity',p_manifest#>>'{executionIdentity,model}');
 if p_manifest#>>'{executionIdentity,model}' not in ('deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro') then
  raise exception 'Analysis generation model not approved' using errcode='PT400'; end if;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') loop
  if jsonb_typeof(slot) is distinct from 'object' or not (slot ?& keys) or (slot-keys)<>'{}'::jsonb
   or slot->>'predecessorJobId' is null or slot->>'predecessorJobId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or slot->>'successorJobId' is null or slot->>'successorJobId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or jsonb_typeof(slot->'updateId') is distinct from 'string' or length(slot->>'updateId') not between 1 and 200
   or jsonb_typeof(slot->'sourceId') is distinct from 'string' or length(slot->>'sourceId') not between 1 and 200
   or slot->>'task' is null or slot->>'task' not in ('summary','keywords')
   or slot->>'emptyDisposition' is null or slot->>'emptyDisposition' not in ('findings_expected','no_findings_reviewed','unreviewed')
   or slot->>'reason' is null or slot->>'reason' not in ('format_or_coverage_failure','audited_empty_omission') then
   raise exception 'Invalid analysis generation slot' using errcode='PT400'; end if;
  foreach digest_key in array array['contentHash','sourceRevision','sourceFingerprint','predecessorJobHash','predecessorLedgerHash'] loop
   if jsonb_typeof(slot->digest_key) is distinct from 'string' or slot->>digest_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid analysis generation slot digest' using errcode='PT400'; end if;
  end loop;
  if (slot->>'emptyDisposition'<>'unreviewed' and (jsonb_typeof(slot->'sourceReviewDigest') is distinct from 'string' or slot->>'sourceReviewDigest' !~ '^[a-f0-9]{64}$'))
   or (slot->>'emptyDisposition'='unreviewed' and slot->'sourceReviewDigest'<>'null'::jsonb)
   or (slot->>'reason'='format_or_coverage_failure' and (slot->'withholdAuditId'<>'null'::jsonb or slot->'currentAnnotationHash'<>'null'::jsonb))
   or (slot->>'reason'='audited_empty_omission' and (slot->>'task'<>'summary' or slot->>'emptyDisposition'<>'findings_expected'
    or slot->>'withholdAuditId' is null or slot->>'withholdAuditId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or slot->>'currentAnnotationHash' is null or slot->>'currentAnnotationHash' !~ '^[a-f0-9]{64}$')) then
   raise exception 'Invalid independent source review or omission reference' using errcode='PT400'; end if;
 end loop;
 select array_agg(distinct x->>'updateId' order by x->>'updateId') into ids from jsonb_array_elements(p_manifest->'slots') x;
 if cardinality(ids)>3 or (select count(distinct x->>'predecessorJobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct x->>'successorJobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct (x->>'updateId',x->>'task')) from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots') then
  raise exception 'Duplicate or expanded analysis generation cohort' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for update;
 if not found or w.updated_at is distinct from p_expected_workspace_revision then
  raise exception 'Analysis generation workspace snapshot changed' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates where user_id=p_user_id and id=any(ids) order by id for update;
 -- Lock the bounded owner job set in stable ID order before the scope/finance
 -- rows. This also proves that no sibling/legacy lease can publish into cohort.
 perform 1 from public.reader_content_analysis_jobs where user_id=p_user_id and update_id=any(ids) order by id for update;
 select * into s from public.content_analysis_rollout_scopes where user_id=p_user_id for update;
 if not found then raise exception 'Analysis generation scope unavailable' using errcode='PT409'; end if;
 if s.generation_rule_version='content-v3' then
  if s.generation_revision_manifest is distinct from p_manifest or not exists(select 1 from public.admin_audit_events e
   where e.admin_id='system:analysis-generation' and e.action='analysis.generation_revision.staged' and e.target_id=p_user_id
    and e.details->>'expectedScopeHash'=p_expected_scope_hash and e.details->>'manifestHash'=public.content_analysis_generation_v3_digest(p_manifest)) then
   raise exception 'Analysis generation transition already consumed' using errcode='PT409'; end if;
  select jsonb_agg(x->'successorJobId' order by x->>'successorJobId') into successors from jsonb_array_elements(p_manifest->'slots') x;
  if exists(select 1 from jsonb_array_elements(p_manifest->'slots') x where not exists(select 1 from public.reader_content_analysis_jobs j
    where j.id=(x->>'successorJobId')::uuid and j.user_id=p_user_id and j.rule_version='content-v3'
     and j.generation_predecessor_job_id=(x->>'predecessorJobId')::uuid and j.generation_contract_hash=p_contract_hash)) then
   raise exception 'Staged analysis generation no longer available' using errcode='PT409'; end if;
  return jsonb_build_object('staged',false,'scope',to_jsonb(s),'successorJobIds',successors);
 end if;
 if s.phase<>'paused' or public.content_analysis_generation_v3_digest(to_jsonb(s))<>p_expected_scope_hash
  or s.update_ids is null or (select array_agg(distinct id order by id) from unnest(s.update_ids) id) is distinct from ids
  or exists(select 1 from public.reader_content_analysis_jobs j where j.user_id=p_user_id and j.update_id=any(ids)
   and (j.state in ('running','prepared') or (j.lease_until>clock_timestamp() and j.state not in ('failed','published','skipped','cancelled')))) then
  raise exception 'Analysis generation requires paused drained exact scope' using errcode='PT409'; end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=p_user_id for update;
 if b.id is null or policy.user_id is null or b.enabled or policy.enabled
  or policy.model is distinct from p_manifest#>>'{executionIdentity,model}'
  or public.content_analysis_generation_v3_digest(to_jsonb(b)) is distinct from p_manifest->>'expectedBudgetHash'
  or public.content_analysis_generation_v3_digest(to_jsonb(policy)) is distinct from p_manifest->>'expectedPolicyHash' then
  raise exception 'Analysis generation financial policy snapshot changed' using errcode='PT409'; end if;
 perform 1 from public.reader_content_analysis_calls order by id for update;
 perform 1 from public.reader_content_analysis_call_attempts order by call_id,attempt_number for share;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
 if public.content_analysis_generation_v3_ledger_hash() is distinct from p_manifest->>'expectedLedgerHash'
  or committed is distinct from (p_manifest->>'expectedCommittedUsd')::numeric or committed>.268365907
  or committed<.018365907 then
  raise exception 'Analysis generation ledger snapshot or original smoke ceiling changed' using errcode='PT409'; end if;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') loop
  select * into a from public.reader_source_updates where user_id=p_user_id and id=slot->>'updateId';
  select * into prior from public.reader_content_analysis_jobs where id=(slot->>'predecessorJobId')::uuid;
  if a.id is null or prior.id is null or not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or prior.rule_version<>'content-v2' or prior.user_id<>p_user_id or prior.update_id<>a.id or prior.source_id<>a.source_id
   or prior.task<>slot->>'task' or prior.content_hash<>slot->>'contentHash' or prior.source_revision<>slot->>'sourceRevision'
   or prior.source_fingerprint<>slot->>'sourceFingerprint'
   or a.source_id<>slot->>'sourceId' or prior.content_hash<>encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
   or prior.source_revision<>public.content_analysis_source_revision(a.record)
   or prior.source_fingerprint is distinct from public.content_analysis_source_fingerprint(w.state,a.source_id)
   or public.content_analysis_generation_v3_digest(to_jsonb(prior))<>slot->>'predecessorJobHash'
   or public.content_analysis_generation_v3_ledger_hash(prior.id)<>slot->>'predecessorLedgerHash'
   or public.content_analysis_v2_unknown_hold(p_user_id,a.id,prior.task)
   or not exists(select 1 from public.reader_content_analysis_calls c where c.job_id=prior.id)
   or exists(select 1 from public.reader_content_analysis_calls c where c.job_id=prior.id and (c.actual_usd is null or c.state<>'settled'))
   or public.content_analysis_task_completed(a.record,prior.content_hash,prior.task)
   or exists(select 1 from public.reader_content_analysis_jobs d where d.user_id=p_user_id and d.update_id=a.id and d.task=prior.task
    and d.content_hash=prior.content_hash and d.source_revision=prior.source_revision and d.state in ('published','skipped') and d.id<>prior.id) then
   raise exception 'Analysis generation predecessor or source not eligible' using errcode='PT409'; end if;
  if slot->>'reason'='format_or_coverage_failure' then
   if prior.state<>'failed' or prior.error_code is null or prior.error_code not in ('analysis_unsupported_passage','analysis_unsupported_summary_number','analysis_incomplete_coverage','analysis_unsupported_mention') then
    raise exception 'Analysis generation requires diagnosed settled format or coverage failure' using errcode='PT409'; end if;
  else
   select * into withheld from public.admin_audit_events where id=(slot->>'withholdAuditId')::uuid for share;
   if prior.state<>'published' or prior.task<>'summary' or prior.result->>'state' is distinct from 'empty'
    or prior.result#>'{patch,videoHighlights}' is distinct from '[]'::jsonb
    or prior.result#>>'{evidence,protocolVersion}' is distinct from 'content-v2'
    or a.record#>>'{videoSummary,status}' is distinct from 'unavailable'
    or a.record#>>'{videoSummary,captionHash}' is distinct from prior.content_hash or a.record->'videoHighlights' is distinct from '[]'::jsonb
    or a.record#>>'{processing,contentHash}' is distinct from prior.content_hash or a.record#>>'{processing,recap}' is distinct from 'failed'
    or a.record#>>'{processing,reason}' is distinct from 'analysis_summary_omission'
    or withheld.id is null or withheld.admin_id<>'system:analysis-quality-review' or withheld.action<>'analysis.summary.withheld' or withheld.target_id<>a.id
    or withheld.details->>'actorType' is distinct from 'assistant' or withheld.details->'humanApproval' is distinct from 'false'::jsonb
    or withheld.details->>'reason' is distinct from 'analysis_summary_omission' or withheld.details->>'predecessorJobId' is distinct from prior.id::text
    or withheld.details->>'contentHash' is distinct from prior.content_hash or withheld.details->>'sourceRevision' is distinct from prior.source_revision
    or withheld.details->>'sourceReviewDigest' is distinct from slot->>'sourceReviewDigest'
    or withheld.details->>'previousRecordHash' is null or withheld.details->>'previousRecordHash' !~ '^[a-f0-9]{64}$'
    or withheld.details->>'withheldRecordHash' is distinct from public.content_analysis_generation_v3_digest(a.record)
    or slot->>'currentAnnotationHash' is distinct from public.content_analysis_generation_v3_digest(jsonb_build_object('videoSummary',a.record->'videoSummary','videoHighlights',a.record->'videoHighlights')) then
    raise exception 'Exact independently audited withheld v2 empty required' using errcode='PT409'; end if;
  end if;
 end loop;
 update public.content_analysis_rollout_scopes set generation_rule_version='content-v3',generation_revision_manifest=p_manifest,
  updated_at=clock_timestamp() where user_id=p_user_id returning * into s;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'successorJobId' loop
  insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,rule_version,task,source_revision,
   source_fingerprint,workspace_revision,config_epoch,generation_predecessor_job_id,generation_contract_hash)
   values((slot->>'successorJobId')::uuid,p_user_id,slot->>'updateId',slot->>'sourceId',slot->>'contentHash','content-v3',slot->>'task',
    slot->>'sourceRevision',slot->>'sourceFingerprint',w.updated_at,p_manifest->>'configEpoch',(slot->>'predecessorJobId')::uuid,p_contract_hash);
 end loop;
 insert into public.admin_audit_events(admin_id,action,target_id,details) values('system:analysis-generation','analysis.generation_revision.staged',p_user_id,
  jsonb_build_object('expectedScopeHash',p_expected_scope_hash,'manifestHash',public.content_analysis_generation_v3_digest(p_manifest),
   'generationContractHash',p_contract_hash,'taskCount',jsonb_array_length(p_manifest->'slots'),'sourceCount',cardinality(ids),
   'actorType','assistant','humanApproval',false));
 select jsonb_agg(x->'successorJobId' order by x->>'successorJobId') into successors from jsonb_array_elements(p_manifest->'slots') x;
 return jsonb_build_object('staged',true,'scope',to_jsonb(s),'successorJobIds',successors);
end;
$$;

create or replace function public.set_content_analysis_rollout_scope(p_user_id text,p_update_ids text[],p_phase text) returns jsonb
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
 select * into saved from public.content_analysis_rollout_scopes where user_id=p_user_id for update;
 if saved.generation_rule_version='content-v3' and (p_phase not in ('paused','evaluation') or p_update_ids is null
  or exists(select 1 from unnest(p_update_ids) id where not exists(select 1 from jsonb_array_elements(saved.generation_revision_manifest->'slots') x where x->>'updateId'=id))) then
  raise exception 'Analysis generation scope expansion denied' using errcode='PT409'; end if;
 -- Historical v1 outcomes, errors, leases, results and all calls remain exact.
 -- Scope/version fences below stop v1 sync/claim/continuation from competing.
 -- The new v2 job records explicit protocol supersession without history edits.
 insert into public.content_analysis_rollout_scopes(user_id,update_ids,phase)
  values(p_user_id,p_update_ids,p_phase) on conflict(user_id) do update
  set update_ids=excluded.update_ids,phase=excluded.phase,updated_at=clock_timestamp() returning * into saved;
 return to_jsonb(saved);
end;
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
 return jsonb_build_object('job',to_jsonb(j),'record',a.record);
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

create or replace function public.claim_content_analysis_job_v2(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 for candidate in select q.id,q.user_id,q.update_id from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  join public.reader_source_updates r on r.user_id=q.user_id and r.id=q.update_id
  where q.rule_version in ('content-v2','content-v3') and public.content_analysis_generation_job_in_scope(q.id)
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
   'sourceReviewDigest',public.content_analysis_generation_v3_slot(j.id)->'sourceReviewDigest')) else '{}'::jsonb end;
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
 if j.rule_version in ('content-v2','content-v3') and p_yield then
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
  state_name:=case when j.rule_version='content-v3' and p_error_code='analysis_storage_unavailable' and p_retryable and j.attempts<3 then 'queued'
   when p_error_code='analysis_provider_http_429' then 'blocked' when p_yield then 'queued'
   when p_error_code in ('analysis_provider_http_429','analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_correction_charge_unknown','analysis_cached_input_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
   else 'failed' end;
 end if;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_error_code='analysis_provider_http_429' then 'infinity'::timestamptz when due is not null then case when state_name='queued' then due else 'infinity'::timestamptz end
   when p_yield then clock_timestamp()+interval '1 second'
   when j.rule_version='content-v3' and state_name='queued' and p_error_code='analysis_storage_unavailable' then clock_timestamp()+interval '1 minute'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when j.rule_version<>'content-v3' and state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  -- Queue claim attempts are separate from monetary attempts on a stable key.
  -- Known429 attempt limits live in calls; unrelated claim/yield pauses cannot
  -- prematurely exhaust a safe, due monetary retry.
  attempts=case when due is not null and state_name='queued' then greatest(0,attempts-1)
   else greatest(0,attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end) end,
  updated_at=clock_timestamp() where id=j.id;
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield or controlled or (j.rule_version='content-v3' and state_name='queued') then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name,'retryAt',case when state_name='queued' then due else null end);
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
   or k !~ '^(summary:v[23]:chunk:(0|[1-9][0-9]*)|summary-reduce:v[23]:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v[23]:verify:0|extractor:v[23]:chunk:(0|[1-9][0-9]*)|checker:v[23]:chunk:(0|[1-9][0-9]*))(:repair:1)?$')
  or (select count(distinct k) from unnest(p_call_keys) k)<>cardinality(p_call_keys)
  or (p_after_key is not null and not p_after_key=any(p_call_keys)) then
  raise exception 'Invalid cached analysis page' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.rule_version not in ('content-v2','content-v3') or j.state<>'running'
  or (j.rule_version='content-v3' and 'summary:v3:verify:0:repair:1'=any(p_call_keys))
  or exists(select 1 from unnest(p_call_keys) k where strpos(k,case when j.rule_version='content-v3' then ':v3:' else ':v2:' end)=0)
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

create or replace function public.mark_content_analysis_call_invalid(p_job_id uuid,p_lease_token uuid,p_call_key text,p_request_hash text,p_error_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; c public.reader_content_analysis_calls; digest text;
begin
 if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' or p_request_hash is null
  or p_request_hash !~ '^[a-f0-9]{64}$' or p_call_key is null or p_call_key !~ ':v[23]:' or strpos(p_call_key,':repair:')>0 then
  raise exception 'Invalid analysis invalidity marker' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if p_lease_token is null or j.rule_version not in ('content-v2','content-v3') or strpos(p_call_key,case when j.rule_version='content-v3' then ':v3:' else ':v2:' end)=0 or j.state<>'running' then
  raise exception 'Current content-v2 lease required' using errcode='PT409'; end if;
 if j.rule_version='content-v3' and (p_call_key='summary:v3:verify:0' or p_error_code in ('analysis_provider_refusal','analysis_unsupported_summary_claim','analysis_invalid_summary_verification','analysis_incomplete_summary_verification')) then
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
  select generation_revision_manifest into manifest from public.content_analysis_rollout_scopes where user_id=j.user_id;
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

-- Protocol evidence is request-bound; independent empty permission comes from
-- the immutable trusted scope, never a model-supplied result or worker flag.
create function public.validate_content_analysis_generation_v3_result(p_job_id uuid,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; slot jsonb;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if j.rule_version is distinct from 'content-v3' then return; end if;
 slot:=public.content_analysis_generation_v3_slot(j.id);
 if slot is null or p_result#>>'{evidence,protocolVersion}' is distinct from 'content-v3'
  or p_result#>>'{evidence,generationContractHash}' is distinct from j.generation_contract_hash then
  raise exception 'Analysis generation result protocol changed' using errcode='PT409'; end if;
 if j.task='summary' and (p_result->>'state'='empty' or p_result#>'{patch,videoHighlights}'='[]'::jsonb)
  and (slot->>'emptyDisposition' is distinct from 'no_findings_reviewed' or slot->>'sourceReviewDigest' is null) then
  raise exception 'Independent full-source no-findings review required' using errcode='PT409'; end if;
end;
$$;

create or replace function public.finish_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs;
begin
 if p_lease_token is null then raise exception 'Lease required' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 perform public.validate_content_analysis_generation_v3_result(j.id,p_result);
 if j.state='prepared' then
  if j.result is distinct from p_result then raise exception 'Prepared result changed' using errcode='PT409'; end if;
  return jsonb_build_object('prepared',true,'jobId',j.id);
 end if;
 if j.state<>'running' then raise exception 'Job not running' using errcode='PT409'; end if;
 perform public.validate_content_analysis_result(j.task,p_result,locked->'record',j.content_hash);
 update public.reader_content_analysis_jobs set state='prepared',result=p_result,updated_at=clock_timestamp()
  where id=j.id and lease_token=p_lease_token and state='running';
 return jsonb_build_object('prepared',true,'jobId',j.id);
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

revoke all on function public.content_analysis_generation_v3_contract_hash(),
 public.content_analysis_generation_v3_digest(jsonb),
 public.content_analysis_generation_v3_ledger_hash(uuid),
 public.content_analysis_generation_v3_slot(uuid),
 public.content_analysis_generation_job_in_scope(uuid),
 public.content_analysis_generation_v3_withhold_valid(uuid,jsonb),
 public.content_analysis_generation_job_completed(uuid,jsonb),
 public.preserve_content_analysis_generation_v3_scope(),
 public.preserve_content_analysis_generation_v3_job(),
 public.stage_content_analysis_generation_v3(text,text,timestamptz,text,jsonb),
 public.validate_content_analysis_generation_v3_result(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.content_analysis_generation_v3_contract_hash(),
 public.content_analysis_generation_v3_digest(jsonb),
 public.content_analysis_generation_v3_ledger_hash(uuid),
 public.content_analysis_generation_v3_slot(uuid),
 public.content_analysis_generation_job_in_scope(uuid),
 public.content_analysis_generation_v3_withhold_valid(uuid,jsonb),
 public.content_analysis_generation_job_completed(uuid,jsonb),
 public.stage_content_analysis_generation_v3(text,text,timestamptz,text,jsonb),
 public.validate_content_analysis_generation_v3_result(uuid,jsonb) to service_role;
commit;
