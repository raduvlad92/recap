-- Local/disposable validation only. Parent applies after integration.
-- No enabled policy, source plan, financial limit or provider pin is changed.
begin;
alter table public.collection_retrieval_attempts drop constraint collection_retrieval_attempts_item_key_check;
alter table public.collection_retrieval_attempts add constraint collection_retrieval_attempts_item_key_check
 check(item_key ~ '^(youtube:[A-Za-z0-9_-]{11}|youtube-discovery:UC[A-Za-z0-9_-]{22}:[0-9]{4}-[0-9]{2}-[0-9]{2}|original:[a-f0-9]{64})$');

-- Once per reader/source/item, including failed or uncertain downloads. An
-- operator must inspect retained evidence before any separately scoped retry.
create function public.guard_public_original_attempt()returns trigger
language plpgsql security invoker set search_path=''as $$
declare e public.reader_collection_checks;s public.reader_collection_source_state;w public.reader_workspaces;
begin
 if new.method not in('public_article','publisher_transcript')then return new;end if;
 select *into e from public.reader_collection_checks where id=new.check_id;
 select *into w from public.reader_workspaces where user_id=e.user_id for share;
 select *into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if e.id is null or e.status<>'running' or e.platform not in('Blog','Substack','Podcast')
  or s.check_id is distinct from e.id or s.lease_until<=clock_timestamp() or w.updated_at is distinct from s.workspace_revision
  or not coalesce(w.state->'followedSourceIds' ? e.source_id,false)
  or not exists(select 1 from public.reader_collection_policies p where p.user_id=e.user_id and p.enabled)
  or not exists(select 1 from jsonb_array_elements(w.state->'customSources')x where x->>'id'=e.source_id
   and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint)
  or new.item_key is null or new.item_key!~'^original:[a-f0-9]{64}$' or new.provider<>'native' or new.stage<>'content'then
  raise exception 'Original source check changed'using errcode='PT409';end if;
 if exists(select 1 from public.collection_retrieval_attempts a join public.reader_collection_checks c on c.id=a.check_id
  where c.user_id=e.user_id and c.source_id=e.source_id and a.item_key=new.item_key and a.method in('public_article','publisher_transcript'))then
  raise exception 'Original already attempted'using errcode='PT429';end if;
 return new;
end;$$;
revoke all on function public.guard_public_original_attempt()from public,anon,authenticated,service_role;
create trigger guard_public_original_attempt before insert on public.collection_retrieval_attempts for each row execute function public.guard_public_original_attempt();

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

-- Existing source revisions remain byte-for-byte identical. Only this newly
-- introduced public-original contract adds its exact date and provenance.
create or replace function public.content_analysis_source_revision(p_record jsonb)returns text
language sql immutable strict security invoker set search_path=''as $$
 select case when p_record#>>'{originalContent,version}'='1'then encode(sha256(convert_to(jsonb_build_object(
  'base',base.revision,'publishedAt',p_record->'publishedAt','originalContent',p_record->'originalContent')::text,'UTF8')),'hex')else base.revision end
 from(select encode(sha256(convert_to(jsonb_build_object(
  'id',p_record->'id','sourceId',p_record->'sourceId','url',p_record->'url',
  'title',p_record->'title','format',p_record->'format','isSample',p_record->'isSample',
  'content',p_record->'content','contentKind',p_record->'contentKind',
  'coverage',p_record->'coverage','transcriptSegments',p_record->'transcriptSegments',
  'videoFormatKind',p_record#>'{videoFormat,kind}','isShort',p_record->'isShort')::text,'UTF8')),'hex')revision)base;
$$;

-- Extend the existing opt-in review-first text queue, not the video/legacy
-- automatic publisher. Sync, claim, reservation and finish all call this same
-- predicate and retain current hash/revision/follow/reader and money checks.
create or replace function public.social_content_eligible(p_state jsonb,p_record jsonb)returns boolean
language sql immutable security invoker set search_path=''as $$
 select coalesce(jsonb_typeof(p_state)='object' and jsonb_typeof(p_record)='object'
 and p_record->>'isSample'='false' and jsonb_typeof(p_record->'content')='string'
 and length(btrim(p_record->>'content')) between 15 and 1000000
 and jsonb_typeof(p_state->'followedSourceIds')='array'
 and p_state->'followedSourceIds' ? (p_record->>'sourceId')
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_state->'customSources')='array' then p_state->'customSources' else '[]'::jsonb end)s
 where s->>'id'=p_record->>'sourceId' and (
  (s->>'platform'in('X','Instagram','LinkedIn')and p_record->>'format'='post'and p_record->>'contentKind'='feed_text')
  or(s->>'platform'in('Blog','Substack','Podcast')and p_record->>'format'in('article','podcast')
   and length(p_record->>'content')between 200 and 96000
   and p_record#>>'{originalContent,version}'='1'and p_record#>>'{originalContent,status}'='usable'
   and p_record#>>'{originalContent,contentHash}'=encode(sha256(convert_to(p_record->>'content','UTF8')),'hex')
   and p_record->>'publishedAt'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   and((p_record->>'format'='article'and p_record->>'contentKind'='feed_text'and p_record#>>'{originalContent,method}'in('publisher_feed','public_article'))
    or(p_record->>'format'='podcast'and p_record->>'contentKind'='transcript'and p_record#>>'{originalContent,method}'='publisher_transcript')))
  )) ,false);
$$;

-- Pending extraction is private source-state cursor data. Existing deletion
-- guards invalidate the lease; also discard the deferred payload so a later
-- claim cannot fetch an original removed by the reader.
create function public.erase_pending_public_originals()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if tg_table_name='reader_source_updates'then
  update public.reader_collection_source_state set cursor=cursor-'pendingOriginals'where user_id=old.user_id and source_id=old.source_id;
 elsif tg_op='DELETE'then
  update public.reader_collection_source_state set cursor=cursor-'pendingOriginals'where user_id=old.user_id;
 else
  update public.reader_collection_source_state s set cursor=cursor-'pendingOriginals'where s.user_id=new.user_id and
   (not coalesce(new.state->'followedSourceIds' ? s.source_id,false)or not exists(select 1 from jsonb_array_elements(new.state->'customSources')x where x->>'id'=s.source_id));
 end if;
 return null;
end;$$;
revoke all on function public.erase_pending_public_originals()from public,anon,authenticated,service_role;
create trigger erase_pending_public_originals_archive after delete on public.reader_source_updates for each row execute function public.erase_pending_public_originals();
create trigger erase_pending_public_originals_workspace after update or delete on public.reader_workspaces for each row execute function public.erase_pending_public_originals();
commit;
