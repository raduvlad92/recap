import { afterEach, describe, expect, it } from 'vitest';
import { executionFlags } from '../scripts/cloudflare-release-state.mjs';
import { HandoverNative, legacyExecutionPolicy, legacySite, databaseProject, fingerprint } from '../scripts/cloudflare-handover-native.mjs';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let temporaryRoot;
afterEach(()=>{if(temporaryRoot)rmSync(temporaryRoot,{recursive:true,force:true});temporaryRoot=null;});
const oldKey='sb_secret_fixture_old',newKey='sb_secret_fixture_cloudflare',off=Object.fromEntries(executionFlags.map(flag=>[flag,'false']));
const status={control:{owner:'netlify',epoch:1,release:'0'.repeat(40),paused:true,old_host_fenced:false},revision:'11111111-1111-4111-8111-111111111111',work:{queued:0,running:0,expired_running:0,uncertain:0}};
const env=(key,value,context='production')=>({key,values:[{value,context}],scopes:['functions']});
const plan={action:'initial-cloudflare-handover',oldSite:legacySite,target:'a'.repeat(40),blockers:[],expected:{...status.control,revision:status.revision}};
function fixture(){
 const state={status:structuredClone(status),flags:{...off},source:false,site:{id:legacySite,name:'recap-v0-radu',account_id:'opaque-netlify-account',build_settings:{repo_url:'https://github.com/raduvlad92/recap',stop_builds:false}},env:[env('VITE_SUPABASE_URL','https://'+databaseProject+'.supabase.co'),env('SUPABASE_SECRET_KEY',oldKey)],keys:[{id:'old-key-id',type:'secret',name:'old-private-key',api_key:oldKey}],loseCreate:false,loseDelete:false};
 const calls=[],fetcher=async(input,init={})=>{
  const url=new URL(input);calls.push({url:String(input),method:init.method,body:init.body});
  if(url.hostname==='api.netlify.com'){
   if(url.pathname.includes('/accounts/'))return Response.json(state.env);
   if(init.method==='PATCH')state.site.build_settings.stop_builds=JSON.parse(init.body).build_settings.stop_builds;
   return Response.json(state.site);
  }
  if(url.hostname==='api.supabase.com'){
   if(url.pathname.endsWith('/database/query')){const query=JSON.parse(init.body).query;expect(query).not.toMatch(/\b(insert|update|delete|alter|drop)\b/i);return Response.json(query.startsWith('with pending as')?[state.drainSummary]:query.startsWith('select provider_run_id as run_id')?state.references:query.includes('select encrypted_config')?[{encrypted_config:state.cipher}]:query.startsWith("select 'function'")?state.definitions:state.baselineRows);}
   expect(url.pathname).toContain('/projects/'+databaseProject+'/api-keys');
   if(init.method==='POST'){state.keys.push({id:'new-key-id',type:'secret',name:'therecap_cloudflare_hosting',api_key:newKey});if(state.loseCreate)throw Error('lost_create_reply');}
   if(init.method==='DELETE'){expect(url.pathname.endsWith('/old-key-id')).toBe(true);state.keys=state.keys.filter(x=>x.id!=='old-key-id');if(state.loseDelete)throw Error('lost_delete_reply');}
   return Response.json(state.keys);
  }
  if(url.hostname==='api.apify.com'){expect(init.method).toBe('GET');expect(url.pathname).toMatch(/^\/v2\/(?:actor-runs|acts)\/[A-Za-z0-9]{6,64}$/);return Response.json({data:url.pathname.includes('/actor-runs/')?state.run:state.actor});}
  if(url.hostname===databaseProject+'.supabase.co'){
   const key=init.headers.apikey;return state.keys.some(k=>k.api_key===key)?Response.json(state.status):Response.json({error:'invalid key'},{status:401});
  }
  throw Error('Unexpected destination');
 };
 const platform={databaseKey:oldKey,status:async()=>structuredClone(state.status),current:async kind=>kind==='source'?{enabled:state.source}:{mode:'shadow',flags:state.flags}};
 const native=new HandoverNative({platform,netlifyToken:'fixture-netlify',managementToken:'fixture-management',oldKey,fetcher});
 return{native,state,calls};
}
describe('native handover resource and credential boundaries',()=>{
 it('preserves explicit production values, known omission defaults and reminder opt-out',()=>{
  const p=legacyExecutionPolicy([{key:'HOURLY_COLLECTION_ENABLED',values:[{value:'true',context:'all'},{value:'false',context:'production'}]},env('AUTOMATIC_CONTENT_ENABLED','false'),env('REMINDER_EMAIL_ENABLED','true')]);
  expect(p.policy).toMatchObject({APIFY_RUNTIME_ENABLED:'false',HOURLY_COLLECTION_ENABLED:'false',CONTENT_ANALYSIS_ENABLED:'false',AUTOMATIC_CONTENT_ENABLED:'false',SOCIAL_COLLECTION_ENABLED:'true',SOCIAL_CONTENT_ENABLED:'true',DAILY_BRIEFING_ENABLED:'true',REMINDER_EMAIL_ENABLED:'false',KEYWORD_LEARNING_ENABLED:'true'});expect(p.sources.KEYWORD_LEARNING_ENABLED).toContain('no-cron');
  expect(()=>legacyExecutionPolicy([{key:'HOURLY_COLLECTION_ENABLED',values:[{context:'production'}]}])).toThrow('legacy_variable_unavailable');
 });
 it('reads the fixed legacy site and returns fingerprints/policy without credentials',async()=>{
  const f=fixture(),report=await f.native.inspectLegacy();expect(report.site).toBe(legacySite);expect(report.databaseKeyHash).toBe(fingerprint(oldKey));expect(JSON.stringify(report)).not.toContain(oldKey);expect(f.calls.every(c=>c.method==='GET')).toBe(true);
 });
 it('creates one separate replacement, verifies access and makes retry read-only',async()=>{
  const f=fixture(),first=await f.native.prepareReplacement(),second=await f.native.prepareReplacement();expect(first).toEqual(second);expect(first.oldKeyHash).not.toBe(first.replacementKeyHash);expect(f.calls.filter(c=>c.method==='POST'&&c.url.includes('api.supabase.com'))).toHaveLength(1);expect(f.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);expect(f.state.status).toEqual(status);
 });
 it('recovers a lost key-create response by exact scoped key identity',async()=>{
  const f=fixture();f.state.loseCreate=true;await expect(f.native.prepareReplacement()).rejects.toThrow('replacement_key_creation_uncertain');const retry=await f.native.prepareReplacement();expect(retry.replacementKey).toBe(newKey);expect(f.state.keys).toHaveLength(2);
 });
 it('refuses key creation on active/unpaused/queued/source-enabled state or changed legacy identity',async()=>{
  for(const mode of ['active','unpaused','queued','source','site','database','key']){const f=fixture();
   if(mode==='active')f.state.flags.HOURLY_COLLECTION_ENABLED='true';if(mode==='unpaused')f.state.status.control.paused=false;if(mode==='queued')f.state.status.work.queued=1;if(mode==='source')f.state.source=true;if(mode==='site')f.state.site.id='wrong-site';if(mode==='database')f.state.env[0].values[0].value='https://wrong.supabase.co';if(mode==='key')f.state.env[1].values[0].value=newKey;
   await expect(f.native.prepareReplacement()).rejects.toThrow();expect(f.calls.some(c=>c.method==='POST'&&c.url.includes('api.supabase.com'))).toBe(false);
  }
 });
 it('refuses every revocation before complete fresh gates, exact key receipt and durable intent',async()=>{
  const f=fixture(),replacement=await f.native.prepareReplacement();f.native.platform.databaseKey=newKey;f.state.site.build_settings.stop_builds=true;
  await expect(f.native.revokeOldKey({...plan,blockers:['privateParity_proof_required']},replacement,async()=>true,async()=>{})).rejects.toThrow('handover_fence_gates_blocked');
  await expect(f.native.revokeOldKey(plan,replacement,async()=>false,async()=>{})).rejects.toThrow('handover_fence_gates_blocked');
  await expect(f.native.revokeOldKey(plan,{...replacement,oldKeyId:'other-key'},async()=>true,async()=>{})).rejects.toThrow('handover_key_receipt_changed');
  await expect(f.native.revokeOldKey(plan,replacement,async()=>true,async()=>{throw Error('checkpoint_unavailable');})).rejects.toThrow('checkpoint_unavailable');expect(f.calls.some(c=>c.method==='DELETE')).toBe(false);
 });
 it('revokes only the recorded old key after durable intent, then reconciles a lost reply',async()=>{
  const f=fixture(),replacement=await f.native.prepareReplacement();f.native.platform.databaseKey=newKey;f.state.site.build_settings.stop_builds=true;let saved=false;f.state.loseDelete=true;
  await expect(f.native.revokeOldKey(plan,replacement,async()=>true,async data=>{saved=true;expect(JSON.stringify(data)).not.toContain(oldKey);})).rejects.toThrow('legacy_key_revocation_uncertain');expect(saved).toBe(true);
  const receipt=await f.native.revokeOldKey(plan,replacement,async()=>true,async()=>{});expect(receipt).toMatchObject({oldDatabaseStatus:401,replacementDatabaseStatus:200,oldKeyAbsent:true});expect(f.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);expect(f.state.keys.map(x=>x.id)).toEqual(['new-key-id']);
 });
 it('reads native key readiness without revoking or stopping the old host',async()=>{
  const f=fixture(),prepared=await f.native.prepareReplacement();f.native.platform.databaseKey=newKey;
  const ready=await f.native.readFenceReadiness();expect(ready.verified).toBe(true);expect(ready.externalFenceEstablished).toBe(false);expect(ready.oldKeyStatus).toBe(200);expect(JSON.stringify(ready)).not.toContain(newKey);expect(f.calls.some(c=>['DELETE','PATCH'].includes(c.method))).toBe(false);
  await expect(f.native.revokeOldKey(plan,prepared,async()=>true,async()=>{})).rejects.toThrow('legacy_builds_not_stopped');
  f.state.site.build_settings.stop_builds=true;
  await expect(f.native.revokeOldKey(plan,prepared,async()=>true,async()=>{f.state.status.revision='operator-change';})).rejects.toThrow('handover_fence_control_changed');expect(f.calls.some(c=>c.method==='DELETE')).toBe(false);
 });
 it('verifies only the pinned original database baseline and rejects drift before mutation',async()=>{
  const f=fixture();temporaryRoot=mkdtempSync(join(tmpdir(),'recap-baseline-'));mkdirSync(join(temporaryRoot,'cloudflare'));f.native.platform.root=temporaryRoot;
  const baseline={tables:['protected_fixture'],rows:[{name:'protected_fixture',count:'1',hash:'a'.repeat(64)}],metadata:[{kind:'function',id:'42',hash:'b'.repeat(64)}]};
  writeFileSync(join(temporaryRoot,'cloudflare/verified-database-baseline.json'),JSON.stringify({project:databaseProject,digest:fingerprint(JSON.stringify(baseline)),tables:1,rows:1,definitions:1}));
  f.state.baselineRows=structuredClone(baseline.rows);f.state.definitions=structuredClone(baseline.metadata);
  expect((await f.native.verifyPreservation(baseline)).allOriginalsPreserved).toBe(true);
  await expect(f.native.verifyPreservation({...baseline,tables:[]})).rejects.toThrow('database_preservation_baseline_changed');
  f.state.baselineRows[0].hash='changed';await expect(f.native.verifyPreservation(baseline)).rejects.toThrow('database_preservation_changed');
 });
 it('keeps reminder plaintext/key material out of a continuity receipt and rejects unauthenticated decoding',async()=>{
  const f=fixture(),key='fixture-worker-secret-at-least-32-characters',plain={RESEND_API_KEY:'private-fixture-provider-key'};f.state.cipher={version:1,ciphertext:'fixture-encrypted-bytes'};
  const decrypt=(_cipher,secret)=>{if(secret!==key)throw Error('authentication_failed');return plain;};
  const receipt=await f.native.verifySecretContinuity(key,decrypt);expect(receipt.authenticated).toBe(true);expect(JSON.stringify(receipt)).not.toContain(key);expect(JSON.stringify(receipt)).not.toContain(plain.RESEND_API_KEY);
  await expect(f.native.verifySecretContinuity(key,()=>plain)).rejects.toThrow('reminder_continuity_unverified');
 });
 it('permits reversible review build pause while refusing stale or active preparation',async()=>{
  const f=fixture();await expect(f.native.pauseBuildsForReview({...status,revision:'stale'})).rejects.toThrow('handover_delivery_control_changed');expect(f.calls).toHaveLength(0);
  const receipt=await f.native.pauseBuildsForReview(status);expect(receipt.buildsStopped).toBe(true);expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
  await f.native.pauseBuildsForReview(status);expect(f.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);expect(f.state.status).toEqual(status);
 });
 it('checks only exact legacy run metadata, retaining unknown financial records',async()=>{
  const f=fixture();f.state.site.disabled=true;f.state.site.published_deploy={commit_ref:'f955398088a9c911693c3e7e1ccd33d4a972c170'};f.state.site.build_settings.stop_builds=true;f.state.drainSummary={live_leases:0,unreferenced_jobs:15,latest_activity:new Date(Date.now()-48*3600000).toISOString()};f.state.references=[{run_id:'fixtureRun12',actor:'fixtureActor12'}];f.state.run={id:'fixtureRun12',actId:'fixtureActor12',status:'SUCCEEDED',finishedAt:new Date(Date.now()-48*3600000).toISOString()};
  const receipt=await f.native.readLegacyDrain('fixture-apify-token');expect(receipt.verified).toBe(true);expect(receipt.billingSettled).toBe(false);expect(receipt.unreferencedCollectionJobRows).toBe(15);expect(JSON.stringify(receipt)).not.toContain('fixtureRun12');expect(f.calls.filter(x=>x.url.includes('api.apify.com'))).toHaveLength(1);
  const referenceQuery=f.calls.find(x=>x.body?.includes('select provider_run_id as run_id')).body;expect(referenceQuery).toContain("status in ('requested','running')");expect(referenceQuery).toContain("state not in ('completed','failed')");
  f.state.run.status='RUNNING';f.state.run.finishedAt=null;expect((await f.native.readLegacyDrain('fixture-apify-token')).verified).toBe(false);
 });
 it('rejects invalid references and mismatched provider identities without starting work',async()=>{
  const f=fixture();f.state.site.disabled=true;f.state.drainSummary={live_leases:0,unreferenced_jobs:0,latest_activity:null};f.state.references=[{run_id:'run-sync/evil',actor:'fixtureActor12'}];
  await expect(f.native.readLegacyDrain('fixture-apify-token')).rejects.toThrow('legacy_provider_reference_invalid');expect(f.calls.some(x=>x.url.includes('api.apify.com'))).toBe(false);
  f.state.references=[{run_id:'fixtureRun12',actor:'fixtureActor12'}];f.state.run={id:'wrongRunId1',actId:'fixtureActor12'};await expect(f.native.readLegacyDrain('fixture-apify-token')).rejects.toThrow('legacy_provider_run_changed');
 });
 it('stops only the fixed site builds behind the same gates',async()=>{
  const f=fixture();await expect(f.native.stopBuilds({...plan,oldSite:'other-site'},async()=>true)).rejects.toThrow('handover_fence_gates_blocked');expect(f.calls).toHaveLength(0);
  await f.native.stopBuilds(plan,async()=>true);expect(f.state.site.build_settings.stop_builds).toBe(true);expect(f.calls.filter(c=>c.method==='PATCH')).toEqual([expect.objectContaining({url:'https://api.netlify.com/api/v1/sites/'+legacySite,body:'{"build_settings":{"stop_builds":true}}'})]);
 });
});
