import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '../src/lib/fixtures';
const dir=new URL('../supabase/migrations/',import.meta.url),lifecycleName='20261107203128_account_lifecycle.sql';
const localNames=readdirSync(dir),extra=process.env.READER_IDENTITY_TEST_LIFECYCLE_MIGRATION;
const lifecycleAvailable=localNames.includes(lifecycleName)||!!extra;
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(value:unknown)=>q(JSON.stringify(value))+'::jsonb';
const issuerA='https://synthetic-a.example',issuerB='https://synthetic-b.example',ownerA='user_stableA',ownerB='user_stableB',subject='user_providerA';
describe.skipIf(!available||!lifecycleAvailable)('identity against the actual PR17 lifecycle migration, disposable PostgreSQL',()=>{
 let root:string,args:string[],started=false;
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s);
 const own=(s:string,sub=subject,iss=issuerA)=>sql(`set role authenticated;set request.jwt.claims=${q(JSON.stringify({sub,iss}))};`+s);
 const configure=(mode='linked',ready=true)=>service(`select review_reader_identity_configuration('${mode}',${ready},array['${issuerA}','${issuerB}'],'synthetic-operator','synthetic-review');`);
 const bind=(sub=subject,owner=ownerA,iss=issuerA)=>`select bind_reader_identity_alias('${iss}','${sub}','${owner}','synthetic-operator','synthetic-explicit-evidence');`;
 const deletion=(owner=ownerA,sub=subject,iss=issuerA,id='10000000-0000-4000-8000-000000000001')=>`select request_account_deletion('${owner}','${id}','${iss}','${sub}');`;
 beforeAll(()=>{
  root=mkdtempSync('/tmp/recap-identity-pr17-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'log'),'-o',`-k ${join(root,'socket')} -h '' -p 55643`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55643','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const migrations=localNames.filter(f=>f.endsWith('.sql')).map(name=>({name,sql:readFileSync(new URL(name,dir),'utf8')}));
  if(!localNames.includes(lifecycleName)&&extra)migrations.push({name:lifecycleName,sql:readFileSync(extra,'utf8')});
  for(const path of (process.env.READER_IDENTITY_TEST_EXTRA_MIGRATIONS||'').split(':').filter(Boolean)){const name=path.split('/').at(-1)!;if(!migrations.some(m=>m.name===name))migrations.push({name,sql:readFileSync(path,'utf8')});}
  for(const migration of migrations.sort((a,b)=>a.name.localeCompare(b.name)))sql(migration.sql);
 },40000);
 beforeEach(()=>{
  sql(`truncate recap_internal.account_deletions cascade;truncate recap_internal.reader_identity_aliases,recap_internal.reader_identity_events;truncate reader_workspaces cascade;
   insert into reader_workspaces(user_id,state)values('${ownerA}',${j({...createDefaultWorkspace(),sourceCollections:[]})}),('${ownerB}',${j({...createDefaultWorkspace(),sourceCollections:[]})}),('${subject}',${j({...createDefaultWorkspace(),sourceCollections:[]})});`);
  configure('legacy',false);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('keeps linked mode inactive, preserves the real legacy access fence with flags off, and cannot expose private tombstones',()=>{
  expect(own('select current_reader_owner();')).toBe(subject);service(deletion(subject));
  expect(service(`select account_access_allowed('${subject}');`)).toBe('f');expect(own('select current_reader_owner();')).toBe('');expect(own('select count(*)from reader_workspaces;')).toBe('0');
  configure('linked',false);expect(own('select current_reader_owner();')).toBe('');
  expect(()=>own('select *from recap_internal.account_deletions;')).toThrow(/42501/);
 });
 it('suppresses every mapped alias and reminder lookup for a deleted stable owner without changing its frozen native locator',()=>{
  configure();service(bind());service(bind('user_secondAlias',ownerA,issuerB));
  expect(own('select user_id from reader_workspaces;')).toBe(ownerA);service(deletion());
  expect(sql(`select user_id||':'||identity_issuer||':'||identity_subject from recap_internal.account_deletions;`)).toBe(`${ownerA}:${issuerA}:${subject}`);
  expect(own('select current_reader_owner();')).toBe('');expect(own('select current_reader_owner();','user_secondAlias',issuerB)).toBe('');
  expect(service(`select reader_provider_subject('${ownerA}','${issuerB}');`)).toBe('');
  expect(()=>service(bind('user_newAlias'))).toThrow(/PT403/);
  // Native completion still has only one frozen identity: alias-wide Clerk
  // revocation/custody is parent work, never certified by this foundation.
  expect(sql(`select count(*)from recap_internal.reader_identity_aliases where owner_id='${ownerA}';`)).toBe('2');
 });
 it('denies a tombstoned frozen provider identity even when the proposed stable target remains active',()=>{
  configure();service(bind('user_frozenProvider',ownerB));service(deletion(ownerB,'user_frozenProvider'));
  expect(service(`select account_access_allowed('${ownerA}');`)).toBe('t');expect(()=>service(bind('user_frozenProvider'))).toThrow(/PT403/);
 });
 it('uses stable ownership in PR17 restrictive RLS, avoiding a same-subject different-issuer collision',()=>{
  configure();service(bind());service(bind('user_otherOriginal',subject,issuerB));service(deletion(subject,'user_otherOriginal',issuerB));
  expect(service(`select account_access_allowed('${subject}');`)).toBe('f');
  expect(own('select current_reader_owner();')).toBe(ownerA);expect(own('select user_id from reader_workspaces;')).toBe(ownerA);
 });
 async function heldTransaction(query:string){
  const child=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
  const ready=new Promise<void>((resolve,reject)=>{child.stdout.on('data',c=>{out+=c;if(out.includes('identity-held'))resolve();});child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>{if(code)reject(new Error(err));});});
  const done=new Promise<void>((resolve,reject)=>child.on('exit',code=>code===0?resolve():reject(new Error(err))));
  child.stdin.end(`begin;set local role service_role;${query}\n\\echo identity-held\nselect pg_sleep(0.6);commit;`);await ready;return {done};
 }
 it('uses the real nonblocking owner barrier when deletion already holds its exclusive side',async()=>{
  configure();service(bind());const {done}=await heldTransaction(deletion());
  expect(()=>service(bind())).toThrow(/PT409/);await done;expect(()=>service(bind())).toThrow(/PT403/);
 });
 it('prevents accepting deletion while alias binding holds the shared writer barrier',async()=>{
  configure();const {done}=await heldTransaction(bind());
  expect(()=>service(deletion())).toThrow(/PT409/);await done;service(deletion());expect(own('select current_reader_owner();')).toBe('');
 });
 it('freezes revoked and disabled aliases, resolves only their own tombstone, and requires native proof for every alias',()=>{
  configure();service(bind());service(bind('user_revokedAlias',ownerA,issuerB));
  service(`select revoke_reader_identity_alias('${issuerB}','user_revokedAlias','synthetic-operator','synthetic-revocation');`);
  service(deletion());
  expect(sql(`select count(*)from recap_internal.account_deletion_identities;`)).toBe('2');
  expect(service(`select resolve_account_deletion_owner('${issuerB}','user_revokedAlias');`)).toBe(ownerA);
  expect(service(`select resolve_account_deletion_owner('${issuerB}','user_unknown');`)).toBe('');
  expect(own('select current_reader_owner();','user_revokedAlias',issuerB)).toBe('');
  expect(()=>own(`select resolve_account_deletion_owner('${issuerB}','user_revokedAlias');`)).toThrow(/42501/);
  expect(()=>own('select *from recap_internal.account_deletion_identities;')).toThrow(/42501/);
  expect(()=>sql('delete from recap_internal.account_deletion_identities;')).toThrow(/PT409/);
  const c=JSON.parse(service('select claim_account_deletion();'));
  const advance=`select advance_account_deletion('${c.id}','${c.lease_token}','identity_deleted');`;
  expect(()=>service(advance)).toThrow(/PT409/);
  const proof=(sub:string,iss:string)=>`select record_account_deletion_identity_step('${c.id}','${c.lease_token}','${iss}','${sub}','deleted');`;
  expect(()=>service(proof('user_wrongAlias',issuerA))).toThrow(/PT400/);
  service(proof(subject,issuerA));expect(()=>service(advance)).toThrow(/PT409/);
  service(proof('user_revokedAlias',issuerB));service(advance);
  expect(sql('select identity_deleted_at is not null from recap_internal.account_deletions;')).toBe('t');
  service(`select requeue_account_deletion_after_restore('${c.id}');`);
  const next=JSON.parse(service('select claim_account_deletion();'));
  expect(next.restore_generation).toBe(1);expect(next.identities.every((i:any)=>i.deleted===false)).toBe(true);
  expect(()=>service(`select advance_account_deletion('${next.id}','${next.lease_token}','identity_deleted');`)).toThrow(/PT409/);
  expect(sql('select count(*)from recap_internal.account_deletion_identity_steps where step=\'deleted\';')).toBe('2');
 });
 it('rejects a mismatched stable owner and cannot link any frozen alias to a new active owner',()=>{
  configure();service(bind());service(bind('user_oldAlias',ownerA,issuerB));
  expect(()=>service(deletion(ownerB))).toThrow(/PT403/);service(deletion());
  expect(()=>service(bind('user_oldAlias',ownerB,issuerB))).toThrow(/PT403/);
  expect(service(`select account_access_allowed('${ownerB}');`)).toBe('t');
 });

 it('fails closed on conflicting restored alias custody rather than silently dropping a locator from the deletion snapshot',()=>{
  configure();service(bind());service(bind('user_otherAlias',ownerB,issuerB));service(deletion());
  // Deliberately corrupt a restored alias with the owner-only test connection;
  // ordinary readers and service-role callers cannot directly make this edit.
  sql(`update recap_internal.reader_identity_aliases set owner_id='${ownerB}'where issuer='${issuerA}'and subject='${subject}';`);
  expect(()=>service(deletion(ownerB,'user_otherAlias',issuerB,'10000000-0000-4000-8000-000000000002'))).toThrow(/23505/);
  expect(service(`select account_access_allowed('${ownerB}');`)).toBe('t');
  expect(sql(`select count(*)from recap_internal.account_deletions;`)).toBe('1');
 });

});
