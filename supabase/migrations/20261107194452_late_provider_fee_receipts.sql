-- Explicit reconciliation of already-settled, referenced YouTube fees only.
-- No backfill, expiry, hold release, scheduler, control or budget change.
begin;
create table public.collection_provider_fee_receipts (
 id uuid primary key default gen_random_uuid(),
 request_key text not null unique check(request_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
 provider_job_id uuid not null references public.reader_collection_provider_jobs(id),
 reservation_id uuid not null references public.collection_budget_reservations(id),
 provider_run_id text not null,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 expected jsonb not null,
 original_reservation jsonb not null,
 original_job_finances jsonb not null,
 original_ledger_finances jsonb not null,
 previous_usd numeric(24,12) not null check(previous_usd>=0),
 reported_usd numeric(24,12) check(reported_usd>=0),
 corrected_usd numeric(24,12) not null check(corrected_usd>=previous_usd),
 delta_usd numeric(24,12) not null check(delta_usd=corrected_usd-previous_usd),
 outcome text not null check(outcome in('applied','unchanged','unresolved_nonfinal','unresolved_zero','unresolved_missing_fee','unresolved_decrease','unresolved_over_cap')),
 created_at timestamptz not null default clock_timestamp(),
 check((outcome='applied' and delta_usd>0) or (outcome<>'applied' and delta_usd=0))
);
create index collection_provider_fee_receipts_reservation on public.collection_provider_fee_receipts(reservation_id,created_at,id);
create index collection_provider_fee_receipts_overrun on public.collection_provider_fee_receipts(id) where outcome='unresolved_over_cap';
alter table public.collection_provider_fee_receipts enable row level security;
revoke all on public.collection_provider_fee_receipts from public,anon,authenticated,service_role;
grant select,insert on public.collection_provider_fee_receipts to service_role;
create function public.immutable_provider_fee_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Provider fee receipts are immutable' using errcode='PT409'; end; $$;
revoke all on function public.immutable_provider_fee_receipt() from public,anon,authenticated,service_role;
create trigger immutable_provider_fee_receipt before update or delete on public.collection_provider_fee_receipts
for each row execute function public.immutable_provider_fee_receipt();

create function public.prepare_late_provider_fee(p_job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;
begin
 select * into j from public.reader_collection_provider_jobs where id=p_job_id;
 select * into r from public.collection_budget_reservations where id=j.reservation_id;
 select * into l from public.collection_jobs where id=j.job_id;
 if j.id is null or r.id is null or l.id is null or j.state not in('completed','failed') or r.kind<>'job' or r.parent_id is not null or r.state<>'settled'
  or r.launch_attempted_at is null or r.provider<>'apify' or r.actor_id<>'h7sDV53CddomktSi5'
  or j.actor_id is distinct from r.actor_id or j.maximum_usd is distinct from r.maximum_usd
  or j.actual_cost_usd is distinct from r.actual_cost_usd or j.provider_run_id is null or j.provider_run_id is distinct from r.provider_run_id
  or l.provider_run_id is distinct from r.provider_run_id or l.actor_id is distinct from r.actor_id or l.provider<>'apify'
  or l.user_id is distinct from j.user_id or l.source_id is distinct from j.source_id or l.platform<>'YouTube'
  or j.item_key !~ '^youtube:|^youtube-discovery:' then
  raise exception 'Only exact already-settled YouTube references can be corrected' using errcode='PT409';
 end if;
 return jsonb_build_object('provider_job_id',j.id,'reservation_id',r.id,'user_id',j.user_id,'provider_run_id',r.provider_run_id,'actor_id',r.actor_id,
  'revision',md5(to_jsonb(r)::text||to_jsonb(j)::text||to_jsonb(l)::text));
end; $$;

create function public.record_late_provider_fee(p_job_id uuid,p_request_key text,p_expected jsonb,p_evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;
 p public.reader_collection_policies;receipt public.collection_provider_fee_receipts;
 amount numeric;provider_cap numeric;delta numeric:=0;corrected numeric;reason text;total numeric;daily numeric;over_cap boolean:=false;observed timestamptz;finished timestamptz;
begin
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' or p_expected is null or p_evidence is null
  or jsonb_typeof(p_expected)<>'object' or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>4000
  or (p_evidence-array['run_id','actor_id','build_id','status','finished_at','observed_at','response_sha256','usage_usd','maximum_usd','authenticated_owner'])<>'{}'::jsonb
  or not(p_evidence ?& array['run_id','actor_id','build_id','status','finished_at','observed_at','response_sha256','usage_usd','maximum_usd','authenticated_owner'])
  or p_evidence->'authenticated_owner' is distinct from 'true'::jsonb
  or coalesce(p_evidence->>'build_id','') !~ '^[A-Za-z0-9]{6,64}$' or coalesce(p_evidence->>'response_sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_evidence->>'status','') not in('READY','RUNNING','TIMING-OUT','ABORTING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED')
  or jsonb_typeof(p_evidence->'maximum_usd')<>'string' or coalesce(p_evidence->>'maximum_usd','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$'
  or length(p_evidence->>'maximum_usd')>80
  or (p_evidence->'usage_usd'<>'null'::jsonb and (jsonb_typeof(p_evidence->'usage_usd')<>'string' or (p_evidence->>'usage_usd') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$' or length(p_evidence->>'usage_usd')>80)) then
  raise exception 'Invalid provider fee evidence' using errcode='PT400';
 end if;
 -- Match hourly admission's policy -> source -> account ordering. No source
 -- or workspace mutations, import, publication, lease or scheduling changes.
 select * into j from public.reader_collection_provider_jobs where id=p_job_id;
 select * into p from public.reader_collection_policies where user_id=j.user_id for update;
 perform 1 from public.reader_collection_source_state where user_id=j.user_id and source_id=j.source_id for update;
 perform 1 from public.collection_budget_accounts where id='source-proof' for update;
 select * into j from public.reader_collection_provider_jobs where id=p_job_id for update;
 select * into r from public.collection_budget_reservations where id=j.reservation_id for update;
 select * into l from public.collection_jobs where id=j.job_id for update;
 -- Replays return the original immutable receipt, even after another correction.
 -- Fresh transport time/hash do not change the economic evidence identity.
 select * into receipt from public.collection_provider_fee_receipts where request_key=p_request_key;
 if receipt.id is not null then
  if receipt.provider_job_id is distinct from p_job_id or receipt.expected is distinct from p_expected
   and p_expected is distinct from public.prepare_late_provider_fee(p_job_id)
   or (receipt.evidence-array['observed_at','response_sha256']) is distinct from (p_evidence-array['observed_at','response_sha256']) then
   raise exception 'Receipt key reused with different evidence' using errcode='PT409';
  end if;
 else
  if p.user_id is null or p_expected is distinct from public.prepare_late_provider_fee(p_job_id)
   or p_evidence->>'run_id' is distinct from r.provider_run_id or p_evidence->>'actor_id' is distinct from r.actor_id then
   raise exception 'Saved provider reference or cash state changed' using errcode='PT409';
  end if;
  begin
   observed:=(p_evidence->>'observed_at')::timestamptz;finished:=(p_evidence->>'finished_at')::timestamptz;
  exception when others then raise exception 'Invalid provider observation time' using errcode='PT400';end;
  if observed is null or not isfinite(observed) or observed>clock_timestamp()+interval'1 second' or observed<clock_timestamp()-interval'60 seconds'
   or finished is not null and(not isfinite(finished) or finished>observed) then raise exception 'Current provider metadata required' using errcode='PT409';end if;
  provider_cap:=(p_evidence->>'maximum_usd')::numeric;
  if provider_cap<>r.maximum_usd then raise exception 'Saved provider cap changed' using errcode='PT409';end if;
  -- Round UP to the cash ledger's 12 decimal places using exact numeric only.
  amount:=ceil((p_evidence->>'usage_usd')::numeric*1000000000000)/1000000000000;
  if amount>=1000000000 then raise exception 'Invalid provider fee magnitude' using errcode='PT400';end if;
  corrected:=r.actual_cost_usd;
  -- A nonfinal observation is still a known lower bound. An observed overrun
  -- must stop admission immediately, even while accounting is preliminary.
  if amount>r.actual_cost_usd then
   select coalesce(sum(case when b.state='held' then b.maximum_usd when b.state='settled' then b.actual_cost_usd else 0 end),0),
    coalesce(sum(case when (a.created_at at time zone'UTC')::date=(j.created_at at time zone'UTC')::date or (b.state='held' and b.launch_attempted_at is not null)
     then case when b.state='held' then b.maximum_usd when b.state='settled' then b.actual_cost_usd else 0 end else 0 end),0)
    into total,daily from public.reader_collection_provider_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.user_id=j.user_id;
   over_cap:=public.collection_budget_committed()+amount-r.actual_cost_usd>(select ceiling_usd from public.collection_budget_accounts where id='source-proof')
    or total+amount-r.actual_cost_usd>p.lifetime_limit_usd or daily+amount-r.actual_cost_usd>p.daily_limit_usd;
  end if;
  if amount>r.maximum_usd or over_cap then reason:='unresolved_over_cap';
  elsif p_evidence->>'status' not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED') or finished is null or finished>observed-interval'10 seconds' then reason:='unresolved_nonfinal';
  elsif amount is null then reason:='unresolved_missing_fee';
  elsif amount=0 then reason:='unresolved_zero';
  elsif amount<greatest(r.actual_cost_usd,j.observed_cost_usd,l.observed_cost_usd,
   (select max(f.reported_usd) from public.collection_provider_fee_receipts f where f.reservation_id=r.id)) then reason:='unresolved_decrease';
  elsif amount=r.actual_cost_usd then reason:='unchanged';
  else
   delta:=amount-r.actual_cost_usd;reason:='applied';corrected:=amount;
  end if;
  insert into public.collection_provider_fee_receipts(request_key,provider_job_id,reservation_id,provider_run_id,evidence,expected,original_reservation,original_job_finances,original_ledger_finances,previous_usd,reported_usd,corrected_usd,delta_usd,outcome)
   values(p_request_key,j.id,r.id,r.provider_run_id,p_evidence,p_expected,to_jsonb(r),
    jsonb_build_object('actual_cost_usd',j.actual_cost_usd,'observed_cost_usd',j.observed_cost_usd),
    jsonb_build_object('observed_cost_usd',l.observed_cost_usd,'cost_status',l.cost_status,'updated_at',l.updated_at),r.actual_cost_usd,amount,corrected,delta,reason) returning * into receipt;
  if reason='applied' then
   update public.collection_budget_reservations set actual_cost_usd=corrected,updated_at=clock_timestamp() where id=r.id;
   update public.reader_collection_provider_jobs set actual_cost_usd=corrected,observed_cost_usd=corrected where id=j.id;
   update public.collection_jobs set observed_cost_usd=corrected,cost_status='provider_reported' where id=l.id;
  end if;
 end if;
 return jsonb_build_object('id',receipt.id,'request_key',receipt.request_key,'outcome',receipt.outcome,'previous_usd',receipt.previous_usd::text,
  'reported_usd',receipt.reported_usd::text,'corrected_usd',receipt.corrected_usd::text,'delta_usd',receipt.delta_usd::text);
end; $$;
revoke all on function public.prepare_late_provider_fee(uuid),public.record_late_provider_fee(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_late_provider_fee(uuid),public.record_late_provider_fee(uuid,text,jsonb,jsonb) to service_role;
comment on table public.collection_provider_fee_receipts is 'Private append-only provider observations and audited upward cash corrections. Unresolved receipts are not permission to launch, release holds or raise limits.';
-- An observed unbooked overrun cannot leave admission silently open. Preserve
-- every receipt; lifting this evidence fence needs separate audited resolution.
create function public.guard_unresolved_provider_overrun() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' or (old.launch_attempted_at is null and new.launch_attempted_at is not null))
  and exists(select 1 from public.collection_provider_fee_receipts where outcome='unresolved_over_cap') then
  raise exception 'Unresolved provider overrun blocks new cash admission' using errcode='PT402';
 end if;
 return new;
end; $$;
revoke all on function public.guard_unresolved_provider_overrun() from public,anon,authenticated,service_role;
create trigger guard_unresolved_provider_overrun before insert or update of launch_attempted_at on public.collection_budget_reservations
 for each row execute function public.guard_unresolved_provider_overrun();
commit;
