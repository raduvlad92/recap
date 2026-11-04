import { describe, expect, it } from 'vitest';
import { executionFlags, planRelease, runRelease } from '../scripts/cloudflare-release-state.mjs';
const oldRelease = 'a'.repeat(40), target = 'b'.repeat(40);
const ids = { jobs: '11111111-1111-4111-8111-111111111111', web: '22222222-2222-4222-8222-222222222222' };
const flags = Object.fromEntries(executionFlags.map(flag => [flag, 'false']));
function fixture({ paused = false } = {}) {
  const snapshot = { control: { owner: 'cloudflare', epoch: 2, release: oldRelease, paused, old_host_fenced: true }, revision: ids.jobs, work: { queued: 0, running: 0, expired_running: 0, uncertain: 7 }, domain: 'recap.filternode.dev', sourceVerified: true,
    workers: Object.fromEntries(['web', 'jobs'].map(kind => [kind, { version: ids[kind], mode: 'active', release: oldRelease, sourceVerified: true, bindingsHash: '1'.repeat(64), flags: { ...flags } }])) };
  const artifact = { release: target, mode: 'active', hashes: { web: 'c'.repeat(64), jobs: 'd'.repeat(64), sourceWorker: 'e'.repeat(64), sourceContainer: 'f'.repeat(64) } };
  snapshot.sourcePin = { version: ids.jobs, image: '0'.repeat(64), workerHash: artifact.hashes.sourceWorker, containerHash: artifact.hashes.sourceContainer, enabled: false };
  return { artifact, snapshot, plan: planRelease(artifact, snapshot) };
}
function ports(snapshot) {
  let status = { control: structuredClone(snapshot.control), work: structuredClone(snapshot.work), revision: snapshot.revision }, stored;
  const calls = [];
  const api = {
    async assertCheckedRelease() { calls.push('checked'); },
    async preflight() { calls.push('preflight'); },
    async status() { return structuredClone(status); },
    async quiesce(expected, nonce) { if (status.revision === nonce && status.control.paused) return api.status(); if (status.revision !== expected.revision || status.work.queued) throw new Error('pause raced'); calls.push('pause'); status.control.paused = true; status.revision = nonce; return api.status(); },
    async upload() { calls.push('upload'); return ids; },
    async transfer(_expected, _target, revision, nonce) { if (status.revision !== revision) throw new Error('revision raced'); calls.push('transfer'); status.control.release = target; status.control.epoch++; status.revision = nonce; return api.status(); },
    async promote() { calls.push('promote'); },
    async verify() { calls.push('verify'); return true; },
    async resume(_expected, revision, nonce) { if (status.revision !== revision) throw new Error('revision raced'); calls.push('resume'); status.control.paused = false; status.revision = nonce; return api.status(); },
  };
  return { api, calls, save: async value => { stored = structuredClone(value); }, journal: () => stored, status: () => status };
}
describe('Cloudflare release coordination without business execution', () => {
  it('never uses a green PR as initial ownership/fencing permission', async () => {
    const { artifact, snapshot } = fixture(); snapshot.control.owner = 'netlify'; snapshot.control.old_host_fenced = false;
    const plan = planRelease(artifact, snapshot), p = ports(snapshot);
    expect(plan.blockers).toContain('cloudflare_ownership_required');
    expect(plan.blockers).toContain('durable_old_host_fence_required');
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_gates_blocked'); expect(p.calls).toEqual([]);
  });
  it('blocks guest artifacts, mixed worker releases, queued work and policy drift', () => {
    const { artifact, snapshot } = fixture(); artifact.mode = 'shadow'; snapshot.work.queued = 1; snapshot.workers.jobs.release = target; snapshot.workers.jobs.flags.SOCIAL_COLLECTION_ENABLED = 'true';
    expect(planRelease(artifact, snapshot).blockers).toEqual(expect.arrayContaining(['active_artifact_required', 'queued_work_must_drain', 'jobs_active_release_mismatch', 'execution_policy_mismatch']));
  });
  it('requires source proof and preserves the reminder opt-out', () => {
    const { artifact, snapshot } = fixture(); snapshot.sourceVerified = false; snapshot.workers.web.flags.REMINDER_EMAIL_ENABLED = snapshot.workers.jobs.flags.REMINDER_EMAIL_ENABLED = 'true';
    expect(planRelease(artifact, snapshot).blockers).toEqual(expect.arrayContaining(['source_artifact_proof_required', 'reminders_must_remain_off']));
  });
  it('orders pause/drain/upload/transfer/promotion/readback/resume and retains held work', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot);
    const result = await runRelease(plan, p.api, p.save);
    expect(p.calls.filter(call => call !== 'checked')).toEqual(['preflight', 'pause', 'upload', 'transfer', 'promote', 'verify', 'resume']);
    expect(result.phase).toBe('complete'); expect(p.status().control).toMatchObject({ owner: 'cloudflare', epoch: 3, release: target, paused: false });
    expect(p.status().work.uncertain).toBe(7);
    const before = [...p.calls]; await runRelease(plan, p.api, p.save, result); expect(p.calls).toEqual([...before, 'verify']);
  });
  it('keeps an operator-paused host paused after a successful release', async () => {
    const { plan, snapshot } = fixture({ paused: true }), p = ports(snapshot);
    await runRelease(plan, p.api, p.save); expect(p.calls).not.toContain('resume'); expect(p.status().control.paused).toBe(true);
  });
  it.each(['running', 'expired_running'])('does not expire or clear %s work to force a release', async field => {
    const { plan, snapshot } = fixture(), p = ports(snapshot); p.status().work[field] = 1;
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_drain_pending');
    expect(p.status().control.paused).toBe(true); expect(p.calls).not.toContain('upload'); expect(p.status().work[field]).toBe(1);
  });
  it('handles a queued admission racing the preflight by refusing the atomic pause', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot); p.status().work.queued = 1;
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain');
    expect(p.status().control.paused).toBe(false); expect(p.calls).not.toContain('upload');
  });
  it.each(['upload', 'promote', 'verify'])('keeps admission paused after an uncertain %s phase', async phase => {
    const { plan, snapshot } = fixture(), p = ports(snapshot); p.api[phase] = async () => { throw new Error('private provider diagnostic'); };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain');
    expect(p.status().control.paused).toBe(true); expect(p.calls).not.toContain('resume'); expect(JSON.stringify(p.journal())).not.toContain('private provider diagnostic');
  });
  it('reconciles a transfer response lost after commit without advancing the epoch twice', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot), original = p.api.transfer;
    p.api.transfer = async (...args) => { await original(...args); throw new Error('transport disconnected'); };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain');
    await runRelease(plan, p.api, p.save, p.journal());
    expect(p.calls.filter(value => value === 'transfer')).toHaveLength(1); expect(p.status().control.epoch).toBe(3);
  });
  it('reconciles a lost resume acknowledgement without repeating promotion or resume', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot), original = p.api.resume;
    p.api.resume = async (...args) => { await original(...args); throw new Error('lost acknowledgement'); };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain');
    await runRelease(plan, p.api, p.save, p.journal()); expect(p.calls.filter(value => value === 'resume')).toHaveLength(1); expect(p.calls.filter(value => value === 'promote')).toHaveLength(1);
  });
  it('rejects plan/checkpoint tampering and refuses stale checked releases before pausing', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot);
    await expect(runRelease({ ...plan, target: oldRelease }, p.api, p.save)).rejects.toThrow('release_plan_changed');
    await expect(runRelease(plan, p.api, p.save, { schema: 1, planDigest: 'wrong', phase: 'prepared' })).rejects.toThrow('release_checkpoint_changed');
    p.api.assertCheckedRelease = async () => { throw new Error('head advanced'); };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain'); expect(p.calls).not.toContain('pause');
  });
  it('never resumes after failed readback', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot); p.api.verify = async () => false;
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_readback_failed'); expect(p.status().control.paused).toBe(true); expect(p.calls).not.toContain('resume');
  });
  it('rechecks worker/source proof immediately before pause and on completed replay', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot);
    p.api.preflight = async () => { throw new Error('source version changed'); };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain'); expect(p.calls).not.toContain('pause');
    p.api.preflight = async () => {};
    const complete = await runRelease(plan, p.api, p.save, p.journal());
    p.api.verify = async () => false;
    await expect(runRelease(plan, p.api, p.save, complete)).rejects.toThrow('release_readback_failed');
  });
  it('reconciles a lost pause reply with its exact nonce', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot), original = p.api.quiesce;
    p.api.quiesce = async (...args) => { const result = await original(...args); if (p.calls.filter(call => call === 'pause').length === 1 && !p.api.failedOnce) { p.api.failedOnce = true; throw new Error('reply lost'); } return result; };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('release_phase_uncertain');
    await runRelease(plan, p.api, p.save, p.journal()); expect(p.calls.filter(call => call === 'pause')).toHaveLength(1);
  });
  it('keeps a new operator pause in force during deployment', async () => {
    const { plan, snapshot } = fixture(), p = ports(snapshot);
    p.api.verify = async () => { p.status().revision = '99999999-9999-4999-8999-999999999999'; return true; };
    await expect(runRelease(plan, p.api, p.save)).rejects.toThrow('hosting_release_revision_changed');
    expect(p.status().control.paused).toBe(true); expect(p.calls).not.toContain('resume');
  });
});
