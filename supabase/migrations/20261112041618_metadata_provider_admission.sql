-- Empty, append-only native authority for separately admitted metadata work.
-- No existing source/financial/provider row, cap, setting or approval is seeded.
begin;
create table public.collection_metadata_contracts (
 digest text primary key check(digest ~ '^[a-f0-9]{64}$'),
 canonical_body text not null check(octet_length(canonical_body)<=16000),
 body jsonb not null check(jsonb_typeof(body)='object'),
 created_at timestamptz not null default clock_timestamp(),
 check(canonical_body::jsonb=body and digest=encode(sha256(convert_to(canonical_body,'UTF8')),'hex')),
 check(body ?& array['version','actorRef','actorId','buildId','buildNumber','originalAccountId','pricingSha256','inputSchemaSha256','maximumUsd','maximumItems'] and body->>'version'='apify-youtube-format-v2' and body->>'actorRef' in('admirala/youtube-scraper','tenfoldfleet/youtube-video-details-lookup')
  and body->>'actorId' ~ '^[A-Za-z0-9]{6,64}$' and body->>'buildId' ~ '^[A-Za-z0-9]{6,64}$'
  and body->>'originalAccountId' ~ '^[A-Za-z0-9]{6,64}$'
  and ((body->>'actorRef'='admirala/youtube-scraper' and body->>'buildNumber'='0.1.7') or(body->>'actorRef'='tenfoldfleet/youtube-video-details-lookup' and body->>'buildNumber'='1.0.5'))
  and body->>'pricingSha256' ~ '^[a-f0-9]{64}$' and body->>'inputSchemaSha256' ~ '^[a-f0-9]{64}$'
  and body->'maximumUsd'='"0.005"'::jsonb and body->'maximumItems'='1'::jsonb
  and (body-array['version','actorRef','actorId','buildId','buildNumber','originalAccountId','pricingSha256','inputSchemaSha256','maximumUsd','maximumItems'])='{}'::jsonb)
);
alter table public.collection_metadata_contracts add constraint metadata_contract_strings check(jsonb_typeof(body->'version')='string' and jsonb_typeof(body->'actorRef')='string' and jsonb_typeof(body->'actorId')='string' and jsonb_typeof(body->'buildId')='string' and jsonb_typeof(body->'buildNumber')='string' and jsonb_typeof(body->'originalAccountId')='string' and jsonb_typeof(body->'pricingSha256')='string' and jsonb_typeof(body->'inputSchemaSha256')='string' and jsonb_typeof(body->'maximumUsd')='string');
create table public.collection_metadata_scopes (
 id uuid primary key default gen_random_uuid(),
 purpose text not null check(purpose in('qualification','repair','comparison')),
 user_id text not null check(length(user_id) between 1 and 200),
 contract_digest text references public.collection_metadata_contracts(digest),
 check_id uuid references public.reader_collection_checks(id),source_id text,archive_id text,target_url text,video_id text,channel_id text,
 source_hash text,source_fingerprint text,workspace_revision timestamptz,archive_revision timestamptz,
 expected_control jsonb,request_canonical text,input_canonical text,request_sha256 text,
 qualification_control jsonb,
 parent_id uuid references public.collection_metadata_scopes(id),fallback_of uuid,
 maximum_calls integer not null check(maximum_calls between 1 and 5),
 maximum_usd numeric(12,6) not null check(maximum_usd>0 and maximum_usd<=0.025),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval'24 hours'),
 check((purpose='comparison' and parent_id is null and check_id is null and contract_digest is null)
  or(purpose in('qualification','repair') and maximum_calls=1 and maximum_usd=.005 and check_id is not null and contract_digest is not null
   and source_id is not null and archive_id is not null and target_url is not null and video_id is not null and channel_id is not null and source_hash is not null and source_fingerprint is not null and request_canonical is not null and input_canonical is not null and request_sha256 is not null and length(source_id) between 1 and 120 and length(archive_id) between 1 and 500
   and video_id ~ '^[A-Za-z0-9_-]{11}$' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
   and source_hash ~ '^[a-f0-9]{64}$' and source_fingerprint ~ '^[a-f0-9]{32}$'
   and workspace_revision is not null and archive_revision is not null and jsonb_typeof(expected_control)='object'
   and length(target_url)<=2048 and public.hourly_item_key(target_url)='youtube:'||video_id
   and octet_length(request_canonical)<=16000 and octet_length(input_canonical)<=12000
   and jsonb_typeof(request_canonical::jsonb)='object' and jsonb_typeof(input_canonical::jsonb)='object'
   and request_sha256=encode(sha256(convert_to(request_canonical,'UTF8')),'hex'))),
 check(purpose<>'qualification' or(qualification_control is not null and qualification_control ?& array['kind','expectedShort','expectedCurrentlyLive','groundingSha256'] and jsonb_typeof(qualification_control)='object'
  and qualification_control->>'kind' in('regular','short','live','replay','duration_adversarial')
  and jsonb_typeof(qualification_control->'expectedShort')='boolean'
  and qualification_control ? 'expectedCurrentlyLive'
  and (qualification_control->'expectedCurrentlyLive'='null'::jsonb or jsonb_typeof(qualification_control->'expectedCurrentlyLive')='boolean')
  and qualification_control->>'groundingSha256' ~ '^[a-f0-9]{64}$'))
);
create table public.collection_metadata_intents (
 id uuid primary key references public.reader_collection_provider_jobs(id),
 scope_id uuid not null unique references public.collection_metadata_scopes(id),
 contract_digest text not null references public.collection_metadata_contracts(digest),
 check_id uuid not null references public.reader_collection_checks(id),
 job_id uuid not null unique references public.collection_jobs(id),
 reservation_id uuid not null unique references public.collection_budget_reservations(id),
 prepared_digest text not null check(prepared_digest ~ '^[a-f0-9]{64}$'),
 authority jsonb not null check(jsonb_typeof(authority)='object' and octet_length(authority::text)<=40000),
 attempt_ordinal integer not null default 1 check(attempt_ordinal=1),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.collection_metadata_scopes add constraint metadata_fallback_intent foreign key(fallback_of)references public.collection_metadata_intents(id);
create table public.collection_metadata_observations (
 id uuid primary key default gen_random_uuid(),
 intent_id uuid references public.collection_metadata_intents(id),
 contract_digest text not null references public.collection_metadata_contracts(digest),
 observation_key text not null unique check(observation_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
 kind text not null check(kind in('ack','status','result','finish','qualification_acceptance','qualification_revocation')),
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=40000),
 created_at timestamptz not null default clock_timestamp(),
 check((kind in('qualification_acceptance','qualification_revocation') and intent_id is null) or(kind in('ack','status','result','finish') and intent_id is not null))
);
create index metadata_intents_contract on public.collection_metadata_intents(contract_digest,created_at);
create index metadata_observations_intent on public.collection_metadata_observations(intent_id,created_at,id);
create index metadata_observations_qualification on public.collection_metadata_observations(contract_digest,created_at,id) where kind in('qualification_acceptance','qualification_revocation');
create function public.immutable_metadata_authority() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Metadata authority and receipts are append only' using errcode='PT409';end;$$;
revoke all on function public.immutable_metadata_authority() from public,anon,authenticated,service_role;
alter table public.collection_metadata_contracts enable row level security;
revoke all on public.collection_metadata_contracts from public,anon,authenticated,service_role;
grant select,insert on public.collection_metadata_contracts to service_role;
create trigger immutable_metadata_contracts before update or delete on public.collection_metadata_contracts for each row execute function public.immutable_metadata_authority();
alter table public.collection_metadata_scopes enable row level security;
revoke all on public.collection_metadata_scopes from public,anon,authenticated,service_role;
grant select,insert on public.collection_metadata_scopes to service_role;
create trigger immutable_metadata_scopes before update or delete on public.collection_metadata_scopes for each row execute function public.immutable_metadata_authority();
alter table public.collection_metadata_intents enable row level security;
revoke all on public.collection_metadata_intents from public,anon,authenticated,service_role;
grant select,insert on public.collection_metadata_intents to service_role;
create trigger immutable_metadata_intents before update or delete on public.collection_metadata_intents for each row execute function public.immutable_metadata_authority();
alter table public.collection_metadata_observations enable row level security;
revoke all on public.collection_metadata_observations from public,anon,authenticated,service_role;
grant select,insert on public.collection_metadata_observations to service_role;
create trigger immutable_metadata_observations before update or delete on public.collection_metadata_observations for each row execute function public.immutable_metadata_authority();
create function public.metadata_native_capability(p_capability jsonb,p_stage text) returns boolean
language plpgsql volatile security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_capability) is distinct from 'object' or not(p_capability ?& array['key','token','epoch','release','revision','messageId'])
  or (p_capability-array['key','token','epoch','release','revision','messageId'])<>'{}'::jsonb
  or jsonb_typeof(p_capability->'epoch') is distinct from 'number'
  or coalesce(p_capability->>'epoch','') !~ '^[1-9][0-9]{0,14}$'
  or coalesce(p_capability->>'token','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or coalesce(p_capability->>'revision','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then return false;end if;
 return public.pipeline_service_capability(p_capability->>'key',(p_capability->>'token')::uuid,(p_capability->>'epoch')::bigint,p_capability->>'release',(p_capability->>'revision')::uuid,p_stage,p_capability->>'messageId');
end;$$;
create function public.metadata_contract_qualified(p_digest text) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select kind='qualification_acceptance' from public.collection_metadata_observations where contract_digest=p_digest and kind in('qualification_acceptance','qualification_revocation') order by created_at desc,id desc limit 1),false);
$$;
-- No workspace lock is acquired after source-state. Archive locks are NOWAIT:
-- an archive deletion's invalidation trigger acquires source-state in reverse.
create function public.metadata_assert_scope(p_scope_id uuid,p_check_id uuid,p_lease_token uuid,p_capability jsonb,p_lock boolean default false,p_admission boolean default true)
returns public.collection_metadata_scopes language plpgsql volatile security invoker set search_path='' as $$
declare q public.collection_metadata_scopes;e public.reader_collection_checks;p public.reader_collection_policies;s public.reader_collection_source_state;a public.reader_source_updates;c public.collection_metadata_contracts;doc jsonb;wanted jsonb;params text;
begin
 if not public.metadata_native_capability(p_capability,'collection')then raise exception 'Native metadata capability changed' using errcode='PT409';end if;
 select * into q from public.collection_metadata_scopes where id=p_scope_id;
 select * into e from public.reader_collection_checks where id=p_check_id;
 if p_lock then
  select * into p from public.reader_collection_policies where user_id=e.user_id for update;
  select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 else
  select * into p from public.reader_collection_policies where user_id=e.user_id;
  select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id;
 end if;
 if q.id is null or q.purpose='comparison' or q.expires_at<=clock_timestamp() or(p_admission and q.check_id is distinct from e.id)
  or q.user_id is distinct from e.user_id or q.source_id is distinct from e.source_id or e.platform<>'YouTube'
  or not coalesce(p.enabled and p.provider_enabled,false) or e.status<>'running'
  or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp()+interval'30 seconds'
  or q.source_fingerprint is distinct from s.fingerprint or q.workspace_revision is distinct from s.workspace_revision
  or q.expected_control is distinct from jsonb_build_object('epoch',p_capability->'epoch','release',p_capability->>'release','revision',p_capability->>'revision')
  or coalesce(s.channel_id,substring(e.source_url from '/channel/(UC[A-Za-z0-9_-]{22})')) is distinct from q.channel_id then
  raise exception 'Metadata scope or source lease changed' using errcode='PT409';end if;
 if not exists(select 1 from public.reader_workspaces w where w.user_id=e.user_id and w.updated_at=s.workspace_revision and w.state->'followedSourceIds' ? e.source_id
  and exists(select 1 from jsonb_array_elements(w.state->'customSources')x where x->>'id'=e.source_id and x->>'platform'='YouTube' and md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl',''))=s.fingerprint))then
  raise exception 'Metadata follow changed' using errcode='PT409';end if;
 if p_lock then select * into a from public.reader_source_updates where user_id=q.user_id and id=q.archive_id for update nowait;
 else select * into a from public.reader_source_updates where user_id=q.user_id and id=q.archive_id;end if;
 if a.user_id is null or a.source_id is distinct from q.source_id or a.updated_at is distinct from q.archive_revision
  or public.hourly_item_key(a.record->>'url') is distinct from 'youtube:'||q.video_id or a.record->>'sourceId' is distinct from q.source_id
  or a.record->'isSample' is distinct from 'false'::jsonb or a.record->>'format' is distinct from 'video'
  or a.record->>'contentKind' is distinct from 'transcript' or length(btrim(coalesce(a.record->>'content','')))=0
  or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from q.source_hash
  or(q.purpose='repair' and coalesce(a.record#>>'{videoFormat,kind}','unknown')<>'unknown')then
  raise exception 'Current metadata archive changed' using errcode='PT409';end if;
 select * into c from public.collection_metadata_contracts where digest=q.contract_digest;
 if q.purpose='repair'and not public.metadata_contract_qualified(c.digest)then raise exception 'Metadata route is not qualified' using errcode='PT409';end if;
 if c.body->>'actorRef'='tenfoldfleet/youtube-video-details-lookup'and not exists(
  select 1 from public.collection_metadata_intents prior join public.collection_metadata_scopes before_scope on before_scope.id=prior.scope_id join public.reader_collection_provider_jobs before_job on before_job.id=prior.id
  where prior.id=q.fallback_of and before_scope.user_id=q.user_id and before_scope.source_id=q.source_id and before_scope.video_id=q.video_id and before_scope.source_hash=q.source_hash
   and q.parent_id is not null and before_scope.parent_id=q.parent_id and prior.authority#>>'{contract,actorRef}'='admirala/youtube-scraper'
   and before_job.state in('completed','failed')and before_job.provider_run_id is not null and before_job.actual_cost_usd>0)then
  raise exception 'Separately admitted known-terminal metadata fallback required'using errcode='PT409';end if;

 doc:=q.request_canonical::jsonb;
 wanted:=case when c.body->>'actorRef'='admirala/youtube-scraper' then jsonb_build_object('videoUrls',jsonb_build_array(q.target_url),'searchQueries','[]'::jsonb,'channels','[]'::jsonb,'playlists','[]'::jsonb,'videoDetails',true,'channelInfo',false,'includeTranscript',false,'channelVideos',false,'channelShorts',false,'channelStreams',false,'maxResultsPerQuery',1,'maxResultsPerChannel',1,'maxResultsPerPlaylist',1,'allowResidentialProxy',false)
  else jsonb_build_object('videos',jsonb_build_array(q.target_url),'monitorMode',false,'maxConcurrency',1,'proxyConfiguration',jsonb_build_object('useApifyProxy',false))end;
 params:='build='||(c.body->>'buildNumber')||'&memory=128&timeout=120&maxItems=1&maxTotalChargeUsd=0.005&restartOnError=false&waitForFinish=0';
 if c.digest is null or doc is distinct from jsonb_build_object('contractDigest',c.digest,'target',jsonb_build_object('url',q.target_url,'channelId',q.channel_id,'contentHash',q.source_hash,'sourceFingerprint',q.source_fingerprint),'input',wanted,'params',params)
  or q.input_canonical::jsonb is distinct from wanted or q.request_sha256 is distinct from encode(sha256(convert_to(q.request_canonical,'UTF8')),'hex')then
  raise exception 'Frozen metadata request changed' using errcode='PT409';end if;
 return q;
exception when lock_not_available then raise exception 'Metadata archive busy' using errcode='PT409';
end;$$;
create function public.metadata_scope_document(p_scope_id uuid)returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('scopeId',q.id,'purpose',q.purpose,'contract',c.body,'contractDigest',c.digest,
 'target',jsonb_build_object('url',q.target_url,'channelId',q.channel_id,'contentHash',q.source_hash,'sourceFingerprint',q.source_fingerprint),
 'fallbackOf',q.fallback_of,'archiveId',q.archive_id,'archiveRevision',q.archive_revision,'workspaceRevision',q.workspace_revision,'requestCanonical',q.request_canonical,'inputCanonical',q.input_canonical,'requestSha256',q.request_sha256,
 'itemKey','youtube-format-v2:'||q.video_id||':'||encode(sha256(convert_to('{"contractDigest":"'||c.digest||'","purpose":"'||q.purpose||'","sourceFingerprint":"'||q.source_fingerprint||'","sourceHash":"'||q.source_hash||'"}','UTF8')),'hex'),
 'preparedDigest',encode(sha256(convert_to(to_jsonb(q)::text||c.digest,'UTF8')),'hex'))
 from public.collection_metadata_scopes q join public.collection_metadata_contracts c on c.digest=q.contract_digest where q.id=p_scope_id;
$$;
create function public.metadata_intent_document(p_intent_id uuid)returns jsonb language sql stable security invoker set search_path='' as $$
 select i.authority||jsonb_build_object('id',i.id,'providerJobId',i.id,'jobId',i.job_id,'reservationId',i.reservation_id,'providerRunId',j.provider_run_id,'state',j.state,'actualCostUsd',j.actual_cost_usd::text,'observedCostUsd',j.observed_cost_usd::text)
 from public.collection_metadata_intents i join public.reader_collection_provider_jobs j on j.id=i.id where i.id=p_intent_id;
$$;
create function public.prepare_hourly_metadata_provider(p_check_id uuid,p_lease_token uuid,p_scope_id uuid default null,p_capability jsonb default null)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare q public.collection_metadata_scopes;items jsonb:='[]';begin
 if not public.metadata_native_capability(p_capability,'collection')then raise exception 'Native metadata capability changed' using errcode='PT409';end if;
 for q in select * from public.collection_metadata_scopes where check_id=p_check_id and purpose in('qualification','repair')and(p_scope_id is null or id=p_scope_id)and expires_at>clock_timestamp()and not exists(select 1 from public.collection_metadata_intents i where i.scope_id=collection_metadata_scopes.id)order by created_at,id limit 5 loop
  perform public.metadata_assert_scope(q.id,p_check_id,p_lease_token,p_capability,false,true);items:=items||jsonb_build_array(public.metadata_scope_document(q.id));
 end loop;
 return items;
end;$$;
create function public.reserve_hourly_metadata_provider(p_check_id uuid,p_lease_token uuid,p_scope_id uuid,p_job_id uuid,p_prepared_digest text,p_preflight jsonb,p_capability jsonb)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare q public.collection_metadata_scopes;parent public.collection_metadata_scopes;i public.collection_metadata_intents;j public.reader_collection_provider_jobs;r public.collection_budget_reservations;doc jsonb;contract jsonb;daily numeric;lifetime numeric;preflight_at timestamptz;attempts bigint;allocated numeric;
begin
 q:=public.metadata_assert_scope(p_scope_id,p_check_id,p_lease_token,p_capability,true,true);
 if q.parent_id is not null then perform pg_advisory_xact_lock(hashtextextended('metadata-scope:'||q.parent_id::text,0));select * into parent from public.collection_metadata_scopes where id=q.parent_id;
  if parent.purpose is distinct from 'comparison'or parent.user_id is distinct from q.user_id or parent.expires_at<=clock_timestamp()then raise exception 'Metadata comparison scope changed'using errcode='PT409';end if;end if;
 perform pg_advisory_xact_lock(hashtextextended('metadata-scope:'||q.id::text,0));
 doc:=public.metadata_scope_document(q.id);contract:=doc->'contract';
 select * into i from public.collection_metadata_intents where scope_id=q.id;
 if i.id is null then select i0.* into i from public.collection_metadata_intents i0 join public.reader_collection_provider_jobs j0 on j0.id=i0.id where j0.user_id=q.user_id and j0.source_id=q.source_id and j0.item_key=doc->>'itemKey';end if;
 if i.id is not null then return jsonb_build_object('claimed',false,'id',i.id,'reservationId',i.reservation_id,'intent',public.metadata_intent_document(i.id));end if;
 if doc->>'preparedDigest' is distinct from p_prepared_digest or jsonb_typeof(p_preflight)is distinct from'object'or octet_length(p_preflight::text)>16000
  or p_preflight->>'contractDigest' is distinct from q.contract_digest or p_preflight->>'requestSha256'is distinct from q.request_sha256
  or coalesce(p_preflight->>'responseSha256','') !~ '^[a-f0-9]{64}$' or p_preflight->>'maximumUsd'is distinct from'0.005'or p_preflight->'maximumItems'is distinct from'1'::jsonb
  or exists(select 1 from unnest(array['actorId','buildId','buildNumber','originalAccountId','pricingSha256','inputSchemaSha256'])k where p_preflight->>k is distinct from contract->>k)then raise exception 'Metadata preflight changed'using errcode='PT409';end if;
 begin preflight_at:=(p_preflight->>'observedAt')::timestamptz;exception when others then raise exception 'Invalid metadata preflight time'using errcode='PT400';end;
 if preflight_at is null or not isfinite(preflight_at)or preflight_at>clock_timestamp()+interval'1 second'or preflight_at<clock_timestamp()-interval'60 seconds'then raise exception 'Fresh metadata preflight required'using errcode='PT409';end if;
 if parent.id is not null then
  select count(*),coalesce(sum(s.maximum_usd),0)into attempts,allocated from public.collection_metadata_intents t join public.collection_metadata_scopes s on s.id=t.scope_id where s.parent_id=parent.id;
  if attempts+1>parent.maximum_calls or allocated+.005>parent.maximum_usd then raise exception 'Metadata comparison exhausted'using errcode='PT402';end if;
 end if;
 if not exists(select 1 from public.collection_jobs where id=p_job_id and user_id=q.user_id and source_id=q.source_id and provider='apify'and actor_id=contract->>'actorId'and platform='YouTube'and status='requested')then raise exception 'Metadata ledger identity changed'using errcode='PT409';end if;
 select coalesce(sum(case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd)else greatest(actual_cost_usd,observed_cost_usd)end),0),
 coalesce(sum(case when created_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC'or actual_cost_usd is null then case when actual_cost_usd is null then greatest(maximum_usd,observed_cost_usd)else greatest(actual_cost_usd,observed_cost_usd)end else 0 end),0)into lifetime,daily from public.reader_collection_provider_jobs where user_id=q.user_id;
 if exists(select 1 from public.reader_collection_policies where user_id=q.user_id and(daily+.005>daily_limit_usd or lifetime+.005>lifetime_limit_usd))then raise exception 'Reader budget exhausted'using errcode='PT402';end if;
 r:=public.reserve_collection_budget('hourly.'||p_check_id::text||'.'||(doc->>'itemKey'),.005,'job',null,'apify',contract->>'actorId');
 if public.claim_collection_budget(r.id)->>'claimed'<>'true'then raise exception 'Metadata launch already claimed'using errcode='PT409';end if;
 insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd)values(q.user_id,q.source_id,doc->>'itemKey',q.source_fingerprint,p_check_id,p_job_id,r.id,contract->>'actorId',.005)returning *into j;
 insert into public.collection_metadata_intents(id,scope_id,contract_digest,check_id,job_id,reservation_id,prepared_digest,authority)values(j.id,q.id,q.contract_digest,p_check_id,p_job_id,r.id,p_prepared_digest,doc)returning *into i;
 perform 1 from public.reader_collection_checks where id=p_check_id for update nowait;
 update public.reader_collection_checks set provider='apify',observed_cost_usd=null,cost_status='unknown',job_id=p_job_id,details=jsonb_set(details,'{providerJobs}',coalesce(details->'providerJobs','[]')||jsonb_build_array(jsonb_build_object('jobId',p_job_id,'providerRunId',null,'actorId',contract->>'actorId','itemKey',doc->>'itemKey','reservedUsd',.005,'observedCostUsd',null,'costStatus','unknown')))where id=p_check_id;
 return jsonb_build_object('claimed',true,'id',j.id,'reservationId',r.id,'intent',public.metadata_intent_document(i.id));
exception when lock_not_available then raise exception 'Metadata check busy'using errcode='PT409';
end;$$;
create function public.pending_hourly_metadata_providers(p_check_id uuid,p_lease_token uuid,p_capability jsonb)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e public.reader_collection_checks;s public.reader_collection_source_state;begin
 if not public.metadata_native_capability(p_capability,'collection')then raise exception 'Native metadata capability changed'using errcode='PT409';end if;
 select *into e from public.reader_collection_checks where id=p_check_id;
 select *into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id;
 if e.id is null or e.status<>'running'or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<=clock_timestamp()then raise exception 'Metadata check lease changed'using errcode='PT409';end if;
 return coalesce((select jsonb_agg(public.metadata_intent_document(x.id)order by x.last_reconciled_at nulls first,x.created_at,x.id)from(select i.id,i.created_at,j.last_reconciled_at from public.collection_metadata_intents i join public.reader_collection_provider_jobs j on j.id=i.id where j.user_id=e.user_id and j.source_id=e.source_id and(j.state in('launch_claimed','running','ambiguous')or j.actual_cost_usd is null or(j.state='completed'and(
   not exists(select 1 from public.collection_metadata_observations o where o.intent_id=i.id and(o.kind='result'or o.body#>'{outcome,classificationRejected}'='true'::jsonb))
   or(i.authority->>'purpose'='repair'and exists(select 1 from public.collection_metadata_observations o where o.intent_id=i.id and o.kind='result')and not exists(select 1 from public.collection_metadata_observations o where o.intent_id=i.id and o.kind='finish'))))) order by j.last_reconciled_at nulls first,i.created_at,i.id limit 100)x),'[]');
end;$$;
create function public.read_hourly_metadata_intent(p_intent_id uuid,p_capability jsonb)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin if not public.metadata_native_capability(p_capability,'enrichment')then raise exception 'Native metadata capability changed'using errcode='PT409';end if;return public.metadata_intent_document(p_intent_id);end;$$;
create function public.assert_hourly_metadata_dispatch(p_check_id uuid,p_lease_token uuid,p_intent_id uuid,p_capability jsonb)returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare i public.collection_metadata_intents;j public.reader_collection_provider_jobs;begin
 select *into i from public.collection_metadata_intents where id=p_intent_id;
 if i.id is null then raise exception 'Metadata intent unavailable'using errcode='PT409';end if;
 perform public.metadata_assert_scope(i.scope_id,p_check_id,p_lease_token,p_capability,true,true);
 select *into j from public.reader_collection_provider_jobs where id=i.id;
 if j.provider_run_id is not null or j.state<>'launch_claimed'or j.job_id is distinct from i.job_id or j.reservation_id is distinct from i.reservation_id then raise exception 'Metadata dispatch consumed'using errcode='PT409';end if;
 return true;
end;$$;
create function public.record_hourly_metadata_observation(p_check_id uuid,p_lease_token uuid,p_intent_id uuid,p_observation_key text,p_evidence jsonb,p_capability jsonb)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare i public.collection_metadata_intents;q public.collection_metadata_scopes;e public.reader_collection_checks;j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;o public.collection_metadata_observations;c jsonb;observed timestamptz;finished timestamptz;amount numeric;final boolean;classification jsonb;late boolean:=false;outcome jsonb;receipt_kind text;
begin
 if not public.metadata_native_capability(p_capability,'collection')then raise exception 'Native metadata capability changed'using errcode='PT409';end if;
 select *into i from public.collection_metadata_intents where id=p_intent_id;
 select *into q from public.collection_metadata_scopes where id=i.scope_id;
 select *into e from public.reader_collection_checks where id=p_check_id;
 if i.id is null or e.user_id is distinct from q.user_id or e.source_id is distinct from q.source_id then raise exception 'Metadata receipt owner changed'using errcode='PT409';end if;
 -- Fee/status reconciliation deliberately survives old scope/lease/follow expiry.
 -- It never grants dispatch or archive import authority.
 perform 1 from public.reader_collection_policies where user_id=q.user_id for update;
 perform 1 from public.reader_collection_source_state where user_id=q.user_id and source_id=q.source_id for update;
 perform 1 from public.collection_budget_accounts where id='source-proof'for update;
 select *into j from public.reader_collection_provider_jobs where id=i.id for update;
 select *into r from public.collection_budget_reservations where id=i.reservation_id for update;
 select *into l from public.collection_jobs where id=i.job_id for update;
 c:=i.authority->'contract';receipt_kind:=p_evidence->>'kind';
 if p_observation_key is null or p_observation_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'or jsonb_typeof(p_evidence)is distinct from'object'or octet_length(p_evidence::text)>16000
  or coalesce(p_evidence->>'kind','')not in('ack','status','result')or coalesce(p_evidence->>'runId','') !~ '^[A-Za-z0-9_-]{6,200}$'or coalesce(p_evidence->>'responseSha256','') !~ '^[a-f0-9]{64}$'then raise exception 'Invalid metadata receipt'using errcode='PT400';end if;
 select *into o from public.collection_metadata_observations where observation_key=p_observation_key;
 if o.id is not null then
  if o.intent_id is distinct from i.id or ((o.body->'evidence')-'observedAt')is distinct from(p_evidence-'observedAt')then raise exception 'Metadata receipt identity changed'using errcode='PT409';end if;
  return o.body->'outcome';
 end if;
 begin observed:=(p_evidence->>'observedAt')::timestamptz;exception when others then raise exception 'Invalid metadata observation time'using errcode='PT400';end;
 if observed is null or not isfinite(observed)or observed>clock_timestamp()+interval'1 second'or observed<clock_timestamp()-interval'60 seconds'then raise exception 'Fresh metadata observation required'using errcode='PT409';end if;
 if j.provider_run_id is not null and j.provider_run_id is distinct from p_evidence->>'runId'or r.provider_run_id is not null and r.provider_run_id is distinct from p_evidence->>'runId'or l.provider_run_id is not null and l.provider_run_id is distinct from p_evidence->>'runId'then raise exception 'Metadata run changed'using errcode='PT409';end if;
 if p_evidence->>'kind'='ack'then
  -- Preserve the returned ID before checking the rest of a POST response.
  -- Invalid/foreign run metadata can never settle a fee or import output.
  update public.reader_collection_provider_jobs set provider_run_id=p_evidence->>'runId',state=case when state='launch_claimed'then'running'else state end where id=j.id;
  update public.collection_budget_reservations set provider_run_id=p_evidence->>'runId',updated_at=clock_timestamp()where id=r.id;
  update public.collection_jobs set provider_run_id=p_evidence->>'runId'where id=l.id;
 else
  if(j.state in('completed','failed')and p_evidence->>'status'not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED'))or j.provider_run_id is null or p_evidence->>'actorId'is distinct from c->>'actorId'or p_evidence->>'buildId'is distinct from c->>'buildId'or p_evidence->>'originalAccountId'is distinct from c->>'originalAccountId'
   or p_evidence->>'maximumUsd'is distinct from'0.005'or j.actor_id is distinct from c->>'actorId'or r.actor_id is distinct from j.actor_id or j.maximum_usd<>.005 or r.maximum_usd<>.005
   or coalesce(p_evidence->>'status','')not in('READY','RUNNING','TIMING-OUT','ABORTING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED')
   or not(p_evidence ?& array['usageUsd','finishedAt'])then raise exception 'Metadata run identity changed'using errcode='PT409';end if;
  if p_evidence->'usageUsd'<>'null'::jsonb then
   if jsonb_typeof(p_evidence->'usageUsd')is distinct from'string'or length(p_evidence->>'usageUsd')>80 or(p_evidence->>'usageUsd') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$'then raise exception 'Invalid metadata fee'using errcode='PT400';end if;
   amount:=(ceil((p_evidence->>'usageUsd')::numeric*1000000000000)/1000000000000)::numeric(24,12);
   if amount>=1000000000 then raise exception 'Invalid metadata fee magnitude'using errcode='PT400';end if;
  end if;
  begin finished:=(p_evidence->>'finishedAt')::timestamptz;exception when others then raise exception 'Invalid metadata finish time'using errcode='PT400';end;
  if finished is not null and(not isfinite(finished)or finished>observed)then raise exception 'Invalid metadata finish time'using errcode='PT400';end if;
  final:=p_evidence->>'status'in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED')and finished is not null and finished<=observed-interval'10 seconds';
  if r.state='settled'then late:=amount is not null and amount is distinct from r.actual_cost_usd;
  else
   if amount>.005 then
    insert into public.collection_provider_fee_receipts(request_key,provider_job_id,reservation_id,provider_run_id,evidence,expected,original_reservation,original_job_finances,original_ledger_finances,previous_usd,reported_usd,corrected_usd,delta_usd,outcome)
    values('metadata-overrun.'||encode(sha256(convert_to(p_observation_key,'UTF8')),'hex'),j.id,r.id,j.provider_run_id,p_evidence,jsonb_build_object('contractDigest',i.contract_digest),to_jsonb(r),jsonb_build_object('actual_cost_usd',j.actual_cost_usd,'observed_cost_usd',j.observed_cost_usd),jsonb_build_object('observed_cost_usd',l.observed_cost_usd,'cost_status',l.cost_status),0,amount,0,0,'unresolved_over_cap');
   end if;
   if final and amount>0 and amount<=.005 and amount>=coalesce(j.observed_cost_usd,0)then r:=public.settle_collection_budget(r.id,j.provider_run_id,amount,true);
   else r:=public.settle_collection_budget(r.id,j.provider_run_id,null,final);end if;
   update public.reader_collection_provider_jobs set observed_cost_usd=greatest(observed_cost_usd,amount),actual_cost_usd=r.actual_cost_usd where id=j.id;
   update public.collection_jobs set observed_cost_usd=greatest(observed_cost_usd,amount),cost_status=case when amount is null then'unknown'else'provider_reported'end where id=l.id;
  end if;
  update public.reader_collection_provider_jobs set state=case when p_evidence->>'status'='SUCCEEDED'then'completed'when p_evidence->>'status'in('FAILED','TIMED-OUT','ABORTED')then'failed'else'running'end,finished_at=case when final then coalesce(finished_at,finished)else finished_at end where id=j.id;
  update public.collection_jobs set status=case when p_evidence->>'status'='SUCCEEDED'then'succeeded'when p_evidence->>'status'in('FAILED','TIMED-OUT','ABORTED')then'failed'else'running'end,finished_at=case when final then coalesce(finished_at,finished)else finished_at end where id=l.id;
  if p_evidence->>'kind'='result'then
   classification:=p_evidence->'classification';
   if p_evidence->>'status'<>'SUCCEEDED'or coalesce(p_evidence->>'datasetSha256','') !~ '^[a-f0-9]{64}$'or p_evidence->>'channelId'is distinct from q.channel_id
    or jsonb_typeof(classification)is distinct from'object'or classification->>'videoId'is distinct from q.video_id or classification->>'sourceHash'is distinct from q.source_hash
    or classification->>'contractDigest'is distinct from i.contract_digest or jsonb_typeof(classification->'explicitShort')is distinct from'boolean'
    or classification#>>'{format,basis}'is distinct from'provider'or classification#>>'{format,kind}'is distinct from (case when classification->'explicitShort'='true'::jsonb then'short'else'regular'end)
    or classification->>'replayStatus'is distinct from'unknown'or not(classification ? 'currentlyLive')or not(classification->'currentlyLive'='null'::jsonb or jsonb_typeof(classification->'currentlyLive')='boolean')then classification:=null;receipt_kind:='status';end if;
  end if;
 end if;
 update public.reader_collection_provider_jobs set last_reconciled_at=clock_timestamp()where id=i.id;
 select *into j from public.reader_collection_provider_jobs where id=i.id;
 o.id:=gen_random_uuid();outcome:=jsonb_build_object('observationId',o.id,'id',i.id,'status',j.state,'fee',jsonb_build_object('actualUsd',j.actual_cost_usd::text,'observedUsd',j.observed_cost_usd::text,'lateCorrectionRequired',late),'classification',classification,'classificationRejected',p_evidence->>'kind'='result'and classification is null);
 insert into public.collection_metadata_observations(id,intent_id,contract_digest,observation_key,kind,body)values(o.id,i.id,i.contract_digest,p_observation_key,receipt_kind,jsonb_build_object('evidence',p_evidence,'outcome',outcome));
 return outcome;
exception when unique_violation then raise exception 'Metadata receipt or run already recorded'using errcode='PT409';
end;$$;
create function public.finish_hourly_metadata_provider(p_check_id uuid,p_lease_token uuid,p_intent_id uuid,p_observation_id uuid,p_capability jsonb)returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare i public.collection_metadata_intents;q public.collection_metadata_scopes;e public.reader_collection_checks;o public.collection_metadata_observations;prior public.collection_metadata_observations;j public.reader_collection_provider_jobs;a public.reader_source_updates;classification jsonb;applied boolean:=false;reason text:='metadata_not_admissible';rec jsonb;begin
 if not public.metadata_native_capability(p_capability,'collection')then raise exception 'Native metadata capability changed'using errcode='PT409';end if;
 select *into i from public.collection_metadata_intents where id=p_intent_id;
 select *into q from public.collection_metadata_scopes where id=i.scope_id;select *into e from public.reader_collection_checks where id=p_check_id;
 if i.id is null or e.user_id is distinct from q.user_id or e.source_id is distinct from q.source_id then raise exception 'Metadata finish owner changed'using errcode='PT409';end if;
 select *into prior from public.collection_metadata_observations where intent_id=i.id and kind='finish';
 if prior.id is not null then return prior.body;end if;
 select *into o from public.collection_metadata_observations where id=p_observation_id and intent_id=i.id and kind='result';
 select *into j from public.reader_collection_provider_jobs where id=i.id;
 select *into q from public.collection_metadata_scopes where id=i.scope_id;
 if q.purpose='repair'and(j.actual_cost_usd is null or j.state in('launch_claimed','running','ambiguous'))then return jsonb_build_object('applied',false,'reason','metadata_fee_pending');end if;
 if q.purpose='repair'and o.id is null then raise exception 'Metadata result receipt unavailable'using errcode='PT409';end if;
 if i.id is null or q.purpose is distinct from'repair'or o.id is null or j.state<>'completed'or j.actual_cost_usd is null or j.actual_cost_usd<=0 then
  reason:=case when q.purpose='qualification'then'qualification_import_forbidden'else'metadata_not_admissible'end;
 else
  begin
   perform public.metadata_assert_scope(q.id,p_check_id,p_lease_token,p_capability,true,false);
   select *into a from public.reader_source_updates where user_id=q.user_id and id=q.archive_id for update nowait;
   classification:=o.body#>'{evidence,classification}';
   rec:=public.merge_hourly_video_enrichment(a.record,jsonb_build_object('sourceId',q.source_id,'url',a.record->>'url','format','video','videoFormat',classification->'format','isShort',classification->'explicitShort','metadataExpectedContentHash',q.source_hash));
   if rec is distinct from a.record then update public.reader_source_updates set record=rec where user_id=q.user_id and id=q.archive_id;applied:=true;end if;
   reason:=case when applied then'format_applied'else'format_unchanged'end;
  exception when sqlstate'PT409'or lock_not_available then reason:='metadata_source_stale_or_busy';end;
 end if;
 insert into public.collection_metadata_observations(intent_id,contract_digest,observation_key,kind,body)values(i.id,i.contract_digest,'metadata-finish.'||i.id::text,'finish',jsonb_build_object('applied',applied,'reason',reason));
 return jsonb_build_object('applied',applied,'reason',reason);
end;$$;
-- Separate explicit operator review of independently frozen qualification controls.
-- Provider booleans or an Actor's passed flag never create this authority.
create function public.accept_hourly_metadata_qualification(p_contract_digest text,p_observation_ids uuid[],p_review jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare key text;prior public.collection_metadata_observations;roles integer;targets integer;bad integer;body jsonb;id uuid:=gen_random_uuid();begin
 if cardinality(p_observation_ids)<>5 or jsonb_typeof(p_review)is distinct from'object'or octet_length(p_review::text)>4000
  or coalesce(p_review->>'operatorReviewSha256','') !~ '^[a-f0-9]{64}$'or coalesce(p_review->>'groundingMatrixSha256','') !~ '^[a-f0-9]{64}$'
  or not exists(select 1 from public.collection_metadata_contracts where digest=p_contract_digest)then raise exception 'Explicit metadata qualification review required'using errcode='PT400';end if;
 select count(distinct q.qualification_control->>'kind'),count(distinct q.video_id),count(*)filter(where q.purpose<>'qualification'or i.contract_digest<>p_contract_digest or o.kind<>'result'or j.state<>'completed'or j.actual_cost_usd is null or j.actual_cost_usd<=0
  or o.body#>'{evidence,classification,explicitShort}'is distinct from q.qualification_control->'expectedShort'
  or(q.qualification_control->'expectedCurrentlyLive'<>'null'::jsonb and o.body#>'{evidence,classification,currentlyLive}'is distinct from q.qualification_control->'expectedCurrentlyLive'))
 into roles,targets,bad from unnest(p_observation_ids)x(id)join public.collection_metadata_observations o on o.id=x.id join public.collection_metadata_intents i on i.id=o.intent_id join public.collection_metadata_scopes q on q.id=i.scope_id join public.reader_collection_provider_jobs j on j.id=i.id;
 if roles<>5 or targets<>5 or bad<>0 then raise exception 'Independent metadata control matrix did not pass'using errcode='PT409';end if;
 key:='metadata-qualification.'||p_contract_digest||'.'||encode(sha256(convert_to(p_review::text||p_observation_ids::text,'UTF8')),'hex');
 body:=jsonb_build_object('controlObservationIds',to_jsonb(p_observation_ids),'operatorReview',p_review);
 select *into prior from public.collection_metadata_observations where observation_key=key;
 if prior.id is not null then return jsonb_build_object('observationId',prior.id,'qualified',public.metadata_contract_qualified(p_contract_digest));end if;
 insert into public.collection_metadata_observations(id,contract_digest,observation_key,kind,body)values(id,p_contract_digest,key,'qualification_acceptance',body);
 return jsonb_build_object('observationId',id,'qualified',true);
end;$$;
create function public.revoke_hourly_metadata_qualification(p_contract_digest text,p_review_sha256 text)returns jsonb language plpgsql security invoker set search_path='' as $$
declare id uuid;begin
 if p_review_sha256 is null or p_review_sha256 !~ '^[a-f0-9]{64}$'then raise exception 'Explicit metadata revocation review required'using errcode='PT400';end if;
 insert into public.collection_metadata_observations(contract_digest,observation_key,kind,body)values(p_contract_digest,'metadata-revoke.'||p_review_sha256,'qualification_revocation',jsonb_build_object('operatorReviewSha256',p_review_sha256))returning collection_metadata_observations.id into id;
 return jsonb_build_object('observationId',id,'qualified',false);
end;$$;
-- Wrapper leaves legacy function name, privileges, actor rules and stable
-- financial identities intact. Current live text is authoritative, not queue JSON.
create function public.reserve_hourly_caption_provider(p_check_id uuid,p_lease_token uuid,p_item_key text,p_job_id uuid,p_actor_id text,p_maximum_usd numeric,p_parent_reservation_id uuid default null)returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks;a public.reader_source_updates;s public.reader_collection_source_state;begin
 select *into e from public.reader_collection_checks where id=p_check_id;
 perform 1 from public.reader_collection_policies where user_id=e.user_id for update;
 select *into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if e.id is null or e.status<>'running'or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<=clock_timestamp()then raise exception 'Caption source lease changed'using errcode='PT409';end if;
 if p_item_key is null or p_item_key !~ '^youtube:[A-Za-z0-9_-]{11}$'then raise exception 'Caption identity required'using errcode='PT400';end if;
 for a in select *from public.reader_source_updates where user_id=e.user_id and source_id=e.source_id and public.hourly_item_key(record->>'url')=p_item_key order by id for update nowait loop
  if a.record->>'contentKind'='transcript'and length(btrim(coalesce(a.record->>'content','')))>0 then return jsonb_build_object('claimed',false,'reason','caption_already_available');end if;
 end loop;
 return public.reserve_hourly_provider(p_check_id,p_lease_token,p_item_key,p_job_id,p_actor_id,p_maximum_usd,p_parent_reservation_id);
exception when lock_not_available then raise exception 'Caption archive busy'using errcode='PT409';end;$$;

create or replace function public.finish_hourly_source(p_check_id uuid,p_lease_token uuid,p_patch jsonb,p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.reader_collection_checks; s public.reader_collection_source_state; w public.reader_workspaces; item jsonb; rec jsonb; base_record jsonb; k text; aid text; inserted integer:=0; affected integer; still_followed boolean; fp text;
begin
 select * into e from public.reader_collection_checks where id=p_check_id for update;
 if e.id is null then raise exception 'Check unavailable' using errcode='PT409'; end if;
 if exists(select 1 from public.collection_metadata_scopes q where q.check_id=p_check_id and q.purpose in('qualification','repair'))then
  if p_items is distinct from '[]'::jsonb or p_patch ?| array['cursor','pending_captions','etag','last_modified','feed_url','channel_id','content_hash']
   or coalesce((p_patch->>'new_count')::integer,0)<>0 or p_patch->>'status'='collected'then raise exception 'Metadata-only scope cannot use generic archive import'using errcode='PT409';end if;
 end if;
 if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_items)='array'then p_items else'[]'::jsonb end)x where x->'record' ?| array['metadataIntentId','metadataScopeId','metadataObservationId','metadataContractDigest'] or x->>'itemKey' like 'youtube-format-v2:%')then raise exception 'Candidate metadata requires dedicated import'using errcode='PT409';end if;

 select * into w from public.reader_workspaces where user_id=e.user_id for share;
 select * into s from public.reader_collection_source_state where user_id=e.user_id and source_id=e.source_id for update;
 if e.status<>'running' or s.check_id is distinct from e.id or s.lease_token is distinct from p_lease_token or s.lease_until<clock_timestamp() then raise exception 'Lease changed' using errcode='PT409'; end if;
 select md5(coalesce(x->>'platform','')||chr(10)||coalesce(x->>'url','')||chr(10)||coalesce(x->>'feedUrl','')) into fp
  from jsonb_array_elements(coalesce(w.state->'customSources','[]'::jsonb)) x where x->>'id'=e.source_id limit 1;
 still_followed:=coalesce(w.state->'followedSourceIds' ? e.source_id,false) and fp=s.fingerprint and w.updated_at=s.workspace_revision and exists(select 1 from public.reader_collection_policies where user_id=e.user_id and enabled);
 if not still_followed then p_patch:=jsonb_build_object('status','blocked','error_code','source_no_longer_followed'); p_items:='[]'::jsonb; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 or p_patch->>'status' not in ('unchanged','collected','partial','unsupported','blocked','failed') then raise exception 'Invalid check result' using errcode='PT400'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  rec:=item->'record'; k:=public.hourly_item_key(rec->>'url');
  if k is null or item->>'itemKey' is distinct from k or rec->>'sourceId' is distinct from e.source_id or rec->'isSample' is distinct from 'false'::jsonb or rec->>'publishedAt' is null then raise exception 'Invalid archive item' using errcode='PT400'; end if;
  if rec ? 'metadataExpectedContentHash' then
   -- Metadata-only repair may update an existing exact archive only. It must
   -- never create a record from an old queue or persist its internal CAS marker.
   update public.reader_source_updates set record=public.merge_hourly_video_enrichment(record,rec)
    where user_id=e.user_id and id=rec->>'id' and source_id=e.source_id and public.hourly_item_key(record->>'url')=k
     and record is distinct from public.merge_hourly_video_enrichment(record,rec);
   get diagnostics affected=row_count; inserted:=inserted+affected;
   continue;
  end if;
  select archive_id into aid from public.reader_collection_seen_items where user_id=e.user_id and source_id=e.source_id and item_key=k;
  if aid is null then
   aid:=rec->>'id';
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    values(e.user_id,aid,e.source_id,s.collection_id,(rec->>'publishedAt')::timestamptz,rec) on conflict(user_id,id) do nothing;
   get diagnostics affected=row_count; inserted:=inserted+affected;
   if affected=0 and not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid and source_id=e.source_id and public.hourly_item_key(record->>'url')=k) then raise exception 'Archive identity collision' using errcode='PT409'; end if;
   insert into public.reader_collection_seen_items(user_id,source_id,item_key,archive_id) values(e.user_id,e.source_id,k,aid) on conflict do nothing;
  else
   -- A real baseline may still live only in the older workspace JSON. Promote
   -- it with its original identity/annotations before enriching source text.
   if not exists(select 1 from public.reader_source_updates where user_id=e.user_id and id=aid) then
    select x into base_record from jsonb_array_elements(w.state->'importedUpdates') x where x->>'id'=aid and x->>'sourceId'=e.source_id and public.hourly_item_key(x->>'url')=k and x->'isSample'='false'::jsonb limit 1;
    if base_record is not null then
     insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
      values(e.user_id,aid,e.source_id,s.collection_id,(base_record->>'publishedAt')::timestamptz,base_record) on conflict do nothing;
    end if;
   end if;
   -- Merge only classification and missing captions. Preserve the original
   -- identity, original text/media/context and every independent annotation.
   update public.reader_source_updates set record=public.merge_hourly_video_enrichment(record,rec)
    where user_id=e.user_id and id=aid and source_id=e.source_id and public.hourly_item_key(record->>'url')=k
     and record is distinct from public.merge_hourly_video_enrichment(record,rec);
   get diagnostics affected=row_count; inserted:=inserted+affected;
  end if;
 end loop;
 update public.reader_collection_checks set status=p_patch->>'status',finished_at=clock_timestamp(),duration_ms=greatest(0,extract(epoch from clock_timestamp()-started_at)*1000),
  new_count=coalesce((p_patch->>'new_count')::integer,0),retrieved_count=inserted,http_status=(p_patch->>'http_status')::integer,error_code=p_patch->>'error_code',
  provider=coalesce(p_patch->>'provider','native'),job_id=(p_patch->>'job_id')::uuid,provider_run_id=p_patch->>'provider_run_id',
  observed_cost_usd=case when p_patch->>'cost_status'='unknown' then null else coalesce((p_patch->>'observed_cost_usd')::numeric,0) end,
  cost_status=coalesce(p_patch->>'cost_status','no_provider_charge'),details=coalesce(p_patch->'details','{}'::jsonb) where id=e.id;
 update public.reader_collection_source_state set lease_token=null,lease_until=null,check_id=null,last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '55 minutes',
  channel_id=coalesce(p_patch->>'channel_id',channel_id), feed_url=coalesce(p_patch->>'feed_url',feed_url),
  etag=case when p_patch ? 'etag' then p_patch->>'etag' else etag end,last_modified=case when p_patch ? 'last_modified' then p_patch->>'last_modified' else last_modified end,
  pending_captions=coalesce(p_patch->'pending_captions',pending_captions),content_hash=coalesce(p_patch->>'content_hash',content_hash),cursor=coalesce(p_patch->'cursor',cursor)
  where user_id=e.user_id and source_id=e.source_id;
 return jsonb_build_object('retrievedCount',inserted,'importAccepted',still_followed);
end;
$$;

create or replace function public.prepare_late_provider_fee(p_job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;i public.collection_metadata_intents; c jsonb;
begin
 select * into j from public.reader_collection_provider_jobs where id=p_job_id;
 select * into r from public.collection_budget_reservations where id=j.reservation_id;
 select * into l from public.collection_jobs where id=j.job_id;
 select *into i from public.collection_metadata_intents where id=j.id;
 c:=i.authority->'contract';
 if i.id is not null and(j.actor_id is distinct from c->>'actorId'or j.maximum_usd<>.005 or i.job_id is distinct from l.id or i.reservation_id is distinct from r.id)then raise exception 'Frozen metadata fee identity changed'using errcode='PT409';end if;
 if j.id is null or r.id is null or l.id is null or j.state not in('completed','failed') or r.kind<>'job' or r.parent_id is not null or r.state<>'settled'
  or r.launch_attempted_at is null or r.provider<>'apify' or (i.id is null and r.actor_id<>'h7sDV53CddomktSi5')
  or j.actor_id is distinct from r.actor_id or j.maximum_usd is distinct from r.maximum_usd
  or j.actual_cost_usd is distinct from r.actual_cost_usd or j.provider_run_id is null or j.provider_run_id is distinct from r.provider_run_id
  or l.provider_run_id is distinct from r.provider_run_id or l.actor_id is distinct from r.actor_id or l.provider<>'apify'
  or l.user_id is distinct from j.user_id or l.source_id is distinct from j.source_id or l.platform<>'YouTube'
  or (case when i.id is null then j.item_key !~ '^(youtube:|youtube-discovery:|youtube-format:)'else j.item_key is distinct from i.authority->>'itemKey'end)  then
  raise exception 'Only exact already-settled YouTube references can be corrected' using errcode='PT409';
 end if;
 return jsonb_build_object('provider_job_id',j.id,'reservation_id',r.id,'user_id',j.user_id,'provider_run_id',r.provider_run_id,'actor_id',r.actor_id,
  'revision',md5(to_jsonb(r)::text||to_jsonb(j)::text||to_jsonb(l)::text))||case when i.id is null then '{}'::jsonb else jsonb_build_object('metadata_contract_digest',i.contract_digest,'build_id',c->>'buildId','original_account_id',c->>'originalAccountId','max_usd','0.005')end;
end; $$;

create or replace function public.record_late_provider_fee(p_job_id uuid,p_request_key text,p_expected jsonb,p_evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.reader_collection_provider_jobs;r public.collection_budget_reservations;l public.collection_jobs;
 p public.reader_collection_policies;receipt public.collection_provider_fee_receipts;
 amount numeric;provider_cap numeric;delta numeric:=0;corrected numeric;reason text;total numeric;daily numeric;over_cap boolean:=false;observed timestamptz;finished timestamptz;
begin
 if exists(select 1 from public.collection_metadata_intents where id=p_job_id)then
  if not exists(select 1 from public.collection_metadata_intents i where i.id=p_job_id and p_evidence->>'consumer_account'=i.authority#>>'{contract,originalAccountId}'and p_evidence->>'build_id'=i.authority#>>'{contract,buildId}')then raise exception 'Frozen metadata fee account or build changed'using errcode='PT409';end if;
  p_evidence:=p_evidence-'consumer_account';
 end if;
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' or p_expected is null or p_evidence is null
  or jsonb_typeof(p_expected)<>'object' or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>4000
  or (p_evidence-array['run_id','actor_id','build_id','status','finished_at','observed_at','response_sha256','usage_usd','maximum_usd','authenticated_owner'])<>'{}'::jsonb
  or not(p_evidence ?& array['run_id','actor_id','build_id','status','finished_at','observed_at','response_sha256','usage_usd','maximum_usd','authenticated_owner'])
  or p_evidence->'authenticated_owner' is distinct from 'true'::jsonb
  or coalesce(p_evidence->>'build_id','') !~ '^[A-Za-z0-9]{6,64}$' or coalesce(p_evidence->>'response_sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_evidence->>'status','') not in('READY','RUNNING','TIMING-OUT','ABORTING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED')
  or jsonb_typeof(p_evidence->'maximum_usd')<>'string' or coalesce(p_evidence->>'maximum_usd','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$'
  or length(p_evidence->>'maximum_usd')>80
  or (p_evidence->'usage_usd'<>'null'::jsonb and (jsonb_typeof(p_evidence->'usage_usd')<>'string' or (p_evidence->>'usage_usd') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,2})?$' or length(p_evidence->>'usage_usd')>80)) then
  raise exception 'Invalid provider fee evidence' using errcode='PT400';
 end if;
 -- Match hourly admission's policy -> source -> account ordering. No source
 -- or workspace mutations, import, publication, lease or scheduling changes.
 select * into j from public.reader_collection_provider_jobs where id=p_job_id;
 select * into p from public.reader_collection_policies where user_id=j.user_id for update;
 perform 1 from public.reader_collection_source_state where user_id=j.user_id and source_id=j.source_id for update;
 perform 1 from public.collection_budget_accounts where id='source-proof' for update;
 select * into j from public.reader_collection_provider_jobs where id=p_job_id for update;
 select * into r from public.collection_budget_reservations where id=j.reservation_id for update;
 select * into l from public.collection_jobs where id=j.job_id for update;
 -- Replays return the original immutable receipt, even after another correction.
 -- Fresh transport time/hash do not change the economic evidence identity.
 select * into receipt from public.collection_provider_fee_receipts where request_key=p_request_key;
 if receipt.id is not null then
  if receipt.provider_job_id is distinct from p_job_id or receipt.expected is distinct from p_expected
   and p_expected is distinct from public.prepare_late_provider_fee(p_job_id)
   or (receipt.evidence-array['observed_at','response_sha256']) is distinct from (p_evidence-array['observed_at','response_sha256']) then
   raise exception 'Receipt key reused with different evidence' using errcode='PT409';
  end if;
 else
  if p.user_id is null or p_expected is distinct from public.prepare_late_provider_fee(p_job_id)
   or p_evidence->>'run_id' is distinct from r.provider_run_id or p_evidence->>'actor_id' is distinct from r.actor_id then
   raise exception 'Saved provider reference or cash state changed' using errcode='PT409';
  end if;
  begin
   observed:=(p_evidence->>'observed_at')::timestamptz;finished:=(p_evidence->>'finished_at')::timestamptz;
  exception when others then raise exception 'Invalid provider observation time' using errcode='PT400';end;
  if observed is null or not isfinite(observed) or observed>clock_timestamp()+interval'1 second' or observed<clock_timestamp()-interval'60 seconds'
   or finished is not null and(not isfinite(finished) or finished>observed) then raise exception 'Current provider metadata required' using errcode='PT409';end if;
  provider_cap:=(p_evidence->>'maximum_usd')::numeric;
  if provider_cap<>r.maximum_usd then raise exception 'Saved provider cap changed' using errcode='PT409';end if;
  -- Round UP to the cash ledger's 12 decimal places using exact numeric only.
  amount:=ceil((p_evidence->>'usage_usd')::numeric*1000000000000)/1000000000000;
  if amount>=1000000000 then raise exception 'Invalid provider fee magnitude' using errcode='PT400';end if;
  corrected:=r.actual_cost_usd;
  -- A nonfinal observation is still a known lower bound. An observed overrun
  -- must stop admission immediately, even while accounting is preliminary.
  if amount>r.actual_cost_usd then
   select coalesce(sum(case when b.state='held' then b.maximum_usd when b.state='settled' then b.actual_cost_usd else 0 end),0),
    coalesce(sum(case when (a.created_at at time zone'UTC')::date=(j.created_at at time zone'UTC')::date or (b.state='held' and b.launch_attempted_at is not null)
     then case when b.state='held' then b.maximum_usd when b.state='settled' then b.actual_cost_usd else 0 end else 0 end),0)
    into total,daily from public.reader_collection_provider_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.user_id=j.user_id;
   over_cap:=public.collection_budget_committed()+amount-r.actual_cost_usd>(select ceiling_usd from public.collection_budget_accounts where id='source-proof')
    or total+amount-r.actual_cost_usd>p.lifetime_limit_usd or daily+amount-r.actual_cost_usd>p.daily_limit_usd;
  end if;
  if amount>r.maximum_usd or over_cap then reason:='unresolved_over_cap';
  elsif p_evidence->>'status' not in('SUCCEEDED','FAILED','TIMED-OUT','ABORTED') or finished is null or finished>observed-interval'10 seconds' then reason:='unresolved_nonfinal';
  elsif amount is null then reason:='unresolved_missing_fee';
  elsif amount=0 then reason:='unresolved_zero';
  elsif amount<greatest(r.actual_cost_usd,j.observed_cost_usd,l.observed_cost_usd,
   (select max(f.reported_usd) from public.collection_provider_fee_receipts f where f.reservation_id=r.id)) then reason:='unresolved_decrease';
  elsif amount=r.actual_cost_usd then reason:='unchanged';
  else
   delta:=amount-r.actual_cost_usd;reason:='applied';corrected:=amount;
  end if;
  insert into public.collection_provider_fee_receipts(request_key,provider_job_id,reservation_id,provider_run_id,evidence,expected,original_reservation,original_job_finances,original_ledger_finances,previous_usd,reported_usd,corrected_usd,delta_usd,outcome)
   values(p_request_key,j.id,r.id,r.provider_run_id,p_evidence,p_expected,to_jsonb(r),
    jsonb_build_object('actual_cost_usd',j.actual_cost_usd,'observed_cost_usd',j.observed_cost_usd),
    jsonb_build_object('observed_cost_usd',l.observed_cost_usd,'cost_status',l.cost_status,'updated_at',l.updated_at),r.actual_cost_usd,amount,corrected,delta,reason) returning * into receipt;
  if reason='applied' then
   update public.collection_budget_reservations set actual_cost_usd=corrected,updated_at=clock_timestamp() where id=r.id;
   update public.reader_collection_provider_jobs set actual_cost_usd=corrected,observed_cost_usd=corrected where id=j.id;
   update public.collection_jobs set observed_cost_usd=corrected,cost_status='provider_reported' where id=l.id;
  end if;
 end if;
 return jsonb_build_object('id',receipt.id,'request_key',receipt.request_key,'outcome',receipt.outcome,'previous_usd',receipt.previous_usd::text,
  'reported_usd',receipt.reported_usd::text,'corrected_usd',receipt.corrected_usd::text,'delta_usd',receipt.delta_usd::text);
end; $$;

alter table public.collection_retrieval_attempts drop constraint collection_retrieval_attempts_item_key_check;
alter table public.collection_retrieval_attempts add constraint collection_retrieval_attempts_item_key_check check(item_key ~ '^(youtube:[A-Za-z0-9_-]{11}|youtube-discovery:UC[A-Za-z0-9_-]{22}:[0-9]{4}-[0-9]{2}-[0-9]{2}|original:[a-f0-9]{64}|youtube-format:[A-Za-z0-9_-]{11}:[a-f0-9]{64}|youtube-format-v2:[A-Za-z0-9_-]{11}:[a-f0-9]{64})$');
revoke all on function public.metadata_native_capability(jsonb,text) from public,anon,authenticated;
grant execute on function public.metadata_native_capability(jsonb,text) to service_role;
revoke all on function public.metadata_contract_qualified(text) from public,anon,authenticated;
grant execute on function public.metadata_contract_qualified(text) to service_role;
revoke all on function public.metadata_assert_scope(uuid,uuid,uuid,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.metadata_assert_scope(uuid,uuid,uuid,jsonb,boolean,boolean) to service_role;
revoke all on function public.metadata_scope_document(uuid) from public,anon,authenticated;
grant execute on function public.metadata_scope_document(uuid) to service_role;
revoke all on function public.metadata_intent_document(uuid) from public,anon,authenticated;
grant execute on function public.metadata_intent_document(uuid) to service_role;
revoke all on function public.prepare_hourly_metadata_provider(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_hourly_metadata_provider(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.reserve_hourly_metadata_provider(uuid,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_hourly_metadata_provider(uuid,uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
revoke all on function public.pending_hourly_metadata_providers(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pending_hourly_metadata_providers(uuid,uuid,jsonb) to service_role;
revoke all on function public.read_hourly_metadata_intent(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_hourly_metadata_intent(uuid,jsonb) to service_role;
revoke all on function public.assert_hourly_metadata_dispatch(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assert_hourly_metadata_dispatch(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.record_hourly_metadata_observation(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_hourly_metadata_observation(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
revoke all on function public.finish_hourly_metadata_provider(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_hourly_metadata_provider(uuid,uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.accept_hourly_metadata_qualification(text,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.accept_hourly_metadata_qualification(text,uuid[],jsonb) to service_role;
revoke all on function public.revoke_hourly_metadata_qualification(text,text) from public,anon,authenticated;
grant execute on function public.revoke_hourly_metadata_qualification(text,text) to service_role;
revoke all on function public.reserve_hourly_caption_provider(uuid,uuid,text,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.reserve_hourly_caption_provider(uuid,uuid,text,uuid,text,numeric,uuid) to service_role;
commit;
