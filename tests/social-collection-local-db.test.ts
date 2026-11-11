import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => { try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'", j = (v: unknown) => q(JSON.stringify(v)) + '::jsonb';
const source = { id: 'fixture-x', platform: 'X', url: 'https://x.com/source', name: 'Source', status: 'ready' };
const workspace = { version: 1, followedSourceIds: [source.id], customSources: [source], importedUpdates: [], settings: {}, savedUpdateIds: [], readLaterIds: [] };
describe.skipIf(!available)('social discovery on disposable PostgreSQL', () => {
 let root: string, args: string[], started = false;
 const sql = (s: string) => execFileSync('psql', args, { input: s, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 const service = (s: string) => sql('set role service_role;' + s), result = (s: string) => { const value = service(s); if (value === 't' || value === 'f') return value === 't'; try { return JSON.parse(value || 'null'); } catch { return value; } };
 const claim = () => result('select public.claim_social_collection_job(true);');
 const launch = (job: any) => result(`select public.mark_social_collection_launch(${q(job.id)},${q(job.lease_token)});`);
 const run = (job: any, id = 'Run123456') => service(`select public.record_social_collection_run(${q(job.id)},${q(job.lease_token)},${q(id)},'Dataset123');`);
 function item(job: any) { const record = { id: 'social-private-id', sourceId: job.source_key, format: 'post', publishedAt: new Date(Date.parse(job.window_to) - 3600000).toISOString(), isSample: false, url: 'https://x.com/source/status/123456789', content: 'A usable public post.', contentKind: 'feed_text', topics: [], brands: [], sponsors: [], insights: [], references: [] }; return { itemKey: 'x:123456789', revision: 'a'.repeat(64), record }; }
 const finish = (job: any, items: unknown[] = [item(job)], fee: number | null = .001, terminal = true, error: string | null = null) => result(`select public.finish_social_collection_job(${q(job.id)},${q(job.lease_token)},${j(items)},${j({ status: 'partial', complete: false, returned: items.length, accepted: items.length, rejected: {} })},${fee === null ? 'null' : fee},${terminal},${error === null ? 'null' : q(error)});`);
 beforeAll(() => {
  root = mkdtempSync('/tmp/rcsc-'); mkdirSync(join(root, 'socket'));
  execFileSync('initdb', ['-D', join(root, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', join(root, 'data'), '-l', join(root, 'postgres.log'), '-o', `-k ${join(root, 'socket')} -h '' -p 55558`, 'start'], { stdio: 'ignore' }); started = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', join(root, 'socket'), '-p', '55558', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sql(readFileSync(new URL(name, dir), 'utf8'));
 }, 40000);
 beforeEach(() => {
  sql(`truncate public.social_collection_deliveries,public.social_collection_items,public.social_collection_jobs,public.social_collection_consumers,public.social_collection_sources cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_collection_policies cascade;truncate public.collection_jobs cascade;truncate public.collection_budget_reservations cascade;
   update public.social_collection_platforms set enabled=false;
   update public.social_collection_platforms set enabled=true,actor_id='Actor12345',build_id='Build12345',build_number='1.2.3',apify_user_id='User12345',pricing_fingerprint=repeat('a',64),reviewed_at=clock_timestamp(),maximum_usd=.05,daily_limit_usd=.5,lifetime_limit_usd=1.5 where platform='X';
   insert into public.reader_workspaces(user_id,state)values('social-owner',${j(workspace)});
   insert into public.reader_collection_policies(user_id,enabled)values('social-owner',true);`);
 });
 afterAll(() => { if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); if (root) rmSync(root, { recursive: true, force: true }); });
 it('deduplicates a public account shared by two private readers', () => {
  sql(`insert into public.reader_workspaces(user_id,state)values('social-other',${j(workspace)});insert into public.reader_collection_policies(user_id,enabled)values('social-other',true);`);
  expect(result('select public.sync_social_collection_sources();')).toBe(2); expect(service('select count(*)from public.social_collection_sources;')).toBe('1');
  const job = claim(); expect(job.consumers).toHaveLength(2); expect(claim()).toBeNull(); expect(launch(job)).toBe(true); expect(launch(job)).toBe(false); run(job); expect(finish(job).imported).toBe(2);
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('1'); expect(service('select count(*)from public.reader_source_updates;')).toBe('2');
 });
 it('claims once across two native concurrent database sessions', async () => {
  result('select public.sync_social_collection_sources();');
  let ready!: () => void;
  const firstClaimed = new Promise<void>(resolve => { ready = resolve; });
  const firstFinished = new Promise<string>((resolve, reject) => {
   const child = execFile('psql', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
   child.stdout!.once('data', () => ready());
   child.stdin!.end("begin;set role service_role;select public.claim_social_collection_job(true);select pg_sleep(.3);commit;");
  });
  await firstClaimed;
  expect(claim()).toBeNull();
  expect(JSON.parse(await firstFinished).id).toBeTruthy();
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('0');
 });
 function addSources(count: number) {
  const customSources = Array.from({ length: count }, (_, index) => ({ ...source, id: 'capacity-' + index, url: 'https://x.com/capacity' + index }));
  sql(`update public.reader_workspaces set state=${j({ ...workspace, customSources, followedSourceIds: customSources.map(value => value.id) })};`);
  result('select public.sync_social_collection_sources();');
 }
 it('limits all fresh social claims to three outstanding admissions', () => {
  addSources(5);
  const first = claim(), second = claim(), third = claim();
  expect(first.id).toBeTruthy(); expect(second.id).toBeTruthy(); expect(third.id).toBeTruthy(); expect(claim()).toBeNull();
  expect(service("select count(*)from public.social_collection_jobs where state in('claimed','launch_claimed','running');")).toBe('3');
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('0');
  // An explicitly unlaunched failed configuration releases its own admission.
  finish(first, [], null, false, 'configuration_failed');
  expect(claim().id).not.toBe(first.id); expect(claim()).toBeNull();
 });
 it('does not race past the third admission across native sessions/platforms', async () => {
  addSources(5); claim(); claim();
  // A distinct platform is eligible concurrently; the global gate must cover it.
  sql(`update public.social_collection_platforms set enabled=true,actor_id='Other12345',build_id='Build23456',build_number='1.2.3',apify_user_id='User12345',pricing_fingerprint=repeat('a',64),reviewed_at=clock_timestamp()where platform='Instagram';
   update public.reader_workspaces set state=jsonb_set(jsonb_set(state,'{customSources}',state->'customSources'||${j([{ ...source, id: 'instagram-capacity', platform: 'Instagram', url: 'https://www.instagram.com/capacity/' }])}),'\{followedSourceIds\}',state->'followedSourceIds'||'"instagram-capacity"'::jsonb);`);
  result('select public.sync_social_collection_sources();');
  let ready!: () => void;
  const firstClaimed = new Promise<void>(resolve => { ready = resolve; });
  const heldThird = new Promise<string>((resolve, reject) => {
   const child = execFile('psql', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
   child.stdout!.once('data', () => ready());
   child.stdin!.end("begin;set role service_role;select public.claim_social_collection_job(true);select pg_sleep(.3);commit;");
  });
  await firstClaimed; expect(claim()).toBeNull();
  expect(JSON.parse(await heldThird).id).toBeTruthy(); expect(claim()).toBeNull();
  expect(service('select count(*)from public.social_collection_jobs;')).toBe('3');
 });
 it('reconciles accepted runs before the capacity gate even with new launching stopped', () => {
  addSources(4); const first = claim(); claim(); claim(); launch(first); run(first);
  sql(`update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute',next_poll_at=clock_timestamp()-interval'1 minute'where id=${q(first.id)};`);
  const recovered = result('select public.claim_social_collection_job(false);');
  expect(recovered.id).toBe(first.id); expect(recovered.provider_run_id).toBe('Run123456'); expect(recovered.reservation_id).toBeTruthy();
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('1');
 });
 it('recovers the same expired unlaunched reservation without adding capacity', () => {
  addSources(4); const first = claim(); claim(); claim();
  sql(`update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute'where id=${q(first.id)};`);
  const resumed = claim(); expect(resumed.id).toBe(first.id); expect(resumed.reservation_id).toBe(first.reservation_id); expect(resumed.lease_token).not.toBe(first.lease_token);
  expect(launch(first)).toBe(false); expect(launch(resumed)).toBe(true); expect(claim()).toBeNull();
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('1');
 });
 it('isolates ambiguous proof ownership from normal source scheduling without releasing its hold', () => {
  result('select public.sync_social_collection_sources();');
  const proof = result("select public.claim_social_collection_proof('X','https://x.com/source','Source','social-owner');");
  launch(proof); finish(proof, [], null, false, 'ambiguous_launch');
  const normal = claim(); expect(normal.purpose).toBe('collection'); expect(normal.source_key).toBe(proof.source_key);
  expect(service(`select state from public.social_collection_jobs where id=${q(proof.id)};`)).toBe('ambiguous');
  expect(service(`select state from public.collection_budget_reservations where id=${q(proof.reservation_id)};`)).toBe('held');
 });
 it('keeps an expired unlaunched proof operator-owned and counts its admission conservatively', () => {
  addSources(4);
  const proof = result("select public.claim_social_collection_proof('X','https://x.com/proofsource','Proof','social-owner');");
  sql(`update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute'where id=${q(proof.id)};`);
  const a = claim(), b = claim(); expect(a.purpose).toBe('collection'); expect(b.purpose).toBe('collection'); expect(claim()).toBeNull();
  expect(service(`select lease_token from public.social_collection_jobs where id=${q(proof.id)};`)).toBe(proof.lease_token);
  expect(service(`select launch_attempted_at is null and state='held'from public.collection_budget_reservations where id=${q(proof.reservation_id)};`)).toBe('t');
 });
 it('applies the same capacity gate to newly requested operator proofs', () => {
  addSources(4); claim(); claim(); claim();
  expect(result("select public.claim_social_collection_proof('X','https://x.com/capacityproof','Proof','social-owner');")).toBeNull();
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('0');
 });
 it('serializes a proof taking slot three against concurrent recurring admission', async () => {
  addSources(5); claim(); claim();
  let ready!: () => void;
  const proofClaimed = new Promise<void>(resolve => { ready = resolve; });
  const heldProof = new Promise<string>((resolve, reject) => {
   const child = execFile('psql', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
   child.stdout!.once('data', () => ready());
   child.stdin!.end("begin;set role service_role;select public.claim_social_collection_proof('X','https://x.com/lastproof','Proof','social-owner');select pg_sleep(.3);commit;");
  });
  await proofClaimed; expect(claim()).toBeNull(); expect(JSON.parse(await heldProof).purpose).toBe('proof'); expect(claim()).toBeNull();
  expect(service('select count(*)from public.social_collection_jobs;')).toBe('3'); expect(service('select count(*)from public.collection_budget_reservations;')).toBe('1');
 });
 it('reconciles a known accepted proof without taking recurring source ownership', () => {
  result('select public.sync_social_collection_sources();');
  const proof = result("select public.claim_social_collection_proof('X','https://x.com/source','Source','social-owner');");
  launch(proof); run(proof); const normal = claim(); expect(normal.purpose).toBe('collection');
  sql(`update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute',next_poll_at=clock_timestamp()-interval'1 minute'where id=${q(proof.id)};`);
  const recovered = result('select public.claim_social_collection_job(false);'); expect(recovered.id).toBe(proof.id); expect(recovered.purpose).toBe('proof');
  expect(service('select last_checked_at is null and last_complete_until is null from public.social_collection_sources;')).toBe('t');
 });
 it('leaves new routes disabled by default and denies reader/adminless invocation', () => {
  sql('update public.social_collection_platforms set enabled=false;'); result('select public.sync_social_collection_sources();'); expect(claim()).toBeNull();
  expect(() => sql('set role authenticated;select public.sync_social_collection_sources();')).toThrow(); expect(() => sql('set role anon;select * from public.social_collection_items;')).toThrow();
 });
 it('retains the shared cash ceiling and platform daily envelope', () => {
  result('select public.sync_social_collection_sources();'); sql('update public.social_collection_platforms set daily_limit_usd=.04 where platform=\'X\';'); const free=claim();expect(free.id).toBeTruthy();expect(() => launch(free)).toThrow();finish(free,[],null,false,'budget_stopped');
  sql(`update public.social_collection_platforms set daily_limit_usd=.5 where platform='X';select public.reserve_collection_budget('preexisting-proof',44.99,'envelope');`); sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';");const next=claim();expect(next.id).toBeTruthy();expect(() => launch(next)).toThrow();
 });
 it('keeps an ambiguous launch and its full reservation instead of re-posting', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); finish(job, [], null, false, 'ambiguous_launch');
  expect(service('select state from public.social_collection_jobs;')).toBe('ambiguous'); expect(service('select state from public.collection_budget_reservations;')).toBe('held'); expect(claim()).toBeNull();
 });
 it('resumes a crashed claim with the same reservation and fences the stale worker before launch', () => {
  result('select public.sync_social_collection_sources();');const first=claim();
  sql("update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute';");
  const resumed=claim();expect(resumed.id).toBe(first.id);expect(resumed.reservation_id).toBe(first.reservation_id);expect(resumed.lease_token).not.toBe(first.lease_token);
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('0');
  expect(launch(first)).toBe(false);expect(launch(resumed)).toBe(true);
  sql("update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute';");expect(claim()).toBeNull();
 });
 it('settles alongside an hourly policy-first reservation without a cross-session deadlock', async () => {
  result('select public.sync_social_collection_sources();');const job=claim();launch(job);run(job);
  let done!:Promise<string>;
  const ready=new Promise<void>((resolve,reject)=>{
   done=new Promise<string>((finish,fail)=>{
    const child=execFile('psql',[...args,'-c',"set role service_role;begin;select 1 from public.reader_collection_policies where user_id='social-owner' for update;select 'locked';select pg_sleep(.4);select public.reserve_collection_budget('hourly-lock-order-fixture',.001,'job',null,'apify','Actor1234');commit;"],{encoding:'utf8'},(error,stdout)=>error?fail(error):finish(stdout));
    child.stdout?.on('data',data=>{if(String(data).includes('locked'))resolve();});child.on('error',reject);
   });done.catch(reject);
  });
  await ready;expect(finish(job).imported).toBe(1);await expect(done).resolves.toContain('locked');
 });
 it('releases only a verified never-launched configuration failure', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); finish(job, [], null, false, 'configuration_failed');
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('0'); expect(service("select status from public.collection_jobs;")).toBe('blocked');
 });
 it('imports native text with no reservation even when the paid account is exhausted',()=>{
  result('select public.sync_social_collection_sources();');
  sql("select public.reserve_collection_budget('exhausted-paid-envelope',45,'envelope');");
  const job=claim();expect(job.reservation_id).toBeNull();expect(() => launch(job)).toThrow();
  const coverage={status:'partial',complete:false,returned:1,accepted:1,rejected:{},retrieval:'native'};
  const out=result(`select public.finish_social_collection_job(${q(job.id)},${q(job.lease_token)},${j([item(job)])},${j(coverage)},0,true,null);`);
  expect(out.imported).toBe(1);expect(service("select provider||':'||cost_status||':'||observed_cost_usd from public.collection_jobs;")).toBe('feed:no_provider_charge:0.000000000000');
  expect(service('select count(*)from public.collection_budget_reservations;')).toBe('1');
 });
 it('keeps method logs private, preserves their identity and refuses rewriting final outcomes',()=>{
  result('select public.sync_social_collection_sources();');const job=claim();
  const id=service(`insert into public.collection_retrieval_attempts(job_id,method,stage,provider)values(${q(job.collection_job_id)},'x_public_timeline','discovery','native')returning id;`);
  expect(() => sql('set role authenticated;select * from public.collection_retrieval_attempts;')).toThrow();
  expect(() => sql('set role anon;select * from public.collection_retrieval_attempts;')).toThrow();
  expect(() => service(`update public.collection_retrieval_attempts set method='another_method'where id=${q(id)};`)).toThrow();
  service(`update public.collection_retrieval_attempts set status='failed',error_code='source_unavailable',http_status=403,finished_at=clock_timestamp()where id=${q(id)};`);
  expect(() => service(`update public.collection_retrieval_attempts set status='succeeded'where id=${q(id)};`)).toThrow();
 });
 it('imports accepted public items but never revives a reader deleted archive', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); run(job); finish(job);
  sql("delete from public.reader_source_updates where user_id='social-owner';"); expect(service('select deleted from public.social_collection_deliveries;')).toBe('t');
  sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';");
  const later = claim(); launch(later); run(later, 'Run234567'); finish(later); expect(service('select count(*)from public.reader_source_updates;')).toBe('0');
 });
 it('rejects late results after source unfollow or workspace revision changed', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); run(job);
  sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`); expect(finish(job).imported).toBe(0);
  expect(service('select count(*)from public.social_collection_items;')).toBe('1'); expect(service('select count(*)from public.reader_source_updates;')).toBe('0');
 });
 it('delivers a fenced cached original on a later valid cycle without another provider result', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); run(job);
  sql("update public.reader_workspaces set state=jsonb_set(state,'{settings}','{\"interests\":[\"technology\"]}');"); expect(finish(job).imported).toBe(0);
  result('select public.sync_social_collection_sources();'); sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';");
  const later = claim(); launch(later); run(later, 'Run345678'); expect(finish(later, []).imported).toBe(1);
  expect(service('select count(*)from public.reader_source_updates;')).toBe('1');
 });
 it('preserves existing archive identities and curated annotations', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); const previous = { ...item(job).record, id: 'historical-original', sourceId: source.id, insights: ['Approved original finding'] };
  sql(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values('social-owner','historical-original',${q(source.id)},'old',${q(previous.publishedAt)},${j(previous)});`);
  launch(job); run(job); finish(job); expect(result("select record from public.reader_source_updates where id='historical-original';")).toEqual(previous); expect(service('select count(*)from public.reader_source_updates;')).toBe('1');
 });
 it('keeps unknown final charges held and allows polling with launch disabled', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); run(job); finish(job, [item(job)], null);
  expect(service('select state from public.collection_budget_reservations;')).toBe('held'); sql("update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute',next_poll_at=clock_timestamp()-interval'1 minute';update public.social_collection_platforms set enabled=false;");
  expect(result('select public.claim_social_collection_job(false);').id).toBe(job.id);
 });
 it('backs off repeated empty acquisitions and resets after useful source text', () => {
  result('select public.sync_social_collection_sources();');
  const delay = () => Number(service('select extract(epoch from(s.next_check_at-j.finished_at))/3600 from public.social_collection_sources s join lateral(select finished_at from public.social_collection_jobs where source_key=s.source_key and purpose=\'collection\' order by finished_at desc limit 1)j on true;'));
  let sequence = 0;
  const cycle = (useful: boolean) => {
   sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';");
   const job = claim(); launch(job); run(job, 'EmptyRun' + String(++sequence).padStart(4, '0'));
   finish(job, useful ? [item(job)] : []); return delay();
  };
  expect([cycle(false), cycle(false), cycle(false), cycle(false), cycle(false)]).toEqual([1, 2, 4, 6, 6]);
  expect(cycle(true)).toBe(1); expect(cycle(false)).toBe(1);
  expect(service("select count(*)from public.collection_budget_reservations where state='held';")).toBe('0');
  expect(service('select count(*)from public.reader_source_updates;')).toBe('1');
 });
 it('caps persistent blocked-source retries at one day without marking coverage complete', () => {
  result('select public.sync_social_collection_sources();');
  const delays: number[] = [];
  for (let i = 0; i < 6; i++) {
   sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';");
   const job = claim(); launch(job); run(job, 'BlockedRun' + String(i).padStart(4, '0'));
   finish(job, [], .001, true, 'provider_blocked');
   delays.push(Number(service(`select extract(epoch from(s.next_check_at-j.finished_at))/3600 from public.social_collection_sources s join public.social_collection_jobs j on j.id=${q(job.id)};`)));
  }
  expect(delays).toEqual([2, 4, 8, 16, 24, 24]);
  expect(service('select last_complete_until is null and last_discovered_until is null from public.social_collection_sources;')).toBe('t');
  expect(service('select count(*)from public.reader_source_updates;')).toBe('0');
  expect(() => sql("set role anon;select public.social_collection_retry_delay('x.com/source',gen_random_uuid(),false,null);")).toThrow();
  expect(() => sql("set role authenticated;select public.social_collection_retry_delay('x.com/source',gen_random_uuid(),false,null);")).toThrow();
 });
 it('keeps provider reconciliation prompt and unknown charges held during an empty run', () => {
  result('select public.sync_social_collection_sources();');
  const job = claim(); launch(job); run(job);
  const before = service('select next_check_at from public.social_collection_sources;');
  finish(job, [], null, false, 'provider_poll_failed');
  expect(service('select next_check_at from public.social_collection_sources;')).toBe(before);
  expect(Number(service('select extract(epoch from(next_poll_at-lease_until))/60 from public.social_collection_jobs;'))).toBe(5);
  expect(service('select state from public.collection_budget_reservations;')).toBe('held');
  sql("update public.social_collection_jobs set lease_until=clock_timestamp()-interval'1 minute',next_poll_at=clock_timestamp()-interval'1 minute';");
  expect(result('select public.claim_social_collection_job(false);').id).toBe(job.id);
 });
 it('ignores isolated proof failures when scheduling a followed source', () => {
  result('select public.sync_social_collection_sources();');
  for (let i = 0; i < 3; i++) {
   const proof = result("select public.claim_social_collection_proof('X','https://x.com/source','Proof Source','social-owner');");
   launch(proof); run(proof, 'ProofRun' + String(i).padStart(4, '0'));
   finish(proof, [], .001, true, 'provider_blocked');
  }
  const job = claim(); launch(job); run(job, 'NormalRun123'); finish(job, []);
  expect(Number(service(`select extract(epoch from(s.next_check_at-j.finished_at))/3600 from public.social_collection_sources s join public.social_collection_jobs j on j.id=${q(job.id)};`))).toBe(1);
 });
 it('does not qualify LinkedIn or another account by adding private follows', () => {
  const before = result("select state from public.reader_workspaces where user_id='social-owner';");
  const proof = result("select public.claim_social_collection_proof('X','https://x.com/proofsource','Proof Source','social-owner');");
  expect(proof.purpose).toBe('proof'); expect(proof.consumers).toEqual([]); expect(launch(proof)).toBe(true); run(proof); expect(finish(proof, []).imported).toBe(0);
  expect(result("select state from public.reader_workspaces where user_id='social-owner';")).toEqual(before);
 });
 it('retains a known saturated window and pauses that source for reviewed recovery', () => {
  result('select public.sync_social_collection_sources();'); const job = claim(); launch(job); run(job);
  result(`select public.finish_social_collection_job(${q(job.id)},${q(job.lease_token)},${j([item(job)])},${j({ status: 'partial', complete: false, reason: 'result_limit_reached' })},.001,true,null);`);
  expect(service('select paused_reason from public.social_collection_sources;')).toBe('result_limit_reached');
  expect(service('select last_discovered_until is null and last_complete_until is null from public.social_collection_sources;')).toBe('t');
  sql("update public.social_collection_sources set next_check_at=clock_timestamp()-interval'1 minute';"); expect(claim()).toBeNull();
 });
 it('matches native social item aliases without changing old YouTube canonicalization', () => {
  expect(result("select public.social_item_key('Instagram','https://www.instagram.com/reel/AbCd123/');")).toBe('instagram:AbCd123');
  expect(result("select public.social_item_key('LinkedIn','https://www.linkedin.com/posts/source_launch-activity-123456789-xyz');")).toBe('linkedin:123456789');
  expect(result("select public.hourly_item_key('https://www.youtube.com/watch?v=abcdEFGH123');")).toBe('youtube:abcdEFGH123');
 });
});
