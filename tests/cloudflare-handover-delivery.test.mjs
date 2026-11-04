import { describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HandoverDelivery,deliveryPolicy,readDelivery } from '../scripts/cloudflare-handover-delivery.mjs';
import { ReleasePlatform } from '../scripts/cloudflare-release-platform.mjs';
import { ReleaseGitHub } from '../scripts/cloudflare-release-github.mjs';
import { planHandover,assertHandoverCheckpoint } from '../scripts/cloudflare-handover-state.mjs';
import { executionFlags } from '../scripts/cloudflare-release-state.mjs';
const target='a'.repeat(40),hash='b'.repeat(64),ids={web:'11111111-1111-4111-8111-111111111111',jobs:'22222222-2222-4222-8222-222222222222',source:'33333333-3333-4333-8333-333333333333',newWeb:'44444444-4444-4444-8444-444444444444',newJobs:'55555555-5555-4555-8555-555555555555'};
const off=Object.fromEntries(executionFlags.map(flag=>[flag,'false']));
function fixture(){
 const artifact={release:target,mode:'active',hashes:Object.fromEntries(['web','jobs','sourceWorker','sourceContainer'].map(name=>[name,hash])),assets:{'index.html':hash},configs:{web:hash,jobs:hash,source:hash}};
 const snapshot={control:{owner:'netlify',epoch:1,release:'0'.repeat(40),paused:true,old_host_fenced:false},revision:randomUUID(),work:{queued:0,running:0,expired_running:0,uncertain:0},domain:'recap.filternode.dev',sourceVerified:true,sourcePin:{version:ids.source,image:hash,workerHash:hash,containerHash:hash,enabled:false},workers:Object.fromEntries(['web','jobs'].map(kind=>[kind,{version:ids[kind],mode:'shadow',flags:off,bindingsHash:hash}])),evidence:Object.fromEntries(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].map(name=>[name,{verified:true,release:target,digest:hash}])),rollback:{verified:true,host:'cloudflare',mode:'active',release:'c'.repeat(40),digest:hash,versions:{web:ids.web,jobs:ids.jobs}}};
 const policy={...off,HOURLY_COLLECTION_ENABLED:'true',SOCIAL_COLLECTION_ENABLED:'true',KEYWORD_LEARNING_ENABLED:'true'},plan=planHandover(artifact,snapshot,{policy,resumeProcessing:false});
 const state={status:{control:{owner:'cloudflare',epoch:2,release:target,paused:true,old_host_fenced:true},revision:randomUUID(),work:structuredClone(snapshot.work)},workers:Object.fromEntries(['web','jobs'].map(kind=>[kind,{mode:'active',version:kind==='web'?ids.newWeb:ids.newJobs,release:target,flags:{...policy},bindingsHash:hash}])),selection:{name:'HOSTING_TARGET',value:'paused',updated_at:'2026-11-04T10:00:00Z'},crons:{web:[],jobs:[],source:[]},consumers:{['1'.repeat(32)]:[],['2'.repeat(32)]:[]},authorized:true,acknowledged:true,lose:null,onIntent:null};
 const calls=[],intents=[];
 const fetcher=async(input,init={})=>{
  const url=new URL(input),method=init.method||'GET';calls.push({url:url.href,method,body:init.body&&JSON.parse(init.body)});
  if(url.hostname==='api.github.com'){
   expect(url.pathname).toBe('/repos/raduvlad92/recap/actions/variables/HOSTING_TARGET');
   if(method==='PATCH'){const body=JSON.parse(init.body);expect(body.name).toBe('HOSTING_TARGET');state.selection={...state.selection,value:body.value,updated_at:'2026-11-04T11:00:00Z'};if(state.lose==='target'){state.lose=null;throw Error('lost-target-reply');}return new Response(null,{status:204});}
   expect(method).toBe('GET');return Response.json(state.selection);
  }
  expect(url.hostname).toBe('api.cloudflare.com');const path=url.pathname.split('/'+'a'.repeat(32))[1];
  let result;
  if(path==='/queues'){expect(method).toBe('GET');result=[{queue_name:'therecap-jobs',queue_id:'1'.repeat(32)},{queue_name:'therecap-jobs-dead',queue_id:'2'.repeat(32)}];}
  else if(/\/queues\/[12]{32}\/consumers$/.test(path)){
   const id=path.split('/')[2];if(method==='POST'){state.consumers[id].push({...JSON.parse(init.body),consumer_id:'3'.repeat(32)});if(state.lose==='consumer'){state.lose=null;throw Error('lost-consumer-reply');}result=state.consumers[id][0];}else{expect(method).toBe('GET');result=state.consumers[id];}
  }else if(/\/workers\/scripts\/therecap-(web|jobs|source)\/schedules$/.test(path)){
   const kind=path.match(/therecap-(\w+)/)[1];if(method==='PUT'){expect(kind).toBe('jobs');state.crons[kind]=JSON.parse(init.body);if(state.lose==='schedules'){state.lose=null;throw Error('lost-schedules-reply');}}else expect(method).toBe('GET');result={schedules:state.crons[kind]};
  }else throw Error('Unexpected delivery endpoint');
  return Response.json({success:true,result});
 };
 const native=new ReleasePlatform({root:process.cwd(),account:'a'.repeat(32),token:'fixture-cloudflare',fetcher});
 const platform={cf:native.cf.bind(native),status:async()=>structuredClone(state.status),current:async kind=>structuredClone(state.workers[kind])};
 const github=new ReleaseGitHub({token:'fixture-github-operator',runId:1,fetcher});
 const delivery=new HandoverDelivery({platform,github,plan,artifact,authorize:async()=>state.authorized,saveIntent:async intent=>{intents.push(intent);await state.onIntent?.(intent);return state.acknowledged;}});
 const expected=structuredClone(state.status),versions={web:ids.newWeb,jobs:ids.newJobs},witness={name:state.selection.name,value:state.selection.value,updatedAt:state.selection.updated_at};
 return{artifact,snapshot,plan,state,calls,intents,platform,github,delivery,expected,versions,witness,mutations:()=>calls.filter(call=>call.method!=='GET')};
}
describe('fixed-resource handover delivery adapters',()=>{
 it('derives only the seven scheduled kinds and preserves private manual learning',()=>{
  expect(deliveryPolicy(off)).toEqual({crons:[],consumer:null});
  const manual=deliveryPolicy({...off,KEYWORD_LEARNING_ENABLED:'true'});expect(manual.crons).toEqual([]);expect(manual.consumer).toMatchObject({script_name:'therecap-jobs',settings:{batch_size:1,max_concurrency:6,max_retries:3}});
  expect(deliveryPolicy({...off,HOURLY_COLLECTION_ENABLED:'true'}).crons).toEqual(['0 * * * *']);
  expect(()=>deliveryPolicy({...off,REMINDER_EMAIL_ENABLED:'true'})).toThrow('delivery_policy_unverified');
 });
 it('inspects exact resources without writes or exposing credentials',async()=>{
  const f=fixture(),surface=await readDelivery(f.platform,f.github);expect(surface.target.value).toBe('paused');expect(surface.schedules.jobs).toEqual([]);expect(f.mutations()).toEqual([]);expect(JSON.stringify(surface)).not.toMatch(/fixture-cloudflare|fixture-github-operator/);
 });
 it('creates a bounded consumer before schedules while paused and selects the existing variable with 204 readback',async()=>{
  const f=fixture(),control=structuredClone(f.state.status);await f.delivery.configureDelivery(f.expected,f.versions);expect(f.mutations().map(call=>call.method)).toEqual(['POST','PUT']);expect(f.intents.map(intent=>intent.operation)).toEqual(['create-consumer','configure-schedules']);
  await f.delivery.selectCloudflare(f.expected,f.versions,f.witness);expect(f.state.selection.value).toBe('cloudflare');expect(f.state.status).toEqual(control);expect(f.mutations().at(-1)).toMatchObject({method:'PATCH',body:{name:'HOSTING_TARGET',value:'cloudflare'}});
  const before=f.mutations().length;await f.delivery.selectCloudflare(f.expected,f.versions,f.witness);expect(f.mutations()).toHaveLength(before);
 });
 it('accepts the real native script field without recreating the existing bounded consumer',async()=>{
  const f=fixture(),{script_name,...body}=deliveryPolicy(f.plan.policy).consumer;
  f.state.consumers['1'.repeat(32)]=[{...body,script:script_name,consumer_id:'3'.repeat(32)}];
  await f.delivery.configureDelivery(f.expected,f.versions);await f.delivery.selectCloudflare(f.expected,f.versions,f.witness);
  expect(f.mutations().map(call=>call.method)).toEqual(['PUT','PATCH']);
  expect((await readDelivery(f.platform,f.github)).queues['therecap-jobs'].consumers[0]).toMatchObject({script_name:'therecap-jobs',settings:{batch_size:1,max_concurrency:6,max_retries:3,max_wait_time_ms:1000,retry_delay:60}});
 });
 it('accepts agreeing documented and native consumer names',async()=>{
  const f=fixture(),body=deliveryPolicy(f.plan.policy).consumer;
  f.state.consumers['1'.repeat(32)]=[{...body,script:body.script_name,consumer_id:'3'.repeat(32)}];
  await f.delivery.configureDelivery(f.expected,f.versions);expect(f.mutations().map(call=>call.method)).toEqual(['PUT']);
 });
 it.each(['conflicting','wrong','missing'])('rejects a %s native consumer identity before a delivery mutation',async reason=>{
  const f=fixture(),{script_name,...body}=deliveryPolicy(f.plan.policy).consumer;
  const identity=reason==='conflicting'?{script_name:'another-worker',script:script_name}:reason==='wrong'?{script:'another-worker'}:{};
  f.state.consumers['1'.repeat(32)]=[{...body,...identity,consumer_id:'3'.repeat(32)}];
  await expect(f.delivery.configureDelivery(f.expected,f.versions)).rejects.toThrow('delivery_consumer_changed');expect(f.mutations()).toEqual([]);
 });
 it('persists real delivery intents through the executor checkpoint validator',async()=>{
  const f=fixture(),nonce=randomUUID();
  const journal={schema:1,planDigest:f.plan.digest,phase:'transferred',pending:'route',error:null,versions:f.versions,fenceReceipt:'b'.repeat(64),revision:nonce,intents:{transfer:nonce},native:{schema:1,targetWitness:f.witness,operations:{}}};
  f.state.onIntent=intent=>{journal.native.operations[intent.kind+':'+intent.operation]=intent;assertHandoverCheckpoint(f.plan,journal);};
  await f.delivery.configureDelivery(f.expected,f.versions);await f.delivery.selectCloudflare(f.expected,f.versions,f.witness);
  expect(Object.keys(journal.native.operations)).toHaveLength(3);
 });
 it.each(['consumer','schedules','target'])('reconciles an applied %s with a lost response without repeating it',async operation=>{
  const f=fixture();if(operation==='target')await f.delivery.configureDelivery(f.expected,f.versions);f.state.lose=operation;
  const apply=()=>operation==='target'?f.delivery.selectCloudflare(f.expected,f.versions,f.witness):f.delivery.configureDelivery(f.expected,f.versions);
  await expect(apply()).rejects.toThrow('lost-'+operation+'-reply');await apply();
  expect(f.mutations().filter(call=>operation==='consumer'?call.method==='POST':operation==='schedules'?call.method==='PUT':call.method==='PATCH')).toHaveLength(1);
 });
 it.each(['ownership','revision','pause','fence','work','version','flags','bindings','evidence','intent'])('blocks changed %s before configuration',async reason=>{
  const f=fixture();if(reason==='ownership')f.state.status.control.owner='netlify';if(reason==='revision')f.state.status.revision=randomUUID();if(reason==='pause')f.state.status.control.paused=false;if(reason==='fence')f.state.status.control.old_host_fenced=false;if(reason==='work')f.state.status.work.uncertain=1;if(reason==='version')f.state.workers.jobs.version=ids.jobs;if(reason==='flags')f.state.workers.jobs.flags.HOURLY_COLLECTION_ENABLED='false';if(reason==='bindings')f.state.workers.jobs.bindingsHash='d'.repeat(64);if(reason==='evidence')f.state.authorized=false;if(reason==='intent')f.state.acknowledged=false;
  await expect(f.delivery.configureDelivery(f.expected,f.versions)).rejects.toThrow();expect(f.mutations()).toEqual([]);
 });
 it('rechecks the operator revision after intent acknowledgement',async()=>{
  const f=fixture();f.state.onIntent=()=>{f.state.status.revision=randomUUID();};await expect(f.delivery.configureDelivery(f.expected,f.versions)).rejects.toThrow('delivery_control_changed');expect(f.mutations()).toEqual([]);
 });
 it.each(['web-cron','source-cron','unknown-cron','foreign-consumer','unbounded-consumer','dead-letter-consumer'])('refuses %s instead of overwriting it',async reason=>{
  const f=fixture(),body=deliveryPolicy(f.plan.policy).consumer;
  if(reason==='web-cron')f.state.crons.web=[{cron:'*/5 * * * *'}];if(reason==='source-cron')f.state.crons.source=[{cron:'*/5 * * * *'}];if(reason==='unknown-cron')f.state.crons.jobs=[{cron:'1 * * * *'}];
  if(reason==='foreign-consumer')f.state.consumers['1'.repeat(32)]=[{...body,consumer_id:'3'.repeat(32),script_name:'another-worker'}];
  if(reason==='unbounded-consumer')f.state.consumers['1'.repeat(32)]=[{...body,consumer_id:'3'.repeat(32),settings:{...body.settings,max_concurrency:null}}];
  if(reason==='dead-letter-consumer')f.state.consumers['2'.repeat(32)]=[{...body,consumer_id:'3'.repeat(32)}];
  await expect(f.delivery.configureDelivery(f.expected,f.versions)).rejects.toThrow();expect(f.mutations()).toEqual([]);
 });
 it('rejects a changed target witness and a delivery edit during final selection',async()=>{
  const f=fixture();await f.delivery.configureDelivery(f.expected,f.versions);const before=f.mutations().length;f.state.selection.updated_at='2026-11-04T10:01:00Z';await expect(f.delivery.selectCloudflare(f.expected,f.versions,f.witness)).rejects.toThrow('delivery_target_witness_changed');expect(f.mutations()).toHaveLength(before);
  f.state.selection.updated_at=f.witness.updatedAt;f.state.onIntent=intent=>{if(intent.operation==='target-cloudflare')f.state.consumers['1'.repeat(32)]=[];};await expect(f.delivery.selectCloudflare(f.expected,f.versions,f.witness)).rejects.toThrow('delivery_configuration_unverified');expect(f.mutations()).toHaveLength(before);
 });
 it('stops scheduled admissions during recovery while preserving the consumer, queued work and holds',async()=>{
  const f=fixture();await f.delivery.configureDelivery(f.expected,f.versions);f.state.selection.value='cloudflare';f.state.status.control.paused=false;f.state.status.work.queued=1;
  const expected=structuredClone(f.state.status),witness={...f.witness,value:'cloudflare'},consumer=structuredClone(f.state.consumers['1'.repeat(32)]),before=f.mutations().length;
  await f.delivery.stopDelivery(expected,f.versions,witness);expect(f.state.crons.jobs).toEqual([]);expect(f.state.consumers['1'.repeat(32)]).toEqual(consumer);expect(f.state.status).toEqual(expected);expect(f.mutations().slice(before).map(call=>call.method)).toEqual(['PATCH','PUT']);expect(f.calls.some(call=>/purge|messages|api-keys/.test(call.url))).toBe(false);
 });
 it('pauses only the legacy deployment selection when the original copy is inert',async()=>{
  const f=fixture();f.state.status={control:structuredClone(f.snapshot.control),revision:f.snapshot.revision,work:structuredClone(f.snapshot.work)};f.state.workers=structuredClone(f.snapshot.workers);f.state.selection.value='netlify';
  await f.delivery.stopDelivery(structuredClone(f.state.status),null,{...f.witness,value:'netlify'});expect(f.state.selection.value).toBe('paused');expect(f.mutations().map(call=>call.method)).toEqual(['PATCH']);
 });
});
