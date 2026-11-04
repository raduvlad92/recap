import { ReleaseError } from './cloudflare-release-state.mjs';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const workflow = 'cloudflare-duplicate.yml';
const path = '.github/workflows/' + workflow;
const workflowId = 406418558;
const states = ['queued','in_progress','requested','waiting','pending'];

/** Read-only initial-operator guard. Disabling a workflow does not cancel its
 * existing runs, so inspect every nonterminal status without branch/event
 * filters. Never treat journal CAS or HOSTING_TARGET=paused as serialization. */
export async function readDeploymentQuiescence(github,target) {
  check(/^[a-f0-9]{40}$/.test(target || ''), 'invalid_quiescence_target');
  const [main,before,...inventories] = await Promise.all([
    github.request('git/ref/heads/main'),
    github.request('actions/workflows/' + workflow),
    ...states.map(status => github.request('actions/workflows/' + workflow + '/runs?status=' + status + '&per_page=100')),
  ]);
  check(main.object?.sha === target, 'release_checked_head_changed');
  check(before?.id === workflowId && before.path === path && ['active','disabled_manually'].includes(before.state) && Number.isFinite(Date.parse(before.updated_at)), 'quiescence_workflow_changed');
  const active = new Map();
  for (const [index,inventory] of inventories.entries()) {
    check(Number.isSafeInteger(inventory?.total_count) && inventory.total_count >= 0 && inventory.total_count <= 100 && Array.isArray(inventory.workflow_runs) && inventory.workflow_runs.length === inventory.total_count, 'quiescence_inventory_incomplete');
    for (const run of inventory.workflow_runs) {
      check(Number.isSafeInteger(run.id) && run.id > 0 && run.workflow_id === workflowId && run.path?.split('@')[0] === path && run.repository?.full_name === 'raduvlad92/recap' && (run.status === states[index] || run.status === 'completed'), 'quiescence_run_changed');
      // A status transition during reads is safe only when it is completed.
      if (run.status !== 'completed') active.set(run.id,{ id: run.id,status: run.status });
    }
  }
  const [after,head] = await Promise.all([github.request('actions/workflows/' + workflow),github.request('git/ref/heads/main')]);
  check(head.object?.sha === target, 'release_checked_head_changed');
  check(after.id === before.id && after.path === before.path && after.state === before.state && after.updated_at === before.updated_at, 'quiescence_workflow_changed');
  const blockers = [...(after.state !== 'disabled_manually' ? ['deployment_workflow_active'] : []),...(active.size ? ['deployment_runs_not_drained'] : [])];
  return { verified: blockers.length === 0,target,workflowId,path,state: after.state,updatedAt: after.updated_at,activeRuns: [...active.values()].sort((a,b) => a.id - b.id),blockers,readOnly: true };
}

export async function assertDeploymentQuiescence(github,target) {
  const receipt = await readDeploymentQuiescence(github,target);
  check(receipt.verified, 'handover_deployment_not_quiescent');
  return receipt;
}
