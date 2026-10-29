import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const owner='admin-analysis-fixture',content='🚀 AeroBox uses a quiet focus setting. The laboratory found a measurable improvement over the older design.';
const hash=createHash('sha256').update(content).digest('hex'),model='deepseek/deepseek-v4.1-flash-1017';
const identity={adapterVersion:'fixture-v1',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'openrouter',model,reasoningEffort:null,pricing:{version:'fixture-v1',inputUsdPerMillion:1,outputUsdPerMillion:1,cachedInputUsdPerMillion:null,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
const record={id:'review-video',sourceId:'review-source',publishedAt:'2026-10-28T00:00:00Z',url:'https://example.test/video',title:'Review fixture',content,isSample:false,format:'video',contentKind:'transcript',videoFormat:{kind:'regular'},coverage:'partial saved transcript',videoKeywords:[],topics:[],brands:[],videoHighlights:[{text:'Prior reviewed finding'}]};
describe.skipIf(!available)('compact review inbox, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false;
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 const source=()=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id='review-video';`);
 const row=(kind='keyword',proposal:unknown={label:'quiet focus',kind:'technology'})=>json(`insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
  values(${q(owner)},'review-video','review-source',${q(hash)},${q(kind)},gen_random_uuid()::text,${j(record)},${j(proposal)},'Unclear naming boundary','{"availability":"unavailable","prompts":[]}')returning to_jsonb(admin_analysis_reviews);`);
 const decide=(r:any,decision='approve',proposal:unknown=null)=>json(`select public.admin_decide_analysis_review(${q(r.id)},${q(r.updated_at)},'admin:fixture',${q(decision)},${proposal===null?'null':j(proposal)});`);
 const job=(state='running',task='summary',result:unknown=null,error:string|null=null)=>sql(`insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,workspace_revision,task,state,lease_token,lease_until,result,error_code)
  select ${q(owner)},a.id,a.source_id,${q(hash)},public.content_analysis_source_revision(a.record),public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,${q(task)},${q(state)},gen_random_uuid(),clock_timestamp()+interval '5 minutes',${result===null?'null':j(result)},${error===null?'null':q(error)}
  from public.reader_source_updates a join public.reader_workspaces w using(user_id)where a.user_id=${q(owner)}and a.id='review-video'returning id;`);
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rcar-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55541`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55541','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.admin_audit_events;
   insert into public.reader_workspaces(user_id,state)values(${q(owner)},${j({version:1,followedSourceIds:['review-source'],customSources:[{id:'review-source',platform:'YouTube',url:'https://example.test/source',status:'live'}],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}})});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'review-video','review-source','fixture','2026-10-28T00:00:00Z',${j(record)});`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('lists legacy and new holds without exposing any private table to public roles',()=>{
  row();expect(json('select count(*)::integer from public.admin_analysis_review_queue;')).toBe(1);
  for(const role of ['anon','authenticated'])for(const table of ['admin_analysis_reviews','admin_analysis_prompt_receipts','admin_analysis_review_queue'])expect(sql(`select has_table_privilege(${q(role)},${q('public.'+table)},'select');`)).toBe('f');
  for(const role of ['anon','authenticated'])for(const fn of ['record_admin_analysis_prompt(uuid,uuid,text,text,jsonb)','admin_decide_analysis_review(uuid,timestamptz,text,text,jsonb)','sync_admin_analysis_reviews(text,integer)'])expect(sql(`select has_function_privilege(${q(role)},${q('public.'+fn)},'execute');`)).toBe('f');
 });
 it('approves or edits a literal keyword atomically through the durable old review decisions',()=>{
  const r=row(),out=decide(r,'approve',{label:'AeroBox',kind:'brand'});expect(out.published).toBe(true);expect(out.record.proposal).toEqual(r.proposal);expect(out.record.resolved).toEqual({label:'AeroBox',kind:'brand'});
  expect(source().videoKeywords).toEqual([{label:'AeroBox',ranges:[]}]);expect(source().videoHighlights).toEqual(record.videoHighlights);expect(source().processing.keywords).toBe('review');
  expect(json(`select count(*)::integer from public.admin_keyword_reviews where status='approved';`)).toBe(1);expect(()=>decide(r)).toThrow();
  expect(()=>sql(`update public.admin_analysis_reviews set reason='rewritten'where id=${q(r.id)};`)).toThrow();
 });
 it('rejects without touching the reader, records the original failure and audit, and refuses stale decisions',()=>{
  const r=row();const before=source();const out=decide(r,'reject');expect(out.published).toBe(false);expect(source()).toEqual(before);expect(out.record.status).toBe('rejected');expect(()=>decide(r,'reject')).toThrow();
  expect(json(`select count(*)::integer from public.admin_audit_events where action='analysis.review.rejected';`)).toBe(1);
 });
 it('blocks ungrounded keyword changes and source drift while still allowing dismissal of stale holds',()=>{
  const r=row();expect(()=>decide(r,'approve',{label:'Invented Name',kind:'brand'})).toThrow();expect(source()).toEqual(record);
  sql(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"changed"')where id='review-video';`);expect(()=>decide(r)).toThrow();expect(decide(r,'reject').record.status).toBe('rejected');
 });
 it('publishes a manually supported recap with literal citations, no invented timing and immutable draft evidence',()=>{
  const proposal={highlights:[{text:'The laboratory measured an improvement over the older design.',evidenceQuote:'The laboratory found a measurable improvement over the older design.'}]};
  const r=row('recap',proposal),out=decide(r);expect(out.published).toBe(true);expect(out.record.proposal).toEqual(proposal);expect(source().videoHighlights).toEqual([{text:proposal.highlights[0].text}]);expect(source().videoSummary.timingBasis).toBe('none');expect(source().processing.recap).toBe('ready');
  expect(json(`select details->'manualSourceReview'from public.admin_audit_events where action='analysis.review.approved';`)).toBe(true);
 });
 it('rejects unsupported/empty recap edits and concurrent recap changes but allows unrelated metadata',()=>{
  const proposal={highlights:[{text:'Measured improvement.',evidenceQuote:'The laboratory found a measurable improvement over the older design.'}]},r=row('recap',proposal);
  expect(()=>decide(r,'approve',{highlights:[]})).toThrow();expect(()=>decide(r,'approve',{highlights:[{text:'False claim',evidenceQuote:'Not actually in the source.'}]})).toThrow();
  sql(`update public.reader_source_updates set record=jsonb_set(record,'{title}','"New title"')where id='review-video';`);expect(decide(r).published).toBe(true);
  const fresh=row('recap',proposal);sql(`delete from public.admin_analysis_reviews where status='approved';update public.reader_source_updates set record=jsonb_set(record,'{videoHighlights}','[{"text":"Different correction"}]')where id='review-video';`);expect(()=>decide(fresh)).toThrow();
 });
 it('retains an approved recap across AI/collector writes for unchanged text, without borrowing it for changed text',()=>{
  const proposal={highlights:[{text:'Measured improvement.',evidenceQuote:'The laboratory found a measurable improvement over the older design.'}]};decide(row('recap',proposal));
  sql(`update public.reader_source_updates set record=record||'{"videoHighlights":[],"title":"Collector refresh","other":"keep"}'::jsonb where id='review-video';`);
  expect(source().videoHighlights).toEqual([{text:'Measured improvement.'}]);expect(source().other).toBe('keep');expect(source().title).toBe('Collector refresh');
  sql(`update public.reader_source_updates set record=record||'{"content":"changed source","videoHighlights":[]}'::jsonb where id='review-video';`);expect(source().videoHighlights).toEqual([]);
 });
 it('captures failed recaps automatically, deduplicates replay and preserves job, archive and charge history',()=>{
  const id=job('failed','summary',null,'analysis_invalid_summary');const before=sql('select to_jsonb(j)from public.reader_content_analysis_jobs j;');expect(json(`select count(*)::integer from public.admin_analysis_reviews where job_id=${q(id)};`)).toBe(1);
  expect(json(`select public.sync_admin_analysis_reviews(${q(owner)});`)).toEqual({captured:0});expect(sql('select to_jsonb(j)from public.reader_content_analysis_jobs j;')).toBe(before);expect(source()).toEqual(record);
  const r=json(`select to_jsonb(r)from public.admin_analysis_reviews r;`);expect(r.provenance.availability).toBe('unavailable');expect(r.provenance.prompts).toEqual([]);expect(r.source_snapshot.content).toBe(content);
 });
 it('stores exact future requests before any monetary reservation, once-per-job source snapshot, and never fabricates historical prompts',()=>{
  const id=job(),lease=sql(`select lease_token from public.reader_content_analysis_jobs where id=${q(id)};`),req={role:'extractor',key:'summary:test:0',system:'Exact system',prompt:'Exact prompt '+content,schema:{type:'object'},maxOutputTokens:500};
  const save=(request:unknown=req,h='a'.repeat(64))=>json(`select public.record_admin_analysis_prompt(${q(id)},${q(lease)},${q(h)},${q(model)},${j(request)});`);
  expect(save().recorded).toBe(true);expect(save().replayed).toBe(true);expect(()=>save({...req,prompt:'changed'})).toThrow();expect(save({...req,key:'summary:test:1'},'b'.repeat(64)).recorded).toBe(true);
  expect(json('select count(*)::integer from public.reader_content_analysis_calls;')).toBe(0);expect(json('select count(*)::integer from public.admin_analysis_prompt_receipts where source_snapshot is not null;')).toBe(1);
  expect(()=>sql(`update public.admin_analysis_prompt_receipts set request='{}';`)).toThrow();
  sql(`insert into public.reader_content_analysis_calls(user_id,job_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash)values(${q(owner)},${q(id)},'historical',${q(lease)},${q(model)},${q(hash)},.1,'settled',.001,${q('c'.repeat(64))});`);
  expect(save({...req,key:'historical'},'c'.repeat(64)).recorded).toBe(false);expect(json('select count(*)::integer from public.admin_analysis_prompt_receipts;')).toBe(2);
  sql(`update public.reader_content_analysis_jobs set state='failed',error_code='analysis_failed'where id=${q(id)};`);expect(json('select provenance from public.admin_analysis_reviews;').prompts).toEqual([]);expect(json('select provenance from public.admin_analysis_reviews;').message).toContain('no completed model response');
  sql(`delete from public.reader_source_updates where id='review-video';`);expect(json('select count(*)::integer from public.admin_analysis_reviews;')).toBe(0);expect(json('select count(*)::integer from public.admin_analysis_prompt_receipts;')).toBe(0);expect(json('select count(*)::integer from public.reader_content_analysis_calls;')).toBe(1);
 });
 it('never upgrades an unknown older keyword batch when approving one new literal name',()=>{
  sql(`update public.reader_source_updates set record=record||'{"videoKeywords":[{"label":"Unknown old label","ranges":[]}],"topics":["Unknown old label"]}'::jsonb where id='review-video';`);
  decide(row(),'approve',{label:'AeroBox',kind:'brand'});
  expect(source().keywordContentHash).toBeNull();expect(source().videoKeywords.map((r:any)=>r.label)).toContain('Unknown old label');expect(source().processing?.keywords).not.toBe('ready');
 });
 it('captures literal pending proposals with valid legacy kinds and hides duplicate legacy queue rows',()=>{
  const id=job('prepared','keywords',{state:'review',pending:[{label:'quiet focus',kind:'feature',reason:'Uncertain setting name'}]});
  const r=json(`select to_jsonb(r)from public.admin_analysis_reviews r where job_id=${q(id)};`);expect(r.proposal.kind).toBe('category');expect(decide(r,'reject').published).toBe(false);expect(source()).toEqual(record);
  expect(json('select count(*)::integer from public.admin_analysis_review_queue;')).toBe(1);
 });
 it('paginates only actual saved generation prompts and never labels an extra planned request as executed',()=>{
  const id=job(),lease=sql(`select lease_token from public.reader_content_analysis_jobs where id=${q(id)};`);
  for(let i=0;i<5;i++){
   const request={key:'request:'+i,role:'extractor',system:'Actual system',prompt:'Actual prompt '+i},h=String(i+1).repeat(64);
   json(`select public.record_admin_analysis_prompt(${q(id)},${q(lease)},${q(h)},${q(model)},${j(request)});`);
   if(i<4)sql(`insert into public.reader_content_analysis_calls(user_id,job_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,request_hash,result,result_at)values(${q(owner)},${q(id)},${q(request.key)},${q(lease)},${q(model)},${q(hash)},.1,'settled',.001,${q(h)},'{}',clock_timestamp());`);
  }
  sql(`update public.reader_content_analysis_jobs set state='failed',error_code='analysis_invalid_summary'where id=${q(id)};`);
  const r=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(r.provenance.prompts).toEqual([]);expect(r.provenance.promptReceiptIds).toHaveLength(4);
  const a=json(`select public.read_admin_analysis_review_prompts(${q(r.id)},0);`),b=json(`select public.read_admin_analysis_review_prompts(${q(r.id)},1);`);
  expect(a.total).toBe(4);expect(a.prompts).toHaveLength(3);expect(b.prompts).toHaveLength(1);expect([...a.prompts,...b.prompts].map(p=>p.prompt)).toEqual(['Actual prompt 0','Actual prompt 1','Actual prompt 2','Actual prompt 3']);
  expect(sql("select has_function_privilege('anon','public.read_admin_analysis_review_prompts(uuid,integer)','execute');")).toBe('f');
 });
 it('rolls back approval, reader publication and legacy decisions if the mandatory audit cannot be written',()=>{
  const proposal={highlights:[{text:'Measured improvement.',evidenceQuote:'The laboratory found a measurable improvement over the older design.'}]},r=row('recap',proposal);
  sql(`create function public.review_test_audit_failure()returns trigger language plpgsql as $$begin raise exception 'fixture audit unavailable';end;$$;create trigger review_test_audit_failure before insert on public.admin_audit_events for each row execute function public.review_test_audit_failure();`);
  try{expect(()=>decide(r)).toThrow();expect(source()).toEqual(record);expect(service(`select status from public.admin_analysis_reviews where id=${q(r.id)};`)).toBe('pending');}
  finally{sql('drop trigger review_test_audit_failure on public.admin_audit_events;drop function public.review_test_audit_failure();');}
 });

 it.each(['approve','reject'])('never reopens a human-%s keyword when a later automatic pending output arrives',decision=>{
  const existing=row();decide(existing,decision);
  const id=job('prepared','keywords',{state:'review',pending:[{label:'quiet focus',kind:'feature',reason:'Automatic uncertainty'}]});
  expect(json(`select count(*)::integer from public.admin_analysis_reviews where job_id=${q(id)};`)).toBe(0);
  expect(json("select count(*)::integer from public.admin_analysis_review_queue where status='pending';")).toBe(0);
 });
 it('shows the resolved legacy decision if another admin tab decides a previously captured pending item',()=>{
  job('prepared','keywords',{state:'review',pending:[{label:'quiet focus',kind:'technology',reason:'Automatic uncertainty'}]});
  const legacy=json(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)values(${q(owner)},'review-video','review-source',${q(hash)},'quiet focus','technology',0,'Legacy pending',${q(content)},'[]','Fixture','https://example.test/video')returning to_jsonb(admin_keyword_reviews);`);
  json(`select public.admin_review_keyword(${q(legacy.id)},${q(legacy.updated_at)},'admin:other','reject','quiet focus','technology');`);
  const page=json("select jsonb_agg(jsonb_build_object('origin',origin,'status',status))from public.admin_analysis_review_queue;");
  expect(page).toEqual([{origin:'legacy_keyword',status:'rejected'}]);
 });

 it('keeps an unknown old charge byte-exact and blocks before recording or reserving another attempt',()=>{
  const id=job(),lease=sql(`select lease_token from public.reader_content_analysis_jobs where id=${q(id)};`),h='a'.repeat(64),request={key:'unknown',role:'extractor',system:'Exact system',prompt:'Exact source request'};
  sql(`insert into public.reader_content_analysis_calls(user_id,job_id,call_key,lease_token,model,source_revision,maximum_usd,state,request_hash)select ${q(owner)},id,'unknown',gen_random_uuid(),${q(model)},source_revision,.1,'unknown',${q(h)}from public.reader_content_analysis_jobs where id=${q(id)};`);
  const before=sql('select to_jsonb(c)from public.reader_content_analysis_calls c;');
  expect(json(`select public.record_admin_analysis_prompt(${q(id)},${q(lease)},${q(h)},${q(model)},${j(request)});`)).toMatchObject({recorded:false,blockedReason:'analysis_unknown_charge_hold'});
  expect(sql('select to_jsonb(c)from public.reader_content_analysis_calls c;')).toBe(before);expect(json('select count(*)::integer from public.admin_analysis_prompt_receipts;')).toBe(0);
 });
 it('records only the next authorized zero-charge attempt and never uses an old HTTP response as that attempt evidence',()=>{
  const id=job(),lease=sql(`select lease_token from public.reader_content_analysis_jobs where id=${q(id)};`),h='a'.repeat(64),request={key:'zero-retry',role:'extractor',system:'Exact system',prompt:'Exact new retry request'};
  const cid=sql(`insert into public.reader_content_analysis_calls(user_id,job_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,observed_usd,request_hash,execution_identity,result_at,settled_at,retry_authorized,rejection_receipt,generation_receipt,retry_authorization_receipt,retry_not_before)
   select ${q(owner)},id,'zero-retry',gen_random_uuid(),${q(model)},source_revision,.1,'settled',0,0,${q(h)},${j(identity)},clock_timestamp(),clock_timestamp(),true,'{}','{}','{}',clock_timestamp()-interval '1 minute'from public.reader_content_analysis_jobs where id=${q(id)}returning id;`);
  const before=sql('select to_jsonb(c)from public.reader_content_analysis_calls c;');
  expect(json(`select public.record_admin_analysis_prompt(${q(id)},${q(lease)},${q(h)},${q(model)},${j(request)});`)).toMatchObject({recorded:true,capturedForAttempt:2});expect(sql('select to_jsonb(c)from public.reader_content_analysis_calls c;')).toBe(before);
  sql(`update public.reader_content_analysis_jobs set state='failed',error_code='analysis_provider_rate_limited'where id=${q(id)};`);
  const old=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(json(`select public.read_admin_analysis_review_prompts(${q(old.id)},0);`).prompts).toEqual([]);
  // Exercise the existing guarded native attempt transition in this disposable fixture.
  sql(`insert into public.reader_content_analysis_call_attempts(call_id,attempt_number,lease_token,request_hash,execution_identity,model,maximum_usd,actual_usd,observed_usd,reserved_at,settled_at,rejection_receipt,generation_receipt,retry_authorization_receipt,retry_authorized,retry_not_before)
   select id,attempt_number,lease_token,request_hash,execution_identity,model,maximum_usd,actual_usd,observed_usd,attempt_reserved_at,settled_at,rejection_receipt,generation_receipt,retry_authorization_receipt,retry_authorized,retry_not_before from public.reader_content_analysis_calls where id=${q(cid)};
   update public.reader_content_analysis_calls set attempt_number=2,lease_token=${q(lease)},state='reserved',actual_usd=null,observed_usd=null,provider_id=null,result_at=null,settled_at=null,rejection_receipt=null,generation_receipt=null,retry_authorization_receipt=null,retry_authorized=false,retry_not_before=null,attempt_reserved_at=clock_timestamp()where id=${q(cid)};
   update public.reader_content_analysis_calls set state='settled',actual_usd=.001,observed_usd=.001,result='{}',result_at=clock_timestamp()where id=${q(cid)};
   update public.reader_content_analysis_jobs set attempts=2,error_code='analysis_invalid_summary'where id=${q(id)};`);
  const next=json(`select to_jsonb(r)from public.admin_analysis_reviews r where id<>${q(old.id)};`);expect(json(`select public.read_admin_analysis_review_prompts(${q(next.id)},0);`).prompts[0].prompt).toBe(request.prompt);expect(json(`select public.read_admin_analysis_review_prompts(${q(old.id)},0);`).prompts).toEqual([]);
 });
 it('retains legacy cached successes without fabricating a prompt even when the old request_hash column is null',()=>{
  const id=job(),lease=sql(`select lease_token from public.reader_content_analysis_jobs where id=${q(id)};`),h='a'.repeat(64),request={key:'cached-legacy',role:'extractor',system:'Current system',prompt:'Current template must not be stored'};
  sql(`insert into public.reader_content_analysis_calls(user_id,job_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,result)select ${q(owner)},id,'cached-legacy',gen_random_uuid(),${q(model)},source_revision,.1,'settled',.001,${j({requestHash:h,value:{}})} from public.reader_content_analysis_jobs where id=${q(id)};`);
  expect(json(`select public.record_admin_analysis_prompt(${q(id)},${q(lease)},${q(h)},${q(model)},${j(request)});`)).toMatchObject({recorded:false,cached:true});expect(json('select count(*)::integer from public.admin_analysis_prompt_receipts;')).toBe(0);
 });
 it('does not reopen the corrected spelling after an administrator edits and approves an older candidate',()=>{
  decide(row(),'approve',{label:'AeroBox',kind:'brand'});
  const id=job('prepared','keywords',{state:'review',pending:[{label:'AeroBox',kind:'brand',reason:'Automatic uncertainty'}]});
  expect(json(`select count(*)::integer from public.admin_analysis_reviews where job_id=${q(id)};`)).toBe(0);
 });

});
