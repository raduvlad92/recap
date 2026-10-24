import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Reuses the existing analysis suites' disposable-cluster harness pattern.
// Private Unix socket, TCP disabled, no Supabase links/env/credentials read.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const models = ['deepseek/deepseek-v4.1-flash-1017', 'minimax/minimax-m3.1-flash', 'openai/gpt-6-luna-pro', 'openai/gpt-6.1-sol-pro'];
type Settings = { selected_model: string; revision: number; updated_at: string };
class Session {
 private child: ChildProcessWithoutNullStreams;
 private output = ''; private errors = ''; private sequence = 0;
 private pending?: { marker: string; resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
 constructor(args: string[]) {
  this.child = spawn('psql', args, { stdio: 'pipe' });
  this.child.stdout.on('data', chunk => {
   this.output += String(chunk);
   if (this.pending && this.output.includes(this.pending.marker + '\n')) {
    const pending = this.pending, end = this.output.indexOf(pending.marker + '\n'); this.pending = undefined;
    const value = this.output.slice(0, end).trim(); this.output = this.output.slice(end + pending.marker.length + 1);
    clearTimeout(pending.timer); pending.resolve(value);
   }
  });
  this.child.stderr.on('data', chunk => { this.errors += String(chunk); });
  const fail = (error: Error) => {
   if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
  };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error(`Local psql exited ${code}: ${this.errors}`)));
 }
 run(query: string): Promise<string> {
  if (this.pending) throw new Error('One outstanding command per local session');
  return new Promise((resolve, reject) => {
   const marker = `analysis_settings_command_${++this.sequence}_done`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local SQL session timeout: ' + this.errors)); }, 8000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(query + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); this.child.kill('SIGTERM'); }
}

describe.skipIf(!available)('actual disposable PostgreSQL analysis model settings', () => {
 let root: string, args: string[], started = false, sequence = 0, beforeMigrationPolicies: string, beforeMigrationState: string;
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 const settings = (): Settings => JSON.parse(service('select to_jsonb(s) from public.content_analysis_runtime_settings s;'));
 const choose = (model: string, revision = settings().revision) => `select public.admin_set_analysis_model('synthetic-settings-admin',${quote(model)},${revision});`;
 const policiesWithoutModel = () => service("select jsonb_agg(to_jsonb(p)-'model' order by p.user_id) from public.reader_content_analysis_policies p;");
 const snapshot = (tables = ['content_analysis_runtime_settings', 'reader_content_analysis_policies', 'admin_audit_events', 'content_analysis_budget', 'reader_content_analysis_jobs', 'reader_content_analysis_calls', 'collection_plans']) => service(`select jsonb_build_object(${tables.map(table => `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`).join(',')});`);

 // Uses only original D35 RPCs: the selector contract does not depend on the
 // newer execution-identity RPC's evolving request payload or pricing schema.
 function runningFixture(owner: string) {
  const source = 'analysis-settings-source';
  const state = { version: 1, followedSourceIds: [source], customSources: [{ id: source, name: 'Synthetic local source', url: 'https://example.org/channel', platform: 'YouTube', status: 'ready', creatorIds: [] }], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {} };
  const record = { id: 'fixture-video', sourceId: source, publishedAt: '2026-10-24T00:00:00Z', url: 'https://example.org/video', title: 'Synthetic local analysis', isSample: false, format: 'video', contentKind: 'transcript', content: 'Synthetic saved words for database-only analysis tests.', videoFormat: { kind: 'regular', basis: 'watch_page' }, topics: [], brands: [] };
  service(`insert into public.reader_workspaces(user_id,state) values(${quote(owner)},${quote(JSON.stringify(state))});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    values(${quote(owner)},'fixture-video',${quote(source)},'synthetic','2026-10-24T00:00:00Z',${quote(JSON.stringify(record))});
   select public.sync_content_analysis_jobs(${quote(owner)},200);`);
  const claimed = JSON.parse(service(`select public.claim_content_analysis_job(${quote(owner)},900);`));
  return { id: claimed.job.id as string, token: claimed.leaseToken as string, owner };
 }
 const reserve = (fixture: ReturnType<typeof runningFixture>, model: string) => `select public.reserve_content_analysis_call('${fixture.id}','${fixture.token}','summary:0',0.005,${quote(model)});`;

 beforeAll(() => {
  // macOS Unix socket paths have a short length limit; keep the prefix small.
  root = mkdtempSync(join(tmpdir(), 'recap-as-db-'));
  const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  try {
   execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55497`, 'start'], { stdio: 'ignore' }); started = true;
  } catch (error) { throw new Error('Disposable PostgreSQL start failed: ' + readFileSync(join(root, 'postgres.log'), 'utf8'), { cause: error }); }
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55497', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  expect(migrations.filter(name => name.endsWith('_content_analysis_runtime_settings.sql'))).toHaveLength(1);
  for (const name of migrations) {
   if (name.endsWith('_content_analysis_runtime_settings.sql')) {
    // Fixtures BEFORE this migration prove backfill preserves live operator
    // fields, a running job and an unresolved financial hold, rather than
    // merely proving behavior on an initially empty policy table.
    service(`insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model,last_served_at,updated_at) values
     ('analysis-settings-a-existing',true,0.123456789012,0.234567890123,0.01,'old-fixture-model','2026-10-20T01:02:03Z','2026-10-21T02:03:04Z'),
     ('analysis-settings-z-existing',false,0.2,0.4,0.02,'other-fixture-model','2026-10-19T03:04:05Z','2026-10-22T04:05:06Z');
     insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,true,1,2);`);
    const fixture = runningFixture('analysis-settings-a-existing');
    const reserved = JSON.parse(service(reserve(fixture, 'old-fixture-model')));
    service(`select public.settle_content_analysis_call('${reserved.call.id}',null,null);
     update public.content_analysis_budget set enabled=false;`);
    beforeMigrationPolicies = policiesWithoutModel();
    beforeMigrationState = snapshot(['content_analysis_budget', 'reader_content_analysis_jobs', 'reader_content_analysis_calls', 'collection_plans', 'admin_audit_events']);
   }
   sql(readFileSync(new URL(name, directory), 'utf8'));
  }
 }, 20000);
 afterAll(() => {
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });

 it('backfills both enabled/disabled policies to DeepSeek, preserves all other fields, active jobs, unknown holds, gates and schedules', () => {
  expect(policiesWithoutModel()).toBe(beforeMigrationPolicies);
  expect(JSON.parse(service('select jsonb_agg(distinct model) from public.reader_content_analysis_policies;'))).toEqual([models[0]]);
  expect(snapshot(['content_analysis_budget', 'reader_content_analysis_jobs', 'reader_content_analysis_calls', 'collection_plans', 'admin_audit_events'])).toBe(beforeMigrationState);
  expect(settings()).toMatchObject({ selected_model: models[0], revision: 1, updated_by: null });
 });
 it('passes rollback-only defaults, constraints, ACLs, invoker, all-model CAS, validation, audit and policy-preservation SQL', () => {
  const before = snapshot();
  expect(sql(readFileSync(new URL('./analysis-settings-db.sql', import.meta.url), 'utf8'))).toBe('');
  expect(snapshot()).toBe(before);
 });
 it.each(['anon', 'authenticated'])('denies %s actual table CRUD and RPC calls', role => {
  for (const query of [
   'select * from public.content_analysis_runtime_settings;',
   'insert into public.content_analysis_runtime_settings default values;',
   `update public.content_analysis_runtime_settings set selected_model=${quote(models[1])};`,
   'delete from public.content_analysis_runtime_settings;',
  ]) expect(() => sql(`set role ${role}; ${query}`)).toThrow(/42501.*permission denied for table content_analysis_runtime_settings/s);
  expect(() => sql(`set role ${role}; ${choose(models[1], 1)}`)).toThrow(/42501.*permission denied for function admin_set_analysis_model/s);
 });
 it('rolls back settings, every policy and audit when audit storage fails, with a safe error', () => {
  const before = snapshot();
  sql(`create function public.reject_analysis_settings_audit_fixture() returns trigger language plpgsql as $$ begin
   if new.action='analysis.model.updated' then raise exception 'Synthetic private storage diagnostic'; end if; return new; end; $$;
   create trigger reject_analysis_settings_audit_fixture before insert on public.admin_audit_events
    for each row execute function public.reject_analysis_settings_audit_fixture();`);
  try {
   let message = '';
   try { service(choose(models[1])); } catch (error) { message = String(error); }
   expect(message).toMatch(/PT503.*Audit unavailable; analysis model not saved/s);
   expect(message).not.toContain('Synthetic private storage diagnostic');
   expect(snapshot()).toBe(before);
  } finally {
   sql('drop trigger reject_analysis_settings_audit_fixture on public.admin_audit_events; drop function public.reject_analysis_settings_audit_fixture();');
  }
 });

 async function waitForLock(application: string) {
  const deadline = Date.now() + 4000;
  while (sql(`select count(*) from pg_stat_activity where application_name=${quote(application)} and wait_event_type='Lock';`) === '0') {
   if (Date.now() > deadline) throw new Error('Concurrent local SQL session never waited for a lock: ' + application);
   await new Promise(resolve => setTimeout(resolve, 10));
  }
 }
 it('serializes two actual saves with one revision, one audit and PT409 for the losing session', async () => {
  const initial = settings(), beforePolicies = policiesWithoutModel();
  const auditCount = Number(service("select count(*) from public.admin_audit_events where action='analysis.model.updated';"));
  const first = new Session(args), second = new Session(args);
  try {
   await first.run("begin; set local role service_role; set local statement_timeout='5s';");
   const saved = JSON.parse(await first.run(choose(models[1], initial.revision)));
   const losing = second.run(`set role service_role; set application_name='analysis-settings-cas-loser'; set statement_timeout='5s'; ${choose(models[2], initial.revision)}`)
    .then(value => ({ value, error: '' }), error => ({ value: '', error: String(error) }));
   await waitForLock('analysis-settings-cas-loser');
   expect(settings()).toMatchObject(initial);
   await first.run('commit;');
   expect((await losing).error).toMatch(/PT409.*Analysis settings changed; reload before saving/s);
   expect(saved).toMatchObject({ selected_model: models[1], revision: initial.revision + 1 });
   expect(settings()).toMatchObject(saved);
   expect(policiesWithoutModel()).toBe(beforePolicies);
   expect(Number(service("select count(*) from public.admin_audit_events where action='analysis.model.updated';"))).toBe(auditCount + 1);
  } finally { first.close(); second.close(); }
 });
 it('rejects a stale save before waiting for a locked policy or changing data', async () => {
  const holder = new Session(args), initial = settings(), before = snapshot();
  try {
   await holder.run("begin; select user_id from public.reader_content_analysis_policies where user_id='analysis-settings-a-existing' for update;");
   expect(() => service(`set lock_timeout='300ms'; ${choose(models[2], initial.revision - 1)}`)).toThrow(/PT409.*Analysis settings changed; reload before saving/s);
   expect(snapshot()).toBe(before);
   await holder.run('rollback;');
  } finally { holder.close(); }
 });
 it('locks policies in user-id order and completes after a later policy is released', async () => {
  const holder = new Session(args), selector = new Session(args), initial = settings();
  const beforePolicies = policiesWithoutModel();
  try {
   await holder.run("begin; set local statement_timeout='5s'; select user_id from public.reader_content_analysis_policies where user_id='analysis-settings-z-existing' for update;");
   const selecting = selector.run(`set role service_role; set application_name='analysis-settings-lock-order'; set statement_timeout='5s'; ${choose(models[2], initial.revision)}`);
   // Handle rejection immediately even if a regression fails the wait/assert.
   const outcome = selecting.then(value => ({ value, error: '' }), error => ({ value: '', error: String(error) }));
   await waitForLock('analysis-settings-lock-order');
   expect(() => service("select user_id from public.reader_content_analysis_policies where user_id='analysis-settings-a-existing' for update nowait;")).toThrow(/55P03.*could not obtain lock/s);
   await holder.run('commit;');
   const result = await outcome;
   expect(result.error).toBe('');
   expect(JSON.parse(result.value)).toMatchObject({ selected_model: models[2], revision: initial.revision + 1 });
   expect(policiesWithoutModel()).toBe(beforePolicies);
  } finally { holder.close(); selector.close(); }
 });
 it('changes selection during a real running job without deadlocking settlement or rewriting its execution model', async () => {
  const initial = settings(), owner = 'analysis-settings-live-' + ++sequence;
  service(`update public.content_analysis_budget set enabled=true;
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)
    values(${quote(owner)},true,0.5,1,0.01,${quote(initial.selected_model)});`);
  const fixture = runningFixture(owner), worker = new Session(args), selector = new Session(args);
  const beforeJob = service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id='${fixture.id}';`);
  const beforePolicy = policiesWithoutModel(), beforeBudget = service('select to_jsonb(b) from public.content_analysis_budget b;');
  try {
   await worker.run("begin; set local deadlock_timeout='100ms'; set local role service_role; set local statement_timeout='5s';");
   const reserved = JSON.parse(await worker.run(reserve(fixture, initial.selected_model)));
   const selecting = selector.run(`set role service_role; set application_name='analysis-settings-active-worker'; set statement_timeout='5s'; ${choose(models[3], initial.revision)}`)
    .then(value => ({ value, error: '' }), error => ({ value: '', error: String(error) }));
   await waitForLock('analysis-settings-active-worker');
   // Worker owns budget -> policy -> call already. The waiting selector must
   // never ask for its budget lock and form a cycle with settlement.
   const settled = JSON.parse(await worker.run(`select public.settle_content_analysis_call('${reserved.call.id}',null,null);`));
   await worker.run('commit;');
   const selected = await selecting;
   expect(selected.error).toBe('');
   expect(JSON.parse(selected.value)).toMatchObject({ selected_model: models[3], revision: initial.revision + 1 });
   const persisted = JSON.parse(service(`select to_jsonb(c) from public.reader_content_analysis_calls c where id='${reserved.call.id}';`));
   expect(persisted).toEqual(settled);
   expect(persisted.model).toBe(initial.selected_model);
   // Snapshot all columns, including any execution provenance added by newer
   // parent migrations, without manufacturing identity for a legacy hold.
   expect(service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id='${fixture.id}';`)).toBe(beforeJob);
   expect(policiesWithoutModel()).toBe(beforePolicy);
   expect(service('select to_jsonb(b) from public.content_analysis_budget b;')).toBe(beforeBudget);
   expect(service('select jsonb_agg(distinct model) from public.reader_content_analysis_policies;')).toBe(JSON.stringify([models[3]]));
  } finally {
   worker.close(); selector.close();
   service('update public.content_analysis_budget set enabled=false;');
  }
 });
});
