import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real DATABASE-ONLY tests. Private Unix socket, TCP disabled, no environment
// credentials or Supabase link/config are read. Every migration is applied.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const model = 'google/fixture-model';
const identity = {
 adapterVersion: 'content-analysis-model-v2', route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
 provider: 'google-ai-studio', model, reasoningEffort: 'low', pricing: {
  version: 'verified-fixture-2026-10-24', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4,
  cachedInputUsdPerMillion: 0.01, cacheWriteApplies: false, cacheWriteUsdPerMillion: null,
 },
};
class Session {
 private child: ChildProcessWithoutNullStreams;
 private output = ''; private errors = ''; private sequence = 0;
 private pending?: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
 constructor(args: string[]) {
  this.child = spawn('psql', args, { stdio: 'pipe' });
  this.child.stdout.on('data', chunk => {
   this.output += String(chunk);
   if (this.pending && this.output.includes(this.pending.marker + '\n')) {
    const p = this.pending, end = this.output.indexOf(p.marker + '\n'); this.pending = undefined;
    const value = this.output.slice(0, end).trim(); this.output = this.output.slice(end + p.marker.length + 1);
    clearTimeout(p.timer); p.resolve(value);
   }
  });
  this.child.stderr.on('data', chunk => { this.errors += String(chunk); });
  const fail = (error: Error) => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; } };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error(`Local psql exited ${code}: ${this.errors}`)));
 }
 run(sql: string): Promise<string> {
  if (this.pending) throw new Error('One outstanding command per local session');
  return new Promise((resolve, reject) => {
   const marker = `execution_command_${++this.sequence}_done`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local SQL timeout: ' + this.errors)); }, 8000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); this.child.kill('SIGTERM'); }
}

describe.skipIf(!available)('D36 actual disposable PostgreSQL execution identity', () => {
 let root: string, args: string[], started = false, sequence = 0;
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recap-execution-db-')); const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55496`, 'start'], { stdio: 'ignore' }); started = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55496', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) sql(readFileSync(new URL(name, directory), 'utf8'));
  service(`insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,true,45,45);`);
 }, 20000);
 afterAll(() => {
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });
 function fixture() {
  const owner = 'execution-db-owner-' + ++sequence, source = 'execution-source';
  const state = { version: 1, followedSourceIds: [source], customSources: [{ id: source, name: 'Synthetic channel', url: 'https://example.org/channel', platform: 'YouTube', status: 'ready', creatorIds: [] }], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {} };
  const record = { id: 'fixture-video', sourceId: source, publishedAt: '2026-10-24T00:00:00Z', url: 'https://example.org/video', title: 'Synthetic provenance', isSample: false, format: 'video', contentKind: 'transcript', content: 'Synthetic saved source words for local provenance testing.', videoFormat: { kind: 'regular', basis: 'watch_page' }, topics: [], brands: [] };
  service(`insert into public.reader_workspaces(user_id,state) values(${quote(owner)},${quote(JSON.stringify(state))});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${quote(owner)},true,1,2,1,${quote(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${quote(owner)},'fixture-video',${quote(source)},'fixture','2026-10-24T00:00:00Z',${quote(JSON.stringify(record))});
   select public.sync_content_analysis_jobs(${quote(owner)},200);`);
  const claimed = JSON.parse(service(`select public.claim_content_analysis_job(${quote(owner)},900);`));
  return { owner, id: claimed.job.id as string, token: claimed.leaseToken as string };
 }
 function reserve(f: ReturnType<typeof fixture>, value: unknown = identity, key = 'role:0', maximum = 0.01) {
  return `select public.reserve_content_analysis_call_v2('${f.id}','${f.token}',${quote(key)},${maximum},${quote(model)},${quote(JSON.stringify(value))}::jsonb);`;
 }
 it('passes new/duplicate/changed/legacy/day-rollover/unknown-charge/settlement acceptance as service_role', () => {
  expect(sql(readFileSync(new URL('./content-analysis-execution-identity-db.sql', import.meta.url), 'utf8'))).toBe('');
 });
 it('passes the D35 rollback-only source/history checks with derived approval proof after all migrations', () => {
  expect(sql(readFileSync(new URL('./content-analysis-db.sql', import.meta.url), 'utf8'))).toBe('');
 });
 it('commits identity before returning permission to contact a provider', () => {
  const f = fixture(), response = JSON.parse(service(reserve(f)));
  expect(response.claimed).toBe(true);
  expect(response.call).toMatchObject({ model, execution_identity: identity, actual_usd: null, result: null, state: 'reserved' });
  // A separate connection sees the committed identity before this test could
  // issue any provider request. No network/provider call exists in this suite.
  const saved = JSON.parse(service(`select to_jsonb(c) from public.reader_content_analysis_calls c where id='${response.call.id}';`));
  expect(saved).toEqual(response.call);
 });
 const malformed: [string, unknown][] = [
  ['null', null], ['array', []], ['empty object', {}], ['nested source payload', { ...identity, source: { text: 'synthetic source' } }],
  ['secret field', { ...identity, apiKey: 'synthetic-secret-do-not-store' }],
  ['extra pricing field', { ...identity, pricing: { ...identity.pricing, token: 'synthetic-secret' } }],
  ['different model', { ...identity, model: 'google/different-model' }],
  ['missing field', Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'reasoningEffort'))],
  ['missing pricing', { ...identity, pricing: {} }], ['null pricing', { ...identity, pricing: null }],
  ['missing verified rate', { ...identity, pricing: { ...identity.pricing, inputUsdPerMillion: null } }],
  ['string rate', { ...identity, pricing: { ...identity.pricing, inputUsdPerMillion: '0.1' } }],
  ['negative rate', { ...identity, pricing: { ...identity.pricing, inputUsdPerMillion: -0.1 } }],
  ['zero rate', { ...identity, pricing: { ...identity.pricing, inputUsdPerMillion: 0 } }],
  ['excessive rate', { ...identity, pricing: { ...identity.pricing, outputUsdPerMillion: 1000.01 } }],
  ['string cache flag', { ...identity, pricing: { ...identity.pricing, cacheWriteApplies: 'false' } }],
  ['missing required cache-write price', { ...identity, pricing: { ...identity.pricing, cacheWriteApplies: true } }],
  ['unexpected cache-write price', { ...identity, pricing: { ...identity.pricing, cacheWriteUsdPerMillion: 0.2 } }],
  ['cached price exceeds input', { ...identity, pricing: { ...identity.pricing, cachedInputUsdPerMillion: 0.2 } }],
  ['missing pricing version', { ...identity, pricing: { ...identity.pricing, version: '' } }],
  ['source text in version', { ...identity, pricing: { ...identity.pricing, version: 'Source text is not pricing' } }],
  ['object adapter', { ...identity, adapterVersion: { source: 'synthetic' } }],
  ['long adapter', { ...identity, adapterVersion: 'v'.repeat(101) }],
  ['source text in adapter', { ...identity, adapterVersion: 'source text' }],
  ['secret query URL', { ...identity, baseURL: 'https://openrouter.ai/api/v1?api_key=synthetic' }],
  ['credential URL', { ...identity, baseURL: 'https://synthetic:secret@openrouter.ai/api/v1' }],
  ['unapproved route', { ...identity, route: 'arbitrary' }], ['empty provider', { ...identity, provider: '' }],
  ['prose provider', { ...identity, provider: 'Google AI Studio' }],
  ['direct wrong provider', { ...identity, route: 'direct', baseURL: 'https://api.openai.com/v1' }],
  ['netlify wrong host', { ...identity, route: 'netlify', provider: 'netlify', baseURL: 'https://netlify.com.evil.example/v1' }],
  ['netlify query URL', { ...identity, route: 'netlify', provider: 'netlify', baseURL: 'https://gateway.netlify.com/v1?key=synthetic' }],
  ['object reasoning', { ...identity, reasoningEffort: { prompt: 'synthetic' } }],
  ['source text in reasoning', { ...identity, reasoningEffort: 'source text' }],
  ['oversized payload', { ...identity, extra: 'x'.repeat(5000) }],
 ];
 it.each(malformed)('rejects %s before reserving money, including for an existing call', (_name, value) => {
  const f = fixture();
  expect(() => service(reserve(f, value))).toThrow(/PT400/);
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${f.id}';`)).toBe('0');
  const original = JSON.parse(service(reserve(f)));
  expect(() => service(reserve(f, value))).toThrow(/PT400/);
  expect(JSON.parse(service(`select to_jsonb(c) from public.reader_content_analysis_calls c where job_id='${f.id}';`))).toEqual(original.call);
 });
 it.each([
  { ...identity, reasoningEffort: null, pricing: { ...identity.pricing, cachedInputUsdPerMillion: null } },
  { ...identity, pricing: { ...identity.pricing, cacheWriteApplies: true, cacheWriteUsdPerMillion: 0.2 } },
  { ...identity, route: 'direct', provider: 'openai', baseURL: 'https://api.openai.com/v1' },
  { ...identity, route: 'netlify', provider: 'netlify', baseURL: 'https://gateway.netlify.com/v1' },
  { ...identity, provider: 'google-vertex/us-east5', pricing: { ...identity.pricing, inputUsdPerMillion: 0.000001, cachedInputUsdPerMillion: null, outputUsdPerMillion: 1000 } },
 ])('accepts the exact explicit contract %#', value => {
  const response = JSON.parse(service(reserve(fixture(), value)));
  expect(response.claimed).toBe(true); expect(response.call.execution_identity).toEqual(value);
 });
 it.each(['anon', 'authenticated'])('denies %s RPC, helper, and private column reads in actual PostgreSQL', role => {
  const f = fixture();
  expect(() => sql(`set role ${role}; ${reserve(f)}`)).toThrow(/42501.*permission denied for function reserve_content_analysis_call_v2/s);
  expect(() => sql(`set role ${role}; select public.validate_content_analysis_execution_identity('{}',${quote(model)});`)).toThrow(/42501.*permission denied for function validate_content_analysis_execution_identity/s);
  expect(() => sql(`set role ${role}; select execution_identity from public.reader_content_analysis_calls;`)).toThrow(/42501.*permission denied for table reader_content_analysis_calls/s);
 });
 it('keeps functions invoker/empty-path and grants no PUBLIC execution', () => {
  const metadata = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'config',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_content_analysis_call_v2','validate_content_analysis_execution_identity','preserve_content_analysis_execution_identity');`));
  expect(metadata).toHaveLength(3);
  for (const fn of metadata) expect(fn).toMatchObject({ definer: false, config: ['search_path=""'], publicExecute: false });
 });
 it('keeps identity and reservation atomic if identity persistence fails', () => {
  const f = fixture();
  // Database-only injected storage failure; an independently committed hold
  // would survive this and fail the assertion below.
  sql(`create function public.reject_execution_fixture() returns trigger language plpgsql as $$ begin raise exception 'Synthetic identity storage failure' using errcode='PT400'; end; $$;
   create trigger reject_execution_fixture before update of execution_identity on public.reader_content_analysis_calls for each row execute function public.reject_execution_fixture();`);
  try {
   expect(() => service(reserve(f))).toThrow(/Synthetic identity storage failure/);
   expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${f.id}';`)).toBe('0');
  } finally { sql('drop trigger reject_execution_fixture on public.reader_content_analysis_calls; drop function public.reject_execution_fixture();'); }
 });
 it('serializes two real sessions on the same key and returns only the original identity', async () => {
  const f = fixture(), a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   const first = JSON.parse(await a.run(reserve(f)));
   let finished = false;
   const duplicate = b.run(`set role service_role; set statement_timeout='5s'; ${reserve(f, { ...identity, provider: 'google-vertex' })}`)
    .then(value => { finished = true; return JSON.parse(value); });
   // Confirm the concurrent backend actually waits for the original lock,
   // without assuming an arbitrary sleep is enough to schedule that session.
   const deadline = Date.now() + 4000;
   while (sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%reserve_content_analysis_call_v2%';") === '0') {
    if (Date.now() > deadline) throw new Error('Second local session never waited on the reservation lock');
    await new Promise(resolve => setTimeout(resolve, 10));
   }
   expect(finished).toBe(false);
   await a.run('commit;');
   const retry = await duplicate;
   expect(retry.claimed).toBe(false); expect(retry.call).toEqual(first.call);
   expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${f.id}';`)).toBe('1');
  } finally { a.close(); b.close(); }
 });
});
