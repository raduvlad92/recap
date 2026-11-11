import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildProviderQualityMigrationPlan, assertProviderQualityNativePredecessor } from '../scripts/provider-quality-migration-plan.mjs';
import { providerQualityContract as contract } from '../scripts/provider-quality-migration-contract.mjs';
import { sourcePins } from '../scripts/reader-migration-pins.mjs';
import { dailyUseContract } from '../scripts/daily-use-migration-contract.mjs';
import { ReaderReleaseDb, bodyOf, quote } from './helpers/reader-release-db.mjs';

const input = () => ({ mode: 'rehearse', operationId: '11000000-0000-4000-8000-000000000099',
  sources: contract.sources.map(pin => readFileSync('supabase/migrations/' + pin.file, 'utf8')),
  runtimeFlags: { ACCOUNT_LIFECYCLE_ENABLED: false, ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED: false },
  baseline: { objectsSha256: 'a'.repeat(64), rowsSha256: 'b'.repeat(64), historySha256: 'c'.repeat(64) },
  expectedHosting: { control: { owner: 'cloudflare', epoch: 6, paused: true, release: contract.servingCommit, old_host_fenced: true },
    revision: '90000000-0000-4000-8000-000000000099', work: { queued: 0, running: 0, expired_running: 0, uncertain: 96 } } });

describe('new provider-quality migration admission', () => {
  it('binds native preflight to the already accepted schema/history rather than a refreshed baseline', () => {
    const capture = { objectsSha256: contract.acceptedPredecessorObjectsSha256, historySha256: contract.acceptedPredecessorHistorySha256, rowsSha256: 'a'.repeat(64) };
    assertProviderQualityNativePredecessor(capture);
    assert.throws(() => assertProviderQualityNativePredecessor({ ...capture, objectsSha256: 'b'.repeat(64) }), /schema\/ACL changed/);
    assert.throws(() => assertProviderQualityNativePredecessor({ ...capture, historySha256: 'b'.repeat(64) }), /history changed/);
  });
  for (const [name, change] of [
    ['unpaused', value => { value.expectedHosting.control.paused = false; }],
    ['wrong serving release', value => { value.expectedHosting.control.release = 'f'.repeat(40); }],
    ['queued frame', value => { value.expectedHosting.work.queued = 1; }],
    ['missing baseline', value => { delete value.baseline.rowsSha256; }],
    ['unbound source', value => { value.sources[0] += '\n'; }],
    ['lifecycle activation', value => { value.runtimeFlags.ACCOUNT_LIFECYCLE_ENABLED = true; }],
    ['unreviewed SQL', value => { value.afterSql = 'select 1;'; }],
  ]) it('refuses ' + name, () => { const value = input(); change(value); assert.throws(() => buildProviderQualityMigrationPlan(value)); });
});

describe('new provider-quality transaction on disposable PG17', () => {
  let server;
  before(() => { server = new ReaderReleaseDb(); });
  after(() => server?.close());
  function fixture() {
    const name = server.fresh();
    server.sql(name, readFileSync('tests/fixtures/reader-release/preservation.sql', 'utf8'));
    for (const pin of [...sourcePins.reader, ...dailyUseContract.sources]) {
      const source = readFileSync('supabase/migrations/' + pin.file, 'utf8');
      server.sql(name, source);
      server.sql(name, `insert into supabase_migrations.schema_migrations(version,name,statements)values(${quote(pin.version)},${quote(pin.name)},array[${quote(bodyOf(source))}]::text[]);`);
    }
    server.sql(name, `update public.hosting_runtime_control set release=${quote(contract.servingCommit)};`);
    return { name, args: { ...input(), expectedHosting: JSON.parse(server.sql(name, 'select public.read_hosting_release_status();')), baseline: server.capture(name) } };
  }
  it('rolls back exactly, then applies only pinned objects/history while preserving every old row', () => {
    const { name, args } = fixture(), initial = server.capture(name);
    const receipt = JSON.parse(server.sql(name, buildProviderQualityMigrationPlan(args).sql));
    assert.equal(receipt.phase, 'rehearsed'); assert.deepEqual(server.capture(name), initial);
    const plan = buildProviderQualityMigrationPlan({ ...args, mode: 'apply' });
    assert.equal(JSON.parse(server.sql(name, plan.sql)).phase, 'applied');
    assert.equal(server.capture(name).rowsSha256, initial.rowsSha256);
    assert.equal(server.sql(name, 'select count(*)from supabase_migrations.schema_migrations;'), '60');
    assert.equal(server.sql(name, "select has_function_privilege('anon','public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)','execute')or has_function_privilege('authenticated','public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)','execute');"), 'f');
    assert.throws(() => server.sql(name, plan.sql), /baseline changed|prerequisite history/i);
  });
  it('refuses data changes after capture without refreshing the approved baseline', () => {
    const { name, args } = fixture();
    server.sql(name, "update public.reader_workspaces set state=jsonb_set(state,'{settings,interests}','[\"changed\"]');");
    const changed = server.capture(name);
    assert.throws(() => server.sql(name, buildProviderQualityMigrationPlan({ ...args, mode: 'apply' }).sql), /baseline changed/i);
    assert.deepEqual(server.capture(name), changed);
  });
  it('rejects broader existing financial RPC permissions even with a fresh capture', () => {
    const { name, args } = fixture();
    server.sql(name, 'grant execute on function public.reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)to anon;');
    args.baseline = server.capture(name);
    const changed = server.capture(name);
    assert.throws(() => server.sql(name, buildProviderQualityMigrationPlan({ ...args, mode: 'apply' }).sql), /definition changed|unreviewed object/i);
    assert.deepEqual(server.capture(name), changed);
  });
});
