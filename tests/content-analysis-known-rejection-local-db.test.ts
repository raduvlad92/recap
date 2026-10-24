import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Real DATABASE-ONLY tests. Private Unix socket, TCP disabled, no environment
// credentials or Supabase link/config are read. Every migration is applied.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const model = 'deepseek/fixture-model';
const identity = {
 adapterVersion: 'content-analysis-model-v2', route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
 provider: 'deepinfra/fp8', model, reasoningEffort: 'low', pricing: {
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

// All proof receipts below are synthetic, service-trusted DATABASE fixtures.
// This suite makes no network/provider request and cannot attest live access.
describe.skipIf(!available)('D36 actual PostgreSQL HTTP429 holds and authenticated generation recovery', () => {
 let root: string, args: string[], started = false, sequence = 0;
 const hash = 'a'.repeat(64);
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 const json = (query: string) => JSON.parse(service(query) || 'null');
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recap-known429-db-')); const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55497`, 'start'], { stdio: 'ignore' }); started = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55497', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) sql(readFileSync(new URL(name, directory), 'utf8'));
  service(`insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd) values(true,true,45,45);`);
 }, 20000);
 beforeEach(() => {
  // Only this private disposable cluster; no Supabase configuration is read.
  sql(`truncate public.reader_workspaces cascade; truncate public.reader_content_analysis_calls cascade;
   truncate public.reader_content_analysis_policies; truncate public.content_analysis_provider_cooldowns;
   update public.content_analysis_budget set enabled=true,daily_limit_usd=45,lifetime_limit_usd=45;`);
 });
 afterAll(() => {
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });
 function fixture() {
  const owner = 'known429-fixture-' + ++sequence, source = 'fixture-source';
  const state = { version: 1, followedSourceIds: [source], customSources: [{ id: source, name: 'Synthetic channel', url: 'https://example.org/channel', platform: 'YouTube', status: 'ready', creatorIds: [] }], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {} };
  const record = { id: 'fixture-video', sourceId: source, publishedAt: '2026-10-24T00:00:00Z', url: 'https://example.org/video', title: 'Synthetic provenance', isSample: false, format: 'video', contentKind: 'transcript', content: 'Synthetic saved source words for isolated PostgreSQL tests.', videoFormat: { kind: 'regular', basis: 'watch_page' }, topics: [], brands: [] };
  service(`insert into public.reader_workspaces(user_id,state) values(${quote(owner)},${quote(JSON.stringify(state))});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${quote(owner)},true,1,2,1,${quote(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${quote(owner)},'fixture-video',${quote(source)},'fixture','2026-10-24T00:00:00Z',${quote(JSON.stringify(record))});
   select public.sync_content_analysis_jobs(${quote(owner)},200);
   update public.reader_content_analysis_jobs set state='skipped' where user_id=${quote(owner)} and task='keywords';`);
  const claimed = json(`select public.claim_content_analysis_job(${quote(owner)},900);`);
  return { owner, id: claimed.job.id as string, token: claimed.leaseToken as string };
 }
 type Fixture = ReturnType<typeof fixture>;
 const reserveSql = (f: Fixture, requestHash: string = hash, value: unknown = identity, key = 'summary:chunk:0', maximum = .01) =>
  `select public.reserve_content_analysis_call_v3('${f.id}','${f.token}',${quote(key)},${maximum},${quote(model)},${quote(JSON.stringify(value))}::jsonb,${quote(requestHash)});`;
 const reserve = (f: Fixture) => json(reserveSql(f));
 const call = (id: string) => json(`select to_jsonb(c) from public.reader_content_analysis_calls c where id='${id}';`);
 const job = (f: Fixture) => json(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id='${f.id}';`);
 const now = () => service('select clock_timestamp();');
 function statusSql(f: Fixture, c: { id: string }, receivedAt: string, preGeneration = true, retry: number | null = 0, providerId = 'gen-fixture-001', status = 429) {
  return `select public.record_content_analysis_known_rejection('${c.id}','${f.token}',${quote(hash)},${quote(JSON.stringify(identity))}::jsonb,${status},${retry === null ? 'null' : retry},${quote(providerId)},${quote(receivedAt)},${preGeneration});`;
 }
 const reject = (f: Fixture, c: { id: string }, preGeneration = true) => json(statusSql(f, c, now(), preGeneration));
 const failSql = (f: Fixture, code = 'analysis_provider_http_429', retry = false) => `select public.fail_content_analysis_job('${f.id}','${f.token}',${quote(code)},${retry});`;
 const fail = (f: Fixture, code = 'analysis_provider_http_429', retry = false) => json(failSql(f, code, retry));
 function proof(c: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  return { verification: 'authenticated_generation_get', generationId: 'gen-fixture-001', model, providerSlug: identity.provider, providerName: 'DeepInfra', generationCreatedAt: c.attempt_reserved_at, checkedAt: now(), totalCost: 0, isByok: false, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, evidenceSha256: 'b'.repeat(64), bindingEvidenceSha256: null, ...patch };
 }
 const verifySql = (f: Fixture, c: Record<string, unknown>, receipt: unknown, allow = true, requestHash: string | null = hash) =>
  `select public.record_content_analysis_generation_receipt('${c.id}','${f.token}',${requestHash === null ? 'null' : quote(requestHash)},${quote(JSON.stringify(identity))}::jsonb,${quote(JSON.stringify(receipt))}::jsonb,${allow});`;
 function verified(f: Fixture, allow = true, patch: Record<string, unknown> = {}) {
  const c = reserve(f).call; reject(f, c); fail(f);
  const receipt = proof(c, patch), result = json(verifySql(f, c, receipt, allow));
  return { c: call(c.id), receipt, result };
 }
 function due(f: Fixture, id: string) {
  // Explicit database-only time advancement; no wall-clock minute sleeps.
  sql(`alter table public.reader_content_analysis_calls disable trigger preserve_content_analysis_request;
   update public.reader_content_analysis_calls set retry_not_before=clock_timestamp()-interval '1 second' where id='${id}';
   alter table public.reader_content_analysis_calls enable trigger preserve_content_analysis_request;
   update public.content_analysis_provider_cooldowns set cooldown_until=clock_timestamp()-interval '1 second';
   update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${f.id}';`);
 }
 function claim(f: Fixture) {
  const result = json(`select public.claim_content_analysis_job(${quote(f.owner)},900);`);
  if (result) f.token = result.leaseToken;
  return result;
 }
 it('commits immutable request provenance before permission to contact a provider', () => {
  const f = fixture(), r = reserve(f);
  expect(r.claimed).toBe(true);
  expect(call(r.call.id)).toMatchObject({ request_hash: hash, execution_identity: identity, attempt_number: 1, retry_authorized: false, actual_usd: null, state: 'reserved' });
  expect(() => service(`update public.reader_content_analysis_calls set request_hash=${quote('c'.repeat(64))} where id='${r.call.id}';`)).toThrow(/PT409/);
  expect(reserve(f)).toMatchObject({ claimed: false, call: { id: r.call.id, attempt_number: 1, lease_token: f.token } });
 });
 it.each([true, false])('status-only HTTP429 preGeneration=%s never releases money; duplicates are exact no-ops', preGeneration => {
  const f = fixture(), c = reserve(f).call, received = now();
  const first = json(statusSql(f, c, received, preGeneration, 200));
  expect(first).toMatchObject({ terminal: true, retryEligible: false, call: { actual_usd: null, observed_usd: null, state: 'unknown', generation_receipt: null, retry_authorized: false } });
  expect(Date.parse(first.retryAt) - Date.parse(received)).toBeGreaterThanOrEqual(200000);
  expect(Date.parse(first.retryAt) - Date.parse(received)).toBeLessThan(201000);
  fail(f);
  expect(json(statusSql(f, c, received, preGeneration, 200))).toEqual(first);
  expect(service('select rejection_count from public.content_analysis_provider_cooldowns;')).toBe('1');
  expect(job(f)).toMatchObject({ state: 'blocked', next_attempt_at: 'infinity' });
  expect(json(`select record->'processing' from public.reader_source_updates where user_id=${quote(f.owner)};`)).toMatchObject({ recap: 'blocked', reason: 'analysis_provider_http_429' });
  expect(service('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;')).toBe('0.010000000000');
 });
 it('status and elapsed cooldown alone never permit a new attempt or generic zero settlement', () => {
  const f = fixture(), c = reserve(f).call; reject(f, c);
  due(f, c.id);
  expect(reserve(f)).toMatchObject({ claimed: false, call: { attempt_number: 1, actual_usd: null } });
  expect(() => service(`select public.settle_content_analysis_call('${c.id}',0,0);`)).toThrow(/HTTP429 is not zero charge evidence/);
  expect(() => fail(f, 'analysis_provider_rate_limited', true)).toThrow(/Verified zero generation receipt required/);
  expect(call(c.id).actual_usd).toBeNull();
 });
 it('one shared circuit pauses NEW stable keys and other owners before any hold', () => {
  const a = fixture(), b = fixture(), c = reserve(a).call; reject(a, c);
  expect(json(reserveSql(a, hash, identity, 'another:chunk:0'))).toMatchObject({ claimed: false, reason: 'analysis_provider_cooldown' });
  const pause = json(reserveSql(b)); expect(pause).toMatchObject({ claimed: false, reason: 'analysis_provider_cooldown' });
  expect(pause.call).toBeUndefined();
  expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
  expect(fail(b, 'analysis_provider_cooldown', true)).toMatchObject({ state: 'queued' });
  expect(job(b).attempts).toBe(0);
  expect(claim(b)).toBeNull();
 });
 it('authenticated numeric zero plus explicit authorization queues once and waits for backoff', () => {
  const f = fixture(), { c, receipt, result } = verified(f);
  expect(result).toMatchObject({ retryEligible: true, terminal: false, call: { actual_usd: 0, observed_usd: 0, state: 'settled', retry_authorized: true } });
  expect(job(f)).toMatchObject({ state: 'queued', attempts: 0, error_code: 'analysis_provider_rate_limited' });
  expect(json(`select record->'processing' from public.reader_source_updates where user_id=${quote(f.owner)};`)).toMatchObject({ recap: 'pending', reason: 'analysis_provider_rate_limited' });
  const original = job(f);
  expect(json(verifySql(f, c, receipt))).toEqual(result);
  expect(job(f)).toEqual(original);
  expect(claim(f)).toBeNull();
 });
 it.each([{ totalCost: .002 }, { totalCost: 0, promptTokens: 1 }, { totalCost: 0, completionTokens: 1 }, { totalCost: 0, reasoningTokens: 1 }])('settles accounting but does not authorize replay for %j', patch => {
  const f = fixture(), { c, result } = verified(f, true, patch);
  expect(result.retryEligible).toBe(false); expect(c.retry_authorized).toBe(false);
  due(f, c.id);
  sql(`update public.reader_content_analysis_jobs set state='running',lease_token='${f.token}',lease_until=clock_timestamp()+interval '10 minutes' where id='${f.id}';`);
  expect(reserve(f).claimed).toBe(false);
  expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('0');
 });
 it('settle-only zero is never replayable, even after a config-style reset', () => {
  const f = fixture(), { c, receipt } = verified(f, false);
  expect(c).toMatchObject({ actual_usd: 0, retry_authorized: false });
  due(f, c.id);
  sql(`update public.reader_content_analysis_jobs set state='running',attempts=0,lease_token='${f.token}',lease_until=clock_timestamp()+interval '10 minutes' where id='${f.id}';`);
  expect(reserve(f).claimed).toBe(false);
  expect(json(verifySql(f, c, receipt, false)).retryEligible).toBe(false);
 });
 it('due verified-zero retry keeps the exact key/identity, archives attempt one and makes a fresh hold', () => {
  const f = fixture(), { c } = verified(f); due(f, c.id); expect(claim(f)).not.toBeNull();
  const next = reserve(f);
  expect(next).toMatchObject({ claimed: true, call: { id: c.id, call_key: c.call_key, execution_identity: identity, request_hash: hash, attempt_number: 2, retry_authorized: false, actual_usd: null, observed_usd: null, state: 'reserved', rejection_receipt: null, generation_receipt: null, lease_token: f.token } });
  expect(next.call.lease_token).not.toBe(c.lease_token);
  expect(json(`select to_jsonb(h) from public.reader_content_analysis_call_attempts h;`)).toMatchObject({ call_id: c.id, attempt_number: 1, actual_usd: 0, retry_authorized: true, generation_receipt: c.generation_receipt, rejection_receipt: c.rejection_receipt });
  expect(reserve(f)).toMatchObject({ claimed: false, call: { id: c.id, attempt_number: 2, lease_token: f.token } });
 });
 it.each([
  ['global lifetime', 'update public.content_analysis_budget set lifetime_limit_usd=.005;', 'PT402'],
  ['global daily', 'update public.content_analysis_budget set daily_limit_usd=.005;', 'PT429'],
  ['reader lifetime', 'update public.reader_content_analysis_policies set lifetime_limit_usd=.005;', 'PT402'],
  ['reader daily', 'update public.reader_content_analysis_policies set daily_limit_usd=.005;', 'PT429'],
  ['per call', 'update public.reader_content_analysis_policies set per_call_limit_usd=.005;', 'PT403'],
  ['global disabled', 'update public.content_analysis_budget set enabled=false;', 'PT403'],
  ['reader disabled', 'update public.reader_content_analysis_policies set enabled=false;', 'PT403'],
  ['policy model', "update public.reader_content_analysis_policies set model='other/model';", 'PT403'],
 ])('fresh %s gate fences a due retry without modifying history or hold', (_name, mutation, code) => {
  const f = fixture(), { c } = verified(f); due(f, c.id); claim(f); sql(mutation);
  expect(() => service(reserveSql(f))).toThrow(new RegExp(code));
  expect(call(c.id)).toMatchObject({ attempt_number: 1, actual_usd: 0 });
  expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('0');
 });
 it('attempt three is terminal despite claim-counter/config resets; exponential delay is durable', () => {
  const f = fixture(); let c = reserve(f).call;
  for (let attempt = 1; attempt <= 3; attempt++) {
   const received = now(), status = json(statusSql(f, c, received));
   expect(Date.parse(status.retryAt) - Date.parse(received)).toBeGreaterThanOrEqual(60000 * 2 ** (attempt - 1));
   fail(f);
   const verified = json(verifySql(f, c, proof(c)));
   expect(verified.retryEligible).toBe(attempt < 3);
   expect(call(c.id).attempt_number).toBe(attempt);
   if (attempt < 3) { due(f, c.id); claim(f); c = reserve(f).call; }
  }
  due(f, c.id);
  // A later config reset can give this job a new worker lease. Exhaustion
  // belongs to the stable key, so the new worker can close its job truthfully
  // without changing the old financial attempt or requiring its old token.
  sql(`update public.reader_content_analysis_jobs set state='running',attempts=0,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes' where id='${f.id}';`);
  f.token=job(f).lease_token;
  expect(reserve(f)).toMatchObject({claimed:false,reason:'analysis_provider_retry_exhausted'});
  expect(fail(f,'analysis_provider_retry_exhausted')).toMatchObject({state:'failed'});
  expect(job(f)).toMatchObject({state:'failed',error_code:'analysis_provider_retry_exhausted',next_attempt_at:'infinity'});
  expect(call(c.id).attempt_number).toBe(3);
  expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('2');
 });
 it('request/provider/pricing changes and legacy missing hashes cannot consume cached or unknown calls', () => {
  const f = fixture(), c = reserve(f).call;
  expect(json(reserveSql(f, 'c'.repeat(64)))).toMatchObject({ claimed: false, call: { id: c.id, request_hash: hash } });
  expect(json(reserveSql(f, hash, { ...identity, provider: 'other-provider' }))).toMatchObject({ claimed: false, call: { id: c.id, execution_identity: identity } });
  reject(f, c); fail(f);
  // A separate original v2 call has no pre-call hash. Current configuration is
  // never used to repair that missing evidence.
  sql('truncate public.content_analysis_provider_cooldowns;');
  const legacy = fixture(); const old = json(`select public.reserve_content_analysis_call_v2('${legacy.id}','${legacy.token}','summary:chunk:0',.01,${quote(model)},${quote(JSON.stringify(identity))}::jsonb);`).call;
  expect(json(reserveSql(legacy))).toMatchObject({ claimed: false, call: { id: old.id, request_hash: null, actual_usd: null } });
  expect(() => service(statusSql(legacy, old, now()))).toThrow(/Rejection request identity changed/);
  expect(call(old.id).actual_usd).toBeNull();
 });
 it('returns a valid v2 cached success with its exact result provenance and no invented pre-call hash',()=>{
  const f=fixture(),c=json(`select public.reserve_content_analysis_call_v2('${f.id}','${f.token}','summary:chunk:0',.01,${quote(model)},${quote(JSON.stringify(identity))}::jsonb);`).call;
  const result={value:{synthetic:true},requestHash:hash,executionIdentity:identity,observedUsd:.002,actualUsd:.002};
  service(`select public.record_content_analysis_call_result('${c.id}','${f.token}',${quote(JSON.stringify(result))}::jsonb,'{}','gen-fixture-success',.002,.002);`);
  const original=call(c.id),cached=json(reserveSql(f));
  expect(cached).toEqual({claimed:false,call:original});
  expect(cached.call).toMatchObject({request_hash:null,execution_identity:identity,model,result,actual_usd:.002,attempt_number:1,retry_authorized:false});
  expect(call(c.id)).toEqual(original);
  expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('0');
 });
 const invalidProofs: [string, Record<string, unknown>][] = [
  ['missing cost', { totalCost: null }], ['string cost', { totalCost: '0' }], ['BYOK', { isByok: true }], ['missing BYOK', { isByok: null }],
  ['different model', { model: 'other/model' }], ['different provider', { providerSlug: 'other-provider' }],
  ['different ID', { generationId: 'gen-other-999' }], ['unverified endpoint', { verification: 'client_assertion' }],
  ['body leak', { privatePrompt: 'Synthetic source text' }], ['nonzero fraction token', { promptTokens: .5 }],
  ['old timestamp', { generationCreatedAt: '2020-01-01T00:00:00Z' }], ['future timestamp', { checkedAt: '2100-01-01T00:00:00Z' }],
 ];
 it.each(invalidProofs)('invalid authenticated evidence: %s preserves the entire unknown hold', (_name, patch) => {
  const f = fixture(), c = reserve(f).call; reject(f, c); fail(f); const original = call(c.id);
  expect(() => service(verifySql(f, c, proof(c, patch)))).toThrow(/PT400|PT409/);
  expect(call(c.id)).toEqual(original);
 });
 it('a legacy receipt requires explicit reviewed binding, settles only and never fills its missing hash', () => {
  const f = fixture(), c = json(`select public.reserve_content_analysis_call_v2('${f.id}','${f.token}','summary:chunk:0',.01,${quote(model)},${quote(JSON.stringify(identity))}::jsonb);`).call;
  fail(f, 'analysis_unknown_charge_hold');
  expect(() => service(verifySql(f, c, proof(c), false, null))).toThrow(/Reviewed request to generation binding required/);
  const result = json(verifySql(f, c, proof(c, { bindingEvidenceSha256: 'd'.repeat(64) }), true, null));
  expect(result).toMatchObject({ retryEligible: false, call: { request_hash: null, actual_usd: 0, retry_authorized: false, rejection_receipt: null } });
  sql(`update public.reader_content_analysis_jobs set state='running',lease_token='${f.token}',lease_until=clock_timestamp()+interval '10 minutes' where id='${f.id}';`);
  expect(reserve(f).claimed).toBe(false);
 });
 it.each(['expired lease', 'source replacement', 'unfollow'])('%s fences status recording and preserves its full hold', fence => {
  const f = fixture(), c = reserve(f).call;
  if (fence === 'expired lease') sql(`update public.reader_content_analysis_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${f.id}';`);
  if (fence === 'source replacement') service(`update public.reader_source_updates set record=record||'{"title":"Changed synthetic title"}' where user_id=${quote(f.owner)};`);
  if (fence === 'unfollow') service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${quote(f.owner)};`);
  expect(() => reject(f, c)).toThrow(/PT409/);
  expect(call(c.id)).toMatchObject({ actual_usd: null, rejection_receipt: null, retry_authorized: false });
 });
 it('source replacement after verified zero cannot revive the old job or grant a new hold', () => {
  const f = fixture(), { c } = verified(f); due(f, c.id);
  service(`update public.reader_source_updates set record=record||'{"title":"Changed synthetic title"}' where user_id=${quote(f.owner)};`);
  expect(claim(f)).toBeNull();
  expect(() => service(reserveSql(f))).toThrow(/PT409/);
  expect(call(c.id)).toMatchObject({ attempt_number: 1, actual_usd: 0 });
 });
 it('deleted source erases output; late authenticated settlement preserves finances without restoring a job', () => {
  const f = fixture(), c = reserve(f).call; reject(f, c); fail(f);
  service(`delete from public.reader_workspaces where user_id=${quote(f.owner)};`);
  expect(() => reject(f, c)).toThrow(/PT409/);
  const receipt = proof(c, { totalCost: .003 }), result = json(verifySql(f, c, receipt, false));
  expect(result).toMatchObject({ retryEligible: false, call: { job_id: null, actual_usd: .003, result: null } });
  expect(service(`select count(*) from public.reader_content_analysis_jobs where id='${f.id}';`)).toBe('0');
 });
 it('old settlement/result/receipt cannot touch the next attempt; guarded success still works', () => {
  const f = fixture(), originalToken = f.token, { c } = verified(f); due(f, c.id); claim(f); reserve(f);
  expect(() => service(`select public.settle_content_analysis_call('${c.id}',0,0);`)).toThrow(/Settlement attempt changed/);
  expect(() => service(`select public.settle_content_analysis_call_v2('${c.id}','${originalToken}',0,0);`)).toThrow(/Settlement attempt changed/);
  expect(() => service(`select public.record_content_analysis_call_result('${c.id}','${originalToken}','{"synthetic":true}','{}','gen-old',0,0);`)).toThrow(/Settlement attempt changed/);
  expect(() => service(statusSql({ ...f, token: originalToken }, c, now()))).toThrow(/PT409/);
  expect(call(c.id)).toMatchObject({ attempt_number: 2, actual_usd: null, result: null });
  const result = json(`select public.record_content_analysis_call_result('${c.id}','${f.token}','{"synthetic":true}','{}','gen-new',.002,.002);`);
  expect(result).toMatchObject({ attempt_number: 2, actual_usd: .002, result: { synthetic: true } });
 });
 it('settlement high-water observations cannot be overwritten by a zero generation receipt', () => {
  const f = fixture(), c = reserve(f).call; reject(f, c); fail(f);
  service(`select public.settle_content_analysis_call_v2('${c.id}','${f.token}',.004,.004);`);
  const verified = json(verifySql(f, c, proof(c)));
  expect(verified).toMatchObject({ retryEligible: false, call: { actual_usd: .004, observed_usd: .004, retry_authorized: false } });
 });
 async function waitForLock(pattern: string) {
  const deadline = Date.now() + 4000;
  while (sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and query like ${quote('%' + pattern + '%')};`) === '0') {
   if (Date.now() > deadline) throw new Error('Expected second local session to wait for ' + pattern);
   await new Promise(resolve => setTimeout(resolve, 10));
  }
 }
 it('parallel due workers claim exactly one job and reserve exactly one next attempt', async () => {
  const f = fixture(), { c } = verified(f); due(f, c.id);
  const a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   const first = JSON.parse(await a.run(`select public.claim_content_analysis_job(${quote(f.owner)},900);`));
   expect(first).not.toBeNull();
   const second = await b.run(`set role service_role; select public.claim_content_analysis_job(${quote(f.owner)},900);`);
   expect(second).toBe('');
   f.token = first.leaseToken;
   expect(JSON.parse(await a.run(reserveSql(f))).claimed).toBe(true);
   await a.run('commit;');
   expect(call(c.id)).toMatchObject({ attempt_number: 2, actual_usd: null });
   expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('1');
  } finally { a.close(); b.close(); }
 });
 it('concurrent duplicate HTTP429 receipts create one status/circuit increment and never settle', async () => {
  const f = fixture(), c = reserve(f).call, received = now();
  const a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   const first = JSON.parse(await a.run(statusSql(f, c, received)));
   const pending = b.run(`set role service_role; set statement_timeout='5s'; ${statusSql(f, c, received)}`);
   await waitForLock('record_content_analysis_known_rejection');
   await a.run('commit;');
   expect(JSON.parse(await pending)).toEqual(first);
   expect(service('select rejection_count from public.content_analysis_provider_cooldowns;')).toBe('1');
   expect(call(c.id).actual_usd).toBeNull();
  } finally { a.close(); b.close(); }
 });
 it('receipt budget lock makes overlapping new-owner reservations observe the shared cooldown', async () => {
  const f = fixture(), other = fixture(), c = reserve(f).call;
  const a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   await a.run(statusSql(f, c, now()));
   const pending = b.run(`set role service_role; set statement_timeout='5s'; ${reserveSql(other)}`);
   await waitForLock('reserve_content_analysis_call_v3');
   await a.run('commit;');
   expect(JSON.parse(await pending)).toMatchObject({ claimed: false, reason: 'analysis_provider_cooldown' });
   expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
  } finally { a.close(); b.close(); }
 });
 it('a stale settlement waiting behind retry cannot release the new hold', async () => {
  const f = fixture(), oldToken = f.token, { c } = verified(f); due(f, c.id); claim(f);
  const a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   await a.run(reserveSql(f));
   const pending = b.run(`set role service_role; set statement_timeout='5s'; select public.settle_content_analysis_call_v2('${c.id}','${oldToken}',0,0);`).then(value => ({ value }), error => ({ error: String(error) }));
   await waitForLock('settle_content_analysis_call_v2');
   await a.run('commit;');
   expect(await pending).toMatchObject({ error: expect.stringMatching(/Settlement attempt changed/) });
   expect(call(c.id)).toMatchObject({ attempt_number: 2, actual_usd: null });
  } finally { a.close(); b.close(); }
 });
 it('deletion racing status receipt cannot deadlock or resurrect source evidence', async () => {
  const f = fixture(), c = reserve(f).call, a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s';");
   await a.run(`delete from public.reader_workspaces where user_id=${quote(f.owner)};`);
   const pending = b.run(`set role service_role; set statement_timeout='5s'; ${statusSql(f, c, now())}`).then(value => ({ value }), error => ({ error: String(error) }));
   await waitForLock('record_content_analysis_known_rejection');
   await a.run('commit;');
   expect(await pending).toMatchObject({ error: expect.stringMatching(/Workspace deleted|Analysis job unavailable|Rejection request identity changed/) });
   expect(call(c.id)).toMatchObject({ job_id: null, actual_usd: null, result: null, rejection_receipt: null });
  } finally { a.close(); b.close(); }
 });
 it.each(['anon', 'authenticated'])('denies %s every recovery RPC and private table read in actual PostgreSQL', role => {
  const f = fixture(), c = reserve(f).call;
  const queries = [reserveSql(f), statusSql(f, c, now()), verifySql(f, c, proof(c)), `select public.settle_content_analysis_call_v2('${c.id}','${f.token}',0,0);`, 'select public.content_analysis_provider_key(\'{}\');', 'select * from public.reader_content_analysis_call_attempts;', 'select * from public.content_analysis_provider_cooldowns;', 'select * from public.content_analysis_provider_pauses;', 'select request_hash,generation_receipt from public.reader_content_analysis_calls;'];
  for (const query of queries) expect(() => sql(`set role ${role}; ${query}`)).toThrow(/42501.*permission denied/s);
 });
 it('new functions are invoker/empty-path with no PUBLIC execution; private tables have RLS and no public policy', () => {
  const metadata = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'config',p.proconfig,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_content_analysis_call_v3','record_content_analysis_known_rejection','record_content_analysis_generation_receipt','settle_content_analysis_call_v2','content_analysis_provider_key','preserve_content_analysis_request');`));
  expect(metadata).toHaveLength(6);
  for (const fn of metadata) expect(fn).toMatchObject({ definer: false, config: ['search_path=""'], publicExecute: false });
  expect(sql(`select count(*) from pg_class where oid in ('public.reader_content_analysis_call_attempts'::regclass,'public.content_analysis_provider_cooldowns'::regclass,'public.content_analysis_provider_pauses'::regclass) and relrowsecurity;`)).toBe('3');
  expect(sql(`select count(*) from pg_policies where tablename in ('reader_content_analysis_call_attempts','content_analysis_provider_cooldowns','content_analysis_provider_pauses');`)).toBe('0');
 });
 it.each([
  ['HTTP200 envelope', { status: 200 }], ['negative RetryAfter', { retry: -1 }], ['oversized RetryAfter', { retry: 3601 }],
  ['unsafe request ID', { providerId: 'unsafe ID with spaces' }], ['future timestamp', { receivedAt: '2100-01-01T00:00:00Z' }],
 ])('invalid status receipt %s never changes accounting or opens a circuit', (_name, patch) => {
  const f = fixture(), c = reserve(f).call;
  const values = { status: 429, retry: 0, providerId: 'gen-fixture-001', receivedAt: now(), ...patch };
  expect(() => service(statusSql(f, c, values.receivedAt, true, values.retry, values.providerId, values.status))).toThrow(/PT400/);
  expect(call(c.id)).toMatchObject({ actual_usd: null, state: 'reserved', rejection_receipt: null });
  expect(service('select count(*) from public.content_analysis_provider_cooldowns;')).toBe('0');
 });
 it('bounds shared exponential cooldown to one hour and rejects changed duplicate receipts', () => {
  const f = fixture(), c = reserve(f).call;
  service(`insert into public.content_analysis_provider_cooldowns values(public.content_analysis_provider_key(${quote(JSON.stringify(identity))}::jsonb),6,clock_timestamp()-interval '1 second',clock_timestamp());`);
  const received = now(), first = json(statusSql(f, c, received));
  expect(Date.parse(first.retryAt) - Date.parse(received)).toBeGreaterThanOrEqual(3600000);
  expect(Date.parse(first.retryAt) - Date.parse(received)).toBeLessThan(3601000);
  expect(() => service(statusSql(f, c, received, false))).toThrow(/Rejection receipt is immutable/);
  expect(service('select rejection_count from public.content_analysis_provider_cooldowns;')).toBe('7');
  expect(call(c.id).actual_usd).toBeNull();
 });
 it('a circuit pause after a completed chunk can queue the same job without another hold', () => {
  const f = fixture(), other = fixture(), c = reserve(f).call;
  service(`select public.record_content_analysis_call_result('${c.id}','${f.token}','{"synthetic":true}','{}','gen-fixture-success',.002,.002);`);
  const blocked = reserve(other).call; reject(other, blocked);
  expect(json(reserveSql(f, hash, identity, 'summary:chunk:1'))).toMatchObject({ claimed: false, reason: 'analysis_provider_cooldown' });
  expect(fail(f, 'analysis_provider_cooldown', true)).toMatchObject({ state: 'queued' });
  expect(call(c.id)).toMatchObject({ actual_usd: .002, result: { synthetic: true } });
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id='${f.id}';`)).toBe('1');
 });
 it('ordinary yield and daily budget fairness keep the existing claim-counter behavior', () => {
  const f = fixture();
  expect(json(`select public.fail_content_analysis_job('${f.id}','${f.token}','analysis_checkpoint',false,true);`)).toMatchObject({ state: 'queued' });
  expect(job(f).attempts).toBe(0);
  sql(`update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${f.id}';`); claim(f);
  expect(fail(f, 'analysis_daily_budget_exhausted', true)).toMatchObject({ state: 'blocked' });
  expect(job(f).attempts).toBe(0);
  expect(Date.parse(job(f).next_attempt_at)).toBeGreaterThan(Date.now());
 });
 it('same-second generation ID without a saved ID or reviewed binding cannot release a hold', () => {
  const f = fixture(), c = reserve(f).call;
  const received = now(); json(statusSql(f, c, received, false, null, 'req-fixture-opaque')); fail(f);
  const original = call(c.id);
  const id = 'gen-' + Math.floor(Date.parse(c.attempt_reserved_at) / 1000) + '-fixture';
  expect(() => service(verifySql(f, c, proof(c, { generationId: id })))).toThrow(/Reviewed request to generation binding required/);
  expect(call(c.id)).toEqual(original);
 });
 it('a new verified lookup can explicitly authorize a previously settle-only zero exactly once', () => {
  const f = fixture(), { c, receipt } = verified(f, false);
  const result = json(verifySql(f, c, receipt, true));
  expect(result).toMatchObject({ retryEligible: true, call: { retry_authorized: true } });
  const once = job(f);
  expect(json(verifySql(f, c, receipt, true))).toEqual(result);
  expect(job(f)).toEqual(once);
 });

 it.each([0, .002])('later positive evidence overrides verified cost %s and revokes pending replay permission', initial => {
  const f = fixture(), { c } = verified(f, true, { totalCost: initial });
  const higher = json(`select public.settle_content_analysis_call_v2('${c.id}','${f.token}',.006,.008);`);
  expect(higher).toMatchObject({ actual_usd: .008, observed_usd: .008, retry_authorized: false, generation_receipt: c.generation_receipt });
  expect(json(`select public.settle_content_analysis_call_v2('${c.id}','${f.token}',null,null);`)).toEqual(higher);
  expect(json(`select public.settle_content_analysis_call_v2('${c.id}','${f.token}',.001,.002);`)).toEqual(higher);
  due(f, c.id);
  sql(`update public.reader_content_analysis_jobs set state='running',lease_token='${f.token}',lease_until=clock_timestamp()+interval '10 minutes' where id='${f.id}';`);
  expect(reserve(f)).toMatchObject({ claimed: false, call: { actual_usd: .008, retry_authorized: false } });
  expect(service('select count(*) from public.reader_content_analysis_call_attempts;')).toBe('0');
 });

 it('only authenticated zero releases the cap, and a retry must compete for a fresh financial hold', () => {
  const f = fixture(), other = fixture(), c = reserve(f).call; reject(f, c); fail(f);
  sql('update public.content_analysis_budget set lifetime_limit_usd=.015;'); due(f, c.id);
  expect(() => service(reserveSql(other))).toThrow(/PT402/);
  expect(json(verifySql(f, c, proof(c))).call.actual_usd).toBe(0);
  const competing = reserve(other).call;
  expect(competing.actual_usd).toBeNull();
  claim(f);
  expect(() => service(reserveSql(f))).toThrow(/PT402/);
  service(`select public.settle_content_analysis_call_v2('${competing.id}','${other.token}',.005,.005);`);
  expect(reserve(f)).toMatchObject({ claimed: true, call: { id: c.id, attempt_number: 2, actual_usd: null } });
 });
 it('retry attribution uses its new UTC reservation day while retaining prior evidence', () => {
  const f = fixture(), { c } = verified(f);
  sql(`update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '1 day' where id='${c.id}';`);
  due(f, c.id); claim(f); const retry = reserve(f).call;
  expect(Date.parse(retry.created_at)).toBeGreaterThan(Date.now() - 10000);
  service(`select public.record_content_analysis_call_result('${c.id}','${f.token}','{"synthetic":true}','{}','gen-today',.003,.003);`);
  expect(service(`select sum(actual_usd) from public.reader_content_analysis_calls where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';`)).toBe('0.003000000000');
  expect(json(`select generation_receipt from public.reader_content_analysis_call_attempts where call_id='${c.id}' and attempt_number=1;`)).toEqual(c.generation_receipt);
 });

 it.each(['reserve', 'status'])('natural lease expiry while %s waits on the global budget fails closed', async operation => {
  const f = fixture(), c = operation === 'status' ? reserve(f).call : null;
  const a = new Session(args), b = new Session(args);
  try {
   await a.run("begin; set local role service_role; set local statement_timeout='5s'; select 1 from public.content_analysis_budget where id for update;");
   sql(`update public.reader_content_analysis_jobs set lease_until=clock_timestamp()+interval '0.5 second' where id='${f.id}';`);
   const query = operation === 'status' ? statusSql(f, c!, now()) : reserveSql(f);
   const pending = b.run(`set role service_role; set statement_timeout='5s'; ${query}`).then(value => ({ value }), error => ({ error: String(error) }));
   await waitForLock(operation === 'status' ? 'record_content_analysis_known_rejection' : 'reserve_content_analysis_call_v3');
   await new Promise(resolve => setTimeout(resolve, 650));
   await a.run('commit;');
   expect(await pending).toMatchObject({ error: expect.stringMatching(/PT409.*Analysis lease expired/s) });
   expect(service('select count(*) from public.content_analysis_provider_cooldowns;')).toBe('0');
   if (c) expect(call(c.id)).toMatchObject({ actual_usd: null, rejection_receipt: null, state: 'reserved' });
   else expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('0');
  } finally { a.close(); b.close(); }
 });

 it('a tiny generic positive settlement cannot shrink an unverified 429 hold', () => {
  const f = fixture(), c = reserve(f).call; reject(f, c); fail(f);
  expect(json(`select public.settle_content_analysis_call_v2('${c.id}','${f.token}',.000001,.000001);`)).toMatchObject({ actual_usd: null, observed_usd: .000001, state: 'unknown', generation_receipt: null });
  expect(service('select greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)) from public.reader_content_analysis_calls;')).toBe('0.010000000000');
 });
 it('fresh authenticated lookup metadata can authorize a settled zero while retaining both evidence records', () => {
  const f = fixture(), { c, receipt } = verified(f, false);
  const fresh = { ...receipt, checkedAt: now(), evidenceSha256: 'e'.repeat(64) };
  expect(fresh.checkedAt).not.toBe(receipt.checkedAt);
  const confirmation = json(verifySql(f, c, fresh, true));
  expect(confirmation).toMatchObject({ retryEligible: true, call: { generation_receipt: receipt, retry_authorization_receipt: fresh, retry_authorized: true } });
  const original = job(f); json(verifySql(f, c, fresh, true)); expect(job(f)).toEqual(original);
 });

});
