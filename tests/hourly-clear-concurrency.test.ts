import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Uses only a newly initialized socket-only local cluster. Never reads project
// credentials or connects to an existing PostgreSQL/Supabase database.
const localPostgresAvailable = (() => {
 try {
  for (const binary of ['initdb', 'pg_ctl', 'psql']) execFileSync(binary, ['--version'], { stdio: 'ignore' });
  if (!/\b17\./.test(execFileSync('initdb', ['--version'], { encoding: 'utf8' }))) return false;
  return typeof process.getuid !== 'function' || process.getuid() !== 0;
 } catch { return false; }
})();
const migrations = resolve('supabase/migrations');
const fixedMigration = '20261022235532_hourly_clear_lock_order.sql';
const historical = readFileSync(join(migrations, '20261021105734_atomic_reader_history_clear.sql'), 'utf8');
const oldClear = historical.slice(historical.indexOf('create function public.clear_reader_workspace'), historical.indexOf('revoke all on function public.clear_reader_workspace')).replace('create function', 'create or replace function');

class SqlSession {
 private child: ChildProcessWithoutNullStreams;
 private output = '';
 private errors = '';
 private count = 0;
 private pending?: { marker: string; resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
 private ended: Error | null = null;
 constructor(args: string[]) {
  this.child = spawn('psql', args, { stdio: 'pipe' });
  this.child.stdout.on('data', chunk => {
   this.output += String(chunk);
   if (this.pending && this.output.includes(this.pending.marker + '\n')) {
    const pending = this.pending, end = this.output.indexOf(pending.marker + '\n');
    const value = this.output.slice(0, end).trim(); this.output = this.output.slice(end + pending.marker.length + 1);
    clearTimeout(pending.timer); this.pending = undefined; pending.resolve(value);
   }
  });
  this.child.stderr.on('data', chunk => { this.errors += String(chunk); });
  const fail = (error: Error) => {
   this.ended = error;
   if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
  };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error(`Local psql session exited ${code}: ${this.errors}`)));
 }
 run(sql: string): Promise<string> {
  if (this.ended) return Promise.reject(this.ended);
  if (this.pending) throw new Error('Only one command may be outstanding per SQL session.');
  return new Promise((resolveCommand, reject) => {
   const marker = `hourly_command_${++this.count}_finished`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local concurrency test command timed out. ' + this.errors)); }, 12_000);
   this.pending = { marker, resolve: resolveCommand, reject, timer };
   this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); if (this.child.exitCode === null) this.child.kill('SIGTERM'); }
}

describe.skipIf(!localPostgresAvailable)('hourly clear/provider lock ordering on disposable PostgreSQL', () => {
 let root: string, args: string[], serverStarted = false, sequence = 0;
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recap-lock-test-'));
  const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore' });
  // A private socket directory avoids port collisions and forbids TCP access.
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55491`, 'start'], { stdio: 'ignore' });
  serverStarted = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55491', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql(readFileSync(join(migrations, file), 'utf8'));
  expect(sql('show server_version;')).toMatch(/^17\./);
  expect(readFileSync(join(migrations, fixedMigration), 'utf8').trim()).not.toBe('');
 }, 20_000);
 afterAll(() => {
  if (serverStarted) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });

 function fixture() {
  const userId = `hourly-lock-owner-${++sequence}`, sourceId = 'lock-test-channel';
  const state = { version: 1, followedSourceIds: [sourceId], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {}, customSources: [{ id: sourceId, name: 'Disposable channel', url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', platform: 'YouTube', status: 'ready', creatorIds: [] }] };
  sql(`insert into public.reader_collection_policies(user_id,enabled,provider_enabled) values('${userId}',true,true);
   insert into public.reader_workspaces(user_id,state) values('${userId}','${JSON.stringify(state)}');
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('${userId}','lock-test-archive','${sourceId}','hourly','2026-10-22T12:00:00Z','{"id":"lock-test-archive","sourceId":"${sourceId}","publishedAt":"2026-10-22T12:00:00Z","url":"https://www.youtube.com/watch?v=abcdefghijk","isSample":false,"contentKind":"metadata_only"}');`);
  const claim = JSON.parse(sql(`select public.claim_hourly_source('${userId}','${sourceId}');`)) as { checkId: string; leaseToken: string };
  const jobId = sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status) values('${userId}','${sourceId}','Disposable channel','https://www.youtube.com/watch?v=zzzzzzzzzzz','YouTube','apify','h7sDV53CddomktSi5','requested') returning id;`);
  const revision = sql(`select updated_at from public.reader_workspaces where user_id='${userId}';`);
  return { userId, sourceId, claim, jobId, revision };
 }
 async function scenario(requireStateAvailable: boolean) {
  const f = fixture(), a = new SqlSession(args), b = new SqlSession(args);
  try {
   await a.run(`begin; set local deadlock_timeout='200ms'; set local statement_timeout='8s'; select 1 from public.reader_collection_policies where user_id='${f.userId}' for update;`);
   const pidB = Number(await b.run('select pg_backend_pid();'));
   // This is the actual reader RPC, authorized by Clerk-style verified request
   // claims. No owner ID is passed as a function argument or trigger shortcut.
   const clear = b.run(`begin; set local deadlock_timeout='200ms'; set local statement_timeout='8s'; set local role authenticated;
    select set_config('request.jwt.claims','{"sub":"${f.userId}","role":"authenticated"}',true);
    select public.clear_reader_workspace('${f.revision}'::timestamptz,null); commit;`);
   const clearOutcome = clear.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: error as Error }));
   let blocked = false;
   for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await a.run(`select coalesce((select wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid)) from pg_stat_activity where pid=${pidB}),false);`);
    if (waiting === 't') { blocked = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
   }
   expect(blocked, 'Clear must be blocked specifically by the held owner policy lock.').toBe(true);
   if (requireStateAvailable) {
    // The fixed clear must wait BEFORE locking source state/archive rows.
    await a.run(`savepoint source_probe; select 1 from public.reader_collection_source_state where user_id='${f.userId}' and source_id='${f.sourceId}' for update nowait; rollback to savepoint source_probe;`);
   }
   // Actual server reservation takes policy -> source state and reserves the
   // real global ledger. No provider is called; this is database-only work.
   const reserve = a.run(`set local role service_role; select public.reserve_hourly_provider('${f.claim.checkId}','${f.claim.leaseToken}','youtube:zzzzzzzzzzz','${f.jobId}','h7sDV53CddomktSi5',0.005); commit;`);
   const [reserved, cleared] = await Promise.all([reserve.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: error as Error })), clearOutcome]);
   return { f, reserved, cleared };
  } finally { a.close(); b.close(); }
 }

 it('lets a real authenticated clear wait before source locks while a provider reservation completes', async () => {
  const result = await scenario(true);
  expect(result.reserved.ok, result.reserved.ok ? '' : result.reserved.error.message).toBe(true);
  expect(result.cleared.ok, result.cleared.ok ? '' : result.cleared.error.message).toBe(true);
  if (result.reserved.ok) expect(result.reserved.value).toContain('"claimed": true');
  if (result.cleared.ok) expect(result.cleared.value).toContain('"updatedAt": null');
  expect(sql(`select count(*) from public.reader_workspaces where user_id='${result.f.userId}';`)).toBe('0');
  expect(sql(`select count(*) from public.reader_source_updates where user_id='${result.f.userId}';`)).toBe('0');
  expect(sql(`select enabled from public.reader_collection_policies where user_id='${result.f.userId}';`)).toBe('f');
  expect(sql(`select discard_result from public.reader_collection_provider_jobs where user_id='${result.f.userId}';`)).toBe('t');
 }, 15_000);

 it('reproduces the former deadlock when only the historical clear function is restored', async () => {
  const currentFunction = sql("select pg_get_functiondef('public.clear_reader_workspace(timestamptz,jsonb)'::regprocedure);");
  try {
   sql(oldClear);
   const result = await scenario(false);
   const errors = [result.reserved, result.cleared].flatMap(outcome => outcome.ok ? [] : [outcome.error.message]);
   expect(errors.some(message => message.includes('40P01') && message.includes('deadlock detected')), errors.join('\n')).toBe(true);
  } finally { sql(currentFunction); }
 }, 15_000);

 it('still rejects an authenticated stale revision before changing archive or workspace rows', () => {
  const f = fixture();
  expect(() => sql(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${f.userId}","role":"authenticated"}',true); select public.clear_reader_workspace(('${f.revision}'::timestamptz-interval '1 microsecond'),null); commit;`)).toThrow(/PT409/);
  expect(sql(`select count(*) from public.reader_workspaces where user_id='${f.userId}';`)).toBe('1');
  expect(sql(`select count(*) from public.reader_source_updates where user_id='${f.userId}';`)).toBe('1');
  expect(sql(`select enabled from public.reader_collection_policies where user_id='${f.userId}';`)).toBe('t');
 });
});
