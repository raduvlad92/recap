-- Persisted private daily snapshots of already approved findings. No provider,
-- model or email is called, and the global dispatcher remains disabled.
begin;
create table public.daily_briefing_control (
 id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.daily_briefing_control(id,enabled)values(true,false);
create table public.daily_briefing_schedules (
 reader_id text primary key references public.reader_workspaces(user_id)on delete cascade,
 enabled boolean not null default true,generation uuid not null default gen_random_uuid(),
 starts_at timestamptz not null default clock_timestamp(),settings_changed_at timestamptz not null default clock_timestamp(),
 last_cutoff_at timestamptz,last_local_date date,
 created_at timestamptz not null default clock_timestamp()
);
create table public.daily_briefings (
 id uuid primary key default gen_random_uuid(),reader_id text not null references public.reader_workspaces(user_id)on delete cascade,
 local_date date not null,period_start timestamptz not null,cutoff_at timestamptz not null,
 status text not null check(status in('ready','partial','quiet','awaiting_review','deleted')),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'and octet_length(snapshot::text)<=2000000),
 workspace_revision timestamptz not null,generation uuid not null,
 created_at timestamptz not null default clock_timestamp(),published_at timestamptz,deleted_at timestamptz,
 unique(reader_id,local_date),check(period_start<cutoff_at),
 check((status='deleted'and deleted_at is not null and snapshot='{}'::jsonb)or(status<>'deleted'and deleted_at is null))
);
create index daily_briefings_reader_history on public.daily_briefings(reader_id,local_date desc)where deleted_at is null;
create table public.daily_briefing_jobs (
 id uuid primary key default gen_random_uuid(),reader_id text not null references public.daily_briefing_schedules(reader_id)on delete cascade,
 local_date date not null,period_start timestamptz not null,cutoff_at timestamptz not null,
 generation uuid not null,workspace_revision timestamptz not null,
 input jsonb not null check(jsonb_typeof(input)='object'and octet_length(input::text)<=2000000),
 state text not null default'running'check(state in('running','finished','failed','cancelled')),
 lease_token uuid,lease_until timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(reader_id,local_date),
 check((state='running'and lease_token is not null and lease_until is not null)or(state<>'running'and lease_token is null and lease_until is null))
);
create table public.daily_briefing_consumed_findings (
 reader_id text not null references public.reader_workspaces(user_id)on delete cascade,
 finding_key text not null check(finding_key~'^[a-f0-9]{64}$'),
 briefing_id uuid not null references public.daily_briefings(id)on delete cascade,
 primary key(reader_id,finding_key)
);
create index daily_briefing_failed_carryforward on public.daily_briefing_jobs(reader_id,generation)where state='failed';
alter table public.daily_briefing_control enable row level security;
alter table public.daily_briefing_schedules enable row level security;
alter table public.daily_briefings enable row level security;
alter table public.daily_briefing_jobs enable row level security;
alter table public.daily_briefing_consumed_findings enable row level security;
revoke all on public.daily_briefing_control,public.daily_briefing_schedules,public.daily_briefings,public.daily_briefing_jobs,public.daily_briefing_consumed_findings from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.daily_briefing_control,public.daily_briefing_schedules,public.daily_briefings,public.daily_briefing_jobs,public.daily_briefing_consumed_findings to service_role;
grant select on public.daily_briefings to authenticated;
create policy daily_briefings_own_read on public.daily_briefings for select to authenticated using((select auth.jwt()->>'sub')=reader_id and deleted_at is null);

create function public.daily_briefing_input(p_reader_id text,p_period_start timestamptz,p_cutoff_at timestamptz,p_local_date date)
returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare w public.reader_workspaces;s public.daily_briefing_schedules;source jsonb;item jsonb;a public.reader_source_updates;
 c public.reader_collection_checks;social public.social_collection_jobs;points jsonb;entry jsonb;finding jsonb;findings jsonb;state text;
 sources jsonb:='[]';updates jsonb:='[]';h text;key text;name text;usable boolean;published boolean;omitted integer:=0;seen integer:=0;
begin
 select*into w from public.reader_workspaces where user_id=p_reader_id;
 select*into s from public.daily_briefing_schedules where reader_id=p_reader_id;
 for source in select value from jsonb_array_elements(coalesce(w.state->'customSources','[]'))
  where coalesce(w.state->'followedSourceIds','[]')?(value->>'id')and value->>'status'is distinct from'sample'order by value->>'id'loop
  name:=left(coalesce(nullif(source->>'name',''),'Source'),160);state:='unknown';c:=null;social:=null;
  select*into c from public.reader_collection_checks where user_id=p_reader_id and source_id=source->>'id'
   and finished_at<=p_cutoff_at order by finished_at desc,id desc limit 1;
  if source->>'platform'in('X','Instagram','LinkedIn')then
   select*into social from public.social_collection_jobs where source_key=public.social_source_key(source->>'platform',source->>'url')
    and purpose='collection'and finished_at<=p_cutoff_at and state in('completed','failed')order by finished_at desc,id desc limit 1;
  end if;
  if social.id is not null and(c.id is null or social.finished_at>c.finished_at)then
   if social.finished_at<p_cutoff_at-interval'6 hours'then state:='unknown';
   elsif social.state='failed'then state:='failed';
   elsif social.coverage->'complete'='true'::jsonb and social.coverage->>'status'in('checked','complete','unchanged')then state:='checked';
   elsif social.coverage->>'status'='blocked'then state:='blocked';
   elsif social.coverage->>'status'='failed'then state:='failed';
   elsif social.coverage->>'status'='partial'then state:='partial';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',source->>'id','sourceName',name,'platform',source->>'platform',
    'state',state,'checkedAt',social.finished_at,'reason',coalesce(social.error_code,social.coverage->>'reason',case when state<>'checked'then'discovery_completeness_unverified'end)));
  else
   if c.finished_at>=p_cutoff_at-interval'6 hours'then
    state:=case when c.status in('unchanged','collected')then'checked'when c.status='partial'then'partial'when c.status='blocked'then'blocked'when c.status in('failed','abandoned')then'failed'else'unknown'end;
   end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',source->>'id','sourceName',name,'platform',source->>'platform',
    'state',state,'checkedAt',c.finished_at,'reason',coalesce(c.error_code,case when state='unknown'then'fresh_source_check_unavailable'end)));
  end if;
 end loop;
 for a in select q.*from public.reader_source_updates q where q.user_id=p_reader_id and q.published_at<p_cutoff_at
  and(q.published_at>=p_period_start or q.updated_at>=p_period_start or exists(select 1 from public.daily_briefing_jobs old
   where old.reader_id=p_reader_id and old.generation=s.generation and old.state='failed'and old.input->'updates'@>jsonb_build_array(jsonb_build_object('updateId',q.id))))
  and coalesce(w.state->'followedSourceIds','[]')?q.source_id and q.record->'isSample'='false'::jsonb
  and not(q.record->>'format'='video'and coalesce(w.state#>>array['sourcePreferences',q.source_id,'showShorts'],'true')='false'and q.record#>>'{videoFormat,kind}'is distinct from'regular')
  order by q.published_at desc,q.id limit 2001 loop
  seen:=seen+1;if seen>2000 then omitted:=omitted+1;continue;end if;
  select value into source from jsonb_array_elements(coalesce(w.state->'customSources','[]'))where value->>'id'=a.source_id and value->>'status'is distinct from'sample'limit 1;
  if source is null then continue;end if;
  name:=left(coalesce(nullif(source->>'name',''),'Source'),160);
  usable:=jsonb_typeof(a.record->'content')='string'and length(btrim(a.record->>'content'))>0 and a.record->>'contentKind'in('transcript','feed_text');
  h:=case when usable then encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')end;
  published:=usable and a.record#>>'{videoSummary,status}'='ready'and a.record#>>'{videoSummary,captionHash}'=h
   and((a.record#>>'{keywordApprovals,contentHash}'=h and jsonb_array_length(coalesce(a.record#>'{keywordApprovals,labels}','[]'))>0)
    or(coalesce(a.record->>'keywordContentHash',a.record#>>'{videoSummary,captionHash}')=h and jsonb_array_length(coalesce(a.record->'videoKeywords','[]'))>0));
  findings:='[]';
  if published then
   for entry in select jsonb_build_object('reviewId',r.id,'point',p.value)from public.admin_analysis_reviews r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.resolved->'highlights')='array'then r.resolved->'highlights'else'[]'end)p
    where r.user_id=p_reader_id and r.update_id=a.id and r.source_id=a.source_id and r.kind='recap'and r.status='approved'and r.content_hash=h
    and r.updated_at<=p_cutoff_at order by r.updated_at,r.id loop
    finding:=entry->'point';key:=encode(sha256(convert_to(a.id||chr(10)||h||chr(10)||btrim(finding->>'text'),'UTF8')),'hex');
    if jsonb_typeof(finding->'text')is distinct from'string'or char_length(btrim(finding->>'text'))not between 1 and 500
     or array_length(regexp_split_to_array(btrim(finding->>'text'),'[[:space:]]+'),1)>38
     or jsonb_typeof(finding->'evidenceQuote')is distinct from'string'or length(btrim(finding->>'evidenceQuote'))not between 15 and 1000
     or strpos(a.record->>'content',finding->>'evidenceQuote')=0
     or not exists(select 1 from jsonb_array_elements(coalesce(a.record->'videoHighlights','[]'))v where btrim(v->>'text')=btrim(finding->>'text'))
     or exists(select 1 from public.daily_briefing_consumed_findings f where f.reader_id=p_reader_id and f.finding_key=key)
     or exists(select 1 from jsonb_array_elements(findings)f where f#>>'{citation,findingKey}'=key)then continue;end if;
    findings:=findings||jsonb_build_array(jsonb_build_object('text',btrim(finding->>'text'),'citation',jsonb_build_object(
     'updateId',a.id,'sourceId',a.source_id,'sourceName',name,'title',left(coalesce(a.record->>'title','Update'),500),'url',a.record->>'url',
     'publishedAt',a.published_at,'contentHash',h,'evidenceQuote',finding->>'evidenceQuote','reviewId',entry->>'reviewId','findingKey',key,'lateArrival',a.published_at<p_period_start)));
   end loop;
  end if;
  -- Old material already briefed is not relabeled pending after an unrelated
  -- keyword/metadata refresh. Newly approved findings have different keys.
  if published and findings='[]'::jsonb and a.published_at<p_period_start then continue;end if;
  item:=jsonb_build_object('updateId',a.id,'sourceId',a.source_id,'sourceName',name,
   'title',left(coalesce(a.record->>'title','Update'),500),'url',a.record->>'url','publishedAt',a.published_at,
   'state',case when not usable then'content_missing'when findings='[]'::jsonb then'awaiting_review'else'available'end,
   'lateArrival',a.published_at<p_period_start,'topics',coalesce((select jsonb_agg(t)from jsonb_array_elements(case when jsonb_typeof(a.record->'topics')='array'then a.record->'topics'else'[]'end)t where jsonb_typeof(t)='string'and length(btrim(t#>>'{}'))between 1 and 200),'[]'),'findings',findings);
  if octet_length(updates::text)+octet_length(item::text)>1500000 then omitted:=omitted+1;else updates:=updates||jsonb_build_array(item);end if;
 end loop;
 return jsonb_build_object('settings',w.state->'settings','localDate',p_local_date,'periodStart',p_period_start,'cutoffAt',p_cutoff_at,
  'sources',sources,'updates',updates,'omittedUpdates',omitted,'missedCycles',case when s.last_local_date is null then 0 else greatest(0,p_local_date-s.last_local_date-1)end);
end;$$;

create function public.fail_daily_briefing(p_job_id uuid,p_lease_token uuid,p_error_code text)
returns boolean language plpgsql security invoker set search_path=''as $$
declare j public.daily_briefing_jobs;s public.daily_briefing_schedules;settings jsonb;inventory jsonb;source_count integer;checked integer;missing integer;snapshot jsonb;
begin
 if p_error_code is null or p_error_code!~'^[a-z][a-z0-9_]{0,79}$'then raise exception'Invalid daily failure reason'using errcode='PT400';end if;
 select*into j from public.daily_briefing_jobs where id=p_job_id;if j.id is null then return false;end if;
 perform 1 from public.reader_workspaces where user_id=j.reader_id for key share;if not found then return false;end if;
 select*into s from public.daily_briefing_schedules where reader_id=j.reader_id for update;
 select*into j from public.daily_briefing_jobs where id=p_job_id for update;
 if s.reader_id is null or not s.enabled or s.generation<>j.generation or j.state<>'running'or j.lease_token is distinct from p_lease_token then return false;end if;
 settings:=j.input->'settings';
 select coalesce(jsonb_agg((u-array['topics','findings'])||jsonb_build_object('state',case when u->>'state'='content_missing'then'content_missing'else'awaiting_review'end)),'[]')into inventory from jsonb_array_elements(j.input->'updates')u;
 source_count:=jsonb_array_length(j.input->'sources');select count(*)into checked from jsonb_array_elements(j.input->'sources')src where src->>'state'='checked';
 select count(*)into missing from jsonb_array_elements(inventory)u where u->>'state'='content_missing';
 snapshot:=jsonb_build_object('version',1,'mode','approved_findings','languageMode','original_approved_wording','localDate',j.local_date,'periodStart',j.period_start,'cutoffAt',j.cutoff_at,
  'timezone',settings->'timezone','deliveryTime',settings->'deliveryTime','recapLanguage',settings->'recapLanguage','interfaceLanguage',settings->'interfaceLanguage','interests',settings->'interests','topics','[]'::jsonb,
  'coverage',jsonb_build_object('followedSources',source_count,'checkedSources',checked,'updatedSources',(select count(distinct u->>'sourceId')from jsonb_array_elements(inventory)u),
   'includedUpdates',0,'availableUpdates',jsonb_array_length(inventory),'pendingReviewUpdates',jsonb_array_length(inventory)-missing,'missingContentUpdates',missing,'omittedUpdates',j.input->'omittedUpdates','sources',j.input->'sources'),
  'allUpdates',inventory,'notice','This daily briefing could not be completed safely ('||p_error_code||'). No new wording was published. Source items remain available.','correction',null);
 insert into public.daily_briefings(id,reader_id,local_date,period_start,cutoff_at,status,snapshot,workspace_revision,generation)
  values(j.id,j.reader_id,j.local_date,j.period_start,j.cutoff_at,'awaiting_review',snapshot,j.workspace_revision,j.generation)on conflict(reader_id,local_date)do nothing;
 update public.daily_briefing_jobs set state='failed',lease_token=null,lease_until=null where id=j.id;
 update public.daily_briefing_schedules set last_cutoff_at=greatest(last_cutoff_at,j.cutoff_at),last_local_date=greatest(last_local_date,j.local_date) where reader_id=j.reader_id;
 return true;
end;$$;
revoke all on function public.daily_briefing_input(text,timestamptz,timestamptz,date)from public,anon,authenticated;
grant execute on function public.daily_briefing_input(text,timestamptz,timestamptz,date)to service_role;

create function public.list_daily_briefing_candidates(p_after_reader text default null,p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path=''as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception'Invalid daily candidate limit'using errcode='PT400';end if;
 if not exists(select 1 from public.daily_briefing_control where id and enabled)then return'[]';end if;
 insert into public.daily_briefing_schedules(reader_id)
  select w.user_id from public.reader_workspaces w join public.reader_collection_policies p on p.user_id=w.user_id and p.enabled
  where jsonb_typeof(w.state->'settings')='object'and coalesce(w.state#>>'{settings,deliveryTime}','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
   and exists(select 1 from pg_timezone_names z where z.name=w.state#>>'{settings,timezone}')
   and jsonb_array_length(coalesce(w.state->'followedSourceIds','[]'))>0 on conflict(reader_id)do nothing;
 select coalesce(jsonb_agg(v order by v->>'readerId'),'[]')into result from(
  select jsonb_build_object('readerId',s.reader_id,'generation',s.generation,'workspaceRevision',w.updated_at,'startsAt',s.starts_at,
   'settingsChangedAt',s.settings_changed_at,'lastCutoffAt',s.last_cutoff_at,'lastLocalDate',s.last_local_date,'settings',w.state->'settings')v
  from public.daily_briefing_schedules s join public.reader_workspaces w on w.user_id=s.reader_id
  join public.reader_collection_policies p on p.user_id=w.user_id and p.enabled
  where s.enabled and(p_after_reader is null or s.reader_id>p_after_reader)
  order by s.reader_id limit p_limit
 )rows;return result;
end;$$;

create function public.claim_daily_briefing(p_reader_id text,p_generation uuid,p_workspace_revision timestamptz,p_local_date date,p_cutoff_at timestamptz,p_period_start timestamptz)
returns jsonb language plpgsql security invoker set search_path=''as $$
declare w public.reader_workspaces;s public.daily_briefing_schedules;j public.daily_briefing_jobs;stale public.daily_briefing_jobs;payload jsonb;zone text;
begin
 if p_reader_id is null or p_generation is null or p_workspace_revision is null or p_local_date is null or p_cutoff_at is null or p_period_start is null
  or p_cutoff_at>clock_timestamp()or p_cutoff_at-p_period_start not between interval'20 hours'and interval'28 hours'then
  raise exception'Invalid daily cycle'using errcode='PT400';end if;
 select*into w from public.reader_workspaces where user_id=p_reader_id for key share;
 select*into s from public.daily_briefing_schedules where reader_id=p_reader_id for update;
 if w.user_id is null or s.reader_id is null or not s.enabled or s.generation<>p_generation
  or not exists(select 1 from public.daily_briefing_control where id and enabled)
  or not exists(select 1 from public.reader_collection_policies where user_id=p_reader_id and enabled)then return null;end if;
 -- After an outage, preserve interrupted earlier days as failed snapshots
 -- before the latest cycle selects their unconsumed source findings.
 for stale in select old.*from public.daily_briefing_jobs old
  where old.reader_id=p_reader_id and old.generation=s.generation and old.local_date<p_local_date
   and old.state='running'and old.lease_until<=clock_timestamp()
  order by old.local_date,old.id for update loop
  perform public.fail_daily_briefing(stale.id,stale.lease_token,'daily_interrupted_before_later_cycle');
 end loop;
 if exists(select 1 from public.daily_briefing_jobs old where old.reader_id=p_reader_id and old.generation=s.generation
  and old.local_date<p_local_date and old.state='running')then return null;end if;
 select*into s from public.daily_briefing_schedules where reader_id=p_reader_id;
 -- Existing claims retain their frozen settings even when bookmarks or later
 -- settings change. Atomic reset rotates generation and cancels them.
 select*into j from public.daily_briefing_jobs where reader_id=p_reader_id and local_date=p_local_date for update;
 if j.id is not null then
  if j.state<>'running'or j.generation<>s.generation or j.lease_until>clock_timestamp()then return null;end if;
  update public.daily_briefing_jobs set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'5 minutes'where id=j.id returning*into j;
  return jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'input',j.input);
 end if;
 zone:=w.state#>>'{settings,timezone}';
 if w.updated_at<>p_workspace_revision or p_cutoff_at<greatest(s.starts_at,s.settings_changed_at)
  or p_local_date<>(p_cutoff_at at time zone zone)::date
  or(s.last_local_date is not null and p_local_date<=s.last_local_date)
  or(s.last_cutoff_at is not null and p_cutoff_at<s.last_cutoff_at+interval'20 hours')
  or exists(select 1 from public.daily_briefings where reader_id=p_reader_id and local_date=p_local_date)then return null;end if;
 payload:=public.daily_briefing_input(p_reader_id,p_period_start,p_cutoff_at,p_local_date);
 insert into public.daily_briefing_jobs(reader_id,local_date,period_start,cutoff_at,generation,workspace_revision,input,lease_token,lease_until)
  values(p_reader_id,p_local_date,p_period_start,p_cutoff_at,s.generation,w.updated_at,payload,gen_random_uuid(),clock_timestamp()+interval'5 minutes')returning*into j;
 return jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'input',j.input);
end;$$;

create function public.finish_daily_briefing(p_job_id uuid,p_lease_token uuid,p_status text,p_snapshot jsonb,p_finding_keys jsonb)
returns uuid language plpgsql security invoker set search_path=''as $$
declare j public.daily_briefing_jobs;s public.daily_briefing_schedules;w public.reader_workspaces;b uuid;
 topic jsonb;point jsonb;citation jsonb;item jsonb;update_row jsonb;finding jsonb;expected_keys jsonb;seen_keys text[]:='{}';h text;a public.reader_source_updates;
begin
 if p_job_id is null or p_lease_token is null or p_status is null or p_status not in('ready','partial','quiet','awaiting_review')
  or jsonb_typeof(p_snapshot)is distinct from'object'or octet_length(p_snapshot::text)>2000000
  or jsonb_typeof(p_finding_keys)is distinct from'array'or jsonb_array_length(p_finding_keys)>60000 then raise exception'Invalid daily snapshot'using errcode='PT400';end if;
 select*into j from public.daily_briefing_jobs where id=p_job_id;
 if j.id is null then raise exception'Daily job unavailable'using errcode='PT409';end if;
 select*into w from public.reader_workspaces where user_id=j.reader_id for key share;
 select*into s from public.daily_briefing_schedules where reader_id=j.reader_id for update;
 select*into j from public.daily_briefing_jobs where id=p_job_id for update;
 if w.user_id is null or s.reader_id is null or not s.enabled or j.generation<>s.generation or j.state<>'running'
  or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp()
  or not exists(select 1 from public.daily_briefing_control where id and enabled)then raise exception'Daily claim changed'using errcode='PT409';end if;
 if p_snapshot->'version'is distinct from'1'::jsonb or p_snapshot->>'mode'is distinct from'approved_findings'or p_snapshot->>'languageMode'is distinct from'original_approved_wording'
  or(p_snapshot->>'cutoffAt')::timestamptz is distinct from j.cutoff_at or(p_snapshot->>'periodStart')::timestamptz is distinct from j.period_start
  or(p_snapshot->>'localDate')::date is distinct from j.local_date
  or p_snapshot->>'timezone'is distinct from j.input#>>'{settings,timezone}'or p_snapshot->>'deliveryTime'is distinct from j.input#>>'{settings,deliveryTime}'
  or p_snapshot->>'recapLanguage'is distinct from j.input#>>'{settings,recapLanguage}'or p_snapshot->>'interfaceLanguage'is distinct from j.input#>>'{settings,interfaceLanguage}'
  or p_snapshot->'interests'is distinct from j.input#>'{settings,interests}'
  or jsonb_typeof(p_snapshot->'topics')is distinct from'array'or jsonb_array_length(p_snapshot->'topics')>5
  or jsonb_typeof(p_snapshot->'allUpdates')is distinct from'array'or jsonb_array_length(p_snapshot->'allUpdates')<>jsonb_array_length(j.input->'updates')then raise exception'Daily snapshot evidence changed'using errcode='PT409';end if;
 select coalesce(jsonb_agg(k order by k),'[]')into expected_keys from(
  select distinct f#>>'{citation,findingKey}'k from jsonb_array_elements(j.input->'updates')u cross join lateral jsonb_array_elements(u->'findings')f
 )keys;
 if jsonb_array_length(p_finding_keys)<>jsonb_array_length(expected_keys)or not(p_finding_keys@>expected_keys and expected_keys@>p_finding_keys)then raise exception'Daily finding identity changed'using errcode='PT409';end if;
 -- Recheck every frozen approved finding against current exact source and its
 -- retained human decision; a stale/rejected source cannot be published.
 for update_row in select value from jsonb_array_elements(j.input->'updates')loop
  for finding in select value from jsonb_array_elements(update_row->'findings')loop
   citation:=finding->'citation';
   select*into a from public.reader_source_updates where user_id=j.reader_id and id=citation->>'updateId'and source_id=citation->>'sourceId'for share;
   h:=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex');
   if a.id is null or h is distinct from citation->>'contentHash'or strpos(a.record->>'content',citation->>'evidenceQuote')=0
    or not exists(select 1 from public.admin_analysis_reviews r where r.id=(citation->>'reviewId')::uuid and r.user_id=j.reader_id and r.update_id=a.id and r.source_id=a.source_id
     and r.status='approved'and r.kind='recap'and r.content_hash=h and exists(select 1 from jsonb_array_elements(r.resolved->'highlights')p where btrim(p->>'text')=finding->>'text'and p->>'evidenceQuote'=citation->>'evidenceQuote'))then
    raise exception'Approved daily source changed'using errcode='PT409';end if;
  end loop;
 end loop;
 for topic in select value from jsonb_array_elements(p_snapshot->'topics')loop
  if jsonb_typeof(topic->'title')is distinct from'string'or length(topic->>'title')not between 1 and 200
   or jsonb_typeof(topic->'points')is distinct from'array'or jsonb_array_length(topic->'points')not between 1 and 6 then raise exception'Invalid daily topic'using errcode='PT400';end if;
  for point in select value from jsonb_array_elements(topic->'points')loop
   if jsonb_typeof(point->'citations')is distinct from'array'or jsonb_array_length(point->'citations')not between 1 and 2000 then raise exception'Invalid daily citations'using errcode='PT400';end if;
   for citation in select value from jsonb_array_elements(point->'citations')loop
    if not exists(select 1 from jsonb_array_elements(j.input->'updates')u cross join lateral jsonb_array_elements(u->'findings')f
     where f->>'text'=point->>'text'and f->'citation'=citation)then raise exception'Unapproved daily wording or citation'using errcode='PT409';end if;
    seen_keys:=array_append(seen_keys,citation->>'findingKey');
   end loop;
  end loop;
 end loop;
 if p_snapshot#>'{coverage,sources}'is distinct from j.input->'sources'
  or p_snapshot#>'{coverage,followedSources}'is distinct from to_jsonb(jsonb_array_length(j.input->'sources'))
  or p_snapshot#>'{coverage,checkedSources}'is distinct from to_jsonb((select count(*)from jsonb_array_elements(j.input->'sources')x where x->>'state'='checked'))
  or p_snapshot#>'{coverage,availableUpdates}'is distinct from to_jsonb(jsonb_array_length(j.input->'updates'))
  or p_snapshot#>'{coverage,pendingReviewUpdates}'is distinct from to_jsonb((select count(*)from jsonb_array_elements(j.input->'updates')x where x->>'state'='awaiting_review'))
  or p_snapshot#>'{coverage,missingContentUpdates}'is distinct from to_jsonb((select count(*)from jsonb_array_elements(j.input->'updates')x where x->>'state'='content_missing'))
  or p_snapshot#>'{coverage,omittedUpdates}'is distinct from j.input->'omittedUpdates'then raise exception'Daily coverage changed'using errcode='PT409';end if;
 for item in select value from jsonb_array_elements(p_snapshot->'allUpdates')loop
  if not exists(select 1 from jsonb_array_elements(j.input->'updates')u where(item-'state')=(u-array['topics','findings','state'])
   and(item->>'state'=u->>'state'or(item->>'state'='included'and u->>'state'='available'and exists(
    select 1 from jsonb_array_elements(u->'findings')f where f#>>'{citation,findingKey}'=any(seen_keys)))))then
   raise exception'Daily update inventory changed'using errcode='PT409';end if;
 end loop;
 if(p_status in('ready','partial')and cardinality(seen_keys)=0)or(p_status in('quiet','awaiting_review')and cardinality(seen_keys)>0)then raise exception'Daily readiness does not match findings'using errcode='PT400';end if;
 insert into public.daily_briefings(id,reader_id,local_date,period_start,cutoff_at,status,snapshot,workspace_revision,generation,published_at)
  values(j.id,j.reader_id,j.local_date,j.period_start,j.cutoff_at,p_status,p_snapshot,j.workspace_revision,j.generation,case when p_status<>'awaiting_review'then clock_timestamp()end)returning id into b;
 insert into public.daily_briefing_consumed_findings(reader_id,finding_key,briefing_id)select j.reader_id,value#>>'{}',b from jsonb_array_elements(expected_keys)on conflict do nothing;
 update public.daily_briefing_jobs set state='finished',lease_token=null,lease_until=null where id=j.id;
 update public.daily_briefing_schedules set last_cutoff_at=j.cutoff_at,last_local_date=j.local_date where reader_id=j.reader_id;
 return b;
end;$$;

create function public.delete_daily_briefing(p_reader_id text,p_id uuid,p_expected_created_at timestamptz)
returns void language plpgsql security invoker set search_path=''as $$
declare b public.daily_briefings;
begin
 perform 1 from public.reader_workspaces where user_id=p_reader_id for key share;
 select*into b from public.daily_briefings where id=p_id and reader_id=p_reader_id for update;
 if b.id is null then raise exception'Daily briefing unavailable'using errcode='PT404';end if;
 if p_expected_created_at is null or b.created_at<>p_expected_created_at then raise exception'Daily briefing changed'using errcode='PT409';end if;
 update public.daily_briefings set status='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()),snapshot='{}'where id=b.id;
 update public.daily_briefing_jobs set state='cancelled',lease_token=null,lease_until=null,input='{}'where id=b.id;
end;$$;

revoke all on function public.list_daily_briefing_candidates(text,integer),public.claim_daily_briefing(text,uuid,timestamptz,date,timestamptz,timestamptz),public.finish_daily_briefing(uuid,uuid,text,jsonb,jsonb),public.fail_daily_briefing(uuid,uuid,text),public.delete_daily_briefing(text,uuid,timestamptz)from public,anon,authenticated;
grant execute on function public.list_daily_briefing_candidates(text,integer),public.claim_daily_briefing(text,uuid,timestamptz,date,timestamptz,timestamptz),public.finish_daily_briefing(uuid,uuid,text,jsonb,jsonb),public.fail_daily_briefing(uuid,uuid,text),public.delete_daily_briefing(text,uuid,timestamptz)to service_role;

create function public.daily_briefing_immutable()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if new.status='deleted'and new.deleted_at is not null and new.snapshot='{}'::jsonb
  and(to_jsonb(new)-array['status','deleted_at','snapshot'])=(to_jsonb(old)-array['status','deleted_at','snapshot'])then return new;end if;
 if new is distinct from old then raise exception'Delivered daily snapshots are immutable; record a visible correction instead'using errcode='PT409';end if;return new;
end;$$;
revoke all on function public.daily_briefing_immutable()from public,anon,authenticated;
grant execute on function public.daily_briefing_immutable()to service_role;
create trigger daily_briefing_immutable before update on public.daily_briefings for each row execute function public.daily_briefing_immutable();

-- Only ordinary schedule changes are tracked here. Bookmark/read-later edits
-- do not alter generation or cancel accepted reminder work.
create function recap_internal.daily_workspace_settings_changed()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if old.state#>'{settings,timezone}'is distinct from new.state#>'{settings,timezone}'or old.state#>'{settings,deliveryTime}'is distinct from new.state#>'{settings,deliveryTime}'then
  update public.daily_briefing_schedules set settings_changed_at=clock_timestamp()where reader_id=new.user_id;
 end if;return new;
end;$$;
revoke all on function recap_internal.daily_workspace_settings_changed()from public,anon,authenticated,service_role;
create trigger daily_workspace_settings_changed after update of state on public.reader_workspaces for each row execute function recap_internal.daily_workspace_settings_changed();

create function recap_internal.reset_own_daily_briefings()returns void
language plpgsql security definer set search_path=''as $$
declare subject text;
begin
 subject:=auth.jwt()->>'sub';if subject is null or length(subject)not between 1 and 200 then raise exception'Sign in required'using errcode='PT401';end if;
 perform 1 from public.reader_workspaces where user_id=subject for update;
 update public.daily_briefing_schedules set generation=gen_random_uuid(),starts_at=clock_timestamp(),settings_changed_at=clock_timestamp()where reader_id=subject;
 update public.daily_briefing_jobs set state='cancelled',lease_token=null,lease_until=null,input='{}'where reader_id=subject;
 update public.daily_briefings set status='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()),snapshot='{}'where reader_id=subject;
end;$$;
revoke all on function recap_internal.reset_own_daily_briefings()from public,anon,authenticated,service_role;
grant execute on function recap_internal.reset_own_daily_briefings()to authenticated;
do $$
declare definition text;needle text:='delete from public.reader_source_updates a where a.user_id=subject;';
begin
 definition:=pg_get_functiondef('public.clear_reader_workspace(timestamptz,jsonb)'::regprocedure);
 if(char_length(definition)-char_length(replace(definition,needle,'')))/char_length(needle)<>1 then raise exception'Unexpected workspace clear definition';end if;
 execute replace(definition,needle,E'perform recap_internal.reset_own_daily_briefings();\n '||needle);
end;$$;
comment on table public.daily_briefings is 'Private immutable daily approved-wording snapshots. Deletion keeps an empty same-cycle tombstone; no generated wording is automatically approved.';
commit;
