-- Private offline candidates only. This migration starts no collection or model jobs.
begin;

create function public.keyword_review_label_key(value text)
returns text language sql immutable strict security invoker set search_path = '' as $$
 select lower(btrim(regexp_replace(value,'[[:space:]]+',' ','g')));
$$;
revoke all on function public.keyword_review_label_key(text) from public,anon,authenticated;
grant execute on function public.keyword_review_label_key(text) to service_role;

create table public.admin_keyword_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public.reader_workspaces(user_id) on delete cascade,
 update_id text not null,
 source_id text not null,
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 label text not null check (char_length(label) between 1 and 100 and btrim(label)<>'' and label !~ '[[:cntrl:]]'),
 normalized_label text generated always as (public.keyword_review_label_key(label)) stored,
 kind text not null check (kind in ('brand','product','game','technology','category')),
 confidence integer not null check (confidence between 0 and 100),
 reason text not null check (char_length(reason) between 1 and 2000 and btrim(reason)<>''),
 evidence_quote text not null check (char_length(evidence_quote) between 1 and 1000 and btrim(evidence_quote)<>''),
 start_seconds double precision check (start_seconds >= 0 and start_seconds <= 9007199254740991),
 proposed_ranges jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_ranges)='array' and jsonb_array_length(proposed_ranges)<=200),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 resolved_label text check (char_length(resolved_label) between 1 and 100 and btrim(resolved_label)<>'' and resolved_label !~ '[[:cntrl:]]'),
 updated_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 update_title text not null,
 update_url text not null,
 foreign key(user_id,update_id) references public.reader_source_updates(user_id,id) on delete cascade,
 unique(user_id,update_id,content_hash,normalized_label),
 check ((status='pending' and resolved_label is null) or (status<>'pending' and resolved_label is not null))
);
create index admin_keyword_reviews_queue_idx on public.admin_keyword_reviews(status,created_at desc,id desc);
-- Workspace deletion and archive/history deletion independently remove private evidence.
create index admin_keyword_reviews_update_idx on public.admin_keyword_reviews(user_id,update_id);
alter table public.admin_keyword_reviews enable row level security;
revoke all on table public.admin_keyword_reviews from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.admin_keyword_reviews to service_role;
comment on column public.admin_keyword_reviews.confidence is 'Offline review score from 0 to 100; not a calibrated probability.';
comment on column public.admin_keyword_reviews.proposed_ranges is 'Only source-grounded ranges supplied by the offline candidate. Empty means unknown timing, never zero duration.';

create function public.keyword_review_validate_candidate()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare archive public.reader_source_updates; item jsonb; boundary double precision; boundaries double precision[] := '{}';
begin
 if tg_op='UPDATE' then
  -- Resolutions do not rewrite the original candidate or its grounded provenance.
  if (to_jsonb(new)-array['status','resolved_label','updated_at','normalized_label']) is distinct from
     (to_jsonb(old)-array['status','resolved_label','updated_at','normalized_label']) then
   raise exception 'Candidate evidence is immutable; enqueue a new content revision' using errcode='PT400';
  end if;
  new.updated_at := greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
 end if;
 -- Same lock order as review/reset: workspace, archive, then queue.
 perform 1 from public.reader_workspaces w where w.user_id=new.user_id for key share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409'; end if;
 select * into archive from public.reader_source_updates a where a.user_id=new.user_id and a.id=new.update_id for share;
 if archive.id is null then raise exception 'Source update no longer exists' using errcode='PT409'; end if;
 if jsonb_typeof(archive.record->'content') is distinct from 'string'
   or coalesce(archive.record->>'contentKind','') not in ('transcript','feed_text')
   or char_length(archive.record->>'content')=0
   or new.content_hash is distinct from encode(sha256(convert_to(archive.record->>'content','UTF8')),'hex') then
  raise exception 'Source content changed or is unavailable' using errcode='PT409';
 end if;
 if new.status<>'pending' or new.resolved_label is not null then raise exception 'New candidates must be pending' using errcode='PT400'; end if;
 if new.source_id is not null and new.source_id<>archive.source_id then raise exception 'Source identity mismatch' using errcode='PT400'; end if;
 new.source_id := archive.source_id;
 new.update_title := coalesce(archive.record->>'title','');
 new.update_url := coalesce(archive.record->>'url','');
 if new.evidence_quote is null or btrim(new.evidence_quote)='' or strpos(
   regexp_replace(archive.record->>'content','[[:space:]]+',' ','g'),
   btrim(regexp_replace(new.evidence_quote,'[[:space:]]+',' ','g')))=0 then
  raise exception 'Evidence must quote the archived content' using errcode='PT400';
 end if;
 -- Time boundaries must exist in actual caption cues or the existing grounded keyword ranges.
 for item in select value from jsonb_array_elements(case when jsonb_typeof(archive.record->'transcriptSegments')='array' then archive.record->'transcriptSegments' else '[]'::jsonb end) loop
  if jsonb_typeof(item->'startSeconds')='number' then
   boundary := (item->>'startSeconds')::double precision;
   boundaries := array_append(boundaries,boundary);
   if jsonb_typeof(item->'durationSeconds')='number' then boundaries := array_append(boundaries,boundary+(item->>'durationSeconds')::double precision); end if;
  end if;
 end loop;
 for item in select r.value from jsonb_array_elements(case when jsonb_typeof(archive.record->'videoKeywords')='array' then archive.record->'videoKeywords' else '[]'::jsonb end) k
   cross join lateral jsonb_array_elements(case when jsonb_typeof(k.value->'ranges')='array' then k.value->'ranges' else '[]'::jsonb end) r loop
  if jsonb_typeof(item->'startSeconds')='number' and jsonb_typeof(item->'endSeconds')='number' then
   boundaries := array_append(array_append(boundaries,(item->>'startSeconds')::double precision),(item->>'endSeconds')::double precision);
  end if;
 end loop;
 if new.start_seconds is not null and not (new.start_seconds=any(boundaries)) then raise exception 'Evidence timing is unavailable' using errcode='PT400'; end if;
 for item in select value from jsonb_array_elements(new.proposed_ranges) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'startSeconds') is distinct from 'number' or jsonb_typeof(item->'endSeconds') is distinct from 'number'
    or (item-array['startSeconds','endSeconds'])<>'{}'::jsonb then raise exception 'Invalid keyword time range' using errcode='PT400'; end if;
  if (item->>'startSeconds')::double precision<0 or (item->>'endSeconds')::double precision<=(item->>'startSeconds')::double precision
    or (item->>'endSeconds')::double precision>9007199254740991
    or not ((item->>'startSeconds')::double precision=any(boundaries)) or not ((item->>'endSeconds')::double precision=any(boundaries)) then
   raise exception 'Keyword range is not grounded in source timing' using errcode='PT400';
  end if;
 end loop;
 new.created_at := clock_timestamp(); new.updated_at := new.created_at;
 return new;
end;
$$;
revoke all on function public.keyword_review_validate_candidate() from public,anon,authenticated;
grant execute on function public.keyword_review_validate_candidate() to service_role;
create trigger admin_keyword_review_validate before insert or update on public.admin_keyword_reviews
 for each row execute function public.keyword_review_validate_candidate();

create function public.admin_review_keyword(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_label text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare candidate public.admin_keyword_reviews; archive public.reader_source_updates; result public.admin_keyword_reviews;
 cleaned text; key text; old_key text; item jsonb; base_keyword jsonb; next_record jsonb;
 keywords jsonb := '[]'; topics jsonb := '[]'; brands jsonb := '[]'; ranges jsonb := '[]'; merged_ranges jsonb := '[]';
 range_start double precision; range_end double precision; duration double precision := 0;
 keyword_position integer; current_position integer := 0;
begin
 cleaned := btrim(regexp_replace(p_label,'[[:space:]]+',' ','g'));
 if p_id is null or p_expected is null or p_admin is null or char_length(p_admin) not between 1 and 200
   or p_decision is null or p_decision not in ('approve','reject') or cleaned is null or char_length(cleaned) not between 1 and 100 or cleaned ~ '[[:cntrl:]]' then
  raise exception 'Invalid review decision' using errcode='PT400';
 end if;
 -- This first read identifies locks only; every candidate field is read again under lock.
 select * into candidate from public.admin_keyword_reviews q where q.id=p_id;
 if candidate.id is null then raise exception 'Review no longer exists' using errcode='PT409'; end if;
 perform 1 from public.reader_workspaces w where w.user_id=candidate.user_id for key share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409'; end if;
 select * into archive from public.reader_source_updates a where a.user_id=candidate.user_id and a.id=candidate.update_id for update;
 if archive.id is null then raise exception 'Source update no longer exists' using errcode='PT409'; end if;
 select * into candidate from public.admin_keyword_reviews q where q.id=p_id for update;
 if candidate.id is null or candidate.status<>'pending' or candidate.updated_at<>p_expected
   or candidate.user_id<>archive.user_id or candidate.update_id<>archive.id or candidate.source_id<>archive.source_id then
  raise exception 'Review changed; reload before saving' using errcode='PT409';
 end if;
 if jsonb_typeof(archive.record->'content') is distinct from 'string'
   or candidate.content_hash is distinct from encode(sha256(convert_to(archive.record->>'content','UTF8')),'hex') then
  raise exception 'Source content changed; review fresh evidence' using errcode='PT409';
 end if;
 if p_decision='approve' then
  key := public.keyword_review_label_key(cleaned); old_key := public.keyword_review_label_key(candidate.label);
  next_record := archive.record;
  if (next_record ? 'videoKeywords' and jsonb_typeof(next_record->'videoKeywords') is distinct from 'array')
    or (next_record ? 'topics' and jsonb_typeof(next_record->'topics') is distinct from 'array')
    or (next_record ? 'brands' and jsonb_typeof(next_record->'brands') is distinct from 'array') then
   raise exception 'Archive keyword fields changed; reload' using errcode='PT409';
  end if;
  ranges := candidate.proposed_ranges;
  for item in select value from jsonb_array_elements(coalesce(next_record->'videoKeywords','[]'::jsonb)) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'label') is distinct from 'string' or jsonb_typeof(item->'ranges') is distinct from 'array' then
    raise exception 'Archive keyword fields changed; reload' using errcode='PT409';
   end if;
   if public.keyword_review_label_key(item->>'label') in (key,old_key) then
    if base_keyword is null then base_keyword := item; keyword_position := current_position; end if;
    ranges := ranges || (item->'ranges');
   else
    keywords := keywords || jsonb_build_array(item); current_position := current_position+1;
   end if;
  end loop;
  -- Union overlapping ranges, so a corrected label never double-counts duration.
  for item in select value from jsonb_array_elements(ranges) order by (value->>'startSeconds')::double precision,(value->>'endSeconds')::double precision loop
   if jsonb_typeof(item->'startSeconds') is distinct from 'number' or jsonb_typeof(item->'endSeconds') is distinct from 'number'
     or (item->>'startSeconds')::double precision<0 or (item->>'endSeconds')::double precision<=(item->>'startSeconds')::double precision then
    raise exception 'Archive keyword timing changed; reload' using errcode='PT409';
   end if;
   if range_start is null then range_start := (item->>'startSeconds')::double precision; range_end := (item->>'endSeconds')::double precision;
   elsif (item->>'startSeconds')::double precision<=range_end then range_end := greatest(range_end,(item->>'endSeconds')::double precision);
   else
    merged_ranges := merged_ranges || jsonb_build_array(jsonb_build_object('startSeconds',range_start,'endSeconds',range_end)); duration := duration+range_end-range_start;
    range_start := (item->>'startSeconds')::double precision; range_end := (item->>'endSeconds')::double precision;
   end if;
  end loop;
  if range_start is not null then merged_ranges := merged_ranges || jsonb_build_array(jsonb_build_object('startSeconds',range_start,'endSeconds',range_end)); duration := duration+range_end-range_start; end if;
  if jsonb_array_length(merged_ranges)>200 then raise exception 'Too many keyword ranges' using errcode='PT400'; end if;
  base_keyword := (coalesce(base_keyword,'{}'::jsonb)-'seconds') || jsonb_build_object('label',cleaned,'ranges',merged_ranges);
  if jsonb_array_length(merged_ranges)>0 then base_keyword := base_keyword || jsonb_build_object('seconds',duration); end if;
  -- Retain existing entry order, replacing all aliases with one merged object.
  select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into keywords from (
   select value,ordinality::double precision as position from jsonb_array_elements(keywords) with ordinality
   union all select base_keyword,coalesce(keyword_position,jsonb_array_length(keywords))::double precision+0.5
  ) entries;
  for item in select value from jsonb_array_elements(coalesce(next_record->'topics','[]'::jsonb)) loop
   if jsonb_typeof(item) is distinct from 'string' then raise exception 'Archive topic fields changed; reload' using errcode='PT409'; end if;
   if public.keyword_review_label_key(item#>>'{}') not in (key,old_key) then topics := topics || jsonb_build_array(item); end if;
  end loop;
  topics := topics || jsonb_build_array(cleaned);
  if jsonb_array_length(keywords)>500 or jsonb_array_length(topics)>1000 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
  next_record := next_record || jsonb_build_object('videoKeywords',keywords,'topics',topics);
  if candidate.kind in ('brand','product','game') then
   for item in select value from jsonb_array_elements(coalesce(next_record->'brands','[]'::jsonb)) loop
    if jsonb_typeof(item) is distinct from 'string' then raise exception 'Archive brand fields changed; reload' using errcode='PT409'; end if;
    if public.keyword_review_label_key(item#>>'{}') not in (key,old_key) then brands := brands || jsonb_build_array(item); end if;
   end loop;
   brands := brands || jsonb_build_array(cleaned);
   if jsonb_array_length(brands)>1000 then raise exception 'Brand capacity reached' using errcode='PT400'; end if;
   next_record := next_record || jsonb_build_object('brands',brands);
  end if;
  update public.reader_source_updates set record=next_record where user_id=archive.user_id and id=archive.id;
 end if;
 update public.admin_keyword_reviews set status=case when p_decision='approve' then 'approved' else 'rejected' end,resolved_label=cleaned
  where id=candidate.id and status='pending' and updated_at=p_expected returning * into result;
 if result.id is null then raise exception 'Review changed; reload before saving' using errcode='PT409'; end if;
 begin
  insert into public.admin_audit_events(admin_id,action,target_id,details)
   values(p_admin,case when p_decision='approve' then 'keyword.approved' else 'keyword.rejected' end,result.id::text,jsonb_build_object('kind',result.kind));
 exception when others then
  raise exception 'Audit unavailable; review not saved' using errcode='PT503';
 end;
 return to_jsonb(result)-'normalized_label';
end;
$$;
revoke all on function public.admin_review_keyword(uuid,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_keyword(uuid,timestamptz,text,text,text) to service_role;
comment on function public.admin_review_keyword(uuid,timestamptz,text,text,text) is 'Service-only pending-review CAS and exact raw UTF8 content SHA256 check. Locks workspace then archive then queue; patches only keywords/topics/brand-like names, and audits atomically. Never recreates an archive/workspace.';
commit;
