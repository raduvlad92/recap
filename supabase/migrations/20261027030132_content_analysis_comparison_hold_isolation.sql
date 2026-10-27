-- A separately requested, first comparison model may run while another model's
-- closed comparison retains an ambiguous charge. No hold is settled, removed,
-- copied, retried or excluded from any monetary total by this migration.
begin;
create function public.content_analysis_comparison_unknown_hold(p_user_id text,p_update_id text,p_task text,p_manifest jsonb,p_except_job uuid default null) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;j public.reader_content_analysis_jobs;d public.content_analysis_admissions;
 target_slot jsonb;origin_slot jsonb;target_cohort text;origin_cohort text;eligible boolean;
begin
 -- This predicate never grants a general cross-model exception. Invalid or
 -- incomplete comparison context fails closed, including explicit JSON nulls.
 if not coalesce(p_user_id is not null and p_update_id is not null and p_task in ('summary','keywords')
  and jsonb_typeof(p_manifest)='object' and p_manifest->>'purpose'='content_model_comparison'
  and p_manifest->>'phase'='comparison' and p_manifest->>'protocolVersion'='content-v4'
  and p_manifest->'spendingDisabled'='true'::jsonb and p_manifest->'workersDrained'='true'::jsonb
  and p_manifest->>'perCallMaximumUsd' is not null and (p_manifest->>'perCallMaximumUsd')::numeric=.10
  and p_manifest->>'generationContractHash'=public.content_analysis_generation_v4_contract_hash()
  and jsonb_typeof(p_manifest->'suiteId')='string' and length(btrim(p_manifest->>'suiteId')) between 1 and 200
  and jsonb_typeof(p_manifest->'round')='number' and p_manifest->>'round' ~ '^[1-9][0-9]{0,5}$'
  and p_manifest->>'sourceReviewDigest' ~ '^[a-f0-9]{64}$'
  and p_manifest->'commonLimits'='{"chunkChars":1250,"maxOutputTokens":3072,"maxInputTokens":27700,"overlapChars":256,"maxChunks":800,"maxSourceChars":1000000,"maxCallUsd":0.10}'::jsonb
  and p_manifest#>>'{executionIdentity,model}' in ('minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro')
  and jsonb_typeof(p_manifest->'slots')='array',false) then return true; end if;
 perform public.validate_content_analysis_execution_identity(p_manifest->'executionIdentity',p_manifest#>>'{executionIdentity,model}');
 if jsonb_array_length(p_manifest->'slots') not in (3,6)
  or (select count(*) from jsonb_array_elements(p_manifest->'slots') x where x->>'updateId'=p_update_id and x->>'task'=p_task)<>1 then return true; end if;
 select x into target_slot from jsonb_array_elements(p_manifest->'slots') x where x->>'updateId'=p_update_id and x->>'task'=p_task;
 target_cohort:=public.content_analysis_comparison_cohort_digest(p_manifest->'slots');
 for c in select call.* from public.reader_content_analysis_calls call
  left join public.reader_content_analysis_jobs job on job.id=call.job_id
  where call.actual_usd is null and (
   (call.user_id=p_user_id and (call.job_id is null or job.id is null or job.user_id is distinct from p_user_id
    or (job.update_id=p_update_id and job.task=p_task and (p_except_job is null or job.id<>p_except_job))))
   or (job.user_id=p_user_id and job.update_id=p_update_id and job.task=p_task and call.user_id is distinct from p_user_id))
 loop
  select * into j from public.reader_content_analysis_jobs where id=c.job_id;
  if not found then return true; end if;
  select * into d from public.content_analysis_admissions where id=j.generation_admission_id;
  if not found or not coalesce(d.purpose='content_model_comparison' and d.user_id=p_user_id and d.state='closed'
   and d.manifest is not null and jsonb_typeof(d.manifest)='object' and jsonb_typeof(d.manifest->'slots')='array',false) then return true; end if;
  if jsonb_array_length(d.manifest->'slots') not in (3,6)
   or (select count(*) from jsonb_array_elements(d.manifest->'slots') x where x->>'jobId'=j.id::text)<>1 then return true; end if;
  select x into origin_slot from jsonb_array_elements(d.manifest->'slots') x where x->>'jobId'=j.id::text;
  origin_cohort:=public.content_analysis_comparison_cohort_digest(d.manifest->'slots');
  eligible:=d.revision>=3 and d.manifest ?& array['purpose','phase','suiteId','round','spendingDisabled','workersDrained','protocolVersion','generationContractHash','commonLimits','executionIdentity','selectionRevision','configEpoch','expectedLedgerHash','expectedCommittedUsd','overallCommitmentCeilingUsd','maximumFreshUsd','maximumCalls','perCallMaximumUsd','sourceReviewDigest','slots']
   and (d.manifest->>'perCallMaximumUsd')::numeric=.10
   and d.manifest_digest=public.content_analysis_generation_v3_digest(d.manifest)
   and d.owner_digest=public.content_analysis_generation_v3_digest(to_jsonb(p_user_id))
   and d.predecessor_digest=public.content_analysis_generation_v3_digest(jsonb_build_array(d.manifest->>'suiteId',d.manifest#>>'{executionIdentity,model}',origin_cohort))
   and d.redacted_at is null and d.acceptance_digest is null and d.accepted_at is null and d.review_digest ~ '^[a-f0-9]{64}$'
   and d.manifest->>'purpose'='content_model_comparison' and d.manifest->>'phase'='comparison'
   and d.manifest->>'protocolVersion'='content-v4'
   and d.manifest->>'generationContractHash'=public.content_analysis_generation_v4_contract_hash()
   and d.manifest->'spendingDisabled'='true'::jsonb and d.manifest->'workersDrained'='true'::jsonb
   and d.manifest->>'suiteId'=p_manifest->>'suiteId' and d.manifest->'round'=p_manifest->'round'
   and origin_cohort=target_cohort and d.manifest->'commonLimits'=p_manifest->'commonLimits'
   and d.manifest->>'sourceReviewDigest'=p_manifest->>'sourceReviewDigest'
   and d.manifest#>>'{executionIdentity,model}' in ('minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro')
   and d.manifest#>>'{executionIdentity,model}'<>p_manifest#>>'{executionIdentity,model}'
   and (select count(*) from public.reader_content_analysis_jobs q where q.generation_admission_id=d.id)=jsonb_array_length(d.manifest->'slots')
   and not exists(select 1 from public.reader_content_analysis_jobs q where q.generation_admission_id=d.id
    and (q.state not in ('failed','blocked','cancelled','skipped','evaluated') or q.lease_token is not null or q.lease_until is not null))
   and j.user_id=p_user_id and j.update_id=p_update_id and j.task=p_task and j.rule_version='content-v4'
   and j.generation_comparison_id is null and j.generation_predecessor_job_id is null
   and j.generation_contract_hash=d.manifest->>'generationContractHash' and j.config_epoch=d.manifest->>'configEpoch'
   and j.state in ('failed','blocked','cancelled','skipped') and j.lease_token is null and j.lease_until is null
   and origin_slot ?& array['jobId','predecessorJobId','updateId','sourceId','task','contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','sourceReviewDigest','emptyDisposition']
   and not (origin_slot ? 'prefixCalls' or origin_slot ? 'allowedFreshRequest' or origin_slot ? 'commonLimits')
   and origin_slot->>'predecessorJobId' is null
   and (origin_slot->>'updateId',origin_slot->>'sourceId',origin_slot->>'task',origin_slot->>'contentHash',origin_slot->>'sourceRevision',origin_slot->>'sourceFingerprint')
    =(j.update_id,j.source_id,j.task,j.content_hash,j.source_revision,j.source_fingerprint)
   and (target_slot->>'updateId',target_slot->>'sourceId',target_slot->>'task',target_slot->>'contentHash',target_slot->>'sourceRevision',target_slot->>'sourceFingerprint')
    =(j.update_id,j.source_id,j.task,j.content_hash,j.source_revision,j.source_fingerprint)
   and origin_slot->>'sourceReviewDigest'=target_slot->>'sourceReviewDigest'
   and c.user_id=j.user_id and c.source_revision=j.source_revision and c.model=d.manifest#>>'{executionIdentity,model}'
   and c.execution_identity=d.manifest->'executionIdentity' and c.request_hash ~ '^[a-f0-9]{64}$'
   and c.state in ('reserved','unknown') and c.maximum_usd>0 and c.maximum_usd<=least(.10,(d.manifest->>'perCallMaximumUsd')::numeric)
   and c.maximum_usd::text not in ('NaN','Infinity','-Infinity')
   and c.call_key ~ '^(summary:v4:chunk:(0|[1-9][0-9]*)|summary-reduce:v4:level:(0|[1-9][0-9]*):group:(0|[1-9][0-9]*)|summary:v4:verify:0|extractor:v4:chunk:(0|[1-9][0-9]*)|checker:v4:chunk:(0|[1-9][0-9]*))(:repair:1)?$'
   and c.call_key<>'summary:v4:verify:0:repair:1'
   and ((j.task='summary' and c.call_key ~ '^summary') or (j.task='keywords' and c.call_key ~ '^(extractor|checker):'))
   and (c.result is null or (jsonb_typeof(c.result)='object' and c.result->>'requestHash'=c.request_hash and c.result->'executionIdentity'=c.execution_identity));
  -- Every relevant hold must qualify individually; one valid origin never
  -- hides another historical, orphaned, malformed or same-model commitment.
  if not coalesce(eligible,false) then return true; end if;
  perform public.validate_content_analysis_execution_identity(d.manifest->'executionIdentity',c.model);
 end loop;
 return false;
exception when others then
 -- Malformed historical context is blocked, never inferred or repaired here.
 return true;
end;
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
  and not case when d.purpose='content_model_comparison' then public.content_analysis_comparison_unknown_hold(j.user_id,j.update_id,j.task,d.manifest,j.id)
   else public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) end
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

create or replace function public.stage_content_analysis_comparison(p_user_id text,p_expected_workspace_revision timestamptz,p_admission_id uuid,p_idempotency_key text,p_manifest jsonb) returns jsonb
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
  or (jsonb_array_length(p_manifest->'slots')=3 and (select count(distinct x->>'task') from jsonb_array_elements(p_manifest->'slots') x)<>1) then
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
   or public.content_analysis_comparison_unknown_hold(p_user_id,a.id,slot->>'task',p_manifest) then
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

create or replace function public.fence_content_analysis_admitted_call(p_new jsonb,p_old jsonb default null) returns void
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
 if (case when d.purpose='content_model_comparison' then public.content_analysis_comparison_unknown_hold(j.user_id,j.update_id,j.task,d.manifest,j.id)
   else public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id) end)
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

revoke all on function public.content_analysis_comparison_unknown_hold(text,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.content_analysis_comparison_unknown_hold(text,text,text,jsonb,uuid) to service_role;
commit;
