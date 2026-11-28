begin;

create table recap_internal.video_analysis_proofs (
  id uuid primary key,
  user_id text not null references public.reader_workspaces(user_id) on delete cascade,
  release text not null check (release ~ '^[a-f0-9]{40}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  authorized_at timestamptz,
  authorization_ref uuid unique,
  hosting_epoch bigint,
  hosting_revision text,
  closed_at timestamptz
);
create unique index one_authorized_video_analysis_proof
  on recap_internal.video_analysis_proofs ((true)) where authorized_at is not null and closed_at is null;

create table recap_internal.video_analysis_proof_targets (
  proof_id uuid not null references recap_internal.video_analysis_proofs(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 10),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  update_id text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_revision text not null check (source_revision ~ '^[a-f0-9]{64}$'),
  task text not null check (task in ('keywords','recap')),
  task_id uuid unique references public.automatic_content_tasks(id) on delete set null,
  session_id uuid unique references public.keyword_learning_sessions(id) on delete set null,
  primary key (proof_id, ordinal, task),
  unique (proof_id, video_id, task),
  unique (proof_id, update_id, task)
);
alter table recap_internal.video_analysis_proofs enable row level security;
alter table recap_internal.video_analysis_proof_targets enable row level security;
revoke all on recap_internal.video_analysis_proofs, recap_internal.video_analysis_proof_targets from public, anon, authenticated, service_role;
grant select on recap_internal.video_analysis_proofs, recap_internal.video_analysis_proof_targets to service_role;
grant insert (id,user_id,release,manifest_sha256), update (authorized_at,authorization_ref,hosting_epoch,hosting_revision,closed_at)
  on recap_internal.video_analysis_proofs to service_role;
grant insert (proof_id,ordinal,video_id,update_id,source_hash,source_revision,task), update (task_id,session_id)
  on recap_internal.video_analysis_proof_targets to service_role;

create function recap_internal.protect_video_analysis_proof_target()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.proof_id,new.ordinal,new.video_id,new.update_id,new.source_hash,new.source_revision,new.task)
    is distinct from (old.proof_id,old.ordinal,old.video_id,old.update_id,old.source_hash,old.source_revision,old.task)
    or (old.session_id is not null and new.session_id is not null and old.session_id is distinct from new.session_id)
    or (old.task_id is not null and new.task_id is not null and old.task_id is distinct from new.task_id) then
    raise exception 'Video proof manifest and task binding are immutable' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
create trigger protect_video_analysis_proof_target before update on recap_internal.video_analysis_proof_targets
  for each row execute function recap_internal.protect_video_analysis_proof_target();

create function recap_internal.video_analysis_proof_ledger(p_id uuid)
returns table (committed numeric, settled numeric, unresolved bigint, calls bigint)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce(sum(greatest(coalesce(c.actual_usd, c.maximum_usd), coalesce(c.observed_usd, 0))), 0),
    coalesce(sum(greatest(c.actual_usd, coalesce(c.observed_usd, 0))) filter (where c.actual_usd is not null), 0),
    count(*) filter (where c.actual_usd is null),
    count(*)
  from recap_internal.video_analysis_proof_targets t
  join public.keyword_learning_requests r on r.session_id = t.session_id
  join public.reader_content_analysis_calls c on c.id = r.call_id
  where t.proof_id = p_id
$$;

create function recap_internal.assert_video_analysis_proof_live(p recap_internal.video_analysis_proofs)
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  hosting jsonb := public.read_hosting_release_status();
begin
  if p.authorized_at is null or p.closed_at is not null or p.authorized_at + interval '6 hours' <= statement_timestamp()
    or hosting#>>'{control,owner}' is distinct from 'cloudflare'
    or hosting#>>'{control,paused}' is distinct from 'false'
    or hosting#>>'{control,old_host_fenced}' is distinct from 'true'
    or hosting#>>'{control,release}' is distinct from p.release
    or hosting#>>'{control,epoch}' is distinct from p.hosting_epoch::text
    or hosting->>'revision' is distinct from p.hosting_revision then
    raise exception 'Video analysis proof is closed, expired or outside its approved release' using errcode = 'PT403';
  end if;
end;
$$;

create function public.prepare_video_analysis_proof(p_id uuid, p_user_id text, p_release text, p_videos jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  manifest text;
  existing recap_internal.video_analysis_proofs;
  entry record;
  archive public.reader_source_updates;
  workspace jsonb;
  policy_cutoff timestamptz;
  video text;
begin
  if p_id is null or p_user_id is null or p_release is null or p_release !~ '^[a-f0-9]{40}$'
    or jsonb_typeof(p_videos) is distinct from 'array' then
    raise exception 'Invalid video analysis proof manifest' using errcode = 'PT400';
  end if;
  if jsonb_array_length(p_videos) not between 1 and 10 or exists (
    select 1 from jsonb_array_elements(p_videos) v where jsonb_typeof(v) is distinct from 'object'
      or (v - array['updateId','sourceHash','sourceRevision']) <> '{}'::jsonb
      or jsonb_typeof(v->'updateId') is distinct from 'string'
      or char_length(v->>'updateId') not between 1 and 200
      or coalesce(v->>'sourceHash','') !~ '^[a-f0-9]{64}$'
      or coalesce(v->>'sourceRevision','') !~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'Invalid video analysis proof targets' using errcode = 'PT400';
  end if;
  manifest := encode(sha256(convert_to(p_videos::text, 'UTF8')), 'hex');
  insert into recap_internal.video_analysis_proofs(id, user_id, release, manifest_sha256)
  values(p_id, p_user_id, p_release, manifest) on conflict (id) do nothing;
  select * into existing from recap_internal.video_analysis_proofs where id = p_id for update;
  if (existing.user_id, existing.release, existing.manifest_sha256) is distinct from (p_user_id, p_release, manifest) then
    raise exception 'Proof ID already binds another manifest' using errcode = 'PT409';
  end if;
  if exists (select 1 from recap_internal.video_analysis_proof_targets where proof_id = p_id) then
    return jsonb_build_object('id', p_id, 'manifestSha256', manifest, 'videos', jsonb_array_length(p_videos), 'capUsd', .75);
  end if;
  select state into workspace from public.reader_workspaces where user_id = p_user_id;
  select starts_at into policy_cutoff from public.automatic_content_policies where user_id = p_user_id and enabled;
  if policy_cutoff is null then
    raise exception 'Video analysis proof requires an opted-in workspace' using errcode = 'PT403';
  end if;
  for entry in select value, ordinality from jsonb_array_elements(p_videos) with ordinality loop
    select * into archive from public.reader_source_updates where user_id = p_user_id and id = entry.value->>'updateId';
    video := substring(archive.record->>'url' from '^https://(?:www[.]|m[.])?youtube[.]com/watch[?]v=([A-Za-z0-9_-]{11})(?:[&#]|$)');
    if archive.id is null or archive.collected_at < policy_cutoff or video is null or archive.record->>'format' is distinct from 'video'
      or archive.record->>'contentKind' is distinct from 'transcript'
      or public.content_analysis_eligible(workspace, archive.record) is distinct from true
      or encode(sha256(convert_to(archive.record->>'content', 'UTF8')), 'hex') is distinct from entry.value->>'sourceHash'
      or public.content_analysis_source_revision(archive.record) is distinct from entry.value->>'sourceRevision'
      or exists (select 1 from public.automatic_content_tasks t where (t.user_id,t.update_id,t.content_hash) =
        (p_user_id,archive.id,entry.value->>'sourceHash'))
      or exists (select 1 from public.reader_content_analysis_calls c where c.user_id = p_user_id
        and c.actual_usd is null and c.source_revision in (entry.value->>'sourceHash',entry.value->>'sourceRevision')) then
      raise exception 'Proof requires exact current, eligible, unattempted YouTube transcript revisions' using errcode = 'PT409';
    end if;
    insert into recap_internal.video_analysis_proof_targets(proof_id, ordinal, video_id, update_id, source_hash, source_revision, task)
    select p_id, entry.ordinality, video, archive.id, entry.value->>'sourceHash', entry.value->>'sourceRevision', task
    from (values ('keywords'), ('recap')) kinds(task);
  end loop;
  return jsonb_build_object('id', p_id, 'manifestSha256', manifest, 'videos', jsonb_array_length(p_videos), 'capUsd', .75);
end;
$$;

create function public.authorize_video_analysis_proof(p_id uuid, p_manifest text, p_authorization_ref uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  p recap_internal.video_analysis_proofs;
  hosting jsonb := public.read_hosting_release_status();
begin
  select * into p from recap_internal.video_analysis_proofs where id = p_id for update;
  if not found or p_manifest is distinct from p.manifest_sha256 or p.closed_at is not null or p_authorization_ref is null
    or not exists (select 1 from recap_internal.video_analysis_proof_targets where proof_id = p_id) then
    raise exception 'Unconfirmed video analysis proof manifest' using errcode = 'PT409';
  end if;
  if p.authorized_at is not null then
    if p.authorization_ref is distinct from p_authorization_ref then
      raise exception 'Video analysis proof already authorized' using errcode = 'PT409';
    end if;
    perform recap_internal.assert_video_analysis_proof_live(p);
    return;
  end if;
  p.authorized_at := clock_timestamp();
  p.hosting_epoch := (hosting#>>'{control,epoch}')::bigint;
  p.hosting_revision := hosting->>'revision';
  if p.hosting_epoch is null or p.hosting_revision is null then
    raise exception 'Hosting revision unavailable' using errcode = 'PT409';
  end if;
  perform recap_internal.assert_video_analysis_proof_live(p);
  update recap_internal.video_analysis_proofs
  set authorized_at = p.authorized_at, authorization_ref = p_authorization_ref,
    hosting_epoch = p.hosting_epoch, hosting_revision = p.hosting_revision
  where id = p_id;
end;
$$;

create function public.claim_video_analysis_proof_task(p_id uuid, p_manifest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  p recap_internal.video_analysis_proofs;
  target recap_internal.video_analysis_proof_targets;
  archive public.reader_source_updates;
  task_row public.automatic_content_tasks;
  policy public.automatic_content_policies;
  usage record;
  workspace jsonb;
  session uuid;
begin
  select * into p from recap_internal.video_analysis_proofs where id = p_id for update;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Video proof claims require read committed' using errcode = 'PT409';
  end if;
  if not found or p_manifest is distinct from p.manifest_sha256 then
    raise exception 'Unconfirmed video analysis proof manifest' using errcode = 'PT409';
  end if;
  perform recap_internal.assert_video_analysis_proof_live(p);
  select * into usage from recap_internal.video_analysis_proof_ledger(p_id);
  if usage.unresolved > 0 or exists (select 1 from recap_internal.video_analysis_proof_targets x
      join public.automatic_content_tasks t on t.id = x.task_id where x.proof_id = p_id and t.state = 'running') then
    return jsonb_build_object('claimed', false, 'reason', 'video_proof_unresolved');
  end if;
  select * into target from recap_internal.video_analysis_proof_targets
    where proof_id = p_id and session_id is null order by ordinal, task desc limit 1;
  if not found then return jsonb_build_object('claimed', false, 'reason', 'video_proof_complete'); end if;
  if usage.committed + .10 > .75 then return jsonb_build_object('claimed', false, 'reason', 'video_proof_budget_exhausted'); end if;
  select * into archive from public.reader_source_updates where user_id = p.user_id and id = target.update_id;
  select state into workspace from public.reader_workspaces where user_id = p.user_id;
  select * into policy from public.automatic_content_policies where user_id = p.user_id and enabled;
  if policy.user_id is null or not exists (select 1 from public.content_analysis_budget where id and enabled)
    or not exists (select 1 from public.reader_content_analysis_policies where user_id = p.user_id and enabled) then
    raise exception 'Analysis policy is disabled' using errcode = 'PT403';
  end if;
  if archive.id is null or archive.collected_at < policy.starts_at or public.content_analysis_eligible(workspace, archive.record) is distinct from true
    or public.content_analysis_source_revision(archive.record) is distinct from target.source_revision
    or exists (select 1 from public.reader_content_analysis_calls c where c.user_id = p.user_id and c.actual_usd is null
      and c.source_revision in (target.source_hash,target.source_revision)) then
    raise exception 'Proof transcript or its charge state changed' using errcode = 'PT409';
  end if;
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
  values(p.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',target.update_id,
    'sourceHash',target.source_hash,'sourceRevision',target.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],least(policy.session_budget_usd,.75),policy.max_calls,
    least(clock_timestamp()+interval '2 hours',p.authorized_at+interval '6 hours')) returning id into session;
  insert into public.automatic_content_tasks(user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,
      source_snapshot,task,state,session_id,lease_token,lease_until,lease_claims)
  values(p.user_id,target.update_id,archive.source_id,target.source_hash,target.source_revision,
    public.content_analysis_source_fingerprint(workspace,archive.source_id),archive.record,target.task,'running',session,
    gen_random_uuid(),least(clock_timestamp()+interval '15 minutes',p.authorized_at+interval '6 hours'),1)
  returning * into task_row;
  update recap_internal.video_analysis_proof_targets set task_id = task_row.id, session_id = session
    where proof_id = p_id and ordinal = target.ordinal and task = target.task;
  return jsonb_build_object('claimed',true,'task',to_jsonb(task_row)-'source_snapshot','record',archive.record,'leaseToken',task_row.lease_token);
end;
$$;

create function recap_internal.guard_video_analysis_proof_reservation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  target recap_internal.video_analysis_proof_targets;
  p recap_internal.video_analysis_proofs;
  c public.reader_content_analysis_calls;
  usage record;
begin
  select * into target from recap_internal.video_analysis_proof_targets where session_id = new.session_id;
  if not found then return new; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Video proof reservations require read committed' using errcode = 'PT409';
  end if;
  -- A rejected request rolls back its model-call reservation in the same
  -- transaction. The outer reservation function still owns all other caps.
  select * into p from recap_internal.video_analysis_proofs where id = target.proof_id for update;
  perform recap_internal.assert_video_analysis_proof_live(p);
  select * into c from public.reader_content_analysis_calls where id = new.call_id;
  if new.source_ordinal <> 1 or new.source_hash is distinct from target.source_hash
    or c.user_id is distinct from p.user_id or c.source_revision is distinct from target.source_hash
    or c.call_key is distinct from new.call_key or c.request_hash is distinct from new.request_hash
    or c.job_id is not null or c.state is distinct from 'reserved'
    or c.maximum_usd is distinct from .10::numeric or c.actual_usd is not null
    or (new.request_payload->>'originalKey' like 'automatic-video:v1:' || target.task || ':%') is distinct from true
    or c.model is distinct from (case new.request_payload#>>'{request,role}'
      when 'checker' then 'openai/gpt-6.1-sol-pro' when 'extractor' then 'deepseek/deepseek-v4.1-flash-1017' end) then
    raise exception 'Video proof request is outside its frozen target' using errcode = 'PT409';
  end if;
  select * into usage from recap_internal.video_analysis_proof_ledger(p.id);
  if usage.unresolved > 0 then raise exception 'Unresolved video proof charge' using errcode = 'PT409'; end if;
  if usage.committed + c.maximum_usd > .75 then raise exception 'Video proof hard cap exhausted' using errcode = 'PT402'; end if;
  return new;
end;
$$;
create trigger guard_video_analysis_proof_reservation before insert on public.keyword_learning_requests
  for each row execute function recap_internal.guard_video_analysis_proof_reservation();

create function public.read_video_analysis_proof(p_id uuid, p_manifest text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',p.id,'manifestSha256',p.manifest_sha256,'release',p.release,'capUsd',.75,
    'authorizedAt',p.authorized_at,'closedAt',p.closed_at,'authorizationRef',p.authorization_ref,
    'committedUsd',usage.committed,'settledUsd',usage.settled,'unresolved',usage.unresolved,'calls',usage.calls,
    'targets',coalesce((select jsonb_agg(jsonb_build_object('ordinal',x.ordinal,'videoId',x.video_id,
      'task',x.task,'state',coalesce(t.state,case when x.session_id is null then 'unstarted' else 'unavailable' end),'errorCode',t.error_code,'reviewCount',coalesce(t.review_count,0),
      'calls',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'state',c.state,
        'reservedUsd',c.maximum_usd,'actualUsd',c.actual_usd,'observedUsd',c.observed_usd,'errorCode',r.error_code)
        order by r.created_at,r.call_key)
        from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
        where r.session_id=x.session_id),'[]'::jsonb))
      order by x.ordinal,x.task) from recap_internal.video_analysis_proof_targets x
      left join public.automatic_content_tasks t on t.id=x.task_id where x.proof_id=p.id),'[]'::jsonb))
  from recap_internal.video_analysis_proofs p
  cross join lateral recap_internal.video_analysis_proof_ledger(p.id) usage
  where p.id=p_id and p.manifest_sha256=p_manifest
$$;

create function public.close_video_analysis_proof(p_id uuid, p_manifest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  update recap_internal.video_analysis_proofs set closed_at=coalesce(closed_at,clock_timestamp())
  where id=p_id and manifest_sha256=p_manifest;
  if not found then raise exception 'Unconfirmed video analysis proof manifest' using errcode='PT409'; end if;
  return public.read_video_analysis_proof(p_id,p_manifest);
end;
$$;

revoke all on function recap_internal.protect_video_analysis_proof_target(), recap_internal.video_analysis_proof_ledger(uuid),
  recap_internal.assert_video_analysis_proof_live(recap_internal.video_analysis_proofs),
  recap_internal.guard_video_analysis_proof_reservation(),
  public.prepare_video_analysis_proof(uuid,text,text,jsonb), public.authorize_video_analysis_proof(uuid,text,uuid),
  public.claim_video_analysis_proof_task(uuid,text), public.read_video_analysis_proof(uuid,text),
  public.close_video_analysis_proof(uuid,text) from public, anon, authenticated;
grant execute on function recap_internal.protect_video_analysis_proof_target(), recap_internal.video_analysis_proof_ledger(uuid),
  recap_internal.assert_video_analysis_proof_live(recap_internal.video_analysis_proofs),
  recap_internal.guard_video_analysis_proof_reservation(),
  public.prepare_video_analysis_proof(uuid,text,text,jsonb), public.authorize_video_analysis_proof(uuid,text,uuid),
  public.claim_video_analysis_proof_task(uuid,text), public.read_video_analysis_proof(uuid,text),
  public.close_video_analysis_proof(uuid,text) to service_role;

commit;
