-- Optional recap reminders. New operator policies are disabled until explicitly
-- enabled for a finite interval. No sender/API credential is stored in SQL.
begin;

create table public.recap_reminder_runtime_settings (
 id boolean primary key default true check(id),
 encrypted_config jsonb not null check(jsonb_typeof(encrypted_config)='object'and encrypted_config->>'version'='1'and octet_length(encrypted_config::text)<=12000),
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.recap_reminder_runtime_settings enable row level security;
revoke all on public.recap_reminder_runtime_settings from public,anon,authenticated;
grant all on public.recap_reminder_runtime_settings to service_role;

create table public.recap_reminder_preferences (
 user_id text primary key references public.reader_workspaces(user_id) on delete cascade,
 opted_in boolean not null default false,
 consent_revision uuid not null default gen_random_uuid(),
 consented_at timestamptz,
 consent_basis text not null check(consent_basis in('saved_preference','preference_change','unsubscribe')),
 observed_at timestamptz not null default clock_timestamp()
);
create table public.recap_reminder_policies (
 user_id text primary key references public.reader_workspaces(user_id) on delete cascade,
 enabled boolean not null default false,
 enabled_until timestamptz,
 daily_send_limit integer not null default 1 check(daily_send_limit between 1 and 1),
 lifetime_send_limit integer not null default 7 check(lifetime_send_limit between 1 and 31),
 created_at timestamptz not null default clock_timestamp(),
 check(not enabled or enabled_until is not null)
);
create table public.recap_reminder_outbox (
 id uuid primary key default gen_random_uuid(),
 briefing_id uuid not null unique references public.daily_briefings(id) on delete cascade,
 reader_id text not null references public.reader_workspaces(user_id) on delete cascade,
 generation uuid not null,
 consent_revision uuid not null,
 state text not null default 'pending' check(state in('pending','claimed','sending','uncertain','retry','accepted','delivered','bounced','complained','failed','cancelled','suppressed')),
 idempotency_key text not null unique,
 recipient_email text,
 recipient_identity text,
 payload jsonb,
 payload_hash text check(payload_hash is null or payload_hash~'^[0-9a-f]{64}$'),
 provider_id text unique,
 attempts integer not null default 0 check(attempts between 0 and 4),
 first_attempt_at timestamptz,
 last_attempt_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 delivered_at timestamptz,
 last_event_at timestamptz,
 check((payload is null and payload_hash is null)or(jsonb_typeof(payload)='object' and payload_hash is not null)),
 check(payload is null or octet_length(payload::text)<=60000)
);
create index recap_reminder_due on public.recap_reminder_outbox(next_attempt_at,created_at) where state in('pending','claimed','sending','uncertain','retry');
create index recap_reminder_reader_attempt on public.recap_reminder_outbox(reader_id,first_attempt_at) where first_attempt_at is not null;
create table public.recap_reminder_suppressions (
 email_hash text primary key check(email_hash~'^[0-9a-f]{64}$'),
 reason text not null check(reason in('email.bounced','email.complained')),
 created_at timestamptz not null default clock_timestamp()
);
create table public.recap_reminder_events (
 event_id text primary key,
 outbox_id uuid references public.recap_reminder_outbox(id) on delete cascade,
 provider_id text not null,
 event_type text not null,
 occurred_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 check(char_length(event_id)between 1 and 200)
);
create index recap_reminder_events_outbox on public.recap_reminder_events(outbox_id);

alter table public.recap_reminder_preferences enable row level security;
alter table public.recap_reminder_policies enable row level security;
alter table public.recap_reminder_outbox enable row level security;
alter table public.recap_reminder_suppressions enable row level security;
alter table public.recap_reminder_events enable row level security;
revoke all on public.recap_reminder_preferences,public.recap_reminder_policies,public.recap_reminder_outbox,public.recap_reminder_suppressions,public.recap_reminder_events from public,anon,authenticated;
grant all on public.recap_reminder_preferences,public.recap_reminder_policies,public.recap_reminder_outbox,public.recap_reminder_suppressions,public.recap_reminder_events to service_role;

-- A historical saved preference is observed, without inventing its opt-in date.
insert into public.recap_reminder_preferences(user_id,opted_in,consent_basis)
 select user_id,coalesce(state#>>'{settings,emailReminder}'='true',false),'saved_preference' from public.reader_workspaces;

create function recap_internal.sync_reminder_preference()returns trigger
language plpgsql security definer set search_path='' as $$
declare requested boolean:=coalesce(new.state#>>'{settings,emailReminder}'='true',false);
begin
 if tg_op='INSERT' then
  insert into public.recap_reminder_preferences(user_id,opted_in,consent_basis,consented_at)
   values(new.user_id,requested,'preference_change',case when requested then clock_timestamp()end);
 elsif (new.state#>>'{settings,emailReminder}')is distinct from(old.state#>>'{settings,emailReminder}') then
  update public.recap_reminder_preferences set opted_in=requested,consent_revision=gen_random_uuid(),consent_basis='preference_change',consented_at=case when requested then clock_timestamp()end,observed_at=clock_timestamp()where user_id=new.user_id;
  -- Accepted mail cannot be recalled; cancel only work not yet accepted.
  update public.recap_reminder_outbox set state='cancelled',error_code='reminder_consent_changed',lease_until=null,lease_token=null
   where reader_id=new.user_id and state in('pending','claimed','sending','uncertain','retry');
 end if;
 return new;
end;$$;
revoke all on function recap_internal.sync_reminder_preference()from public,anon,authenticated,service_role;
create trigger recap_reminder_preference_changed after insert or update on public.reader_workspaces for each row execute function recap_internal.sync_reminder_preference();

create function recap_internal.queue_ready_briefing_reminder()returns trigger
language plpgsql security definer set search_path='' as $$
declare preference public.recap_reminder_preferences;
begin
 if new.deleted_at is not null or new.status='deleted' then
  update public.recap_reminder_outbox set state='cancelled',error_code='reminder_briefing_deleted',lease_until=null,lease_token=null
   where briefing_id=new.id and state in('pending','claimed','sending','uncertain','retry');
 elsif new.status in('ready','partial','quiet')and new.published_at is not null then
  select*into preference from public.recap_reminder_preferences where user_id=new.reader_id;
  if preference.opted_in and exists(select 1 from public.daily_briefing_schedules s where s.reader_id=new.reader_id and s.generation=new.generation)then
   insert into public.recap_reminder_outbox(briefing_id,reader_id,generation,consent_revision,idempotency_key)
    values(new.id,new.reader_id,new.generation,preference.consent_revision,'therecap:daily-reminder:v1:'||new.id::text)on conflict(briefing_id)do nothing;
  end if;
 end if;
 return new;
end;$$;
revoke all on function recap_internal.queue_ready_briefing_reminder()from public,anon,authenticated,service_role;
create trigger recap_reminder_ready after insert or update on public.daily_briefings for each row execute function recap_internal.queue_ready_briefing_reminder();

create function public.sync_recap_reminders()returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 -- Recovery for a missed creation event only. Do not send historical reminders.
 insert into public.recap_reminder_outbox(briefing_id,reader_id,generation,consent_revision,idempotency_key)
 select b.id,b.reader_id,b.generation,p.consent_revision,'therecap:daily-reminder:v1:'||b.id::text
 from public.daily_briefings b join public.reader_workspaces w on w.user_id=b.reader_id
 join public.daily_briefing_schedules s on s.reader_id=b.reader_id and s.generation=b.generation
 join public.recap_reminder_preferences p on p.user_id=b.reader_id and p.opted_in
 join public.recap_reminder_policies policy on policy.user_id=b.reader_id and policy.enabled and policy.enabled_until>clock_timestamp()
 where b.status in('ready','partial','quiet')and b.published_at is not null and b.deleted_at is null
  and b.published_at>clock_timestamp()-interval'23 hours'and b.cutoff_at>clock_timestamp()-interval'23 hours'
  and w.state#>>'{settings,emailReminder}'='true'
 on conflict(briefing_id)do nothing;
 get diagnostics n=row_count;
 update public.recap_reminder_outbox set state=case when first_attempt_at is not null then'uncertain'else'failed'end,error_code='reminder_retry_window_expired',next_attempt_at='infinity',lease_until=null,lease_token=null
  where state in('pending','claimed','sending','uncertain','retry')and((first_attempt_at is not null and first_attempt_at<=clock_timestamp()-interval'23 hours')or created_at<=clock_timestamp()-interval'23 hours' or attempts>=4 and (lease_until is null or lease_until<clock_timestamp()));
 return jsonb_build_object('synchronized',n);
end;$$;

create function public.claim_recap_reminder(p_lease_seconds integer default 120)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record;o public.recap_reminder_outbox;b public.daily_briefings;w public.reader_workspaces;preference public.recap_reminder_preferences;policy public.recap_reminder_policies;generation uuid;token uuid;
begin
 if p_lease_seconds<30 or p_lease_seconds>120 then raise exception 'Invalid lease'using errcode='PT400';end if;
 for candidate in select id,reader_id from public.recap_reminder_outbox where state in('pending','retry','uncertain','claimed','sending')and next_attempt_at<=clock_timestamp()and(lease_until is null or lease_until<clock_timestamp())order by next_attempt_at,created_at limit 100 loop
  -- Consistent lifecycle lock order: workspace, daily schedule, preferences,
  -- policy, outbox. Never lock an outbox then wait for its workspace.
  select*into w from public.reader_workspaces where user_id=candidate.reader_id for update skip locked;if not found then continue;end if;
  select s.generation into generation from public.daily_briefing_schedules s where s.reader_id=candidate.reader_id for share;
  select*into preference from public.recap_reminder_preferences where user_id=candidate.reader_id for share;
  select*into policy from public.recap_reminder_policies where user_id=candidate.reader_id for update;
  select*into o from public.recap_reminder_outbox where id=candidate.id for update skip locked;if not found then continue;end if;
  if o.state not in('pending','retry','uncertain','claimed','sending')or o.lease_until>clock_timestamp()then continue;end if;
  select*into b from public.daily_briefings where id=o.briefing_id;
  if not coalesce(preference.opted_in,false)or w.state#>>'{settings,emailReminder}'is distinct from'true'or o.consent_revision is distinct from preference.consent_revision or o.generation is distinct from generation or b.deleted_at is not null or b.status not in('ready','partial','quiet')or b.published_at is null then
   update public.recap_reminder_outbox set state='cancelled',error_code='reminder_no_longer_eligible',lease_token=null,lease_until=null where id=o.id;continue;
  end if;
  if not coalesce(policy.enabled,false)or policy.enabled_until<=clock_timestamp()then continue;end if;
  if o.attempts>=4 or coalesce(o.first_attempt_at,o.created_at)<=clock_timestamp()-interval'23 hours'then
   update public.recap_reminder_outbox set state=case when first_attempt_at is not null then'uncertain'else'failed'end,error_code='reminder_retry_window_expired',next_attempt_at='infinity',lease_token=null,lease_until=null where id=o.id;continue;
  end if;
  token:=gen_random_uuid();
  update public.recap_reminder_outbox set state='claimed',lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)where id=o.id returning*into o;
  return jsonb_build_object('claimed',true,'outbox',to_jsonb(o),'briefing',jsonb_build_object('id',b.id,'local_date',b.local_date,'status',b.status,'snapshot',jsonb_build_object('recapLanguage',b.snapshot->>'recapLanguage','interfaceLanguage',b.snapshot->>'interfaceLanguage')),'leaseToken',token);
 end loop;
 return jsonb_build_object('claimed',false);
end;$$;

create function public.authorize_recap_reminder_send(p_outbox_id uuid,p_lease_token uuid,p_recipient_email text,p_recipient_identity text,p_payload jsonb,p_payload_hash text)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner text;o public.recap_reminder_outbox;b public.daily_briefings;w public.reader_workspaces;preference public.recap_reminder_preferences;policy public.recap_reminder_policies;generation uuid;
begin
 select reader_id into owner from public.recap_reminder_outbox where id=p_outbox_id;
 select*into w from public.reader_workspaces where user_id=owner for update;
 if not found then return jsonb_build_object('authorized',false,'reason','reminder_workspace_deleted');end if;
 select s.generation into generation from public.daily_briefing_schedules s where s.reader_id=owner for share;
 select*into preference from public.recap_reminder_preferences where user_id=owner for share;
 select*into policy from public.recap_reminder_policies where user_id=owner for update;
 select*into o from public.recap_reminder_outbox where id=p_outbox_id for update;
 if o.id is null or o.state<>'claimed'or o.lease_token is distinct from p_lease_token or o.lease_until<=clock_timestamp()then raise exception 'Stale reminder claim'using errcode='PT409';end if;
 select*into b from public.daily_briefings where id=o.briefing_id;
 if not coalesce(preference.opted_in,false)or w.state#>>'{settings,emailReminder}'is distinct from'true'or o.consent_revision is distinct from preference.consent_revision or o.generation is distinct from generation or b.deleted_at is not null or b.status not in('ready','partial','quiet')or b.published_at is null or not coalesce(policy.enabled,false)or policy.enabled_until<=clock_timestamp()then
  update public.recap_reminder_outbox set state='cancelled',error_code='reminder_no_longer_eligible',lease_token=null,lease_until=null where id=o.id;return jsonb_build_object('authorized',false,'reason','reminder_no_longer_eligible');
 end if;
 if p_recipient_email is null or length(p_recipient_email)>254 or p_recipient_email!~'^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'or p_recipient_email<>lower(p_recipient_email)or p_recipient_identity is null or length(p_recipient_identity)not between 1 and 200 or p_payload_hash is null or p_payload_hash!~'^[0-9a-f]{64}$'or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>60000 or p_payload->'to'is distinct from jsonb_build_array(p_recipient_email)then raise exception 'Invalid reminder payload'using errcode='PT400';end if;
 if o.recipient_email is not null and(o.recipient_email is distinct from p_recipient_email or o.recipient_identity is distinct from p_recipient_identity or o.payload is distinct from p_payload or o.payload_hash is distinct from p_payload_hash)then
  update public.recap_reminder_outbox set state='cancelled',error_code='reminder_recipient_or_payload_changed',lease_token=null,lease_until=null where id=o.id;return jsonb_build_object('authorized',false,'reason','reminder_recipient_or_payload_changed');
 end if;
 if exists(select 1 from public.recap_reminder_suppressions where email_hash=encode(extensions.digest(p_recipient_email,'sha256'),'hex'))then
  update public.recap_reminder_outbox set state='suppressed',error_code='reminder_recipient_suppressed',lease_token=null,lease_until=null where id=o.id;return jsonb_build_object('authorized',false,'reason','reminder_recipient_suppressed');
 end if;
 if o.attempts>=4 or coalesce(o.first_attempt_at,o.created_at)<=clock_timestamp()-interval'23 hours'then
  update public.recap_reminder_outbox set state=case when first_attempt_at is not null then'uncertain'else'failed'end,error_code='reminder_retry_window_expired',next_attempt_at='infinity',lease_token=null,lease_until=null where id=o.id;return jsonb_build_object('authorized',false,'reason','reminder_retry_window_expired');
 end if;
 if o.first_attempt_at is null and((select count(*)from public.recap_reminder_outbox x where x.reader_id=owner and x.first_attempt_at is not null)>=policy.lifetime_send_limit or(select count(*)from public.recap_reminder_outbox x where x.reader_id=owner and x.first_attempt_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')>=policy.daily_send_limit)then
  update public.recap_reminder_outbox set state='failed',error_code='reminder_send_limit',lease_token=null,lease_until=null where id=o.id;return jsonb_build_object('authorized',false,'reason','reminder_send_limit');
 end if;
 update public.recap_reminder_outbox set state='sending',recipient_email=p_recipient_email,recipient_identity=p_recipient_identity,payload=p_payload,payload_hash=p_payload_hash,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp(),attempts=attempts+1,error_code=null where id=o.id;
 return jsonb_build_object('authorized',true);
end;$$;

create function public.finish_recap_reminder_send(p_outbox_id uuid,p_lease_token uuid,p_outcome text,p_provider_id text default null,p_error_code text default null)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.recap_reminder_outbox;next_state text;
begin
 select*into o from public.recap_reminder_outbox where id=p_outbox_id for update;
 if o.id is null then return jsonb_build_object('state','deleted');end if;
 -- A signed event may have confirmed delivery before our POST response arrived.
 if o.state in('accepted','delivered','bounced','complained')and(p_provider_id is null or o.provider_id=p_provider_id)then return jsonb_build_object('state',o.state);end if;
 if o.state in('cancelled','suppressed')then return jsonb_build_object('state',o.state);end if;
 if o.lease_token is distinct from p_lease_token or o.lease_until<=clock_timestamp()or o.state not in('claimed','sending')then raise exception 'Stale reminder claim'using errcode='PT409';end if;
 if p_outcome not in('accepted','uncertain','retry','failed','cancelled')or p_error_code is not null and(length(p_error_code)>100 or p_error_code!~'^[a-z0-9_]+$')then raise exception 'Invalid outcome'using errcode='PT400';end if;
 if p_outcome='accepted'and(o.state<>'sending'or p_provider_id is null or p_provider_id!~'^[a-zA-Z0-9_-]{1,100}$')then raise exception 'Missing provider acceptance'using errcode='PT400';end if;
 if p_outcome in('uncertain','retry')and o.state<>'sending'then raise exception 'No send started'using errcode='PT409';end if;
 next_state:=p_outcome;
 update public.recap_reminder_outbox set state=next_state,provider_id=coalesce(p_provider_id,provider_id),accepted_at=case when p_outcome='accepted'then coalesce(accepted_at,clock_timestamp())else accepted_at end,error_code=p_error_code,next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_outcome='retry'then 300 else 60 end),lease_token=null,lease_until=null where id=o.id;
 return jsonb_build_object('state',next_state);
end;$$;

create function public.record_recap_reminder_event(p_event_id text,p_event jsonb)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.recap_reminder_outbox;provider text;kind text;occurred timestamptz;tag text;next_state text;recipient text;n integer;
begin
 provider:=p_event#>>'{data,email_id}';kind:=p_event->>'type';occurred:=(p_event->>'created_at')::timestamptz;
 if p_event_id is null or p_event_id!~'^[a-zA-Z0-9_-]{1,200}$'or provider is null or provider!~'^[a-zA-Z0-9_-]{1,100}$'or kind not in('email.sent','email.delivered','email.bounced','email.complained','email.failed')or occurred is null then raise exception 'Invalid event'using errcode='PT400';end if;
 if jsonb_typeof(p_event#>'{data,tags}')='array'then select x->>'value'into tag from jsonb_array_elements(p_event#>'{data,tags}')x where x->>'name'='recap_reminder'limit 1;
 elsif jsonb_typeof(p_event#>'{data,tags}')='object'then tag:=p_event#>>'{data,tags,recap_reminder}';end if;
 select*into o from public.recap_reminder_outbox where provider_id=provider or(tag~'^[0-9a-f-]{36}$'and id::text=tag and provider_id is null and first_attempt_at is not null)order by(provider_id=provider)desc nulls last limit 1 for update;
 if o.id is null then return jsonb_build_object('matched',false);end if;
 recipient:=lower(p_event#>>'{data,to,0}');
 if jsonb_array_length(p_event#>'{data,to}')<>1 or recipient is distinct from o.recipient_email then raise exception 'Event recipient mismatch'using errcode='PT409';end if;
 insert into public.recap_reminder_events(event_id,outbox_id,provider_id,event_type,occurred_at)values(p_event_id,o.id,provider,kind,occurred)on conflict(event_id)do nothing;get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('matched',true,'duplicate',true);end if;
 if kind in('email.bounced','email.complained')then
  insert into public.recap_reminder_suppressions(email_hash,reason)values(encode(extensions.digest(o.recipient_email,'sha256'),'hex'),kind)on conflict(email_hash)do update set reason=case when excluded.reason='email.complained'then excluded.reason else public.recap_reminder_suppressions.reason end;
 end if;
 next_state:=case when kind='email.complained'then'complained'when o.state='complained'then'complained'when kind='email.bounced'then'bounced'when o.state='bounced'then'bounced'when kind='email.delivered'then'delivered'when o.state='delivered'then'delivered'when o.state='failed'then'failed'when kind='email.sent'then'accepted'else'failed'end;
 update public.recap_reminder_outbox set state=case when state in('cancelled','suppressed')then state else next_state end,provider_id=provider,accepted_at=coalesce(accepted_at,occurred),delivered_at=case when kind='email.delivered'then coalesce(delivered_at,occurred)else delivered_at end,last_event_at=greatest(coalesce(last_event_at,occurred),occurred),lease_token=null,lease_until=null where id=o.id;
 return jsonb_build_object('matched',true,'state',next_state);
end;$$;

create function public.unsubscribe_recap_reminder(p_outbox_id uuid)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner text;
begin
 select reader_id into owner from public.recap_reminder_outbox where id=p_outbox_id;
 if owner is null then return jsonb_build_object('unsubscribed',true);end if;
 perform 1 from public.reader_workspaces where user_id=owner for update;
 -- The verified, scoped token identifies a reminder, never an arbitrary reader.
 update public.reader_workspaces set state=jsonb_set(state,'{settings,emailReminder}','false'::jsonb)where user_id=owner;
 update public.recap_reminder_preferences set opted_in=false,consent_revision=gen_random_uuid(),consent_basis='unsubscribe',observed_at=clock_timestamp()where user_id=owner;
 update public.recap_reminder_outbox set state='cancelled',error_code='reminder_unsubscribed',lease_token=null,lease_until=null where reader_id=owner and state in('pending','claimed','sending','uncertain','retry');
 return jsonb_build_object('unsubscribed',true);
end;$$;

revoke all on function public.sync_recap_reminders(),public.claim_recap_reminder(integer),public.authorize_recap_reminder_send(uuid,uuid,text,text,jsonb,text),public.finish_recap_reminder_send(uuid,uuid,text,text,text),public.record_recap_reminder_event(text,jsonb),public.unsubscribe_recap_reminder(uuid)from public,anon,authenticated;
grant execute on function public.sync_recap_reminders(),public.claim_recap_reminder(integer),public.authorize_recap_reminder_send(uuid,uuid,text,text,jsonb,text),public.finish_recap_reminder_send(uuid,uuid,text,text,text),public.record_recap_reminder_event(text,jsonb),public.unsubscribe_recap_reminder(uuid)to service_role;
commit;
