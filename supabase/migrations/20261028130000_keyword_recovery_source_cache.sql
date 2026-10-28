-- Hoist the exact existing full-source normalization out of the accepted-name
-- loop. No matching, source, financial, review or publication predicate changes.
-- This replaces only three verified fragments of the existing function body.
-- CREATE OR REPLACE retains its owner, invoker settings and execute ACLs.
-- No archive, publication, review, session or financial row is written here.
begin;
do $migration$
declare routine regprocedure:=to_regprocedure('public.publish_keyword_recovery_result(uuid,integer,text,jsonb,jsonb)');
 definition text; patched text; old_metadata jsonb; new_metadata jsonb;
 declaration text:=' source_hash text; k text;';
 invocation text:=$invocation$ perform public.validate_content_analysis_result('keywords',p_output,rec,source_hash);$invocation$;
 source_expression text:=$source_expression$lower(regexp_replace(rec->>'content',E'[ \\t\\r\\n]*[\\r\\n][ \\t\\r\\n]*',' ','g'))$source_expression$;
 old_predicate text; new_predicate text:=$predicate$strpos(normalized_content,lower(candidate->>'label'))$predicate$;
begin
 if routine is null then raise exception 'Keyword recovery publication routine missing'; end if;
 definition:=pg_get_functiondef(routine);
 old_predicate:='strpos('||source_expression||$predicate$,lower(candidate->>'label'))$predicate$;
 if strpos(definition,'normalized_content')>0
  or (length(definition)-length(replace(definition,declaration,'')))/length(declaration)<>1
  or (length(definition)-length(replace(definition,invocation,'')))/length(invocation)<>1
  or (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate)<>1 then
  raise exception 'Keyword recovery normalization predicate drift'; end if;
 select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile)
  into old_metadata from pg_proc where oid=routine;
 patched:=replace(definition,declaration,' source_hash text; normalized_content text; k text;');
 patched:=replace(patched,invocation,invocation||E'\n normalized_content:='||source_expression||';');
 patched:=replace(patched,old_predicate,new_predicate);
 -- Refuse any accidental rewrite beyond the declaration, one assignment and
 -- the existing strpos argument. The regular expression remains byte-exact.
 if replace(replace(replace(patched,new_predicate,old_predicate),invocation||E'\n normalized_content:='||source_expression||';',invocation),
  ' source_hash text; normalized_content text; k text;',declaration) is distinct from definition then
  raise exception 'Keyword recovery normalization rewrite changed other text'; end if;
 execute patched;
 select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile)
  into new_metadata from pg_proc where oid=routine;
 if new_metadata is distinct from old_metadata then raise exception 'Keyword recovery normalization security metadata changed'; end if;
end;
$migration$;
commit;
