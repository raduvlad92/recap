import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const owner='keyword-production-fixture',ds='deepseek/deepseek-v4.1-flash-1017',sol='openai/gpt-6.1-sol-pro';
const content='AeroBox Plus supports C++. Ada is here. ExampleBrand sponsors this.\nGoogle \n Home is fine.',hash=createHash('sha256').update(content).digest('hex'),contract='d'.repeat(64);
const baseRecord={id:'kw-video',sourceId:'kw-source',publishedAt:'2026-10-27T00:00:00Z',url:'https://example.test/watch',title:'Fixture',content,isSample:false,format:'video',contentKind:'transcript',videoFormat:{kind:'regular'},coverage:'partial saved transcript',
 transcriptSegments:[{text:content,startSeconds:0,durationSeconds:10}],videoKeywords:[{label:'C++',seconds:10,ranges:[{startSeconds:0,endSeconds:10}]}],topics:['C++'],brands:[],keywordContentHash:hash,
 videoSummary:{ruleVersion:'takeaways-v1',captionHash:hash,status:'ready',timingBasis:'captions'},videoHighlights:[{text:'AeroBox Plus supports C++.',startSeconds:0}],processing:{ruleVersion:'content-v1',contentHash:hash,recap:'ready',keywords:'pending',content:'partial'},editorialNote:'Preserve this exact field.'};
const row=(label:string,kind='product')=>({label,kind,confidence:50,reason:'Source-only checker disposition; score is a legacy compatibility marker.',evidenceQuote:label,ranges:[{startSeconds:0,endSeconds:10}]});
const output=()=>({state:'review',patch:{keywordRuleVersion:'entities-v2'},pending:[{...row('Ada','category'),confidence:0}],evidence:{contentHash:hash,ruleVersion:'entities-v2',coverage:[{start:0,end:content.length}],accepted:[row('AeroBox Plus'),row('ExampleBrand','brand')],generationContractHash:contract,protocolVersion:'named-mentions-v1',chunkCount:1}});
describe.skipIf(!available)('finite keyword publication, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false,sid:string,calls:any[];
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 const publishQuery=(out:unknown=output(),proof:unknown=calls)=>`select public.publish_keyword_production_result(${q(sid)},1,${q(contract)},${j(proof)},${j(out)});`;
 const publish=(out:unknown=output(),proof:unknown=calls)=>json(publishQuery(out,proof));
 const record=()=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id='kw-video';`);
 const freeze=()=>sql(`update public.keyword_production_releases set sources=(select jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',a.id,'sourceHash',${q(hash)},'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),'keywordSnapshotHash',public.keyword_production_snapshot(a.record),'chunkCount',1)) from public.reader_source_updates a join public.reader_workspaces w using(user_id) where a.user_id=${q(owner)} and a.id='kw-video') where session_id=${q(sid)};`);
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rckp-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55529`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55529','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.keyword_learning_requests,public.keyword_learning_sessions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,false,5,10) on conflict(id) do update set enabled=false,daily_limit_usd=5,lifetime_limit_usd=10;
   insert into public.reader_workspaces(user_id,state) values(${q(owner)},${j({version:1,followedSourceIds:['kw-source'],customSources:[{id:'kw-source',platform:'YouTube',url:'https://example.test/source',status:'live'}],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}})});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${q(owner)},false,5,10,.1,${q(ds)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${q(owner)},'kw-video','kw-source','fixture','2026-10-27T00:00:00Z',${j(baseRecord)});`);
  sid=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at) values(${q(owner)},'released',${j([{ordinal:1,updateId:'kw-video',sourceHash:hash}])},array[${q(ds)},${q(sol)}],1,9,clock_timestamp()+interval '1 hour') returning id;`);
  sql(`insert into public.keyword_production_releases(session_id,contract_hash,state,sources) values(${q(sid)},${q(contract)},'released','[{"ordinal":1}]');`);freeze();
  calls=['direct','typed','checker'].map((role,index)=>{
   const requestHash=String(index+1).repeat(64),key='keyword-learning:v1:production-fixture-'+role;
   const id=sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash) values(${q(owner)},${q(key)},gen_random_uuid(),${q(role==='checker'?sol:ds)},${q(hash)},.1,'settled',.001,${q(requestHash)}) returning id;`);
   sql(`insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id,result,completed,completed_at) values(${q(sid)},${q(key)},1,${q(hash)},${q(requestHash)},${j({request:{key}})},${q(id)},${j({value:{names:['AeroBox Plus']},actualUsd:.001})},true,clock_timestamp());`);
   return{chunkIndex:0,role,callId:id,requestHash};
  });
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('publishes accepted names, keeps uncertainty private, and preserves editorial/summary/workspace/financial/job history',()=>{
  const before=sql(`select jsonb_build_object('workspace',(select jsonb_agg(to_jsonb(w)) from public.reader_workspaces w),'jobs',(select jsonb_agg(to_jsonb(j)) from public.reader_content_analysis_jobs j),'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),'budget',(select to_jsonb(b) from public.content_analysis_budget b),'policy',(select jsonb_agg(to_jsonb(p)) from public.reader_content_analysis_policies p));`);
  const receipt=publish(),after=record();expect(receipt.published).toBe(true);expect(receipt.keywordCount).toBe(3);expect(receipt.state).toBe('review');
  expect(after.videoKeywords.map((x:any)=>x.label).sort()).toEqual(['AeroBox Plus','C++','ExampleBrand']);expect(after.topics).not.toContain('Ada');expect(after.brands).toContain('ExampleBrand');
  expect(after.videoSummary).toEqual(baseRecord.videoSummary);expect(after.videoHighlights).toEqual(baseRecord.videoHighlights);expect(after.editorialNote).toBe(baseRecord.editorialNote);expect(after.processing.recap).toBe('ready');expect(after.content).toBe(content);
  expect(service(`select label from public.admin_keyword_reviews where user_id=${q(owner)};`)).toBe('Ada');
  expect(sql(`select jsonb_build_object('workspace',(select jsonb_agg(to_jsonb(w)) from public.reader_workspaces w),'jobs',(select jsonb_agg(to_jsonb(j)) from public.reader_content_analysis_jobs j),'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),'budget',(select to_jsonb(b) from public.content_analysis_budget b),'policy',(select jsonb_agg(to_jsonb(p)) from public.reader_content_analysis_policies p));`)).toBe(before);
  expect(json('select previous_annotations from public.keyword_production_publications;').videoKeywords).toEqual(baseRecord.videoKeywords);
 });
 it('replays the exact receipt after closure without touching the archive or accepting changed output/evidence',()=>{
  const first=publish(),saved=record();sql(`update public.keyword_learning_sessions set state='closed' where id=${q(sid)};update public.keyword_production_releases set state='closed' where session_id=${q(sid)};`);
  expect(publish(output(),[...calls].reverse())).toEqual({...first,replayed:true});expect(record()).toEqual(saved);
  expect(()=>publish({...output(),state:'ready'})).toThrow();expect(()=>publish(output(),calls.map((x,i)=>i?x:{...x,requestHash:'e'.repeat(64)}))).toThrow();expect(service('select count(*) from public.keyword_production_publications;')).toBe('1');
 });
 it.each(['staged','closed'])('rejects a %s publication release with no archive write',state=>{
  sql(`update public.keyword_production_releases set state=${q(state)} where session_id=${q(sid)};`);expect(()=>publish()).toThrow();expect(record()).toEqual(baseRecord);expect(service('select count(*) from public.keyword_production_publications;')).toBe('0');
 });
 it('rejects closed/expired sessions and unapproved contract bindings',()=>{
  sql(`update public.keyword_learning_sessions set state='closed' where id=${q(sid)};`);expect(()=>publish()).toThrow();
  sql(`update public.keyword_learning_sessions set state='released',created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${q(sid)};`);expect(()=>publish()).toThrow();
  sql(`update public.keyword_learning_sessions set expires_at=clock_timestamp()+interval '1 hour' where id=${q(sid)};update public.keyword_production_releases set contract_hash=repeat('e',64) where session_id=${q(sid)};`);expect(()=>publish()).toThrow();
 });
 it.each([
  `update public.reader_source_updates set record=jsonb_set(record,'{content}','"Changed source"') where id='kw-video';`,
  `update public.reader_source_updates set record=jsonb_set(record,'{title}','"Changed identity"') where id='kw-video';`,
  `update public.reader_source_updates set record=jsonb_set(record,'{videoKeywords}','[]') where id='kw-video';`,
  `update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`,
  `update public.reader_workspaces set state=jsonb_set(state,'{customSources,0,url}','"https://other.example/source"');`,
 ])('rejects a concurrent source/keyword/follow change',change=>{sql(change);expect(()=>publish()).toThrow();expect(service('select count(*) from public.keyword_production_publications;')).toBe('0');});
 it('allows an unrelated bookmark save while preserving it and a concurrent summary correction',()=>{
  sql(`update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["kw-video"]');update public.reader_source_updates set record=jsonb_set(record,'{videoHighlights}','[{"text":"A reviewed correction"}]') where id='kw-video';`);
  expect(publish().published).toBe(true);expect(record().videoHighlights).toEqual([{text:'A reviewed correction'}]);expect(json(`select state from public.reader_workspaces where user_id=${q(owner)};`).savedUpdateIds).toEqual(['kw-video']);
 });
 it.each([
  `update public.reader_content_analysis_calls set state='unknown',actual_usd=null where model=${q(sol)};`,
  `update public.keyword_learning_requests set completed=false where call_key like '%checker';`,
  `update public.keyword_learning_requests set error_code='analysis_invalid_output' where call_key like '%checker';`,
  `update public.keyword_learning_requests set result=jsonb_set(result,'{validationError}','"analysis_invalid_output"') where call_key like '%checker';`,
  `update public.keyword_learning_requests set source_ordinal=2 where call_key like '%checker';`,
 ])('requires successful settled immutable evidence for every generation',change=>{sql(change);expect(()=>publish()).toThrow();expect(record()).toEqual(baseRecord);});
 it('rejects incomplete, duplicate and changed generation receipts',()=>{
  expect(()=>publish(output(),calls.slice(0,2))).toThrow();expect(()=>publish(output(),[calls[0],calls[0],calls[2]])).toThrow();
  expect(()=>publish(output(),calls.map(x=>({...x,role:x.role==='checker'?'direct':x.role==='direct'?'checker':x.role})))).toThrow();
  expect(()=>publish(output(),calls.map((x,i)=>i?x:{...x,requestHash:'e'.repeat(64)}))).toThrow();expect(()=>publish(output(),calls.map((x,i)=>i?x:{...x,chunkIndex:1}))).toThrow();expect(record()).toEqual(baseRecord);
 });
 it('requires every accepted label to occur in the saved source even if its separate quote is real',()=>{
  const bad=output();bad.evidence.accepted[0]={...bad.evidence.accepted[0],label:'Invented Product'};expect(()=>publish(bad)).toThrow();expect(record()).toEqual(baseRecord);
 });
 it('accepts names spanning source line breaks while retaining the exact original evidence quote',()=>{
  const out=output();out.evidence.accepted.push({...row('Google Home','technology'),evidenceQuote:'Google \n Home'});
  expect(publish(out).published).toBe(true);expect(record().topics).toContain('Google Home');
  expect(json('select output from public.keyword_production_publications;').evidence.accepted.find((x:any)=>x.label==='Google Home').evidenceQuote).toBe('Google \n Home');
 });
 it('requires all three distinct model roles for every frozen chunk',()=>{
  const extra=calls.map((prior,index)=>{
   const key='keyword-learning:v1:second-chunk-'+prior.role,requestHash=String(index+4).repeat(64);
   const id=sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash) select user_id,${q(key)},gen_random_uuid(),model,source_revision,maximum_usd,state,actual_usd,${q(requestHash)} from public.reader_content_analysis_calls where id=${q(prior.callId)} returning id;`);
   sql(`insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id,result,completed,completed_at) select session_id,${q(key)},source_ordinal,source_hash,${q(requestHash)},${j({request:{key}})},${q(id)},result,true,clock_timestamp() from public.keyword_learning_requests where call_id=${q(prior.callId)};`);
   return{chunkIndex:1,role:prior.role,callId:id,requestHash};
  });
  sql(`update public.keyword_production_releases set sources=jsonb_set(sources,'{0,chunkCount}','2') where session_id=${q(sid)};`);
  const out=output();out.evidence.chunkCount=2;expect(()=>publish(out,calls)).toThrow();expect(publish(out,[...calls,...extra]).published).toBe(true);expect(json('select generation_receipts from public.keyword_production_publications;')).toHaveLength(6);
 });
 it('requires source cue boundaries and full coverage without claiming empty success',()=>{
  const bad=output();bad.evidence.accepted[0].ranges=[{startSeconds:1,endSeconds:2}];expect(()=>publish(bad)).toThrow();
  const short=output();short.evidence.coverage=[{start:0,end:content.length-1}];expect(()=>publish(short)).toThrow();
  const empty=output();empty.evidence.accepted=[];empty.pending=[];empty.state='empty';expect(()=>publish(empty)).toThrow();
 });
 it('preserves operator decisions and machine-review history while settling only source-bound newly accepted names',()=>{
  sql(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url) values(${q(owner)},'kw-video','kw-source',${q(hash)},'AeroBox Plus','product',0,'Review me','AeroBox Plus','[]','',''),(${q(owner)},'kw-video','kw-source',${q(hash)},'ExampleBrand','brand',0,'Review me','ExampleBrand','[]','',''),(${q(owner)},'kw-video','kw-source',${q(hash)},'C++','technology',0,'Review me','C++','[]','','');
   update public.admin_keyword_reviews set status='rejected',resolved_label=label,resolved_kind=kind where label='ExampleBrand';
   update public.admin_keyword_reviews set status='approved',resolved_label=label,resolved_kind=kind where label='C++';`);freeze();
  const before=json(`select jsonb_agg(to_jsonb(r) order by label) from public.admin_keyword_reviews r;`),receipt=publish();
  expect([...record().topics].sort()).toEqual(['AeroBox Plus','C++']);expect(record().brands).toEqual(['AeroBox Plus']);
  expect(json(`select jsonb_agg(to_jsonb(r) order by label) from public.admin_keyword_reviews r where label<>'Ada';`)).toEqual(before);
  expect(receipt.machineAdjudicatedPendingReviewIds).toHaveLength(1);
  expect(json(`select jsonb_agg(label order by label) from public.admin_keyword_review_queue where status='pending';`)).toEqual(['Ada']);
  sql(`update public.admin_keyword_reviews set status='rejected',resolved_label=label,resolved_kind=kind,updated_at=clock_timestamp() where label='AeroBox Plus';`);
  expect(service(`select label from public.admin_keyword_review_queue where label='AeroBox Plus' and status='rejected';`)).toBe('AeroBox Plus');
 });
 it('preserves an accepted existing brand and ranges instead of replacing its type with a coarse category',()=>{
  sql(`update public.reader_source_updates set record=record||${j({videoKeywords:[row('ExampleBrand','brand')].map(({label,ranges})=>({label,ranges,seconds:10})),topics:['ExampleBrand'],brands:['ExampleBrand']})} where id='kw-video';`);freeze();
  const out=output();out.evidence.accepted[1].kind='category';publish(out);expect(record().brands).toContain('ExampleBrand');expect(record().videoKeywords.find((x:any)=>x.label==='ExampleBrand').ranges).toEqual([{startSeconds:0,endSeconds:10}]);
 });
 it('validates 1,000 whole-source entries and rejects 1,001 while retaining independent grounding and byte guards',()=>{
  const labels=Array.from({length:1001},(_,index)=>`NamedItem${index}`),source=labels.join(' '),sourceHash=createHash('sha256').update(source).digest('hex');
  const candidate=(label:string)=>({...row(label),ranges:[]});
  const result={...output(),state:'ready',pending:[],evidence:{...output().evidence,contentHash:sourceHash,coverage:[{start:0,end:source.length}],accepted:labels.slice(0,1000).map(candidate)}};
  const validate=(value:unknown)=>service(`select public.validate_content_analysis_result('keywords',${j(value)},${j({content:source})},${q(sourceHash)});`);
  expect(()=>validate(result)).not.toThrow();
  expect(()=>validate({...result,evidence:{...result.evidence,accepted:labels.map(candidate)}})).toThrow(/Invalid keyword inventory/);
  expect(()=>validate({...result,evidence:{...result.evidence,accepted:result.evidence.accepted.map((item,index)=>index?item:{...item,evidenceQuote:'Not in source'})}})).toThrow(/Invalid keyword candidate/);
  expect(()=>validate({...result,evidence:{...result.evidence,unused:'x'.repeat(500000)}})).toThrow(/Invalid prepared analysis/);
 });
 it('publishes 618 accepted plus 31 private entries with prior annotations intact, then permits an ordinary review above 500',()=>{
  const labels=Array.from({length:649},(_,index)=>`NamedItem${index}`),source=content+' '+labels.join(' '),sourceHash=createHash('sha256').update(source).digest('hex');
  const largeRecord={...baseRecord,content:source,keywordContentHash:sourceHash,transcriptSegments:[{text:source,startSeconds:0,durationSeconds:10}]};
  sql(`update public.reader_source_updates set record=${j(largeRecord)} where id='kw-video';
   update public.keyword_learning_sessions set sources=${j([{ordinal:1,updateId:'kw-video',sourceHash}])} where id=${q(sid)};
   update public.keyword_production_releases set sources=(select jsonb_build_array(jsonb_build_object('ordinal',1,'updateId',a.id,'sourceHash',${q(sourceHash)},'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),'keywordSnapshotHash',public.keyword_production_snapshot(a.record),'chunkCount',1)) from public.reader_source_updates a join public.reader_workspaces w using(user_id) where a.id='kw-video') where session_id=${q(sid)};`);
  calls=calls.map(prior=>{
   const key='keyword-learning:v1:large-fixture-'+prior.role;
   const id=sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash) select user_id,${q(key)},gen_random_uuid(),model,${q(sourceHash)},maximum_usd,state,actual_usd,request_hash from public.reader_content_analysis_calls where id=${q(prior.callId)} returning id;`);
   sql(`insert into public.keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id,result,completed,completed_at) select session_id,${q(key)},source_ordinal,${q(sourceHash)},request_hash,${j({request:{key}})},${q(id)},result,true,clock_timestamp() from public.keyword_learning_requests where call_id=${q(prior.callId)};`);
   return{...prior,callId:id};
  });
  const out={...output(),pending:labels.slice(618).map(label=>({...row(label),confidence:0})),evidence:{...output().evidence,contentHash:sourceHash,coverage:[{start:0,end:source.length}],accepted:labels.slice(0,618).map(label=>row(label))}};
  const receipt=publish(out);expect(receipt.keywordCount).toBe(619);expect(receipt.acceptedCount).toBe(618);expect(receipt.pendingCount).toBe(31);
  expect(record().videoKeywords.find((item:any)=>item.label==='C++')).toEqual(baseRecord.videoKeywords[0]);
  expect(record().content).toBe(source);expect(record().videoHighlights).toEqual(baseRecord.videoHighlights);expect(record().editorialNote).toBe(baseRecord.editorialNote);
  const pending=json(`select to_jsonb(r) from public.admin_keyword_reviews r where label=${q(labels[618])};`);
  expect(json(`select public.admin_review_keyword(${q(pending.id)},${q(pending.updated_at)},'fixture-admin','approve',${q(pending.label)},'product');`).status).toBe('approved');
  expect(record().videoKeywords).toHaveLength(620);expect(service('select count(*) from public.admin_keyword_review_queue;')).toBe('31');
 });
 it('changes only the four bounded function predicates without rewriting existing publication data or function privileges',()=>{
  publish();
  const snapshot=()=>sql(`select jsonb_build_object('archive',(select jsonb_agg(to_jsonb(r)) from public.reader_source_updates r),'workspace',(select jsonb_agg(to_jsonb(w)) from public.reader_workspaces w),'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),'publications',(select jsonb_agg(to_jsonb(p)) from public.keyword_production_publications p),'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),'session',(select jsonb_agg(to_jsonb(s)) from public.keyword_learning_sessions s),'release',(select jsonb_agg(to_jsonb(r)) from public.keyword_production_releases r));`);
  const signatures=['validate_content_analysis_result(text,jsonb,jsonb,text)','publish_keyword_production_result(uuid,integer,text,jsonb,jsonb)','publish_content_analysis_job(uuid,uuid)','admin_review_keyword_before_content_processing(uuid,timestamp with time zone,text,text,text,text)'];
  const predicates=[["jsonb_array_length(p_result#>'{evidence,accepted}')+jsonb_array_length(p_result->'pending') not between 1 and 1000","jsonb_array_length(p_result#>'{evidence,accepted}')+jsonb_array_length(p_result->'pending') not between 1 and 500"],['jsonb_each(entries))>1000','jsonb_each(entries))>500'],['jsonb_each(entries))>1000','jsonb_each(entries))>500'],['jsonb_array_length(keywords)>1000 or','jsonb_array_length(keywords)>500 or']];
  const privileges=()=>sql(`select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'securityDefiner',prosecdef,'config',proconfig) order by oid) from pg_proc where oid in (${signatures.map(signature=>q('public.'+signature)+'::regprocedure').join(',')});`);
  const before=snapshot(),grants=privileges();
  signatures.forEach((signature,index)=>{const definition=sql(`select pg_get_functiondef(${q('public.'+signature)}::regprocedure);`),[current,prior]=predicates[index];expect(definition.split(current)).toHaveLength(2);sql(definition.replace(current,prior));});
  sql(readFileSync(new URL('../supabase/migrations/20261028023000_keyword_capacity.sql',import.meta.url),'utf8'));
  expect(snapshot()).toBe(before);expect(privileges()).toBe(grants);
  expect(()=>sql(readFileSync(new URL('../supabase/migrations/20261028023000_keyword_capacity.sql',import.meta.url),'utf8'))).toThrow(/Keyword capacity predicate drift/);
 });
 it('has no ordinary reader access or public EXECUTE permission',()=>{
  for(const role of ['anon','authenticated']){
   expect(()=>sql(`set role ${role};select * from public.keyword_production_releases;`)).toThrow();expect(()=>sql(`set role ${role};select * from public.keyword_production_publications;`)).toThrow();expect(()=>sql(`set role ${role};select * from public.admin_keyword_review_queue;`)).toThrow();expect(()=>sql(`set role ${role};`+publishQuery())).toThrow();
  }
  expect(()=>service(`insert into public.keyword_production_releases(session_id,contract_hash,state,sources) values(gen_random_uuid(),repeat('a',64),'released','[{}]');`)).toThrow();
  expect(()=>service(`select public.erase_keyword_production_release();`)).toThrow();
 });
 it.each(['archive','workspace'])('erases private production evidence on %s deletion while retaining historical charges',scope=>{
  publish();sql(scope==='archive'?`delete from public.reader_source_updates where user_id=${q(owner)} and id='kw-video';`:`delete from public.reader_workspaces where user_id=${q(owner)};`);
  expect(service('select count(*) from public.keyword_production_publications;')).toBe('0');expect(service('select state from public.keyword_production_releases;')).toBe('closed');expect(service('select sources from public.keyword_production_releases;')).toBe('[]');expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('3');expect(()=>publish()).toThrow();
 });
 it('serializes simultaneous duplicate publication into one immutable receipt and one set of reviews',async()=>{
  const run=(query:string)=>new Promise<string>((resolve,reject)=>{const child=execFile('psql',args,{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin?.end(query);});
  const replies=await Promise.all([run('set role service_role;'+publishQuery()),run('set role service_role;'+publishQuery())]);
  const receipts=replies.map(x=>JSON.parse(x.trim()));expect(new Set(receipts.map(x=>x.publicationId)).size).toBe(1);expect(receipts.map(x=>x.replayed).sort()).toEqual([false,true]);expect(service('select count(*) from public.keyword_production_publications;')).toBe('1');expect(service('select count(*) from public.admin_keyword_reviews;')).toBe('1');
 });
});
