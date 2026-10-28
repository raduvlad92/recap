-- Finite keyword rollout publication. This migration releases no session,
-- enables no background queue and changes no historical job or charge.
begin;

create function public.keyword_production_snapshot(p_record jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
  'videoKeywords',p_record->'videoKeywords','topics',p_record->'topics','brands',p_record->'brands',
  'keywordRuleVersion',p_record->'keywordRuleVersion','keywordContentHash',p_record->'keywordContentHash',
  'keywordTimingBasis',p_record->'keywordTimingBasis','keywordEvidence',p_record->'keywordEvidence',
  'provenance',public.content_analysis_keyword_provenance(p_record),
  'processingKeywords',p_record#>'{processing,keywords}')::text,'UTF8')),'hex');
$$;

create table public.keyword_production_releases (
 session_id uuid primary key references public.keyword_learning_sessions(id),
 contract_hash text not null check(contract_hash ~ '^[a-f0-9]{64}$'),
 state text not null default 'staged' check(state in ('staged','released','closed')),
 sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=20),
 created_at timestamptz not null default clock_timestamp(),
 check(state='closed' or jsonb_array_length(sources)>0)
);
create table public.keyword_production_publications (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.keyword_production_releases(session_id),
 source_ordinal integer not null check(source_ordinal between 1 and 1000),
 user_id text not null, update_id text not null, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 contract_hash text not null check(contract_hash ~ '^[a-f0-9]{64}$'),
 generation_receipts jsonb not null check(jsonb_typeof(generation_receipts)='array' and jsonb_array_length(generation_receipts) between 3 and 249),
 output jsonb not null check(jsonb_typeof(output)='object' and octet_length(output::text)<=500000),
 previous_annotations jsonb not null check(jsonb_typeof(previous_annotations)='object'),
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(user_id) references public.reader_workspaces(user_id) on delete cascade,
 foreign key(user_id,update_id) references public.reader_source_updates(user_id,id) on delete cascade,
 unique(session_id,source_ordinal)
);
create index keyword_production_publications_source on public.keyword_production_publications(user_id,update_id,source_hash);
alter table public.keyword_production_releases enable row level security;
alter table public.keyword_production_publications enable row level security;
revoke all on public.keyword_production_releases,public.keyword_production_publications from public,anon,authenticated,service_role;
grant select,update on public.keyword_production_releases to service_role;
grant select,insert on public.keyword_production_publications to service_role;

create function public.publish_keyword_production_result(p_session_id uuid,p_source_ordinal integer,p_contract_hash text,p_calls jsonb,p_output jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions; release public.keyword_production_releases; a public.reader_source_updates; w public.reader_workspaces;
 old_publication public.keyword_production_publications; prior public.admin_keyword_reviews; request public.keyword_learning_requests; charge public.reader_content_analysis_calls;
 slot jsonb; receipt_slot jsonb; candidate jsonb; item jsonb; rec jsonb; next_record jsonb; proc jsonb; output_receipt jsonb;
 entries jsonb:='{}'; generation_receipts jsonb:='[]'; previous_annotations jsonb; keywords jsonb; topics jsonb; brands jsonb;
 source_hash text; k text; label text; kind text; ranges jsonb; final_state text; chunks integer; chunk_index integer; call_role text;
 seen_slots text[]:='{}'; seen_calls uuid[]:='{}'; publication_id uuid:=gen_random_uuid(); expected_model text;
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
   or (select jsonb_agg(value-array['resultHash','model'] order by (value->>'chunkIndex')::integer,value->>'role') from jsonb_array_elements(old_publication.generation_receipts))
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
 select * into d from public.keyword_learning_sessions where id=p_session_id for update;
 select * into release from public.keyword_production_releases where session_id=p_session_id for update;
 if release.state is distinct from 'released' or release.contract_hash is distinct from p_contract_hash
  or d.state<>'released' or d.expires_at<=clock_timestamp() or d.user_id is distinct from w.user_id then
  raise exception 'Finite keyword publication release required' using errcode='PT403'; end if;
 if not exists(select 1 from jsonb_array_elements(release.sources) s where s=slot)
  or (select count(*) from jsonb_array_elements(release.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1
  or not exists(select 1 from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text and s->>'updateId'=a.id and s->>'sourceHash'=slot->>'sourceHash') then
  raise exception 'Publication binding changed while locking' using errcode='PT409'; end if;
 -- A simultaneous identical publication must observe the receipt written by
 -- the first transaction after waiting for its archive/session locks.
 select * into old_publication from public.keyword_production_publications where session_id=p_session_id and source_ordinal=p_source_ordinal;
 if found then return public.publish_keyword_production_result(p_session_id,p_source_ordinal,p_contract_hash,p_calls,p_output); end if;
 rec:=a.record; source_hash:=encode(sha256(convert_to(rec->>'content','UTF8')),'hex');
 if source_hash is distinct from slot->>'sourceHash' or public.content_analysis_source_revision(rec) is distinct from slot->>'sourceRevision'
  or public.content_analysis_source_fingerprint(w.state,a.source_id) is distinct from slot->>'sourceFingerprint'
  or public.keyword_production_snapshot(rec) is distinct from slot->>'keywordSnapshotHash'
  or public.content_analysis_eligible(w.state,rec) is distinct from true then
  raise exception 'Publication source, follows or keywords changed' using errcode='PT409'; end if;
 if coalesce(slot->>'chunkCount','') !~ '^[1-9][0-9]?$' then raise exception 'Invalid frozen chunk count' using errcode='PT400'; end if;
 chunks:=(slot->>'chunkCount')::integer;
 if chunks>83 or jsonb_array_length(p_calls)<>chunks*3 then raise exception 'Incomplete generation receipts' using errcode='PT400'; end if;
 if p_output#>>'{evidence,generationContractHash}' is distinct from p_contract_hash
  or p_output#>>'{evidence,protocolVersion}' is distinct from 'named-mentions-v1'
  or p_output#>'{evidence,chunkCount}' is distinct from to_jsonb(chunks) then
  raise exception 'Keyword production output contract changed' using errcode='PT409'; end if;
 for receipt_slot in select value from jsonb_array_elements(p_calls) loop
  if jsonb_typeof(receipt_slot)<>'object' or (receipt_slot-array['chunkIndex','role','callId','requestHash'])<>'{}'::jsonb
   or jsonb_typeof(receipt_slot->'chunkIndex') is distinct from 'number'
   or (receipt_slot->>'chunkIndex')::numeric<>trunc((receipt_slot->>'chunkIndex')::numeric)
   or (receipt_slot->>'chunkIndex')::integer not between 0 and chunks-1
   or receipt_slot->>'role' is null or receipt_slot->>'role' not in ('direct','typed','checker')
   or coalesce(receipt_slot->>'callId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(receipt_slot->>'requestHash','') !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid generation receipt' using errcode='PT400'; end if;
  chunk_index:=(receipt_slot->>'chunkIndex')::integer;call_role:=receipt_slot->>'role';
  if chunk_index::text||':'||call_role=any(seen_slots) or (receipt_slot->>'callId')::uuid=any(seen_calls) then
   raise exception 'Duplicate generation receipt' using errcode='PT400'; end if;
  seen_slots:=array_append(seen_slots,chunk_index::text||':'||call_role);seen_calls:=array_append(seen_calls,(receipt_slot->>'callId')::uuid);
  select * into request from public.keyword_learning_requests where session_id=d.id and call_id=(receipt_slot->>'callId')::uuid;
  select * into charge from public.reader_content_analysis_calls where id=request.call_id;
  expected_model:=case when call_role='checker' then 'openai/gpt-6.1-sol-pro' else 'deepseek/deepseek-v4.1-flash-1017' end;
  if request.call_id is null or request.source_ordinal<>p_source_ordinal or request.source_hash<>source_hash
   or request.request_hash is distinct from receipt_slot->>'requestHash' or not request.completed or request.error_code is not null
   or request.result is null or request.result->'value' is null or request.result->>'validationError' is not null
   or charge.user_id is distinct from d.user_id or charge.source_revision is distinct from source_hash
   or charge.request_hash is distinct from request.request_hash or charge.model is distinct from expected_model
   or charge.state<>'settled' or charge.actual_usd is null or charge.actual_usd>.10 then
   raise exception 'Successful settled generation evidence required' using errcode='PT409'; end if;
  generation_receipts:=generation_receipts||jsonb_build_array(receipt_slot||jsonb_build_object('model',charge.model,
   'resultHash',encode(sha256(convert_to(request.result::text,'UTF8')),'hex')));
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
 if (select count(*) from jsonb_each(entries))>500 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
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

-- A later source-bound checker may settle an earlier model's pending name.
-- Keep that historical row exact; a private view hides only currently accepted
-- machine-adjudicated pending rows. Explicit operator decisions always remain.
create view public.admin_keyword_review_queue with (security_invoker=true) as
 select q.* from public.admin_keyword_reviews q where q.status<>'pending' or not exists (
  select 1 from public.keyword_production_publications p join public.reader_source_updates a on a.user_id=p.user_id and a.id=p.update_id
  where p.user_id=q.user_id and p.update_id=q.update_id and p.source_hash=q.content_hash and q.updated_at<=p.created_at
   and (public.content_analysis_keyword_provenance(a.record)#>>'{}')=q.content_hash
   and exists(select 1 from jsonb_array_elements(p.output#>'{evidence,accepted}') c where public.content_analysis_keyword_key(c->>'label')=public.content_analysis_keyword_key(q.label))
   and exists(select 1 from jsonb_array_elements(coalesce(a.record->'videoKeywords','[]'::jsonb)) k where public.content_analysis_keyword_key(k->>'label')=public.content_analysis_keyword_key(q.label))
 );
revoke all on public.admin_keyword_review_queue from public,anon,authenticated,service_role;
grant select on public.admin_keyword_review_queue to service_role;

create function public.erase_keyword_production_release() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; update_id text;
begin
 if tg_table_name='reader_source_updates' then update_id:=old.id;end if;
 -- Run before the existing evaluation erasure trigger clears the owner/source
 -- lookup. Receipt payloads themselves cascade with the archive FK.
 for sid in select d.id from public.keyword_learning_sessions d where d.user_id=old.user_id
  and exists(select 1 from public.keyword_production_releases r where r.session_id=d.id)
  and (tg_table_name='reader_workspaces' or exists(select 1 from jsonb_array_elements(d.sources) s where s->>'updateId'=update_id))
  order by d.id for update loop
  update public.keyword_production_releases set state='closed',sources='[]'::jsonb where session_id=sid;
 end loop;
 return old;
end;
$$;
create trigger keyword_00_production_archive_erasure before delete on public.reader_source_updates for each row execute function public.erase_keyword_production_release();
create trigger keyword_00_production_workspace_erasure before delete on public.reader_workspaces for each row execute function public.erase_keyword_production_release();

revoke all on function public.keyword_production_snapshot(jsonb),public.publish_keyword_production_result(uuid,integer,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.erase_keyword_production_release() from public,anon,authenticated,service_role;
grant execute on function public.keyword_production_snapshot(jsonb),public.publish_keyword_production_result(uuid,integer,text,jsonb,jsonb) to service_role;
commit;
