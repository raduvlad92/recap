import { describe, expect, it } from 'vitest';
import { ReleaseGitHub, ReleaseJournal } from '../scripts/cloudflare-release-github.mjs';
const target = 'a'.repeat(40), plan = { target, digest: 'd'.repeat(64), artifactHashes: { web: 'w', jobs: 'j', sourceWorker: 's', sourceContainer: 'c' } };
function fixture() {
  const records = new Map(), calls = []; let next = 1;
  const run = { head_sha: target, head_branch: 'main', event: 'push', repository: { full_name: 'raduvlad92/recap' }, path: '.github/workflows/cloudflare-duplicate.yml' };
  const jobs = { jobs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] };
  const state = { head: target, failRead: false, corruptRead: false, waits: [], onWait: null };
  const fetcher = async (input, init = {}) => {
    const path = new URL(input).pathname.split('/recap/')[1]; calls.push([path, init.method || 'GET']);
    if (path === 'git/ref/heads/main') return Response.json({ object: { sha: state.head } });
    if (path === 'actions/runs/1') return Response.json(run);
    if (path === 'actions/runs/1/jobs') return Response.json(jobs);
    if (path === 'check-runs' && init.method === 'POST') { const data = { ...JSON.parse(init.body), id: next++, app: { slug: 'github-actions' } }; records.set(data.id, data); return Response.json(data); }
    if (path.startsWith('check-runs/')) {
      const id = Number(path.split('/')[1]); if (init.method === 'PATCH') { Object.assign(records.get(id), JSON.parse(init.body)); return Response.json(records.get(id)); }
      if (state.failRead) return Response.json({ message: 'private diagnostic' }, { status: 503 });
      const value = structuredClone(records.get(id)); if (state.corruptRead) value.output.summary = 'changed'; return Response.json(value);
    }
    throw new Error('Unexpected fake GitHub endpoint');
  };
  return { github: new ReleaseGitHub({ token: 'fixture-token', runId: 1, fetcher, wait: async ms => { state.waits.push(ms); state.onWait?.(); } }), records, calls, state, run, jobs };
}
describe('durable GitHub release checkpoints', () => {
  it('requires the checked current main SHA and completed canonical verification job', async () => {
    const f = fixture(); await f.github.assertCheckedRelease(target);
    f.state.head = 'b'.repeat(40); await expect(f.github.assertCheckedRelease(target)).rejects.toThrow('release_checked_head_changed');
    f.state.head = target; f.jobs.jobs[0].conclusion = 'failure'; await expect(f.github.assertCheckedRelease(target)).rejects.toThrow('release_verification_job_incomplete');
    f.jobs.jobs[0].conclusion = 'success'; f.run.event = 'pull_request'; await expect(f.github.assertCheckedRelease(target)).rejects.toThrow('release_checked_head_changed');
  });
  it('bounds incomplete-job visibility retries while rechecking main on every read', async () => {
    const f = fixture(); f.jobs.jobs[0].status = 'in_progress';
    f.state.onWait = () => { if (f.state.waits.length === 2) f.jobs.jobs[0].status = 'completed'; };
    await f.github.assertCheckedRelease(target); expect(f.state.waits).toEqual([2000,2000]);
    f.jobs.jobs = []; f.state.waits = []; f.state.onWait = null;
    await expect(f.github.assertCheckedRelease(target)).rejects.toThrow('release_verification_job_incomplete'); expect(f.state.waits).toHaveLength(5);
    f.jobs.jobs = [{ name: 'verify',status: 'queued' }]; f.state.waits = []; f.state.onWait = () => { f.state.head = 'b'.repeat(40); };
    await expect(f.github.assertCheckedRelease(target)).rejects.toThrow('release_checked_head_changed'); expect(f.state.waits).toHaveLength(1);
  });
  it('requires a successful artifact-only manual run with its deploy explicitly skipped', async () => {
    const f = fixture(); Object.assign(f.run,{ event: 'workflow_dispatch',status: 'completed',conclusion: 'success' });
    f.jobs.jobs[0].steps = [{ name: 'Validate artifact-only handover preparation',status: 'completed',conclusion: 'success' }];
    f.jobs.jobs.push({ name: 'deploy',status: 'completed',conclusion: 'skipped' });
    await f.github.assertPreparedHandover(target);
    for (const mutation of [() => { f.run.event = 'push'; },() => { f.jobs.jobs[1].conclusion = 'success'; },() => { f.jobs.jobs[0].steps[0].conclusion = 'skipped'; },() => { f.run.conclusion = 'failure'; }]) {
      const run = structuredClone(f.run),jobs = structuredClone(f.jobs); mutation();
      await expect(f.github.assertPreparedHandover(target)).rejects.toThrow('handover_preparation_run_required'); Object.assign(f.run,run); Object.assign(f.jobs,jobs);
    }
    f.state.head = 'b'.repeat(40); await f.github.assertPreparedHandover(target,{ currentMain: false });
    await expect(f.github.assertPreparedHandover(target)).rejects.toThrow('release_checked_head_changed');
  });
  it('creates then reads back the whole checkpoint before acknowledging a save', async () => {
    const f = fixture(), remote = new ReleaseJournal(f.github, plan), journal = { phase: 'prepared', pending: 'pause' };
    await remote.save(journal); expect(remote.id).toBe(1); expect(f.calls).toEqual([['check-runs', 'POST'], ['check-runs/1', 'GET']]);
    await remote.save({ ...journal, phase: 'paused' }); expect(f.calls.slice(-2)).toEqual([['check-runs/1', 'PATCH'], ['check-runs/1', 'GET']]);
    const restored = await ReleaseJournal.restore(f.github, 1, { release: target, hashes: plan.artifactHashes }); expect(restored.plan).toEqual(plan); expect(restored.prior.phase).toBe('paused');
  });
  it('does not acknowledge remote read failure or changed checkpoint content', async () => {
    const f = fixture(), remote = new ReleaseJournal(f.github, plan); f.state.failRead = true;
    await expect(remote.save({ phase: 'prepared' })).rejects.toThrow('release_github_request_failed'); expect(remote.id).toBe(null);
    f.state.failRead = false; f.state.corruptRead = true; await expect(remote.save({ phase: 'prepared' })).rejects.toThrow('release_checkpoint_unacknowledged');
  });
  it('rejects restored data for another commit, artifact or GitHub app', async () => {
    const f = fixture(), remote = new ReleaseJournal(f.github, plan); await remote.save({ phase: 'prepared' });
    await expect(ReleaseJournal.restore(f.github, 1, { release: 'b'.repeat(40), hashes: plan.artifactHashes })).rejects.toThrow('release_checkpoint_changed');
    await expect(ReleaseJournal.restore(f.github, 1, { release: target, hashes: {} })).rejects.toThrow('release_checkpoint_changed');
    f.records.get(1).app.slug = 'unrelated-app'; await expect(ReleaseJournal.restore(f.github, 1, { release: target, hashes: plan.artifactHashes })).rejects.toThrow('release_checkpoint_changed');
  });
  it('keeps the transport probe separate from an executable release checkpoint', async () => {
    const f = fixture(); await f.github.probeCheckpoint(target); expect(f.records.get(1).name).toBe('cloudflare-release-journal-probe'); expect(f.records.get(1).conclusion).toBe('neutral');
    await expect(ReleaseJournal.restore(f.github, 1, { release: target })).rejects.toThrow('release_checkpoint_changed');
  });
});
