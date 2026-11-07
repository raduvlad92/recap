import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '../src/lib/fixtures';

const available = ['initdb','pg_ctl','psql'].every(bin => { try { execFileSync(bin,['--version'],{stdio:'ignore'}); return true; } catch { return false; } });
const migration = '20261107205636_stable_reader_ownership.sql';
const q = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'","''") + "'::jsonb";
const issuerA = 'https://synthetic-a.example', issuerB = 'https://synthetic-b.example';
describe.skipIf(!available)('reader identity on disposable socket-only PostgreSQL', () => {
 let root: string, args: string[], started = false, before: string, initialConfig: string, originalGuard: string, lifecycleInstalled: boolean;
 const sql = (query: string) => execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 const reader = (query: string, subject = 'synthetic-provider-a', issuer: string | null = issuerA) => sql(`set role authenticated; set request.jwt.claims=${"'"+JSON.stringify({sub:subject,...(issuer ? {iss:issuer} : {})})+"'"}; ${query}`);
 const configure = (mode = 'linked', ready = true) => service(`select public.review_reader_identity_configuration('${mode}',${ready},array['${issuerA}','${issuerB}'],'synthetic-operator','synthetic-review');`);
 const bind = (subject = 'synthetic-provider-a', owner = 'synthetic-owner-a', issuer = issuerA) => `select public.bind_reader_identity_alias('${issuer}','${subject}','${owner}','synthetic-operator','synthetic-explicit-control-proof');`;
 const owner = (subject = 'synthetic-provider-a', issuer: string | null = issuerA) => reader('select public.current_reader_owner();',subject,issuer);
 const snapshot = () => sql('select public.synthetic_snapshot();');
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(),'recap-reader-identity-')); mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'log'),'-o',`-k ${join(root,'socket')} -h '' -p 55642`,'start'],{stdio:'ignore'}); started = true;
  args = ['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55642','-U','postgres','-d','postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const dir = new URL('../supabase/migrations/',import.meta.url);
  for (const file of readdirSync(dir).filter(f=>f.endsWith('.sql')&&f!==migration).sort()) sql(readFileSync(new URL(file,dir),'utf8'));
  const state = {...createDefaultWorkspace(), sourceCollections: []};
  for (const id of ['synthetic-owner-a','synthetic-owner-b','synthetic-provider-a']) {
   sql(`insert into reader_workspaces(user_id,state)values('${id}',${q(state)});
    insert into reader_collection_policies(user_id)values('${id}');
    insert into reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values('${id}','synthetic-update','synthetic-source','synthetic-collection','2026-11-01T00:00:00Z',${q({id:'synthetic-update',sourceId:'synthetic-source',publishedAt:'2026-11-01T00:00:00Z',isSample:false})});
    insert into daily_briefings(reader_id,local_date,period_start,cutoff_at,status,snapshot,workspace_revision,generation)select '${id}','2026-11-01','2026-10-31','2026-11-01','quiet','{}',updated_at,gen_random_uuid()from reader_workspaces where user_id='${id}';`);
  }
  sql(`insert into collection_jobs(user_id,source_id,source_name,source_url,platform,provider,status)values('synthetic-owner-a','synthetic-source','Synthetic','https://synthetic.example','Blog','feed','requested');
   insert into collection_job_consumers(job_id,user_id)select id,user_id from collection_jobs;
   insert into reader_collection_checks(user_id,source_id,source_name,source_url,platform)values('synthetic-owner-a','synthetic-source','Synthetic','https://synthetic.example','Blog');
   insert into admin_audit_events(admin_id,action)values('synthetic-historical-admin','synthetic.original');
   insert into collection_budget_reservations(request_key,kind,maximum_usd,provider,actor_id,launch_attempted_at)values('synthetic-old-hold','job',.005,'apify','synthetic-actor','2020-01-01');
   insert into reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state)values('synthetic-owner-a','synthetic-unknown-model',gen_random_uuid(),'synthetic/model',repeat('a',64),.01,'unknown');`);
  sql(`create function public.synthetic_snapshot() returns jsonb language plpgsql stable set search_path=''as $$
   declare t record; result jsonb:='{}'; rows jsonb;
   begin
    for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'synthetic_%' loop
     execute format($query$select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)from public.%I t$query$,t.relname)into rows;
     result:=result||jsonb_build_object(t.relname,rows);
    end loop;return result;
   end$$;`);
  before = snapshot(); sql(readFileSync(new URL(migration,dir),'utf8'));
  initialConfig=sql("select mode||':'||lifecycle_ready||':'||(select count(*)from recap_internal.reader_identity_issuers)||':'||(select count(*)from recap_internal.reader_identity_aliases) from recap_internal.reader_identity_settings;");
  originalGuard=sql("select pg_get_functiondef('recap_internal.reader_identity_allowed(text,text,text)'::regprocedure);");
  lifecycleInstalled=sql("select to_regclass('recap_internal.account_deletions') is not null;")==='t';
  // Mapping-only unit seam. Real deletion/barrier coverage lives in the separate
  // PR17 migration matrix and never uses this allow-all/no-op fixture.
  sql(`create function public.synthetic_allow_identity() returns void language plpgsql as $fn$begin
   if to_regclass('recap_internal.account_deletions') is not null then return;end if;
   execute $body$create or replace function recap_internal.reader_identity_allowed(p_owner_id text,p_issuer text,p_subject text) returns boolean language sql volatile security definer set search_path=''as 'select true'$body$;
   if to_regprocedure('recap_internal.lock_account_writer(text)') is null then
    execute $body$create function recap_internal.lock_account_writer(p_user_id text) returns void language sql set search_path=''as 'select null::void'$body$;
   end if;
  end$fn$;`);
 },30000);
 beforeEach(() => {
  sql('truncate recap_internal.reader_identity_aliases,recap_internal.reader_identity_events;');
  configure('legacy',false);
  sql(originalGuard);
 });
 afterAll(() => { if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'}); if(root)rmSync(root,{recursive:true,force:true}); });
 const linked = () => { sql('select public.synthetic_allow_identity();'); configure(); service(bind()); };
 it('preserves complete original workspace/archive/job/audit/held-money/model rows and starts in legacy mode', () => {
  expect(initialConfig).toBe('legacy:false:0:0');expect(snapshot()).toBe(before); expect(owner()).toBe('synthetic-provider-a');
  expect(sql('select mode||\':\'||lifecycle_ready from recap_internal.reader_identity_settings;')).toBe('legacy:false');
 });
 it('keeps legacy subject compatibility with missing/untrusted issuer and no aliases', () => {
  expect(owner('synthetic-owner-a',null)).toBe('synthetic-owner-a');
  expect(owner('synthetic-owner-a','https://untrusted.example')).toBe('synthetic-owner-a');
  expect(reader('select user_id from reader_workspaces;', 'synthetic-owner-a',null)).toBe('synthetic-owner-a');
 });
 it('fails linked access closed before readiness and without the installed lifecycle contract', () => {
  configure('linked',false); expect(owner()).toBe('');
  configure(); expect(owner()).toBe(''); if(!lifecycleInstalled)expect(()=>service(bind())).toThrow(/PT403/);
 });
 it('denies a null lifecycle decision instead of treating unknown as permission', () => {
  linked();sql(`create or replace function recap_internal.reader_identity_allowed(p_owner_id text,p_issuer text,p_subject text)returns boolean language sql volatile security definer set search_path=''as $$select null::boolean$$;`);
  expect(()=>service(bind())).toThrow(/PT403/);expect(owner()).toBe('');
 });
 it('resolves an explicit alias to the old key while leaving the actual subject separate', () => {
  linked(); expect(owner()).toBe('synthetic-owner-a');
  expect(reader("select auth.jwt()->>'sub';")).toBe('synthetic-provider-a');
  expect(reader('select user_id from reader_workspaces;')).toBe('synthetic-owner-a');
  expect(reader('select user_id from reader_source_updates;')).toBe('synthetic-owner-a');
  expect(reader('select reader_id from daily_briefings;')).toBe('synthetic-owner-a');
  expect(snapshot()).toBe(before);
 });
 it('does not fall back to a matching historical subject or client metadata in linked mode', () => {
  sql('select public.synthetic_allow_identity();'); configure();
  expect(owner()).toBe(''); expect(reader('select count(*) from reader_workspaces;')).toBe('0');
  expect(()=>reader(`insert into reader_workspaces(user_id,state)select 'synthetic-provider-a',${q(createDefaultWorkspace())};`)).toThrow(/42501/);
  expect(owner('synthetic-owner-a')).toBe('');
 });
 it('separates same-subject issuers and demands an exact trusted issuer', () => {
  linked(); service(bind('synthetic-provider-a','synthetic-owner-b',issuerB));
  expect(owner('synthetic-provider-a',issuerB)).toBe('synthetic-owner-b');
  for(const issuer of [null,'https://untrusted.example',issuerA+'/'])expect(owner('synthetic-provider-a',issuer)).toBe('');
  expect(()=>service(bind('synthetic-provider-b','synthetic-owner-a','https://untrusted.example'))).toThrow(/PT403/);
 });
 it('retains all eleven policy predicates, denies cross-owner updates/reassignment and keeps clear revision checks', () => {
  linked();
  expect(sql("select count(*)from pg_policies where schemaname='public' and (qual like '%current_reader_owner%' or with_check like '%current_reader_owner%');")).toBe('11');
  expect(sql("select count(*)from pg_policies where coalesce(qual,'') like '%auth.jwt()%'or coalesce(with_check,'')like '%auth.jwt()%';")).toBe('0');
  expect(reader('select user_id from collection_jobs;')).toBe('synthetic-owner-a');
  expect(reader('select user_id from collection_job_consumers;')).toBe('synthetic-owner-a');
  expect(reader('select user_id from reader_collection_policies;')).toBe('synthetic-owner-a');
  expect(reader('select user_id from reader_collection_checks;')).toBe('synthetic-owner-a');
  expect(reader("update reader_workspaces set state=state where user_id='synthetic-owner-b' returning user_id;")).toBe('');
  expect(()=>reader("update reader_workspaces set user_id='synthetic-owner-b' where user_id='synthetic-owner-a';")).toThrow(/42501/);
  expect(()=>reader("select clear_reader_workspace('2020-01-01',null);")).toThrow(/PT409/);
  expect(snapshot()).toBe(before);
 });
 it('clears only the resolved owner, retaining existing daily tombstones and another reader history', () => {
  linked();
  const result=reader(`begin; select public.clear_reader_workspace((select updated_at from reader_workspaces),${q({...createDefaultWorkspace(),sourceCollections:[]})});
   select count(*)from reader_source_updates; select count(*)from daily_briefings; rollback;`);
  expect(result).toContain('updatedAt'); expect(result.split('\n').slice(-2)).toEqual(['0','0']);
  expect(snapshot()).toBe(before);
 });
 it('denies anonymous/reader linkage, configuration, arbitrary resolution, reverse lookup and private tables', () => {
  for(const role of ['anon','authenticated']) {
   for(const query of [bind(),`select public.review_reader_identity_configuration('linked',true,array['${issuerA}'],'synthetic','synthetic');`,
    `select * from public.resolve_reader_owners('${issuerA}',array['synthetic-provider-a']);`,
    `select public.reader_provider_subject('synthetic-owner-a','${issuerA}');`,
    `select * from recap_internal.reader_identity_aliases;`,`select * from recap_internal.reader_identity_settings;`,`select * from recap_internal.reader_identity_events;`])
    expect(()=>sql(`set role ${role};${query}`)).toThrow(/42501/);
  }
  expect(()=>sql('set role anon;select public.current_reader_owner();')).toThrow(/42501/);
  expect(sql("select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname in('current_reader_owner','resolve_reader_owners','reader_provider_subject','bind_reader_identity_alias','review_reader_identity_configuration','revoke_reader_identity_alias');")).toBe('0');
 });
 it('requires reviewed evidence and an existing workspace, and prevents direct service-role alias rewrites', () => {
  linked(); expect(()=>service(bind('synthetic-extra','missing-owner'))).toThrow(/PT409/);
  expect(()=>service(`select public.bind_reader_identity_alias('${issuerA}','synthetic-extra','synthetic-owner-a','synthetic','');`)).toThrow(/PT400/);
  expect(()=>service("update recap_internal.reader_identity_aliases set owner_id='synthetic-owner-b';")).toThrow(/42501/);
  expect(()=>service('delete from recap_internal.reader_identity_events;')).toThrow(/42501/);
  expect(sql("select count(*)from recap_internal.reader_identity_events where action='alias.bound';")).toBe('1');
 });
 it('audits revocation and cannot resurrect or reassign a revoked alias', () => {
  linked();service(`select public.revoke_reader_identity_alias('${issuerA}','synthetic-provider-a','synthetic','synthetic-revoke');`);
  expect(owner()).toBe('');expect(()=>service(bind())).toThrow(/PT409/);
  expect(service(`select public.reader_provider_subject('synthetic-owner-a','${issuerA}');`)).toBe('');
  expect(sql("select count(*)from recap_internal.reader_identity_events where action='alias.revoked';")).toBe('1');
 });
 it('fails reverse lookup closed when more than one active provider subject could receive a reminder', () => {
  linked();expect(service(`select public.reader_provider_subject('synthetic-owner-a','${issuerA}');`)).toBe('synthetic-provider-a');
  service(bind('synthetic-second-alias'));expect(service(`select public.reader_provider_subject('synthetic-owner-a','${issuerA}');`)).toBe('');
 });
 const asyncSql = (query:string) => new Promise<{code:number|null;out:string;err:string}>(resolve=>{
  const child=spawn('psql',args);let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('close',code=>resolve({code,out:out.trim(),err}));child.stdin.end('set role service_role; '+query);
 });
 it('serializes identical duplicate binds and competing-owner races without alias reassignment', async () => {
  sql('select public.synthetic_allow_identity();');configure();
  const same=await Promise.all([asyncSql(bind()),asyncSql(bind())]);expect(same.map(r=>r.code)).toEqual([0,0]);
  const race=await Promise.all([asyncSql(bind('synthetic-race','synthetic-owner-a')),asyncSql(bind('synthetic-race','synthetic-owner-b'))]);
  expect(race.filter(r=>r.code===0)).toHaveLength(1);expect(race.find(r=>r.code!==0)?.err).toMatch(/PT409/);
  expect(sql("select count(*)from recap_internal.reader_identity_aliases where subject='synthetic-race';")).toBe('1');
 });
});
