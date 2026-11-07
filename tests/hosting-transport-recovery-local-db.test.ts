import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const available = ['initdb','pg_ctl','psql'].every(bin => { try { execFileSync(bin,['--version'],{stdio:'ignore'}); return true; } catch { return false; } });
const q = (value: string) => "'" + value.replaceAll("'", "''") + "'", j = (value: unknown) => q(JSON.stringify(value)) + '::jsonb';
const release = 'a'.repeat(40), key = (n: number) => 'cron:automatic-content:3:' + n;
describe.skipIf(!available)('hosting transport recovery, disposable full-schema PostgreSQL', () => {
 let root = '', started = false, args: string[] = [];
 const sql = (query: string) => execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service = (query: string) => sql('set role service_role;' + query);
 const json = (query: string) => JSON.parse(service(query) || 'null');
 const revision = () => sql('select release_revision from hosting_runtime_control;');
 const frame = (n = 1) => JSON.parse(sql(`select to_jsonb(w) from hosting_work w where key=${q(key(n))};`));
 const domain = () => json('select read_automatic_hosting_domain_evidence();');
 const admit = (n: number) => service(`select admit_hosting_work(${q(key(n))},'automatic-content',3,${q(release)});`);
 const claimQuery = (n: number, message = 'native-' + n) => `select begin_automatic_hosting_queue_work(${q(key(n))},3,${q(release)},${q(message)});`;
 const claim = (n: number, message?: string) => json(claimQuery(n,message));
 const pause = () => {
  const next = randomUUID(); service(`select pause_hosting_transport_checked(3,${q(release)},${q(revision())},${q(next)});`); return next;
 };
 function native(n = 1) {
  return { worker:'therecap-jobs',release,worker_version:randomUUID(),queue:'therecap-jobs',queue_id:'1'.repeat(32),receipt_hash:'b'.repeat(64),
   schedules_absent:true,consumers_absent:true,deployment_workflows_drained:true,max_wall_ms:900000,
   delivery_stopped_at:new Date(Date.now()-18*60_000).toISOString(),observed_at:new Date(Date.now()-1000).toISOString(),message_id:'native-'+n,
   message:{version:1,kind:'automatic-content',epoch:3,release,key:key(n)}};
 }
 const recoverQuery = (expected: unknown, proof: unknown, evidence: unknown, id = randomUUID(), rev = revision()) => `select recover_automatic_hosting_frame_checked(3,${q(release)},${q(rev)},${j(expected)},${q(id)},${j(proof)},${j(evidence)});`;
 function legacy(n = 1, state = 'running') {
  sql(`insert into hosting_work(key,kind,epoch,release,state,lease_token,lease_until,created_at,updated_at)
   values(${q(key(n))},'automatic-content',3,${q(release)},${q(state)},${state==='running'?'gen_random_uuid()':'null'},${state==='running'?"clock_timestamp()-interval '40 minutes'":'null'},clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour');`);
 }
 // Simulate passage of time in disposable fixtures only, preserving the real
 // immutable triggers outside this explicit owner-only test setup.
 function age(n: number) {
  sql(`update hosting_work set created_at=created_at-interval '1 hour',updated_at=updated_at-interval '1 hour',lease_until=lease_until-interval '1 hour' where key=${q(key(n))};
   alter table hosting_queue_invocations disable trigger hosting_invocation_immutable;
   update hosting_queue_invocations set frame=(select to_jsonb(w) from hosting_work w where key=${q(key(n))}),recorded_at=recorded_at-interval '1 hour',not_after=not_after-interval '1 hour' where key=${q(key(n))};
   alter table hosting_queue_invocations enable trigger hosting_invocation_immutable;`);
 }
 beforeAll(() => {
  root=mkdtempSync('/tmp/recap-transport-'); mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55625`,'start'],{stdio:'ignore'}); started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55625','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort()) sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(() => {
  sql(`truncate hosting_work cascade;truncate reader_content_analysis_calls cascade;truncate automatic_content_tasks cascade;
   update hosting_runtime_control set owner='cloudflare',epoch=3,release=${q(release)},paused=false,old_host_fenced=true;`);
 });
 afterAll(() => { if(started) execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'}); if(root) rmSync(root,{recursive:true,force:true}); });
 it('preserves the exact original legacy frame and unknown financial hold; never declares completion', () => {
  legacy(); const original=frame();
  sql(`insert into reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state) values('fixture','held',gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',repeat('c',64),.09,'unknown');`);
  const before=domain(); pause(); const proof=native(), id=randomUUID(), query=recoverQuery(original,proof,before,id);
  const result=json(query); expect(result.disposition).toBe('expired_outcome_unknown'); expect(result.original_frame).toEqual(original);
  expect(frame()).toEqual({...original,state:'uncertain',updated_at:frame().updated_at}); expect(domain()).toEqual(before);
  expect(domain()).toMatchObject({unknown_calls:1,commitment_usd:.09}); expect(json(query)).toEqual(result);
  expect(() => service(`select finish_hosting_work(${q(key(1))},${q(original.lease_token)},3,true);`)).toThrow();
  expect(() => service(`delete from hosting_transport_dispositions;`)).toThrow();
  expect(() => sql(`update hosting_transport_dispositions set disposition='superseded_unstarted';`)).toThrow();
 });
 it('supersedes only exact unstarted automatic cron frames; normal release can then pause without draining them by replay', () => {
  legacy(1,'queued'); const original=frame();
  expect(() => service(`select quiesce_hosting_release(3,${q(release)});`)).toThrow();
  pause(); const proof: Record<string,unknown>=native(); delete proof.message_id; proof.message_status='not_observed';
  const out=json(recoverQuery(original,proof,domain())); expect(out.disposition).toBe('superseded_unstarted');
  const status=json('select read_hosting_release_status();'); expect(status.work).toMatchObject({queued:0,running:0,uncertain:1});
  expect(json(`select advance_hosting_release_checked(3,${q(release)},${q(revision())},${q('b'.repeat(40))},false,${q(randomUUID())});`).control.release).toBe('b'.repeat(40));
 });
 it.each(['epoch','release','revision','paused','owner','fence','lease','updated_at'])('rejects recovery after changed %s', field => {
  legacy(); const original=frame(); pause(); const query=recoverQuery(original,native(),domain());
  const mutations: Record<string,string>={epoch:'update hosting_runtime_control set epoch=4',release:`update hosting_runtime_control set release=${q('b'.repeat(40))}`,revision:'update hosting_runtime_control set paused=true',paused:'update hosting_runtime_control set paused=false',owner:"update hosting_runtime_control set owner='netlify'",fence:'update hosting_runtime_control set old_host_fenced=false',lease:`update hosting_work set lease_token=gen_random_uuid()`,updated_at:'update hosting_work set updated_at=clock_timestamp()'};
  sql(mutations[field]); expect(() => service(query)).toThrow(); expect(sql('select count(*) from hosting_transport_dispositions;')).toBe('0');
 });
 it.each(['max_wall_ms','delivery_stopped_at','observed_at','message','queue','receipt_hash','consumers_absent','schedules_absent','deployment_workflows_drained','worker_version','message_id'])('rejects missing or unsafe native %s evidence', field => {
  legacy(); pause(); const proof: Record<string,unknown>=native();
  if(field==='delivery_stopped_at') proof[field]=new Date(Date.now()-60_000).toISOString();
  else if(field==='message') proof[field]={...(proof.message as object),key:key(99)};
  else delete proof[field];
  expect(() => service(recoverQuery(frame(),proof,domain()))).toThrow(); expect(frame().state).toBe('running');
 });
 it('rejects stale domain/financial evidence and preserves the new hold', () => {
  legacy(); pause(); const expected=domain();
  sql(`insert into reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state) values('fixture','late-held',gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',repeat('c',64),.01,'unknown');`);
  expect(() => service(recoverQuery(frame(),native(),expected))).toThrow(); expect(domain().unknown_calls).toBe(1);
 });
 it('requires paused/fenced control and fresh native evidence even for an expired legacy lease', () => {
  legacy(); expect(() => service(recoverQuery(frame(),native(),domain()))).toThrow();
  pause(); const proof=native(); proof.observed_at=new Date(Date.now()-3*60_000).toISOString();
  expect(() => service(recoverQuery(frame(),proof,domain()))).toThrow();
 });
 it('recovers future bound frames once and admits the next tick without touching task/model evidence', () => {
  admit(1); claim(1); age(1); const original=frame(), before=domain(); admit(2);
  expect(claim(2).token).toMatch(/[a-f0-9-]{36}/); expect(frame().state).toBe('uncertain');
  const audit=json('select to_jsonb(d) from hosting_transport_dispositions d;');
  expect(audit.original_frame).toEqual(original); expect(audit.native_evidence.mode).toBe('recorded_invocation_bound');
  expect(domain()).toEqual(before); expect(claim(1)).toBeNull(); expect(claim(2)).toBeNull();
  expect(sql('select count(*) from hosting_transport_dispositions;')).toBe('1');
 });
 it('coalesces busy ticks durably instead of creating retries or claiming paid work', () => {
  admit(1); claim(1); admit(2); const original=frame(2);
  expect(claim(2)).toEqual({superseded:true,recovery_required:false});
  expect(json(`select original_frame from hosting_transport_dispositions where key=${q(key(2))};`)).toEqual(original);
  expect(frame().state).toBe('running'); expect(frame(2).state).toBe('uncertain'); expect(claim(2)).toBeNull();
 });
 it.each(['lease','control','valid'])('binds completion to the exact invocation and marks %s replies truthfully', mode => {
  admit(1); const claimed=claim(1);
  if(mode==='lease') age(1);
  if(mode==='control') sql('update hosting_runtime_control set paused=true;');
  const finish=(message='native-1')=>`select finish_automatic_hosting_queue_work(${q(key(1))},${q(claimed.token)},3,${q(release)},${q(message)},true);`;
  expect(()=>service(finish('other-message'))).toThrow(); expect(frame().state).toBe('running');
  service(finish()); expect(frame().state).toBe(mode==='valid'?'completed':'uncertain');
  expect(()=>service(finish())).toThrow();
 });
 it('reconciles simultaneous same-ID lost replies once and rejects replay after an intervening frame/control change', async () => {
  legacy(); pause(); const id=randomUUID(),query=recoverQuery(frame(),native(),domain(),id);
  const run=()=>new Promise<string>((resolve,reject)=>execFile('psql',args,{encoding:'utf8'},(error,out)=>error?reject(error):resolve(out.trim())).stdin!.end('set role service_role;'+query));
  const replies=await Promise.all([run(),run()]); expect(JSON.parse(replies[0])).toEqual(JSON.parse(replies[1]));
  expect(sql('select count(*) from hosting_transport_dispositions;')).toBe('1');
  sql('update hosting_work set updated_at=clock_timestamp();'); expect(()=>service(query)).toThrow();
  sql('update hosting_runtime_control set paused=true;'); expect(()=>service(query)).toThrow();
 });
 it('does not infer legacy native bounds or reuse a bound after control revision/lease changed', () => {
  for(const mutation of ['legacy','revision','lease']) {
   sql('truncate hosting_work cascade;');
   if(mutation==='legacy') legacy(); else {admit(1); claim(1); age(1);}
   if(mutation==='revision') sql('update hosting_runtime_control set paused=false;');
   if(mutation==='lease') sql('update hosting_work set lease_token=gen_random_uuid();');
   admit(2); expect(claim(2).superseded).toBe(true); expect(frame().state).toBe('running');
  }
 });
 it('rejects queue identity conflicts/missing native ID and does not bind another frame', () => {
  admit(1); expect(() => claim(1,'')).toThrow(); expect(() => service(claimQuery(1).replace("'native-1'",'null'))).toThrow();
  expect(() => service(claimQuery(1).replace(',3,',',4,'))).toThrow();
  expect(() => service(claimQuery(1).replace(q(release),q('b'.repeat(40))))).toThrow();
  sql(`update hosting_work set kind='keyword-learning' where key=${q(key(1))};`); expect(() => claim(1)).toThrow();
  expect(sql('select count(*) from hosting_queue_invocations;')).toBe('0');
 });
 it('serializes concurrent recovery: one immutable disposition wins, the other fails CAS', async () => {
  legacy(); pause(); const original=frame(), proof=native(), evidence=domain();
  const queries=[recoverQuery(original,proof,evidence),recoverQuery(original,proof,evidence)];
  const run=(query:string)=>new Promise<{error:unknown;out:string}>((resolve)=>execFile('psql',args,{encoding:'utf8'},(error,out)=>resolve({error,out})).stdin!.end('set role service_role;'+query));
  const results=await Promise.all(queries.map(run)); expect(results.filter(r=>!r.error)).toHaveLength(1);
  expect(sql('select count(*) from hosting_transport_dispositions;')).toBe('1'); expect(frame().state).toBe('uncertain');
 });
 it('waits for concurrent domain writers then rejects their changed evidence', async () => {
  legacy(); pause(); const query=recoverQuery(frame(),native(),domain());
  const writer=spawn('psql',args,{stdio:['pipe','pipe','pipe']}); const done=new Promise(resolve=>writer.on('exit',resolve));
  await new Promise<void>(resolve=>{writer.stdout.on('data',chunk=>{if(String(chunk).includes('writer-ready')) resolve();}); writer.stdin.write(`begin;insert into reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state) values('fixture','racing-hold',gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',repeat('c',64),.01,'unknown');select 'writer-ready';\n`);});
  const recoverer=spawn('psql',args,{env:{...process.env,PGAPPNAME:'recap-transport-recovery-fixture'},stdio:['pipe','pipe','pipe']}); const recovered=new Promise(resolve=>recoverer.on('exit',resolve));
  let error=''; recoverer.stderr.on('data',chunk=>error+=String(chunk)); recoverer.stdin.end('set role service_role;'+query);
  try {
   let waiting=false;
   for(let i=0;i<30;i++){waiting=sql("select exists(select 1 from pg_stat_activity where application_name='recap-transport-recovery-fixture' and wait_event_type='Lock');")==='t'; if(waiting) break; await new Promise(resolve=>setTimeout(resolve,10));}
   expect(waiting).toBe(true);
  } finally {writer.stdin.end('commit;\n');}
  expect(await done).toBe(0); expect(await recovered).not.toBe(0); expect(error).toContain('domain evidence changed');
  expect(frame().state).toBe('running'); expect(domain().unknown_calls).toBe(1);
 });
 it('keeps public execution/table access and the internal helper denied', () => {
  for(const role of ['anon','authenticated']) {
   for(const signature of ['read_automatic_hosting_domain_evidence()','pause_hosting_transport_checked(bigint,text,uuid,uuid)','recover_automatic_hosting_frame_checked(bigint,text,uuid,jsonb,uuid,jsonb,jsonb)','begin_automatic_hosting_queue_work(text,bigint,text,text)','finish_automatic_hosting_queue_work(text,uuid,bigint,text,text,boolean)']) expect(sql(`select has_function_privilege(${q(role)},${q(signature)},'execute');`)).toBe('f');
   for(const table of ['hosting_queue_invocations','hosting_transport_dispositions']) expect(sql(`select has_table_privilege(${q(role)},${q(table)},'select');`)).toBe('f');
  }
  expect(sql("select has_function_privilege('service_role','disposition_automatic_hosting_frame(jsonb,uuid,jsonb,jsonb)','execute');")).toBe('f');
 });
});
