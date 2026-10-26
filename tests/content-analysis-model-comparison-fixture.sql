-- Synthetic DATABASE-ONLY twelve-row legacy ledger. No private source data.
insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)
 values(true,false,5,5) on conflict(id) do update set enabled=false,daily_limit_usd=5,lifetime_limit_usd=5;
insert into public.reader_workspaces(user_id,state) values('generation-v3-owner',
 '{"version":1,"followedSourceIds":["fixture-source"],"customSources":[{"id":"fixture-source","name":"Synthetic source","url":"https://example.org/channel","platform":"YouTube","status":"ready","creatorIds":[]}],"savedUpdateIds":[],"readLaterIds":[],"importedUpdates":[],"settings":{}}');
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
 values('generation-v3-owner',false,5,5,0.01,'deepseek/deepseek-v4.1-flash-1017');
do $$
declare n integer; rec jsonb; ids uuid[]:='{}'; chosen uuid; call_number integer; cost numeric;
begin
 for n in 1..4 loop
  rec:=jsonb_build_object('id','fixture-video-'||n,'sourceId','fixture-source','publishedAt','2026-10-24T00:00:00Z',
   'url','https://example.org/video/'||n,'title','Synthetic source','isSample',false,'format','video','contentKind','transcript',
   'content','Synthetic full original fixture words for old protocol preservation.','videoFormat','{"kind":"regular","basis":"watch_page"}'::jsonb,'topics','[]'::jsonb,'brands','[]'::jsonb);
  insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
   values('generation-v3-owner',rec->>'id','fixture-source','fixture','2026-10-24T00:00:00Z',rec);
 end loop;
 perform public.sync_content_analysis_jobs('generation-v3-owner',200);
 for chosen in select id from public.reader_content_analysis_jobs where user_id='generation-v3-owner'
  order by update_id,task limit 7 loop ids:=array_append(ids,chosen); end loop;
 delete from public.reader_content_analysis_jobs where user_id='generation-v3-owner' and not (id=any(ids));
 for call_number in 1..12 loop
  chosen:=ids[case when call_number<=3 then call_number else 1+(call_number-4)%7 end];
  cost:=case when call_number<=3 then null when call_number<12 then .001 else .001187716 end;
  insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,
   actual_usd,observed_usd,state,result,usage,provider_id,result_at,settled_at)
   select id,user_id,'legacy:fixture:'||call_number,gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',source_revision,
    case when call_number<=3 then .003059397 else .002 end,cost,cost,
    case when cost is null then 'unknown' else 'settled' end,
    case when cost is null then null else jsonb_build_object('value',jsonb_build_object('fixture','invalid-'||call_number)) end,
    case when cost is null then null else '{"inputTokens":10,"outputTokens":3}'::jsonb end,
    case when cost is null then null else 'gen-synthetic-'||call_number end,
    case when cost is null then null else clock_timestamp() end,
    case when cost is null then null else clock_timestamp() end
   from public.reader_content_analysis_jobs where id=chosen;
 end loop;
 update public.reader_content_analysis_jobs j set state='blocked',error_code='analysis_unknown_charge_hold'
  where id=any(ids);
end;
$$;

-- Three synthetic v2 originals, six tasks, eleven settled synthetic responses.
-- Direct seed writes below are fixture-only; production staging cannot bypass
-- the source/lease/call fences. Only this disposable cluster disables a trigger.
alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;
do $$
declare n integer; t text; rec jsonb; h text; jid uuid; call_number integer:=0; step integer;
begin
 for n in 1..5 loop
  rec:=jsonb_build_object('id','generation-video-'||n,'sourceId','fixture-source','publishedAt','2026-10-25T00:00:00Z',
   'url','https://example.org/generation/'||n,'title','Synthetic generation source','isSample',false,'format','video','contentKind','transcript',
   'content','Nvidia makes RTX 5090. A GPU measured a 45 FPS result. The reviewer explains the measured trade-off.',
   'videoFormat','{"kind":"regular","basis":"watch_page"}'::jsonb,'topics','[]'::jsonb,'brands','[]'::jsonb);
  h:=encode(sha256(convert_to(rec->>'content','UTF8')),'hex');
  if n in (1,4,5) then
   rec:=rec||jsonb_build_object('videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',h,'timingBasis','none'),
    'videoHighlights',case when n=4 then '[{"text":"Nvidia makes the RTX 5090."}]'::jsonb else '[]'::jsonb end,
    'processing',jsonb_build_object('ruleVersion','content-v1','contentHash',h,'content','full','recap',case when n=4 then 'ready' else 'empty' end,'keywords','pending'));
  end if;
  insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
   values('generation-v3-owner',rec->>'id','fixture-source','fixture','2026-10-25T00:00:00Z',rec);
  if n>3 then continue; end if;
  foreach t in array array['summary','keywords'] loop
   jid:=gen_random_uuid();
   insert into public.reader_content_analysis_jobs(id,user_id,update_id,source_id,content_hash,rule_version,task,source_revision,
    source_fingerprint,workspace_revision,config_epoch,state,error_code,next_attempt_at,result)
    select jid,'generation-v3-owner',rec->>'id','fixture-source',h,'content-v2',t,public.content_analysis_source_revision(rec),
     public.content_analysis_source_fingerprint(w.state,'fixture-source'),w.updated_at,'original-v2-epoch',
     case when n=1 and t='summary' then 'published' else 'failed' end,
     case when n=1 and t='summary' then null when n=1 then 'analysis_unsupported_mention'
      when n=2 then 'analysis_unsupported_passage' when t='summary' then 'analysis_unsupported_summary_number' else 'analysis_incomplete_coverage' end,
     'infinity',case when n=1 and t='summary' then jsonb_build_object('state','empty','patch',jsonb_build_object('videoSummary',rec->'videoSummary','videoHighlights','[]'::jsonb),
      'pending','[]'::jsonb,'evidence',jsonb_build_object('protocolVersion','content-v2','contentHash',h,'selected','[]'::jsonb)) else null end
    from public.reader_workspaces w where user_id='generation-v3-owner';
   for step in 1..case when n=1 and t='summary' then 1 else 2 end loop
    call_number:=call_number+1;
    insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,
     actual_usd,observed_usd,state,result,usage,provider_id,result_at,settled_at)
     select jid,user_id,case when t='summary' then 'summary:v2:chunk:0' else 'extractor:v2:chunk:0' end||case when step=1 then '' else ':repair:1' end,
      gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',source_revision,.001,
      case when call_number=11 then .000583656 else .0005 end,case when call_number=11 then .000583656 else .0005 end,
      'settled',jsonb_build_object('value',jsonb_build_object('synthetic',call_number)),'{}','gen-v2-synthetic-'||call_number,clock_timestamp(),clock_timestamp()
     from public.reader_content_analysis_jobs where id=jid;
   end loop;
  end loop;
 end loop;
end;
$$;
alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;
select public.set_content_analysis_rollout_scope('generation-v3-owner',array['generation-video-1','generation-video-2','generation-video-3'],'paused');

-- Protected completed history and private admin decisions are substantive rows,
-- not empty-table preservation assertions.
insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,rule_version,task,source_revision,
 source_fingerprint,workspace_revision,state,lease_token,lease_until)
 select a.user_id,a.id,a.source_id,encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),
  case when a.id='generation-video-4' then 'content-v2' else 'content-v1' end,'summary',public.content_analysis_source_revision(a.record),
  public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,
  case when a.id='generation-video-4' then 'published' else 'skipped' end,gen_random_uuid(),'2000-01-01'
 from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id
 where a.user_id='generation-v3-owner' and a.id in ('generation-video-4','generation-video-5');
insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
 select user_id,id,source_id,encode(sha256(convert_to(record->>'content','UTF8')),'hex'),'Nvidia','brand',60,'Synthetic ambiguous identity','Nvidia','[]','',''
 from public.reader_source_updates where user_id='generation-v3-owner' and id in ('generation-video-2','generation-video-4');
update public.admin_keyword_reviews set status='approved',resolved_label='NVIDIA',resolved_kind='brand'
 where user_id='generation-v3-owner' and update_id='generation-video-4';

-- The comparison baseline is the complete 490/394/35/3 checkpoint, using
-- synthetic identities/text only. First stage the original immutable v3 scope
-- through its actual RPC; the comparison must follow this exact root lineage.
do $$
declare manifest jsonb; slots jsonb; rec jsonb; previous jsonb; root_id uuid; rev timestamptz;
 original_identity jsonb:='{"adapterVersion":"content-analysis-model-v2","route":"openrouter","baseURL":"https://openrouter.ai/api/v1","provider":"relace","model":"deepseek/deepseek-v4.1-flash-1017","reasoningEffort":"none","pricing":{"version":"synthetic-fixture-2026-10-25","inputUsdPerMillion":0.1,"outputUsdPerMillion":0.4,"cachedInputUsdPerMillion":null,"cacheWriteApplies":false,"cacheWriteUsdPerMillion":null}}';
begin
 select a.record,j.id into previous,root_id from public.reader_source_updates a join public.reader_content_analysis_jobs j
  on j.user_id=a.user_id and j.update_id=a.id and j.rule_version='content-v2' and j.task='summary'
  where a.user_id='generation-v3-owner' and a.id='generation-video-1';
 rec:=jsonb_set(previous,'{videoSummary,status}','"unavailable"')||jsonb_build_object('processing',previous->'processing'||
  jsonb_build_object('recap','failed','reason','analysis_summary_omission','updatedAt',clock_timestamp()));
 update public.reader_source_updates set record=rec where user_id='generation-v3-owner' and id='generation-video-1';
 insert into public.admin_audit_events(admin_id,action,target_id,details)
 select 'system:analysis-quality-review','analysis.summary.withheld','generation-video-1',jsonb_build_object(
  'predecessorJobId',j.id,'contentHash',j.content_hash,'sourceRevision',j.source_revision,
  'previousRecordHash',public.content_analysis_generation_v3_digest(previous),'withheldRecordHash',public.content_analysis_generation_v3_digest(rec),
  'sourceReviewDigest',repeat('b',64),'reason','analysis_summary_omission','actorType','assistant','humanApproval',false)
 from public.reader_content_analysis_jobs j where j.id=root_id;
 select jsonb_agg(jsonb_build_object('predecessorJobId',j.id,'successorJobId',gen_random_uuid(),'updateId',j.update_id,'sourceId',j.source_id,
  'task',j.task,'contentHash',j.content_hash,'sourceRevision',j.source_revision,'sourceFingerprint',j.source_fingerprint,
  'predecessorJobHash',public.content_analysis_generation_v3_digest(to_jsonb(j)-array['generation_comparison_id','generation_admission_id']),
  'predecessorLedgerHash',public.content_analysis_generation_v3_ledger_hash(j.id),'emptyDisposition','findings_expected','sourceReviewDigest',repeat('b',64),
  'reason',case when j.state='published' then 'audited_empty_omission' else 'format_or_coverage_failure' end,
  'withholdAuditId',case when j.state='published' then (select id from public.admin_audit_events where action='analysis.summary.withheld' and target_id=j.update_id) else null end,
  'currentAnnotationHash',case when j.state='published' then public.content_analysis_generation_v3_digest(jsonb_build_object('videoSummary',a.record->'videoSummary','videoHighlights',a.record->'videoHighlights')) else null end)
  order by j.update_id,j.task) into slots from public.reader_content_analysis_jobs j join public.reader_source_updates a on a.user_id=j.user_id and a.id=j.update_id
  where j.user_id='generation-v3-owner' and j.rule_version='content-v2' and j.update_id in ('generation-video-1','generation-video-2','generation-video-3');
 manifest:=jsonb_build_object('protocolVersion','content-v3','generationContractHash',public.content_analysis_generation_v3_contract_hash(),
  'executionIdentity',original_identity,'configEpoch','openrouter-2026-10-24-v2:deepseek/deepseek-v4.1-flash-1017:1:'||repeat('e',64),
  'runtimeDisabled',true,'workersDrained',true,
  'expectedBudgetHash',(select public.content_analysis_generation_v3_digest(to_jsonb(b)) from public.content_analysis_budget b),
  'expectedPolicyHash',(select public.content_analysis_generation_v3_digest(to_jsonb(p)) from public.reader_content_analysis_policies p where user_id='generation-v3-owner'),
  'expectedLedgerHash',public.content_analysis_generation_v3_ledger_hash(),
  'expectedCommittedUsd',(select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls),
  'budget','{"originalCommittedUsd":0.018365907,"incrementalAllowanceUsd":0.25,"smokeLifetimeCeilingUsd":0.268365907}'::jsonb,'slots',slots);
 select updated_at into rev from public.reader_workspaces where user_id='generation-v3-owner';
 perform public.stage_content_analysis_generation_v3('generation-v3-owner',
  (select public.content_analysis_generation_v3_digest(to_jsonb(s)) from public.content_analysis_rollout_scopes s where user_id='generation-v3-owner'),
  rev,public.content_analysis_generation_v3_contract_hash(),manifest);
end $$;
alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;
do $$ declare j public.reader_content_analysis_jobs; n integer:=0; step integer; begin
 for j in select * from public.reader_content_analysis_jobs where rule_version='content-v3' order by update_id,task loop
  for step in 1..2 loop
   n:=n+1;
   insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,
    actual_usd,observed_usd,state,result,usage,provider_id,result_at,settled_at,request_hash,execution_identity)
   select j.id,j.user_id,(case when j.task='summary' then 'summary:v3:chunk:0' else 'extractor:v3:chunk:0' end)||case when step=1 then '' else ':repair:1' end,
    gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',j.source_revision,.001,
    case when n=12 then .000474752 else .00038 end,case when n=12 then .000474752 else .00038 end,
    'settled',jsonb_build_object('value',jsonb_build_object('syntheticV3Failure',n)),'{}','gen-v3-synthetic-'||n,clock_timestamp(),clock_timestamp(),repeat('a',64),s.generation_revision_manifest->'executionIdentity'
    from public.content_analysis_rollout_scopes s where s.user_id=j.user_id;
  end loop;
  update public.reader_content_analysis_jobs set state='failed',error_code='analysis_incomplete_coverage',next_attempt_at='infinity' where id=j.id;
 end loop;
end $$;
alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;

insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
 select 'generation-v3-owner','comparison-history-'||n,'fixture-source','fixture','2026-10-23T00:00:00Z',
 jsonb_build_object('id','comparison-history-'||n,'sourceId','fixture-source','publishedAt','2026-10-23T00:00:00Z',
  'url','https://example.org/history/'||n,'title','Synthetic original','isSample',false,'format','video','contentKind','transcript',
  'content','Synthetic preserved historical source.','videoFormat','{"kind":"regular","basis":"watch_page"}'::jsonb,'topics','[]'::jsonb,'brands','[]'::jsonb)
 from generate_series(1,481) n;
insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,task,source_revision,source_fingerprint,workspace_revision,state,error_code)
 select a.user_id,a.id,a.source_id,encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),'summary',public.content_analysis_source_revision(a.record),
 public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,'blocked','analysis_runtime_disabled'
 from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id where a.id like 'comparison-history-%'
 order by a.id limit 373;
-- Model selection is deliberately OUTSIDE the stage/budget transaction.
select public.admin_set_analysis_model('synthetic-reviewer','openai/gpt-6-luna-pro',(select revision from public.content_analysis_runtime_settings where id));

-- Two unrelated synthetic workspaces have no collection/analysis work. The
-- comparator must preserve them without assuming the target is the only owner.
insert into public.reader_workspaces(user_id,state)
 select 'comparison-unrelated-owner-'||n,w.state
 from public.reader_workspaces w cross join generate_series(1,2) n
 where w.user_id='generation-v3-owner';
