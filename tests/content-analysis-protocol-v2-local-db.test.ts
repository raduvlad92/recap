import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contentHash } from '../src/lib/content-processing';
import { ANALYSIS_CACHE_PAGE_BYTES, createAnalysisWorker, type AnalysisClaim, type AnalysisStore, type AnalysisCachePage } from '../netlify/functions/_shared/content-analysis';
import { analysisV2CallPlan } from '../netlify/functions/_shared/content-analysis-engine';
import { type AnalysisGenerator, type AnalysisLimits } from '../netlify/functions/_shared/content-analysis-model';

// Real PostgreSQL, synthetic DATABASE-ONLY fixtures. Private Unix socket with
// TCP disabled. Never reads environment credentials or Supabase project config.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const q = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const jsonSql = (value: unknown) => q(JSON.stringify(value)) + '::jsonb';
const model = 'deepseek/deepseek-v4.1-flash-1017', requestHash = 'a'.repeat(64);
const identity = {
 adapterVersion: 'content-analysis-model-v2', route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
 provider: 'relace', model, reasoningEffort: null, pricing: {
  version: 'synthetic-fixture-2026-10-25', inputUsdPerMillion: .1, outputUsdPerMillion: .4,
  cachedInputUsdPerMillion: null, cacheWriteApplies: false, cacheWriteUsdPerMillion: null,
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
  if (this.pending) throw new Error('One outstanding local command per session');
  return new Promise((resolve, reject) => {
   const marker = `protocol_command_${++this.sequence}_done`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local SQL timeout: ' + this.errors)); }, 8000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); this.child.kill('SIGTERM'); }
}

describe.skipIf(!available)('D38 actual disposable PostgreSQL private content-v2 protocol', () => {
 let root: string, args: string[], started = false, sequence = 0;
 let beforeMigration: string, afterMigration: string, ledgerAcceptance: string;
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 const json = (query: string) => JSON.parse(service(query) || 'null');
 const preservation = (after = false) => `select jsonb_build_object(
  'budget',(select to_jsonb(b) from public.content_analysis_budget b),
  'policies',(select jsonb_agg(to_jsonb(p) order by user_id) from public.reader_content_analysis_policies p),
  'workspace',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
  'originals',(select jsonb_agg(to_jsonb(r) order by user_id,id) from public.reader_source_updates r),
  'jobs',(select jsonb_agg(${after ? "to_jsonb(j)-array['continuation_result_count','continuation_stalls']" : 'to_jsonb(j)'} order by id) from public.reader_content_analysis_jobs j),
  'calls',(select jsonb_agg(${after ? "to_jsonb(c)-array['validation_error_code','validation_result_hash']" : 'to_jsonb(c)'} order by id) from public.reader_content_analysis_calls c),
  'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
  'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a),
  'settings',(select to_jsonb(s) from public.content_analysis_runtime_settings s));`;
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recap-protocol-v2-db-')); const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55498`, 'start'], { stdio: 'ignore' }); started = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55498', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
   if (name.includes('_content_analysis_protocol_v2.sql')) {
    sql(readFileSync(new URL('./content-analysis-protocol-v2-legacy-fixture.sql', import.meta.url), 'utf8'));
    beforeMigration = service(preservation());
   }
   sql(readFileSync(new URL(name, directory), 'utf8'));
   if (name.includes('_content_analysis_protocol_v2.sql')) {
    afterMigration = service(preservation(true));
    ledgerAcceptance = sql(readFileSync(new URL('./content-analysis-protocol-v2-db.sql', import.meta.url), 'utf8'));
   }
  }
 }, 20000);
 beforeEach(() => {
  sql(`truncate public.reader_workspaces cascade; truncate public.reader_source_updates cascade; truncate public.reader_content_analysis_calls cascade;
   truncate public.reader_content_analysis_policies; truncate public.content_analysis_provider_cooldowns;
   update public.content_analysis_budget set enabled=true,daily_limit_usd=5,lifetime_limit_usd=5;`);
 });
 afterAll(() => {
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });
 function fixture(count = 1) {
  const owner = 'protocol-fixture-' + ++sequence, source = 'fixture-source';
  const state = { version: 1, followedSourceIds: [source], customSources: [{ id: source, name: 'Synthetic source', url: 'https://example.org/channel', platform: 'YouTube', status: 'ready', creatorIds: [] }], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {} };
  const record = { id: 'fixture-video-1', sourceId: source, publishedAt: '2026-10-24T00:00:00Z', url: 'https://example.org/video', title: 'Synthetic content', isSample: false, format: 'video', contentKind: 'transcript', content: 'Nvidia makes RTX 5090. A GPU measured a 45 FPS result.', videoFormat: { kind: 'regular', basis: 'watch_page' }, topics: [], brands: [] };
  service(`insert into public.reader_workspaces(user_id,state) values(${q(owner)},${jsonSql(state)});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${q(owner)},true,5,5,.01,${q(model)});`);
  for (let n = 1; n <= count; n++) {
   const item = { ...record, id: 'fixture-video-' + n, publishedAt: `2026-10-${25 - n}T00:00:00Z` };
   service(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${q(owner)},${q(item.id)},${q(source)},'fixture',${q(item.publishedAt)},${jsonSql(item)});`);
  }
  return { owner, source, record, hash: contentHash(record.content) };
 }
 type Fixture = ReturnType<typeof fixture>;
 type Claim = { job: { id: string; content_hash: string; task: 'summary' | 'keywords'; attempts: number; rule_version: string }; leaseToken: string };
 type Lease = {job:{id:string};leaseToken:string};
 function scope(f: Pick<Fixture, 'owner'>, ids: string[] | null = ['fixture-video-1'], phase = 'evaluation') {
  return json(`select public.set_content_analysis_rollout_scope(${q(f.owner)},${ids === null ? 'null' : `array[${ids.map(q).join(',')}]::text[]`},${q(phase)});`);
 }
 const sync = (f: Pick<Fixture, 'owner'>, limit = 200, epoch = '') => json(`select public.sync_content_analysis_jobs_v2(${q(f.owner)},${limit},${q(epoch)});`);
 const claim = (f: Pick<Fixture, 'owner'>): Claim | null => json(`select public.claim_content_analysis_job_v2(${q(f.owner)},900);`);
 const job = (c: Claim) => json(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id='${c.job.id}';`);
 function active(task: 'summary' | 'keywords' = 'summary') {
  const f = fixture(); scope(f); sync(f);
  service(`update public.reader_content_analysis_jobs set state='skipped' where user_id=${q(f.owner)} and task<>${q(task)};`);
  return { f, c: claim(f)! };
 }
 const reserveSql = (c: Claim, key = 'summary:v2:chunk:0', hash = requestHash, maximum = .001, value: unknown = identity) =>
  `select public.reserve_content_analysis_call_v3('${c.job.id}','${c.leaseToken}',${q(key)},${maximum},${q(model)},${jsonSql(value)},${q(hash)});`;
 const reserve = (c: Claim, key?: string, hash?: string) => json(reserveSql(c, key, hash));
 const call = (id: string) => json(`select to_jsonb(c) from public.reader_content_analysis_calls c where id='${id}';`);
 function save(c: Claim, id: string, value: unknown = { invalid: true }, actual: number | null = .0001) {
  return json(`select public.record_content_analysis_call_result('${id}','${c.leaseToken}',${jsonSql({ value, requestHash })},'{}',null,${actual === null ? 'null' : actual},${actual === null ? '.00005' : actual});`);
 }
 const markSql = (c: Claim, key = 'summary:v2:chunk:0', hash = requestHash, code = 'analysis_invalid_model_output') =>
  `select public.mark_content_analysis_call_invalid('${c.job.id}','${c.leaseToken}',${q(key)},${q(hash)},${q(code)});`;
 const mark = (c: Claim, key?: string) => json(markSql(c, key));
 const due = (c: Claim) => service(`update public.reader_content_analysis_jobs set next_attempt_at='-infinity' where id='${c.job.id}';`);
 const yieldJob = (c: Claim) => json(`select public.fail_content_analysis_job('${c.job.id}','${c.leaseToken}','analysis_worker_yield',false,true);`);
 const record = (f: Fixture) => json(`select record from public.reader_source_updates where user_id=${q(f.owner)} and id='fixture-video-1';`);
 function summary(f: Fixture) {
  return { state: 'ready', pending: [], patch: { videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: f.hash, timingBasis: 'none' }, videoHighlights: [{ text: 'Nvidia makes the RTX 5090.' }] }, evidence: { contentHash: f.hash, sourceContentState: 'partial', coverage: [{ start: 0, end: f.record.content.length }], selected: [{ text: 'Nvidia makes the RTX 5090.', evidenceQuote: 'Nvidia makes RTX 5090.' }] } };
 }
 const prepare = (c: Lease, value: unknown) => json(`select public.prepare_content_analysis_job('${c.job.id}','${c.leaseToken}',${jsonSql(value)});`);
 const publishSql = (c: Lease) => `select public.publish_content_analysis_job('${c.job.id}','${c.leaseToken}');`;
 const cacheSql = (c: Lease, keys = ['summary:v2:chunk:0'], after: string | null = null) =>
  `select public.read_content_analysis_cached_calls_v2('${c.job.id}','${c.leaseToken}',array[${keys.map(q).join(',')}]::text[],${after === null ? 'null' : q(after)},${q(model)});`;
 async function waiting(pattern: string) {
  const deadline = Date.now() + 4000;
  while (sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and query like ${q('%' + pattern + '%')};`) === '0') {
   if (Date.now() > deadline) throw new Error('Expected concurrent PostgreSQL lock wait');
   await new Promise(resolve => setTimeout(resolve, 10));
  }
 }
 it('preserves all twelve legacy rows, three unknown holds, sources, settings, reviews, and disabled $5 gates across the actual migration', () => {
  expect(beforeMigration).toBeTruthy(); expect(afterMigration).toBe(beforeMigration); expect(ledgerAcceptance).toBe('');
 });
 it('requires an explicit nonpaused owner scope; NULL means all and empty means no originals', () => {
  const f = fixture(2); expect(sync(f)).toEqual({ synchronized: 0 }); expect(claim(f)).toBeNull();
  scope(f, [], 'evaluation'); expect(sync(f).synchronized).toBe(0);
  scope(f, null, 'paused'); expect(sync(f).synchronized).toBe(0);
  scope(f, ['fixture-video-2']); expect(sync(f).synchronized).toBe(2);
  expect(json(`select jsonb_agg(distinct update_id) from public.reader_content_analysis_jobs where user_id=${q(f.owner)};`)).toEqual(['fixture-video-2']);
  scope(f, null, 'active'); expect(sync(f).synchronized).toBe(2);
  expect(service(`select count(*) from public.reader_content_analysis_jobs where user_id=${q(f.owner)};`)).toBe('4');
 });
 it('scope selection never enables or changes financial/runtime policy and saved model selection', () => {
  const f = fixture(); service(`update public.content_analysis_budget set enabled=false; update public.reader_content_analysis_policies set enabled=false where user_id=${q(f.owner)};`);
  const before = service(preservation(true)); scope(f); expect(claim(f)).toBeNull();
  expect(service(preservation(true))).toBe(before);
 });
 it.each(['anon', 'authenticated'])('denies %s private table and every new RPC/helper', role => {
  const f = fixture();
  const statements = [
   'select * from public.content_analysis_rollout_scopes;',
   `select public.set_content_analysis_rollout_scope(${q(f.owner)},null,'active');`,
   `select public.sync_content_analysis_jobs_v2(${q(f.owner)});`,
   `select public.claim_content_analysis_job_v2(${q(f.owner)});`,
   `select public.content_analysis_v2_in_scope(${q(f.owner)},'fixture-video-1');`,
   `select public.content_analysis_v2_unknown_hold(${q(f.owner)},'fixture-video-1','summary');`,
   `select public.content_analysis_task_completed('{}','${'b'.repeat(64)}','summary');`,
   `select public.mark_content_analysis_call_invalid(gen_random_uuid(),gen_random_uuid(),'summary:v2:chunk:0','${requestHash}','analysis_invalid_model_output');`,
   `select public.read_content_analysis_cached_calls_v2(gen_random_uuid(),gen_random_uuid(),array['summary:v2:chunk:0'],null,${q(model)});`,
  ];
  for (const statement of statements) expect(() => sql(`set role ${role}; ${statement}`)).toThrow(/42501.*permission denied/s);
 });
 it('service can only write scopes through the guarded setter; functions use empty paths and no PUBLIC execution', () => {
  const f = fixture(); scope(f);
  expect(() => service(`update public.content_analysis_rollout_scopes set phase='active';`)).toThrow(/42501.*permission denied/s);
  expect(() => service(`delete from public.content_analysis_rollout_scopes;`)).toThrow(/42501.*permission denied/s);
  const metadata = json(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'config',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_content_analysis_rollout_scope','sync_content_analysis_jobs_v2','claim_content_analysis_job_v2','mark_content_analysis_call_invalid','fence_content_analysis_v2_call','read_content_analysis_cached_calls_v2');`);
  expect(metadata).toHaveLength(6);
  for (const fn of metadata) expect(fn).toMatchObject({ config: ['search_path=""'], publicExecute: false, definer: fn.name === 'set_content_analysis_rollout_scope' });
 });
 it.each(['unknown', '', 'EVALUATION'])('rejects invalid scope phase %s', phase => {
  expect(() => scope(fixture(), null, phase)).toThrow(/PT400/);
 });
 it('keeps legacy fixtures/RPCs working only without a v2 owner scope, and v2 claims select v2 exclusively', () => {
  const f = fixture(); service(`select public.sync_content_analysis_jobs(${q(f.owner)},200);`);
  const legacy = json(`select public.claim_content_analysis_job(${q(f.owner)},900);`);
  expect(legacy.job.rule_version).toBe('content-v1'); expect(claim(f)).toBeNull();
  const raw = json(`select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where user_id=${q(f.owner)};`);
  scope(f); expect(json(`select public.claim_content_analysis_job(${q(f.owner)},900);`)).toBeNull();
  expect(() => service(reserveSql(legacy, 'summary:0'))).toThrow(/PT409/);
  expect(sync(f).synchronized).toBe(2); expect(claim(f)?.job.rule_version).toBe('content-v2');
  const retained = json(`select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where user_id=${q(f.owner)} and rule_version='content-v1';`);
  expect(retained.map((j: { id: string }) => j.id)).toEqual(raw.map((j: { id: string }) => j.id));
  expect(retained).toEqual(raw);
 });
 it('known settled invalid v1 responses are superseded without changing their ledger/result bytes', () => {
  const f = fixture(); service(`select public.sync_content_analysis_jobs(${q(f.owner)},200); update public.reader_content_analysis_jobs set state='skipped' where user_id=${q(f.owner)} and task='keywords';`);
  const old = json(`select public.claim_content_analysis_job(${q(f.owner)},900);`), paid = reserve(old, 'summary:chunk:0').call;
  save(old, paid.id); const before = call(paid.id);
  scope(f); expect(sync(f).synchronized).toBe(1); expect(claim(f)?.job.rule_version).toBe('content-v2');
  expect(call(paid.id)).toEqual(before);
 });
 it('legacy unresolved actual-null calls fence the same source/task across new versions and keys', () => {
  service(`delete from public.content_analysis_budget;`);
  sql(readFileSync(new URL('./content-analysis-protocol-v2-legacy-fixture.sql', import.meta.url), 'utf8'));
  const owner = 'protocol-preservation-owner', before = service(`select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;`);
  service(`update public.content_analysis_budget set enabled=true; update public.reader_content_analysis_policies set enabled=true;`);
  scope({ owner }, null); sync({ owner });
  expect(service(`select count(*) from public.reader_content_analysis_jobs where user_id=${q(owner)} and rule_version='content-v2' and error_code='analysis_unknown_charge_hold';`)).toBe('3');
  expect(service(`select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;`)).toBe(before);
  expect(service(`select count(*),sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null;`)).toBe('3|0.009178191000');
 });
 it('an orphan unknown commitment remains a conservative owner hold after its job is deleted', () => {
  const { f, c } = active(), paid = reserve(c).call;
  service(`delete from public.reader_content_analysis_jobs where id='${c.job.id}';`);
  expect(call(paid.id).job_id).toBeNull(); expect(call(paid.id).actual_usd).toBeNull();
  sync(f);
  expect(service(`select count(*) from public.reader_content_analysis_jobs where user_id=${q(f.owner)} and state='blocked' and error_code='analysis_unknown_charge_hold';`)).toBe('1');
  expect(claim(f)).toBeNull();
 });
 it('does not rewrite completed saved annotations or current-hash published work when a model/config changes', () => {
  const { f, c } = active(); prepare(c, summary(f)); expect(service(publishSql(c))).toBe('t');
  const before = record(f); service(`update public.reader_content_analysis_policies set model='minimax/minimax-m3.1-flash' where user_id=${q(f.owner)};`);
  expect(sync(f, 200, 'new-model').synchronized).toBe(0); expect(claim(f)).toBeNull(); expect(record(f)).toEqual(before);
 });
 it('completion filtering happens before the sync limit and remains task specific', () => {
  const f = fixture(2), output = summary(f); scope(f, null);
  service(`update public.reader_source_updates set record=record||${jsonSql(output.patch)}||${jsonSql({ keywordRuleVersion: 'entities-v2', keywordContentHash: f.hash, videoKeywords: [], processing: { keywords: 'empty' } })} where user_id=${q(f.owner)} and id='fixture-video-1';`);
  expect(sync(f, 1).synchronized).toBe(2);
  expect(json(`select jsonb_agg(distinct update_id) from public.reader_content_analysis_jobs where user_id=${q(f.owner)};`)).toEqual(['fixture-video-2']);
 });
 it('keeps a completed matching keyword inventory awaiting private admin review', () => {
  const f = fixture(); scope(f);
  service(`update public.reader_source_updates set record=record||${jsonSql({ keywordRuleVersion: 'entities-v2', keywordContentHash: f.hash, videoKeywords: [], processing: { keywords: 'review' } })} where user_id=${q(f.owner)};`);
  expect(sync(f).synchronized).toBe(1);
  expect(service(`select task from public.reader_content_analysis_jobs where user_id=${q(f.owner)};`)).toBe('summary');
 });
 it.each([null, false, 'invalid schema', [], {}])('materializes raw invalid output %# before validation and permits one settled repair', value => {
  const { c } = active(), original = reserve(c).call; save(c, original.id, value);
  expect(call(original.id).result.value).toEqual(value);
  expect(() => service(reserveSql(c, 'summary:v2:chunk:0:repair:1'))).toThrow(/PT409.*Known settled invalid/s);
  const marked = mark(c); expect(marked.actual_usd).toBe(.0001); expect(marked.validation_result_hash).toMatch(/^[a-f0-9]{64}$/);
  const repaired = reserve(c, 'summary:v2:chunk:0:repair:1'); expect(repaired.claimed).toBe(true); save(c, repaired.call.id, { fixed: true });
  expect(reserve(c, 'summary:v2:chunk:0:repair:1').claimed).toBe(false);
  expect(call(original.id).result).toEqual(marked.result);
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${c.job.id}';`)).toBe('2');
 });
 it('observed-only materialized output cannot authorize correction or another fresh key', () => {
  const { c } = active(), original = reserve(c).call; save(c, original.id, { invalid: true }, null);
  expect(call(original.id)).toMatchObject({ actual_usd: null, state: 'unknown' });
  expect(() => service(markSql(c))).toThrow(/PT409.*Known settled materialized/s);
  expect(() => service(reserveSql(c, 'summary:v2:chunk:0:repair:1'))).toThrow(/PT409.*Unresolved prior/s);
  expect(() => service(reserveSql(c, 'summary:v2:chunk:1'))).toThrow(/PT409.*Unresolved prior/s);
  expect(reserve(c).claimed).toBe(false); expect(call(original.id).actual_usd).toBeNull();
 });
 it('binds invalidity to the base result hash and preserves the original error code', () => {
  const { c } = active(), paid = reserve(c).call; save(c, paid.id);
  const marked = json(markSql(c, undefined, undefined, 'invalid_keyword_candidate'));
  expect(marked.validation_error_code).toBe('invalid_keyword_candidate');
  expect(() => service(markSql(c))).toThrow(/PT409.*invalidity evidence changed/s);
  expect(() => service(`update public.reader_content_analysis_calls set validation_result_hash='${'b'.repeat(64)}' where id='${paid.id}';`)).toThrow(/PT409/);
  expect(call(paid.id)).toEqual(marked);
 });
 it.each(['analysis_unknown_charge_hold','analysis_correction_charge_unknown'])('a blocked same-job %s never requeues on restart/config/model changes, but known settlement can resume it', errorCode => {
  const { f, c } = active(), paid = reserve(c).call; save(c, paid.id, { invalid: true }, null);
  json(`select public.fail_content_analysis_job('${c.job.id}','${c.leaseToken}',${q(errorCode)});`);
  const blocked = job(c); expect(blocked.state).toBe('blocked'); expect(blocked.error_code).toBe(errorCode);
  expect(record(f).processing.recap).toBe('blocked'); expect(sync(f, 200, 'changed-config').synchronized).toBe(0);
  expect(job(c)).toEqual(blocked); expect(claim(f)).toBeNull();
  json(`select public.settle_content_analysis_call_v2('${paid.id}','${c.leaseToken}',.0001,.0001);`);
  expect(sync(f, 200, 'changed-config').synchronized).toBe(1); const resumed=claim(f)!;expect(resumed.job.id).toBe(c.job.id);
  expect(reserve(resumed)).toMatchObject({claimed:false,call:{id:paid.id,actual_usd:.0001}});
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${c.job.id}';`)).toBe('1');
 });
 it('a verified-zero retry cannot spend beside another unresolved same-job call, and resumes after known settlement', () => {
  const activeJob = active(), f = activeJob.f; let c = activeJob.c;
  const original = reserve(c).call, received = service('select clock_timestamp();');
  json(`select public.record_content_analysis_known_rejection('${original.id}','${c.leaseToken}','${requestHash}',${jsonSql(identity)},429,0,'gen-synthetic-zero',${q(received)},false);`);
  json(`select public.fail_content_analysis_job('${c.job.id}','${c.leaseToken}','analysis_provider_http_429');`);
  const proof = { verification: 'authenticated_generation_get', generationId: 'gen-synthetic-zero', model,
   providerSlug: identity.provider, providerName: 'Relace', generationCreatedAt: original.attempt_reserved_at,
   checkedAt: service('select clock_timestamp();'), totalCost: 0, isByok: false, promptTokens: 0,
   completionTokens: 0, reasoningTokens: 0, evidenceSha256: 'b'.repeat(64), bindingEvidenceSha256: null };
  expect(json(`select public.record_content_analysis_generation_receipt('${original.id}','${c.leaseToken}','${requestHash}',${jsonSql(identity)},${jsonSql(proof)},true);`).retryEligible).toBe(true);
  // Local fixture clock advancement only; no HTTP request and no real minute sleep.
  sql(`alter table public.reader_content_analysis_calls disable trigger preserve_content_analysis_request;
   update public.reader_content_analysis_calls set retry_not_before=clock_timestamp()-interval '1 second' where id='${original.id}';
   alter table public.reader_content_analysis_calls enable trigger preserve_content_analysis_request;
   update public.content_analysis_provider_cooldowns set cooldown_until=clock_timestamp()-interval '1 second';
   update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${c.job.id}';`);
  c = claim(f)!; const unknown = reserve(c, 'summary:v2:chunk:1').call, settledZero = call(original.id);
  expect(() => service(reserveSql(c))).toThrow(/PT409.*Unresolved prior/s);
  expect(call(original.id)).toEqual(settledZero);
  expect(service(`select count(*) from public.reader_content_analysis_call_attempts where call_id='${original.id}';`)).toBe('0');
  expect(reserve(c, 'summary:v2:chunk:1').claimed).toBe(false);
  json(`select public.settle_content_analysis_call_v2('${unknown.id}','${c.leaseToken}',.0001,.0001);`);
  expect(reserve(c)).toMatchObject({ claimed: true, call: { id: original.id, attempt_number: 2, actual_usd: null } });
  expect(service(`select count(*) from public.reader_content_analysis_call_attempts where call_id='${original.id}';`)).toBe('1');
 });
 it('a settled cache envelope without an explicit raw value cannot authorize correction', () => {
  const { c } = active(), paid = reserve(c).call;
  json(`select public.record_content_analysis_call_result('${paid.id}','${c.leaseToken}','{"requestHash":"${requestHash}"}','{}',null,.0001,.0001);`);
  expect(() => service(markSql(c))).toThrow(/PT409.*Known settled materialized/s);
 });
 it('missing response, missing base, changed request hash and changed model identity cannot authorize a repair', () => {
  const { c } = active(); expect(() => service(reserveSql(c, 'summary:v2:chunk:0:repair:1'))).toThrow(/PT409/);
  const original = reserve(c).call;
  service(`select public.settle_content_analysis_call_v2('${original.id}','${c.leaseToken}',.0001,.0001);`);
  expect(() => service(markSql(c))).toThrow(/PT409/);
  save(c, original.id); expect(() => service(markSql(c, undefined, 'b'.repeat(64)))).toThrow(/PT409/);
  mark(c);
  expect(() => service(reserveSql(c, 'summary:v2:chunk:0:repair:1', requestHash, .001, { ...identity, provider: 'other-provider' }))).toThrow(/PT409/);
 });
 it.each(['summary:chunk:0', 'summary:v2:chunk:00', 'summary:v2:chunk:0:repair:2', 'summary:v2:chunk:0:repair:1:repair:1', 'new-prefix:v2:chunk:0', 'extractor:v2:chunk:0'])('rejects noncanonical v2 key %s without a financial row', key => {
  const { c } = active(); expect(() => service(reserveSql(c, key))).toThrow(/PT400/);
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${c.job.id}';`)).toBe('0');
 });
 it.each(['summary:v2:chunk:0', 'summary-reduce:v2:level:0:group:0', 'summary:v2:verify:0'])('accepts canonical summary key %s with immutable identity/hash', key => {
  const { c } = active(), r = reserve(c, key); expect(r.claimed).toBe(true);
  expect(r.call.execution_identity).toEqual(identity); expect(r.call.request_hash).toBe(requestHash);
  expect(() => service(`update public.reader_content_analysis_calls set request_hash='${'b'.repeat(64)}' where id='${r.call.id}';`)).toThrow(/PT409/);
 });
 it.each(['extractor:v2:chunk:0', 'checker:v2:chunk:0'])('accepts canonical keyword key %s', key => {
  const { c } = active('keywords'); expect(reserve(c, key).claimed).toBe(true);
 });
 it('rejects legacy reservation RPC bypass, >$.01 calls, and exhausted budgets before inserting a row', () => {
  const { c } = active();
  expect(() => service(`select public.reserve_content_analysis_call('${c.job.id}','${c.leaseToken}','summary:v2:chunk:0',.001,${q(model)});`)).toThrow(/PT400/);
  expect(() => service(reserveSql(c, undefined, undefined, .010000000001))).toThrow(/PT403/);
  service(`update public.content_analysis_budget set daily_limit_usd=.0001;`);
  expect(() => service(reserveSql(c))).toThrow(/PT429/);
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${c.job.id}';`)).toBe('0');
 });
 it('pause revokes preparation/publication/reservation but financial reconciliation still works', () => {
  const { f, c } = active(), original = reserve(c).call; prepare(c, summary(f)); scope(f, null, 'paused');
  expect(claim(f)).toBeNull(); expect(() => service(publishSql(c))).toThrow(/PT409/);
  expect(() => service(reserveSql(c))).toThrow(/PT409/);
  expect(json(`select public.settle_content_analysis_call_v2('${original.id}','${c.leaseToken}',.0001,.0001);`).actual_usd).toBe(.0001);
  scope(f); expect(service(publishSql(c))).toBe('t');
 });
 it.each(['content', 'title', 'timing', 'unfollow', 'delete'])('fences source %s changes before publishing, preserving every financial commitment', kind => {
  const { f, c } = active(), original = reserve(c).call; prepare(c, summary(f));
  if (kind === 'delete') service(`delete from public.reader_source_updates where user_id=${q(f.owner)};`);
  else if (kind === 'unfollow') service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${q(f.owner)};`);
  else service(`update public.reader_source_updates set record=record||${jsonSql(kind === 'content' ? { content: f.record.content + ' New sentence.' } : kind === 'title' ? { title: 'New synthetic title' } : { transcriptSegments: [{ text: f.record.content, startSeconds: 3, durationSeconds: 5 }] })} where user_id=${q(f.owner)};`);
  expect(() => service(publishSql(c))).toThrow(/PT409/); expect(call(original.id).actual_usd).toBeNull();
  if (kind === 'delete') expect(call(original.id)).toMatchObject({ job_id: null, result: null });
 });
 it('pages large raw cached responses under the row/byte caps without changing any charge or raw value', () => {
  const {c}=active(),keys=Array.from({length:5},(_,i)=>'summary:v2:chunk:'+i);
  for(const key of keys){const paid=reserve(c,key).call;save(c,paid.id,'x'.repeat(480000));}
  const before=service(`select jsonb_agg(to_jsonb(c) order by call_key) from public.reader_content_analysis_calls c;`);
  const first=json(cacheSql(c,keys)) as AnalysisCachePage;
  expect(first.calls).toHaveLength(2);expect(first.nextAfterKey).toBe(keys[1]);
  const second=json(cacheSql(c,keys,first.nextAfterKey)) as AnalysisCachePage;
  const third=json(cacheSql(c,keys,second.nextAfterKey)) as AnalysisCachePage;
  expect([...first.calls,...second.calls,...third.calls].map(row=>row.call_key)).toEqual(keys);
  expect(third.nextAfterKey).toBeNull();
  for(const page of [first,second,third])expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(ANALYSIS_CACHE_PAGE_BYTES);
  expect(service(`select jsonb_agg(to_jsonb(c) order by call_key) from public.reader_content_analysis_calls c;`)).toBe(before);
 });
 it.each(['empty','too-many','duplicate','bad-key','bad-cursor','null-lease','wrong-task'])('rejects malformed cache input %s',kind=>{
  const {c}=active();
  const query=kind==='null-lease'?cacheSql(c).replace(q(c.leaseToken),'null'):cacheSql(c,kind==='empty'?[]:kind==='too-many'?Array.from({length:65},(_,i)=>'summary:v2:chunk:'+i):kind==='duplicate'?['summary:v2:chunk:0','summary:v2:chunk:0']:kind==='bad-key'?['summary:0']:kind==='wrong-task'?['extractor:v2:chunk:0']:['summary:v2:chunk:0'],kind==='bad-cursor'?'summary:v2:chunk:1':null);
  expect(()=>service(query)).toThrow(kind==='wrong-task'?/PT409/:/PT400/);
 });
 it.each(['content','title','unfollow','delete-source','delete-workspace','scope-paused','scope-empty','expired-lease','wrong-lease','budget-off','policy-off','model-changed'])('denies cached raw output after %s',kind=>{
  const {f,c}=active(),paid=reserve(c).call;save(c,paid.id);
  if(kind==='content'||kind==='title')service(`update public.reader_source_updates set record=record||${jsonSql(kind==='content'?{content:f.record.content+' Changed.'}:{title:'Changed title'})} where user_id=${q(f.owner)};`);
  else if(kind==='unfollow')service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${q(f.owner)};`);
  else if(kind==='delete-source')service(`delete from public.reader_source_updates where user_id=${q(f.owner)};`);
  else if(kind==='delete-workspace')service(`delete from public.reader_workspaces where user_id=${q(f.owner)};`);
  else if(kind==='scope-paused')scope(f,null,'paused');
  else if(kind==='scope-empty')scope(f,[]);
  else if(kind==='expired-lease')service(`update public.reader_content_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${c.job.id}';`);
  else if(kind==='budget-off')service(`update public.content_analysis_budget set enabled=false;`);
  else if(kind==='policy-off')service(`update public.reader_content_analysis_policies set enabled=false where user_id=${q(f.owner)};`);
  else if(kind==='model-changed')service(`update public.reader_content_analysis_policies set model='minimax/minimax-m3.1-flash' where user_id=${q(f.owner)};`);
  expect(()=>service(cacheSql(kind==='wrong-lease'?{...c,leaseToken:'00000000-0000-0000-0000-000000000001'}:c))).toThrow(/PT409|PT403/);
  expect(call(paid.id).actual_usd).toBe(.0001);
 });
 it('cache read rechecks natural lease expiry after a financial lock wait',async()=>{
  const {c}=active(),paid=reserve(c).call;save(c,paid.id);
  service(`update public.reader_content_analysis_jobs set lease_until=clock_timestamp()+interval '.3 seconds' where id='${c.job.id}';`);
  const a=new Session(args),b=new Session(args);
  try{
   await a.run('begin; set local role service_role; select 1 from public.content_analysis_budget for update;');
   const pending=b.run('set role service_role; '+cacheSql(c)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting('read_content_analysis_cached_calls_v2');await a.run('select pg_sleep(.35); commit;');
   expect((await pending).error).toMatch(/PT409.*lease expired/s);
  }finally{a.close();b.close();}
 });
 it('actual worker + PG completes a 30-result cached prefix with ten owners and 500ms RPC time, without duplicate charges',async()=>{
  const f=fixture(),text='Nvidia makes RTX 5090. GPU evidence repeats. '.repeat(2500);
  service(`update public.reader_source_updates set record=record||${jsonSql({content:text})} where user_id=${q(f.owner)};`);scope(f);sync(f);
  service(`update public.reader_content_analysis_jobs set state='skipped' where user_id=${q(f.owner)} and task='summary';`);
  const lim:AnalysisLimits={model,pricingVersion:'r3-fixture',chunkChars:12000,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,inputUsdPerMillion:.1,outputUsdPerMillion:.4,cachedInputUsdPerMillion:.01,cacheWriteApplies:false,maxCallUsd:.01};
  const env=(name:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'relace'} as Record<string,string>)[name];
  let clock=0,saved=0,seed=true,generated=0,cachePages=0,peakRows=0,peakBytes=0;
  const claimedOwners:string[]=[];
  const tick=()=>{clock+=500;};
  const store:AnalysisStore={
   policies:async()=>{tick();return json(`select coalesce(jsonb_agg(to_jsonb(p) order by last_served_at,user_id),'[]') from public.reader_content_analysis_policies p where enabled;`);},
   sync:async userId=>{tick();return sync({owner:userId});},
   claim:async userId=>{tick();const found=claim({owner:userId});if(found)claimedOwners.push(userId);return found as unknown as AnalysisClaim|null;},
   cachedCalls:async(c,keys,after)=>{tick();const page=json(cacheSql(c,keys,after)) as AnalysisCachePage;cachePages++;peakRows=Math.max(peakRows,page.calls.length);peakBytes=Math.max(peakBytes,Buffer.byteLength(JSON.stringify(page)));return page;},
   reserve:async(c,r,maximum,m,i,h)=>{tick();return json(`select public.reserve_content_analysis_call_v3('${c.job.id}','${c.leaseToken}',${q(r.key)},${maximum},${q(m)},${jsonSql(i)},${q(h)});`);},
   saveCall:async(row,c,r)=>{tick();const out=json(`select public.record_content_analysis_call_result('${row.id}','${c.leaseToken}',${jsonSql(r)},'{}',null,.0001,.0001);`);if(++saved===30&&seed)clock=552000;return out;},
   prepare:async(c,r)=>{tick();prepare(c,r);},publish:async c=>{tick();return service(publishSql(c))==='t';},
   fail:async(c,code,retryable,yielded=false)=>{tick();return json(`select public.fail_content_analysis_job('${c.job.id}','${c.leaseToken}',${q(code)},${retryable},${yielded});`);},
   recordRejection:async()=>{throw new Error('No provider calls in disposable fixture');},
  };
  const generate:AnalysisGenerator=async r=>{
   generated++;if(!seed)clock+=8000;
   const p=JSON.parse(r.prompt),pass=p.interval.start===0?p.passages.find((v:{text:string})=>v.text.includes('Nvidia')):undefined;
   return {value:{readComplete:true,lastPassageId:p.requiredLastPassageId,candidates:pass?[{label:'Nvidia',kind:'brand',confidence:90,reason:'Literal synthetic brand',mention:'Nvidia',passageIds:[pass.id]}]:[]},actualUsd:.0001,observedUsd:.0001};
  };
  expect((await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})()).yielded).toBe(1);expect(saved).toBe(30);
  const c={job:{id:service(`select id from public.reader_content_analysis_jobs where user_id=${q(f.owner)} and task='keywords';`)}} as Claim;
  expect(job(c).continuation_result_count).toBe(30);
  const rawPrefix=service(`select jsonb_agg(to_jsonb(c) order by call_key) from public.reader_content_analysis_calls c;`);
  // Seven idle owners and two with actual short work exercise the same ten
  // enabled-policy slice as R3, plus real last-served rotation and publication.
  const others=Array.from({length:9},(_,i)=>fixture(i<2?1:0));
  for(const other of others.slice(0,2)){scope(other);sync(other);service(`update public.reader_content_analysis_jobs set state='skipped' where user_id=${q(other.owner)} and task='summary';`);}
  seed=false;const initialClaims=claimedOwners.length;
  let turns=0;
  for(;turns<15&&job(c).state!=='published';turns++){
   service(`update public.reader_content_analysis_jobs set next_attempt_at='-infinity' where state='queued';`);
   const before=job(c).continuation_result_count;
   await createAnalysisWorker({env,store,limits:lim,generate,now:()=>clock})();
   const current=job(c);expect(current.state).not.toBe('failed');expect(current.continuation_stalls).toBe(0);
   if(current.state==='queued')expect(current.continuation_result_count).toBeGreaterThan(before);
  }
  expect(turns).toBeGreaterThan(1);expect(turns).toBeLessThan(15);expect(job(c).state).toBe('published');
  expect(claimedOwners[initialClaims]).not.toBe(f.owner);
  expect(new Set(claimedOwners)).toEqual(new Set([f.owner,...others.slice(0,2).map(o=>o.owner)]));
  expect(record(f).keywordRuleVersion).toBe('entities-v2');
  for(const other of others.slice(0,2))expect(record(other).keywordRuleVersion).toBe('entities-v2');
  const expected=analysisV2CallPlan(text,lim).keywordChunks*2+4;
  expect(generated).toBe(expected);expect(saved).toBe(expected);
  expect(service(`select count(*) from public.reader_content_analysis_calls;`)).toBe(String(expected));
  expect(Number(service(`select sum(actual_usd) from public.reader_content_analysis_calls;`))).toBeCloseTo(expected*.0001,12);
  const originalIds=JSON.parse(rawPrefix).map((row:{id:string})=>q(row.id));
  expect(service(`select jsonb_agg(to_jsonb(c) order by call_key) from public.reader_content_analysis_calls c where id in (${originalIds.join(',')});`)).toBe(rawPrefix);
  const windowsPerLongClaim=Math.ceil(analysisV2CallPlan(text,lim).keywordChunks/32)*2;
  expect(peakRows).toBeLessThanOrEqual(64);expect(peakBytes).toBeLessThanOrEqual(ANALYSIS_CACHE_PAGE_BYTES);
  expect(cachePages).toBeLessThanOrEqual((turns+1)*windowsPerLongClaim+4);
 },30000);
 it('long work continues across eight leases representing >11 minutes, replaying sixteen immutable paid successes without another charge', () => {
  let { f, c } = active(); const saved: Record<string, unknown> = {}; let syntheticElapsed = 0;
  for (let lease = 0; lease < 8; lease++) {
   for (let chunk = 0; chunk < lease * 2; chunk++) {
    const key = 'summary:v2:chunk:' + chunk, cached = reserve(c, key);
    expect(cached.claimed).toBe(false); expect(cached.call).toEqual(saved[key]);
   }
   for (let n = 0; n < 2; n++) {
    const key = 'summary:v2:chunk:' + (lease * 2 + n), paid = reserve(c, key).call;
    saved[key] = save(c, paid.id, { selected: [] }); syntheticElapsed += 45000;
   }
   expect(job(c).attempts).toBe(1); expect(yieldJob(c).state).toBe('queued'); due(c); c = claim(f)!;
  }
  expect(syntheticElapsed).toBeGreaterThan(11 * 60000); expect(job(c).continuation_stalls).toBe(0);
  prepare(c, summary(f)); expect(service(publishSql(c))).toBe('t');
  expect(service(`select count(*),sum(actual_usd) from public.reader_content_analysis_calls where job_id='${c.job.id}';`)).toBe('16|0.001600000000');
  expect(job(c).state).toBe('published');
 // Repeated real PostgreSQL cache replay can exceed five seconds under load.
 },30000);
 it('three no-progress yields stop instead of running forever', () => {
  let { f, c } = active();
  for (let n = 0; n < 3; n++) {
   const result = yieldJob(c);
   if (n < 2) { expect(result.state).toBe('queued'); due(c); c = claim(f)!; }
   else expect(result.state).toBe('failed');
  }
  expect(job(c)).toMatchObject({ state: 'failed', error_code: 'analysis_no_progress', continuation_stalls: 3, next_attempt_at: 'infinity' });
  expect(claim(f)).toBeNull();
 });
 it('the actual worker reports the durable terminal stop after three genuinely fruitless cache-timeout turns',async()=>{
  const f=fixture();scope(f);sync(f);service(`update public.reader_content_analysis_jobs set state='skipped' where user_id=${q(f.owner)} and task='keywords';`);
  const lim:AnalysisLimits={model,pricingVersion:'stall-fixture',chunkChars:12000,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxOutputTokens:4096,inputUsdPerMillion:.1,outputUsdPerMillion:.4,cachedInputUsdPerMillion:.01,cacheWriteApplies:false,maxCallUsd:.01};
  let clock=0,generations=0;
  const env=(key:string)=>({CONTENT_ANALYSIS_ENABLED:'true',CONTENT_ANALYSIS_ROUTE:'openrouter',CONTENT_ANALYSIS_OPENROUTER_PROVIDER:'relace'} as Record<string,string>)[key];
  const unused=async():Promise<never>=>{throw new Error('Unexpected paid or publication operation');};
  const store:AnalysisStore={policies:async()=>[{user_id:f.owner,enabled:true,model}],sync:async()=>sync(f),claim:async()=>claim(f) as unknown as AnalysisClaim|null,
   cachedCalls:async(c,keys,after)=>{const page=json(cacheSql(c,keys,after));clock+=600000;return page;},
   reserve:unused,recordRejection:unused,saveCall:unused,prepare:unused,publish:unused,
   fail:async(c,code,retryable,yielded)=>json(`select public.fail_content_analysis_job('${c.job.id}','${c.leaseToken}',${q(code)},${retryable},${!!yielded});`)};
  const id=service(`select id from public.reader_content_analysis_jobs where user_id=${q(f.owner)} and task='summary';`),c={job:{id}} as Claim;
  for(let turn=0;turn<3;turn++){
   due(c);const result=await createAnalysisWorker({env,store,limits:lim,generate:async()=>{generations++;throw new Error('No model call');},now:()=>clock})();
   expect(result).toMatchObject(turn<2?{yielded:1,failed:0}:{yielded:0,failed:1});
  }
  expect(generations).toBe(0);expect(job(c)).toMatchObject({state:'failed',error_code:'analysis_no_progress',continuation_stalls:3,next_attempt_at:'infinity'});
  expect(claim(f)).toBeNull();expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('0');
 });
 it('three crashed leases reach terminal cleanup while calls and unknown costs survive', () => {
  let { f, c } = active(); const paid = reserve(c).call;
  for (let n = 0; n < 3; n++) {
   service(`update public.reader_content_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${c.job.id}';`);
   const next = claim(f); if (n < 2) { expect(next?.job.attempts).toBe(n + 2); c = next!; } else expect(next).toBeNull();
  }
  expect(job(c)).toMatchObject({ state: 'failed', error_code: 'analysis_lease_expired', lease_token: null, next_attempt_at: 'infinity' });
  expect(call(paid.id).actual_usd).toBeNull();
 });
 it('sync skips a locked archive and does not deadlock against enrichment', async () => {
  const f = fixture(); scope(f); const a = new Session(args), b = new Session(args);
  try {
   await a.run(`begin; set local role service_role; select 1 from public.reader_source_updates where user_id=${q(f.owner)} for update;`);
   expect(JSON.parse(await b.run(`set role service_role; select public.sync_content_analysis_jobs_v2(${q(f.owner)});`))).toEqual({ synchronized: 0 });
   await a.run('commit;'); expect(sync(f).synchronized).toBe(2);
  } finally { a.close(); b.close(); }
 });
 it('scope pause serializes with a candidate claim and rechecks eligibility after waiting', async () => {
  const f = fixture(); scope(f); sync(f); const a = new Session(args), b = new Session(args);
  try {
   await a.run(`begin; set local role service_role; select public.set_content_analysis_rollout_scope(${q(f.owner)},null,'paused');`);
   const pending = b.run(`set role service_role; select public.claim_content_analysis_job_v2(${q(f.owner)},900);`);
   await waiting('claim_content_analysis_job_v2'); await a.run('commit;'); expect(await pending).toBe('');
   expect(claim(f)).toBeNull();
  } finally { a.close(); b.close(); }
 });
 it('a scope change waits for an in-flight reservation and preserves its committed hold', async () => {
  const { f, c } = active(), a = new Session(args), b = new Session(args);
  try {
   await a.run('begin; set local role service_role;'); const paid = JSON.parse(await a.run(reserveSql(c)));
   const pending = b.run(`set role service_role; select public.set_content_analysis_rollout_scope(${q(f.owner)},null,'paused');`);
   await waiting('set_content_analysis_rollout_scope'); await a.run('commit;'); expect(JSON.parse(await pending).phase).toBe('paused');
   expect(call(paid.call.id)).toEqual(paid.call);
  } finally { a.close(); b.close(); }
 });
 it.each(['pause-first', 'publish-first'])('serializes scope changes against actual two-session %s publication', async order => {
  const { f, c } = active(); prepare(c, summary(f)); const prepared = job(c), a = new Session(args), b = new Session(args);
  const pause = `select public.set_content_analysis_rollout_scope(${q(f.owner)},null,'paused');`;
  try {
   await a.run('begin; set local role service_role;'); await a.run(order === 'pause-first' ? pause : publishSql(c));
   const pending = b.run('set role service_role; ' + (order === 'pause-first' ? publishSql(c) : pause))
    .then(value => ({ value, error: '' }), error => ({ value: '', error: String(error) }));
   await waiting(order === 'pause-first' ? 'publish_content_analysis_job' : 'set_content_analysis_rollout_scope');
   await a.run('commit;'); const result = await pending;
   if (order === 'pause-first') {
    expect(result.error).toMatch(/PT409.*scope paused or changed/s); expect(job(c)).toEqual(prepared);
    expect(record(f).videoSummary).toBeUndefined();
   } else {
    expect(result.error).toBe(''); expect(JSON.parse(result.value).phase).toBe('paused');
    expect(job(c).state).toBe('published'); expect(record(f).videoSummary.captionHash).toBe(f.hash);
   }
   expect(claim(f)).toBeNull();
  } finally { a.close(); b.close(); }
 });
 it.each(['review-first', 'publish-first'])('preserves admin rejection during actual two-session %s publication race', async order => {
  const { f, c } = active('keywords');
  service(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
   values(${q(f.owner)},'fixture-video-1',${q(f.source)},'${f.hash}','Nvidia','brand',60,'Synthetic ambiguity','Nvidia makes RTX 5090.','[]','','');`);
  const review = json(`select to_jsonb(r) from public.admin_keyword_reviews r where user_id=${q(f.owner)};`);
  prepare(c, { state: 'ready', patch: { keywordRuleVersion: 'entities-v2' }, pending: [], evidence: { contentHash: f.hash, ruleVersion: 'entities-v2', coverage: [{ start: 0, end: f.record.content.length }], accepted: [{ label: 'Nvidia', kind: 'brand', confidence: 90, reason: 'Explicit brand', evidenceQuote: 'Nvidia makes RTX 5090.', ranges: [] }] } });
  const decide = `select public.admin_review_keyword('${review.id}',${q(review.updated_at)},'synthetic-admin','reject','Nvidia','brand');`, a = new Session(args), b = new Session(args);
  try {
   await a.run('begin; set local role service_role;'); await a.run(order === 'review-first' ? decide : publishSql(c));
   const pending = b.run('set role service_role; ' + (order === 'review-first' ? publishSql(c) : decide));
   await waiting(order === 'review-first' ? 'publish_content_analysis_job' : 'admin_review_keyword');
   await a.run('commit;'); await pending;
   expect(record(f).videoKeywords).toEqual([]);
   expect(json(`select to_jsonb(r) from public.admin_keyword_reviews r where id='${review.id}';`)).toMatchObject({ status: 'rejected', resolved_label: 'Nvidia', resolved_kind: 'brand' });
   expect(job(c).state).toBe('published');
  } finally { a.close(); b.close(); }
 });
});
