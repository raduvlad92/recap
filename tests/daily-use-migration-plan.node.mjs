import assert from 'node:assert/strict';
import {after,before,describe,it} from 'node:test';
import {readFileSync} from 'node:fs';
import {buildDailyUseMigrationPlan} from '../scripts/daily-use-migration-plan.mjs';
import {buildReaderMigrationCapture} from '../scripts/reader-migration-plan.mjs';
import {dailyUseContract} from '../scripts/daily-use-migration-contract.mjs';
import {sourcePins} from '../scripts/reader-migration-pins.mjs';
import {ReaderReleaseDb,readerSources,bodyOf,quote} from './helpers/reader-release-db.mjs';
const sources=()=>dailyUseContract.sources.map(p=>readFileSync(new URL('../supabase/migrations/'+p.file,import.meta.url),'utf8'));
const input=()=>({mode:'rehearse',operationId:'11000000-0000-4000-8000-000000000001',
 runtimeFlags:{ACCOUNT_LIFECYCLE_ENABLED:false,ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED:false},sources:sources(),
 baseline:{objectsSha256:'a'.repeat(64),rowsSha256:'b'.repeat(64),historySha256:'c'.repeat(64)},
 expectedHosting:{control:{owner:'cloudflare',epoch:4,paused:true,release:sourcePins.coreCommit,old_host_fenced:true},
  revision:'90000000-0000-4000-8000-000000000001',work:{queued:0,running:0,expired_running:0,uncertain:96}}});
describe('daily-use migration input refusals',()=>{
 for(const[label,mutate]of[
  ['unpaused',x=>{x.expectedHosting.control.paused=false;}],['wrong serving release',x=>{x.expectedHosting.control.release='f'.repeat(40);}],
  ['queued work',x=>{x.expectedHosting.work.queued=1;}],['expired work',x=>{x.expectedHosting.work.expired_running=1;}],
  ['lifecycle enabled',x=>{x.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED=true;}],['string false',x=>{x.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED='false';}],
  ['unbound SQL hook',x=>{x.afterSql='select 1';}],['changed source bytes',x=>{x.sources[0]+='\n';}],
  ['missing baseline',x=>{delete x.baseline.rowsSha256;}],['invalid operation',x=>{x.operationId="';commit;--";}],
 ])it('refuses '+label,()=>{const x=input();mutate(x);assert.throws(()=>buildDailyUseMigrationPlan(x));});
 it('returns deterministic bounded SQL without executing it',()=>{
  const a=buildDailyUseMigrationPlan(input()),b=buildDailyUseMigrationPlan(input());assert.equal(a.sql,b.sql);assert.equal(a.transactionSha256,b.transactionSha256);
  assert.equal(a.dispatchesSql,false);assert(Buffer.byteLength(a.sql)<1000000);assert(a.sql.endsWith('rollback;\n'));
 });
});
describe('daily-use migrations on disposable PostgreSQL17',()=>{
 let db;before(()=>{db=new ReaderReleaseDb();});after(()=>db?.close());
 function fixture(){
  const name=db.fresh();db.sql(name,readFileSync(new URL('fixtures/reader-release/preservation.sql',import.meta.url),'utf8'));
  readerSources().forEach((src,i)=>{db.sql(name,src);const p=sourcePins.reader[i];db.sql(name,`insert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(p.version)},${quote(p.name)},array[${quote(bodyOf(src))}]::text[]);`);});
  const expectedHosting=JSON.parse(db.sql(name,'select public.read_hosting_release_status();'));
  const baseline=JSON.parse(db.sql(name,buildReaderMigrationCapture().sql));return{name,args:{...input(),expectedHosting,baseline}};
 }
 it('rehearses with exact preservation, then commits only the reviewed schema/history changes',()=>{
  const{name,args}=fixture(),before=db.capture(name);
  assert.equal(JSON.parse(db.sql(name,buildDailyUseMigrationPlan(args).sql)).phase,'rehearsed');assert.deepEqual(db.capture(name),before);
  assert.equal(db.sql(name,"select to_regprocedure('public.social_collection_retry_delay(text,uuid,boolean,text)')is null;"),'t');
  const plan=buildDailyUseMigrationPlan({...args,mode:'apply'}),receipt=JSON.parse(db.sql(name,plan.sql));assert.equal(receipt.phase,'applied');
  assert.deepEqual(db.capture(name),receipt.capture);assert.equal(receipt.capture.rowsSha256,before.rowsSha256);
  assert.equal(db.sql(name,'select count(*)from supabase_migrations.schema_migrations;'),'59');
  assert.equal(db.sql(name,"select has_function_privilege('anon','public.social_collection_retry_delay(text,uuid,boolean,text)','EXECUTE')or has_function_privilege('authenticated','public.social_collection_retry_delay(text,uuid,boolean,text)','EXECUTE');"),'f');
  assert.throws(()=>db.sql(name,plan.sql),/Approved baseline changed|Exact prerequisite history required/);
 });
 it('refuses stale baseline data without silently refreshing approval',()=>{
  const{name,args}=fixture();db.sql(name,"update public.reader_workspaces set state=jsonb_set(state,'{settings,interests}','[\"changed\"]');");
  const changed=db.capture(name);assert.throws(()=>db.sql(name,buildDailyUseMigrationPlan({...args,mode:'apply'}).sql),/Approved baseline changed/);assert.deepEqual(db.capture(name),changed);
 });
 it('refuses broader target-function permissions even with a newly captured baseline',()=>{
  const{name,args}=fixture();db.sql(name,'grant execute on function public.reserve_keyword_learning_call(uuid,text,integer,text,text,jsonb,text,numeric,jsonb)to anon;');
  args.baseline=JSON.parse(db.sql(name,buildReaderMigrationCapture().sql));const before=db.capture(name);
  assert.throws(()=>db.sql(name,buildDailyUseMigrationPlan({...args,mode:'apply'}).sql),/Prerequisite definition changed/);assert.deepEqual(db.capture(name),before);
 });
});
