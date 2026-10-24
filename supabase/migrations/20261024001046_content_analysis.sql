-- D35. Structure/RPCs only: no policy is enabled, no model/provider is called.
-- Service-only private queue. Raw UTF8 content hash matches D28 exactly.
-- Lock order: workspace SHARE -> archive SHARE/UPDATE -> job -> global budget
-- -> owner policy -> call -> keyword reviews. Settlement uses budget -> policy
-- -> call only. Never take a job lock before an archive/workspace lock.
begin;

create function public.content_analysis_source_revision(p_record jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
  'id',p_record->'id','sourceId',p_record->'sourceId','url',p_record->'url',
  'title',p_record->'title','format',p_record->'format','isSample',p_record->'isSample',
  'content',p_record->'content','contentKind',p_record->'contentKind',
  'coverage',p_record->'coverage','transcriptSegments',p_record->'transcriptSegments',
  'videoFormatKind',p_record#>'{videoFormat,kind}','isShort',p_record->'isShort')::text,'UTF8')),'hex');
$$;
create function public.content_analysis_source_fingerprint(p_state jsonb,p_source_id text) returns text
language sql stable strict security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('platform',x->'platform','url',x->'url','feedUrl',x->'feedUrl')::text,'UTF8')),'hex')
 from jsonb_array_elements(coalesce(p_state->'customSources','[]'::jsonb)) x
 where x->>'id'=p_source_id and coalesce(x->>'status','')<>'sample' limit 1;
$$;
create function public.content_analysis_eligible(p_state jsonb,p_record jsonb) returns boolean
language sql stable strict security invoker set search_path='' as $$
 select coalesce(p_state->'followedSourceIds' ? (p_record->>'sourceId'),false)
  and public.content_analysis_source_fingerprint(p_state,p_record->>'sourceId') is not null
  and p_record->'isSample'='false'::jsonb
  -- D35 initial paid scope is saved VIDEO TRANSCRIPTS only. Social originals,
  -- descriptions and podcasts never become paid work in this increment.
  and p_record->>'format'='video' and p_record->>'contentKind'='transcript'
  and jsonb_typeof(p_record->'content')='string' and length(btrim(p_record->>'content'))>0
  and (coalesce(p_state#>array['sourcePreferences',p_record->>'sourceId','showShorts'],'false'::jsonb)='true'::jsonb
   or (p_record#>>'{videoFormat,kind}'='regular'
    and p_record->'isShort' is distinct from 'true'::jsonb
    and coalesce(p_record->>'url','') !~* '^https://(www\.|m\.)?youtube\.com/shorts/'));
$$;

create table public.content_analysis_budget (
 id boolean primary key default true check(id), enabled boolean not null default false,
 daily_limit_usd numeric(24,12) not null check(daily_limit_usd>0 and daily_limit_usd<=45),
 lifetime_limit_usd numeric(24,12) not null check(lifetime_limit_usd>0 and lifetime_limit_usd<=45),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.reader_content_analysis_policies (
 user_id text primary key check(length(user_id) between 1 and 200),
 enabled boolean not null default false,
 daily_limit_usd numeric(24,12) not null check(daily_limit_usd>0 and daily_limit_usd<=45),
 lifetime_limit_usd numeric(24,12) not null check(lifetime_limit_usd>0 and lifetime_limit_usd<=45),
 per_call_limit_usd numeric(24,12) not null check(per_call_limit_usd>0 and per_call_limit_usd<=1),
 model text not null check(length(model) between 1 and 160),
 last_served_at timestamptz not null default '-infinity',
 updated_at timestamptz not null default clock_timestamp()
);
create index content_analysis_policies_fairness on public.reader_content_analysis_policies(enabled,last_served_at,user_id);
-- Budget rows intentionally survive workspace/archive deletion. Deletion must
-- never erase unresolved financial commitments or reset lifetime allowances.
create table public.reader_content_analysis_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public.reader_workspaces(user_id) on delete cascade,
 update_id text not null, source_id text not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 rule_version text not null default 'content-v1' check(rule_version='content-v1'),
 task text not null check(task in ('summary','keywords')),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 source_fingerprint text not null, workspace_revision timestamptz not null,
 config_epoch text not null default '' check(length(config_epoch)<=200),
 state text not null default 'queued' check(state in ('queued','running','prepared','published','failed','blocked','cancelled','skipped')),
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0 check(attempts>=0),
 next_attempt_at timestamptz not null default '-infinity',
 result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=500000)),
 error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 published_at timestamptz,
 foreign key(user_id,update_id) references public.reader_source_updates(user_id,id) on delete cascade,
 unique(user_id,update_id,content_hash,rule_version,task)
);
create index content_analysis_jobs_ready on public.reader_content_analysis_jobs(next_attempt_at,created_at,id)
 where state in ('queued','running','prepared','failed','blocked');
create index content_analysis_jobs_owner on public.reader_content_analysis_jobs(user_id,source_id,update_id);
create index content_analysis_jobs_owner_status on public.reader_content_analysis_jobs(user_id,updated_at,id);
create table public.reader_content_analysis_calls (
 id uuid primary key default gen_random_uuid(), job_id uuid references public.reader_content_analysis_jobs(id) on delete set null,
 user_id text not null, call_key text not null check(length(call_key) between 1 and 160),
 lease_token uuid not null, model text not null,
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 maximum_usd numeric(24,12) not null check(maximum_usd>0 and maximum_usd<=1),
 observed_usd numeric(24,12) check(observed_usd>=0 and observed_usd<='999999999999'::numeric),
 actual_usd numeric(24,12) check(actual_usd>=0 and actual_usd<='999999999999'::numeric),
 state text not null default 'reserved' check(state in ('reserved','unknown','settled')),
 result jsonb check(result is null or octet_length(result::text)<=500000),
 usage jsonb check(usage is null or (jsonb_typeof(usage)='object' and octet_length(usage::text)<=20000)),
 provider_id text check(length(provider_id)<=300), result_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), settled_at timestamptz,
 unique(job_id,call_key), check((state='settled')=(actual_usd is not null))
);
create index content_analysis_calls_owner_date on public.reader_content_analysis_calls(user_id,created_at,id);
create index content_analysis_calls_unsettled on public.reader_content_analysis_calls(created_at,id) where actual_usd is null;
alter table public.content_analysis_budget enable row level security;
alter table public.reader_content_analysis_policies enable row level security;
alter table public.reader_content_analysis_jobs enable row level security;
alter table public.reader_content_analysis_calls enable row level security;
revoke all on public.content_analysis_budget,public.reader_content_analysis_policies,public.reader_content_analysis_jobs,public.reader_content_analysis_calls from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.content_analysis_budget,public.reader_content_analysis_policies,public.reader_content_analysis_jobs,public.reader_content_analysis_calls to service_role;

-- Independent keyword batch provenance. Explicit null/invalid values mean
-- unknown; only an absent key may use an untouched historical summary hash.
create function public.content_analysis_keyword_provenance(p_record jsonb) returns jsonb
language sql immutable strict security invoker set search_path='' as $$
 select case when p_record ? 'keywordContentHash' then case
   when jsonb_typeof(p_record->'keywordContentHash')='string'
    and (p_record->>'keywordContentHash') ~ '^[a-f0-9]{64}$' then p_record->'keywordContentHash'
   else 'null'::jsonb end
  when jsonb_typeof(p_record#>'{videoSummary,captionHash}')='string'
   and (p_record#>>'{videoSummary,captionHash}') ~ '^[a-f0-9]{64}$' then p_record#>'{videoSummary,captionHash}'
  else 'null'::jsonb end;
$$;

create function public.content_analysis_processing(p_record jsonb,p_hash text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select (case when p_record#>>'{processing,contentHash}'=p_hash and p_record#>>'{processing,ruleVersion}'='content-v1' then p_record->'processing'
  else jsonb_build_object('ruleVersion','content-v1','contentHash',p_hash,'recap',
   case when p_record#>>'{videoSummary,ruleVersion}'='takeaways-v1' and p_record#>>'{videoSummary,captionHash}'=p_hash and p_record#>>'{videoSummary,status}'='ready'
    then case when jsonb_array_length(coalesce(p_record->'videoHighlights','[]'::jsonb))>0 then 'ready' else 'empty' end else 'pending' end,'keywords','pending') end)
  ||jsonb_build_object('content',case when p_record#>>'{processing,contentHash}'=p_hash and p_record#>>'{processing,content}'='partial'
   or nullif(btrim(p_record->>'coverage'),'') is null or p_record->>'coverage' ~* '(partial|incomplete|excerpt|truncat|not verified|unverified|clipped|unknown|not complete)' then 'partial' else 'ready' end);
$$;

create function public.sync_content_analysis_jobs(p_user_id text,p_limit integer default 200,p_config_epoch text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.reader_workspaces; a public.reader_source_updates; task_name text; h text; rev text; n integer:=0; changed integer; legacy boolean;
begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 1000 or p_config_epoch is null or length(p_config_epoch)>200 then raise exception 'Invalid queue request' using errcode='PT400'; end if;
 select * into w from public.reader_workspaces where user_id=p_user_id for share;
 if not found then return jsonb_build_object('synchronized',0); end if;
 -- Scan the durable archive, including later caption recovery; newest eligible
 -- items precede old backfill. Lock every archive before touching its job rows.
 for a in select r.* from public.reader_source_updates r where r.user_id=p_user_id
  and public.content_analysis_eligible(w.state,r.record)
  and exists(select 1 from unnest(array['summary','keywords']) t where not exists(
   select 1 from public.reader_content_analysis_jobs j where j.user_id=r.user_id and j.update_id=r.id
    and j.content_hash=encode(sha256(convert_to(r.record->>'content','UTF8')),'hex') and j.rule_version='content-v1' and j.task=t
    and j.source_revision=public.content_analysis_source_revision(r.record) and j.state<>'cancelled'
    and not (j.state='blocked' and j.config_epoch<>p_config_epoch and j.error_code in
     ('analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'))))
  -- Hourly enrichment may lock archives in provider item order. Skip locked
  -- rows so our newest-first scan cannot wait while holding a newer row that
  -- hourly needs next. Skipped rows remain eligible for the next queue sync.
  order by r.published_at desc,r.id limit p_limit for share of r skip locked
 loop
  h:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'); rev:=public.content_analysis_source_revision(a.record);
  foreach task_name in array array['summary','keywords'] loop
   legacy:=task_name='summary' and a.record#>>'{videoSummary,ruleVersion}'='takeaways-v1'
    and a.record#>>'{videoSummary,captionHash}'=h and a.record#>>'{videoSummary,status}'='ready'
    and jsonb_typeof(a.record->'videoHighlights')='array'
    and not exists(select 1 from jsonb_array_elements(coalesce(a.record->'videoHighlights','[]'::jsonb)) point
     where (a.record#>>'{videoSummary,timingBasis}'='none' and point ? 'startSeconds')
      or (point ? 'startSeconds' and not exists(select 1 from jsonb_array_elements(coalesce(a.record->'transcriptSegments','[]'::jsonb)) cue where cue->'startSeconds'=point->'startSeconds')));
   insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,task,source_revision,source_fingerprint,workspace_revision,config_epoch,state)
    values(p_user_id,a.id,a.source_id,h,task_name,rev,public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,p_config_epoch,
     case when legacy then 'skipped' else 'queued' end)
    on conflict(user_id,update_id,content_hash,rule_version,task) do update set
     source_revision=excluded.source_revision,source_fingerprint=excluded.source_fingerprint,workspace_revision=excluded.workspace_revision,
     config_epoch=excluded.config_epoch,
     attempts=0,
     state=excluded.state,lease_token=null,lease_until=null,result=null,error_code=null,next_attempt_at='-infinity',updated_at=clock_timestamp()
    where reader_content_analysis_jobs.state='cancelled' or (reader_content_analysis_jobs.state='blocked'
     and reader_content_analysis_jobs.config_epoch<>excluded.config_epoch and reader_content_analysis_jobs.error_code in
      ('analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit','analysis_budget_exhausted','analysis_call_limit'));
   get diagnostics changed=row_count; n:=n+changed;
  end loop;
 end loop;
 return jsonb_build_object('synchronized',n);
end;
$$;

-- Shared lock/fence routine. No workspace equality check: unrelated bookmark
-- saves may continue. Source fingerprint + invalidation triggers fence follow
-- epochs; exact source_revision fences caption/timing/identity replacements.
create function public.lock_content_analysis_job(p_job_id uuid,p_lease_token uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs; w public.reader_workspaces; a public.reader_source_updates;
begin
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if not found then raise exception 'Analysis job unavailable' using errcode='PT409'; end if;
 select * into w from public.reader_workspaces where user_id=j.user_id for share;
 if not found then raise exception 'Workspace deleted' using errcode='PT409'; end if;
 select * into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id for update;
 if not found then raise exception 'Source deleted' using errcode='PT409'; end if;
 select * into j from public.reader_content_analysis_jobs where id=p_job_id for update;
 if not found or j.state in ('cancelled','blocked','skipped')
  or not coalesce(public.content_analysis_eligible(w.state,a.record),false)
  or j.source_id is distinct from a.source_id
  or j.content_hash is distinct from encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
  or j.source_revision is distinct from public.content_analysis_source_revision(a.record)
  or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(w.state,a.source_id)
  or (p_lease_token is not null and (j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp())) then
  raise exception 'Analysis lease or source changed' using errcode='PT409';
 end if;
 return jsonb_build_object('job',to_jsonb(j),'record',a.record);
end;
$$;

create function public.claim_content_analysis_job(p_user_id text default null,p_lease_seconds integer default 300) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record; w public.reader_workspaces; a public.reader_source_updates; j public.reader_content_analysis_jobs; token uuid; proc jsonb;
begin
 if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'Invalid lease' using errcode='PT400'; end if;
 for candidate in select q.id,q.user_id,q.update_id from public.reader_content_analysis_jobs q
  join public.reader_content_analysis_policies p on p.user_id=q.user_id and p.enabled
  join public.reader_source_updates r on r.user_id=q.user_id and r.id=q.update_id
  where (p_user_id is null or q.user_id=p_user_id)
   and (q.state in ('queued','running','prepared','failed') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
   and q.next_attempt_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
   -- Expired running leases MUST reach the under-lock terminal cleanup even
   -- after attempt three. Daily pauses resume independently of that counter.
   and (q.attempts<3 or q.state in ('running','prepared') or (q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'))
  order by r.published_at desc,q.created_at,q.id limit 100
 loop
  select * into w from public.reader_workspaces where user_id=candidate.user_id for share;
  if not found then continue; end if;
  -- UPDATE rather than SHARE: claiming also publishes truthful running state.
  -- Sibling tasks cannot deadlock by each upgrading an archive SHARE lock.
  select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update skip locked;
  if not found then continue; end if;
  select * into j from public.reader_content_analysis_jobs where id=candidate.id for update skip locked;
  if not found then continue; end if;
  if not (j.state in ('queued','running','prepared','failed') or (j.state='blocked' and j.error_code='analysis_daily_budget_exhausted'))
   or j.next_attempt_at>clock_timestamp() or j.lease_until>clock_timestamp() then continue; end if;
  if not coalesce(public.content_analysis_eligible(w.state,a.record),false)
   or j.source_revision<>public.content_analysis_source_revision(a.record)
   or j.source_fingerprint<>public.content_analysis_source_fingerprint(w.state,a.source_id) then
   update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if j.state='running' and j.attempts>=3 then
   -- A crashed third worker can no longer publish or reserve. Close its lease
   -- and reader-visible state; caches/unknown monetary commitments survive.
   update public.reader_content_analysis_jobs set state='failed',error_code='analysis_lease_expired',
    lease_token=null,lease_until=null,next_attempt_at='infinity',updated_at=clock_timestamp() where id=j.id;
   proc:=public.content_analysis_processing(a.record,j.content_hash);
   proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"failed"'::jsonb)
    ||jsonb_build_object('reason','analysis_lease_expired','updatedAt',clock_timestamp());
   update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
   continue;
  end if;
  if j.attempts>=3 and j.state not in ('prepared','blocked') then continue; end if;
  token:=gen_random_uuid();
  update public.reader_content_analysis_jobs set lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   state=case when state='prepared' then 'prepared' else 'running' end,
   attempts=attempts+case when state='prepared' then 0 else 1 end,error_code=null,updated_at=clock_timestamp()
   where id=j.id returning * into j;
  proc:=public.content_analysis_processing(a.record,j.content_hash);
  proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],'"running"'::jsonb)
   ||jsonb_build_object('updatedAt',clock_timestamp());
  update public.reader_source_updates set record=a.record||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id;
  -- Persist fairness only after a real claim. Empty queues and terminal-lease
  -- cleanup never move a reader behind others or reserve any model budget.
  update public.reader_content_analysis_policies set last_served_at=clock_timestamp() where user_id=j.user_id;
  return jsonb_build_object('job',to_jsonb(j),'record',a.record,'leaseToken',token);
 end loop;
 return null;
end;
$$;

create function public.reserve_content_analysis_call(p_job_id uuid,p_lease_token uuid,p_call_key text,p_maximum_usd numeric,p_model text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; b public.content_analysis_budget; p public.reader_content_analysis_policies;
 c public.reader_content_analysis_calls; daily numeric; lifetime numeric; global_daily numeric; global_lifetime numeric; utc_day timestamptz;
begin
 if p_lease_token is null or p_call_key is null or length(p_call_key) not between 1 and 160
  or p_maximum_usd is null or p_maximum_usd<=0 or p_maximum_usd>1 or p_maximum_usd::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Invalid call reservation' using errcode='PT400'; end if;
 p_maximum_usd:=ceil(p_maximum_usd*1000000000000)/1000000000000;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state<>'running' then raise exception 'Job not running' using errcode='PT409'; end if;
 select * into b from public.content_analysis_budget where id for update;
 select * into p from public.reader_content_analysis_policies where user_id=j.user_id for update;
 if not coalesce(b.enabled and p.enabled,false) or p_model is distinct from p.model or p_maximum_usd>p.per_call_limit_usd then
  raise exception 'Analysis runtime or model disabled' using errcode='PT403'; end if;
 -- Stable job/role/chunk keys survive revisions and configuration changes.
 -- The worker checks its immutable requestHash before using cached output;
 -- mismatches block visibly instead of charging the same key again.
 select * into c from public.reader_content_analysis_calls where job_id=j.id and call_key=p_call_key;
 if found then return jsonb_build_object('claimed',false,'call',to_jsonb(c)); end if;
 utc_day:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 -- Unsettled commitments count on EVERY day, not only their creation day.
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into global_lifetime,global_daily from public.reader_content_analysis_calls;
 select coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))),0),
  coalesce(sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) filter(where created_at>=utc_day or actual_usd is null),0)
  into lifetime,daily from public.reader_content_analysis_calls where user_id=j.user_id;
 -- Lifetime exhaustion wins even when a daily cap is also exhausted: waiting
 -- for midnight must never pretend lifetime money or unknown holds reset.
 if global_lifetime+p_maximum_usd>b.lifetime_limit_usd or lifetime+p_maximum_usd>p.lifetime_limit_usd then
  raise exception 'Lifetime analysis budget exhausted' using errcode='PT402'; end if;
 if global_daily+p_maximum_usd>b.daily_limit_usd or daily+p_maximum_usd>p.daily_limit_usd then
  raise exception 'Daily analysis budget exhausted' using errcode='PT429'; end if;
 insert into public.reader_content_analysis_calls(job_id,user_id,source_revision,call_key,lease_token,model,maximum_usd)
  values(j.id,j.user_id,j.source_revision,p_call_key,p_lease_token,p_model,p_maximum_usd) returning * into c;
 return jsonb_build_object('claimed',true,'call',to_jsonb(c));
end;
$$;

create function public.record_content_analysis_call_result(p_call_id uuid,p_lease_token uuid,p_result jsonb,p_usage jsonb,p_provider_id text default null,p_actual_usd numeric default null,p_observed_usd numeric default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;
begin
 if p_lease_token is null or p_result is null or p_result='null'::jsonb or octet_length(p_result::text)>500000
  or jsonb_typeof(p_usage) is distinct from 'object' or octet_length(p_usage::text)>20000
  or length(p_provider_id)>300 then raise exception 'Invalid call result' using errcode='PT400'; end if;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if not found or c.lease_token is distinct from p_lease_token then raise exception 'Call reservation changed' using errcode='PT409'; end if;
 -- Settlement takes budget -> policy -> call. Do this before the result-row
 -- lock, including when costs are unknown, so atomic save never inverts order.
 perform public.settle_content_analysis_call(p_call_id,p_actual_usd,p_observed_usd);
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 -- Financial reconciliation may complete after deletion. Never reattach or
 -- restore erased source evidence once the owning job has been removed.
 if c.job_id is null then return to_jsonb(c); end if;
 if c.result is not null then
  if c.result is distinct from p_result or c.usage is distinct from p_usage or c.provider_id is distinct from p_provider_id then
   raise exception 'Call result is immutable' using errcode='PT409'; end if;
  return to_jsonb(c);
 end if;
 update public.reader_content_analysis_calls set result=p_result,usage=p_usage,provider_id=p_provider_id,result_at=clock_timestamp()
  where id=c.id and result is null and lease_token=p_lease_token returning * into c;
 return to_jsonb(c);
end;
$$;

create function public.settle_content_analysis_call(p_call_id uuid,p_actual_usd numeric default null,p_observed_usd numeric default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;
begin
 if (p_actual_usd is not null and (p_actual_usd<0 or p_actual_usd::text in ('NaN','Infinity','-Infinity')))
  or (p_observed_usd is not null and (p_observed_usd<0 or p_observed_usd::text in ('NaN','Infinity','-Infinity'))) then
  raise exception 'Invalid charge' using errcode='PT400'; end if;
 if p_actual_usd is not null then p_actual_usd:=ceil(p_actual_usd*1000000000000)/1000000000000; end if;
 if p_observed_usd is not null then p_observed_usd:=ceil(p_observed_usd*1000000000000)/1000000000000; end if;
 select * into c from public.reader_content_analysis_calls where id=p_call_id;
 if not found then raise exception 'Call unavailable' using errcode='PT409'; end if;
 perform 1 from public.content_analysis_budget where id for update;
 perform 1 from public.reader_content_analysis_policies where user_id=c.user_id for update;
 select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
 if not found then raise exception 'Call unavailable' using errcode='PT409'; end if;
 -- High-water observations cannot be reduced by stale or lower settlements.
 update public.reader_content_analysis_calls set
  observed_usd=case when coalesce(observed_usd,p_observed_usd,p_actual_usd) is null then null else greatest(coalesce(observed_usd,0),coalesce(p_observed_usd,0),coalesce(p_actual_usd,0)) end,
  actual_usd=case when actual_usd is null and p_actual_usd is null then null else greatest(coalesce(actual_usd,0),coalesce(p_actual_usd,0),coalesce(observed_usd,0),coalesce(p_observed_usd,0)) end,
  state=case when actual_usd is not null or p_actual_usd is not null then 'settled' else 'unknown' end,
  settled_at=case when actual_usd is not null or p_actual_usd is not null then clock_timestamp() else null end
  where id=c.id returning * into c;
 return to_jsonb(c);
end;
$$;

create function public.content_analysis_keyword_key(p_label text) returns text
language sql immutable strict security invoker set search_path='' as $$
 select case public.keyword_review_label_key(p_label)
  when 'gpus' then 'gpu' when 'graphics card' then 'gpu' when 'graphics cards' then 'gpu'
  when 'ps1' then 'playstation' when 'ps 1' then 'playstation'
  when 'ps2' then 'playstation 2' when 'ps 2' then 'playstation 2'
  when 'ps4' then 'playstation 4' when 'ps5' then 'playstation 5'
  when 'n64' then 'nintendo 64' when 'vw' then 'volkswagen'
  when 'nvidia rtx 5090' then 'rtx 5090' when 'nvidia rtx pro' then 'rtx pro'
  when 'vw beetle' then 'beetle' else public.keyword_review_label_key(p_label) end;
$$;

-- Merge actual ranges once. This helper never estimates missing timings.
create function public.content_analysis_public_keyword(p_label text,p_ranges jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; merged jsonb:='[]'; lo numeric; hi numeric; seconds numeric:=0; answer jsonb;
begin
 if jsonb_typeof(p_ranges) is distinct from 'array' or jsonb_array_length(p_ranges)>400 then raise exception 'Invalid ranges' using errcode='PT400'; end if;
 for r in select value from jsonb_array_elements(p_ranges) order by (value->>'startSeconds')::numeric,(value->>'endSeconds')::numeric loop
  if jsonb_typeof(r->'startSeconds') is distinct from 'number' or jsonb_typeof(r->'endSeconds') is distinct from 'number'
   or (r->>'startSeconds')::numeric<0 or (r->>'endSeconds')::numeric<=(r->>'startSeconds')::numeric
   or (r->>'endSeconds')::numeric>9007199254740991 then raise exception 'Invalid range' using errcode='PT400'; end if;
  if lo is null then lo:=(r->>'startSeconds')::numeric; hi:=(r->>'endSeconds')::numeric;
  elsif (r->>'startSeconds')::numeric<=hi then hi:=greatest(hi,(r->>'endSeconds')::numeric);
  else merged:=merged||jsonb_build_array(jsonb_build_object('startSeconds',lo,'endSeconds',hi)); seconds:=seconds+hi-lo; lo:=(r->>'startSeconds')::numeric; hi:=(r->>'endSeconds')::numeric;
  end if;
 end loop;
 if lo is not null then merged:=merged||jsonb_build_array(jsonb_build_object('startSeconds',lo,'endSeconds',hi)); seconds:=seconds+hi-lo; end if;
 if jsonb_array_length(merged)>200 then raise exception 'Keyword range capacity' using errcode='PT400'; end if;
 answer:=jsonb_build_object('label',p_label,'ranges',merged);
 if jsonb_array_length(merged)>0 then answer:=answer||jsonb_build_object('seconds',seconds); end if;
 return answer;
end;
$$;

-- Validation repeats the storage-critical subset of the engine's full D25/D28
-- checks. The engine retains UTF16 offsets privately; SQL verifies literal
-- quotations rather than treating JS offsets as PostgreSQL character indices.
create function public.validate_content_analysis_result(p_task text,p_result jsonb,p_record jsonb,p_content_hash text) returns void
language plpgsql security invoker set search_path='' as $$
declare candidate jsonb; point jsonb; quote text; r jsonb; span jsonb; boundary numeric; boundaries numeric[]:='{}';
 cue jsonb; seen text[]:='{}'; k text; coverage_end integer:=0; content_length integer;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>500000
  or p_result->>'state' is null or p_result->>'state' not in ('ready','empty','review')
  or jsonb_typeof(p_result->'patch') is distinct from 'object'
  or jsonb_typeof(p_result->'evidence') is distinct from 'object'
  or jsonb_typeof(p_result->'pending') is distinct from 'array'
  or p_result#>>'{evidence,contentHash}' is distinct from p_content_hash then
  raise exception 'Invalid prepared analysis' using errcode='PT400'; end if;
 -- Engine intervals are UTF16. Compute that length explicitly, including
 -- supplementary code points, instead of confusing bytes/SQL characters.
 select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer into content_length
  from regexp_split_to_table(p_record->>'content','') ch;
 if jsonb_typeof(p_result#>'{evidence,coverage}') is distinct from 'array' then raise exception 'Missing full coverage' using errcode='PT400'; end if;
 for span in select value from jsonb_array_elements(p_result#>'{evidence,coverage}') order by (value->>'start')::integer loop
  if jsonb_typeof(span->'start') is distinct from 'number' or jsonb_typeof(span->'end') is distinct from 'number'
   or (span->>'start')::numeric<>trunc((span->>'start')::numeric) or (span->>'end')::numeric<>trunc((span->>'end')::numeric)
   or (span->>'start')::integer<0 or (span->>'start')::integer>coverage_end
   or (span->>'end')::integer<=(span->>'start')::integer or (span->>'end')::integer>content_length then
   raise exception 'Incomplete source coverage' using errcode='PT400'; end if;
  coverage_end:=greatest(coverage_end,(span->>'end')::integer);
 end loop;
 if coverage_end<>content_length then raise exception 'Incomplete source coverage' using errcode='PT400'; end if;
 for cue in select value from jsonb_array_elements(coalesce(p_record->'transcriptSegments','[]'::jsonb)) loop
  if jsonb_typeof(cue->'startSeconds')='number' then
   boundary:=(cue->>'startSeconds')::numeric; boundaries:=array_append(boundaries,boundary);
   if jsonb_typeof(cue->'durationSeconds')='number' then boundaries:=array_append(boundaries,boundary+(cue->>'durationSeconds')::numeric); end if;
  end if;
 end loop;
 if p_task='summary' then
  if ((p_result->'patch')-array['videoSummary','videoHighlights'])<>'{}'::jsonb
   or p_result#>>'{patch,videoSummary,ruleVersion}' is distinct from 'takeaways-v1'
   or p_result#>>'{patch,videoSummary,status}' is distinct from 'ready'
   or ((p_result#>'{patch,videoSummary}')-array['ruleVersion','status','captionHash','timingBasis'])<>'{}'::jsonb
   or p_result#>>'{patch,videoSummary,captionHash}' is distinct from p_content_hash
   or p_result#>>'{patch,videoSummary,timingBasis}' is null or p_result#>>'{patch,videoSummary,timingBasis}' not in ('captions','none')
   or jsonb_typeof(p_result#>'{patch,videoHighlights}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{patch,videoHighlights}')>6
   or jsonb_typeof(p_result#>'{evidence,selected}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{patch,videoHighlights}')<>jsonb_array_length(p_result#>'{evidence,selected}')
   or jsonb_array_length(p_result->'pending')<>0 or p_result->>'state'='review'
   or ((p_result->>'state'='empty')<>(jsonb_array_length(p_result#>'{patch,videoHighlights}')=0)) then
   raise exception 'Invalid summary fields' using errcode='PT400'; end if;
  for point in select value from jsonb_array_elements(p_result#>'{patch,videoHighlights}') loop
   if jsonb_typeof(point->'text') is distinct from 'string' or length(btrim(point->>'text')) not between 1 and 500
    or array_length(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'),1)>38
    or (point-array['text','startSeconds'])<>'{}'::jsonb then raise exception 'Invalid takeaway' using errcode='PT400'; end if;
   select x into candidate from jsonb_array_elements(p_result#>'{evidence,selected}') x where x->>'text'=point->>'text' and x->'startSeconds' is not distinct from point->'startSeconds' limit 1;
   quote:=candidate->>'evidenceQuote';
   if quote is null or length(btrim(quote)) not between 15 and 1000 or strpos(p_record->>'content',quote)=0 then raise exception 'Ungrounded takeaway' using errcode='PT400'; end if;
   if point ? 'startSeconds' and (jsonb_typeof(point->'startSeconds') is distinct from 'number'
    or not ((point->>'startSeconds')::numeric=any(boundaries))
    or not exists(select 1 from jsonb_array_elements(coalesce(p_record->'transcriptSegments','[]'::jsonb)) s
     where s->'startSeconds'=point->'startSeconds')) then raise exception 'Ungrounded takeaway time' using errcode='PT400'; end if;
  end loop;
 elsif p_task='keywords' then
  if ((p_result->'patch')-'keywordRuleVersion')<>'{}'::jsonb or p_result#>>'{patch,keywordRuleVersion}' is distinct from 'entities-v2'
   or p_result#>>'{evidence,ruleVersion}' is distinct from 'entities-v2'
   or jsonb_typeof(p_result#>'{evidence,accepted}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{evidence,accepted}')+jsonb_array_length(p_result->'pending') not between 1 and 500
   or ((p_result->>'state'='review')<>(jsonb_array_length(p_result->'pending')>0)) then raise exception 'Invalid keyword inventory' using errcode='PT400'; end if;
  for candidate in select value from jsonb_array_elements((p_result#>'{evidence,accepted}')||(p_result->'pending')) loop
   quote:=candidate->>'evidenceQuote'; k:=public.content_analysis_keyword_key(candidate->>'label');
   if jsonb_typeof(candidate->'label') is distinct from 'string' or length(btrim(candidate->>'label')) not between 1 and 100 or candidate->>'label' ~ '[[:cntrl:]]'
    or candidate->>'kind' is null or candidate->>'kind' not in ('brand','product','game','technology','category')
    or quote is null or length(btrim(quote)) not between 1 and 1000 or strpos(p_record->>'content',quote)=0
    or jsonb_typeof(candidate->'reason') is distinct from 'string' or length(btrim(candidate->>'reason')) not between 1 and 2000
    or jsonb_typeof(candidate->'confidence') is distinct from 'number' or (candidate->>'confidence')::numeric<>trunc((candidate->>'confidence')::numeric)
    or (candidate->>'confidence')::integer not between 0 and 100
    or jsonb_typeof(candidate->'ranges') is distinct from 'array' or jsonb_array_length(candidate->'ranges')>200
    or k=any(seen) then raise exception 'Invalid keyword candidate' using errcode='PT400'; end if;
   seen:=array_append(seen,k);
   for r in select value from jsonb_array_elements(candidate->'ranges') loop
    if jsonb_typeof(r->'startSeconds') is distinct from 'number' or jsonb_typeof(r->'endSeconds') is distinct from 'number'
     or (r->>'startSeconds')::numeric<0 or (r->>'endSeconds')::numeric<=(r->>'startSeconds')::numeric
     or not ((r->>'startSeconds')::numeric=any(boundaries)) or not ((r->>'endSeconds')::numeric=any(boundaries))
     or (r-array['startSeconds','endSeconds'])<>'{}'::jsonb then raise exception 'Ungrounded keyword time' using errcode='PT400'; end if;
   end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_result#>'{evidence,accepted}') x where (x->>'confidence')::integer<50) then raise exception 'Low-confidence publication' using errcode='PT400'; end if;
 else raise exception 'Unknown analysis task' using errcode='PT400'; end if;
end;
$$;

create function public.finish_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs;
begin
 if p_lease_token is null then raise exception 'Lease required' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state='prepared' then
  if j.result is distinct from p_result then raise exception 'Prepared result changed' using errcode='PT409'; end if;
  return jsonb_build_object('prepared',true,'jobId',j.id);
 end if;
 if j.state<>'running' then raise exception 'Job not running' using errcode='PT409'; end if;
 perform public.validate_content_analysis_result(j.task,p_result,locked->'record',j.content_hash);
 update public.reader_content_analysis_jobs set state='prepared',result=p_result,updated_at=clock_timestamp()
  where id=j.id and lease_token=p_lease_token and state='running';
 return jsonb_build_object('prepared',true,'jobId',j.id);
end;
$$;
-- Worker-facing alias retained alongside finish for the coordinated interface.
create function public.prepare_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select public.finish_content_analysis_job(p_job_id,p_lease_token,p_result);
$$;

create function public.publish_content_analysis_job(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; rec jsonb; next_record jsonb; proc jsonb;
 candidate jsonb; prior public.admin_keyword_reviews; item jsonb; k text; label text; kind text; ranges jsonb;
 entries jsonb:='{}'; keywords jsonb; topics jsonb; brands jsonb; final_state text; content_state text;
begin
 if p_lease_token is null then raise exception 'Lease required' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state='published' then return true; end if;
 if j.state<>'prepared' or j.result is null then raise exception 'No prepared result' using errcode='PT409'; end if;
 rec:=locked->'record';
 perform public.validate_content_analysis_result(j.task,j.result,rec,j.content_hash);
 next_record:=rec; final_state:=j.result->>'state';
 if j.task='summary' then
  -- Capture the PRE-replacement legacy hash (or explicit unknown) before a
  -- fresh summary replaces the only previous provenance for unchanged labels.
  -- Never confer this summary job's new hash on a separate keyword inventory.
  next_record:=rec||jsonb_build_object('keywordContentHash',public.content_analysis_keyword_provenance(rec),
   'videoSummary',j.result#>'{patch,videoSummary}','videoHighlights',j.result#>'{patch,videoHighlights}');
 else
  -- Archive is locked before review rows. An admin approval/rejection that
  -- won the archive lock is reread here; one that follows us patches our result.
  perform 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash order by q.id for update;
  for candidate in select value from jsonb_array_elements(j.result->'pending') loop
   k:=public.content_analysis_keyword_key(candidate->>'label');
   if not exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash
    and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then
    insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
     values(j.user_id,j.update_id,j.source_id,j.content_hash,candidate->>'label',candidate->>'kind',(candidate->>'confidence')::integer,
      candidate->>'reason',candidate->>'evidenceQuote',candidate->'ranges',coalesce(rec->>'title',''),coalesce(rec->>'url',''))
     on conflict(user_id,update_id,content_hash,normalized_label) do nothing;
   end if;
  end loop;
  for candidate in select value from jsonb_array_elements(j.result#>'{evidence,accepted}') loop
   k:=public.content_analysis_keyword_key(candidate->>'label');
   -- Pending/rejected identities override a model acceptance, including aliases
   -- and admin-corrected names. Do not recreate or resolve an existing review.
   if exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash
    and (public.content_analysis_keyword_key(q.label)=k or public.content_analysis_keyword_key(q.resolved_label)=k)) then continue; end if;
   entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',candidate->>'kind','keyword',public.content_analysis_public_keyword(candidate->>'label',candidate->'ranges')));
  end loop;
  -- Every approved decision for this hash survives, even if neither new pass
  -- rediscovered it. Corrected labels/types and current merged ranges win.
  for prior in select q.* from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='approved' order by q.updated_at,q.id loop
   label:=prior.resolved_label; kind:=prior.resolved_kind; k:=public.content_analysis_keyword_key(label); ranges:=prior.proposed_ranges;
   for item in select value from jsonb_array_elements(coalesce(rec->'videoKeywords','[]'::jsonb)) loop
    if (public.content_analysis_keyword_provenance(rec)#>>'{}')=j.content_hash
     and public.content_analysis_keyword_key(item->>'label') in (k,public.content_analysis_keyword_key(prior.label)) then ranges:=ranges||coalesce(item->'ranges','[]'::jsonb); end if;
   end loop;
   entries:=entries-public.content_analysis_keyword_key(prior.label);
   entries:=jsonb_set(entries,array[k],jsonb_build_object('kind',kind,'keyword',public.content_analysis_public_keyword(label,ranges)));
  end loop;
  -- A later explicit rejection also fences a prior corrected alias.
  for prior in select q.* from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='rejected' loop
   entries:=entries-public.content_analysis_keyword_key(prior.label)-coalesce(public.content_analysis_keyword_key(prior.resolved_label),'');
  end loop;
  if (select count(*) from jsonb_each(entries))>500 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
  select coalesce(jsonb_agg(value->'keyword' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
   coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key),'[]'::jsonb),
   coalesce(jsonb_agg(value#>'{keyword,label}' order by coalesce((value#>>'{keyword,seconds}')::numeric,-1) desc,key) filter(where value->>'kind' in ('brand','product','game')),'[]'::jsonb)
   into keywords,topics,brands from jsonb_each(entries);
  next_record:=rec||jsonb_build_object('topics',topics,'brands',brands,'keywordRuleVersion','entities-v2','keywordContentHash',j.content_hash);
  if rec->>'format'='video' then next_record:=next_record||jsonb_build_object('videoKeywords',keywords); end if;
  final_state:=case when exists(select 1 from public.admin_keyword_reviews q where q.user_id=j.user_id and q.update_id=j.update_id and q.content_hash=j.content_hash and q.status='pending') then 'review'
   when jsonb_array_length(topics)=0 then 'empty' else 'ready' end;
 end if;
 proc:=public.content_analysis_processing(rec,j.content_hash);
 content_state:=case when j.result#>>'{evidence,sourceContentState}'='partial' then 'partial' else proc->>'content' end;
 proc:=(proc-'reason')||jsonb_build_object('content',content_state,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(final_state));
 next_record:=next_record||jsonb_build_object('processing',proc);
 -- DB CAS over the LOCKED LATEST record. No caller record replacement/upsert;
 -- preserve new records, originals, unrelated annotations, media and workspace.
 update public.reader_source_updates set record=next_record where user_id=j.user_id and id=j.update_id and record=rec;
 if not found then raise exception 'Archive changed' using errcode='PT409'; end if;
 update public.reader_content_analysis_jobs set state='published',published_at=clock_timestamp(),updated_at=clock_timestamp(),error_code=null where id=j.id and lease_token=p_lease_token;
 return true;
end;
$$;

-- Preserve the existing D28 validator/CAS/decision audit implementation. The
-- wrapper acquires workspace SHARE before its archive/review locks, then only
-- synchronizes keyword annotations/status after the original decision succeeds.
alter function public.admin_review_keyword(uuid,timestamptz,text,text,text,text) rename to admin_review_keyword_before_content_processing;
revoke all on function public.admin_review_keyword_before_content_processing(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_review_keyword_before_content_processing(uuid,timestamptz,text,text,text,text) to service_role;
create or replace function public.admin_review_keyword_before_content_processing(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_label text,p_kind text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare candidate public.admin_keyword_reviews; archive public.reader_source_updates; result public.admin_keyword_reviews;
 effective_kind text; cleaned text; key text; old_key text; item jsonb; base_keyword jsonb; next_record jsonb;
 keywords jsonb := '[]'; topics jsonb := '[]'; brands jsonb := '[]'; ranges jsonb := '[]'; merged_ranges jsonb := '[]';
 range_start double precision; range_end double precision; duration double precision := 0;
 keyword_position integer; current_position integer := 0;
begin
 cleaned := btrim(regexp_replace(p_label,'[[:space:]]+',' ','g'));
 if p_id is null or p_expected is null or p_admin is null or char_length(p_admin) not between 1 and 200
   or p_decision is null or p_decision not in ('approve','reject') or cleaned is null or char_length(cleaned) not between 1 and 100 or cleaned ~ '[[:cntrl:]]' then
  raise exception 'Invalid review decision' using errcode='PT400';
 end if;
 -- This first read identifies locks only; every candidate field is read again under lock.
 select * into candidate from public.admin_keyword_reviews q where q.id=p_id;
 if candidate.id is null then raise exception 'Review no longer exists' using errcode='PT409'; end if;
 perform 1 from public.reader_workspaces w where w.user_id=candidate.user_id for key share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409'; end if;
 select * into archive from public.reader_source_updates a where a.user_id=candidate.user_id and a.id=candidate.update_id for update;
 if archive.id is null then raise exception 'Source update no longer exists' using errcode='PT409'; end if;
 select * into candidate from public.admin_keyword_reviews q where q.id=p_id for update;
 if candidate.id is null or candidate.status<>'pending' or candidate.updated_at<>p_expected
   or candidate.user_id<>archive.user_id or candidate.update_id<>archive.id or candidate.source_id<>archive.source_id then
  raise exception 'Review changed; reload before saving' using errcode='PT409';
 end if;
 if jsonb_typeof(archive.record->'content') is distinct from 'string'
   or candidate.content_hash is distinct from encode(sha256(convert_to(archive.record->>'content','UTF8')),'hex') then
  raise exception 'Source content changed; review fresh evidence' using errcode='PT409';
 end if;
 effective_kind := coalesce(p_kind,candidate.kind);
 if effective_kind not in ('brand','product','game','technology','category') then raise exception 'Invalid keyword type' using errcode='PT400'; end if;
 if p_decision='approve' then
  key := public.keyword_review_label_key(cleaned); old_key := public.keyword_review_label_key(candidate.label);
  next_record := archive.record;
  if (next_record ? 'videoKeywords' and jsonb_typeof(next_record->'videoKeywords') is distinct from 'array')
    or (next_record ? 'topics' and jsonb_typeof(next_record->'topics') is distinct from 'array')
    or (next_record ? 'brands' and jsonb_typeof(next_record->'brands') is distinct from 'array') then
   raise exception 'Archive keyword fields changed; reload' using errcode='PT409';
  end if;
  ranges := candidate.proposed_ranges;
  for item in select value from jsonb_array_elements(coalesce(next_record->'videoKeywords','[]'::jsonb)) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'label') is distinct from 'string' or jsonb_typeof(item->'ranges') is distinct from 'array' then
    raise exception 'Archive keyword fields changed; reload' using errcode='PT409';
   end if;
   if public.keyword_review_label_key(item->>'label') in (key,old_key) then
    if base_keyword is null then base_keyword := item; keyword_position := current_position; end if;
    -- A current decision cannot inherit timing from an old/unknown batch.
    if (public.content_analysis_keyword_provenance(archive.record)#>>'{}')=candidate.content_hash then
     ranges := ranges || (item->'ranges');
    end if;
   else
    keywords := keywords || jsonb_build_array(item); current_position := current_position+1;
   end if;
  end loop;
  -- Union overlapping ranges, so a corrected label never double-counts duration.
  for item in select value from jsonb_array_elements(ranges) order by (value->>'startSeconds')::double precision,(value->>'endSeconds')::double precision loop
   if jsonb_typeof(item->'startSeconds') is distinct from 'number' or jsonb_typeof(item->'endSeconds') is distinct from 'number'
     or (item->>'startSeconds')::double precision<0 or (item->>'endSeconds')::double precision<=(item->>'startSeconds')::double precision then
    raise exception 'Archive keyword timing changed; reload' using errcode='PT409';
   end if;
   if range_start is null then range_start := (item->>'startSeconds')::double precision; range_end := (item->>'endSeconds')::double precision;
   elsif (item->>'startSeconds')::double precision<=range_end then range_end := greatest(range_end,(item->>'endSeconds')::double precision);
   else
    merged_ranges := merged_ranges || jsonb_build_array(jsonb_build_object('startSeconds',range_start,'endSeconds',range_end)); duration := duration+range_end-range_start;
    range_start := (item->>'startSeconds')::double precision; range_end := (item->>'endSeconds')::double precision;
   end if;
  end loop;
  if range_start is not null then merged_ranges := merged_ranges || jsonb_build_array(jsonb_build_object('startSeconds',range_start,'endSeconds',range_end)); duration := duration+range_end-range_start; end if;
  if jsonb_array_length(merged_ranges)>200 then raise exception 'Too many keyword ranges' using errcode='PT400'; end if;
  base_keyword := (coalesce(base_keyword,'{}'::jsonb)-'seconds') || jsonb_build_object('label',cleaned,'ranges',merged_ranges);
  if jsonb_array_length(merged_ranges)>0 then base_keyword := base_keyword || jsonb_build_object('seconds',duration); end if;
  -- Retain existing entry order, replacing all aliases with one merged object.
  select coalesce(jsonb_agg(value order by position),'[]'::jsonb) into keywords from (
   select value,ordinality::double precision as position from jsonb_array_elements(keywords) with ordinality
   union all select base_keyword,coalesce(keyword_position,jsonb_array_length(keywords))::double precision+0.5
  ) entries;
  for item in select value from jsonb_array_elements(coalesce(next_record->'topics','[]'::jsonb)) loop
   if jsonb_typeof(item) is distinct from 'string' then raise exception 'Archive topic fields changed; reload' using errcode='PT409'; end if;
   if public.keyword_review_label_key(item#>>'{}') not in (key,old_key) then topics := topics || jsonb_build_array(item); end if;
  end loop;
  topics := topics || jsonb_build_array(cleaned);
  if jsonb_array_length(keywords)>500 or jsonb_array_length(topics)>1000 then raise exception 'Keyword capacity reached' using errcode='PT400'; end if;
  next_record := next_record || jsonb_build_object('topics',topics);
  if next_record->>'format'='video' then next_record := next_record || jsonb_build_object('videoKeywords',keywords); end if;
  if effective_kind in ('brand','product','game') then
   for item in select value from jsonb_array_elements(coalesce(next_record->'brands','[]'::jsonb)) loop
    if jsonb_typeof(item) is distinct from 'string' then raise exception 'Archive brand fields changed; reload' using errcode='PT409'; end if;
    if public.keyword_review_label_key(item#>>'{}') not in (key,old_key) then brands := brands || jsonb_build_array(item); end if;
   end loop;
   brands := brands || jsonb_build_array(cleaned);
   if jsonb_array_length(brands)>1000 then raise exception 'Brand capacity reached' using errcode='PT400'; end if;
   next_record := next_record || jsonb_build_object('brands',brands);
  else
   select coalesce(jsonb_agg(value),'[]'::jsonb) into brands from jsonb_array_elements(coalesce(next_record->'brands','[]'::jsonb)) b where public.keyword_review_label_key(b.value#>>'{}') not in (key,old_key);
   next_record := next_record || jsonb_build_object('brands',brands);
  end if;
  update public.reader_source_updates set record=next_record where user_id=archive.user_id and id=archive.id;
 end if;
 update public.admin_keyword_reviews set status=case when p_decision='approve' then 'approved' else 'rejected' end,resolved_label=cleaned,resolved_kind=effective_kind
  where id=candidate.id and status='pending' and updated_at=p_expected returning * into result;
 if result.id is null then raise exception 'Review changed; reload before saving' using errcode='PT409'; end if;
 begin
  insert into public.admin_audit_events(admin_id,action,target_id,details)
   values(p_admin,case when p_decision='approve' then 'keyword.approved' else 'keyword.rejected' end,result.id::text,jsonb_build_object('kind',result.resolved_kind));
 exception when others then
  raise exception 'Audit unavailable; review not saved' using errcode='PT503';
 end;
 return to_jsonb(result)-'normalized_label';
end;
$$;
create function public.admin_review_keyword(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_label text,p_kind text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.admin_keyword_reviews; decided jsonb; a public.reader_source_updates; h text; proc jsonb; next_record jsonb; keyword_state text; prior_keyword_provenance jsonb;
begin
 select * into candidate from public.admin_keyword_reviews where id=p_id;
 if not found then raise exception 'Review no longer exists' using errcode='PT409'; end if;
 perform 1 from public.reader_workspaces where user_id=candidate.user_id for share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409'; end if;
 -- Freeze the whole batch BEFORE a single decision patches one identity.
 -- Neither approving one name nor rejecting a candidate verifies other labels.
 select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id for update;
 if not found then raise exception 'Source update no longer exists' using errcode='PT409'; end if;
 prior_keyword_provenance:=public.content_analysis_keyword_provenance(a.record);
 decided:=public.admin_review_keyword_before_content_processing(p_id,p_expected,p_admin,p_decision,p_label,p_kind);
 -- The inner RPC already holds this archive UPDATE lock and checks its exact
 -- current content hash before approving/rejecting. Never upsert missing rows.
 select * into a from public.reader_source_updates where user_id=candidate.user_id and id=candidate.update_id;
 if not found then raise exception 'Source update no longer exists' using errcode='PT409'; end if;
 h:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex');
 next_record:=a.record||jsonb_build_object('keywordContentHash',prior_keyword_provenance);
 if a.record#>>'{processing,contentHash}'=h and a.record#>>'{processing,keywords}'='review' then
  keyword_state:=case when (prior_keyword_provenance#>>'{}') is distinct from h then 'pending'
   when exists(select 1 from public.admin_keyword_reviews q where q.user_id=a.user_id and q.update_id=a.id and q.content_hash=h and q.status='pending') then 'review'
   when jsonb_array_length(case when a.record->>'format'='video' then coalesce(a.record->'videoKeywords','[]'::jsonb) else coalesce(a.record->'topics','[]'::jsonb) end)>0 then 'ready' else 'empty' end;
  proc:=jsonb_set(a.record->'processing','{keywords}',to_jsonb(keyword_state))||jsonb_build_object('updatedAt',clock_timestamp());
  next_record:=next_record||jsonb_build_object('processing',proc);
 end if;
 update public.reader_source_updates set record=next_record where user_id=a.user_id and id=a.id and record=a.record;
 if not found then raise exception 'Archive changed' using errcode='PT409'; end if;
 -- The lightweight owner poll sees the decision without reading private review
 -- quotes or requiring a new model pass. All same-archive work serializes on
 -- the archive lock acquired by the original RPC before any job/review locks.
 update public.reader_content_analysis_jobs set updated_at=clock_timestamp()
  where user_id=a.user_id and update_id=a.id and content_hash=h and task='keywords' and state='published';
 return decided;
end;
$$;

create function public.fail_content_analysis_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false,p_yield boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare locked jsonb; j public.reader_content_analysis_jobs; state_name text; rec jsonb; proc jsonb;
begin
 if p_lease_token is null or p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' or p_retryable is null or p_yield is null then raise exception 'Invalid failure' using errcode='PT400'; end if;
 locked:=public.lock_content_analysis_job(p_job_id,p_lease_token);
 select * into j from jsonb_populate_record(null::public.reader_content_analysis_jobs,locked->'job');
 if j.state not in ('running','prepared') then raise exception 'Job not active' using errcode='PT409'; end if;
 state_name:=case when p_yield then 'queued'
  when p_error_code in ('analysis_budget_exhausted','analysis_daily_budget_exhausted','analysis_call_limit','analysis_unknown_charge_hold','analysis_cached_input_changed','analysis_credentials_required','analysis_runtime_disabled','analysis_pricing_unverified','analysis_pricing_not_verified','analysis_configuration_required','analysis_provider_not_verified','analysis_gateway_not_verified','analysis_model_policy_mismatch','analysis_input_limit') then 'blocked'
  else 'failed' end;
 update public.reader_content_analysis_jobs set state=state_name,error_code=p_error_code,lease_token=null,lease_until=null,
  next_attempt_at=case when p_yield then clock_timestamp()+interval '1 second'
   when p_error_code='analysis_daily_budget_exhausted' then (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'
   when state_name='failed' and p_retryable and attempts<3 then clock_timestamp()+interval '1 minute' else 'infinity'::timestamptz end,
  attempts=greatest(0,attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end),updated_at=clock_timestamp() where id=j.id;
 rec:=locked->'record';
 proc:=public.content_analysis_processing(rec,j.content_hash);
 proc:=proc||jsonb_build_object('reason',p_error_code,'updatedAt',clock_timestamp());
 proc:=jsonb_set(proc,array[case when j.task='summary' then 'recap' else 'keywords' end],to_jsonb(case when p_yield then 'pending' else state_name end));
 update public.reader_source_updates set record=rec||jsonb_build_object('processing',proc) where user_id=j.user_id and id=j.update_id and record=rec;
 return jsonb_build_object('failed',not p_yield,'jobId',j.id,'state',state_name);
end;
$$;

-- These narrowly scoped trigger functions invalidate private analysis only.
-- They run for owner workspace changes/deletes without granting queue privileges.
create function public.invalidate_content_analysis_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.content_analysis_source_revision(new.record) is distinct from public.content_analysis_source_revision(old.record) then
  update public.reader_content_analysis_jobs set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='source_changed',updated_at=clock_timestamp()
   where user_id=old.user_id and update_id=old.id;
 end if;
 return new;
end;
$$;
create trigger content_analysis_source_changed after update on public.reader_source_updates for each row execute function public.invalidate_content_analysis_source();
create function public.invalidate_content_analysis_follow() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.reader_content_analysis_jobs j set state='cancelled',lease_token=null,lease_until=null,result=null,error_code='follow_changed',updated_at=clock_timestamp()
  where j.user_id=new.user_id and (not coalesce(new.state->'followedSourceIds' ? j.source_id,false)
   or j.source_fingerprint is distinct from public.content_analysis_source_fingerprint(new.state,j.source_id)
   or exists(select 1 from public.reader_source_updates a where a.user_id=j.user_id and a.id=j.update_id and not coalesce(public.content_analysis_eligible(new.state,a.record),false)));
 return new;
end;
$$;
create trigger content_analysis_follow_changed after update on public.reader_workspaces for each row execute function public.invalidate_content_analysis_follow();

create function public.erase_content_analysis_call_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- BEFORE the job FK sets job_id NULL, remove its source-bearing cache while
 -- keeping cost/usage/provider accounting and every unknown financial hold.
 update public.reader_content_analysis_calls set result=null,result_at=null where job_id=old.id;
 return old;
end;
$$;
create trigger content_analysis_job_evidence_deleted before delete on public.reader_content_analysis_jobs for each row execute function public.erase_content_analysis_call_evidence();

revoke all on function public.content_analysis_source_revision(jsonb),public.content_analysis_source_fingerprint(jsonb,text),public.content_analysis_eligible(jsonb,jsonb),public.content_analysis_processing(jsonb,text),public.content_analysis_keyword_provenance(jsonb),
 public.sync_content_analysis_jobs(text,integer,text),public.lock_content_analysis_job(uuid,uuid),public.claim_content_analysis_job(text,integer),
 public.reserve_content_analysis_call(uuid,uuid,text,numeric,text),public.settle_content_analysis_call(uuid,numeric,numeric),
 public.record_content_analysis_call_result(uuid,uuid,jsonb,jsonb,text,numeric,numeric),public.content_analysis_keyword_key(text),public.content_analysis_public_keyword(text,jsonb),
 public.validate_content_analysis_result(text,jsonb,jsonb,text),public.finish_content_analysis_job(uuid,uuid,jsonb),public.prepare_content_analysis_job(uuid,uuid,jsonb),
 public.publish_content_analysis_job(uuid,uuid),public.admin_review_keyword(uuid,timestamptz,text,text,text,text),public.fail_content_analysis_job(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.content_analysis_source_revision(jsonb),public.content_analysis_source_fingerprint(jsonb,text),public.content_analysis_eligible(jsonb,jsonb),public.content_analysis_processing(jsonb,text),public.content_analysis_keyword_provenance(jsonb),
 public.sync_content_analysis_jobs(text,integer,text),public.lock_content_analysis_job(uuid,uuid),public.claim_content_analysis_job(text,integer),
 public.reserve_content_analysis_call(uuid,uuid,text,numeric,text),public.settle_content_analysis_call(uuid,numeric,numeric),
 public.record_content_analysis_call_result(uuid,uuid,jsonb,jsonb,text,numeric,numeric),public.content_analysis_keyword_key(text),public.content_analysis_public_keyword(text,jsonb),
 public.validate_content_analysis_result(text,jsonb,jsonb,text),public.finish_content_analysis_job(uuid,uuid,jsonb),public.prepare_content_analysis_job(uuid,uuid,jsonb),
 public.publish_content_analysis_job(uuid,uuid),public.admin_review_keyword(uuid,timestamptz,text,text,text,text),public.fail_content_analysis_job(uuid,uuid,text,boolean,boolean) to service_role;
revoke all on function public.invalidate_content_analysis_source(),public.invalidate_content_analysis_follow(),public.erase_content_analysis_call_evidence() from public,anon,authenticated,service_role;
comment on table public.reader_content_analysis_calls is 'Private per-call result cache and conservative USD commitments. Unknown actual charges retain the maximum hold across days, failed jobs, unfollows and deletion. SDK usage alone is not an invoice.';
comment on table public.reader_content_analysis_jobs is 'Private independent summary/keywords leases keyed by owner/update/exact UTF8 content hash/content-v1/task. Prepared output and evidence are private. No policy/runtime activated by migration.';
commit;
