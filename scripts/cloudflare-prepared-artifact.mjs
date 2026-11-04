import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runtimeDigest } from './cloudflare-source-runtime.mjs';
import { ReleaseError } from './cloudflare-release-state.mjs';
const check = (value,code) => { if (!value) throw new ReleaseError(code); };
/** Bind local checked files to the immutable archive from the exact successful
 * main preparation run. No archive extraction, deployment or credential write. */
export class PreparedHandoverArtifact {
  constructor({ github,artifactId,archivePath,historical = false,manifestReader }) {
    check(github && Number.isSafeInteger(artifactId) && artifactId > 0 && typeof archivePath === 'string', 'handover_archive_unconfigured');
    Object.assign(this,{ github,artifactId,archivePath,historical });
    this.manifestReader = manifestReader || (path => execFileSync('unzip',['-p',path,'.local/cloudflare-build/release.json'],{ encoding: 'utf8',maxBuffer: 1024 * 1024,stdio: ['ignore','pipe','pipe'] }));
  }
  async assert(artifact) {
    check(artifact?.mode === 'active' && /^[a-f0-9]{40}$/.test(artifact.release) && /^[a-f0-9]{64}$/.test(artifact.configs?.sourceRuntime), 'handover_active_archive_required');
    const preparation = await this.github.assertPreparedHandover(artifact.release,{ currentMain: !this.historical });
    check(preparation?.activeArtifactDeploymentSkipped === true && ['manual-artifact-only','isolated-main-job'].includes(preparation.preparationKind),'handover_preparation_run_required');
    const metadata = await this.github.request('actions/artifacts/' + this.artifactId);
    check(metadata.id === this.artifactId && metadata.name === preparation.artifactName && metadata.expired === false && metadata.workflow_run?.id === Number(this.github.runId) && metadata.workflow_run?.head_sha === artifact.release && metadata.workflow_run?.head_branch === 'main' && /^sha256:[a-f0-9]{64}$/.test(metadata.digest), 'handover_archive_identity_changed');
    const bytes = readFileSync(this.archivePath);
    check(bytes.length > 0 && bytes.length <= 100 * 1024 * 1024 && 'sha256:' + createHash('sha256').update(bytes).digest('hex') === metadata.digest, 'handover_archive_digest_changed');
    let remote;try { remote = JSON.parse(this.manifestReader(this.archivePath)); } catch { throw new ReleaseError('handover_archive_manifest_changed'); }
    check(runtimeDigest(remote) === runtimeDigest(artifact), 'handover_archive_manifest_changed');
    return { verified: true,runId: Number(this.github.runId),artifactId: metadata.id,release: artifact.release,archiveDigest: metadata.digest,artifactDigest: runtimeDigest(artifact),deploymentSkipped: true,preparationKind: preparation.preparationKind,historicalReadOnly: this.historical };
  }
}
