import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The shared disposable PostgreSQL harness is plain ESM.
import { ReaderReleaseDb, readerSources, quote } from './helpers/reader-release-db.mjs';

const migration = '20261125103322_monthly_provider_budget.sql';
const dir = new URL('../supabase/migrations/', import.meta.url);
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
});
const apify = (key: string, maximum: number, parent = 'null') =>
  `(public.reserve_collection_budget(${quote(key)},${maximum},'job',${parent},'apify','FixtureActor')).id`;
const models = (key: string, count: number, maximum = 1) =>
  `insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd)
   select 'monthly-fixture',${quote(key)}||n,gen_random_uuid(),'fixture-model',repeat('a',64),${maximum} from generate_series(1,${count}) n;`;

describe.skipIf(!available)('monthly provider budget in disposable PostgreSQL', () => {
  let db: ReaderReleaseDb;
  beforeAll(() => { db = new ReaderReleaseDb(); }, 40_000);
  afterAll(() => db?.close());

  function fixture(before = '') {
    const name = db.fresh();
    const sql = (input: string) => db.sql(name, input);
    const service = (input: string) => sql('set role service_role; ' + input);
    for (const source of readerSources()) sql(source);
    for (const file of readdirSync(dir).filter(name => name >= '20261111023125' && name < migration && name.endsWith('.sql')).sort()) {
      sql(readFileSync(new URL(file, dir), 'utf8'));
    }
    if (before) sql(before);
    sql(readFileSync(new URL(migration, dir), 'utf8'));
    return { name, sql, service, status: () => JSON.parse(service('select public.read_monthly_provider_budget()')) };
  }

  it('enforces one combined cap, records all three alerts, and separates spend from reservations', () => {
    const f = fixture();
    const id = f.service(`select ${apify('fixture:apify',10)}`);
    expect(f.status()).toMatchObject({ spentUsd: 0, committedUsd: 10, unresolvedUsd: 10, alerts: [50], paused: false });
    f.service(`select public.claim_collection_budget('${id}'); select public.settle_collection_budget('${id}','FixtureRun',9.5,true);`);
    f.service(models('fixture:model', 7, .95));
    expect(f.status()).toMatchObject({ apifyUsd: 9.5, openrouterUsd: 0, spentUsd: 9.5, committedUsd: 16.15, alerts: [50,80], paused: false });
    const last = f.service(`select ${apify('fixture:final',3.85)}`);
    expect(f.status()).toMatchObject({ limitUsd: 20, committedUsd: 20, unresolvedUsd: 10.5, alerts: [50,80,100], paused: true });
    expect(() => f.service(`select ${apify('fixture:denied',.005)}`)).toThrow(/PT402[\s\S]*provider_monthly_budget_exhausted/);
    expect(() => f.service(models('fixture:denied-model',1,.01))).toThrow(/PT402[\s\S]*provider_monthly_budget_exhausted/);
    expect(f.service(`select ${apify('fixture:final',3.85)}`)).toBe(last);
    expect(f.service('select count(*) from recap_internal.monthly_provider_budget_alerts')).toBe('3');
    f.service(`select public.release_collection_budget('${last}');`);
    expect(f.status()).toMatchObject({ committedUsd: 16.15, paused: false, alerts: [50,80,100] });
  });

  it('rolls settled costs out at UTC midnight, carries earlier holds, and counts envelope children once', () => {
    const f = fixture(`
      insert into public.collection_budget_reservations(request_key,kind,provider,actor_id,maximum_usd,state,actual_cost_usd,completed_at,created_at)
      values('fixture:old-fee','job','apify','FixtureActor',9,'settled',9,'2030-01-31 23:59+00','2030-01-31 23:59+00');
      insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)
      values('fixture','old-unknown',gen_random_uuid(),'fixture-model',repeat('a',64),.25,'unknown','2030-01-31 23:59+00');`);
    const stats = (at: string) => JSON.parse(f.service(`select to_jsonb(s) from public.monthly_provider_budget_snapshot(${quote(at)}) s`));
    expect(stats('2030-01-31 23:59:59+00')).toMatchObject({ apify_usd: 9, committed_usd: 9.25 });
    expect(stats('2030-02-01 00:00:00+00')).toMatchObject({ apify_usd: 0, committed_usd: .25, unresolved_usd: .25 });
    const parent = f.service("select (public.reserve_collection_budget('fixture:parent',5,'envelope')).id");
    const child = f.service(`select ${apify('fixture:child',2,quote(parent))}`);
    expect(f.status()).toMatchObject({ committedUsd: 5.25 });
    f.service(`select public.claim_collection_budget('${child}'); select public.settle_collection_budget('${child}','FixtureChild',1.5,true);`);
    expect(f.status()).toMatchObject({ apifyUsd: 1.5, committedUsd: 5.25 });
    f.service(`select public.close_collection_budget_envelope('${parent}',true);`);
    expect(f.status()).toMatchObject({ apifyUsd: 1.5, committedUsd: 1.75 });
  });

  it('serializes competing Apify and OpenRouter reservations and rolls back an over-limit statement', async () => {
    const f = fixture();
    const apifySession = db.session(f.name), modelSession = db.session(f.name);
    try {
      await apifySession.command(`set role service_role; begin; select ${apify('fixture:race',11)};`);
      const attempt = modelSession.command(`set role service_role; ${models('fixture:race',10)}`)
        .then(() => 'admitted', (error: unknown) => String(error));
      let blocked = false;
      for (let i = 0; i < 50 && !blocked; i++) {
        blocked = f.sql("select exists(select 1 from pg_locks where locktype='advisory' and not granted)") === 't';
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      await apifySession.command('commit;');
      expect(blocked).toBe(true);
      expect(await attempt).toContain('provider_monthly_budget_exhausted');
      expect(f.status()).toMatchObject({ committedUsd: 11, unresolvedUsd: 11, alerts: [50] });
      expect(f.service('select count(*) from public.reader_content_analysis_calls')).toBe('0');
    } finally { modelSession.close(); apifySession.close(); }
  });

  it('admits recurring collection after the proof lifetime and keeps the budget private', () => {
    const f = fixture(`
      insert into public.collection_budget_reservations(request_key,kind,provider,actor_id,maximum_usd,state,actual_cost_usd,completed_at,created_at)
      select 'fixture:past-proof','job','apify','FixtureActor',45,'settled',45,
       date_trunc('month',now(),'UTC')-interval '1 day',date_trunc('month',now(),'UTC')-interval '1 day';
    `);
    const statements = readFileSync(new URL('./hourly-collection-db.sql', import.meta.url), 'utf8');
    const setup = statements.slice(statements.indexOf('insert into public.reader_collection_policies'), statements.indexOf('create temp table'));
    f.sql(setup.replace('true,true,0.01,0.02', 'true,true,0.01,0.001'));
    const outcome = f.service("select public.claim_hourly_source('hourly-db-test-owner','hourly-db-source')");
    const active = JSON.parse(outcome);
    const job = f.sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status)
      values('hourly-db-test-owner','hourly-db-source','Fixture','https://www.youtube.com/watch?v=12345678901','YouTube','apify','h7sDV53CddomktSi5','requested')
      returning id`);
    const reserve = (id: string, key: string, amount: number) => f.service(`select public.reserve_hourly_provider('${active.checkId}','${active.leaseToken}','${key}','${id}','h7sDV53CddomktSi5',${amount});`);
    expect(JSON.parse(reserve(job, 'youtube:12345678901', .005))).toMatchObject({ claimed: true });
    expect(f.status()).toMatchObject({ committedUsd: .005 });
    for (const role of ['anon', 'authenticated']) {
      expect(f.sql(`select has_function_privilege('${role}','public.read_monthly_provider_budget()','execute')`)).toBe('f');
      expect(f.sql(`select has_table_privilege('${role}','recap_internal.monthly_provider_budget_alerts','select')`)).toBe('f');
    }
  });
});
