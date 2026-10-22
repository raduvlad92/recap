-- D32: serialize the complete owner clear transaction before archive triggers
-- acquire source-state locks. A narrowly scoped internal helper can lock only
-- the JWT owner's policy; readers receive no policy-write privilege.
begin;
create schema if not exists recap_internal;
revoke all on schema recap_internal from public,anon;
grant usage on schema recap_internal to authenticated;
create function recap_internal.lock_own_hourly_policy() returns void
language plpgsql security definer set search_path='' as $$
declare subject text;
begin
 subject:=auth.jwt()->>'sub';
 if subject is null or length(subject) not between 1 and 200 then raise exception 'Sign in required' using errcode='PT401'; end if;
 perform 1 from public.reader_collection_policies where user_id=subject for update;
end;
$$;
revoke all on function recap_internal.lock_own_hourly_policy() from public,anon,authenticated,service_role;
grant execute on function recap_internal.lock_own_hourly_policy() to authenticated;
comment on function recap_internal.lock_own_hourly_policy() is 'Internal owner-only transaction lock for clear_reader_workspace. No arbitrary user argument and no policy changes. Not in the exposed public schema.';
create or replace function public.clear_reader_workspace(p_expected_updated_at timestamptz,p_next_state jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare subject text; current_revision timestamptz; next_revision timestamptz;
begin
 subject := auth.jwt()->>'sub';
 if subject is null or length(subject) not between 1 and 200 then raise exception 'Sign in required' using errcode='PT401'; end if;
 if p_expected_updated_at is null then raise exception 'Saved revision required' using errcode='PT409'; end if;
 -- Match provider reservation order before any archive invalidation can lock source state.
 perform recap_internal.lock_own_hourly_policy();
 select w.updated_at into current_revision from public.reader_workspaces w where w.user_id=subject for update;
 if current_revision is null or current_revision<>p_expected_updated_at then raise exception 'Workspace changed; reload before clearing history' using errcode='PT409'; end if;
 if p_next_state is not null and jsonb_typeof(p_next_state)<>'object' then raise exception 'Invalid workspace' using errcode='PT400'; end if;
 delete from public.reader_source_updates a where a.user_id=subject;
 if p_next_state is null then
   delete from public.reader_workspaces w where w.user_id=subject;
 else
   update public.reader_workspaces w set state=p_next_state where w.user_id=subject returning w.updated_at into next_revision;
 end if;
 return jsonb_build_object('updatedAt',next_revision);
end;
$$;
revoke all on function public.clear_reader_workspace(timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.clear_reader_workspace(timestamptz,jsonb) to authenticated;
comment on function public.clear_reader_workspace(timestamptz,jsonb) is 'Atomic owner-scoped revision-checked archive and workspace reset/delete. A stale tab fails before deleting history.';
commit;
