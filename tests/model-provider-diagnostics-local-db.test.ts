import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{return /\b17\./.test(execFileSync(bin,['--version'],{encoding:'utf8'}));}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(x:unknown)=>q(JSON.stringify(x))+'::jsonb';
const migration='20261112041617_model_provider_diagnostics.sql',owner='diagnostic-fixture',model='deepseek/deepseek-v4.1-flash-1017';
const content='The laboratory measured the fixture device.',hash=createHash('sha256').update(content).digest('hex');
const identity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'relace',model,reasoningEffort:'none',pricing:{version:'fixture-pricing',inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
describe.skipIf(!available)('model provider diagnostic sidecar, isolated PostgreSQL17 only',()=>{
 let root:string,args:string[],started=false,sid:string,reservation:any,receipt:any,preserved=false;
 const sql=(text:string)=>execFileSync('psql',args,{input:'set client_min_messages=warning;'+text,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(text:string)=>sql('set role service_role;'+text),json=(text:string)=>JSON.parse(service(text)||'null');
 const snapshot=()=>sql("select jsonb_build_object('calls',(select jsonb_agg(to_jsonb(c)order by id)from public.reader_content_analysis_calls c),'requests',(select jsonb_agg(to_jsonb(r)order by call_id)from public.keyword_learning_requests r),'diagnostics',(select jsonb_agg(to_jsonb(d)order by call_id)from recap_internal.model_provider_diagnostics d),'sessions',(select jsonb_agg(to_jsonb(s)order by id)from public.keyword_learning_sessions s));");
 beforeAll(()=>{
  root=mkdtempSync('/tmp/recap-diag-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55488`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55488','-U','postgres','-d','postgres'];
  sql("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;");
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(name=>name.endsWith('.sql')&&name<migration).sort())sql(readFileSync(new URL(name,dir),'utf8'));
  sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state)values('historical-diagnostic-fixture','historic',gen_random_uuid(),${q(model)},repeat('c',64),.1,'unknown');`);
  const capture=()=>sql("select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(c))from public.reader_content_analysis_calls c),'columns',(select jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull,attnum)order by attnum)from pg_attribute where attrelid='public.reader_content_analysis_calls'::regclass and attnum>0),'oid','public.reader_content_analysis_calls'::regclass::oid,'oldRecorder',pg_get_functiondef('public.record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text)'::regprocedure));");
  const before=capture();sql(readFileSync(new URL(migration,dir),'utf8'));preserved=capture()===before;
 },40000);
 beforeEach(()=>{
  sql(`truncate public.keyword_learning_requests,public.keyword_learning_sessions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.content_analysis_provider_cooldowns;
  insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)values(true,false,5,12)on conflict(id)do update set enabled=false,daily_limit_usd=5,lifetime_limit_usd=12;
  insert into public.reader_workspaces(user_id,state)values(${q(owner)},'{"version":1,"followedSourceIds":[],"customSources":[],"importedUpdates":[],"savedUpdateIds":[],"readLaterIds":[],"settings":{}}');
  insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)values(${q(owner)},false,5,12,.1,${q(model)});
  insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'diagnostic-video','diagnostic-source','fixture','2026-10-27T00:00:00Z',${j({id:'diagnostic-video',sourceId:'diagnostic-source',publishedAt:'2026-10-27T00:00:00Z',content,contentKind:'transcript',format:'video',isSample:false})});`);
  sid=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)values(${q(owner)},'released',${j([{ordinal:1,updateId:'diagnostic-video',sourceHash:hash}])},array[${q(model)}],.2,2,clock_timestamp()+interval'1 hour')returning id;`);
  reservation=json(`select public.reserve_keyword_learning_call(${q(sid)},'keyword-learning:v1:diagnostic-fixture',1,${q(hash)},${q(model)},${j(identity)},repeat('a',64),.1,'{"request":{"key":"keyword-learning:v1:diagnostic-fixture"}}');`);
  receipt={schema:1,kind:'model-provider-http-diagnostic-v1',route:'openrouter',httpStatus:404,requestMethod:'POST',requestUrl:'https://openrouter.ai/api/v1/chat/completions',responseUrl:null,providerRequestId:'req_0123456789abcdef',providerCode:404,receivedAt:sql(`select to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`),costConclusion:'unknown',retryAuthority:false};
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 const query=(patch:Record<string,any>={})=>{
  const p={session:sid,key:reservation.call.call_key,call:reservation.call.id,lease:reservation.call.lease_token,hash:reservation.requestHash,attempt:reservation.call.attempt_number,error:'analysis_provider_http_404',receipt,...patch};
  return `select public.record_keyword_learning_failure_with_diagnostic(${q(p.session)},${q(p.key)},${q(p.call)},${q(p.lease)},${q(p.hash)},${p.attempt},${q(p.error)},${j(p.receipt)});`;
 };
 it('adds no historical rows/backfill and preserves old ledger JSON/schema/OID/recorder definition',()=>{expect(preserved).toBe(true);expect(service('select count(*)from recap_internal.model_provider_diagnostics;')).toBe('0');});
 it('atomically records a null-result unknown charge and a separate source-free diagnostic',()=>{
  const saved=json(query());expect(saved).toMatchObject({completed:true,result:null,errorCode:'analysis_provider_http_404',call:{state:'unknown',actual_usd:null,observed_usd:null,maximum_usd:.1,attempt_number:1,retry_authorized:false,rejection_receipt:null,generation_receipt:null}});
  const sidecar=json('select to_jsonb(d)from recap_internal.model_provider_diagnostics d;');expect(sidecar).toMatchObject({call_id:reservation.call.id,session_id:sid,attempt_number:1,request_hash:reservation.requestHash,diagnostic:receipt});
  for(const field of['lease_token','source_hash','source','user_id','request_payload','result','actual_usd'])expect(sidecar).not.toHaveProperty(field);
  expect(service("select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))from public.reader_content_analysis_calls;")).toBe('0.100000000000');
 });
 it('returns exact duplicates without changing old call/request/session/sidecar timestamps',()=>{const first=json(query()),before=snapshot();expect(json(query({receipt:Object.fromEntries(Object.entries(receipt).reverse())}))).toEqual(first);expect(snapshot()).toBe(before);});
 it('rejects changed duplicate evidence atomically',()=>{json(query());const before=snapshot();expect(()=>json(query({receipt:{...receipt,providerCode:503}}))).toThrow();expect(snapshot()).toBe(before);});
 it.each(['session','key','call','lease','hash','attempt','error'])('rejects wrong exact %s binding without changing the reservation',field=>{
  const before=snapshot(),patch:Record<string,any>={};patch[field]=field==='attempt'?2:field==='key'?'keyword-learning:v1:wrong':field==='hash'?'b'.repeat(64):field==='error'?'analysis_provider_http_503':'99999999-9999-4999-8999-999999999999';
  expect(()=>json(query(patch))).toThrow();expect(snapshot()).toBe(before);
 });
 it('rejects an existing other-owner session instead of crossing private call ownership',()=>{
  const other=sql(`insert into public.keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)values('other-diagnostic-fixture','released',${j([{ordinal:1,updateId:'other-update',sourceHash:hash}])},array[${q(model)}],.2,2,clock_timestamp()+interval'1 hour')returning id;`);
  const before=snapshot();expect(()=>json(query({session:other}))).toThrow();expect(snapshot()).toBe(before);
 });
 it.each([null,'12345678-1234-4234-8234-123456789012','a'.repeat(32),'gen-1794444170-aBcD0123456789'])('retains a valid bounded request ID %s under the same SQL allowlist',providerRequestId=>{
  json(query({receipt:{...receipt,providerRequestId,requestMethod:null,requestUrl:null,responseUrl:null,providerCode:null}}));expect(json('select diagnostic->\'providerRequestId\'from recap_internal.model_provider_diagnostics;')).toBe(providerRequestId);
 });
 it.each([{message:'PRIVATE SOURCE'},{requestUrl:'https://secret:token@openrouter.ai/api/v1/chat/completions'},{responseUrl:'https://openrouter.ai/api/v1/chat/completions?key=SECRET'},{providerRequestId:'sk-secret'},{providerCode:'no_endpoints_found'},{actualUsd:0},{retryAuthority:true},{httpStatus:200},{receivedAt:'2026-02-30T00:00:00.000Z'}])('rejects unsafe/forged diagnostic %s before error settlement',patch=>{
  const before=snapshot();expect(()=>json(query({receipt:{...receipt,...patch}}))).toThrow();expect(snapshot()).toBe(before);
 });
 it('rejects future and pre-reservation evidence times',()=>{
  const before=snapshot();for(const direction of['1 day','-1 day']){const timestamp=sql(`select to_char((clock_timestamp()+${q(direction)}::interval)at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`);expect(()=>json(query({receipt:{...receipt,receivedAt:timestamp}}))).toThrow();}expect(snapshot()).toBe(before);
 });
 it('cannot backfill a completed legacy failure',()=>{
  json(`select public.record_keyword_learning_call(${q(sid)},${q(reservation.call.call_key)},${q(reservation.call.id)},${q(reservation.call.lease_token)},${q(reservation.requestHash)},null,'analysis_provider_http_404');`);
  const before=snapshot();expect(()=>json(query())).toThrow();expect(snapshot()).toBe(before);
 });
 it('cannot overwrite a completed success or bill',()=>{
  json(`select public.record_keyword_learning_call(${q(sid)},${q(reservation.call.call_key)},${q(reservation.call.id)},${q(reservation.call.lease_token)},${q(reservation.requestHash)},'{"value":{"fixture":true},"actualUsd":0.001,"observedUsd":0.001,"providerId":"gen-fixture"}',null);`);
  const before=snapshot();expect(()=>json(query())).toThrow();expect(snapshot()).toBe(before);
 });
 it('records an in-flight failure after session closure without reopening or freeing its hold',()=>{sql(`update public.keyword_learning_sessions set state='closed'where id=${q(sid)};`);expect(json(query()).call.actual_usd).toBeNull();expect(service(`select state from public.keyword_learning_sessions where id=${q(sid)};`)).toBe('closed');});
 it('records observed error headers on a timed-out body without treating status as a charge',()=>{const saved=json(query({error:'analysis_provider_timeout'}));expect(saved.errorCode).toBe('analysis_provider_timeout');expect(saved.call.actual_usd).toBeNull();expect(saved.call.maximum_usd).toBe(.1);});
 it.each(['archive','workspace'])('survives %s erasure without rehydrating source evidence',kind=>{
  sql(kind==='archive'?`delete from public.reader_source_updates where user_id=${q(owner)};`:`delete from public.reader_workspaces where user_id=${q(owner)};`);
  const saved=json(query());expect(saved.call.actual_usd).toBeNull();expect(saved.errorCode).toBe('source_deleted');expect(saved.result).toBeNull();
  expect(json('select request_payload from public.keyword_learning_requests;')).toBeNull();expect(json('select diagnostic from recap_internal.model_provider_diagnostics;')).toEqual(receipt);
 });
 it('keeps existing source-free diagnostics immutable on duplicate acknowledgement after archive erasure',()=>{
  json(query());sql(`delete from public.reader_source_updates where user_id=${q(owner)};`);const before=snapshot();expect(json(query()).errorCode).toBe('source_deleted');expect(snapshot()).toBe(before);
 });
 it('enforces service-only RPC/table permissions, invoker mode, RLS and append-only writes',()=>{
  const signature='public.record_keyword_learning_failure_with_diagnostic(uuid,text,uuid,uuid,text,integer,text,jsonb)';
  for(const role of['anon','authenticated']){expect(sql(`select has_function_privilege(${q(role)},${q(signature)},'EXECUTE');`)).toBe('f');expect(()=>sql('set role '+role+';'+query())).toThrow();expect(()=>sql('set role '+role+';select*from recap_internal.model_provider_diagnostics;')).toThrow();}
  expect(sql(`select has_function_privilege('service_role',${q(signature)},'EXECUTE');`)).toBe('t');expect(sql(`select prosecdef from pg_proc where oid=${q(signature)}::regprocedure;`)).toBe('f');expect(sql("select relrowsecurity from pg_class where oid='recap_internal.model_provider_diagnostics'::regclass;")).toBe('t');
  json(query());expect(()=>service('delete from recap_internal.model_provider_diagnostics;')).toThrow();expect(()=>service("update recap_internal.model_provider_diagnostics set error_code='analysis_provider_http_503';")).toThrow();expect(()=>sql('delete from recap_internal.model_provider_diagnostics;')).toThrow();expect(()=>sql("update recap_internal.model_provider_diagnostics set request_hash=repeat('b',64);")).toThrow();
 });
 it('permits explicit parent FK cleanup without blocking retention erasure',()=>{json(query());sql(`delete from public.keyword_learning_requests;delete from public.reader_content_analysis_calls where id=${q(reservation.call.id)};`);expect(service('select count(*)from recap_internal.model_provider_diagnostics;')).toBe('0');});
 it('rolls back the error result if sidecar insertion fails',()=>{
  sql("create function recap_internal.fixture_fail_diagnostic()returns trigger language plpgsql as $$begin raise exception'fixture insert failure';end;$$;create trigger aa_fixture_fail before insert on recap_internal.model_provider_diagnostics for each row execute function recap_internal.fixture_fail_diagnostic();");
  const before=snapshot();expect(()=>json(query())).toThrow();expect(snapshot()).toBe(before);sql('drop trigger aa_fixture_fail on recap_internal.model_provider_diagnostics;drop function recap_internal.fixture_fail_diagnostic();');
 });
 it('serializes simultaneous identical acknowledgements without a second write or changed hold',async()=>{
  const run=()=>new Promise<string>((resolve,reject)=>{const p=execFile('psql',args,{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout.trim()));p.stdin!.end('set role service_role;'+query());});
  const values=await Promise.all([run(),run()]);expect(JSON.parse(values[0])).toEqual(JSON.parse(values[1]));expect(service('select count(*)from recap_internal.model_provider_diagnostics;')).toBe('1');expect(service("select count(*),sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))from public.reader_content_analysis_calls;")).toBe('1|0.100000000000');
 });
});
