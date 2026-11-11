// Offline PostgreSQL 17 only. Never reads env credentials or a hosted server.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { ReaderReleaseDb, sha256 } from '../tests/helpers/reader-release-db.mjs';
import { sourcePins } from './reader-migration-pins.mjs';
if (process.argv.length !== 2) throw new Error('This offline catalogue helper takes no arguments');
const migration = '20261111211058_provider_metadata_stages.sql', source = readFileSync('supabase/migrations/' + migration, 'utf8');
const server = new ReaderReleaseDb();
try {
  const database = server.fresh(), core = new Set(sourcePins.core.map(x => x.file));
  for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && !core.has(name) && name < migration).sort()) server.sql(database, readFileSync('supabase/migrations/' + name,'utf8'));
  const before = server.catalogue(database);
  const identity = () => JSON.parse(server.sql(database,`select jsonb_build_object('functions',(select coalesce(jsonb_agg(jsonb_build_object('key',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','oid',p.oid)order by p.oid),'[]')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','recap_internal')),'constraints',(select coalesce(jsonb_agg(jsonb_build_object('key',n.nspname||'.'||c.relname||'.'||con.conname,'oid',con.oid)order by con.oid),'[]')from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','recap_internal')));`));
  const beforeIdentity = identity(); server.sql(database, source); const after = server.catalogue(database), afterIdentity = identity();
  const left = new Map(before.map(x=>[x.key,x])), right = new Map(after.map(x=>[x.key,x]));
  const changes = [...new Set([...left.keys(),...right.keys()])].sort().flatMap(key=>left.get(key)?.sha256===right.get(key)?.sha256?[]:[{key,before:left.get(key)||null,after:right.get(key)||null}]);
  const identityChanges = Object.fromEntries(['functions','constraints'].map(kind=>{
    const a = new Map(beforeIdentity[kind].map(x=>[x.key,x.oid])), b = new Map(afterIdentity[kind].map(x=>[x.key,x.oid]));
    return [kind,[...new Set([...a.keys(),...b.keys()])].filter(key=>a.get(key)!==b.get(key)).map(key=>({key,before:a.get(key)||null,after:b.get(key)||null}))];
  }));
  const invariants = ['function:reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)','function:prepare_late_provider_fee(uuid)','function:merge_hourly_video_enrichment(jsonb,jsonb)','function:finish_hourly_source(uuid,uuid,jsonb,jsonb)'].map(key=>{
    const a = left.get(key), b = right.get(key); if(!a||!b||a.sha256!==b.sha256)throw new Error('Existing service ACL/function metadata changed: '+key);
    return {key,before:a,after:b};
  });
  const receipt = {schema:1,recordedAt:new Date().toISOString(),evidence:'offline_disposable_postgresql_17',productionWrites:0,migration,sourceSha256:sha256(source),beforeCount:before.length,afterCount:after.length,changes,invariants,identityChanges};
  mkdirSync('.local/provider-quality-implementation',{recursive:true}); writeFileSync('.local/provider-quality-implementation/metadata-migration-local-catalogue.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({migration,sourceSha256:receipt.sourceSha256,beforeCount:before.length,afterCount:after.length,changedKeys:changes.map(x=>x.key),identityChanges}));
} finally { server.close(); }
