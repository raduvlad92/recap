-- Source-free HTTP telemetry only; never settlement, retry or pricing authority.
-- No old financial/request table, function, row, receipt or baseline is altered.
begin;

create function recap_internal.valid_model_provider_diagnostic(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare at_time timestamptz;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false;end if;
 if (select count(*)from jsonb_object_keys(p))<>12 or not p?&array['schema','kind','route','httpStatus','requestMethod','requestUrl','responseUrl','providerRequestId','providerCode','receivedAt','costConclusion','retryAuthority'] then return false;end if;
 if p->'schema'<>'1'::jsonb or p->'kind'<>'"model-provider-http-diagnostic-v1"'::jsonb or p->'route'<>'"openrouter"'::jsonb
  or p->'costConclusion'<>'"unknown"'::jsonb or p->'retryAuthority'<>'false'::jsonb
  or jsonb_typeof(p->'httpStatus')<>'number' or (p->>'httpStatus')!~'^[45][0-9]{2}$'
  or not(p->'requestMethod'='null'::jsonb or p->'requestMethod'='"POST"'::jsonb)
  or not(p->'requestUrl'='null'::jsonb or p->'requestUrl'='"https://openrouter.ai/api/v1/chat/completions"'::jsonb)
  or not(p->'responseUrl'='null'::jsonb or p->'responseUrl'='"https://openrouter.ai/api/v1/chat/completions"'::jsonb)
  or not(p->'providerCode'='null'::jsonb or jsonb_typeof(p->'providerCode')='number' and p->>'providerCode'=any(array['400','401','402','403','404','408','409','413','422','429','500','502','503','504','529']))
  or not(p->'providerRequestId'='null'::jsonb or jsonb_typeof(p->'providerRequestId')='string' and length(p->>'providerRequestId')<=100
   and p->>'providerRequestId'~'^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{32}|req_[A-Za-z0-9]{8,64}|gen-[0-9]{10,16}-[A-Za-z0-9]{8,64})$')
  or jsonb_typeof(p->'receivedAt')<>'string' or p->>'receivedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then return false;end if;
 begin at_time:=(p->>'receivedAt')::timestamptz;exception when others then return false;end;
 return isfinite(at_time)and to_char(at_time at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=p->>'receivedAt';
end;
$$;

create table recap_internal.model_provider_diagnostics (
 call_id uuid not null references public.reader_content_analysis_calls(id)on delete cascade,
 attempt_number integer not null check(attempt_number between 1 and 3),
 session_id uuid not null references public.keyword_learning_sessions(id)on delete cascade,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 error_code text not null check(error_code~'^analysis_provider_(http_[45][0-9]{2}|timeout)$'),
 diagnostic jsonb not null check(recap_internal.valid_model_provider_diagnostic(diagnostic)),
 created_at timestamptz not null default clock_timestamp(),
 primary key(call_id,attempt_number),
 check(error_code='analysis_provider_timeout'or error_code='analysis_provider_http_'||(diagnostic->>'httpStatus'))
);
create index model_provider_diagnostics_session_idx on recap_internal.model_provider_diagnostics(session_id,call_id);
alter table recap_internal.model_provider_diagnostics enable row level security;
revoke all on recap_internal.model_provider_diagnostics from public,anon,authenticated,service_role;
grant select,insert on recap_internal.model_provider_diagnostics to service_role;

create function recap_internal.fence_model_provider_diagnostic()returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;r public.keyword_learning_requests;
begin
 if tg_op='DELETE' then
  -- Permit only FK cascade cleanup if its parent really disappeared. Normal
  -- archive/account erasure retains the ledger and this source-free evidence.
  if pg_trigger_depth()>1 and(not exists(select 1 from public.reader_content_analysis_calls where id=old.call_id)
   or not exists(select 1 from public.keyword_learning_sessions where id=old.session_id))then return old;end if;
  raise exception'Diagnostic is append-only'using errcode='PT409';
 end if;
 if tg_op='UPDATE' then raise exception'Diagnostic is immutable'using errcode='PT409';end if;
 select*into c from public.reader_content_analysis_calls where id=new.call_id;
 select*into r from public.keyword_learning_requests where session_id=new.session_id and call_id=new.call_id;
 if c.id is null or r.call_id is null or r.request_hash is distinct from new.request_hash or c.request_hash is distinct from new.request_hash
  or c.attempt_number is distinct from new.attempt_number or c.execution_identity->>'route' is distinct from'openrouter'
  or c.execution_identity->>'baseURL' is distinct from'https://openrouter.ai/api/v1'
  or r.completed is not true or r.result is not null or r.error_code is distinct from new.error_code and r.error_code is distinct from'source_deleted'
  or c.state<>'unknown'or c.actual_usd is not null or c.retry_authorized then raise exception'Diagnostic call binding changed'using errcode='PT409';end if;
 if (new.diagnostic->>'receivedAt')::timestamptz<c.attempt_reserved_at-interval'5 seconds'
  or (new.diagnostic->>'receivedAt')::timestamptz>clock_timestamp()+interval'5 seconds' then raise exception'Diagnostic time changed'using errcode='PT409';end if;
 return new;
end;
$$;
create trigger model_provider_diagnostic_fence before insert or update or delete on recap_internal.model_provider_diagnostics
for each row execute function recap_internal.fence_model_provider_diagnostic();

create function public.record_keyword_learning_failure_with_diagnostic(
 p_session_id uuid,p_call_key text,p_call_id uuid,p_lease_token uuid,p_request_hash text,
 p_attempt_number integer,p_error_code text,p_diagnostic jsonb)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;r public.keyword_learning_requests;d public.keyword_learning_sessions;
 prior recap_internal.model_provider_diagnostics;saved jsonb;
begin
 if p_session_id is null or p_call_id is null or p_lease_token is null or p_request_hash is null or p_request_hash!~'^[a-f0-9]{64}$'
  or p_call_key is null or p_call_key!~'^keyword-learning:v1:[A-Za-z0-9._:-]{1,120}$'
  or p_attempt_number is null or p_attempt_number not between 1 and 3 or not recap_internal.valid_model_provider_diagnostic(p_diagnostic)
  or p_error_code is null or p_error_code not in('analysis_provider_timeout','analysis_provider_http_'||(p_diagnostic->>'httpStatus'))then
  raise exception'Invalid provider diagnostic'using errcode='PT400';end if;
 select*into c from public.reader_content_analysis_calls where id=p_call_id;
 if c.id is null then raise exception'Diagnostic call unavailable'using errcode='PT409';end if;
 -- Match financial lock order before session/request/call locks. The existing
 -- error recorder reacquires these same locks, in this one transaction.
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=c.user_id for update;
 select*into d from public.keyword_learning_sessions where id=p_session_id for update;
 select*into r from public.keyword_learning_requests where session_id=p_session_id and call_key=p_call_key for update;
 select*into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if d.id is null or r.call_id is distinct from p_call_id or r.request_hash is distinct from p_request_hash or c.request_hash is distinct from p_request_hash
  or c.lease_token is distinct from p_lease_token or c.attempt_number is distinct from p_attempt_number
  or d.user_id is not null and d.user_id is distinct from c.user_id or r.source_hash is distinct from c.source_revision
  or c.execution_identity->>'route' is distinct from'openrouter'or c.execution_identity->>'baseURL' is distinct from'https://openrouter.ai/api/v1' then
  raise exception'Diagnostic request binding changed'using errcode='PT409';end if;
 select*into prior from recap_internal.model_provider_diagnostics where call_id=p_call_id and attempt_number=p_attempt_number;
 if found then
  if prior.session_id is distinct from p_session_id or prior.request_hash is distinct from p_request_hash or prior.error_code is distinct from p_error_code
   or prior.diagnostic is distinct from p_diagnostic then raise exception'Diagnostic is immutable'using errcode='PT409';end if;
  return public.read_keyword_learning_call(p_session_id,p_call_key);
 end if;
 -- Never backfill a completed old failure or overwrite a genuine result/bill.
 if r.completed or c.actual_usd is not null or c.state not in('reserved','unknown')or c.retry_authorized then
  raise exception'Completed call has no new diagnostic admission'using errcode='PT409';end if;
 if (p_diagnostic->>'receivedAt')::timestamptz<c.attempt_reserved_at-interval'5 seconds'
  or (p_diagnostic->>'receivedAt')::timestamptz>clock_timestamp()+interval'5 seconds' then raise exception'Diagnostic time changed'using errcode='PT409';end if;
 saved:=public.record_keyword_learning_call(p_session_id,p_call_key,p_call_id,p_lease_token,p_request_hash,null,p_error_code);
 insert into recap_internal.model_provider_diagnostics(call_id,attempt_number,session_id,request_hash,error_code,diagnostic)
 values(p_call_id,p_attempt_number,p_session_id,p_request_hash,p_error_code,p_diagnostic);
 return saved;
end;
$$;
revoke all on function recap_internal.valid_model_provider_diagnostic(jsonb),recap_internal.fence_model_provider_diagnostic(),
 public.record_keyword_learning_failure_with_diagnostic(uuid,text,uuid,uuid,text,integer,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function recap_internal.valid_model_provider_diagnostic(jsonb),recap_internal.fence_model_provider_diagnostic(),
 public.record_keyword_learning_failure_with_diagnostic(uuid,text,uuid,uuid,text,integer,text,jsonb)to service_role;
comment on table recap_internal.model_provider_diagnostics is 'Append-only source-free HTTP telemetry. No cost/zero-charge/retry authority; existing financial/request rows and historical failures are never backfilled.';
commit;
