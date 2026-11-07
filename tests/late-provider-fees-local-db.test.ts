import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const migration='20261107194452_late_provider_fee_receipts.sql';
const quote=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
describe.skipIf(!available)('late provider fees on a disposable socket-only PostgreSQL cluster',()=>{
 let root:string,args:string[],started=false,sequence=0;
 const sql=(query:string)=>execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const invoke=(query:string)=>sql('set role service_role; '+query);
 beforeAll(()=>{
  root=mkdtempSync(join(tmpdir(),'recap-late-fee-'));mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'log'),'-o',`-k ${join(root,'socket')} -h '' -p 55639`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55639','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')&&f!==migration).sort())sql(readFileSync(new URL(file,dir),'utf8'));
  // Deliberately ancient unknown source/model fixtures. No age-based clearing.
  sql(`insert into public.collection_budget_reservations(request_key,kind,maximum_usd,provider,actor_id,launch_attempted_at,created_at)
   select 'original-hold.'||n,'job',.005,'apify','h7sDV53CddomktSi5','2020-01-01','2020-01-01' from generate_series(1,17)n;
   insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)
   select 'synthetic-old-model','original-model.'||n,gen_random_uuid(),'synthetic/model',repeat('a',64),.01,'unknown','2020-01-01' from generate_series(1,7)n;
   create table preserved_holds as select id,to_jsonb(r) as record from public.collection_budget_reservations r;
   create table preserved_models as select id,to_jsonb(c) as record from public.reader_content_analysis_calls c;`);
  sql(readFileSync(new URL(migration,dir),'utf8'));
 },30000);
 beforeEach(()=>sql('truncate public.collection_provider_fee_receipts;'));
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 function fixture(cost='0',maximum='.005'){
  const n=++sequence,user='synthetic-fee-'+n,run='SyntheticRun'+n;
  sql(`insert into public.reader_collection_policies(user_id)values('${user}');
   insert into public.reader_collection_source_state(user_id,source_id,fingerprint)values('${user}','synthetic-source','original-fingerprint');`);
  const check=sql(`insert into public.reader_collection_checks(user_id,source_id,source_name,source_url,platform)values('${user}','synthetic-source','Synthetic','https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv','YouTube')returning id;`);
  const ledger=sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status,cost_status,observed_cost_usd,result_count,error_code)
   values('${user}','synthetic-source','Synthetic','https://www.youtube.com/watch?v=abcdefghijk','YouTube','apify','h7sDV53CddomktSi5','${run}','succeeded','provider_reported',${cost},7,'original_content_gap')returning id;`);
  const rid=JSON.parse(invoke(`select to_jsonb(public.reserve_collection_budget('synthetic-fee.${n}',${maximum},'job',null,'apify','h7sDV53CddomktSi5'));`)).id;
  invoke(`select public.claim_collection_budget('${rid}');select public.settle_collection_budget('${rid}','${run}',${cost},true);`);
  const id=sql(`insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,provider_run_id,actual_cost_usd,observed_cost_usd,finished_at,content_pending,discard_result)
   values('${user}','synthetic-source','youtube:abcdefghijk','original-fingerprint','${check}','${ledger}','${rid}','h7sDV53CddomktSi5',${maximum},'completed','${run}',${cost},${cost},'2026-11-06',false,true)returning id;`);
  return {id,rid,run,user,ledger};
 }
 const snapshot=(f:ReturnType<typeof fixture>)=>JSON.parse(invoke(`select public.prepare_late_provider_fee('${f.id}');`));
 const evidence=(f:ReturnType<typeof fixture>,patch:Record<string,unknown>={})=>({run_id:f.run,actor_id:'h7sDV53CddomktSi5',build_id:'SyntheticBuild123',status:'SUCCEEDED',finished_at:new Date(Date.now()-60000).toISOString(),observed_at:new Date().toISOString(),response_sha256:'a'.repeat(64),usage_usd:'0.004',maximum_usd:'0.005',authenticated_owner:true,...patch});
 const request=(f:ReturnType<typeof fixture>,key:string,expected:unknown,e:unknown)=>`select public.record_late_provider_fee('${f.id}','${key}',${quote(expected)},${quote(e)});`;
 const record=(f:ReturnType<typeof fixture>,key:string,e:unknown=evidence(f),expected:unknown=snapshot(f))=>JSON.parse(invoke(request(f,key,expected,e)));
 const money=(f:ReturnType<typeof fixture>)=>sql(`select actual_cost_usd::text from public.collection_budget_reservations where id='${f.rid}';`);
 it('preserves every field of seventeen original holds and seven unknown model charges during migration',()=>{
  expect(sql(`select count(*) from preserved_holds p join collection_budget_reservations r using(id) where p.record is distinct from to_jsonb(r);`)).toBe('0');
  expect(sql(`select count(*) from preserved_models p join reader_content_analysis_calls c using(id) where p.record is distinct from to_jsonb(c);`)).toBe('0');
  const old=sql('select id from preserved_holds limit 1;');expect(()=>invoke(`select public.prepare_late_provider_fee('${old}');`)).toThrow(/PT409/);
 });
 it('corrects 0 to .004 atomically, keeps the original history and all nonfinancial job fields inspectable',()=>{
  const f=fixture(),expected=snapshot(f),e=evidence(f);
  const original=sql(`select to_jsonb(r) from collection_budget_reservations r where id='${f.rid}';`);
  const beforeJob=sql(`select to_jsonb(j)-'actual_cost_usd'-'observed_cost_usd' from reader_collection_provider_jobs j where id='${f.id}';`);
  const beforeLedger=sql(`select to_jsonb(j)-'observed_cost_usd'-'cost_status'-'updated_at' from collection_jobs j where id='${f.ledger}';`);
  const result=record(f,'correction',e,expected);
  expect(result).toMatchObject({outcome:'applied',previous_usd:'0.000000000000',corrected_usd:'0.004000000000',delta_usd:'0.004000000000'});expect(money(f)).toBe('0.004000000000');
  expect(sql(`select original_reservation from collection_provider_fee_receipts where id='${result.id}';`)).toBe(original);
  expect(sql(`select to_jsonb(j)-'actual_cost_usd'-'observed_cost_usd' from reader_collection_provider_jobs j where id='${f.id}';`)).toBe(beforeJob);
  expect(sql(`select to_jsonb(j)-'observed_cost_usd'-'cost_status'-'updated_at' from collection_jobs j where id='${f.ledger}';`)).toBe(beforeLedger);
  expect(()=>invoke(`select public.settle_collection_budget('${f.rid}','${f.run}',0,true);`)).toThrow(/PT409/);
  expect(record(f,'correction',e,expected)).toEqual(result);
  expect(record(f,'correction',e)).toEqual(result);
  expect(record(f,'same-fee-new-observation',e)).toMatchObject({outcome:'unchanged',delta_usd:'0.000000000000'});
  expect(()=>record(f,'correction',{...e,usage_usd:'0.0041'},expected)).toThrow(/PT409/);
 });
 it.each([
  [{status:'RUNNING',finished_at:null,usage_usd:'0'},'unresolved_nonfinal'],
  [{finished_at:'recent',usage_usd:'0'},'unresolved_nonfinal'],
  [{usage_usd:'0'},'unresolved_zero'],[{usage_usd:null},'unresolved_missing_fee'],
  [{usage_usd:'0.0001'},'unresolved_decrease'],
 ])('records unresolved fee evidence without changing original settlement: %j', (patch,outcome)=>{
  const f=fixture('.001'),currentPatch={...patch,...('finished_at' in patch && patch.finished_at==='recent'?{finished_at:new Date().toISOString()}:{})};
  expect(record(f,'unresolved',evidence(f,currentPatch))).toMatchObject({outcome,delta_usd:'0.000000000000'});expect(money(f)).toBe('0.001000000000');
 });
 it('rounds a positive sub-picodollar upward and never rounds an over-cap charge down',()=>{
  const f=fixture();expect(record(f,'exact',evidence(f,{usage_usd:'1e-13'}))).toMatchObject({corrected_usd:'0.000000000001'});
  const g=fixture();expect(record(g,'over-rounded-cap',evidence(g,{usage_usd:'0.00500000000000001'}))).toMatchObject({outcome:'unresolved_over_cap',reported_usd:'0.005000000001'});expect(money(g)).toBe('0.000000000000');
  expect(()=>invoke(`select public.reserve_collection_budget('overrun-new-job',.005,'job',null,'apify','h7sDV53CddomktSi5');`)).toThrow(/PT402/);
 });
 it('blocks an unlaunched existing reservation after an unresolved overrun and never discounts prior high-water receipts',()=>{
  const f=fixture(),rid=JSON.parse(invoke(`select to_jsonb(public.reserve_collection_budget('unlaunched-before-overrun',.005,'job',null,'apify','h7sDV53CddomktSi5'));`)).id;
  expect(record(f,'over-cap',evidence(f,{usage_usd:'0.006'})).outcome).toBe('unresolved_over_cap');
  expect(()=>invoke(`select public.claim_collection_budget('${rid}');`)).toThrow(/PT402/);
  expect(record(f,'later-lower-amount',evidence(f)).outcome).toBe('unresolved_decrease');expect(money(f)).toBe('0.000000000000');
 });
 it('stops an observed overrun even before provider accounting is final',()=>{
  const f=fixture();expect(record(f,'running-overrun',evidence(f,{status:'RUNNING',finished_at:null,usage_usd:'0.006'})).outcome).toBe('unresolved_over_cap');
  expect(money(f)).toBe('0.000000000000');expect(()=>invoke(`select public.reserve_collection_budget('running-overrun-admission',.005,'job',null,'apify','h7sDV53CddomktSi5');`)).toThrow(/PT402/);
 });
 it.each([{run_id:'WrongRun123'},{actor_id:'WrongActor123'},{authenticated_owner:false},{maximum_usd:'0.006'},{observed_at:'2020-01-01'}])('rejects wrong identity, cap, authorization and stale metadata: %j',patch=>{
  const f=fixture();expect(()=>record(f,'bad-evidence',evidence(f,patch))).toThrow();expect(money(f)).toBe('0.000000000000');expect(sql('select count(*) from collection_provider_fee_receipts;')).toBe('0');
 });
 it('CAS rejects a changed cash projection or even an unrelated saved-job change after metadata inspection',()=>{
  const f=fixture(),expected=snapshot(f),e=evidence(f);sql(`update reader_collection_provider_jobs set discard_result=false where id='${f.id}';`);
  expect(()=>record(f,'stale',e,expected)).toThrow(/PT409/);expect(money(f)).toBe('0.000000000000');
 });
 it('refuses a referenced unknown reservation even when its completion timestamp is old',()=>{
  const f=fixture();sql(`update collection_budget_reservations set state='held',actual_cost_usd=null,completed_at='2020-01-01' where id='${f.rid}';
   update reader_collection_provider_jobs set actual_cost_usd=null where id='${f.id}';`);
  expect(()=>snapshot(f)).toThrow(/PT409/);expect(sql(`select state||':'||(actual_cost_usd is null) from collection_budget_reservations where id='${f.rid}';`)).toBe('held:true');
 });
 it('keeps receipts private, immutable, invoker-only, and denies reader/anonymous RPC access',()=>{
  const f=fixture(),r=record(f,'private');
  for(const role of ['anon','authenticated']){
   expect(()=>sql(`set role ${role};${request(f,'attack',snapshot(f),evidence(f))}`)).toThrow(/42501/);
   expect(()=>sql(`set role ${role};select * from collection_provider_fee_receipts;`)).toThrow(/42501/);
  }
  expect(()=>invoke(`update collection_provider_fee_receipts set delta_usd=0 where id='${r.id}';`)).toThrow(/42501/);
  expect(()=>sql(`delete from collection_provider_fee_receipts where id='${r.id}';`)).toThrow(/PT409/);
  expect(sql(`select bool_or(prosecdef) from pg_proc where proname in('prepare_late_provider_fee','record_late_provider_fee');`)).toBe('f');
 });
 it('does not change original held/model identities after every correction and rejected case',()=>{
  expect(sql(`select count(*) from preserved_holds p join collection_budget_reservations r using(id) where p.record is distinct from to_jsonb(r);`)).toBe('0');
  expect(sql(`select count(*) from preserved_models p join reader_content_analysis_calls c using(id) where p.record is distinct from to_jsonb(c);`)).toBe('0');
  expect(sql(`select count(*)||':'||sum(maximum_usd) from collection_budget_reservations where request_key like 'original-hold.%' and state='held' and actual_cost_usd is null;`)).toBe('17:0.085000');
 });
 it('checks original-day reader and global caps before any correction, retaining an unresolved receipt',()=>{
  const f=fixture(),e=evidence(f),expected=snapshot(f);
  expect(JSON.parse(sql(`begin;update reader_collection_policies set daily_limit_usd=.003 where user_id='${f.user}';set local role service_role;${request(f,'daily-cap',expected,e)}rollback;`))).toMatchObject({outcome:'unresolved_over_cap'});expect(money(f)).toBe('0.000000000000');
  expect(JSON.parse(sql(`begin;update reader_collection_policies set lifetime_limit_usd=.003 where user_id='${f.user}';set local role service_role;${request(f,'lifetime-cap',expected,e)}rollback;`))).toMatchObject({outcome:'unresolved_over_cap'});expect(money(f)).toBe('0.000000000000');
  expect(JSON.parse(sql(`begin;update collection_budget_accounts set ceiling_usd=.001;set local role service_role;${request(f,'global-cap',expected,e)}rollback;`))).toMatchObject({outcome:'unresolved_over_cap'});expect(money(f)).toBe('0.000000000000');
 });
 const asyncSql=(query:string)=>new Promise<{code:number|null,out:string,err:string}>(resolve=>{
  const child=spawn('psql',args);let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('close',code=>resolve({code,out:out.trim(),err}));child.stdin.end('set role service_role; '+query);
 });
 it('serializes simultaneous identical receipts and competing CAS corrections without double charging',async()=>{
  const f=fixture(),e=evidence(f),expected=snapshot(f),query=request(f,'concurrent-identical',expected,e);
  const identical=await Promise.all([asyncSql(query),asyncSql(query)]);expect(identical.map(r=>r.code)).toEqual([0,0]);expect(identical[0].out).toBe(identical[1].out);expect(money(f)).toBe('0.004000000000');
  const g=fixture(),same=snapshot(g),a=request(g,'concurrent-a',same,evidence(g)),b=request(g,'concurrent-b',same,evidence(g,{usage_usd:'0.0045'}));
  const competing=await Promise.all([asyncSql(a),asyncSql(b)]);expect(competing.filter(r=>r.code===0)).toHaveLength(1);expect(competing.find(r=>r.code!==0)?.err).toMatch(/PT409/);
  expect(sql(`select count(*) from collection_provider_fee_receipts where reservation_id='${g.rid}';`)).toBe('1');
 });
});
