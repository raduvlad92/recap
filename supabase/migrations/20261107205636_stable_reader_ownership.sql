-- Identity foundation only: legacy ownership is the default; no real aliases,
-- issuer trust, lifecycle readiness or application rows are changed here.
begin;
create schema if not exists recap_internal;
revoke all on schema recap_internal from public, anon;
grant usage on schema recap_internal to authenticated, service_role;

create table recap_internal.reader_identity_settings (
 singleton boolean primary key default true check (singleton),
 mode text not null default 'legacy' check (mode in ('legacy','linked')),
 lifecycle_ready boolean not null default false
);
insert into recap_internal.reader_identity_settings(singleton) values(true);
create table recap_internal.reader_identity_issuers (
 issuer text primary key check (length(issuer) between 9 and 2048 and issuer ~ '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$'),
 enabled boolean not null default true
);
create table recap_internal.reader_identity_aliases (
 issuer text not null references recap_internal.reader_identity_issuers(issuer),
 subject text not null check (length(subject) between 1 and 200),
 owner_id text not null check (length(owner_id) between 1 and 200 and owner_id <> 'guest'),
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 primary key (issuer,subject)
);
create index reader_identity_alias_owner on recap_internal.reader_identity_aliases(owner_id,issuer);
create table recap_internal.reader_identity_events (
 id uuid primary key default gen_random_uuid(),
 action text not null,
 actor_ref text not null,
 review_ref text not null,
 details jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table recap_internal.reader_identity_settings enable row level security;
alter table recap_internal.reader_identity_issuers enable row level security;
alter table recap_internal.reader_identity_aliases enable row level security;
alter table recap_internal.reader_identity_events enable row level security;
revoke all on recap_internal.reader_identity_settings,recap_internal.reader_identity_issuers,recap_internal.reader_identity_aliases,recap_internal.reader_identity_events from public,anon,authenticated,service_role;
grant select on recap_internal.reader_identity_settings,recap_internal.reader_identity_issuers,recap_internal.reader_identity_aliases,recap_internal.reader_identity_events to service_role;

-- PR17 contract: retain stable-owner suppression and the separately frozen
-- provider locator. No lifecycle schema is created by this foundation.
create function recap_internal.reader_identity_allowed(p_owner_id text,p_issuer text,p_subject text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if to_regprocedure('public.account_access_allowed(text)') is null
 or to_regclass('recap_internal.account_deletions') is null then return false; end if;
 if public.account_access_allowed(p_owner_id) is not true then return false; end if;
 return not exists(select 1 from recap_internal.account_deletions
  where identity_issuer=p_issuer and identity_subject=p_subject);
end;$$;
revoke all on function recap_internal.reader_identity_allowed(text,text,text) from public,anon,authenticated,service_role;

create function recap_internal.resolve_reader_owner(p_issuer text,p_subject text)
returns text language plpgsql volatile security definer set search_path='' as $$
declare settings recap_internal.reader_identity_settings; owner_key text;
begin
 select * into settings from recap_internal.reader_identity_settings where singleton;
 if settings.mode='legacy' then
  -- Once PR17 exists, disabling identity/deletion flags cannot lift its fence.
  if (to_regprocedure('public.account_access_allowed(text)') is not null or to_regclass('recap_internal.account_deletions') is not null)
   and recap_internal.reader_identity_allowed(p_subject,p_issuer,p_subject) is not true then return null; end if;
  return p_subject;
 end if;
 if settings.mode is distinct from 'linked' or not settings.lifecycle_ready
   or p_issuer is null or p_subject is null then return null; end if;
 select a.owner_id into owner_key from recap_internal.reader_identity_aliases a
 join recap_internal.reader_identity_issuers i using(issuer)
 where a.issuer=p_issuer and a.subject=p_subject and a.revoked_at is null and i.enabled;
 if owner_key is null or recap_internal.reader_identity_allowed(owner_key,p_issuer,p_subject) is not true then return null; end if;
 return owner_key;
end;$$;
revoke all on function recap_internal.resolve_reader_owner(text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.resolve_reader_owner(text,text) to service_role;

create function recap_internal.current_reader_owner() returns text
language sql volatile security definer set search_path='' as $$
 select recap_internal.resolve_reader_owner(auth.jwt()->>'iss',auth.jwt()->>'sub')
$$;
revoke all on function recap_internal.current_reader_owner() from public,anon,authenticated,service_role;
grant execute on function recap_internal.current_reader_owner() to authenticated;
-- Public wrappers are invoker-only. Arbitrary identity lookup is service-only;
-- the browser can resolve only its own already-verified JWT.
create function public.current_reader_owner() returns text
language sql volatile security invoker set search_path='' as $$select recap_internal.current_reader_owner()$$;
revoke all on function public.current_reader_owner() from public,anon,authenticated,service_role;
grant execute on function public.current_reader_owner() to authenticated;
create function public.resolve_reader_owners(p_issuer text,p_subjects text[])
returns table(provider_subject text,owner_id text)
language sql volatile security invoker set search_path='' as $$
 select s,recap_internal.resolve_reader_owner(p_issuer,s) from unnest(p_subjects) s
 where cardinality(p_subjects)<=100
$$;
revoke all on function public.resolve_reader_owners(text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.resolve_reader_owners(text,text[]) to service_role;

create function recap_internal.reader_provider_subject(p_owner_id text,p_issuer text) returns text
language plpgsql volatile security definer set search_path='' as $$
declare settings recap_internal.reader_identity_settings; subjects text[];
begin
 select * into settings from recap_internal.reader_identity_settings where singleton;
 if settings.mode='legacy' then
  if (to_regprocedure('public.account_access_allowed(text)') is not null or to_regclass('recap_internal.account_deletions') is not null)
   and recap_internal.reader_identity_allowed(p_owner_id,p_issuer,p_owner_id) is not true then return null; end if;
  return p_owner_id;
 end if;
 if settings.mode is distinct from 'linked' or not settings.lifecycle_ready or p_issuer is null then return null; end if;
 select array_agg(a.subject) into subjects from recap_internal.reader_identity_aliases a
 join recap_internal.reader_identity_issuers i using(issuer)
 where a.owner_id=p_owner_id and a.issuer=p_issuer and i.enabled and a.revoked_at is null
 and recap_internal.reader_identity_allowed(a.owner_id,a.issuer,a.subject);
 -- No inferred recipient, arbitrary first alias, or fallback to the historical key.
 if cardinality(subjects)=1 then return subjects[1]; end if;
 return null;
end;$$;
revoke all on function recap_internal.reader_provider_subject(text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.reader_provider_subject(text,text) to service_role;
create function public.reader_provider_subject(p_owner_id text,p_issuer text) returns text
language sql volatile security invoker set search_path='' as $$select recap_internal.reader_provider_subject(p_owner_id,p_issuer)$$;
revoke all on function public.reader_provider_subject(text,text) from public,anon,authenticated,service_role;
grant execute on function public.reader_provider_subject(text,text) to service_role;

create function recap_internal.review_reader_identity_configuration(p_mode text,p_lifecycle_ready boolean,p_issuers text[],p_actor_ref text,p_review_ref text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_mode is null or p_mode not in('legacy','linked') or p_lifecycle_ready is null or p_issuers is null
 or cardinality(p_issuers)>10 or p_actor_ref is null or length(btrim(p_actor_ref)) not between 1 and 200
 or p_review_ref is null or length(btrim(p_review_ref)) not between 1 and 500 then
  raise exception 'Reviewed identity configuration required' using errcode='PT400'; end if;
 perform 1 from recap_internal.reader_identity_settings where singleton for update;
 update recap_internal.reader_identity_issuers set enabled=false;
 insert into recap_internal.reader_identity_issuers(issuer,enabled) select distinct unnest(p_issuers),true
 on conflict(issuer) do update set enabled=true;
 update recap_internal.reader_identity_settings set mode=p_mode,lifecycle_ready=p_lifecycle_ready where singleton;
 insert into recap_internal.reader_identity_events(action,actor_ref,review_ref,details)
 values('configuration.reviewed',p_actor_ref,p_review_ref,jsonb_build_object('mode',p_mode,'lifecycleReady',p_lifecycle_ready,'issuers',p_issuers));
end;$$;
revoke all on function recap_internal.review_reader_identity_configuration(text,boolean,text[],text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.review_reader_identity_configuration(text,boolean,text[],text,text) to service_role;
create function public.review_reader_identity_configuration(p_mode text,p_lifecycle_ready boolean,p_issuers text[],p_actor_ref text,p_review_ref text)
returns void language sql security invoker set search_path='' as $$
 select recap_internal.review_reader_identity_configuration(p_mode,p_lifecycle_ready,p_issuers,p_actor_ref,p_review_ref)
$$;
revoke all on function public.review_reader_identity_configuration(text,boolean,text[],text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_reader_identity_configuration(text,boolean,text[],text,text) to service_role;

create function recap_internal.bind_reader_identity_alias(p_issuer text,p_subject text,p_owner_id text,p_actor_ref text,p_review_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare existing recap_internal.reader_identity_aliases;
begin
 if p_actor_ref is null or length(btrim(p_actor_ref)) not between 1 and 200
 or p_review_ref is null or length(btrim(p_review_ref)) not between 1 and 500 then
  raise exception 'Explicit reviewed linkage evidence required' using errcode='PT400'; end if;
 -- Use PR17's exact nonblocking shared owner barrier before any configuration
 -- or workspace row lock. Deletion uses its exclusive side with the same salt.
 if to_regprocedure('recap_internal.lock_account_writer(text)') is null then
  raise exception 'Lifecycle writer fence is not installed' using errcode='PT403'; end if;
 perform recap_internal.lock_account_writer(p_owner_id);
 perform 1 from recap_internal.reader_identity_settings where singleton for update;
 if not exists(select 1 from recap_internal.reader_identity_settings where singleton and lifecycle_ready)
 or not exists(select 1 from recap_internal.reader_identity_issuers where issuer=p_issuer and enabled)
 or recap_internal.reader_identity_allowed(p_owner_id,p_issuer,p_subject) is not true then
  raise exception 'Identity linkage is not ready or permitted' using errcode='PT403'; end if;
 -- This foundation links existing readers only; new-reader enrollment is separate.
 perform 1 from public.reader_workspaces where user_id=p_owner_id for update;
 if not found then raise exception 'Existing workspace required' using errcode='PT409'; end if;
 insert into recap_internal.reader_identity_aliases(issuer,subject,owner_id) values(p_issuer,p_subject,p_owner_id)
 on conflict(issuer,subject) do nothing;
 select * into existing from recap_internal.reader_identity_aliases where issuer=p_issuer and subject=p_subject;
 if existing.owner_id is distinct from p_owner_id or existing.revoked_at is not null then
  raise exception 'Alias is already bound or revoked' using errcode='PT409'; end if;
 insert into recap_internal.reader_identity_events(action,actor_ref,review_ref,details)
 values('alias.bound',p_actor_ref,p_review_ref,jsonb_build_object('issuer',p_issuer,'subject',p_subject,'ownerId',p_owner_id));
end;$$;
revoke all on function recap_internal.bind_reader_identity_alias(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.bind_reader_identity_alias(text,text,text,text,text) to service_role;
create function public.bind_reader_identity_alias(p_issuer text,p_subject text,p_owner_id text,p_actor_ref text,p_review_ref text)
returns void language sql security invoker set search_path='' as $$select recap_internal.bind_reader_identity_alias(p_issuer,p_subject,p_owner_id,p_actor_ref,p_review_ref)$$;
revoke all on function public.bind_reader_identity_alias(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.bind_reader_identity_alias(text,text,text,text,text) to service_role;

create function recap_internal.revoke_reader_identity_alias(p_issuer text,p_subject text,p_actor_ref text,p_review_ref text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor_ref is null or length(btrim(p_actor_ref)) not between 1 and 200 or p_review_ref is null or length(btrim(p_review_ref)) not between 1 and 500 then
  raise exception 'Reviewed revocation required' using errcode='PT400'; end if;
 perform 1 from recap_internal.reader_identity_settings where singleton for update;
 update recap_internal.reader_identity_aliases set revoked_at=coalesce(revoked_at,clock_timestamp()) where issuer=p_issuer and subject=p_subject;
 if not found then raise exception 'Alias not found' using errcode='PT409'; end if;
 insert into recap_internal.reader_identity_events(action,actor_ref,review_ref,details)
 values('alias.revoked',p_actor_ref,p_review_ref,jsonb_build_object('issuer',p_issuer,'subject',p_subject));
end;$$;
revoke all on function recap_internal.revoke_reader_identity_alias(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.revoke_reader_identity_alias(text,text,text,text) to service_role;
create function public.revoke_reader_identity_alias(p_issuer text,p_subject text,p_actor_ref text,p_review_ref text)
returns void language sql security invoker set search_path='' as $$select recap_internal.revoke_reader_identity_alias(p_issuer,p_subject,p_actor_ref,p_review_ref)$$;
revoke all on function public.revoke_reader_identity_alias(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_reader_identity_alias(text,text,text,text) to service_role;

-- Replace exactly the eleven original ownership policies, retaining all other
-- predicates and permissions. Fail migration on unexpected base definitions.
do $$
declare p record; using_expr text; check_expr text; changed integer:=0;
begin
 for p in select * from pg_policies where schemaname='public' loop
  using_expr:=p.qual; check_expr:=p.with_check;
  if coalesce(using_expr,'') like '%auth.jwt()%''sub''%' or coalesce(check_expr,'') like '%auth.jwt()%''sub''%' then
   using_expr:=replace(using_expr,'auth.jwt() ->> ''sub''::text','recap_internal.current_reader_owner()');
   check_expr:=replace(check_expr,'auth.jwt() ->> ''sub''::text','recap_internal.current_reader_owner()');
   if coalesce(using_expr,'') like '%auth.jwt()%' or coalesce(check_expr,'') like '%auth.jwt()%' then raise exception 'Unexpected owner policy %',p.policyname; end if;
   execute format('alter policy %I on public.%I %s %s',p.policyname,p.tablename,
    case when using_expr is null then '' else 'using ('||using_expr||')' end,
    case when check_expr is null then '' else 'with check ('||check_expr||')' end);
   changed:=changed+1;
  end if;
 end loop;
 if changed<>11 then raise exception 'Expected eleven direct-sub owner policies, found %',changed; end if;
end;$$;
-- Keep the evolved clear transaction, its lock order, daily tombstones and all
-- prior invalidation behavior. Change only how its caller's owner is resolved.
do $$
declare proc regprocedure; definition text; needle text:='auth.jwt()->>''sub''';
begin
 foreach proc in array array['public.clear_reader_workspace(timestamptz,jsonb)'::regprocedure,
  'recap_internal.lock_own_hourly_policy()'::regprocedure,'recap_internal.reset_own_daily_briefings()'::regprocedure] loop
  definition:=pg_get_functiondef(proc);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected owner function %',proc; end if;
  execute replace(definition,needle,'recap_internal.current_reader_owner()');
 end loop;
end;$$;
do $$
declare definition text; needle text:='auth.jwt()->>''sub''';
begin
 if to_regprocedure('recap_internal.own_account_is_active()') is not null then
  definition:=pg_get_functiondef('recap_internal.own_account_is_active()'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Unexpected lifecycle owner helper'; end if;
  execute replace(definition,needle,'recap_internal.current_reader_owner()');
 end if;
end;$$;
comment on function public.current_reader_owner() is 'Own verified JWT to stable data owner. Legacy subject compatibility by default; linked mode denies untrusted, unbound, revoked or lifecycle-blocked identities.';
comment on function recap_internal.reader_identity_allowed(text,text,text) is 'PR17 adapter only: absent lifecycle fails closed; checks stable account_access_allowed and frozen issuer/subject tombstones. Does not implement deletion or certify native deletion of all aliases. Linked readiness remains false by default.';
commit;
