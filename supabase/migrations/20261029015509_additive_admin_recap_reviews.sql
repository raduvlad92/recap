-- Add distinct human-approved recap material to the same source version.
-- Existing content, review history, charges and jobs remain unchanged.
-- A separate change watermark lets reader polling observe annotations without
-- changing collection time or waking/updating a processing job.
alter table public.reader_source_updates add column updated_at timestamptz not null default clock_timestamp();
create index reader_source_updates_changed_idx on public.reader_source_updates(user_id,updated_at,id);
create function public.touch_reader_source_update()returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.record is distinct from old.record or new.source_id is distinct from old.source_id then
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 else new.updated_at:=old.updated_at;end if;return new;
end;
$$;
revoke all on function public.touch_reader_source_update()from public,anon,authenticated;
grant execute on function public.touch_reader_source_update()to service_role;
-- BEFORE triggers run in name order: observe the final preserved recap.
create trigger zz_reader_source_updates_touch before update on public.reader_source_updates
 for each row execute function public.touch_reader_source_update();

create function public.admin_analysis_published_recap(p_user_id text,p_update_id text,p_source_id text,p_content_hash text,p_record jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare first_review public.admin_analysis_reviews;review public.admin_analysis_reviews;a public.reader_source_updates;
 point jsonb;points jsonb:='[]';seed jsonb;summary jsonb;seen text[]:='{}';key text;valid_seed boolean:=true;timing text:='none';
begin
 select *into a from public.reader_source_updates where user_id=p_user_id and id=p_update_id and source_id=p_source_id;
 if p_record is not null then a.record:=p_record;end if;
 if a.id is null or jsonb_typeof(a.record->'content')is distinct from'string'
  or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')is distinct from p_content_hash then return null;end if;
 select *into first_review from public.admin_analysis_reviews where user_id=p_user_id and update_id=p_update_id
  and source_id=p_source_id and content_hash=p_content_hash and kind='recap'and status='approved'order by updated_at,id limit 1;
 if first_review.id is null then return null;end if;
 seed:=first_review.annotation_snapshot->'videoHighlights';summary:=first_review.annotation_snapshot->'videoSummary';
 -- Existing reader points are a seed only when already published for this exact
 -- source hash. An old/unknown/failed draft must never acquire approval here.
 if jsonb_typeof(seed)='array'and jsonb_array_length(seed)between 1 and 30
  and summary->>'ruleVersion'='takeaways-v1'and summary->>'status'='ready'and summary->>'captionHash'=p_content_hash
  and summary->>'timingBasis'in('none','captions','publisher-chapters')then
  for point in select value from jsonb_array_elements(seed)loop
   if jsonb_typeof(point)is distinct from'object'or jsonb_typeof(point->'text')is distinct from'string'
    or char_length(btrim(point->>'text'))not between 1 and 500
    or array_length(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'),1)>38
    or(point-array['text','startSeconds'])<>'{}'::jsonb then valid_seed:=false;exit;end if;
   if point?'startSeconds'then
    if jsonb_typeof(point->'startSeconds')is distinct from'number'then valid_seed:=false;exit;end if;
    if(point->>'startSeconds')::numeric<0 or summary->>'timingBasis'='none'then
     valid_seed:=false;exit;end if;
   end if;
  end loop;
  if valid_seed then
   for point in select value from jsonb_array_elements(seed)loop
    -- A cue refresh can remove a formerly supported caption time. Keep the
    -- published finding, without retaining timing that the new record cannot prove.
    if point?'startSeconds'and summary->>'timingBasis'='captions'and not exists(
     select 1 from jsonb_array_elements(coalesce(a.record->'transcriptSegments','[]'))c where c->'startSeconds'=point->'startSeconds')then point:=point-'startSeconds';end if;
    key:=btrim(point->>'text');if not(key=any(seen))then points:=points||jsonb_build_array(point);seen:=array_append(seen,key);end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(points)p where p?'startSeconds')then timing:=summary->>'timingBasis';end if;
  end if;
 end if;
 -- Each contribution retains its original exact source quotations privately.
 for review in select *from public.admin_analysis_reviews where user_id=p_user_id and update_id=p_update_id
  and source_id=p_source_id and content_hash=p_content_hash and kind='recap'and status='approved'order by updated_at,id loop
  for point in select value from jsonb_array_elements(review.resolved->'highlights')loop
   key:=btrim(point->>'text');if not(key=any(seen))then points:=points||jsonb_build_array(jsonb_build_object('text',key));seen:=array_append(seen,key);end if;
  end loop;
 end loop;
 if jsonb_array_length(points)>30 then raise exception 'Recap has reached thirty published points; no existing point was removed'using errcode='PT400';end if;
 return jsonb_build_object('videoHighlights',points,'videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',p_content_hash,'timingBasis',timing));
end;
$$;
revoke all on function public.admin_analysis_published_recap(text,text,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.admin_analysis_published_recap(text,text,text,text,jsonb)to service_role;

create or replace function public.admin_decide_analysis_review(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_proposal jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.admin_analysis_reviews;a public.reader_source_updates;q public.admin_keyword_reviews;
 chosen jsonb;point jsonb;selected jsonb:='[]';highlights jsonb:='[]';patch jsonb;prepared jsonb;proc jsonb;
 label text;kind text;old_label text;quote text;source_snapshot jsonb;published_recap jsonb;utf16_length integer;published boolean:=false;
begin
 if p_id is null or p_expected is null or p_admin is null or char_length(p_admin) not between 1 and 200
  or p_decision is null or p_decision not in('approve','reject') then raise exception 'Invalid review decision' using errcode='PT400';end if;
 select * into r from public.admin_analysis_reviews where id=p_id;
 if not found then raise exception 'Review no longer exists' using errcode='PT409';end if;
 perform 1 from public.reader_workspaces where user_id=r.user_id for key share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409';end if;
 select * into a from public.reader_source_updates where user_id=r.user_id and id=r.update_id for update;
 select * into r from public.admin_analysis_reviews where id=p_id for update;
 if r.id is null or a.id is null or r.status<>'pending' or r.updated_at is distinct from p_expected then
  raise exception 'Review changed; reload before saving' using errcode='PT409';end if;
 chosen:=coalesce(p_proposal,r.proposal);
 if jsonb_typeof(chosen) is distinct from 'object' or octet_length(chosen::text)>500000 then raise exception 'Invalid edited proposal' using errcode='PT400';end if;
 source_snapshot:=r.source_snapshot;
 if source_snapshot is null and r.job_id is not null then select p.source_snapshot into source_snapshot from public.admin_analysis_prompt_receipts p
  where p.job_id=r.job_id and p.source_snapshot is not null order by p.created_at,p.id limit 1;end if;
 if p_decision='approve' then
  if source_snapshot is null or jsonb_typeof(a.record->'content')is distinct from'string' or coalesce(a.record->>'contentKind','')not in('transcript','feed_text')
   or encode(sha256(convert_to(source_snapshot->>'content','UTF8')),'hex') is distinct from r.content_hash
   or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from r.content_hash or a.source_id is distinct from r.source_id then
   raise exception 'Source changed or original text unavailable; review fresh evidence' using errcode='PT409';end if;
 end if;
 if r.kind='keyword' then
  if p_decision='approve' then
   label:=btrim(chosen->>'label');kind:=chosen->>'kind';
   if (chosen-array['label','kind'])<>'{}'::jsonb or jsonb_typeof(chosen->'label') is distinct from 'string'
    or char_length(label) not between 1 and 100 or label ~ '[[:cntrl:]]' or kind is null or kind not in('brand','product','game','technology','category')
    or strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    raise exception 'Use a literal keyword from this transcript and a valid type' using errcode='PT400';end if;
   chosen:=jsonb_build_object('label',label,'kind',kind);
  end if;
  old_label:=coalesce(nullif(btrim(r.proposal->>'label'),''),label);
  -- Reuse the existing human keyword decisions so retries retain the decision.
  if old_label is not null and source_snapshot is not null
   and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=r.content_hash then
   select * into q from public.admin_keyword_reviews where user_id=r.user_id and update_id=r.update_id
    and content_hash=r.content_hash and normalized_label=public.keyword_review_label_key(old_label)for update;
   if q.id is null then
    quote:=case when strpos(source_snapshot->>'content',old_label)>0 then substring(source_snapshot->>'content'from greatest(1,strpos(source_snapshot->>'content',old_label)-200)for least(1000,char_length(old_label)+400))else left(source_snapshot->>'content',1000)end;
    insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
     values(r.user_id,r.update_id,r.source_id,r.content_hash,old_label,coalesce(kind,case when r.proposal->>'kind'in('brand','product','game','technology','category')then r.proposal->>'kind'else'category'end),0,r.reason,quote,'[]',coalesce(a.record->>'title',''),coalesce(a.record->>'url',''))returning *into q;
   end if;
   if q.status<>'pending' then raise exception 'An administrator already decided this keyword; reload' using errcode='PT409';end if;
   if p_decision='approve'then
    perform public.admin_review_keyword(q.id,q.updated_at,p_admin,p_decision,label,kind);
   else
    perform public.admin_review_keyword_before_content_processing(q.id,q.updated_at,p_admin,p_decision,old_label,q.kind);
   end if;
   update public.admin_analysis_reviews set legacy_keyword_review_id=q.id where id=r.id;
  end if;
  if p_decision='approve' then
   -- An individual approval must not bless unknown older labels as a fresh batch.
   -- A genuinely empty prior batch can display its one source-proved manual label,
   -- while remaining in review rather than claiming exhaustive automatic coverage.
   if jsonb_array_length(coalesce(a.record->'videoKeywords','[]'::jsonb))=0
    and jsonb_array_length(coalesce(a.record->'topics','[]'::jsonb))=0
    and jsonb_array_length(coalesce(a.record->'brands','[]'::jsonb))=0 then
    proc:=public.content_analysis_processing((select record from public.reader_source_updates where user_id=r.user_id and id=r.update_id),r.content_hash);
    update public.reader_source_updates set record=record||jsonb_build_object('keywordRuleVersion','entities-v2','keywordContentHash',r.content_hash,
     'processing',proc||jsonb_build_object('keywords','review'))where user_id=r.user_id and id=r.update_id;
   end if;published:=true;
  end if;
 elsif p_decision='approve' then
  if (chosen-'highlights')<>'{}'::jsonb or jsonb_typeof(chosen->'highlights') is distinct from 'array' or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'A recap needs one to six source-supported points' using errcode='PT400';end if;
  -- Only an earlier explicit approval can explain annotation drift. Arbitrary
  -- replacement still conflicts; source and review revisions are checked above.
  published_recap:=public.admin_analysis_published_recap(r.user_id,r.update_id,r.source_id,r.content_hash);
  if r.annotation_snapshot is distinct from jsonb_build_object('videoHighlights',a.record->'videoHighlights','videoSummary',a.record->'videoSummary')
   and published_recap is distinct from jsonb_build_object('videoHighlights',a.record->'videoHighlights','videoSummary',a.record->'videoSummary')then
   raise exception 'Reader recap changed; reload before adding to it' using errcode='PT409';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb then raise exception 'Invalid recap point'using errcode='PT400';end if;
   highlights:=highlights||jsonb_build_array(jsonb_build_object('text',point->>'text'));
   selected:=selected||jsonb_build_array(jsonb_build_object('text',point->>'text','evidenceQuote',point->>'evidenceQuote'));
  end loop;
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer into utf16_length from regexp_split_to_table(a.record->>'content','')ch;
  patch:=jsonb_build_object('videoHighlights',highlights,'videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',r.content_hash,'timingBasis','none'));
  prepared:=jsonb_build_object('state','ready','patch',patch,'pending','[]'::jsonb,'evidence',jsonb_build_object('contentHash',r.content_hash,'coverage',jsonb_build_array(jsonb_build_object('start',0,'end',utf16_length)),'selected',selected));
  perform public.validate_content_analysis_result('summary',prepared,a.record,r.content_hash);
  -- Record the explicit manual approval before writing, for the preservation trigger below.
  update public.admin_analysis_reviews set status='approved',resolved=chosen,resolved_by=p_admin where id=r.id;
  -- Validate ONLY the new cited contribution above; retain separately published
  -- points and their existing timing instead of inventing replacement citations.
  patch:=public.admin_analysis_published_recap(r.user_id,r.update_id,r.source_id,r.content_hash);
  if patch is null then raise exception 'Approved recap unavailable' using errcode='PT409';end if;
  proc:=public.content_analysis_processing(a.record,r.content_hash)||jsonb_build_object('recap','ready');
  update public.reader_source_updates set record=record||jsonb_build_object('keywordContentHash',public.content_analysis_keyword_provenance(a.record))||patch||jsonb_build_object('processing',proc)where user_id=r.user_id and id=r.update_id;published:=true;
 end if;
 if not(r.kind='recap'and p_decision='approve')then
  update public.admin_analysis_reviews set status=case when p_decision='approve'then'approved'else'rejected'end,resolved=chosen,resolved_by=p_admin where id=r.id;
 end if;
 select *into r from public.admin_analysis_reviews where id=p_id;
 insert into public.admin_audit_events(admin_id,action,target_id,details)values(p_admin,'analysis.review.'||r.status,r.id::text,
  jsonb_build_object('kind',r.kind,'contentHash',r.content_hash,'manualSourceReview',true,'published',published,'edited',chosen is distinct from r.proposal));
 return jsonb_build_object('record',to_jsonb(r),'published',published);
end;
$$;

create or replace function public.admin_analysis_preserve_reviewed_recap()returns trigger
language plpgsql security invoker set search_path='' as $$
declare h text;published_recap jsonb;
begin
 if jsonb_typeof(new.record->'content')is distinct from'string'then return new;end if;
 h:=encode(sha256(convert_to(new.record->>'content','UTF8')),'hex');
 published_recap:=public.admin_analysis_published_recap(new.user_id,new.id,new.source_id,h,new.record);
 if published_recap is null then return new;end if;
 -- Preserve the independent keyword batch before restoring summary provenance.
 -- An explicit new keyword hash wins; absence retains the prior known/unknown hash.
 new.record:=new.record||jsonb_build_object('keywordContentHash',public.content_analysis_keyword_provenance(case when new.record?'keywordContentHash'then new.record else old.record end))||published_recap;
 new.record:=new.record||jsonb_build_object('processing',public.content_analysis_processing(new.record,h)||jsonb_build_object('recap','ready'));return new;
end;
$$;
-- Replaced functions retain their existing service-only grants.
