-- Distinct, content-bound metadata repair reuses existing intent/fee/lease
-- state. No old rows, caps, unknown holds, source policies or schedules change.
begin;
alter table public.collection_retrieval_attempts drop constraint collection_retrieval_attempts_item_key_check;
alter table public.collection_retrieval_attempts add constraint collection_retrieval_attempts_item_key_check
 check(item_key ~ '^(youtube:[A-Za-z0-9_-]{11}|youtube-discovery:UC[A-Za-z0-9_-]{22}:[0-9]{4}-[0-9]{2}-[0-9]{2}|original:[a-f0-9]{64}|youtube-format:[A-Za-z0-9_-]{11}:[a-f0-9]{64})$');
create or replace function public.reserve_hourly_provider(p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_actor_id text,p_maximum_usd numeric,p_parent_reservation_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; p public.reader_collection_policies; r public.collection_budget_reservations; j public.reader_collection_provider_jobs; daily numeric; lifetime numeric; claimed jsonb;
begin
 select * into e from public.reader_collection_checks where id=p_check_id;
 select * into p from public.reader_collection_policies where user_id=e.user_id for update;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if not coalesce(p.enabled and p.provider_enabled,false) or e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Provider disabled or lease changed' using errcode='PT409'; end if;
 if not exists(select 1 from public.reader_workspaces w where w.user_id=e.user_id and w.updated_at=s.workspace_revision and w.state->'followedSourceIds' ? e.source_id and exists(select 1 from jsonb_array_elements(w.state->'customSources') x where x->>'id'=e.source_id and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)) then raise exception 'Follow changed' using errcode='PT409'; end if;
 if p_item_key is null or not coalesce((
  p_item_key ~ '^youtube:[A-Za-z0-9_-]{11}$'
  or (e.platform='YouTube' and p_actor_id='h7sDV53CddomktSi5' and p_maximum_usd<=0.005
   and p_item_key ~ '^youtube-format:[A-Za-z0-9_-]{11}:[a-f0-9]{64}$'
   and exists(select 1 from public.reader_source_updates a where a.user_id=e.user_id and a.source_id=e.source_id
    and public.hourly_item_key(a.record->>'url')='youtube:'||split_part(p_item_key,':',2)
    and a.record->>'contentKind'='transcript' and length(btrim(a.record->>'content'))>0
    and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=split_part(p_item_key,':',3)
    and coalesce(a.record#>>'{videoFormat,kind}','unknown')='unknown'))
  or (e.platform='YouTube' and p_actor_id='h7sDV53CddomktSi5' and p_maximum_usd<=0.02
   and p_item_key='youtube-discovery:'||coalesce(s.channel_id,substring(e.source_url from '/channel/(UC[A-Za-z0-9_-]{22})'))||':'||(clock_timestamp()at time zone'UTC')::date::text)
 ),false) or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>0.10 then raise exception 'Invalid provider reservation' using errcode='PT400'; end if;
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

create or replace function public.prepare_late_provider_fee(p_job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;
begin
 select * into j from public.reader_collection_provider_jobs where id=p_job_id;
 select * into r from public.collection_budget_reservations where id=j.reservation_id;
 select * into l from public.collection_jobs where id=j.job_id;
 if j.id is null or r.id is null or l.id is null or j.state not in('completed','failed') or r.kind<>'job' or r.parent_id is not null or r.state<>'settled'
  or r.launch_attempted_at is null or r.provider<>'apify' or r.actor_id<>'h7sDV53CddomktSi5'
  or j.actor_id is distinct from r.actor_id or j.maximum_usd is distinct from r.maximum_usd
  or j.actual_cost_usd is distinct from r.actual_cost_usd or j.provider_run_id is null or j.provider_run_id is distinct from r.provider_run_id
  or l.provider_run_id is distinct from r.provider_run_id or l.actor_id is distinct from r.actor_id or l.provider<>'apify'
  or l.user_id is distinct from j.user_id or l.source_id is distinct from j.source_id or l.platform<>'YouTube'
  or j.item_key !~ '^(youtube:|youtube-discovery:|youtube-format:)'  then
  raise exception 'Only exact already-settled YouTube references can be corrected' using errcode='PT409';
 end if;
 return jsonb_build_object('provider_job_id',j.id,'reservation_id',r.id,'user_id',j.user_id,'provider_run_id',r.provider_run_id,'actor_id',r.actor_id,
  'revision',md5(to_jsonb(r)::text||to_jsonb(j)::text||to_jsonb(l)::text));
end; $$;
create or replace function public.merge_hourly_video_enrichment(p_base jsonb,p_incoming jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:=p_base; before_format jsonb; after_format jsonb; chosen jsonb; before_kind text; after_kind text;
 original_short boolean; incoming_short boolean; original_canonical_short boolean; incoming_canonical_short boolean;
begin
 if p_base->>'sourceId' is distinct from p_incoming->>'sourceId'
  or public.hourly_item_key(p_base->>'url') is distinct from public.hourly_item_key(p_incoming->>'url')
  or public.hourly_item_key(p_base->>'url') is null then
  raise exception 'Enrichment identity changed' using errcode='PT409';
 end if;
 -- A paid metadata repair binds the exact transcript CURRENT at the atomic
 -- UPDATE, not just the queue's older copy. No text/annotation/date replacement.
 if p_incoming ? 'metadataExpectedContentHash' then
  if jsonb_typeof(p_incoming->'metadataExpectedContentHash') is distinct from 'string'
   or coalesce(p_incoming->>'metadataExpectedContentHash','') !~ '^[a-f0-9]{64}$'
   or p_base->>'format' is distinct from 'video' or p_base->>'contentKind' is distinct from 'transcript'
   or length(coalesce(p_base->>'content',''))=0
   or encode(sha256(convert_to(p_base->>'content','UTF8')),'hex') is distinct from p_incoming->>'metadataExpectedContentHash' then
   return p_base;
  end if;
  p_incoming:=jsonb_build_object('sourceId',p_incoming->'sourceId','url',p_incoming->'url','format','video',
   'videoFormat',p_incoming->'videoFormat','isShort',p_incoming->'isShort');
 end if;
 if p_base->>'format'='video' or p_incoming->>'format'='video' then
  before_format:=p_base->'videoFormat'; after_format:=p_incoming->'videoFormat';
  -- Match sanitizeVideoFormat: enum values must be primitive strings. Invalid
  -- objects are missing evidence, never a trusted short/regular declaration.
  if jsonb_typeof(before_format) is distinct from 'object' or jsonb_typeof(before_format->'kind') is distinct from 'string' or jsonb_typeof(before_format->'basis') is distinct from 'string' or coalesce(before_format->>'kind','') not in ('short','regular','unknown') or coalesce(before_format->>'basis','') not in ('provider','canonical_url','watch_page','legacy') then before_format:=null; end if;
  if jsonb_typeof(after_format) is distinct from 'object' or jsonb_typeof(after_format->'kind') is distinct from 'string' or jsonb_typeof(after_format->'basis') is distinct from 'string' or coalesce(after_format->>'kind','') not in ('short','regular','unknown') or coalesce(after_format->>'basis','') not in ('provider','canonical_url','watch_page','legacy') then after_format:=null; end if;
  original_canonical_short:=coalesce(p_base->>'url' ~ '^https://(www\.|m\.)?youtube\.com/shorts/[A-Za-z0-9_-]+/?([?#].*)?$',false);
  incoming_canonical_short:=coalesce(p_incoming->>'url' ~ '^https://(www\.|m\.)?youtube\.com/shorts/[A-Za-z0-9_-]+/?([?#].*)?$',false);
  original_short:=coalesce(p_base->'isShort'='true'::jsonb,false) or original_canonical_short or coalesce(before_format->>'kind'='short',false);
  incoming_short:=coalesce(p_incoming->'isShort'='true'::jsonb,false) or incoming_canonical_short or coalesce(after_format->>'kind'='short',false);
  -- Normalize each side exactly as the client's videoFormatKind/evidence
  -- helpers do, including a missing classification's explicit legacy unknown.
  before_kind:=case when before_format->>'kind'='unknown' then 'unknown'
   when original_canonical_short then 'short'
   when before_format->>'kind'='regular' and p_base->'isShort'='true'::jsonb then 'unknown'
   when original_short then 'short' when before_format->>'kind'='regular' and before_format->>'basis'<>'legacy' then 'regular' else 'unknown' end;
  after_kind:=case when after_format->>'kind'='unknown' then 'unknown'
   when incoming_canonical_short then 'short'
   when after_format->>'kind'='regular' and p_incoming->'isShort'='true'::jsonb then 'unknown'
   when incoming_short then 'short' when after_format->>'kind'='regular' and after_format->>'basis'<>'legacy' then 'regular' else 'unknown' end;
  before_format:=case when before_format->>'kind'=before_kind then before_format
   when before_kind='short' and original_canonical_short then jsonb_build_object('kind','short','basis','canonical_url')
   when before_format is not null then jsonb_set(before_format,'{kind}',to_jsonb(before_kind))
   else jsonb_build_object('kind',before_kind,'basis','legacy') end;
  after_format:=case when after_format->>'kind'=after_kind then after_format
   when after_kind='short' and incoming_canonical_short then jsonb_build_object('kind','short','basis','canonical_url')
   when after_format is not null then jsonb_set(after_format,'{kind}',to_jsonb(after_kind))
   else jsonb_build_object('kind',after_kind,'basis','legacy') end;
  -- Keep checked same-kind provenance against a legacy fallback. Then apply
  -- positive evidence, unresolved conflicts and regular/unknown retention in
  -- the same order as mergedVideoFormat; no raw-format coalesce fallback.
  if before_kind=after_kind and before_format->>'basis'<>'legacy' and after_format->>'basis'='legacy' then chosen:=before_format;
  elsif before_kind='short' or after_kind='short' then chosen:=case when after_kind='short' then after_format else before_format end;
  elsif (original_short or incoming_short) and (before_kind='regular' or after_kind='regular') then chosen:=jsonb_set(case when after_kind='regular' then after_format else before_format end,'{kind}','"unknown"'::jsonb);
  elsif after_kind='unknown' and before_kind='regular' and before_format->>'basis'<>'legacy' then chosen:=before_format;
  else chosen:=after_format; end if;
  if chosen is not null then
   result:=jsonb_set(result,'{videoFormat}',chosen);
   if original_short or incoming_short then result:=jsonb_set(result,'{isShort}','true'::jsonb);
   elsif chosen->>'kind'='regular' then result:=jsonb_set(result,'{isShort}','false'::jsonb); end if;
  end if;
 end if;
 -- Public-original enrichment never changes source/update/date identity or
 -- replaces previously usable source text/curated annotations.
 if p_base->>'format' in('article','podcast') and p_incoming->>'format'=p_base->>'format'
  and p_incoming->>'publishedAt'=p_base->>'publishedAt'
  and p_incoming#>>'{originalContent,version}'='1'
  and p_base#>>'{originalContent,status}' is distinct from 'usable' then
  result:=result||jsonb_strip_nulls(jsonb_build_object('content',coalesce(p_incoming->'content',p_base->'content'),
   'contentKind',p_incoming->'contentKind','originalContent',p_incoming->'originalContent','coverage',p_incoming->'coverage',
   'transcriptSegments',p_incoming->'transcriptSegments'));
 end if;
 -- Stored usable transcripts remain authoritative. A metadata-only description
 -- may be superseded by recovered speech without replacing original metadata.
 if p_incoming->>'contentKind'='transcript' and length(coalesce(p_incoming->>'content',''))>0
  and not coalesce(p_base->>'format'in('article','podcast')and p_incoming#>>'{originalContent,version}'='1',false)
  and (coalesce(p_base->>'contentKind','metadata_only')<>'transcript' or length(coalesce(p_base->>'content',''))=0) then
  result:=result||jsonb_strip_nulls(jsonb_build_object('content',p_incoming->'content','contentKind','transcript','coverage',p_incoming->'coverage','transcriptSegments',p_incoming->'transcriptSegments'));
  if p_base->>'content' is distinct from p_incoming->>'content' and p_base->'videoSummary'->>'status'='unavailable' then result:=result-'videoSummary'; end if;
 end if;
 return result;
end;
$$;

create or replace function public.finish_hourly_source(p_check_id uuid,p_lease_token uuid,p_patch jsonb,p_items jsonb default '[]'::jsonb) returns jsonb
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
  if rec ? 'metadataExpectedContentHash' then
   -- Metadata-only repair may update an existing exact archive only. It must
   -- never create a record from an old queue or persist its internal CAS marker.
   update public.reader_source_updates set record=public.merge_hourly_video_enrichment(record,rec)
    where user_id=e.user_id and id=rec->>'id' and source_id=e.source_id and public.hourly_item_key(record->>'url')=k
     and record is distinct from public.merge_hourly_video_enrichment(record,rec);
   get diagnostics affected=row_count; inserted:=inserted+affected;
   continue;
  end if;
  select archive_id into aid from public.reader_collection_seen_items where user_id=e.user_id and source_id=e.source_id and item_key=k;
  if aid is null then
   aid:=rec->>'id';
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    values(e.user_id,aid,e.source_id,s.collection_id,(rec->>'publishedAt')::timestamptz,rec) on conflict(user_id,id) do nothing;
   get diagnostics affected=row_count; inserted:=inserted+affected;
   if affected=0 and not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid and source_id=e.source_id and public.hourly_item_key(record->>'url')=k) then raise exception 'Archive identity collision' using errcode='PT409'; end if;
   insert into public.reader_collection_seen_items(user_id,source_id,item_key,archive_id) values(e.user_id,e.source_id,k,aid) on conflict do nothing;
  else
   -- A real baseline may still live only in the older workspace JSON. Promote
   -- it with its original identity/annotations before enriching source text.
   if not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid) then
    select x into base_record from jsonb_array_elements(w.state->'importedUpdates') x where x->>'id'=aid and x->>'sourceId'=e.source_id and public.hourly_item_key(x->>'url')=k and x->'isSample'='false'::jsonb limit 1;
    if base_record is not null then
     insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
      values(e.user_id,aid,e.source_id,s.collection_id,(base_record->>'publishedAt')::timestamptz,base_record) on conflict do nothing;
    end if;
   end if;
   -- Merge only classification and missing captions. Preserve the original
   -- identity, original text/media/context and every independent annotation.
   update public.reader_source_updates set record=public.merge_hourly_video_enrichment(record,rec)
    where user_id=e.user_id and id=aid and source_id=e.source_id and public.hourly_item_key(record->>'url')=k
     and record is distinct from public.merge_hourly_video_enrichment(record,rec);
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

-- Read-only execution capability: callers cannot turn an internal service
-- into a second scheduler. Domain reservations still admit every paid call.
create function public.pipeline_service_capability(p_key text,p_token uuid,p_epoch bigint,p_release text,p_revision uuid,p_stage text,p_message_id text default null)
-- Native hosting tables intentionally have no direct service-role SELECT.
-- This read-only capability check follows their existing definer RPC boundary.
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.hosting_runtime_control c join public.hosting_work w on w.key=p_key
  where c.singleton and c.owner='cloudflare' and not c.paused and c.old_host_fenced
   and c.epoch=p_epoch and c.release=p_release and c.release_revision=p_revision
   and w.epoch=c.epoch and w.release=c.release and w.lease_token=p_token and w.state='running' and w.lease_until>clock_timestamp()
   and ((p_stage in('collection','enrichment') and w.kind in('hourly-collection','social-collection'))
    or(p_stage in('generation','verification') and w.kind in('automatic-content','social-content')))
   and(w.kind<>'automatic-content' or exists(select 1 from public.hosting_queue_invocations i
    where i.key=w.key and i.frame=to_jsonb(w) and i.message_id=p_message_id
     and i.control_revision=c.release_revision and i.not_after>clock_timestamp()))),false);
$$;
revoke all on function public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text) to service_role;
commit;
