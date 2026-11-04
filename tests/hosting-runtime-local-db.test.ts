import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => { try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
describe.skipIf(!available)('hosting handover in disposable PostgreSQL', () => {
  let root = '', started = false, args: string[] = [];
  const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const release = 'a'.repeat(40), next = 'b'.repeat(40);
  beforeAll(() => {
    root = mkdtempSync('/tmp/recap-hosting-'); mkdirSync(join(root, 'socket'));
    execFileSync('initdb', ['-D', join(root, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(root, 'data'), '-l', join(root, 'log'), '-o', `-k ${join(root, 'socket')} -h '' -p 55621`, 'start'], { stdio: 'ignore' }); started = true;
    args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', join(root, 'socket'), '-p', '55621', '-U', 'postgres', '-d', 'postgres'];
    sql('create role anon; create role authenticated; create role service_role;');
    sql(readFileSync(new URL('../supabase/migrations/20261104090000_hosting_runtime_handover.sql', import.meta.url), 'utf8'));
  });
  afterAll(() => { if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); if (root) rmSync(root, { recursive: true, force: true }); });
  it('starts paused, keeps all tables private, and denies public execution', () => {
    expect(JSON.parse(sql('select read_hosting_runtime();'))).toMatchObject({ owner: 'netlify', epoch: 1, paused: true, old_host_fenced: false });
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['hosting_work', 'hosting_runtime_control']) expect(sql(`select has_table_privilege('${role}','${table}','select');`)).toBe('f');
      expect(sql(`select has_function_privilege('${role}','read_hosting_runtime()','execute');`)).toBe('f');
    }
    expect(() => sql(`select admit_hosting_work('x','http',1,'${release}');`)).toThrow();
    expect(() => sql(`select change_hosting_runtime('netlify',1,'cloudflare','${release}',false,false);`)).toThrow();
  });
  it('requires the exact expected owner/epoch and a verified old-host fence', () => {
    expect(() => sql(`select change_hosting_runtime('netlify',null,'cloudflare','${release}',false,true);`)).toThrow();
    const result = JSON.parse(sql(`select change_hosting_runtime('netlify',1,'cloudflare','${release}',false,true);`));
    expect(result).toMatchObject({ owner: 'cloudflare', epoch: 2, paused: false });
    expect(() => sql(`select change_hosting_runtime('netlify',1,'cloudflare','${release}',true,true);`)).toThrow();
  });
  it('deduplicates ticks, serializes a pipeline, and leaves queued busy work retryable', () => {
    expect(sql(`select admit_hosting_work('cron:first','social-collection',2,'${release}');`)).toBe('t');
    const first = JSON.parse(sql(`select begin_hosting_work('cron:first','social-collection',2,'${release}');`));
    expect(first.token).toMatch(/[a-f0-9-]{36}/);
    expect(sql(`select begin_hosting_work('cron:first','social-collection',2,'${release}');`)).toBe('');
    sql(`select admit_hosting_work('cron:second','social-collection',2,'${release}');`);
    expect(JSON.parse(sql(`select begin_hosting_work('cron:second','social-collection',2,'${release}');`))).toEqual({ busy: true });
    expect(() => sql(`select change_hosting_runtime('cloudflare',2,'cloudflare','${next}',false,true);`)).toThrow();
    sql(`select change_hosting_runtime('cloudflare',2,'cloudflare','${release}',true,true);`);
    expect(() => sql(`select change_hosting_runtime('cloudflare',2,'cloudflare','${next}',true,true);`)).toThrow();
    sql(`select finish_hosting_work('cron:first','${first.token}',2,false);`);
    expect(sql("select state from hosting_work where key='cron:first';")).toBe('uncertain');
    sql(`select change_hosting_runtime('cloudflare',2,'cloudflare','${next}',true,true);`);
    expect(() => sql(`select begin_hosting_work('cron:second','social-collection',2,'${release}');`)).toThrow();
  });
  it('preserves unrelated existing data through all hosting transitions', () => {
    sql("create table protected_fixture(id integer primary key, record jsonb); insert into protected_fixture values(1,'{\"quote\":\"Original\",\"unknownCost\":null}');");
    const before = sql('select to_jsonb(protected_fixture) from protected_fixture;');
    sql(`select change_hosting_runtime('cloudflare',3,'netlify','${release}',true,true);`);
    expect(sql('select to_jsonb(protected_fixture) from protected_fixture;')).toBe(before);
  });
});
