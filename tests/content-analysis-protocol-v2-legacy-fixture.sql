-- Synthetic DATABASE-ONLY twelve-row legacy ledger. No private source data.
insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)
 values(true,false,5,5);
insert into public.reader_workspaces(user_id,state) values('protocol-preservation-owner',
 '{"version":1,"followedSourceIds":["fixture-source"],"customSources":[{"id":"fixture-source","name":"Synthetic source","url":"https://example.org/channel","platform":"YouTube","status":"ready","creatorIds":[]}],"savedUpdateIds":[],"readLaterIds":[],"importedUpdates":[],"settings":{}}');
insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
 values('protocol-preservation-owner',false,5,5,0.01,'deepseek/deepseek-v4.1-flash-1017');
do $$
declare n integer; rec jsonb; ids uuid[]:='{}'; chosen uuid; call_number integer; cost numeric;
begin
 for n in 1..4 loop
  rec:=jsonb_build_object('id','fixture-video-'||n,'sourceId','fixture-source','publishedAt','2026-10-24T00:00:00Z',
   'url','https://example.org/video/'||n,'title','Synthetic source','isSample',false,'format','video','contentKind','transcript',
   'content','Synthetic full original fixture words for old protocol preservation.','videoFormat','{"kind":"regular","basis":"watch_page"}'::jsonb,'topics','[]'::jsonb,'brands','[]'::jsonb);
  insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
   values('protocol-preservation-owner',rec->>'id','fixture-source','fixture','2026-10-24T00:00:00Z',rec);
 end loop;
 perform public.sync_content_analysis_jobs('protocol-preservation-owner',200);
 for chosen in select id from public.reader_content_analysis_jobs where user_id='protocol-preservation-owner'
  order by update_id,task limit 7 loop ids:=array_append(ids,chosen); end loop;
 delete from public.reader_content_analysis_jobs where user_id='protocol-preservation-owner' and not (id=any(ids));
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
