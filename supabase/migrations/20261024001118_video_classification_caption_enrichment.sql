-- Classification/caption enrichment only. Does not enable providers, policies,
-- schedules, subscriptions or spending. Parent applies after review.
begin;

create function public.merge_hourly_video_enrichment(p_base jsonb,p_incoming jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:=p_base; before_format jsonb; after_format jsonb; chosen jsonb; before_kind text; after_kind text;
 original_short boolean; incoming_short boolean; original_canonical_short boolean; incoming_canonical_short boolean;
begin
 if p_base->>'sourceId' is distinct from p_incoming->>'sourceId'
  or public.hourly_item_key(p_base->>'url') is distinct from public.hourly_item_key(p_incoming->>'url')
  or public.hourly_item_key(p_base->>'url') is null then
  raise exception 'Enrichment identity changed' using errcode='PT409';
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
 -- Stored usable transcripts remain authoritative. A metadata-only description
 -- may be superseded by recovered speech without replacing original metadata.
 if p_incoming->>'contentKind'='transcript' and length(coalesce(p_incoming->>'content',''))>0
  and (coalesce(p_base->>'contentKind','metadata_only')<>'transcript' or length(coalesce(p_base->>'content',''))=0) then
  result:=result||jsonb_strip_nulls(jsonb_build_object('content',p_incoming->'content','contentKind','transcript','coverage',p_incoming->'coverage','transcriptSegments',p_incoming->'transcriptSegments'));
  if p_base->>'content' is distinct from p_incoming->>'content' and p_base->'videoSummary'->>'status'='unavailable' then result:=result-'videoSummary'; end if;
 end if;
 return result;
end;
$$;
revoke all on function public.merge_hourly_video_enrichment(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.merge_hourly_video_enrichment(jsonb,jsonb) to service_role;

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

commit;
