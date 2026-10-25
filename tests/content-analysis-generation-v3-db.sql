-- Synthetic preservation acceptance after the actual local migration.
begin;
set local role service_role;
do $$
begin
 if (select count(*) from public.reader_content_analysis_calls)<>23 then raise exception '23 original calls changed'; end if;
 if (select count(*) from public.reader_content_analysis_calls where actual_usd is null)<>3
  or (select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null)<>.009178191 then
  raise exception 'Three old unknown commitments changed'; end if;
 if (select sum(actual_usd) from public.reader_content_analysis_calls)<>.009187716+.005583656 then raise exception 'Original settled receipts changed'; end if;
 if exists(select 1 from public.reader_content_analysis_jobs where rule_version='content-v3' or generation_contract_hash is not null or generation_predecessor_job_id is not null) then
  raise exception 'Migration created or stamped a generation'; end if;
 if exists(select 1 from public.content_analysis_rollout_scopes where generation_rule_version<>'content-v2' or generation_revision_manifest is not null or phase<>'paused') then
  raise exception 'Migration staged or activated scope'; end if;
 if exists(select 1 from public.admin_audit_events) then raise exception 'Migration wrote audit data'; end if;
 if exists(select 1 from public.content_analysis_budget where enabled or daily_limit_usd<>5 or lifetime_limit_usd<>5)
  or exists(select 1 from public.reader_content_analysis_policies where enabled or daily_limit_usd<>5 or lifetime_limit_usd<>5 or per_call_limit_usd<>.01) then
  raise exception 'Gates or caps changed'; end if;
end;
$$;
rollback;
