-- D22: only metadata/counts reach the owner admin; private collected text stays out.
begin;
create or replace function public.admin_workspace_summaries(p_user_ids text[])
returns table(user_id text,state jsonb,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
 select w.user_id,jsonb_build_object('followedSourceIds',w.state->'followedSourceIds','customSources',w.state->'customSources',
 'customCreators',coalesce((select jsonb_agg(jsonb_build_object('id',c->'id','name',c->'name')) from jsonb_array_elements(coalesce(w.state->'customCreators','[]'::jsonb)) c),'[]'::jsonb),
 'savedCount',jsonb_array_length(w.state->'savedUpdateIds'),'readLaterCount',jsonb_array_length(w.state->'readLaterIds'),
 'importedCount',(select count(*) from (
   select item->>'id' as id from jsonb_array_elements(w.state->'importedUpdates') item
   union select a.id from public.reader_source_updates a where a.user_id=w.user_id
 ) updates), 'settings',w.state->'settings'),w.updated_at
 from public.reader_workspaces w where w.user_id = any(p_user_ids) and cardinality(p_user_ids) <= 100;
$$;
revoke all on function public.admin_workspace_summaries(text[]) from public,anon,authenticated;
grant execute on function public.admin_workspace_summaries(text[]) to service_role;
commit;
