import { describe, expect, it } from 'vitest';
import { canReuseSource } from '../scripts/cloudflare-source-proof.mjs';
const artifact = { hashes: { sourceWorker: 'a'.repeat(64), sourceContainer: 'b'.repeat(64) } };
const proof = { schema: 1, hostedChecks: 10, workerHash: artifact.hashes.sourceWorker, containerHash: artifact.hashes.sourceContainer, version: '11111111-1111-4111-8111-111111111111', image: 'c'.repeat(64) };
const live = { version: proof.version, image: proof.image, publicRoute: false, hasSecrets: false, maximumInstances: 1, enabled: false };
describe('verified private source reuse', () => {
  it('reuses only an exact verified artifact and immutable live component', () => { expect(canReuseSource(artifact, proof, live)).toBe(true); });
  it.each([{ version: 'different-version' }, { image: 'd'.repeat(64) }, { publicRoute: true }, { hasSecrets: true }, { maximumInstances: 2 }, { enabled: true }])('rejects live source drift %j', change => { expect(canReuseSource(artifact, proof, { ...live, ...change })).toBe(false); });
  it('requires actual hosted proof and unchanged worker/container bytes', () => {
    expect(canReuseSource(artifact, { ...proof, hostedChecks: 0 }, live)).toBe(false);
    for (const name of ['sourceWorker', 'sourceContainer']) expect(canReuseSource({ hashes: { ...artifact.hashes, [name]: 'e'.repeat(64) } }, proof, live)).toBe(false);
  });
});
