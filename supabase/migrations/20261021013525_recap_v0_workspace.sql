-- therecap functioning v0: apply only to the founder-selected recap Supabase project.
-- Clerk native third-party auth must be configured first. Use the Clerk subject
-- as text; auth.uid() expects a UUID and is not appropriate for Clerk user IDs.
-- Public clients use only the publishable key and their Clerk session token.
begin;

create table if not exists public.reader_workspaces (
  user_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint reader_workspace_owner_length check (char_length(user_id) between 1 and 200),
  constraint reader_workspace_v1 check (
    jsonb_typeof(state) = 'object'
    and state->>'version' = '1'
    and jsonb_typeof(state->'followedSourceIds') = 'array'
    and jsonb_typeof(state->'savedUpdateIds') = 'array'
    and jsonb_typeof(state->'readLaterIds') = 'array'
    and jsonb_typeof(state->'settings') = 'object'
    and jsonb_typeof(state->'customSources') = 'array'
    and jsonb_typeof(state->'importedUpdates') = 'array'
    and state ?& array['version', 'followedSourceIds', 'savedUpdateIds', 'readLaterIds', 'settings', 'customSources', 'importedUpdates']
  ),
  constraint reader_workspace_size check (octet_length(state::text) <= 2000000)
);

alter table public.reader_workspaces enable row level security;
revoke all on table public.reader_workspaces from anon;
grant select, insert, update, delete on table public.reader_workspaces to authenticated;

drop policy if exists reader_workspace_select on public.reader_workspaces;
create policy reader_workspace_select on public.reader_workspaces for select to authenticated
  using ((select auth.jwt()->>'sub') = user_id);
drop policy if exists reader_workspace_insert on public.reader_workspaces;
create policy reader_workspace_insert on public.reader_workspaces for insert to authenticated
  with check ((select auth.jwt()->>'sub') = user_id);
drop policy if exists reader_workspace_update on public.reader_workspaces;
create policy reader_workspace_update on public.reader_workspaces for update to authenticated
  using ((select auth.jwt()->>'sub') = user_id)
  with check ((select auth.jwt()->>'sub') = user_id);
drop policy if exists reader_workspace_delete on public.reader_workspaces;
create policy reader_workspace_delete on public.reader_workspaces for delete to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

-- Server timestamps are the optimistic concurrency token; clients cannot choose them.
create or replace function public.reader_workspace_set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.reader_workspace_set_updated_at() from public, anon, authenticated;
drop trigger if exists reader_workspace_updated_at on public.reader_workspaces;
create trigger reader_workspace_updated_at before insert or update on public.reader_workspaces
for each row execute function public.reader_workspace_set_updated_at();

commit;

-- Verify after applying (authenticated browser test required, not a schema-only pass):
-- 1. Guest cannot SELECT/INSERT/UPDATE/DELETE rows.
-- 2. Account A can save and reload only its own row.
-- 3. A token cannot read/change/delete Account B's user_id or reassign its owner.
-- 4. A stale updated_at conditional UPDATE returns no row and the UI shows conflict.
-- 5. Account switch/sign-out never imports guest or another account's state.
