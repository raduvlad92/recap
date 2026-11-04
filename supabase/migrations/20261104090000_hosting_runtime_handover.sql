-- Hosting transport only. Existing catalogue, reader, source, financial and
-- publication records are untouched. Execution remains paused after apply.
begin;
create table public.hosting_runtime_control (
  singleton boolean primary key default true check (singleton),
  owner text not null check (owner in ('netlify','cloudflare')),
  epoch bigint not null check (epoch > 0),
  paused boolean not null default true,
  release text not null check (release ~ '^[a-f0-9]{40}$'),
  old_host_fenced boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.hosting_runtime_control(singleton,owner,epoch,paused,release,old_host_fenced)
values(true,'netlify',1,true,'0000000000000000000000000000000000000000',false);
create table public.hosting_work (
  key text primary key check (length(key) between 1 and 180),
  kind text not null check (kind in ('http','hourly-collection','content-analysis','automatic-content','social-collection','social-content','daily-briefing','recap-reminders','keyword-learning')),
  epoch bigint not null,
  release text not null check (release ~ '^[a-f0-9]{40}$'),
  state text not null check (state in ('queued','running','completed','uncertain')),
  lease_token uuid,
  lease_until timestamptz,
  payload jsonb check (payload is null or octet_length(payload::text) <= 230000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hosting_work_active on public.hosting_work(kind,lease_until) where state='running';
alter table public.hosting_runtime_control enable row level security;
alter table public.hosting_work enable row level security;
revoke all on public.hosting_runtime_control,public.hosting_work from public,anon,authenticated,service_role;

create function public.read_hosting_runtime() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('owner',owner,'epoch',epoch,'paused',paused,'release',release,'old_host_fenced',old_host_fenced)
 from public.hosting_runtime_control where singleton
$$;
create function public.admit_hosting_work(p_key text,p_kind text,p_epoch bigint,p_release text,p_payload jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.hosting_runtime_control; w public.hosting_work;
begin
 select * into strict c from public.hosting_runtime_control where singleton for share;
 if p_epoch is null or p_release is null or p_key is null or p_kind is null then raise exception 'Invalid hosting identity'; end if;
 if c.owner<>'cloudflare' or c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting runtime is paused or stale'; end if;
 if p_key !~ '^[a-z0-9:-]{1,180}$' or (p_payload is not null and p_kind<>'keyword-learning') then raise exception 'Invalid hosting work'; end if;
 insert into public.hosting_work(key,kind,epoch,release,state,payload) values(p_key,p_kind,p_epoch,p_release,'queued',p_payload) on conflict do nothing;
 select * into strict w from public.hosting_work where key=p_key;
 if w.kind<>p_kind or w.epoch<>p_epoch or w.release<>p_release or w.payload is distinct from p_payload then raise exception 'Hosting identity conflict'; end if;
 return w.state='queued';
end $$;
create function public.begin_hosting_work(p_key text,p_kind text,p_epoch bigint,p_release text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hosting_runtime_control; w public.hosting_work; token uuid;
begin
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_epoch is null or p_release is null or p_key is null or p_kind is null then raise exception 'Invalid hosting identity'; end if;
 if c.owner<>'cloudflare' or c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting runtime is paused or stale'; end if;
 select * into w from public.hosting_work where key=p_key for update;
 if not found or w.state<>'queued' or w.epoch<>p_epoch or w.release<>p_release or w.kind<>p_kind then return null; end if;
 -- Serialize long batches of the same pipeline, including delayed/repeated ticks.
 if w.kind<>'http' and exists(select 1 from public.hosting_work where kind=w.kind and state='running') then return jsonb_build_object('busy',true); end if;
 token:=gen_random_uuid();
 update public.hosting_work set state='running',lease_token=token,lease_until=now()+interval '15 minutes',updated_at=now() where key=p_key;
 return jsonb_build_object('token',token,'payload',w.payload);
end $$;
create function public.finish_hosting_work(p_key text,p_token uuid,p_epoch bigint,p_completed boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.hosting_work set state=case when p_completed then 'completed' else 'uncertain' end,
  payload=case when p_completed then null else payload end,updated_at=now()
 where key=p_key and epoch=p_epoch and lease_token=p_token and state='running';
 if not found then raise exception 'Hosting lease changed'; end if;
 -- HTTP frames only coordinate a drain; domain audit/financial receipts remain
 -- authoritative. Avoid retaining a new hosting row for each polling read.
 delete from public.hosting_work where key=p_key and lease_token=p_token and kind='http' and state='completed';
end $$;

-- The operator must first verify old-host disablement/credential fencing and
-- drain active work. Pause/unpause retains the epoch; ownership/release changes
-- advance it. No source or budget state is reset by a hosting switch.
create function public.change_hosting_runtime(p_expected_owner text,p_expected_epoch bigint,p_owner text,p_release text,p_paused boolean,p_old_host_fenced boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.hosting_runtime_control;
begin
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_expected_owner is null or p_expected_epoch is null or p_owner is null or p_release is null or p_paused is null or p_old_host_fenced is null then raise exception 'Invalid hosting transition'; end if;
 if c.owner<>p_expected_owner or c.epoch<>p_expected_epoch then raise exception 'Hosting runtime changed'; end if;
 if p_owner not in ('netlify','cloudflare') or p_release !~ '^[a-f0-9]{40}$' then raise exception 'Invalid hosting target'; end if;
 if (p_owner<>c.owner or p_release<>c.release) and not c.paused then raise exception 'Pause admission first'; end if;
 if (p_owner<>c.owner or p_release<>c.release) and exists(select 1 from public.hosting_work where state='running') then raise exception 'Drain hosting work first'; end if;
 if p_owner='cloudflare' and not p_paused and not p_old_host_fenced then raise exception 'Old host must be fenced'; end if;
 update public.hosting_runtime_control set owner=p_owner,release=p_release,paused=p_paused,old_host_fenced=p_old_host_fenced,
  epoch=case when p_owner<>c.owner or p_release<>c.release then epoch+1 else epoch end,updated_at=now() where singleton;
 return public.read_hosting_runtime();
end $$;
revoke all on function public.read_hosting_runtime(),public.admit_hosting_work(text,text,bigint,text,jsonb),public.begin_hosting_work(text,text,bigint,text),public.finish_hosting_work(text,uuid,bigint,boolean),public.change_hosting_runtime(text,bigint,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.read_hosting_runtime(),public.admit_hosting_work(text,text,bigint,text,jsonb),public.begin_hosting_work(text,text,bigint,text),public.finish_hosting_work(text,uuid,bigint,boolean),public.change_hosting_runtime(text,bigint,text,text,boolean,boolean) to service_role;
commit;
