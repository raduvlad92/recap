import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const owner='social-content-fixture',model='deepseek/deepseek-v4.1-flash-1017';
const content='AeroBox Plus uses a quiet focus setting. The laboratory measured an improvement over the older design.';
const hash=createHash('sha256').update(content).digest('hex');
const record={id:'automatic-video',sourceId:'automatic-source',title:'Fixture new video',url:'https://x.com/socialfixture/status/1234567890123456789',publishedAt:'2026-10-29T00:00:00Z',content,contentKind:'feed_text',format:'post',isSample:false,topics:[],brands:[],videoKeywords:[]};
const workspace={version:1,followedSourceIds:['automatic-source'],customSources:[{id:'automatic-source',platform:'X',url:'https://x.com/socialfixture',status:'live'}],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}};
const identity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'relace',model,reasoningEffort:'none',pricing:{version:'fixture-pricing',inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
describe.skipIf(!available)('social-text drafts, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false;
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 const sync=()=>json('select public.sync_social_content_tasks();');
 const claim=()=>json('select public.claim_social_content_task();');
 const source=()=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id='automatic-video';`);
 function task(kind='recap'){
  sync();service(`update public.social_content_tasks set state='blocked',error_code='fixture_skip'where task<>${q(kind)};`);
  return claim();
 }
 function reserve(t:any,key='one'){
  const callKey='keyword-learning:v1:automatic-fixture-'+key;
  return json(`select public.reserve_keyword_learning_call(${q(t.task.session_id)},${q(callKey)},1,${q(t.task.content_hash)},${q(model)},${j(identity)},repeat('a',64),.10,${j({request:{key:callKey,role:'extractor',system:'Fixture exact instructions',prompt:content,schema:{type:'object'},maxOutputTokens:100}})});`);
 }
 function settle(t:any,r:any,result:unknown={value:{names:['AeroBox Plus']},actualUsd:.001,observedUsd:.001,providerId:'fixture-provider'},error:string|null=null){
  return json(`select public.record_keyword_learning_call(${q(t.task.session_id)},${q(r.call.call_key)},${q(r.call.id)},${q(r.call.lease_token)},${q(r.requestHash)},${result===null?'null':j(result)},${error===null?'null':q(error)});`);
 }
 const finish=(t:any,result:unknown=null,error:string|null=null)=>json(`select public.finish_social_content_task(${q(t.task.id)},${q(t.leaseToken)},${result===null?'null':j(result)},${error===null?'null':q(error)});`);
 const keyword=(keys:string[],proposals:unknown[]=[{label:'AeroBox Plus',kind:'product',reason:'Check relevance and naming'}])=>({kind:'keywords',callKeys:keys,proposals});
 const recap=(keys:string[])=>({kind:'recap',callKeys:keys,proposal:{highlights:[{text:'AeroBox Plus has a quiet focus setting.',evidenceQuote:'AeroBox Plus uses a quiet focus setting.'}]}});
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rcac-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55553`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55553','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_collection_policies cascade;truncate public.keyword_learning_sessions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.content_analysis_provider_cooldowns;
   insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)values(true,true,5,10)on conflict(id)do update set enabled=true,daily_limit_usd=5,lifetime_limit_usd=10;
   insert into public.reader_workspaces(user_id,state)values(${q(owner)},${j(workspace)});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)values(${q(owner)},true,5,10,.1,${q(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'automatic-video','automatic-source','fixture','2026-10-29T00:00:00Z',${j(record)});
   insert into public.social_content_policies(user_id,enabled,starts_at)values(${q(owner)},true,clock_timestamp()-interval'1 hour');`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('syncs only explicit opted-in new followed usable sources and never touches originals or the old queue',()=>{
  const before=source(),jobs=service('select count(*)from public.reader_content_analysis_jobs;');
  expect(sync()).toEqual({synchronized:2});expect(sync()).toEqual({synchronized:0});expect(source()).toEqual(before);
  expect(service('select count(*)from public.reader_content_analysis_jobs;')).toBe(jobs);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
 });
 it('leaves old archives, metadata-only records, unfollowed sources and Shorts excluded',()=>{
  sql(`update public.reader_source_updates set collected_at=clock_timestamp()-interval'2 hours';`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_source_updates set collected_at=clock_timestamp(),record=jsonb_set(record,'{contentKind}','"metadata_only"');`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_source_updates set record=${j(record)};update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_workspaces set state=${j(workspace)};update public.reader_source_updates set record=jsonb_set(record,'{format}','"video"');`);expect(sync().synchronized).toBe(0);
 });
 it('does not synchronize disabled policies and makes the activation cutoff immutable',()=>{
  service('update public.social_content_policies set enabled=false;');expect(sync().synchronized).toBe(0);
  expect(()=>service(`update public.social_content_policies set starts_at=starts_at-interval'1 day';`)).toThrow();
 });
 it('does not queue already published current-source keyword or recap batches again',()=>{
  sql(`update public.reader_source_updates set record=record||${j({keywordContentHash:hash,videoSummary:{captionHash:hash,status:'ready',ruleVersion:'takeaways-v1',timingBasis:'none'},videoHighlights:[{text:'Prior supported finding'}]})};`);
  expect(sync().synchronized).toBe(0);
 });
 it('requires both enabled financial policies without enabling any old processing scope',()=>{
  sync();sql('update public.content_analysis_budget set enabled=false;');expect(claim().reason).toBe('automatic_processing_paused');
  expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
  sql('update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=false;');expect(claim().reason).toBe('automatic_processing_paused');
 });
 it('creates one finite 24-hour DeepSeek plus Sol session and immutable exact evidence',()=>{
  const t=task();expect(t.claimed).toBe(true);expect(t.record).toEqual(record);expect(t.task.source_snapshot).toEqual(record);expect(t.task.content_hash).toBe(hash);
  const s=json(`select to_jsonb(s)-'user_id'from public.keyword_learning_sessions s where id=${q(t.task.session_id)};`);
  expect(s.models).toEqual([model,'openai/gpt-6.1-sol-pro']);expect(s.state).toBe('released');expect(Number(s.maximum_usd)).toBe(.3);expect(s.sources).toMatchObject([{ordinal:1,updateId:'automatic-video',sourceHash:hash}]);
  expect(Date.parse(s.expires_at)-Date.parse(s.created_at)).toBeLessThanOrEqual(86400000);
  expect(()=>service(`update public.social_content_tasks set source_snapshot='{}'where id=${q(t.task.id)};`)).toThrow();
  expect(()=>service(`update public.social_content_tasks set session_id=gen_random_uuid()where id=${q(t.task.id)};`)).toThrow();
 });
 it('puts literal keyword drafts into pending review without publishing and keeps exact native prompt references',()=>{
  const t=task('keywords'),before=source(),r=reserve(t);settle(t,r);const out=finish(t,keyword([r.call.call_key]));
  expect(out).toEqual({state:'review',reviewCount:1});expect(source()).toEqual(before);
  const v=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(v.status).toBe('pending');expect(v.proposal).toEqual({label:'AeroBox Plus',kind:'product'});expect(v.source_snapshot).toEqual(before);
  expect(v.provenance).toMatchObject({origin:'automatic_content',purpose:'social_text',sessionId:t.task.session_id,callKeys:[r.call.call_key],sourceRevision:t.task.source_revision});expect(v.provenance.prompts).toBeUndefined();
  expect(service(`select state from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('closed');
  expect(()=>finish(t,keyword([r.call.call_key]))).toThrow();expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('1');
 });
 it('puts cited recap drafts into pending review without changing existing reader annotations',()=>{
  const t=task(),before=source(),r=reserve(t);settle(t,r);expect(finish(t,recap([r.call.call_key]))).toEqual({state:'review',reviewCount:1});expect(source()).toEqual(before);
  expect(json('select proposal from public.admin_analysis_reviews;')).toEqual(recap([]).proposal);
 });
 it('deduplicates repeated labels and preserves unsupported proposals for correction while publication still rejects them',()=>{
  const t=task('keywords'),r=reserve(t);settle(t,r);
  expect(finish(t,keyword([r.call.call_key],[{label:'AeroBox Plus',kind:'product'},{label:'AeroBox Plus',kind:'product'},{label:'Invented Unmentioned Device',kind:'product'}])).reviewCount).toBe(2);
  const v=json("select to_jsonb(r)from public.admin_analysis_reviews r where proposal->>'label'='Invented Unmentioned Device';");
  expect(v.reason).toContain('does not occur literally');expect(v.status).toBe('pending');
  expect(()=>json(`select public.admin_decide_analysis_review(${q(v.id)},${q(v.updated_at)},'admin:fixture','approve');`)).toThrow();expect(source()).toEqual(record);
 });
 it('rejects unquoted recaps and mismatched call evidence atomically',()=>{
  const t=task(),r=reserve(t);settle(t,r);const wrong=recap([r.call.call_key]);wrong.proposal.highlights[0].evidenceQuote='This passage was invented by the fixture.';
  expect(()=>finish(t,wrong)).toThrow();expect(()=>finish(t,recap(['keyword-learning:v1:some-other-task']))).toThrow();expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('refuses changed source versions and unfollows at finish without generating a false failure review',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);
  expect(finish(t,recap([r.call.call_key]))).toMatchObject({state:'blocked',errorCode:'automatic_source_changed',reviewCount:0});expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('does not create a session for a task whose original source revision changed before claim',()=>{
  sync();sql(`update public.reader_source_updates set record=jsonb_set(record,'{title}','"Changed source title"');`);expect(claim()).toMatchObject({claimed:false,reason:'automatic_source_changed'});expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
 });
 it('enforces pause and follow/source checks on every new native request, retaining unrelated private evaluation behavior',()=>{
  const t=task();sql('update public.content_analysis_budget set enabled=false;');expect(()=>reserve(t)).toThrow();expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('0');
  sql(`update public.content_analysis_budget set enabled=true;update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);expect(()=>reserve(t)).toThrow();
 });
 it('blocks lifetime and UTC-day exhaustion before sessions or empty reviews and preserves old unknown holds',()=>{
  sync();sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)values(${q(owner)},'old-unknown',gen_random_uuid(),${q(model)},repeat('c',64),.095,'unknown',clock_timestamp()-interval'2 days');update public.reader_content_analysis_policies set lifetime_limit_usd=.1;`);
  expect(claim().reason).toBe('analysis_budget_exhausted');expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
  sql('update public.reader_content_analysis_policies set lifetime_limit_usd=10,daily_limit_usd=.1;');expect(claim().reason).toBe('analysis_daily_budget_exhausted');expect(service("select actual_usd is null and state='unknown'from public.reader_content_analysis_calls where call_key='old-unknown';")).toBe('t');
 });
 it('yields with settled cache and resumes the same finite session without recreating paid calls',()=>{
  const t=task(),r=reserve(t);settle(t,r);expect(finish(t,null,'automatic_worker_yield')).toMatchObject({state:'queued',sessionId:t.task.session_id});
  const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);expect(resumed.leaseToken).not.toBe(t.leaseToken);expect(reserve(resumed).claimed).toBe(false);
  expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('resumes expired task leases using the same released session and blocks expired sessions permanently',()=>{
  const t=task();service(`update public.social_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);
  sql(`update public.keyword_learning_sessions set created_at=clock_timestamp()-interval'2 days',expires_at=clock_timestamp()-interval'1 day'where id=${q(t.task.session_id)};update public.social_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);
  expect(claim().reason).toBe('automatic_session_expired');expect(claim().claimed).toBe(false);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('keeps unknown provider charges held, creates one inspectable failure, and never redispatches it',()=>{
  const t=task(),r=reserve(t);settle(t,r,null,'analysis_provider_timeout');expect(finish(t,null,'analysis_provider_timeout')).toMatchObject({state:'blocked',errorCode:'analysis_unknown_charge_hold',reviewCount:1});
  const review=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(review.proposal).toEqual({});expect(review.status).toBe('pending');expect(review.provenance.callKeys).toEqual([r.call.call_key]);
  expect(claim().claimed).toBe(false);expect(service('select actual_usd is null from public.reader_content_analysis_calls;')).toBe('t');expect(()=>reserve(t)).toThrow();
 });
 it('does not turn an unresolved lease into a retry or a replacement session',()=>{
  const t=task();reserve(t);service(`update public.social_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);
  expect(claim().reason).toBe('analysis_unknown_charge_hold');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('keeps operational capacity/budget failures in task monitoring without an empty inbox row',()=>{
  const t=task();expect(finish(t,null,'analysis_budget_exhausted')).toMatchObject({state:'blocked',reviewCount:0});expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('only resumes a daily budget stop on a later UTC day and keeps the same finite session',()=>{
  const t=task();finish(t,null,'analysis_daily_budget_exhausted');sync();expect(service(`select state from public.social_content_tasks where id=${q(t.task.id)};`)).toBe('blocked');
  sql(`alter table public.social_content_tasks disable trigger social_content_task_immutable;update public.social_content_tasks set updated_at=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC'-interval'1 second'where id=${q(t.task.id)};alter table public.social_content_tasks enable trigger social_content_task_immutable;`);
  sync();const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('whole-workspace deletion erases tasks and closes admission evidence without orphan sessions',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`delete from public.reader_workspaces where user_id=${q(owner)};`);
  expect(service('select count(*)from public.social_content_tasks;')).toBe('0');expect(service('select count(*)from public.social_content_policies;')).toBe('0');
  expect(service(`select state='closed'and user_id is null and sources='[]'::jsonb from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('t');
  expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('erases task/source evidence on archive or workspace deletion while preserving the native financial ledger',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`delete from public.reader_source_updates where id='automatic-video';`);
  expect(service('select count(*)from public.social_content_tasks;')).toBe('0');expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
  expect(service(`select state='closed'and user_id is null and sources='[]'::jsonb from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('t');
  expect(service('select request_payload is null and result is null from public.keyword_learning_requests;')).toBe('t');
 });
 it('does not expose automatic policies, task evidence or RPCs to ordinary readers',()=>{
  for(const role of ['anon','authenticated']){
   for(const table of ['social_content_policies','social_content_tasks'])expect(()=>sql(`set role ${role};select*from public.${table};`)).toThrow();
   for(const fn of ['sync_social_content_tasks()','claim_social_content_task(integer)','finish_social_content_task(uuid,uuid,jsonb,text)','social_content_immutable()','guard_social_content_request()'])expect(sql(`select has_function_privilege(${q(role)},${q('public.'+fn)},'execute');`)).toBe('f');
  }
 });
 it('serializes simultaneous workers into one task lease and one finite session',async()=>{
  sync();service("update public.social_content_tasks set state='blocked',error_code='fixture_skip'where task='keywords';");
  const run=()=>new Promise<any>((resolve,reject)=>{const child=execFile('psql',args,{encoding:'utf8'},(e,out)=>e?reject(e):resolve(JSON.parse(out.split('\n').find(x=>x.startsWith('{'))!)));child.stdin?.end('set role service_role;begin;select public.claim_social_content_task();select pg_sleep(.1);commit;');});
  const values=await Promise.all([run(),run()]);expect(values.filter(x=>x.claimed)).toHaveLength(1);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 describe('persisted public originals use the existing review-first queue',()=>{
  const publicText=content+' '+content+' '+content;
  const publicHash=createHash('sha256').update(publicText).digest('hex');
  const publicSource={...workspace.customSources[0],platform:'Blog',url:'https://publication.example/'};
  const publicRecord={...record,format:'article',url:'https://publication.example/one',content:publicText,
   originalContent:{version:1,method:'public_article',status:'usable',reason:'usable_text',url:'https://publication.example/one',contentHash:publicHash}};
  const prepare=()=>sql(`update public.reader_workspaces set state=jsonb_set(state,'{customSources}',${j([publicSource])});update public.reader_source_updates set record=${j(publicRecord)},published_at=${q(publicRecord.publishedAt)}::timestamptz;`);
  it('admits exact usable originals idempotently and saves only human-review proposals',()=>{
   prepare();expect(sync()).toEqual({synchronized:2});expect(sync()).toEqual({synchronized:0});
   const t=task(),before=source(),r=reserve(t);settle(t,r);
   expect(finish(t,recap([r.call.call_key]))).toEqual({state:'review',reviewCount:1});
   expect(source()).toEqual(before);expect(service('select status from public.admin_analysis_reviews;')).toBe('pending');
  });
  it.each(['partial','failed','unavailable','deferred'])('rejects %s originals despite a nonempty saved prefix',status=>{
   prepare();sql(`update public.reader_source_updates set record=jsonb_set(record,'{originalContent,status}',${j(status)});`);expect(sync().synchronized).toBe(0);
  });
  it('rejects metadata, mismatched hashes, missing dates and unmarked legacy feed text',()=>{
   for(const patch of [{contentKind:'metadata_only'},{originalContent:{...publicRecord.originalContent,contentHash:'a'.repeat(64)}},{originalContent:null}]){
    prepare();sql(`update public.reader_source_updates set record=record||${j(patch)};`);expect(sync().synchronized).toBe(0);
   }
  });
  it('rejects missing dates at storage and eligibility',()=>{
   prepare();expect(()=>sql(`update public.reader_source_updates set record=jsonb_set(record,'{publishedAt}','""');`)).toThrow();
   expect(service(`select public.social_content_eligible(${j({...workspace,customSources:[publicSource]})},${j({...publicRecord,publishedAt:''})});`)).toBe('f');
  });
  it('detects changed date and provenance before claim',()=>{
   for(const patch of [{publishedAt:'2026-10-30T00:00:00Z'},{originalContent:{...publicRecord.originalContent,url:'https://publication.example/changed'}}]){
    sql('truncate public.keyword_learning_sessions cascade;truncate public.social_content_tasks;');prepare();sync();
    sql(`update public.reader_source_updates set record=record||${j(patch)},published_at=coalesce((${j(patch)}->>'publishedAt')::timestamptz,published_at);`);expect(claim()).toMatchObject({claimed:false,reason:'automatic_source_changed'});
   }
  });
  it('preserves financial holds while blocking late results after source removal or account deletion',()=>{
   prepare();const t=task(),r=reserve(t);
   sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);
   expect(finish(t,recap([r.call.call_key]))).toMatchObject({state:'blocked',errorCode:'automatic_source_changed'});
   expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
   expect(service('select count(*)from public.reader_content_analysis_calls where actual_usd is null and maximum_usd=.10;')).toBe('1');
   sql(`delete from public.reader_workspaces where user_id=${q(owner)};`);
   expect(()=>finish(t,recap([r.call.call_key]))).toThrow();
   expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
  });
  it('merges only missing source text, preserves identity/date and never resurrects a deleted archive',()=>{
   prepare();const prior={...publicRecord,contentKind:'metadata_only',content:'short excerpt',originalContent:{...publicRecord.originalContent,status:'partial'}};
   expect(json(`select public.merge_hourly_video_enrichment(${j(prior)},${j(publicRecord)});`)).toEqual({...prior,content:publicText,contentKind:'feed_text',originalContent:publicRecord.originalContent});
   expect(json(`select public.merge_hourly_video_enrichment(${j(prior)},${j({...publicRecord,publishedAt:'2026-10-30T00:00:00Z'})});`)).toEqual(prior);
   expect(json(`select public.merge_hourly_video_enrichment(${j(publicRecord)},${j({...prior,content:'different partial'})});`)).toEqual(publicRecord);
   sql(`insert into public.reader_collection_policies(user_id,enabled,provider_enabled)values(${q(owner)},true,false);`);
   const c=json(`select public.claim_hourly_source(${q(owner)},'automatic-source');`);
   service(`update public.reader_collection_source_state set cursor=${j({pendingOriginals:[prior]})};`);
   sql(`delete from public.reader_source_updates where user_id=${q(owner)};`);
   expect(service(`select cursor ? 'pendingOriginals'from public.reader_collection_source_state;`)).toBe('f');
   expect(()=>json(`select public.finish_hourly_source(${q(c.checkId)},${q(c.leaseToken)},'{"status":"collected"}',${j([{itemKey:publicRecord.url,record:publicRecord}])});`)).toThrow();
   expect(service('select count(*)from public.reader_source_updates;')).toBe('0');
  });
  it('requires an active parent for private hashed attempt IDs and permanently suppresses repeat downloads',()=>{
   prepare();sql(`insert into public.reader_collection_policies(user_id,enabled,provider_enabled)values(${q(owner)},true,false);`);
   const c=json(`select public.claim_hourly_source(${q(owner)},'automatic-source');`);
   const key='original:'+createHash('sha256').update('automatic-source\n'+publicRecord.url).digest('hex');
   const add=`insert into public.collection_retrieval_attempts(check_id,item_key,method,provider,stage)values(${q(c.checkId)},${q(key)},'public_article','native','content');`;
   service(add);expect(()=>service(add)).toThrow(/Original already attempted/);
   expect(()=>service(`insert into public.collection_retrieval_attempts(check_id,item_key,method,provider,stage)values(${q(c.checkId)},'https://private.invalid/','public_article','native','content');`)).toThrow();
   sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);
   expect(()=>service(add.replace(key,'original:'+'b'.repeat(64)))).toThrow(/Original source check changed/);
   expect(service(`select has_table_privilege('anon','public.collection_retrieval_attempts','select')or has_table_privilege('authenticated','public.collection_retrieval_attempts','insert');`)).toBe('f');
  });
 });

});
