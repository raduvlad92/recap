begin;

create table recap_internal.hourly_youtube_pilot (
  singleton boolean primary key default true check (singleton),
  reader_id text not null references public.reader_workspaces(user_id) on delete cascade,
  epoch bigint not null,
  release text not null,
  channel_ids text[] not null,
  envelope_id uuid not null,
  proof_day date not null,
  recurring boolean not null
);
create table recap_internal.hourly_youtube_pilot_daily (
  envelope_id uuid not null,
  channel_id text not null,
  utc_day date not null,
  stage text not null check (stage in ('discovery','caption')),
  provider_job_id uuid not null references public.reader_collection_provider_jobs(id) on delete cascade,
  primary key (envelope_id,channel_id,utc_day,stage)
);
alter table recap_internal.hourly_youtube_pilot enable row level security;
alter table recap_internal.hourly_youtube_pilot_daily enable row level security;
revoke all on recap_internal.hourly_youtube_pilot,recap_internal.hourly_youtube_pilot_daily
  from public,anon,authenticated,service_role;

-- Operator activation and rollback use the normal paused, drained release fence.
-- The same reviewed envelope can be reused after a rollback. Its holds survive.
create function public.restore_hourly_youtube_pilot_checked(
  p_epoch bigint,p_release text,p_expected_revision uuid,p_resume_revision uuid,
  p_reader_id text,p_channel_ids text[],p_recurring boolean default false,
  p_proof_day date default (clock_timestamp() at time zone 'UTC')::date
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare
  control public.hosting_runtime_control;
  scope recap_internal.hourly_youtube_pilot;
  envelope public.collection_budget_reservations;
  channels text[];
  monthly jsonb;
begin
  select * into strict control from public.hosting_runtime_control where singleton for update;
  if p_epoch is null or p_release is null or p_expected_revision is null or p_resume_revision is null
    or p_resume_revision=p_expected_revision or p_recurring is null
    or control.owner<>'cloudflare' or not control.old_host_fenced
    or control.epoch<>p_epoch or control.release<>p_release then
    raise exception 'YouTube pilot release changed' using errcode='PT409';
  end if;
  if p_channel_ids is not null then
    select array_agg(id order by id collate "C") into channels from unnest(p_channel_ids) id;
    if p_reader_id is null or p_proof_day is null or channels is distinct from array[
      'UCdBK94H6oZT2Q7l0-b0xmMg','UCeeFfhMcJa1kjtfZAGskOCA','UChIs72whgZI9w6d6FhwGGHA'
    ] then raise exception 'YouTube pilot scope is not reviewed' using errcode='PT400'; end if;
  elsif p_reader_id is not null or p_recurring then
    raise exception 'Rollback does not select a reader' using errcode='PT400';
  end if;
  select * into scope from recap_internal.hourly_youtube_pilot where singleton;
  if control.release_revision=p_resume_revision and not control.paused then
    if channels is distinct from scope.channel_ids or p_reader_id is distinct from scope.reader_id
      or (channels is not null and (scope.epoch<>p_epoch or scope.release<>p_release or scope.proof_day<>p_proof_day or scope.recurring<>p_recurring)) then
      raise exception 'YouTube pilot resume intent changed' using errcode='PT409';
    end if;
    return public.read_hosting_release_status() || jsonb_build_object('channelIds',channels,'envelopeId',scope.envelope_id);
  end if;
  if not control.paused or control.release_revision<>p_expected_revision
    or exists(select 1 from public.hosting_work where state in ('queued','running')) then
    raise exception 'YouTube pilot requires the drained paused release' using errcode='PT409';
  end if;

  if channels is null then
    if scope.singleton is null then raise exception 'YouTube pilot is not installed' using errcode='PT409'; end if;
    delete from recap_internal.hourly_youtube_pilot where singleton;
  else
    if p_recurring and (scope.singleton is null or scope.proof_day<>p_proof_day)
      or not p_recurring and p_proof_day not between (clock_timestamp() at time zone 'UTC')::date
        and (clock_timestamp() at time zone 'UTC')::date+1 then
      raise exception 'YouTube pilot proof scope is unavailable' using errcode='PT409';
    end if;
    if scope.reader_id is not null and scope.reader_id<>p_reader_id then
      raise exception 'YouTube pilot reader changed' using errcode='PT409';
    end if;
    if (select count(distinct s.channel_id)
        from public.reader_workspaces w
        join public.reader_collection_policies p on p.user_id=w.user_id
        join public.reader_collection_source_state s on s.user_id=w.user_id
        where w.user_id=p_reader_id and p.enabled and p.provider_enabled
          and w.state->'followedSourceIds' ? s.source_id and s.channel_id=any(channels))<>3 then
      raise exception 'Reviewed YouTube channels are not followed and identified' using errcode='PT409';
    end if;
    -- Keep the existing reservation lock order. The ledger trigger checks the
    -- combined monthly cap atomically for the new envelope.
    monthly:=public.read_monthly_provider_budget();
    if (monthly->>'limitUsd')::numeric is distinct from 20
      or (monthly->>'paused')::boolean is distinct from false then
      raise exception 'Monthly provider budget unavailable' using errcode='PT402';
    end if;
    envelope:=public.reserve_collection_budget('hourly.youtube-tech-pilot.v1',2.50,'envelope');
    if envelope.state<>'held' or (public.read_monthly_provider_budget()->>'paused')::boolean is distinct from false then
      raise exception 'YouTube pilot envelope unavailable' using errcode='PT402';
    end if;
    insert into recap_internal.hourly_youtube_pilot(reader_id,epoch,release,channel_ids,envelope_id,proof_day,recurring)
      values(p_reader_id,p_epoch,p_release,channels,envelope.id,p_proof_day,p_recurring)
      on conflict(singleton) do update set epoch=excluded.epoch,release=excluded.release,
        channel_ids=excluded.channel_ids,envelope_id=excluded.envelope_id,proof_day=excluded.proof_day,recurring=excluded.recurring;
  end if;

  return public.advance_hosting_release_checked(p_epoch,p_release,p_expected_revision,p_release,true,p_resume_revision)
    || jsonb_build_object('channelIds',channels,'envelopeId',envelope.id);
end;
$$;

create function public.read_hourly_youtube_pilot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s recap_internal.hourly_youtube_pilot; c public.hosting_runtime_control;
begin
  select * into s from recap_internal.hourly_youtube_pilot where singleton;
  if not found then return null; end if;
  select * into strict c from public.hosting_runtime_control where singleton;
  if c.owner<>'cloudflare' or not c.old_host_fenced or c.paused or c.epoch<>s.epoch or c.release<>s.release then
    raise exception 'YouTube pilot requires checked restoration for the serving release' using errcode='PT409';
  end if;
  return jsonb_build_object('readerId',s.reader_id,'channelIds',s.channel_ids,'proofDay',s.proof_day,'recurring',s.recurring);
end;
$$;

create function public.reserve_hourly_youtube_pilot(
  p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_maximum_usd numeric,p_utc_day date
) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  control public.hosting_runtime_control;
  scope recap_internal.hourly_youtube_pilot;
  check_row public.reader_collection_checks;
  policy public.reader_collection_policies;
  source_state public.reader_collection_source_state;
  channel text;
  today date := (clock_timestamp() at time zone 'UTC')::date;
  step text;
  already uuid;
  result jsonb;
  lifetime numeric;
begin
  select * into strict control from public.hosting_runtime_control where singleton for share;
  select * into scope from recap_internal.hourly_youtube_pilot where singleton;
  if not found or control.owner<>'cloudflare' or not control.old_host_fenced or control.paused
    or control.epoch<>scope.epoch or control.release<>scope.release then
    raise exception 'YouTube pilot requires checked restoration' using errcode='PT409';
  end if;
  select * into check_row from public.reader_collection_checks where id=p_check_id;
  if check_row.user_id is distinct from scope.reader_id or check_row.platform is distinct from 'YouTube' then
    raise exception 'Source outside reviewed YouTube pilot' using errcode='PT409';
  end if;

  -- Serialize all reservations for the reader, including aliases of one channel.
  select * into policy from public.reader_collection_policies where user_id=scope.reader_id for update;
  select s.* into source_state from public.reader_collection_source_state s
    where s.user_id=scope.reader_id and s.source_id=check_row.source_id
      and s.check_id=p_check_id and s.lease_token=p_lease_token for update;
  channel:=source_state.channel_id;
  if not coalesce(policy.enabled and policy.provider_enabled,false)
    or channel is null or not channel=any(scope.channel_ids) then
    raise exception 'Source outside reviewed YouTube pilot' using errcode='PT409';
  end if;

  if p_utc_day is distinct from today or not scope.recurring and scope.proof_day<>today then
    raise exception 'YouTube pilot UTC day changed' using errcode='PT409';
  end if;
  if p_item_key='youtube-discovery:'||channel||':'||today::text and p_maximum_usd=0.020 then
    step:='discovery';
  elsif p_item_key ~ '^youtube:[A-Za-z0-9_-]{11}$' and p_maximum_usd=0.005
    and exists(select 1 from jsonb_array_elements(source_state.pending_captions) task
      where task#>>'{record,sourceId}'=check_row.source_id
        and public.hourly_item_key(task#>>'{record,url}')=p_item_key
        and task#>>'{record,contentKind}' is distinct from 'transcript') then
    step:='caption';
  else
    raise exception 'Invalid YouTube pilot reservation' using errcode='PT400';
  end if;
  select provider_job_id into already from recap_internal.hourly_youtube_pilot_daily
    where envelope_id=scope.envelope_id and channel_id=channel and utc_day=today and stage=step;
  if already is null then
    -- A prior TechLinked launch on this day also counts after the scope changes.
    select j.id into already from public.reader_collection_provider_jobs j
      where j.user_id=scope.reader_id and j.item_key=p_item_key
      order by j.created_at limit 1;
  end if;
  if already is not null then return jsonb_build_object('claimed',false,'id',already); end if;
  select coalesce(sum(greatest(coalesce(j.actual_cost_usd,j.maximum_usd),j.observed_cost_usd)),0)
    into lifetime from public.reader_collection_provider_jobs j where j.user_id=scope.reader_id;
  if lifetime+p_maximum_usd>policy.lifetime_limit_usd then
    raise exception 'Reader lifetime budget exhausted' using errcode='PT402';
  end if;

  -- The existing reservation enforces the source lease, follow revision,
  -- reader daily cap, reviewed $2.50 parent and shared monthly cap.
  result:=public.reserve_hourly_provider(p_check_id,p_lease_token,p_item_key,p_job_id,
    'h7sDV53CddomktSi5',p_maximum_usd,scope.envelope_id);
  if result->'claimed'='true'::jsonb then
    insert into recap_internal.hourly_youtube_pilot_daily(envelope_id,channel_id,utc_day,stage,provider_job_id)
      values(scope.envelope_id,channel,today,step,(result->>'id')::uuid);
  end if;
  return result;
end;
$$;

revoke all on function public.restore_hourly_youtube_pilot_checked(bigint,text,uuid,uuid,text,text[],boolean,date),
  public.read_hourly_youtube_pilot(),public.reserve_hourly_youtube_pilot(uuid,uuid,text,uuid,numeric,date)
  from public,anon,authenticated;
grant execute on function public.restore_hourly_youtube_pilot_checked(bigint,text,uuid,uuid,text,text[],boolean,date),
  public.read_hourly_youtube_pilot(),public.reserve_hourly_youtube_pilot(uuid,uuid,text,uuid,numeric,date)
  to service_role;

commit;
