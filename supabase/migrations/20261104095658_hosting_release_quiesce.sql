-- Deployment coordination only. No content/financial/reader rows are changed.
begin;
create index hosting_work_queued on public.hosting_work(key) where state='queued';

create function public.read_hosting_release_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('control',public.read_hosting_runtime(),'work',jsonb_build_object(
  'queued',(select count(*) from public.hosting_work where state='queued'),
  'running',(select count(*) from public.hosting_work where state='running'),
  'expired_running',(select count(*) from public.hosting_work where state='running' and lease_until<now()),
  'uncertain',(select count(*) from public.hosting_work where state='uncertain')))
$$;

create function public.quiesce_hosting_release(p_expected_epoch bigint,p_expected_release text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 -- PostgREST uses READ COMMITTED. Refuse a stale repeatable-read snapshot.
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Release requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_epoch is null or p_expected_release is null
  or c.owner<>'cloudflare' or not c.old_host_fenced
  or c.epoch<>p_expected_epoch or c.release<>p_expected_release then
  raise exception 'Hosting release changed or is not fenced';
 end if;
 -- admit_hosting_work takes FOR SHARE on this same control row. Once this
 -- lock is acquired, every earlier admission is visible and new ones wait.
 if exists(select 1 from public.hosting_work where state='queued') then
  raise exception 'Drain queued hosting work before pausing';
 end if;
 if not c.paused then update public.hosting_runtime_control set paused=true,updated_at=now() where singleton; end if;
 return public.read_hosting_release_status();
end $$;

revoke all on function public.read_hosting_release_status(),public.quiesce_hosting_release(bigint,text) from public,anon,authenticated;
grant execute on function public.read_hosting_release_status(),public.quiesce_hosting_release(bigint,text) to service_role;
commit;
