-- Finite recovery of held keyword inventories. This creates no session,
-- releases no spending and never copies or changes an original paid call.
begin;
alter table public.keyword_production_releases
 add column origin_session_id uuid references public.keyword_learning_sessions(id),
 add column baseline_contract_hash text,
 add column recovery_requests jsonb not null default '[]'::jsonb,
 add constraint keyword_recovery_origin_binding check(
  (origin_session_id is null and baseline_contract_hash is null and recovery_requests='[]'::jsonb)
  or (origin_session_id is not null and origin_session_id<>session_id and baseline_contract_hash is not null and baseline_contract_hash ~ '^[a-f0-9]{64}$')),
 add constraint keyword_recovery_request_bound check(jsonb_typeof(recovery_requests)='array' and jsonb_array_length(recovery_requests)<=30 and octet_length(recovery_requests::text)<=1000000);

-- Read-only evidence verification. Callers acquire workspace/archive before
-- locking sessions in UUID order. No financial or call locks are taken here.
create function public.keyword_recovery_origin_receipts(p_session_id uuid,p_source_ordinal integer,p_calls jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions; origin public.keyword_learning_sessions;
 release public.keyword_production_releases; original public.keyword_production_releases;
 slot jsonb; old_slot jsonb; item jsonb; r public.keyword_learning_requests; c public.reader_content_analysis_calls;
 chunks integer; idx integer; role_name text; expected_model text; seen_slots text[]:='{}'; seen_calls uuid[]:='{}';
 receipts jsonb; result_hashes jsonb:='{}'; payload_hashes jsonb:='{}';
begin
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 select * into release from public.keyword_production_releases where session_id=p_session_id;
 select * into origin from public.keyword_learning_sessions where id=release.origin_session_id;
 select * into original from public.keyword_production_releases where session_id=release.origin_session_id;
 if d.id is null or d.user_id is null or release.origin_session_id is null or origin.state is distinct from 'closed'
  or original.state is distinct from 'closed' or origin.user_id is distinct from d.user_id
  or original.contract_hash is distinct from release.baseline_contract_hash then
  raise exception 'Closed original keyword evidence required' using errcode='PT409'; end if;
 select value into slot from jsonb_array_elements(release.sources) where value->>'ordinal'=p_source_ordinal::text;
 select value into old_slot from jsonb_array_elements(original.sources) where value->>'ordinal'=p_source_ordinal::text;
 if slot is null or old_slot is null
  or (select count(*) from jsonb_array_elements(release.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1
  or (select count(*) from jsonb_array_elements(original.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1
  or slot->>'updateId' is distinct from old_slot->>'updateId' or slot->>'sourceHash' is distinct from old_slot->>'sourceHash'
  or slot->'chunkCount' is distinct from old_slot->'chunkCount'
  or not exists(select 1 from jsonb_array_elements(origin.sources) s where s->>'ordinal'=p_source_ordinal::text
   and s->>'updateId'=slot->>'updateId' and s->>'sourceHash'=slot->>'sourceHash')
  or not exists(select 1 from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text
   and s->>'updateId'=slot->>'updateId' and s->>'sourceHash'=slot->>'sourceHash')
  or coalesce(slot->>'chunkCount','') !~ '^[1-9][0-9]?$' then
  raise exception 'Original keyword source or policy changed' using errcode='PT409'; end if;
 chunks:=(slot->>'chunkCount')::integer;
 if chunks>83 or p_calls is null or jsonb_typeof(p_calls)<>'array' or jsonb_array_length(p_calls)<>chunks*3 then
  raise exception 'Every original keyword request is required' using errcode='PT400'; end if;
 for item in select value from jsonb_array_elements(p_calls) loop
  if jsonb_typeof(item)<>'object' or (item-array['chunkIndex','role','callId','requestHash'])<>'{}'::jsonb
   or jsonb_typeof(item->'chunkIndex') is distinct from 'number' or (item->>'chunkIndex')::numeric<>trunc((item->>'chunkIndex')::numeric)
   or (item->>'chunkIndex')::numeric not between 0 and chunks-1
   or coalesce(item->>'role','') not in ('direct','typed','checker')
   or coalesce(item->>'callId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(item->>'requestHash','') !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid original keyword receipt' using errcode='PT400'; end if;
  idx:=(item->>'chunkIndex')::integer; role_name:=item->>'role';
  if idx::text||':'||role_name=any(seen_slots) or (item->>'callId')::uuid=any(seen_calls) then
   raise exception 'Duplicate original keyword receipt' using errcode='PT400'; end if;
  seen_slots:=array_append(seen_slots,idx::text||':'||role_name); seen_calls:=array_append(seen_calls,(item->>'callId')::uuid);
  select * into r from public.keyword_learning_requests where session_id=origin.id and call_id=(item->>'callId')::uuid;
  select * into c from public.reader_content_analysis_calls where id=r.call_id;
  expected_model:=case when role_name='checker' then 'openai/gpt-6.1-sol-pro' else 'deepseek/deepseek-v4.1-flash-1017' end;
  if r.call_id is null or r.source_ordinal<>p_source_ordinal or r.source_hash is distinct from slot->>'sourceHash'
   or r.request_hash is distinct from item->>'requestHash' or not r.completed or r.error_code is not null
   or r.result is null or jsonb_typeof(r.result->'value') is distinct from 'object' or r.result->>'validationError' is not null or r.request_payload is null
   or c.user_id is distinct from d.user_id or c.source_revision is distinct from slot->>'sourceHash'
   or c.request_hash is distinct from r.request_hash or c.model is distinct from expected_model
   or c.state is distinct from 'settled' or c.actual_usd is null or c.actual_usd<0 or c.actual_usd>.10
   or c.actual_usd::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Successful settled original keyword evidence required' using errcode='PT409'; end if;
  result_hashes:=result_hashes||jsonb_build_object(c.id::text,encode(sha256(convert_to(r.result::text,'UTF8')),'hex'));
  payload_hashes:=payload_hashes||jsonb_build_object(c.id::text,encode(sha256(convert_to(r.request_payload::text,'UTF8')),'hex'));
 end loop;
 select jsonb_agg(value order by (value->>'chunkIndex')::integer,value->>'role') into receipts from jsonb_array_elements(p_calls);
 -- A closed release's final policy metadata may describe a later failed
 -- attempt. Exact paid payloads select the earlier attempt; freeze the chosen
 -- reconstruction policy and additional source-bound timing holds separately.
 return jsonb_build_object('baselineReceipts',receipts,'originResultHashesPGsha',result_hashes,'originRequestPayloadHashesPGsha',payload_hashes,
  'baselinePolicyHashPGsha',encode(sha256(convert_to(jsonb_build_object('checkerPolicy',slot->'checkerPolicy','sectionSweepChunks',slot->'sectionSweepChunks',
   'timingReviews',slot->'timingReviews','contextReviews',slot->'contextReviews',
   'baselineGenerationContractHash',slot->'baselineGenerationContractHash')::text,'UTF8')),'hex'),
  'baselineReceiptNativeHash',encode(sha256(convert_to(receipts::text,'UTF8')),'hex'));
end;
$$;

create function public.seal_keyword_recovery_plan(p_session_id uuid,p_source_ordinal integer,p_baseline_calls jsonb,p_baseline_output_hash text,p_requests jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions; release public.keyword_production_releases; a public.reader_source_updates; w public.reader_workspaces;
 slot jsonb; proof jsonb; plan jsonb; plans jsonb; existing_plans jsonb; all_plans jsonb; next_slot jsonb; seen integer[]:='{}'; source_hash text;
begin
 if p_source_ordinal is null or p_source_ordinal not between 1 and 1000 or p_baseline_output_hash is null or p_baseline_output_hash !~ '^[a-f0-9]{64}$'
  or p_requests is null or jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)>30 or octet_length(p_requests::text)>1000000 then
  raise exception 'Invalid finite keyword recovery plan' using errcode='PT400'; end if;
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 select * into release from public.keyword_production_releases where session_id=p_session_id;
 select value into slot from jsonb_array_elements(coalesce(release.sources,'[]'::jsonb)) where value->>'ordinal'=p_source_ordinal::text;
 if d.user_id is null or release.origin_session_id is null or slot is null then raise exception 'Recovery admission unavailable' using errcode='PT403'; end if;
 select * into w from public.reader_workspaces where user_id=d.user_id for share;
 select * into a from public.reader_source_updates where user_id=d.user_id and id=slot->>'updateId' for share;
 if w.user_id is null or a.id is null then raise exception 'Recovery source deleted' using errcode='PT409'; end if;
 perform 1 from public.keyword_learning_sessions where id=any(array[p_session_id,release.origin_session_id]) order by id for update;
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 select * into release from public.keyword_production_releases where session_id=p_session_id for update;
 if d.state not in ('staged','released') or d.expires_at<=clock_timestamp() or release.state not in ('staged','released')
  or release.origin_session_id is null or d.user_id is distinct from w.user_id
  or not exists(select 1 from jsonb_array_elements(release.sources) s where s=slot) then
  raise exception 'Finite recovery admission changed' using errcode='PT409'; end if;
 source_hash:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex');
 if source_hash is distinct from slot->>'sourceHash' or public.content_analysis_source_revision(a.record) is distinct from slot->>'sourceRevision'
  or public.content_analysis_source_fingerprint(w.state,a.source_id) is distinct from slot->>'sourceFingerprint'
  or public.keyword_production_snapshot(a.record) is distinct from slot->>'keywordSnapshotHash'
  or public.content_analysis_eligible(w.state,a.record) is distinct from true then
  raise exception 'Recovery source snapshot changed' using errcode='PT409'; end if;
 proof:=public.keyword_recovery_origin_receipts(p_session_id,p_source_ordinal,p_baseline_calls);
 for plan in select value from jsonb_array_elements(p_requests) loop
  if jsonb_typeof(plan)<>'object' or (plan-array['sourceOrdinal','batchIndex','callKey','model','requestHash','requestPayload','executionIdentity'])<>'{}'::jsonb
   or plan->'sourceOrdinal' is distinct from to_jsonb(p_source_ordinal) or jsonb_typeof(plan->'batchIndex') is distinct from 'number'
   or (plan->>'batchIndex')::numeric<>trunc((plan->>'batchIndex')::numeric) or (plan->>'batchIndex')::numeric not between 0 and 29
   or (plan->>'batchIndex')::integer=any(seen)
   or coalesce(plan->>'callKey','') !~ '^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$'
   or plan->>'model' is distinct from 'openai/gpt-6.1-sol-pro' or (plan->>'model'=any(d.models)) is distinct from true
   or coalesce(plan->>'requestHash','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(plan->'requestPayload') is distinct from 'object' or octet_length((plan->'requestPayload')::text)>220000
   or plan#>>'{requestPayload,request,key}' is distinct from plan->>'callKey' then
   raise exception 'Invalid sealed recovery request' using errcode='PT400'; end if;
  perform public.validate_content_analysis_execution_identity(plan->'executionIdentity',plan->>'model');
  seen:=array_append(seen,(plan->>'batchIndex')::integer);
 end loop;
 if exists(select 1 from generate_series(0,jsonb_array_length(p_requests)-1) n where not n=any(seen)) then
  raise exception 'Recovery request batches must be complete' using errcode='PT400'; end if;
 select coalesce(jsonb_agg(value order by (value->>'batchIndex')::integer),'[]'::jsonb) into plans from jsonb_array_elements(p_requests);
 select coalesce(jsonb_agg(value order by (value->>'batchIndex')::integer),'[]'::jsonb) into existing_plans from jsonb_array_elements(release.recovery_requests) where value->'sourceOrdinal'=to_jsonb(p_source_ordinal);
 next_slot:=slot||proof||jsonb_build_object('baselineOutputHash',p_baseline_output_hash);
 if release.state='released' or d.state='released' or exists(select 1 from public.keyword_learning_requests r where r.session_id=p_session_id and r.source_ordinal=p_source_ordinal) then
  if slot is distinct from next_slot or existing_plans is distinct from plans then raise exception 'Sealed recovery plan is immutable' using errcode='PT409'; end if;
  return proof||jsonb_build_object('sealed',true,'replayed',true,'requestCount',jsonb_array_length(plans));
 end if;
 select coalesce(jsonb_agg(value order by (value->>'sourceOrdinal')::integer,(value->>'batchIndex')::integer),'[]'::jsonb) into all_plans
  from (select value from jsonb_array_elements(release.recovery_requests) where value->'sourceOrdinal' is distinct from to_jsonb(p_source_ordinal)
   union all select value from jsonb_array_elements(plans)) merged;
 if jsonb_array_length(all_plans)>30 or (select count(distinct value->>'callKey') from jsonb_array_elements(all_plans))<>jsonb_array_length(all_plans)
  or (select count(distinct value->>'requestHash') from jsonb_array_elements(all_plans))<>jsonb_array_length(all_plans) then
  raise exception 'Finite recovery request roster changed' using errcode='PT400'; end if;
 update public.keyword_production_releases set recovery_requests=all_plans,sources=(select jsonb_agg(case when value=slot then next_slot else value end order by (value->>'ordinal')::integer) from jsonb_array_elements(sources)) where session_id=p_session_id;
 return proof||jsonb_build_object('sealed',true,'replayed',false,'requestCount',jsonb_array_length(plans));
end;
$$;

-- The existing reservation creates its ledger row and request in one
-- transaction. A rejected INSERT rolls both back before provider dispatch.
-- INSERT only deliberately permits existing privacy-erasure UPDATEs.
create function public.enforce_keyword_recovery_request() returns trigger
language plpgsql security invoker set search_path='' as $$
declare release public.keyword_production_releases; d public.keyword_learning_sessions; c public.reader_content_analysis_calls; slot jsonb; expected jsonb;
begin
 select * into release from public.keyword_production_releases where session_id=new.session_id;
 if release.origin_session_id is null then return new; end if;
 select * into d from public.keyword_learning_sessions where id=new.session_id;
 select value into slot from jsonb_array_elements(release.sources) where value->>'ordinal'=new.source_ordinal::text;
 select value into expected from jsonb_array_elements(release.recovery_requests) where value->>'sourceOrdinal'=new.source_ordinal::text and value->>'callKey'=new.call_key;
 select * into c from public.reader_content_analysis_calls where id=new.call_id;
 if release.state is distinct from 'released' or d.state is distinct from 'released' or d.expires_at<=clock_timestamp()
  or slot is null or slot->'baselineReceipts' is null or slot->'originResultHashesPGsha' is null or expected is null
  or (select count(*) from jsonb_array_elements(release.recovery_requests) x where x->>'callKey'=new.call_key)<>1
  or new.source_hash is distinct from slot->>'sourceHash' or new.request_hash is distinct from expected->>'requestHash'
  or new.request_payload is distinct from expected->'requestPayload' or c.request_hash is distinct from new.request_hash
  or c.user_id is distinct from d.user_id or c.source_revision is distinct from new.source_hash
  or c.model is distinct from expected->>'model' or c.execution_identity is distinct from expected->'executionIdentity' then
  raise exception 'Only the exact sealed keyword repair request is admitted' using errcode='PT409'; end if;
 return new;
end;
$$;
create trigger keyword_recovery_request_whitelist before insert on public.keyword_learning_requests for each row execute function public.enforce_keyword_recovery_request();

-- Recovery keeps original 3N receipts separate from the fresh repair ledger.
create function public.publish_keyword_recovery_result(p_session_id uuid,p_source_ordinal integer,p_contract_hash text,p_calls jsonb,p_output jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions; release public.keyword_production_releases; a public.reader_source_updates; w public.reader_workspaces;
 old_publication public.keyword_production_publications; prior public.admin_keyword_reviews; request public.keyword_learning_requests; charge public.reader_content_analysis_calls;
 slot jsonb; receipt_slot jsonb; candidate jsonb; item jsonb; rec jsonb; next_record jsonb; proc jsonb; output_receipt jsonb;
 entries jsonb:='{}'; generation_receipts jsonb:='[]'; previous_annotations jsonb; keywords jsonb; topics jsonb; brands jsonb;
 source_hash text; k text; label text; kind text; ranges jsonb; final_state text; chunks integer; chunk_index integer; call_role text;
 seen_slots text[]:='{}'; seen_calls uuid[]:='{}'; publication_id uuid:=gen_random_uuid(); expected_model text;
 origin public.keyword_learning_sessions; original public.keyword_production_releases; proof jsonb; baseline_calls jsonb; expected_repairs jsonb; plan jsonb;
begin
 if p_session_id is null or p_source_ordinal is null or p_source_ordinal not between 1 and 1000
  or p_contract_hash is null or p_contract_hash !~ '^[a-f0-9]{64}$'
  or p_calls is null or jsonb_typeof(p_calls)<>'array' or jsonb_array_length(p_calls) not between 3 and 249
  or p_output is null or jsonb_typeof(p_output)<>'object' or octet_length(p_output::text)>500000 then
  raise exception 'Invalid keyword publication request' using errcode='PT400'; end if;
 -- An exact prior receipt is readable after closure. It cannot write the
 -- archive again, resurrect erased content, or accept different paid evidence.
 select * into old_publication from public.keyword_production_publications where session_id=p_session_id and source_ordinal=p_source_ordinal;
 if found then
  if old_publication.contract_hash is distinct from p_contract_hash or old_publication.output is distinct from p_output
   or (select jsonb_agg(value-array['resultHash','model','originSessionId','sessionId'] order by (value->>'chunkIndex')::integer,value->>'role') from jsonb_array_elements(old_publication.generation_receipts))
    is distinct from (select jsonb_agg(value order by (value->>'chunkIndex')::integer,value->>'role') from jsonb_array_elements(p_calls)) then
   raise exception 'Immutable keyword publication changed' using errcode='PT409'; end if;
  return old_publication.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 if d.user_id is null then raise exception 'Keyword publication session unavailable' using errcode='PT403'; end if;
 select * into w from public.reader_workspaces where user_id=d.user_id for share;
 if w.user_id is null then raise exception 'Workspace deleted' using errcode='PT409'; end if;
 select * into release from public.keyword_production_releases where session_id=p_session_id;
 select value into slot from jsonb_array_elements(coalesce(release.sources,'[]'::jsonb)) s where s->>'ordinal'=p_source_ordinal::text;
 if slot is null or (select count(*) from jsonb_array_elements(release.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1
  or slot->>'updateId' is null then raise exception 'Frozen publication source unavailable' using errcode='PT409'; end if;
 select * into a from public.reader_source_updates where user_id=d.user_id and id=slot->>'updateId' for update;
 if a.id is null then raise exception 'Archive deleted' using errcode='PT409'; end if;
 -- Same order as evaluation source deletion: workspace, archive, session.
 perform 1 from public.keyword_learning_sessions where id=any(array[p_session_id,release.origin_session_id]) order by id for update;
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 select * into release from public.keyword_production_releases where session_id=p_session_id for update;
 if release.origin_session_id is null or release.state is distinct from 'released' or release.contract_hash is distinct from p_contract_hash
  or d.state<>'released' or d.expires_at<=clock_timestamp() or d.user_id is distinct from w.user_id then
  raise exception 'Finite keyword publication release required' using errcode='PT403'; end if;
 if not exists(select 1 from jsonb_array_elements(release.sources) s where s=slot)
  or (select count(*) from jsonb_array_elements(release.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1
  or not exists(select 1 from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text and s->>'updateId'=a.id and s->>'sourceHash'=slot->>'sourceHash') then
  raise exception 'Publication binding changed while locking' using errcode='PT409'; end if;
 -- A simultaneous identical publication must observe the receipt written by
 -- the first transaction after waiting for its archive/session locks.
 select * into old_publication from public.keyword_production_publications where session_id=p_session_id and source_ordinal=p_source_ordinal;
 if found then return public.publish_keyword_recovery_result(p_session_id,p_source_ordinal,p_contract_hash,p_calls,p_output); end if;
 rec:=a.record; source_hash:=encode(sha256(convert_to(rec->>'content','UTF8')),'hex');
 if source_hash is distinct from slot->>'sourceHash' or public.content_analysis_source_revision(rec) is distinct from slot->>'sourceRevision'
  or public.content_analysis_source_fingerprint(w.state,a.source_id) is distinct from slot->>'sourceFingerprint'
  or public.keyword_production_snapshot(rec) is distinct from slot->>'keywordSnapshotHash'
  or public.content_analysis_eligible(w.state,rec) is distinct from true then
  raise exception 'Publication source, follows or keywords changed' using errcode='PT409'; end if;
 if coalesce(slot->>'chunkCount','') !~ '^[1-9][0-9]?$' then raise exception 'Invalid frozen chunk count' using errcode='PT400'; end if;
 chunks:=(slot->>'chunkCount')::integer;
 select coalesce(jsonb_agg(value order by (value->>'chunkIndex')::integer,value->>'role'),'[]'::jsonb) into baseline_calls
  from jsonb_array_elements(p_calls) where value->>'role' in ('direct','typed','checker');
 select coalesce(jsonb_agg(value order by (value->>'batchIndex')::integer),'[]'::jsonb) into expected_repairs
  from jsonb_array_elements(release.recovery_requests) where value->'sourceOrdinal'=to_jsonb(p_source_ordinal);
 if chunks>83 or jsonb_array_length(p_calls)<>chunks*3+jsonb_array_length(expected_repairs) then
  raise exception 'Incomplete original or repair generation receipts' using errcode='PT400'; end if;
 proof:=public.keyword_recovery_origin_receipts(p_session_id,p_source_ordinal,baseline_calls);
 if slot->'baselineReceipts' is distinct from proof->'baselineReceipts'
  or slot->'originResultHashesPGsha' is distinct from proof->'originResultHashesPGsha'
  or slot->'originRequestPayloadHashesPGsha' is distinct from proof->'originRequestPayloadHashesPGsha'
  or slot->'baselinePolicyHashPGsha' is distinct from proof->'baselinePolicyHashPGsha'
  or coalesce(slot->>'baselineOutputHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(slot->>'baselineGenerationContractHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(slot->>'reviewedOutputHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(slot->>'semanticReviewHash','') !~ '^[a-f0-9]{64}$'
  or slot->>'reviewedOutputNativeHash' is distinct from encode(sha256(convert_to(p_output::text,'UTF8')),'hex') then
  raise exception 'Sealed original evidence or reviewed output changed' using errcode='PT409'; end if;
 select * into origin from public.keyword_learning_sessions where id=release.origin_session_id;
 select * into original from public.keyword_production_releases where session_id=release.origin_session_id;
 if p_output#>>'{evidence,generationContractHash}' is distinct from slot->>'baselineGenerationContractHash'
  or p_output#>>'{evidence,recoveryContractHash}' is distinct from p_contract_hash
  or p_output#>>'{evidence,protocolVersion}' is distinct from 'named-mentions-v1'
  or p_output#>'{evidence,chunkCount}' is distinct from to_jsonb(chunks) then
  raise exception 'Keyword production output contract changed' using errcode='PT409'; end if;
 for receipt_slot in select value from jsonb_array_elements(p_calls) loop
  if jsonb_typeof(receipt_slot)<>'object' or (receipt_slot-array['chunkIndex','role','callId','requestHash'])<>'{}'::jsonb
   or jsonb_typeof(receipt_slot->'chunkIndex') is distinct from 'number'
   or (receipt_slot->>'chunkIndex')::numeric<>trunc((receipt_slot->>'chunkIndex')::numeric)
   or (receipt_slot->>'chunkIndex')::numeric not between 0 and 82
   or receipt_slot->>'role' is null or receipt_slot->>'role' not in ('direct','typed','checker','repair')
   or coalesce(receipt_slot->>'callId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(receipt_slot->>'requestHash','') !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid generation receipt' using errcode='PT400'; end if;
  chunk_index:=(receipt_slot->>'chunkIndex')::integer;call_role:=receipt_slot->>'role';
  if chunk_index::text||':'||call_role=any(seen_slots) or (receipt_slot->>'callId')::uuid=any(seen_calls) then
   raise exception 'Duplicate generation receipt' using errcode='PT400'; end if;
  seen_slots:=array_append(seen_slots,chunk_index::text||':'||call_role);seen_calls:=array_append(seen_calls,(receipt_slot->>'callId')::uuid);
  plan:=null;
  if call_role='repair' then
   select value into plan from jsonb_array_elements(expected_repairs) where value->'batchIndex'=to_jsonb(chunk_index);
   if plan is null then raise exception 'Unadmitted repair receipt' using errcode='PT409'; end if;
   select * into request from public.keyword_learning_requests where session_id=d.id and call_id=(receipt_slot->>'callId')::uuid;
  else
   if chunk_index>=chunks then raise exception 'Original receipt outside frozen chunks' using errcode='PT400'; end if;
   select * into request from public.keyword_learning_requests where session_id=origin.id and call_id=(receipt_slot->>'callId')::uuid;
  end if;
  select * into charge from public.reader_content_analysis_calls where id=request.call_id;
  expected_model:=case when call_role in ('checker','repair') then 'openai/gpt-6.1-sol-pro' else 'deepseek/deepseek-v4.1-flash-1017' end;
  if request.call_id is null or request.source_ordinal<>p_source_ordinal or request.source_hash<>source_hash
   or request.request_hash is distinct from receipt_slot->>'requestHash' or not request.completed or request.error_code is not null
   or request.result is null or jsonb_typeof(request.result->'value') is distinct from 'object' or request.result->>'validationError' is not null
   or charge.user_id is distinct from d.user_id or charge.source_revision is distinct from source_hash
   or charge.request_hash is distinct from request.request_hash or charge.model is distinct from expected_model
   or charge.state<>'settled' or charge.actual_usd is null or charge.actual_usd<0 or charge.actual_usd>.10
   or charge.actual_usd::text in ('NaN','Infinity','-Infinity')
   or (call_role='repair' and (request.call_key is distinct from plan->>'callKey'
    or request.request_hash is distinct from plan->>'requestHash' or request.request_payload is distinct from plan->'requestPayload'
    or charge.execution_identity is distinct from plan->'executionIdentity'
    or request.result->'executionIdentity' is distinct from plan->'executionIdentity'
    or request.result->>'providerId' is null or (request.result->>'actualUsd')::numeric is distinct from charge.actual_usd)) then
   raise exception 'Successful settled generation evidence required' using errcode='PT409'; end if;
  generation_receipts:=generation_receipts||jsonb_build_array(receipt_slot||jsonb_build_object('model',charge.model,
   'resultHash',encode(sha256(convert_to(request.result::text,'UTF8')),'hex'))
   ||case when call_role='repair' then jsonb_build_object('sessionId',d.id) else jsonb_build_object('originSessionId',origin.id) end);
 end loop;
 perform public.validate_content_analysis_result('keywords',p_output,rec,source_hash);
 for candidate in select value from jsonb_array_elements(p_output#>'{evidence,accepted}') loop
  if strpos(lower(regexp_replace(rec->>'content',E'[ \\t\\r\\n]*[\\r\\n][ \\t\\r\\n]*',' ','g')),lower(candidate->>'label'))=0 then
   raise exception 'Accepted keyword is not literal source text' using errcode='PT400'; end if;
 end loop;
 -- Preserve every already accepted current-source annotation. A batch may
 -- add evidence; it must not replace an editorial inventory with coarser types.
 if jsonb_array_length(coalesce(rec->'videoKeywords','[]'::jsonb))>0 and (public.content_analysis_keyword_provenance(rec)#>>'{}') is distinct from source_hash then
  raise exception 'Existing keyword provenance needs review' using errcode='PT409'; end if;
 for item in select value from jsonb_array_elements(coalesce(rec->'videoKeywords','[]'::jsonb)) loop
  k:=public.content_analysis_keyword_key(item->>'label');
  if k is null or k='' then raise exception 'Existing keyword inventory malformed' using errcode='PT409'; end if;
  kind:=case when coalesce(rec->'brands','[]'::jsonb) ? (item->>'label') then 'brand' else 'category' end;
  entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',kind,'keyword',item));
 end loop;
 -- Keep current-source accepted topic/brand labels that lack timing, too.
 if (public.content_analysis_keyword_provenance(rec)#>>'{}')=source_hash then
  for item in select value from jsonb_array_elements(coalesce(rec->'topics','[]'::jsonb)||coalesce(rec->'brands','[]'::jsonb)) loop
   if jsonb_typeof(item)<>'string' then raise exception 'Existing keyword label malformed' using errcode='PT409'; end if;
   label:=item#>>'{}';k:=public.content_analysis_keyword_key(label);
   if not (entries ? k) then entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',case when coalesce(rec->'brands','[]'::jsonb) ? label then 'brand' else 'category' end,'keyword',public.content_analysis_public_keyword(label,'[]'::jsonb))); end if;
  end loop;
 end if;
 perform 1 from public.admin_keyword_reviews q where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash order by q.id for update;
 for candidate in select value from jsonb_array_elements(p_output->'pending') loop
  k:=public.content_analysis_keyword_key(candidate->>'label');
  if not exists(select 1 from public.admin_keyword_reviews q where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash
   and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then
   insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
    values(d.user_id,a.id,a.source_id,source_hash,candidate->>'label',candidate->>'kind',(candidate->>'confidence')::integer,
     candidate->>'reason',candidate->>'evidenceQuote',candidate->'ranges',coalesce(rec->>'title',''),coalesce(rec->>'url',''))
    on conflict(user_id,update_id,content_hash,normalized_label) do nothing;
  end if;
 end loop;
 for candidate in select value from jsonb_array_elements(p_output#>'{evidence,accepted}') loop
  k:=public.content_analysis_keyword_key(candidate->>'label');
  if exists(select 1 from public.admin_keyword_reviews q where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash and q.status in ('approved','rejected')
   and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then continue; end if;
  if entries ? k then
   ranges:=coalesce(entries#>array[k,'keyword','ranges'],'[]'::jsonb)||(candidate->'ranges');
   entries:=jsonb_set(entries,array[k,'keyword'],public.content_analysis_public_keyword(entries#>>array[k,'keyword','label'],ranges));
  else entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',candidate->>'kind','keyword',public.content_analysis_public_keyword(candidate->>'label',candidate->'ranges'))); end if;
 end loop;
 -- Explicit current operator decisions win over old and new model output.
 for prior in select q.* from public.admin_keyword_reviews q where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash
  and (q.status<>'pending' or not exists(select 1 from jsonb_array_elements(p_output#>'{evidence,accepted}') c
   where public.content_analysis_keyword_key(c->>'label') in (public.content_analysis_keyword_key(q.label),public.content_analysis_keyword_key(q.resolved_label)))) order by q.updated_at,q.id loop
  entries:=entries-public.content_analysis_keyword_key(prior.label)-coalesce(public.content_analysis_keyword_key(prior.resolved_label),'');
  if prior.status='approved' then
   label:=prior.resolved_label; k:=public.content_analysis_keyword_key(label);ranges:=prior.proposed_ranges;
   for item in select value from jsonb_array_elements(coalesce(rec->'videoKeywords','[]'::jsonb)) loop
    if public.content_analysis_keyword_key(item->>'label') in (k,public.content_analysis_keyword_key(prior.label)) then ranges:=ranges||coalesce(item->'ranges','[]'::jsonb); end if;
   end loop;
   entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',prior.resolved_kind,'keyword',public.content_analysis_public_keyword(label,ranges)));
  end if;
 end loop;
 if (select count(*) from jsonb_each(entries))>1000 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
 select coalesce(jsonb_agg(value->'keyword' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
  coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
  coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key) filter(where value->>'kind' in ('brand','product','game')),'[]'::jsonb)
  into keywords,topics,brands from jsonb_each(entries);
 final_state:=case when exists(select 1 from public.admin_keyword_reviews q where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash and q.status='pending'
  and not exists(select 1 from jsonb_array_elements(p_output#>'{evidence,accepted}') c
   where public.content_analysis_keyword_key(c->>'label') in (public.content_analysis_keyword_key(q.label),public.content_analysis_keyword_key(q.resolved_label)))) then 'review'
  when jsonb_array_length(topics)=0 then 'empty' else 'ready' end;
 proc:=public.content_analysis_processing(rec,source_hash);
 proc:=jsonb_set(proc,array['keywords'],to_jsonb(final_state))||jsonb_build_object('updatedAt',clock_timestamp());
 next_record:=rec||jsonb_build_object('videoKeywords',keywords,'topics',topics,'brands',brands,'keywordRuleVersion','entities-v2','keywordContentHash',source_hash,'processing',proc);
 previous_annotations:=jsonb_build_object('videoKeywords',rec->'videoKeywords','topics',rec->'topics','brands',rec->'brands','keywordRuleVersion',rec->'keywordRuleVersion','keywordContentHash',rec->'keywordContentHash','processing',rec->'processing');
 output_receipt:=jsonb_build_object('published',true,'replayed',false,'publicationId',publication_id,'sourceOrdinal',p_source_ordinal,'sourceHash',source_hash,'contractHash',p_contract_hash,
  'originSessionId',origin.id,'baselineContractHash',release.baseline_contract_hash,'baselineReceiptNativeHash',proof->>'baselineReceiptNativeHash',
  'baselineOutputHash',slot->>'baselineOutputHash','reviewedOutputHash',slot->>'reviewedOutputHash','reviewedOutputNativeHash',slot->>'reviewedOutputNativeHash','semanticReviewHash',slot->>'semanticReviewHash',
  'newCallCount',jsonb_array_length(expected_repairs),'newSettledUsd',(select coalesce(sum(c.actual_usd),0) from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id where r.session_id=d.id and r.source_ordinal=p_source_ordinal),
  'keywordCount',jsonb_array_length(keywords),'acceptedCount',jsonb_array_length(p_output#>'{evidence,accepted}'),'pendingCount',jsonb_array_length(p_output->'pending'),'state',final_state,'keywordSnapshotHashAfter',public.keyword_production_snapshot(next_record),
  'machineAdjudicatedPendingReviewIds',(select coalesce(jsonb_agg(q.id order by q.id),'[]'::jsonb) from public.admin_keyword_reviews q
   where q.user_id=d.user_id and q.update_id=a.id and q.content_hash=source_hash and q.status='pending'
   and exists(select 1 from jsonb_array_elements(p_output#>'{evidence,accepted}') c where public.content_analysis_keyword_key(c->>'label')=public.content_analysis_keyword_key(q.label))));
 update public.reader_source_updates set record=next_record where user_id=a.user_id and id=a.id and record=rec;
 if not found then raise exception 'Archive changed' using errcode='PT409'; end if;
 insert into public.keyword_production_publications(id,session_id,source_ordinal,user_id,update_id,source_hash,source_revision,contract_hash,generation_receipts,output,previous_annotations,receipt)
  values(publication_id,d.id,p_source_ordinal,d.user_id,a.id,source_hash,slot->>'sourceRevision',p_contract_hash,generation_receipts,p_output,previous_annotations,output_receipt);
 return output_receipt;
end;
$$;

-- Extend the existing erasure path; all private plan quotes and payloads are
-- cleared while the immutable financial ledger remains intact.
create or replace function public.erase_keyword_production_release() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; update_id text;
begin
 if tg_table_name='reader_source_updates' then update_id:=old.id; end if;
 for sid in select d.id from public.keyword_learning_sessions d where d.user_id=old.user_id
  and exists(select 1 from public.keyword_production_releases r where r.session_id=d.id)
  and (tg_table_name='reader_workspaces' or exists(select 1 from jsonb_array_elements(d.sources) s where s->>'updateId'=update_id))
  order by d.id for update loop
  update public.keyword_production_releases set state='closed',sources='[]'::jsonb,recovery_requests='[]'::jsonb where session_id=sid;
 end loop;
 return old;
end;
$$;
revoke all on function public.keyword_recovery_origin_receipts(uuid,integer,jsonb),public.seal_keyword_recovery_plan(uuid,integer,jsonb,text,jsonb),
 public.enforce_keyword_recovery_request(),public.publish_keyword_recovery_result(uuid,integer,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.keyword_recovery_origin_receipts(uuid,integer,jsonb),public.seal_keyword_recovery_plan(uuid,integer,jsonb,text,jsonb),
 public.publish_keyword_recovery_result(uuid,integer,text,jsonb,jsonb) to service_role;
commit;
