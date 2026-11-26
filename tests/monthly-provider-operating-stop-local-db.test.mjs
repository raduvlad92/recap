import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReaderReleaseDb, quote, readerSources } from './helpers/reader-release-db.mjs';

const bin = process.env.READER_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const apify = (key, maximum, parent = 'null') =>
  `select (public.reserve_collection_budget(${quote(key)},${maximum},'job',${parent},'apify','FixtureActor')).id;`;
const model = (key, maximum, state = 'reserved', createdAt = 'now()') =>
  `insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)
   values('operating-stop-fixture',${quote(key)},gen_random_uuid(),'fixture-model',repeat('a',64),${maximum},${quote(state)},${createdAt});`;
const reached = /PT402[\s\S]*provider_monthly_budget_exhausted[\s\S]*provider_operating_stop_reached/;
const wouldExceed = /PT402[\s\S]*provider_monthly_budget_exhausted[\s\S]*provider_operating_stop_would_exceed/;

describe.skipIf(!existsSync(join(bin, 'initdb')))('monthly provider operating stop in disposable PostgreSQL 17', () => {
  let db;
  beforeAll(() => { db = new ReaderReleaseDb(); }, 40_000);
  afterAll(() => db?.close());

  function fixture() {
    const name = db.fresh();
    const sql = input => db.sql(name, input);
    const service = input => sql('set role service_role; ' + input);
    for (const source of readerSources()) sql(source);
    for (const file of readdirSync(migrations).filter(name => name >= '20261111023125' && name.endsWith('.sql')).sort()) {
      sql(readFileSync(new URL(file, migrations), 'utf8'));
    }
    return { name, sql, service, status: () => JSON.parse(service('select public.read_monthly_provider_budget();')) };
  }

  it('admits up to $18 from $17.99, refuses both providers at $18, and records the reason separately', () => {
    const f = fixture();
    f.service(apify('standing-hold', 17.99));
    expect(f.status()).toMatchObject({ limitUsd: 20, operatingLimitUsd: 18, committedUsd: 17.99,
      paused: false, lastRefusal: null });
    expect(() => f.service(model('oversized', .02))).toThrow(wouldExceed);
    f.service("select public.record_monthly_provider_admission_refusal('provider_operating_stop_would_exceed');");
    expect(f.status()).toMatchObject({ lastRefusal: { reason: 'provider_operating_stop_would_exceed' } });

    f.service(model('last-cent', .01));
    expect(f.status()).toMatchObject({ spentUsd: 0, committedUsd: 18, unresolvedUsd: 18,
      paused: true, pauseReason: 'provider_operating_stop_reached', alerts: [50, 80] });
    expect(() => f.service(apify('apify-denied', .001))).toThrow(reached);
    expect(() => f.service(model('router-denied', .001))).toThrow(reached);
    f.service("select public.record_monthly_provider_admission_refusal('provider_operating_stop_reached');");
    expect(f.status()).toMatchObject({ lastRefusal: { reason: 'provider_operating_stop_reached', at: expect.any(String) } });
    expect(f.service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
    expect(f.service('select count(*) from recap_internal.monthly_provider_admission_refusals;')).toBe('1');
    for (const role of ['anon', 'authenticated']) {
      expect(f.sql(`select has_function_privilege('${role}','public.record_monthly_provider_admission_refusal(text)','execute');`)).toBe('f');
      expect(f.sql(`select has_table_privilege('${role}','recap_internal.monthly_provider_admission_refusals','select');`)).toBe('f');
    }
  }, 30_000);

  it('admits just one last-cent reservation across concurrent provider transactions', async () => {
    const f = fixture();
    f.service(apify('standing-hold', 17.99));
    const collection = db.session(f.name);
    const analysis = db.session(f.name);
    try {
      await collection.command(`set role service_role; begin; ${apify('apify-last-cent', .01)}`);
      const attempt = analysis.command(`set role service_role; ${model('router-last-cent', .01)}`)
        .then(() => 'admitted', error => String(error));
      let blocked = false;
      try {
        for (let i = 0; i < 50 && !blocked; i++) {
          blocked = f.sql("select exists(select 1 from pg_locks where locktype='advisory' and not granted);") === 't';
          if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { await collection.command('commit;'); }
      expect(blocked).toBe(true);
      expect(await attempt).toContain('provider_monthly_budget_exhausted');
      expect(f.status()).toMatchObject({ committedUsd: 18, unresolvedUsd: 18, paused: true });
      expect(f.service('select count(*) from public.reader_content_analysis_calls;')).toBe('0');
    } finally { analysis.close(); collection.close(); }
  }, 30_000);

  it('counts earlier UTC holds and refuses an already-funded Apify launch while allowing settlement', () => {
    const f = fixture();
    const envelope = f.service("select (public.reserve_collection_budget('source-envelope',17.90,'envelope')).id;");
    const admitted = f.service(apify('started-child', .10, quote(envelope)));
    f.service(`select public.claim_collection_budget('${admitted}');`);
    const unlaunched = f.service(apify('unlaunched-child', .10, quote(envelope)));
    f.service(model('previous-month-unknown', .10, 'unknown', "date_trunc('month',now(),'UTC')-interval '1 day'"));
    expect(f.status()).toMatchObject({ spentUsd: 0, committedUsd: 18, unresolvedUsd: 18, paused: true });
    expect(() => f.service(apify('another-funded-child', .10, quote(envelope)))).toThrow(reached);
    expect(() => f.service(`select public.claim_collection_budget('${unlaunched}');`)).toThrow(reached);
    expect(f.service(`select launch_attempted_at is null from public.collection_budget_reservations where id='${unlaunched}';`)).toBe('t');
    f.service(`select public.settle_collection_budget('${admitted}','FixtureRun',.10,true);`);
    expect(f.status()).toMatchObject({ apifyUsd: .10, committedUsd: 18, unresolvedUsd: 17.90, paused: true });
  }, 30_000);
});
