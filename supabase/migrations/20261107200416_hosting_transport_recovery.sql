-- Transport disposition only: never complete/replay business work or settle money.
begin;
create table public.hosting_queue_invocations (
 key text primary key references public.hosting_work(key),
 message_id text not null check(message_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 queue_name text not null check(queue_name='therecap-jobs'),
 control_revision uuid not null,
 frame jsonb not null,
 bound_policy text not null check(bound_policy='cloudflare-queue-wall-15m-plus-2m-v1'),
 recorded_at timestamptz not null,
 not_after timestamptz not null check(not_after=recorded_at+interval '17 minutes')
);
create table public.hosting_transport_dispositions (
 key text primary key references public.hosting_work(key),
 recovery_id uuid not null unique,
 disposition text not null check(disposition in ('expired_outcome_unknown','superseded_unstarted')),
 original_frame jsonb not null,
 control_snapshot jsonb not null,
 native_evidence jsonb not null,
 domain_evidence jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.hosting_queue_invocations enable row level security;
alter table public.hosting_transport_dispositions enable row level security;
revoke all on public.hosting_queue_invocations,public.hosting_transport_dispositions from public,anon,authenticated,service_role;
grant select on public.hosting_queue_invocations,public.hosting_transport_dispositions to service_role;
create function public.hosting_transport_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Hosting transport evidence is immutable'; end $$;
create trigger hosting_invocation_immutable before update or delete on public.hosting_queue_invocations for each row execute function public.hosting_transport_immutable();
create trigger hosting_disposition_immutable before update or delete on public.hosting_transport_dispositions for each row execute function public.hosting_transport_immutable();

-- Hash full private records inside PostgreSQL; never copy prompts/user IDs to
-- the transport audit. Unknown charges remain unknown and contribute their hold.
create function public.read_automatic_hosting_domain_evidence() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'running_tasks',(select count(*) from public.automatic_content_tasks where state='running'),
  'tasks_hash',(select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' order by id),''),'UTF8')),'hex') from public.automatic_content_tasks t),
  'requests_hash',(select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),'' order by session_id,call_key),''),'UTF8')),'hex') from public.keyword_learning_requests r),
  'calls_hash',(select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'),'' order by id),''),'UTF8')),'hex') from public.reader_content_analysis_calls c),
  'unknown_calls',(select count(*) from public.reader_content_analysis_calls where actual_usd is null),
  'commitment_usd',(select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0) from public.reader_content_analysis_calls))
$$;

-- Internal helper. Caller holds control lock; the full original (including
-- timestamps/token/lease) is saved before changing only state and updated_at.
create function public.disposition_automatic_hosting_frame(p_expected jsonb,p_id uuid,p_native jsonb,p_domain jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.hosting_work; a public.hosting_transport_dispositions; outcome text;
begin
 select * into strict w from public.hosting_work where key=p_expected->>'key' for update;
 select * into a from public.hosting_transport_dispositions where key=w.key;
 if found then
  if a.recovery_id=p_id and a.original_frame=p_expected and a.native_evidence=p_native and a.domain_evidence=p_domain
   and to_jsonb(w)=a.original_frame||jsonb_build_object('state','uncertain','updated_at',a.recorded_at) then return to_jsonb(a); end if;
  raise exception 'Hosting disposition changed';
 end if;
 if to_jsonb(w) is distinct from p_expected or w.kind<>'automatic-content' or w.payload is not null
  or w.key !~ ('^cron:automatic-content:'||w.epoch||':[0-9]+$') or w.state not in ('queued','running')
  or (w.state='queued' and (w.lease_token is not null or w.lease_until is not null)) then raise exception 'Hosting frame changed or unsupported'; end if;
 outcome:=case when w.state='running' then 'expired_outcome_unknown' else 'superseded_unstarted' end;
 insert into public.hosting_transport_dispositions(key,recovery_id,disposition,original_frame,control_snapshot,native_evidence,domain_evidence)
 select w.key,p_id,outcome,p_expected,to_jsonb(c),p_native,p_domain from public.hosting_runtime_control c where singleton returning * into a;
 update public.hosting_work set state='uncertain',updated_at=a.recorded_at where key=w.key;
 return to_jsonb(a);
end $$;

-- Recovery pause is distinct from ordinary checked release: explicitly permits
-- a backlog, but does not dispose it or advance the owner/epoch/release.
create function public.pause_hosting_transport_checked(p_epoch bigint,p_release text,p_revision uuid,p_next_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Recovery requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_epoch is null or p_release is null or p_revision is null or p_next_revision is null or p_next_revision=p_revision
  or c.owner<>'cloudflare' or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting control changed'; end if;
 if c.paused and c.release_revision=p_next_revision then return public.read_hosting_release_status(); end if;
 if c.release_revision<>p_revision then raise exception 'Hosting revision changed'; end if;
 update public.hosting_runtime_control set paused=true,release_revision=p_next_revision,updated_at=clock_timestamp() where singleton;
 return public.read_hosting_release_status();
end $$;

-- Service-only operator attestation, NOT a native Cloudflare verifier. Parent
-- must retain actual fixed-resource GET receipts and invocation-bound evidence.
create function public.recover_automatic_hosting_frame_checked(p_epoch bigint,p_release text,p_revision uuid,p_expected jsonb,p_id uuid,p_native jsonb,p_domain jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control; observed timestamptz; stopped timestamptz; w public.hosting_work; prior public.hosting_transport_dispositions;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Recovery requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_epoch is null or p_release is null or p_revision is null or p_id is null or p_expected is null or p_native is null or p_domain is null
  or c.owner<>'cloudflare' or not c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release or c.release_revision<>p_revision
  or (p_expected->>'epoch')::bigint is distinct from p_epoch or p_expected->>'release' is distinct from p_release then raise exception 'Hosting control changed'; end if;
 -- Exact replay after a lost reply is read-only, even if domain evidence later
 -- changes. A newer control revision still invalidates this replay.
 select * into strict w from public.hosting_work where key=p_expected->>'key' for update;
 select * into prior from public.hosting_transport_dispositions where key=p_expected->>'key';
 if found then
  if prior.recovery_id=p_id and prior.original_frame=p_expected and prior.native_evidence=p_native and prior.domain_evidence=p_domain
   and to_jsonb(w)=prior.original_frame||jsonb_build_object('state','uncertain','updated_at',prior.recorded_at) then return to_jsonb(prior); end if;
  raise exception 'Hosting disposition changed';
 end if;
 observed:=(p_native->>'observed_at')::timestamptz; stopped:=(p_native->>'delivery_stopped_at')::timestamptz;
 if observed is null or stopped is null or not isfinite(observed) or not isfinite(stopped) or observed>clock_timestamp() or observed<clock_timestamp()-interval '2 minutes'
  or observed<stopped+interval '17 minutes'
  or octet_length(p_native::text)>16000 or octet_length(p_domain::text)>4000
  or p_native->>'worker' is distinct from 'therecap-jobs' or p_native->>'release' is distinct from p_release
  or p_native->>'queue' is distinct from 'therecap-jobs'
  or p_native->>'queue_id' is null or p_native->>'queue_id' !~ '^[a-f0-9]{32}$'
  or p_native->>'worker_version' is null or p_native->>'worker_version' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or p_native->>'receipt_hash' is null or p_native->>'receipt_hash' !~ '^[a-f0-9]{64}$'
  or p_native->>'max_wall_ms' is distinct from '900000'
  or p_native->'schedules_absent' is distinct from 'true'::jsonb or p_native->'consumers_absent' is distinct from 'true'::jsonb
  or p_native->'deployment_workflows_drained' is distinct from 'true'::jsonb
  or p_native->'message' is distinct from jsonb_build_object('version',1,'kind','automatic-content','epoch',p_epoch,'release',p_release,'key',p_expected->>'key')
  or not ((coalesce(p_native->>'message_id','') ~ '^[A-Za-z0-9_-]{1,200}$' and not (p_native ? 'message_status'))
   or (not (p_native ? 'message_id') and coalesce(p_native->>'message_status','')='not_observed')) then raise exception 'Native invocation/message proof required'; end if;
 select * into strict w from public.hosting_work where key=p_expected->>'key' for update;
 if w.created_at>stopped or (w.state='running' and (w.lease_until is null or w.lease_until>=clock_timestamp() or w.updated_at>stopped)) then raise exception 'Hosting invocation not drained'; end if;
 lock table public.automatic_content_tasks,public.keyword_learning_requests,public.reader_content_analysis_calls in share mode;
 if p_domain is distinct from public.read_automatic_hosting_domain_evidence() or p_domain->>'running_tasks' is distinct from '0' then raise exception 'Automatic domain evidence changed or running'; end if;
 return public.disposition_automatic_hosting_frame(p_expected,p_id,p_native,p_domain);
end $$;

-- New native automatic-content queue claims record a conservative upper bound
-- AFTER entering the invocation. A lease is not this proof. Legacy frames lack
-- this receipt and can only use the paused operator path above.
create function public.begin_automatic_hosting_queue_work(p_key text,p_epoch bigint,p_release text,p_message_id text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control; w public.hosting_work; busy public.hosting_work; inv public.hosting_queue_invocations; claim jsonb; evidence jsonb; at_time timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Queue claim requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for update;
 if p_key is null or p_epoch is null or p_release is null or p_message_id is null or p_message_id !~ '^[A-Za-z0-9_-]{1,200}$'
  or c.owner<>'cloudflare' or c.paused or not c.old_host_fenced or c.epoch<>p_epoch or c.release<>p_release then raise exception 'Hosting queue identity/control changed'; end if;
 select * into w from public.hosting_work where key=p_key for update;
 if not found then raise exception 'Hosting queue frame missing'; end if;
 if w.kind<>'automatic-content' or w.epoch<>p_epoch or w.release<>p_release or w.payload is not null
  or w.key !~ ('^cron:automatic-content:'||p_epoch||':[0-9]+$') then raise exception 'Hosting queue identity conflict'; end if;
 if w.state<>'queued' then return null; end if;
 for busy in select * from public.hosting_work where kind='automatic-content' and state='running' order by key for update loop
  select * into inv from public.hosting_queue_invocations where key=busy.key;
  if inv.key is not null and inv.control_revision=c.release_revision and inv.frame=to_jsonb(busy) and inv.not_after<clock_timestamp() then
   lock table public.automatic_content_tasks,public.keyword_learning_requests,public.reader_content_analysis_calls in share mode;
   evidence:=public.read_automatic_hosting_domain_evidence();
   if evidence->>'running_tasks'='0' then
    perform public.disposition_automatic_hosting_frame(to_jsonb(busy),gen_random_uuid(),jsonb_build_object('mode','recorded_invocation_bound','invocation',to_jsonb(inv)),evidence);
    continue;
   end if;
  end if;
  -- This unstarted tick adds no new task intent. Do not retry it into the DLQ
  -- while the durable domain queue is already being serviced or needs review.
  perform public.disposition_automatic_hosting_frame(to_jsonb(w),gen_random_uuid(),jsonb_build_object('mode','coalesced_tick','message_id',p_message_id,'queue','therecap-jobs','blocked_by',busy.key),'{}'::jsonb);
  return jsonb_build_object('superseded',true,'recovery_required',inv.key is null or inv.not_after<clock_timestamp());
 end loop;
 claim:=public.begin_hosting_work(p_key,'automatic-content',p_epoch,p_release);
 if claim is null or claim ? 'busy' then return claim; end if;
 select * into strict w from public.hosting_work where key=p_key;
 at_time:=clock_timestamp();
 insert into public.hosting_queue_invocations(key,message_id,queue_name,control_revision,frame,bound_policy,recorded_at,not_after)
 values(p_key,p_message_id,'therecap-jobs',c.release_revision,to_jsonb(w),'cloudflare-queue-wall-15m-plus-2m-v1',at_time,at_time+interval '17 minutes');
 return claim||jsonb_build_object('revision',c.release_revision);
end $$;

-- Completion is invocation-bound too. A late/fenced reply can only report an
-- uncertain transport outcome; it cannot turn an expired frame into success.
create function public.finish_automatic_hosting_queue_work(p_key text,p_token uuid,p_epoch bigint,p_release text,p_message_id text,p_completed boolean)
returns void language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare c public.hosting_runtime_control; w public.hosting_work; inv public.hosting_queue_invocations; completed boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Queue finish requires read committed'; end if;
 select * into strict c from public.hosting_runtime_control where singleton for share;
 select * into strict w from public.hosting_work where key=p_key for update;
 select * into strict inv from public.hosting_queue_invocations where key=p_key;
 if p_token is null or p_epoch is null or p_release is null or p_message_id is null
  or w.kind<>'automatic-content' or w.epoch<>p_epoch or w.release<>p_release or w.lease_token is distinct from p_token
  or w.state<>'running' or inv.message_id<>p_message_id or inv.frame is distinct from to_jsonb(w) then raise exception 'Hosting invocation identity changed'; end if;
 completed:=p_completed is true and w.lease_until>clock_timestamp() and inv.not_after>clock_timestamp()
  and c.owner='cloudflare' and not c.paused and c.old_host_fenced and c.epoch=p_epoch and c.release=p_release and c.release_revision=inv.control_revision;
 perform public.finish_hosting_work(p_key,p_token,p_epoch,completed);
end $$;

revoke all on function public.hosting_transport_immutable(),public.disposition_automatic_hosting_frame(jsonb,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_automatic_hosting_domain_evidence(),public.pause_hosting_transport_checked(bigint,text,uuid,uuid),public.recover_automatic_hosting_frame_checked(bigint,text,uuid,jsonb,uuid,jsonb,jsonb),public.begin_automatic_hosting_queue_work(text,bigint,text,text),public.finish_automatic_hosting_queue_work(text,uuid,bigint,text,text,boolean) from public,anon,authenticated;
grant execute on function public.read_automatic_hosting_domain_evidence(),public.pause_hosting_transport_checked(bigint,text,uuid,uuid),public.recover_automatic_hosting_frame_checked(bigint,text,uuid,jsonb,uuid,jsonb,jsonb),public.begin_automatic_hosting_queue_work(text,bigint,text,text),public.finish_automatic_hosting_queue_work(text,uuid,bigint,text,text,boolean) to service_role;
commit;
