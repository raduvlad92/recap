import { createHash } from 'node:crypto';
import { assertHandoverPlan,assertHandoverCheckpoint } from './cloudflare-handover-state.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';
import { assertDeploymentWindowState } from './cloudflare-deployment-window.mjs';
export const hostingJournalBranch = 'ops/therecap-hosting-journal';
const repository = 'raduvlad92/recap', maximumBytes = 60000;
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const encode = value => JSON.stringify(canonical(value));
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
function decode(record,path) {
  check(record?.type === 'file' && record.path === path && record.encoding === 'base64' && typeof record.content === 'string' && record.content.length <= maximumBytes * 2 && sha(record.sha), 'handover_git_record_changed');
  const bytes = Buffer.from(record.content,'base64'), text = bytes.toString('utf8');
  check(bytes.length <= maximumBytes && bytes.toString('base64') === record.content.replace(/\s/g,'') && blob(text) === record.sha, 'handover_git_record_changed');
  let data;try { data = JSON.parse(text); } catch { throw new ReleaseError('handover_git_record_changed'); }
  check(data && typeof data === 'object' && !Array.isArray(data), 'handover_git_record_changed');
  return { sha: record.sha,text,data };
}
async function ensureBranch(github,target) {
  let ref = await github.request('git/ref/heads/' + hostingJournalBranch,undefined,'GET',true);
  if (!ref) {
    const main = await github.request('git/ref/heads/main');check(main.object?.sha === target, 'release_checked_head_changed');
    await github.request('git/refs',{ ref: 'refs/heads/' + hostingJournalBranch,sha: target });
    ref = await github.request('git/ref/heads/' + hostingJournalBranch);
  }
  check(ref?.ref === 'refs/heads/' + hostingJournalBranch && ref.object?.type === 'commit' && sha(ref.object.sha), 'handover_git_branch_changed');
}
async function read(github,path,missing = false) {
  const value = await github.request('contents/' + path + '?ref=' + encodeURIComponent(hostingJournalBranch),undefined,'GET',missing);
  return value ? decode(value,path) : null;
}
async function write(github,path,text,expectedSha) {
  check(Buffer.byteLength(text) <= maximumBytes, 'handover_git_record_too_large');
  const result = await github.request('contents/' + path,{ branch: hostingJournalBranch,message: 'Record Cloudflare hosting progress',content: Buffer.from(text).toString('base64'),...(expectedSha ? { sha: expectedSha } : {}) },'PUT');
  const confirmed = await read(github,path);
  check(result.content?.sha === confirmed.sha && confirmed.text === text, 'handover_git_unacknowledged');return confirmed;
}
/** Existing operator repository authority; atomic expected-blob writes and Git
 * history retain acknowledged progress without exporting local admin tokens
 * into CI. The operational branch is never merged or executed as source. */
export class GitHandoverJournal {
  #last = null;
  constructor(github,plan,artifact,action = 'handover') {
    assertHandoverPlan(plan,artifact);check(['handover','rollback'].includes(action), 'invalid_handover_checkpoint_action');
    Object.assign(this,{ github,plan: structuredClone(plan),artifact: structuredClone(artifact),action });
  }
  get path() { return '.hosting-journal/' + this.plan.digest + '/' + this.action + '.json'; }
  get checkpoint() { return { branch: hostingJournalBranch,path: this.path,sha: this.#last?.sha || null }; }
  #validated(record) {
    const data = record.data;
    check(Object.keys(data).sort().join(',') === 'action,artifactDigest,journal,kind,plan,repository,schema,sequence' && data.schema === 1 && data.kind === 'operator-handover-journal' && data.repository === repository && data.action === this.action && Number.isSafeInteger(data.sequence) && data.sequence > 0, 'handover_git_record_changed');
    assertHandoverPlan(data.plan,this.artifact);
    check(encode(data.plan) === encode(this.plan) && data.artifactDigest === this.plan.artifactDigest, 'handover_git_record_changed');
    assertHandoverCheckpoint(this.plan,data.journal,this.action);return record;
  }
  async save(journal) {
    assertHandoverPlan(this.plan,this.artifact);assertHandoverCheckpoint(this.plan,journal,this.action);
    await ensureBranch(this.github,this.plan.target);
    const record = await read(this.github,this.path,true), current = record && this.#validated(record);
    if (current) {
      if (encode(current.data.journal) === encode(journal) && (!this.#last ? current.data.sequence === 1 : [this.#last.data.sequence,this.#last.data.sequence + 1].includes(current.data.sequence))) { this.#last = current;return; }
      check(this.#last && current.sha === this.#last.sha, 'handover_git_requires_resume');
    } else check(!this.#last, 'handover_git_record_changed');
    const data = { schema: 1,kind: 'operator-handover-journal',repository,action: this.action,sequence: current ? current.data.sequence + 1 : 1,artifactDigest: this.plan.artifactDigest,plan: this.plan,journal };
    this.#last = this.#validated(await write(this.github,this.path,encode(data),current?.sha));
  }
  static async restore(github,planDigest,artifact,action = 'handover') {
    check(/^[a-f0-9]{64}$/.test(planDigest) && ['handover','rollback'].includes(action), 'invalid_handover_checkpoint');
    const path = '.hosting-journal/' + planDigest + '/' + action + '.json',record = await read(github,path);
    const remote = new GitHandoverJournal(github,record.data.plan,artifact,action);
    check(remote.path === path, 'handover_git_record_changed');remote.#last = remote.#validated(record);
    return { plan: structuredClone(remote.plan),prior: structuredClone(record.data.journal),remote };
  }
}

/** Separate window journal: transport-only windows cannot restore as a ready
 * handover, and a window record accepts no runtime or private account values. */
export class GitDeploymentWindowJournal {
  #last = null;
  constructor(github,state) { assertDeploymentWindowState(state);Object.assign(this,{ github,identity: Object.fromEntries(['target','purpose','planDigest','operation'].map(key => [key,state[key]])) }); }
  get path() { return '.hosting-journal/windows/' + this.identity.operation + '.json'; }
  #validated(record) {
    const data = record.data;
    check(Object.keys(data).sort().join(',') === 'kind,schema,sequence,state' && data.schema === 1 && data.kind === 'deployment-window-checkpoint' && Number.isSafeInteger(data.sequence) && data.sequence > 0,'deployment_window_checkpoint_changed');
    assertDeploymentWindowState(data.state);
    check(Object.entries(this.identity).every(([key,value]) => data.state[key] === value),'deployment_window_checkpoint_changed');return record;
  }
  async save(state) {
    assertDeploymentWindowState(state);check(Object.entries(this.identity).every(([key,value]) => state[key] === value),'deployment_window_checkpoint_changed');
    await ensureBranch(this.github,state.target);
    const record = await read(this.github,this.path,true),current = record && this.#validated(record);
    if (current) {
      if (encode(current.data.state) === encode(state) && (!this.#last ? current.data.sequence === 1 : [this.#last.data.sequence,this.#last.data.sequence + 1].includes(current.data.sequence))) { this.#last = current;return; }
      check(this.#last && current.sha === this.#last.sha,'deployment_window_requires_resume');
    } else check(!this.#last,'deployment_window_checkpoint_changed');
    const data = { schema: 1,kind: 'deployment-window-checkpoint',sequence: current ? current.data.sequence + 1 : 1,state };
    this.#last = this.#validated(await write(this.github,this.path,encode(data),current?.sha));
  }
  static async restore(github,operation) {
    check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operation || ''),'invalid_deployment_window_checkpoint');
    const record = await read(github,'.hosting-journal/windows/' + operation + '.json');
    const remote = new GitDeploymentWindowJournal(github,record.data.state);remote.#last = remote.#validated(record);
    check(remote.identity.operation === operation,'deployment_window_checkpoint_changed');return { state: structuredClone(record.data.state),remote };
  }
}
/** A distinct, non-restorable native storage probe, containing no ready plan. */
export async function probeGitHandoverJournal(github,target) {
  check(sha(target), 'invalid_handover_probe_target');await ensureBranch(github,target);
  const path = '.hosting-journal/probes/' + target + '.json';
  const payload = step => encode({ schema: 1,kind: 'transport-only-operator-journal',target,step,activatesProcessing: false,restorableCheckpoint: false });
  let prior = await read(github,path,true);
  if (prior) check(['created','updated'].some(step => prior.text === payload(step)), 'handover_git_probe_changed');
  const first = await write(github,path,payload('created'),prior?.sha);
  const second = await write(github,path,payload('updated'),first.sha);
  let conflict = false;
  try { await write(github,path,payload('created'),first.sha); } catch (error) { conflict = error instanceof ReleaseError && error.code === 'release_github_conflict'; }
  const final = await read(github,path);
  check(conflict && final.sha === second.sha && final.text === payload('updated'), 'handover_git_probe_conflict_unverified');
  return { branch: hostingJournalBranch,path,sha: final.sha,target,storageVerified: true,staleWriteRejected: true,activatesProcessing: false,restorableCheckpoint: false };
}
