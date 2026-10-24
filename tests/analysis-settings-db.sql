-- Actual PostgreSQL acceptance. Disposable local database only; all synthetic
-- changes roll back. No credentials, source requests or inference.
begin;
set local role service_role;

do $$
declare settings public.content_analysis_runtime_settings; response jsonb; previous_at timestamptz; previous_model text;
 selected text; revision_before bigint; policies_before jsonb; audit_before bigint; audit public.admin_audit_events;
 invalid record; procedure record;
begin
 select * into settings from public.content_analysis_runtime_settings;
 if (select count(*) from public.content_analysis_runtime_settings)<>1
  or settings.id is distinct from true or settings.selected_model<>'deepseek/deepseek-v4.1-flash-1017'
  or settings.revision<>1 or settings.updated_at is null or settings.updated_by is not null then
  raise exception 'Seeded singleton/defaults incorrect'; end if;
 if not (select relrowsecurity from pg_class where oid='public.content_analysis_runtime_settings'::regclass)
  or exists(select 1 from pg_policy where polrelid='public.content_analysis_runtime_settings'::regclass) then
  raise exception 'Private settings RLS incorrect'; end if;
 if exists(select 1 from aclexplode((select relacl from pg_class where oid='public.content_analysis_runtime_settings'::regclass))
   where grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)) then
  raise exception 'Public table privileges present'; end if;
 if not has_table_privilege('service_role','public.content_analysis_runtime_settings','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('service_role','public.content_analysis_runtime_settings','TRUNCATE') then
  raise exception 'Unexpected service table privileges'; end if;
 select * into procedure from pg_proc where oid='public.admin_set_analysis_model(text,text,bigint)'::regprocedure;
 if procedure.prosecdef or procedure.proconfig is distinct from array['search_path=""']
  or not has_function_privilege('service_role',procedure.oid,'EXECUTE')
  or has_function_privilege('anon',procedure.oid,'EXECUTE')
  or has_function_privilege('authenticated',procedure.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) a
   where a.grantee=0 and a.privilege_type='EXECUTE') then
  raise exception 'Private invoker RPC privileges incorrect'; end if;

 begin insert into public.content_analysis_runtime_settings(id) values(false);
  raise exception 'False singleton accepted'; exception when check_violation then null; end;
 begin insert into public.content_analysis_runtime_settings default values;
  raise exception 'Second singleton accepted'; exception when unique_violation then null; end;
 begin update public.content_analysis_runtime_settings set selected_model='unknown/model';
  raise exception 'Unknown table model accepted'; exception when check_violation then null; end;
 begin update public.content_analysis_runtime_settings set revision=0;
  raise exception 'Zero revision accepted'; exception when check_violation then null; end;
 begin update public.content_analysis_runtime_settings set selected_model=null;
  raise exception 'Null table model accepted'; exception when not_null_violation then null; end;

 select jsonb_agg(to_jsonb(p)-'model' order by p.user_id) into policies_before
  from public.reader_content_analysis_policies p;
 foreach selected in array array[
  'deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openai/gpt-6-luna-pro','openai/gpt-6.1-sol-pro'
 ] loop
  select * into settings from public.content_analysis_runtime_settings;
  previous_at:=settings.updated_at; previous_model:=settings.selected_model; revision_before:=settings.revision;
  select count(*) into audit_before from public.admin_audit_events;
  response:=public.admin_set_analysis_model('synthetic-settings-admin',selected,revision_before);
  if response->>'selected_model' is distinct from selected or (response->>'revision')::bigint<>revision_before+1
   or (response->>'updated_at')::timestamptz<previous_at
   or response-array['selected_model','revision','updated_at']<>'{}'::jsonb
   or not response ?& array['selected_model','revision','updated_at'] then
   raise exception 'CAS response contract incorrect'; end if;
  select * into settings from public.content_analysis_runtime_settings;
  if settings.updated_by<>'synthetic-settings-admin' or settings.selected_model<>selected
   or settings.revision<>revision_before+1 or to_jsonb(settings.updated_at) is distinct from response->'updated_at' then
   raise exception 'Saved singleton differs from response'; end if;
  if exists(select 1 from public.reader_content_analysis_policies where model<>selected)
   or (select jsonb_agg(to_jsonb(p)-'model' order by p.user_id) from public.reader_content_analysis_policies p)
    is distinct from policies_before then
   raise exception 'Selection failed policy model-only preservation'; end if;
  if (select count(*) from public.admin_audit_events)<>audit_before+1 then raise exception 'Missing/duplicate audit'; end if;
  select * into audit from public.admin_audit_events where action='analysis.model.updated'
   and (details->>'revision')::bigint=revision_before+1;
  if audit.admin_id is distinct from 'synthetic-settings-admin' or audit.target_id is distinct from 'content_analysis_runtime_settings'
   or audit.details is distinct from jsonb_build_object('previous_model',previous_model,
    'selected_model',selected,'revision',revision_before+1) then
   raise exception 'Audit metadata incorrect'; end if;
 end loop;

 select * into settings from public.content_analysis_runtime_settings;
 select count(*) into audit_before from public.admin_audit_events;
 begin perform public.admin_set_analysis_model('synthetic-settings-admin','deepseek/deepseek-v4.1-flash-1017',settings.revision-1);
  raise exception 'Stale revision accepted'; exception when sqlstate 'PT409' then
   if sqlerrm<>'Analysis settings changed; reload before saving' then raise; end if;
 end;
 for invalid in select * from (values
  (null::text,'minimax/minimax-m3.1-flash'::text,settings.revision),
  ('','minimax/minimax-m3.1-flash',settings.revision),
  (E' \t\n','minimax/minimax-m3.1-flash',settings.revision),
  (repeat('x',201),'minimax/minimax-m3.1-flash',settings.revision),
  ('synthetic-settings-admin',null,settings.revision),
  ('synthetic-settings-admin','unknown/model',settings.revision),
  ('synthetic-settings-admin','minimax/minimax-m3.1-flash ',settings.revision),
  ('synthetic-settings-admin','Minimax/minimax-m3.1-flash',settings.revision),
  ('synthetic-settings-admin','openai/gpt-6-luna-pro:free',settings.revision),
  ('synthetic-settings-admin','minimax/minimax-m3.1-flash',null::bigint),
  ('synthetic-settings-admin','minimax/minimax-m3.1-flash',0),
  ('synthetic-settings-admin','minimax/minimax-m3.1-flash',-1)
 ) v(admin_id,model,revision) loop
  begin perform public.admin_set_analysis_model(invalid.admin_id,invalid.model,invalid.revision);
   raise exception 'Invalid selection accepted'; exception when sqlstate 'PT400' then
    if sqlerrm<>'Invalid analysis model selection' then raise; end if;
  end;
 end loop;
 if (select to_jsonb(s) from public.content_analysis_runtime_settings s) is distinct from to_jsonb(settings)
  or (select jsonb_agg(to_jsonb(p)-'model' order by p.user_id) from public.reader_content_analysis_policies p) is distinct from policies_before
  or exists(select 1 from public.reader_content_analysis_policies where model<>settings.selected_model)
  or (select count(*) from public.admin_audit_events)<>audit_before then
  raise exception 'Rejected save changed settings/policies/audit'; end if;

 -- An empty policy set and repeated same-model save still have a valid CAS.
 delete from public.reader_content_analysis_policies;
 response:=public.admin_set_analysis_model('synthetic-settings-admin',settings.selected_model,settings.revision);
 if (response->>'revision')::bigint<>settings.revision+1 then raise exception 'Empty policy selection failed'; end if;
 delete from public.content_analysis_runtime_settings;
 begin perform public.admin_set_analysis_model('synthetic-settings-admin',settings.selected_model,settings.revision+1);
  raise exception 'Missing singleton recreated silently'; exception when sqlstate 'PT503' then null; end;
 insert into public.content_analysis_runtime_settings default values;
 if not exists(select 1 from public.content_analysis_runtime_settings where id and revision=1
  and selected_model='deepseek/deepseek-v4.1-flash-1017' and updated_by is null and updated_at is not null) then
  raise exception 'Column defaults incorrect'; end if;
 update public.content_analysis_runtime_settings set revision=9223372036854775807;
 begin perform public.admin_set_analysis_model('synthetic-settings-admin',settings.selected_model,9223372036854775807);
  raise exception 'Revision overflow accepted'; exception when sqlstate 'PT409' then null; end;
end $$;
rollback;
