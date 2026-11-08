-- Synthetic disposable-only records. No real reader, source, credential or job.
-- Do not execute this fixture on an existing database.
insert into public.reader_workspaces(user_id,state)
select 'synthetic-owner-'||n,jsonb_build_object('version',1,'followedSourceIds',jsonb_build_array('synthetic-source'),
 'savedUpdateIds',jsonb_build_array('synthetic-update'),'readLaterIds','[]'::jsonb,'importedUpdates','[]'::jsonb,
 'customSources',jsonb_build_array(jsonb_build_object('id','synthetic-source','name','Synthetic source','platform','YouTube','url','https://www.youtube.com/@synthetic','status','ready')),
 'settings',jsonb_build_object('emailReminder',false))from generate_series(1,3)n;
insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
select user_id,'synthetic-update','synthetic-source','synthetic-collection','2026-11-07T00:00:00Z',jsonb_build_object(
 'id','synthetic-update','sourceId','synthetic-source','title','Synthetic preserved original',
 'url','https://www.youtube.com/watch?v=abcdeFGHI12','publishedAt','2026-11-07T00:00:00Z',
 'content','Synthetic offline source content for preservation checks.','contentKind','transcript','format','video','isSample',false)
from public.reader_workspaces;
insert into public.reader_collection_policies(user_id,enabled,provider_enabled)select user_id,false,false from public.reader_workspaces;
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
select user_id,false,1,10,.1,'synthetic-model'from public.reader_workspaces;
insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,workspace_revision,task,state,result)
select '20000000-0000-4000-8000-000000000001','synthetic-owner-1','synthetic-update','synthetic-source',repeat('a',64),repeat('b',64),'synthetic-fingerprint',updated_at,'summary','blocked','{"synthetic":true}'
from public.reader_workspaces where user_id='synthetic-owner-1';
insert into public.reader_content_analysis_calls(id,job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,observed_usd,actual_usd,state,result,usage,provider_id)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=1 then '20000000-0000-4000-8000-000000000001'::uuid end,
 'synthetic-owner-1','synthetic-call-'||n,'40000000-0000-4000-8000-000000000001','synthetic-model',repeat('b',64),.012345678901,.003,null,'unknown',
 '{"synthetic":true}','{"total_tokens":17}','synthetic-model-run-'||n from generate_series(1,7)n;
insert into public.collection_budget_reservations(id,request_key,kind,maximum_usd,provider,actor_id,provider_run_id,state,launch_attempted_at)
select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-reservation-'||n,'job',.005,'apify','syntheticActor','SyntheticRun'||n,'held','2026-11-07T00:00:00Z'
from generate_series(1,19)n;
insert into public.collection_jobs(id,user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status)
values('60000000-0000-4000-8000-000000000001','synthetic-owner-1','synthetic-source','Synthetic source','https://www.youtube.com/@synthetic','YouTube','apify','syntheticActor','SyntheticRun1','running');
insert into public.reader_collection_checks(id,user_id,source_id,source_name,source_url,platform,provider,job_id,provider_run_id,observed_cost_usd,cost_status,details)
values('70000000-0000-4000-8000-000000000001','synthetic-owner-1','synthetic-source','Synthetic source','https://www.youtube.com/@synthetic','YouTube','apify','60000000-0000-4000-8000-000000000001','SyntheticRun1',null,'unknown','{"synthetic":true}');
insert into public.reader_collection_source_state(user_id,source_id,fingerprint,pending_captions,cursor,check_id)
values('synthetic-owner-1','synthetic-source','synthetic-fingerprint','[{"synthetic":true}]','{"pendingOriginals":[{"synthetic":true}]}','70000000-0000-4000-8000-000000000001');
insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,provider_run_id,content_pending)
values('synthetic-owner-1','synthetic-source','youtube:abcdeFGHI12','synthetic-fingerprint','70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','syntheticActor',.005,'running','SyntheticRun1',true);
-- A separate already-corrected receipt is outside the nineteen unknown holds.
insert into public.collection_budget_reservations(id,request_key,kind,maximum_usd,provider,actor_id,provider_run_id,state,actual_cost_usd,launch_attempted_at,completed_at)
values('50000000-0000-4000-8000-000000000020','synthetic-corrected','job',.005,'apify','syntheticActor','SyntheticCorrected','settled',.004,'2026-11-07T00:00:00Z','2026-11-07T00:01:00Z');
insert into public.collection_jobs(id,user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status,observed_cost_usd,cost_status)
values('60000000-0000-4000-8000-000000000020','synthetic-owner-1','synthetic-source','Synthetic source','https://www.youtube.com/@synthetic','YouTube','apify','syntheticActor','SyntheticCorrected','succeeded',.004,'provider_reported');
insert into public.reader_collection_provider_jobs(id,user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,provider_run_id,actual_cost_usd)
values('61000000-0000-4000-8000-000000000020','synthetic-owner-1','synthetic-source','youtube:abcdefghijk','synthetic-fingerprint','70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000020','50000000-0000-4000-8000-000000000020','syntheticActor',.005,'completed','SyntheticCorrected',.004);
insert into public.collection_provider_fee_receipts(request_key,provider_job_id,reservation_id,provider_run_id,evidence,expected,original_reservation,original_job_finances,original_ledger_finances,previous_usd,reported_usd,corrected_usd,delta_usd,outcome)
values('synthetic-fee-receipt','61000000-0000-4000-8000-000000000020','50000000-0000-4000-8000-000000000020','SyntheticCorrected','{"synthetic":true}','{"synthetic":true}','{"synthetic":true}','{"synthetic":true}','{"synthetic":true}',0,.004,.004,.004,'applied');
insert into public.admin_audit_events(admin_id,action,details)values('synthetic-operator','synthetic.preservation','{"synthetic":true}');
insert into public.automatic_content_policies(user_id,enabled,starts_at)values('synthetic-owner-1',false,'2026-11-06T00:00:00Z');
insert into public.automatic_content_tasks(user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,source_snapshot,task,state)
select user_id,id,source_id,encode(sha256(convert_to(record->>'content','UTF8')),'hex'),public.content_analysis_source_revision(record),repeat('c',64),record,'recap','blocked'
from public.reader_source_updates where user_id='synthetic-owner-1';
insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until)
values('cron:automatic-content:4:1794000000000','automatic-content',4,'182457410f7f8e979348d10347fe50b1e94b295b','uncertain','80000000-0000-4000-8000-000000000001','2026-11-07T00:00:00Z');
insert into public.hosting_queue_invocations(key,message_id,queue_name,control_revision,frame,bound_policy,recorded_at,not_after)
values('cron:automatic-content:4:1794000000000','SyntheticMessage1','therecap-jobs','90000000-0000-4000-8000-000000000001','{"synthetic":true}','cloudflare-queue-wall-15m-plus-2m-v1','2026-11-07T00:00:00Z','2026-11-07T00:17:00Z');
insert into public.hosting_transport_dispositions(key,recovery_id,disposition,original_frame,control_snapshot,native_evidence,domain_evidence)
values('cron:automatic-content:4:1794000000000','90000000-0000-4000-8000-000000000002','expired_outcome_unknown','{"synthetic":true}','{"synthetic":true}','{"synthetic":true}','{"synthetic":true}');
update public.hosting_runtime_control set owner='cloudflare',epoch=4,paused=true,old_host_fenced=true,
 release='182457410f7f8e979348d10347fe50b1e94b295b',release_revision='90000000-0000-4000-8000-000000000001';
