import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ReaderReleaseDb, quote, jsonSql, sha256 } from './helpers/reader-release-db.mjs';
import { sourcePins } from '../scripts/reader-migration-pins.mjs';
const migration = '20261111211058_provider_metadata_stages.sql';
let server, db;
const sql = text => server.sql(db, text), service = text => sql('set role service_role;' + text);
const source = 'metadata-stage-source', video = 'abcdefghijk';
const content = 'This is an exact retained transcript and it must never be bought again just to determine video format.';
const hash = sha256(content), formatKey = 'youtube-format:' + video + ':' + hash;
const record = {id:'metadata-stage-update',sourceId:source,url:'https://www.youtube.com/watch?v='+video,publishedAt:'2026-11-11T10:00:00Z',contentKind:'transcript',content,title:'Synthetic retained transcript',format:'video',topics:[],brands:[],videoKeywords:[],isSample:false,videoFormat:{kind:'unknown'}};
const state = {version:1,customSources:[{id:source,name:'Synthetic',platform:'YouTube',url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',status:'ready',creatorIds:[]}],followedSourceIds:[source],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}};
const actor = 'h7sDV53CddomktSi5';
function fixture(owner) {
  sql(`insert into public.reader_workspaces(user_id,state)values(${quote(owner)},${jsonSql(state)});
    insert into public.reader_collection_policies(user_id,enabled,provider_enabled)values(${quote(owner)},true,true);
    insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${quote(owner)},'metadata-stage-update',${quote(source)},'fixture',${quote(record.publishedAt)},${jsonSql(record)});`);
  const claim = JSON.parse(service(`select public.claim_hourly_source(${quote(owner)},${quote(source)});`));
  const ledger = sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status)
    values(${quote(owner)},${quote(source)},'Synthetic',${quote(record.url)},'YouTube','apify',${quote(actor)},'requested')returning id;`);
  return {owner,claim,ledger};
}
const reserve = (f, key = formatKey, cap = '.005', actorId = actor) => JSON.parse(service(`select public.reserve_hourly_provider(${quote(f.claim.checkId)},${quote(f.claim.leaseToken)},${quote(key)},${quote(f.ledger)},${quote(actorId)},${cap});`));
const metadata = extra => ({...record,videoFormat:{kind:'regular',basis:'provider'},isShort:false,metadataExpectedContentHash:hash,...extra});
const finish = (f,incoming) => JSON.parse(service(`select public.finish_hourly_source(${quote(f.claim.checkId)},${quote(f.claim.leaseToken)},'{"status":"partial"}',${jsonSql([{itemKey:'youtube:'+video,record:incoming}])});`));
const archive = owner => JSON.parse(sql(`select record from public.reader_source_updates where user_id=${quote(owner)} and id='metadata-stage-update';`));
beforeAll(() => {
  const originalBin=process.env.READER_TEST_PG_BIN;
  try {
    process.env.READER_TEST_PG_BIN=originalBin||(existsSync('/usr/lib/postgresql/17/bin/initdb')?'/usr/lib/postgresql/17/bin':'/opt/homebrew/opt/postgresql@17/bin');
    server = new ReaderReleaseDb();
  } finally { if(originalBin===undefined)delete process.env.READER_TEST_PG_BIN;else process.env.READER_TEST_PG_BIN=originalBin; }
  db = server.fresh();
  const core = new Set(sourcePins.core.map(x => x.file));
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql') && !core.has(file) && file < migration).sort()) sql(readFileSync('supabase/migrations/' + file, 'utf8'));
  const f = fixture('pre-migration-owner');
  reserve(f, 'youtube:00000000000');
  sql(`create table original_provider_rows as select id,to_jsonb(j)as record from public.reader_collection_provider_jobs j;
    create table original_finance_rows as select id,to_jsonb(r)as record from public.collection_budget_reservations r;
    create table original_sources as select user_id,id,to_jsonb(a)as record from public.reader_source_updates a;`);
  sql(readFileSync('supabase/migrations/' + migration, 'utf8'));
}, 40000);
afterAll(() => server?.close());
it('preserves every preexisting source and financial row, including unknown held fees', () => {
  expect(sql(`select count(*)from original_provider_rows o join public.reader_collection_provider_jobs j using(id)where o.record is distinct from to_jsonb(j);`)).toBe('0');
  expect(sql(`select count(*)from original_finance_rows o join public.collection_budget_reservations r using(id)where o.record is distinct from to_jsonb(r);`)).toBe('0');
  expect(sql(`select count(*)from original_sources o join public.reader_source_updates a using(user_id,id)where o.record is distinct from to_jsonb(a);`)).toBe('0');
  expect(sql(`select state||':'||(actual_cost_usd is null)::text from public.collection_budget_reservations where id in(select id from original_finance_rows);`)).toBe('held:true');
});
it('admits distinct metadata work once for exact retained transcript and unchanged source, without reusing caption intent', () => {
  const f = fixture('metadata-success'), before = sql(`select record from public.reader_source_updates where user_id='metadata-success';`);
  const result = reserve(f); expect(result.claimed).toBe(true); expect(reserve(f).claimed).toBe(false);
  expect(sql(`select count(*)from public.reader_collection_provider_jobs where user_id='metadata-success';`)).toBe('1');
  expect(sql(`select record from public.reader_source_updates where user_id='metadata-success';`)).toBe(before);
  expect(sql(`select maximum_usd||':'||state||':'||(actual_cost_usd is null)::text from public.collection_budget_reservations where id=${quote(result.reservationId)};`)).toBe('0.005000:held:true');
});
it.each(['wrong-hash','wrong-video','no-transcript','known-format','cap','actor','stale-lease','changed-follow'])('rejects metadata admission when %s', reason => {
  const f = fixture('metadata-denied-' + reason); let key = formatKey, cap = '.005', actorId = actor;
  if (reason === 'wrong-hash') key = 'youtube-format:' + video + ':' + '0'.repeat(64);
  if (reason === 'wrong-video') key = 'youtube-format:zzzzzzzzzzz:' + hash;
  if (reason === 'no-transcript') sql(`update public.reader_source_updates set record=record||'{"contentKind":"metadata_only"}'where user_id=${quote(f.owner)};`);
  if (reason === 'known-format') sql(`update public.reader_source_updates set record=jsonb_set(record,'{videoFormat,kind}','"regular"')where user_id=${quote(f.owner)};`);
  if (reason === 'cap') cap = '.005001';
  if (reason === 'actor') actorId = 'UnreviewedActor';
  if (reason === 'stale-lease') f.claim.leaseToken = '11111111-1111-4111-8111-111111111111';
  if (reason === 'changed-follow') sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]')where user_id=${quote(f.owner)};`);
  expect(() => reserve(f,key,cap,actorId)).toThrow();
  expect(sql(`select count(*)from public.reader_collection_provider_jobs where user_id=${quote(f.owner)};`)).toBe('0');
});
it('retains all original source caps and global account limits after new admission', () => {
  expect(sql(`select bool_and(daily_limit_usd=.10 and lifetime_limit_usd=1)from public.reader_collection_policies;`)).toBe('t');
  expect(() => service(`select public.reserve_hourly_provider(gen_random_uuid(),gen_random_uuid(),${quote(formatKey)},gen_random_uuid(),${quote(actor)},.005);`)).toThrow();
});
it('applies only matching metadata format at atomic write, without storing its marker or replacing source annotations',()=>{
  const f=fixture('metadata-match-write'), original=archive(f.owner);
  const result=finish(f,metadata({title:'Must not replace the title',content:'Must not replace current transcript',videoKeywords:['Must not replace annotations']}));
  expect(result.retrievedCount).toBe(1);
  expect(archive(f.owner)).toEqual({...original,videoFormat:{kind:'regular',basis:'provider'},isShort:false});
  expect(archive(f.owner)).not.toHaveProperty('metadataExpectedContentHash');
});
it.each([null,7,'malformed','0'.repeat(64)])('leaves CURRENT source entirely unchanged for malformed/stale metadata marker %s',marker=>{
  const f=fixture('metadata-marker-'+String(marker).slice(0,12)), before=archive(f.owner);
  expect(finish(f,metadata({metadataExpectedContentHash:marker})).retrievedCount).toBe(0);
  expect(archive(f.owner)).toEqual(before);
});
it('does not insert a metadata repair whose exact base archive is absent',()=>{
  const f=fixture('metadata-no-base'), before=archive(f.owner);
  expect(finish(f,metadata({id:'absent-metadata-base'})).retrievedCount).toBe(0);
  expect(sql(`select count(*)from public.reader_source_updates where user_id=${quote(f.owner)};`)).toBe('1');
  expect(archive(f.owner)).toEqual(before);
  expect(sql(`select count(*)from public.reader_source_updates where record ? 'metadataExpectedContentHash';`)).toBe('0');
});
it('rejects an old queued hash after the live archive changes while preserving the exact completed provider fee and receipt',()=>{
  const f=fixture('metadata-live-content-race'), reservation=reserve(f);
  service(`select public.settle_collection_budget(${quote(reservation.reservationId)},'MetadataRaceCompletedRun',.004,true);
   update public.reader_collection_provider_jobs set state='completed',provider_run_id='MetadataRaceCompletedRun',actual_cost_usd=.004,content_pending=false,finished_at=clock_timestamp()where id=${quote(reservation.id)};
   update public.collection_jobs set status='succeeded',provider_run_id='MetadataRaceCompletedRun',observed_cost_usd=.004,cost_status='provider_reported',finished_at=clock_timestamp()where id=${quote(f.ledger)};`);
  const finances=()=>sql(`select jsonb_build_object('provider',(select to_jsonb(j)from public.reader_collection_provider_jobs j where id=${quote(reservation.id)}),'reservation',(select to_jsonb(r)from public.collection_budget_reservations r where id=${quote(reservation.reservationId)}),'ledger',(select to_jsonb(l)from public.collection_jobs l where id=${quote(f.ledger)}));`);
  const financeBefore=finances(), corrected={...record,content:content+' A later correction changed the source.',videoKeywords:['Curated existing annotation']};
  sql(`update public.reader_source_updates set record=${jsonSql(corrected)} where user_id=${quote(f.owner)};`);
  expect(finish(f,metadata()).retrievedCount).toBe(0);
  expect(archive(f.owner)).toEqual(corrected); expect(finances()).toBe(financeBefore);
  expect(sql(`select actual_cost_usd||':'||state from public.collection_budget_reservations where id=${quote(reservation.reservationId)};`)).toBe('0.004000000000:settled');
  expect(sql(`select count(*)from public.reader_collection_provider_jobs where user_id=${quote(f.owner)};`)).toBe('1');
});
it('rechecks the current source hash after a concurrent archive writer commits ahead of the metadata UPDATE',async()=>{
  const f=fixture('metadata-concurrent-write'), reservation=reserve(f), corrected={...record,content:content+' Concurrently corrected before metadata write.'};
  const writer=server.session(db), worker=server.session(db);
  const finances=()=>sql(`select jsonb_build_object('provider',(select to_jsonb(j)from public.reader_collection_provider_jobs j where id=${quote(reservation.id)}),'reservation',(select to_jsonb(r)from public.collection_budget_reservations r where id=${quote(reservation.reservationId)}));`);
  const before=finances(); let pending;
  try {
    await writer.command(`begin;update public.reader_source_updates set record=${jsonSql(corrected)} where user_id=${quote(f.owner)};`);
    await worker.command(`set application_name='metadata-concurrent-worker';set role service_role;`);
    pending=worker.command(`select public.finish_hourly_source(${quote(f.claim.checkId)},${quote(f.claim.leaseToken)},'{"status":"partial"}',${jsonSql([{itemKey:'youtube:'+video,record:metadata()}])});`);
    let blocked=false;
    for(let i=0;i<50;i++) {
      blocked=sql(`select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='metadata-concurrent-worker'and wait_event_type='Lock');`)==='t';
      if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(blocked).toBe(true); await writer.command('commit;');
    expect(JSON.parse(await pending)).toMatchObject({retrievedCount:0,importAccepted:true});
    expect(archive(f.owner)).toEqual(corrected); expect(finances()).toBe(before);
  } finally { writer.close(); worker.close(); await pending?.catch(()=>{}); }
});
it('accepts only a live native frame capability, blocks stale control and preserves uncertain history', () => {
  const release = 'a'.repeat(40), revision = '22222222-2222-4222-8222-222222222222', token = '33333333-3333-4333-8333-333333333333';
  sql(`update public.hosting_runtime_control set owner='cloudflare',paused=false,old_host_fenced=true,epoch=77,release=${quote(release)},release_revision=${quote(revision)};
    insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until)values('cron:hourly-collection:77:1','hourly-collection',77,${quote(release)},'running',${quote(token)},clock_timestamp()+interval'1 minute'),('legacy-uncertain-preserved','automatic-content',1,repeat('0',40),'uncertain',null,null);`);
  const call = (stage='collection',rev=revision) => service(`select public.pipeline_service_capability('cron:hourly-collection:77:1',${quote(token)},77,${quote(release)},${quote(rev)},${quote(stage)},null);`);
  expect(call()).toBe('t'); expect(call('enrichment')).toBe('t'); expect(call('generation')).toBe('f'); expect(call('verification')).toBe('f'); expect(call('unknown')).toBe('f');
  expect(call('collection','44444444-4444-4444-8444-444444444444')).toBe('f');
  sql(`insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until)values('cron:social-content:77:1','social-content',77,${quote(release)},'running',${quote(token)},clock_timestamp()+interval'1 minute');`);
  const social = stage => service(`select public.pipeline_service_capability('cron:social-content:77:1',${quote(token)},77,${quote(release)},${quote(revision)},${quote(stage)},null);`);
  expect(social('generation')).toBe('t'); expect(social('verification')).toBe('t'); expect(social('collection')).toBe('f');
  service(`select public.admit_hosting_work('cron:automatic-content:77:123','automatic-content',77,${quote(release)},null);select public.begin_automatic_hosting_queue_work('cron:automatic-content:77:123',77,${quote(release)},'exact-native-message');`);
  const automaticToken=sql(`select lease_token from public.hosting_work where key='cron:automatic-content:77:123';`);
  const automatic = message => service(`select public.pipeline_service_capability('cron:automatic-content:77:123',${quote(automaticToken)},77,${quote(release)},${quote(revision)},'verification',${quote(message)});`);
  expect(automatic('exact-native-message')).toBe('t'); expect(automatic('different-message')).toBe('f');
  sql(`insert into public.hosting_work(key,kind,epoch,release,state,lease_token,lease_until)values('cron:automatic-content:77:122','automatic-content',77,${quote(release)},'running',${quote(token)},clock_timestamp()+interval'1 minute');
    with moment as(select clock_timestamp()-interval'18 minutes'as at)insert into public.hosting_queue_invocations(key,message_id,queue_name,control_revision,frame,bound_policy,recorded_at,not_after)
    select w.key,'expired-native-message','therecap-jobs',${quote(revision)},to_jsonb(w),'cloudflare-queue-wall-15m-plus-2m-v1',moment.at,moment.at+interval'17 minutes'from public.hosting_work w cross join moment where w.key='cron:automatic-content:77:122';`);
  expect(service(`select public.pipeline_service_capability('cron:automatic-content:77:122',${quote(token)},77,${quote(release)},${quote(revision)},'generation','expired-native-message');`)).toBe('f');
  // Expired/changed native frames fail even while release controls stay valid.
  sql(`update public.hosting_work set lease_until=clock_timestamp()-interval'1 second'where key='cron:automatic-content:77:123';`); expect(automatic('exact-native-message')).toBe('f');
  for(const role of ['anon','authenticated']) expect(()=>sql(`set role ${role};select public.pipeline_service_capability('cron:hourly-collection:77:1',${quote(token)},77,${quote(release)},${quote(revision)},'collection',null);`)).toThrow(/permission denied/);
  sql(`update public.hosting_runtime_control set paused=true;`); expect(call()).toBe('f');
  expect(sql(`select state from public.hosting_work where key='legacy-uncertain-preserved';`)).toBe('uncertain');
  expect(sql(`select has_function_privilege('anon','public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)','execute')or has_function_privilege('authenticated','public.pipeline_service_capability(text,uuid,bigint,text,uuid,text,text)','execute');`)).toBe('f');
});
