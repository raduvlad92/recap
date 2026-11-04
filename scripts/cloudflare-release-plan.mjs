import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRelease, ReleaseError } from './cloudflare-release-state.mjs';
import { checkedArtifact, ReleasePlatform } from './cloudflare-release-platform.mjs';
// Read-only: no deployment, checkpoint write or ownership transition.
try {
  if (process.argv.slice(2).length) throw new ReleaseError('release_plan_is_read_only');
  const root = fileURLToPath(new URL('../', import.meta.url)), artifact = checkedArtifact(root);
  const platform = new ReleasePlatform({ root, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, databaseKey: process.env.SUPABASE_SECRET_KEY });
  const plan = planRelease(artifact, await platform.snapshot(artifact));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ recorded_at: new Date().toISOString(), read_only: true, repository_head: head, artifact_matches_head: artifact.release === head, ready_for_release: plan.blockers.length === 0 && artifact.release === head, plan }, null, 2));
} catch (error) { console.error(JSON.stringify({ read_only: true, error: error instanceof ReleaseError ? error.code : 'release_preflight_unavailable' })); process.exitCode = 1; }
