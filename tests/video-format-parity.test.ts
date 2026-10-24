import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeVideoFormatFields, sanitizeVideoFormat, videoFormatKind } from '../src/lib/video-format';

// Only disposable local PostgreSQL 17 is used. Explicit socket/connection
// arguments and an isolated PG environment avoid saved services/password files.
const available = (() => {
  try { return /\b17\./.test(execFileSync('initdb', ['--version'], { encoding: 'utf8', timeout: 5_000 })) && process.getuid?.() !== 0; }
  catch { return false; }
})();
const stableMigration = '20261023000813_hourly_check_hour_alignment.sql';
const classificationMigration = '20261024001118_video_classification_caption_enrichment.sql';
const literal = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
type ClientInput = Parameters<typeof mergeVideoFormatFields>[0];
type FixtureRecord = Omit<ClientInput, 'videoFormat'> & { sourceId: string; format: 'video'; videoFormat?: unknown };
type FormatFixture = { label: string; value?: unknown };
type SqlRow = [number, number, unknown, unknown];

const kinds = ['unknown', 'regular', 'short'] as const;
const bases = ['legacy', 'provider', 'watch_page', 'canonical_url'] as const;
const malformedEnums = [null, true, false, 0, 'invalid', {}, { value: 'short' }, [], ['short'], ['regular'], ['unknown']];
const formats: FormatFixture[] = [
  { label: 'absent' }, { label: 'explicit-null', value: null },
  ...kinds.flatMap(kind => bases.map(basis => ({ label: `${kind}/${basis}`, value: { kind, basis } }))),
  ...[true, false, 0, 'short', [], ['short'], [{ kind: 'short', basis: 'provider' }], {}, { kind: 'short' }, { basis: 'provider' }]
    .map(value => ({ label: `malformed-format:${JSON.stringify(value)}`, value })),
  ...malformedEnums.map(kind => ({ label: `malformed-kind:${JSON.stringify(kind)}`, value: { kind, basis: 'provider' } })),
  ...malformedEnums.map(basis => ({ label: `malformed-basis:${JSON.stringify(basis)}`, value: { kind: 'short', basis } })),
  ...['provider', 'legacy', 'watch_page', 'canonical_url'].flatMap(basis =>
    kinds.map(kind => ({ label: `array-basis:${kind}/${basis}`, value: { kind, basis: [basis] } }))),
];
const urls = ['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk'];
const fixtures = urls.flatMap((url, urlIndex) => [undefined, false, true].flatMap(isShort => formats.map(format => ({
  label: `${urlIndex === 0 ? 'watch' : 'shorts'}; flag=${String(isShort)}; ${format.label}`,
  record: {
    sourceId: 'synthetic-parity-source', format: 'video' as const, url,
    ...(isShort === undefined ? {} : { isShort }),
    ...('value' in format ? { videoFormat: format.value } : {}),
  } satisfies FixtureRecord,
}))));

describe.skipIf(!available)('SQL/client video classification fallback parity on disposable PostgreSQL 17', () => {
  let root: string | undefined, args: string[], environment: NodeJS.ProcessEnv, started = false;
  const sql = (query: string) => execFileSync('psql', args, {
    input: query, encoding: 'utf8', env: environment, timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'recap-format-parity-'));
    const data = join(root, 'data'), socket = join(root, 'socket');
    mkdirSync(socket);
    environment = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
      PGPASSFILE: join(root, 'no-password-file'), PGSERVICEFILE: join(root, 'no-service-file'), PGSYSCONFDIR: root,
    };
    execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { env: environment, stdio: 'ignore', timeout: 15_000 });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55519`, 'start'], { env: environment, stdio: 'ignore', timeout: 15_000 });
    started = true;
    args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55519', '-U', 'postgres', '-d', 'postgres'];
    expect(sql("select current_setting('server_version_num')::integer / 10000, current_setting('listen_addresses');")).toBe('17|');
    const directory = resolve('supabase/migrations');
    const migrations = readdirSync(directory).filter(file => file.endsWith('.sql') && (file <= stableMigration || file === classificationMigration)).sort();
    expect(migrations).toContain(stableMigration);
    expect(migrations).toContain(classificationMigration);
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb; $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.jwt() to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to service_role;
      ${migrations.map(file => readFileSync(join(directory, file), 'utf8')).join('\n')}`);
  }, 30_000);

  afterAll(() => {
    try {
      if (started && root) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { env: environment, stdio: 'ignore', timeout: 10_000 });
    } finally { if (root) rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps the client reference strict about primitive enum strings', () => {
    for (const value of malformedEnums) {
      expect(sanitizeVideoFormat({ kind: value, basis: 'provider' }), `kind=${JSON.stringify(value)}`).toBeUndefined();
      expect(sanitizeVideoFormat({ kind: 'short', basis: value }), `basis=${JSON.stringify(value)}`).toBeUndefined();
    }
    for (const basis of bases) expect(sanitizeVideoFormat({ kind: 'short', basis: [basis] })).toBeUndefined();
  });

  it('matches effective kind and meaningful kind/basis for every ordered pair without losing positive flags', () => {
    const failures = {
      effectiveKind: { count: 0, examples: [] as unknown[] },
      classification: { count: 0, examples: [] as unknown[] },
      regularWithPositiveFlag: { count: 0, examples: [] as unknown[] },
      positiveFlagLoss: { count: 0, examples: [] as unknown[] },
    };
    const records = literal(fixtures.map(fixture => fixture.record));
    const began = Date.now(), beforeBatchSize = 16;
    let checkedPairs = 0;
    expect(fixtures).toHaveLength(formats.length * urls.length * 3);
    // The cross product is built in SQL from one JSON fixture array per batch.
    // Return only classification fields, at most 16 * fixture-count rows; do
    // not start a process per pair or print the complete matrix on failure.
    for (let first = 0; first < fixtures.length; first += beforeBatchSize) {
      if (Date.now() - began > 30_000) throw new Error(`Parity matrix exceeded 30 seconds after ${checkedPairs} pairs`);
      const end = Math.min(first + beforeBatchSize, fixtures.length);
      const rows: SqlRow[] = JSON.parse(sql(`set statement_timeout='10s';
        with fixtures as (
          select (ordinality - 1)::integer as id, value as record
          from jsonb_array_elements(${records}) with ordinality
        ), merged as materialized (
          select b.id as before_id, a.id as after_id,
            public.merge_hourly_video_enrichment(b.record,a.record) as record
          from fixtures b cross join fixtures a where b.id >= ${first} and b.id < ${end}
        )
        select jsonb_agg(jsonb_build_array(before_id,after_id,record->'videoFormat',record->'isShort') order by before_id,after_id)
        from merged;`));
      expect(rows).toHaveLength((end - first) * fixtures.length);
      for (const [beforeIndex, afterIndex, format, flag] of rows) {
        const before = fixtures[beforeIndex], after = fixtures[afterIndex];
        // Deliberately pass malformed JSON through the public helper's runtime
        // sanitizer, rather than coercing fixture enum values into strings.
        const fields = mergeVideoFormatFields(before.record as ClientInput, after.record as ClientInput);
        const client = { url: before.record.url, ...fields };
        const server = { url: before.record.url, videoFormat: format, isShort: flag } as ClientInput;
        const serverKind = videoFormatKind(server), clientKind = videoFormatKind(client);
        const actual = sanitizeVideoFormat(format), expected = sanitizeVideoFormat(fields.videoFormat)!;
        const recordFailure = (category: keyof typeof failures) => {
          const failure = failures[category]; failure.count++;
          if (failure.examples.length < 2) failure.examples.push({ before: before.label, after: after.label,
            server: { videoFormat: format, isShort: flag, effectiveKind: serverKind },
            client: { ...fields, effectiveKind: clientKind } });
        };
        if (serverKind !== clientKind) recordFailure('effectiveKind');
        // No classification is an acceptable spelling of unknown/legacy only
        // when neither input nor output carries meaningful checked evidence.
        const meaningful = actual || expected.kind !== 'unknown' || expected.basis !== 'legacy'
          || sanitizeVideoFormat(before.record.videoFormat) || sanitizeVideoFormat(after.record.videoFormat);
        if (meaningful && (actual?.kind !== expected.kind || actual?.basis !== expected.basis)) recordFailure('classification');
        if (actual?.kind === 'regular' && flag === true) recordFailure('regularWithPositiveFlag');
        // An explicit checked unknown may remain unknown even with positive
        // evidence. Require preservation of the flag, not an invented short.
        if ((before.record.isShort === true || after.record.isShort === true) && (flag !== true || fields.isShort !== true)
          || fields.isShort === true && flag !== true) recordFailure('positiveFlagLoss');
        checkedPairs++;
      }
    }
    expect(checkedPairs).toBe(fixtures.length ** 2);
    expect(Object.fromEntries(Object.entries(failures).map(([category, failure]) => [category, failure.count])),
      JSON.stringify({ fixtures: fixtures.length, checkedPairs, failures }, null, 2)).toEqual({
      effectiveKind: 0, classification: 0, regularWithPositiveFlag: 0, positiveFlagLoss: 0,
    });
  }, 45_000);
});
