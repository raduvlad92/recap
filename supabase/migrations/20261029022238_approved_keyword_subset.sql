-- A human-approved label can be readable without certifying an unknown older
-- keyword batch. Keep raw labels and batch provenance exactly as they are.
create function public.project_approved_keyword_subset()returns trigger
language plpgsql security invoker set search_path='' as $$
declare h text;labels jsonb;
begin
 -- This field is derived from private decisions, never caller/provider proof.
 new.record:=new.record-'keywordApprovals';
 if jsonb_typeof(new.record->'content')is distinct from'string'
  or coalesce(new.record->>'contentKind','')not in('transcript','feed_text')then return new;end if;
 h:=encode(sha256(convert_to(new.record->>'content','UTF8')),'hex');
 select coalesce(jsonb_agg(label order by label),'[]'::jsonb)into labels from(
  select distinct q.resolved_label as label from public.admin_keyword_reviews q
  where q.user_id=new.user_id and q.update_id=new.id and q.source_id=new.source_id and q.content_hash=h and q.status='approved'
   and not exists(select 1 from public.admin_keyword_reviews rejected where rejected.user_id=q.user_id and rejected.update_id=q.update_id
    and rejected.source_id=q.source_id and rejected.content_hash=h and rejected.status='rejected'
    and public.content_analysis_keyword_key(q.resolved_label)in(public.content_analysis_keyword_key(rejected.label),public.content_analysis_keyword_key(rejected.resolved_label)))
  order by label limit 1001
 )approved;
 if jsonb_array_length(labels)>1000 then raise exception 'Approved keyword subset capacity reached'using errcode='PT400';end if;
 if jsonb_array_length(labels)>0 then new.record:=new.record||jsonb_build_object('keywordApprovals',jsonb_build_object('contentHash',h,'labels',labels));end if;
 return new;
end;
$$;
revoke all on function public.project_approved_keyword_subset()from public,anon,authenticated;
grant execute on function public.project_approved_keyword_subset()to service_role;
-- Name order: preserve recap, derive keyword proof, then touch final watermark.
create trigger y_admin_keyword_approved_subset before insert or update on public.reader_source_updates
 for each row execute function public.project_approved_keyword_subset();

-- Inbox rejection uses the inner legacy decision, which does not write the
-- archive after updating the ledger. Refresh derived proof under its held lock.
do $$
declare definition text;needle text:='perform public.admin_review_keyword_before_content_processing(q.id,q.updated_at,p_admin,p_decision,old_label,q.kind);';
begin
 definition:=pg_get_functiondef('public.admin_decide_analysis_review(uuid,timestamptz,text,text,jsonb)'::regprocedure);
 if(char_length(definition)-char_length(replace(definition,needle,'')))/char_length(needle)<>1 then
  raise exception 'Unexpected inbox keyword decision definition';end if;
 execute replace(definition,needle,needle||E'\n    update public.reader_source_updates set record=record where user_id=r.user_id and id=r.update_id;');
end;
$$;

-- Backfill only actual existing decisions for the current source version.
-- No review/charge/job row or original keyword field is changed.
update public.reader_source_updates a set record=a.record where exists(
 select 1 from public.admin_keyword_reviews q where q.user_id=a.user_id and q.update_id=a.id and q.source_id=a.source_id
  and q.status='approved'and jsonb_typeof(a.record->'content')='string'
  and q.content_hash=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
);
