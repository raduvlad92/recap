-- Private, finite, nonpublishing prompt evaluation. No session is created or
-- released here, and no existing financial/runtime/source row is modified.
begin;

create table public.keyword_learning_sessions (
 id uuid primary key default gen_random_uuid(), user_id text,
 state text not null default 'staged' check(state in ('staged','released','closed')),
 sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=20),
 models text[] not null check(cardinality(models) between 1 and 4 and array_position(models,null) is null and models <@ array[
  'deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro']::text[]),
 maximum_usd numeric(24,12) not null check(maximum_usd>0 and maximum_usd<=10),
 max_calls integer not null check(max_calls between 1 and 250),
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 check(state='closed' or (user_id is not null and length(user_id) between 1 and 200 and jsonb_array_length(sources)>0)),
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create table public.keyword_learning_requests (
 session_id uuid not null references public.keyword_learning_sessions(id),
 call_key text not null check(call_key ~ '^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$'),
 source_ordinal integer not null check(source_ordinal between 1 and 1000),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 request_payload jsonb check(request_payload is null or (jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=220000)),
 call_id uuid not null unique references public.reader_content_analysis_calls(id),
 result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=500000)),
 error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 completed boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 primary key(session_id,call_key)
);
alter table public.keyword_learning_sessions enable row level security;
alter table public.keyword_learning_requests enable row level security;
revoke all on public.keyword_learning_sessions,public.keyword_learning_requests from public,anon,authenticated,service_role;
grant select,update on public.keyword_learning_sessions to service_role;
grant select,insert,update on public.keyword_learning_requests to service_role;

create function public.read_keyword_learning_call(p_session_id uuid,p_call_key text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('claimed',false,'call',to_jsonb(c)-'result'-'usage',
  'result',r.result,'errorCode',r.error_code,'requestHash',r.request_hash,'completed',r.completed)
 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
 where r.session_id=p_session_id and r.call_key=p_call_key;
$$;

create function public.reserve_keyword_learning_call(p_session_id uuid,p_call_key text,p_source_ordinal integer,p_source_hash text,
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
 if global_total+p_maximum_usd>least(b.lifetime_limit_usd,10) or owner_total+p_maximum_usd>least(p.lifetime_limit_usd,10)
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

create function public.record_keyword_learning_call(p_session_id uuid,p_call_key text,p_call_id uuid,p_lease_token uuid,p_request_hash text,
 p_result jsonb default null,p_error_code text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.keyword_learning_sessions;r public.keyword_learning_requests;c public.reader_content_analysis_calls;
 actual numeric;observed numeric;usage_data jsonb;provider text;
begin
 if p_call_id is null or p_lease_token is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
  or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,79}$')
  or (p_result is null and p_error_code is null) or (p_result is not null and (jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>500000)) then
  raise exception 'Invalid private evaluation result' using errcode='PT400';end if;
 if p_result is not null then
  if (p_result ? 'actualUsd' and jsonb_typeof(p_result->'actualUsd') not in ('number','null'))
   or (p_result ? 'observedUsd' and jsonb_typeof(p_result->'observedUsd') not in ('number','null'))
   or (p_result ? 'usage' and jsonb_typeof(p_result->'usage')<>'object') then raise exception 'Invalid generation accounting' using errcode='PT400';end if;
  actual:=(p_result->>'actualUsd')::numeric;observed:=(p_result->>'observedUsd')::numeric;
  usage_data:=coalesce(p_result->'usage','{}'::jsonb);provider:=p_result->>'providerId';
  if octet_length(usage_data::text)>20000 or length(provider)>300 then raise exception 'Invalid generation metadata' using errcode='PT400';end if;
 end if;
 -- Settlement survives a closed/expired/deleted-source session. Stopping work
 -- must never prevent recording a genuine bill or release an unknown hold.
 select * into r from public.keyword_learning_requests where session_id=p_session_id and call_key=p_call_key;
 if r.call_id is distinct from p_call_id or r.request_hash is distinct from p_request_hash then raise exception 'Evaluation settlement binding changed' using errcode='PT409';end if;
 perform public.settle_content_analysis_call_v2(p_call_id,p_lease_token,actual,observed);
 select * into d from public.keyword_learning_sessions where id=p_session_id for update;
 select * into r from public.keyword_learning_requests where session_id=p_session_id and call_key=p_call_key for update;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if c.lease_token is distinct from p_lease_token then raise exception 'Evaluation settlement lease changed' using errcode='PT409';end if;
 if r.completed then
  if r.result is distinct from p_result or r.error_code is distinct from p_error_code then raise exception 'Evaluation result is immutable' using errcode='PT409';end if;
  return public.read_keyword_learning_call(p_session_id,p_call_key);
 end if;
 update public.reader_content_analysis_calls set usage=usage_data,provider_id=provider,result_at=clock_timestamp() where id=c.id;
 update public.keyword_learning_requests set result=case when d.user_id is null then null else p_result end,
  error_code=case when d.user_id is null then 'source_deleted' else p_error_code end,completed=true,completed_at=clock_timestamp()
  where session_id=p_session_id and call_key=p_call_key;
 return public.read_keyword_learning_call(p_session_id,p_call_key);
end;
$$;

create function public.erase_keyword_learning_source_evidence() returns trigger
-- Owner-authorized archive/workspace deletion must erase private eval caches
-- without granting readers direct table access. This trigger has no callable
-- arguments and no role is granted EXECUTE on the function itself.
language plpgsql security definer set search_path='' as $$
declare sid uuid;update_id text;
begin
 if tg_table_name='reader_source_updates' then update_id:=old.id;end if;
 -- Match settlement's session -> request row order, so deletion and a genuine
 -- in-flight bill cannot each hold the row the other is waiting to acquire.
 for sid in select d.id from public.keyword_learning_sessions d where d.user_id=old.user_id
  and (tg_table_name='reader_workspaces' or exists(select 1 from jsonb_array_elements(d.sources) s where s->>'updateId'=update_id)) order by d.id for update loop
  update public.keyword_learning_requests set request_payload=null,result=null,error_code='source_deleted' where session_id=sid;
  update public.keyword_learning_sessions set state='closed',user_id=null,sources='[]'::jsonb where id=sid;
 end loop;
 return old;
end;
$$;
create trigger keyword_learning_archive_erasure before delete on public.reader_source_updates for each row execute function public.erase_keyword_learning_source_evidence();
create trigger keyword_learning_workspace_erasure before delete on public.reader_workspaces for each row execute function public.erase_keyword_learning_source_evidence();

revoke all on function public.read_keyword_learning_call(uuid,text),public.reserve_keyword_learning_call(uuid,text,integer,text,text,jsonb,text,numeric,jsonb),
 public.record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text),public.erase_keyword_learning_source_evidence() from public,anon,authenticated,service_role;
grant execute on function public.read_keyword_learning_call(uuid,text),public.reserve_keyword_learning_call(uuid,text,integer,text,text,jsonb,text,numeric,jsonb),
 public.record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text) to service_role;
commit;
