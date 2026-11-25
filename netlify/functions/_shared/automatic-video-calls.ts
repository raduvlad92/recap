import { createHash } from 'node:crypto';
import { AnalysisError, type GenerationRequest, type GenerationResult } from './content-analysis-model';
import type { KeywordLearningInput } from './keyword-learning';
import { canonicalKeywordProductionJson } from './keyword-production-handler';

import { VIDEO_CALL_PREFIX } from './content-analysis-runtime';
export type VideoGeneration = (input: KeywordLearningInput) => Promise<GenerationResult>;
type OutputFailure = NonNullable<GenerationResult['validationError']>;
type VideoScope = Pick<KeywordLearningInput, 'sessionId' | 'sourceOrdinal' | 'sourceHash'>;

export function bindVideoCall(scope: VideoScope, stage: string, model: string, request: GenerationRequest): KeywordLearningInput {
 const originalKey = VIDEO_CALL_PREFIX + stage;
 const key = createHash('sha256').update(canonicalKeywordProductionJson({
  sessionId: scope.sessionId, sourceOrdinal: scope.sourceOrdinal, sourceHash: scope.sourceHash,
  originalKey, model, request: { ...request, key: originalKey },
 })).digest('hex');
 return { action: 'generate', sessionId: scope.sessionId, sourceOrdinal: scope.sourceOrdinal, sourceHash: scope.sourceHash,
  model, originalKey, request: { ...request, key: 'keyword-learning:v1:' + key } };
}

export class SettledVideoOutputError extends AnalysisError {
 constructor(public readonly failed: KeywordLearningInput, public readonly failure: OutputFailure) { super(failure); }
}

export function videoRecovery(base: SettledVideoOutputError, input: KeywordLearningInput, stage: string, request = input.request) {
 return bindVideoCall(input, stage, input.model, {
  ...request, correction: { baseKey: base.failed.request.key, errorCode: base.failure },
 });
}

/** The caller only returns materialized output after verifying the durable
 * settlement. The same prompts yield the same keys on worker continuation. */
export async function runVideoCall(input: KeywordLearningInput, run: VideoGeneration): Promise<GenerationResult> {
 const attempt = async (request: KeywordLearningInput) => {
  const result = await run(request);
  if (typeof result.actualUsd !== 'number' || !Number.isFinite(result.actualUsd) || result.actualUsd < 0) {
   throw new AnalysisError('analysis_unknown_charge_hold');
  }
  if (!result.providerId) throw new AnalysisError('automatic_content_receipt_missing');
  if (result.validationError) throw new SettledVideoOutputError(request, result.validationError);
  return result;
 };
 try { return await attempt(input); }
 catch (error) {
  if (!(error instanceof SettledVideoOutputError) || error.failure !== 'analysis_invalid_json') throw error;
  // One attempt at the same size and spend ceiling. Never feed malformed
  // model output back as instructions or turn a network error into a retry.
  return attempt(videoRecovery(error, input, input.originalKey!.slice(VIDEO_CALL_PREFIX.length) + ':json', {
   ...input.request, system: input.request.system + ' Return one complete, syntactically valid JSON object conforming to the supplied schema. Escape quotes and control characters inside strings.',
  }));
 }
}
