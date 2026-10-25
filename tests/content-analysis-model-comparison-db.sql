-- Actual local migration preservation/ACL acceptance over the seeded checkpoint.
begin;
set local role service_role;
do $$ begin
 if (select count(*) from public.reader_source_updates)<>490 or (select count(*) from public.reader_content_analysis_jobs)<>394
  or (select count(*) from public.reader_content_analysis_calls)<>35 then raise exception 'Original 490/394/35 checkpoint changed'; end if;
 if (select count(*) from public.reader_content_analysis_calls where actual_usd is null)<>3
  or (select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null)<>.009178191
  or (select sum(actual_usd) from public.reader_content_analysis_calls)<>.019426124 then raise exception 'Settled costs/three holds changed'; end if;
 if exists(select 1 from public.reader_content_analysis_jobs where generation_comparison_id is not null)
  or exists(select 1 from public.content_analysis_model_comparisons) then raise exception 'Migration staged comparison work'; end if;
 if exists(select 1 from public.content_analysis_rollout_scopes where phase<>'paused' or generation_rule_version<>'content-v3')
  or exists(select 1 from public.content_analysis_budget where enabled)
  or exists(select 1 from public.reader_content_analysis_policies where enabled) then raise exception 'Migration activated work'; end if;
 if has_table_privilege('service_role','public.content_analysis_model_comparisons','INSERT')
  or has_table_privilege('service_role','public.content_analysis_model_comparisons','UPDATE')
  or has_table_privilege('service_role','public.content_analysis_model_comparisons','DELETE')
  or has_table_privilege('authenticated','public.content_analysis_model_comparisons','SELECT')
  or has_table_privilege('anon','public.content_analysis_model_comparisons','SELECT') then raise exception 'Private comparison ACL is wrong'; end if;
end $$;
rollback;
