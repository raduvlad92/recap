-- Release metadata only. Original reader/content/financial tables are untouched.
begin;
alter table public.hosting_runtime_control add column release_revision uuid not null default gen_random_uuid();
create function public.bump_hosting_release_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.release_revision is not distinct from old.release_revision then new.release_revision:=gen_random_uuid(); end if;
 return new;
end $$;
revoke all on function public.bump_hosting_release_revision() from public,anon,authenticated,service_role;
create trigger hosting_release_revision before update on public.hosting_runtime_control for each row execute function public.bump_hosting_release_revision();

create or replace function public.read_hosting_release_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('control',public.read_hosting_runtime(),'revision',(select release_revision from public.hosting_runtime_control where singleton),'work',jsonb_build_object(
  'queued',(select count(*) from public.hosting_work where state='queued'),
  'running',(select count(*) from public.hosting_work where state='running'),
  'expired_running',(select count(*) from public.hosting_work where state='running' and lease_until<now()),
  'uncertain',(select count(*) from public.hosting_work where state='uncertain')))
$$;

-- Existing operator pause calls also invalidate a release, even when already paused.
create or replace function public.quiesce_hosting_release(p_expected_epoch bigint,p_expected_release text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Release requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_epoch is null or p_expected_release is null or c.owner<>'cloudflare' or not c.old_host_fenced or c.epoch<>p_expected_epoch or c.release<>p_expected_release then raise exception 'Hosting release changed or is not fenced'; end if;
 if exists(select 1 from public.hosting_work where state='queued') then raise exception 'Drain queued hosting work before pausing'; end if;
 update public.hosting_runtime_control set paused=true,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;

create function public.quiesce_hosting_release_checked(p_expected_epoch bigint,p_expected_release text,p_expected_revision uuid,p_next_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Release requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_epoch is null or p_expected_release is null or p_expected_revision is null or p_next_revision is null or p_next_revision=p_expected_revision or c.owner<>'cloudflare' or not c.old_host_fenced or c.epoch<>p_expected_epoch or c.release<>p_expected_release then raise exception 'Hosting release changed or is not fenced'; end if;
 if c.release_revision=p_next_revision and c.paused then return public.read_hosting_release_status(); end if;
 if c.release_revision<>p_expected_revision then raise exception 'Hosting release revision changed'; end if;
 if exists(select 1 from public.hosting_work where state='queued') then raise exception 'Drain queued hosting work before pausing'; end if;
 update public.hosting_runtime_control set paused=true,release_revision=p_next_revision,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;

create function public.advance_hosting_release_checked(p_expected_epoch bigint,p_expected_release text,p_expected_revision uuid,p_release text,p_resume boolean,p_next_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control; next_epoch bigint;
begin
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_epoch is null or p_expected_release is null or p_expected_revision is null or p_next_revision is null or p_next_revision=p_expected_revision or p_resume is null or p_release is null or p_release !~ '^[a-f0-9]{40}$' or c.owner<>'cloudflare' or not c.old_host_fenced or (p_resume and p_release<>p_expected_release) then raise exception 'Invalid fenced release transition'; end if;
 next_epoch:=p_expected_epoch+case when p_release<>p_expected_release then 1 else 0 end;
 if c.release_revision=p_next_revision and c.epoch=next_epoch and c.release=p_release and c.paused=(not p_resume) then return public.read_hosting_release_status(); end if;
 if c.epoch<>p_expected_epoch or c.release<>p_expected_release or c.release_revision<>p_expected_revision or not c.paused then raise exception 'Hosting release revision changed'; end if;
 if exists(select 1 from public.hosting_work where state in ('queued','running')) then raise exception 'Drain hosting work first'; end if;
 update public.hosting_runtime_control set release=p_release,epoch=next_epoch,paused=not p_resume,release_revision=p_next_revision,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;
revoke all on function public.read_hosting_release_status(),public.quiesce_hosting_release(bigint,text),public.quiesce_hosting_release_checked(bigint,text,uuid,uuid),public.advance_hosting_release_checked(bigint,text,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.read_hosting_release_status(),public.quiesce_hosting_release(bigint,text),public.quiesce_hosting_release_checked(bigint,text,uuid,uuid),public.advance_hosting_release_checked(bigint,text,uuid,text,boolean,uuid) to service_role;
commit;
