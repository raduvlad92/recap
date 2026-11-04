import { expect,it } from 'vitest';
import { DeploymentWindow,deploymentWindowState,assertDeploymentWindowState } from '../scripts/cloudflare-deployment-window.mjs';
import { ReleaseError } from '../scripts/cloudflare-release-state.mjs';
const target = 'a'.repeat(40),endpoint = 'actions/workflows/cloudflare-duplicate.yml';
function fixture(prior) {
  const state = { workflow: 'active',stamp: '2026-11-04T10:00:00Z',head: target,busy: false,authorized: true,ack: true,lose: null,onSave: null },saved = [],writes = [];
  const github = { request: async(path,_body,method) => {
    if (path === 'git/ref/heads/main') return { object: { sha: state.head } };
    if (path === endpoint) return { id: 406418558,path: '.github/workflows/cloudflare-duplicate.yml',state: state.workflow,updated_at: state.stamp };
    if (path.startsWith(endpoint + '/runs?')) {
      const status = new URLSearchParams(path.split('?')[1]).get('status');
      const rows = state.busy && status === 'in_progress' ? [{ id: 1,workflow_id: 406418558,path: '.github/workflows/cloudflare-duplicate.yml',repository: { full_name: 'raduvlad92/recap' },status }] : [];
      return { total_count: rows.length,workflow_runs: rows };
    }
    expect(method).toBe('PUT');expect([endpoint + '/disable',endpoint + '/enable']).toContain(path);
    const action = path.endsWith('/disable') ? 'disable' : 'enable';writes.push(action);
    state.workflow = action === 'disable' ? 'disabled_manually' : 'active';state.stamp = action === 'disable' ? '2026-11-04T11:00:00Z' : '2026-11-04T12:00:00Z';
    if (state.lose === action) { state.lose = null;throw new ReleaseError('lost_reply'); }return null;
  } };
  const options = { github,state: prior || deploymentWindowState(target,'transport-only'),authorize: async() => state.authorized,save: async value => {
    assertDeploymentWindowState(value);if (!state.ack) return false;saved.push(structuredClone(value));await state.onSave?.(value);return true;
  } };
  return { state,saved,writes,options,window: new DeploymentWindow(options) };
}
it('acknowledges disable/drain/enable state before each fixed workflow write',async() => {
  const f = fixture();await f.window.suspend();expect(f.saved.map(s => s.phase)).toEqual(['disable-intent','suspended','drained']);expect(f.state.workflow).toBe('disabled_manually');
  await f.window.release();expect(f.saved.map(s => s.phase)).toEqual(['disable-intent','suspended','drained','enable-intent','released']);expect(f.writes).toEqual(['disable','enable']);
  await f.window.release();expect(f.writes).toEqual(['disable','enable']);
});
it.each(['disable','enable'])('reconciles a lost %s reply from the acknowledged window without repeating it',async action => {
  const f = fixture();if (action === 'enable') await f.window.suspend();f.state.lose = action;
  await expect(action === 'disable' ? f.window.suspend() : f.window.release()).rejects.toThrow('lost_reply');
  const restored = new DeploymentWindow({ ...f.options,state: f.saved.at(-1) });
  if (action === 'disable') await restored.suspend();else await restored.release();
  expect(f.writes.filter(value => value === action)).toHaveLength(1);
});
it('leaves suspension in place while existing runs drain and never cancels or enables them',async() => {
  const f = fixture();f.state.busy = true;await expect(f.window.suspend()).rejects.toThrow('handover_deployment_not_quiescent');expect(f.state.workflow).toBe('disabled_manually');expect(f.writes).toEqual(['disable']);
  await expect(f.window.release()).rejects.toThrow('deployment_window_not_drained');f.state.busy = false;await f.window.suspend();await f.window.release();expect(f.writes).toEqual(['disable','enable']);
});
it.each(['authorization','storage','already-disabled','head'])('rejects changed %s before any workflow mutation',async reason => {
  const f = fixture();if (reason === 'authorization') f.state.authorized = false;if (reason === 'storage') f.state.ack = false;if (reason === 'already-disabled') f.state.workflow = 'disabled_manually';if (reason === 'head') f.state.head = 'b'.repeat(40);
  await expect(f.window.suspend()).rejects.toThrow();expect(f.writes).toEqual([]);
});
it('rechecks independent authorization and workflow identity after acknowledging disable intent',async() => {
  const f = fixture();f.state.onSave = value => { if (value.phase === 'disable-intent') f.state.authorized = false; };
  await expect(f.window.suspend()).rejects.toThrow('deployment_window_authorization_changed');expect(f.writes).toEqual([]);
  const g = fixture();g.state.onSave = value => { if (value.phase === 'disable-intent') g.state.stamp = '2026-11-04T10:30:00Z'; };
  await expect(g.window.suspend()).rejects.toThrow('deployment_window_workflow_changed');expect(g.writes).toEqual([]);
});
it('retains suspension when release authorization or acknowledged storage fails',async() => {
  const f = fixture();await f.window.suspend();f.state.authorized = false;await expect(f.window.release()).rejects.toThrow('deployment_window_authorization_changed');
  f.state.authorized = true;f.state.ack = false;await expect(f.window.release()).rejects.toThrow('deployment_window_unacknowledged');expect(f.writes).toEqual(['disable']);expect(f.state.workflow).toBe('disabled_manually');
});
it('does not adopt a changed disabled workflow witness or re-suspend a released operation',async() => {
  const f = fixture();await f.window.suspend();f.state.stamp = '2026-11-04T11:30:00Z';await expect(f.window.release()).rejects.toThrow('deployment_window_workflow_changed');expect(f.writes).toEqual(['disable']);
  const g = fixture();await g.window.suspend();await g.window.release();await expect(g.window.suspend()).rejects.toThrow('deployment_window_requires_new_operation');
});
it.each(['private','purpose','plan','phase','workflow'])('rejects invalid %s window checkpoint fields',reason => {
  const value = deploymentWindowState(target,'transport-only');if (reason === 'private') value.token = 'private';if (reason === 'purpose') value.purpose = 'other';if (reason === 'plan') value.planDigest = 'b'.repeat(64);if (reason === 'phase') value.phase = 'unknown';if (reason === 'workflow') value.workflow = {};
  expect(() => assertDeploymentWindowState(value)).toThrow('deployment_window_checkpoint_changed');
});
