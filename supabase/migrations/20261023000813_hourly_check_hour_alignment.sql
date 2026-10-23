-- Keep the next check on the next UTC hour boundary. Using finish +55 minutes
-- can skip an entire scheduled hour after a slow collection or manual first run.
begin;
create function public.align_hourly_next_check() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.last_checked_at is not null and new.last_checked_at is distinct from old.last_checked_at then
  new.next_check_at := (date_trunc('hour',new.last_checked_at at time zone 'UTC')+interval '1 hour') at time zone 'UTC';
 end if;
 return new;
end;
$$;
revoke all on function public.align_hourly_next_check() from public,anon,authenticated,service_role;
create trigger align_hourly_next_check before update on public.reader_collection_source_state for each row execute function public.align_hourly_next_check();
commit;
