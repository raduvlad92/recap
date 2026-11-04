import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { planHandover, runHandover, runHandoverRollback } from '../scripts/cloudflare-handover-state.mjs';
import { executionFlags, ReleaseError } from '../scripts/cloudflare-release-state.mjs';
const target='a'.repeat(40),old='b'.repeat(40),receipt='c'.repeat(64),ids={web:'11111111-1111-4111-8111-111111111111',jobs:'22222222-2222-4222-8222-222222222222',source:'33333333-3333-4333-8333-333333333333',newWeb:'44444444-4444-4444-8444-444444444444',newJobs:'55555555-5555-4555-8555-555555555555'};
function fixture(resumeProcessing=true){
 const artifact={release:target,mode:'active',hashes:{web:'d'.repeat(64),jobs:'e'.repeat(64),sourceWorker:'f'.repeat(64),sourceContainer:'0'.repeat(64)},assets:{'index.html':'1'.repeat(64)}};
 const off=Object.fromEntries(executionFlags.map(flag=>[flag,'false'])),policy={...off,HOURLY_COLLECTION_ENABLED:'true'};
 const snapshot={control:{owner:'netlify',epoch:1,release:'0'.repeat(40),paused:true,old_host_fenced:false},revision:randomUUID(),work:{queued:0,running:0,expired_running:0,uncertain:0},domain:'recap.filternode.dev',sourceVerified:true,sourcePin:{version:ids.source,image:'2'.repeat(64),workerHash:artifact.hashes.sourceWorker,containerHash:artifact.hashes.sourceContainer,enabled:false},workers:Object.fromEntries(['web','jobs'].map(kind=>[kind,{version:ids[kind],release:old,mode:'shadow',flags:{...off},bindingsHash:'3'.repeat(64)}])),evidence:Object.fromEntries(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].map(name=>[name,{verified:true,release:target,digest:receipt}])),rollback:{verified:true,host:'cloudflare',mode:'active',release:old,digest:receipt,versions:{web:ids.web,jobs:ids.jobs}}};
 return{artifact,snapshot,options:{policy,resumeProcessing},plan:planHandover(artifact,snapshot,{policy,resumeProcessing})};
}
function ports(snapshot){
 const state=structuredClone(snapshot),events=[],saved=[];
 Object.assign(state,{target:'netlify',fenced:false,checked:true,evidence:true,readback:true,rollbackProof:true,serving:{web:ids.web,jobs:ids.jobs}});
 const status=async()=>structuredClone({control:state.control,revision:state.revision,work:state.work});
 const apply=(control,revision)=>{state.control=control;state.revision=revision;return status();};
 const api={status,assertCheckedHandover:async()=>{if(!state.checked)throw new ReleaseError('checked_head_changed');},verifyEvidence:async()=>state.evidence,
 stopDelivery:async()=>{events.push('stop-delivery');state.target='paused';},verifyTarget:async value=>state.target===value,
 fenceOldHost:async()=>{if(!state.fenced)events.push('fence');state.fenced=true;return receipt;},verifyFence:async(_plan,value)=>state.fenced&&value===receipt,
 stage:async()=>{events.push('stage');return{web:ids.newWeb,jobs:ids.newJobs};},
 commit:async(plan,nonce)=>{events.push('commit');expect(state.control.paused).toBe(true);expect(state.fenced).toBe(true);expect(state.target).toBe('paused');return apply({owner:'cloudflare',epoch:plan.expected.epoch+1,release:plan.target,paused:true,old_host_fenced:true},nonce);},
 promote:async(_plan,versions)=>{events.push('promote');expect(state.control.paused).toBe(true);state.serving=structuredClone(versions);},configureDelivery:async()=>{events.push('configure');expect(state.control.paused).toBe(true);},
 verifyReadback:async()=>state.readback&&state.serving.web===ids.newWeb&&state.serving.jobs===ids.newJobs,
 selectCloudflare:async()=>{events.push('select');expect(state.control.paused).toBe(true);state.target='cloudflare';},
 resume:async(_plan,revision,nonce)=>{events.push('resume');expect(state.revision).toBe(revision);expect(state.target).toBe('cloudflare');return apply({...state.control,paused:false},nonce);},
 assertCheckedRecovery:async()=>{if(!state.checked)throw new ReleaseError('checked_recovery_changed');},verifyRollbackProof:async()=>state.rollbackProof,verifyRecoveryFence:async()=>state.fenced,
 pauseForRollback:async(expected,nonce)=>{events.push('rollback-pause');expect(state.revision).toBe(expected.revision);return apply({...state.control,paused:true},nonce);},
 restoreRelease:async(expected,release,revision,nonce)=>{events.push('restore-release');expect(state.revision).toBe(revision);return apply({...state.control,epoch:expected.control.epoch+(release===expected.control.release?0:1),release,paused:true},nonce);},
 restoreVersions:async rollback=>{events.push('restore-versions');expect(state.control.paused).toBe(true);state.serving=structuredClone(rollback.versions);},verifyRecovery:async rollback=>state.serving.web===rollback.versions.web&&state.serving.jobs===rollback.versions.jobs,
 };
 return{api,state,events,saved,save:async value=>{saved.push(structuredClone(value));}};
}
describe('initial ownership handover with isolated ports',()=>{
 it('requires explicit existing policy, exact-release evidence and a usable Cloudflare rollback',()=>{
  const {artifact,snapshot,options}=fixture();snapshot.rollback.unexpectedPrivateValue='private-fixture-do-not-record';snapshot.sourcePin.unexpectedPrivateValue='private-fixture-do-not-record';expect(JSON.stringify(planHandover(artifact,snapshot,options))).not.toContain('private-fixture-do-not-record');expect(planHandover(artifact,snapshot).blockers).toEqual(expect.arrayContaining(['explicit_existing_execution_policy_required','reminder_policy_unverified']));delete snapshot.evidence.privateParity;snapshot.rollback.host='netlify';delete options.policy.HOURLY_COLLECTION_ENABLED;
  expect(planHandover(artifact,snapshot,options).blockers).toEqual(expect.arrayContaining(['privateParity_proof_required','explicit_existing_execution_policy_required','usable_cloudflare_rollback_required']));
 });
 it.each(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'])('refuses missing or wrong-release %s receipts before any mutation',async name=>{
  const {artifact,snapshot,options}=fixture();snapshot.evidence[name].release=old;const plan=planHandover(artifact,snapshot,options),p=ports(snapshot);
  await expect(runHandover(plan,p.api,p.save)).rejects.toThrow('handover_gates_blocked');expect(p.events).toEqual([]);
 });
 it('blocks shadow artifacts, live duplicate flags, jobs, missing source/domain proof and enabled reminders',()=>{
  const {artifact,snapshot,options}=fixture();artifact.mode='shadow';snapshot.work.uncertain=1;snapshot.workers.jobs.flags.HOURLY_COLLECTION_ENABLED='true';snapshot.sourceVerified=false;snapshot.domain='wrong.example';options.policy.REMINDER_EMAIL_ENABLED='true';
  expect(planHandover(artifact,snapshot,options).blockers).toEqual(expect.arrayContaining(['active_artifact_required','hosting_work_must_be_resolved','inert_duplicate_required','source_artifact_proof_required','permanent_domain_unverified','reminders_must_remain_off']));
 });
 it('checkpoints before every mutation and resumes only after routing, readback and target selection',async()=>{
  const {plan,snapshot}=fixture(),p=ports(snapshot),original=p.api.commit;
  p.api.commit=async(...args)=>{expect(p.saved.at(-1).pending).toBe('transfer');expect(p.saved.at(-1).intents.transfer).toMatch(/[a-f0-9-]{36}/);return original(...args);};
  const journal=await runHandover(plan,p.api,p.save);expect(journal.phase).toBe('complete');expect(p.events).toEqual(['stop-delivery','fence','stage','commit','promote','configure','select','resume']);expect(p.state.control).toMatchObject({owner:'cloudflare',epoch:2,release:target,paused:false,old_host_fenced:true});
  const prior=p.events.length;await runHandover(plan,p.api,p.save,journal);expect(p.events).toHaveLength(prior);
 });
 it('honors the explicit policy to keep processing paused',async()=>{
  const{plan,snapshot}=fixture(false),p=ports(snapshot);await runHandover(plan,p.api,p.save);expect(p.state.control.paused).toBe(true);expect(p.events).not.toContain('resume');
 });
 it.each(['commit','resume'])('reconciles a successful %s with a lost reply without repeating it',async operation=>{
  const{plan,snapshot}=fixture(),p=ports(snapshot),original=p.api[operation];let failed=false;
  p.api[operation]=async(...args)=>{const value=await original(...args);if(!failed){failed=true;throw Error('lost_reply');}return value;};
  await expect(runHandover(plan,p.api,p.save)).rejects.toThrow('handover_phase_uncertain');
  await runHandover(plan,p.api,p.save,p.saved.at(-1));expect(p.events.filter(value=>value===operation)).toHaveLength(1);
 });
 it.each(['commit','resume'])('refuses an operator pause after the ambiguous %s reply',async operation=>{
  const{plan,snapshot}=fixture(),p=ports(snapshot),original=p.api[operation];
  p.api[operation]=async(...args)=>{await original(...args);p.state.control.paused=true;p.state.revision=randomUUID();throw Error('lost_reply');};
  await expect(runHandover(plan,p.api,p.save)).rejects.toThrow('handover_phase_uncertain');
  await expect(runHandover(plan,p.api,p.save,p.saved.at(-1))).rejects.toThrow('handover_control_changed');expect(p.state.control.paused).toBe(true);expect(p.events.filter(value=>value===operation)).toHaveLength(1);
 });
 it('keeps ownership unchanged when fencing cannot be proved',async()=>{
  const{plan,snapshot}=fixture(),p=ports(snapshot);p.api.verifyFence=async()=>false;
  await expect(runHandover(plan,p.api,p.save)).rejects.toThrow('handover_fence_unverified');expect(p.state.control.owner).toBe('netlify');expect(p.events).not.toContain('stage');
 });
 it('keeps Cloudflare paused and does not select/resume after failed readback',async()=>{
  const{plan,snapshot}=fixture(),p=ports(snapshot);p.state.readback=false;
  await expect(runHandover(plan,p.api,p.save)).rejects.toThrow('handover_readback_failed');expect(p.state.control).toMatchObject({owner:'cloudflare',paused:true});expect(p.state.target).toBe('paused');expect(p.events).not.toContain('resume');
 });
 it('fails before mutation if checkpoint storage, checked head or fresh evidence fails',async()=>{
  for(const failure of ['storage','head','evidence']){const{plan,snapshot}=fixture(),p=ports(snapshot);if(failure==='head')p.state.checked=false;if(failure==='evidence')p.state.evidence=false;
   await expect(runHandover(plan,p.api,failure==='storage'?async()=>{throw Error('storage_unavailable');}:p.save)).rejects.toThrow();expect(p.events).toEqual([]);
  }
 });
 it('rejects changed artifacts, journal revisions and unknown journal fields',async()=>{
  const{plan,snapshot}=fixture(),p=ports(snapshot);await runHandover(plan,p.api,p.save);
  await expect(runHandover({...plan,artifactDigest:'f'.repeat(64)},p.api,p.save)).rejects.toThrow('handover_plan_changed');
  for(const extra of [{revision:randomUUID()},{privateData:'forbidden'}])await expect(runHandover(plan,p.api,p.save,{...p.saved.at(-1),...extra})).rejects.toThrow('handover_checkpoint_changed');
 });
});
describe('Cloudflare rollback rehearsal',()=>{
 async function activated(){const{plan,snapshot}=fixture(),p=ports(snapshot);await runHandover(plan,p.api,p.save);p.events.length=0;return{plan,p};}
 it('restores the proved Cloudflare release and versions while retaining a pause/fence',async()=>{
  const{plan,p}=await activated(),saved=[];const result=await runHandoverRollback(plan,p.api,async value=>saved.push(value));
  expect(result.phase).toBe('complete');expect(p.state.control).toMatchObject({owner:'cloudflare',epoch:3,release:old,paused:true,old_host_fenced:true});expect(p.state.target).toBe('paused');expect(p.events).not.toContain('resume');
  await runHandoverRollback(plan,p.api,async()=>{},saved.at(-1));expect(p.events.filter(value=>value==='restore-release')).toHaveLength(1);
 });
 it.each(['pauseForRollback','restoreRelease'])('reconciles a lost %s reply without repeating the transition',async operation=>{
  const{plan,p}=await activated(),saved=[],original=p.api[operation];let failed=false;
  p.api[operation]=async(...args)=>{const value=await original(...args);if(!failed){failed=true;throw Error('lost_reply');}return value;};
  await expect(runHandoverRollback(plan,p.api,async value=>saved.push(value))).rejects.toThrow('handover_rollback_uncertain');
  await runHandoverRollback(plan,p.api,async value=>saved.push(value),saved.at(-1));expect(p.events.filter(value=>value===(operation==='pauseForRollback'?'rollback-pause':'restore-release'))).toHaveLength(1);
 });
 it('refuses live work, changed recovery proof and an intervening operator update',async()=>{
  for(const failure of ['work','proof','operator']){const{plan,p}=await activated(),saved=[];
   if(failure==='work')p.state.work.running=1;
   if(failure==='proof')p.state.rollbackProof=false;
   if(failure==='operator'){const original=p.api.pauseForRollback;p.api.pauseForRollback=async(...args)=>{await original(...args);p.state.revision=randomUUID();throw Error('lost_reply');};}
   await expect(runHandoverRollback(plan,p.api,async value=>saved.push(value))).rejects.toThrow();
   if(failure==='operator')await expect(runHandoverRollback(plan,p.api,async value=>saved.push(value),saved.at(-1))).rejects.toThrow('handover_control_changed');
   expect(p.events).not.toContain('restore-versions');expect(p.state.control.release).toBe(target);
  }
 });
});
