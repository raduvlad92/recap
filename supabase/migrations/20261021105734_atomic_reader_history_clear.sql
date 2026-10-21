-- D22: guard user-owned optional metadata and clear workspace/history in one CAS transaction.
begin;
create or replace function public.admin_workspace_summaries(p_user_ids text[])
returns table(user_id text,state jsonb,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
 select w.user_id,jsonb_build_object('followedSourceIds',w.state->'followedSourceIds','customSources',w.state->'customSources',
 'customCreators',coalesce((select jsonb_agg(jsonb_build_object('id',c->'id','name',c->'name')) from jsonb_array_elements(case when jsonb_typeof(w.state->'customCreators')='array' then w.state->'customCreators' else '[]'::jsonb end) c where jsonb_typeof(c)='object'),'[]'::jsonb),
 'savedCount',jsonb_array_length(w.state->'savedUpdateIds'),'readLaterCount',jsonb_array_length(w.state->'readLaterIds'),
 'importedCount',(select count(*) from (
   select item->>'id' as id from jsonb_array_elements(w.state->'importedUpdates') item
   union select a.id from public.reader_source_updates a where a.user_id=w.user_id
 ) updates), 'settings',w.state->'settings'),w.updated_at
 from public.reader_workspaces w where w.user_id = any(p_user_ids) and cardinality(p_user_ids) <= 100;
$$;
revoke all on function public.admin_workspace_summaries(text[]) from public,anon,authenticated;
grant execute on function public.admin_workspace_summaries(text[]) to service_role;

-- Ordinary readers receive authority only over their own existing workspace.
-- A missing/stale revision fails before any archive rows are removed.
create function public.clear_reader_workspace(p_expected_updated_at timestamptz,p_next_state jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare subject text; current_revision timestamptz; next_revision timestamptz;
begin
 subject := auth.jwt()->>'sub';
 if subject is null or length(subject) not between 1 and 200 then raise exception 'Sign in required' using errcode='PT401'; end if;
 if p_expected_updated_at is null then raise exception 'Saved revision required' using errcode='PT409'; end if;
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
