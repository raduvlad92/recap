import { ReleaseError } from './cloudflare-release-state.mjs';
import { assertHandoverPlan, assertHandoverCheckpoint } from './cloudflare-handover-state.mjs';

const repository = 'raduvlad92/recap';
const names = { handover: 'cloudflare-handover-checkpoint', rollback: 'cloudflare-handover-rollback-checkpoint' };
const check = (condition, code) => { if (!condition) throw new ReleaseError(code); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const encode = value => JSON.stringify(canonical(value));
const summaryLimit = 60000;
function parse(summary) {
  check(typeof summary === 'string' && Buffer.byteLength(summary,'utf8') <= summaryLimit, 'handover_checkpoint_changed');
  let data;
  try { data = JSON.parse(summary); } catch { throw new ReleaseError('handover_checkpoint_changed'); }
  check(data && typeof data === 'object' && !Array.isArray(data), 'handover_checkpoint_changed');
  return data;
}

/** Durable, sanitized progress only. No runtime/provider/database credentials or
 * mutation ports are accepted. Execution must still recheck every live gate.
 * Production workflows must share the therecap-hosting-production concurrency
 * group; the sequence/readback guard also rejects intervening checkpoint edits. */
export class HandoverJournal {
  #id = null;
  #last = null;
  constructor(github, plan, artifact, action = 'handover') {
    check(Object.hasOwn(names,action), 'invalid_handover_checkpoint_action');
    assertHandoverPlan(plan,artifact);
    this.github = github;
    this.plan = structuredClone(plan);
    this.artifact = structuredClone(artifact);
    this.action = action;
  }
  get id() { return this.#id; }
  get name() { return names[this.action]; }
  get externalId() { return this.action + ':' + this.plan.digest; }
  #read(record) {
    check(Number.isSafeInteger(record?.id) && record.id > 0 && record.name === this.name && record.app?.slug === 'github-actions' && record.head_sha === this.plan.target && record.external_id === this.externalId, 'handover_checkpoint_changed');
    const data = parse(record.output?.summary);
    check(Object.keys(data).sort().join(',') === 'action,artifactDigest,journal,kind,plan,repository,schema,sequence' && data.schema === 1 && data.kind === 'hosting-handover-progress' && data.repository === repository && data.action === this.action && Number.isSafeInteger(data.sequence) && data.sequence > 0, 'handover_checkpoint_changed');
    assertHandoverPlan(data.plan,this.artifact);
    check(encode(data.plan) === encode(this.plan) && data.artifactDigest === this.plan.artifactDigest, 'handover_checkpoint_changed');
    assertHandoverCheckpoint(this.plan,data.journal,this.action);
    return { data, summary: record.output.summary };
  }
  async #existing() {
    const result = await this.github.request('commits/' + this.plan.target + '/check-runs?check_name=' + this.name + '&filter=all&per_page=100');
    check(Number.isSafeInteger(result?.total_count) && result.total_count >= 0 && result.total_count <= 100 && Array.isArray(result.check_runs) && result.check_runs.length === result.total_count, 'handover_checkpoint_lookup_incomplete');
    const matches = result.check_runs.filter(record => record.app?.slug === 'github-actions' && record.name === this.name && record.head_sha === this.plan.target && record.external_id === this.externalId);
    check(matches.length <= 1, 'handover_checkpoint_ambiguous');
    return matches[0] || null;
  }
  async save(journal) {
    assertHandoverPlan(this.plan,this.artifact);
    assertHandoverCheckpoint(this.plan,journal,this.action);
    const record = this.#id ? await this.github.request('check-runs/' + this.#id) : await this.#existing();
    let current = null;
    if (record) {
      check(!this.#id || record.id === this.#id, 'handover_checkpoint_changed');
      current = this.#read(record);
      // Reconcile an acknowledged update whose response was lost. A genuinely
      // newer/different remote checkpoint must be restored, never overwritten.
      const nextSequence = this.#last ? this.#last.data.sequence + 1 : 1;
      if (encode(current.data.journal) === encode(journal) && (!this.#last ? current.data.sequence === 1 : [this.#last.data.sequence,nextSequence].includes(current.data.sequence))) {
        this.#id = record.id; this.#last = current; return;
      }
      check(this.#last && current.summary === this.#last.summary, 'handover_checkpoint_requires_resume');
    } else check(!this.#id && !this.#last, 'handover_checkpoint_changed');
    const data = { schema: 1, kind: 'hosting-handover-progress', repository, action: this.action, sequence: current ? current.data.sequence + 1 : 1, artifactDigest: this.plan.artifactDigest, plan: this.plan, journal };
    const summary = encode(data);
    check(Buffer.byteLength(summary,'utf8') <= summaryLimit, 'handover_checkpoint_too_large');
    const complete = journal.phase === 'complete', failed = journal.error !== null;
    const body = { name: this.name, external_id: this.externalId, status: complete || failed ? 'completed' : 'in_progress', ...(complete || failed ? { conclusion: failed ? 'action_required' : 'success', completed_at: new Date().toISOString() } : {}), output: { title: 'Cloudflare ' + this.action + ': ' + journal.phase, summary } };
    const written = this.#id ? await this.github.request('check-runs/' + this.#id,body,'PATCH') : await this.github.request('check-runs',{ ...body,head_sha: this.plan.target });
    const acknowledged = this.#read(written);
    check(acknowledged.summary === summary && (!this.#id || written.id === this.#id), 'handover_checkpoint_unacknowledged');
    const read = await this.github.request('check-runs/' + written.id), confirmed = this.#read(read);
    check(read.id === written.id && confirmed.summary === summary, 'handover_checkpoint_unacknowledged');
    this.#id = read.id; this.#last = confirmed;
  }
  static async restore(github,id,artifact,action = 'handover') {
    check(/^[1-9]\d*$/.test(String(id)) && Number.isSafeInteger(Number(id)), 'invalid_handover_checkpoint');
    const record = await github.request('check-runs/' + id), data = parse(record.output?.summary);
    const remote = new HandoverJournal(github,data.plan,artifact,action), read = remote.#read(record);
    check(record.id === Number(id), 'handover_checkpoint_changed');
    remote.#id = record.id; remote.#last = read;
    return { plan: structuredClone(remote.plan), prior: structuredClone(read.data.journal), remote };
  }
}

/** Exercise native storage without recording a fake ready/executable plan. */
export async function probeHandoverJournal(github,target) {
  check(/^[a-f0-9]{40}$/.test(target), 'invalid_handover_probe_target');
  const name = 'cloudflare-handover-journal-probe';
  const output = step => ({ title: 'Handover checkpoint storage; no runtime action', summary: encode({ schema: 1, kind: 'transport-only-handover-journal', target, step, activatesProcessing: false, restorableCheckpoint: false }) });
  const created = await github.request('check-runs',{ name, head_sha: target, status: 'in_progress', output: output('created') });
  const verify = (record,step) => check(Number.isSafeInteger(record?.id) && record.id > 0 && record.id === created.id && record.name === name && record.app?.slug === 'github-actions' && record.head_sha === target && record.output?.summary === output(step).summary, 'handover_probe_unacknowledged');
  verify(created,'created'); verify(await github.request('check-runs/' + created.id),'created');
  verify(await github.request('check-runs/' + created.id,{ status: 'completed',conclusion: 'neutral',output: output('updated') },'PATCH'),'updated');
  const final = await github.request('check-runs/' + created.id); verify(final,'updated');
  check(final.status === 'completed' && final.conclusion === 'neutral', 'handover_probe_unacknowledged');
  return { id: created.id, name, target, storageVerified: true, activatesProcessing: false, restorableCheckpoint: false };
}
