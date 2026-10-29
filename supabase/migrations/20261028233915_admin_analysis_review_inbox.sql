-- Private compact human review. No provider, budget or collection activation.
begin;

create table public.admin_analysis_prompt_receipts (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.reader_content_analysis_jobs(id) on delete cascade,
 call_key text not null check(char_length(call_key) between 1 and 160),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 model text not null check(char_length(model) between 1 and 160),
 captured_for_attempt integer not null default 1 check(captured_for_attempt between 1 and 3),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=500000),
 source_snapshot jsonb check(source_snapshot is null or jsonb_typeof(source_snapshot)='object'),
 created_at timestamptz not null default clock_timestamp(),
 unique(job_id,call_key)
);
alter table public.admin_analysis_prompt_receipts enable row level security;
revoke all on public.admin_analysis_prompt_receipts from public,anon,authenticated,service_role;
grant select,insert,delete on public.admin_analysis_prompt_receipts to service_role;

create function public.admin_analysis_prompt_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Recorded requests are immutable' using errcode='PT409';end;
$$;
create trigger admin_analysis_prompt_immutable before update on public.admin_analysis_prompt_receipts
 for each row execute function public.admin_analysis_prompt_immutable();

create function public.record_admin_analysis_prompt(p_job_id uuid,p_lease_token uuid,p_request_hash text,p_model text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs;a public.reader_source_updates;w public.reader_workspaces;
 prior public.admin_analysis_prompt_receipts;c public.reader_content_analysis_calls;first_source jsonb;key text;planned_attempt integer:=1;
begin
 if p_job_id is null or p_lease_token is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
  or p_model is null or char_length(p_model) not between 1 and 160 or jsonb_typeof(p_request) is distinct from 'object'
  or octet_length(p_request::text)>500000 or jsonb_typeof(p_request->'key') is distinct from 'string'
  or char_length(p_request->>'key') not between 1 and 160 or jsonb_typeof(p_request->'system') is distinct from 'string'
  or jsonb_typeof(p_request->'prompt') is distinct from 'string' then raise exception 'Invalid actual request snapshot' using errcode='PT400';end if;
 key:=p_request->>'key';
 select * into j from public.reader_content_analysis_jobs where id=p_job_id;
 if not found then raise exception 'Analysis no longer exists' using errcode='PT409';end if;
 select * into w from public.reader_workspaces where user_id=j.user_id for key share;
 select * into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id for share;
 select * into j from public.reader_content_analysis_jobs where id=p_job_id for update;
 if j.id is null or w.user_id is null or a.id is null or j.state<>'running' or j.lease_token is distinct from p_lease_token
  or j.lease_until is null or j.lease_until<=clock_timestamp() or a.source_id is distinct from j.source_id
  or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from j.content_hash
  or public.content_analysis_source_revision(a.record) is distinct from j.source_revision
  or public.content_analysis_source_fingerprint(w.state,a.source_id) is distinct from j.source_fingerprint then
  raise exception 'Analysis source or lease changed' using errcode='PT409';end if;
 -- Keep native cache/hold/authorized-zero-retry semantics before any reservation.
 select *into c from public.reader_content_analysis_calls where job_id=j.id and call_key=key;
 if c.id is not null then
  if c.result is not null then
   return jsonb_build_object('recorded',false,'cached',coalesce(c.request_hash,c.result->>'requestHash')=p_request_hash and c.model=p_model,'reason','historical_prompt_unavailable');
  end if;
  if c.model=p_model and c.request_hash=p_request_hash and c.source_revision=j.source_revision
   and c.actual_usd=0 and c.observed_usd=0 and c.rejection_receipt is not null and c.generation_receipt is not null then
   if c.attempt_number>=3 then return jsonb_build_object('recorded',false,'blockedReason','analysis_provider_retry_exhausted');end if;
   if c.retry_authorized and c.retry_authorization_receipt is not null then planned_attempt:=c.attempt_number+1;
   else return jsonb_build_object('recorded',false,'blockedReason','analysis_unknown_charge_hold');end if;
  else return jsonb_build_object('recorded',false,'blockedReason','analysis_unknown_charge_hold');end if;
 end if;
 select * into prior from public.admin_analysis_prompt_receipts where job_id=j.id and call_key=key;
 if found then
  if prior.request_hash<>p_request_hash or prior.model<>p_model or prior.request<>p_request or prior.captured_for_attempt>planned_attempt then
   raise exception 'Recorded request changed' using errcode='PT409';end if;
  return jsonb_build_object('recorded',true,'replayed',true,'capturedForAttempt',prior.captured_for_attempt);
 end if;
 if not exists(select 1 from public.admin_analysis_prompt_receipts where job_id=j.id) then first_source:=a.record;end if;
 insert into public.admin_analysis_prompt_receipts(job_id,call_key,request_hash,model,captured_for_attempt,request,source_snapshot)
 values(j.id,key,p_request_hash,p_model,planned_attempt,p_request,first_source);
 return jsonb_build_object('recorded',true,'replayed',false,'capturedForAttempt',planned_attempt);
end;
$$;

create table public.admin_analysis_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id text not null references public.reader_workspaces(user_id) on delete cascade,
 update_id text not null,source_id text not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('keyword','recap')),
 dedupe_key text not null unique check(char_length(dedupe_key) between 1 and 400),
 source_snapshot jsonb check(source_snapshot is null or jsonb_typeof(source_snapshot)='object'),
 annotation_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(annotation_snapshot)='object'),
 proposal jsonb not null default '{}'::jsonb check(jsonb_typeof(proposal)='object' and octet_length(proposal::text)<=500000),
 reason text not null check(char_length(reason) between 1 and 2000),
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object' and octet_length(provenance::text)<=2000000),
 job_id uuid,
 legacy_keyword_review_id uuid references public.admin_keyword_reviews(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 resolved jsonb check(resolved is null or jsonb_typeof(resolved)='object'),
 resolved_by text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(user_id,update_id) references public.reader_source_updates(user_id,id) on delete cascade,
 check((status='pending' and resolved is null and resolved_by is null)or(status<>'pending' and resolved is not null and resolved_by is not null))
);
create index admin_analysis_reviews_queue on public.admin_analysis_reviews(status,created_at desc,id desc);
create index admin_analysis_reviews_source on public.admin_analysis_reviews(user_id,update_id,content_hash);
alter table public.admin_analysis_reviews enable row level security;
revoke all on public.admin_analysis_reviews from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.admin_analysis_reviews to service_role;

create function public.admin_analysis_review_validate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.reader_source_updates;
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['status','resolved','resolved_by','updated_at','legacy_keyword_review_id']) is distinct from
   (to_jsonb(old)-array['status','resolved','resolved_by','updated_at','legacy_keyword_review_id']) then
   raise exception 'Original review evidence is immutable' using errcode='PT400';end if;
  if old.status<>'pending' and (new.status,new.resolved,new.resolved_by) is distinct from (old.status,old.resolved,old.resolved_by) then
   raise exception 'Review already decided' using errcode='PT409';end if;
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');return new;
 end if;
 select * into a from public.reader_source_updates where user_id=new.user_id and id=new.update_id;
 if a.id is null or a.source_id is distinct from new.source_id then raise exception 'Review source is unavailable' using errcode='PT409';end if;
 if new.status<>'pending' or new.resolved is not null or new.resolved_by is not null then raise exception 'New reviews must be pending' using errcode='PT400';end if;
 if new.source_snapshot is not null and (jsonb_typeof(new.source_snapshot->'content') is distinct from 'string'
  or encode(sha256(convert_to(new.source_snapshot->>'content','UTF8')),'hex') is distinct from new.content_hash) then
  raise exception 'Exact original source snapshot is required' using errcode='PT400';end if;
 new.annotation_snapshot:=case when new.kind='recap' then jsonb_build_object('videoHighlights',a.record->'videoHighlights','videoSummary',a.record->'videoSummary')else '{}'::jsonb end;
 new.created_at:=clock_timestamp();new.updated_at:=new.created_at;return new;
end;
$$;
create trigger admin_analysis_review_validate before insert or update on public.admin_analysis_reviews
 for each row execute function public.admin_analysis_review_validate();

create view public.admin_analysis_review_queue with(security_invoker=true) as
 select r.id,'analysis'::text as origin,r.kind,r.status,r.proposal,r.reason,r.updated_at,r.created_at,
 coalesce(r.source_snapshot->>'title',a.record->>'title','')as source_title,
 coalesce(r.source_snapshot->>'url',a.record->>'url','')as source_url
 from public.admin_analysis_reviews r join public.reader_source_updates a on a.user_id=r.user_id and a.id=r.update_id
 where not(r.status='pending'and r.kind='keyword'and exists(select 1 from public.admin_keyword_reviews q where q.user_id=r.user_id and q.update_id=r.update_id and q.content_hash=r.content_hash and (q.normalized_label=public.keyword_review_label_key(r.proposal->>'label')or(q.status='approved'and public.keyword_review_label_key(q.resolved_label)=public.keyword_review_label_key(r.proposal->>'label')))and q.status<>'pending'))
 union all
 select q.id,'legacy_keyword'::text,'keyword'::text,q.status,jsonb_build_object('label',q.label,'kind',q.kind),q.reason,q.updated_at,q.created_at,q.update_title,q.update_url
 from public.admin_keyword_reviews q where not exists(select 1 from public.admin_analysis_reviews r where
  r.legacy_keyword_review_id=q.id or((q.status='pending'or r.status<>'pending')and r.user_id=q.user_id and r.update_id=q.update_id and r.content_hash=q.content_hash
   and r.kind='keyword' and (public.keyword_review_label_key(r.proposal->>'label')=q.normalized_label or(q.status='approved'and public.keyword_review_label_key(r.proposal->>'label')=public.keyword_review_label_key(q.resolved_label)))));
revoke all on public.admin_analysis_review_queue from public,anon,authenticated,service_role;
grant select on public.admin_analysis_review_queue to service_role;

create function public.admin_decide_analysis_review(p_id uuid,p_expected timestamptz,p_admin text,p_decision text,p_proposal jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.admin_analysis_reviews;a public.reader_source_updates;q public.admin_keyword_reviews;
 chosen jsonb;point jsonb;selected jsonb:='[]';highlights jsonb:='[]';patch jsonb;prepared jsonb;proc jsonb;
 label text;kind text;old_label text;quote text;source_snapshot jsonb;utf16_length integer;published boolean:=false;
begin
 if p_id is null or p_expected is null or p_admin is null or char_length(p_admin) not between 1 and 200
  or p_decision is null or p_decision not in('approve','reject') then raise exception 'Invalid review decision' using errcode='PT400';end if;
 select * into r from public.admin_analysis_reviews where id=p_id;
 if not found then raise exception 'Review no longer exists' using errcode='PT409';end if;
 perform 1 from public.reader_workspaces where user_id=r.user_id for key share;
 if not found then raise exception 'Reader workspace no longer exists' using errcode='PT409';end if;
 select * into a from public.reader_source_updates where user_id=r.user_id and id=r.update_id for update;
 select * into r from public.admin_analysis_reviews where id=p_id for update;
 if r.id is null or a.id is null or r.status<>'pending' or r.updated_at is distinct from p_expected then
  raise exception 'Review changed; reload before saving' using errcode='PT409';end if;
 chosen:=coalesce(p_proposal,r.proposal);
 if jsonb_typeof(chosen) is distinct from 'object' or octet_length(chosen::text)>500000 then raise exception 'Invalid edited proposal' using errcode='PT400';end if;
 source_snapshot:=r.source_snapshot;
 if source_snapshot is null and r.job_id is not null then select p.source_snapshot into source_snapshot from public.admin_analysis_prompt_receipts p
  where p.job_id=r.job_id and p.source_snapshot is not null order by p.created_at,p.id limit 1;end if;
 if p_decision='approve' then
  if source_snapshot is null or jsonb_typeof(a.record->'content')is distinct from'string' or coalesce(a.record->>'contentKind','')not in('transcript','feed_text')
   or encode(sha256(convert_to(source_snapshot->>'content','UTF8')),'hex') is distinct from r.content_hash
   or encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') is distinct from r.content_hash or a.source_id is distinct from r.source_id then
   raise exception 'Source changed or original text unavailable; review fresh evidence' using errcode='PT409';end if;
 end if;
 if r.kind='keyword' then
  if p_decision='approve' then
   label:=btrim(chosen->>'label');kind:=chosen->>'kind';
   if (chosen-array['label','kind'])<>'{}'::jsonb or jsonb_typeof(chosen->'label') is distinct from 'string'
    or char_length(label) not between 1 and 100 or label ~ '[[:cntrl:]]' or kind is null or kind not in('brand','product','game','technology','category')
    or strpos(regexp_replace(a.record->>'content','[[:space:]]+',' ','g'),label)=0 then
    raise exception 'Use a literal keyword from this transcript and a valid type' using errcode='PT400';end if;
   chosen:=jsonb_build_object('label',label,'kind',kind);
  end if;
  old_label:=coalesce(nullif(btrim(r.proposal->>'label'),''),label);
  -- Reuse the existing human keyword decisions so retries retain the decision.
  if old_label is not null and source_snapshot is not null
   and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=r.content_hash then
   select * into q from public.admin_keyword_reviews where user_id=r.user_id and update_id=r.update_id
    and content_hash=r.content_hash and normalized_label=public.keyword_review_label_key(old_label)for update;
   if q.id is null then
    quote:=case when strpos(source_snapshot->>'content',old_label)>0 then substring(source_snapshot->>'content'from greatest(1,strpos(source_snapshot->>'content',old_label)-200)for least(1000,char_length(old_label)+400))else left(source_snapshot->>'content',1000)end;
    insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
     values(r.user_id,r.update_id,r.source_id,r.content_hash,old_label,coalesce(kind,case when r.proposal->>'kind'in('brand','product','game','technology','category')then r.proposal->>'kind'else'category'end),0,r.reason,quote,'[]',coalesce(a.record->>'title',''),coalesce(a.record->>'url',''))returning *into q;
   end if;
   if q.status<>'pending' then raise exception 'An administrator already decided this keyword; reload' using errcode='PT409';end if;
   if p_decision='approve'then
    perform public.admin_review_keyword(q.id,q.updated_at,p_admin,p_decision,label,kind);
   else
    perform public.admin_review_keyword_before_content_processing(q.id,q.updated_at,p_admin,p_decision,old_label,q.kind);
   end if;
   update public.admin_analysis_reviews set legacy_keyword_review_id=q.id where id=r.id;
  end if;
  if p_decision='approve' then
   -- An individual approval must not bless unknown older labels as a fresh batch.
   -- A genuinely empty prior batch can display its one source-proved manual label,
   -- while remaining in review rather than claiming exhaustive automatic coverage.
   if jsonb_array_length(coalesce(a.record->'videoKeywords','[]'::jsonb))=0
    and jsonb_array_length(coalesce(a.record->'topics','[]'::jsonb))=0
    and jsonb_array_length(coalesce(a.record->'brands','[]'::jsonb))=0 then
    proc:=public.content_analysis_processing((select record from public.reader_source_updates where user_id=r.user_id and id=r.update_id),r.content_hash);
    update public.reader_source_updates set record=record||jsonb_build_object('keywordRuleVersion','entities-v2','keywordContentHash',r.content_hash,
     'processing',proc||jsonb_build_object('keywords','review'))where user_id=r.user_id and id=r.update_id;
   end if;published:=true;
  end if;
 elsif p_decision='approve' then
  if (chosen-'highlights')<>'{}'::jsonb or jsonb_typeof(chosen->'highlights') is distinct from 'array' or jsonb_array_length(chosen->'highlights')not between 1 and 6 then
   raise exception 'A recap needs one to six source-supported points' using errcode='PT400';end if;
  if r.annotation_snapshot is distinct from jsonb_build_object('videoHighlights',a.record->'videoHighlights','videoSummary',a.record->'videoSummary')then
   raise exception 'Reader recap changed; reload before replacing it' using errcode='PT409';end if;
  for point in select value from jsonb_array_elements(chosen->'highlights')loop
   if jsonb_typeof(point)is distinct from'object'or(point-array['text','evidenceQuote'])<>'{}'::jsonb then raise exception 'Invalid recap point'using errcode='PT400';end if;
   highlights:=highlights||jsonb_build_array(jsonb_build_object('text',point->>'text'));
   selected:=selected||jsonb_build_array(jsonb_build_object('text',point->>'text','evidenceQuote',point->>'evidenceQuote'));
  end loop;
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer into utf16_length from regexp_split_to_table(a.record->>'content','')ch;
  patch:=jsonb_build_object('videoHighlights',highlights,'videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',r.content_hash,'timingBasis','none'));
  prepared:=jsonb_build_object('state','ready','patch',patch,'pending','[]'::jsonb,'evidence',jsonb_build_object('contentHash',r.content_hash,'coverage',jsonb_build_array(jsonb_build_object('start',0,'end',utf16_length)),'selected',selected));
  perform public.validate_content_analysis_result('summary',prepared,a.record,r.content_hash);
  -- Record the explicit manual approval before writing, for the preservation trigger below.
  update public.admin_analysis_reviews set status='approved',resolved=chosen,resolved_by=p_admin where id=r.id;
  proc:=public.content_analysis_processing(a.record,r.content_hash)||jsonb_build_object('recap','ready');
  update public.reader_source_updates set record=record||patch||jsonb_build_object('processing',proc)where user_id=r.user_id and id=r.update_id;published:=true;
 end if;
 if not(r.kind='recap'and p_decision='approve')then
  update public.admin_analysis_reviews set status=case when p_decision='approve'then'approved'else'rejected'end,resolved=chosen,resolved_by=p_admin where id=r.id;
 end if;
 select *into r from public.admin_analysis_reviews where id=p_id;
 insert into public.admin_audit_events(admin_id,action,target_id,details)values(p_admin,'analysis.review.'||r.status,r.id::text,
  jsonb_build_object('kind',r.kind,'contentHash',r.content_hash,'manualSourceReview',true,'published',published,'edited',chosen is distinct from r.proposal));
 return jsonb_build_object('record',to_jsonb(r),'published',published);
end;
$$;

create function public.admin_analysis_preserve_reviewed_recap()returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.admin_analysis_reviews;h text;points jsonb;
begin
 if jsonb_typeof(new.record->'content')is distinct from'string'then return new;end if;
 h:=encode(sha256(convert_to(new.record->>'content','UTF8')),'hex');
 select *into r from public.admin_analysis_reviews where user_id=new.user_id and update_id=new.id and content_hash=h
  and source_id=new.source_id and kind='recap'and status='approved'order by updated_at desc,id desc limit 1;
 if r.id is null then return new;end if;
 select jsonb_agg(jsonb_build_object('text',p->>'text')order by ord)into points from jsonb_array_elements(r.resolved->'highlights')with ordinality e(p,ord);
 new.record:=new.record||jsonb_build_object('videoHighlights',points,'videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',h,'timingBasis','none'));
 new.record:=new.record||jsonb_build_object('processing',public.content_analysis_processing(new.record,h)||jsonb_build_object('recap','ready'));return new;
end;
$$;
create trigger admin_analysis_preserve_reviewed_recap before update of record on public.reader_source_updates
 for each row execute function public.admin_analysis_preserve_reviewed_recap();

create function public.capture_admin_analysis_review(p_job_id uuid)returns integer
language plpgsql security invoker set search_path='' as $$
declare j public.reader_content_analysis_jobs;a public.reader_source_updates;snapshot jsonb;prompts jsonb;prov jsonb;proposal jsonb;candidate jsonb;
 reason text;dedupe text;added integer:=0;n integer;
begin
 select *into j from public.reader_content_analysis_jobs where id=p_job_id;if j.id is null then return 0;end if;
 if j.state not in('failed','blocked','prepared','published','evaluated')then return 0;end if;
 if j.state not in('failed','blocked')and (case when jsonb_typeof(j.result->'pending')='array'then jsonb_array_length(j.result->'pending')else 0 end)=0
  and coalesce(j.result->>'state','')<>'review'then return 0;end if;
 select *into a from public.reader_source_updates where user_id=j.user_id and id=j.update_id;if a.id is null then return 0;end if;
 select p.source_snapshot into snapshot from public.admin_analysis_prompt_receipts p where p.job_id=j.id and p.source_snapshot is not null order by p.created_at,p.id limit 1;
 if snapshot is null and encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=j.content_hash then snapshot:=a.record;end if;
 select coalesce(jsonb_agg(p.id order by p.created_at,p.id),'[]'::jsonb)into prompts from public.admin_analysis_prompt_receipts p
  join public.reader_content_analysis_calls c on c.job_id=p.job_id and c.call_key=p.call_key and c.request_hash=p.request_hash and c.model=p.model and c.attempt_number>=p.captured_for_attempt
  where p.job_id=j.id and(c.result_at is not null or c.provider_id is not null or c.result is not null);
 prov:=jsonb_build_object('origin','analysis_job','jobId',j.id,'availability',case when jsonb_array_length(prompts)>0 then'recorded'else'unavailable'end,
  'promptReceiptIds',prompts,'prompts','[]'::jsonb,
  'message',case when jsonb_array_length(prompts)>0 then null when exists(select 1 from public.admin_analysis_prompt_receipts p where p.job_id=j.id)
   then'A request was saved, but no completed model response was recorded.'else'The original generation prompt was not saved.'end);
 reason:=left(coalesce(nullif(j.error_code,''),case when j.task='summary'then'Recap needs source review'else'Keyword needs source review'end),2000);
 dedupe:='job:'||j.id||':'||j.attempts||':'||encode(sha256(convert_to(coalesce(j.result,'null'::jsonb)::text||coalesce(j.error_code,''),'UTF8')),'hex');
 if j.task='keywords'and jsonb_typeof(j.result->'pending')='array'and jsonb_array_length(j.result->'pending')>0 then
  for candidate in select value from jsonb_array_elements(j.result->'pending')loop
   if jsonb_typeof(candidate->'label')is distinct from'string'then continue;end if;
   if exists(select 1 from public.admin_keyword_reviews prior where prior.user_id=j.user_id and prior.update_id=j.update_id and prior.content_hash=j.content_hash
    and (prior.normalized_label=public.keyword_review_label_key(candidate->>'label')or(prior.status='approved'and public.keyword_review_label_key(prior.resolved_label)=public.keyword_review_label_key(candidate->>'label')))and prior.status<>'pending')then continue;end if;
   proposal:=jsonb_build_object('label',candidate->>'label','kind',case when candidate->>'kind'in('brand','product','game','technology','category')then candidate->>'kind'else'category'end);
   insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance,job_id)
    values(j.user_id,j.update_id,j.source_id,j.content_hash,'keyword',dedupe||':'||encode(sha256(convert_to(candidate->>'label','UTF8')),'hex'),snapshot,proposal,left(coalesce(nullif(candidate->>'reason',''),reason),2000),prov,j.id)
    on conflict(dedupe_key)do nothing;get diagnostics n=row_count;added:=added+n;
  end loop;
 else
  proposal:='{}';
  if j.task='summary'and jsonb_typeof(j.result#>'{patch,videoHighlights}')='array'then
   select jsonb_build_object('highlights',coalesce(jsonb_agg(jsonb_build_object('text',point->>'text','evidenceQuote',coalesce((select item->>'evidenceQuote'from jsonb_array_elements(case when jsonb_typeof(j.result#>'{evidence,selected}')='array'then j.result#>'{evidence,selected}'else'[]'::jsonb end)item where item->>'text'=point->>'text'limit 1),''))order by ord),'[]'::jsonb))into proposal
    from jsonb_array_elements(j.result#>'{patch,videoHighlights}')with ordinality e(point,ord);
  end if;
  insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance,job_id)
   values(j.user_id,j.update_id,j.source_id,j.content_hash,case when j.task='summary'then'recap'else'keyword'end,dedupe,snapshot,proposal,reason,prov,j.id)
   on conflict(dedupe_key)do nothing;get diagnostics added=row_count;
 end if;return added;
end;
$$;
create function public.capture_admin_analysis_review_trigger()returns trigger
language plpgsql security invoker set search_path=''as $$begin perform public.capture_admin_analysis_review(new.id);return new;end;$$;
create trigger admin_analysis_review_capture after insert or update of state,result,error_code on public.reader_content_analysis_jobs
 for each row execute function public.capture_admin_analysis_review_trigger();
create function public.sync_admin_analysis_reviews(p_user_id text default null,p_limit integer default 500)returns jsonb
language plpgsql security invoker set search_path=''as $$
declare j record;added integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid review sync limit'using errcode='PT400';end if;
 for j in select id from public.reader_content_analysis_jobs where(p_user_id is null or user_id=p_user_id)and state in('failed','blocked','prepared','published','evaluated')order by created_at,id limit p_limit loop
  added:=added+public.capture_admin_analysis_review(j.id);
 end loop;return jsonb_build_object('captured',added);
end;$$;

-- Read large exact prompts three at a time; the queue never copies them per item.
create function public.read_admin_analysis_review_prompts(p_review_id uuid,p_page integer default 0)returns jsonb
language plpgsql security invoker set search_path=''as $$
declare r public.admin_analysis_reviews;answer jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 then raise exception 'Invalid prompt page'using errcode='PT400';end if;
 select *into r from public.admin_analysis_reviews where id=p_review_id;
 if r.id is null then raise exception 'Review no longer exists'using errcode='PT409';end if;
 with actual as materialized(
  select p.id,p.created_at,p.model,p.request,p.request_hash from public.admin_analysis_prompt_receipts p
   join public.reader_content_analysis_calls c on c.job_id=p.job_id and c.call_key=p.call_key and c.request_hash=p.request_hash and c.model=p.model and c.attempt_number>=p.captured_for_attempt
   where p.job_id=r.job_id and(c.result_at is not null or c.provider_id is not null or c.result is not null)
    and case when jsonb_typeof(r.provenance->'promptReceiptIds')='array'then(r.provenance->'promptReceiptIds')?p.id::text else p.created_at<=r.created_at end
 ),page as(select *from actual order by created_at,id limit 3 offset p_page*3)
 select jsonb_build_object('prompts',coalesce((select jsonb_agg(jsonb_build_object('role',request->>'role','model',model,'system',request->>'system','prompt',request->>'prompt','requestHash',request_hash)order by created_at,id)from page),'[]'::jsonb),
  'total',(select count(*)from actual),'page',p_page,'pageSize',3)into answer;return answer;
end;$$;

revoke all on function public.admin_analysis_prompt_immutable(),public.record_admin_analysis_prompt(uuid,uuid,text,text,jsonb),public.admin_analysis_review_validate(),
 public.admin_decide_analysis_review(uuid,timestamptz,text,text,jsonb),public.admin_analysis_preserve_reviewed_recap(),public.capture_admin_analysis_review(uuid),
 public.capture_admin_analysis_review_trigger(),public.sync_admin_analysis_reviews(text,integer),public.read_admin_analysis_review_prompts(uuid,integer)from public,anon,authenticated;
grant execute on function public.admin_analysis_prompt_immutable(),public.record_admin_analysis_prompt(uuid,uuid,text,text,jsonb),public.admin_analysis_review_validate(),
 public.admin_decide_analysis_review(uuid,timestamptz,text,text,jsonb),public.admin_analysis_preserve_reviewed_recap(),public.capture_admin_analysis_review(uuid),
 public.capture_admin_analysis_review_trigger(),public.sync_admin_analysis_reviews(text,integer),public.read_admin_analysis_review_prompts(uuid,integer)to service_role;
commit;
