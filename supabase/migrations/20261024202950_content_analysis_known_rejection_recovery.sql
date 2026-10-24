-- D36 durable status, shared circuit and separately verified cost recovery.
-- HTTP429 is status telemetry only and NEVER frees a hold. Only a separately
-- authenticated provider generation receipt can settle cost/permit a retry.
-- No historical receipts, policies, runtime switches or provider calls.
begin;

alter table public.reader_content_analysis_calls
 add column request_hash text check(request_hash ~ '^[a-f0-9]{64}$'),
 add column attempt_number integer not null default 1 check(attempt_number between 1 and 3),
 add column attempt_reserved_at timestamptz not null default clock_timestamp(),
 add column rejection_receipt jsonb,
 add column generation_receipt jsonb,
 add column retry_authorization_receipt jsonb,
 add column retry_authorized boolean not null default false,
 add column retry_not_before timestamptz;

-- Existing rows retain their actual original attempt time, not migration time.
update public.reader_content_analysis_calls set attempt_reserved_at=created_at;

-- Previous attempts are source-free, provider-verified-zero snapshots. The current attempt
-- remains in the original unique(job_id,call_key) ledger row. No alternate key.
create table public.reader_content_analysis_call_attempts (
 call_id uuid not null references public.reader_content_analysis_calls(id) on delete cascade,
 attempt_number integer not null check(attempt_number between 1 and 2),
 lease_token uuid not null, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 execution_identity jsonb not null, model text not null,
 maximum_usd numeric(24,12) not null, actual_usd numeric(24,12) not null check(actual_usd=0),
 observed_usd numeric(24,12) not null check(observed_usd=0),
 reserved_at timestamptz not null, settled_at timestamptz not null,
 rejection_receipt jsonb not null, generation_receipt jsonb not null, retry_authorization_receipt jsonb not null, retry_authorized boolean not null check(retry_authorized), retry_not_before timestamptz not null,
 primary key(call_id,attempt_number)
);
create table public.content_analysis_provider_cooldowns (
 identity_key text primary key check(identity_key ~ '^[a-f0-9]{64}$'),
 rejection_count integer not null check(rejection_count between 1 and 1000000),
 cooldown_until timestamptz not null, updated_at timestamptz not null
);
-- Exact circuit refusal bound to the lease. This permits safe queue yielding
-- even when earlier chunks already succeeded in the same job/lease.
create table public.content_analysis_provider_pauses (
 job_id uuid not null references public.reader_content_analysis_jobs(id) on delete cascade,
 lease_token uuid not null, identity_key text not null,
 retry_at timestamptz not null, primary key(job_id,lease_token)
);
alter table public.content_analysis_provider_pauses enable row level security;
revoke all on public.content_analysis_provider_pauses from public,anon,authenticated,service_role;
grant select,insert,update on public.content_analysis_provider_pauses to service_role;
alter table public.reader_content_analysis_call_attempts enable row level security;
alter table public.content_analysis_provider_cooldowns enable row level security;
revoke all on public.reader_content_analysis_call_attempts,public.content_analysis_provider_cooldowns from public,anon,authenticated,service_role;
grant select,insert on public.reader_content_analysis_call_attempts to service_role;
grant select,insert,update on public.content_analysis_provider_cooldowns to service_role;

create function public.content_analysis_provider_key(p_identity jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(p_identity->>'route',p_identity->>'baseURL',p_identity->>'model',p_identity->>'provider')::text,'UTF8')),'hex');
$$;
create function public.preserve_content_analysis_request() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.request_hash is distinct from old.request_hash
  or new.call_key is distinct from old.call_key or new.user_id is distinct from old.user_id then
  raise exception 'Analysis request identity is immutable' using errcode='PT409'; end if;
 if new.attempt_number is distinct from old.attempt_number then
  if new.attempt_number<>old.attempt_number+1 or old.attempt_number>=3
   or not old.retry_authorized or old.retry_authorization_receipt is null or old.rejection_receipt is null or old.generation_receipt is null or old.actual_usd is distinct from 0::numeric
   or old.observed_usd is distinct from 0::numeric or old.result is not null
   or not exists(select 1 from public.reader_content_analysis_call_attempts h
    where h.call_id=old.id and h.attempt_number=old.attempt_number
     and h.lease_token=old.lease_token and h.rejection_receipt=old.rejection_receipt)
   or new.lease_token=old.lease_token or new.actual_usd is not null
   or new.state<>'reserved' or new.rejection_receipt is not null or new.generation_receipt is not null or new.retry_authorization_receipt is not null or new.retry_authorized then
   raise exception 'Invalid analysis retry transition' using errcode='PT409'; end if;
 elsif (old.retry_authorized and not new.retry_authorized and coalesce(new.actual_usd,0)<=0 and coalesce(new.observed_usd,0)<=0)
  or (new.retry_authorized and (new.actual_usd is distinct from 0::numeric or new.observed_usd is distinct from 0::numeric
   or new.generation_receipt is null or new.retry_authorization_receipt is null or new.rejection_receipt is null or new.request_hash is null))
  or new.lease_token is distinct from old.lease_token
  or new.attempt_reserved_at is distinct from old.attempt_reserved_at
  or (old.rejection_receipt is not null and new.rejection_receipt is distinct from old.rejection_receipt)
  or (old.generation_receipt is not null and new.generation_receipt is distinct from old.generation_receipt)
  or (old.retry_authorization_receipt is not null and new.retry_authorization_receipt is distinct from old.retry_authorization_receipt)
  or (old.retry_not_before is not null and new.retry_not_before is distinct from old.retry_not_before) then
  raise exception 'Analysis attempt identity is immutable' using errcode='PT409'; end if;
 return new;
end;
$$;
create trigger preserve_content_analysis_request before update on public.reader_content_analysis_calls
 for each row execute function public.preserve_content_analysis_request();

create function public.reserve_content_analysis_call_v3(p_job_id uuid,p_lease_token uuid,p_call_key text,p_maximum_usd numeric,p_model text,p_execution_identity jsonb,p_request_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; b public.content_analysis_budget; p public.reader_content_analysis_policies;
 c public.reader_content_analysis_calls; existing boolean; due timestamptz; utc_day timestamptz;
 daily numeric; lifetime numeric; global_daily numeric; global_lifetime numeric;
begin
 perform public.validate_content_analysis_execution_identity(p_execution_identity,p_model);
 if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_lease_token is null
  or p_call_key is null or length(p_call_key) not between 1 and 160
  or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>1
  or p_maximum_usd::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Invalid call reservation' using errcode='PT400'; end if;
 p_maximum_usd:=ceil(p_maximum_usd*1000000000000)/1000000000000;
 -- Every attempt repeats the complete workspace/archive/job/policy/model fences.
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state<>'running' then raise exception 'Job not running' using errcode='PT409'; end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into p from public.reader_content_analysis_policies where user_id=j.user_id for update;
 if not coalesce(b.enabled and p.enabled,false) or p_model is distinct from p.model or p_maximum_usd>p.per_call_limit_usd then
  raise exception 'Analysis runtime or model disabled' using errcode='PT403'; end if;
 select * into c from public.reader_content_analysis_calls where job_id=j.id and call_key=p_call_key for update;
 existing:=found;
 -- The lease can expire naturally while budget/policy/call locks are awaited.
 -- Row locks prevent replacement, not time passing. Recheck before permission.
 if j.lease_until is null or j.lease_until<=clock_timestamp() then
  raise exception 'Analysis lease expired while reserving' using errcode='PT409'; end if;
 if existing then
  if c.execution_identity=p_execution_identity and c.request_hash=p_request_hash
   and c.attempt_number>=3 and c.generation_receipt is not null and c.actual_usd=0 then
   return jsonb_build_object('claimed',false,'call',to_jsonb(c),'reason','analysis_provider_retry_exhausted'); end if;
  -- Legacy/changed/unknown/successful calls remain exact original rows. A worker
  -- validates identity/hash before using any cache; none is permission to call.
  if c.execution_identity is distinct from p_execution_identity or c.request_hash is distinct from p_request_hash
   or c.model is distinct from p_model or c.source_revision is distinct from j.source_revision
   or not c.retry_authorized or c.rejection_receipt is null or c.generation_receipt is null or c.actual_usd is distinct from 0::numeric
   or c.observed_usd is distinct from 0::numeric or c.result is not null then
   return jsonb_build_object('claimed',false,'call',to_jsonb(c)); end if;
  if p_maximum_usd is distinct from c.maximum_usd then raise exception 'Analysis reservation ceiling changed' using errcode='PT409'; end if;
  if c.attempt_number>=3 then
   return jsonb_build_object('claimed',false,'call',to_jsonb(c),'reason','analysis_provider_retry_exhausted'); end if;
 end if;
 -- Budget lock serializes circuit receipts and reservations across ALL owners.
 select cooldown_until into due from public.content_analysis_provider_cooldowns
  where identity_key=public.content_analysis_provider_key(p_execution_identity);
 if existing then due:=greatest(due,c.retry_not_before); end if;
 if due>clock_timestamp() then
  insert into public.content_analysis_provider_pauses(job_id,lease_token,identity_key,retry_at)
   values(j.id,p_lease_token,public.content_analysis_provider_key(p_execution_identity),due)
   on conflict(job_id,lease_token) do update set identity_key=excluded.identity_key,retry_at=greatest(content_analysis_provider_pauses.retry_at,excluded.retry_at);
  return jsonb_build_object('claimed',false,'reason','analysis_provider_cooldown','retryAt',due)
   ||case when existing then jsonb_build_object('call',to_jsonb(c)) else '{}'::jsonb end; end if;
 if existing and c.lease_token=p_lease_token then
  -- Receipt must be followed by durable fail/claim; a worker never spins in-lease.
  return jsonb_build_object('claimed',false,'call',to_jsonb(c),'reason','analysis_provider_rate_limited','retryAt',c.retry_not_before); end if;
 utc_day:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into global_lifetime,global_daily from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into lifetime,daily from public.reader_content_analysis_calls where user_id=j.user_id;
 if global_lifetime+p_maximum_usd>b.lifetime_limit_usd or lifetime+p_maximum_usd>p.lifetime_limit_usd then
  raise exception 'Lifetime analysis budget exhausted' using errcode='PT402'; end if;
 if global_daily+p_maximum_usd>b.daily_limit_usd or daily+p_maximum_usd>p.daily_limit_usd then
  raise exception 'Daily analysis budget exhausted' using errcode='PT429'; end if;
 if existing then
  insert into public.reader_content_analysis_call_attempts(call_id,attempt_number,lease_token,request_hash,execution_identity,model,maximum_usd,actual_usd,observed_usd,reserved_at,settled_at,rejection_receipt,generation_receipt,retry_authorization_receipt,retry_authorized,retry_not_before)
   values(c.id,c.attempt_number,c.lease_token,c.request_hash,c.execution_identity,c.model,c.maximum_usd,c.actual_usd,c.observed_usd,c.attempt_reserved_at,c.settled_at,c.rejection_receipt,c.generation_receipt,c.retry_authorization_receipt,c.retry_authorized,c.retry_not_before);
  update public.reader_content_analysis_calls set attempt_number=attempt_number+1,lease_token=p_lease_token,
   maximum_usd=p_maximum_usd,actual_usd=null,observed_usd=null,state='reserved',usage=null,provider_id=null,
   result_at=null,settled_at=null,rejection_receipt=null,generation_receipt=null,retry_authorization_receipt=null,retry_authorized=false,retry_not_before=null,attempt_reserved_at=clock_timestamp(),
   created_at=clock_timestamp() where id=c.id returning * into c;
 else
  insert into public.reader_content_analysis_calls(job_id,user_id,source_revision,call_key,lease_token,model,maximum_usd,execution_identity,request_hash)
   values(j.id,j.user_id,j.source_revision,p_call_key,p_lease_token,p_model,p_maximum_usd,p_execution_identity,p_request_hash) returning * into c;
 end if;
 return jsonb_build_object('claimed',true,'call',to_jsonb(c));
end;
$$;

create function public.record_content_analysis_known_rejection(p_call_id uuid,p_lease_token uuid,p_request_hash text,p_execution_identity jsonb,p_http_status integer,p_retry_after_seconds integer,p_provider_request_id text,p_received_at timestamptz,p_pre_generation boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls; locked jsonb; proof jsonb; circuit public.content_analysis_provider_cooldowns;
 due timestamptz; delay integer; key text; count_rejections integer;
begin
 if p_http_status is distinct from 429 or p_pre_generation is null
  or p_lease_token is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
  or (p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 3600)
  or (p_provider_request_id is not null and p_provider_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$')
  or p_received_at is null or not isfinite(p_received_at) or p_received_at>clock_timestamp()+interval '5 seconds' then
  raise exception 'Invalid known pre-generation rejection' using errcode='PT400'; end if;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if not found then raise exception 'Call unavailable' using errcode='PT409'; end if;
 perform public.validate_content_analysis_execution_identity(p_execution_identity,c.model);
 if p_execution_identity->>'route'<>'openrouter' or c.execution_identity is distinct from p_execution_identity
  or c.request_hash is distinct from p_request_hash or c.lease_token is distinct from p_lease_token
  or p_received_at<c.attempt_reserved_at or c.job_id is null then
  raise exception 'Rejection request identity changed' using errcode='PT409'; end if;
 proof:=jsonb_build_object('httpStatus',429,'preGeneration',p_pre_generation,'requestHash',p_request_hash,
  'retryAfterSeconds',p_retry_after_seconds,'providerRequestId',p_provider_request_id,'receivedAt',p_received_at);
 -- Duplicate receipt is idempotent even after fail cleared the job lease. It
 -- cannot extend cooldown, increase a counter or touch another attempt.
 if c.rejection_receipt is not null then
  if c.rejection_receipt is distinct from proof then raise exception 'Rejection receipt is immutable' using errcode='PT409'; end if;
  return jsonb_build_object('call',to_jsonb(c),'retryAt',c.retry_not_before,'terminal',true,'retryEligible',false,'receipt',proof); end if;
 locked:=public.lock_content_analysis_job(c.job_id,p_lease_token);
 if locked#>>'{job,state}'<>'running' then raise exception 'Job not running' using errcode='PT409'; end if;
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=c.user_id for update;
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if (locked#>>'{job,lease_until}') is null or (locked#>>'{job,lease_until}')::timestamptz<=clock_timestamp() then
  raise exception 'Analysis lease expired while recording status' using errcode='PT409'; end if;
 if c.lease_token is distinct from p_lease_token or c.request_hash is distinct from p_request_hash
  or c.execution_identity is distinct from p_execution_identity or c.job_id is null then
  raise exception 'Rejection attempt changed' using errcode='PT409'; end if;
 if c.rejection_receipt is not null then
  if c.rejection_receipt is distinct from proof then raise exception 'Rejection receipt is immutable' using errcode='PT409'; end if;
  return jsonb_build_object('call',to_jsonb(c),'retryAt',c.retry_not_before,'terminal',true,'retryEligible',false,'receipt',proof); end if;
 if c.state not in ('reserved','unknown') or c.actual_usd is not null or coalesce(c.observed_usd,0)>0
  or c.result is not null or c.usage is not null or c.provider_id is not null then
  raise exception 'Call is not an untouched pre-generation reservation' using errcode='PT409'; end if;
 key:=public.content_analysis_provider_key(p_execution_identity);
 select * into circuit from public.content_analysis_provider_cooldowns where identity_key=key;
 count_rejections:=least(coalesce(circuit.rejection_count,0)+1,1000000);
 delay:=greatest(coalesce(p_retry_after_seconds,0),least(3600,60*(2^least(6,greatest(c.attempt_number-1,count_rejections-1)))::integer));
 due:=greatest(clock_timestamp()+make_interval(secs=>delay),circuit.cooldown_until);
 insert into public.content_analysis_provider_cooldowns(identity_key,rejection_count,cooldown_until,updated_at)
  values(key,count_rejections,due,clock_timestamp()) on conflict(identity_key) do update
  set rejection_count=excluded.rejection_count,cooldown_until=excluded.cooldown_until,updated_at=excluded.updated_at;
 update public.reader_content_analysis_calls set rejection_receipt=proof,retry_not_before=due,
  state='unknown' where id=c.id returning * into c;
 return jsonb_build_object('call',to_jsonb(c),'retryAt',due,'terminal',true,'retryEligible',false,'receipt',proof);
end;
$$;

-- Untokened old settlement cannot target a retried row. Result writes use the
-- guarded variant under financial locks, including a lease recheck AFTER waits.
create function public.settle_content_analysis_call_v2(p_call_id uuid,p_lease_token uuid,p_actual_usd numeric default null,p_observed_usd numeric default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;
begin
 if (p_actual_usd is not null and (p_actual_usd<0 or p_actual_usd::text in ('NaN','Infinity','-Infinity')))
  or (p_observed_usd is not null and (p_observed_usd<0 or p_observed_usd::text in ('NaN','Infinity','-Infinity'))) then
  raise exception 'Invalid charge' using errcode='PT400'; end if;
 if p_actual_usd is not null then p_actual_usd:=ceil(p_actual_usd*1000000000000)/1000000000000; end if;
 if p_observed_usd is not null then p_observed_usd:=ceil(p_observed_usd*1000000000000)/1000000000000; end if;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if not found then raise exception 'Call unavailable' using errcode='PT409'; end if;
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=c.user_id for update;
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if not found or (p_lease_token is null and c.attempt_number>1)
  or (p_lease_token is not null and c.lease_token is distinct from p_lease_token) then
  raise exception 'Settlement attempt changed' using errcode='PT409'; end if;
 if c.generation_receipt is not null then
  -- Provider lookup proof stays immutable, but later positive current-attempt
  -- billing evidence must retain the established monotone financial high-water.
  if coalesce(p_actual_usd,0)<=coalesce(c.actual_usd,0)
   and coalesce(p_observed_usd,0)<=greatest(coalesce(c.actual_usd,0),coalesce(c.observed_usd,0)) then
   return to_jsonb(c); end if;
  update public.reader_content_analysis_calls set
   observed_usd=greatest(coalesce(observed_usd,0),coalesce(p_actual_usd,0),coalesce(p_observed_usd,0)),
   actual_usd=greatest(coalesce(actual_usd,0),coalesce(observed_usd,0),coalesce(p_actual_usd,0),coalesce(p_observed_usd,0)),
   retry_authorized=false,state='settled',settled_at=clock_timestamp() where id=c.id returning * into c;
  return to_jsonb(c); end if;
 if c.rejection_receipt is not null then
  if p_actual_usd=0 then raise exception 'HTTP429 is not zero charge evidence' using errcode='PT409'; end if;
  -- Even a tiny claimed positive charge cannot replace an unverified 429 hold.
  -- Record observations conservatively; only authenticated generation lookup
  -- is allowed to resolve its actual charge and release the maximum reserve.
  update public.reader_content_analysis_calls set
   observed_usd=case when coalesce(observed_usd,p_actual_usd,p_observed_usd) is null then null
    else greatest(coalesce(observed_usd,0),coalesce(p_actual_usd,0),coalesce(p_observed_usd,0)) end,
   state='unknown' where id=c.id returning * into c;
  return to_jsonb(c); end if;
 update public.reader_content_analysis_calls set
  observed_usd=case when coalesce(observed_usd,p_observed_usd,p_actual_usd) is null then null else greatest(coalesce(observed_usd,0),coalesce(p_observed_usd,0),coalesce(p_actual_usd,0)) end,
  actual_usd=case when actual_usd is null and p_actual_usd is null then null else greatest(coalesce(actual_usd,0),coalesce(p_actual_usd,0),coalesce(observed_usd,0),coalesce(p_observed_usd,0)) end,
  state=case when actual_usd is not null or p_actual_usd is not null then 'settled' else 'unknown' end,
  settled_at=case when actual_usd is not null or p_actual_usd is not null then clock_timestamp() else null end
  where id=c.id returning * into c;
 return to_jsonb(c);
end;
$$;
create or replace function public.settle_content_analysis_call(p_call_id uuid,p_actual_usd numeric default null,p_observed_usd numeric default null) returns jsonb
language sql security invoker set search_path='' as $$
 select public.settle_content_analysis_call_v2(p_call_id,null,p_actual_usd,p_observed_usd);
$$;
create or replace function public.record_content_analysis_call_result(p_call_id uuid,p_lease_token uuid,p_result jsonb,p_usage jsonb,p_provider_id text default null,p_actual_usd numeric default null,p_observed_usd numeric default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;
begin
 if p_lease_token is null or p_result is null or p_result='null'::jsonb or octet_length(p_result::text)>500000
  or jsonb_typeof(p_usage) is distinct from 'object' or octet_length(p_usage::text)>20000
  or length(p_provider_id)>300 then raise exception 'Invalid call result' using errcode='PT400'; end if;
 -- Guarded settlement locks budget -> policy -> call and rechecks the lease.
 perform public.settle_content_analysis_call_v2(p_call_id,p_lease_token,p_actual_usd,p_observed_usd);
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if c.rejection_receipt is not null then raise exception 'Rejected attempt has no generated result' using errcode='PT409'; end if;
 if c.job_id is null then return to_jsonb(c); end if;
 if c.result is not null then
  if c.result is distinct from p_result or c.usage is distinct from p_usage or c.provider_id is distinct from p_provider_id then
   raise exception 'Call result is immutable' using errcode='PT409'; end if;
  return to_jsonb(c); end if;
 update public.reader_content_analysis_calls set result=p_result,usage=p_usage,provider_id=p_provider_id,result_at=clock_timestamp()
  where id=c.id and result is null and lease_token=p_lease_token returning * into c;
 return to_jsonb(c);
end;
$$;

create or replace function public.fail_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false,p_yield boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; state_name text; rec jsonb; proc jsonb;
 due timestamptz; known public.reader_content_analysis_calls; controlled boolean:=false;
begin
 if p_lease_token is null or p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$'
  or p_retryable is null or p_yield is null then raise exception 'Invalid failure' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state not in ('running','prepared') then raise exception 'Job not active' using errcode='PT409'; end if;
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
  state_name:=case when p_error_code='analysis_provider_http_429' then 'blocked' when p_yield then 'queued'
   when p_error_code in ('analysis_provider_http_429','analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_cached_input_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
   else 'failed' end;
 end if;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_error_code='analysis_provider_http_429' then 'infinity'::timestamptz when due is not null then case when state_name='queued' then due else 'infinity'::timestamptz end
   when p_yield then clock_timestamp()+interval '1 second'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  -- Queue claim attempts are separate from monetary attempts on a stable key.
  -- Known429 attempt limits live in calls; unrelated claim/yield pauses cannot
  -- prematurely exhaust a safe, due monetary retry.
  attempts=case when due is not null and state_name='queued' then greatest(0,attempts-1)
   else greatest(0,attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end) end,
  updated_at=clock_timestamp() where id=j.id;
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash)||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield or controlled then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name,'retryAt',case when state_name='queued' then due else null end);
end;
$$;

-- Only trusted server code which has just authenticated to the fixed OpenRouter
-- generation endpoint may call this RPC. SQL cannot attest an outbound HTTP GET;
-- this private service boundary is NOT an operator/client assertion endpoint.
-- Missing-ID binding requires an explicitly reviewed request-to-generation
-- artifact hash, never an inferred same-second match. Legacy rows may settle
-- but cannot acquire the missing pre-call request hash or replay permission.
create function public.record_content_analysis_generation_receipt(p_call_id uuid,p_lease_token uuid,p_request_hash text,p_execution_identity jsonb,p_receipt jsonb,p_allow_retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls; j public.reader_content_analysis_jobs; w public.reader_workspaces; a public.reader_source_updates;
 total numeric; native_count numeric; k text; generation_at timestamptz; checked_at timestamptz; due timestamptz;
 receipt_zero boolean; eligible boolean:=false; expected_id text; proc jsonb;
begin
 if p_lease_token is null or p_allow_retry is null or jsonb_typeof(p_receipt) is distinct from 'object'
  or octet_length(p_receipt::text)>4096
  or not (p_receipt ?& array['verification','generationId','model','providerSlug','providerName','generationCreatedAt','checkedAt','totalCost','isByok','promptTokens','completionTokens','reasoningTokens','evidenceSha256','bindingEvidenceSha256'])
  or (p_receipt-array['verification','generationId','model','providerSlug','providerName','generationCreatedAt','checkedAt','totalCost','isByok','promptTokens','completionTokens','reasoningTokens','evidenceSha256','bindingEvidenceSha256'])<>'{}'::jsonb
  or p_receipt->>'verification' is distinct from 'authenticated_generation_get'
  or coalesce(p_receipt->>'generationId','') !~ '^gen-[A-Za-z0-9-]{1,200}$'
  or jsonb_typeof(p_receipt->'providerName') is distinct from 'string'
  or coalesce(p_receipt->>'providerName','') !~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,149}$'
  or coalesce(p_receipt->>'evidenceSha256','') !~ '^[a-f0-9]{64}$'
  or (p_receipt->'bindingEvidenceSha256'<>'null'::jsonb and coalesce(p_receipt->>'bindingEvidenceSha256','') !~ '^[a-f0-9]{64}$')
  or jsonb_typeof(p_receipt->'totalCost') is distinct from 'number'
  or p_receipt->'isByok' is distinct from 'false'::jsonb then
  raise exception 'Authenticated generation receipt required' using errcode='PT400'; end if;
 foreach k in array array['verification','generationId','model','providerSlug','providerName','generationCreatedAt','checkedAt','evidenceSha256'] loop
  if jsonb_typeof(p_receipt->k) is distinct from 'string' then raise exception 'Invalid generation receipt field' using errcode='PT400'; end if;
 end loop;
 if p_receipt->'bindingEvidenceSha256'<>'null'::jsonb and jsonb_typeof(p_receipt->'bindingEvidenceSha256') is distinct from 'string' then
  raise exception 'Invalid generation binding evidence' using errcode='PT400'; end if;
 total:=(p_receipt->>'totalCost')::numeric;
 if total<0 or total>'999999999999'::numeric then raise exception 'Invalid generation cost' using errcode='PT400'; end if;
 foreach k in array array['promptTokens','completionTokens','reasoningTokens'] loop
  if k='reasoningTokens' and p_receipt->k='null'::jsonb then continue; end if;
  if jsonb_typeof(p_receipt->k) is distinct from 'number' then raise exception 'Invalid generation token count' using errcode='PT400'; end if;
  native_count:=(p_receipt->>k)::numeric;
  if native_count<0 or native_count>9007199254740991 or trunc(native_count)<>native_count then
   raise exception 'Invalid generation token count' using errcode='PT400'; end if;
 end loop;
 begin generation_at:=(p_receipt->>'generationCreatedAt')::timestamptz; checked_at:=(p_receipt->>'checkedAt')::timestamptz;
 exception when others then raise exception 'Invalid generation timestamps' using errcode='PT400'; end;
 if generation_at is null or checked_at is null or not isfinite(generation_at) or not isfinite(checked_at)
  or checked_at<generation_at or checked_at>clock_timestamp()+interval '5 seconds'
  or checked_at<clock_timestamp()-interval '5 minutes' then
  raise exception 'Invalid generation timestamps' using errcode='PT400'; end if;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if not found then raise exception 'Call unavailable' using errcode='PT409'; end if;
 perform public.validate_content_analysis_execution_identity(p_execution_identity,c.model);
 -- Retry scheduling takes workspace -> archive -> job BEFORE financial locks.
 -- Ledger-only reconciliation (allow_retry=false) works after deletion and
 -- never takes a job lock or restores erased source evidence.
 if p_allow_retry and c.job_id is not null then
  select * into j from public.reader_content_analysis_jobs where id=c.job_id;
  select * into w from public.reader_workspaces where user_id=j.user_id for share;
  select * into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id for update;
  select * into j from public.reader_content_analysis_jobs where id=c.job_id for update;
  if j.id is not null and w.user_id is not null and a.id is not null
   and j.state in ('blocked','failed','queued') and (j.lease_until is null or j.lease_until<=clock_timestamp())
   and j.error_code in ('analysis_provider_http_429','analysis_unknown_charge_hold','analysis_provider_rate_limited')
   and coalesce(public.content_analysis_eligible(w.state,a.record),false)
   and j.source_id=a.source_id and c.source_revision=j.source_revision
   and j.source_revision=public.content_analysis_source_revision(a.record)
   and j.content_hash=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
   and j.source_fingerprint=public.content_analysis_source_fingerprint(w.state,a.source_id) then eligible:=true; end if;
 end if;
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=c.user_id for update;
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if c.lease_token is distinct from p_lease_token or c.request_hash is distinct from p_request_hash
  or c.execution_identity is distinct from p_execution_identity or p_execution_identity->>'route'<>'openrouter'
  or p_receipt->>'model' is distinct from c.model or p_receipt->>'providerSlug' is distinct from p_execution_identity->>'provider'
  or generation_at<c.attempt_reserved_at-interval '1 second' or generation_at>c.attempt_reserved_at+interval '60 seconds'
  or checked_at<c.attempt_reserved_at then
  raise exception 'Generation receipt identity changed' using errcode='PT409'; end if;
 expected_id:=coalesce(c.provider_id,case when c.rejection_receipt->>'providerRequestId' ~ '^gen-' then c.rejection_receipt->>'providerRequestId' end);
 if (expected_id is not null and expected_id is distinct from p_receipt->>'generationId')
  or (expected_id is null and p_receipt->'bindingEvidenceSha256'='null'::jsonb) then
  raise exception 'Reviewed request to generation binding required' using errcode='PT409'; end if;
 if c.generation_receipt is not null and
  (c.generation_receipt-array['checkedAt','evidenceSha256']) is distinct from (p_receipt-array['checkedAt','evidenceSha256']) then
  raise exception 'Verified generation receipt is immutable' using errcode='PT409'; end if;
 -- A conflicting positive high-water observation always wins over a zero.
 total:=greatest(ceil(total*1000000000000)/1000000000000,coalesce(c.actual_usd,0),coalesce(c.observed_usd,0));
 receipt_zero:=total=0 and (p_receipt->>'promptTokens')::numeric=0
  and (p_receipt->>'completionTokens')::numeric=0 and coalesce((p_receipt->>'reasoningTokens')::numeric,0)=0;
 eligible:=eligible and receipt_zero and c.request_hash is not null and c.rejection_receipt is not null
  and c.result is null and c.attempt_number<3 and c.job_id is not null;
 if c.generation_receipt is null then
  update public.reader_content_analysis_calls set generation_receipt=p_receipt,actual_usd=total,
   observed_usd=greatest(total,coalesce(observed_usd,0)),state='settled',settled_at=clock_timestamp()
   where id=c.id returning * into c;
 end if;
 due:=greatest(c.retry_not_before,(select cooldown_until from public.content_analysis_provider_cooldowns
  where identity_key=public.content_analysis_provider_key(c.execution_identity)));
 if eligible and not c.retry_authorized then
  update public.reader_content_analysis_calls set retry_authorized=true,retry_authorization_receipt=coalesce(retry_authorization_receipt,p_receipt) where id=c.id returning * into c;
  update public.reader_content_analysis_jobs set state='queued',next_attempt_at=due,lease_token=null,lease_until=null,
   error_code='analysis_provider_rate_limited',attempts=greatest(0,attempts-1),updated_at=clock_timestamp() where id=j.id;
  proc:=public.content_analysis_processing(a.record,j.content_hash)
   ||jsonb_build_object('reason','analysis_provider_rate_limited','updatedAt',clock_timestamp());
  proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"pending"'::jsonb);
  update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc)
   where user_id=j.user_id and id=j.update_id and record=a.record;
  -- Only truthful processing state changes; no source output is restored.
 end if;
 return jsonb_build_object('call',to_jsonb(c),'retryEligible',eligible and c.retry_authorized,'retryAt',case when eligible and c.retry_authorized then due else null end,'terminal',not (eligible and c.retry_authorized));
end;
$$;

revoke all on function public.content_analysis_provider_key(jsonb),public.preserve_content_analysis_request(),
 public.reserve_content_analysis_call_v3(uuid,uuid,text,numeric,text,jsonb,text),
 public.record_content_analysis_known_rejection(uuid,uuid,text,jsonb,integer,integer,text,timestamptz,boolean),
 public.record_content_analysis_generation_receipt(uuid,uuid,text,jsonb,jsonb,boolean),
 public.settle_content_analysis_call_v2(uuid,uuid,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function public.content_analysis_provider_key(jsonb),
 public.reserve_content_analysis_call_v3(uuid,uuid,text,numeric,text,jsonb,text),
 public.record_content_analysis_known_rejection(uuid,uuid,text,jsonb,integer,integer,text,timestamptz,boolean),
 public.record_content_analysis_generation_receipt(uuid,uuid,text,jsonb,jsonb,boolean),
 public.settle_content_analysis_call_v2(uuid,uuid,numeric,numeric) to service_role;
comment on column public.reader_content_analysis_calls.request_hash is 'Source-free SHA256 bound before provider request. Legacy null remains unknown and cannot be inferred/backfilled for automatic retry.';
comment on column public.reader_content_analysis_calls.rejection_receipt is 'HTTP status telemetry only. HTTP429, including pre-generation-looking responses, never proves a zero charge.';
comment on column public.reader_content_analysis_calls.generation_receipt is 'Service-trusted authenticated GET /api/v1/generation receipt, bound to exact model/provider/time/request evidence. Never accept client-asserted cost or infer zero from missing records.';
comment on table public.reader_content_analysis_call_attempts is 'Prior verified-zero attempts under the original stable job/call key. No source text or generated output; attempt three is terminal.';
comment on table public.content_analysis_provider_cooldowns is 'Private global route/baseURL/model/provider circuit. Receipt and fresh reservations serialize on global budget lock; no runtime activation.';
commit;
