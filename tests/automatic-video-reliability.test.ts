import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceUpdate } from '../src/lib/types';
import { contentHash } from '../src/lib/content-processing';
import { assertAutomaticRecapVerifierCapacity, createAutomaticContentWorker, createAutomaticLearningCaller, generateAutomaticContent, type AutomaticContentClaim } from '../netlify/functions/_shared/automatic-content';
import { analysisLimits, conservativeCallUsd, type GenerationResult } from '../netlify/functions/_shared/content-analysis-model';
import { analysisRuntimeEnv } from '../netlify/functions/_shared/content-analysis-runtime';
import type { KeywordLearningInput } from '../netlify/functions/_shared/keyword-learning';
import * as learning from '../netlify/functions/_shared/keyword-learning';
import type { RecapPoint } from '../netlify/functions/_shared/recap-quality';
import replay from './fixtures/automatic-video-rerun.json';

const env = (name: string) => ({ APP_URL: 'https://example.com', CONTENT_ANALYSIS_WORKER_SECRET: 'f'.repeat(40) })[name];
const checkedUsd = .001;
const primary = 'The casing kept the components cool under a sustained workload.';
const secondary = 'The repair took roughly an hour after the replacement arrived.';
const tail = 'The final trial found the matching bracket reduced vibration.';
const makePoint = (quote: string): RecapPoint => ({ text: quote, evidenceQuote: quote });
const settled = (value: unknown): GenerationResult => ({ value, providerId: 'offline-fixture', actualUsd: checkedUsd, observedUsd: checkedUsd });
type SavedFailure = { value: unknown; validationError: GenerationResult['validationError']; actualUsd: number };
function fromFailure(saved: SavedFailure): GenerationResult {
 return { ...settled(saved.value), validationError: saved.validationError, actualUsd: saved.actualUsd, observedUsd: saved.actualUsd };
}
function claim(content = primary + '\n' + secondary, task: 'keywords' | 'recap' = 'recap'): AutomaticContentClaim {
 const record: SourceUpdate = { id: 'fixture', sourceId: 'test', contributorIds: [], title: 'No title evidence', summary: '',
  url: 'https://example.com/video', publishedAt: '2026-11-25T00:00:00Z', format: 'video', contentKind: 'transcript',
  topics: [], brands: [], sponsors: [], references: [], insights: [], isSample: false, content };
 return { record, leaseToken: 'test', task: { id: 'test', update_id: record.id, user_id: 'test', task, content_hash: contentHash(content), session_id: '12345678-1234-4234-8234-123456789012' } };
}
function verdicts(input: KeywordLearningInput, original: string, assessment = true) {
 const prompt = JSON.parse(input.request.prompt);
 const { text, start } = prompt.sourceContext;
 expect(original.slice(start, start + text.length)).toBe(text);
 return {
  sourceHash: input.sourceHash, readComplete: true,
  verdicts: prompt.findings.map((finding: { index: number; text: string; evidenceSpan: { start: number; end: number; quoteHash: string } }) => {
   const { evidenceSpan, text: findingText } = finding;
   const quote = original.slice(evidenceSpan.start, evidenceSpan.end);
   expect(quote).toBe(text.slice(evidenceSpan.start - start, evidenceSpan.end - start));
   expect(quote).toBeTruthy();
   const status = assessment ? 'entailed' : 'insufficient';
   return { index: finding.index, quoteHash: evidenceSpan.quoteHash, status, wholeClaimSupported: assessment, contextConflict: false,
    reason: 'Fixture evidence judgment.', atoms: [{ start: 0, end: findingText.length, text: findingText, status, supportBasis: 'quote',
     supportingSpans: [{ start: 0, end: quote.length, text: quote }] }] };
  }),
 };
}
function modelResponse(input: KeywordLearningInput, original: string, quotes = [primary, secondary]) {
 const prompt = JSON.parse(input.request.prompt);
 if (prompt.task === 'recap_check') return settled(verdicts(input, original));
 if (prompt.task === 'recap_veto') return settled({ sourceHash: input.sourceHash, readComplete: true, clear: prompt.findings.map(() => true) });
 return settled({ readComplete: true, highlights: quotes.filter(quote => prompt.content.includes(quote)).map(makePoint) });
}
function wire(request: KeywordLearningInput) {
 const limits = analysisLimits(analysisRuntimeEnv(() => undefined, request.model, 1, request.originalKey));
 expect(conservativeCallUsd(request.request, limits)).toBeLessThanOrEqual(.10);
 expect(() => learning.parseKeywordLearningInput(request)).not.toThrow();
 expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(220000);
}

describe('November 25 automatic video replay without paid calls', () => {
 beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw Error('Offline replay attempted network I/O'); })));
 afterEach(() => vi.unstubAllGlobals());
 it('retries malformed, settled JSON once with the same schema and cap, then reuses the exact receipts on continuation', async () => {
  expect(() => JSON.parse(replay.invalidJson.value.rawOutput)).toThrow();
  const source = claim(), cache = new Map<string, GenerationResult>(), paid: KeywordLearningInput[] = [];
  const run = async (input: KeywordLearningInput) => {
   if (cache.has(input.request.key)) return cache.get(input.request.key)!;
   wire(input); paid.push(input);
   const receipt = paid.length === 1 ? fromFailure(replay.invalidJson as SavedFailure) : modelResponse(input, source.record.content!);
   cache.set(input.request.key, receipt); return receipt;
  };
  const result = await generateAutomaticContent(source, run);
  expect(await generateAutomaticContent(source, run)).toEqual(result);
  expect(paid).toHaveLength(3);
  expect(paid[1].request).toMatchObject({ maxOutputTokens: paid[0].request.maxOutputTokens, schema: paid[0].request.schema,
   correction: { baseKey: paid[0].request.key, errorCode: 'analysis_invalid_json' } });
  expect(result.callKeys).toEqual(paid.map(input => input.request.key));
  expect(result.proposal?.highlights).toEqual([makePoint(primary), makePoint(secondary)]);
  const alwaysBad = vi.fn(async () => fromFailure(replay.invalidJson as SavedFailure));
  await expect(generateAutomaticContent(source, alwaysBad)).rejects.toThrow('analysis_invalid_json');
  expect(alwaysBad).toHaveBeenCalledTimes(2);
 });
 it('splits a settled truncated checker response into smaller, separately checked requests', async () => {
  const source = claim(), calls: KeywordLearningInput[] = [];
  const run = async (input: KeywordLearningInput) => {
   wire(input); calls.push(input);
   if (calls.length === 2) return fromFailure(replay.outputCapacity as SavedFailure);
   return modelResponse(input, source.record.content!);
  };
  const result = await generateAutomaticContent(source, run);
  expect(calls).toHaveLength(4);
  for (const shard of calls.slice(2)) {
   expect(JSON.parse(shard.request.prompt).findings).toHaveLength(1);
   expect(shard.request.correction).toEqual({baseKey: calls[1].request.key, errorCode: 'analysis_output_capacity'});
  }
  expect(result.callKeys).toHaveLength(4);
  expect(result.proposal?.highlights).toEqual([makePoint(primary), makePoint(secondary)]);
 });
 it('rechecks a single truncated finding once with a larger in-budget output limit and unchanged evidence', async () => {
  const source = claim(primary), checks: KeywordLearningInput[] = [];
  const result = await generateAutomaticContent(source, async input => {
   wire(input);
   if (input.request.role === 'checker') {
    checks.push(input);
    if (checks.length === 1) return fromFailure(replay.outputCapacity as SavedFailure);
   }
   return modelResponse(input, primary, [primary]);
  });
  expect(checks).toHaveLength(2);
  expect(checks[1].request.maxOutputTokens).toBeGreaterThan(checks[0].request.maxOutputTokens);
  expect(checks[1].request).toMatchObject({
   prompt: checks[0].request.prompt,
   schema: checks[0].request.schema,
   correction: {baseKey: checks[0].request.key, errorCode:'analysis_output_capacity'},
  });
  expect(result.proposal?.highlights).toEqual([makePoint(primary)]);
  const alwaysTruncated = vi.fn(async (input: KeywordLearningInput) => input.request.role === 'checker'
   ? fromFailure(replay.outputCapacity as SavedFailure) : modelResponse(input, primary, [primary]));
  await expect(generateAutomaticContent(source, alwaysTruncated)).rejects.toThrow('analysis_output_capacity');
  expect(alwaysTruncated).toHaveBeenCalledTimes(3);
 });
 it('reads the retained over-limit length through the final source window and preserves original evidence offsets', async () => {
  const filler = 'A description of the lab and its ordinary work. ';
  const content = primary + ' ' + filler.repeat(replay.longRecap.chars).slice(0, replay.longRecap.chars - primary.length - tail.length - 2) + ' ' + tail;
  const source = claim(content), drafts: Array<{start:number;text:string}> = [], vetoes: typeof drafts = [];
  expect(content).toHaveLength(replay.longRecap.chars);
  expect(() => assertAutomaticRecapVerifierCapacity(source)).toThrow('analysis_input_limit');
  const result = await generateAutomaticContent(source, async input => {
   wire(input);
   const prompt = JSON.parse(input.request.prompt);
   if (prompt.task === 'recap_draft') drafts.push({ start: prompt.start, text: prompt.content });
   if (prompt.task === 'recap_veto') {
    vetoes.push(prompt.sourceContext);
    const clear = prompt.findings.map((value: string) => !prompt.sourceContext.text.endsWith(tail) || value !== primary);
    return settled({ sourceHash: input.sourceHash, readComplete: true, clear });
   }
   return modelResponse(input, content, [primary, tail]);
  });
  for (const windows of [drafts, vetoes]) {
   let covered = 0;
   expect(windows.length).toBeGreaterThan(1);
   for (const window of windows) {
    expect(window.start).toBeLessThanOrEqual(covered);
    expect(content.slice(window.start, window.start + window.text.length)).toBe(window.text);
    covered = window.start + window.text.length;
   }
   expect(covered).toBe(content.length);
  }
  expect(result.proposal?.highlights).toEqual([makePoint(tail)]);
 });
 it('recovers uniquely matching verifier offsets without modifying stored evidence', async () => {
  const source=claim();
  const run=async(input:KeywordLearningInput)=>{
   if(input.request.role==='extractor')return modelResponse(input,source.record.content!,[primary]);
   const saved=verdicts(input,source.record.content!);
   saved.verdicts[0].atoms[0].end=1;
   saved.verdicts[0].atoms[0].supportingSpans[0].start=60;
   const bytes=JSON.stringify(saved);
   const output=settled(saved);
   Object.freeze(saved.verdicts[0].atoms[0].supportingSpans[0]);
   Object.freeze(saved.verdicts[0].atoms[0]);
   receipts.push({saved,bytes});
   return output;
  };
  const receipts:Array<{saved:unknown;bytes:string}>=[];
  const result=await generateAutomaticContent(source,run);
  expect(result.proposal?.highlights).toEqual([makePoint(primary)]);
  expect(receipts.map(({saved})=>JSON.stringify(saved))).toEqual(receipts.map(({bytes})=>bytes));
 });
 it('caps checked findings across multiple windows at six',async()=>{
  const quotes=Array.from({length:10},(_,i)=>'The independent trial found the setup performed as intended in stage '+(i+1)+'.');
  const content=quotes.join(' Ordinary material. '.repeat(600));
  const source=claim(content);
  const result=await generateAutomaticContent(source,async input=>modelResponse(input,content,quotes));
  expect(result.proposal?.highlights).toHaveLength(6);
  expect(result.proposal?.highlights?.every(point=>content.includes(point.evidenceQuote))).toBe(true);
 });
 it('saves a checker-positive but unsupported claim for manual review with its original evidence', async () => {
  const source = claim(primary);
  const point = { text: 'Aster announced that the new casing passed the certification test.', evidenceQuote: primary };
  const store = { sync: vi.fn().mockResolvedValue({ synchronized: 1 }),
   claim: vi.fn().mockResolvedValueOnce(source).mockResolvedValue(null), finish: vi.fn() };
  const call = vi.fn(async (input: KeywordLearningInput) => input.request.role === 'extractor'
   ? settled({ readComplete: true, highlights: [point] })
   : settled(verdicts(input, primary)));
  const result = await createAutomaticContentWorker({ env, store, call })();
  expect(result).toMatchObject({ queuedForReview: 1, blocked: 0 });
  expect(call).toHaveBeenCalledTimes(2);
  expect(store.finish).toHaveBeenCalledExactlyOnceWith(source, {
   kind: 'recap', proposal: { highlights: [point] }, callKeys: call.mock.calls.map(([input]) => input.request.key),
   reason: expect.stringMatching(/^Needs manual review\. point 1,/),
  });
 });
 it('keeps an unresolved charge in its original reservation and sends no retry or subsequent job', async () => {
  const source = claim(), saved = replay.chargeHold;
  const store = { sync: vi.fn().mockResolvedValue({synchronized:2}), claim: vi.fn().mockResolvedValue(source), finish: vi.fn() };
  const receipt = { completed: true, errorCode: saved.errorCode, call: { state: 'unknown', actual_usd: saved.actualUsd, maximum_usd: saved.maximumUsd }, result: null };
  const handler = vi.fn(async () => Response.json(receipt, {status:202}));
  const spy = vi.spyOn(learning, 'createKeywordLearningHandler').mockReturnValue(handler);
  try {
   const result = await createAutomaticContentWorker({ env, store, call: createAutomaticLearningCaller(env, {} as never) })();
   expect(result.blocked).toBe(1);
   expect(handler).toHaveBeenCalledOnce();
   expect(store.claim).toHaveBeenCalledOnce();
   expect(store.finish).toHaveBeenCalledExactlyOnceWith(source, null, 'analysis_unknown_charge_hold');
   expect(receipt.call).toEqual({ state: 'unknown', actual_usd: null, maximum_usd: .1 });
  } finally { spy.mockRestore(); }
 });
 it('shards dense keyword checks and keeps the strongest 15 distinct source mentions', async () => {
  const names = ['Alderbox','Birchbox','Cedarbox','Dogwoodbox','Elmcrate','Fircrate','Ginkgobox','Hawthorncase','Ironwoodcase','Junipercase','Kapokcase','Larchcase','Maplecase','Nutcase','Oakcase','Pinecase','Quincecase','Redwoodcase','Sprucecase','Teakcase','Umbrellacase','Vinecase','Willowcase','Yewcase','Zebracase','Appletower','Banyantower','Citrustower','Duriantower','Eldertower','Figtower','Grapetower','Hazeltower','Ivorytower','Jacarandatower','Kiwitower','Limetower','Myrtletower'];
  const source = claim(names.join(' ') + ' ' + names.at(-1) + ' ' + names.at(-1), 'keywords');
  source.record.title = names.at(-1)! + ' review';
  const checkSizes: number[] = [];
  let truncated = false;
  const result = await generateAutomaticContent(source, async input => {
   wire(input);
   if (input.request.role === 'extractor') return settled({ names: input.originalKey?.includes(':direct:') ? names.slice(0, 23) : names.slice(23), uncertainNames: [] });
   const candidates: Array<{ candidateIndex: number; name: string }> = JSON.parse(input.request.prompt.slice(input.request.prompt.lastIndexOf('\n') + 1)).candidates;
   checkSizes.push(candidates.length);
   if (!truncated) { truncated = true; return fromFailure(replay.outputCapacity as SavedFailure); }
   return settled({ readComplete: true, verdicts: candidates.map(({ candidateIndex, name }) => [candidateIndex, 0, names.includes(name) ? 0 : 1]), missingNames: [] });
  });
  expect(checkSizes.slice(0, 3)).toEqual([32, 16, 16]);
  expect(checkSizes.length).toBeGreaterThan(3);
  expect(result.proposals).toHaveLength(15);
  expect(new Set(result.proposals?.map(p => p.label)).size).toBe(15);
  expect(result.proposals?.[0].label).toBe(names.at(-1));
  expect(result.proposals?.[0].reason).toMatch(/^The AI checker accepted/);
  expect(result.proposals?.slice(1).every(proposal => proposal.reason.startsWith('Needs manual review. '))).toBe(true);
  expect(result.proposals?.every(proposal => names.includes(proposal.label))).toBe(true);
 });
});

const retainedDirectory = process.env.THERECAP_RETAINED_FIXTURES;
describe.skipIf(!retainedDirectory)('private retained replay, local only', () => {
 it('reads the original archived transcript and saved response bytes offline', async () => {
  const load = (name: string) => JSON.parse(readFileSync(retainedDirectory + '/' + name, 'utf8'));
  const { transcript } = load('long-fixture-input.json');
  const failures = load('failure-fixture-inputs.json') as Array<{ error_code: string; actual_usd: string | null; maximum_usd: string; transcript: string; response: { rawOutput: string; finishReason: string } }>;
  const original = claim(transcript);
  const first = transcript.slice(0, 48).trim(), last = transcript.slice(-48).trim();
  expect(first).not.toBe(last);
  const output = await generateAutomaticContent(original, async input => {
   wire(input);
   return modelResponse(input, transcript, [first, last]);
  });
  expect(output.proposal?.highlights?.at(-1)?.evidenceQuote).toBe(last);
  for (const code of ['analysis_invalid_json', 'analysis_output_capacity'] as const) {
   const saved = failures.find(row => row.error_code === code)!;
   const original = claim(saved.transcript);
   const point = saved.transcript.slice(-58).trim();
   let injected = false;
   const output = await generateAutomaticContent(original, async input => {
    wire(input);
    if (!injected) { injected = true; return fromFailure({ value: saved.response, validationError: code, actualUsd: Number(saved.actual_usd) }); }
    return modelResponse(input, saved.transcript, [point]);
   });
   expect(output.proposal?.highlights).toEqual([makePoint(point)]);
  }
  expect(failures.some(row => row.error_code === replay.chargeHold.errorCode && row.actual_usd === null && Number(row.maximum_usd) === .1)).toBe(true);
 });
});
