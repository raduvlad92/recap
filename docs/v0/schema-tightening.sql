-- Follow-up for the initial v0 schema only. Reject JSON null/string versions
-- rather than relying on SQL CHECK's acceptance of an unknown (NULL) result.
begin;
alter table public.reader_workspaces drop constraint if exists reader_workspace_v1;
alter table public.reader_workspaces add constraint reader_workspace_v1 check (
  coalesce(
    jsonb_typeof(state) = 'object'
    and state->'version' = '1'::jsonb
    and jsonb_typeof(state->'followedSourceIds') = 'array'
    and jsonb_typeof(state->'savedUpdateIds') = 'array'
    and jsonb_typeof(state->'readLaterIds') = 'array'
    and jsonb_typeof(state->'settings') = 'object'
    and jsonb_typeof(state->'customSources') = 'array'
    and jsonb_typeof(state->'importedUpdates') = 'array'
    and state ?& array['version', 'followedSourceIds', 'savedUpdateIds', 'readLaterIds', 'settings', 'customSources', 'importedUpdates'],
    false
  )
);
commit;
