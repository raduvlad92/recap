import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkedArtifact, ReleasePlatform } from './cloudflare-release-platform.mjs';
import { ReleaseGitHub } from './cloudflare-release-github.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';

try {
  if (process.argv.slice(2).length || process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'raduvlad92/recap' || process.env.GITHUB_REF !== 'refs/heads/main') throw new ReleaseError('release_ci_context_required');
  const root = fileURLToPath(new URL('../', import.meta.url)), artifact = checkedArtifact(root);
  if (artifact.release !== process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== artifact.release) throw new ReleaseError('release_checked_head_changed');
  const github = new ReleaseGitHub({ token: process.env.GITHUB_TOKEN, runId: process.env.GITHUB_RUN_ID }); await github.assertCheckedRelease(artifact.release);
  const platform = new ReleasePlatform({ root, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  const current = await platform.current('web');
  const active = process.env.HOSTING_TARGET === 'cloudflare';
  if (active) {
    if (current.mode !== 'active' || artifact.mode !== 'active') throw new ReleaseError('initial_switch_is_separate');
    execFileSync('node', ['scripts/cloudflare-release.mjs'], { cwd: root, env: process.env, stdio: 'inherit' });
  } else {
    if (current.mode !== 'shadow' || artifact.mode !== 'shadow' || process.env.RELEASE_CHECKPOINT_ID) throw new ReleaseError('refusing_shadow_over_active_release');
    await github.probeCheckpoint(artifact.release);
    execFileSync('node', ['scripts/cloudflare-deploy.mjs'], { cwd: root, env: process.env, stdio: 'inherit' });
  }
} catch (error) { console.error(JSON.stringify({ error: error instanceof ReleaseError ? error.code : 'main_deployment_failed' })); process.exitCode = 1; }
