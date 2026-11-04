import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { planRelease, runRelease, ReleaseError } from './cloudflare-release-state.mjs';
import { ReleasePlatform, checkedArtifact } from './cloudflare-release-platform.mjs';
import { ReleaseGitHub, ReleaseJournal } from './cloudflare-release-github.mjs';

// Normal active releases only. Initial switch/retirement have no entrypoint.
try {
  if (process.argv.slice(2).length || process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'raduvlad92/recap' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.HOSTING_TARGET !== 'cloudflare') throw new ReleaseError('release_ci_context_required');
  const root = fileURLToPath(new URL('../', import.meta.url)), artifact = checkedArtifact(root);
  if (artifact.mode !== 'active' || artifact.release !== process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== artifact.release) throw new ReleaseError('release_active_checked_artifact_required');
  const github = new ReleaseGitHub({ token: process.env.GITHUB_TOKEN, runId: process.env.GITHUB_RUN_ID });
  await github.assertCheckedRelease(artifact.release);
  const platform = new ReleasePlatform({ root, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, databaseKey: process.env.SUPABASE_SECRET_KEY });
  let plan, prior = null, remote;
  if (process.env.RELEASE_CHECKPOINT_ID) ({ plan, prior, remote } = await ReleaseJournal.restore(github, process.env.RELEASE_CHECKPOINT_ID, artifact));
  else { plan = planRelease(artifact, await platform.snapshot(artifact)); remote = new ReleaseJournal(github, plan); }
  const directory = join(root, '.local/cloudflare-release'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  let latest = prior;
  const save = async journal => {
    await remote.save(journal); latest = journal;
    const temp = join(directory, 'checkpoint.tmp'), file = join(directory, 'checkpoint.json');
    const fd = openSync(temp, 'w', 0o600); try { writeFileSync(fd, JSON.stringify({ schema: 1, checkRunId: remote.id, plan, journal }, null, 2)); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, file);
  };
  const assertNoWorkerDrift = async () => {
    for (const kind of ['jobs', 'web']) {
      const current = await platform.current(kind);
      if (![plan.priorVersions[kind], latest?.versions?.[kind]].includes(current.version)) throw new ReleaseError('release_worker_drift');
    }
  };
  const mutateControl = (expected, release, resume, revision, nonce) => platform.rpc('advance_hosting_release_checked', { p_expected_epoch: expected.epoch, p_expected_release: expected.release, p_expected_revision: revision, p_release: release, p_resume: resume, p_next_revision: nonce });
  const api = {
    assertCheckedRelease: async target => { await github.assertCheckedRelease(target); checkedArtifact(root); await platform.assertSource(plan, artifact); await assertNoWorkerDrift(); },
    preflight: () => platform.preflight(plan, artifact),
    status: () => platform.status(),
    quiesce: (expected, nonce) => platform.rpc('quiesce_hosting_release_checked', { p_expected_epoch: expected.epoch, p_expected_release: expected.release, p_expected_revision: expected.revision, p_next_revision: nonce }),
    upload: async () => { const versions = {}; for (const kind of ['jobs', 'web']) versions[kind] = await platform.uploadVersion(kind, artifact, plan.policy, 'active', plan.bindings[kind], plan.digest); return versions; },
    transfer: (expected, target, revision, nonce) => mutateControl(expected, target, false, revision, nonce),
    promote: async versions => { for (const kind of ['jobs', 'web']) { await github.assertCheckedRelease(artifact.release); await platform.assertSource(plan, artifact); await platform.promoteVersion(kind, versions[kind], [plan.priorVersions[kind]]); } },
    verify: (_plan, versions) => platform.verify(plan, artifact, versions),
    resume: (expected, revision, nonce) => mutateControl(expected, plan.target, true, revision, nonce),
  };
  const result = await runRelease(plan, api, save, prior);
  console.log(JSON.stringify({ event: 'cloudflare_release_complete', release: plan.target, checkRunId: remote.id, phase: result.phase, processingPaused: plan.expected.paused }));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof ReleaseError ? error.code : 'release_operation_uncertain' })); process.exitCode = 1;
}
