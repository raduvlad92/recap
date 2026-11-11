import type { KeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import { createKeywordLearningHandler, parseKeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import { database } from '../netlify/functions/_shared/admin-data';
import { CollectionError } from '../netlify/functions/_shared/security';
import { normalizeInstagramProviderContent } from '../netlify/functions/_shared/provider-content';
import hourly from '../netlify/functions/hourly-collection-worker.mts';
import social from '../netlify/functions/social-collection-worker.mts';
import { assertActive, bindingEnv, hostingRpc, readControl, runWithBindings, type Bindings } from './runtime';
import type { PipelineCapability, PipelineServices } from './pipeline-contract';

const denied = (): never => { throw new CollectionError(503, 'pipeline_capability_changed', 'The private processing stage is paused or changed.'); };
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export async function assertPipelineCapability(bindings: Bindings, capability: PipelineCapability, stage: 'collection' | 'enrichment' | 'generation' | 'verification'): Promise<void> {
  if (!capability || Object.keys(capability).some(key => !['key','token','epoch','release','revision','messageId'].includes(key))
    || typeof capability.key !== 'string' || !/^[a-z0-9:-]{1,180}$/.test(capability.key) || !uuid(capability.token) || !uuid(capability.revision)
    || !Number.isSafeInteger(capability.epoch) || capability.epoch < 1 || !/^[a-f0-9]{40}$/.test(capability.release)
    || capability.release !== bindings.RELEASE_SHA || capability.messageId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(capability.messageId)) denied();
  assertActive(bindings, await readControl(bindings));
  const valid = await hostingRpc<boolean>(bindings, 'pipeline_service_capability', {
    p_key: capability.key, p_token: capability.token, p_epoch: capability.epoch, p_release: capability.release,
    p_revision: capability.revision, p_stage: stage, p_message_id: capability.messageId,
  });
  if (valid !== true) denied();
}
const scoped = (bindings: Bindings, services: PipelineServices, capability: PipelineCapability): Bindings => ({ ...bindings, pipeline: { services, capability } });
export async function runCollectionStage(bindings: Bindings, services: PipelineServices, capability: PipelineCapability, kind: 'hourly-collection' | 'social-collection'): Promise<Response> {
  if (!['hourly-collection','social-collection'].includes(kind)) denied();
  await assertPipelineCapability(bindings, capability, 'collection');
  const secret = bindingEnv(bindings)('HOURLY_COLLECTION_WORKER_SECRET');
  if (!secret || secret.length < 32 || secret.length > 256) denied();
  // Invoke the domain handler directly in this stage, never the queue again.
  return runWithBindings(scoped(bindings, services, capability), () => (kind === 'hourly-collection' ? hourly : social)(new Request(bindings.APP_URL + '/.netlify/functions/' + kind + '-worker', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hourly-collection-secret': secret! }, body: '{}',
  })));
}
export async function runEnrichmentStage(bindings: Bindings, capability: PipelineCapability, raw: unknown, actorRef: string) {
  await assertPipelineCapability(bindings, capability, 'enrichment');
  // Bounded one-record payload. Provider identity and collection provenance are
  // still checked by the collection job and frozen adapter, not this RPC body.
  if (typeof actorRef !== 'string' || actorRef.length > 160 || JSON.stringify(raw)?.length > 2 * 1024 * 1024) denied();
  return normalizeInstagramProviderContent(raw, actorRef);
}
export async function runAnalysisStage(bindings: Bindings, capability: PipelineCapability, input: KeywordLearningInput, stage: 'generation' | 'verification'): Promise<Response> {
  await assertPipelineCapability(bindings, capability, stage);
  const parsed = parseKeywordLearningInput(input);
  if (parsed.action !== 'generate' || (parsed.request.role === 'checker') !== (stage === 'verification')) denied();
  const env = bindingEnv(bindings), secret = env('CONTENT_ANALYSIS_WORKER_SECRET');
  if (!secret || secret.length < 32 || secret.length > 256) denied();
  // The unchanged finite-session handler stores/reserves the SAME exact
  // request before inference. A lost RPC response must resume its stored key,
  // not purchase another call. It never invokes HostRuntime.analysis.
  return runWithBindings(bindings, () => createKeywordLearningHandler({ env, db: () => database(env) }, { generateOnly: true, generationTimeoutMs: 120000 })(new Request(bindings.APP_URL + '/.netlify/functions/keyword-learning-worker', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-content-analysis-secret': secret! }, body: JSON.stringify(parsed),
  })));
}
