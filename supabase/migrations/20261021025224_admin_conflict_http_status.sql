-- Business-level optimistic edit conflicts must not use serialization_failure.
-- PostgREST 14 retries SQLSTATE 40001 internally; PT409 returns HTTP409 directly.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;

create or replace function public.admin_update_creator(p_id text,p_expected timestamptz,p_admin text,p_description text,p_topics text[],p_listed boolean)
returns public.catalogue_creators language plpgsql security invoker set search_path = '' as $$
declare result public.catalogue_creators;
begin
  update public.catalogue_creators set description=p_description,topics=p_topics,is_listed=p_listed,updated_at=clock_timestamp()
    where id=p_id and updated_at=p_expected returning * into result;
  if result.id is null then raise exception 'Record changed; reload before saving' using errcode='PT409'; end if;
  insert into public.admin_audit_events(admin_id,action,target_id,details) values (p_admin,'creator.updated',p_id,jsonb_build_object('listed',p_listed));
  return result;
end;
$$;

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
  if result.platform is null then raise exception 'Record changed; reload before saving' using errcode='PT409'; end if;
  insert into public.admin_audit_events(admin_id,action,target_id) values (p_admin,'plan.updated',p_platform);
  return result;
end;
$$;

revoke all on function public.admin_update_creator(text,timestamptz,text,text,text[],boolean) from public,anon,authenticated;
revoke all on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_update_creator(text,timestamptz,text,text,text[],boolean) to service_role;
grant execute on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) to service_role;
commit;
