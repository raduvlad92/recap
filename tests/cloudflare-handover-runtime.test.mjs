import { afterEach,describe,expect,it } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { assetManifest,fileHash } from '../scripts/cloudflare-artifacts.mjs';
import { ReleasePlatform,bindingHash } from '../scripts/cloudflare-release-platform.mjs';
import { HandoverRuntime } from '../scripts/cloudflare-handover-runtime.mjs';
import { readSourceRuntime,runtimeDigest } from '../scripts/cloudflare-source-runtime.mjs';
import { planHandover } from '../scripts/cloudflare-handover-state.mjs';
import { executionFlags,ReleaseError } from '../scripts/cloudflare-release-state.mjs';
const ids={web:'11111111-1111-4111-8111-111111111111',jobs:'22222222-2222-4222-8222-222222222222',source:'33333333-3333-4333-8333-333333333333',enabled:'44444444-4444-4444-8444-444444444444',newWeb:'55555555-5555-4555-8555-555555555555',newJobs:'66666666-6666-4666-8666-666666666666'};
const target='a'.repeat(40),hash='b'.repeat(64),off=Object.fromEntries(executionFlags.map(flag=>[flag,'false']));
const roots=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(resumeProcessing=true){
 const root=mkdtempSync(join(tmpdir(),'recap-handover-runtime-'));roots.push(root);
 const put=(name,body)=>{const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof body==='string'?body:JSON.stringify(body));};
 for(const name of ['web','jobs']){put('.local/cloudflare-build/'+name+'/'+name+'.js','fixture '+name);put('.local/cloudflare-build/'+name+'.json',{vars:{RELEASE_SHA:target}});}
 put('.local/cloudflare-build/source.json',{});put('.local/cloudflare-build/source-worker/source.js','fixture source worker');put('.local/cloudflare-build/source-container/server.mjs','fixture source server');put('.local/cloudflare-build/source-container/Dockerfile','fixture docker');put('dist-cloudflare/index.html','fixture page');put('cloudflare/verified-public-config.json',{});
 const artifact={release:target,mode:'active',publicConfig:{},hashes:{web:fileHash(join(root,'.local/cloudflare-build/web/web.js')),jobs:fileHash(join(root,'.local/cloudflare-build/jobs/jobs.js')),sourceWorker:fileHash(join(root,'.local/cloudflare-build/source-worker/source.js')),sourceContainer:'c'.repeat(64)},configs:Object.fromEntries(['web','jobs','source'].map(kind=>[kind,fileHash(join(root,'.local/cloudflare-build/'+kind+'.json'))])),assets:assetManifest(join(root,'dist-cloudflare'))};
 // Match the same concatenated-source digest used by checkedArtifact.
 artifact.hashes.sourceContainer=createHash('sha256').update(readFileSync(join(root,'.local/cloudflare-build/source-container/server.mjs'))).update(readFileSync(join(root,'.local/cloudflare-build/source-container/Dockerfile'))).digest('hex');
 put('.local/cloudflare-build/release.json',artifact);
 const bindings=[{name:'SOURCE_CONTAINER',type:'durable_object_namespace',namespace_id:'fixture-source-namespace'},{name:'RELEASE_SHA',type:'plain_text',text:'d'.repeat(40)}],runtime={compatibility_date:'2026-11-04',limits:{cpu_ms:1000}},configuration={image:'fixture-image@sha256:'+hash,vcpu:0.25,memory_mib:256};
 const resources=flag=>({script:{etag:'e'.repeat(64)},script_runtime:structuredClone(runtime),bindings:[...structuredClone(bindings),{name:'SOURCE_TRANSPORT_ENABLED',type:'plain_text',text:flag}]});
 const pin={schema:1,disabledVersion:ids.source,enabledVersion:ids.enabled,image:hash,scriptEtag:'e'.repeat(64),runtimeHash:runtimeDigest(runtime),bindingsHash:bindingHash(bindings),configurationHash:runtimeDigest(configuration),maximumInstances:1};
 put('cloudflare/verified-source-runtime.json',pin);put('cloudflare/verified-source.json',{version:ids.source,enabledVersion:ids.enabled,image:hash});
 artifact.configs.sourceRuntime=fileHash(join(root,'cloudflare/verified-source-runtime.json'));put('.local/cloudflare-build/release.json',artifact);
 const snapshot={control:{owner:'netlify',epoch:1,release:'0'.repeat(40),paused:true,old_host_fenced:false},revision:randomUUID(),work:{queued:0,running:0,expired_running:0,uncertain:0},domain:'recap.filternode.dev',sourceVerified:true,sourcePin:{version:ids.source,image:hash,workerHash:artifact.hashes.sourceWorker,containerHash:artifact.hashes.sourceContainer,enabled:false},workers:Object.fromEntries(['web','jobs'].map(kind=>[kind,{version:ids[kind],mode:'shadow',flags:off,bindingsHash:hash}])),evidence:Object.fromEntries(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].map(name=>[name,{verified:true,release:target,digest:hash}])),rollback:{verified:true,host:'cloudflare',mode:'active',release:'f'.repeat(40),digest:hash,versions:{web:ids.web,jobs:ids.jobs}}};
 const policy={...off,HOURLY_COLLECTION_ENABLED:'true'},plan=planHandover(artifact,snapshot,{policy,resumeProcessing});
 const state={status:{control:structuredClone(snapshot.control),revision:snapshot.revision,work:structuredClone(snapshot.work)},workers:structuredClone(snapshot.workers),sourceEnabled:false,sourceTrusted:true,currentBindingsChanged:false,resources:{[ids.source]:resources('false'),[ids.enabled]:resources('true')},app:{name:'therecap-source-sourcedownloader',max_instances:1,configuration},authorized:true,acknowledged:true,onIntent:null,lose:null,staged:{}};
 const calls=[],intents=[],writes=[];
 const fetcher=async(input,init={})=>{
  const url=new URL(input),body=init.body?JSON.parse(init.body):null;calls.push({url:url.href,method:init.method,body});
  if(url.hostname==='zlfdqzabsfndifxiqguo.supabase.co'){
   const name=url.pathname.split('/').at(-1);expect(init.method).toBe('POST');if(name==='read_hosting_release_status')return Response.json(state.status);
   expect(['commit_hosting_handover_checked','advance_hosting_release_checked','quiesce_hosting_release_checked']).toContain(name);writes.push(name);
   expect(body.p_expected_revision).toBe(state.status.revision);expect(body.p_expected_epoch).toBe(state.status.control.epoch);expect(body.p_expected_release).toBe(state.status.control.release);
   if(name==='commit_hosting_handover_checked'){expect(body.p_old_host_fenced).toBe(true);state.status.control={owner:'cloudflare',epoch:2,release:target,paused:true,old_host_fenced:true};}
   if(name==='advance_hosting_release_checked')state.status.control={...state.status.control,epoch:state.status.control.epoch+(body.p_release===state.status.control.release?0:1),release:body.p_release,paused:!body.p_resume};
   if(name==='quiesce_hosting_release_checked')state.status.control.paused=true;
   state.status.revision=body.p_next_revision;
   if(state.lose===name){state.lose=null;throw Error('lost-runtime-reply');}return Response.json(state.status);
  }
  expect(url.hostname).toBe('api.cloudflare.com');const path=url.pathname.split('/'+'a'.repeat(32))[1];let result;
  if(path==='/containers/applications')result=[state.app];
  else if(path.startsWith('/workers/scripts/therecap-source/versions/')){const id=path.split('/').at(-1);result={id,resources:state.resources[id]};}
  else if(path.endsWith('/deployments')&&init.method==='POST'){
   const kind=path.match(/therecap-(\w+)/)[1];writes.push('promote-'+kind);
   if(kind==='source')state.sourceEnabled=body.versions[0].version_id===ids.enabled;else state.workers[kind]=structuredClone(state.staged[kind]);
   if(state.lose==='promote-'+kind){state.lose=null;throw Error('lost-runtime-reply');}result={};
  }else throw Error('Unexpected runtime endpoint');
  return Response.json({success:true,result});
 };
 const platform=new ReleasePlatform({root,account:'a'.repeat(32),token:'fixture-cloudflare',databaseKey:'sb_secret_fixture_database',fetcher});
 platform.current=async kind=>kind==='source'?{version:state.sourceEnabled?ids.enabled:ids.source,enabled:state.sourceEnabled,bindingsHash:state.currentBindingsChanged?'0'.repeat(64):bindingHash(state.resources[state.sourceEnabled?ids.enabled:ids.source].bindings)}:structuredClone(state.workers[kind]);
 platform.source=async()=>({verified:state.sourceTrusted,domain:'recap.filternode.dev',pin:{version:state.sourceEnabled?ids.enabled:ids.source,enabled:state.sourceEnabled,image:hash}});
 platform.uploadVersion=async(kind,actual,flags,mode,bounds)=>{expect(actual).toEqual(artifact);expect(flags).toEqual(policy);expect(mode).toBe('active');expect(bounds).toBe(hash);if(!state.staged[kind]){writes.push('upload-'+kind);state.staged[kind]={version:kind==='web'?ids.newWeb:ids.newJobs,mode:'active',release:target,flags:{...policy},sourceVerified:true,bindingsHash:hash};if(state.lose==='upload-'+kind){state.lose=null;throw new ReleaseError('release_version_upload_uncertain');}}return state.staged[kind].version;};
 platform.assertVersion=async(kind,version)=>{expect(version).toBe(state.staged[kind].version);return version;};
 const adapter=new HandoverRuntime({platform,artifact,plan,authorize:async()=>state.authorized,saveIntent:async intent=>{intents.push(intent);await state.onIntent?.(intent);return state.acknowledged;}});
 const expected=structuredClone(state.status);return{root,put,artifact,plan,pin,state,calls,writes,intents,platform,adapter,expected};
}
async function activated(f,resume=true){const versions=await f.adapter.stage(f.expected),paused=await f.adapter.commit(f.expected,randomUUID(),versions);await f.adapter.promote(paused,versions);const status=resume?await f.adapter.resume(paused,randomUUID(),versions):paused;return{versions,paused,status};}
describe('guarded native handover runtime with isolated providers',()=>{
 it('stages before ownership and promotes only the pinned source and jobs/web while paused',async()=>{
  const f=fixture();const {status}=await activated(f);expect(status.control).toMatchObject({owner:'cloudflare',epoch:2,release:target,paused:false,old_host_fenced:true});
  expect(f.writes).toEqual(['upload-jobs','upload-web','commit_hosting_handover_checked','promote-source','promote-jobs','promote-web','advance_hosting_release_checked']);expect(f.intents.length).toBe(7);expect(f.calls.some(call=>/download|messages|purge|api-keys/.test(call.url))).toBe(false);
 });
 it.each(['etag','runtime','binding','current-binding','secret','flag','image','capacity','private'])('refuses changed source %s before runtime writes',async reason=>{
  const f=fixture();if(reason==='etag')f.state.resources[ids.enabled].script.etag='0'.repeat(64);if(reason==='runtime')f.state.resources[ids.enabled].script_runtime.limits.cpu_ms=300000;if(reason==='binding')f.state.resources[ids.enabled].bindings[0].namespace_id='different';if(reason==='secret')f.state.resources[ids.enabled].bindings.push({name:'PRIVATE_KEY',type:'secret_text'});if(reason==='flag')f.state.resources[ids.enabled].bindings.at(-1).text='false';if(reason==='image')f.state.app.configuration.image='unverified-image';if(reason==='capacity')f.state.app.max_instances=2;if(reason==='private')f.state.sourceTrusted=false;
  if(reason==='current-binding')f.state.currentBindingsChanged=true;await expect(f.adapter.stage(f.expected)).rejects.toThrow();expect(f.writes).toEqual([]);
 });
 it.each(['artifact','revision','work','gates','intent','worker'])('refuses changed %s before ownership transfer',async reason=>{
  const f=fixture(),versions=await f.adapter.stage(f.expected),before=f.writes.length;if(reason==='artifact')f.put('dist-cloudflare/index.html','tampered');if(reason==='revision')f.state.status.revision=randomUUID();if(reason==='work')f.state.status.work.uncertain=1;if(reason==='gates')f.state.authorized=false;if(reason==='intent')f.state.acknowledged=false;if(reason==='worker')f.state.workers.jobs.version=ids.newJobs;
  await expect(f.adapter.commit(f.expected,randomUUID(),versions)).rejects.toThrow();expect(f.writes).toHaveLength(before);
 });
 it('rechecks an intervening operator pause after durable intent acknowledgement',async()=>{
  const f=fixture(),versions=await f.adapter.stage(f.expected),before=f.writes.length;f.state.onIntent=()=>{f.state.status.revision=randomUUID();};await expect(f.adapter.commit(f.expected,randomUUID(),versions)).rejects.toThrow('handover_runtime_control_changed');expect(f.writes).toHaveLength(before);
 });
 it.each(['upload-jobs','promote-source','promote-jobs','promote-web'])('reconciles lost %s without repeating the applied mutation',async operation=>{
  const f=fixture();f.state.lose=operation;
  if(operation==='upload-jobs'){await expect(f.adapter.stage(f.expected)).rejects.toThrow();await f.adapter.stage(f.expected);}
  else{const versions=await f.adapter.stage(f.expected),paused=await f.adapter.commit(f.expected,randomUUID(),versions);await expect(f.adapter.promote(paused,versions)).rejects.toThrow('lost-runtime-reply');await f.adapter.promote(paused,versions);}
  expect(f.writes.filter(value=>value===operation)).toHaveLength(1);
 });
 it('reconciles its own lost commit acknowledgement and refuses an operator replacement revision',async()=>{
  const f=fixture(),nonce=randomUUID(),versions=await f.adapter.stage(f.expected);f.state.lose='commit_hosting_handover_checked';await expect(f.adapter.commit(f.expected,nonce,versions)).rejects.toThrow('lost-runtime-reply');expect((await f.adapter.commit(f.expected,nonce,versions)).revision).toBe(nonce);expect(f.writes.filter(value=>value==='commit_hosting_handover_checked')).toHaveLength(1);
  f.state.status.revision=randomUUID();await expect(f.adapter.commit(f.expected,nonce,versions)).rejects.toThrow('handover_runtime_control_changed');expect(f.writes).toHaveLength(3);
 });
 it('acknowledges its own resumed operation after legitimate queued work without replaying it',async()=>{
  const f=fixture(),{versions,paused}=await activated(f,false),nonce=randomUUID();f.state.lose='advance_hosting_release_checked';await expect(f.adapter.resume(paused,nonce,versions)).rejects.toThrow('lost-runtime-reply');f.state.status.work.queued=1;
  const result=await f.adapter.resume(paused,nonce,versions);expect(result.control.paused).toBe(false);expect(result.work.queued).toBe(1);expect(f.writes.filter(value=>value==='advance_hosting_release_checked')).toHaveLength(1);
 });
 it('never resumes under the explicit keep-paused policy',async()=>{
  const f=fixture(false),{versions,paused}=await activated(f,false);await expect(f.adapter.resume(paused,randomUUID(),versions)).rejects.toThrow('handover_runtime_operation_invalid');expect(f.state.status.control.paused).toBe(true);
 });
 it('reconciles paused recovery/restore operations and disables only the pinned source while preserving the fence',async()=>{
  const f=fixture(),{versions,status}=await activated(f),pauseNonce=randomUUID();f.state.lose='quiesce_hosting_release_checked';await expect(f.adapter.pauseForRollback(status,pauseNonce)).rejects.toThrow('lost-runtime-reply');const paused=await f.adapter.pauseForRollback(status,pauseNonce),restoreNonce=randomUUID();
  f.state.lose='advance_hosting_release_checked';await expect(f.adapter.restoreRelease(status,f.plan.rollback.release,paused.revision,restoreNonce)).rejects.toThrow('lost-runtime-reply');const restored=await f.adapter.restoreRelease(status,f.plan.rollback.release,paused.revision,restoreNonce);
  expect(restored.control).toMatchObject({owner:'cloudflare',epoch:3,release:f.plan.rollback.release,paused:true,old_host_fenced:true});await f.adapter.setSourceEnabled(restored,false,versions);expect(f.state.sourceEnabled).toBe(false);expect(f.writes.filter(value=>value==='quiesce_hosting_release_checked')).toHaveLength(1);
 });
 it('reads sanitized source metadata without a provider write or source request',async()=>{
  const f=fixture(),receipt=await readSourceRuntime(f.platform,f.artifact);expect(receipt).toMatchObject({verified:true,enabled:false,maximumInstances:1,publicRoute:false,secretBindings:0});expect(JSON.stringify(receipt)).not.toMatch(/fixture-cloudflare|fixture_database|fixture-source-namespace/);expect(f.writes).toEqual([]);
 });
});
