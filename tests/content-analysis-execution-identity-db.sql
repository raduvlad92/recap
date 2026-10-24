-- D36 rollback-only, DATABASE-ONLY provenance acceptance. The TS harness loads
-- all migrations into disposable PostgreSQL; no linked DB or provider is used.
begin;
set local role service_role;
insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)
 values(true,true,45,45) on conflict(id) do update set enabled=true,daily_limit_usd=45,lifetime_limit_usd=45;
insert into public.reader_workspaces(user_id,state) values('execution-sql-owner',
 '{"version":1,"followedSourceIds":["execution-source"],"customSources":[{"id":"execution-source","name":"Synthetic channel","url":"https://example.org/channel","platform":"YouTube","status":"ready","creatorIds":[]}],"importedUpdates":[],"savedUpdateIds":[],"readLaterIds":[],"settings":{}}');
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
 values('execution-sql-owner',true,0.02,0.1,0.02,'google/fixture-model');
insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values
 ('execution-sql-owner','execution-video','execution-source','synthetic','2026-10-24T00:00:00Z',
 '{"id":"execution-video","sourceId":"execution-source","publishedAt":"2026-10-24T00:00:00Z","url":"https://example.org/video","title":"Synthetic source","format":"video","isSample":false,"videoFormat":{"kind":"regular","basis":"watch_page"},"contentKind":"transcript","content":"Synthetic saved source words for local provenance tests.","topics":[],"brands":[]}');
do $$
declare job jsonb; first_call jsonb; retry jsonb; changed jsonb; legacy jsonb; call_id uuid; identity jsonb :=
 '{"adapterVersion":"content-analysis-model-v2","route":"openrouter","baseURL":"https://openrouter.ai/api/v1","provider":"google-ai-studio","model":"google/fixture-model","reasoningEffort":"low","pricing":{"version":"verified-fixture-2026-10-24","inputUsdPerMillion":0.1,"outputUsdPerMillion":0.4,"cachedInputUsdPerMillion":0.01,"cacheWriteApplies":false,"cacheWriteUsdPerMillion":null}}';
begin
 perform public.sync_content_analysis_jobs('execution-sql-owner',200);
 job:=public.claim_content_analysis_job('execution-sql-owner',900);
 first_call:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.01,'google/fixture-model',identity);
 call_id:=(first_call#>>'{call,id}')::uuid;
 if first_call->'claimed'<>'true'::jsonb or first_call#>'{call,execution_identity}' is distinct from identity
  or (select execution_identity from public.reader_content_analysis_calls where id=call_id) is distinct from identity then
  raise exception 'Identity was not saved before returning the new claim'; end if;
 retry:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.01,'google/fixture-model',identity);
 if retry->'claimed'<>'false'::jsonb or retry->'call' is distinct from first_call->'call' then raise exception 'Duplicate claim changed ledger'; end if;
 -- Every execution/pricing dimension stays the original even if configuration
 -- changes; the worker must compare the cached identity before reusing output.
 for changed in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(identity,'{adapterVersion}','"content-analysis-model-v3"'),
  jsonb_set(identity,'{provider}','"google-vertex"'),
  jsonb_set(identity,'{reasoningEffort}','null'),
  jsonb_set(identity,'{pricing,version}','"verified-fixture-v2"'),
  jsonb_set(identity,'{pricing,inputUsdPerMillion}','0.2'),
  jsonb_set(identity,'{pricing,outputUsdPerMillion}','0.5'),
  jsonb_set(identity,'{pricing,cachedInputUsdPerMillion}','null'),
  jsonb_set(jsonb_set(identity,'{pricing,cacheWriteApplies}','true'),'{pricing,cacheWriteUsdPerMillion}','0.2'),
  identity||'{"route":"direct","baseURL":"https://api.openai.com/v1","provider":"openai"}',
  identity||'{"route":"netlify","baseURL":"https://gateway.netlify.com/v1","provider":"netlify"}')) loop
  retry:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.005,'google/fixture-model',changed);
  if retry->'claimed'<>'false'::jsonb or retry->'call' is distinct from first_call->'call' then raise exception 'Changed identity refreshed original ledger'; end if;
 end loop;
 begin
  update public.reader_content_analysis_calls set execution_identity=jsonb_set(identity,'{provider}','"google-vertex"') where id=call_id;
  raise exception 'Identity update allowed';
 exception when sqlstate 'PT409' then null; end;
 begin
  update public.reader_content_analysis_calls set execution_identity=null where id=call_id;
  raise exception 'Identity removal allowed';
 exception when sqlstate 'PT409' then null; end;
 begin
  update public.reader_content_analysis_calls set model='different-model' where id=call_id;
  raise exception 'Model update allowed';
 exception when sqlstate 'PT409' then null; end;
 -- A transport/ambiguous response with no result and no charge is unknown,
 -- not free. The maximum stays committed even after a UTC day rollover.
 perform public.settle_content_analysis_call(call_id,null,null);
 update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=call_id;
 legacy:=public.reserve_content_analysis_call((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:1',0.01,'google/fixture-model');
 update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=(legacy#>>'{call,id}')::uuid;
 legacy:=(select to_jsonb(c) from public.reader_content_analysis_calls c where id=(legacy#>>'{call,id}')::uuid);
 perform public.settle_content_analysis_call((legacy->>'id')::uuid,null,null);
 legacy:=(select to_jsonb(c) from public.reader_content_analysis_calls c where id=(legacy->>'id')::uuid);
 retry:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:1',0.005,'google/fixture-model',identity);
 if retry->'claimed'<>'false'::jsonb or retry->'call' is distinct from legacy or retry#>'{call,execution_identity}'<>'null'::jsonb then
  raise exception 'Legacy unknown provenance was freshened'; end if;
 retry:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.005,'google/fixture-model',jsonb_set(identity,'{provider}','"google-vertex"'));
 if retry->'claimed'<>'false'::jsonb or retry#>'{call,execution_identity}' is distinct from identity then raise exception 'Day rollover changed identity'; end if;
 if (select count(*) from public.reader_content_analysis_calls where user_id='execution-sql-owner')<>2
  or (select sum(maximum_usd) from public.reader_content_analysis_calls where user_id='execution-sql-owner' and actual_usd is null and result is null)<>0.02
  or exists(select 1 from public.reader_content_analysis_calls where user_id='execution-sql-owner' and state<>'unknown') then
  raise exception 'Ambiguous calls lost their maximum holds'; end if;
 begin
  perform public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:2',0.001,'google/fixture-model',identity);
  raise exception 'Old unknown holds failed to block a new call';
 exception when sqlstate 'PT429' then null; end;
 -- A valid but differently modeled configuration still obeys policy, and
 -- when policy changes the original key returns its immutable old model.
 changed:=jsonb_set(identity,'{model}','"google/another-fixture"');
 begin
  perform public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.001,'google/another-fixture',changed);
  raise exception 'Model policy bypass';
 exception when sqlstate 'PT403' then null; end;
 update public.reader_content_analysis_policies set model='google/another-fixture' where user_id='execution-sql-owner';
 retry:=public.reserve_content_analysis_call_v2((job#>>'{job,id}')::uuid,(job->>'leaseToken')::uuid,'role:0',0.001,'google/another-fixture',changed);
 if retry->'claimed'<>'false'::jsonb or retry#>>'{call,model}'<>'google/fixture-model' or retry#>'{call,execution_identity}' is distinct from identity then
  raise exception 'Policy change replaced original model'; end if;
 -- Existing result/settlement interfaces preserve identity and high-water fees.
 perform public.record_content_analysis_call_result(call_id,(job->>'leaseToken')::uuid,'{"value":{"synthetic":true}}','{"inputTokens":10}',null,null,null);
 perform public.settle_content_analysis_call(call_id,0.006,0.006);
 perform public.settle_content_analysis_call(call_id,0.001,0.001);
 if not exists(select 1 from public.reader_content_analysis_calls where id=call_id and execution_identity=identity and actual_usd=0.006) then
  raise exception 'Result/settlement changed identity or reduced a known charge'; end if;
end;
$$;
rollback;
