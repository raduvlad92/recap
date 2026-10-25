-- ONE sealed same-H3 approved execution-profile comparison. No runtime, source,
-- settings, policy, original manifest, annotation, ledger or audit data changes.
-- Lock order: workspace -> archives -> jobs -> scope -> comparison -> budget
-- -> policy -> calls/attempts -> review/audit. Never lock settings after policy.
begin;
create table public.content_analysis_model_comparisons (
 id uuid primary key,
 user_id text,
 owner_digest text not null check(owner_digest ~ '^[a-f0-9]{64}$'),
 purpose text not null check(purpose='approved_model_comparison'),
 original_manifest_digest text not null check(original_manifest_digest ~ '^[a-f0-9]{64}$'),
 generation_contract_hash text not null check(generation_contract_hash=public.content_analysis_generation_v3_contract_hash()),
 manifest jsonb check(manifest is null or (jsonb_typeof(manifest)='object' and octet_length(manifest::text)<=32768)),
 manifest_digest text not null check(manifest_digest ~ '^[a-f0-9]{64}$'),
 idempotency_key text check(length(idempotency_key) between 1 and 200),
 state text not null default 'staged' check(state in ('staged','released','paused','closed')),
 revision bigint not null default 1 check(revision>=1),
 review_digest text check(review_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 redacted_at timestamptz,
 unique(owner_digest,original_manifest_digest,purpose),
 check((manifest is null)=(redacted_at is not null)),
 check(manifest is not null or (state='closed' and user_id is null and idempotency_key is null and review_digest is null))
);
alter table public.content_analysis_model_comparisons enable row level security;
revoke all on public.content_analysis_model_comparisons from public,anon,authenticated,service_role;
grant select on public.content_analysis_model_comparisons to service_role;
alter table public.reader_content_analysis_jobs add column generation_comparison_id uuid
 references public.content_analysis_model_comparisons(id) on delete restrict;
alter table public.reader_content_analysis_jobs add constraint content_analysis_comparison_v3_only
 check(generation_comparison_id is null or rule_version='content-v3');
-- Locate only the old five-column constraint; do not weaken predecessor/call uniqueness.
do $$ declare n text; begin
 select c.conname into strict n from pg_constraint c where c.conrelid='public.reader_content_analysis_jobs'::regclass
  and c.contype='u' and (select array_agg(a.attname::text order by k.ordinality) from unnest(c.conkey) with ordinality k(num,ordinality)
   join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num)=array['user_id','update_id','content_hash','rule_version','task'];
 execute format('alter table public.reader_content_analysis_jobs drop constraint %I',n);
end $$;
create unique index content_analysis_original_logical_job on public.reader_content_analysis_jobs(user_id,update_id,content_hash,rule_version,task)
 where generation_comparison_id is null;
create unique index content_analysis_comparison_logical_job on public.reader_content_analysis_jobs(generation_comparison_id,user_id,update_id,content_hash,rule_version,task)
 where generation_comparison_id is not null;

-- Only the newly declared NULL field is omitted. Historical hashes were made
-- before it existed; no historical audit/manifest/paid row is rewritten.
create function public.content_analysis_model_comparison_job_digest(p_value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(case when p_value->'generation_comparison_id'='null'::jsonb then p_value-'generation_comparison_id' else p_value end);
$$;
create function public.content_analysis_model_comparison_annotation_hash(p_record jsonb,p_task text) returns text
language sql immutable strict security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(case when p_task='summary' then
  jsonb_build_object('videoSummary',p_record->'videoSummary','videoHighlights',p_record->'videoHighlights') else
  jsonb_build_object('topics',p_record->'topics','brands',p_record->'brands','videoKeywords',p_record->'videoKeywords',
   'keywordRuleVersion',p_record->'keywordRuleVersion','keywordProvenance',public.content_analysis_keyword_provenance(p_record)) end);
$$;
create function public.content_analysis_model_comparison_review_hash(p_user_id text,p_update_id text) returns text
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb))
 from public.admin_keyword_reviews r where r.user_id=p_user_id and r.update_id=p_update_id;
$$;
create function public.content_analysis_generation_v3_manifest(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when j.generation_comparison_id is null then s.generation_revision_manifest else c.manifest end
 from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
 left join public.content_analysis_model_comparisons c on c.id=j.generation_comparison_id and c.user_id=j.user_id
 where j.id=p_job_id and j.rule_version='content-v3';
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
    on conflict(user_id,update_id,content_hash,rule_version,task) where generation_comparison_id is null do update set
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
    on conflict(user_id,update_id,content_hash,rule_version,task) where generation_comparison_id is null do update set
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

create or replace function public.stage_content_analysis_generation_v3(p_user_id text,p_expected_scope_hash text,
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
   or (public.content_analysis_model_comparison_job_digest(to_jsonb(prior))<>slot->>'predecessorJobHash' and public.content_analysis_generation_v3_digest(to_jsonb(prior))<>slot->>'predecessorJobHash')
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

create or replace function public.content_analysis_generation_v3_slot(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then (jsonb_agg(x.slot)->0) else null end from (
  select slot from public.reader_content_analysis_jobs j
  join public.content_analysis_rollout_scopes s on s.user_id=j.user_id,
  lateral jsonb_array_elements(s.generation_revision_manifest->'slots') slot
  where j.id=p_job_id and j.rule_version='content-v3' and j.generation_comparison_id is null
   and s.generation_rule_version='content-v3' and slot->>'successorJobId'=j.id::text
   and slot->>'predecessorJobId'=j.generation_predecessor_job_id::text
  union all
  select slot from public.reader_content_analysis_jobs j
  join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
  join public.content_analysis_model_comparisons c on c.id=j.generation_comparison_id and c.user_id=j.user_id,
  lateral jsonb_array_elements(c.manifest->'slots') slot,
  lateral jsonb_array_elements(s.generation_revision_manifest->'slots') original
  where j.id=p_job_id and j.rule_version='content-v3' and s.generation_rule_version='content-v3'
   and c.original_manifest_digest=public.content_analysis_generation_v3_digest(s.generation_revision_manifest)
   and c.manifest_digest=public.content_analysis_generation_v3_digest(c.manifest)
   and slot->>'successorJobId'=j.id::text and slot->>'predecessorJobId'=j.generation_predecessor_job_id::text
   and original->>'successorJobId'=slot->>'predecessorJobId'
   and original->>'predecessorJobId'=slot->>'rootJobId'
   and public.content_analysis_generation_v3_digest(original)=slot->>'originalSlotDigest'
 ) x;
$$;
create function public.content_analysis_model_comparison_original_slot(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then jsonb_agg(x)->0 else null end
 from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id,
 lateral jsonb_array_elements(s.generation_revision_manifest->'slots') x
 where j.id=p_job_id and public.content_analysis_generation_v3_slot(j.id) is not null
  and ((j.generation_comparison_id is null and x->>'successorJobId'=j.id::text)
   or (j.generation_comparison_id is not null and x->>'successorJobId'=j.generation_predecessor_job_id::text
    and public.content_analysis_generation_v3_digest(x)=public.content_analysis_generation_v3_slot(j.id)->>'originalSlotDigest'));
$$;
create or replace function public.content_analysis_generation_v3_withhold_valid(p_job_id uuid,p_record jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(slot->>'reason'<>'audited_empty_omission' or (
  slot->>'currentAnnotationHash'=public.content_analysis_model_comparison_annotation_hash(p_record,'summary')
  and exists(select 1 from public.admin_audit_events e where e.id=(slot->>'withholdAuditId')::uuid
   and e.admin_id='system:analysis-quality-review' and e.action='analysis.summary.withheld' and e.target_id=j.update_id
   and e.details->>'predecessorJobId'=slot->>'predecessorJobId' and e.details->>'contentHash'=j.content_hash
   and e.details->>'sourceRevision'=j.source_revision and e.details->>'sourceReviewDigest'=slot->>'sourceReviewDigest'
   and e.details->>'reason'='analysis_summary_omission' and e.details->>'actorType'='assistant' and e.details->'humanApproval'='false'::jsonb)),false)
 from public.reader_content_analysis_jobs j,
 lateral (select public.content_analysis_model_comparison_original_slot(j.id) slot) selected where j.id=p_job_id;
$$;
create or replace function public.content_analysis_generation_job_completed(p_job_id uuid,p_record jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_task_completed(p_record,j.content_hash,j.task)
  or exists(select 1 from public.reader_content_analysis_jobs d where d.user_id=j.user_id and d.update_id=j.update_id
   and d.content_hash=j.content_hash and d.source_revision=j.source_revision and d.task=j.task
   and d.state in ('published','skipped') and d.id<>j.id
   and not (j.rule_version='content-v3'
    and d.id::text=public.content_analysis_model_comparison_original_slot(j.id)->>'predecessorJobId'
    and public.content_analysis_model_comparison_original_slot(j.id)->>'reason'='audited_empty_omission'
    and public.content_analysis_generation_v3_withhold_valid(j.id,p_record)))
 from public.reader_content_analysis_jobs j where j.id=p_job_id;
$$;

-- A sibling keyword publication may create new private pending identities.
-- That authorized write is not an admin decision and must not invalidate an
-- in-flight summary. Remove only exact, still-pending rows attributable to the
-- published sibling when reconstructing the sealed prior review snapshot.
-- Any decision/edit to old or newly pending identities remains a drift fence.
create function public.content_analysis_model_comparison_runtime_review_hash(p_job_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select public.content_analysis_generation_v3_digest(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb))
 from public.reader_content_analysis_jobs j join public.admin_keyword_reviews r on r.user_id=j.user_id and r.update_id=j.update_id
 where j.id=p_job_id and not (j.task='summary' and r.status='pending' and r.resolved_label is null and r.resolved_kind is null
  and exists(select 1 from public.reader_content_analysis_jobs sibling,
   lateral jsonb_array_elements(sibling.result->'pending') proposal
   where sibling.generation_comparison_id=j.generation_comparison_id and sibling.user_id=j.user_id and sibling.update_id=j.update_id
    and sibling.content_hash=j.content_hash and sibling.task='keywords' and sibling.state='published'
    and r.content_hash=sibling.content_hash and r.source_id=sibling.source_id
    and r.created_at>=sibling.created_at and r.updated_at<=sibling.published_at
    and r.label=proposal->>'label' and r.kind=proposal->>'kind' and r.confidence=(proposal->>'confidence')::integer
    and r.reason=proposal->>'reason' and r.evidence_quote=proposal->>'evidenceQuote' and r.proposed_ranges=proposal->'ranges'));
$$;

-- Snapshot validation is shared by stage/release and every runtime boundary.
-- No settings lock: the existing selector serializes on policy; callers recheck
-- this predicate after their financial locks. It never calls the selector.
create function public.content_analysis_model_comparison_current(p_job_id uuid,p_require_released boolean default true) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(j.rule_version='content-v3' and j.generation_contract_hash=public.content_analysis_generation_v3_contract_hash()
  and c.manifest is not null and (not p_require_released or c.state='released') and c.state<>'closed'
  and s.generation_rule_version='content-v3' and (not p_require_released or s.phase='evaluation')
  and j.update_id=any(s.update_ids)
  and public.content_analysis_generation_v3_slot(j.id) is not null
  and slot->>'updateId'=j.update_id and slot->>'sourceId'=j.source_id and slot->>'task'=j.task
  and slot->>'contentHash'=j.content_hash and slot->>'sourceRevision'=j.source_revision
  and slot->>'sourceFingerprint'=j.source_fingerprint and slot->>'rootJobId'=prior.generation_predecessor_job_id::text
  and prior.generation_comparison_id is null and prior.rule_version='content-v3' and prior.state='failed'
  and prior.user_id=j.user_id and prior.update_id=j.update_id and prior.task=j.task
  and prior.content_hash=j.content_hash and prior.source_revision=j.source_revision and prior.source_fingerprint=j.source_fingerprint
  and root.rule_version='content-v2' and root.user_id=j.user_id and root.update_id=j.update_id and root.task=j.task
  and public.content_analysis_generation_v3_ledger_hash(prior.id)=slot->>'predecessorLedgerHash'
  and public.content_analysis_generation_v3_ledger_hash(root.id)=slot->>'rootLedgerHash'
  and j.config_epoch=c.manifest->>'configEpoch'
  and settings.selected_model=c.manifest#>>'{executionIdentity,model}' and settings.revision=(c.manifest->>'selectionRevision')::bigint
  and policy.model=settings.selected_model and (not p_require_released or (policy.enabled and budget.enabled))
  and a.source_id=j.source_id and public.content_analysis_eligible(w.state,a.record)
  and public.content_analysis_source_revision(a.record)=j.source_revision
  and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=j.content_hash
  and public.content_analysis_source_fingerprint(w.state,j.source_id)=j.source_fingerprint
  and (j.state='published' or (
   slot->>'currentAnnotationHash'=public.content_analysis_model_comparison_annotation_hash(a.record,j.task)
   and slot->>'adminReviewHash'=public.content_analysis_model_comparison_runtime_review_hash(j.id)
   and not public.content_analysis_generation_job_completed(j.id,a.record)
   and public.content_analysis_generation_v3_withhold_valid(j.id,a.record)))
  and not public.content_analysis_v2_unknown_hold(j.user_id,j.update_id,j.task,j.id),false)
 from public.reader_content_analysis_jobs j
 join public.content_analysis_model_comparisons c on c.id=j.generation_comparison_id and c.user_id=j.user_id
 join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
 join public.reader_content_analysis_jobs prior on prior.id=j.generation_predecessor_job_id
 join public.reader_content_analysis_jobs root on root.id=prior.generation_predecessor_job_id
 join public.reader_source_updates a on a.user_id=j.user_id and a.id=j.update_id
 join public.reader_workspaces w on w.user_id=j.user_id
 join public.reader_content_analysis_policies policy on policy.user_id=j.user_id
 cross join public.content_analysis_runtime_settings settings cross join public.content_analysis_budget budget,
 lateral (select public.content_analysis_generation_v3_slot(j.id) slot) selected
 where j.id=p_job_id and settings.id and budget.id;
$$;
create or replace function public.content_analysis_generation_job_in_scope(p_job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.reader_content_analysis_jobs j join public.content_analysis_rollout_scopes s on s.user_id=j.user_id
  where j.id=p_job_id and j.rule_version=s.generation_rule_version and s.phase<>'paused'
   and (s.update_ids is null or j.update_id=any(s.update_ids))
   and (j.rule_version='content-v2' or (j.generation_contract_hash=public.content_analysis_generation_v3_contract_hash()
    and public.content_analysis_generation_v3_slot(j.id) is not null
    and (j.generation_comparison_id is null or public.content_analysis_model_comparison_current(j.id)))));
$$;

create function public.stage_content_analysis_model_comparison(p_user_id text,p_expected_scope_hash text,
 p_expected_workspace_revision timestamptz,p_comparison_id uuid,p_idempotency_key text,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.reader_workspaces; s public.content_analysis_rollout_scopes; c public.content_analysis_model_comparisons;
 a public.reader_source_updates; prior public.reader_content_analysis_jobs; root public.reader_content_analysis_jobs;
 b public.content_analysis_budget; policy public.reader_content_analysis_policies; settings public.content_analysis_runtime_settings;
 slot jsonb; original jsonb; ids text[]; committed numeric; successors jsonb; digest_key text;
 manifest_keys text[]:=array['protocolVersion','generationContractHash','purpose','originalManifestDigest','executionIdentity',
  'responseModel','responseProviderName','selectionRevision','baseEpochHash','configEpoch','effectiveLimits','runtimeDisabled','workersDrained',
  'expectedBudgetHash','expectedPolicyHash','expectedLedgerHash','expectedCommittedUsd','expectedCounts','budget','callBound','reviewDigest','slots'];
 slot_keys text[]:=array['predecessorJobId','successorJobId','rootJobId','originalSlotDigest','updateId','sourceId','task',
  'contentHash','sourceRevision','sourceFingerprint','predecessorJobHash','predecessorLedgerHash','rootJobHash','rootLedgerHash',
  'currentAnnotationHash','adminReviewHash','emptyDisposition','sourceReviewDigest'];
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200 or p_comparison_id is null
  or p_expected_scope_hash is null or p_expected_scope_hash !~ '^[a-f0-9]{64}$' or p_expected_workspace_revision is null
  or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
  or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>32768
  or not (p_manifest ?& manifest_keys) or (p_manifest-manifest_keys)<>'{}'::jsonb
  or p_manifest->>'protocolVersion' is distinct from 'content-v3'
  or p_manifest->>'generationContractHash' is distinct from public.content_analysis_generation_v3_contract_hash()
  or p_manifest->>'purpose' is distinct from 'approved_model_comparison'
  or p_manifest->'runtimeDisabled' is distinct from 'true'::jsonb or p_manifest->'workersDrained' is distinct from 'true'::jsonb
  or p_manifest->>'responseModel' is distinct from 'openai/gpt-6-luna-pro' or p_manifest->>'responseProviderName' is distinct from 'OpenAI'
  or jsonb_typeof(p_manifest->'selectionRevision') is distinct from 'number' or p_manifest->>'selectionRevision' !~ '^[1-9][0-9]{0,17}$'
  or p_manifest->'effectiveLimits' is distinct from '{"maxSourceChars":1000000,"chunkChars":12000,"overlapChars":256,"maxChunks":800,"maxOutputTokens":8192,"maxInputTokens":128000,"maxCallUsd":0.01}'::jsonb
  or p_manifest->'expectedCounts' is distinct from '{"sourceUpdates":490,"jobs":394,"calls":35,"unsettledCalls":3}'::jsonb
  or p_manifest->'budget' is distinct from '{"originalCommittedUsd":0.018365907,"incrementalAllowanceUsd":0.25,"smokeLifetimeCeilingUsd":0.268365907}'::jsonb
  or p_manifest->'callBound' is distinct from '{"baseCalls":16,"correctionCalls":13,"maximumCalls":29,"baseMaximumUsd":0.094562875,"correctionMaximumUsd":0.13,"maximumFreshUsd":0.224562875}'::jsonb
  or jsonb_typeof(p_manifest->'expectedCommittedUsd') is distinct from 'number'
  or jsonb_typeof(p_manifest->'slots') is distinct from 'array' then
  raise exception 'Invalid sealed model comparison manifest' using errcode='PT400'; end if;
 foreach digest_key in array array['originalManifestDigest','baseEpochHash','expectedBudgetHash','expectedPolicyHash','expectedLedgerHash','reviewDigest'] loop
  if jsonb_typeof(p_manifest->digest_key) is distinct from 'string' or p_manifest->>digest_key !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid comparison digest' using errcode='PT400'; end if;
 end loop;
 if p_manifest->>'configEpoch' is distinct from ('openrouter-2026-10-24-v2:openai/gpt-6-luna-pro:'||(p_manifest->>'selectionRevision')||':'||(p_manifest->>'baseEpochHash')) then
  raise exception 'Comparison config epoch must use the actual new selection revision and original base hash' using errcode='PT400'; end if;
 perform public.validate_content_analysis_execution_identity(p_manifest->'executionIdentity','openai/gpt-6-luna-pro');
 if p_manifest->'executionIdentity' is distinct from '{"adapterVersion":"content-analysis-model-v2","route":"openrouter","baseURL":"https://openrouter.ai/api/v1","provider":"openai","model":"openai/gpt-6-luna-pro","reasoningEffort":"none","pricing":{"version":"openrouter-2026-10-24-v2:openai/gpt-6-luna-pro:openai","inputUsdPerMillion":0.1,"outputUsdPerMillion":0.5,"cachedInputUsdPerMillion":0.01,"cacheWriteApplies":true,"cacheWriteUsdPerMillion":0.125}}'::jsonb then
  raise exception 'Existing Luna normal execution profile required' using errcode='PT400'; end if;
 if jsonb_array_length(p_manifest->'slots') not between 1 and 6 then
  raise exception 'One to six original comparison slots required' using errcode='PT400'; end if;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') loop
  if jsonb_typeof(slot) is distinct from 'object' or not (slot ?& slot_keys) or (slot-slot_keys)<>'{}'::jsonb
   or slot->>'task' is null or slot->>'task' not in ('summary','keywords')
   or jsonb_typeof(slot->'updateId') is distinct from 'string' or length(slot->>'updateId') not between 1 and 200
   or jsonb_typeof(slot->'sourceId') is distinct from 'string' or length(slot->>'sourceId') not between 1 and 200
   or slot->>'emptyDisposition' is null or slot->>'emptyDisposition' not in ('findings_expected','no_findings_reviewed','unreviewed') then
   raise exception 'Invalid comparison slot' using errcode='PT400'; end if;
  foreach digest_key in array array['predecessorJobId','successorJobId','rootJobId'] loop
   if slot->>digest_key is null or slot->>digest_key !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then
    raise exception 'Invalid comparison job UUID' using errcode='PT400'; end if;
  end loop;
  foreach digest_key in array array['originalSlotDigest','contentHash','sourceRevision','sourceFingerprint','predecessorJobHash','predecessorLedgerHash','rootJobHash','rootLedgerHash','currentAnnotationHash','adminReviewHash'] loop
   if slot->>digest_key is null or slot->>digest_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid comparison slot digest' using errcode='PT400'; end if;
  end loop;
 end loop;
 select array_agg(distinct x->>'updateId' order by x->>'updateId') into ids from jsonb_array_elements(p_manifest->'slots') x;
 if cardinality(ids) not between 1 and 3
  or (select count(distinct x->>'predecessorJobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct x->>'successorJobId') from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots')
  or (select count(distinct (x->>'updateId',x->>'task')) from jsonb_array_elements(p_manifest->'slots') x)<>jsonb_array_length(p_manifest->'slots') then
  raise exception 'Duplicate or expanded comparison slots' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for update;
 if not found then raise exception 'Comparison workspace unavailable' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates where user_id=p_user_id order by id for update;
 perform 1 from public.reader_content_analysis_jobs where user_id=p_user_id order by id for update;
 select * into s from public.content_analysis_rollout_scopes where user_id=p_user_id for update;
 select * into c from public.content_analysis_model_comparisons
  where owner_digest=public.content_analysis_generation_v3_digest(to_jsonb(p_user_id))
   and original_manifest_digest=p_manifest->>'originalManifestDigest' and purpose='approved_model_comparison' for update;
 if found then
  if c.id is distinct from p_comparison_id or c.user_id is distinct from p_user_id or c.manifest is distinct from p_manifest
   or c.idempotency_key is distinct from p_idempotency_key then
   raise exception 'One model comparison already consumed' using errcode='PT409'; end if;
  if exists(select 1 from jsonb_array_elements(c.manifest->'slots') x where not exists(select 1 from public.reader_content_analysis_jobs j
   where j.id=(x->>'successorJobId')::uuid and j.generation_comparison_id=c.id and j.generation_predecessor_job_id=(x->>'predecessorJobId')::uuid)) then
   raise exception 'Comparison evidence was deleted; permission cannot be renewed' using errcode='PT409'; end if;
  select jsonb_agg(x->'successorJobId' order by x->>'successorJobId') into successors from jsonb_array_elements(c.manifest->'slots') x;
  return jsonb_build_object('staged',false,'comparison',to_jsonb(c),'successorJobIds',successors);
 end if;
 if w.updated_at is distinct from p_expected_workspace_revision or s.user_id is null or s.phase<>'paused'
  or s.generation_rule_version<>'content-v3' or public.content_analysis_generation_v3_digest(to_jsonb(s)) is distinct from p_expected_scope_hash
  or public.content_analysis_generation_v3_digest(s.generation_revision_manifest) is distinct from p_manifest->>'originalManifestDigest'
  or s.generation_revision_manifest->'budget' is distinct from p_manifest->'budget'
  or right(s.generation_revision_manifest->>'configEpoch',64) is distinct from p_manifest->>'baseEpochHash'
  or exists(select 1 from unnest(ids) id where not id=any(s.update_ids))
  or exists(select 1 from public.reader_content_analysis_jobs j where j.user_id=p_user_id
   and (j.state in ('running','prepared') or (j.lease_until>clock_timestamp() and j.state not in ('failed','published','skipped','cancelled')))) then
  raise exception 'Paused drained exact original comparison scope required' using errcode='PT409'; end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=p_user_id for update;
 select * into settings from public.content_analysis_runtime_settings where id;
 if b.id is null or policy.user_id is null or b.enabled or policy.enabled
  or settings.selected_model is distinct from 'openai/gpt-6-luna-pro' or policy.model is distinct from settings.selected_model
  or settings.revision is distinct from (p_manifest->>'selectionRevision')::bigint
  or b.daily_limit_usd<>5 or b.lifetime_limit_usd<>5 or policy.daily_limit_usd<>5 or policy.lifetime_limit_usd<>5 or policy.per_call_limit_usd<>.01
  or public.content_analysis_generation_v3_digest(to_jsonb(b)) is distinct from p_manifest->>'expectedBudgetHash'
  or public.content_analysis_generation_v3_digest(to_jsonb(policy)) is distinct from p_manifest->>'expectedPolicyHash' then
  raise exception 'Off-first comparison selection or financial snapshot changed' using errcode='PT409'; end if;
 perform 1 from public.reader_content_analysis_calls order by id for update;
 perform 1 from public.reader_content_analysis_call_attempts order by call_id,attempt_number for share;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
 if public.content_analysis_generation_v3_ledger_hash() is distinct from p_manifest->>'expectedLedgerHash'
  or committed is distinct from (p_manifest->>'expectedCommittedUsd')::numeric or committed<.028604315
  or committed+.224562875>.268365907
  or (select count(*) from public.reader_source_updates)<>490 or (select count(*) from public.reader_content_analysis_jobs)<>394
  or (select count(*) from public.reader_content_analysis_calls)<>35 or (select count(*) from public.reader_content_analysis_calls where actual_usd is null)<>3 then
  raise exception 'Comparison original ledger, counts or shared envelope changed' using errcode='PT409'; end if;
 perform 1 from public.admin_keyword_reviews where user_id=p_user_id order by id for share;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') loop
  select * into prior from public.reader_content_analysis_jobs where id=(slot->>'predecessorJobId')::uuid;
  select * into root from public.reader_content_analysis_jobs where id=(slot->>'rootJobId')::uuid;
  select * into a from public.reader_source_updates where user_id=p_user_id and id=slot->>'updateId';
  original:=public.content_analysis_generation_v3_slot(prior.id);
  if prior.id is null or root.id is null or a.id is null or original is null
   or prior.generation_comparison_id is not null or prior.rule_version<>'content-v3' or prior.state<>'failed'
   or prior.error_code is null or prior.error_code not in ('analysis_unsupported_passage','analysis_unsupported_summary_number','analysis_incomplete_coverage','analysis_unsupported_mention','analysis_correction_dropped_proposal','analysis_incomplete_read')
   or root.rule_version<>'content-v2' or prior.generation_predecessor_job_id is distinct from root.id
   or prior.generation_contract_hash is distinct from public.content_analysis_generation_v3_contract_hash()
   or public.content_analysis_generation_v3_digest(original) is distinct from slot->>'originalSlotDigest'
   or original->>'predecessorJobId' is distinct from root.id::text
   or slot->'emptyDisposition' is distinct from original->'emptyDisposition' or slot->'sourceReviewDigest' is distinct from original->'sourceReviewDigest'
   or (prior.user_id,prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
    is distinct from (p_user_id,slot->>'updateId',slot->>'sourceId',slot->>'task',slot->>'contentHash',slot->>'sourceRevision',slot->>'sourceFingerprint')
   or (root.user_id,root.update_id,root.source_id,root.task,root.content_hash,root.source_revision,root.source_fingerprint)
    is distinct from (prior.user_id,prior.update_id,prior.source_id,prior.task,prior.content_hash,prior.source_revision,prior.source_fingerprint)
   or public.content_analysis_model_comparison_job_digest(to_jsonb(prior)) is distinct from slot->>'predecessorJobHash'
   or public.content_analysis_generation_v3_ledger_hash(prior.id) is distinct from slot->>'predecessorLedgerHash'
   or public.content_analysis_model_comparison_job_digest(to_jsonb(root)) is distinct from slot->>'rootJobHash'
   or public.content_analysis_generation_v3_ledger_hash(root.id) is distinct from slot->>'rootLedgerHash'
   or a.source_id is distinct from prior.source_id or not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or public.content_analysis_source_revision(a.record) is distinct from prior.source_revision
   or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from prior.content_hash
   or public.content_analysis_source_fingerprint(w.state,a.source_id) is distinct from prior.source_fingerprint
   or public.content_analysis_model_comparison_annotation_hash(a.record,prior.task) is distinct from slot->>'currentAnnotationHash'
   or public.content_analysis_model_comparison_review_hash(p_user_id,a.id) is distinct from slot->>'adminReviewHash'
   or public.content_analysis_v2_unknown_hold(p_user_id,a.id,prior.task)
   or not exists(select 1 from public.reader_content_analysis_calls call where call.job_id=prior.id)
   or exists(select 1 from public.reader_content_analysis_calls call where call.job_id=prior.id and (call.actual_usd is null or call.state<>'settled'
    or call.execution_identity is distinct from s.generation_revision_manifest->'executionIdentity' or call.source_revision is distinct from prior.source_revision
    or call.model is distinct from s.generation_revision_manifest#>>'{executionIdentity,model}'
    or call.request_hash is null or call.result is null or jsonb_typeof(call.result) is distinct from 'object' or not (call.result ? 'value')))
   or public.content_analysis_generation_job_completed(prior.id,a.record)
   or not coalesce(public.content_analysis_generation_v3_withhold_valid(prior.id,a.record),false) then
   raise exception 'Exact diagnosed settled original comparison lineage or current source/review changed' using errcode='PT409'; end if;
 end loop;
 insert into public.content_analysis_model_comparisons(id,user_id,owner_digest,purpose,original_manifest_digest,generation_contract_hash,manifest,manifest_digest,idempotency_key)
 values(p_comparison_id,p_user_id,public.content_analysis_generation_v3_digest(to_jsonb(p_user_id)),'approved_model_comparison',p_manifest->>'originalManifestDigest',
  public.content_analysis_generation_v3_contract_hash(),p_manifest,public.content_analysis_generation_v3_digest(p_manifest),p_idempotency_key) returning * into c;
 for slot in select value from jsonb_array_elements(p_manifest->'slots') order by value->>'successorJobId' loop
  insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,rule_version,task,source_revision,
   source_fingerprint,workspace_revision,config_epoch,generation_predecessor_job_id,generation_contract_hash,generation_comparison_id)
  values((slot->>'successorJobId')::uuid,p_user_id,slot->>'updateId',slot->>'sourceId',slot->>'contentHash','content-v3',slot->>'task',slot->>'sourceRevision',
   slot->>'sourceFingerprint',w.updated_at,p_manifest->>'configEpoch',(slot->>'predecessorJobId')::uuid,public.content_analysis_generation_v3_contract_hash(),c.id);
 end loop;
 insert into public.admin_audit_events(admin_id,action,target_id,details) values('system:analysis-model-comparison','analysis.model_comparison.staged',c.id::text,
  jsonb_build_object('manifestDigest',c.manifest_digest,'originalManifestDigest',c.original_manifest_digest,'reviewDigest',p_manifest->>'reviewDigest',
   'actorType','assistant','humanApproval',false,'taskCount',jsonb_array_length(p_manifest->'slots'),'sourceCount',cardinality(ids)));
 select jsonb_agg(x->'successorJobId' order by x->>'successorJobId') into successors from jsonb_array_elements(c.manifest->'slots') x;
 return jsonb_build_object('staged',true,'comparison',to_jsonb(c),'successorJobIds',successors);
end;
$$;

create function public.set_content_analysis_model_comparison_state(p_comparison_id uuid,p_expected_revision bigint,
 p_action text,p_manifest_digest text,p_review_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.content_analysis_model_comparisons; owner_id text; b public.content_analysis_budget;
 policy public.reader_content_analysis_policies; committed numeric; comparison_committed numeric;
begin
 if p_comparison_id is null or p_expected_revision is null or p_expected_revision<1 or p_action is null
  or p_action not in ('release','pause','close') or p_manifest_digest is null or p_manifest_digest !~ '^[a-f0-9]{64}$'
  or (p_review_digest is not null and p_review_digest !~ '^[a-f0-9]{64}$')
  or (p_action='release' and p_review_digest is null) then
  raise exception 'Invalid revisioned comparison transition' using errcode='PT400'; end if;
 select user_id into owner_id from public.content_analysis_model_comparisons where id=p_comparison_id;
 perform 1 from public.reader_workspaces where user_id=owner_id for update;
 if not found then raise exception 'Comparison workspace unavailable' using errcode='PT409'; end if;
 perform 1 from public.reader_source_updates where user_id=owner_id order by id for update;
 perform 1 from public.reader_content_analysis_jobs where user_id=owner_id order by id for update;
 perform 1 from public.content_analysis_rollout_scopes where user_id=owner_id for update;
 select * into c from public.content_analysis_model_comparisons where id=p_comparison_id for update;
 if c.id is null or c.state='closed' or c.manifest is null or c.revision<>p_expected_revision
  or c.manifest_digest<>p_manifest_digest or c.revision=9223372036854775807 then
  raise exception 'Comparison changed or permanently closed' using errcode='PT409'; end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into policy from public.reader_content_analysis_policies where user_id=owner_id for update;
 if p_action='release' then
  if c.state not in ('staged','paused') or b.enabled or policy.enabled
   or not exists(select 1 from public.content_analysis_rollout_scopes where user_id=owner_id and phase='paused')
   or exists(select 1 from public.reader_content_analysis_jobs where user_id=owner_id and (state in ('running','prepared')
    or (lease_until>clock_timestamp() and state not in ('failed','published','skipped','cancelled'))))
   or exists(select 1 from jsonb_array_elements(c.manifest->'slots') x
    where public.content_analysis_model_comparison_current((x->>'successorJobId')::uuid,false) is distinct from true) then
   raise exception 'Off-first independent reviewed comparison release requires current drained evidence' using errcode='PT409'; end if;
  select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) into committed from public.reader_content_analysis_calls;
  select coalesce(sum(greatest(coalesce(call.actual_usd,call.maximum_usd),coalesce(call.observed_usd,0))),0)
   into comparison_committed from public.reader_content_analysis_calls call join public.reader_content_analysis_jobs j on j.id=call.job_id
   where j.generation_comparison_id=c.id;
  if committed+greatest(.224562875-comparison_committed,0)>.268365907 then
   raise exception 'Sealed comparison bound no longer fits original smoke envelope' using errcode='PT402'; end if;
 end if;
 update public.content_analysis_model_comparisons set state=case p_action when 'release' then 'released' when 'pause' then 'paused' else 'closed' end,
  revision=revision+1,review_digest=case when p_action='release' then p_review_digest else review_digest end,updated_at=clock_timestamp()
  where id=c.id returning * into c;
 if p_action in ('pause','close') then
  update public.content_analysis_rollout_scopes set phase='paused',updated_at=clock_timestamp() where user_id=owner_id and phase<>'paused';
 end if;
 insert into public.admin_audit_events(admin_id,action,target_id,details) values('system:analysis-model-comparison','analysis.model_comparison.'||p_action,c.id::text,
  jsonb_build_object('manifestDigest',c.manifest_digest,'revision',c.revision,'reviewDigest',p_review_digest,'actorType','assistant','humanApproval',false));
 return to_jsonb(c);
end;
$$;

-- A consumed comparison survives as a source-free tombstone. Privacy deletion
-- removes its private manifest, identity association and review evidence, while
-- original call rows/unknown monetary holds retain their existing semantics.
create function public.erase_content_analysis_model_comparison_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.content_analysis_model_comparisons c set manifest=null,user_id=null,idempotency_key=null,review_digest=null,
  state='closed',revision=revision+1,updated_at=clock_timestamp(),redacted_at=clock_timestamp()
  where c.user_id=old.user_id and c.manifest is not null and (tg_table_name='reader_workspaces'
   or exists(select 1 from jsonb_array_elements(c.manifest->'slots') x where x->>'updateId'=old.id));
 return old;
end;
$$;
create trigger erase_content_analysis_model_comparison_source before delete on public.reader_source_updates
 for each row execute function public.erase_content_analysis_model_comparison_evidence();
-- Separate workspace wrapper avoids accessing a nonexistent OLD.id field.
create function public.erase_content_analysis_model_comparison_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.content_analysis_model_comparisons set manifest=null,user_id=null,idempotency_key=null,review_digest=null,
  state='closed',revision=revision+1,updated_at=clock_timestamp(),redacted_at=clock_timestamp()
  where user_id=old.user_id and manifest is not null;
 return old;
end;
$$;
create trigger erase_content_analysis_model_comparison_workspace before delete on public.reader_workspaces
 for each row execute function public.erase_content_analysis_model_comparison_workspace();

-- Protect the exact v2 audit root as well as its original failed v3 successor.
create function public.content_analysis_model_comparison_history(p_job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.content_analysis_model_comparisons c,
  lateral jsonb_array_elements(c.manifest->'slots') x where x->>'rootJobId'=p_job_id::text or x->>'predecessorJobId'=p_job_id::text);
$$;
create function public.preserve_content_analysis_model_comparison_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if public.content_analysis_model_comparison_history(old.id) and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
  raise exception 'Comparison predecessor and audited root are immutable' using errcode='PT409'; end if;
 return new;
end;
$$;
create trigger preserve_content_analysis_model_comparison_history before update on public.reader_content_analysis_jobs
 for each row execute function public.preserve_content_analysis_model_comparison_history();
create or replace function public.preserve_content_analysis_generation_v3_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare slot jsonb; prior public.reader_content_analysis_jobs; manifest jsonb;
begin
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

create or replace function public.invalidate_content_analysis_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.content_analysis_source_revision(new.record) is distinct from public.content_analysis_source_revision(old.record) then
  update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp()
   where user_id=old.user_id and update_id=old.id
    and not public.content_analysis_model_comparison_history(id)
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
   and not public.content_analysis_model_comparison_history(j.id)
   and (j.rule_version<>'content-v3' or j.state not in ('failed','published','skipped','cancelled'))
   and (not coalesce(new.state->'followedSourceIds' ? j.source_id,false)
    or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(new.state,j.source_id)
    or exists(select 1 from public.reader_source_updates a where a.user_id=j.user_id and a.id=j.update_id and not coalesce(public.content_analysis_eligible(new.state,a.record),false)));
 return new;
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
declare j public.reader_content_analysis_jobs; slot jsonb;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
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

create function public.erase_content_analysis_model_comparison_job() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.content_analysis_model_comparisons c set manifest=null,user_id=null,idempotency_key=null,review_digest=null,
  state='closed',revision=revision+1,updated_at=clock_timestamp(),redacted_at=clock_timestamp()
  where c.manifest is not null and (c.id=old.generation_comparison_id or exists(
   select 1 from jsonb_array_elements(c.manifest->'slots') x where old.id::text in
    (x->>'successorJobId',x->>'predecessorJobId',x->>'rootJobId')));
 return old;
end;
$$;
create trigger erase_content_analysis_model_comparison_job before delete on public.reader_content_analysis_jobs
 for each row execute function public.erase_content_analysis_model_comparison_job();

revoke all on function
 public.content_analysis_model_comparison_job_digest(jsonb),
 public.content_analysis_model_comparison_annotation_hash(jsonb,text),
 public.content_analysis_model_comparison_review_hash(text,text),
 public.content_analysis_model_comparison_runtime_review_hash(uuid),
 public.content_analysis_generation_v3_manifest(uuid),
 public.content_analysis_model_comparison_original_slot(uuid),
 public.content_analysis_model_comparison_current(uuid,boolean),
 public.content_analysis_model_comparison_history(uuid),
 public.stage_content_analysis_model_comparison(text,text,timestamptz,uuid,text,jsonb),
 public.set_content_analysis_model_comparison_state(uuid,bigint,text,text,text),
 public.erase_content_analysis_model_comparison_evidence(),
 public.erase_content_analysis_model_comparison_workspace(),
 public.erase_content_analysis_model_comparison_job(),
 public.preserve_content_analysis_model_comparison_history() from public,anon,authenticated,service_role;
grant execute on function
 public.content_analysis_model_comparison_job_digest(jsonb),
 public.content_analysis_model_comparison_annotation_hash(jsonb,text),
 public.content_analysis_model_comparison_review_hash(text,text),
 public.content_analysis_model_comparison_runtime_review_hash(uuid),
 public.content_analysis_generation_v3_manifest(uuid),
 public.content_analysis_model_comparison_original_slot(uuid),
 public.content_analysis_model_comparison_current(uuid,boolean),
 public.content_analysis_model_comparison_history(uuid),
 public.stage_content_analysis_model_comparison(text,text,timestamptz,uuid,text,jsonb),
 public.set_content_analysis_model_comparison_state(uuid,bigint,text,text,text) to service_role;
commit;
