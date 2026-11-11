import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { sourcePins } from '../../scripts/reader-migration-pins.mjs';
import { catalogueSql, cleanupSql } from '../../scripts/reader-migration-catalogue.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export const jsonSql = value => quote(JSON.stringify(value)) + '::jsonb';
export const readerSources = () => sourcePins.reader.map(pin => {
 const source = readFileSync(new URL('../fixtures/reader-release/' + pin.file, import.meta.url), 'utf8');
 assert.equal(sha256(source), pin.sourceSha256, pin.file);
 return source;
});
export const bodyOf = source => {
 const match = /^\s*(?:(?:--[^\n]*(?:\n|$))\s*)*begin;\s*\n([\s\S]*?)\ncommit;\s*$/i.exec(source);
 assert(match, 'Single known reader wrapper required');
 return match[1];
};

// No existing server, project env, credentials, connection URI, Docker service,
// or TCP port is used. Every database is a clone of this newly created cluster.
export class ReaderReleaseDb {
 constructor() {
  assert.equal(process.versions.node.split('.')[0], '22', 'Run this suite with Node 22');
  this.root = mkdtempSync(join(tmpdir(), 'therecap-reader-plan-'));
  this.socket = join(this.root, 'socket'); mkdirSync(this.socket, { mode: 0o700 });
  this.data = join(this.root, 'data'); this.sequence = 0; this.started = false;
  this.bin = process.env.READER_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
  this.env = { PATH: dirname(process.execPath) + ':' + this.bin + ':/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
   PGPASSFILE: join(this.root, 'absent-pgpass'), PGSERVICEFILE: join(this.root, 'absent-service'), PGSYSCONFDIR: this.root };
  try {
   for (const bin of ['initdb', 'pg_ctl', 'psql']) assert.match(this.run(bin, ['--version']), /\b17\./, 'PostgreSQL 17 required');
   this.run('initdb', ['-D', this.data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8']);
   this.run('pg_ctl', ['-D', this.data, '-l', join(this.root, 'postgres.log'), '-o', `-k ${this.socket} -h '' -p 55439`, '-w', 'start']);
   this.started = true;
   this.sql('postgres', 'create database reader_core;');
   this.sql('reader_core', `create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);`);
   for (const pin of sourcePins.core) {
    const source = readFileSync(new URL('../../supabase/migrations/' + pin.file, import.meta.url), 'utf8');
    assert.equal(sha256(source), pin.sourceSha256, 'Core source drift: ' + pin.file);
    this.sql('reader_core', source);
    this.sql('reader_core', `insert into supabase_migrations.schema_migrations values(${quote(pin.version)},array[${quote(source)}],${quote(pin.name)});`);
   }
   assert.equal(this.sql('reader_core', 'select count(*)from supabase_migrations.schema_migrations;'), '53');
   assert.equal(this.sql('reader_core', "select count(*)from pg_tables where schemaname='public';"), '62');
  } catch (error) { this.close(); throw error; }
 }
 run(bin, args, input) {
  try {
   return execFileSync(join(this.bin, bin), args, { input, encoding: 'utf8', env: this.env, timeout: 60000,
    maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) { throw new Error(String(error.stderr || error.message)); }
 }
 sql(database, input) {
  assert.match(database, /^(postgres|reader_core|reader_test_[0-9]+)$/);
  return this.run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
   '-h', this.socket, '-p', '55439', '-U', 'postgres', '-d', database], input);
 }
 fresh() {
  const name = 'reader_test_' + ++this.sequence;
  this.sql('postgres', `create database ${name} template reader_core;`);
  return name;
 }
 capture(database) {
  return JSON.parse(this.sql(database, 'begin;set local search_path=pg_catalog,public;' + catalogueSql +
   'select pg_temp.reader_capture();' + cleanupSql + 'rollback;'));
 }
 catalogue(database) {
  return JSON.parse(this.sql(database, 'begin;set local search_path=pg_catalog,public;' + catalogueSql +
   "select coalesce(jsonb_agg(jsonb_build_object('key',key,'sha256',encode(sha256(convert_to(doc::text,'UTF8')),'hex'),'doc',doc)order by key),'[]')from pg_temp.reader_catalogue();" + cleanupSql + 'rollback;'));
 }
 session(database) {
  assert.match(database, /^reader_test_[0-9]+$/);
  return new SqlSession(join(this.bin, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', this.socket,
   '-p', '55439', '-U', 'postgres', '-d', database], this.env);
 }
 close() {
  if (this.started) { this.run('pg_ctl', ['-D', this.data, 'stop', '-m', 'immediate', '-w']); this.started = false; }
  if (this.root) { rmSync(this.root, { recursive: true, force: true }); this.root = undefined; }
 }
}

class SqlSession {
 constructor(binary, args, env) {
  this.child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  this.output = ''; this.errors = ''; this.count = 0;
  this.child.stdout.on('data', data => {
   this.output += String(data);
   if (this.pending && this.output.includes(this.pending.marker + '\n')) {
    const { marker, resolve, timer } = this.pending, end = this.output.indexOf(marker + '\n');
    const value = this.output.slice(0, end); this.output = this.output.slice(end + marker.length + 1);
    clearTimeout(timer); this.pending = null; resolve(value);
   }
  });
  this.child.stderr.on('data', data => { this.errors += String(data); });
  const fail = error => {
   this.ended = error;
   if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
  };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error('Disposable psql session exited ' + code + ': ' + this.errors)));
 }
 command(query) {
  assert(!this.pending, 'Only one outstanding session command');
  if (this.ended) return Promise.reject(this.ended);
  return new Promise((resolve, reject) => {
   const marker = 'reader_barrier_' + ++this.count;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Disposable SQL session timed out')); }, 10000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(query + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); if (this.child.exitCode === null) this.child.kill('SIGTERM'); }
}
