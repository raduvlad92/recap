-- Long existing captions can exceed 150k bytes even within the collector's
-- 200k-character excerpt limit. Retain them without silently trimming records.
begin;
alter table public.reader_source_updates drop constraint reader_source_update_size;
alter table public.reader_source_updates add constraint reader_source_update_size
 check (octet_length(record::text)<=1000000);
comment on table public.reader_source_updates is 'Private collected source updates. Ordinary readers may read/delete their own rows; only the server imports/upserts. No public catalogue access. One-megabyte UTF-8 JSON limit supports long caption excerpts; oversized records fail explicitly.';
commit;
