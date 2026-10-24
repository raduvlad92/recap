-- D35 acceptance checks. Run ONLY on a disposable local database AFTER parent
-- applies all migrations. No source/model/provider requests; fixtures roll back.
-- Not executed by the static test, and not a concurrent-session proof.
begin;
insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)
 values(true,true,1,2) on conflict(id) do update set enabled=true,daily_limit_usd=1,lifetime_limit_usd=2;
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
 values('analysis-db-owner',true,0.02,0.03,0.02,'fixture-model');
insert into public.reader_workspaces(user_id,state) values('analysis-db-owner',
 '{"version":1,"followedSourceIds":["analysis-source"],"customSources":[{"id":"analysis-source","name":"Synthetic channel","url":"https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv","platform":"YouTube","status":"ready","creatorIds":[]}],"importedUpdates":[],"savedUpdateIds":[],"readLaterIds":[],"settings":{}}');
insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values
 ('analysis-db-owner','analysis-video','analysis-source','synthetic','2026-10-24T00:00:00Z',
 '{"id":"analysis-video","sourceId":"analysis-source","publishedAt":"2026-10-24T00:00:00Z","url":"https://www.youtube.com/watch?v=abcdefghijk","title":"Synthetic source","format":"video","isSample":false,"videoFormat":{"kind":"regular","basis":"watch_page"},"contentKind":"transcript","content":"Nvidia makes RTX 5090. Tape to Tape is named in the final sentence.","summary":"Original description","coverage":"Full saved transcript, completeness not verified","topics":[],"brands":[],"sponsors":[],"references":[],"insights":[],"media":[{"type":"image","url":"https://example.org/image.jpg"}]}');

do $$
declare c jsonb; s jsonb; k jsonb; r jsonb; cached jsonb; rec jsonb; original jsonb; state_before jsonb; rev_before timestamptz;
 summary_output jsonb; keyword_output jsonb; h text; txt text; q uuid; q_last uuid; call_id uuid; old_token uuid; old_job uuid; n integer; polled timestamptz;
begin
 select record into rec from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video';
 select state into state_before from public.reader_workspaces where user_id='analysis-db-owner';
 if public.content_analysis_eligible(state_before,rec||'{"contentKind":"feed_text"}') then raise exception 'Video description became paid work'; end if;
 if public.content_analysis_eligible(state_before,rec||'{"format":"post"}') then raise exception 'Social text became paid work'; end if;
 if coalesce(public.content_analysis_eligible(state_before,(rec-'videoFormat')||'{"isShort":false}'),false) then raise exception 'Legacy false inferred regular'; end if;
 if public.content_analysis_eligible(state_before,rec||'{"url":"https://www.youtube.com/shorts/abcdefghijk"}') then raise exception 'Canonical Short accepted'; end if;
 perform public.sync_content_analysis_jobs('analysis-db-owner',200,'epoch-one');
 perform public.sync_content_analysis_jobs('analysis-db-owner',200,'epoch-one');
 if (select count(*) from public.reader_content_analysis_jobs where user_id='analysis-db-owner')<>2 then raise exception 'Independent queue key/idempotency failed'; end if;
 for n in 1..2 loop
  c:=public.claim_content_analysis_job('analysis-db-owner',900);
  if c#>>'{job,task}'='summary' then s:=c; else k:=c; end if;
 end loop;
 if s is null or k is null or public.claim_content_analysis_job('analysis-db-owner') is not null then raise exception 'Claim lease failed'; end if;
 if not exists(select 1 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video' and record#>>'{processing,recap}'='running' and record#>>'{processing,keywords}'='running' and record#>>'{processing,content}'='partial') then raise exception 'Running/partial status missing'; end if;
 r:=public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,(s->>'leaseToken')::uuid,'summary:0',0.01,'fixture-model');
 call_id:=(r#>>'{call,id}')::uuid; old_token:=(s->>'leaseToken')::uuid;
 if r->>'claimed'<>'true' then raise exception 'Fresh call unclaimed'; end if;
 r:=public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,old_token,'summary:0',0.01,'fixture-model');
 if r->>'claimed'<>'false' then raise exception 'Call relaunched'; end if;
 perform public.record_content_analysis_call_result(call_id,old_token,'{"requestHash":"synthetic-hash","value":{"readComplete":true}}','{"inputTokens":10,"outputTokens":2}',null);
 cached:=(select result from public.reader_content_analysis_calls where id=call_id);
 if cached is null or not exists(select 1 from public.reader_content_analysis_calls where id=call_id and actual_usd is null and state='unknown') then raise exception 'Private cache/unknown hold missing'; end if;
 begin perform public.record_content_analysis_call_result(call_id,old_token,'{"value":"changed"}','{}'); raise exception 'Cache mutated'; exception when sqlstate 'PT409' then null; end;
 perform public.settle_content_analysis_call(call_id,0.006,0.006);
 perform public.settle_content_analysis_call(call_id,0.001,0.001);
 if (select actual_usd from public.reader_content_analysis_calls where id=call_id)<>0.006 then raise exception 'Charge high-water regressed'; end if;
 r:=public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,old_token,'summary:1',0.01,'fixture-model');
 update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=(r#>>'{call,id}')::uuid;
 begin perform public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,old_token,'summary:2',0.01,'fixture-model'); raise exception 'Old unknown hold ignored'; exception when sqlstate 'PT429' then null; end;
 begin perform public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,old_token,'wrong-model',0.001,'different-model'); raise exception 'Model policy bypass'; exception when sqlstate 'PT403' then null; end;
 -- Cooperative checkpoint does not exhaust attempts and resumes cached calls.
 perform public.fail_content_analysis_job((s#>>'{job,id}')::uuid,old_token,'analysis_worker_yield',false,true);
 update public.reader_content_analysis_jobs set next_attempt_at='-infinity' where id=(s#>>'{job,id}')::uuid;
 s:=public.claim_content_analysis_job('analysis-db-owner',900);
 r:=public.reserve_content_analysis_call((s#>>'{job,id}')::uuid,(s->>'leaseToken')::uuid,'summary:0',0.01,'fixture-model');
 if r->>'claimed'<>'false' or r#>'{call,result}' is distinct from cached then raise exception 'Yield lost cache'; end if;
 -- Credential/config blocks resume once per epoch. Ambiguous keys stay blocked.
 perform public.fail_content_analysis_job((k#>>'{job,id}')::uuid,(k->>'leaseToken')::uuid,'analysis_credentials_required');
 perform public.sync_content_analysis_jobs('analysis-db-owner',200,'epoch-one');
 if exists(select 1 from public.reader_content_analysis_jobs where id=(k#>>'{job,id}')::uuid and state<>'blocked') then raise exception 'Same epoch requeued'; end if;
 perform public.sync_content_analysis_jobs('analysis-db-owner',200,'epoch-two');
 k:=public.claim_content_analysis_job('analysis-db-owner',900);
 if k#>>'{job,task}'<>'keywords' then raise exception 'Configuration epoch failed to resume'; end if;
 h:=s#>>'{job,content_hash}'; txt:=rec->>'content';
 summary_output:=jsonb_build_object('state','ready','pending','[]'::jsonb,'patch',jsonb_build_object('videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash',h,'timingBasis','none'),'videoHighlights','[{"text":"Nvidia makes the RTX 5090."}]'::jsonb),
  'evidence',jsonb_build_object('contentHash',h,'sourceContentState','partial','coverage',jsonb_build_array(jsonb_build_object('start',0,'end',length(txt))),'selected','[{"text":"Nvidia makes the RTX 5090.","evidenceQuote":"Nvidia makes RTX 5090."}]'::jsonb));
 perform public.prepare_content_analysis_job((s#>>'{job,id}')::uuid,(s->>'leaseToken')::uuid,summary_output);
 -- A concurrent workspace save and new hourly row must survive publication.
 update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["analysis-video"]') where user_id='analysis-db-owner';
 select state,updated_at into state_before,rev_before from public.reader_workspaces where user_id='analysis-db-owner';
 insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('analysis-db-owner','analysis-new','analysis-source','synthetic','2026-10-24T00:00:00Z',jsonb_set(rec,'{id}','"analysis-new"'));
 update public.reader_source_updates set record=record||'{"summary":"Newer description","postContext":{"reply":{"status":"unavailable"}}}' where user_id='analysis-db-owner' and id='analysis-video';
 select record into original from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video';
 perform public.publish_content_analysis_job((s#>>'{job,id}')::uuid,(s->>'leaseToken')::uuid);
 if (select record-array['videoSummary','videoHighlights','processing','keywordContentHash'] from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video') is distinct from original-array['videoSummary','videoHighlights','processing','keywordContentHash'] then raise exception 'Summary overwrote latest original'; end if;
 if not exists(select 1 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video' and record ? 'keywordContentHash' and record->'keywordContentHash'='null'::jsonb) then raise exception 'Unknown keyword provenance inherited summary hash'; end if;
 if not exists(select 1 from public.reader_workspaces where user_id='analysis-db-owner' and state=state_before and updated_at=rev_before) or not exists(select 1 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-new') then raise exception 'Workspace/new hourly row lost'; end if;
 -- Rejected same-hash identities win; corrected prior approvals survive.
 insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,update_title,update_url) values('analysis-db-owner','analysis-video','analysis-source',h,'Nvidia','brand',90,'Synthetic candidate','Nvidia makes RTX 5090.','','') returning id into q;
 perform public.admin_review_keyword(q,(select updated_at from public.admin_keyword_reviews where id=q),'synthetic-admin','reject','Nvidia','brand');
 insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,update_title,update_url) values('analysis-db-owner','analysis-video','analysis-source',h,'RTX 5090','category',70,'Synthetic candidate','Nvidia makes RTX 5090.','','') returning id into q;
 perform public.admin_review_keyword(q,(select updated_at from public.admin_keyword_reviews where id=q),'synthetic-admin','approve','RTX 5090','product');
 keyword_output:=jsonb_build_object('state','ready','patch','{"keywordRuleVersion":"entities-v2"}'::jsonb,'pending','[]'::jsonb,'evidence',jsonb_build_object('contentHash',h,'ruleVersion','entities-v2','coverage',jsonb_build_array(jsonb_build_object('start',0,'end',length(txt))),'accepted','[{"label":"Nvidia","kind":"brand","confidence":100,"reason":"Literal mention","evidenceQuote":"Nvidia makes RTX 5090.","ranges":[]},{"label":"Tape to Tape","kind":"game","confidence":100,"reason":"Final sentence","evidenceQuote":"Tape to Tape is named in the final sentence.","ranges":[]}]'::jsonb));
 perform public.finish_content_analysis_job((k#>>'{job,id}')::uuid,(k->>'leaseToken')::uuid,keyword_output);
 perform public.publish_content_analysis_job((k#>>'{job,id}')::uuid,(k->>'leaseToken')::uuid);
 select record into rec from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video';
 if rec->'topics' ? 'Nvidia' or not(rec->'topics' ? 'RTX 5090' and rec->'brands' ? 'RTX 5090' and rec->'topics' ? 'Tape to Tape') or rec#>>'{processing,recap}'<>'ready' or rec#>>'{processing,content}'<>'partial' then raise exception 'Decision/sibling/partial preservation failed'; end if;
 if rec->>'keywordContentHash'<>h then raise exception 'Keyword publication missing independent content hash'; end if;
 -- Real existing admin decisions update review/ready/empty and the poll marker
 -- while preserving recap, source fields and independently hashed keywords.
 select updated_at into polled from public.reader_content_analysis_jobs where id=(k#>>'{job,id}')::uuid;
 original:=rec;
 insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,update_title,update_url)
  values('analysis-db-owner','analysis-video','analysis-source',h,'Nvidia makes','category',40,'Synthetic review','Nvidia makes RTX 5090.','','') returning id into q;
 insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,update_title,update_url)
  values('analysis-db-owner','analysis-video','analysis-source',h,'final sentence','category',40,'Synthetic review','Tape to Tape is named in the final sentence.','','') returning id into q_last;
 update public.reader_source_updates set record=jsonb_set(record,'{processing,keywords}','"review"') where user_id='analysis-db-owner' and id='analysis-video';
 perform public.admin_review_keyword(q,(select updated_at from public.admin_keyword_reviews where id=q),'synthetic-admin','approve','Nvidia makes','category');
 if not exists(select 1 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video' and record#>>'{processing,keywords}'='review' and record#>>'{processing,recap}'='ready' and record->>'keywordContentHash'=h) then raise exception 'Nonfinal admin approval cleared review or recap/hash'; end if;
 perform public.admin_review_keyword(q_last,(select updated_at from public.admin_keyword_reviews where id=q_last),'synthetic-admin','reject','final sentence','category');
 select record into rec from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video';
 if rec#>>'{processing,keywords}'<>'ready' or rec#>>'{processing,recap}'<>'ready' or rec->>'keywordContentHash'<>h or not(rec->'topics' ? 'Nvidia makes') then raise exception 'Final admin decision left stale review status or lost accepted label'; end if;
 if rec-array['processing','keywordContentHash','videoKeywords','topics','brands'] is distinct from original-array['processing','keywordContentHash','videoKeywords','topics','brands'] then raise exception 'Admin status integration overwrote original/recap fields'; end if;
 if not exists(select 1 from public.reader_content_analysis_jobs where id=(k#>>'{job,id}')::uuid and state='published' and updated_at>polled) then raise exception 'Admin decision absent from lightweight poll'; end if;
 update public.reader_source_updates set record=jsonb_set(record||'{"videoKeywords":[],"topics":[],"brands":[]}','{processing,keywords}','"review"') where user_id='analysis-db-owner' and id='analysis-video';
 insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,update_title,update_url)
  values('analysis-db-owner','analysis-video','analysis-source',h,'Nvidia makes RTX','category',40,'Synthetic review','Nvidia makes RTX 5090.','','') returning id into q_last;
 perform public.admin_review_keyword(q_last,(select updated_at from public.admin_keyword_reviews where id=q_last),'synthetic-admin','reject','Nvidia makes RTX','category');
 if not exists(select 1 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video' and record#>>'{processing,keywords}'='empty' and record#>>'{processing,recap}'='ready' and record->>'keywordContentHash'=h) then raise exception 'Final rejection without labels did not become empty'; end if;
 -- Deletion erases private source caches without releasing financial holds.
 old_job:=(s#>>'{job,id}')::uuid;
 delete from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-video';
 if exists(select 1 from public.reader_content_analysis_jobs where id=old_job) or exists(select 1 from public.reader_content_analysis_calls where id=call_id and (job_id is not null or result is not null)) then raise exception 'Deletion kept source evidence'; end if;
 perform public.record_content_analysis_call_result(call_id,old_token,cached,'{"inputTokens":10,"outputTokens":2}',null);
 if exists(select 1 from public.reader_content_analysis_calls where id=call_id and result is not null) or not exists(select 1 from public.reader_content_analysis_calls where user_id='analysis-db-owner' and actual_usd is null and maximum_usd=0.01) then raise exception 'Late evidence resurrected or hold refunded'; end if;
 begin perform public.publish_content_analysis_job(old_job,(s->>'leaseToken')::uuid); raise exception 'Deleted archive recreated'; exception when sqlstate 'PT409' then null; end;
end;
$$;

-- Recovery regressions: simulate UTC rollover by moving only synthetic settled
-- charges into yesterday and making a scheduled pause due; lifetime/holds stay.
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
 values('analysis-recovery-owner',true,0.01,0.02,0.01,'fixture-model');
insert into public.reader_workspaces(user_id,state) select 'analysis-recovery-owner',state from public.reader_workspaces where user_id='analysis-db-owner';
insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
 select 'analysis-recovery-owner','recovery-video',source_id,collection_id,published_at,jsonb_set(record,'{id}','"recovery-video"')
 from public.reader_source_updates where user_id='analysis-db-owner' and id='analysis-new';
do $$
declare c jsonb; s jsonb; k jsonb; r jsonb; token uuid; sid uuid; kid uuid; first_call uuid; second_call uuid;
 served timestamptz; tries integer; n integer;
begin
 if (select last_served_at from public.reader_content_analysis_policies where user_id='analysis-recovery-owner')<>'-infinity'::timestamptz then raise exception 'Unserved reader fairness default changed'; end if;
 if public.claim_content_analysis_job('analysis-recovery-owner') is not null then raise exception 'Empty queue claimed'; end if;
 if (select last_served_at from public.reader_content_analysis_policies where user_id='analysis-recovery-owner')<>'-infinity'::timestamptz then raise exception 'Empty queue moved fairness'; end if;
 perform public.sync_content_analysis_jobs('analysis-recovery-owner',200,'stable-epoch');
 for n in 1..2 loop c:=public.claim_content_analysis_job('analysis-recovery-owner',900); if c#>>'{job,task}'='summary' then s:=c; else k:=c; end if; end loop;
 sid:=(s#>>'{job,id}')::uuid; kid:=(k#>>'{job,id}')::uuid; token:=(s->>'leaseToken')::uuid;
 select last_served_at into served from public.reader_content_analysis_policies where user_id='analysis-recovery-owner';
 if served='-infinity'::timestamptz then raise exception 'Claim did not update fairness'; end if;
 if public.claim_content_analysis_job('analysis-recovery-owner') is not null then raise exception 'Leased queue reclaimed'; end if;
 if (select last_served_at from public.reader_content_analysis_policies where user_id='analysis-recovery-owner')<>served then raise exception 'Unsuccessful claim moved fairness'; end if;
 r:=public.reserve_content_analysis_call(sid,token,'summary:0',0.007,'fixture-model'); first_call:=(r#>>'{call,id}')::uuid;
 perform public.settle_content_analysis_call(first_call,0.007,0.007);
 begin perform public.reserve_content_analysis_call(sid,token,'summary:1',0.007,'fixture-model'); raise exception 'Daily spend bypassed'; exception when sqlstate 'PT429' then null; end;
 perform public.fail_content_analysis_job(sid,token,'analysis_daily_budget_exhausted');
 if not exists(select 1 from public.reader_content_analysis_jobs where id=sid and state='blocked' and attempts=0
  and next_attempt_at=((date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC')) then raise exception 'Daily pause was terminal, consumed attempts, or used nonUTC reset'; end if;
 if public.claim_content_analysis_job('analysis-recovery-owner') is not null then raise exception 'Daily pause resumed before midnight'; end if;
 update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=first_call;
 update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=sid;
 s:=public.claim_content_analysis_job('analysis-recovery-owner',900); token:=(s->>'leaseToken')::uuid;
 if s#>>'{job,id}'<>sid::text then raise exception 'Daily pause did not autoresume without epoch change'; end if;
 r:=public.reserve_content_analysis_call(sid,token,'summary:0',0.007,'fixture-model');
 if r->>'claimed'<>'false' then raise exception 'Rollover relaunched settled key'; end if;
 r:=public.reserve_content_analysis_call(sid,token,'summary:1',0.007,'fixture-model'); second_call:=(r#>>'{call,id}')::uuid;
 perform public.record_content_analysis_call_result(second_call,token,'{"requestHash":"fixture","value":{"done":true}}','{}');
 update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=second_call;
 begin perform public.reserve_content_analysis_call(sid,token,'summary:2',0.004,'fixture-model'); raise exception 'Old unknown hold disappeared at midnight'; exception when sqlstate 'PT429' then null; end;
 begin perform public.reserve_content_analysis_call(sid,token,'summary:2',0.009,'fixture-model'); raise exception 'Lifetime spend reset at midnight'; exception when sqlstate 'PT402' then null; end;
 -- Repeat more than three UTC daily pauses with one configuration epoch.
 for n in 1..4 loop
  perform public.fail_content_analysis_job(sid,token,'analysis_daily_budget_exhausted');
  update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=sid;
  s:=public.claim_content_analysis_job('analysis-recovery-owner',900); token:=(s->>'leaseToken')::uuid;
  if s is null or (s#>>'{job,attempts}')::integer<>1 then raise exception 'Daily pauses exhausted retry attempts'; end if;
  r:=public.reserve_content_analysis_call(sid,token,'summary:1',0.007,'fixture-model');
  if r->>'claimed'<>'false' or r#>'{call,result}' is null then raise exception 'Unknown cached call relaunched'; end if;
 end loop;
 if (select count(*) from public.reader_content_analysis_calls where user_id='analysis-recovery-owner')<>2 then raise exception 'Daily recovery duplicated calls'; end if;
 perform public.fail_content_analysis_job(kid,(k->>'leaseToken')::uuid,'analysis_budget_exhausted',true);
 if not exists(select 1 from public.reader_content_analysis_jobs where id=kid and state='blocked' and next_attempt_at='infinity') then raise exception 'Lifetime block scheduled automatic retry'; end if;
 -- A third expired running lease is swept to failed, without a fourth claim,
 -- call release, fairness bump, or a permanently running archive indicator.
 update public.reader_content_analysis_jobs set attempts=3,lease_until=clock_timestamp()-interval '1 second' where id=sid;
 select last_served_at into served from public.reader_content_analysis_policies where user_id='analysis-recovery-owner';
 if public.claim_content_analysis_job('analysis-recovery-owner') is not null then raise exception 'Expired third lease relaunched'; end if;
 if not exists(select 1 from public.reader_content_analysis_jobs where id=sid and state='failed' and error_code='analysis_lease_expired' and attempts=3 and lease_token is null and lease_until is null and next_attempt_at='infinity') then raise exception 'Expired third lease left running forever'; end if;
 if not exists(select 1 from public.reader_source_updates where user_id='analysis-recovery-owner' and id='recovery-video' and record#>>'{processing,recap}'='failed' and record#>>'{processing,keywords}'='blocked' and record#>>'{processing,reason}'='analysis_lease_expired') then raise exception 'Expired lease status or sibling preservation failed'; end if;
 if (select last_served_at from public.reader_content_analysis_policies where user_id='analysis-recovery-owner')<>served then raise exception 'Terminal cleanup moved reader fairness'; end if;
 if (select count(*) from public.reader_content_analysis_calls where user_id='analysis-recovery-owner')<>2 or not exists(select 1 from public.reader_content_analysis_calls where id=second_call and actual_usd is null and maximum_usd=0.007) then raise exception 'Expired lease erased unknown hold'; end if;
 begin perform public.reserve_content_analysis_call(sid,token,'summary:2',0.001,'fixture-model'); raise exception 'Expired worker reserved a call'; exception when sqlstate 'PT409' then null; end;
 -- Prepared work still resumes without another model attempt even after three
 -- previous attempts, because its validated result is already durable.
 update public.reader_content_analysis_jobs set state='prepared',attempts=3,result='{"fixture":true}',next_attempt_at='-infinity',lease_until=clock_timestamp()-interval '1 second' where id=kid;
 c:=public.claim_content_analysis_job('analysis-recovery-owner',900);
 if c#>>'{job,state}'<>'prepared' or (c#>>'{job,attempts}')::integer<>3 then raise exception 'Prepared recovery regenerated content'; end if;
end;
$$;

-- Access boundary checks use actual database ACLs, not a browser flag.
do $$ declare fn record; t text; begin
 foreach t in array array['content_analysis_budget','reader_content_analysis_policies','reader_content_analysis_jobs','reader_content_analysis_calls'] loop
  if has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('anon','public.'||t,'SELECT') then raise exception 'Private table exposed: %',t; end if;
 end loop;
 for fn in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('sync_content_analysis_jobs','claim_content_analysis_job','reserve_content_analysis_call','record_content_analysis_call_result','prepare_content_analysis_job','publish_content_analysis_job','fail_content_analysis_job') loop
  if has_function_privilege('authenticated',fn.oid,'EXECUTE') or has_function_privilege('anon',fn.oid,'EXECUTE') then raise exception 'Private RPC exposed'; end if;
 end loop;
end;
$$;
rollback;
