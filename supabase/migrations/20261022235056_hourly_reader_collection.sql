-- Hourly checks for explicitly enabled readers only. No policy rows, provider
-- calls or schedules are activated by this schema migration.
begin;
create table public.reader_collection_policies (
 user_id text primary key check(length(user_id) between 1 and 200),
 enabled boolean not null default false,
 provider_enabled boolean not null default false,
 daily_limit_usd numeric(12,6) not null default 0.10 check(daily_limit_usd>0 and daily_limit_usd<=0.10),
 lifetime_limit_usd numeric(12,6) not null default 1.00 check(lifetime_limit_usd>0 and lifetime_limit_usd<=45),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.reader_collection_checks (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public.reader_collection_policies(user_id),
 source_id text not null check(length(source_id) between 1 and 120),
 source_name text not null, source_url text not null, platform text not null, workspace_revision timestamptz,
 status text not null default 'running' check(status in ('running','unchanged','collected','partial','unsupported','blocked','failed','abandoned')),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 duration_ms bigint check(duration_ms>=0), new_count integer not null default 0 check(new_count>=0),
 retrieved_count integer not null default 0 check(retrieved_count>=0), http_status integer,
 error_code text check(error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 provider text not null default 'native' check(provider in ('native','apify','none')),
 job_id uuid references public.collection_jobs(id), provider_run_id text,
 observed_cost_usd numeric(24,12) default 0 check(observed_cost_usd>=0),
 cost_status text not null default 'no_provider_charge' check(cost_status in ('no_provider_charge','provider_reported','unknown')),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=100000),
 check((cost_status='unknown' and observed_cost_usd is null) or (cost_status='no_provider_charge' and observed_cost_usd=0) or (cost_status='provider_reported' and observed_cost_usd is not null))
);
create index reader_collection_checks_owner_date on public.reader_collection_checks(user_id,started_at desc,id);
create table public.reader_collection_source_state (
 user_id text not null references public.reader_collection_policies(user_id),
 source_id text not null, fingerprint text not null, collection_id text not null default 'hourly',
 channel_id text, feed_url text, etag text, last_modified text, content_hash text,
 initialized_at timestamptz not null default clock_timestamp(), workspace_revision timestamptz, last_checked_at timestamptz,
 next_check_at timestamptz not null default '-infinity', pending_captions jsonb not null default '[]'::jsonb check(jsonb_typeof(pending_captions)='array' and octet_length(pending_captions::text)<=2000000), cursor jsonb not null default '{}'::jsonb,
 lease_token uuid, lease_until timestamptz, check_id uuid references public.reader_collection_checks(id),
 primary key(user_id,source_id)
);
create table public.reader_collection_seen_items (
 user_id text not null, source_id text not null, item_key text not null check(length(item_key) between 1 and 2200),
 archive_id text not null, first_seen_at timestamptz not null default clock_timestamp(),
 primary key(user_id,source_id,item_key),
 foreign key(user_id,source_id) references public.reader_collection_source_state(user_id,source_id) on delete cascade
);
create table public.reader_collection_provider_jobs (
 id uuid primary key default gen_random_uuid(), user_id text not null, source_id text not null,
 item_key text not null, source_fingerprint text not null, discard_result boolean not null default false, check_id uuid not null references public.reader_collection_checks(id),
 job_id uuid not null unique references public.collection_jobs(id),
 reservation_id uuid not null unique references public.collection_budget_reservations(id),
 actor_id text not null, maximum_usd numeric(12,6) not null check(maximum_usd>0 and maximum_usd<=0.10),
 state text not null default 'launch_claimed' check(state in ('launch_claimed','running','completed','failed','ambiguous')),
 job_token text, provider_run_id text, observed_cost_usd numeric(24,12) check(observed_cost_usd>=0), actual_cost_usd numeric(24,12) check(actual_cost_usd>=0),
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 foreign key(user_id,source_id) references public.reader_collection_source_state(user_id,source_id),
 unique(user_id,source_id,item_key)
);
create index reader_collection_provider_jobs_owner_date on public.reader_collection_provider_jobs(user_id,created_at);

alter table public.reader_collection_policies enable row level security;
alter table public.reader_collection_checks enable row level security;
alter table public.reader_collection_source_state enable row level security;
alter table public.reader_collection_seen_items enable row level security;
alter table public.reader_collection_provider_jobs enable row level security;
revoke all on public.reader_collection_policies,public.reader_collection_checks,public.reader_collection_source_state,public.reader_collection_seen_items,public.reader_collection_provider_jobs from public,anon,authenticated,service_role;
grant select on public.reader_collection_policies,public.reader_collection_checks to authenticated;
grant select,insert,update,delete on public.reader_collection_policies,public.reader_collection_checks,public.reader_collection_source_state,public.reader_collection_seen_items,public.reader_collection_provider_jobs to service_role;
create policy reader_collection_policies_own_select on public.reader_collection_policies for select to authenticated using((select auth.jwt()->>'sub')=user_id);
create policy reader_collection_checks_own_select on public.reader_collection_checks for select to authenticated using((select auth.jwt()->>'sub')=user_id);

-- Canonical original identities, independent of old tech-/live- archive IDs.
create function public.hourly_item_key(p_url text) returns text language sql immutable security invoker set search_path='' as $$
 select case when p_url ~ '^https://(www\.|m\.)?youtube\.com/watch\?' and substring(p_url from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)') is not null
   then 'youtube:'||substring(p_url from '[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)')
 when p_url ~ '^https://(www\.|m\.)?youtube\.com/(shorts|live)/[A-Za-z0-9_-]{11}' then 'youtube:'||substring(p_url from '/(?:shorts|live)/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
 when p_url ~ '^https://youtu\.be/[A-Za-z0-9_-]{11}' then 'youtube:'||substring(p_url from 'youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
 else regexp_replace(split_part(p_url,'#',1),'/$','') end;
$$;

-- Reads current followed customSources inside the transaction. A stale caller
-- cannot turn a catalogue entry, removed follow or changed URL into a request.
create function public.claim_hourly_source(p_user_id text,p_source_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.reader_collection_source_state; w public.reader_workspaces; source jsonb; fp text; token uuid; event uuid; cid text;
begin
 if not exists(select 1 from public.reader_collection_policies where user_id=p_user_id and enabled) then return null; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for share;
 if w.user_id is null or not (w.state->'followedSourceIds' ? p_source_id) then return null; end if;
 select x into source from jsonb_array_elements(w.state->'customSources') x where x->>'id'=p_source_id limit 1;
 if source is null or source->>'status'='sample' then return null; end if;
 fp:=md5(coalesce(source->>'platform','')||chr(10)||coalesce(source->>'url','')||chr(10)||coalesce(source->>'feedUrl',''));
 select x->>'id' into cid from jsonb_array_elements(coalesce(w.state->'sourceCollections','[]'::jsonb)) x where x->'sourceIds' ? p_source_id limit 1;
 insert into public.reader_collection_source_state(user_id,source_id,fingerprint,collection_id) values(p_user_id,p_source_id,fp,coalesce(cid,'hourly')) on conflict do nothing;
 select * into s from public.reader_collection_source_state where user_id=p_user_id and source_id=p_source_id for update;
 if s.lease_until>clock_timestamp() or s.next_check_at>clock_timestamp() then return null; end if;
 if s.check_id is not null then
  update public.reader_collection_checks set status='abandoned',finished_at=clock_timestamp(),duration_ms=greatest(0,extract(epoch from clock_timestamp()-started_at)*1000),error_code='lease_expired'
   where id=s.check_id and status='running';
 end if;
 if s.fingerprint<>fp then
  update public.reader_collection_source_state set fingerprint=fp,channel_id=null,feed_url=null,etag=null,last_modified=null,content_hash=null,pending_captions='[]'::jsonb,cursor='{}'::jsonb,initialized_at=clock_timestamp()
   where user_id=p_user_id and source_id=p_source_id;
 end if;
 -- Bootstrap from REAL existing archive records on every claim. Repeated runs
 -- are cheap indexed no-ops and include imports that arrived between checks.
 insert into public.reader_collection_seen_items(user_id,source_id,item_key,archive_id)
  select p_user_id,p_source_id,public.hourly_item_key(a.record->>'url'),a.id from public.reader_source_updates a
  where a.user_id=p_user_id and a.source_id=p_source_id and a.record->>'url' like 'https://%' and a.record->'isSample'='false'::jsonb
  on conflict do nothing;
 insert into public.reader_collection_seen_items(user_id,source_id,item_key,archive_id)
  select p_user_id,p_source_id,public.hourly_item_key(x->>'url'),x->>'id'
  from jsonb_array_elements(w.state->'importedUpdates') x where x->>'sourceId'=p_source_id and x->>'url' like 'https://%' and x->'isSample'='false'::jsonb and x->>'id' is not null
  on conflict do nothing;
 token:=gen_random_uuid();
 insert into public.reader_collection_checks(user_id,source_id,source_name,source_url,platform,workspace_revision)
  values(p_user_id,p_source_id,left(coalesce(source->>'name',p_source_id),160),left(coalesce(source->>'url',''),2048),coalesce(source->>'platform','unknown'),w.updated_at) returning id into event;
 update public.reader_collection_source_state set lease_token=token,lease_until=clock_timestamp()+interval '10 minutes',check_id=event,collection_id=coalesce(cid,'hourly'),workspace_revision=w.updated_at
  where user_id=p_user_id and source_id=p_source_id returning * into s;
 return jsonb_build_object('source',source,'state',to_jsonb(s),'checkId',event,'leaseToken',token);
end;
$$;

-- A single atomic archive/cursor/event commit. Lost or expired leases cannot
-- advance validators or overwrite newer history. Never fabricates a date.
create function public.finish_hourly_source(p_check_id uuid,p_lease_token uuid,p_patch jsonb,p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; w public.reader_workspaces; item jsonb; rec jsonb; base_record jsonb; k text; aid text; inserted integer:=0; affected integer; still_followed boolean; fp text;
begin
 select * into e from public.reader_collection_checks where id=p_check_id for update;
 if e.id is null then raise exception 'Check unavailable' using errcode='PT409'; end if;
 select * into w from public.reader_workspaces where user_id=e.user_id for share;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Lease changed' using errcode='PT409'; end if;
 select md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl','')) into fp
  from jsonb_array_elements(coalesce(w.state->'customSources','[]'::jsonb)) x where x->>'id'=e.source_id limit 1;
 still_followed:=coalesce(w.state->'followedSourceIds' ? e.source_id,false) and fp=s.fingerprint and w.updated_at=s.workspace_revision and exists(select 1 from public.reader_collection_policies where user_id=e.user_id and enabled);
 if not still_followed then p_patch:=jsonb_build_object('status','blocked','error_code','source_no_longer_followed'); p_items:='[]'::jsonb; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 or p_patch->>'status' not in ('unchanged','collected','partial','unsupported','blocked','failed') then raise exception 'Invalid check result' using errcode='PT400'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  rec:=item->'record'; k:=public.hourly_item_key(rec->>'url');
  if k is null or item->>'itemKey' is distinct from k or rec->>'sourceId' is distinct from e.source_id or rec->'isSample' is distinct from 'false'::jsonb or rec->>'publishedAt' is null then raise exception 'Invalid archive item' using errcode='PT400'; end if;
  select archive_id into aid from public.reader_collection_seen_items where user_id=e.user_id and source_id=e.source_id and item_key=k;
  if aid is null then
   aid:=rec->>'id';
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    values(e.user_id,aid,e.source_id,s.collection_id,(rec->>'publishedAt')::timestamptz,rec) on conflict(user_id,id) do nothing;
   get diagnostics affected=row_count; inserted:=inserted+affected;
   if affected=0 and not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid and source_id=e.source_id and public.hourly_item_key(record->>'url')=k) then raise exception 'Archive identity collision' using errcode='PT409'; end if;
   insert into public.reader_collection_seen_items(user_id,source_id,item_key,archive_id) values(e.user_id,e.source_id,k,aid) on conflict do nothing;
  elsif rec->>'contentKind'='transcript' and length(rec->>'content')>0 then
   -- A real baseline may still live only in the older workspace JSON. Promote
   -- it with its original identity/annotations before enriching source text.
   if not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid) then
    select x into base_record from jsonb_array_elements(w.state->'importedUpdates') x where x->>'id'=aid and x->>'sourceId'=e.source_id and public.hourly_item_key(x->>'url')=k and x->'isSample'='false'::jsonb limit 1;
    if base_record is not null then
     insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
      values(e.user_id,aid,e.source_id,s.collection_id,(base_record->>'publishedAt')::timestamptz,base_record) on conflict do nothing;
    end if;
   end if;
   -- Preserve existing curated takeaways; only enrich missing source material.
   update public.reader_source_updates set record=record||jsonb_strip_nulls(jsonb_build_object('content',rec->'content','contentKind','transcript','coverage',rec->'coverage','transcriptSegments',rec->'transcriptSegments'))
    where user_id=e.user_id and id=aid and coalesce(record->>'contentKind','metadata_only')<>'transcript';
   get diagnostics affected=row_count; inserted:=inserted+affected;
  end if;
 end loop;
 update public.reader_collection_checks set status=p_patch->>'status',finished_at=clock_timestamp(),duration_ms=greatest(0,extract(epoch from clock_timestamp()-started_at)*1000),
  new_count=coalesce((p_patch->>'new_count')::integer,0),retrieved_count=inserted,http_status=(p_patch->>'http_status')::integer,error_code=p_patch->>'error_code',
  provider=coalesce(p_patch->>'provider','native'),job_id=(p_patch->>'job_id')::uuid,provider_run_id=p_patch->>'provider_run_id',
  observed_cost_usd=case when p_patch->>'cost_status'='unknown' then null else coalesce((p_patch->>'observed_cost_usd')::numeric,0) end,
  cost_status=coalesce(p_patch->>'cost_status','no_provider_charge'),details=coalesce(p_patch->'details','{}'::jsonb) where id=e.id;
 update public.reader_collection_source_state set lease_token=null,lease_until=null,check_id=null,last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '55 minutes',
  channel_id=coalesce(p_patch->>'channel_id',channel_id), feed_url=coalesce(p_patch->>'feed_url',feed_url),
  etag=case when p_patch ? 'etag' then p_patch->>'etag' else etag end,last_modified=case when p_patch ? 'last_modified' then p_patch->>'last_modified' else last_modified end,
  pending_captions=coalesce(p_patch->'pending_captions',pending_captions),content_hash=coalesce(p_patch->>'content_hash',content_hash),cursor=coalesce(p_patch->'cursor',cursor)
  where user_id=e.user_id and source_id=e.source_id;
 return jsonb_build_object('retrievedCount',inserted,'importAccepted',still_followed);
end;
$$;

-- Both user commitments and the existing global ledger are locked before paid
-- POST authorization. Unknown costs never expire, even at UTC day rollover.
create function public.reserve_hourly_provider(p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_actor_id text,p_maximum_usd numeric,p_parent_reservation_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; p public.reader_collection_policies; r public.collection_budget_reservations; j public.reader_collection_provider_jobs; daily numeric; lifetime numeric; claimed jsonb;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into p from public.reader_collection_policies where user_id=e.user_id for update;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if not coalesce(p.enabled and p.provider_enabled,false) or e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Provider disabled or lease changed' using errcode='PT409'; end if;
 if not exists(select 1 from public.reader_workspaces w where w.user_id=e.user_id and w.updated_at=s.workspace_revision and w.state->'followedSourceIds' ? e.source_id and exists(select 1 from jsonb_array_elements(w.state->'customSources') x where x->>'id'=e.source_id and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)) then raise exception 'Follow changed' using errcode='PT409'; end if;
 if p_item_key is null or p_item_key !~ '^youtube:[A-Za-z0-9_-]{11}$' or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>0.10 then raise exception 'Invalid provider reservation' using errcode='PT400'; end if;
 if not exists(select 1 from public.collection_jobs where id=p_job_id and user_id=e.user_id and source_id=e.source_id and provider='apify' and actor_id=p_actor_id and status='requested') then raise exception 'Job unavailable' using errcode='PT409'; end if;
 select * into j from public.reader_collection_provider_jobs where user_id=e.user_id and source_id=e.source_id and item_key=p_item_key;
 if j.id is not null then return jsonb_build_object('claimed',false,'id',j.id); end if;
 select coalesce(sum(case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd) else greatest(actual_cost_usd,observed_cost_usd) end),0),
  coalesce(sum(case when created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or actual_cost_usd is null then case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd) else greatest(actual_cost_usd,observed_cost_usd) end else 0 end),0)
  into lifetime,daily from public.reader_collection_provider_jobs where user_id=e.user_id;
 if daily+p_maximum_usd>p.daily_limit_usd or lifetime+p_maximum_usd>p.lifetime_limit_usd then raise exception 'Reader budget exhausted' using errcode='PT402'; end if;
 r:=public.reserve_collection_budget('hourly.'||e.id::text||'.'||p_item_key,p_maximum_usd,'job',p_parent_reservation_id,'apify',p_actor_id);
 claimed:=public.claim_collection_budget(r.id);
 if claimed->>'claimed'<>'true' then raise exception 'Launch already claimed' using errcode='PT409'; end if;
 insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd)
  values(e.user_id,e.source_id,p_item_key,s.fingerprint,e.id,p_job_id,r.id,p_actor_id,p_maximum_usd) returning * into j;
 -- Durable pre-POST unknown-cost reference, even if the process dies next.
 update public.reader_collection_checks set provider='apify',observed_cost_usd=null,cost_status='unknown',job_id=p_job_id,
  details=jsonb_set(details,'{providerJobs}',coalesce(details->'providerJobs','[]'::jsonb)||jsonb_build_array(jsonb_build_object('jobId',p_job_id,'providerRunId',null,'actorId',p_actor_id,'itemKey',p_item_key,'reservedUsd',p_maximum_usd,'observedCostUsd',null,'costStatus','unknown'))) where id=e.id;
 return jsonb_build_object('claimed',true,'id',j.id,'reservationId',r.id);
end;
$$;

create function public.hourly_provider_cost_high_water() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.observed_cost_usd:=greatest(old.observed_cost_usd,new.observed_cost_usd,old.actual_cost_usd,new.actual_cost_usd);
 if new.actual_cost_usd is not null then new.actual_cost_usd:=greatest(new.actual_cost_usd,new.observed_cost_usd); end if;
 return new;
end;
$$;
revoke all on function public.hourly_provider_cost_high_water() from public,anon,authenticated;
create trigger hourly_provider_cost_high_water before update on public.reader_collection_provider_jobs for each row execute function public.hourly_provider_cost_high_water();

-- An owner clearing/deleting archived history must not have it resurrected by
-- a late worker. The trigger has no callable endpoint and accepts no user IDs.
create function public.invalidate_hourly_deleted_archive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.reader_collection_source_state set pending_captions='[]'::jsonb,lease_token=null,lease_until=null,check_id=null where user_id=old.user_id and source_id=old.source_id;
 update public.reader_collection_provider_jobs set discard_result=true where user_id=old.user_id and source_id=old.source_id;
 return old;
end;
$$;
revoke all on function public.invalidate_hourly_deleted_archive() from public,anon,authenticated,service_role;
create trigger invalidate_hourly_deleted_archive after delete on public.reader_source_updates for each row execute function public.invalidate_hourly_deleted_archive();

create function public.invalidate_hourly_workspace_removal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  -- Same policy -> source ordering as paid reservation, before touching jobs.
  update public.reader_collection_policies set enabled=false,updated_at=clock_timestamp() where user_id=old.user_id;
  update public.reader_collection_source_state set pending_captions='[]'::jsonb,lease_token=null,lease_until=null,check_id=null where user_id=old.user_id;
  update public.reader_collection_provider_jobs set discard_result=true where user_id=old.user_id;
  return old;
 end if;
 update public.reader_collection_source_state s set pending_captions='[]'::jsonb,lease_token=null,lease_until=null,check_id=null where s.user_id=new.user_id and
  (not(new.state->'followedSourceIds' ? s.source_id) or not exists(select 1 from jsonb_array_elements(new.state->'customSources') x where x->>'id'=s.source_id));
 update public.reader_collection_provider_jobs j set discard_result=true where j.user_id=new.user_id and
  (not(new.state->'followedSourceIds' ? j.source_id) or not exists(select 1 from jsonb_array_elements(new.state->'customSources') x where x->>'id'=j.source_id));
 return new;
end;
$$;
revoke all on function public.invalidate_hourly_workspace_removal() from public,anon,authenticated,service_role;
create trigger invalidate_hourly_workspace_removal after update or delete on public.reader_workspaces for each row execute function public.invalidate_hourly_workspace_removal();

revoke all on function public.hourly_item_key(text),public.claim_hourly_source(text,text),public.finish_hourly_source(uuid,uuid,jsonb,jsonb),public.reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.hourly_item_key(text),public.claim_hourly_source(text,text),public.finish_hourly_source(uuid,uuid,jsonb,jsonb),public.reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid) to service_role;
comment on table public.reader_collection_provider_jobs is 'Server-only tokens. Launch-claimed/ambiguous rows retain budget holds forever until explicit reconciliation. Never expose job_token to readers or logs.';
comment on table public.reader_collection_checks is 'One row per leased freshness check. Cost mirrors collection_jobs child costs; do not sum both. Native zero is supplier fee only, not total operating cost.';
commit;
