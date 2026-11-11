import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildReaderMigrationCapture, buildReaderMigrationPlan } from '../scripts/reader-migration-plan.mjs';
import { sourcePins } from '../scripts/reader-migration-pins.mjs';
import { reviewedContract } from '../scripts/reader-migration-contract.mjs';
import { ReaderReleaseDb, bodyOf, jsonSql, quote, readerSources, sha256 } from './helpers/reader-release-db.mjs';

const operationId = '10000000-0000-4000-8000-000000000001';
const runtimeFlags = { ACCOUNT_LIFECYCLE_ENABLED: false, ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED: false };
const staticInput = () => ({ mode: 'rehearse', operationId, runtimeFlags: { ...runtimeFlags }, sources: readerSources(),
 expectedHosting: { control: { owner: 'cloudflare', epoch: 4, paused: true, release: sourcePins.coreCommit, old_host_fenced: true },
  revision: '90000000-0000-4000-8000-000000000001', work: { queued: 0, running: 0, expired_running: 0, uncertain: 96 } },
 baseline: { objectsSha256: 'a'.repeat(64), rowsSha256: 'b'.repeat(64), historySha256: 'c'.repeat(64) } });
const inputCases = [
 ['unpaused control', i => { i.expectedHosting.control.paused = false; }],
 ['unfenced control', i => { i.expectedHosting.control.old_host_fenced = false; }],
 ['wrong owner', i => { i.expectedHosting.control.owner = 'netlify'; }],
 ['another release', i => { i.expectedHosting.control.release = 'f'.repeat(40); }],
 ['zero epoch', i => { i.expectedHosting.control.epoch = 0; }],
 ['unsafe epoch', i => { i.expectedHosting.control.epoch = Number.MAX_SAFE_INTEGER + 1; }],
 ['missing revision', i => { delete i.expectedHosting.revision; }],
 ['revision injection', i => { i.expectedHosting.revision = "';commit;--"; }],
 ['queued work', i => { i.expectedHosting.work.queued = 1; }],
 ['running work', i => { i.expectedHosting.work.running = 1; }],
 ['expired work', i => { i.expectedHosting.work.expired_running = 1; }],
 ['unknown uncertainty', i => { i.expectedHosting.work.uncertain = null; }],
 ['negative count', i => { i.expectedHosting.work.uncertain = -1; }],
 ['noninteger count', i => { i.expectedHosting.work.uncertain = .5; }],
 ['extra control metadata', i => { i.expectedHosting.control.nativeProof = true; }],
 ['extra work metadata', i => { i.expectedHosting.work.finished = 1; }],
 ['implicit mode', i => { delete i.mode; }],
 ['repair mode', i => { i.mode = 'repair'; }],
 ['missing durable identity', i => { i.operationId = ''; }],
 ['extra SQL hook', i => { i.afterSql = 'select 1'; }],
 ['missing baseline digest', i => { delete i.baseline.rowsSha256; }],
 ['malformed baseline digest', i => { i.baseline.objectsSha256 = 'a'.repeat(63); }],
 ['extra baseline approval', i => { i.baseline.approved = true; }],
 ['lifecycle enabled', i => { i.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED = true; }],
 ['Clerk deletion enabled', i => { i.runtimeFlags.ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED = true; }],
 ['string false', i => { i.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED = 'false'; }],
 ['missing flag declaration', i => { delete i.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED; }],
 ['missing migration', i => { i.sources.pop(); }],
 ['reordered migrations', i => { i.sources.reverse(); }],
 ['extra migration', i => { i.sources.push('select 1;'); }],
];

describe('pure bounded reader migration planner', () => {
 it('pins complete core history and exact source/body bytes to the requested commits', () => {
  assert.equal(sourcePins.core.length, 53);
  assert.equal(sourcePins.reader.length, 4);
  for (const [index, source] of readerSources().entries()) {
   assert.equal(sha256(source), sourcePins.reader[index].sourceSha256);
   assert.equal(sha256(bodyOf(source)), sourcePins.reader[index].bodySha256);
  }
  assert.throws(() => { sourcePins.reader[0].sourceSha256 = 'f'.repeat(64); }, TypeError);
  assert.throws(() => { reviewedContract.changes.length = 0; }, TypeError);
 });
 it('binds the integrated active reader migrations to the exact reviewed fixture bytes', () => {
  const sources=readerSources();
  for(const [index,pin]of sourcePins.reader.entries()){
   const actual=readFileSync(new URL('../supabase/migrations/'+pin.file,import.meta.url),'utf8');
   assert.equal(actual,sources[index],'Active reader migration differs: '+pin.file);
   assert.equal(sha256(actual),pin.sourceSha256);
  }
 });
 it('produces deterministic bounded independent rehearsal/apply hashes, with no effects or caller mutation', () => {
  const input = staticInput(), saved = structuredClone(input), originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Network is forbidden'); };
  try {
   const rehearsal = buildReaderMigrationPlan(input), same = buildReaderMigrationPlan(structuredClone(input));
   const apply = buildReaderMigrationPlan({ ...input, mode: 'apply' });
   assert.equal(rehearsal.transactionSha256, same.transactionSha256);
   assert.equal(sha256(rehearsal.sql), rehearsal.transactionSha256);
   assert.notEqual(rehearsal.transactionSha256, apply.transactionSha256);
   assert(rehearsal.sql.length < 1000000);
   assert.match(rehearsal.sql, /rollback;\n$/); assert.match(apply.sql, /notify pgrst,'reload schema';\ncommit;\n$/);
   assert(!rehearsal.sql.includes('insert into supabase_migrations.schema_migrations'));
   assert(!rehearsal.sql.includes("notify pgrst,'reload schema'"));
   assert.equal(rehearsal.dispatchesSql, false);assert.deepEqual(input, saved);
  } finally { globalThis.fetch = originalFetch; }
 });
 for (const [name, change] of inputCases) it('refuses ' + name, () => { const input = staticInput(); change(input); assert.throws(() => buildReaderMigrationPlan(input)); });
 for (let index = 0; index < 4; index++) {
  for (const [name, change] of [['one-byte edit', s => s + '\n'], ['line-ending edit', s => s.replaceAll('\n', '\r\n')], ['SQL suffix', s => s + 'select 1;']]) {
   it(`refuses ${name} in ${sourcePins.reader[index].version}`, () => {
    const input = staticInput(); input.sources[index] = change(input.sources[index]);assert.throws(() => buildReaderMigrationPlan(input), /Pinned source bytes differ/);
   });
  }
 }
});

describe('actual complete 53-core + four-reader sources on disposable PostgreSQL 17', { concurrency: false }, () => {
 let db;
 const prepare = () => {
  const name = db.fresh();
  const expectedHosting = JSON.parse(db.sql(name, 'select public.read_hosting_release_status();'));
  const baseline = db.capture(name);
  return { name, input: { mode: 'apply', operationId, runtimeFlags, sources: readerSources(), expectedHosting, baseline } };
 };
 const own = (name, query, sub = 'synthetic-owner-1', iss = 'https://synthetic.example') => db.sql(name,
  `set role authenticated;set request.jwt.claims=${quote(JSON.stringify({ sub, iss }))};` + query);
 const service = (name, query) => db.sql(name, 'set role service_role;' + query);
 const financials = name => db.sql(name, `select jsonb_build_object(
  'model',(select jsonb_agg(to_jsonb(c)-'erased_job_id'order by id)from public.reader_content_analysis_calls c),
  'reservations',(select jsonb_agg(to_jsonb(r)order by id)from public.collection_budget_reservations r),
  'providers',(select jsonb_agg(to_jsonb(j)order by id)from public.reader_collection_provider_jobs j),
  'fees',(select jsonb_agg(to_jsonb(r)order by id)from public.collection_provider_fee_receipts r),
  'domain',public.read_automatic_hosting_domain_evidence()-'calls_hash');`);
 const assertCoreOnly = name => {
  assert.equal(db.sql(name, 'select count(*)from supabase_migrations.schema_migrations;'), '53');
  assert.equal(db.sql(name, "select count(*)from pg_tables where schemaname='public';"), '62');
  assert.equal(db.sql(name, "select to_regclass('recap_internal.account_deletions')is null;"), 't');
 };
 const executeFault = (name, input, fault) => {
  const before = db.capture(name), finances = financials(name);
  const plan = buildReaderMigrationPlan(input);
  // Test-only tampering; the public builder has no injection/repair option.
  const corrupted = plan.sql.replace('-- READER_AFTER_BODIES', () => fault + '\n-- READER_AFTER_BODIES');
  assert.throws(() => db.sql(name, corrupted), /Original rows changed|Unexpected new rows|Identity activation|Unreviewed metadata|Reviewed object result|Original migration history changed|Original erased job|Hosting state changed/);
  assert.deepEqual(db.capture(name), before, 'Failure must roll back the entire real transaction');
  assert.equal(financials(name), finances);assertCoreOnly(name);
 };
 before(() => {
  db = new ReaderReleaseDb();
  db.sql('reader_core', readFileSync(new URL('./fixtures/reader-release/preservation.sql', import.meta.url), 'utf8'));
 }, { timeout: 60000 });
 after(() => { db?.close(); });

 it('captures only digests and leaves all core rows/schema/history exact', () => {
  const { name, input } = prepare(), capture = buildReaderMigrationCapture();
  assert.equal(sha256(capture.sql), capture.transactionSha256);
  assert.deepEqual(JSON.parse(db.sql(name, capture.sql)), input.baseline);
  assert.deepEqual(db.capture(name), input.baseline);assertCoreOnly(name);
 });
 it('rehearses the real combined sources, rolls back every object/row/history change, then applies once', () => {
  const { name, input } = prepare(), before = db.capture(name), money = financials(name);
  db.sql(name, buildReaderMigrationPlan({ ...input, mode: 'rehearse' }).sql);
  assert.deepEqual(db.capture(name), before);assertCoreOnly(name);assert.equal(financials(name), money);
  db.sql(name, buildReaderMigrationPlan(input).sql);
  assert.equal(financials(name), money);
  assert.equal(db.sql(name, 'select count(*)from public.reader_workspaces;'), '3');
  assert.equal(db.sql(name, 'select count(*)from public.reader_source_updates;'), '3');
  assert.equal(db.sql(name, 'select count(*)from public.reader_content_analysis_calls where actual_usd is null;'), '7');
  assert.equal(db.sql(name, "select count(*)from public.collection_budget_reservations where state='held'and actual_cost_usd is null;"), '19');
  assert.equal(db.sql(name, 'select count(*)from supabase_migrations.schema_migrations;'), '57');
  for (const pin of sourcePins.reader) {
   assert.equal(db.sql(name, `select name||':'||cardinality(statements)||':'||encode(sha256(convert_to(statements[1],'UTF8')),'hex')from supabase_migrations.schema_migrations where version=${quote(pin.version)};`), pin.name + ':1:' + pin.bodySha256);
  }
  assert.deepEqual(JSON.parse(db.sql(name, 'select public.read_hosting_release_status();')), input.expectedHosting);
  assert.equal(db.sql(name, 'select count(*)from recap_internal.account_deletions;'), '0');
  assert.equal(db.sql(name, 'select mode||\':\'||lifecycle_ready from recap_internal.reader_identity_settings;'), 'legacy:false');
 });
 it('matches every individually reviewed transition when executing the pinned source bodies', () => {
  const { name, input } = prepare(), before = new Map(db.catalogue(name).map(x => [x.key, x.sha256]));
  db.sql(name, buildReaderMigrationPlan(input).sql);
  const actual = db.catalogue(name).filter(x => before.get(x.key) !== x.sha256).map(x => ({ key: x.key, beforeSha256: before.get(x.key) ?? null, afterSha256: x.sha256 }));
  assert.deepEqual(actual, reviewedContract.changes.map(({ key, beforeSha256, afterSha256 }) => ({ key, beforeSha256, afterSha256 })));
 });
 it('preserves unrelated pre-existing column grants, comments and default privileges', () => {
  const { name, input } = prepare();
  db.sql(name, `grant select(user_id)on public.reader_content_analysis_calls to authenticated;
   comment on table public.reader_source_updates is 'Synthetic preserved comment';
   alter default privileges in schema recap_internal grant select on tables to service_role;`);
  const original = db.capture(name);input.baseline = original;
  db.sql(name, buildReaderMigrationPlan(input).sql);
  assert.equal(db.sql(name, "select has_column_privilege('authenticated','public.reader_content_analysis_calls','user_id','SELECT');"), 't');
  assert.equal(db.sql(name, "select obj_description('public.reader_source_updates'::regclass,'pg_class');"), 'Synthetic preserved comment');
  assert.equal(service(name, 'select count(*)from recap_internal.reader_identity_settings;'), '1');
  assert.throws(() => service(name, 'select *from recap_internal.account_deletions;'), /42501/);
 });
 it('emits no rehearsal notification and exactly one committed schema reload', async () => {
  const { name, input } = prepare(), listener = db.session(name);
  try {
   await listener.command('listen pgrst;');
   db.sql(name, buildReaderMigrationPlan({ ...input, mode: 'rehearse' }).sql);
   assert(!/Asynchronous notification/.test(await listener.command('select 1;')));
   db.sql(name, buildReaderMigrationPlan(input).sql);
   const output = await listener.command('select 1;');
   assert.equal((output.match(/Asynchronous notification "pgrst" with payload "reload schema"/g) || []).length, 1);
   assert(!/Asynchronous notification/.test(await listener.command('select 1;')));
  } finally { listener.close(); }
 });

 const preDrifts = [
  ['row/hold', "update public.reader_content_analysis_calls set observed_usd=.004 where call_key='synthetic-call-2';"],
  ['full model row metadata', "update public.reader_content_analysis_calls set usage='{}'where call_key='synthetic-call-2';"],
  ['schema grant', 'grant select on public.reader_content_analysis_calls to authenticated;'],
  ['schema default', "alter table public.reader_source_updates alter column collection_id set default 'changed';"],
  ['migration name', "update supabase_migrations.schema_migrations set name='changed'where version='20261105011050';"],
  ['migration statements', "update supabase_migrations.schema_migrations set statements=array['changed']where version='20261105011050';"],
  ['migration version', "delete from supabase_migrations.schema_migrations where version='20261105011050';"],
  ['control revision', "update public.hosting_runtime_control set release_revision=gen_random_uuid();"],
  ['pause', 'update public.hosting_runtime_control set paused=false;'],
  ['release', "update public.hosting_runtime_control set release=repeat('f',40);"],
  ['fence', 'update public.hosting_runtime_control set old_host_fenced=false;'],
  ['queued work', "insert into public.hosting_work(key,kind,epoch,release,state)values('synthetic:queued','http',4,'182457410f7f8e979348d10347fe50b1e94b295b','queued');"],
  ['running work', "insert into public.hosting_work(key,kind,epoch,release,state,lease_until)values('synthetic:running','http',4,'182457410f7f8e979348d10347fe50b1e94b295b','running',clock_timestamp()-interval'1 hour');"],
 ];
 for (const [name, drift] of preDrifts) it('refuses stale ' + name + ' before migration', () => {
  const prepared = prepare();db.sql(prepared.name, drift);const drifted = db.capture(prepared.name);
  assert.throws(() => db.sql(prepared.name, buildReaderMigrationPlan(prepared.input).sql), /Hosting release|Captured rows|Expected exactly/);
  assert.deepEqual(db.capture(prepared.name), drifted);
  assert.equal(db.sql(prepared.name, "select to_regclass('recap_internal.account_deletions')is null;"), 't');
 });
 it('refuses a fresh baseline with unrecognized objects or a wrong core history identity', () => {
  for (const drift of ['create table public.unexpected_reader_table(id int);', 'create table public.supabase_migrations_shadow(id int);', "update supabase_migrations.schema_migrations set name='wrong'where version='20261105011050';"]) {
   const { name, input } = prepare();db.sql(name, drift);input.baseline = db.capture(name);
   assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql), /Unexpected existing schema|Core migration history/);
   assert.deepEqual(db.capture(name), input.baseline);
  }
 });
 it('refuses running automatic domain work even when the hosting frame counts are drained', () => {
  const { name, input } = prepare();
  db.sql(name, `insert into public.keyword_learning_sessions(id,user_id,state,sources,models,maximum_usd,max_calls,expires_at)
   values('a0000000-0000-4000-8000-000000000001','synthetic-owner-1','released','[{"synthetic":true}]',array['openai/gpt-6-luna-pro'],.1,2,clock_timestamp()+interval'1 hour');
   update public.automatic_content_tasks set state='running',session_id='a0000000-0000-4000-8000-000000000001',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'1 hour';`);
  input.baseline = db.capture(name);
  assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql), /Automatic domain work must be drained/);
  assert.deepEqual(db.capture(name), input.baseline);
 });

 const faults = [
  ['financial observation', "update public.reader_content_analysis_calls set observed_usd=.004 where call_key='synthetic-call-2';"],
  ['unknown hold deletion', "delete from public.reader_content_analysis_calls where call_key='synthetic-call-2';"],
  ['source maximum', "update public.collection_budget_reservations set maximum_usd=.006 where request_key='synthetic-reservation-2';"],
  ['cost cap', 'update public.collection_budget_accounts set ceiling_usd=44;'],
  ['workspace clear', "delete from public.reader_workspaces where user_id='synthetic-owner-3';"],
  ['archive change', "update public.reader_source_updates set record=record||'{\"title\":\"Changed\"}'::jsonb where user_id='synthetic-owner-3';"],
  ['extra ordinary row', "insert into public.admin_audit_events(admin_id,action)values('synthetic-operator','synthetic.injected');"],
  ['migration history', "update supabase_migrations.schema_migrations set name='changed'where version='20261105011050';"],
  ['old table ACL', 'grant select on public.reader_content_analysis_calls to authenticated;'],
  ['column ACL', 'grant select(user_id)on public.reader_content_analysis_calls to authenticated;'],
  ['row type ACL', 'grant usage on type public.reader_workspaces to authenticated;'],
  ['default privileges', 'alter default privileges in schema public grant select on tables to authenticated;'],
  ['old column default', "alter table public.reader_source_updates alter column collection_id set default 'changed';"],
  ['old index', 'drop index public.content_analysis_calls_owner_date;'],
  ['old trigger', 'alter table public.reader_workspaces disable trigger reader_workspace_updated_at;'],
  ['old function metadata', "comment on function public.hourly_item_key(text)is 'Changed';"],
  ['old function body', "create or replace function public.hourly_item_key(p_url text)returns text language sql immutable set search_path=''as $$select 'changed'::text$$;"],
  ['reviewed ownership policy', 'alter policy reader_workspace_select on public.reader_workspaces using(true);'],
  ['unreviewed policy', 'create policy injected on public.reader_workspaces for select using(true);'],
  ['new private table RLS', 'alter table recap_internal.account_deletions disable row level security;'],
  ['new private table ACL', 'grant select on recap_internal.account_deletions to service_role;'],
  ['new RPC ACL', 'grant execute on function public.request_account_deletion(text,uuid,text,text)to authenticated;'],
  ['new helper security', 'alter function recap_internal.current_reader_owner()security invoker;'],
  ['linked mode activation', "update recap_internal.reader_identity_settings set mode='linked',lifecycle_ready=true;"],
  ['issuer trust seed', "insert into recap_internal.reader_identity_issuers(issuer)values('https://synthetic.example');"],
  ['tombstone seed', "insert into recap_internal.account_deletions(user_id,id,identity_issuer,identity_subject)values('synthetic-tombstone','a0000000-0000-4000-8000-000000000001','https://synthetic.example','synthetic-tombstone');"],
  ['new relation', 'create table recap_internal.injected_table(id int);'],
  ['new helper', 'create function recap_internal.injected_helper()returns int language sql as $$select 1$$;'],
  ['control mutation', 'update public.hosting_runtime_control set paused=false;'],
 ];
 for (const [description, fault] of faults) it('rolls back injected ' + description + ' with every original row intact', () => {
  const { name, input } = prepare();executeFault(name, input, fault);
 });
 it('rolls back a hard SQL failure after all migration bodies without partial schema/history', () => {
  const { name, input } = prepare(), before = db.capture(name);
  assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql.replace('-- READER_AFTER_BODIES', 'select 1/0;\n-- READER_AFTER_BODIES')), /22012/);
  assert.deepEqual(db.capture(name), before);assertCoreOnly(name);
 });
 it('includes history-trigger side effects in final row preservation checks', () => {
  const { name, input } = prepare();
  db.sql(name, `create function supabase_migrations.synthetic_history_side_effect()returns trigger language plpgsql as $$
   begin update public.reader_content_analysis_calls set observed_usd=.004 where call_key='synthetic-call-2';return new;end$$;
   create trigger synthetic_history_side_effect after insert on supabase_migrations.schema_migrations for each row execute function supabase_migrations.synthetic_history_side_effect();`);
  input.baseline = db.capture(name);
  assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql), /Original rows changed/);
  assert.deepEqual(db.capture(name), input.baseline);assertCoreOnly(name);
 });
 it('refuses empty partial installs, conflicting rows, and history-only partial applies without repairing', () => {
  for (const [index, suffix] of [[0, ''], [0, "insert into recap_internal.account_deletions(user_id,id,identity_issuer,identity_subject)values('synthetic-owner-1','a0000000-0000-4000-8000-000000000001','https://synthetic.example','synthetic-owner-1');"], [-1, "insert into supabase_migrations.schema_migrations(version,name,statements)values('20261107203128','account_lifecycle',array['ambiguous']);"]]) {
   const { name, input } = prepare();if (index >= 0) db.sql(name, input.sources[index]);if (suffix) db.sql(name, suffix);
   input.baseline = db.capture(name);const before = input.baseline;
   assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql), /Unexpected existing schema|Expected exactly 53/);
   assert.deepEqual(db.capture(name), before);
  }
 });
 it('refuses both an old apply retry and a rebuilt plan after successful apply; reads reconcile instead', () => {
  const { name, input } = prepare(), plan = buildReaderMigrationPlan(input);db.sql(name, plan.sql);
  const after = db.capture(name);assert.throws(() => db.sql(name, plan.sql), /Captured rows/);
  assert.throws(() => db.sql(name, buildReaderMigrationPlan({ ...input, baseline: after }).sql), /Expected exactly 53/);
  assert.deepEqual(db.capture(name), after);
 });
 it('bounds lock conflicts instead of racing an active writer or changing its lease', async () => {
  const { name, input } = prepare(), writer = db.session(name);
  try {
   await writer.command("begin;update public.reader_content_analysis_calls set observed_usd=.004 where call_key='synthetic-call-2';");
   assert.throws(() => db.sql(name, buildReaderMigrationPlan(input).sql), /55P03/);
   await writer.command('rollback;');assert.deepEqual(db.capture(name), input.baseline);assertCoreOnly(name);
  } finally { writer.close(); }
 });
 it('retains legacy owner reads/writes and denies cross-owner access or reassignment with every activation off', () => {
  const { name, input } = prepare();db.sql(name, buildReaderMigrationPlan(input).sql);
  assert.equal(own(name, 'select public.current_reader_owner();'), 'synthetic-owner-1');
  assert.equal(own(name, 'select count(*)from public.reader_workspaces;'), '1');
  assert.equal(own(name, 'select count(*)from public.reader_source_updates;'), '1');
  assert.equal(own(name, "select count(*)from public.reader_workspaces where user_id='synthetic-owner-2';"), '0');
  assert.equal(own(name, "with changed as(update public.reader_workspaces set state=state where user_id='synthetic-owner-2'returning*)select count(*)from changed;"), '0');
  assert.throws(() => own(name, "update public.reader_workspaces set user_id='synthetic-owner-new';"), /42501/);
  assert.equal(own(name, 'update public.reader_workspaces set state=state returning user_id;'), 'synthetic-owner-1');
  assert.equal(service(name, "select public.reader_provider_subject('synthetic-owner-1','https://synthetic.example');"), 'synthetic-owner-1');
  assert.throws(() => service(name, "select public.bind_reader_identity_alias('https://synthetic.example','synthetic-alias','synthetic-owner-1','synthetic-operator','synthetic-review');"), /PT403/);
  for (const table of ['reader_identity_issuers', 'reader_identity_aliases', 'reader_identity_events', 'account_deletions'])assert.equal(db.sql(name, `select count(*)from recap_internal.${table};`), '0');
 });
 it('enforces actual private table ACLs/RLS, invoker wrappers, and service-only mutation RPCs', () => {
  const { name, input } = prepare();db.sql(name, buildReaderMigrationPlan(input).sql);
  const tables = ['account_deletions', 'account_deletion_retention_proofs', 'account_deletion_external_work', 'account_deletion_external_receipts',
   'account_deletion_identities', 'account_deletion_identity_steps', 'reader_identity_settings', 'reader_identity_issuers', 'reader_identity_aliases', 'reader_identity_events'];
  for (const table of tables) {
   assert.equal(db.sql(name, `select relrowsecurity and not relforcerowsecurity from pg_class where oid='recap_internal.${table}'::regclass;`), 't');
   for (const role of ['anon', 'authenticated'])assert.throws(() => db.sql(name, `set role ${role};select *from recap_internal.${table};`), /42501/);
   assert.throws(() => service(name, `delete from recap_internal.${table};`), /42501/);
  }
  const rpc = 'public.request_account_deletion(text,uuid,text,text)';
  for (const role of ['anon', 'authenticated'])assert.equal(db.sql(name, `select has_function_privilege('${role}','${rpc}','EXECUTE');`), 'f');
  assert.equal(db.sql(name, `select has_function_privilege('service_role','${rpc}','EXECUTE');`), 't');
  assert.equal(db.sql(name, "select prosecdef from pg_proc where oid='public.current_reader_owner()'::regprocedure;"), 'f');
  assert.equal(db.sql(name, "select prosecdef from pg_proc where oid='recap_internal.current_reader_owner()'::regprocedure;"), 't');
  assert.throws(() => own(name, "select public.resolve_reader_owners('https://synthetic.example',array['synthetic-owner-2']);"), /42501/);
 });
 it('keeps a disposable tombstone mandatory with flags off, and never erases payloads or releases unknown financial holds', () => {
  const { name, input } = prepare();db.sql(name, buildReaderMigrationPlan(input).sql);const finances = financials(name);
  const request = `select public.request_account_deletion('synthetic-owner-1','a0000000-0000-4000-8000-000000000001','https://synthetic.example','synthetic-owner-1');`;
  const first = JSON.parse(service(name, request));assert.equal(first.backupExpiryActivated, false);
  assert.deepEqual(JSON.parse(service(name, request)), first);
  assert.equal(own(name, 'select public.current_reader_owner();'), '');
  assert.equal(own(name, 'select count(*)from public.reader_workspaces;'), '0');
  assert.equal(own(name, 'select count(*)from public.reader_source_updates;'), '0');
  assert.equal(own(name, 'select count(*)from public.reader_workspaces;', 'synthetic-owner-2'), '1');
  assert.equal(service(name, "select public.resolve_account_deletion_owner('https://synthetic.example','synthetic-owner-1');"), 'synthetic-owner-1');
  assert.throws(() => service(name, "update public.reader_content_analysis_policies set enabled=true where user_id='synthetic-owner-1';"), /PT403/);
  assert.equal(own(name, 'with changed as(update public.reader_workspaces set state=state returning*)select count(*)from changed;'), '0');
  assert.throws(() => db.sql(name, 'delete from recap_internal.account_deletions;'), /PT409/);
  assert.equal(db.sql(name, "select mode||':'||lifecycle_ready from recap_internal.reader_identity_settings;"), 'legacy:false');
  assert.equal(db.sql(name, 'select count(*)from public.reader_workspaces;'), '3');
  assert.equal(db.sql(name, 'select count(*)from public.reader_source_updates;'), '3');
  assert.equal(financials(name), finances);
  assert.equal(db.sql(name, 'select count(*)from recap_internal.account_deletion_retention_proofs;'), '0');
  assert.equal(db.sql(name, 'select count(*)from recap_internal.account_deletion_identity_steps;'), '0');
 });
});
