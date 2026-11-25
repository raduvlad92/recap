import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyServingHealth } from '../scripts/cloudflare-release-platform.mjs';
import { journaledMigration, verifyReleaseMigrations } from '../scripts/cloudflare-release-migrations.mjs';
import { verifyReviewedApifyBuild } from '../scripts/verify-reviewed-apify-build.mjs';

const release = 'a'.repeat(40);
const migration = '20261125103322_fixture.sql';
const sql = "begin;\ndo $$ begin perform '$&'; end; $$;\ncommit;\n";
const digest = value => createHash('sha256').update(value).digest('hex');
const temporary = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), 'recap-release-guard-'));
  temporary.push(root);
  return root;
};
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('post-promotion health', () => {
  it('retries a stale binding read and records status, SHA, and mode', async () => {
    const observations = [], delays = [];
    const stale = 'b'.repeat(40);
    const replies = [
      Response.json({ hosting: { release: stale, mode: 'shadow' } }),
      Response.json({ hosting: { release, mode: 'active' } }),
    ];
    await verifyServingHealth({ release, mode:'active', fetcher: async () => replies.shift(),
      wait: async ms => delays.push(ms), report: line => observations.push(JSON.parse(line)) });
    expect(delays).toEqual([500]);
    expect(observations).toMatchObject([{ status:200, observedRelease:stale, observedMode:'shadow' }]);
  });

  it('fails closed after bounded attempts and avoids logging response content', async () => {
    const observations = [], delays = [];
    await expect(verifyServingHealth({ release, mode:'active',
      fetcher: async () => new Response('untrusted content', { status:503 }),
      wait: async ms => delays.push(ms), report: line => observations.push(JSON.parse(line)) })).rejects.toThrow('release_health_unverified');
    expect(delays).toEqual([500, 1000, 2000, 4000]);
    expect(observations).toHaveLength(5);
    expect(observations.every(value => value.status===503 && value.observedRelease===null && value.observedMode===null)).toBe(true);
    expect(JSON.stringify(observations)).not.toContain('untrusted content');
  });
});

describe('release migrations', () => {
  it('retains dollar quoting and JavaScript replacement metacharacters in the journal', () => {
    const rendered = journaledMigration(migration, sql, digest(sql));
    expect(rendered.split('$reviewed_recapsql$')[1]).toBe(sql);
    expect(rendered).toContain("do $$ begin perform '$&'; end; $$;");
    expect(() => journaledMigration(migration, sql, digest('unexpected'))).toThrow('release_migration_source_unverified');
  });

  it('requires matching bytes for a migration added since the serving release', async () => {
    const root = temp();
    const git = (...args) => execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
    const save = message => git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m',message);
    git('init');
    writeFileSync(join(root,'README'), 'prior release');
    git('add','README'); save('prior');
    const from = git('rev-parse','HEAD');
    mkdirSync(join(root,'supabase','migrations'),{recursive:true});
    writeFileSync(join(root,'supabase','migrations',migration),sql);
    git('add','supabase/migrations'); save('new migration');
    const to = git('rev-parse','HEAD');
    const paths = [];
    const context = { root, from, to, token:'fictional-token', report:() => {} };
    const fetcher = async input => {
      paths.push(new URL(input).pathname);
      return Response.json({ version:'20261125103322', name:'fixture', statements:[sql] });
    };
    await expect(verifyReleaseMigrations({ ...context, from:to, token:undefined, fetcher })).resolves.toBeUndefined();
    expect(paths).toEqual([]);
    await expect(verifyReleaseMigrations({ ...context, token:undefined, fetcher })).rejects.toThrow('release_migration_read_credential_missing');
    await expect(verifyReleaseMigrations({ ...context, fetcher })).resolves.toBeUndefined();
    expect(paths).toEqual(['/v1/projects/zlfdqzabsfndifxiqguo/database/migrations/20261125103322']);
    await expect(verifyReleaseMigrations({ ...context,
      fetcher:async () => Response.json({ version:'20261125103322', name:'fixture', statements:[sql.replaceAll('$$','$')] }) }))
      .rejects.toThrow('release_migration_unverified');
  });
});

it('reads Apify metadata only with the explicitly selected approved credential', async () => {
  const authorityFile = join(temp(), 'approved.json');
  writeFileSync(authorityFile, JSON.stringify({ APIFY_API_TOKEN:'approved-fixture' }));
  const price = { startedAt:'2026-11-25T00:00:00.000Z' };
  const reviewed = { buildId:'testBuild', buildNumber:'0.0.340', actorId:'testActor', pricingSha256:digest(JSON.stringify(price)) };
  const fetcher = async (input, init) => {
    expect(init.headers.authorization).toBe('Bearer approved-fixture');
    return Response.json({ data:new URL(input).pathname.includes('/actor-builds/') ?
      { id:'testBuild', status:'SUCCEEDED', actId:'testActor' } :
      { taggedBuilds:{ latest:{ buildId:'testBuild', buildNumber:'0.0.340' } }, pricingInfos:[price] } });
  };
  await expect(verifyReviewedApifyBuild({ authorityFile, reviewed, fetcher, at:Date.parse('2026-11-25T12:00:00Z') }))
    .resolves.toMatchObject({ buildNumber:'0.0.340', pricingVerified:true });
  await expect(verifyReviewedApifyBuild({ reviewed, fetcher })).rejects.toThrow('Approved Apify authority file required');
});
