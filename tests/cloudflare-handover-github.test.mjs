import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HandoverJournal, probeHandoverJournal } from '../scripts/cloudflare-handover-github.mjs';
import { ReleaseGitHub } from '../scripts/cloudflare-release-github.mjs';
import { planHandover, runHandover, runHandoverRollback } from '../scripts/cloudflare-handover-state.mjs';
import { executionFlags } from '../scripts/cloudflare-release-state.mjs';
const target = 'a'.repeat(40), hash = 'b'.repeat(64), ids = { web: '11111111-1111-4111-8111-111111111111', jobs: '22222222-2222-4222-8222-222222222222', source: '33333333-3333-4333-8333-333333333333' };
function fixture() {
  const artifact = { release: target, mode: 'active', hashes: Object.fromEntries(['web','jobs','sourceWorker','sourceContainer'].map(name => [name,hash])), assets: { 'index.html': hash }, configs: { web: hash, jobs: hash, source: hash }, publicConfig: { origin: 'https://recap.filternode.dev' } };
  const off = Object.fromEntries(executionFlags.map(flag => [flag,'false']));
  const snapshot = { control: { owner: 'netlify', epoch: 1, release: '0'.repeat(40), paused: true, old_host_fenced: false }, revision: randomUUID(), work: { queued: 0, running: 0, expired_running: 0, uncertain: 0 }, domain: 'recap.filternode.dev', sourceVerified: true, sourcePin: { version: ids.source, image: hash, workerHash: hash, containerHash: hash, enabled: false }, workers: Object.fromEntries(['web','jobs'].map(kind => [kind,{ version: ids[kind], mode: 'shadow', flags: off, bindingsHash: hash }])), evidence: Object.fromEntries(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].map(name => [name,{ verified: true, release: target, digest: hash }])), rollback: { verified: true, host: 'cloudflare', mode: 'active', release: 'c'.repeat(40), digest: hash, versions: { web: ids.web, jobs: ids.jobs } } };
  const plan = planHandover(artifact,snapshot,{ policy: off,resumeProcessing: false });
  const journal = { schema: 1, planDigest: plan.digest, phase: 'prepared', pending: 'stop-delivery', error: null, versions: null, fenceReceipt: null, revision: snapshot.revision, intents: {} };
  const records = new Map(), calls = [], state = { failRead: false, loseCreate: false, losePatch: false, total: null };
  const fetcher = async (input,init = {}) => {
    const url = new URL(input), path = url.pathname.split('/recap/')[1], method = init.method || 'GET'; calls.push({ path,method });
    if (path.startsWith('commits/')) {
      const matches = [...records.values()].filter(record => record.head_sha === target && record.name === url.searchParams.get('check_name'));
      return Response.json({ total_count: state.total ?? matches.length,check_runs: matches });
    }
    if (path === 'check-runs' && method === 'POST') {
      const record = { ...JSON.parse(init.body),id: records.size + 1,app: { slug: 'github-actions' } }; records.set(record.id,record);
      if (state.loseCreate) { state.loseCreate = false; throw Error('lost-create-reply'); }
      return Response.json(record);
    }
    if (path.startsWith('check-runs/')) {
      const record = records.get(Number(path.split('/')[1]));
      if (method === 'PATCH') { Object.assign(record,JSON.parse(init.body)); if (state.losePatch) { state.losePatch = false; throw Error('lost-patch-reply'); } return Response.json(record); }
      if (state.failRead) return Response.json({ message: 'private diagnostic must not persist' },{ status: 503 });
      return Response.json(record);
    }
    throw Error('Unexpected endpoint in isolated fixture');
  };
  const github = new ReleaseGitHub({ token: 'fixture-token',runId: 1,fetcher });
  return { artifact,snapshot,plan,journal,records,calls,state,github,remote: new HandoverJournal(github,plan,artifact) };
}
function ports(f) {
  const state = structuredClone(f.snapshot), mutations = [];
  const status = async () => ({ control: structuredClone(state.control),revision: state.revision,work: structuredClone(state.work) });
  const api = { status,assertCheckedHandover: async () => {},verifyEvidence: async () => true,stopDelivery: async () => { mutations.push('stop');state.target = 'paused'; },verifyTarget: async value => value === state.target,
    fenceOldHost: async () => { mutations.push('fence');state.fenced = true;return hash; },verifyFence: async () => state.fenced,
    stage: async () => ({ web: ids.web,jobs: ids.jobs }),commit: async (plan,nonce) => { mutations.push('commit');state.control = { owner: 'cloudflare',epoch: plan.expected.epoch + 1,release: plan.target,paused: true,old_host_fenced: true };state.revision = nonce;return status(); },
    promote: async () => { mutations.push('promote'); },configureDelivery: async () => {},verifyReadback: async () => true,selectCloudflare: async () => { mutations.push('select');state.target = 'cloudflare'; },
    assertCheckedRecovery: async () => {},verifyRollbackProof: async () => true,verifyRecoveryFence: async () => state.fenced,
    pauseForRollback: async (_expected,nonce) => { mutations.push('pause');state.control.paused = true;state.revision = nonce;return status(); },
    restoreRelease: async (_expected,release,_revision,nonce) => { mutations.push('restore');state.control = { ...state.control,release,epoch: state.control.epoch + 1,paused: true };state.revision = nonce;return status(); },restoreVersions: async () => {},verifyRecovery: async () => true };
  return { api,state,mutations };
}
describe('durable initial handover and recovery checkpoints',() => {
  it('reads back every save and restores the exact plan, complete artifact and operation intent',async () => {
    const f = fixture();await f.remote.save(f.journal);expect(f.remote.id).toBe(1);expect(f.calls.map(call => call.method)).toEqual(['GET','POST','GET']);
    const restored = await HandoverJournal.restore(f.github,1,f.artifact);expect(restored.plan).toEqual(f.plan);expect(restored.prior).toEqual(f.journal);
    await restored.remote.save({ ...f.journal,phase: 'delivery-stopped',pending: null });
    expect(JSON.parse(f.records.get(1).output.summary).sequence).toBe(2);
  });
  it.each(['assets','configs','publicConfig','release'])('rejects a changed full artifact %s before storing or resuming',async field => {
    const f = fixture();await f.remote.save(f.journal);const changed = structuredClone(f.artifact);changed[field] = field === 'release' ? 'd'.repeat(40) : {};
    await expect(HandoverJournal.restore(f.github,1,changed)).rejects.toThrow('handover_artifact_changed');
  });
  it('keeps malformed or private journal fields out of remote storage',async () => {
    const f = fixture();
    for (const extra of [{ privateKey: 'private-fixture' },{ error: 'private@email.example' },{ intents: { token: 'private-fixture' } }]) await expect(f.remote.save({ ...f.journal,...extra })).rejects.toThrow('handover_checkpoint_changed');
    expect(f.calls).toEqual([]);
  });
  it.each(['null','[]','"private diagnostic"'])('rejects malformed serialized envelope %s',async summary => {
    const f = fixture();await f.remote.save(f.journal);f.records.get(1).output.summary = summary;
    await expect(HandoverJournal.restore(f.github,1,f.artifact)).rejects.toThrow('handover_checkpoint_changed');
  });
  it.each(['0','-1','1/private','9007199254740992'])('rejects invalid checkpoint ID %s before a request',async id => {
    const f = fixture();await expect(HandoverJournal.restore(f.github,id,f.artifact)).rejects.toThrow('invalid_handover_checkpoint');expect(f.calls).toEqual([]);
  });
  it.each(['id','head','app','name','external','payload','sequence','oversized'])('rejects changed %s checkpoint identity or content',async field => {
    const f = fixture();await f.remote.save(f.journal);const record = f.records.get(1);
    if (field === 'id') { record.id = 2;await expect(f.remote.save(f.journal)).rejects.toThrow('handover_checkpoint_changed'); }
    if (field === 'head') record.head_sha = 'd'.repeat(40);
    if (field === 'app') record.app.slug = 'other-app';
    if (field === 'name') record.name = 'cloudflare-release-checkpoint';
    if (field === 'external') record.external_id = 'other-plan';
    if (field === 'payload') { const data = JSON.parse(record.output.summary);data.privateKey = 'do-not-store';record.output.summary = JSON.stringify(data); }
    if (field === 'sequence') { const data = JSON.parse(record.output.summary);data.sequence = -1;record.output.summary = JSON.stringify(data); }
    if (field === 'oversized') record.output.summary = 'x'.repeat(60001);
    await expect(HandoverJournal.restore(f.github,1,f.artifact)).rejects.toThrow('handover_checkpoint_changed');
  });
  it('does not repeat creation or update after a lost acknowledgement',async () => {
    const f = fixture();f.state.loseCreate = true;await expect(f.remote.save(f.journal)).rejects.toThrow('lost-create-reply');
    await f.remote.save(f.journal);expect(f.remote.id).toBe(1);expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    const next = { ...f.journal,phase: 'delivery-stopped',pending: null };f.state.losePatch = true;await expect(f.remote.save(next)).rejects.toThrow('lost-patch-reply');
    await f.remote.save(next);expect(f.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);expect(JSON.parse(f.records.get(1).output.summary).sequence).toBe(2);
  });
  it('rejects an intervening remote update and duplicate matching records',async () => {
    const f = fixture();await f.remote.save(f.journal);const stale = await HandoverJournal.restore(f.github,1,f.artifact);
    await f.remote.save({ ...f.journal,phase: 'delivery-stopped',pending: null });
    await expect(stale.remote.save({ ...f.journal,error: 'handover_phase_uncertain' })).rejects.toThrow('handover_checkpoint_requires_resume');
    f.records.set(2,{ ...structuredClone(f.records.get(1)),id: 2 });
    await expect(new HandoverJournal(f.github,f.plan,f.artifact).save(f.journal)).rejects.toThrow('handover_checkpoint_ambiguous');
  });
  it('refuses an incomplete lookup and never performs a runtime mutation before durable readback',async () => {
    const f = fixture();f.state.total = 101;await expect(f.remote.save(f.journal)).rejects.toThrow('handover_checkpoint_lookup_incomplete');expect(f.records.size).toBe(0);
    f.state.total = null;f.state.failRead = true;const p = ports(f);
    await expect(runHandover(f.plan,p.api,value => f.remote.save(value))).rejects.toThrow();expect(p.mutations).toEqual([]);
  });
  it('restores a lost ownership reply with its saved nonce and commits exactly once',async () => {
    const f = fixture(),p = ports(f),commit = p.api.commit;
    p.api.commit = async (...args) => { await commit(...args);throw Error('lost-runtime-reply'); };
    await expect(runHandover(f.plan,p.api,value => f.remote.save(value))).rejects.toThrow('handover_phase_uncertain');
    const restored = await HandoverJournal.restore(f.github,f.remote.id,f.artifact);
    expect(restored.prior.intents.transfer).toBe(p.state.revision);
    const done = await runHandover(restored.plan,p.api,value => restored.remote.save(value),restored.prior);
    expect(done.phase).toBe('complete');expect(p.mutations.filter(value => value === 'commit')).toHaveLength(1);expect(p.state.control.paused).toBe(true);
  });
  it.each(['pauseForRollback','restoreRelease'])('restores a saved recovery %s nonce without repeating the operation',async operation => {
    const f = fixture(),p = ports(f);await runHandover(f.plan,p.api,value => f.remote.save(value));
    const recovery = new HandoverJournal(f.github,f.plan,f.artifact,'rollback'),apply = p.api[operation];
    p.api[operation] = async (...args) => { await apply(...args);throw Error('lost-recovery-reply'); };
    await expect(runHandoverRollback(f.plan,p.api,value => recovery.save(value))).rejects.toThrow('handover_rollback_uncertain');
    await expect(HandoverJournal.restore(f.github,recovery.id,f.artifact)).rejects.toThrow('handover_checkpoint_changed');
    const restored = await HandoverJournal.restore(f.github,recovery.id,f.artifact,'rollback');
    await runHandoverRollback(restored.plan,p.api,value => restored.remote.save(value),restored.prior);
    expect(p.mutations.filter(value => value === (operation === 'pauseForRollback' ? 'pause' : 'restore'))).toHaveLength(1);
    expect(p.state.control).toMatchObject({ owner: 'cloudflare',paused: true,old_host_fenced: true,release: f.plan.rollback.release });
  });
  it('uses a neutral transport-only probe that cannot restore as a handover or recovery',async () => {
    const f = fixture(),proof = await probeHandoverJournal(f.github,target);
    expect(proof).toMatchObject({ storageVerified: true,activatesProcessing: false,restorableCheckpoint: false });expect(f.records.get(proof.id).conclusion).toBe('neutral');
    for (const action of ['handover','rollback']) await expect(HandoverJournal.restore(f.github,proof.id,f.artifact,action)).rejects.toThrow();
    expect(f.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
  });
});
