-- Founder approved one additional USD2 on 11 November 2026: USD12 cumulative.
-- Keep USD5/day, USD0.10/call, immutable historical charges and unknown holds.
-- This migration only permits the renewed ceiling; controls are updated separately
-- through the recorded exact-state operator. It creates no job or model request.
begin;

create or replace function public.reserve_keyword_learning_call(p_session_id uuid,p_call_key text,p_source_ordinal integer,p_source_hash text,
 p_model text,p_execution_identity jsonb,p_request_hash text,p_maximum_usd numeric,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions;r public.keyword_learning_requests;c public.reader_content_analysis_calls;
 b public.content_analysis_budget;p public.reader_content_analysis_policies;a public.reader_source_updates;slot jsonb;
 global_total numeric;global_day numeric;owner_total numeric;owner_day numeric;session_total numeric;calls integer;utc_day timestamptz;
begin
 perform public.validate_content_analysis_execution_identity(p_execution_identity,p_model);
 if p_session_id is null or p_call_key is null or p_call_key !~ '^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$'
  or p_source_ordinal is null or p_source_ordinal not between 1 and 1000 or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$'
  or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>.10
  or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>220000
  or p_request#>>'{request,key}' is distinct from p_call_key then
  raise exception 'Invalid private evaluation reservation' using errcode='PT400';end if;
 -- Source lock precedes financial locks, as in the production lock helper.
 -- Budget -> policy -> session then serializes money, caps and idempotency.
 select * into d from public.keyword_learning_sessions where id=p_session_id;
 if d.id is null or d.user_id is null then raise exception 'Evaluation session unavailable' using errcode='PT403';end if;
 select value into slot from jsonb_array_elements(d.sources) where value->>'ordinal'=p_source_ordinal::text;
 if slot is null or slot->>'sourceHash' is distinct from p_source_hash or slot->>'updateId' is null or length(slot->>'updateId') not between 1 and 200
  or (select count(*) from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text)<>1 then
  raise exception 'Frozen evaluation source missing' using errcode='PT409';end if;
 select * into a from public.reader_source_updates where user_id=d.user_id and id=slot->>'updateId' for share;
 if a.id is null or jsonb_typeof(a.record->'content') is distinct from 'string'
  or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from p_source_hash then
  raise exception 'Frozen evaluation source changed' using errcode='PT409';end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into p from public.reader_content_analysis_policies where user_id=d.user_id for update;
 select * into d from public.keyword_learning_sessions where id=p_session_id for update;
 if b.id is null or p.user_id is null or d.user_id is distinct from a.user_id or d.user_id is distinct from p.user_id
  or d.state<>'released' or d.expires_at<=clock_timestamp()
  or (p_model=any(d.models)) is distinct from true or p_maximum_usd>p.per_call_limit_usd then
  raise exception 'Finite released evaluation session required' using errcode='PT403';end if;
 if not exists(select 1 from jsonb_array_elements(d.sources) s where s->>'ordinal'=p_source_ordinal::text
  and s->>'sourceHash'=p_source_hash and s->>'updateId'=a.id) then
  raise exception 'Evaluation source binding changed while locking' using errcode='PT409';end if;
 select * into r from public.keyword_learning_requests where session_id=d.id and call_key=p_call_key;
 if found then
  select * into c from public.reader_content_analysis_calls where id=r.call_id;
  if r.request_hash is distinct from p_request_hash or r.source_hash is distinct from p_source_hash or r.source_ordinal is distinct from p_source_ordinal
   or r.request_payload is distinct from p_request or c.model is distinct from p_model or c.execution_identity is distinct from p_execution_identity
   or c.maximum_usd is distinct from p_maximum_usd then
   raise exception 'Evaluation request binding changed' using errcode='PT409';end if;
  return public.read_keyword_learning_call(d.id,p_call_key);
 end if;
 if exists(select 1 from public.keyword_learning_requests q join public.reader_content_analysis_calls l on l.id=q.call_id where q.session_id=d.id and l.actual_usd is null) then
  raise exception 'Unresolved evaluation call remains held' using errcode='PT409';end if;
 if exists(select 1 from public.content_analysis_provider_cooldowns q where q.identity_key=public.content_analysis_provider_key(p_execution_identity) and q.cooldown_until>clock_timestamp()) then
  raise exception 'Provider cooldown remains active' using errcode='PT409';end if;
 utc_day:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into global_total,global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_total,owner_day from public.reader_content_analysis_calls where user_id=d.user_id;
 select count(*),coalesce(sum(greatest(coalesce(l.actual_usd,l.maximum_usd),coalesce(l.observed_usd,0))),0)
  into calls,session_total from public.keyword_learning_requests q join public.reader_content_analysis_calls l on l.id=q.call_id where q.session_id=d.id;
 if global_total+p_maximum_usd>least(b.lifetime_limit_usd,12) or owner_total+p_maximum_usd>least(p.lifetime_limit_usd,12)
  or session_total+p_maximum_usd>d.maximum_usd or calls>=d.max_calls then
  raise exception 'Finite evaluation lifetime budget exhausted' using errcode='PT402';end if;
 if global_day+p_maximum_usd>least(b.daily_limit_usd,5) or owner_day+p_maximum_usd>least(p.daily_limit_usd,5) then
  raise exception 'Evaluation daily budget exhausted' using errcode='PT429';end if;
 insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,execution_identity,request_hash)
  values(null,d.user_id,p_call_key,gen_random_uuid(),p_model,p_source_hash,p_maximum_usd,p_execution_identity,p_request_hash) returning * into c;
 insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id)
  values(d.id,p_call_key,p_source_ordinal,p_source_hash,p_request_hash,p_request,c.id);
 return jsonb_build_object('claimed',true,'call',to_jsonb(c)-'result'-'usage','result',null,'errorCode',null,'requestHash',p_request_hash,'completed',false);
end;
$$;

create or replace function public.claim_automatic_content_task(p_lease_seconds integer default 900) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;p public.automatic_content_policies;
 a public.reader_source_updates;w public.reader_workspaces;b public.content_analysis_budget;
 op public.reader_content_analysis_policies;s public.keyword_learning_sessions;
 utc_day timestamptz;global_total numeric;global_day numeric;owner_total numeric;owner_day numeric;reason text;
begin
 if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then raise exception 'Invalid automatic lease'using errcode='PT400';end if;
 select q.*into t from public.automatic_content_tasks q join public.automatic_content_policies ap using(user_id)
 where ap.enabled and(q.state='queued' or(q.state='running'and q.lease_until<=clock_timestamp()))
 order by q.created_at,q.update_id,case q.task when'recap'then 0 else 1 end,q.id limit 1;
 if t.id is null then return jsonb_build_object('claimed',false);end if;
 -- Keep the existing workspace -> archive -> global budget -> owner ordering.
 select *into w from public.reader_workspaces where user_id=t.user_id for key share;
 select *into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select *into b from public.content_analysis_budget where id for update;
 select *into op from public.reader_content_analysis_policies where user_id=t.user_id for update;
 select *into p from public.automatic_content_policies where user_id=t.user_id for share;
 select *into t from public.automatic_content_tasks where id=t.id for update skip locked;
 if t.id is null or p.enabled is distinct from true or t.state not in('queued','running')or(t.state='running'and t.lease_until>clock_timestamp())then
  return jsonb_build_object('claimed',false);end if;
 if b.enabled is distinct from true or op.enabled is distinct from true then return jsonb_build_object('claimed',false,'reason','automatic_processing_paused');end if;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 end if;
 utc_day:=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into global_total,global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_total,owner_day from public.reader_content_analysis_calls where user_id=t.user_id;
 if reason is null then
  if global_total+.10>least(b.lifetime_limit_usd,12)or owner_total+.10>least(op.lifetime_limit_usd,12)then reason:='analysis_budget_exhausted';
  elsif global_day+.10>least(b.daily_limit_usd,5)or owner_day+.10>least(op.daily_limit_usd,5)then reason:='analysis_daily_budget_exhausted';
  elsif op.per_call_limit_usd<.10 then reason:='analysis_call_limit';end if;
 end if;
 if t.session_id is not null then
  select *into s from public.keyword_learning_sessions where id=t.session_id for update;
  if reason is null and(s.id is null or s.state<>'released'or s.expires_at<=clock_timestamp())then reason:='automatic_session_expired';end if;
  if reason is null and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=t.session_id and c.actual_usd is null)then reason:='analysis_unknown_charge_hold';end if;
 end if;
 if reason is not null then
  update public.automatic_content_tasks set state='blocked',error_code=reason,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then
   update public.keyword_learning_sessions set state='closed'where id=t.session_id and state<>'closed';
  end if;
  return jsonb_build_object('claimed',false,'reason',reason,'taskId',t.id);
 end if;
 if t.session_id is null then
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values(t.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',t.update_id,'sourceHash',t.content_hash,'sourceRevision',t.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],
    least(p.session_budget_usd,least(b.lifetime_limit_usd,12)-global_total,least(op.lifetime_limit_usd,12)-owner_total),
    p.max_calls,clock_timestamp()+interval'24 hours')returning*into s;
 end if;
 update public.automatic_content_tasks set state='running',session_id=s.id,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_claims=lease_claims+1,error_code=null
  where id=t.id returning*into t;
 return jsonb_build_object('claimed',true,'task',to_jsonb(t),'record',t.source_snapshot,'leaseToken',t.lease_token);
end;
$$;

create or replace function public.claim_social_content_task(p_lease_seconds integer default 900) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.social_content_tasks;p public.social_content_policies;
 a public.reader_source_updates;w public.reader_workspaces;b public.content_analysis_budget;
 op public.reader_content_analysis_policies;s public.keyword_learning_sessions;
 utc_day timestamptz;global_total numeric;global_day numeric;owner_total numeric;owner_day numeric;reason text;
begin
 if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then raise exception 'Invalid automatic lease'using errcode='PT400';end if;
 select q.*into t from public.social_content_tasks q join public.social_content_policies ap using(user_id)
 where ap.enabled and(q.state='queued' or(q.state='running'and q.lease_until<=clock_timestamp()))
 order by q.created_at,q.update_id,case q.task when'recap'then 0 else 1 end,q.id limit 1;
 if t.id is null then return jsonb_build_object('claimed',false);end if;
 -- Keep the existing workspace -> archive -> global budget -> owner ordering.
 select *into w from public.reader_workspaces where user_id=t.user_id for key share;
 select *into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select *into b from public.content_analysis_budget where id for update;
 select *into op from public.reader_content_analysis_policies where user_id=t.user_id for update;
 select *into p from public.social_content_policies where user_id=t.user_id for share;
 select *into t from public.social_content_tasks where id=t.id for update skip locked;
 if t.id is null or p.enabled is distinct from true or t.state not in('queued','running')or(t.state='running'and t.lease_until>clock_timestamp())then
  return jsonb_build_object('claimed',false);end if;
 if b.enabled is distinct from true or op.enabled is distinct from true then return jsonb_build_object('claimed',false,'reason','automatic_processing_paused');end if;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.social_content_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 end if;
 utc_day:=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into global_total,global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_total,owner_day from public.reader_content_analysis_calls where user_id=t.user_id;
 if reason is null then
  if global_total+.10>least(b.lifetime_limit_usd,12)or owner_total+.10>least(op.lifetime_limit_usd,12)then reason:='analysis_budget_exhausted';
  elsif global_day+.10>least(b.daily_limit_usd,5)or owner_day+.10>least(op.daily_limit_usd,5)then reason:='analysis_daily_budget_exhausted';
  elsif op.per_call_limit_usd<.10 then reason:='analysis_call_limit';end if;
 end if;
 if t.session_id is not null then
  select *into s from public.keyword_learning_sessions where id=t.session_id for update;
  if reason is null and(s.id is null or s.state<>'released'or s.expires_at<=clock_timestamp())then reason:='automatic_session_expired';end if;
  if reason is null and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=t.session_id and c.actual_usd is null)then reason:='analysis_unknown_charge_hold';end if;
 end if;
 if reason is not null then
  update public.social_content_tasks set state='blocked',error_code=reason,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then
   update public.keyword_learning_sessions set state='closed'where id=t.session_id and state<>'closed';
  end if;
  return jsonb_build_object('claimed',false,'reason',reason,'taskId',t.id);
 end if;
 if t.session_id is null then
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values(t.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',t.update_id,'sourceHash',t.content_hash,'sourceRevision',t.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],
    least(p.session_budget_usd,least(b.lifetime_limit_usd,12)-global_total,least(op.lifetime_limit_usd,12)-owner_total),
    p.max_calls,clock_timestamp()+interval'24 hours')returning*into s;
 end if;
 update public.social_content_tasks set state='running',session_id=s.id,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_claims=lease_claims+1,error_code=null
  where id=t.id returning*into t;
 return jsonb_build_object('claimed',true,'task',to_jsonb(t),'record',t.source_snapshot,'leaseToken',t.lease_token);
end;
$$;

commit;
