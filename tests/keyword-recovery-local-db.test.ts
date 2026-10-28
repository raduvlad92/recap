import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const owner='keyword-recovery-fixture',ds='deepseek/deepseek-v4.1-flash-1017',sol='openai/gpt-6.1-sol-pro';
const content='AeroBox Plus supports C++. Ada is here. ExampleBrand sponsors this.',sourceHash=createHash('sha256').update(content).digest('hex');
const originalContract='d'.repeat(64),hostContract='e'.repeat(64),recoveryContract='f'.repeat(64),baselineOutputHash='a'.repeat(64);
const identity=(model=sol)=>({adapterVersion:'fixture-v1',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'openrouter',model,reasoningEffort:null,pricing:{version:'fixture-v1',inputUsdPerMillion:1,outputUsdPerMillion:1,cachedInputUsdPerMillion:null,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}});
const baseRecord={id:'recover-video',sourceId:'recover-source',publishedAt:'2026-10-27T00:00:00Z',url:'https://example.test/video',title:'Recovery fixture',content,isSample:false,format:'video',contentKind:'transcript',videoFormat:{kind:'regular'},coverage:'partial saved transcript',transcriptSegments:[{text:content,startSeconds:0,durationSeconds:10}],videoKeywords:[{label:'C++',seconds:10,ranges:[{startSeconds:0,endSeconds:10}]}],topics:['C++'],brands:[],keywordContentHash:sourceHash,videoSummary:{ruleVersion:'takeaways-v1',captionHash:sourceHash,status:'ready',timingBasis:'captions'},videoHighlights:[{text:'AeroBox Plus supports C++.',startSeconds:0}],processing:{ruleVersion:'content-v1',contentHash:sourceHash,recap:'ready',keywords:'pending',content:'partial'},editorialNote:'Preserve this exact field.'};
const row=(label:string,kind='product')=>({label,kind,confidence:50,reason:'Exact source fixture.',evidenceQuote:label,ranges:[{startSeconds:0,endSeconds:10}]});
const output=()=>({state:'review',patch:{keywordRuleVersion:'entities-v2'},pending:[{...row('Ada','category'),confidence:0}],evidence:{contentHash:sourceHash,ruleVersion:'entities-v2',coverage:[{start:0,end:content.length}],accepted:[row('AeroBox Plus'),row('ExampleBrand','brand')],generationContractHash:hostContract,recoveryContractHash:recoveryContract,protocolVersion:'named-mentions-v1',chunkCount:1}});

describe.skipIf(!available)('closed-origin keyword recovery, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false,origin:string,sid:string,calls:any[];
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 const plan=(batchIndex=0)=>({sourceOrdinal:1,batchIndex,callKey:'keyword-learning:v1:recovery-fixture-'+batchIndex,model:sol,requestHash:String(batchIndex+6).repeat(64),requestPayload:{request:{role:'checker',key:'keyword-learning:v1:recovery-fixture-'+batchIndex,system:'Only sealed fixture targets.',prompt:'AeroBox Plus',schema:{type:'object'},maxOutputTokens:64},originalKey:null,generationHash:'9'.repeat(64)},executionIdentity:identity()});
 const seal=(plans:unknown[]=[])=>json(`select public.seal_keyword_recovery_plan(${q(sid)},1,${j(calls)},${q(baselineOutputHash)},${j(plans)});`);
 const release=()=>sql(`update public.keyword_learning_sessions set state='released' where id=${q(sid)};update public.keyword_production_releases set state='released' where session_id=${q(sid)};`);
 const pin=(out:unknown=output())=>sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0}',sources->0||jsonb_build_object('reviewedOutputHash',repeat('b',64),'semanticReviewHash',repeat('c',64),'reviewedOutputNativeHash',encode(sha256(convert_to((${j(out)})::text,'UTF8')),'hex'))) where session_id=${q(sid)};`);
 const publishQuery=(out:unknown=output(),proof:unknown=calls)=>`select public.publish_keyword_recovery_result(${q(sid)},1,${q(recoveryContract)},${j(proof)},${j(out)});`;
 const publish=(out:unknown=output(),proof:unknown=calls)=>json(publishQuery(out,proof));
 const reserve=(p=plan(),payload:unknown=p.requestPayload)=>json(`select public.reserve_keyword_learning_call(${q(sid)},${q(p.callKey)},1,${q(sourceHash)},${q(sol)},${j(p.executionIdentity)},${q(p.requestHash)},.1,${j(payload)});`);
 const settle=(p=plan(),r=reserve(p))=>{
  const result={value:{readComplete:true,decisions:[{targetId:0,kind:'product',disposition:'accepted'}]},actualUsd:.001,providerId:'fixture-repair-provider',executionIdentity:p.executionIdentity};
  json(`select public.record_keyword_learning_call(${q(sid)},${q(p.callKey)},${q(r.call.id)},${q(r.call.lease_token)},${q(p.requestHash)},${j(result)},null);`);
  return{chunkIndex:p.batchIndex,role:'repair',callId:r.call.id,requestHash:p.requestHash};
 };
 const record=()=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id='recover-video';`);
 const preserved=()=>sql(`select jsonb_build_object('originSession',(select to_jsonb(s) from public.keyword_learning_sessions s where id=${q(origin)}),'originRelease',(select to_jsonb(r) from public.keyword_production_releases r where session_id=${q(origin)}),'oldCalls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c where call_key not like 'keyword-learning:v1:recovery-fixture-%'),'oldRequests',(select jsonb_agg(to_jsonb(r) order by call_key) from public.keyword_learning_requests r where session_id=${q(origin)}),'publications',(select jsonb_agg(to_jsonb(p) order by id) from public.keyword_production_publications p where session_id=${q(origin)}),'otherArchives',(select jsonb_agg(to_jsonb(a) order by id) from public.reader_source_updates a where id<>'recover-video'),'workspace',(select to_jsonb(w) from public.reader_workspaces w where user_id=${q(owner)}),'budget',(select to_jsonb(b) from public.content_analysis_budget b),'policy',(select to_jsonb(p) from public.reader_content_analysis_policies p where user_id=${q(owner)}));`);
 const concurrent=(s:string)=>new Promise<{stdout:string;stderr:string;code:number}>((resolve)=>execFile('psql',args,{encoding:'utf8',maxBuffer:8*1024*1024},(error,stdout,stderr)=>resolve({stdout,stderr,code:error?Number((error as any).code)||1:0})).stdin!.end(s));
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rckr-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55531`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55531','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.keyword_learning_requests,public.keyword_learning_sessions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,false,5,10) on conflict(id) do update set enabled=false,daily_limit_usd=5,lifetime_limit_usd=10;
   insert into public.reader_workspaces(user_id,state) values(${q(owner)},${j({version:1,followedSourceIds:['recover-source'],customSources:[{id:'recover-source',platform:'YouTube',url:'https://example.test/source',status:'live'}],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}})});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${q(owner)},false,5,10,.1,${q(ds)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${q(owner)},'recover-video','recover-source','fixture','2026-10-27T00:00:00Z',${j(baseRecord)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) select ${q(owner)},'preserved-'||n,'recover-source','fixture','2026-10-27T00:00:00Z',${j(baseRecord)}||jsonb_build_object('id','preserved-'||n) from generate_series(1,14) n;`);
  origin=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at) values(${q(owner)},'closed',${j([{ordinal:1,updateId:'recover-video',sourceHash}])},array[${q(ds)},${q(sol)}],1,9,clock_timestamp()+interval '1 hour') returning id;`);
  sid=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at) values(${q(owner)},'staged',${j([{ordinal:1,updateId:'recover-video',sourceHash}])},array[${q(sol)}],1.5,30,clock_timestamp()+interval '1 hour') returning id;`);
  sql(`insert into public.keyword_production_releases(session_id,contract_hash,state,sources) select ${q(origin)},${q(originalContract)},'closed',jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',a.id,'sourceHash',${q(sourceHash)},'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),'keywordSnapshotHash',public.keyword_production_snapshot(a.record),'chunkCount',1)) from public.reader_source_updates a join public.reader_workspaces w using(user_id) where a.user_id=${q(owner)} and a.id='recover-video';
   insert into public.keyword_production_releases(session_id,contract_hash,state,sources,origin_session_id,baseline_contract_hash) select ${q(sid)},${q(recoveryContract)},'staged',jsonb_build_array(sources->0||jsonb_build_object('baselineGenerationContractHash',${q(hostContract)})),${q(origin)},${q(originalContract)} from public.keyword_production_releases where session_id=${q(origin)};`);
  calls=['direct','typed','checker'].map((role,index)=>{
   const requestHash=String(index+1).repeat(64),key='keyword-learning:v1:original-fixture-'+role,model=role==='checker'?sol:ds;
   const id=sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash,execution_identity) values(${q(owner)},${q(key)},gen_random_uuid(),${q(model)},${q(sourceHash)},.1,'settled',.001,${q(requestHash)},${j(identity(model))}) returning id;`);
   sql(`insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id,result,completed,completed_at) values(${q(origin)},${q(key)},1,${q(sourceHash)},${q(requestHash)},${j({request:{key}})},${q(id)},${j({value:{names:['AeroBox Plus']},actualUsd:.001,providerId:'fixture-original',executionIdentity:identity(model)})},true,clock_timestamp());`);
   return{chunkIndex:0,role,callId:id,requestHash};
  });
  calls.sort((a,b)=>a.chunkIndex-b.chunkIndex||a.role.localeCompare(b.role));
  sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd) values(${q(owner)},'historical-unknown',gen_random_uuid(),${q(ds)},${q(sourceHash)},.01,'unknown',null);
   insert into public.keyword_production_publications(session_id,source_ordinal,user_id,update_id,source_hash,source_revision,contract_hash,generation_receipts,output,previous_annotations,receipt) select ${q(origin)},n+1,${q(owner)},'preserved-'||n,${q(sourceHash)},${q(sourceHash)},${q(originalContract)},${j(calls)},'{}','{}',jsonb_build_object('fixturePublication',n) from generate_series(1,14) n;
   insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url) values(${q(owner)},'recover-video','recover-source',${q(sourceHash)},'ExampleBrand','brand',0,'Existing operator rejection','ExampleBrand','[]','','');
   update public.admin_keyword_reviews set status='rejected',resolved_label=label,resolved_kind=kind where user_id=${q(owner)};`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('publishes zero-new-call recovery from all closed-origin receipts and preserves fourteen publications, old calls/holds, reviews, recaps and workspace',()=>{
  const before=preserved(),review=json('select to_jsonb(r) from public.admin_keyword_reviews r;');seal();release();pin();
  const receipt=publish();expect(receipt.published).toBe(true);expect(receipt.originSessionId).toBe(origin);expect(receipt.newCallCount).toBe(0);expect(Number(receipt.newSettledUsd)).toBe(0);
  expect(preserved()).toBe(before);expect(record().topics.sort()).toEqual(['AeroBox Plus','C++']);expect(record().videoSummary).toEqual(baseRecord.videoSummary);expect(record().videoHighlights).toEqual(baseRecord.videoHighlights);expect(record().processing.recap).toBe('ready');expect(record().editorialNote).toBe(baseRecord.editorialNote);expect(record().content).toBe(content);
  expect(json(`select to_jsonb(r) from public.admin_keyword_reviews r where label='ExampleBrand';`)).toEqual(review);
  expect(json(`select count(*)::integer from public.keyword_learning_requests where session_id=${q(sid)};`)).toBe(0);
  expect(json('select generation_receipts from public.keyword_production_publications where session_id='+q(sid)+';').every((r:any)=>r.originSessionId===origin)).toBe(true);
 });
 it('seals exact request payloads, meters only the fresh repair once, and preserves every old ledger row',()=>{
  const before=preserved(),p=plan();expect(seal([p]).requestCount).toBe(1);release();const reserved=reserve(p);expect(reserved.claimed).toBe(true);expect(reserve(p).claimed).toBe(false);const repair=settle(p,reserved);pin();
  const receipt=publish(output(),[...calls,repair]);expect(receipt.newCallCount).toBe(1);expect(Number(receipt.newSettledUsd)).toBe(.001);expect(preserved()).toBe(before);
  expect(json('select count(*)::integer from public.reader_content_analysis_calls;')).toBe(5);
 });
 it('replays an exact publication after closure without another write or charge and rejects changed evidence/output',()=>{
  seal();release();pin();const first=publish(),saved=record();sql(`update public.keyword_learning_sessions set state='closed' where id=${q(sid)};update public.keyword_production_releases set state='closed' where session_id=${q(sid)};`);
  expect(publish(output(),[...calls].reverse())).toEqual({...first,replayed:true});expect(record()).toEqual(saved);expect(()=>publish({...output(),state:'ready'})).toThrow();expect(()=>publish(output(),calls.slice(1))).toThrow();
 });
 it('allows exact plan replay after release but prevents re-sealing a changed baseline or request',()=>{
  const p=plan();seal([p]);release();expect(seal([p]).replayed).toBe(true);expect(()=>seal([{...p,requestPayload:{...p.requestPayload,originalKey:'changed'}}])).toThrow();
  sql(`update public.keyword_learning_requests set result=jsonb_set(result,'{value}','{"changed":true}') where call_id=${q(calls[0].callId)};`);expect(()=>seal([p])).toThrow();
 });
 it('selects an earlier paid attempt independently of the closed release last policy and permits additional source-bound timing holds',()=>{
  sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0}',sources->0||${j({checkerPolicy:'strict-context-v1',sectionSweepChunks:[0],timingReviews:[]})}) where session_id=${q(origin)};
   update public.keyword_production_releases set sources=jsonb_set(sources,'{0}',sources->0||${j({checkerPolicy:'alias-boundaries-v1',sectionSweepChunks:[],timingReviews:[{name:'C++',evidenceQuote:'AeroBox Plus supports C++.'}]})}) where session_id=${q(sid)};`);
  const sealed=seal();expect(sealed.baselinePolicyHashPGsha).toMatch(/^[a-f0-9]{64}$/);release();pin();expect(publish().published).toBe(true);
 });
 it('seals source-bound context reviews and refuses a later valid-context change without an archive write',()=>{
  const firstSentence=content.slice(0,content.indexOf('.')+1),reviews=[{name:'C++',contexts:[{start:0,end:firstSentence.length,text:firstSentence}]}];
  sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0,contextReviews}',${j(reviews)}) where session_id=${q(sid)};`);
  const sealed=seal();expect(sealed.baselinePolicyHashPGsha).toMatch(/^[a-f0-9]{64}$/);release();pin();expect(seal().replayed).toBe(true);
  const changed=[{name:'C++',contexts:[{start:0,end:content.length,text:content}]}];
  sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0,contextReviews}',${j(changed)}) where session_id=${q(sid)};`);
  expect(()=>seal()).toThrow();expect(()=>publish()).toThrow();expect(record()).toEqual(baseRecord);
  expect(json(`select count(*)::integer from public.keyword_production_publications where session_id=${q(sid)};`)).toBe(0);
 });
 it.each(['payload','hash','identity','key'])('rolls back a ledger reservation for an unlisted %s before dispatch',field=>{
  const p=plan();seal([p]);release();const before=sql('select count(*) from public.reader_content_analysis_calls;');
  const changed=structuredClone(p);if(field==='payload')changed.requestPayload.request.prompt='Unrelated prompt';if(field==='hash')changed.requestHash='8'.repeat(64);if(field==='identity')changed.executionIdentity.pricing.version='changed';if(field==='key')changed.callKey='keyword-learning:v1:unlisted';
  expect(()=>reserve(changed)).toThrow();expect(sql('select count(*) from public.reader_content_analysis_calls;')).toBe(before);expect(json(`select count(*)::integer from public.keyword_learning_requests where session_id=${q(sid)};`)).toBe(0);
 });
 it('keeps an unknown fresh call held and refuses another admitted request without resending the first',()=>{
  const a=plan(0),b=plan(1);seal([a,b]);release();const first=reserve(a);json(`select public.record_keyword_learning_call(${q(sid)},${q(a.callKey)},${q(first.call.id)},${q(first.call.lease_token)},${q(a.requestHash)},null,'analysis_generation_failed');`);
  expect(reserve(a).claimed).toBe(false);expect(()=>reserve(b)).toThrow();expect(service(`select state from public.reader_content_analysis_calls where id=${q(first.call.id)};`)).toBe('unknown');
 });
 it.each(['missing','duplicate','unknown'])('rejects %s original evidence at plan sealing',mode=>{
  const proof=mode==='missing'?calls.slice(1):mode==='duplicate'?[calls[0],calls[0],calls[2]]:calls;
  if(mode==='unknown')sql(`update public.reader_content_analysis_calls set state='unknown',actual_usd=null where id=${q(calls[0].callId)};`);
  expect(()=>json(`select public.seal_keyword_recovery_plan(${q(sid)},1,${j(proof)},${q(baselineOutputHash)},'[]');`)).toThrow();expect(record()).toEqual(baseRecord);
 });
 it.each(['origin-open','origin-contract','policy','result','payload','review-pin','review-hash','wrong-host-contract','wrong-recovery-contract','missing-repair'])('holds publication on %s drift with no archive write',mode=>{
  const plans=mode==='missing-repair'?[plan()]:[];seal(plans);release();const out=output();pin(out);
  if(mode==='origin-open')sql(`update public.keyword_learning_sessions set state='released' where id=${q(origin)};`);
  if(mode==='origin-contract')sql(`update public.keyword_production_releases set contract_hash=repeat('a',64) where session_id=${q(origin)};`);
  if(mode==='policy')sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0,checkerPolicy}','"strict-context-v1"') where session_id=${q(sid)};`);
  if(mode==='result')sql(`update public.keyword_learning_requests set result=jsonb_set(result,'{value}','{"changed":true}') where call_id=${q(calls[0].callId)};`);
  if(mode==='payload')sql(`update public.keyword_learning_requests set request_payload=jsonb_set(request_payload,'{changed}','true') where call_id=${q(calls[0].callId)};`);
  if(mode==='review-pin')sql(`update public.keyword_production_releases set sources=sources#-'{0,reviewedOutputNativeHash}' where session_id=${q(sid)};`);
  if(mode==='review-hash')sql(`update public.keyword_production_releases set sources=sources#-'{0,semanticReviewHash}' where session_id=${q(sid)};`);
  if(mode==='wrong-host-contract'){out.evidence.generationContractHash='a'.repeat(64);pin(out);}
  if(mode==='wrong-recovery-contract'){out.evidence.recoveryContractHash='a'.repeat(64);pin(out);}
  expect(()=>publish(out)).toThrow();expect(record()).toEqual(baseRecord);expect(json(`select count(*)::integer from public.keyword_production_publications where session_id=${q(sid)};`)).toBe(0);
 });
 it.each(['content','keywords','follows'])('rejects current %s drift atomically',mode=>{
  seal();release();pin();if(mode==='content')sql(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"changed"') where id='recover-video';`);
  if(mode==='keywords')sql(`update public.reader_source_updates set record=jsonb_set(record,'{topics}','["Changed"]') where id='recover-video';`);
  if(mode==='follows')sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);
  const before=record();expect(()=>publish()).toThrow();expect(record()).toEqual(before);
 });
 it('serializes simultaneous identical publications to one immutable receipt',async()=>{
  seal();release();pin();const results=await Promise.all([concurrent('set role service_role;'+publishQuery()),concurrent('set role service_role;'+publishQuery())]);expect(results.map(r=>r.code)).toEqual([0,0]);
  expect(results.map(r=>JSON.parse(r.stdout.trim()).replayed).sort()).toEqual([false,true]);expect(json(`select count(*)::integer from public.keyword_production_publications where session_id=${q(sid)};`)).toBe(1);
 });
 it('erases sealed source payloads and caches without erasing charges, including after a held repair',()=>{
  const p=plan();seal([p]);release();reserve(p);const charges=sql('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;');
  sql(`delete from public.reader_source_updates where user_id=${q(owner)} and id='recover-video';`);
  expect(sql('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;')).toBe(charges);expect(json(`select recovery_requests from public.keyword_production_releases where session_id=${q(sid)};`)).toEqual([]);
  expect(json(`select sources from public.keyword_production_releases where session_id=${q(sid)};`)).toEqual([]);expect(service(`select bool_and(request_payload is null and result is null) from public.keyword_learning_requests;`)).toBe('t');expect(()=>publish()).toThrow();
 });
 it('takes archive before sessions when deletion races publication and never resurrects erased content',async()=>{
  seal();release();pin();const deletion=concurrent(`begin;set local lock_timeout='2s';select id from public.reader_source_updates where id='recover-video' for update;select pg_sleep(.15);delete from public.reader_source_updates where id='recover-video';commit;`);
  await new Promise(resolve=>setTimeout(resolve,30));const publishing=concurrent(`set role service_role;set lock_timeout='2s';${publishQuery()}`);const results=await Promise.all([deletion,publishing]);expect(results[0].code).toBe(0);expect(results.every(r=>!r.stderr.includes('deadlock detected'))).toBe(true);expect(json(`select count(*)::integer from public.reader_source_updates where id='recover-video';`)).toBe(0);
 });
 it('denies anonymous and authenticated access to every recovery helper and RPC',()=>{
  for(const role of ['anon','authenticated'])for(const name of ['keyword_recovery_origin_receipts(uuid,integer,jsonb)','seal_keyword_recovery_plan(uuid,integer,jsonb,text,jsonb)','enforce_keyword_recovery_request()','publish_keyword_recovery_result(uuid,integer,text,jsonb,jsonb)'])expect(sql(`select has_function_privilege(${q(role)},${q('public.'+name)},'execute');`)).toBe('f');
 });
});
