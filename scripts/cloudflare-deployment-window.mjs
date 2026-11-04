import { randomUUID } from 'node:crypto';
import { ReleaseError } from './cloudflare-release-state.mjs';
import { assertDeploymentQuiescence } from './cloudflare-deployment-quiescence.mjs';
const endpoint = 'actions/workflows/cloudflare-duplicate.yml';
const workflowId = 406418558,path = '.github/workflows/cloudflare-duplicate.yml';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const keys = (value,names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value,name));
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const phases = ['prepared','disable-intent','suspended','drained','enable-intent','released'];

export function deploymentWindowState(target,purpose,planDigest = null) {
  const state = { schema: 1,kind: 'operator-deployment-window',target,purpose,planDigest,operation: randomUUID(),phase: 'prepared',workflow: null };
  assertDeploymentWindowState(state);return state;
}
export function assertDeploymentWindowState(state) {
  const code = 'deployment_window_checkpoint_changed';
  check(keys(state,['schema','kind','target','purpose','planDigest','operation','phase','workflow']) && state.schema === 1 && state.kind === 'operator-deployment-window' && /^[a-f0-9]{40}$/.test(state.target || '') && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.operation || '') && phases.includes(state.phase),code);
  check(state.purpose === 'transport-only' ? state.planDigest === null : ['handover','rollback'].includes(state.purpose) && /^[a-f0-9]{64}$/.test(state.planDigest || ''),code);
  if (state.phase === 'prepared') check(state.workflow === null,code);
  else {
    const w = state.workflow;
    check(keys(w,['id','path','priorUpdatedAt','disabledUpdatedAt']) && w.id === workflowId && w.path === path && timestamp(w.priorUpdatedAt),code);
    check(state.phase === 'disable-intent' ? w.disabledUpdatedAt === null : timestamp(w.disabledUpdatedAt),code);
  }
}

/** Fixed workflow only. The caller supplies independently verified operation
 * authorization and acknowledged durable storage, never a CLI JSON approval.
 * Errors deliberately retain suspension. No automatic finally/cleanup enable. */
export class DeploymentWindow {
  constructor({ github,state,authorize,save }) {
    assertDeploymentWindowState(state);check(github && typeof authorize === 'function' && typeof save === 'function','deployment_window_unconfigured');
    Object.assign(this,{ github,state: structuredClone(state),authorize,save });
  }
  async #workflow() {
    const [head,w] = await Promise.all([this.github.request('git/ref/heads/main'),this.github.request(endpoint)]);
    check(head.object?.sha === this.state.target,'release_checked_head_changed');
    check(w?.id === workflowId && w.path === path && ['active','disabled_manually'].includes(w.state) && timestamp(w.updated_at),'deployment_window_workflow_changed');return w;
  }
  async #authorization(action) { check(await this.authorize(action,structuredClone(this.state)) === true,'deployment_window_authorization_changed'); }
  async #record(phase,workflow = this.state.workflow) {
    const next = { ...this.state,phase,workflow };assertDeploymentWindowState(next);
    check(await this.save(structuredClone(next)) === true,'deployment_window_unacknowledged');this.state = next;
  }
  #owned(w) { check(w.state === 'disabled_manually' && w.updated_at === this.state.workflow.disabledUpdatedAt,'deployment_window_workflow_changed'); }
  async suspend() {
    check(!['enable-intent','released'].includes(this.state.phase),'deployment_window_requires_new_operation');
    await this.#authorization('suspend');let w = await this.#workflow();
    if (this.state.phase === 'prepared') {
      check(w.state === 'active','deployment_window_already_disabled');
      await this.#record('disable-intent',{ id: workflowId,path,priorUpdatedAt: w.updated_at,disabledUpdatedAt: null });
    }
    if (this.state.phase === 'disable-intent') {
      await this.#authorization('suspend');w = await this.#workflow();
      if (w.state === 'active') {
        check(w.updated_at === this.state.workflow.priorUpdatedAt,'deployment_window_workflow_changed');
        await this.github.request(endpoint + '/disable',undefined,'PUT');
      }
      w = await this.#workflow();check(w.state === 'disabled_manually','deployment_window_disable_unverified');
      await this.#record('suspended',{ ...this.state.workflow,disabledUpdatedAt: w.updated_at });
    }
    this.#owned(await this.#workflow());
    const receipt = await assertDeploymentQuiescence(this.github,this.state.target);
    check(receipt.updatedAt === this.state.workflow.disabledUpdatedAt,'deployment_window_workflow_changed');
    if (this.state.phase !== 'drained') await this.#record('drained');return structuredClone(this.state);
  }
  async release() {
    check(['drained','enable-intent','released'].includes(this.state.phase),'deployment_window_not_drained');
    await this.#authorization('release');let w = await this.#workflow();
    if (this.state.phase === 'released') { check(w.state === 'active','deployment_window_workflow_changed');return structuredClone(this.state); }
    if (this.state.phase === 'drained') { this.#owned(w);await this.#record('enable-intent'); }
    await this.#authorization('release');w = await this.#workflow();
    if (w.state !== 'active') { this.#owned(w);await this.github.request(endpoint + '/enable',undefined,'PUT'); }
    check((await this.#workflow()).state === 'active','deployment_window_enable_unverified');
    await this.#record('released');return structuredClone(this.state);
  }
}
