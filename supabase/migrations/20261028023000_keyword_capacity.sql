-- Bound complete inventories at 1,000 without trimming paid/source evidence.
-- Per-chunk model requests and byte/range/source limits remain unchanged.
-- Replace only the expected predicate in each exact existing routine. Abort
-- on drift; CREATE OR REPLACE retains owner, invoker settings and execute ACLs.
-- No archive, review, publication, session, control or financial row is written.
begin;
do $$
declare target record; definition text; routine regprocedure;
begin
 for target in select * from (values
  ('public.validate_content_analysis_result(text,jsonb,jsonb,text)',
   'jsonb_array_length(p_result#>''{evidence,accepted}'')+jsonb_array_length(p_result->''pending'') not between 1 and 500',
   'jsonb_array_length(p_result#>''{evidence,accepted}'')+jsonb_array_length(p_result->''pending'') not between 1 and 1000'),
  ('public.publish_keyword_production_result(uuid,integer,text,jsonb,jsonb)',
   '(select count(*) from jsonb_each(entries))>500',
   '(select count(*) from jsonb_each(entries))>1000'),
  ('public.publish_content_analysis_job(uuid,uuid)',
   '(select count(*) from jsonb_each(entries))>500',
   '(select count(*) from jsonb_each(entries))>1000'),
  ('public.admin_review_keyword_before_content_processing(uuid,timestamp with time zone,text,text,text,text)',
   'jsonb_array_length(keywords)>500 or jsonb_array_length(topics)>1000',
   'jsonb_array_length(keywords)>1000 or jsonb_array_length(topics)>1000')
 ) as changes(signature,old_predicate,new_predicate) loop
  routine:=to_regprocedure(target.signature);
  if routine is null then raise exception 'Keyword capacity routine missing: %',target.signature; end if;
  definition:=pg_get_functiondef(routine);
  if (length(definition)-length(replace(definition,target.old_predicate,'')))/length(target.old_predicate)<>1
   or strpos(definition,target.new_predicate)>0 then
   raise exception 'Keyword capacity predicate drift: %',target.signature;
  end if;
  execute replace(definition,target.old_predicate,target.new_predicate);
 end loop;
end;
$$;
commit;
