-- New reviewed v4 prompt/repair revision and first DeepSeek comparison.
-- Old v4 jobs retain their original contract and remain valid, immutable history.
-- The exact closed cross-model hold exception retains both reviewed hashes;
-- it never settles, releases, retries or excludes an old call from spending.
begin;

alter table public.reader_content_analysis_jobs drop constraint content_analysis_generation_v3_identity;
alter table public.reader_content_analysis_jobs add constraint content_analysis_generation_v3_identity check(
 (rule_version='content-v3' and generation_predecessor_job_id is not null and generation_contract_hash is not null and generation_contract_hash=public.content_analysis_generation_v3_contract_hash())
 or (rule_version='content-v4' and generation_admission_id is not null and generation_contract_hash is not null and generation_contract_hash in ('e5b7e8411c040ab6f12c064829601936faa147b1e44901fb8ff05390e80b1561','6388be0aca7cd311339cb258c88486d52ba81adef38911bd6554383ee64bab91'))
 or (rule_version in ('content-v1','content-v2') and generation_predecessor_job_id is null and generation_contract_hash is null and generation_admission_id is null));

create or replace function public.content_analysis_generation_v4_contract_hash() returns text
language sql immutable security invoker set search_path='' as $$ select '6388be0aca7cd311339cb258c88486d52ba81adef38911bd6554383ee64bab91'::text; $$;

create or replace function public.content_analysis_comparison_unknown_hold(p_user_id text,p_update_id text,p_task text,p_manifest jsonb,p_except_job uuid default null) returns boolean
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
  and p_manifest#>>'{executionIdentity,model}' in ('deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro')
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
   and d.manifest->>'generationContractHash' in ('e5b7e8411c040ab6f12c064829601936faa147b1e44901fb8ff05390e80b1561','6388be0aca7cd311339cb258c88486d52ba81adef38911bd6554383ee64bab91')
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
  or p_manifest#>>'{executionIdentity,model}' not in ('deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro')
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

commit;
