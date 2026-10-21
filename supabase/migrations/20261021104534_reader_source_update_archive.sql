-- D22: private per-reader source material is stored separately from the small
-- workspace document. This migration adds structure only; it does not collect.
begin;
create table public.reader_source_updates (
  user_id text not null check (length(user_id) between 1 and 200),
  id text not null check (length(id) between 1 and 200),
  source_id text not null check (length(source_id) between 1 and 120),
  collection_id text not null check (length(collection_id) between 1 and 120),
  published_at timestamptz not null,
  record jsonb not null,
  collected_at timestamptz not null default clock_timestamp(),
  primary key(user_id,id),
  constraint reader_source_update_size check (octet_length(record::text)<=150000),
  constraint reader_source_update_object check (
    jsonb_typeof(record)='object' and record ?& array['id','sourceId','publishedAt','isSample']
    and jsonb_typeof(record->'id')='string' and jsonb_typeof(record->'sourceId')='string'
    and jsonb_typeof(record->'publishedAt')='string' and record->'isSample'='false'::jsonb
    and record->>'id'=id and record->>'sourceId'=source_id
  ),
  constraint reader_source_update_date check (
    (record->>'publishedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
    and (record->>'publishedAt')::timestamptz=published_at
  )
);
create index reader_source_updates_collection_date_idx on public.reader_source_updates(user_id,collection_id,published_at desc,id);
alter table public.reader_source_updates enable row level security;
revoke all on table public.reader_source_updates from public,anon,authenticated,service_role;
grant select,delete on table public.reader_source_updates to authenticated;
grant select,insert,update,delete on table public.reader_source_updates to service_role;
create policy reader_source_updates_own_select on public.reader_source_updates for select to authenticated
  using ((select auth.jwt()->>'sub')=user_id);
create policy reader_source_updates_own_delete on public.reader_source_updates for delete to authenticated
  using ((select auth.jwt()->>'sub')=user_id);
comment on table public.reader_source_updates is 'Private collected source updates. Ordinary readers may read/delete their own rows; only the server imports/upserts. No public catalogue access. Oversized records fail instead of being silently truncated.';
commit;
