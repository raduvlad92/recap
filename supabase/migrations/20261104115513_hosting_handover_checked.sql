-- Initial handover metadata only; this function cannot resume processing.
-- The trusted coordinator must independently verify the external old-host fence.
begin;
create function public.commit_hosting_handover_checked(p_expected_epoch bigint,p_expected_release text,p_expected_revision uuid,p_release text,p_old_host_fenced boolean,p_next_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Handover requires read committed'; end if;
 if p_expected_epoch is null or p_expected_release is null or p_expected_revision is null or p_next_revision is null or p_next_revision=p_expected_revision or p_release is null or p_release !~ '^[a-f0-9]{40}$' or p_old_host_fenced is distinct from true then raise exception 'Invalid fenced handover'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if c.owner='cloudflare' and c.epoch=p_expected_epoch+1 and c.release=p_release and c.paused and c.old_host_fenced and c.release_revision=p_next_revision then return public.read_hosting_release_status(); end if;
 if c.owner<>'netlify' or c.epoch<>p_expected_epoch or c.release<>p_expected_release or c.release_revision<>p_expected_revision or not c.paused then raise exception 'Handover state changed'; end if;
 if exists(select 1 from public.hosting_work where state in ('queued','running','uncertain')) then raise exception 'Resolve hosting work before initial handover'; end if;
 update public.hosting_runtime_control set owner='cloudflare',epoch=epoch+1,release=p_release,paused=true,old_host_fenced=true,release_revision=p_next_revision,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;
revoke all on function public.commit_hosting_handover_checked(bigint,text,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.commit_hosting_handover_checked(bigint,text,uuid,text,boolean,uuid) to service_role;
commit;
