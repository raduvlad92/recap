-- D21: shared researched catalogue and private operational records. No jobs start here.
begin;
create table public.catalogue_creators (
  id text primary key, slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  name text not null check (char_length(name) between 1 and 160),
  kind text not null check (kind in ('person','group')),
  description text not null check (char_length(description) between 10 and 2000),
  topics text[] not null default '{}', language text not null default 'en',
  is_listed boolean not null default true, researched_at date not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.collection_plans (
  platform text primary key check (platform in ('YouTube','Instagram','X','Substack','LinkedIn','Blog','Podcast')),
  provider text not null check (provider in ('apify','brightdata','native_feed','undecided')),
  actor_id text, pricing_url text, unit_label text not null default 'Not yet priced',
  quoted_usd numeric(12,6) check (quoted_usd >= 0), quote_checked_at date,
  notes text not null default '', planned_check_hours integer not null default 24 check (planned_check_hours between 1 and 720),
  execution_enabled boolean not null default false check (execution_enabled = false),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.catalogue_channels (
  id text primary key, creator_id text not null references public.catalogue_creators(id),
  platform text not null references public.collection_plans(platform), name text not null,
  handle text not null, url text not null unique check (url like 'https://%'),
  description text not null, language text not null default 'en',
  verification text not null check (verification in ('official_crosslink','official_profile','public_directory')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  researched_at date not null, collection_status text not null default 'planned' check (collection_status = 'planned'),
  updated_at timestamptz not null default clock_timestamp()
);
create index catalogue_channels_creator_idx on public.catalogue_channels(creator_id);
create index catalogue_channels_platform_idx on public.catalogue_channels(platform);
create index catalogue_creators_topics_idx on public.catalogue_creators using gin(topics);
create table public.catalogue_relationships (
  id uuid primary key default gen_random_uuid(), from_creator_id text not null references public.catalogue_creators(id),
  to_creator_id text not null references public.catalogue_creators(id),
  relationship text not null check (relationship in ('member','presenter','publisher','associated')),
  valid_from date, valid_until date, evidence jsonb not null,
  check (from_creator_id <> to_creator_id), check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index catalogue_relationships_from_idx on public.catalogue_relationships(from_creator_id);
create index catalogue_relationships_to_idx on public.catalogue_relationships(to_creator_id);
create table public.catalogue_channel_contributors (
  channel_id text not null references public.catalogue_channels(id), creator_id text not null references public.catalogue_creators(id),
  role text not null check (role in ('publisher','presenter','associated')), evidence jsonb not null,
  primary key(channel_id,creator_id,role)
);
create index catalogue_channel_contributors_creator_idx on public.catalogue_channel_contributors(creator_id);
create table public.collection_jobs (
  id uuid primary key default gen_random_uuid(), user_id text not null,
  source_id text not null, source_name text not null, source_url text not null, platform text not null,
  provider text not null check (provider in ('feed','apify','brightdata')),
  actor_id text, provider_run_id text unique,
  status text not null check (status in ('requested','running','succeeded','failed','blocked')),
  result_count integer check (result_count >= 0), observed_cost_usd numeric(12,6) check (observed_cost_usd >= 0),
  cost_status text not null default 'unknown' check (cost_status in ('unknown','provider_reported','no_provider_charge')),
  error_code text, created_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create index collection_jobs_user_created_idx on public.collection_jobs(user_id,created_at desc);
create index collection_jobs_created_idx on public.collection_jobs(created_at desc);
create table public.collection_job_consumers (
  job_id uuid not null references public.collection_jobs(id) on delete cascade, user_id text not null,
  channel_id text, primary key(job_id,user_id)
);
create index collection_job_consumers_user_idx on public.collection_job_consumers(user_id);
create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(), admin_id text not null, action text not null,
  target_id text, details jsonb not null default '{}', created_at timestamptz not null default clock_timestamp()
);
create index admin_audit_created_idx on public.admin_audit_events(created_at desc);

alter table public.catalogue_creators enable row level security;
alter table public.catalogue_channels enable row level security;
alter table public.catalogue_relationships enable row level security;
alter table public.catalogue_channel_contributors enable row level security;
alter table public.collection_plans enable row level security;
alter table public.collection_jobs enable row level security;
alter table public.collection_job_consumers enable row level security;
alter table public.admin_audit_events enable row level security;
revoke all on public.catalogue_creators,public.catalogue_channels,public.catalogue_relationships,public.catalogue_channel_contributors,public.collection_plans,public.collection_jobs,public.collection_job_consumers,public.admin_audit_events from anon,authenticated;
grant select on public.catalogue_creators,public.catalogue_channels,public.catalogue_relationships,public.catalogue_channel_contributors to anon,authenticated;
grant select on public.collection_jobs,public.collection_job_consumers to authenticated;
grant all on public.catalogue_creators,public.catalogue_channels,public.catalogue_relationships,public.catalogue_channel_contributors,public.collection_plans,public.collection_jobs,public.collection_job_consumers,public.admin_audit_events to service_role;
create policy catalogue_public_creators on public.catalogue_creators for select to anon,authenticated using (is_listed);
create policy catalogue_public_channels on public.catalogue_channels for select to anon,authenticated using (exists (select 1 from public.catalogue_creators c where c.id = creator_id and c.is_listed));
create policy catalogue_public_relationships on public.catalogue_relationships for select to anon,authenticated using (exists (select 1 from public.catalogue_creators c where c.id = from_creator_id and c.is_listed) and exists (select 1 from public.catalogue_creators c where c.id = to_creator_id and c.is_listed));
create policy catalogue_public_contributors on public.catalogue_channel_contributors for select to anon,authenticated using (exists (select 1 from public.catalogue_creators c where c.id = creator_id and c.is_listed) and exists (select 1 from public.catalogue_channels s where s.id = channel_id));
create policy collection_jobs_own on public.collection_jobs for select to authenticated using ((select auth.jwt()->>'sub') = user_id);
create policy collection_consumers_own on public.collection_job_consumers for select to authenticated using ((select auth.jwt()->>'sub') = user_id);

create function public.admin_update_creator(p_id text,p_expected timestamptz,p_admin text,p_description text,p_topics text[],p_listed boolean)
returns public.catalogue_creators language plpgsql security invoker set search_path = '' as $$
declare result public.catalogue_creators;
begin
  update public.catalogue_creators set description=p_description,topics=p_topics,is_listed=p_listed,updated_at=clock_timestamp()
    where id=p_id and updated_at=p_expected returning * into result;
  if result.id is null then raise exception 'Record changed; reload before saving' using errcode='40001'; end if;
  insert into public.admin_audit_events(admin_id,action,target_id,details) values (p_admin,'creator.updated',p_id,jsonb_build_object('listed',p_listed));
  return result;
end;
$$;
create function public.admin_update_plan(p_platform text,p_expected timestamptz,p_admin text,p_provider text,p_actor text,p_hours integer,p_notes text)
returns public.collection_plans language plpgsql security invoker set search_path = '' as $$
declare result public.collection_plans;
begin
  update public.collection_plans set provider=p_provider,actor_id=p_actor,planned_check_hours=p_hours,notes=p_notes,
    quoted_usd=case when provider=p_provider then quoted_usd else null end,
    pricing_url=case when provider=p_provider then pricing_url else null end,
    unit_label=case when provider=p_provider then unit_label else 'Not priced for selected provider' end,
    quote_checked_at=case when provider=p_provider then quote_checked_at else null end,
    updated_at=clock_timestamp()
    where platform=p_platform and updated_at=p_expected returning * into result;
  if result.platform is null then raise exception 'Record changed; reload before saving' using errcode='40001'; end if;
  insert into public.admin_audit_events(admin_id,action,target_id) values (p_admin,'plan.updated',p_platform);
  return result;
end;
$$;
revoke all on function public.admin_update_creator(text,timestamptz,text,text,text[],boolean) from public,anon,authenticated;
revoke all on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_update_creator(text,timestamptz,text,text,text[],boolean) to service_role;
grant execute on function public.admin_update_plan(text,timestamptz,text,text,text,integer,text) to service_role;

create function public.admin_workspace_summaries(p_user_ids text[])
returns table(user_id text,state jsonb,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
 select w.user_id,jsonb_build_object('followedSourceIds',w.state->'followedSourceIds','customSources',w.state->'customSources',
 'savedCount',jsonb_array_length(w.state->'savedUpdateIds'),'readLaterCount',jsonb_array_length(w.state->'readLaterIds'),
 'importedCount',jsonb_array_length(w.state->'importedUpdates'),'settings',w.state->'settings'),w.updated_at
 from public.reader_workspaces w where w.user_id = any(p_user_ids) and cardinality(p_user_ids) <= 100;
$$;
create function public.admin_user_job_usage(p_user_ids text[])
returns table(user_id text,job_count bigint,actors text[],observed_cost_usd numeric,unknown_cost_jobs bigint)
language sql stable security invoker set search_path = '' as $$
 select j.user_id,count(*),array_remove(array_agg(distinct case when j.provider='apify' and j.provider_run_id is not null then j.actor_id end),null),
 coalesce(sum(j.observed_cost_usd),0),count(*) filter (where j.observed_cost_usd is null)
 from public.collection_jobs j where j.user_id = any(p_user_ids) and cardinality(p_user_ids) <= 100 group by j.user_id;
$$;
create function public.admin_operating_metrics()
returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
 'workspaces',(select count(*) from public.reader_workspaces),
 'followedChannels',(select coalesce(sum(jsonb_array_length(state->'followedSourceIds')),0) from public.reader_workspaces),
 'catalogueCreators',(select count(*) from public.catalogue_creators),
 'catalogueChannels',(select count(*) from public.catalogue_channels),
 'platformCounts',(select coalesce(jsonb_object_agg(platform,n),'{}'::jsonb) from (select platform,count(*) n from public.catalogue_channels group by platform) p),
 'plannedActors',(select count(distinct actor_id) from public.collection_plans where provider='apify'),
 'usedActors',(select count(distinct actor_id) from public.collection_jobs where provider='apify' and provider_run_id is not null),
 'jobs',(select count(*) from public.collection_jobs),
 'runningJobs',(select count(*) from public.collection_jobs where status in ('requested','running')),
 'failedJobs',(select count(*) from public.collection_jobs where status='failed'),
 'observedCostUsd',(select coalesce(sum(observed_cost_usd),0) from public.collection_jobs),
 'unknownCostJobs',(select count(*) from public.collection_jobs where observed_cost_usd is null));
$$;
revoke all on function public.admin_workspace_summaries(text[]),public.admin_user_job_usage(text[]),public.admin_operating_metrics() from public,anon,authenticated;
grant execute on function public.admin_workspace_summaries(text[]),public.admin_user_job_usage(text[]),public.admin_operating_metrics() to service_role;
commit;
