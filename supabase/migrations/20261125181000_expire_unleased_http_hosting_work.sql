-- A web request can disappear after HTTP admission and before its lease.
-- Expire only empty, unleased HTTP rows. Keep the originals as uncertain.
-- Installing these definitions does not transition any existing rows.
begin;

create function recap_internal.unleased_http_hosting_work(p_work public.hosting_work) returns boolean
language sql immutable strict set search_path='' as $$
 select p_work.kind='http' and p_work.state='queued'
   and p_work.lease_token is null and p_work.lease_until is null and p_work.payload is null;
$$;

-- Invoked with the hosting control row locked, in the same lock order as
-- admission and claims. Completed HTTP rows keep their existing lifecycle.
create function recap_internal.retire_unleased_http_hosting_work(p_cutoff timestamptz) returns void
language sql set search_path='' as $$
 update public.hosting_work w set state='uncertain',updated_at=clock_timestamp()
 where w.state='queued' and w.kind='http' and w.created_at<=p_cutoff
  and recap_internal.unleased_http_hosting_work(w);
$$;

revoke all on function recap_internal.unleased_http_hosting_work(public.hosting_work),
 recap_internal.retire_unleased_http_hosting_work(timestamptz) from public,anon,authenticated,service_role;

-- Ordinary releases can fence unleased HTTP during checked quiesce.
-- The existing status RPC retains raw counts for handover and audit callers.
create function public.read_hosting_release_drain_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_set(public.read_hosting_release_status(),'{work,queued}',to_jsonb(count(*)))
 from public.hosting_work w
 where w.state='queued' and not recap_internal.unleased_http_hosting_work(w);
$$;

revoke all on function public.read_hosting_release_drain_status() from public,anon,authenticated,service_role;
grant execute on function public.read_hosting_release_drain_status() to service_role;

create or replace function public.begin_hosting_work(p_key text,p_kind text,p_epoch bigint,p_release text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hosting_runtime_control; w public.hosting_work; token uuid; claimed_at timestamptz:=now();
begin
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_epoch is null or p_release is null or p_key is null or p_kind is null then raise exception 'Invalid hosting identity'; end if;
 if c.owner<>'cloudflare' or c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting runtime is paused or stale'; end if;
 select * into w from public.hosting_work where key=p_key for update;
 if not found or w.epoch<>p_epoch or w.release<>p_release or w.kind<>p_kind then return null; end if;
 if recap_internal.unleased_http_hosting_work(w) and w.created_at<=clock_timestamp()-interval '60 seconds' then
  update public.hosting_work set state='uncertain',updated_at=clock_timestamp() where key=w.key;
  return null;
 end if;
 if w.kind='hourly-collection' and w.state in ('queued','running') then
  perform recap_internal.retire_unleased_http_hosting_work(clock_timestamp()-interval '60 seconds');
  -- This lease starts inside the queue invocation and covers its 15-minute
  -- wall-time limit. Preserve the original token and deadline as evidence.
  claimed_at:=clock_timestamp();
  update public.hosting_work
  set state='uncertain',updated_at=claimed_at
  where kind=w.kind and epoch=w.epoch and release=w.release and state='running'
   and lease_token is not null and lease_until<=claimed_at
   and (w.state='queued' or key=w.key);
 end if;
 if w.state<>'queued' then return null; end if;
 -- Live leases, and running rows without a provable deadline, still serialize.
 if w.kind<>'http' and exists(select 1 from public.hosting_work where kind=w.kind and state='running') then return jsonb_build_object('busy',true); end if;
 token:=gen_random_uuid();
 update public.hosting_work set state='running',lease_token=token,lease_until=claimed_at+interval '15 minutes',updated_at=claimed_at where key=p_key;
 return jsonb_build_object('token',token,'payload',w.payload);
end $$;

create or replace function public.quiesce_hosting_release_checked(p_expected_epoch bigint,p_expected_release text,p_expected_revision uuid,p_next_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Release requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_epoch is null or p_expected_release is null or p_expected_revision is null or p_next_revision is null or p_next_revision=p_expected_revision or c.owner<>'cloudflare' or not c.old_host_fenced or c.epoch<>p_expected_epoch or c.release<>p_expected_release then raise exception 'Hosting release changed or is not fenced'; end if;
 if c.release_revision=p_next_revision and c.paused then return public.read_hosting_release_status(); end if;
 if c.release_revision<>p_expected_revision then raise exception 'Hosting release revision changed'; end if;
 if exists(select 1 from public.hosting_work w where w.state='queued' and not recap_internal.unleased_http_hosting_work(w)) then raise exception 'Drain queued hosting work before pausing'; end if;
 -- Holding the admission lock fences any late HTTP lease. The original
 -- request will see the pause and its handler cannot start.
 perform recap_internal.retire_unleased_http_hosting_work(clock_timestamp());
 update public.hosting_runtime_control set paused=true,release_revision=p_next_revision,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;

commit;
