import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReaderReleaseDb } from './helpers/reader-release-db.mjs';

const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
const pgBin = process.env.READER_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const release = 'a'.repeat(40);
const previous = '20261125030000_hourly_hosting_lease_recovery.sql';
const httpExpiry = '20261125181000_expire_unleased_http_hosting_work.sql';
const deadline = '20261126032659_expire_queued_hourly_cron_slots.sql';
const cronKey = (offset, epoch = 10) => `'cron:hourly-collection:${epoch}:' || (floor(extract(epoch from now()) / 300)::bigint + (${offset}))::text`;
const claim = key => `public.begin_hosting_work(${key},'hourly-collection',10,'${release}')`;

describe.skipIf(!existsSync(join(pgBin, 'initdb')))('hourly cron deadlines in disposable PostgreSQL', () => {
  let db;
  beforeAll(() => { db = new ReaderReleaseDb(); }, 40_000);
  afterAll(() => db?.close());

  function fixture(withDeadline = true) {
    const database = db.fresh();
    const sql = query => db.sql(database, query);
    sql(migration(previous));
    sql(migration(httpExpiry));
    if (withDeadline) sql(migration(deadline));
    sql(`update public.hosting_runtime_control
      set owner='cloudflare', epoch=10, release='${release}', paused=false, old_host_fenced=true;`);
    return sql;
  }

  it('acknowledges an expired delivery without claiming it or allowing it to be readmitted', () => {
    const stale = cronKey(-4);
    const admit = `public.admit_hosting_work(${stale},'hourly-collection',10,'${release}')`;
    const original = fixture(false);
    expect(original(`select ${admit}; select ${claim(stale)} is not null;`)).toBe('t\nt');

    const sql = fixture();
    expect(sql(`select ${admit};
      select ${claim(stale)} is null;
      select ${admit};
      select state,lease_token is null,lease_until is null from public.hosting_work where key=${stale};`
    )).toBe('t\nt\nf\nuncertain|t|t');
  });

  it('retires unattended stale slots and expired leases while preserving scope and receipts', () => {
    const stale = cronKey(-4), fresh = cronKey(0), running = cronKey(-5), otherEpoch = cronKey(-6, 9);
    const sql = fixture();
    expect(sql(`do $$ declare saved_token uuid:=gen_random_uuid(); prior_deadline timestamptz:=now()-interval '1 second'; begin
      insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until) values
        (${stale},'hourly-collection',10,'${release}','queued',null,null),
        (${fresh},'hourly-collection',10,'${release}','queued',null,null),
        (${running},'hourly-collection',10,'${release}','running',saved_token,prior_deadline),
        (${otherEpoch},'hourly-collection',9,'${release}','queued',null,null),
        ('manual:hourly-collection:10:fixture','hourly-collection',10,'${release}','queued',null,null),
        ('cron:daily-briefing:10:1','daily-briefing',10,'${release}','queued',null,null);
      if ${claim(fresh)}->>'token' is null then raise exception 'Current slot did not claim'; end if;
      if (select lease_until is distinct from prior_deadline or lease_token is distinct from saved_token
          from public.hosting_work where key=${running}) then raise exception 'Expired receipt changed'; end if;
      end $$;
      select state from public.hosting_work order by case key
        when ${stale} then 1 when ${fresh} then 2 when ${running} then 3 when ${otherEpoch} then 4
        when 'manual:hourly-collection:10:fixture' then 5 else 6 end;`
    )).toBe('uncertain\nrunning\nuncertain\nqueued\nqueued\nqueued');
  });

  it('preserves busy retries and the pause and role fences', () => {
    const stale = cronKey(-4), fresh = cronKey(0);
    const sql = fixture();
    sql(`insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until) values
      (${stale},'hourly-collection',10,'${release}','queued',null,null),
      (${fresh},'hourly-collection',10,'${release}','queued',null,null),
      ('manual:hourly-collection:10:live','hourly-collection',10,'${release}','running',gen_random_uuid(),now()+interval '5 minutes');
      update public.hosting_runtime_control set paused=true;`);
    expect(() => sql(`select ${claim(fresh)};`)).toThrow(/paused or stale/);
    expect(sql(`select state from public.hosting_work where key=${stale};`)).toBe('queued');
    expect(() => sql(`set role anon; select ${claim(fresh)};`)).toThrow(/permission denied/);
    sql('update public.hosting_runtime_control set paused=false;');
    expect(sql(`set role service_role; select ${claim(fresh)};`)).toBe('{"busy": true}');
  });

  it('keeps the predecessor HTTP expiry when the hourly deadline migration follows it', () => {
    const sql = fixture();
    const fresh = cronKey(0);
    sql(`insert into public.hosting_work(key,kind,epoch,release,state,created_at,payload) values
      ('http:late','http',10,'${release}','queued',now()-interval '61 seconds',null),
      ('http:abandoned','http',10,'${release}','queued',now()-interval '61 seconds',null),
      ('http:live','http',10,'${release}','queued',now(),null),
      ('http:has-payload','http',10,'${release}','queued',now()-interval '61 seconds','{"fixture":true}');
      select public.admit_hosting_work(${fresh},'hourly-collection',10,'${release}');`);
    expect(sql(`select public.begin_hosting_work('http:late','http',10,'${release}') is null;
      select ${claim(fresh)}->>'token' is not null;
      select key,state,lease_token is null,lease_until is null
      from public.hosting_work where kind='http' order by key;`))
      .toBe('t\nt\nhttp:abandoned|uncertain|t|t\nhttp:has-payload|queued|t|t\nhttp:late|uncertain|t|t\nhttp:live|queued|t|t');
  });
});
