-- D22: one durable, non-recurring ceiling shared by all paid collection work.
-- No credentials, reader identity, provider launch or source material belongs here.
begin;
create table public.collection_budget_accounts (
  id text primary key check (id = 'source-proof'),
  currency text not null default 'USD' check (currency = 'USD'),
  ceiling_usd numeric(12,6) not null check (ceiling_usd > 0 and ceiling_usd <= 45),
  original_ceiling_eur numeric(12,6) not null default 50 check (original_ceiling_eur = 50),
  created_at timestamptz not null default clock_timestamp()
);
insert into public.collection_budget_accounts(id,ceiling_usd) values ('source-proof',45);
create table public.collection_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id text not null default 'source-proof' references public.collection_budget_accounts(id),
  request_key text not null check (request_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  kind text not null check (kind in ('envelope','job')),
  parent_id uuid references public.collection_budget_reservations(id),
  maximum_usd numeric(12,6) not null check (maximum_usd > 0 and maximum_usd <= 45),
  provider text check (provider in ('apify','brightdata')),
  actor_id text check (actor_id is null or (length(actor_id) <= 200 and actor_id ~ '^[A-Za-z0-9_-]+([~/][A-Za-z0-9_-]+)?$')),
  provider_run_id text check (provider_run_id is null or provider_run_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  state text not null default 'held' check (state in ('held','settled','released')),
  actual_cost_usd numeric(24,12) check (actual_cost_usd >= 0 and actual_cost_usd < 1000000000),
  launch_attempted_at timestamptz,
  completed_at timestamptz,
  provider_inventory_complete boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(account_id,request_key),
  check (account_id = 'source-proof'),
  check ((kind = 'envelope' and parent_id is null and provider is null and actor_id is null and provider_run_id is null and launch_attempted_at is null)
    or (kind = 'job' and provider is not null and actor_id is not null)),
  check ((state = 'settled' and actual_cost_usd is not null and completed_at is not null)
    or (state <> 'settled' and actual_cost_usd is null)),
  check (state <> 'released' or launch_attempted_at is null),
  check (kind <> 'envelope' or state <> 'settled' or provider_inventory_complete),
  check (not provider_inventory_complete or kind = 'envelope')
);
create index collection_budget_parent_idx on public.collection_budget_reservations(parent_id);
create unique index collection_budget_provider_run_idx on public.collection_budget_reservations(provider,provider_run_id) where provider_run_id is not null;
alter table public.collection_budget_accounts enable row level security;
alter table public.collection_budget_reservations enable row level security;
revoke all on table public.collection_budget_accounts,public.collection_budget_reservations from public,anon,authenticated,service_role;
grant select,update on table public.collection_budget_accounts to service_role;
grant select,insert,update on table public.collection_budget_reservations to service_role;
-- No reader policies: only the existing server's service_role may use this ledger.

-- Held envelopes charge their full maximum globally. A known overrun is still
-- recorded honestly and increases commitment; it must never disappear in a cap.
create function public.collection_budget_committed()
returns numeric language sql stable security invoker set search_path = '' as $$
 select coalesce(sum(case when r.kind='envelope' and r.state='held' then greatest(r.maximum_usd,
   coalesce((select sum(case when j.state='held' then j.maximum_usd when j.state='settled' then j.actual_cost_usd else 0 end)
     from public.collection_budget_reservations j where j.parent_id=r.id),0))
   when r.state='held' then r.maximum_usd when r.state='settled' then r.actual_cost_usd else 0 end),0)
 from public.collection_budget_reservations r where r.parent_id is null and r.account_id='source-proof';
$$;
create function public.collection_budget_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('accountId',a.id,'currency',a.currency,'ceilingUsd',a.ceiling_usd,
   'committedUsd',public.collection_budget_committed(),
   'availableUsd',greatest(0,a.ceiling_usd-public.collection_budget_committed()),
   'overCeiling',public.collection_budget_committed()>a.ceiling_usd,
   'heldEnvelopes',(select count(*) from public.collection_budget_reservations r where r.kind='envelope' and r.state='held'),
   'unknownCostJobs',(select count(*) from public.collection_budget_reservations r where r.kind='job' and r.state='held' and r.launch_attempted_at is not null))
 from public.collection_budget_accounts a where a.id='source-proof';
$$;

create function public.reserve_collection_budget(p_request_key text,p_maximum_usd numeric,p_kind text,p_parent_id uuid default null,p_provider text default null,p_actor_id text default null)
returns public.collection_budget_reservations language plpgsql security invoker set search_path = '' as $$
declare a public.collection_budget_accounts; r public.collection_budget_reservations; parent public.collection_budget_reservations; allocated numeric;
begin
 select * into a from public.collection_budget_accounts where id='source-proof' for update;
 if a.id is null then raise exception 'Budget unavailable' using errcode='PT503'; end if;
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' or p_maximum_usd is null or p_maximum_usd <= 0 or p_maximum_usd > a.ceiling_usd or scale(p_maximum_usd)>6
   or p_kind is null or p_kind not in ('envelope','job') then raise exception 'Invalid budget reservation' using errcode='PT400'; end if;
 if (p_kind='envelope' and (p_parent_id is not null or p_provider is not null or p_actor_id is not null))
   or (p_kind='job' and (p_provider is null or p_provider not in ('apify','brightdata') or p_actor_id is null or length(p_actor_id)>200 or p_actor_id !~ '^[A-Za-z0-9_-]+([~/][A-Za-z0-9_-]+)?$')) then
   raise exception 'Invalid budget reservation' using errcode='PT400'; end if;
 select * into r from public.collection_budget_reservations where account_id=a.id and request_key=p_request_key;
 if r.id is not null then
   if r.maximum_usd<>p_maximum_usd or r.kind<>p_kind or r.parent_id is distinct from p_parent_id or r.provider is distinct from p_provider or r.actor_id is distinct from p_actor_id then
     raise exception 'Budget request identity changed' using errcode='PT409'; end if;
   return r;
 end if;
 if public.collection_budget_committed()>a.ceiling_usd then raise exception 'Budget ceiling exceeded' using errcode='PT402'; end if;
 if p_parent_id is null then
   if public.collection_budget_committed()+p_maximum_usd>a.ceiling_usd then raise exception 'Budget exhausted' using errcode='PT402'; end if;
 else
   select * into parent from public.collection_budget_reservations where id=p_parent_id;
   if parent.id is null or parent.kind<>'envelope' or parent.state<>'held' or parent.account_id<>a.id then raise exception 'Budget envelope unavailable' using errcode='PT409'; end if;
   select coalesce(sum(case when state='held' then maximum_usd when state='settled' then actual_cost_usd else 0 end),0) into allocated from public.collection_budget_reservations where parent_id=parent.id;
   if allocated+p_maximum_usd>parent.maximum_usd then raise exception 'Envelope budget exhausted' using errcode='PT402'; end if;
 end if;
 insert into public.collection_budget_reservations(request_key,kind,parent_id,maximum_usd,provider,actor_id)
   values(p_request_key,p_kind,p_parent_id,p_maximum_usd,p_provider,p_actor_id) returning * into r;
 return r;
end;
$$;

-- Call immediately BEFORE the provider POST. A replay returns claimed=false and
-- cannot authorize a second launch. A network/crash ambiguity keeps the hold.
create function public.claim_collection_budget(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.collection_budget_reservations; a public.collection_budget_accounts;
begin
 select * into a from public.collection_budget_accounts where id='source-proof' for update;
 select * into r from public.collection_budget_reservations where id=p_id;
 if r.id is null or r.kind<>'job' or r.state<>'held' then raise exception 'Budget job unavailable' using errcode='PT409'; end if;
 if r.launch_attempted_at is not null then return jsonb_build_object('claimed',false,'reservation',to_jsonb(r)); end if;
 if public.collection_budget_committed()>a.ceiling_usd then raise exception 'Budget ceiling exceeded' using errcode='PT402'; end if;
 if r.parent_id is not null and not exists(select 1 from public.collection_budget_reservations where id=r.parent_id and kind='envelope' and state='held') then raise exception 'Budget envelope unavailable' using errcode='PT409'; end if;
 update public.collection_budget_reservations set launch_attempted_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
 return jsonb_build_object('claimed',true,'reservation',to_jsonb(r));
end;
$$;

-- Bind an actual run or report a terminal outcome. A null final cost NEVER
-- releases a reservation. Final reported charges are immutable/idempotent.
create function public.settle_collection_budget(p_id uuid,p_provider_run_id text,p_actual_usd numeric default null,p_terminal boolean default false)
returns public.collection_budget_reservations language plpgsql security invoker set search_path = '' as $$
declare r public.collection_budget_reservations;
begin
 perform 1 from public.collection_budget_accounts where id='source-proof' for update;
 select * into r from public.collection_budget_reservations where id=p_id;
 if r.id is null or r.kind<>'job' or r.state='released' or r.launch_attempted_at is null then raise exception 'Budget job unavailable' using errcode='PT409'; end if;
 if p_provider_run_id is null or p_provider_run_id !~ '^[A-Za-z0-9_-]{1,200}$' or p_terminal is null or (p_actual_usd is not null and (not p_terminal or p_actual_usd<0 or p_actual_usd>=1000000000 or scale(p_actual_usd)>12)) then raise exception 'Invalid provider outcome' using errcode='PT400'; end if;
 if r.provider_run_id is not null and r.provider_run_id<>p_provider_run_id then raise exception 'Provider run changed' using errcode='PT409'; end if;
 if r.state='settled' then
   if not p_terminal or p_actual_usd is distinct from r.actual_cost_usd then raise exception 'Final charge changed' using errcode='PT409'; end if;
   return r;
 end if;
 update public.collection_budget_reservations set provider_run_id=p_provider_run_id,
   actual_cost_usd=p_actual_usd,state=case when p_actual_usd is null then 'held' else 'settled' end,
   completed_at=case when p_terminal then coalesce(completed_at,clock_timestamp()) else completed_at end,updated_at=clock_timestamp()
   where id=r.id returning * into r;
 return r;
exception when unique_violation then raise exception 'Provider run already recorded' using errcode='PT409';
end;
$$;

create function public.release_collection_budget(p_id uuid)
returns public.collection_budget_reservations language plpgsql security invoker set search_path = '' as $$
declare r public.collection_budget_reservations;
begin
 perform 1 from public.collection_budget_accounts where id='source-proof' for update;
 select * into r from public.collection_budget_reservations where id=p_id;
 if r.id is null then raise exception 'Budget reservation unavailable' using errcode='PT409'; end if;
 if r.state='released' then return r; end if;
 if r.state<>'held' or r.launch_attempted_at is not null or r.provider_run_id is not null
   or exists(select 1 from public.collection_budget_reservations where parent_id=r.id and state<>'released') then
   raise exception 'Launched or unresolved reservations must remain held' using errcode='PT409'; end if;
 update public.collection_budget_reservations set state='released',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
 return r;
end;
$$;

create function public.close_collection_budget_envelope(p_id uuid,p_provider_inventory_complete boolean)
returns public.collection_budget_reservations language plpgsql security invoker set search_path = '' as $$
declare r public.collection_budget_reservations; charge numeric;
begin
 perform 1 from public.collection_budget_accounts where id='source-proof' for update;
 select * into r from public.collection_budget_reservations where id=p_id;
 if r.id is null or r.kind<>'envelope' or r.state='released' then raise exception 'Budget envelope unavailable' using errcode='PT409'; end if;
 if p_provider_inventory_complete is distinct from true then raise exception 'Complete provider inventory required' using errcode='PT409'; end if;
 if r.state='settled' then return r; end if;
 if not exists(select 1 from public.collection_budget_reservations where parent_id=r.id and state='settled')
   or exists(select 1 from public.collection_budget_reservations where parent_id=r.id and state='held') then raise exception 'Unknown charges remain held' using errcode='PT409'; end if;
 select coalesce(sum(actual_cost_usd),0) into charge from public.collection_budget_reservations where parent_id=r.id and state='settled';
 update public.collection_budget_reservations set state='settled',actual_cost_usd=charge,provider_inventory_complete=true,
   completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id returning * into r;
 return r;
end;
$$;

revoke all on function public.collection_budget_committed(),public.collection_budget_status(),public.reserve_collection_budget(text,numeric,text,uuid,text,text),public.claim_collection_budget(uuid),public.settle_collection_budget(uuid,text,numeric,boolean),public.release_collection_budget(uuid),public.close_collection_budget_envelope(uuid,boolean) from public,anon,authenticated;
grant execute on function public.collection_budget_committed(),public.collection_budget_status(),public.reserve_collection_budget(text,numeric,text,uuid,text,text),public.claim_collection_budget(uuid),public.settle_collection_budget(uuid,text,numeric,boolean),public.release_collection_budget(uuid),public.close_collection_budget_envelope(uuid,boolean) to service_role;
comment on table public.collection_budget_accounts is 'Shared non-recurring source proof ceiling: conservative USD45 within the existing EUR50 approval. No per-reader resets or automatic increases.';
comment on table public.collection_budget_reservations is 'Server-only holds. Unknown charges and abandoned envelopes stay committed until explicit reconciliation; no expiry or background release.';
commit;
