-- Run against a disposable local database after migrations, or as a rolled-back
-- management-API check after the parent applies the migration. No source/provider
-- requests. All synthetic fixtures are rolled back, including budget holds.
begin;
insert into public.reader_collection_policies(user_id,enabled,provider_enabled,daily_limit_usd,lifetime_limit_usd) values ('hourly-db-test-owner',true,true,0.01,0.02),('hourly-db-test-other',true,false,0.1,1);
insert into public.reader_workspaces(user_id,state) values ('hourly-db-test-owner','{"version":1,"followedSourceIds":["hourly-db-source"],"customSources":[{"id":"hourly-db-source","name":"Disposable test channel","url":"https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv","platform":"YouTube","status":"ready","creatorIds":[]}],"importedUpdates":[],"savedUpdateIds":[],"readLaterIds":[],"settings":{},"sourceCollections":[{"id":"tech","sourceIds":["hourly-db-source"]}]}');
insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values ('hourly-db-test-owner','existing-tech-id','hourly-db-source','tech','2026-10-22T12:00:00Z','{"id":"existing-tech-id","sourceId":"hourly-db-source","publishedAt":"2026-10-22T12:00:00Z","url":"https://youtu.be/abcdefghijk","isSample":false,"summary":"Curated existing annotation","contentKind":"metadata_only"}');
insert into public.reader_collection_checks(user_id,source_id,source_name,source_url,platform,status) values('hourly-db-test-other','other-source','Other test source','https://example.org/feed','Blog','unchanged');
create temp table hourly_test_claim as select public.claim_hourly_source('hourly-db-test-owner','hourly-db-source') as claim;
do $$ declare c jsonb; again jsonb; r jsonb; jid uuid; k text; i integer; begin
 select claim into c from hourly_test_claim;
 if c is null then raise exception 'Claim missing'; end if;
 if public.claim_hourly_source('hourly-db-test-owner','catalogue-unfollowed') is not null then raise exception 'Catalogue source claimed'; end if;
 again:=public.claim_hourly_source('hourly-db-test-owner','hourly-db-source');
 if again is not null then raise exception 'Concurrent lease not fenced'; end if;
 if not exists(select 1 from public.reader_collection_seen_items where user_id='hourly-db-test-owner' and item_key='youtube:abcdefghijk' and archive_id='existing-tech-id') then raise exception 'Baseline identity mismatch'; end if;
 if public.hourly_item_key('https://youtube.com/live/abcdefghijk')<>'youtube:abcdefghijk' then raise exception 'Livestream canonicalization mismatch'; end if;
 for i in 1..3 loop
  k:='youtube:'||repeat(i::text,11);
  insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status) values('hourly-db-test-owner','hourly-db-source','Disposable test','https://www.youtube.com/watch?v='||repeat(i::text,11),'YouTube','apify','h7sDV53CddomktSi5','requested') returning id into jid;
  if i<3 then
   r:=public.reserve_hourly_provider((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,k,jid,'h7sDV53CddomktSi5',0.005);
   if r->>'claimed'<>'true' then raise exception 'Reservation not claimed'; end if;
  else
   begin
    perform public.reserve_hourly_provider((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,k,jid,'h7sDV53CddomktSi5',0.005);
    raise exception 'Daily cap bypassed';
   exception when sqlstate 'PT402' then null; end;
  end if;
 end loop;
 -- A lower later terminal fee cannot erase a running high-water observation.
 update public.reader_collection_provider_jobs set observed_cost_usd=0.004 where user_id='hourly-db-test-owner';
 update public.reader_collection_provider_jobs set observed_cost_usd=0.001,actual_cost_usd=0.002 where user_id='hourly-db-test-owner';
 if exists(select 1 from public.reader_collection_provider_jobs where user_id='hourly-db-test-owner' and (observed_cost_usd<0.004 or actual_cost_usd<0.004)) then raise exception 'Provider cost high-water regressed'; end if;
 update public.reader_collection_provider_jobs set actual_cost_usd=null where user_id='hourly-db-test-owner';
 -- A stale token cannot advance validators or import updates.
 begin perform public.finish_hourly_source((c->>'checkId')::uuid,gen_random_uuid(),'{"status":"unchanged","etag":"bad"}'); raise exception 'Stale lease accepted'; exception when sqlstate 'PT409' then null; end;
 r:=public.finish_hourly_source((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'{"status":"collected","new_count":0,"etag":"good"}',jsonb_build_array(jsonb_build_object('itemKey','youtube:abcdefghijk','record',jsonb_build_object('id','new-id-must-not-duplicate','sourceId','hourly-db-source','url','https://www.youtube.com/live/abcdefghijk','publishedAt','2026-10-22T12:00:00Z','isSample',false,'contentKind','transcript','content','Real test captions','summary','Do not replace curated summary'))));
 if (r->>'retrievedCount')::int<>1 then raise exception 'Enrichment missing'; end if;
 if not exists(select 1 from public.reader_collection_source_state where user_id='hourly-db-test-owner' and next_check_at=((date_trunc('hour',last_checked_at at time zone 'UTC')+interval '1 hour') at time zone 'UTC')) then raise exception 'Next check must match next UTC hour'; end if;
 if (select count(*) from public.reader_source_updates where user_id='hourly-db-test-owner')<>1 then raise exception 'Old tech archive duplicated'; end if;
 if not exists(select 1 from public.reader_source_updates where user_id='hourly-db-test-owner' and id='existing-tech-id' and record->>'summary'='Curated existing annotation' and record->>'contentKind'='transcript') then raise exception 'Existing annotation lost'; end if;
 -- Unknown holds from yesterday also consume today's ceiling.
 update public.reader_collection_provider_jobs set created_at=clock_timestamp()-interval '2 days' where user_id='hourly-db-test-owner';
 update public.reader_collection_source_state set next_check_at='-infinity' where user_id='hourly-db-test-owner';
 c:=public.claim_hourly_source('hourly-db-test-owner','hourly-db-source');
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status) values('hourly-db-test-owner','hourly-db-source','Disposable test','https://www.youtube.com/watch?v=44444444444','YouTube','apify','h7sDV53CddomktSi5','requested') returning id into jid;
 begin perform public.reserve_hourly_provider((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'youtube:44444444444',jid,'h7sDV53CddomktSi5',0.005); raise exception 'Unknown holds expired by UTC rollover'; exception when sqlstate 'PT402' then null; end;
 -- A known terminal fee releases only the unused reader maximum; lifetime
 -- usage never resets with the UTC day.
 update public.reader_collection_provider_jobs set actual_cost_usd=0.004 where user_id='hourly-db-test-owner';
 update public.reader_collection_policies set daily_limit_usd=0.1,lifetime_limit_usd=0.01 where user_id='hourly-db-test-owner';
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status) values('hourly-db-test-owner','hourly-db-source','Disposable test','https://www.youtube.com/watch?v=55555555555','YouTube','apify','h7sDV53CddomktSi5','requested') returning id into jid;
 begin perform public.reserve_hourly_provider((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'youtube:55555555555',jid,'h7sDV53CddomktSi5',0.005); raise exception 'Lifetime cap bypassed'; exception when sqlstate 'PT402' then null; end;
 -- Clearing real history fences the current lease and all pending content.
 update public.reader_collection_source_state set pending_captions='[{"record":{"id":"queued-old"},"attempts":1,"nextAttemptAt":"2026-10-22T12:00:00Z"}]' where user_id='hourly-db-test-owner';
 delete from public.reader_source_updates where user_id='hourly-db-test-owner';
 if exists(select 1 from public.reader_collection_source_state where user_id='hourly-db-test-owner' and pending_captions<>'[]'::jsonb) then raise exception 'Cleared archive retained caption queue'; end if;
 if exists(select 1 from public.reader_collection_provider_jobs where user_id='hourly-db-test-owner' and not discard_result) then raise exception 'Clear did not invalidate pending results'; end if;
 begin perform public.finish_hourly_source((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'{"status":"collected"}'); raise exception 'Deleted history lease accepted'; exception when sqlstate 'PT409' then null; end;
end $$;
-- Real legacy workspace-only imports are promoted under their existing ID;
-- annotations survive, and a normal concurrent bookmark save does not retire a
-- provider result until a later current-revision archive commit accepts it.
update public.reader_workspaces set state=jsonb_set(state,'{importedUpdates}','[{"id":"legacy-workspace-only","sourceId":"hourly-db-source","url":"https://youtu.be/zzzzzzzzzzz","publishedAt":"2026-10-22T12:00:00Z","isSample":false,"summary":"Legacy annotation","contentKind":"metadata_only"}]') where user_id='hourly-db-test-owner';
update public.reader_collection_source_state set next_check_at='-infinity' where user_id='hourly-db-test-owner';
do $$ declare c jsonb; r jsonb; items jsonb; begin
 c:=public.claim_hourly_source('hourly-db-test-owner','hourly-db-source');
 items:=jsonb_build_array(jsonb_build_object('itemKey','youtube:zzzzzzzzzzz','record',jsonb_build_object('id','different-new-id','sourceId','hourly-db-source','url','https://www.youtube.com/watch?v=zzzzzzzzzzz','publishedAt','2026-10-22T12:00:00Z','isSample',false,'contentKind','transcript','content','Real recovered caption source text')));
 update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["bookmark"]') where user_id='hourly-db-test-owner';
 r:=public.finish_hourly_source((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'{"status":"collected"}',items);
 if r->'importAccepted' is distinct from 'false'::jsonb or exists(select 1 from public.reader_source_updates where user_id='hourly-db-test-owner') then raise exception 'Concurrent workspace CAS accepted stale import'; end if;
 update public.reader_collection_source_state set next_check_at='-infinity' where user_id='hourly-db-test-owner';
 c:=public.claim_hourly_source('hourly-db-test-owner','hourly-db-source');
 r:=public.finish_hourly_source((c->>'checkId')::uuid,(c->>'leaseToken')::uuid,'{"status":"collected"}',items);
 if r->'importAccepted' is distinct from 'true'::jsonb or not exists(select 1 from public.reader_source_updates where user_id='hourly-db-test-owner' and id='legacy-workspace-only' and record->>'summary'='Legacy annotation' and record->>'content'='Real recovered caption source text') then raise exception 'Workspace-only baseline promotion failed'; end if;
end $$;
update public.reader_collection_source_state set pending_captions='[{"record":{"id":"queued-refollow"},"attempts":1,"nextAttemptAt":"2026-10-22T12:00:00Z"}]' where user_id='hourly-db-test-owner';
update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id='hourly-db-test-owner';
do $$ begin if exists(select 1 from public.reader_collection_source_state where user_id='hourly-db-test-owner' and pending_captions<>'[]'::jsonb) then raise exception 'Unfollow retained caption queue'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"hourly-db-test-owner"}',true);
do $$ begin
 if (select count(*) from public.reader_collection_policies)<>1 then raise exception 'Policy ownership RLS failed'; end if;
 if exists(select 1 from public.reader_collection_checks where user_id<>'hourly-db-test-owner') then raise exception 'Check ownership RLS failed'; end if;
 if has_table_privilege('authenticated','public.reader_collection_provider_jobs','select') then raise exception 'Private token table exposed'; end if;
 if has_table_privilege('authenticated','public.reader_collection_policies','update') then raise exception 'Reader can enable provider'; end if;
 if has_function_privilege('authenticated','public.reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)','execute') then raise exception 'Reader can reserve provider budget'; end if;
end $$;
reset role;
select 'hourly_database_invariants_passed' as result;
rollback;
