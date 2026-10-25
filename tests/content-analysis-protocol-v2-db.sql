-- Rollback-only service ACL and protocol structure acceptance on local PG.
begin;
set local role service_role;
do $$
begin
 if exists(select 1 from public.content_analysis_rollout_scopes) then raise exception 'Migration activated a rollout'; end if;
 if (select count(*) from public.reader_content_analysis_calls)<>12 then raise exception 'Legacy calls changed'; end if;
 if (select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null)<>.009178191 then
  raise exception 'Unknown holds changed'; end if;
 if (select sum(actual_usd) from public.reader_content_analysis_calls)<>.009187716 then raise exception 'Settled history changed'; end if;
 if exists(select 1 from public.reader_content_analysis_calls where execution_identity is not null or request_hash is not null) then
  raise exception 'Legacy unknown identity inferred'; end if;
 if exists(select 1 from public.content_analysis_budget where enabled or daily_limit_usd<>5 or lifetime_limit_usd<>5)
  or exists(select 1 from public.reader_content_analysis_policies where enabled or daily_limit_usd<>5 or lifetime_limit_usd<>5 or per_call_limit_usd<>.01) then
  raise exception 'Budget/gates changed'; end if;
end;
$$;
rollback;
