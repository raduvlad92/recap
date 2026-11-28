import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The shared disposable PostgreSQL harness is plain ESM.
import { ReaderReleaseDb, readerSources, quote, jsonSql } from './helpers/reader-release-db.mjs';

const migration = '20261125232024_provider_generation_ack.sql';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const reviewed = ['UCdBK94H6oZT2Q7l0-b0xmMg', 'UCeeFfhMcJa1kjtfZAGskOCA', 'UChIs72whgZI9w6d6FhwGGHA'];
const unlisted = 'UCabcdefghijklmnopqrstuv';
const actor = 'h7sDV53CddomktSi5';
const sha = 'a'.repeat(40);
const pause = '00000000-0000-4000-8000-000000000011';
const resumed = '00000000-0000-4000-8000-000000000012';
const pausedAgain = '00000000-0000-4000-8000-000000000013';
const rollbackRevision = '00000000-0000-4000-8000-000000000014';
const reader = 'pilot-fixture-reader';

describe('checked YouTube pilot on disposable PostgreSQL', () => {
 let server: ReaderReleaseDb;
 let baseline: string;
 beforeAll(() => {
  server = new ReaderReleaseDb();
  baseline = server.fresh();
  for (const sql of readerSources()) server.sql(baseline, sql);
  for (const name of readdirSync(migrations).filter(name => name >= '20261111023125' && name <= migration && name.endsWith('.sql')).sort()) {
   server.sql(baseline, readFileSync(new URL(name,migrations),'utf8'));
  }
 }, 45_000);
 afterAll(() => server?.close());

 function fixture() {
  const dbName = server.fresh();
  // The two fixtures are fresh isolated databases. Match the migrated baseline.
  server.sql('postgres', `drop database ${dbName}; create database ${dbName} template ${baseline};`);
  const sql = (value: string) => server.sql(dbName,value);
  const service = (value: string) => sql('set role service_role; ' + value);
  const sources = [...reviewed, reviewed[0], unlisted].map((id,index) => ({
   id: 'source-'+index, name:'Fixture '+index, url:'https://www.youtube.com/channel/'+id, platform:'YouTube', status:'ready', creatorIds:[],
  }));
  const state={version:1,customSources:sources,followedSourceIds:sources.map(x=>x.id),importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}};
  sql(`insert into public.reader_workspaces(user_id,state)values(${quote(reader)},${jsonSql(state)});
   insert into public.reader_collection_policies(user_id,enabled,provider_enabled,daily_limit_usd,lifetime_limit_usd) values(${quote(reader)},true,true,.1,1);
   update public.hosting_runtime_control set owner='cloudflare',release=${quote(sha)},epoch=10,old_host_fenced=true,paused=true,release_revision=${quote(pause)} where singleton;`);
  const claims=sources.map((source,index)=>{
   const channel=[...reviewed,reviewed[0],unlisted][index];
   const c=JSON.parse(service(`select public.claim_hourly_source(${quote(reader)},${quote(source.id)})`));
   sql(`update public.reader_collection_source_state set channel_id=${quote(channel)} where user_id=${quote(reader)} and source_id=${quote(source.id)}`);
   const job=sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status)
      values(${quote(reader)},${quote(source.id)},'Fixture',${quote(source.url)},'YouTube','apify',${quote(actor)},'requested') returning id;`);
   return { ...c, channel, job,sourceId:source.id };
  });
  const scope=(channels:string[]=reviewed,revision=pause)=>service(`select public.restore_hourly_youtube_pilot_checked(
    10,${quote(sha)},${quote(revision)},${quote(resumed)},${quote(reader)},array[${channels.map(quote).join(',')}]);`);
  const day=sql("select (clock_timestamp() at time zone 'UTC')::date");
  const reserve=(index:number,dayKey=day, key='youtube-discovery:'+claims[index].channel+':'+day, amount=.02)=>{
   const c=claims[index];
   return JSON.parse(service(`select public.reserve_hourly_youtube_pilot(${quote(c.checkId)},${quote(c.leaseToken)},${quote(key)},${quote(c.job)},${amount},${quote(dayKey)});`));
  };
  return {sql,service,claims,scope,reserve,day};
 }

 it('fences restoration and uses the same checked transition for rollback', () => {
  const f=fixture();
  expect(()=>f.scope([reviewed[0],reviewed[1],unlisted])).toThrow(/PT400/);
  expect(()=>f.scope(reviewed,pausedAgain)).toThrow(/PT409/);
  expect(f.sql("select count(*) from public.collection_budget_reservations where request_key='hourly.youtube-tech-pilot.v1'")).toBe('0');
  const installed=JSON.parse(f.scope([...reviewed].reverse()));
  expect(installed).toMatchObject({revision:resumed,channelIds:reviewed,control:{paused:false,epoch:10,release:sha}});
  expect(JSON.parse(f.scope()).envelopeId).toBe(installed.envelopeId);
  expect(JSON.parse(f.service('select public.read_hourly_youtube_pilot()'))).toMatchObject({readerId:reader,channelIds:reviewed,proofDay:f.day,recurring:false});
  expect(()=>f.sql('set role authenticated; select public.read_hourly_youtube_pilot()')).toThrow(/42501/);
  f.service(`select public.quiesce_hosting_release_checked(10,${quote(sha)},${quote(resumed)},${quote(pausedAgain)})`);
  const reset=JSON.parse(f.service(`select public.restore_hourly_youtube_pilot_checked(
   10,${quote(sha)},${quote(pausedAgain)},${quote(rollbackRevision)},null,null)`));
  expect(reset).toMatchObject({revision:rollbackRevision,channelIds:null,control:{paused:false}});
  expect(f.service('select public.read_hourly_youtube_pilot() is null')).toBe('t');
  expect(f.sql("select daily_limit_usd||':'||lifetime_limit_usd from public.reader_collection_policies")).toBe('0.100000:1.000000');
  expect(f.sql(`select state from public.collection_budget_reservations where id=${quote(installed.envelopeId)}`)).toBe('held');
 });

 it('rejects an unlisted channel and deduplicates exact channels across source aliases', () => {
  const f=fixture();
  const {envelopeId}=JSON.parse(f.scope());
  expect(()=>f.reserve(4)).toThrow(/PT409/);
  expect(()=>f.reserve(0,'2020-01-01')).toThrow(/PT409/);
  const first=f.reserve(0);
  expect(first).toMatchObject({claimed:true});
  expect(f.reserve(3)).toEqual({claimed:false,id:first.id});
  expect(f.reserve(1)).toMatchObject({claimed:true});
  expect(f.reserve(2)).toMatchObject({claimed:true});
  expect(f.sql(`select count(*)||':'||sum(maximum_usd) from public.collection_budget_reservations where parent_id=${quote(envelopeId)}`)).toBe('3:0.060000');
 });

 it('admits the $0.075 proof with $0.075 carried and caps one caption fallback per channel', () => {
  const f=fixture();
  const old=f.claims[4];
  const oldFee=f.service(`select (public.reserve_collection_budget('fixture.retained_hold',.075,'job',null,'apify',${quote(actor)})).id`);
  f.sql(`insert into public.reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,created_at)
   select ${quote(reader)},s.source_id,'youtube:oldhold0001',s.fingerprint,${quote(old.checkId)},${quote(old.job)},${quote(oldFee)},${quote(actor)},.075,'ambiguous',clock_timestamp()-interval '1 day'
   from public.reader_collection_source_state s where s.user_id=${quote(reader)} and s.source_id=${quote(old.sourceId)};`);
  expect(()=>f.sql('update public.reader_collection_policies set daily_limit_usd=.20,lifetime_limit_usd=3.50')).toThrow(/PT409/);
  const {envelopeId}=JSON.parse(f.scope());
  const captionIds=['abcdefghijk','lmnopqrstuv','01234567890','abcdefghijZ'];
  for (let i=0;i<4;i++) {
   const record={url:'https://www.youtube.com/watch?v='+captionIds[i],sourceId:f.claims[i].sourceId,contentKind:'metadata_only'};
   f.sql(`update public.reader_collection_source_state set pending_captions=${jsonSql([{record}])}
    where user_id=${quote(reader)} and source_id=${quote(f.claims[i].sourceId)}`);
  }
  expect(()=>f.reserve(0,f.day,'youtube:zzzzzzzzzzz',.005)).toThrow(/PT400/);
  for (let i=0;i<3;i++) {
   expect(f.reserve(i).claimed).toBe(true);
   // The production collector uses a separate, requested collection job per reservation.
   f.claims[i].job=f.sql(`insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status)
     values(${quote(reader)},${quote(f.claims[i].sourceId)},'Fixture','https://www.youtube.com/watch?v=${captionIds[i]}','YouTube','apify',${quote(actor)},'requested') returning id;`);
   expect(f.reserve(i,f.day,'youtube:'+captionIds[i],.005).claimed).toBe(true);
  }
  expect(f.reserve(3,f.day,'youtube:'+captionIds[3],.005).claimed).toBe(false);
  expect(f.sql(`select count(*)||':'||sum(maximum_usd) from public.collection_budget_reservations where parent_id=${quote(envelopeId)}`)).toBe('6:0.075000');
  expect(f.sql('select sum(maximum_usd) from public.reader_collection_provider_jobs')).toBe('0.150000');
 });
 it('blocks new launches outside the initial proof date until another checked restore', () => {
  const f=fixture();
  const tomorrow=f.sql("select (clock_timestamp() at time zone 'UTC')::date+1");
  const restore=(recurring:boolean,expected:string,next:string)=>f.service(`select public.restore_hourly_youtube_pilot_checked(
   10,${quote(sha)},${quote(expected)},${quote(next)},${quote(reader)},array[${reviewed.map(quote).join(',')}],${recurring},${quote(tomorrow)});`);
  expect(()=>restore(true,pause,resumed)).toThrow(/PT409/);
  restore(false,pause,resumed);
  expect(()=>f.reserve(0)).toThrow(/PT409/);
  expect(f.sql('select count(*) from recap_internal.hourly_youtube_pilot_daily')).toBe('0');
  expect(JSON.parse(f.service('select public.read_hourly_youtube_pilot()'))).toMatchObject({proofDay:tomorrow,recurring:false});
 });
 it('refuses cap drift and leaves the release and envelope unchanged', () => {
  const f=fixture();
  f.sql("update public.reader_collection_policies set daily_limit_usd=.09");
  expect(()=>f.scope()).toThrow(/PT409/);
  expect(f.sql("select count(*) from public.collection_budget_reservations where request_key='hourly.youtube-tech-pilot.v1'")).toBe('0');
  expect(JSON.parse(f.service('select public.read_hosting_release_status()'))).toMatchObject({revision:pause,control:{paused:true}});
 });
 it('enforces the $2.50 envelope and applies the reviewed reader ceilings', () => {
  const f=fixture();
  const {envelopeId}=JSON.parse(f.scope());
  f.service(`select public.reserve_collection_budget('fixture.nearly_full',2.49,'job',${quote(envelopeId)},'apify',${quote(actor)});`);
  expect(()=>f.reserve(0)).toThrow(/PT402[\s\S]*Envelope budget exhausted/);
  expect(f.sql('select count(*) from recap_internal.hourly_youtube_pilot_daily')).toBe('0');
  expect(f.sql('select daily_limit_usd::numeric||\':\'||lifetime_limit_usd::numeric from public.reader_collection_policies')).toBe('0.200000:3.500000');
 });

 it('binds a returned generation ID without releasing the hold, refuses drift and is service-only', () => {
  const f=fixture();
  const token='00000000-0000-4000-8000-000000000031';
  const requestHash='c'.repeat(64);
  const identity={adapterVersion:'fixture-v1',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'deepinfra/fp8',
    model:'fixture/test',reasoningEffort:null,pricing:{version:'fixture-v1',inputUsdPerMillion:.1,outputUsdPerMillion:.4,
      cachedInputUsdPerMillion:null,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
  const id=f.sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,execution_identity,request_hash)
   values('fixture-model-reader','fixture-call',${quote(token)},'fixture/test',repeat('a',64),.10,${jsonSql(identity)},${quote(requestHash)}) returning id`);
  const ack=(generation:string,hash=requestHash)=>`select public.record_openrouter_generation_ack(${quote(id)},${quote(token)},${quote(hash)},${quote(generation)})`;
  expect(()=>f.sql('set role authenticated; '+ack('gen-fixture'))).toThrow(/42501/);
  expect(()=>f.service(ack('gen-fixture','b'.repeat(64)))).toThrow(/PT409/);
  f.service(ack('gen-fixture'));
  f.service(ack('gen-fixture'));
  expect(()=>f.service(ack('gen-other'))).toThrow(/PT409/);
  expect(f.sql(`select provider_id||':'||state||':'||(actual_usd is null)::text from public.reader_content_analysis_calls where id=${quote(id)}`))
   .toBe('gen-fixture:reserved:true');
 });
});
