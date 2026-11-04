import { ReleaseError } from './cloudflare-release-state.mjs';
const repository = 'raduvlad92/recap', checkName = 'cloudflare-release-checkpoint';
const requireState = (condition, code) => { if (!condition) throw new ReleaseError(code); };

export class ReleaseGitHub {
  constructor({ token, runId, fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve,ms)) }) {
    requireState(token && /^\d+$/.test(String(runId)), 'release_github_unconfigured');
    Object.assign(this, { token, runId: String(runId), fetcher, wait });
  }
  async request(path, body, method, allowMissing = false) {
    const response = await this.fetcher('https://api.github.com/repos/' + repository + '/' + path, {
      method: method || (body ? 'POST' : 'GET'), headers: { authorization: 'Bearer ' + this.token, accept: 'application/vnd.github+json', 'cache-control': 'no-cache', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && allowMissing && (!method || method === 'GET') && !body) return null;
      throw new ReleaseError(response.status === 409 ? 'release_github_conflict' : 'release_github_request_failed');
    }
    return response.status === 204 ? null : response.json();
  }
  async assertCheckedRelease(target, { currentMain = true } = {}) {
    // GitHub may start the dependent deployment before its jobs read model
    // exposes the completed verification. Retry only that incomplete read;
    // changed identity, explicit failure and provider errors still stop now.
    for (let attempt = 0; attempt < 6; attempt++) {
      const [ref, run, jobs] = await Promise.all([this.request('git/ref/heads/main'), this.request('actions/runs/' + this.runId), this.request('actions/runs/' + this.runId + '/jobs?filter=latest&per_page=100')]);
      requireState((!currentMain || ref.object?.sha === target) && run.head_sha === target && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) && run.repository?.full_name === repository && run.path?.split('@')[0] === '.github/workflows/cloudflare-duplicate.yml', 'release_checked_head_changed');
      const verify = jobs.jobs?.find(job => job.name === 'verify');
      if (verify?.status === 'completed' && verify.conclusion === 'success') return;
      requireState(attempt < 5 && (!verify || verify.status !== 'completed'), 'release_verification_job_incomplete');
      await this.wait(2000);
    }
  }

  async assertPreparedHandover(target, options) {
    await this.assertCheckedRelease(target,options);
    const [run,jobs] = await Promise.all([this.request('actions/runs/' + this.runId),this.request('actions/runs/' + this.runId + '/jobs?filter=latest&per_page=100')]);
    const verify = jobs.jobs?.find(job => job.name === 'verify');
    requireState(run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' && verify?.steps?.some(step => step.name === 'Validate artifact-only handover preparation' && step.status === 'completed' && step.conclusion === 'success') && jobs.jobs?.some(job => job.name === 'deploy' && job.status === 'completed' && job.conclusion === 'skipped'), 'handover_preparation_run_required');
  }
  async probeCheckpoint(target) {
    const summary = JSON.stringify({ schema: 1, kind: 'transport-only', target, activatesProcessing: false });
    const created = await this.request('check-runs', { name: 'cloudflare-release-journal-probe', head_sha: target, status: 'in_progress', output: { title: 'Verify remote checkpoint storage', summary } });
    requireState(Number.isSafeInteger(created.id), 'release_checkpoint_unacknowledged');
    const read = await this.request('check-runs/' + created.id);
    requireState(read.head_sha === target && read.output?.summary === summary, 'release_checkpoint_unacknowledged');
    await this.request('check-runs/' + created.id, { status: 'completed', conclusion: 'neutral', output: { title: 'Remote checkpoint storage verified; no processing activated', summary } }, 'PATCH');
  }
}

/** GitHub acknowledges the whole sanitized plan/journal before the coordinator
 * may mutate a provider. This survives runner loss; local artifacts are backup. */
export class ReleaseJournal {
  constructor(github, plan, id = null) { Object.assign(this, { github, plan, id }); }
  async save(journal) {
    const complete = journal.phase === 'complete';
    const data = { name: checkName, external_id: this.plan.digest, status: complete ? 'completed' : 'in_progress', ...(complete ? { conclusion: 'success', completed_at: new Date().toISOString() } : {}), output: { title: 'Cloudflare release: ' + journal.phase, summary: JSON.stringify({ schema: 1, plan: this.plan, journal }) } };
    const result = this.id ? await this.github.request('check-runs/' + this.id, data, 'PATCH') : await this.github.request('check-runs', { ...data, head_sha: this.plan.target });
    requireState(Number.isSafeInteger(result.id) && result.id > 0 && result.head_sha === this.plan.target && result.external_id === this.plan.digest && result.name === checkName && result.output?.summary === data.output.summary, 'release_checkpoint_unacknowledged');
    const read = await this.github.request('check-runs/' + result.id);
    requireState(read.head_sha === this.plan.target && read.external_id === this.plan.digest && read.output?.summary === data.output.summary, 'release_checkpoint_unacknowledged');
    this.id = result.id;
  }
  static async restore(github, id, artifact) {
    requireState(/^\d+$/.test(String(id)), 'invalid_release_checkpoint');
    const result = await github.request('check-runs/' + id);
    requireState(result.name === checkName && result.app?.slug === 'github-actions' && result.head_sha === artifact.release, 'release_checkpoint_changed');
    let data; try { data = JSON.parse(result.output.summary); } catch { throw new ReleaseError('release_checkpoint_changed'); }
    requireState(data.schema === 1 && data.plan?.target === artifact.release && result.external_id === data.plan.digest && ['web', 'jobs', 'sourceWorker', 'sourceContainer'].every(kind => data.plan.artifactHashes?.[kind] === artifact.hashes[kind]), 'release_checkpoint_changed');
    return { plan: data.plan, prior: data.journal, remote: new ReleaseJournal(github, data.plan, Number(id)) };
  }
}
