import { describe,expect,it } from 'vitest';
import { HandoverExecutor } from '../scripts/cloudflare-handover-executor.mjs';
import { executorFixture,ids } from './helpers/cloudflare-executor-fixture.mjs';
const run=async(f,extra={})=>new HandoverExecutor({...f.options,remote:f.remote(extra.action||'handover'),...extra}).run();
describe('integrated handover executor with isolated native contracts',()=>{
 it('persists native intents and the original target witness before the complete guarded sequence',async()=>{
  const f=executorFixture(),done=await run(f);expect(done.phase).toBe('complete');expect(done.native.targetWitness.value).toBe('paused');expect(Object.keys(done.native.operations)).toEqual(expect.arrayContaining(['hosting-fence:legacy-key-revoke','hosting-runtime:commit','hosting-delivery:target-cloudflare']));
  expect(f.state.status.control).toMatchObject({owner:'cloudflare',paused:false,old_host_fenced:true});expect(f.state.target.value).toBe('cloudflare');expect(f.mutations.indexOf('fence')).toBeLessThan(f.mutations.indexOf('commit'));
  expect(f.journals.handover.some(j=>j.pending==='transfer'&&j.native.operations['hosting-runtime:commit'])).toBe(true);
 });
 it('composes real delivery adapters with the durable executor and runtime contracts',async()=>{
  const f=executorFixture(),done=await run(f,{deliveryFactory:undefined});expect(done.phase).toBe('complete');
  expect(done.native.operations['hosting-delivery:create-consumer']).toBeDefined();expect(done.native.operations['hosting-delivery:target-cloudflare']).toBeDefined();
  expect(f.state.status.control.paused).toBe(false);expect(f.state.target.value).toBe('cloudflare');
  const recovered=await run(f,{action:'rollback',handover:done,deliveryFactory:undefined});expect(recovered.phase).toBe('complete');expect(f.state.target.value).toBe('paused');expect(f.state.consumer).not.toBe(null);expect(f.state.crons).toEqual([]);
 });
 it.each(['prepared','evidence','recovery','storage','artifact'])('blocks missing or changed %s before a runtime mutation',async reason=>{
  const f=executorFixture();if(reason==='prepared')f.state.prepared=false;if(reason==='evidence')f.state.evidence=false;if(reason==='recovery')f.state.recovery=false;if(reason==='storage')f.state.storage=false;if(reason==='artifact')f.put('dist-cloudflare/index.html','changed');
  await expect(run(f)).rejects.toThrow();expect(f.mutations).toEqual([]);
 });
 it('refuses historical archive inspection as current executable authorization',async()=>{
  const f=executorFixture(),actual=f.options.prepared.assert;
  f.options.prepared.assert=async artifact=>({...await actual(artifact),historicalReadOnly:true});
  await expect(run(f)).rejects.toThrow('handover_executor_artifact_changed');expect(f.mutations).toEqual([]);
 });
 it('reconciles a lost ownership reply from the acknowledged journal without another commit',async()=>{
  const f=executorFixture();f.state.lose='commit';await expect(run(f)).rejects.toThrow('handover_phase_uncertain');const prior=f.journals.handover.at(-1);expect(prior.intents.transfer).toBe(f.state.status.revision);
  const done=await run(f,{prior});expect(done.phase).toBe('complete');expect(f.mutations.filter(op=>op==='commit')).toHaveLength(1);
 });
 it('finishes an acknowledged own resume after legitimate new work without frozen-data checks or replay',async()=>{
  const f=executorFixture();f.state.lose='resume';await expect(run(f)).rejects.toThrow('handover_phase_uncertain');f.state.status.work.queued=1;f.state.evidence=false;
  const done=await run(f,{prior:f.journals.handover.at(-1)});expect(done.phase).toBe('complete');expect(f.mutations.filter(op=>op==='resume')).toHaveLength(1);expect(f.state.status.work.queued).toBe(1);
 });
 it('retains an explicit keep-paused policy',async()=>{
  const f=executorFixture(false);await run(f);expect(f.state.status.control.paused).toBe(true);expect(f.mutations).not.toContain('resume');
 });
 it('does not continue an acknowledged operator-intervention error',async()=>{
  const f=executorFixture();f.state.lose='commit';await expect(run(f)).rejects.toThrow();const prior={...f.journals.handover.at(-1),error:'delivery_target_witness_changed'},before=f.mutations.length;
  await expect(run(f,{prior})).rejects.toThrow('handover_operator_change_requires_replan');expect(f.mutations).toHaveLength(before);
 });
 it.each(['source-false','recover-jobs','recover-web'])('recovers lost %s after durably recording the restored database revision',async operation=>{
  const f=executorFixture(),handover=await run(f);f.state.lose=operation;
  await expect(run(f,{action:'rollback',handover})).rejects.toThrow('handover_rollback_uncertain');const prior=f.journals.rollback.at(-1);
  expect(prior.phase).toBe('restore-committed');expect(prior.revision).toBe(f.state.status.revision);
  const done=await run(f,{action:'rollback',handover,prior});expect(done.phase).toBe('complete');expect(f.state.status.control).toMatchObject({owner:'cloudflare',paused:true,old_host_fenced:true});expect(f.state.source).toBe(false);expect(f.state.serving).toEqual({web:ids.recoveryWeb,jobs:ids.recoveryJobs});expect(f.mutations.filter(op=>op==='restore')).toHaveLength(1);
 });
});
