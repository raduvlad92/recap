import { expect,it } from 'vitest';
import { ReleaseGitHub } from '../scripts/cloudflare-release-github.mjs';
import { readDeploymentQuiescence,assertDeploymentQuiescence } from '../scripts/cloudflare-deployment-quiescence.mjs';
const target = 'a'.repeat(40),workflowPath = '.github/workflows/cloudflare-duplicate.yml';
function fixture() {
  const state = { head: target,workflow: { id: 406418558,path: workflowPath,state: 'disabled_manually',updated_at: '2026-11-04T18:00:00Z' },runs: {},incomplete: false,onWorkflowRead: null },calls = [];
  let reads = 0;
  const github = new ReleaseGitHub({ token: 'fixture-token',runId: 1,fetcher: async(input,init) => {
    const url = new URL(input),path = url.pathname.split('/recap/')[1];
    calls.push({ path,method: init.method });expect(init.headers['cache-control']).toBe('no-cache');expect(init.method).toBe('GET');
    if (path === 'git/ref/heads/main') return Response.json({ object: { sha: state.head } });
    if (path === 'actions/workflows/cloudflare-duplicate.yml') { state.onWorkflowRead?.(++reads);return Response.json(state.workflow); }
    expect(path).toBe('actions/workflows/cloudflare-duplicate.yml/runs');
    expect([...url.searchParams.keys()].sort()).toEqual(['per_page','status']);
    const rows = state.runs[url.searchParams.get('status')] || [];
    return Response.json({ total_count: state.incomplete ? 101 : rows.length,workflow_runs: rows });
  } });
  const run = status => ({ id: 42,workflow_id: 406418558,path: workflowPath,repository: { full_name: 'raduvlad92/recap' },status,head_branch: 'old-branch',head_sha: 'b'.repeat(40),event: 'workflow_dispatch' });
  return { state,calls,github,run };
}
it('requires the fixed disabled workflow and complete empty run inventories without writes',async() => {
  const f = fixture();expect(await assertDeploymentQuiescence(f.github,target)).toMatchObject({ verified: true,activeRuns: [],blockers: [],readOnly: true });expect(f.calls).toHaveLength(9);
});
it.each(['queued','in_progress','requested','waiting','pending'])('blocks %s runs on any branch, SHA or event even when the workflow is disabled',async status => {
  const f = fixture();f.state.runs[status] = [f.run(status)];
  expect(await readDeploymentQuiescence(f.github,target)).toMatchObject({ verified: false,blockers: ['deployment_runs_not_drained'],activeRuns: [{ id: 42,status }] });
  await expect(assertDeploymentQuiescence(f.github,target)).rejects.toThrow('handover_deployment_not_quiescent');
});
it('blocks an active workflow even when HOSTING_TARGET would be paused and no run is visible',async() => {
  const f = fixture();f.state.workflow.state = 'active';expect((await readDeploymentQuiescence(f.github,target)).blockers).toEqual(['deployment_workflow_active']);
});
it.each(['head','id','path','state','timestamp','pagination','run'])('rejects changed or incomplete %s metadata',async reason => {
  const f = fixture();
  if (reason === 'head') f.state.head = 'c'.repeat(40);
  if (reason === 'id') f.state.workflow.id++;
  if (reason === 'path') f.state.workflow.path = '.github/workflows/other.yml';
  if (reason === 'state') f.state.workflow.state = 'disabled_inactivity';
  if (reason === 'timestamp') f.state.workflow.updated_at = 'unknown';
  if (reason === 'pagination') f.state.incomplete = true;
  if (reason === 'run') f.state.runs.queued = [{ ...f.run('queued'),workflow_id: 1 }];
  await expect(readDeploymentQuiescence(f.github,target)).rejects.toThrow();
});
it('rejects a changed workflow or main head across the inventory read',async() => {
  const f = fixture();f.state.onWorkflowRead = n => { if (n === 2) f.state.workflow.state = 'active'; };
  await expect(readDeploymentQuiescence(f.github,target)).rejects.toThrow('quiescence_workflow_changed');
  const other = fixture();other.state.onWorkflowRead = n => { if (n === 2) other.state.head = 'c'.repeat(40); };
  await expect(readDeploymentQuiescence(other.github,target)).rejects.toThrow('release_checked_head_changed');
});
it('accepts an already completed run observed during an inventory status transition',async() => {
  const f = fixture();f.state.runs.in_progress = [f.run('completed')];expect((await readDeploymentQuiescence(f.github,target)).verified).toBe(true);
});
