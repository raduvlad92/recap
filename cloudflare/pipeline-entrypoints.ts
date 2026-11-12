import { WorkerEntrypoint } from 'cloudflare:workers';
import type { KeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import type { Bindings } from './runtime';
import { pipelineServices, type PipelineCapability } from './pipeline-contract';
import { runAnalysisStage, runCollectionStage, runEnrichmentStage, runYouTubeFormatStage } from './pipeline-services';

export class CollectionService extends WorkerEntrypoint<Bindings> {
  async run(capability: PipelineCapability, kind: 'hourly-collection' | 'social-collection') {
    const services = this.ctx.exports;
    if (!pipelineServices(services)) throw new Error('Private pipeline entrypoints are missing');
    return runCollectionStage(this.env, services, capability, kind);
  }
}
export class EnrichmentService extends WorkerEntrypoint<Bindings> {
  instagram(capability: PipelineCapability, raw: unknown, actorRef: string) { return runEnrichmentStage(this.env, capability, raw, actorRef); }
  youtubeFormat(capability: PipelineCapability, intentId: string, run: unknown, rows: unknown) { return runYouTubeFormatStage(this.env, capability, intentId, run, rows); }
}
export class GenerationService extends WorkerEntrypoint<Bindings> {
  generate(capability: PipelineCapability, input: KeywordLearningInput) { return runAnalysisStage(this.env, capability, input, 'generation'); }
}
export class VerificationService extends WorkerEntrypoint<Bindings> {
  generate(capability: PipelineCapability, input: KeywordLearningInput) { return runAnalysisStage(this.env, capability, input, 'verification'); }
}
