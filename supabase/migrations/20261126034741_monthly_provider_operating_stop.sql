-- Apply before enabling the paid Flow 6/9 pilot. Keep the shared UTC ledger,
-- approved ceiling, existing financial receipts, and proof-specific caps.
begin;

create function recap_internal.monthly_provider_operating_limit()
returns numeric language sql immutable security invoker set search_path='' as $$
 select 18::numeric;
$$;
revoke all on function recap_internal.monthly_provider_operating_limit() from public,anon,authenticated;
grant execute on function recap_internal.monthly_provider_operating_limit() to service_role;

create function recap_internal.monthly_provider_stop_reason(p_committed numeric, p_additional numeric, p_ceiling numeric)
returns text language sql immutable security invoker set search_path='' as $$
 select case when p_committed>=stop.limit_usd then 'provider_operating_stop_reached'
  when p_committed+p_additional>stop.limit_usd then 'provider_operating_stop_would_exceed' end
 from (select least(p_ceiling,recap_internal.monthly_provider_operating_limit()) as limit_usd) stop;
$$;
revoke all on function recap_internal.monthly_provider_stop_reason(numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function recap_internal.monthly_provider_stop_reason(numeric,numeric,numeric) to service_role;

create or replace function public.require_monthly_provider_capacity(p_additional_usd numeric, p_existing_allocation boolean default false)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare refusal text;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Provider admissions require read committed' using errcode='PT409';
 end if;
 perform public.lock_monthly_provider_budget();
 select recap_internal.monthly_provider_stop_reason(committed_usd,p_additional_usd,limit_usd)
 into strict refusal from public.monthly_provider_budget_snapshot(clock_timestamp());
 if refusal is not null then
  -- A held allocation still needs fresh authority to launch. Retain the RPC
  -- error contract for workers that yield, while identifying the exact refusal.
  raise exception 'Monthly provider budget exhausted' using errcode='PT402',
   detail='provider_monthly_budget_exhausted', hint=refusal;
 end if;
end;
$$;

-- Keep the existing early exits on the same operating limit. These checks
-- avoid opening sessions when capacity is already exhausted. Only the
-- transaction-locked reservation and launch guards grant spending authority.
do $$
declare claim record; definition text;
begin
 for claim in select * from (values
   ('public.claim_automatic_content_task(integer)','committed_usd+.10>limit_usd','.10'),
   ('public.claim_social_content_task(integer)','committed_usd+.10>limit_usd','.10'),
   ('public.claim_content_analysis_job_v2(text,integer)','committed_usd>=limit_usd','0')
 ) as claims(rpc,predicate,maximum) loop
  definition:=pg_get_functiondef(claim.rpc::regprocedure);
  if (length(definition)-length(replace(definition,claim.predicate,'')))<>length(claim.predicate) then
   raise exception 'Unexpected provider budget preflight in %',claim.rpc;
  end if;
  execute replace(definition,claim.predicate,
   format('recap_internal.monthly_provider_stop_reason(committed_usd,%s,limit_usd) is not null',claim.maximum));
 end loop;
end;
$$;

create table recap_internal.monthly_provider_admission_refusals (
 month_start date primary key,
 observed_at timestamptz not null,
 reason text not null check (reason in ('provider_operating_stop_reached','provider_operating_stop_would_exceed'))
);
alter table recap_internal.monthly_provider_admission_refusals enable row level security;
revoke all on recap_internal.monthly_provider_admission_refusals from public,anon,authenticated,service_role;
grant select,insert,update on recap_internal.monthly_provider_admission_refusals to service_role;

-- The denied transaction rolled back. The server records just the reason in a
-- separate transaction, with one last-observed receipt per UTC month.
create function public.record_monthly_provider_admission_refusal(p_reason text)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare observed timestamptz:=clock_timestamp();
begin
 insert into recap_internal.monthly_provider_admission_refusals(month_start,observed_at,reason)
 values(date_trunc('month',observed at time zone 'UTC')::date,observed,p_reason)
 on conflict (month_start) do update
 set observed_at=excluded.observed_at,reason=excluded.reason
 where monthly_provider_admission_refusals.observed_at<=excluded.observed_at;
end;
$$;
revoke all on function public.record_monthly_provider_admission_refusal(text) from public,anon,authenticated;
grant execute on function public.record_monthly_provider_admission_refusal(text) to service_role;

create or replace function public.read_monthly_provider_budget() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('monthStart',s.month_start,'resetsAt',s.resets_at,'limitUsd',s.limit_usd,
  'operatingLimitUsd',o.limit_usd,
  'apifyUsd',s.apify_usd,'openrouterUsd',s.openrouter_usd,'spentUsd',s.apify_usd+s.openrouter_usd,
  'committedUsd',s.committed_usd,'unresolvedUsd',s.unresolved_usd,'paused',s.committed_usd>=o.limit_usd,
  'pauseReason',case when s.committed_usd>=o.limit_usd then 'provider_operating_stop_reached' end,
  'lastRefusal',case when r.month_start is not null then jsonb_build_object('at',r.observed_at,'reason',r.reason) end,
  'alerts',coalesce((select jsonb_agg(q.percent order by q.percent)
   from (values (50),(80),(100)) q(percent)
   where s.committed_usd>=s.limit_usd*q.percent/100.0 or exists(
    select 1 from recap_internal.monthly_provider_budget_alerts a where a.month_start=s.month_start and a.threshold=q.percent)),'[]'::jsonb))
 from public.monthly_provider_budget_snapshot(statement_timestamp()) s
 cross join lateral (select least(s.limit_usd,recap_internal.monthly_provider_operating_limit()) as limit_usd) o
 left join recap_internal.monthly_provider_admission_refusals r using (month_start);
$$;

commit;
