import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ReleaseError } from './cloudflare-release-state.mjs';

const project = 'zlfdqzabsfndifxiqguo';
const filename = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const commit = /^[a-f0-9]{40}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

export function migrationIdentity(file, source) {
  const parsed = filename.exec(file);
  if (!parsed) throw new ReleaseError('release_migration_filename_invalid');
  return { version: parsed[1], name: parsed[2], sha256: digest(source) };
}

export function journaledMigration(file, source, expectedHash) {
  const { version, name, sha256 } = migrationIdentity(file, source);
  const delimiter = '$reviewed_recapsql$';
  if (sha256 !== expectedHash || source.includes(delimiter) ||
      (source.match(/^begin;$/gmi) ?? []).length !== 1 || (source.match(/^commit;$/gmi) ?? []).length !== 1 ||
      !/\ncommit;\s*$/i.test(source)) throw new ReleaseError('release_migration_source_unverified');
  return source.replace(/^begin;$/mi, () => `begin;
set local lock_timeout='5s';
set local statement_timeout='55s';
select pg_advisory_xact_lock(20261125,38);
`).replace(/\ncommit;\s*$/i, () => `
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('${version}','${name}',array[${delimiter}${source}${delimiter}]);
commit;
`);
}

function changedMigrations(root, from, to) {
  if (!commit.test(from) || !commit.test(to)) throw new ReleaseError('release_migration_commit_invalid');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let paths;
  try {
    git('merge-base','--is-ancestor',from,to);
    paths = git('diff', '--name-only', '--no-renames', '-z', from, to, '--', 'supabase/migrations/*.sql').split('\0').filter(Boolean).sort();
    return paths.map(path => migrationIdentity(path.slice('supabase/migrations/'.length), git('show', to + ':' + path)));
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError('release_migration_source_unavailable');
  }
}

export async function verifyReleaseMigrations({ root, from, to, token, fetcher = fetch, report = console.error }) {
  const migrations = changedMigrations(root, from, to);
  if (!migrations.length) return;
  if (!token) throw new ReleaseError('release_migration_read_credential_missing');
  for (const migration of migrations) {
    let status = null;
    try {
      const response = await fetcher('https://api.supabase.com/v1/projects/' + project + '/database/migrations/' + migration.version, {
        headers: { authorization: 'Bearer ' + token, 'cache-control': 'no-cache' },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      status = response.status;
      const applied = response.ok ? await response.json() : null;
      if (applied?.version === migration.version && applied.name === migration.name &&
          Array.isArray(applied.statements) && applied.statements.length === 1 && typeof applied.statements[0] === 'string' &&
          digest(applied.statements[0]) === migration.sha256) continue;
    } catch {
      // Report the version and status without exposing SQL or credentials.
    }
    report(JSON.stringify({ event: 'release_migration_unverified', version: migration.version, status }));
    throw new ReleaseError('release_migration_unverified');
  }
}
