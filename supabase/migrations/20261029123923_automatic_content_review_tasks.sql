-- Opt-in new-content drafts. Nothing is enabled or published by this migration.
-- All model calls keep the existing finite-session/shared financial ledger.
begin;

create table public.automatic_content_policies (
 user_id text primary key references public.reader_workspaces(user_id) on delete cascade,
 enabled boolean not null default false,
 starts_at timestamptz not null,
 session_budget_usd numeric(24,12) not null default .30 check(session_budget_usd between .10 and 10),
 max_calls integer not null default 100 check(max_calls between 1 and 250),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.automatic_content_tasks (
 id uuid primary key default gen_random_uuid(),
 user_id text not null,update_id text not null,source_id text not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object' and octet_length(source_snapshot::text)<=2000000),
 task text not null check(task in('keywords','recap')),
 state text not null default 'queued' check(state in('queued','running','review','blocked','failed')),
 session_id uuid unique references public.keyword_learning_sessions(id),
 lease_token uuid,lease_until timestamptz,
 lease_claims integer not null default 0 check(lease_claims>=0),
 review_count integer not null default 0 check(review_count between 0 and 5000),
 error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(user_id,update_id,content_hash,task),
 foreign key(user_id,update_id) references public.reader_source_updates(user_id,id) on delete cascade,
 foreign key(user_id) references public.automatic_content_policies(user_id) on delete cascade,
 check(jsonb_typeof(source_snapshot->'content')='string'
  and encode(sha256(convert_to(source_snapshot->>'content','UTF8')),'hex')=content_hash
  and public.content_analysis_source_revision(source_snapshot)=source_revision
  and source_snapshot->>'id'=update_id and source_snapshot->>'sourceId'=source_id),
 check((state='running' and session_id is not null and lease_token is not null and lease_until is not null) or
  (state<>'running' and lease_token is null and lease_until is null))
);
create index automatic_content_tasks_queue on public.automatic_content_tasks(state,created_at,id);
alter table public.automatic_content_policies enable row level security;
alter table public.automatic_content_tasks enable row level security;
revoke all on public.automatic_content_policies,public.automatic_content_tasks from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.automatic_content_policies,public.automatic_content_tasks to service_role;
-- The existing service-only invoker may create finite admissions; no reader can.
grant insert on public.keyword_learning_sessions to service_role;

create function public.automatic_content_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='automatic_content_policies' then
  if new.user_id is distinct from old.user_id or new.starts_at is distinct from old.starts_at or new.created_at is distinct from old.created_at then
   raise exception 'Automatic collection cutoff is immutable' using errcode='PT409';end if;
 else
  if (to_jsonb(new)-array['state','session_id','lease_token','lease_until','lease_claims','review_count','error_code','updated_at']) is distinct from
   (to_jsonb(old)-array['state','session_id','lease_token','lease_until','lease_claims','review_count','error_code','updated_at'])
   or(old.session_id is not null and new.session_id is distinct from old.session_id) then
   raise exception 'Automatic source evidence and session are immutable' using errcode='PT409';end if;
 end if;
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');return new;
end;
$$;
create trigger automatic_content_policy_immutable before update on public.automatic_content_policies for each row execute function public.automatic_content_immutable();
create trigger automatic_content_task_immutable before update on public.automatic_content_tasks for each row execute function public.automatic_content_immutable();

create function public.guard_automatic_content_request()returns trigger
language plpgsql security invoker set search_path=''as $$
declare t public.automatic_content_tasks;a public.reader_source_updates;w public.reader_workspaces;
begin
 select*into t from public.automatic_content_tasks where session_id=new.session_id;
 if not found then return new;end if;
 if t.state<>'running'or t.lease_until<=clock_timestamp()
  or not exists(select 1 from public.automatic_content_policies p where p.user_id=t.user_id and p.enabled)
  or not exists(select 1 from public.content_analysis_budget where id and enabled)
  or not exists(select 1 from public.reader_content_analysis_policies where user_id=t.user_id and enabled)then
  raise exception 'Automatic processing is paused or lease expired'using errcode='PT403';end if;
 select*into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id;
 select*into w from public.reader_workspaces where user_id=t.user_id;
 if new.source_ordinal<>1 or new.source_hash<>t.content_hash or a.id is null or w.user_id is null
  or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then
  raise exception 'Automatic source changed before reservation'using errcode='PT409';end if;
 return new;
end;
$$;
create trigger guard_automatic_content_request before insert on public.keyword_learning_requests for each row execute function public.guard_automatic_content_request();

create function public.sync_automatic_content_tasks() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare added integer;
begin
 -- Daily limits reopen only on a later UTC day, using the same still-valid
 -- finite session. Unknown charges, failures and lifetime stops never retry.
 update public.automatic_content_tasks t set state='queued',error_code=null
  from public.automatic_content_policies p where t.user_id=p.user_id and p.enabled and t.state='blocked'
   and t.error_code='analysis_daily_budget_exhausted'
   and t.updated_at<(date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC')
   and(t.session_id is null or exists(select 1 from public.keyword_learning_sessions s where s.id=t.session_id and s.state='released'and s.expires_at>clock_timestamp()));
 insert into public.automatic_content_tasks(user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,source_snapshot,task)
 select a.user_id,a.id,a.source_id,h.hash,public.content_analysis_source_revision(a.record),
  public.content_analysis_source_fingerprint(w.state,a.source_id),a.record,t.task
 from public.automatic_content_policies p join public.reader_workspaces w using(user_id)
 join public.reader_source_updates a on a.user_id=p.user_id
 cross join lateral(select encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') hash) h
 cross join(values('keywords'::text),('recap'::text))t(task)
 where p.enabled and a.collected_at>=p.starts_at and public.content_analysis_eligible(w.state,a.record)
  and not(case when t.task='keywords' then(public.content_analysis_keyword_provenance(a.record)#>>'{}')=h.hash
   else a.record#>>'{videoSummary,captionHash}'=h.hash and a.record#>>'{videoSummary,status}'='ready' end is true)
 on conflict(user_id,update_id,content_hash,task)do nothing;
 get diagnostics added=row_count;
 return jsonb_build_object('synchronized',added);
end;
$$;

create function public.claim_automatic_content_task(p_lease_seconds integer default 900) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;p public.automatic_content_policies;
 a public.reader_source_updates;w public.reader_workspaces;b public.content_analysis_budget;
 op public.reader_content_analysis_policies;s public.keyword_learning_sessions;
 utc_day timestamptz;global_total numeric;global_day numeric;owner_total numeric;owner_day numeric;reason text;
begin
 if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then raise exception 'Invalid automatic lease'using errcode='PT400';end if;
 select q.*into t from public.automatic_content_tasks q join public.automatic_content_policies ap using(user_id)
 where ap.enabled and(q.state='queued' or(q.state='running'and q.lease_until<=clock_timestamp()))
 order by q.created_at,q.update_id,case q.task when'recap'then 0 else 1 end,q.id limit 1;
 if t.id is null then return jsonb_build_object('claimed',false);end if;
 -- Keep the existing workspace -> archive -> global budget -> owner ordering.
 select *into w from public.reader_workspaces where user_id=t.user_id for key share;
 select *into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select *into b from public.content_analysis_budget where id for update;
 select *into op from public.reader_content_analysis_policies where user_id=t.user_id for update;
 select *into p from public.automatic_content_policies where user_id=t.user_id for share;
 select *into t from public.automatic_content_tasks where id=t.id for update skip locked;
 if t.id is null or p.enabled is distinct from true or t.state not in('queued','running')or(t.state='running'and t.lease_until>clock_timestamp())then
  return jsonb_build_object('claimed',false);end if;
 if b.enabled is distinct from true or op.enabled is distinct from true then return jsonb_build_object('claimed',false,'reason','automatic_processing_paused');end if;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 end if;
 utc_day:=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into global_total,global_day from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))filter(where created_at>=utc_day or actual_usd is null),0)
  into owner_total,owner_day from public.reader_content_analysis_calls where user_id=t.user_id;
 if reason is null then
  if global_total+.10>least(b.lifetime_limit_usd,10)or owner_total+.10>least(op.lifetime_limit_usd,10)then reason:='analysis_budget_exhausted';
  elsif global_day+.10>least(b.daily_limit_usd,5)or owner_day+.10>least(op.daily_limit_usd,5)then reason:='analysis_daily_budget_exhausted';
  elsif op.per_call_limit_usd<.10 then reason:='analysis_call_limit';end if;
 end if;
 if t.session_id is not null then
  select *into s from public.keyword_learning_sessions where id=t.session_id for update;
  if reason is null and(s.id is null or s.state<>'released'or s.expires_at<=clock_timestamp())then reason:='automatic_session_expired';end if;
  if reason is null and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=t.session_id and c.actual_usd is null)then reason:='analysis_unknown_charge_hold';end if;
 end if;
 if reason is not null then
  update public.automatic_content_tasks set state='blocked',error_code=reason,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then
   update public.keyword_learning_sessions set state='closed'where id=t.session_id and state<>'closed';
  end if;
  return jsonb_build_object('claimed',false,'reason',reason,'taskId',t.id);
 end if;
 if t.session_id is null then
  insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values(t.user_id,'released',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',t.update_id,'sourceHash',t.content_hash,'sourceRevision',t.source_revision)),
    array['deepseek/deepseek-v4.1-flash-1017','openai/gpt-6.1-sol-pro'],
    least(p.session_budget_usd,least(b.lifetime_limit_usd,10)-global_total,least(op.lifetime_limit_usd,10)-owner_total),
    p.max_calls,clock_timestamp()+interval'24 hours')returning*into s;
 end if;
 update public.automatic_content_tasks set state='running',session_id=s.id,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_claims=lease_claims+1,error_code=null
  where id=t.id returning*into t;
 return jsonb_build_object('claimed',true,'task',to_jsonb(t),'record',t.source_snapshot,'leaseToken',t.lease_token);
end;
$$;

create function public.finish_automatic_content_task(p_task_id uuid,p_lease_token uuid,p_result jsonb default null,p_error_code text default null)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.automatic_content_tasks;a public.reader_source_updates;w public.reader_workspaces;
 s public.keyword_learning_sessions;keys jsonb;entry jsonb;point jsonb;chosen jsonb;provenance jsonb;reason text;label text;kind text;
 amount integer:=0;inserted integer;unknown_call boolean;key_count integer;
begin
 if p_task_id is null or p_lease_token is null or(p_error_code is null and p_result is null)
  or(p_error_code is not null and(p_error_code!~'^[a-z][a-z0-9_]{0,79}$'or p_result is not null))
  or(p_result is not null and(jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>2000000))then
  raise exception 'Invalid automatic task result'using errcode='PT400';end if;
 select*into t from public.automatic_content_tasks where id=p_task_id;
 if not found then raise exception 'Automatic task unavailable'using errcode='PT409';end if;
 select*into w from public.reader_workspaces where user_id=t.user_id for key share;
 select*into a from public.reader_source_updates where user_id=t.user_id and id=t.update_id for share;
 select*into t from public.automatic_content_tasks where id=p_task_id for update;
 if t.state<>'running'or t.lease_token is distinct from p_lease_token or t.lease_until<=clock_timestamp()then
  raise exception 'Automatic task lease changed'using errcode='PT409';end if;
 select*into s from public.keyword_learning_sessions where id=t.session_id for update;
 if a.id is null or w.user_id is null or a.source_id is distinct from t.source_id or public.content_analysis_eligible(w.state,a.record)is distinct from true
  or public.content_analysis_source_revision(a.record)is distinct from t.source_revision
  or public.content_analysis_source_fingerprint(w.state,t.source_id)is distinct from t.source_fingerprint then reason:='automatic_source_changed';
 elsif not exists(select 1 from public.automatic_content_policies p where p.user_id=t.user_id and p.enabled)then reason:='automatic_processing_paused';
 elsif s.state is distinct from'released'or s.expires_at<=clock_timestamp()then reason:='automatic_session_expired';end if;
 select coalesce(jsonb_agg(r.call_key order by r.created_at,r.call_key),'[]'::jsonb),count(*),coalesce(bool_or(c.actual_usd is null),false)
  into keys,key_count,unknown_call from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
  where r.session_id=t.session_id and r.source_ordinal=1 and r.source_hash=t.content_hash and c.user_id=t.user_id;
 if reason is null and p_error_code='automatic_worker_yield'and not unknown_call then
  update public.automatic_content_tasks set state='queued',error_code=p_error_code,lease_token=null,lease_until=null where id=t.id;
  return jsonb_build_object('state','queued','reviewCount',0,'sessionId',s.id);
 end if;
 if reason is null then reason:=case when unknown_call then'analysis_unknown_charge_hold'else p_error_code end;end if;
 provenance:=jsonb_build_object('origin','automatic_content','sessionId',s.id,'callKeys',keys,'sourceRevision',t.source_revision,
  'message','Automatically generated draft. Administrator confirmation is required; nothing was published.');
 if reason is not null then
  -- Operational stops stay in task monitoring. Real attempted provider failures
  -- retain one inspectable inbox row, with no invented empty generated finding.
  if reason not in('automatic_worker_yield','automatic_source_changed','automatic_processing_paused','automatic_session_expired',
    'analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_input_limit')
   and exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
    where r.session_id=s.id and r.completed and c.result_at is not null)then
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,case when t.task='recap'then'recap'else'keyword'end,
     'automatic:'||t.id::text||':failure',t.source_snapshot,'{}',
     'Automatic generation could not provide a validated draft ('||reason||'). Inspect the saved source and prompt, then edit or reject.',provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics amount=row_count;
  end if;
  update public.automatic_content_tasks set state=case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,
   error_code=reason,review_count=amount,lease_token=null,lease_until=null where id=t.id;
  if reason<>'analysis_daily_budget_exhausted'then update public.keyword_learning_sessions set state='closed'where id=s.id;end if;
  return jsonb_build_object('state',case when reason like'analysis_provider%'or reason='analysis_generation_failed'then'failed'else'blocked'end,'errorCode',reason,'reviewCount',amount);
 end if;
 if key_count=0 or jsonb_typeof(p_result->'callKeys')is distinct from'array'
  or jsonb_array_length(p_result->'callKeys')<>key_count or not((p_result->'callKeys')@>keys and keys@>(p_result->'callKeys'))
  or exists(select 1 from public.keyword_learning_requests r join public.reader_content_analysis_calls c on c.id=r.call_id
   where r.session_id=s.id and(not r.completed or r.result is null or r.error_code is not null or r.source_ordinal<>1 or r.source_hash<>t.content_hash or c.user_id<>t.user_id or c.actual_usd is null))then
  raise exception 'Exact completed automatic call evidence is required'using errcode='PT409';end if;
 if t.task='keywords'then
  if p_result->>'kind'is distinct from'keywords'or jsonb_typeof(p_result->'proposals')is distinct from'array'or jsonb_array_length(p_result->'proposals')>5000 then
   raise exception 'Invalid automatic keyword proposals'using errcode='PT400';end if;
  for entry in select value from jsonb_array_elements(p_result->'proposals')loop
   label:=btrim(entry->>'label');kind:=entry->>'kind';
   if jsonb_typeof(entry)is distinct from'object'or(entry-array['label','kind','reason'])<>'{}'::jsonb
    or jsonb_typeof(entry->'label')is distinct from'string'or char_length(label)not between 1 and 100 or label~'[[:cntrl:]]'
    or kind is null or kind not in('brand','product','game','technology','category')then
    raise exception 'Invalid automatic keyword proposal'using errcode='PT400';end if;
   reason:=coalesce(nullif(btrim(entry->>'reason'),''),'AI keyword draft; confirm its relevance and identity, edit or reject.');
   if strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    reason:='Name does not occur literally in the saved source. Correct it from that source or reject. '||reason;
   end if;
   if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
    values(t.user_id,t.update_id,t.source_id,t.content_hash,'keyword','automatic:'||t.id::text||':keyword:'||encode(sha256(convert_to(public.keyword_review_label_key(label),'UTF8')),'hex'),
     t.source_snapshot,jsonb_build_object('label',label,'kind',kind),reason,provenance)
    on conflict(dedupe_key)do nothing;
   get diagnostics inserted=row_count;amount:=amount+inserted;
  end loop;
 else
  chosen:=p_result->'proposal';
  if p_result->>'kind'is distinct from'recap'or jsonb_typeof(chosen)is distinct from'object'or(chosen-'highlights')<>'{}'::jsonb
   or jsonb_typeof(chosen->'highlights')is distinct from'array'or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'Automatic recap needs one to six cited points'using errcode='PT400';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb
    or jsonb_typeof(point->'text')is distinct from'string'or char_length(btrim(point->>'text'))not between 1 and 500
    or cardinality(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'))>38
    or jsonb_typeof(point->'evidenceQuote')is distinct from'string'or char_length(btrim(point->>'evidenceQuote'))not between 15 and 1000
    or strpos(a.record->>'content',point->>'evidenceQuote')=0 then
    raise exception 'Automatic recap needs exact supporting source quotes'using errcode='PT400';end if;
  end loop;
  reason:=coalesce(nullif(btrim(p_result->>'reason'),''),'AI recap draft; check the cited source, then confirm, edit or reject.');
  if char_length(reason)>2000 then raise exception 'Automatic reason is too long'using errcode='PT400';end if;
  insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
   values(t.user_id,t.update_id,t.source_id,t.content_hash,'recap','automatic:'||t.id::text||':recap',t.source_snapshot,chosen,reason,provenance)
   on conflict(dedupe_key)do nothing;
  get diagnostics amount=row_count;
 end if;
 update public.automatic_content_tasks set state='review',review_count=amount,error_code=null,lease_token=null,lease_until=null where id=t.id;
 update public.keyword_learning_sessions set state='closed'where id=s.id;
 return jsonb_build_object('state','review','reviewCount',amount);
end;
$$;
revoke all on function public.automatic_content_immutable(),public.guard_automatic_content_request(),public.sync_automatic_content_tasks(),public.claim_automatic_content_task(integer),
 public.finish_automatic_content_task(uuid,uuid,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.sync_automatic_content_tasks(),public.claim_automatic_content_task(integer),public.finish_automatic_content_task(uuid,uuid,jsonb,text)to service_role;
commit;
