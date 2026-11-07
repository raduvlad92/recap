-- Inactive integration. Preserve permanent owners and freeze every native alias.
begin;
create table recap_internal.account_deletion_identities (
 request_id uuid not null references recap_internal.account_deletions(id),
 issuer text not null,subject text not null,
 primary key(request_id,issuer,subject),unique(issuer,subject)
);
create table recap_internal.account_deletion_identity_steps (
 request_id uuid not null,issuer text not null,subject text not null,
 restore_generation integer not null check(restore_generation>=0),
 step text not null check(step in('revoked','deleted')),verified_at timestamptz not null default clock_timestamp(),
 primary key(request_id,issuer,subject,restore_generation,step),
 foreign key(request_id,issuer,subject) references recap_internal.account_deletion_identities(request_id,issuer,subject)
);
alter table recap_internal.account_deletion_identities enable row level security;
alter table recap_internal.account_deletion_identity_steps enable row level security;
revoke all on recap_internal.account_deletion_identities,recap_internal.account_deletion_identity_steps from public,anon,authenticated,service_role;
create trigger keep_deletion_identities before update or delete on recap_internal.account_deletion_identities for each row execute function recap_internal.keep_account_deletion();
create trigger keep_deletion_identity_steps before update or delete on recap_internal.account_deletion_identity_steps for each row execute function recap_internal.keep_account_deletion();
-- Old single-identity evidence remains evidence only for that exact locator.
insert into recap_internal.account_deletion_identities select id,identity_issuer,identity_subject from recap_internal.account_deletions;
insert into recap_internal.account_deletion_identities select d.id,a.issuer,a.subject from recap_internal.account_deletions d join recap_internal.reader_identity_aliases a on a.owner_id=d.user_id on conflict(request_id,issuer,subject) do nothing;
insert into recap_internal.account_deletion_identity_steps
 select id,identity_issuer,identity_subject,restore_generation,'revoked',identity_revoked_at from recap_internal.account_deletions where identity_revoked_at is not null;
insert into recap_internal.account_deletion_identity_steps
 select id,identity_issuer,identity_subject,restore_generation,'deleted',identity_deleted_at from recap_internal.account_deletions where identity_deleted_at is not null;
update recap_internal.account_deletions d set state='blocked',completed_at=null,identity_deleted_at=null,identity_revoked_at=null,reason='alias_identity_proof_required',next_attempt_at=clock_timestamp()
 where exists(select 1 from recap_internal.account_deletion_identities i where i.request_id=d.id and not exists(select 1 from recap_internal.account_deletion_identity_steps s where (s.request_id,s.issuer,s.subject,s.restore_generation,s.step)=(i.request_id,i.issuer,i.subject,d.restore_generation,'deleted')))
 and (d.identity_deleted_at is not null or d.state='completed');

create or replace function recap_internal.reader_identity_allowed(p_owner_id text,p_issuer text,p_subject text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if public.account_access_allowed(p_owner_id) is not true then return false;end if;
 return not exists(select 1 from recap_internal.account_deletion_identities where issuer=p_issuer and subject=p_subject);
end;$$;

-- Service-only: verified caller identity -> own tombstone OR ordinary active
-- owner. This exception never resolves content, reminders, admin access or RLS.
create function public.resolve_account_deletion_owner(p_issuer text,p_subject text)returns text
language plpgsql volatile security definer set search_path='' as $$
declare owner_key text;begin
 select d.user_id into owner_key from recap_internal.account_deletion_identities i join recap_internal.account_deletions d on d.id=i.request_id where i.issuer=p_issuer and i.subject=p_subject;
 if found then return owner_key;end if;
 return recap_internal.resolve_reader_owner(p_issuer,p_subject);
end;$$;

create or replace function public.request_account_deletion(p_user_id text,p_request_id uuid,p_identity_issuer text,p_identity_subject text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare d recap_internal.account_deletions;resolved text;begin
 if p_user_id is null or p_request_id is null or p_identity_issuer is null or p_identity_subject is null then raise exception 'Invalid deletion request'using errcode='PT400';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_user_id,170112026)) then raise exception 'Account busy; retry request'using errcode='PT409';end if;
 -- Serialize the snapshot with reviewed alias/configuration changes. Alias
 -- binding takes the same nonblocking shared owner barrier before this row.
 perform 1 from recap_internal.reader_identity_settings where singleton for update;
 resolved:=public.resolve_account_deletion_owner(p_identity_issuer,p_identity_subject);
 if resolved is distinct from p_user_id then raise exception 'Verified account owner required'using errcode='PT403';end if;
 select * into d from recap_internal.account_deletions where user_id=p_user_id;
 if found then return public.read_account_deletion(p_user_id);end if;
 insert into recap_internal.account_deletions(user_id,id,identity_issuer,identity_subject) values(p_user_id,p_request_id,p_identity_issuer,p_identity_subject);
 insert into recap_internal.account_deletion_identities values(p_request_id,p_identity_issuer,p_identity_subject);
 -- Disabled/revoked aliases can still have provider sessions or payloads.
 insert into recap_internal.account_deletion_identities select p_request_id,issuer,subject from recap_internal.reader_identity_aliases where owner_id=p_user_id on conflict(request_id,issuer,subject)do nothing;
 update public.reader_collection_policies set enabled=false,provider_enabled=false where user_id=p_user_id;
 update public.reader_content_analysis_policies set enabled=false where user_id=p_user_id;
 update public.automatic_content_policies set enabled=false where user_id=p_user_id;
 update public.social_content_policies set enabled=false where user_id=p_user_id;
 update public.daily_briefing_schedules set enabled=false where reader_id=p_user_id;
 update public.recap_reminder_preferences set opted_in=false where user_id=p_user_id;
 delete from public.social_collection_consumers where user_id=p_user_id;
 return public.read_account_deletion(p_user_id);
end;$$;

create or replace function public.claim_account_deletion()returns jsonb language plpgsql security definer set search_path=''as $$
declare d recap_internal.account_deletions;begin
 select * into d from recap_internal.account_deletions where state<>'completed'and next_attempt_at<=clock_timestamp()and coalesce(lease_until,'-infinity')<clock_timestamp()order by requested_at for update skip locked limit 1;
 if not found then return null;end if;
 update recap_internal.account_deletions set state='in_progress',reason=null,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'2 minutes',attempts=attempts+1 where id=d.id returning *into d;
 return to_jsonb(d)||jsonb_build_object('identities',(select jsonb_agg(jsonb_build_object('issuer',i.issuer,'subject',i.subject,'deleted',exists(select 1 from recap_internal.account_deletion_identity_steps s where(s.request_id,s.issuer,s.subject,s.restore_generation,s.step)=(i.request_id,i.issuer,i.subject,d.restore_generation,'deleted')))order by i.issuer,i.subject)from recap_internal.account_deletion_identities i where i.request_id=d.id));
end;$$;
create function public.record_account_deletion_identity_step(p_id uuid,p_token uuid,p_issuer text,p_subject text,p_step text)returns void language plpgsql security definer set search_path=''as $$
declare d recap_internal.account_deletions;begin
 select *into strict d from recap_internal.account_deletions where id=p_id for update;
 if not public.confirm_account_deletion_lease(p_id,p_token)then raise exception 'Deletion lease changed'using errcode='PT409';end if;
 if p_step not in('revoked','deleted')or p_step is null or not exists(select 1 from recap_internal.account_deletion_identities where request_id=p_id and issuer=p_issuer and subject=p_subject)then raise exception 'Frozen native identity required'using errcode='PT400';end if;
 -- Confirmed absence implies there are no remaining native sessions for this ID.
 if p_step='deleted'then insert into recap_internal.account_deletion_identity_steps values(p_id,p_issuer,p_subject,d.restore_generation,'revoked',clock_timestamp())on conflict do nothing;end if;
 insert into recap_internal.account_deletion_identity_steps values(p_id,p_issuer,p_subject,d.restore_generation,p_step,clock_timestamp())on conflict do nothing;
end;$$;
-- Preserve the existing financial/retention/restore state machine and add only
-- alias-wide native-proof guards and a bounded incomplete-cleanup outcome.
do $$declare definition text;marker text;begin
 definition:=pg_get_functiondef('public.advance_account_deletion(uuid,uuid,text)'::regprocedure);
 marker:=' if p_step=''identity_revoked'' then';
 if position(marker in definition)=0 then raise exception 'Lifecycle definition drift';end if;
 definition:=replace(definition,marker,$patch$
 if p_step in('identity_revoked','identity_deleted')and exists(select 1 from recap_internal.account_deletion_identities i where i.request_id=d.id and not exists(select 1 from recap_internal.account_deletion_identity_steps s where(s.request_id,s.issuer,s.subject,s.restore_generation,s.step)=(i.request_id,i.issuer,i.subject,d.restore_generation,case when p_step='identity_deleted'then 'deleted'else 'revoked'end)))then raise exception 'Every native alias requires proof'using errcode='PT409';end if;
 if p_step='identity_revoked' then$patch$);
 definition:=replace(definition,'''payload_erasure_retry'',''finish''','''payload_erasure_retry'',''identity_cleanup_pending'',''finish''');
 definition:=replace(definition,'elsif d.identity_deleted_at is null then','elsif d.identity_deleted_at is null or exists(select 1 from recap_internal.account_deletion_identities i where i.request_id=d.id and not exists(select 1 from recap_internal.account_deletion_identity_steps s where(s.request_id,s.issuer,s.subject,s.restore_generation,s.step)=(i.request_id,i.issuer,i.subject,d.restore_generation,''deleted'')))then');
 execute definition;
 definition:=pg_get_functiondef('public.account_deletion_reference_digest(uuid)'::regprocedure);
 marker:='''restoreGeneration'',d.restore_generation,';
 if position(marker in definition)=0 then raise exception 'Retention digest definition drift';end if;
 execute replace(definition,marker,marker||'''identities'',(select coalesce(jsonb_agg(jsonb_build_array(issuer,subject)order by issuer,subject),''[]'')from recap_internal.account_deletion_identities where request_id=d.id),');
end;$$;
revoke all on function public.resolve_account_deletion_owner(text,text),public.record_account_deletion_identity_step(uuid,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.resolve_account_deletion_owner(text,text),public.record_account_deletion_identity_step(uuid,uuid,text,text,text)to service_role;
commit;
