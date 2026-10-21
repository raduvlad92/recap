-- D21 review: collector-specific quotes and compare-and-swap for every ledger write.
begin;

alter table public.collection_jobs
  add column updated_at timestamptz not null default clock_timestamp();

create function public.set_collection_job_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A same-status update must still receive a strictly newer server revision.
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function public.set_collection_job_revision() from public,anon,authenticated;
grant execute on function public.set_collection_job_revision() to service_role;
create trigger collection_jobs_revision before update on public.collection_jobs
  for each row execute function public.set_collection_job_revision();

create or replace function public.admin_update_plan(p_platform text,p_expected timestamptz,p_admin text,p_provider text,p_actor text,p_hours integer,p_notes text)
returns public.collection_plans language plpgsql security invoker set search_path = '' as $$
declare result public.collection_plans;
begin
  update public.collection_plans set provider=p_provider,actor_id=nullif(btrim(p_actor),''),planned_check_hours=p_hours,notes=p_notes,
    quoted_usd=case when provider is not distinct from p_provider and actor_id is not distinct from nullif(btrim(p_actor),'') then quoted_usd else null end,
    pricing_url=case when provider is not distinct from p_provider and actor_id is not distinct from nullif(btrim(p_actor),'') then pricing_url else null end,
    unit_label=case when provider is not distinct from p_provider and actor_id is not distinct from nullif(btrim(p_actor),'') then unit_label else 'Not priced for selected collector' end,
    quote_checked_at=case when provider is not distinct from p_provider and actor_id is not distinct from nullif(btrim(p_actor),'') then quote_checked_at else null end,
    updated_at=clock_timestamp()
    where platform=p_platform and updated_at=p_expected returning * into result;
  if result.platform is null then raise exception 'Record changed; reload before saving' using errcode='40001'; end if;
  insert into public.admin_audit_events(admin_id,action,target_id) values (p_admin,'plan.updated',p_platform);
  return result;
end;
$$;
revoke all on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) to service_role;

commit;
