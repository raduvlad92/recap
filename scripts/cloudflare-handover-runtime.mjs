import { assertHandoverPlan } from './cloudflare-handover-state.mjs';
import { checkedArtifact } from './cloudflare-release-platform.mjs';
import { readSourceRuntime, runtimeDigest } from './cloudflare-source-runtime.mjs';
import { executionFlags, ReleaseError } from './cloudflare-release-state.mjs';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fields = ['owner','epoch','release','paused','old_host_fenced'];
const workFields = ['queued','running','expired_running','uncertain'];
const matches = (status,control,revision) => status?.revision === revision && fields.every(key => status.control?.[key] === control[key]);
const validWork = status => status.work && workFields.every(key => Number.isSafeInteger(status.work[key]) && status.work[key] >= 0);
/** Native runtime operations only, not an apply command. The executor supplies
 * fresh head/evidence/fence/delivery authorization and acknowledged durable
 * sub-operation intents. Original artifact files are rehashed before actions. */
export class HandoverRuntime {
  constructor({ platform,artifact,plan,authorize,saveIntent }) {
    assertHandoverPlan(plan,artifact);
    check(plan.sourcePin.enabled === false && typeof authorize === 'function' && typeof saveIntent === 'function', 'handover_runtime_unconfigured');
    Object.assign(this,{ platform,artifact: structuredClone(artifact),plan: structuredClone(plan),authorize,saveIntent });
  }
  async #enter(action) {
    assertHandoverPlan(this.plan,this.artifact);
    check(runtimeDigest(checkedArtifact(this.platform.root)) === this.plan.artifactDigest, 'handover_artifact_changed');
    check(await this.authorize(this.plan,action) === true, 'handover_runtime_gates_changed');
  }
  async #expect(expected,allowUnpaused = false) {
    const c = expected?.control;
    check(uuid(expected?.revision) && c, 'handover_runtime_control_changed');
    const initial = c.owner === 'netlify', old = this.plan.expected;
    if (initial) check(expected.revision === old.revision && fields.every(key => c[key] === old[key]), 'handover_runtime_control_changed');
    else check(c.owner === 'cloudflare' && c.old_host_fenced === true && ((c.release === this.plan.target && c.epoch === old.epoch + 1) || (c.release === this.plan.rollback.release && c.epoch === old.epoch + 1 + (c.release === this.plan.target ? 0 : 1))), 'handover_runtime_control_changed');
    check(c.paused === true || !initial && allowUnpaused && c.paused === false, 'handover_runtime_pause_required');
    const status = await this.platform.status();
    check(matches(status,c,expected.revision), 'handover_runtime_control_changed');
    check(validWork(status) && workFields.every(key => status.work[key] === 0), 'handover_runtime_work_not_drained');
    return status;
  }
  async #source(enabled = null) {
    const result = await readSourceRuntime(this.platform,this.artifact);
    check(enabled === null || result.enabled === enabled, 'handover_source_state_changed');return result;
  }
  async #workers(versions,exact = false) {
    for (const kind of ['jobs','web']) {
      const worker = await this.platform.current(kind), old = worker.version === this.plan.priorVersions[kind] && worker.mode === 'shadow' && executionFlags.every(flag => worker.flags?.[flag] === 'false');
      const active = uuid(versions?.[kind]) && worker.version === versions[kind] && worker.mode === 'active' && worker.release === this.plan.target && executionFlags.every(flag => worker.flags?.[flag] === this.plan.policy[flag]) && worker.sourceVerified === true;
      check(worker.bindingsHash === this.plan.bindings[kind] && (exact ? active : old || active), 'handover_runtime_worker_changed');
    }
  }
  async #change(expected,operation,change,{ enabled = null,allowUnpaused = false } = {}) {
    await this.#enter(operation);await this.#expect(expected,allowUnpaused);await this.#source(enabled);
    const intent = { kind: 'hosting-runtime',planDigest: this.plan.digest,operation };
    check(await this.saveIntent({ ...intent,digest: runtimeDigest(intent) }) === true, 'handover_runtime_intent_unacknowledged');
    await this.#enter(operation);await this.#expect(expected,allowUnpaused);await this.#source(enabled);
    return change();
  }
  #target(paused = true) { return { owner: 'cloudflare',epoch: this.plan.expected.epoch + 1,release: this.plan.target,paused,old_host_fenced: true }; }
  async #applied(operation,control,nonce,empty = true) {
    await this.#enter(operation + '-reconcile');const status = await this.platform.status();
    if (!matches(status,control,nonce)) return null;
    check(validWork(status) && (!empty || workFields.every(key => status.work[key] === 0)), 'handover_runtime_work_not_drained');
    await this.#source();return status;
  }
  async stage(expected) {
    check(expected?.control?.owner === 'netlify', 'handover_runtime_control_changed');
    const versions = {};
    for (const kind of ['jobs','web']) versions[kind] = await this.#change(expected,'stage-' + kind,async () => {
      await this.#workers(null);return this.platform.uploadVersion(kind,this.artifact,this.plan.policy,'active',this.plan.bindings[kind],this.plan.digest + ':handover');
    },{ enabled: false });
    check(['web','jobs'].every(kind => uuid(versions[kind])), 'handover_versions_unverified');return versions;
  }
  async commit(expected,nonce,versions) {
    check(uuid(nonce) && nonce !== expected?.revision && expected?.control?.owner === 'netlify' && ['web','jobs'].every(kind => uuid(versions?.[kind])), 'handover_runtime_operation_invalid');
    const verifyStaged = async () => { for (const kind of ['jobs','web']) await this.platform.assertVersion(kind,versions[kind],this.artifact,this.plan.policy,'active',this.plan.bindings[kind]); };
    const applied = await this.#applied('commit',this.#target(),nonce);if (applied) { await verifyStaged();return applied; }
    const result = await this.#change(expected,'commit:' + nonce,async () => {
      await this.#workers(null);await verifyStaged();
      return this.platform.rpc('commit_hosting_handover_checked',{ p_expected_epoch: expected.control.epoch,p_expected_release: expected.control.release,p_expected_revision: expected.revision,p_release: this.plan.target,p_old_host_fenced: true,p_next_revision: nonce });
    },{ enabled: false });
    check(matches(result,this.#target(),nonce) && validWork(result) && workFields.every(key => result.work[key] === 0), 'handover_runtime_commit_unverified');return result;
  }
  async setSourceEnabled(expected,enabled,versions) {
    check(typeof enabled === 'boolean' && expected?.control?.owner === 'cloudflare' && (!enabled || ['web','jobs'].every(kind => uuid(versions?.[kind]))), 'handover_runtime_operation_invalid');
    await this.#enter('source-' + enabled);await this.#expect(expected);let source = await this.#source();
    if (enabled) { await this.#workers(versions);for (const kind of ['jobs','web']) await this.platform.assertVersion(kind,versions[kind],this.artifact,this.plan.policy,'active',this.plan.bindings[kind]); }
    if (source.enabled !== enabled) await this.#change(expected,'source-' + enabled,async () => {
      source = await this.#source();if (enabled) await this.#workers(versions);
      if (source.enabled !== enabled) await this.platform.cf('/workers/scripts/therecap-source/deployments',{ strategy: 'percentage',versions: [{ version_id: enabled ? source.enabledVersion : source.disabledVersion,percentage: 100 }] });
    });
    await this.#expect(expected);return this.#source(enabled);
  }
  async promote(expected,versions) {
    check(expected?.control?.release === this.plan.target && expected?.control?.owner === 'cloudflare' && ['web','jobs'].every(kind => uuid(versions?.[kind])), 'handover_versions_unverified');
    await this.#enter('promote');await this.#expect(expected);await this.#workers(versions);
    for (const kind of ['jobs','web']) await this.platform.assertVersion(kind,versions[kind],this.artifact,this.plan.policy,'active',this.plan.bindings[kind]);
    await this.setSourceEnabled(expected,true,versions);
    for (const kind of ['jobs','web']) await this.#change(expected,'promote-' + kind,async () => {
      await this.#workers(versions);await this.platform.assertVersion(kind,versions[kind],this.artifact,this.plan.policy,'active',this.plan.bindings[kind]);
      await this.platform.promoteVersion(kind,versions[kind],[this.plan.priorVersions[kind]]);
    },{ enabled: true });
    await this.#workers(versions,true);await this.#expect(expected);
  }
  async resume(expected,nonce,versions) {
    check(this.plan.resumeProcessing === true && uuid(nonce) && nonce !== expected?.revision && matches(expected,this.#target(),expected?.revision), 'handover_runtime_operation_invalid');
    const applied = await this.#applied('resume',this.#target(false),nonce,false);
    if (applied) { await this.#workers(versions,true);await this.#source(true);return applied; }
    const result = await this.#change(expected,'resume:' + nonce,async () => {
      await this.#workers(versions,true);
      return this.platform.rpc('advance_hosting_release_checked',{ p_expected_epoch: expected.control.epoch,p_expected_release: expected.control.release,p_expected_revision: expected.revision,p_release: this.plan.target,p_resume: true,p_next_revision: nonce });
    },{ enabled: true });
    check(matches(result,this.#target(false),nonce) && validWork(result), 'handover_runtime_resume_unverified');return result;
  }
  async pauseForRollback(expected,nonce) {
    check(uuid(nonce) && nonce !== expected?.revision && expected?.control?.owner === 'cloudflare' && expected.control.release === this.plan.target, 'handover_runtime_operation_invalid');
    const applied = await this.#applied('pause',this.#target(),nonce);if (applied) return applied;
    const result = await this.#change(expected,'pause:' + nonce,() => this.platform.rpc('quiesce_hosting_release_checked',{ p_expected_epoch: expected.control.epoch,p_expected_release: expected.control.release,p_expected_revision: expected.revision,p_next_revision: nonce }),{ allowUnpaused: true });
    check(matches(result,this.#target(),nonce) && validWork(result) && workFields.every(key => result.work[key] === 0), 'handover_runtime_pause_unverified');return result;
  }
  async restoreRelease(expected,release,revision,nonce) {
    check(release === this.plan.rollback.release && uuid(nonce) && nonce !== revision && uuid(revision) && typeof expected?.control?.paused === 'boolean' && matches(expected,this.#target(expected.control.paused),expected.revision), 'handover_runtime_operation_invalid');
    const control = { ...this.#target(),release,epoch: this.plan.expected.epoch + 1 + (release === this.plan.target ? 0 : 1) };
    const applied = await this.#applied('restore',control,nonce);if (applied) return applied;
    const paused = { ...expected,control: this.#target(),revision };
    const result = await this.#change(paused,'restore:' + nonce,() => this.platform.rpc('advance_hosting_release_checked',{ p_expected_epoch: paused.control.epoch,p_expected_release: paused.control.release,p_expected_revision: revision,p_release: release,p_resume: false,p_next_revision: nonce }));
    check(matches(result,control,nonce) && validWork(result) && workFields.every(key => result.work[key] === 0), 'handover_runtime_restore_unverified');return result;
  }
}
