import type { SourceUpdate } from '../../../src/lib/types';
import { AnalysisError, type GenerationRequest } from './content-analysis-model';
import type { KeywordLearningInput } from './keyword-learning';
import { bindVideoCall, runVideoCall, SettledVideoOutputError, videoRecovery, type VideoGeneration } from './automatic-video-calls';
import { planKeywordProductionChunks, keywordProductionExtractionCalls, keywordProductionCheckerCall, finalizeKeywordProductionChunk,
 mergeKeywordProductionChunks, videoKeywordCandidateCount, videoKeywordBatchVerdicts } from './keyword-production';

const profile = 'context-roles-v2';
const batchSize = 32;

function inventoryRequest(request: GenerationRequest, names: number, uncertain: number): GenerationRequest {
 const schema = request.schema as { properties: Record<'names' | 'uncertainNames', Record<string, unknown>> };
 const marker = '\nTRANSCRIPT DATA\n', at = request.prompt.lastIndexOf(marker);
 const instructions = request.prompt.slice(0, at)
  .replace('build a complete literal name inventory', 'identify useful literal names')
  .replace('Find EVERY explicitly named identity', 'Find the most specific useful named identities')
  .replace('Include a name even if it appears once. No importance, frequency or top-N filter.', 'Include a name that appears once when it helps describe the video.')
  .replace('Return all names, without truncation.', 'Prioritize names by relevance to what the creator discusses.');
 return { ...request, prompt: instructions + '\nReturn at most ' + names + ' names and ' + uncertain + ' uncertainNames.' + request.prompt.slice(at),
  schema: { ...schema, properties: {
   names: { ...schema.properties.names, maxItems: names },
   uncertainNames: { ...schema.properties.uncertainNames, maxItems: uncertain },
  } },
 };
}

export async function videoKeywordOutput(record: SourceUpdate, scope: Pick<KeywordLearningInput, 'sessionId' | 'sourceOrdinal' | 'sourceHash'>, run: VideoGeneration) {
 const results = [];
 for (const chunk of planKeywordProductionChunks(record, profile)) {
  const extract = async (step: ReturnType<typeof keywordProductionExtractionCalls>[number]) => {
   const stage = 'keywords:' + step.step + ':' + chunk.index;
   const input = bindVideoCall(scope, stage, step.model, inventoryRequest(step.request, 30, 8));
   let result;
   let names = 30, uncertain = 8;
   try { result = await runVideoCall(input, run); }
   catch (error) {
    if (!(error instanceof SettledVideoOutputError) || error.failure !== 'analysis_output_capacity') throw error;
    names = 12; uncertain = 4;
    result = await runVideoCall(videoRecovery(error, input, stage + ':small', inventoryRequest(step.request, names, uncertain)), run);
   }
   const value = result.value as { names?: unknown; uncertainNames?: unknown } | null;
   if (!Array.isArray(value?.names) || value.names.length > names || !Array.isArray(value.uncertainNames) || value.uncertainNames.length > uncertain) {
    throw new AnalysisError('automatic_keyword_invalid_result');
   }
   return value;
  };
  const [directCall, roleCall] = keywordProductionExtractionCalls(record, chunk, undefined, profile);
  const values = { direct: await extract(directCall), type_sweep: await extract(roleCall) };
  const count = videoKeywordCandidateCount(chunk, values);
  const verify = async (start: number, size: number, parent?: SettledVideoOutputError): Promise<number[][]> => {
   const batch = keywordProductionCheckerCall(record, chunk, values, 'standard', undefined, profile, { start, size });
   const stage = 'keywords:check:' + chunk.index + ':' + start + ':' + size;
   const input = bindVideoCall(scope, stage, batch.model, batch.request);
   try {
    const result = await runVideoCall(parent ? videoRecovery(parent, input, stage) : input, run);
    return videoKeywordBatchVerdicts(result.value, size, start);
   } catch (error) {
    if (!(error instanceof SettledVideoOutputError) || error.failure !== 'analysis_output_capacity' || parent || size < 2) throw error;
    const half = Math.ceil(size / 2);
    return [...await verify(start, half, error), ...await verify(start + half, size - half, error)];
   }
  };
  const verdicts = [];
  for (let start = 0; start < count; start += batchSize) {
   verdicts.push(...await verify(start, Math.min(batchSize, count - start)));
  }
  results.push(finalizeKeywordProductionChunk(record, chunk, { ...values, checker: { readComplete: true, verdicts, missingNames: [] } }, 'standard', undefined, profile));
 }
 return mergeKeywordProductionChunks(record, results, profile);
}
