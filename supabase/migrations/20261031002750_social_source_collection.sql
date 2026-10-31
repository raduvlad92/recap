-- Shared public-source discovery; no policy or supplier execution is enabled.
begin;
create table public.social_collection_platforms (
 platform text primary key check(platform in('X','Instagram','LinkedIn')),
 enabled boolean not null default false,
 actor_ref text not null,
 actor_id text,build_id text,build_number text,apify_user_id text,pricing_fingerprint text,reviewed_at timestamptz,
 max_items integer not null default 20 check(max_items between 1 and 100),
 maximum_usd numeric(12,6) not null default .05 check(maximum_usd>0 and maximum_usd<=1),
 daily_limit_usd numeric(12,6) not null default .5 check(daily_limit_usd>0 and daily_limit_usd<=5),
 lifetime_limit_usd numeric(12,6) not null default 1.5 check(lifetime_limit_usd>0 and lifetime_limit_usd<=5),
 memory_mb integer not null default 256 check(memory_mb in(128,256,512,1024)),
 timeout_seconds integer not null default 120 check(timeout_seconds between 30 and 600),
 check(not enabled or (actor_id~'^[A-Za-z0-9]{6,64}$' and build_id~'^[A-Za-z0-9]{6,64}$' and build_number~'^\d+\.\d+\.\d+$' and apify_user_id~'^[A-Za-z0-9]{6,64}$' and pricing_fingerprint~'^[a-f0-9]{64}$' and reviewed_at is not null and actor_id is not null and build_id is not null and build_number is not null and apify_user_id is not null and pricing_fingerprint is not null))
);
insert into public.social_collection_platforms(platform,actor_ref) values('X','xquik/x-tweet-scraper'),('Instagram','apify/instagram-scraper'),('LinkedIn','harvestapi/linkedin-profile-posts');
create table public.social_collection_sources (
 source_key text primary key,platform text not null references public.social_collection_platforms,
 source_url text not null,source_name text not null,
 next_check_at timestamptz not null default clock_timestamp(),last_checked_at timestamptz,last_complete_until timestamptz,last_discovered_until timestamptz,paused_reason text,
 last_coverage jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create table public.social_collection_consumers (
 source_key text not null references public.social_collection_sources,
 user_id text not null,source_id text not null,workspace_revision timestamptz not null,source_fingerprint text not null,
 primary key(source_key,user_id,source_id)
);
create table public.social_collection_jobs (
 id uuid primary key default gen_random_uuid(),source_key text not null references public.social_collection_sources,
 platform text not null references public.social_collection_platforms,
 purpose text not null default 'collection'check(purpose in('collection','proof')),
 window_from timestamptz not null,window_to timestamptz not null,config jsonb not null,
 state text not null default 'claimed' check(state in('claimed','launch_claimed','running','ambiguous','completed','failed')),
 lease_token uuid not null default gen_random_uuid(),lease_until timestamptz not null default clock_timestamp()+interval'5 minutes',
 reservation_id uuid not null unique references public.collection_budget_reservations,
 collection_job_id uuid not null unique references public.collection_jobs,
 consumers jsonb not null check(jsonb_typeof(consumers)='array'),
 provider_run_id text unique,dataset_id text,
 actual_usd numeric(24,12) check(actual_usd>=0),coverage jsonb,error_code text,
 next_poll_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 check(window_from<window_to and window_to-window_from<=interval'2 days')
);
create unique index social_one_open_source_job on public.social_collection_jobs(source_key) where state in('claimed','launch_claimed','running','ambiguous');
create index social_job_reconciliation on public.social_collection_jobs(next_poll_at) where provider_run_id is not null and (state='running' or actual_usd is null);
create table public.social_collection_items (
 source_key text not null references public.social_collection_sources,item_key text not null,revision text not null check(revision~'^[a-f0-9]{64}$'),
 record jsonb not null check(jsonb_typeof(record)='object' and octet_length(record::text)<=1000000),
 job_id uuid not null references public.social_collection_jobs,collected_at timestamptz not null default clock_timestamp(),
 primary key(source_key,item_key,revision)
);
create table public.social_collection_deliveries (
 user_id text not null,source_id text not null,item_key text not null,archive_id text not null,
 source_key text not null references public.social_collection_sources,revision text not null,
 deleted boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,source_id,item_key)
);
create index social_delivery_archive on public.social_collection_deliveries(user_id,archive_id);
create function public.social_job_identity_guard()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if(new.id,new.source_key,new.platform,new.purpose,new.window_from,new.window_to,new.config,new.reservation_id,new.collection_job_id,new.consumers,new.created_at)is distinct from(old.id,old.source_key,old.platform,old.purpose,old.window_from,old.window_to,old.config,old.reservation_id,old.collection_job_id,old.consumers,old.created_at)
 or(old.provider_run_id is not null and new.provider_run_id is distinct from old.provider_run_id)or(old.dataset_id is not null and new.dataset_id is distinct from old.dataset_id)
 or(old.actual_usd is not null and(new.actual_usd is null or new.actual_usd<old.actual_usd))then raise exception'Immutable social job evidence changed'using errcode='PT409';end if;
 return new;
end;$$;
revoke all on function public.social_job_identity_guard()from public,anon,authenticated,service_role;
create trigger social_job_identity_guard before update on public.social_collection_jobs for each row execute function public.social_job_identity_guard();
alter table public.social_collection_platforms enable row level security;
alter table public.social_collection_sources enable row level security;
alter table public.social_collection_consumers enable row level security;
alter table public.social_collection_jobs enable row level security;
alter table public.social_collection_items enable row level security;
alter table public.social_collection_deliveries enable row level security;
revoke all on public.social_collection_platforms,public.social_collection_sources,public.social_collection_consumers,public.social_collection_jobs,public.social_collection_items,public.social_collection_deliveries from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.social_collection_platforms,public.social_collection_sources,public.social_collection_consumers,public.social_collection_jobs,public.social_collection_items,public.social_collection_deliveries to service_role;

create function public.social_source_key(p_platform text,p_url text)returns text language plpgsql immutable security invoker set search_path='' as $$
declare v text;
begin
 if p_url is null or length(p_url)>2048 or p_url~'[?#@]' and p_url !~ '^https://[^/]+/' then return null;end if;
 v:=lower(regexp_replace(regexp_replace(p_url,'^https://(www\.)?','','i'),'/+$',''));
 if p_platform='X' and v~'^(x\.com|twitter\.com)/[a-z0-9_]{1,120}$' then return regexp_replace(v,'^twitter\.com/','x.com/');end if;
 if p_platform='Instagram' and v~'^instagram\.com/[a-z0-9_.]{1,120}$' and split_part(v,'/',2) not in('home','search','explore','accounts','p','reel','reels','i') then return v;end if;
 if p_platform='LinkedIn' and v~'^linkedin\.com/(in|company)/[a-z0-9_-]{1,120}$' then return v;end if;
 return null;
end;$$;
create function public.social_item_key(p_platform text,p_url text)returns text language sql immutable security invoker set search_path='' as $$
 select case
 when p_platform='X' and p_url~'^https://(www\.)?(x\.com|twitter\.com)/[A-Za-z0-9_]+/status/[0-9]+/?([?].*)?$'then 'x:'||substring(p_url from '/status/([0-9]+)')
 when p_platform='Instagram' and p_url~'^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?([?].*)?$'then 'instagram:'||substring(p_url from '/(?:p|reel)/([A-Za-z0-9_-]+)')
 when p_platform='LinkedIn' and p_url~'^https://(www\.)?linkedin\.com/' then 'linkedin:'||substring(p_url from '(?:activity-|urn:li:(?:activity|ugcPost):)([0-9]+)')
 end;
$$;

create function public.sync_social_collection_sources()returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 -- Current saved follows only; never sweep the catalogue or sample inventory.
 delete from public.social_collection_consumers c where not exists(
  select 1 from public.reader_workspaces w join public.reader_collection_policies p on p.user_id=w.user_id and p.enabled,
   lateral jsonb_array_elements(coalesce(w.state->'customSources','[]'))x
  where w.user_id=c.user_id and x->>'id'=c.source_id and coalesce(w.state->'followedSourceIds','[]')?c.source_id
   and x->>'status' is distinct from 'sample' and public.social_source_key(x->>'platform',x->>'url')=c.source_key);
 insert into public.social_collection_sources(source_key,platform,source_url,source_name)
 select distinct on(public.social_source_key(x->>'platform',x->>'url'))public.social_source_key(x->>'platform',x->>'url'),x->>'platform',x->>'url',left(coalesce(x->>'name','Public source'),160)
 from public.reader_workspaces w join public.reader_collection_policies p on p.user_id=w.user_id and p.enabled,
 lateral jsonb_array_elements(coalesce(w.state->'customSources','[]'))x
 where coalesce(w.state->'followedSourceIds','[]')?(x->>'id')and x->>'status' is distinct from 'sample' and public.social_source_key(x->>'platform',x->>'url')is not null
 order by public.social_source_key(x->>'platform',x->>'url'),w.user_id on conflict(source_key)do nothing;
 insert into public.social_collection_consumers(source_key,user_id,source_id,workspace_revision,source_fingerprint)
 select public.social_source_key(x->>'platform',x->>'url'),w.user_id,x->>'id',w.updated_at,md5(x::text)
 from public.reader_workspaces w join public.reader_collection_policies p on p.user_id=w.user_id and p.enabled,
 lateral jsonb_array_elements(coalesce(w.state->'customSources','[]'))x
 where coalesce(w.state->'followedSourceIds','[]')?(x->>'id')and x->>'status' is distinct from 'sample' and public.social_source_key(x->>'platform',x->>'url')is not null and length(x->>'id')between 1 and 120
 on conflict(source_key,user_id,source_id)do update set workspace_revision=excluded.workspace_revision,source_fingerprint=excluded.source_fingerprint;
 get diagnostics n=row_count;return n;
end;$$;

create function public.claim_social_collection_job(p_allow_launch boolean default false)returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.social_collection_sources;p public.social_collection_platforms;j public.social_collection_jobs;r public.collection_budget_reservations;consumer jsonb;members jsonb;ledger uuid;cost numeric;daily numeric;token uuid;moment timestamptz:=clock_timestamp();
begin
 -- Accepted jobs remain reconcilable with the platform stopped. An ambiguous
 -- POST without a run reference is deliberately never automatically relaunched.
 select * into j from public.social_collection_jobs where provider_run_id is not null and(state='running'or(state='completed'and actual_usd is null))and lease_until<moment and next_poll_at<=moment order by next_poll_at,created_at for update skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning * into j;
  select * into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 if not p_allow_launch then return null;end if;
 -- A claim whose launch marker was never written is safe to resume using
 -- the same reservation. Once marked, an unknown POST is never relaunched.
 select q.*into j from public.social_collection_jobs q
 join public.social_collection_platforms reviewed_platform on reviewed_platform.platform=q.platform and reviewed_platform.enabled
 where q.state='claimed'and q.provider_run_id is null and q.lease_until<moment
 order by q.created_at,q.id for update of q skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning*into j;
  select*into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 -- Lock platform before source. All reservations serialize through the existing
 -- global account, without changing the old YouTube policy/caps.
 select q.* into p from public.social_collection_platforms q where enabled
 and q.maximum_usd+coalesce((select sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end)from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=q.platform),0)<=q.lifetime_limit_usd
 and q.maximum_usd+coalesce((select sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end)from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=q.platform and a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'),0)<=q.daily_limit_usd
 and exists(select 1 from public.social_collection_sources a where a.platform=q.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.state in('claimed','launch_claimed','running','ambiguous')))order by q.platform for update skip locked limit 1;
 if p.platform is null then return null;end if;
 select a.* into s from public.social_collection_sources a where a.platform=p.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.state in('claimed','launch_claimed','running','ambiguous'))order by a.next_check_at,a.source_key for update skip locked limit 1;
 if s.source_key is null then return null;end if;
 select coalesce(sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end),0),coalesce(sum(case when a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'then case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end else 0 end),0)into cost,daily from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=p.platform;
 if cost+p.maximum_usd>p.lifetime_limit_usd or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
 select jsonb_agg(to_jsonb(c)order by c.user_id,c.source_id)into members from public.social_collection_consumers c where c.source_key=s.source_key;
 consumer:=members->0;if consumer is null then return null;end if;
 token:=gen_random_uuid();r:=public.reserve_collection_budget('social.'||token::text,p.maximum_usd,'job',null,'apify',p.actor_id);
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status,cost_status)values(consumer->>'user_id',consumer->>'source_id',s.source_name,s.source_url,s.platform,'apify',p.actor_id,'requested','unknown')returning id into ledger;
 insert into public.collection_job_consumers(job_id,user_id)select ledger,value->>'user_id'from jsonb_array_elements(members)on conflict do nothing;
 insert into public.social_collection_jobs(id,source_key,platform,window_from,window_to,config,reservation_id,collection_job_id,consumers)values(token,s.source_key,s.platform,greatest(moment-interval'24 hours',coalesce(s.last_discovered_until-interval'2 hours',moment-interval'24 hours')),moment,to_jsonb(p),r.id,ledger,members)returning * into j;
 return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
end;$$;

create function public.mark_social_collection_launch(p_id uuid,p_lease uuid)returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.social_collection_jobs;p public.social_collection_platforms;answer jsonb;
begin
 select * into p from public.social_collection_platforms where platform=(select platform from public.social_collection_jobs where id=p_id)for update;
 select * into j from public.social_collection_jobs where id=p_id for update;
 if j.id is null or j.state<>'claimed'or j.lease_token is distinct from p_lease or j.lease_until<clock_timestamp()then return false;end if;
 if not p.enabled or to_jsonb(p)is distinct from j.config then raise exception'Social configuration changed'using errcode='PT409';end if;
 if j.purpose<>'proof'and not exists(select 1 from public.social_collection_consumers c join public.reader_workspaces w on w.user_id=c.user_id join public.reader_collection_policies cp on cp.user_id=c.user_id and cp.enabled where c.source_key=j.source_key and w.updated_at=c.workspace_revision and coalesce(w.state->'followedSourceIds','[]')?c.source_id)then raise exception'No current source consumers'using errcode='PT409';end if;
 answer:=public.claim_collection_budget(j.reservation_id);
 if answer->'claimed'<>'true'::jsonb then return false;end if;
 update public.social_collection_jobs set state='launch_claimed'where id=j.id;
 update public.collection_jobs set status='running'where id=j.collection_job_id;return true;
end;$$;

-- Explicit finite operator qualification, isolated from private reader follows.
-- At most five proof jobs/platform in this increment; no automatic proof loop.
create function public.claim_social_collection_proof(p_platform text,p_url text,p_name text,p_operator_id text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s public.social_collection_sources;p public.social_collection_platforms;j public.social_collection_jobs;r public.collection_budget_reservations;k text;ledger uuid;token uuid;cost numeric;daily numeric;moment timestamptz:=clock_timestamp();
begin
 k:=public.social_source_key(p_platform,p_url);
 if k is null or length(p_operator_id)not between 1 and 200 or p_operator_id is null then raise exception'Invalid proof target'using errcode='PT400';end if;
 select * into p from public.social_collection_platforms where platform=p_platform for update;
 if p.platform is null or not p.enabled then raise exception'Proof configuration unavailable'using errcode='PT409';end if;
 if(select count(*)from public.social_collection_jobs where platform=p_platform and purpose='proof')>=5 then raise exception'Finite proof roster exhausted'using errcode='PT402';end if;
 select coalesce(sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end),0),coalesce(sum(case when a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'then case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end else 0 end),0)into cost,daily from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=p.platform;
 if cost+p.maximum_usd>p.lifetime_limit_usd or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
 insert into public.social_collection_sources(source_key,platform,source_url,source_name)values(k,p_platform,p_url,left(coalesce(p_name,'Public proof source'),160))on conflict do nothing;
 select * into s from public.social_collection_sources where source_key=k for update;
 if exists(select 1 from public.social_collection_jobs where source_key=k and state in('claimed','launch_claimed','running','ambiguous'))then raise exception'Existing source job requires reconciliation'using errcode='PT409';end if;
 token:=gen_random_uuid();r:=public.reserve_collection_budget('social.'||token::text,p.maximum_usd,'job',null,'apify',p.actor_id);
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status,cost_status)values(p_operator_id,'proof-'||md5(k),s.source_name,s.source_url,s.platform,'apify',p.actor_id,'requested','unknown')returning id into ledger;
 insert into public.collection_job_consumers(job_id,user_id)values(ledger,p_operator_id);
 insert into public.social_collection_jobs(id,source_key,platform,purpose,window_from,window_to,config,reservation_id,collection_job_id,consumers)values(token,s.source_key,s.platform,'proof',moment-interval'24 hours',moment,to_jsonb(p),r.id,ledger,'[]')returning * into j;
 return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
end;$$;

create function public.record_social_collection_run(p_id uuid,p_lease uuid,p_run_id text,p_dataset_id text)returns void language plpgsql security invoker set search_path='' as $$
declare j public.social_collection_jobs;
begin
 select * into j from public.social_collection_jobs where id=p_id for update;
 if j.id is null or j.lease_token is distinct from p_lease or j.state not in('launch_claimed','running')or p_run_id!~'^[A-Za-z0-9]{6,64}$'or(p_dataset_id is not null and p_dataset_id!~'^[A-Za-z0-9]{6,64}$')or(j.provider_run_id is not null and j.provider_run_id<>p_run_id)then raise exception'Social run changed'using errcode='PT409';end if;
 perform public.settle_collection_budget(j.reservation_id,p_run_id,null,false);
 update public.social_collection_jobs set state='running',provider_run_id=p_run_id,dataset_id=p_dataset_id where id=j.id;
 update public.collection_jobs set provider_run_id=p_run_id where id=j.collection_job_id;
end;$$;

create function public.finish_social_collection_job(p_id uuid,p_lease uuid,p_items jsonb,p_coverage jsonb,p_actual_usd numeric,p_terminal boolean,p_error text default null)returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.social_collection_jobs;member jsonb;w public.reader_workspaces;src jsonb;item jsonb;rec jsonb;k text;aid text;oldrec jsonb;sent public.social_collection_deliveries;inserted integer:=0;source_name text;current_revision text;finished timestamptz:=clock_timestamp();
begin
 select * into j from public.social_collection_jobs where id=p_id for update;
 if j.id is null or j.lease_token is distinct from p_lease or j.lease_until<finished then raise exception'Social lease changed'using errcode='PT409';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array'or jsonb_array_length(p_items)>coalesce((j.config->>'max_items')::integer,0)or jsonb_typeof(p_coverage)<>'object'or p_actual_usd<0 then raise exception'Invalid social result'using errcode='PT400';end if;
 -- Hourly collection and workspace clearing take reader policy locks before
 -- the shared financial account. Match that order before settlement/import.
 perform 1 from public.reader_collection_policies p
 where p.user_id in(select value->>'user_id'from jsonb_array_elements(j.consumers))
 order by p.user_id collate "C" for update;
 if j.provider_run_id is not null then perform public.settle_collection_budget(j.reservation_id,j.provider_run_id,p_actual_usd,p_terminal);end if;
 if j.state='claimed'and p_error is not null then
  perform public.release_collection_budget(j.reservation_id);
  update public.social_collection_jobs set state='failed',error_code=p_error,coverage=p_coverage,finished_at=finished,lease_until=finished where id=j.id;
  update public.social_collection_sources set next_check_at=finished+interval'1 hour',last_coverage=p_coverage where source_key=j.source_key and j.purpose='collection';
  update public.collection_jobs set status='blocked',error_code=p_error,finished_at=finished where id=j.collection_job_id;
  return jsonb_build_object('imported',0);
 end if;
 if not p_terminal then
  update public.social_collection_jobs set state=case when provider_run_id is null then'ambiguous'else'running'end,error_code=p_error,coverage=p_coverage,lease_until=finished,next_poll_at=finished+interval'5 minutes'where id=j.id;
  return jsonb_build_object('imported',0);
 end if;
 if j.provider_run_id is null then raise exception'Missing actual run'using errcode='PT409';end if;
 for item in select value from jsonb_array_elements(p_items)loop
  rec:=item->'record';k:=public.social_item_key(j.platform,rec->>'url');
  if k is null or k is distinct from item->>'itemKey'or rec->'isSample'is distinct from'false'::jsonb or rec->>'format'<>'post'or item->>'revision'!~'^[a-f0-9]{64}$'or rec->>'sourceId' is distinct from j.source_key or(rec->>'publishedAt')::timestamptz<j.window_from or(rec->>'publishedAt')::timestamptz>=j.window_to then raise exception'Invalid source attribution'using errcode='PT400';end if;
  insert into public.social_collection_items(source_key,item_key,revision,record,job_id)values(j.source_key,k,item->>'revision',rec,j.id)on conflict do nothing;
 end loop;
 -- Match reset/provider lock order: owner policy, workspace, then archive.
 for member in select value from jsonb_array_elements(j.consumers)order by value->>'user_id',value->>'source_id'loop
  perform 1 from public.reader_collection_policies where user_id=member->>'user_id'and enabled for update;
  if not found then continue;end if;
  select * into w from public.reader_workspaces where user_id=member->>'user_id'for share;
  if w.user_id is null or w.updated_at is distinct from(member->>'workspace_revision')::timestamptz or not coalesce(w.state->'followedSourceIds','[]')?(member->>'source_id')then continue;end if;
  select x into src from jsonb_array_elements(coalesce(w.state->'customSources','[]'))x where x->>'id'=member->>'source_id'limit 1;
  if src is null or md5(src::text)is distinct from member->>'source_fingerprint'or public.social_source_key(src->>'platform',src->>'url')is distinct from j.source_key then continue;end if;
  -- A settings revision may have fenced a previous in-flight import, or a new
  -- follower may have joined an already shared source. Deliver bounded cached
  -- originals without paying to retrieve those older identities a second time.
  for item in
   select value from jsonb_array_elements(p_items)
   union all
   select jsonb_build_object('itemKey',cached.item_key,'revision',cached.revision,'record',cached.record)from(
    select distinct on(c.item_key)c.* from public.social_collection_items c join public.social_collection_jobs previous on previous.id=c.job_id
    where c.source_key=j.source_key and previous.purpose='collection'and c.collected_at>=finished-interval'24 hours'
     and not exists(select 1 from jsonb_array_elements(p_items)x where x->>'itemKey'=c.item_key)
     and not exists(select 1 from public.social_collection_deliveries d where d.user_id=w.user_id and d.source_id=member->>'source_id'and d.item_key=c.item_key)
    order by c.item_key,c.collected_at desc limit 100
   )cached
  loop
   rec:=item->'record';k:=item->>'itemKey';aid:=null;oldrec:=null;
   select * into sent from public.social_collection_deliveries where user_id=w.user_id and source_id=member->>'source_id'and item_key=k;
   if sent.deleted then continue;end if;
   select a.id,a.record into aid,oldrec from public.reader_source_updates a where a.user_id=w.user_id and a.source_id=member->>'source_id'and public.social_item_key(j.platform,a.record->>'url')=k order by a.collected_at limit 1;
   if aid is null then
    select x->>'id',x into aid,oldrec from jsonb_array_elements(coalesce(w.state->'importedUpdates','[]'))x where x->>'sourceId'=member->>'source_id'and x->'isSample'='false'::jsonb and public.social_item_key(j.platform,x->>'url')=k limit 1;
   end if;
   if sent.archive_id is not null and aid is null then continue;end if;
   aid:=coalesce(aid,'social-'||substr(md5((member->>'source_id')||chr(10)||k),1,32));
   if oldrec is null then
    rec:=rec||jsonb_build_object('id',aid,'sourceId',member->>'source_id');
    insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(w.user_id,aid,member->>'source_id','social',(rec->>'publishedAt')::timestamptz,rec)on conflict do nothing;
    if found then inserted:=inserted+1;end if;
   end if;
   -- Existing reader annotations/source versions are preserved. A changed public
   -- revision is retained above for explicit review rather than silently merged.
   insert into public.social_collection_deliveries(user_id,source_id,item_key,archive_id,source_key,revision)values(w.user_id,member->>'source_id',k,aid,j.source_key,item->>'revision')on conflict do nothing;
  end loop;
 end loop;
 update public.social_collection_jobs set state=case when p_error is null then'completed'else'failed'end,coverage=p_coverage,error_code=p_error,actual_usd=case when p_actual_usd is null then actual_usd else greatest(coalesce(actual_usd,0),p_actual_usd)end,finished_at=finished,lease_until=finished,next_poll_at=finished+interval'1 hour'where id=j.id;
 -- Progress records what was retrieved, not proven exhaustive coverage. A known
 -- cap freezes the source for reviewed recovery; never skip its unresolved tail.
 update public.social_collection_sources set next_check_at=finished+interval'1 hour',last_checked_at=finished,
  last_complete_until=case when p_coverage->'complete'='true'::jsonb then j.window_to else last_complete_until end,
  last_discovered_until=case when p_error is null and jsonb_array_length(p_items)>0 and coalesce(p_coverage->>'reason','')<>'result_limit_reached'then j.window_to else last_discovered_until end,
  paused_reason=case when p_coverage->>'reason'='result_limit_reached'then'result_limit_reached'else paused_reason end,last_coverage=p_coverage
 where source_key=j.source_key and j.purpose='collection';
 update public.collection_jobs set status=case when p_error is null then'succeeded'else'failed'end,result_count=jsonb_array_length(p_items),observed_cost_usd=case when p_actual_usd is null then observed_cost_usd else greatest(coalesce(observed_cost_usd,0),p_actual_usd)end,cost_status=case when p_actual_usd is null then cost_status else'provider_reported'end,error_code=p_error,finished_at=coalesce(finished_at,finished)where id=j.collection_job_id;
 return jsonb_build_object('imported',inserted);
end;$$;

create function public.social_archive_deleted()returns trigger language plpgsql security definer set search_path=''as $$
begin update public.social_collection_deliveries set deleted=true where user_id=old.user_id and archive_id=old.id;return old;end;$$;
revoke all on function public.social_archive_deleted()from public,anon,authenticated,service_role;
create trigger social_archive_deleted after delete on public.reader_source_updates for each row execute function public.social_archive_deleted();

create function public.social_collection_status()returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('platforms',(select coalesce(jsonb_agg(jsonb_build_object('platform',platform,'enabled',enabled,'actorRef',actor_ref,'build',build_number,'reviewedAt',reviewed_at)),'[]')from public.social_collection_platforms),
 'sources',(select count(*)from public.social_collection_sources),'pausedSources',(select count(*)from public.social_collection_sources where paused_reason is not null),'pending',(select count(*)from public.social_collection_jobs where state in('claimed','launch_claimed','running','ambiguous')),'unknownCostJobs',(select count(*)from public.social_collection_jobs j join public.collection_budget_reservations r on r.id=j.reservation_id where r.state='held'and r.launch_attempted_at is not null));
$$;
revoke all on function public.social_source_key(text,text),public.social_item_key(text,text),public.sync_social_collection_sources(),public.claim_social_collection_job(boolean),public.claim_social_collection_proof(text,text,text,text),public.mark_social_collection_launch(uuid,uuid),public.record_social_collection_run(uuid,uuid,text,text),public.finish_social_collection_job(uuid,uuid,jsonb,jsonb,numeric,boolean,text),public.social_collection_status()from public,anon,authenticated;
grant execute on function public.social_source_key(text,text),public.social_item_key(text,text),public.sync_social_collection_sources(),public.claim_social_collection_job(boolean),public.claim_social_collection_proof(text,text,text,text),public.mark_social_collection_launch(uuid,uuid),public.record_social_collection_run(uuid,uuid,text,text),public.finish_social_collection_job(uuid,uuid,jsonb,jsonb,numeric,boolean,text),public.social_collection_status()to service_role;
commit;
