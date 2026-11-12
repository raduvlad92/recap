import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {providerAdmissionContract} from './provider-admission-migration-contract.mjs';
import {catalogueSql,cleanupSql} from './reader-migration-catalogue.mjs';

// Pure SQL builder. The parent owns native stop/drain, durable intent, dispatch
// and ambiguous-result reconciliation. No credential, file or network access.
const sha=x=>createHash('sha256').update(x).digest('hex');
const q=x=>"'"+x.replaceAll("'","''")+"'";
const json=x=>q(JSON.stringify(x))+'::jsonb';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Native operator gate, separate from disposable-database transaction tests.
 * A fresh data snapshot must never bless unrelated schema or history drift. */
export function assertProviderAdmissionNativePredecessor(capture){
 assert(exact(capture,['objectsSha256','rowsSha256','historySha256']));
 assert.equal(capture.objectsSha256,providerAdmissionContract.acceptedPredecessorObjectsSha256,'Accepted predecessor schema/ACL changed; do not refresh it');
 assert.equal(capture.historySha256,providerAdmissionContract.acceptedPredecessorHistorySha256,'Accepted predecessor history changed; do not refresh it');
 assert(/^[a-f0-9]{64}$/.test(capture.rowsSha256));
}

export function buildProviderAdmissionMigrationPlan(input){
 assert(exact(input,['mode','operationId','expectedServingCommit','expectedHosting','runtimeFlags','baseline','sources']));
 const {mode,operationId,expectedServingCommit,expectedHosting:h,runtimeFlags,baseline,sources}=input;
 assert(typeof expectedServingCommit==='string'&&/^[a-f0-9]{40}$/.test(expectedServingCommit));
 assert(['rehearse','apply'].includes(mode));assert(uuid.test(operationId));
 assert(exact(baseline,['objectsSha256','rowsSha256','historySha256']));
 assert(Object.values(baseline).every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)));
 assert(exact(runtimeFlags,['ACCOUNT_LIFECYCLE_ENABLED','ACCOUNT_LIFECYCLE_CLERK_DELETION_ENABLED']));
 assert(Object.values(runtimeFlags).every(x=>x===false));
 assert(exact(h,['control','revision','work'])&&exact(h.control,['owner','epoch','paused','release','old_host_fenced']));
 assert.equal(h.control.owner,'cloudflare');assert.equal(h.control.release,expectedServingCommit);assert.equal(h.control.paused,true);assert.equal(h.control.old_host_fenced,true);
 assert(Number.isSafeInteger(h.control.epoch)&&h.control.epoch>0);assert(uuid.test(h.revision));
 assert(exact(h.work,['queued','running','expired_running','uncertain']));assert(Object.values(h.work).every(x=>Number.isSafeInteger(x)&&x>=0));
 assert(h.work.queued===0&&h.work.running===0&&h.work.expired_running===0);
 assert(Array.isArray(sources)&&sources.length===2);
 const bodies=sources.map((src,i)=>{
  const pin=providerAdmissionContract.sources[i];assert(typeof src==='string'&&Buffer.byteLength(src)<150000);assert.equal(sha(src),pin.sourceSha256);
  const m=/^\s*(?:(?:--[^\n]*(?:\n|$))\s*)*begin;\s*\n([\s\S]*?)\ncommit;\s*$/i.exec(src);assert(m);assert.equal(sha(m[1]),pin.bodySha256);return m[1];
 });
 const versions='array['+providerAdmissionContract.prerequisiteVersions.map(q).join(',')+']::text[]';
 const history=mode==='apply'?providerAdmissionContract.sources.map((p,i)=>`insert into supabase_migrations.schema_migrations(version,name,statements)values(${q(p.version)},${q(p.name)},array[${q(bodies[i])}]::text[]);`).join('\n'):'';
 const sql=`-- Provider-admission operation ${operationId}; new additive stage rollout only; completed 53->60 operations are excluded, never retry an ambiguous apply.
begin;
set local transaction isolation level read committed;
set local standard_conforming_strings=on;set local search_path=pg_catalog,public;
set local timezone='UTC';set local datestyle='ISO,YMD';
set local lock_timeout='2s';set local statement_timeout='30s';set local idle_in_transaction_session_timeout='30s';
select pg_advisory_xact_lock(734601,7111);
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $locks$declare r record;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','recap_internal')and c.relkind in('r','p','m')order by n.nspname,c.relname loop
  execute format('lock table %I.%I in share mode',r.nspname,r.relname);
 end loop;
end $locks$;
${catalogueSql}
create temporary table provider_admission_contract on commit drop as select value->>'key'key,value->>'beforeSha256'old_hash,value->>'afterSha256'new_hash from jsonb_array_elements(${json(providerAdmissionContract.changes)});
create temporary table provider_admission_objects on commit drop as select*from pg_temp.reader_catalogue();
create temporary table provider_admission_rows on commit drop as select*from pg_temp.reader_rows();
create temporary table provider_admission_history on commit drop as select version,to_jsonb(x)doc from supabase_migrations.schema_migrations x;
do $before$declare c record;actual text;begin
 if current_setting('server_version_num')::integer not between 170000 and 179999 then raise exception'PostgreSQL17 required';end if;
 if(select count(*)from provider_admission_objects)>20000 then raise exception'Object bound exceeded';end if;
 if public.read_hosting_release_status()is distinct from ${json(h)} then raise exception'Hosting state changed';end if;
 if exists(select 1 from public.automatic_content_tasks where state='running')or exists(select 1 from public.social_content_tasks where state='running')or exists(select 1 from public.reader_content_analysis_jobs where state='running')then raise exception'Running domain task';end if;
 if pg_temp.reader_capture()is distinct from ${json(baseline)} then raise exception'Approved baseline changed';end if;
 if(select array_agg(version order by version)from supabase_migrations.schema_migrations)is distinct from ${versions} then raise exception'Exact prerequisite history required';end if;
 for c in select*from provider_admission_contract loop
  select encode(sha256(convert_to(doc::text,'UTF8')),'hex')into actual from provider_admission_objects where key=c.key;
  if actual is distinct from c.old_hash then raise exception'Prerequisite definition changed: %',c.key;end if;
 end loop;
end $before$;
${bodies.join('\n')}
${history}
do $after$declare c record;actual text;begin
 if exists(select 1 from provider_admission_objects b full join pg_temp.reader_catalogue()a using(key)where
  (a.doc is distinct from b.doc or a.identity is distinct from b.identity)and not exists(select 1 from provider_admission_contract permitted where permitted.key=coalesce(a.key,b.key)))then raise exception'Unreviewed object transition';end if;
 if exists(select 1 from provider_admission_objects b join pg_temp.reader_catalogue()a using(key)where a.identity is distinct from b.identity and not exists(select 1 from jsonb_array_elements(${json(providerAdmissionContract.changes)}) permitted_change where permitted_change->>'key'=b.key and permitted_change->'allowIdentityChange'='true'::jsonb))then raise exception'Original object identity changed';end if;
 for c in select*from provider_admission_contract loop
  select encode(sha256(convert_to(doc::text,'UTF8')),'hex')into actual from pg_temp.reader_catalogue()where key=c.key;
  if actual is distinct from c.new_hash then raise exception'Resulting definition changed: %',c.key;end if;
 end loop;
 if exists(select 1 from provider_admission_rows b left join pg_temp.reader_rows()a using(key)where a.row_count is distinct from b.row_count or a.row_sha256 is distinct from b.row_sha256)then raise exception'Original project rows changed';end if;
 if exists(select 1 from pg_temp.reader_rows()a left join provider_admission_rows b using(key)where b.key is null and (not a.key=any(array[${providerAdmissionContract.newTables.map(q).join(',')}]::text[])or a.row_count<>0))then raise exception'Unreviewed or nonempty new table';end if;
 if exists(select 1 from provider_admission_history b left join supabase_migrations.schema_migrations a using(version)where to_jsonb(a)is distinct from b.doc)then raise exception'Original migration history changed';end if;
 if(select count(*)from supabase_migrations.schema_migrations)<>60+${mode==='apply'?2:0} then raise exception'Unexpected history count';end if;
 ${mode==='apply'?providerAdmissionContract.sources.map(p=>`if not exists(select 1 from supabase_migrations.schema_migrations where version=${q(p.version)} and name=${q(p.name)} and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')=${q(p.bodySha256)}) then raise exception'Exact new history required';end if;`).join('\n'):''}
 if public.read_hosting_release_status()is distinct from ${json(h)} then raise exception'Hosting state changed';end if;
end $after$;
select jsonb_build_object('phase',${q(mode==='apply'?'applied':'rehearsed')},'capture',pg_temp.reader_capture())as receipt;
${cleanupSql}
${mode==='apply'?"notify pgrst,'reload schema';\ncommit;":'rollback;'}
`;
 assert(Buffer.byteLength(sql)<1000000);
 return Object.freeze({sql,mode,operationId,transactionSha256:sha(sql),contractSha256:sha(JSON.stringify(providerAdmissionContract)),sourcePins:providerAdmissionContract.sources,dispatchesSql:false});
}
