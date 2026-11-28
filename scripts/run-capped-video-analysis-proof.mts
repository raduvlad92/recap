import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database } from '../netlify/functions/_shared/admin-data';
import { createAutomaticLearningCaller, generateAutomaticContent, type AutomaticContentClaim } from '../netlify/functions/_shared/automatic-content';
import { AnalysisError } from '../netlify/functions/_shared/content-analysis-model';
import { publicHttpsUrl, runtimeEnv } from '../netlify/functions/_shared/security';

type ProofReceipt = {
  id: string;
  release: string;
  manifestSha256: string;
  authorizedAt: string | null;
  closedAt: string | null;
  unresolved: number;
  targets: Array<{ state: string }>;
};
type ProofClaim = (AutomaticContentClaim & { claimed: true; task: { lease_until: string } }) | { claimed: false; reason: string };

interface ProofRun {
  id: string;
  manifest: string;
  release: string;
}
interface ProofDependencies {
  db: Pick<ReturnType<typeof database>, 'rpc'>;
  call: ReturnType<typeof createAutomaticLearningCaller>;
  now: () => number;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RELEASE = /^[a-f0-9]{40}$/;

export async function runCappedVideoAnalysisProof(run: ProofRun, deps: ProofDependencies) {
  const scope = { p_id: run.id, p_manifest: run.manifest };
  const rpc = async <T,>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await deps.db.rpc(name, args);
    if (error) throw new Error(name + ' failed (' + (error.code || 'unconfirmed') + '). Read the proof receipt before taking another action.');
    return data as T;
  };
  const read = () => rpc<ProofReceipt | null>('read_video_analysis_proof', scope);
  const proof = await read();
  if (!proof || proof.id !== run.id || proof.release !== run.release || proof.manifestSha256 !== run.manifest ||
    !proof.authorizedAt || proof.closedAt || proof.unresolved || proof.targets.some(target => target.state === 'running')) {
    throw new Error('An authorized, open proof with no unresolved call or active task is required.');
  }
  let stop: string | undefined;
  for (let index = 0; index < proof.targets.length; index++) {
    const claim = await rpc<ProofClaim>('claim_video_analysis_proof_task', scope);
    if (claim.claimed !== true) {
      stop = claim.reason;
      break;
    }
    const deadline = Date.parse(claim.task.lease_until);
    if (!Number.isFinite(deadline)) throw new Error('Proof task lease could not be confirmed.');
    let result = null;
    let code: string | null = null;
    try {
      result = await generateAutomaticContent(claim, deps.call, () => {
        if (deps.now() + 130_000 >= deadline) throw new AnalysisError('video_proof_task_deadline');
      });
    } catch (error) {
      code = error instanceof AnalysisError ? error.code : 'video_proof_unconfirmed';
    }
    const saved = await rpc<{ state: string; errorCode?: string }>('finish_automatic_content_task', {
      p_task_id: claim.task.id, p_lease_token: claim.leaseToken, p_result: result,
      p_error_code: code === 'provider_monthly_budget_exhausted' ? 'analysis_budget_exhausted' : code,
    });
    if (saved.state !== 'review' || code) {
      stop = code ?? saved.errorCode ?? 'video_proof_task_incomplete';
      break;
    }
  }
  // Close after all tasks or a known stop. A failed RPC above is ambiguous and
  // leaves the wave for a receipt read. Replaying it can never admit a new call
  // while the original task or its charge is still in progress.
  const receipt = await rpc<ProofReceipt>('close_video_analysis_proof', scope);
  return { stop: stop ?? 'video_proof_complete', receipt };
}

async function main() {
  const [action, id, manifest, release, ...extra] = process.argv.slice(2);
  if (action !== '--launch-authorized-proof' || !UUID.test(id ?? '') || !DIGEST.test(manifest ?? '') ||
    !RELEASE.test(release ?? '') || extra.length) {
    throw new Error('Usage: run-capped-video-analysis-proof --launch-authorized-proof <proof UUID> <manifest SHA256> <accepted release SHA>');
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== release || execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
    throw new Error('Run from the clean, accepted release checkout.');
  }
  const secret = runtimeEnv('CONTENT_ANALYSIS_WORKER_SECRET') ?? '';
  publicHttpsUrl(runtimeEnv('APP_URL'));
  if (secret.length < 32 || secret.length > 256 || !runtimeEnv('OPENROUTER_API_KEY')?.trim()) {
    throw new Error('The existing private analysis credentials are required.');
  }
  const db = database(runtimeEnv);
  const result = await runCappedVideoAnalysisProof({ id, manifest, release }, {
    db, call: createAutomaticLearningCaller(runtimeEnv, db), now: Date.now,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Video proof state could not be confirmed.');
    process.exitCode = 1;
  });
}
