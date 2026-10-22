-- Follow-up after the original migration was applied. Preserve applied history.
begin;
create or replace function public.keyword_review_label_key(value text)
returns text language sql immutable strict security invoker set search_path = '' as $$
 select lower(btrim(regexp_replace(normalize(value,NFKC),'[[:space:]]+',' ','g')));
$$;
create or replace function public.admin_review_keyword(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_label text)
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
  next_record := next_record || jsonb_build_object('topics',topics);
  if next_record->>'format'='video' then next_record := next_record || jsonb_build_object('videoKeywords',keywords); end if;
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
commit;
