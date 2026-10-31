-- Keep the interval after an explicitly early cycle available to the next
-- scheduled snapshot. This changes no saved snapshot, source, approval or gate.
begin;
do $$
declare definition text;
 coverage_predicate text:='and state in(''completed'',''failed'')';
 inventory_predicate text:='and(q.published_at>=p_period_start or q.updated_at>=p_period_start or exists(';
begin
 definition:=pg_get_functiondef('public.daily_briefing_input(text,timestamptz,timestamptz,date)'::regprocedure);
 if(char_length(definition)-char_length(replace(definition,coverage_predicate,'')))/char_length(coverage_predicate)<>1
  or(char_length(definition)-char_length(replace(definition,inventory_predicate,'')))/char_length(inventory_predicate)<>1 then
  raise exception'Unexpected daily briefing input definition';end if;
 -- The function also has a local state variable. Qualify the table column so
 -- a real social-source branch cannot fail with ambiguous-column SQLSTATE42702.
 definition:=replace(definition,coverage_predicate,'and social_collection_jobs.state in(''completed'',''failed'')');
 -- PostgreSQL LEAST ignores a null last_cutoff_at, retaining p_period_start
 -- for the first cycle. The existing upper cutoff and finding dedupe remain.
 definition:=replace(definition,inventory_predicate,
  'and(q.published_at>=least(p_period_start,s.last_cutoff_at) or q.updated_at>=least(p_period_start,s.last_cutoff_at) or exists(');
 execute definition;
end;$$;
commit;
