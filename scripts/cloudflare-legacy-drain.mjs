import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ReleaseError } from './cloudflare-release-state.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = (value, code) => { if (!value) throw new ReleaseError(code); };
const terminal = new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const contract = JSON.parse(readFileSync(new URL('../cloudflare/verified-legacy-runtime.json',import.meta.url),'utf8'));
export const legacyQuietWindowSeconds = contract.quietWindowSeconds;
export const legacyBoundedRelease = contract.commit;
/** Execution drain assessment, separate from financial settlement/quality.
 * Old unknown records remain unchanged. Missing references are never retried. */
export function assessLegacyDrain({ legacy, summary, runs, oldDatabaseStatus, now = Date.now() }) {
  const blockers = [];
  if (legacy.publishedRelease !== contract.commit) blockers.push('legacy_timeout_contract_unverified');
  if (!legacy.buildsStopped || !(legacy.disabled || oldDatabaseStatus === 401)) blockers.push('legacy_admission_not_stopped');
  check(summary && Number.isSafeInteger(summary.live_leases) && summary.live_leases >= 0 && Number.isSafeInteger(summary.unreferenced_jobs) && summary.unreferenced_jobs >= 0, 'legacy_drain_summary_invalid');
  if (summary.live_leases) blockers.push('legacy_live_leases');
  const latest = summary.latest_activity === null ? null : Date.parse(summary.latest_activity);
  if ((summary.unreferenced_jobs > 0 && latest === null) || (latest !== null && (!Number.isFinite(latest) || latest > now - legacyQuietWindowSeconds * 1000))) blockers.push('legacy_quiet_window_pending');
  check(Array.isArray(runs) && runs.length <= 20 && runs.every(run => /^[a-f0-9]{64}$/.test(run.runHash) && typeof run.status === 'string' && run.actorIdentityVerified === true), 'legacy_run_receipt_invalid');
  if (runs.some(run => !terminal.has(run.status) || !run.finishedAt || !Number.isFinite(Date.parse(run.finishedAt)) || Date.parse(run.finishedAt) > now + 5 * 60 * 1000)) blockers.push('legacy_provider_still_active_or_unknown');
  const receipt = { scope:'legacy-execution-drain-assessment', site:legacy.site, publishedRelease:legacy.publishedRelease, timeoutContractDigest:hash(contract), quietWindowSeconds:legacyQuietWindowSeconds,
    legacyAdmissionStopped:legacy.buildsStopped && (legacy.disabled || oldDatabaseStatus === 401), liveLeases:summary.live_leases,
    latestLegacyActivity:summary.latest_activity, unreferencedCollectionJobRows:summary.unreferenced_jobs,
    unreferencedAssessment:'retained-uncertainty-older-than-quiet-window-with-disabled-or-fenced-host',
    knownDistinctRuns:runs.length, runs, allKnownRunsTerminal:runs.every(run=>terminal.has(run.status)),
    oldFinancialHoldsAndRecordsPreserved:true, billingSettled:false, sourceCoverageOrQualityProven:false, newRunsStarted:0, blockers };
  return {verified:blockers.length===0,digest:hash(receipt),...receipt};
}
