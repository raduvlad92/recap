import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourcePins } from './reader-migration-pins.mjs';
import { reviewedContract } from './reader-migration-contract.mjs';
import { catalogueSql, cleanupSql } from './reader-migration-catalogue.mjs';

// Pure text builder: no fs, process/env, credentials, network, database client,
// subprocess, CLI, SQL dispatch or automatic reconciliation path.
const sha256 = value => createHash('sha256').update(value).digest('hex');
const q = value => "'" + value.replaceAll("'", "''") + "'";
const j = value => q(JSON.stringify(value)) + '::jsonb';
const array = values => 'array[' + values.map(q).join(',') + ']::text[]';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const setupSql = `begin;
set local transaction isolation level read committed;
set local standard_conforming_strings=on;
set local search_path=pg_catalog,public;
set local timezone='UTC';set local datestyle='ISO,YMD';
set local lock_timeout='2s';set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='30s';
select pg_advisory_xact_lock(734601,7110);
lock table supabase_migrations.schema_migrations in share row exclusive mode;
-- No writer or DDL transaction may overlap this parent-owned stopped window.
do $reader_locks$ declare r record;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','recap_internal')and c.relkind in('r','p','m')order by n.nspname,c.relname loop
  execute format('lock table %I.%I in share mode',r.nspname,r.relname);
 end loop;
end $reader_locks$;
`;

const boundsSql = `
do $reader_bounds$begin
 if current_setting('server_version_num')::int not between 170000 and 179999 then raise exception 'PostgreSQL 17 required';end if;
 if(select count(*)from pg_temp.reader_catalogue())>20000 then raise exception 'Reader plan object bound exceeded';end if;
end $reader_bounds$;
`;

// Parent may execute this separately to capture the baseline. It returns only
// digests. Temporary helpers and locks are rolled back; no project row is written.
export function buildReaderMigrationCapture() {
 const sql = setupSql + catalogueSql + boundsSql + 'select pg_temp.reader_capture();\n' + cleanupSql + 'rollback;\n';
 return Object.freeze({ sql, transactionSha256: sha256(sql), mode: 'capture', dispatchesSql: false });
}

export function buildReaderMigrationPlan(input) {
 assert(exact(input, ['mode', 'operationId', 'expectedHosting', 'baseline', 'runtimeFlags', 'sources']), 'Unexpected plan input fields');
 const { mode, operationId, expectedHosting, baseline, runtimeFlags, sources } = input;
 assert(['rehearse', 'apply'].includes(mode), 'Explicit rehearse or apply mode required');
 assert.equal(typeof operationId, 'string');assert(uuidPattern.test(operationId), 'Durable parent operation UUID required');
 assert(exact(baseline, ['objectsSha256', 'rowsSha256', 'historySha256']), 'Exact captured baseline required');
 for (const value of Object.values(baseline)) assert(typeof value === 'string' && hashPattern.test(value), 'Invalid baseline digest');
 assert(exact(runtimeFlags, ['ACCOUNT_LIFECYCLE_ENABLED', 'ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED']), 'Explicit inactive runtime declarations required');
 assert(Object.values(runtimeFlags).every(value => value === false), 'Lifecycle flags must remain inactive');
 assert(exact(expectedHosting, ['control', 'revision', 'work']), 'Exact hosting status required');
 const { control, revision, work } = expectedHosting;
 assert(exact(control, ['owner', 'epoch', 'paused', 'release', 'old_host_fenced']), 'Unexpected control fields');
 assert.equal(control.owner, 'cloudflare');assert.equal(control.paused, true);assert.equal(control.old_host_fenced, true);
 assert.equal(control.release, sourcePins.coreCommit, 'Expected accepted core release required');
 assert(Number.isSafeInteger(control.epoch) && control.epoch > 0, 'Exact epoch required');
 assert.equal(typeof revision, 'string');assert(uuidPattern.test(revision), 'Exact pause revision required');
 assert(exact(work, ['queued', 'running', 'expired_running', 'uncertain']), 'Exact active-work counts required');
 assert(Object.values(work).every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid work counts');
 assert.equal(work.queued, 0, 'Queued work must be drained');assert.equal(work.running, 0, 'Running work must be drained');
 assert.equal(work.expired_running, 0, 'Expired leases are not a native drain proof');
 // Canonical order makes repeated calls produce identical transaction bytes.
 const hosting = { control: { owner: control.owner, epoch: control.epoch, paused: true, release: control.release, old_host_fenced: true }, revision,
  work: { queued: 0, running: 0, expired_running: 0, uncertain: work.uncertain } };
 const baselinePin = { objectsSha256: baseline.objectsSha256, rowsSha256: baseline.rowsSha256, historySha256: baseline.historySha256 };
 assert(Array.isArray(sources) && sources.length === 4, 'Exactly four ordered pinned migration sources required');
 const bodies = sources.map((source, index) => {
  const pin = sourcePins.reader[index];
  assert(typeof source === 'string' && Buffer.byteLength(source, 'utf8') <= 200000, 'Bounded migration text required');
  assert.equal(sha256(source), pin.sourceSha256, 'Pinned source bytes differ: ' + pin.file);
  const wrapped = /^\s*(?:(?:--[^\n]*(?:\n|$))\s*)*begin;\s*\n([\s\S]*?)\ncommit;\s*$/i.exec(source);
  assert(wrapped, 'Expected exact single outer BEGIN/COMMIT wrapper');
  assert.equal(sha256(wrapped[1]), pin.bodySha256, 'Pinned body bytes differ: ' + pin.file);
  return wrapped[1];
 });
 const changes = reviewedContract.changes;
 const contractRows = changes.map(change => [change.key, change.beforeSha256, change.afterSha256, change.replaceIdentity === true]);
 const historyVersions = sourcePins.core.map(pin => pin.version);
 const finalVersions = [...historyVersions, ...(mode === 'apply' ? sourcePins.reader.map(pin => pin.version) : [])];
 const historyInsertSql = mode === 'apply' ? sourcePins.reader.map((pin, index) => `insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(pin.version)},${q(pin.name)},array[${q(bodies[index])}]::text[]);`).join('\n') : '';
 const sql = `-- Parent operation ${operationId}; initial rollout only. Never retry an ambiguous apply.\n` + setupSql + catalogueSql + boundsSql + `
create temporary table reader_contract(key text primary key,before_sha256 text,after_sha256 text,replace_identity boolean)on commit drop;
insert into reader_contract select value->>0,value->>1,value->>2,(value->>3)::boolean from jsonb_array_elements(${j(contractRows)});
create temporary table reader_before_objects on commit drop as select *from pg_temp.reader_catalogue();
create unique index on reader_before_objects(key);
create temporary table reader_before_rows on commit drop as select *from pg_temp.reader_rows();
create temporary table reader_before_history on commit drop as select version,to_jsonb(h)doc from supabase_migrations.schema_migrations h;
do $reader_preconditions$declare c record;actual text;begin
 if public.read_hosting_release_status()is distinct from ${j(hosting)} then raise exception 'Hosting release/revision/work changed';end if;
 if exists(select 1 from public.automatic_content_tasks where state='running')then raise exception 'Automatic domain work must be drained';end if;
 if pg_temp.reader_capture()is distinct from ${j(baselinePin)} then raise exception 'Captured rows/schema/history baseline changed';end if;
 if(select array_agg(version order by version)from supabase_migrations.schema_migrations)is distinct from ${array(historyVersions)}then
  raise exception 'Expected exactly 53 core history versions; partial apply requires reconciliation';end if;
 if exists(select 1 from jsonb_to_recordset(${j(sourcePins.core.map(pin => ({ version: pin.version, name: pin.name })) )})p(version text,name text)
  join supabase_migrations.schema_migrations h using(version)where h.name is distinct from p.name or cardinality(h.statements) is null or cardinality(h.statements)=0 or array_position(h.statements,null)is not null)then
  raise exception 'Core migration history identity/statements differ';end if;
 -- Fixed core inventory includes individual public/internal objects, not a
 -- schema-wide exemption. Native defaults/history metadata remain baseline-bound.
 select encode(sha256(convert_to(coalesce(jsonb_agg(key order by key collate "C"),'[]')::text,'UTF8')),'hex')into actual
 from reader_before_objects where key not like 'defaultAcl:%'and key!~'^[^:]+:supabase_migrations([.]|$)';
 if actual<>${q(reviewedContract.coreKeysSha256)}then raise exception 'Unexpected existing schema or partial reader rollout';end if;
 for c in select *from reader_contract loop
  select encode(sha256(convert_to(doc::text,'UTF8')),'hex')into actual from reader_before_objects where key=c.key;
  if actual is distinct from c.before_sha256 then raise exception 'Reviewed object precondition differs: %',c.key;end if;
 end loop;
end $reader_preconditions$;
-- READER_BEFORE_BODIES
${bodies.map((body, index) => `-- Exact ${sourcePins.reader[index].version}; source ${sourcePins.reader[index].sourceSha256}; body ${sourcePins.reader[index].bodySha256}\n${body}`).join('\n')}
-- READER_AFTER_BODIES
-- History inserts are inside preservation checks as well as the transaction.
${historyInsertSql}
create temporary table reader_after_objects on commit drop as select *from pg_temp.reader_catalogue();
create unique index on reader_after_objects(key);
create temporary table reader_after_rows on commit drop as select *from pg_temp.reader_rows(true);
do $reader_postconditions$declare b record;actual text;begin
 for b in select *from reader_before_rows loop
  if not exists(select 1 from reader_after_rows a where a.key=b.key and(a.row_count,a.row_sha256)=(b.row_count,b.row_sha256))then
   raise exception 'Original rows changed: %',b.key;end if;
 end loop;
 if exists(select 1 from public.reader_content_analysis_calls where erased_job_id is not null)then raise exception 'Original erased job identity was seeded';end if;
 -- Only one documented settings row is introduced. All tombstones, aliases,
 -- issuer trust, deletion/retention proofs and identity events must be empty.
 for b in select *from reader_after_rows a where not exists(select 1 from reader_before_rows p where p.key=a.key)loop
  if b.key='recap_internal.reader_identity_settings'then
   if b.row_count<>1 or not exists(select 1 from recap_internal.reader_identity_settings where singleton and mode='legacy'and not lifecycle_ready)then
    raise exception 'Identity activation/settings changed';end if;
  elsif b.row_count<>0 then raise exception 'Unexpected new rows: %',b.key;end if;
 end loop;
 -- Verify the complete logical catalogue. A replacement may change only its
 -- exact reviewed definition. ACL/signature/security/comment are separate keys.
 for b in select coalesce(p.key,a.key)key,p.doc old_doc,a.doc new_doc,p.identity old_identity,a.identity new_identity,
  c.before_sha256,c.after_sha256,coalesce(c.replace_identity,false)replace_identity,c.key contract_key
  from reader_before_objects p full join reader_after_objects a using(key)left join reader_contract c on c.key=coalesce(p.key,a.key)loop
  if b.contract_key is null then
   if(b.old_doc,b.old_identity)is distinct from(b.new_doc,b.new_identity)then raise exception 'Unreviewed metadata/ACL/identity change: %',b.key;end if;
  else
   actual:=case when b.new_doc is not null then encode(sha256(convert_to(b.new_doc::text,'UTF8')),'hex')end;
   if actual is distinct from b.after_sha256 then raise exception 'Reviewed object result differs: %',b.key;end if;
   if b.old_doc is not null and not b.replace_identity and b.old_identity is distinct from b.new_identity then raise exception 'Original object identity changed: %',b.key;end if;
  end if;
 end loop;
 if exists(select 1 from reader_contract c where not exists(select 1 from reader_after_objects a where a.key=c.key))then raise exception 'Reviewed new object missing';end if;
 if exists((select h.version,to_jsonb(h)from supabase_migrations.schema_migrations h join reader_before_history b using(version)except select version,doc from reader_before_history)
  union all(select version,doc from reader_before_history except select h.version,to_jsonb(h)from supabase_migrations.schema_migrations h join reader_before_history b using(version)))then raise exception 'Original migration history changed';end if;
 if(select array_agg(version order by version)from supabase_migrations.schema_migrations)is distinct from ${array(finalVersions)}then raise exception 'Final migration history differs';end if;
 ${mode === 'apply' ? `if exists(select 1 from jsonb_to_recordset(${j(sourcePins.reader.map(pin => ({ version: pin.version, name: pin.name, body_sha256: pin.bodySha256 })))})p(version text,name text,body_sha256 text)
  join supabase_migrations.schema_migrations h using(version)where h.name is distinct from p.name or cardinality(h.statements)is distinct from 1
   or encode(sha256(convert_to(h.statements[1],'UTF8')),'hex')is distinct from p.body_sha256)then raise exception 'New migration history bytes differ';end if;` : ''}
 if public.read_hosting_release_status()is distinct from ${j(hosting)} then raise exception 'Hosting state changed during migration';end if;
end $reader_postconditions$;
${cleanupSql}
${mode === 'apply' ? "notify pgrst,'reload schema';\ncommit;" : 'rollback;'}
`;
 assert(Buffer.byteLength(sql, 'utf8') < 1000000, 'Transaction bound exceeded');
 return Object.freeze({ sql, mode, operationId, transactionSha256: sha256(sql),
  migrations: Object.freeze(sourcePins.reader.map(pin => Object.freeze({ ...pin }))),
  contractSha256: sha256(JSON.stringify(reviewedContract)), dispatchesSql: false,
  parentNativeGates: Object.freeze(['fresh exact native stop and full quiet bound', 'drained admitted work and deployment window',
   'private source/config/flags unchanged; both lifecycle flags off', 'durably saved intent, SQL bytes and transaction hash before dispatch',
   'rollback rehearsal acceptance before separately journaled apply', 'ambiguous result: read-only reconcile same intent; no retry',
   'native history/schema/ACL/rows readback and queued release acceptance before restoring original delivery']) });
}
