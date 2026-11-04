import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkedArtifact, ReleasePlatform } from './cloudflare-release-platform.mjs';
import { planHandover } from './cloudflare-handover-state.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';
// Deliberately read-only. No caller-supplied proof/policy or apply switch.
try {
  if (process.argv.slice(2).length) throw new ReleaseError('handover_plan_is_read_only');
  const root = fileURLToPath(new URL('../', import.meta.url)), artifact = checkedArtifact(root);
  const platform = new ReleasePlatform({ root, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, databaseKey: process.env.SUPABASE_SECRET_KEY });
  const snapshot = await platform.snapshot(artifact);
  // Native parity/fence/legacy-policy adapters are still pending. Existing
  // release-specific evidence cannot be relabeled as a new handover receipt.
  const plan = planHandover(artifact, snapshot);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ recorded_at: new Date().toISOString(), read_only: true, repository_head: head, artifact_matches_head: artifact.release === head, ready_for_handover: plan.blockers.length === 0 && artifact.release === head, live_apply_entrypoint_available: false, plan }, null, 2));
} catch (error) { console.error(JSON.stringify({ read_only: true, error: error instanceof ReleaseError ? error.code : 'handover_preflight_unavailable' })); process.exitCode = 1; }
