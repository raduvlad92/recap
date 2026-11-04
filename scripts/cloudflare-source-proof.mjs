export function canReuseSource(artifact, proof, live) {
  return !!(proof?.schema === 1 && proof.hostedChecks === 10
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(proof.version || '')
    && /^[a-f0-9]{64}$/.test(proof.image || '')
    && proof.workerHash === artifact?.hashes?.sourceWorker
    && proof.containerHash === artifact?.hashes?.sourceContainer
    && live?.version === proof.version && live.image === proof.image
    && live.publicRoute === false && live.hasSecrets === false
    && live.maximumInstances === 1 && live.enabled === false);
}
