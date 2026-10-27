import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const model='deepseek/deepseek-v4.1-flash-1017',owner='keyword-learning-fixture',source='AeroBox Plus supports C++.',sourceHash=createHash('sha256').update(source).digest('hex');
const identity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'relace',model,reasoningEffort:'none',pricing:{version:'fixture-pricing',inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
describe.skipIf(!available)('private keyword evaluation, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false,sid:string;
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rckw-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55519`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55519','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.keyword_learning_requests,public.keyword_learning_sessions;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.content_analysis_provider_cooldowns;
   insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,false,5,10) on conflict(id) do update set enabled=false,daily_limit_usd=5,lifetime_limit_usd=10;
   insert into public.reader_workspaces(user_id,state) values(${q(owner)},'{"version":1,"followedSourceIds":[],"customSources":[],"importedUpdates":[],"savedUpdateIds":[],"readLaterIds":[],"settings":{}}');
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${q(owner)},false,5,10,.1,${q(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${q(owner)},'kw-video','kw-source','fixture','2026-10-27T00:00:00Z',${j({id:'kw-video',sourceId:'kw-source',publishedAt:'2026-10-27T00:00:00Z',content:source,isSample:false,format:'video',contentKind:'transcript'})});`);
  sid=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at) values(${q(owner)},'released',${j([{ordinal:1,updateId:'kw-video',sourceHash}])},array[${q(model)}],.2,4,clock_timestamp()+interval '1 hour') returning id;`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 function reserveQuery(key='one',maximum=.01,patch:Record<string,unknown>={}){
  const v={session:sid,key:'keyword-learning:v1:'+key,ordinal:1,sourceHash,model,identity,requestHash:'a'.repeat(64),maximum,...patch};
  return `select public.reserve_keyword_learning_call(${q(String(v.session))},${q(String(v.key))},${v.ordinal},${q(String(v.sourceHash))},${q(String(v.model))},${j(v.identity)},${q(String(v.requestHash))},${v.maximum},${j({request:{key:v.key}})});`;
 }
 const reserve=(key='one',maximum=.01,patch:Record<string,unknown>={})=>json(reserveQuery(key,maximum,patch));
 function record(r:any,result:unknown={value:{names:['AeroBox Plus','C++']},actualUsd:.001,observedUsd:.001,usage:{inputTokens:10,outputTokens:5},providerId:'gen-fixture'},error:string|null=null){return json(`select public.record_keyword_learning_call(${q(sid)},${q(r.call.call_key)},${q(r.call.id)},${q(r.call.lease_token)},${q(r.requestHash)},${result===null?'null':j(result)},${error===null?'null':q(error)});`);}
 it('writes only evaluation evidence and the shared ledger, with production flags off',()=>{
  const before=sql(`select jsonb_build_object('workspace',(select jsonb_agg(to_jsonb(w)) from public.reader_workspaces w),'archive',(select jsonb_agg(to_jsonb(a)) from public.reader_source_updates a),'jobs',(select jsonb_agg(to_jsonb(j)) from public.reader_content_analysis_jobs j));`);
  const r=reserve(),saved=record(r);expect(r.claimed).toBe(true);expect(r.call.job_id).toBeNull();expect(saved.call.state).toBe('settled');expect(saved.result.value.names).toEqual(['AeroBox Plus','C++']);
  expect(service('select enabled from public.content_analysis_budget where id;')).toBe('f');expect(service(`select enabled from public.reader_content_analysis_policies where user_id=${q(owner)};`)).toBe('f');
  expect(sql(`select jsonb_build_object('workspace',(select jsonb_agg(to_jsonb(w)) from public.reader_workspaces w),'archive',(select jsonb_agg(to_jsonb(a)) from public.reader_source_updates a),'jobs',(select jsonb_agg(to_jsonb(j)) from public.reader_content_analysis_jobs j));`)).toBe(before);
 });
 it('is idempotent and refuses a changed request instead of charging another attempt',()=>{
  const r=reserve();record(r);expect(reserve().claimed).toBe(false);expect(()=>reserve('one',.01,{requestHash:'b'.repeat(64)})).toThrow();expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
 });
 it.each(['staged','closed'])('rejects a %s session',state=>{sql(`update public.keyword_learning_sessions set state=${q(state)} where id=${q(sid)};`);expect(()=>reserve()).toThrow();});
 it('rejects an expired session',()=>{sql(`update public.keyword_learning_sessions set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${q(sid)};`);expect(()=>reserve()).toThrow();});
 it('requires a still-current frozen source and an approved session model',()=>{
  expect(()=>reserve('one',.01,{sourceHash:'b'.repeat(64)})).toThrow();expect(()=>reserve('one',.01,{model:'minimax/minimax-m3.1-flash',identity:{...identity,model:'minimax/minimax-m3.1-flash'}})).toThrow();
  sql(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"changed"'::jsonb) where id='kw-video';`);expect(()=>reserve()).toThrow();
 });
 it('enforces the hard per-call cap before any ledger insert',()=>{expect(()=>reserve('one',.100000001)).toThrow();expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('0');});
 it('retains a timeout hold and forbids both same-key resending and new spending in that session',()=>{
  const r=reserve(),saved=record(r,null,'analysis_provider_timeout');expect(saved.call.state).toBe('unknown');expect(saved.call.actual_usd).toBeNull();expect(reserve().claimed).toBe(false);expect(()=>reserve('two')).toThrow();
 });
 it('counts old unknown holds against cumulative and daily budgets',()=>{
  sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at) values(${q(owner)},'old-unknown',gen_random_uuid(),${q(model)},repeat('c',64),.095,'unknown',clock_timestamp()-interval '2 days');update public.reader_content_analysis_policies set daily_limit_usd=.1 where user_id=${q(owner)};`);
  expect(()=>reserve()).toThrow();sql(`update public.reader_content_analysis_policies set daily_limit_usd=5,lifetime_limit_usd=.1 where user_id=${q(owner)};`);expect(()=>reserve()).toThrow();
 });
 it('enforces finite session cash and call count separately',()=>{
  sql(`update public.keyword_learning_sessions set maximum_usd=.015 where id=${q(sid)};`);record(reserve('one'),{value:{names:[]},actualUsd:.01,observedUsd:.01});expect(()=>reserve('two')).toThrow();
  sql(`update public.keyword_learning_sessions set maximum_usd=.2,max_calls=1 where id=${q(sid)};`);expect(()=>reserve('two')).toThrow();
 });
 it('continues recording genuine cost after stopping the session without permitting new calls',()=>{
  const r=reserve();sql(`update public.keyword_learning_sessions set state='closed' where id=${q(sid)};`);expect(record(r).call.state).toBe('settled');expect(()=>reserve('two')).toThrow();
 });
 it('has no ordinary-reader table or function access',()=>{
  expect(()=>sql('set role anon;select * from public.keyword_learning_sessions;')).toThrow();expect(()=>sql(`set role authenticated;select public.read_keyword_learning_call(${q(sid)},'keyword-learning:v1:one');`)).toThrow();
  expect(()=>service(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at) values(${q(owner)},'released','[]',array[${q(model)}],1,1,clock_timestamp()+interval '1 hour');`)).toThrow();
  expect(()=>sql('set role anon;'+reserveQuery())).toThrow();expect(()=>sql('set role authenticated;'+reserveQuery())).toThrow();
 });
 it('erases source-bearing evaluation evidence on source deletion while keeping the ledger',()=>{
  const r=reserve();record(r);sql(`set role authenticated;select set_config('request.jwt.claims',${q(JSON.stringify({sub:owner}))},false);delete from public.reader_source_updates where user_id=${q(owner)} and id='kw-video';`);
  expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');expect(service('select request_payload is null and result is null from public.keyword_learning_requests;')).toBe('t');expect(service('select state from public.keyword_learning_sessions;')).toBe('closed');
 });
 it('erases source-bearing evidence on whole-workspace deletion, too',()=>{
  record(reserve());sql(`delete from public.reader_workspaces where user_id=${q(owner)};`);expect(service('select request_payload is null and result is null from public.keyword_learning_requests;')).toBe('t');expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('settles a genuine zero without releasing any unrelated old hold',()=>{
  sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state) values(${q(owner)},'old-unknown',gen_random_uuid(),${q(model)},repeat('c',64),.01,'unknown');`);
  const r=reserve();record(r,{value:{names:[]},actualUsd:0,observedUsd:0});expect(reserve('two').claimed).toBe(true);expect(service("select actual_usd is null and state='unknown' from public.reader_content_analysis_calls where call_key='old-unknown';")).toBe('t');
 });
 it('refuses a changed settlement lease without changing the existing hold',()=>{
  const r=reserve();expect(()=>json(`select public.record_keyword_learning_call(${q(sid)},${q(r.call.call_key)},${q(r.call.id)},gen_random_uuid(),${q(r.requestHash)},${j({value:{names:[]},actualUsd:0,observedUsd:0})},null);`)).toThrow();
  expect(service('select actual_usd is null from public.reader_content_analysis_calls;')).toBe('t');
 });
 it('serializes concurrent identical reservations into exactly one durable call',async()=>{
  const run=(query:string)=>new Promise<string>((resolve,reject)=>{const child=execFile('psql',args,{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin?.end(query);});
  const query='set role service_role;begin;'+reserveQuery()+'select pg_sleep(.15);commit;';
  const replies=await Promise.all([run(query),run(query)]),values=replies.map(v=>JSON.parse(v.split('\n').find(x=>x.startsWith('{'))!));
  expect(values.filter(v=>v.claimed)).toHaveLength(1);expect(new Set(values.map(v=>v.call.id)).size).toBe(1);expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('serializes deletion with in-flight settlement without losing erasure or the genuine bill',async()=>{
  const r=reserve();
  const run=(query:string)=>new Promise<string>((resolve,reject)=>{const child=execFile('psql',args,{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin?.end(query);});
  const result={value:{names:['AeroBox Plus']},actualUsd:.001,observedUsd:.001};
  const settlement=run(`set role service_role;begin;select id from public.keyword_learning_sessions where id=${q(sid)} for update;select pg_sleep(.3);select public.record_keyword_learning_call(${q(sid)},${q(r.call.call_key)},${q(r.call.id)},${q(r.call.lease_token)},${q(r.requestHash)},${j(result)},null);commit;`);
  await new Promise(resolve=>setTimeout(resolve,60));
  await Promise.all([settlement,run(`delete from public.reader_source_updates where user_id=${q(owner)} and id='kw-video';`)]);
  expect(service('select actual_usd from public.reader_content_analysis_calls;')).toBe('0.001000000000');
  expect(service('select request_payload is null and result is null from public.keyword_learning_requests;')).toBe('t');
  expect(service('select state from public.keyword_learning_sessions;')).toBe('closed');
 });
});
