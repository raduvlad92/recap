import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkedArtifact, ReleasePlatform } from './cloudflare-release-platform.mjs';
import { planHandover } from './cloudflare-handover-state.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HandoverNative } from './cloudflare-handover-native.mjs';
import { reminderValidator } from './cloudflare-secret-continuity.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';
// Deliberately read-only. No caller-supplied proof/policy or apply switch.
try {
  if (process.argv.slice(2).length) throw new ReleaseError('handover_plan_is_read_only');
  const root = fileURLToPath(new URL('../', import.meta.url)), artifact = checkedArtifact(root);
  const platform = new ReleasePlatform({ root, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, databaseKey: process.env.SUPABASE_SECRET_KEY });
  const snapshot = await platform.snapshot(artifact);
  const options = {}, nativeReceipts = {};
  const nativeConfigured = ['NETLIFY_AUTH_TOKEN','SUPABASE_MANAGEMENT_TOKEN','NETLIFY_DATABASE_KEY','CONTENT_ANALYSIS_WORKER_SECRET'].every(name => !!process.env[name]);
  if (nativeConfigured) {
    const native = new HandoverNative({platform,netlifyToken:process.env.NETLIFY_AUTH_TOKEN,managementToken:process.env.SUPABASE_MANAGEMENT_TOKEN,oldKey:process.env.NETLIFY_DATABASE_KEY,oldKeyId:process.env.NETLIFY_DATABASE_KEY_ID});
    nativeReceipts.fenceReadiness = await native.readFenceReadiness();
    nativeReceipts.preservation = await native.verifyPreservation(JSON.parse(readFileSync(join(root,'.local/cloudflare-preflight/db-before.json'),'utf8')));
    nativeReceipts.secretContinuity = await native.verifySecretContinuity(process.env.CONTENT_ANALYSIS_WORKER_SECRET,await reminderValidator(root));
    if (process.env.APIFY_API_TOKEN) nativeReceipts.legacyDrain = await native.readLegacyDrain(process.env.APIFY_API_TOKEN);
    snapshot.evidence = Object.fromEntries(Object.entries(nativeReceipts).map(([name,receipt]) => [name,{verified:receipt.verified,release:artifact.release,digest:receipt.digest}]));
    options.policy = nativeReceipts.fenceReadiness.legacy.policy;
    // Preserve the audited pre-migration scheduled-processing policy. Manual
    // keyword access alone does not request automatic resumption.
    options.resumeProcessing = ['HOURLY_COLLECTION_ENABLED','CONTENT_ANALYSIS_ENABLED','AUTOMATIC_CONTENT_ENABLED','SOCIAL_COLLECTION_ENABLED','SOCIAL_CONTENT_ENABLED','DAILY_BRIEFING_ENABLED'].some(name=>options.policy[name]==='true');
  }
  // Live private/browser parity, legacy drain and a usable recovery artifact
  // remain independently required; no caller-supplied receipt can bypass them.
  const plan = planHandover(artifact, snapshot, options);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ recorded_at: new Date().toISOString(), read_only: true, repository_head: head, artifact_matches_head: artifact.release === head, ready_for_handover: plan.blockers.length === 0 && artifact.release === head, live_apply_entrypoint_available: false, native_readiness_adapters_configured: nativeConfigured, native_receipts: nativeReceipts, plan }, null, 2));
} catch (error) { console.error(JSON.stringify({ read_only: true, error: error instanceof ReleaseError ? error.code : 'handover_preflight_unavailable' })); process.exitCode = 1; }
