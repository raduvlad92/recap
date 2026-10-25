-- Additive, server-only scheduling and independent content disposition.
-- No policy, runtime gate, provider job, reservation or fee is activated/released.
begin;
alter table public.reader_collection_source_state add column last_started_at timestamptz;
alter table public.reader_collection_provider_jobs add column last_reconciled_at timestamptz;
alter table public.reader_collection_provider_jobs add column content_pending boolean not null default false;
-- Existing terminal rows already went through the accepted-import path. Keep
-- unresolved originals recoverable even after a later fee settlement.
update public.reader_collection_provider_jobs set content_pending=true where state in ('launch_claimed','running','ambiguous');
alter table public.reader_collection_provider_jobs alter column content_pending set default true;
create index hourly_provider_service_order on public.reader_collection_provider_jobs(user_id,source_id,last_reconciled_at nulls first,created_at,id)
 where state in ('launch_claimed','running','ambiguous') or actual_cost_usd is null or content_pending;

create function public.hourly_source_started() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.lease_token is not null and new.lease_token is distinct from old.lease_token then new.last_started_at:=clock_timestamp(); end if;
 return new;
end;
$$;
revoke all on function public.hourly_source_started() from public,anon,authenticated;
create trigger hourly_source_started before update on public.reader_collection_source_state for each row execute function public.hourly_source_started();

-- Bounded global least-started order includes new follows before they have a
-- source-state row. Claim RPC still revalidates follow/workspace/lease/due state.
-- Reading this list never marks an unclaimed source as serviced.
create function public.schedule_hourly_sources() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('user_id',q.user_id,'source_id',q.source_id) order by q.last_started_at nulls first,q.user_id,q.source_id),'[]'::jsonb)
 from (
  select distinct p.user_id,x->>'id' as source_id,s.last_started_at
  from public.reader_collection_policies p join public.reader_workspaces w on w.user_id=p.user_id
  cross join lateral jsonb_array_elements(w.state->'customSources') x
  left join public.reader_collection_source_state s on s.user_id=p.user_id and s.source_id=x->>'id'
  where p.enabled and w.state->'followedSourceIds' ? (x->>'id') and coalesce(x->>'status','')<>'sample'
   and x->>'id' is not null and (s.lease_until is null or s.lease_until<=now()) and (s.next_check_at is null or s.next_check_at<=now())
  order by s.last_started_at nulls first,p.user_id,x->>'id' limit 1000
 ) q;
$$;

-- Fenced metadata-only reconciliation touch. In particular, no-run ambiguous
-- rows rotate without releasing holds or attempting a new launch.
create function public.service_hourly_provider(p_check_id uuid,p_lease_token uuid,p_provider_job_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; w public.reader_workspaces;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into w from public.reader_workspaces where user_id=e.user_id for share;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if e.id is null or e.status<>'running' or s.check_id is distinct from p_check_id or s.lease_token is distinct from p_lease_token or s.lease_until is null or s.lease_until<clock_timestamp()
  or w.updated_at is distinct from s.workspace_revision or not coalesce(w.state->'followedSourceIds' ? e.source_id,false)
  or not exists(select 1 from jsonb_array_elements(w.state->'customSources') x where x->>'id'=e.source_id and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)
  or not exists(select 1 from public.reader_collection_policies where user_id=e.user_id and enabled)
 then raise exception 'Hourly source changed' using errcode='PT409'; end if;
 update public.reader_collection_provider_jobs set last_reconciled_at=clock_timestamp()
  where id=p_provider_job_id and user_id=e.user_id and source_id=e.source_id;
 if not found then raise exception 'Provider job unavailable' using errcode='PT409'; end if;
end;
$$;

create function public.pending_hourly_providers(p_check_id uuid,p_lease_token uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; result jsonb;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id;
 if e.id is null or e.status<>'running' or s.check_id is distinct from p_check_id or s.lease_token is distinct from p_lease_token or s.lease_until is null or s.lease_until<now() then raise exception 'Lease changed' using errcode='PT409'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.last_reconciled_at nulls first,q.created_at,q.id),'[]'::jsonb) into result
 from (select j.* from public.reader_collection_provider_jobs j where j.user_id=e.user_id and j.source_id=e.source_id
  and (j.state in ('launch_claimed','running','ambiguous') or j.actual_cost_usd is null or j.content_pending)
  order by j.last_reconciled_at nulls first,j.created_at,j.id limit 100) q;
 return result;
end;
$$;
revoke all on function public.schedule_hourly_sources(),public.service_hourly_provider(uuid,uuid,uuid),public.pending_hourly_providers(uuid,uuid) from public,anon,authenticated;
grant execute on function public.schedule_hourly_sources(),public.service_hourly_provider(uuid,uuid,uuid),public.pending_hourly_providers(uuid,uuid) to service_role;
comment on column public.reader_collection_provider_jobs.content_pending is 'Unread/unaccepted original remains GET-only recoverable independently of terminal status or final fee. Clear only after accepted import or explicit discard.';
commit;
