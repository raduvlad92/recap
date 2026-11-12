import type { KeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import type { normalizeInstagramProviderContent } from '../netlify/functions/_shared/provider-content';
import type { ObservedFormatEvidence } from '../netlify/functions/_shared/youtube-format-provider';

/** Only the existing native queue coordinator creates this capability after
 * its frame claim. Every private call rechecks it against native SQL state. */
export interface PipelineCapability {
  key: string; token: string; epoch: number; release: string; revision: string; messageId: string | null;
}
export interface PipelineServices {
  CollectionService: { run(capability: PipelineCapability, kind: 'hourly-collection' | 'social-collection'): Promise<Response> };
  EnrichmentService: {
    instagram(capability: PipelineCapability, raw: unknown, actorRef: string): Promise<ReturnType<typeof normalizeInstagramProviderContent>>;
    youtubeFormat(capability: PipelineCapability, intentId: string, run: unknown, rows: unknown): Promise<ObservedFormatEvidence>;
  };
  GenerationService: { generate(capability: PipelineCapability, input: KeywordLearningInput): Promise<Response> };
  VerificationService: { generate(capability: PipelineCapability, input: KeywordLearningInput): Promise<Response> };
}
export function pipelineServices(value: unknown): value is PipelineServices {
  if (!value || typeof value !== 'object') return false;
  const services = value as PipelineServices;
  return typeof services.CollectionService?.run === 'function' && typeof services.EnrichmentService?.instagram === 'function' && typeof services.EnrichmentService?.youtubeFormat === 'function'
    && typeof services.GenerationService?.generate === 'function' && typeof services.VerificationService?.generate === 'function';
}
