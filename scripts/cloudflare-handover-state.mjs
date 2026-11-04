import { createHash, randomUUID } from 'node:crypto';
import { executionFlags, ReleaseError } from './cloudflare-release-state.mjs';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const check = (condition, code) => { if (!condition) throw new ReleaseError(code); };
const oldSite = '522a0657-c191-4355-8d72-2ed19c580b81';
const evidenceNames = ['privateParity', 'secretContinuity', 'preservation', 'legacyDrain', 'fenceReadiness'];
const phases = ['prepared', 'delivery-stopped', 'fenced', 'staged', 'transferred', 'routed', 'verified', 'selected', 'complete'];
const workEmpty = status => status.work && ['queued', 'running', 'expired_running', 'uncertain'].every(name => status.work[name] === 0);
const targetControl = plan => ({ owner: 'cloudflare', epoch: plan.expected.epoch + 1, release: plan.target, paused: true, old_host_fenced: true });
function statusMatches(status, expected, revision) {
  check(status && Object.entries(expected).every(([key,value]) => status.control?.[key] === value) && status.revision === revision, 'handover_control_changed');
  check(workEmpty(status), 'handover_work_not_drained');
}

/** Pure planning. Receipt hashes identify independently verified evidence;
 * neither a hash nor a caller boolean authorizes a live switch. The live ports
 * must re-verify each external gate before mutation. No apply CLI is exposed. */
export function planHandover(artifact, snapshot, options = {}) {
  check(sha(artifact?.release) && ['web','jobs','sourceWorker','sourceContainer'].every(name => hash(artifact.hashes?.[name])), 'invalid_handover_artifact');
  const c = snapshot?.control;
  check(c && ['netlify','cloudflare'].includes(c.owner) && typeof c.paused === 'boolean' && typeof c.old_host_fenced === 'boolean' && Number.isSafeInteger(c.epoch) && c.epoch > 0 && sha(c.release) && uuid(snapshot.revision), 'invalid_handover_snapshot');
  const blockers = [];
  if (artifact.mode !== 'active') blockers.push('active_artifact_required');
  if (c.owner !== 'netlify' || c.paused !== true) blockers.push('paused_netlify_owner_required');
  if (!workEmpty(snapshot)) blockers.push('hosting_work_must_be_resolved');
  if (snapshot.domain !== 'recap.filternode.dev') blockers.push('permanent_domain_unverified');
  if (snapshot.sourceVerified !== true || !uuid(snapshot.sourcePin?.version) || !hash(snapshot.sourcePin?.image) || snapshot.sourcePin?.workerHash !== artifact.hashes.sourceWorker || snapshot.sourcePin?.containerHash !== artifact.hashes.sourceContainer) blockers.push('source_artifact_proof_required');
  const priorVersions = {}, bindings = {};
  for (const kind of ['web', 'jobs']) {
    const worker = snapshot.workers?.[kind];
    check(uuid(worker?.version), 'invalid_handover_worker');
    priorVersions[kind] = worker.version; bindings[kind] = worker.bindingsHash;
    if (worker.mode !== 'shadow' || executionFlags.some(flag => worker.flags?.[flag] !== 'false') || !hash(worker.bindingsHash)) blockers.push('inert_duplicate_required');
  }
  const policy = options.policy || {};
  if (Object.keys(policy).length !== executionFlags.length || executionFlags.some(flag => !['true','false'].includes(policy[flag]))) blockers.push('explicit_existing_execution_policy_required');
  if (policy.REMINDER_EMAIL_ENABLED !== 'false') blockers.push(policy.REMINDER_EMAIL_ENABLED === 'true' ? 'reminders_must_remain_off' : 'reminder_policy_unverified');
  if (typeof options.resumeProcessing !== 'boolean') blockers.push('explicit_resume_policy_required');
  const receipts = {};
  for (const name of evidenceNames) {
    const receipt = snapshot.evidence?.[name];
    if (receipt?.verified !== true || receipt.release !== artifact.release || !hash(receipt.digest)) blockers.push(name + '_proof_required');
    else receipts[name] = receipt.digest;
  }
  const rollback = snapshot.rollback;
  if (rollback?.verified !== true || rollback.host !== 'cloudflare' || rollback.mode !== 'active' || !sha(rollback.release) || !hash(rollback.digest) || !['web','jobs'].every(kind => uuid(rollback.versions?.[kind]))) blockers.push('usable_cloudflare_rollback_required');
  const plan = { schema: 1, action: 'initial-cloudflare-handover', oldSite, target: artifact.release, artifactDigest: digest(artifact),
    expected: { owner: c.owner, epoch: c.epoch, release: c.release, paused: c.paused, old_host_fenced: c.old_host_fenced, revision: snapshot.revision },
    priorVersions, bindings, sourcePin: snapshot.sourcePin ? Object.fromEntries(['version','image','workerHash','containerHash','enabled'].map(name => [name,snapshot.sourcePin[name]])) : null, policy, resumeProcessing: options.resumeProcessing === true, receipts,
    rollback: rollback?.verified === true ? { verified: true, host: rollback.host, mode: rollback.mode, release: rollback.release, digest: rollback.digest, versions: { web: rollback.versions?.web, jobs: rollback.versions?.jobs } } : null, blockers: [...new Set(blockers)] };
  return { ...plan, digest: digest(plan) };
}
function checkedPlan(plan) {
  const { digest: stored, ...body } = plan || {};
  check(stored === digest(body) && body.schema === 1 && body.action === 'initial-cloudflare-handover' && body.oldSite === oldSite, 'handover_plan_changed');
  check(Array.isArray(plan.blockers) && plan.blockers.length === 0 && plan.expected.owner === 'netlify' && plan.expected.paused === true, 'handover_gates_blocked');
}

/** Rehearsed orchestration ports only. Fence/credentials/routing/CI operations
 * are independently idempotent adapters; this module never talks to a host,
 * rotates a key, dispatches a job or deletes the old site. */
export async function runHandover(plan, api, save, prior = null) {
  checkedPlan(plan);
  let journal = prior ? structuredClone(prior) : { schema: 1, planDigest: plan.digest, phase: 'prepared', pending: null, error: null, versions: null, fenceReceipt: null, revision: plan.expected.revision, intents: {} };
  check(journal.schema === 1 && journal.planDigest === plan.digest && phases.includes(journal.phase) && uuid(journal.revision) && journal.intents && Object.keys(journal).every(key => ['schema','planDigest','phase','pending','error','versions','fenceReceipt','revision','intents'].includes(key)), 'handover_checkpoint_changed');
  check(Object.entries(journal.intents).every(([key,value]) => ['transfer','resume'].includes(key) && uuid(value)), 'handover_checkpoint_changed');
  if (phases.indexOf(journal.phase) >= phases.indexOf('fenced')) check(hash(journal.fenceReceipt), 'handover_checkpoint_changed');
  if (phases.indexOf(journal.phase) >= phases.indexOf('staged')) check(Object.keys(journal.versions || {}).length === 2 && ['web','jobs'].every(kind => uuid(journal.versions?.[kind])), 'handover_checkpoint_changed');
  const transferred = phases.indexOf(journal.phase) >= phases.indexOf('transferred');
  check(journal.revision === (journal.phase === 'complete' && plan.resumeProcessing ? journal.intents.resume : transferred ? journal.intents.transfer : plan.expected.revision), 'handover_checkpoint_changed');
  const old = { ...plan.expected }; delete old.revision;
  const fresh = async () => { await api.assertCheckedHandover(plan); check(await api.verifyEvidence(plan) === true, 'handover_evidence_changed'); };
  const before = async pending => { if (['transfer','resume'].includes(pending) && !journal.intents[pending]) journal.intents[pending] = randomUUID(); journal.pending = pending; journal.error = null; await save(structuredClone(journal)); await fresh(); };
  const after = async phase => { journal.phase = phase; journal.pending = null; journal.error = null; await save(structuredClone(journal)); };
  const unchangedOld = async () => statusMatches(await api.status(), old, plan.expected.revision);
  const pausedTarget = async () => statusMatches(await api.status(), targetControl(plan), journal.revision);
  try {
    if (journal.phase === 'complete') {
      await fresh(); statusMatches(await api.status(), { ...targetControl(plan), paused: !plan.resumeProcessing }, journal.revision);
      check(await api.verifyReadback(plan, journal.versions) === true && await api.verifyTarget('cloudflare') === true && await api.verifyFence(plan, journal.fenceReceipt) === true, 'handover_readback_failed'); return journal;
    }
    if (journal.phase === 'prepared') {
      await before('stop-delivery'); await unchangedOld(); await api.stopDelivery(plan); check(await api.verifyTarget('paused') === true, 'handover_delivery_not_stopped'); await after('delivery-stopped');
    }
    if (journal.phase === 'delivery-stopped') {
      await before('fence'); await unchangedOld(); const receipt = await api.fenceOldHost(plan);
      check(hash(receipt) && await api.verifyFence(plan, receipt) === true, 'handover_fence_unverified'); journal.fenceReceipt = receipt; await after('fenced');
    }
    if (journal.phase === 'fenced') {
      await before('stage'); await unchangedOld(); check(await api.verifyFence(plan, journal.fenceReceipt) === true, 'handover_fence_unverified');
      const versions = await api.stage(plan); check(['web','jobs'].every(kind => uuid(versions?.[kind])), 'handover_versions_unverified'); journal.versions = { web: versions.web, jobs: versions.jobs }; await after('staged');
    }
    if (journal.phase === 'staged') {
      await before('transfer'); check(await api.verifyTarget('paused') === true && await api.verifyFence(plan, journal.fenceReceipt) === true, 'handover_fence_unverified');
      let status = await api.status();
      if (status.revision !== journal.intents.transfer) { statusMatches(status, old, plan.expected.revision); status = await api.commit(plan, journal.intents.transfer); }
      statusMatches(status, targetControl(plan), journal.intents.transfer); journal.revision = status.revision; await after('transferred');
    }
    if (journal.phase === 'transferred') {
      await before('route'); await pausedTarget(); await api.promote(plan, journal.versions); await api.configureDelivery(plan); await after('routed');
    }
    if (journal.phase === 'routed') {
      await fresh(); await pausedTarget(); check(await api.verifyReadback(plan, journal.versions) === true && await api.verifyFence(plan, journal.fenceReceipt) === true, 'handover_readback_failed'); await after('verified');
    }
    if (journal.phase === 'verified') {
      await before('select-target'); await pausedTarget(); await api.selectCloudflare(plan); check(await api.verifyTarget('cloudflare') === true, 'handover_target_unverified'); await after('selected');
    }
    if (journal.phase === 'selected') {
      await before('resume'); check(await api.verifyTarget('cloudflare') === true && await api.verifyFence(plan, journal.fenceReceipt) === true && await api.verifyReadback(plan, journal.versions) === true, 'handover_readback_failed');
      let status = await api.status();
      if (plan.resumeProcessing) {
        if (!(status.control?.paused === false && status.revision === journal.intents.resume)) { statusMatches(status, targetControl(plan), journal.revision); status = await api.resume(plan, journal.revision, journal.intents.resume); }
        statusMatches(status, { ...targetControl(plan), paused: false }, journal.intents.resume); journal.revision = status.revision;
      } else statusMatches(status, targetControl(plan), journal.revision);
      await after('complete');
    }
    return journal;
  } catch (error) {
    journal.error = error instanceof ReleaseError ? error.code : 'handover_phase_uncertain'; await save(structuredClone(journal)); throw new ReleaseError(journal.error);
  }
}

/** Explicit recovery. Restore only the proved Cloudflare versions; leave work
 * paused and keep Netlify fenced. A Netlify 503 is never a rollback target. */
export async function runHandoverRollback(plan, api, save, prior = null) {
  checkedPlan(plan);
  check(plan.rollback?.host === 'cloudflare' && plan.rollback.verified === true, 'handover_rollback_unavailable');
  let journal = prior ? structuredClone(prior) : { schema: 1, planDigest: plan.digest, phase: 'prepared', pending: null, error: null, expected: null, revision: null, intents: { pause: randomUUID(), restore: randomUUID() } };
  check(journal.schema === 1 && journal.planDigest === plan.digest && ['prepared','paused','restored','complete'].includes(journal.phase) && Object.keys(journal).every(key => ['schema','planDigest','phase','pending','error','expected','revision','intents'].includes(key)) && uuid(journal.intents?.pause) && uuid(journal.intents?.restore), 'handover_rollback_checkpoint_changed');
  check(Object.keys(journal.intents).length === 2 && (!journal.expected || (journal.expected.control?.owner === 'cloudflare' && journal.expected.control.epoch === plan.expected.epoch + 1 && journal.expected.control.release === plan.target && journal.expected.control.old_host_fenced === true && typeof journal.expected.control.paused === 'boolean' && uuid(journal.expected.revision))), 'handover_rollback_checkpoint_changed');
  if (journal.phase !== 'prepared') check(journal.expected && journal.revision === (journal.phase === 'paused' ? journal.intents.pause : journal.intents.restore), 'handover_rollback_checkpoint_changed');
  const before = async pending => { journal.pending = pending; journal.error = null; await save(structuredClone(journal)); await api.assertCheckedRecovery(plan); check(await api.verifyRollbackProof(plan.rollback) === true && await api.verifyRecoveryFence(plan) === true, 'handover_rollback_proof_changed'); };
  const after = async phase => { journal.phase = phase; journal.pending = null; await save(structuredClone(journal)); };
  const restored = () => ({ ...journal.expected.control, release: plan.rollback.release, epoch: journal.expected.control.epoch + (plan.rollback.release === plan.target ? 0 : 1), paused: true });
  try {
    if (journal.phase === 'prepared') {
      if (!journal.expected) { const status = await api.status(); check(status.control?.owner === 'cloudflare' && status.control.epoch === plan.expected.epoch + 1 && status.control.release === plan.target && status.control.old_host_fenced === true && uuid(status.revision), 'handover_rollback_state_changed'); journal.expected = status; }
      await before('pause'); await api.stopDelivery(plan); check(await api.verifyTarget('paused') === true, 'handover_delivery_not_stopped');
      let status = await api.status();
      if (!(status.control?.paused === true && status.revision === journal.intents.pause)) { statusMatches(status, journal.expected.control, journal.expected.revision); status = await api.pauseForRollback(journal.expected, journal.intents.pause); }
      statusMatches(status, { ...journal.expected.control, paused: true }, journal.intents.pause); journal.revision = status.revision; await after('paused');
    }
    if (journal.phase === 'paused') {
      await before('restore'); let status = await api.status();
      if (status.revision !== journal.intents.restore) { statusMatches(status, { ...journal.expected.control, paused: true }, journal.revision); status = await api.restoreRelease(journal.expected, plan.rollback.release, journal.revision, journal.intents.restore); }
      statusMatches(status, restored(), journal.intents.restore); journal.revision = status.revision; await api.restoreVersions(plan.rollback); await after('restored');
    }
    if (journal.phase === 'restored' || journal.phase === 'complete') {
      await before('verify'); statusMatches(await api.status(), restored(), journal.revision);
      check(await api.verifyRecovery(plan.rollback) === true && await api.verifyTarget('paused') === true, 'handover_rollback_readback_failed'); await after('complete');
    }
    return journal;
  } catch (error) { journal.error = error instanceof ReleaseError ? error.code : 'handover_rollback_uncertain'; await save(structuredClone(journal)); throw new ReleaseError(journal.error); }
}
