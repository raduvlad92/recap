-- Explicit requests only. No reader is selected, deleted or enabled by apply.
begin;
create table recap_internal.account_deletions (
 user_id text primary key check(length(user_id) between 1 and 200),
 identity_issuer text not null check(length(identity_issuer)between 1 and 2048),
 identity_subject text not null check(length(identity_subject)between 1 and 200),
 id uuid not null unique, state text not null default 'requested' check(state in('requested','in_progress','blocked','completed')),
 requested_at timestamptz not null default clock_timestamp(),
 payload_erased_at timestamptz, identity_revoked_at timestamptz, identity_deleted_at timestamptz, completed_at timestamptz,
 reason text, lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
 next_attempt_at timestamptz not null default clock_timestamp(),
 restore_generation integer not null default 0 check(restore_generation>=0),
 check((state='completed')=(completed_at is not null))
);
create table recap_internal.account_deletion_retention_proofs (
 request_id uuid not null references recap_internal.account_deletions(id),restore_generation integer not null,
 policy_version text not null check(policy_version ~ '^[A-Za-z0-9._-]{1,100}$'),
 references_sha256 text not null check(references_sha256 ~ '^[a-f0-9]{64}$'),
 backup_manifest_sha256 text not null check(backup_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 external_manifest_sha256 text not null check(external_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz not null default clock_timestamp(),primary key(request_id,restore_generation)
);
create table recap_internal.account_deletion_external_work (
 request_id uuid not null references recap_internal.account_deletions(id),kind text not null check(kind in('reminder','social')),
 internal_id uuid not null,provider_id text check(provider_id~'^[A-Za-z0-9_-]+$'and length(provider_id)<=300),original_state text not null check(original_state~'^[a-z_]{1,30}$'),started_at timestamptz,
 primary key(request_id,kind,internal_id)
);
create table recap_internal.account_deletion_external_receipts (
 request_id uuid not null,kind text not null,internal_id uuid not null,provider_id text not null check(provider_id~'^[A-Za-z0-9_-]{1,100}$'),receipt_key text not null check(receipt_key~'^[A-Za-z0-9_-]{1,200}$'),
 received_at timestamptz not null default clock_timestamp(),primary key(request_id,kind,internal_id,provider_id,receipt_key),
 foreign key(request_id,kind,internal_id)references recap_internal.account_deletion_external_work(request_id,kind,internal_id)
);
alter table recap_internal.account_deletions enable row level security;
alter table recap_internal.account_deletion_retention_proofs enable row level security;
alter table recap_internal.account_deletion_external_work enable row level security;
alter table recap_internal.account_deletion_external_receipts enable row level security;
revoke all on recap_internal.account_deletions,recap_internal.account_deletion_retention_proofs,recap_internal.account_deletion_external_work,recap_internal.account_deletion_external_receipts from public,anon,authenticated,service_role;

create function recap_internal.keep_account_deletion() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Deletion fence is permanent' using errcode='PT409';end if;
 if tg_table_name<>'account_deletions' then raise exception 'Deletion custody evidence is immutable' using errcode='PT409';end if;
 if (new.user_id,new.id,new.requested_at,new.identity_issuer,new.identity_subject) is distinct from(old.user_id,old.id,old.requested_at,old.identity_issuer,old.identity_subject) then
  raise exception 'Deletion identity is immutable' using errcode='PT409';end if;
 return new;
end;$$;
create trigger keep_account_deletion before update or delete on recap_internal.account_deletions for each row execute function recap_internal.keep_account_deletion();
create trigger keep_retention_proof before update or delete on recap_internal.account_deletion_retention_proofs for each row execute function recap_internal.keep_account_deletion();
create trigger keep_external_work before update or delete on recap_internal.account_deletion_external_work for each row execute function recap_internal.keep_account_deletion();
create trigger keep_external_receipts before update or delete on recap_internal.account_deletion_external_receipts for each row execute function recap_internal.keep_account_deletion();

create function recap_internal.account_is_active(p_user_id text) returns boolean
language sql volatile security definer set search_path='' as $$
 select p_user_id is not null and current_setting('transaction_isolation')='read committed'
  and not exists(select 1 from recap_internal.account_deletions where user_id=p_user_id)
$$;
create function recap_internal.own_account_is_active() returns boolean
language sql volatile security definer set search_path='' as $$
 select recap_internal.account_is_active(auth.jwt()->>'sub')
$$;
create function public.account_access_allowed(p_user_id text) returns boolean
language sql volatile security definer set search_path='' as $$ select recap_internal.account_is_active(p_user_id) $$;

-- A nonblocking owner barrier avoids waiting behind a writer that already holds
-- a domain row. Request/erase use the exclusive side; all owner writes share it.
create function recap_internal.lock_account_writer(p_user_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null then return;end if;
 if current_setting('transaction_isolation')<>'read committed'
  or not pg_try_advisory_xact_lock_shared(hashtextextended(p_user_id,170112026)) then
  raise exception 'Account transaction changed; retry' using errcode='PT409';end if;
end;$$;

alter table public.reader_content_analysis_calls add column erased_job_id uuid;
comment on column public.reader_content_analysis_calls.erased_job_id is 'Exact original internal job identity retained before privacy cascade; no source payload or replacement fee.';

create function recap_internal.account_write_fence() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id text; old_owner text; blocked boolean; n jsonb:=to_jsonb(new); o jsonb;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old);end if;
 owner_id:=coalesce(n->>'user_id',n->>'reader_id');
 old_owner:=coalesce(o->>'user_id',o->>'reader_id');
 if tg_table_name='keyword_learning_requests' then
  select user_id into owner_id from public.reader_content_analysis_calls where id=new.call_id;
 elsif tg_table_name='admin_analysis_prompt_receipts' then
  select user_id into owner_id from public.reader_content_analysis_jobs where id=new.job_id;
 elsif tg_table_name='keyword_production_releases' then
  select user_id into owner_id from public.keyword_learning_sessions where id=new.session_id;
 end if;
 -- Identity reassignment cannot escape a deletion fence.
 perform recap_internal.lock_account_writer(old_owner);
 if owner_id is distinct from old_owner then perform recap_internal.lock_account_writer(owner_id);end if;
 blocked:=exists(select 1 from recap_internal.account_deletions where user_id in(owner_id,old_owner));
 if tg_table_name='reader_content_analysis_calls' and tg_op='UPDATE' and n->'erased_job_id' is distinct from o->'erased_job_id' then
  if not blocked or old.erased_job_id is not null or new.erased_job_id is distinct from old.job_id then
   raise exception 'Erased job identity changed' using errcode='PT409';end if;
 end if;
 if not blocked then return new;end if;
 if tg_op='INSERT' then raise exception 'Account deletion requested' using errcode='PT403';end if;
 case tg_table_name
 when 'reader_content_analysis_calls' then
  if new.attempt_number<>old.attempt_number then raise exception 'Deleted account cannot retry inference' using errcode='PT403';end if;
  new.result:=null;new.result_at:=null;
  -- Token counts are financial metadata; arbitrary model usage objects are not.
  select coalesce(jsonb_object_agg(key,value),'{}') into new.usage from jsonb_each(coalesce(new.usage,'{}'))
   where key in('prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens','cached_tokens','reasoning_tokens') and jsonb_typeof(value)='number';
 when 'keyword_learning_requests' then new.request_payload:=null;new.result:=null;new.error_code:='source_deleted';
 when 'keyword_production_releases' then
  if new.state<>'closed' or new.sources<>'[]'::jsonb or new.recovery_requests<>'[]'::jsonb then raise exception 'Deleted publication closed'using errcode='PT403';end if;
 when 'reader_collection_checks' then new.source_name:='';new.source_url:='';new.details:='{}';
 when 'collection_jobs' then new.source_name:='';new.source_url:='';
 when 'reader_collection_provider_jobs' then new.job_token:=null;new.discard_result:=true;new.content_pending:=false;
 when 'reader_collection_source_state' then
  if new.lease_token is not null and (new.lease_token is distinct from old.lease_token or new.lease_until>old.lease_until) then
   raise exception 'Deleted account cannot acquire source work' using errcode='PT403';end if;
  new.pending_captions:='[]';new.cursor:='{}';new.feed_url:=null;new.etag:=null;new.last_modified:=null;
 when 'reader_collection_policies' then
  if new.enabled or new.provider_enabled or (n-array['enabled','provider_enabled','updated_at']) is distinct from(o-array['enabled','provider_enabled','updated_at']) then
   raise exception 'Deleted account collection disabled' using errcode='PT403';end if;
 when 'reader_content_analysis_policies' then
  -- Global model selection updates disabled policies as well. This grants no
  -- launch authority and never changes the immutable model on historical calls.
  if new.enabled or (n-array['enabled','updated_at','model']) is distinct from(o-array['enabled','updated_at','model']) then
   raise exception 'Deleted account analysis disabled' using errcode='PT403';end if;
 when 'automatic_content_policies','social_content_policies','daily_briefing_schedules' then
  if new.enabled or (n-array['enabled','updated_at'])is distinct from(o-array['enabled','updated_at'])then raise exception 'Deleted account scheduling disabled'using errcode='PT403';end if;
 when 'recap_reminder_preferences' then
  if new.opted_in or(n-array['opted_in'])is distinct from(o-array['opted_in'])then raise exception 'Deleted account reminders disabled'using errcode='PT403';end if;
 when 'keyword_learning_sessions' then
  if new.state<>'closed' or new.user_id is not null or new.sources<>'[]'::jsonb then raise exception 'Deleted evaluation closed' using errcode='PT403';end if;
 when 'content_analysis_admissions','content_analysis_model_comparisons' then
  if new.state<>'closed' or new.user_id is not null or new.manifest is not null then raise exception 'Deleted admission closed' using errcode='PT403';end if;
 else raise exception 'Account deletion requested' using errcode='PT403';
 end case;
 -- A late native identity invalidates a prior retention manifest. Financial
 -- settlement remains possible, but never silently leaves a stale completion.
 if (tg_table_name='reader_content_analysis_calls'and n->'provider_id'is distinct from o->'provider_id')
  or(tg_table_name in('collection_jobs','reader_collection_provider_jobs')and n->'provider_run_id'is distinct from o->'provider_run_id')then
  update recap_internal.account_deletions set state='blocked',completed_at=null,reason='external_reference_changed',next_attempt_at=clock_timestamp()
   where user_id=owner_id and state='completed';
 end if;
 return new;
end;$$;

-- Explicit inventory: future owner/payload tables need the same review. Keep
-- the private fee/transport receipt tables outside all payload deletion paths.
do $$ declare t text;begin
 foreach t in array array['reader_workspaces','reader_source_updates','reader_collection_policies','reader_collection_checks',
 'reader_collection_source_state','reader_collection_seen_items','reader_collection_provider_jobs','collection_jobs','collection_job_consumers',
 'reader_content_analysis_policies','reader_content_analysis_jobs','reader_content_analysis_calls','keyword_learning_sessions','keyword_learning_requests',
 'admin_analysis_prompt_receipts','content_analysis_admissions','content_analysis_model_comparisons','content_analysis_rollout_scopes',
 'admin_keyword_reviews','admin_analysis_reviews','keyword_production_releases','keyword_production_publications','automatic_content_policies','automatic_content_tasks',
 'social_content_policies','social_content_tasks','social_collection_consumers','social_collection_deliveries',
 'daily_briefing_schedules','daily_briefings','daily_briefing_jobs','daily_briefing_consumed_findings','recap_reminder_preferences','recap_reminder_policies','recap_reminder_outbox'] loop
  execute format('create trigger zz_account_write_fence before insert or update on public.%I for each row execute function recap_internal.account_write_fence()',t);
  execute format('create policy account_access_fence on public.%I as restrictive for all to authenticated using(recap_internal.own_account_is_active()) with check(recap_internal.own_account_is_active())',t);
 end loop;
end;$$;

create function recap_internal.active_social_consumers(p_consumers jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$
 select coalesce(jsonb_agg(value order by ordinal),'[]') from jsonb_array_elements(p_consumers)with ordinality a(value,ordinal)
 where recap_internal.account_is_active(value->>'user_id')
$$;
-- Only removal of tombstoned consumers is added to the existing identity guard.
create or replace function public.social_job_identity_guard()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if new.reservation_id is distinct from old.reservation_id and not(old.reservation_id is null and new.reservation_id is not null and old.state='claimed'and new.state='launch_claimed')then raise exception'Social reservation changed'using errcode='PT409';end if;
 if(new.id,new.source_key,new.platform,new.purpose,new.window_from,new.window_to,new.config,new.collection_job_id,new.created_at)is distinct from(old.id,old.source_key,old.platform,old.purpose,old.window_from,old.window_to,old.config,old.collection_job_id,old.created_at)
 or(new.consumers is distinct from old.consumers and new.consumers is distinct from recap_internal.active_social_consumers(old.consumers))
 or(old.provider_run_id is not null and new.provider_run_id is distinct from old.provider_run_id)or(old.dataset_id is not null and new.dataset_id is distinct from old.dataset_id)
 or(old.actual_usd is not null and(new.actual_usd is null or new.actual_usd<old.actual_usd))then raise exception'Immutable social job evidence changed'using errcode='PT409';end if;
 return new;
end;$$;
create function recap_internal.fence_social_job_consumers() returns trigger language plpgsql security definer set search_path='' as $$
declare member jsonb;owner_id text;begin
 for member in select value from jsonb_array_elements(new.consumers) order by value->>'user_id' loop
  perform recap_internal.lock_account_writer(member->>'user_id');
 end loop;
 for owner_id in select d.user_id from recap_internal.account_deletions d join recap_internal.account_deletion_external_work w on w.request_id=d.id where w.kind='social'and w.internal_id=new.id order by d.user_id loop
  perform recap_internal.lock_account_writer(owner_id);
  if tg_op='UPDATE'and(new.provider_run_id,new.dataset_id)is distinct from(old.provider_run_id,old.dataset_id)then
   update recap_internal.account_deletions set state='blocked',completed_at=null,reason='external_reference_changed',next_attempt_at=clock_timestamp()where user_id=owner_id and state='completed';
  end if;
 end loop;
 new.consumers:=recap_internal.active_social_consumers(new.consumers);return new;
end;$$;
create trigger aa_account_consumers before insert or update on public.social_collection_jobs for each row execute function recap_internal.fence_social_job_consumers();

create function recap_internal.fence_hosting_payload()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.payload is not null and new.kind='keyword-learning' and not exists(
  select 1 from public.keyword_learning_sessions s where s.id::text=new.payload->>'sessionId' and s.state='released' and recap_internal.account_is_active(s.user_id))then new.payload:=null;end if;
 return new;
end;$$;
create trigger aa_account_hosting_payload before insert or update on public.hosting_work for each row execute function recap_internal.fence_hosting_payload();
create function recap_internal.fence_social_item()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.social_collection_jobs where id=new.job_id and purpose='collection')and not exists(
  select 1 from public.social_collection_consumers c where c.source_key=new.source_key and recap_internal.account_is_active(c.user_id))then return null;end if;
 return new;
end;$$;
create trigger aa_account_social_item before insert or update on public.social_collection_items for each row execute function recap_internal.fence_social_item();

create function recap_internal.account_audit_details(p_details jsonb)returns jsonb language sql immutable set search_path=''as $$
 select coalesce(jsonb_object_agg(key,value),'{}')from jsonb_each(p_details)where
 (key in('expectedScopeHash','manifestHash','generationContractHash','manifestDigest','originalManifestDigest','reviewDigest','contentHash')and jsonb_typeof(value)='string'and value#>>'{}'~'^[a-f0-9]{64}$')or
 (key in('taskCount','sourceCount','revision','maximumUsd','observedCostUsd','actualUsd','deltaUsd','page')and jsonb_typeof(value)='number')or
 (key in('humanApproval','manualSourceReview','published','edited','listed')and jsonb_typeof(value)='boolean')or
 (key in('kind','status','actorType','previous_model','selected_model','jobId','reservationId','providerRunId')and jsonb_typeof(value)='string'and value#>>'{}'~'^[A-Za-z0-9_./:-]{1,160}$')
$$;
create function recap_internal.fence_account_audit()returns trigger language plpgsql security definer set search_path=''as $$
declare owner_id text;begin
 for owner_id in select user_id from recap_internal.account_deletions where user_id in(new.admin_id,new.target_id)or jsonb_path_exists(new.details,'$.** ? (@ == $owner)',jsonb_build_object('owner',user_id))order by user_id loop
  perform recap_internal.lock_account_writer(owner_id);new.details:=recap_internal.account_audit_details(new.details);
 end loop;return new;
end;$$;
create trigger zz_account_audit before insert or update on public.admin_audit_events for each row execute function recap_internal.fence_account_audit();

-- Existing authenticated webhook processing can acknowledge a late acceptance
-- identity without restoring the deleted outbox, recipient or email payload.
create function recap_internal.record_erased_reminder_reference(p_outbox_id uuid,p_provider_id text,p_event_id text)returns void language plpgsql security definer set search_path=''as $$
declare d recap_internal.account_deletions;begin
 select a.*into d from recap_internal.account_deletions a join recap_internal.account_deletion_external_work w on w.request_id=a.id where w.kind='reminder'and w.internal_id=p_outbox_id;
 if not found then return;end if;
 perform recap_internal.lock_account_writer(d.user_id);
 insert into recap_internal.account_deletion_external_receipts(request_id,kind,internal_id,provider_id,receipt_key)values(d.id,'reminder',p_outbox_id,p_provider_id,p_event_id)on conflict do nothing;
 update recap_internal.account_deletions set state='blocked',completed_at=null,reason='external_reference_changed',next_attempt_at=clock_timestamp()where id=d.id and state='completed';
end;$$;
do $$declare definition text;marker text:=' if o.id is null then return jsonb_build_object(''matched'',false);end if;';begin
 definition:=pg_get_functiondef('public.record_recap_reminder_event(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Reminder webhook definition drift';end if;
 execute replace(definition,marker,$patch$
 if o.id is null then
  if tag~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'then perform recap_internal.record_erased_reminder_reference(tag::uuid,provider,p_event_id);end if;
  return jsonb_build_object('matched',false);
 end if;
$patch$);
end;$$;

-- The old completed-result replay compares cached raw output. After erasure it
-- must still accept genuine exact-call settlement, never restore that cache or
-- roll a valid bill back merely because its old payload was intentionally erased.
do $$declare definition text;marker text:=' if r.completed then';addition text;begin
 definition:=pg_get_functiondef('public.record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then raise exception 'Keyword settlement definition drift';end if;
 addition:=$patch$
 if not public.account_access_allowed(c.user_id) then
  update public.reader_content_analysis_calls set usage=usage_data,provider_id=coalesce(provider,provider_id)where id=c.id;
  update public.keyword_learning_requests set request_payload=null,result=null,error_code='source_deleted',completed=true,completed_at=coalesce(completed_at,clock_timestamp())where session_id=p_session_id and call_key=p_call_key;
  return public.read_keyword_learning_call(p_session_id,p_call_key);
 end if;
$patch$;
 execute replace(definition,marker,addition||marker);
end;$$;

create function public.read_account_deletion(p_user_id text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('requestId',id,'state',state,'reason',reason,'requestedAt',requested_at,
 'payloadErasedAt',payload_erased_at,'identityDeletedAt',identity_deleted_at,'completedAt',completed_at,
 'scope','active_services_with_verified_restore_suppression','backupExpiryActivated',false)
 from recap_internal.account_deletions where user_id=p_user_id
$$;
create function public.request_account_deletion(p_user_id text,p_request_id uuid,p_identity_issuer text,p_identity_subject text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or length(p_user_id) not between 1 and 200 or p_request_id is null or p_identity_issuer is null or p_identity_subject is null then raise exception 'Invalid deletion request' using errcode='PT400';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_user_id,170112026)) then raise exception 'Account busy; retry request' using errcode='PT409';end if;
 insert into recap_internal.account_deletions(user_id,id,identity_issuer,identity_subject) values(p_user_id,p_request_id,p_identity_issuer,p_identity_subject) on conflict(user_id)do nothing;
 update public.reader_collection_policies set enabled=false,provider_enabled=false where user_id=p_user_id;
 update public.reader_content_analysis_policies set enabled=false where user_id=p_user_id;
 update public.automatic_content_policies set enabled=false where user_id=p_user_id;
 update public.social_content_policies set enabled=false where user_id=p_user_id;
 update public.daily_briefing_schedules set enabled=false where reader_id=p_user_id;
 update public.recap_reminder_preferences set opted_in=false where user_id=p_user_id;
 delete from public.social_collection_consumers where user_id=p_user_id;
 return public.read_account_deletion(p_user_id);
end;$$;

create function public.claim_account_deletion() returns jsonb language plpgsql security definer set search_path='' as $$
declare d recap_internal.account_deletions;begin
 select * into d from recap_internal.account_deletions where state<>'completed' and next_attempt_at<=clock_timestamp()
  and coalesce(lease_until,'-infinity')<clock_timestamp() order by requested_at for update skip locked limit 1;
 if not found then return null;end if;
 update recap_internal.account_deletions set state='in_progress',reason=null,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'2 minutes',attempts=attempts+1
 where id=d.id returning * into d;return to_jsonb(d);
end;$$;
create function public.confirm_account_deletion_lease(p_id uuid,p_token uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from recap_internal.account_deletions where id=p_id and lease_token=p_token and lease_until>clock_timestamp() and state='in_progress')
$$;

create function public.erase_account_payloads(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d recap_internal.account_deletions; sessions uuid[];begin
 select * into strict d from recap_internal.account_deletions where id=p_id for update;
 if not public.confirm_account_deletion_lease(p_id,p_token) then raise exception 'Deletion lease changed' using errcode='PT409';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(d.user_id,170112026)) then raise exception 'Account writer still active' using errcode='PT409';end if;
 select array_agg(id)into sessions from public.keyword_learning_sessions where user_id=d.user_id;
 -- Transport key/token/uncertain disposition stays exact; its prompt is payload.
 update public.hosting_work set payload=null where payload->>'sessionId'=any(sessions::text[]);
 update public.reader_content_analysis_calls set erased_job_id=job_id where user_id=d.user_id and job_id is not null and erased_job_id is null;
 insert into recap_internal.account_deletion_external_work(request_id,kind,internal_id,provider_id,original_state,started_at)
 select d.id,'reminder',id,provider_id,state,first_attempt_at from public.recap_reminder_outbox where reader_id=d.user_id and(first_attempt_at is not null or provider_id is not null)
 on conflict do nothing;
 insert into recap_internal.account_deletion_external_work(request_id,kind,internal_id,provider_id,original_state,started_at)
 select d.id,'social',id,provider_run_id,state,created_at from public.social_collection_jobs where exists(select 1 from jsonb_array_elements(consumers)c where c->>'user_id'=d.user_id)on conflict do nothing;
 -- Existing privacy triggers close/redact manifests and production/evaluation
 -- sources BEFORE cascades remove jobs, receipts, reviews, snapshots and outbox.
 delete from public.reader_workspaces where user_id=d.user_id;
 delete from public.reader_source_updates where user_id=d.user_id;
 -- Also cover detached sessions/orphan call caches after earlier workspace clear.
 update public.keyword_learning_requests r set request_payload=null,result=null,error_code='source_deleted'
  from public.reader_content_analysis_calls c where r.call_id=c.id and c.user_id=d.user_id;
 update public.keyword_production_releases set state='closed',sources='[]',recovery_requests='[]' where session_id=any(sessions);
 update public.keyword_learning_sessions set state='closed',user_id=null,sources='[]' where id=any(sessions);
 update public.reader_content_analysis_calls set result=null,result_at=null,usage=usage where user_id=d.user_id;
 update public.reader_collection_provider_jobs set discard_result=true,job_token=null,content_pending=false where user_id=d.user_id;
 delete from public.reader_collection_seen_items where user_id=d.user_id;
 update public.reader_collection_source_state set pending_captions='[]',cursor='{}',feed_url=null,etag=null,last_modified=null,lease_token=null,lease_until=null,check_id=null where user_id=d.user_id;
 delete from public.reader_collection_source_state s where s.user_id=d.user_id and not exists(select 1 from public.reader_collection_provider_jobs p where p.user_id=s.user_id and p.source_id=s.source_id);
 update public.reader_collection_checks set source_name='',source_url='',details='{}' where user_id=d.user_id;
 delete from public.reader_collection_checks c where c.user_id=d.user_id and not exists(select 1 from public.reader_collection_provider_jobs p where p.check_id=c.id);
 update public.collection_jobs set source_name='',source_url='' where user_id=d.user_id;
 delete from public.collection_job_consumers where user_id=d.user_id;
 delete from public.social_collection_consumers where user_id=d.user_id;
 delete from public.social_collection_deliveries where user_id=d.user_id;
 delete from public.social_collection_items i where exists(select 1 from public.social_collection_jobs j where j.source_key=i.source_key and exists(select 1 from jsonb_array_elements(j.consumers)c where c->>'user_id'=d.user_id))
  and not exists(select 1 from public.social_collection_consumers c where c.source_key=i.source_key and recap_internal.account_is_active(c.user_id));
 update public.social_collection_jobs set consumers=recap_internal.active_social_consumers(consumers)
  where exists(select 1 from jsonb_array_elements(consumers)c where c->>'user_id'=d.user_id);
 -- Shared public acquisition is retained for other readers, never re-delivered
 -- to this owner. Unfollowed shared originals have no private owner linkage.
 update public.admin_audit_events set details=recap_internal.account_audit_details(details) where admin_id=d.user_id or target_id=d.user_id or jsonb_path_exists(details,'$.** ? (@ == $owner)',jsonb_build_object('owner',d.user_id));
 update recap_internal.account_deletions set payload_erased_at=clock_timestamp() where id=d.id;
 return public.read_account_deletion(d.user_id);
end;$$;

create function public.account_deletion_reference_digest(p_id uuid) returns text
language sql security definer set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('restoreGeneration',d.restore_generation,
 'model',(select coalesce(jsonb_agg(jsonb_build_array(id,provider_id,erased_job_id,call_key,request_hash)order by id),'[]')from public.reader_content_analysis_calls where user_id=d.user_id),
 'source',(select coalesce(jsonb_agg(jsonb_build_array(id,provider_run_id,actor_id)order by id),'[]')from public.collection_jobs where user_id=d.user_id),
 'sourceReservations',(select coalesce(jsonb_agg(jsonb_build_array(id,job_id,reservation_id,provider_run_id,actor_id,maximum_usd)order by id),'[]')from public.reader_collection_provider_jobs where user_id=d.user_id),
 'externalWork',(select coalesce(jsonb_agg(jsonb_build_array(kind,internal_id,provider_id,original_state)order by kind,internal_id),'[]')from recap_internal.account_deletion_external_work where request_id=d.id),
 'social',(select coalesce(jsonb_agg(jsonb_build_array(s.id,s.provider_run_id,s.dataset_id)order by s.id),'[]')from public.social_collection_jobs s join recap_internal.account_deletion_external_work w on w.internal_id=s.id and w.kind='social'where w.request_id=d.id),
 'externalReceipts',(select coalesce(jsonb_agg(jsonb_build_array(kind,internal_id,provider_id,receipt_key)order by kind,internal_id,provider_id,receipt_key),'[]')from recap_internal.account_deletion_external_receipts where request_id=d.id))::text,'UTF8')),'hex')
 from recap_internal.account_deletions d where id=p_id
$$;
-- An operator attestation, NOT an automated backup/provider-erasure proof.
create function public.record_account_deletion_retention_proof(p_id uuid,p_policy_version text,p_references_sha256 text,p_backup_manifest_sha256 text,p_external_manifest_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare d recap_internal.account_deletions;begin
 select * into strict d from recap_internal.account_deletions where id=p_id for update;
 if d.payload_erased_at is null or d.identity_deleted_at is null then raise exception 'Active erasure proof incomplete'using errcode='PT409';end if;
 if p_references_sha256 is distinct from public.account_deletion_reference_digest(p_id) then raise exception 'External references changed' using errcode='PT409';end if;
 insert into recap_internal.account_deletion_retention_proofs(request_id,restore_generation,policy_version,references_sha256,backup_manifest_sha256,external_manifest_sha256)
 values(p_id,d.restore_generation,p_policy_version,p_references_sha256,p_backup_manifest_sha256,p_external_manifest_sha256)on conflict do nothing;
 if not exists(select 1 from recap_internal.account_deletion_retention_proofs where request_id=p_id and restore_generation=d.restore_generation and policy_version=p_policy_version and references_sha256=p_references_sha256 and backup_manifest_sha256=p_backup_manifest_sha256 and external_manifest_sha256=p_external_manifest_sha256)then raise exception 'Retention attestation changed'using errcode='PT409';end if;
end;$$;

create function public.advance_account_deletion(p_id uuid,p_token uuid,p_step text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d recap_internal.account_deletions;why text;begin
 select * into strict d from recap_internal.account_deletions where id=p_id for update;
 if not public.confirm_account_deletion_lease(p_id,p_token) then raise exception 'Deletion lease changed' using errcode='PT409';end if;
 if p_step='identity_revoked' then update recap_internal.account_deletions set identity_revoked_at=coalesce(identity_revoked_at,clock_timestamp())where id=p_id;
 elsif p_step='identity_deleted' then
  update recap_internal.account_deletions set identity_revoked_at=coalesce(identity_revoked_at,clock_timestamp()),identity_deleted_at=coalesce(identity_deleted_at,clock_timestamp())where id=p_id;
 elsif p_step in('clerk_unavailable','clerk_deletion_disabled','payload_erasure_retry','finish')then
  if p_step<>'finish'then why:=p_step;
  elsif d.payload_erased_at is null then why:='payload_erasure_pending';
  elsif d.identity_deleted_at is null then why:='identity_deletion_pending';
  elsif exists(select 1 from public.reader_content_analysis_calls where user_id=d.user_id and actual_usd is null)
    or exists(select 1 from public.reader_collection_provider_jobs where user_id=d.user_id and state in('launch_claimed','running','ambiguous'))
    or exists(select 1 from public.social_collection_jobs s join recap_internal.account_deletion_external_work w on w.internal_id=s.id and w.kind='social'where w.request_id=d.id and s.state in('claimed','launch_claimed','running','ambiguous'))
    or exists(select 1 from public.collection_jobs where user_id=d.user_id and status in('requested','running')) then why:='external_work_unresolved';
  elsif not exists(select 1 from recap_internal.account_deletion_retention_proofs where request_id=p_id and restore_generation=d.restore_generation and references_sha256=public.account_deletion_reference_digest(p_id))then why:='retention_proof_required';
  end if;
  update recap_internal.account_deletions set state=case when why is null then 'completed'else 'blocked'end,reason=why,
   completed_at=case when why is null then clock_timestamp()end,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval'15 minutes'where id=p_id;
 else raise exception 'Invalid lifecycle step' using errcode='PT400';end if;
 return public.read_account_deletion(d.user_id);
end;$$;
-- Quarantined restore only, after replay of the latest independent tombstone
-- manifest and BEFORE enabling serving/workers. Never removes suppression.
create function public.requeue_account_deletion_after_restore(p_id uuid)returns void language plpgsql security definer set search_path=''as $$
begin
 update recap_internal.account_deletions set state='requested',completed_at=null,payload_erased_at=null,reason='restore_recheck_required',
 identity_revoked_at=null,identity_deleted_at=null,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp(),restore_generation=restore_generation+1 where id=p_id;
 if not found then raise exception 'Deletion tombstone required'using errcode='PT409';end if;
end;$$;

-- Lifecycle kind uses the existing dispatcher and secret, with a positive gate.
alter table public.hosting_work drop constraint hosting_work_kind_check;
alter table public.hosting_work add constraint hosting_work_kind_check check(kind in('http','hourly-collection','content-analysis','automatic-content','social-collection','social-content','daily-briefing','recap-reminders','keyword-learning','account-lifecycle'));

revoke all on function recap_internal.keep_account_deletion(),recap_internal.account_is_active(text),recap_internal.own_account_is_active(),
 recap_internal.lock_account_writer(text),recap_internal.account_write_fence(),recap_internal.active_social_consumers(jsonb),recap_internal.fence_social_job_consumers(),recap_internal.fence_hosting_payload(),recap_internal.fence_social_item(),recap_internal.account_audit_details(jsonb),recap_internal.fence_account_audit(),recap_internal.record_erased_reminder_reference(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function recap_internal.own_account_is_active() to authenticated;
grant usage on schema recap_internal to service_role;
grant execute on function recap_internal.active_social_consumers(jsonb) to service_role;
grant execute on function recap_internal.record_erased_reminder_reference(uuid,text,text)to service_role;
revoke all on function public.account_access_allowed(text),public.read_account_deletion(text),public.request_account_deletion(text,uuid,text,text),public.claim_account_deletion(),public.confirm_account_deletion_lease(uuid,uuid),public.erase_account_payloads(uuid,uuid),public.account_deletion_reference_digest(uuid),public.record_account_deletion_retention_proof(uuid,text,text,text,text),public.advance_account_deletion(uuid,uuid,text),public.requeue_account_deletion_after_restore(uuid) from public,anon,authenticated,service_role;
grant execute on function public.account_access_allowed(text),public.read_account_deletion(text),public.request_account_deletion(text,uuid,text,text),public.claim_account_deletion(),public.confirm_account_deletion_lease(uuid,uuid),public.erase_account_payloads(uuid,uuid),public.account_deletion_reference_digest(uuid),public.record_account_deletion_retention_proof(uuid,text,text,text,text),public.advance_account_deletion(uuid,uuid,text),public.requeue_account_deletion_after_restore(uuid) to service_role;
commit;
