import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Only a newly created Unix-socket PostgreSQL cluster; no credentials, existing
// database connection, supplier/source calls, or migration-history writes.
const available = ['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const migration='20261025184542_hourly_caption_recovery_fairness.sql';
describe.skipIf(!available)('D38 caption fairness on actual disposable PostgreSQL',()=>{
 let root:string,args:string[],started=false,sequence=0;
 const sql=(query:string)=>execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const invoke=(query:string)=>sql('set role service_role; '+query);
 beforeAll(()=>{
  root=mkdtempSync(join(tmpdir(),'recap-caption-db-'));const data=join(root,'data'),socket=join(root,'socket');mkdirSync(socket);
  execFileSync('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  try { execFileSync('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -h '' -p 55504`,'start'],{stdio:'ignore', env:{...process.env,LC_ALL:'C'}}); started=true; } catch { throw new Error(readFileSync(join(root,'postgres.log'),'utf8')); }
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p','55504','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')&&f!==migration).sort())sql(readFileSync(new URL(file,dir),'utf8'));
  // Eight preexisting unsettled .005 holds, one known run, plus a terminal
  // already-imported row. The additive migration must preserve every old field.
  fixture('migration-preservation');
  const c=JSON.parse(invoke(`select public.claim_hourly_source('migration-preservation','source-0');`));
  for(let i=0;i<8;i++)addJob('migration-preservation','source-0',c,i,i<7?'ambiguous':'running',i<7?null:'KnownRun');
  sql(`create table caption_pre_migration_snapshot as select id,to_jsonb(j) as record from public.reader_collection_provider_jobs j;
   create table caption_pre_reservation_snapshot as select id,to_jsonb(r) as record from public.collection_budget_reservations r;`);
  sql(readFileSync(new URL(migration,dir),'utf8'));
 },20000);
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 function fixture(explicitUser?:string,count=1){
  const user=explicitUser||'caption-db-owner-'+(++sequence);
  const sources=Array.from({length:count},(_,i)=>({id:'source-'+i,name:'Synthetic source '+i,platform:'YouTube',url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',status:'ready',creatorIds:[]}));
  const state={version:1,followedSourceIds:sources.map(s=>s.id),customSources:sources,importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}};
  sql(`insert into public.reader_collection_policies(user_id,enabled,provider_enabled) values('${user}',true,true);insert into public.reader_workspaces(user_id,state) values('${user}','${JSON.stringify(state)}');`);
  return user;
 }
 function addJob(user:string,source:string,c:{checkId:string},i:number,state='ambiguous',run:string|null=null){
  return sql(`with j as (insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status) values('${user}','${source}','Synthetic','https://www.youtube.com/watch?v=${String(i).padStart(11,'0')}','YouTube','apify','h7sDV53CddomktSi5','running') returning id),r as(select (public.reserve_collection_budget('caption-fixture.${user}.${i}',.005,'job',null,'apify','h7sDV53CddomktSi5')).id as id)
   insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,provider_run_id)
   select '${user}','${source}','youtube:${String(i).padStart(11,'0')}',s.fingerprint,'${c.checkId}',j.id,r.id,'h7sDV53CddomktSi5',.005,'${state}',${run?"'"+run+"'":'null'} from j,r,public.reader_collection_source_state s where s.user_id='${user}' and s.source_id='${source}' returning id;`);
 }
 const claim=(user:string,source='source-0')=>JSON.parse(invoke(`select coalesce(public.claim_hourly_source('${user}','${source}'),'null'::jsonb);`));
 const pending=(c:{checkId:string,leaseToken:string})=>JSON.parse(invoke(`select public.pending_hourly_providers('${c.checkId}','${c.leaseToken}');`)) as Array<{id:string,provider_run_id:string|null,content_pending:boolean}>;
 const service=(c:{checkId:string,leaseToken:string},id:string)=>invoke(`select public.service_hourly_provider('${c.checkId}','${c.leaseToken}','${id}');`);
 const schedule=()=>JSON.parse(invoke('select public.schedule_hourly_sources();')) as Array<{user_id:string,source_id:string}>;
 it('adds only new fields/defaults and preserves all eight unknown .040 holds and prior identities',()=>{
  expect(sql(`select count(*) from public.reader_collection_provider_jobs j join caption_pre_migration_snapshot p using(id) where p.record is distinct from to_jsonb(j)-'last_reconciled_at'-'content_pending';`)).toBe('0');
  expect(sql(`select count(*) from public.collection_budget_reservations r join caption_pre_reservation_snapshot p using(id) where p.record is distinct from to_jsonb(r);`)).toBe('0');
  expect(sql(`select count(*)||':'||sum(maximum_usd)||':'||count(actual_cost_usd) from public.reader_collection_provider_jobs where user_id='migration-preservation';`)).toBe('8:0.040000:0');
  expect(sql(`select bool_and(content_pending) from public.reader_collection_provider_jobs where user_id='migration-preservation';`)).toBe('t');
 });
 it('F1 uses persisted least-served ordering beyond 100 ambiguous jobs, retaining holds and bounded pages',()=>{
  const user=fixture(),c=claim(user),ids=Array.from({length:101},(_,i)=>addJob(user,'source-0',c,i,i===100?'running':'ambiguous',i===100?'SyntheticKnownRun':null));
  const first=pending(c);expect(first).toHaveLength(100);expect(first.some(j=>j.provider_run_id)).toBe(false);
  for(const j of first)service(c,j.id);
  const restarted=pending(c);expect(restarted[0].id).toBe(ids[100]);expect(restarted[0].provider_run_id).toBe('SyntheticKnownRun');
  expect(sql(`select count(*)||':'||count(actual_cost_usd) from public.reader_collection_provider_jobs where user_id='${user}';`)).toBe('101:0');
  expect(sql(`select count(*) from public.collection_budget_reservations r join public.reader_collection_provider_jobs j on j.reservation_id=r.id where j.user_id='${user}' and r.state='held';`)).toBe('101');
 },15000);
 it('F3 persists only actual claims, rotates across owners/restarts, and preserves actual UTC-hour due and lease gates',()=>{
  const a=fixture(undefined,4),b=fixture(undefined,2);
  const read1=schedule().filter(e=>[a,b].includes(e.user_id));expect(read1).toHaveLength(6);
  expect(schedule().filter(e=>[a,b].includes(e.user_id))).toEqual(read1);
  expect(sql(`select count(*) from public.reader_collection_source_state where user_id in ('${a}','${b}');`)).toBe('0');
  const ca=claim(a),startedAt=sql(`select last_started_at from public.reader_collection_source_state where user_id='${a}' and source_id='source-0';`);expect(startedAt).not.toBe('');
  expect(claim(a)).toBeNull();expect(schedule().some(e=>e.user_id===a&&e.source_id==='source-0')).toBe(false);
  invoke(`select public.finish_hourly_source('${ca.checkId}','${ca.leaseToken}','{"status":"partial"}');`);
  expect(claim(a)).toBeNull();
  expect(sql(`select next_check_at=((date_trunc('hour',last_checked_at at time zone 'UTC')+interval '1 hour') at time zone 'UTC') from public.reader_collection_source_state where user_id='${a}' and source_id='source-0';`)).toBe('t');
  sql(`update public.reader_collection_source_state set next_check_at='-infinity' where user_id='${a}';`);
  const read2=schedule().filter(e=>[a,b].includes(e.user_id));expect(read2.at(-1)).toEqual({user_id:a,source_id:'source-0'});
  for(const e of read2.slice(0,-1)){const c=claim(e.user_id,e.source_id);expect(c).not.toBeNull();}
  expect(schedule().filter(e=>[a,b].includes(e.user_id))).toEqual([{user_id:a,source_id:'source-0'}]);
 });
 it('touch RPC is service-only and enforces stale-token, workspace CAS, changed source, expired lease and source deletion fences',()=>{
  const user=fixture(),c=claim(user),id=addJob(user,'source-0',c,0);
  expect(()=>service({...c,leaseToken:'00000000-0000-4000-8000-000000000000'},id)).toThrow(/PT409/);
  expect(()=>sql(`set role authenticated;select public.service_hourly_provider('${c.checkId}','${c.leaseToken}','${id}');`)).toThrow(/42501/);
  expect(sql(`select has_function_privilege('anon','public.schedule_hourly_sources()','execute') or has_function_privilege('authenticated','public.pending_hourly_providers(uuid,uuid)','execute');`)).toBe('f');
  service(c,id);expect(sql(`select last_reconciled_at is not null from public.reader_collection_provider_jobs where id='${id}';`)).toBe('t');
  sql(`update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["synthetic-bookmark"]') where user_id='${user}';`);
  expect(()=>service(c,id)).toThrow(/PT409/);
  sql(`update public.reader_collection_source_state set workspace_revision=(select updated_at from public.reader_workspaces where user_id='${user}') where user_id='${user}';update public.reader_workspaces set state=jsonb_set(state,'{customSources,0,url}','"https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx"') where user_id='${user}';`);
  expect(()=>service(c,id)).toThrow(/PT409/);
  sql(`update public.reader_collection_source_state set lease_until=clock_timestamp()-interval '1 second' where user_id='${user}';`);expect(()=>service(c,id)).toThrow(/PT409/);
  sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id='${user}';`);
  expect(claim(user)).toBeNull();expect(schedule().some(e=>e.user_id===user)).toBe(false);expect(()=>service(c,id)).toThrow(/PT409/);
  expect(sql(`select discard_result from public.reader_collection_provider_jobs where id='${id}';`)).toBe('t');
  expect(sql(`select actual_cost_usd is null from public.reader_collection_provider_jobs where id='${id}';`)).toBe('t');
 });
 it('F4 settles a known terminal fee while content_pending remains GET-only; accepted import retires content independently of unknown fee holds',()=>{
  const user=fixture(),c=claim(user),id=addJob(user,'source-0',c,1,'running','SyntheticKnownRun');
  const rid=sql(`select reservation_id from public.reader_collection_provider_jobs where id='${id}';`);
  invoke(`select public.claim_collection_budget('${rid}');select public.settle_collection_budget('${rid}','SyntheticKnownRun',.004,true);update public.reader_collection_provider_jobs set state='completed',actual_cost_usd=.004,content_pending=true where id='${id}';`);
  expect(pending(c).find(j=>j.id===id)).toMatchObject({content_pending:true});
  expect(sql(`select state||':'||actual_cost_usd from public.collection_budget_reservations where id='${rid}';`)).toBe('settled:0.004000000000');
  expect(()=>invoke(`select public.settle_collection_budget('${rid}','SyntheticKnownRun',.003,true);`)).toThrow(/PT409/);
  invoke(`select public.finish_hourly_source('${c.checkId}','${c.leaseToken}','{"status":"partial","details":{"captionStatus":"response_too_large"}}');`);
  expect(sql(`select count(*) from public.reader_source_updates where user_id='${user}';`)).toBe('0');
  sql(`update public.reader_collection_source_state set next_check_at='-infinity' where user_id='${user}';`);
  const restart=claim(user);expect(pending(restart).find(j=>j.id===id)).toBeDefined();
  const items=[{itemKey:'youtube:00000000001',record:{id:'caption-fixture-original',sourceId:'source-0',url:'https://www.youtube.com/watch?v=00000000001',publishedAt:'2026-10-22T12:00:00Z',isSample:false,contentKind:'transcript',content:'Existing original, no synthetic inference',summary:'Original summary'}}];
  const result=JSON.parse(invoke(`select public.finish_hourly_source('${restart.checkId}','${restart.leaseToken}','{"status":"collected"}','${JSON.stringify(items)}');`));expect(result.importAccepted).toBe(true);
  invoke(`update public.reader_collection_provider_jobs set content_pending=false where id='${id}';`);
  sql(`update public.reader_collection_source_state set next_check_at='-infinity' where user_id='${user}';`);const again=claim(user);expect(pending(again).some(j=>j.id===id)).toBe(false);
  const unknown=addJob(user,'source-0',again,2,'completed','SyntheticUnknownRun');invoke(`update public.reader_collection_provider_jobs set content_pending=false where id='${unknown}';`);
  expect(pending(again).some(j=>j.id===unknown)).toBe(true);
  expect(sql(`select r.state||':'||(r.actual_cost_usd is null) from public.collection_budget_reservations r join public.reader_collection_provider_jobs j on j.reservation_id=r.id where j.id='${unknown}';`)).toBe('held:true');
  // Deleting the archived original invalidates leases and never reopens import.
  sql(`delete from public.reader_source_updates where user_id='${user}';`);expect(()=>service(again,id)).toThrow(/PT409/);
  expect(sql(`select discard_result from public.reader_collection_provider_jobs where id='${id}';`)).toBe('t');
 });
});
