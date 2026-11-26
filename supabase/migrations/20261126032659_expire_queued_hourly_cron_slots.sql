-- Leave overdue hourly cron slots in the ledger without claiming or replaying them.
-- Existing running leases and all source/provider receipts retain their own bounds.
begin;

create or replace function public.begin_hosting_work(p_key text,p_kind text,p_epoch bigint,p_release text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hosting_runtime_control; w public.hosting_work; token uuid; claimed_at timestamptz:=now();
begin
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_epoch is null or p_release is null or p_key is null or p_kind is null then raise exception 'Invalid hosting identity'; end if;
 if c.owner<>'cloudflare' or c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting runtime is paused or stale'; end if;
 select * into w from public.hosting_work where key=p_key for update;
 if not found or w.epoch<>p_epoch or w.release<>p_release or w.kind<>p_kind then return null; end if;
 if w.kind='hourly-collection' and w.state in ('queued','running') then
  -- This lease starts inside the queue invocation and covers its 15-minute
  -- wall-time limit. Preserve the original token and deadline as evidence.
  claimed_at:=clock_timestamp();
  update public.hosting_work
  set state='uncertain',updated_at=claimed_at
  where kind=w.kind and epoch=w.epoch and release=w.release and state='running'
   and lease_token is not null and lease_until<=claimed_at
   and (w.state='queued' or key=w.key);
  if w.state='queued' then
   -- A missed cron slot cannot make useful progress under its original
   -- deadline. Retire it even if its native queue message was lost.
   update public.hosting_work
   set state='uncertain',updated_at=claimed_at
   where kind=w.kind and epoch=w.epoch and release=w.release and state='queued'
     and lease_token is null and lease_until is null
     and to_timestamp(substring(key from
       '^cron:hourly-collection:' || w.epoch::text || ':([0-9]{1,10})$')::bigint * 300)
       + interval '15 minutes' <= claimed_at;
   if not exists(select 1 from public.hosting_work where key=p_key and state='queued') then return null; end if;
  end if;
 end if;
 if w.state<>'queued' then return null; end if;
 -- Live leases, and running rows without a provable deadline, still serialize.
 if w.kind<>'http' and exists(select 1 from public.hosting_work where kind=w.kind and state='running') then return jsonb_build_object('busy',true); end if;
 token:=gen_random_uuid();
 update public.hosting_work set state='running',lease_token=token,lease_until=claimed_at+interval '15 minutes',updated_at=claimed_at where key=p_key;
 return jsonb_build_object('token',token,'payload',w.payload);
end $$;

commit;
