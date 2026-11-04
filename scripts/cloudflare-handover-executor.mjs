import { checkedArtifact } from './cloudflare-release-platform.mjs';
import { HandoverRuntime } from './cloudflare-handover-runtime.mjs';
import { HandoverDelivery,readDelivery,deliveryPolicy } from './cloudflare-handover-delivery.mjs';
import { assertHandoverPlan,assertHandoverCheckpoint,runHandover,runHandoverRollback } from './cloudflare-handover-state.mjs';
import { runtimeDigest } from './cloudflare-source-runtime.mjs';
import { executionFlags,ReleaseError } from './cloudflare-release-state.mjs';
import { legacySite,databaseProject } from './cloudflare-handover-native.mjs';
import { assertDeploymentQuiescence } from './cloudflare-deployment-quiescence.mjs';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const same = (a,b) => runtimeDigest(a) === runtimeDigest(b);
const oldControl = plan => ({ control: Object.fromEntries(['owner','epoch','release','paused','old_host_fenced'].map(key => [key,plan.expected[key]])),revision: plan.expected.revision });
const targetControl = plan => ({ owner: 'cloudflare',epoch: plan.expected.epoch + 1,release: plan.target,paused: true,old_host_fenced: true });
const nativeEmpty = () => ({ schema: 1,targetWitness: null,operations: {} });
const intervention = new Set(['handover_control_changed','delivery_control_changed','handover_runtime_control_changed','delivery_target_witness_changed']);

/** Trusted local operator composition. No JSON/apply CLI or public route.
 * Existing local fence/variable authority stays local; the journal acknowledges
 * every native intent and target witness before a provider mutation. */
export class HandoverExecutor {
  constructor({ platform,github,legacy,replacement,plan,artifact,remote,prepared,evidenceReader,recovery,prior = null,action = 'handover',handover = null,runtimeFactory,deliveryFactory }) {
    assertHandoverPlan(plan,artifact);check(['handover','rollback'].includes(action) && remote?.action === action && remote.plan?.digest === plan.digest && typeof prepared?.assert === 'function' && typeof evidenceReader === 'function' && typeof recovery?.verify === 'function', 'handover_executor_unconfigured');
    if (prior) { assertHandoverCheckpoint(plan,prior,action);check(!intervention.has(prior.error), 'handover_operator_change_requires_replan'); }
    if (action === 'rollback') { assertHandoverCheckpoint(plan,handover);check(handover.versions, 'handover_versions_unverified'); }
    Object.assign(this,{ platform,github,legacy,replacement,plan,artifact,remote,prepared,evidenceReader,recovery,action,handover,prior });
    this.native = structuredClone(prior?.native || nativeEmpty());this.latest = prior && structuredClone(prior);
    const authorize = () => this.#authorize(),saveIntent = intent => this.#intent(intent);
    this.runtime = runtimeFactory ? runtimeFactory({ authorize,saveIntent }) : new HandoverRuntime({ platform,artifact,plan,authorize,saveIntent });
    this.delivery = deliveryFactory ? deliveryFactory({ authorize,saveIntent }) : new HandoverDelivery({ platform,github,plan,artifact,authorize,saveIntent });
  }
  #versions() { return this.action === 'rollback' ? this.handover.versions : this.latest?.versions; }
  #target(revision) { return { control: targetControl(this.plan),revision }; }
  async #save(primary) {
    const next = { ...structuredClone(primary),native: structuredClone(this.native) };
    assertHandoverCheckpoint(this.plan,next,this.action);await this.remote.save(next);this.latest = next;
  }
  async #nativeSave(native) {
    check(this.latest?.pending, 'handover_native_intent_without_phase');
    const next = { ...structuredClone(this.latest),native: structuredClone(native) };
    assertHandoverCheckpoint(this.plan,next,this.action);await this.remote.save(next);
    this.native = next.native;this.latest = next;return true;
  }
  #intent(intent) {
    const key = intent.kind + ':' + intent.operation;
    return this.#nativeSave({ ...this.native,operations: { ...this.native.operations,[key]: structuredClone(intent) } });
  }
  async #checked() {
    await assertDeploymentQuiescence(this.github,this.plan.target);
    const proof = await this.prepared.assert(this.artifact);
    check(proof?.verified === true && proof.historicalReadOnly === false && proof.deploymentSkipped === true && proof.release === this.plan.target && proof.artifactDigest === this.plan.artifactDigest && runtimeDigest(checkedArtifact(this.platform.root)) === this.plan.artifactDigest, 'handover_executor_artifact_changed');
    const source = await this.runtime.verifySource();check(source.verified, 'source_runtime_unverified');
    if (this.action === 'handover' && ['prepared','delivery-stopped','fenced','staged'].includes(this.latest?.phase || 'prepared')) check(source.enabled === false, 'handover_source_state_changed');
    for (const kind of ['web','jobs']) {
      const current = await this.platform.current(kind),allowed = [this.plan.priorVersions[kind],this.#versions()?.[kind]];
      if (this.action === 'rollback') allowed.push(this.plan.rollback.versions[kind]);
      check(allowed.includes(current.version), 'handover_runtime_worker_changed');
    }
  }
  async #ownResume() {
    const status = await this.platform.status();
    return this.action === 'handover' && this.plan.resumeProcessing && ['selected','complete'].includes(this.latest?.phase) && this.latest.intents.resume && status.revision === this.latest.intents.resume && same(status.control,{ ...targetControl(this.plan),paused: false });
  }
  async #recoveryProof() {
    const actual = checkedArtifact(this.recovery.root);
    check(actual.mode === 'active' && actual.release === this.plan.rollback.release && runtimeDigest(actual) === runtimeDigest(this.recovery.artifact) && ['sourceWorker','sourceContainer'].every(kind => actual.hashes[kind] === this.artifact.hashes[kind]), 'handover_recovery_artifact_changed');
    const policy = this.recovery.policy;
    check(Object.keys(policy || {}).length === executionFlags.length && executionFlags.every(flag => ['true','false'].includes(policy[flag])) && policy.REMINDER_EMAIL_ENABLED === 'false', 'handover_recovery_policy_changed');
    const result = await this.recovery.verify(this.plan.rollback,{ artifact: actual,policy });
    check(result?.verified === true && result.release === actual.release && result.digest === this.plan.rollback.digest && result.artifactDigest === runtimeDigest(actual) && same(result.versions,this.plan.rollback.versions), 'handover_recovery_proof_changed');
    return actual;
  }
  async #evidence() {
    const receipts = await this.evidenceReader(this.plan);
    check(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].every(name => receipts?.[name]?.verified === true && receipts[name].release === this.plan.target && receipts[name].digest === this.plan.receipts[name]), 'handover_evidence_changed');
    await this.#recoveryProof();return true;
  }
  async #fenceReceipt() {
    const current = await this.legacy.readFenceReadiness(),id = current.identity;
    check(current.externalFenceEstablished === true && current.oldKeyStatus === 401 && current.replacementKeyStatus === 200 && current.oldKeyPresent === false && current.legacy.buildsStopped === true, 'handover_fence_unverified');
    return { site: legacySite,project: databaseProject,oldKeyIdHash: id.oldKeyIdHash,oldKeyHash: id.oldKeyHash,replacementKeyHash: id.replacementKeyHash,oldDatabaseStatus: 401,replacementDatabaseStatus: 200,oldKeyAbsent: true };
  }
  async #authorize() {
    await this.#checked();
    if (this.action === 'rollback') { await this.#recoveryProof();await this.#fenceReceipt();return true; }
    if (await this.#ownResume()) { await this.#fenceReceipt();return true; }
    await this.#evidence();
    if (this.latest?.fenceReceipt) check(runtimeDigest(await this.#fenceReceipt()) === this.latest.fenceReceipt, 'handover_fence_unverified');
    return true;
  }
  async #stop(expected) {
    const before = await readDelivery(this.platform,this.github);
    if (!this.native.targetWitness) await this.#nativeSave({ ...this.native,targetWitness: before.target });
    const witness = this.native.targetWitness;
    const surface = await this.delivery.stopDelivery(expected,this.#versions(),witness);
    if (witness.value === 'paused') check(same(surface.target,witness), 'delivery_target_witness_changed');
    await this.#nativeSave({ ...this.native,targetWitness: surface.target });
  }
  async #readback() {
    const source = await this.runtime.verifySource();check(source.enabled === true, 'handover_source_state_changed');
    const live = await this.platform.source(this.artifact);
    await this.platform.verify({ ...this.plan,sourcePin: live.pin },this.artifact,this.#versions());
    const surface = await readDelivery(this.platform,this.github),desired = deliveryPolicy(this.plan.policy),consumers = surface.queues['therecap-jobs'].consumers;
    check(!surface.schedules.web.length && !surface.schedules.source.length && same(surface.schedules.jobs,desired.crons) && !surface.queues['therecap-jobs-dead'].consumers.length && consumers.length === (desired.consumer ? 1 : 0), 'handover_delivery_readback_failed');
    if (desired.consumer) { const { id,...actual } = consumers[0];check(/^[a-f0-9]{32}$/.test(id) && same(actual,desired.consumer), 'handover_delivery_readback_failed'); }
    return true;
  }
  async #restoreVersions() {
    const artifact = await this.#recoveryProof(),expected = { control: { ...this.latest.expected.control,paused: true,release: this.plan.rollback.release,epoch: this.latest.expected.control.epoch + (this.plan.rollback.release === this.plan.target ? 0 : 1) },revision: this.latest.revision };
    await this.runtime.setSourceEnabled(expected,false,this.#versions());
    for (const kind of ['jobs','web']) {
      await this.#authorize();await this.#intent({ kind: 'hosting-runtime',planDigest: this.plan.digest,operation: 'recover-' + kind,digest: runtimeDigest({ kind: 'hosting-runtime',planDigest: this.plan.digest,operation: 'recover-' + kind }) });
      await this.#authorize();const status = await this.platform.status();
      check(status.revision === expected.revision && same(status.control,expected.control) && Object.values(status.work).every(count => count === 0), 'handover_runtime_control_changed');
      await this.platform.assertVersion(kind,this.plan.rollback.versions[kind],artifact,this.recovery.policy,'active',this.plan.bindings[kind]);
      await this.platform.promoteVersion(kind,this.plan.rollback.versions[kind],[this.plan.priorVersions[kind],this.#versions()[kind]]);
    }
  }
  async #recoveryReadback() {
    const artifact = await this.#recoveryProof(),source = await this.runtime.verifySource();check(source.enabled === false, 'handover_recovery_source_enabled');
    const platform = Object.create(this.platform);platform.root = this.recovery.root;
    const live = await platform.source(artifact);
    await platform.verify({ ...this.plan,policy: this.recovery.policy,sourcePin: live.pin },artifact,this.plan.rollback.versions);
    const surface = await readDelivery(this.platform,this.github);
    check(surface.target.value === 'paused' && Object.values(surface.schedules).every(crons => crons.length === 0), 'handover_rollback_readback_failed');return true;
  }
  async run() {
    const api = { status: () => this.platform.status(),assertCheckedHandover: () => this.#checked(),verifyEvidence: () => this.#evidence(),
      stopDelivery: () => this.#stop(this.action === 'rollback' ? this.latest.expected : oldControl(this.plan)),verifyTarget: async value => (await readDelivery(this.platform,this.github)).target.value === value,
      fenceOldHost: async () => { await this.legacy.stopBuilds(this.plan,() => this.#authorize());const receipt = await this.legacy.revokeOldKey(this.plan,this.replacement,() => this.#authorize(),async () => this.#intent({ kind: 'hosting-fence',planDigest: this.plan.digest,operation: 'legacy-key-revoke',digest: runtimeDigest({ kind: 'hosting-fence',planDigest: this.plan.digest,operation: 'legacy-key-revoke' }) }));return runtimeDigest(receipt); },
      verifyFence: async (_plan,digest) => runtimeDigest(await this.#fenceReceipt()) === digest,
      stage: () => this.runtime.stage(oldControl(this.plan)),commit: (_plan,nonce) => this.runtime.commit(oldControl(this.plan),nonce,this.#versions()),
      promote: (_plan,versions) => this.runtime.promote(this.#target(this.latest.revision),versions),configureDelivery: () => this.delivery.configureDelivery(this.#target(this.latest.revision),this.#versions()),verifyReadback: () => this.#readback(),
      selectCloudflare: () => this.delivery.selectCloudflare(this.#target(this.latest.revision),this.#versions(),this.native.targetWitness),resume: (_plan,revision,nonce) => this.runtime.resume(this.#target(revision),nonce,this.#versions()),
      assertCheckedRecovery: () => this.#checked(),verifyRollbackProof: async () => { await this.#recoveryProof();return true; },verifyRecoveryFence: async () => { await this.#fenceReceipt();return true; },
      pauseForRollback: (expected,nonce) => this.runtime.pauseForRollback(expected,nonce),restoreRelease: (...args) => this.runtime.restoreRelease(...args),restoreVersions: () => this.#restoreVersions(),verifyRecovery: () => this.#recoveryReadback() };
    const operation = this.action === 'rollback' ? runHandoverRollback : runHandover;
    await operation(this.plan,api,journal => this.#save(journal),this.prior);return structuredClone(this.latest);
  }
}
