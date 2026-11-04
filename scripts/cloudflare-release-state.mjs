import { createHash, randomUUID } from 'node:crypto';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const executionFlags = ['APIFY_RUNTIME_ENABLED', 'HOURLY_COLLECTION_ENABLED', 'CONTENT_ANALYSIS_ENABLED', 'AUTOMATIC_CONTENT_ENABLED', 'SOCIAL_COLLECTION_ENABLED', 'SOCIAL_CONTENT_ENABLED', 'DAILY_BRIEFING_ENABLED', 'REMINDER_EMAIL_ENABLED', 'KEYWORD_LEARNING_ENABLED'];
export class ReleaseError extends Error { constructor(code) { super(code); this.code = code; } }
const requireState = (condition, code) => { if (!condition) throw new ReleaseError(code); };

/** Normal release only. Initial ownership transfer/retirement have additional
 * parity/fencing/acceptance gates and cannot enter through this coordinator. */
export function planRelease(artifact, snapshot) {
  requireState(artifact && sha(artifact.release), 'invalid_release_artifact');
  const control = snapshot?.control, work = snapshot?.work, workers = snapshot?.workers;
  requireState(control && ['netlify', 'cloudflare'].includes(control.owner) && Number.isSafeInteger(control.epoch) && control.epoch > 0 && sha(control.release) && typeof control.paused === 'boolean' && typeof control.old_host_fenced === 'boolean', 'invalid_hosting_control');
  requireState(work && ['queued', 'running', 'expired_running', 'uncertain'].every(key => Number.isSafeInteger(work[key]) && work[key] >= 0), 'invalid_work_status');
  const blockers = [];
  if (artifact.mode !== 'active') blockers.push('active_artifact_required');
  if (control.owner !== 'cloudflare') blockers.push('cloudflare_ownership_required');
  if (!control.old_host_fenced) blockers.push('durable_old_host_fence_required');
  if (work.queued) blockers.push('queued_work_must_drain');
  if (snapshot.domain !== 'recap.filternode.dev') blockers.push('permanent_domain_unverified');
  const policy = {};
  for (const kind of ['web', 'jobs']) {
    requireState(workers?.[kind] && uuid(workers[kind].version), 'invalid_worker_snapshot');
    if (workers[kind].mode !== 'active' || workers[kind].release !== control.release) blockers.push(kind + '_active_release_mismatch');
    if (workers[kind].sourceVerified !== true) blockers.push(kind + '_source_verification_required');
    if (!/^[a-f0-9]{64}$/.test(workers[kind].bindingsHash || '')) blockers.push('binding_inventory_required');
  }
  for (const flag of executionFlags) {
    const value = workers.web.flags?.[flag];
    if (!['true', 'false'].includes(value) || workers.jobs.flags?.[flag] !== value) blockers.push('execution_policy_mismatch');
    else policy[flag] = value;
  }
  if (policy.REMINDER_EMAIL_ENABLED !== 'false') blockers.push('reminders_must_remain_off');
  // Never infer verified transport from a flag alone. The live adapter must
  // independently compare source-image/code proof before making this receipt.
  const pin = snapshot.sourcePin;
  if (snapshot.sourceVerified !== true || !pin || !uuid(pin.version) || !/^[a-f0-9]{64}$/.test(pin.image || '') || pin.workerHash !== artifact.hashes?.sourceWorker || pin.containerHash !== artifact.hashes?.sourceContainer) blockers.push('source_artifact_proof_required');
  requireState(uuid(snapshot.revision), 'invalid_release_revision');
  const plan = { schema: 2, action: 'cloudflare-release', target: artifact.release,
    expected: { owner: control.owner, epoch: control.epoch, release: control.release, paused: control.paused, old_host_fenced: control.old_host_fenced, revision: snapshot.revision },
    priorVersions: { web: workers.web.version, jobs: workers.jobs.version }, policy,
    bindings: { web: workers.web.bindingsHash, jobs: workers.jobs.bindingsHash },
    artifactHashes: { web: artifact.hashes?.web, jobs: artifact.hashes?.jobs, sourceWorker: artifact.hashes?.sourceWorker, sourceContainer: artifact.hashes?.sourceContainer },
    sourcePin: pin ? { version: pin.version, image: pin.image, workerHash: pin.workerHash, containerHash: pin.containerHash, enabled: pin.enabled } : null,
    blockers: [...new Set(blockers)] };
  requireState(Object.values(plan.artifactHashes).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), 'invalid_artifact_hashes');
  return { ...plan, digest: digest(plan) };
}

const phases = ['prepared', 'paused', 'drained', 'uploaded', 'transferred', 'promoted', 'verified', 'complete'];
const expectedControl = (plan, transferred = false) => ({ owner: 'cloudflare', epoch: plan.expected.epoch + (transferred && plan.target !== plan.expected.release ? 1 : 0), release: transferred ? plan.target : plan.expected.release, old_host_fenced: true });
function checkControl(status, expected, paused = true, revision) {
  requireState(status && typeof status.control?.paused === 'boolean' && Object.entries(expected).every(([key, value]) => status.control?.[key] === value) && status.control.paused === paused, 'hosting_control_changed');
  if (revision) requireState(status.revision === revision, 'hosting_release_revision_changed');
  requireState(status.work && ['queued', 'running', 'expired_running', 'uncertain'].every(key => Number.isSafeInteger(status.work[key]) && status.work[key] >= 0), 'invalid_work_status');
}

/** Ports are explicit: no environment, networking or provider calls occur on
 * import. save() must durably persist a sanitized checkpoint before each phase.
 * Interrupted transfer/resume are reconciled by reading the control, not replay
 * of business work. Uncertain external promotion keeps admission paused. */
export async function runRelease(plan, api, save, prior = null) {
  const { digest: storedDigest, ...body } = plan || {};
  requireState(storedDigest === digest(body) && body.schema === 2 && body.action === 'cloudflare-release', 'release_plan_changed');
  requireState(Array.isArray(plan.blockers) && plan.blockers.length === 0, 'release_gates_blocked');
  requireState(plan.expected.owner === 'cloudflare' && plan.expected.old_host_fenced === true, 'release_cannot_transfer_initial_ownership');
  let journal = prior ? structuredClone(prior) : { schema: 2, planDigest: plan.digest, phase: 'prepared', pending: null, versions: null, error: null, revision: null, intents: {} };
  requireState(journal.schema === 2 && journal.planDigest === plan.digest && phases.includes(journal.phase), 'release_checkpoint_changed');
  requireState(Object.keys(journal).every(key => ['schema', 'planDigest', 'phase', 'pending', 'versions', 'error', 'revision', 'intents'].includes(key)), 'release_checkpoint_changed');
  requireState(journal.intents && Object.entries(journal.intents).every(([key,value]) => ['pause','transfer','resume'].includes(key) && uuid(value)), 'release_checkpoint_changed');
  if (journal.phase !== 'prepared') requireState(uuid(journal.revision), 'release_checkpoint_changed');
  if (phases.indexOf(journal.phase) >= phases.indexOf('uploaded')) requireState(uuid(journal.versions?.jobs) && uuid(journal.versions?.web), 'invalid_uploaded_versions');
  if (journal.phase === 'complete') {
    const status = await api.status(); checkControl(status, expectedControl(plan, true), plan.expected.paused, journal.revision);
    requireState(await api.verify(plan, journal.versions) === true, 'release_readback_failed');
    return journal;
  }
  const before = async pending => { if (['pause','transfer','resume'].includes(pending) && !journal.intents[pending]) journal.intents[pending] = randomUUID(); journal.pending = pending; journal.error = null; await save(structuredClone(journal)); await api.assertCheckedRelease(plan.target); };
  const after = async phase => { journal.phase = phase; journal.pending = null; journal.error = null; await save(structuredClone(journal)); };
  try {
    if (journal.phase === 'prepared') {
      await before('pause');
      await api.preflight(plan);
      const status = await api.quiesce(plan.expected, journal.intents.pause); checkControl(status, expectedControl(plan), true, journal.intents.pause); journal.revision = status.revision;
      requireState(status.work.queued === 0, 'queued_work_must_drain'); await after('paused');
    }
    if (journal.phase === 'paused') {
      const status = await api.status(); checkControl(status, expectedControl(plan), true, journal.revision);
      requireState(status.work.queued === 0 && status.work.running === 0 && status.work.expired_running === 0, 'release_drain_pending'); await after('drained');
    }
    if (journal.phase === 'drained') {
      await before('upload');
      const status = await api.status(); checkControl(status, expectedControl(plan), true, journal.revision);
      requireState(status.work.queued === 0 && status.work.running === 0, 'release_drain_pending');
      const versions = await api.upload(plan);
      requireState(uuid(versions?.jobs) && uuid(versions?.web), 'invalid_uploaded_versions');
      journal.versions = { jobs: versions.jobs, web: versions.web }; await after('uploaded');
    }
    if (journal.phase === 'uploaded') {
      await before('transfer');
      let status = await api.status();
      const next = expectedControl(plan, true);
      const alreadyTransferred = Object.entries(next).every(([key, value]) => status.control?.[key] === value) && status.revision === journal.intents.transfer;
      if (!alreadyTransferred) { checkControl(status, expectedControl(plan), true, journal.revision); requireState(status.work.queued === 0 && status.work.running === 0, 'release_drain_pending'); status = await api.transfer(plan.expected, plan.target, journal.revision, journal.intents.transfer); }
      checkControl(status, next, true, journal.intents.transfer); journal.revision = status.revision; requireState(status.work.queued === 0 && status.work.running === 0, 'release_drain_pending'); await after('transferred');
    }
    if (journal.phase === 'transferred') {
      await before('promote'); checkControl(await api.status(), expectedControl(plan, true), true, journal.revision);
      requireState(uuid(journal.versions?.jobs) && uuid(journal.versions?.web), 'invalid_uploaded_versions');
      await api.promote(journal.versions, plan); await after('promoted');
    }
    if (journal.phase === 'promoted') {
      checkControl(await api.status(), expectedControl(plan, true), true, journal.revision);
      requireState(await api.verify(plan, journal.versions) === true, 'release_readback_failed'); await after('verified');
    }
    if (journal.phase === 'verified') {
      await before('resume'); let status = await api.status();
      if (plan.expected.paused) checkControl(status, expectedControl(plan, true), true, journal.revision);
      else {
        const alreadyResumed = status.control?.paused === false && status.revision === journal.intents.resume;
        if (!alreadyResumed) { checkControl(status, expectedControl(plan, true), true, journal.revision); status = await api.resume(expectedControl(plan, true), journal.revision, journal.intents.resume); }
        checkControl(status, expectedControl(plan, true), false, journal.intents.resume); journal.revision = status.revision;
      }
      checkControl(status, expectedControl(plan, true), plan.expected.paused, journal.revision); await after('complete');
    }
    return journal;
  } catch (error) {
    journal.error = error instanceof ReleaseError ? error.code : 'release_phase_uncertain';
    await save(structuredClone(journal));
    throw new ReleaseError(journal.error);
  }
}
