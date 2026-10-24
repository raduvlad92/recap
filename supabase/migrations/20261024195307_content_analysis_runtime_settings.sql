-- Private model selection only. Never enables analysis, alters spending caps,
-- changes schedules, or rewrites an existing execution/call identity.
begin;

create table public.content_analysis_runtime_settings (
 id boolean primary key default true check(id),
 selected_model text not null default 'deepseek/deepseek-v4.1-flash-1017'
  check(selected_model in (
   'deepseek/deepseek-v4.1-flash-1017',
   'minimax/minimax-m3.1-flash',
   'openai/gpt-6-luna-pro',
   'openai/gpt-6.1-sol-pro'
  )),
 revision bigint not null default 1 check(revision>=1),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by text
);
alter table public.content_analysis_runtime_settings enable row level security;
revoke all on public.content_analysis_runtime_settings from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.content_analysis_runtime_settings to service_role;

insert into public.content_analysis_runtime_settings(id) values(true);
-- Preserve enabled state, every allowance, fairness timestamps and operator
-- metadata. The same user-id lock order is used by the selection RPC below.
do $$ begin
 perform 1 from public.reader_content_analysis_policies order by user_id for update;
 update public.reader_content_analysis_policies
  set model='deepseek/deepseek-v4.1-flash-1017'
  where model is distinct from 'deepseek/deepseek-v4.1-flash-1017';
end $$;

create function public.admin_set_analysis_model(p_admin_id text,p_model text,p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.content_analysis_runtime_settings; saved public.content_analysis_runtime_settings;
begin
 if p_admin_id is null or char_length(p_admin_id) not between 1 and 200
  or p_admin_id !~ '[^[:space:]]'
  or p_model is null or p_model not in (
   'deepseek/deepseek-v4.1-flash-1017',
   'minimax/minimax-m3.1-flash',
   'openai/gpt-6-luna-pro',
   'openai/gpt-6.1-sol-pro'
  ) or p_expected_revision is null or p_expected_revision<1 then
  raise exception 'Invalid analysis model selection' using errcode='PT400';
 end if;

 -- The singleton serializes selections. Reject stale saves before taking any
 -- policy locks or changing any settings, policies or audit records.
 select * into previous from public.content_analysis_runtime_settings where id for update;
 if not found then raise exception 'Analysis settings unavailable' using errcode='PT503'; end if;
 if previous.revision<>p_expected_revision then
  raise exception 'Analysis settings changed; reload before saving' using errcode='PT409';
 end if;
 if previous.revision=9223372036854775807 then
  raise exception 'Analysis settings revision exhausted' using errcode='PT409';
 end if;

 -- Workers lock budget -> one policy -> call and never this settings row.
 -- Lock all policies in stable order; do not take budget/job/call locks here.
 perform 1 from public.reader_content_analysis_policies order by user_id for update;
 update public.content_analysis_runtime_settings
  set selected_model=p_model,revision=revision+1,updated_at=clock_timestamp(),updated_by=p_admin_id
  where id and revision=p_expected_revision returning * into saved;
 if not found then raise exception 'Analysis settings changed; reload before saving' using errcode='PT409'; end if;
 update public.reader_content_analysis_policies set model=p_model where model is distinct from p_model;

 begin
  insert into public.admin_audit_events(admin_id,action,target_id,details)
   values(p_admin_id,'analysis.model.updated','content_analysis_runtime_settings',jsonb_build_object(
    'previous_model',previous.selected_model,'selected_model',saved.selected_model,'revision',saved.revision));
 exception when others then
  raise exception 'Audit unavailable; analysis model not saved' using errcode='PT503';
 end;
 return jsonb_build_object('selected_model',saved.selected_model,'revision',saved.revision,'updated_at',saved.updated_at);
end;
$$;
revoke all on function public.admin_set_analysis_model(text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_analysis_model(text,text,bigint) to service_role;

commit;
