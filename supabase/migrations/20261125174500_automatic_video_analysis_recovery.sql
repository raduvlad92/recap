-- Preserve complete model receipts, including a settled format/capacity
-- failure that a later request recovered. Unknown charges still block review.
-- Keep the monthly-budget yield introduced by 20261125103322.
begin;

create or replace function public.finish_automatic_content_task(p_task_id uuid,p_lease_token uuid,p_result jsonb default null,p_error_code text default null)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;a public.reader_source_updates;w public.reader_workspaces;
 s public.keyword_learning_sessions;keys jsonb;entry jsonb;point jsonb;chosen jsonb;provenance jsonb;reason text;label text;kind text;
 amount integer:=0;inserted integer;unknown_call boolean;key_count integer;video_calls boolean;
begin
 if p_task_id is null or p_lease_token is null or(p_error_code is null and p_result is null)
  or(p_error_code is not null and(p_error_code!~'^[a-z][a-z0-9_]{0,79}$'or p_result is not null))
  or(p_result is not null and(jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>2000000))then
  raise exception 'Invalid automatic task result'using errcode='PT400';end if;
 select*into t from public.automatic_content_tasks where id=p_task_id;
 if not found then raise exception 'Automatic task unavailable'using errcode='PT409';end if;
 select*into w from public.reader_workspaces where user_id=t.user_id for key share;
 select*into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select*into t from public.automatic_content_tasks where id=p_task_id for update;
 if t.state<>'running'or t.lease_token is distinct from p_lease_token or t.lease_until<=clock_timestamp()then
  raise exception 'Automatic task lease changed'using errcode='PT409';end if;
 select*into s from public.keyword_learning_sessions where id=t.session_id for update;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 elsif not exists(select 1 from public.automatic_content_policies p where p.user_id=t.user_id and p.enabled)then reason:='automatic_processing_paused';
 elsif s.state is distinct from'released'or s.expires_at<=clock_timestamp()then reason:='automatic_session_expired';end if;
 select coalesce(jsonb_agg(r.call_key order by r.created_at,r.call_key),'[]'::jsonb),count(*),coalesce(bool_or(c.actual_usd is null),false),
  coalesce(bool_and(coalesce(r.request_payload->>'originalKey' like 'automatic-video:v1:'||t.task||':%',false)),false)
  into keys,key_count,unknown_call,video_calls from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
  where r.session_id=t.session_id and r.source_ordinal=1 and r.source_hash=t.content_hash and c.user_id=t.user_id;
 if reason is null and p_error_code in ('automatic_worker_yield','provider_monthly_budget_exhausted') and not unknown_call then
  update public.automatic_content_tasks set state='queued',error_code=p_error_code,lease_token=null,lease_until=null where id=t.id;
  return jsonb_build_object('state','queued','reviewCount',0,'sessionId',s.id);
 end if;
 if reason is null then reason:=case when unknown_call then'analysis_unknown_charge_hold'else p_error_code end;end if;
 provenance:=jsonb_build_object('origin','automatic_content','sessionId',s.id,'callKeys',keys,'sourceRevision',t.source_revision,
  'message','Automatically generated draft. Administrator confirmation is required; nothing was published.');
 if reason is not null then
  -- Operational stops stay in task monitoring. Real attempted provider failures
  -- retain one inspectable inbox row, with no invented empty generated finding.
  if reason not in('automatic_worker_yield','automatic_source_changed','automatic_processing_paused','automatic_session_expired',
    'analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_input_limit')
   and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
    where r.session_id=s.id and r.completed and c.result_at is not null)then
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,case when t.task='recap'then'recap'else'keyword'end,
     'automatic:'||t.id::text||':failure',t.source_snapshot,'{}',
     'Automatic generation could not provide a validated draft ('||reason||'). Inspect the saved source and prompt, then edit or reject.',provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics amount=row_count;
  end if;
  update public.automatic_content_tasks set state=case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,
   error_code=reason,review_count=amount,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then update public.keyword_learning_sessions set state='closed'where id=s.id;end if;
  return jsonb_build_object('state',case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,'errorCode',reason,'reviewCount',amount);
 end if;
 if key_count=0 or jsonb_typeof(p_result->'callKeys')is distinct from'array'
  or jsonb_array_length(p_result->'callKeys')<>key_count or not((p_result->'callKeys')@>keys and keys@>(p_result->'callKeys'))
  or exists(
   select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=s.id and (
    not r.completed or r.result is null or r.source_ordinal<>1 or r.source_hash<>t.content_hash or c.user_id<>t.user_id or c.actual_usd is null
    or (video_calls and (c.state<>'settled' or c.provider_id is null or (r.result->>'validationError') is distinct from r.error_code))
    or (r.error_code is not null and not (
     video_calls and r.error_code in ('analysis_invalid_json','analysis_output_capacity')
     and r.result->>'validationError' is not distinct from r.error_code and c.state='settled' and c.provider_id is not null
     and exists (
      select 1 from public.keyword_learning_requests recovery join public.reader_content_analysis_calls replacement on replacement.id=recovery.call_id
      where recovery.session_id=r.session_id and recovery.created_at>r.created_at and replacement.model=c.model
       and recovery.request_payload#>>'{request,role}'=r.request_payload#>>'{request,role}'
       and recovery.request_payload#>>'{request,correction,baseKey}'=r.call_key
       and recovery.request_payload#>>'{request,correction,errorCode}'=r.error_code
     )
    ))
   )
  )then
  raise exception 'Exact completed automatic call evidence is required'using errcode='PT409';end if;
 if t.task='keywords'then
  if p_result->>'kind'is distinct from'keywords'or jsonb_typeof(p_result->'proposals')is distinct from'array'or jsonb_array_length(p_result->'proposals')>(case when video_calls then 15 else 5000 end)
   or (video_calls and jsonb_array_length(p_result->'proposals')<1) then
   raise exception 'Invalid automatic keyword proposals'using errcode='PT400';end if;
  for entry in select value from jsonb_array_elements(p_result->'proposals')loop
   label:=btrim(entry->>'label');kind:=entry->>'kind';
   if jsonb_typeof(entry)is distinct from'object'or(entry-array['label','kind','reason'])<>'{}'::jsonb
    or jsonb_typeof(entry->'label')is distinct from'string'or char_length(label)not between 1 and 100 or label~'[[:cntrl:]]'
    or kind is null or kind not in('brand','product','game','technology','category')then
    raise exception 'Invalid automatic keyword proposal'using errcode='PT400';end if;
   reason:=coalesce(nullif(btrim(entry->>'reason'),''),'AI keyword draft; confirm its relevance and identity, edit or reject.');
   if strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    if video_calls then raise exception 'Automatic video keyword needs a literal source mention' using errcode='PT400';end if;
    reason:='Name does not occur literally in the saved source. Correct it from that source or reject. '||reason;
   end if;
   if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,'keyword','automatic:'||t.id::text||':keyword:'||encode(sha256(convert_to(public.keyword_review_label_key(label),'UTF8')),'hex'),
     t.source_snapshot,jsonb_build_object('label',label,'kind',kind),reason,provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics inserted=row_count;amount:=amount+inserted;
  end loop;
 else
  chosen:=p_result->'proposal';
  if p_result->>'kind'is distinct from'recap'or jsonb_typeof(chosen)is distinct from'object'or(chosen-'highlights')<>'{}'::jsonb
   or jsonb_typeof(chosen->'highlights')is distinct from'array'or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'Automatic recap needs one to six cited points'using errcode='PT400';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb
    or jsonb_typeof(point->'text')is distinct from'string'or char_length(btrim(point->>'text'))not between 1 and 500
    or cardinality(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'))>38
    or jsonb_typeof(point->'evidenceQuote')is distinct from'string'or char_length(btrim(point->>'evidenceQuote'))not between 15 and 1000
    or strpos(a.record->>'content',point->>'evidenceQuote')=0 then
    raise exception 'Automatic recap needs exact supporting source quotes'using errcode='PT400';end if;
  end loop;
  reason:=coalesce(nullif(btrim(p_result->>'reason'),''),'AI recap draft; check the cited source, then confirm, edit or reject.');
  if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
  insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
   values(t.user_id,t.update_id,t.source_id,t.content_hash,'recap','automatic:'||t.id::text||':recap',t.source_snapshot,chosen,reason,provenance)
   on conflict(dedupe_key)do nothing;
  get diagnostics amount=row_count;
 end if;
 update public.automatic_content_tasks set state='review',review_count=amount,error_code=null,lease_token=null,lease_until=null where id=t.id;
 update public.keyword_learning_sessions set state='closed'where id=s.id;
 return jsonb_build_object('state','review','reviewCount',amount);
end;
$$;

commit;
