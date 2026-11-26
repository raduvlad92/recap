import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnalysisError, analysisLimits, conservativeCallUsd, type GenerationResult } from '../../../netlify/functions/_shared/content-analysis-model';
import { generateAutomaticContent, type AutomaticContentClaim } from '../../../netlify/functions/_shared/automatic-content';
import { analysisRuntimeEnv } from '../../../netlify/functions/_shared/content-analysis-runtime';
import { parseKeywordLearningInput, type KeywordLearningInput } from '../../../netlify/functions/_shared/keyword-learning';
import { validateContentReviewProposal } from '../../../netlify/functions/_shared/content-review-admin';
import { findLiteralNameOccurrences } from '../../../scripts/lib/keyword-learning.mjs';

// Read a private manifest and print aggregate results only.
async function main() {
 globalThis.fetch = () => { throw new Error('offline_replay_network_forbidden'); };
 const digest = (text: string) => createHash('sha256').update(text).digest('hex');
 const file = process.argv[2];
 const raw = readFileSync(file, 'utf8');
 const cohort = JSON.parse(raw);
 const trustedReceiptClasses = new Set(['analysis_invalid_json','analysis_output_capacity']);
 const rates = new Map([
   ['deepseek/deepseek-v4.1-flash-1017', [.12, .50, 700]],
   ['openai/gpt-6.1-sol-pro', [2, 10, 500]],
 ]);

 const success = (value: unknown): GenerationResult => ({ value, providerId: 'offline-replay', actualUsd: 0, observedUsd: 0 });
 function mock(input: KeywordLearningInput, original: string): GenerationResult {
  const request = input.request;
  if (input.originalKey?.includes(':recap:')) {
   const prompt = JSON.parse(request.prompt);
   if (prompt.task === 'recap_check') {
    return success({ sourceHash: input.sourceHash, readComplete: true,
     verdicts: prompt.findings.map(finding => {
      const quote = original.slice(finding.evidenceSpan.start, finding.evidenceSpan.end);
      if (!quote || quote !== prompt.sourceContext.text.slice(finding.evidenceSpan.start - prompt.sourceContext.start, finding.evidenceSpan.end - prompt.sourceContext.start)) throw new Error('offline_invalid_source_binding');
      return { index: finding.index, quoteHash: finding.evidenceSpan.quoteHash, status: 'entailed', wholeClaimSupported: true, contextConflict: false,
       reason: 'Synthetic verifier.', atoms: [{ start: 0, end: finding.text.length, text: finding.text, status: 'entailed', supportBasis: 'quote',
        supportingSpans: [{ start: 0, end: quote.length, text: quote }] }] };
     }) });
   }
   if (prompt.task === 'recap_veto') return success({sourceHash: input.sourceHash,readComplete:true,clear:prompt.findings.map(() => true)});
   const window: string = prompt.content;
   const quotes: Array<{ text: string; evidenceQuote: string }> = [];
   const limit = (request.schema as any).properties.highlights.maxItems;
   for (const match of window.matchAll(/(?:[\p{L}\p{N}][^.!?\r\n]{20,115}(?:[.!?]|(?=\s|$)))/gu)) {
    const quote = match[0].trim();
    if (quote.includes('\u0000') || /[\uD800-\uDFFF]/u.test(quote) || quote.split(/\s+/u).length > 22
     || original.indexOf(quote) !== prompt.start + window.indexOf(quote) || original.indexOf(quote, original.indexOf(quote) + 1) !== -1) continue;
    quotes.push({text:quote,evidenceQuote:quote});
    if (quotes.length === limit) break;
   }
   return success({readComplete:true,highlights:quotes});
  }
  const lastLine = request.prompt.slice(request.prompt.lastIndexOf('\n') + 1);
  if (request.role === 'extractor') {
   const marker = '\nTRANSCRIPT DATA\n';
   const offset = request.prompt.lastIndexOf(marker);
   const window = offset < 0 ? original : request.prompt.slice(offset + marker.length);
   const name = [...window.matchAll(/\b[A-Z][A-Za-z0-9+-]{4,24}\b/gu)].map(match => match[0])
    .find(name => findLiteralNameOccurrences(window, name).length && findLiteralNameOccurrences(original, name).length);
   return success({names:name?[name]:[],uncertainNames:[]});
  }
  const {candidates} = JSON.parse(lastLine);
  return success({readComplete:true,verdicts:candidates.map(({candidateIndex})=>[candidateIndex,0,0]),missingNames:[]});
 }
 const round = (number, places = 6) => Number.isFinite(number) ? Number(number.toFixed(places)) : null;
 const freshCalls = new Map<string, {count: number; input: number; output: number}>();
 const sumStats = (results: any[]) => ({n:results.length,valid:results.filter(r=>r.valid).length,
  retained:results.filter(r=>r.retained).length, mockOnly:results.filter(r=>r.calls>0&&!r.retained).length,
  calls:results.reduce((n,r)=>n+r.calls,0), stops:Object.fromEntries(Object.entries(Object.groupBy(results.filter(r=>!r.valid),r=>r.stop)).map(([k,v])=>[k,v!.length]))});
 const outcomes = [];
 for (const row of cohort) {
  const outcome = { failure: row.failure, video: row.video, channel: row.channel as string | undefined, task: row.task, valid:false, retained:false, calls:0, cost:0, conservative:0, stop:'', historical:row.failure==='prior_draft', chars:row.source_length??0 };
  outcomes.push(outcome);
  if (row.failure.includes('charge_hold')) {
   if (row.failure === 'analysis_unknown_charge_hold' && !row.calls?.some(call=>call.actualUsd===null)) throw new Error('missing_hold_receipt');
   outcome.stop = 'unresolved_charge';
   continue;
  }
  const claim: AutomaticContentClaim = { record: {...row.metadata,content:row.content}, leaseToken:'offline',
   task: { id:row.id??row.legacyId,update_id:row.update_id,user_id:row.user_id,content_hash:row.content_hash,task:row.task,
    session_id:row.session_id??row.legacyId } };
  const saved = trustedReceiptClasses.has(row.failure) ? row.calls?.find(call => call.error===row.failure && call.state==='settled' && call.result?.value?.rawOutput && call.result.validationError===row.failure) : null;
  if (trustedReceiptClasses.has(row.failure) && !saved) throw new Error('missing_exact_retained_failure');
  try {
   const result = await generateAutomaticContent(claim, async input => {
    parseKeywordLearningInput(input);
    const limits = analysisLimits(analysisRuntimeEnv(() => undefined, input.model, 1, input.originalKey));
    if (conservativeCallUsd(input.request, limits) > Math.min(.10, limits.maxCallUsd)) throw new AnalysisError('analysis_call_limit');
    outcome.calls++;
    const rate = rates.get(input.model);
    if (!rate) throw new Error('unknown_offline_model');
    const [promptPrice,completionPrice,completion] = rate;
    const inputChars = input.request.system.length + input.request.prompt.length + JSON.stringify(input.request.schema ?? {}).length;
    const inputTokens = Math.ceil(inputChars/4);
    const projectedOutput = Math.min(input.request.maxOutputTokens, completion);
    outcome.cost += (promptPrice*inputTokens + completionPrice*projectedOutput)/1e6;
    outcome.conservative += (promptPrice*Math.ceil(inputChars/3) + completionPrice*Math.min(input.request.maxOutputTokens,completion*2))/1e6;
    const group = freshCalls.get(input.model) ?? {count:0,input:0,output:0};
    group.count++;group.input += inputTokens;group.output += projectedOutput;freshCalls.set(input.model,group);
    if (saved && !outcome.retained && input.request.role===saved.role) {
     outcome.retained = true;
     return saved.result;
    }
    if (row.failure === 'analysis_budget_exhausted') throw new AnalysisError('analysis_budget_exhausted');
    if (row.failure === 'keyword_learning_storage_unavailable') throw new AnalysisError('keyword_learning_storage_unavailable');
    return mock(input,row.content);
   });
   if (row.task === 'recap' && result.proposal && result.proposal.highlights.length <= 6) {
    validateContentReviewProposal(result.proposal,'recap',row.content);
    outcome.valid = true;
   }
   if (row.task === 'keywords' && result.proposals?.length && result.proposals.length <= 15) {
    for (const {label,kind} of result.proposals) validateContentReviewProposal({label,kind},'keyword',row.content);
    outcome.valid = true;
   }
   if (!outcome.valid) outcome.stop='empty_or_over_limit';
  } catch (error) {
   outcome.stop = error instanceof AnalysisError ? error.code : (error as any).safeCode??(error as any).code??'offline_adapter_or_validator_error';
  }
 }
 const byVideo = Object.values(Object.groupBy(outcomes,r=>r.video)).map(rows=>rows!);
 const cost = (rows: any[])=>({
  videos:rows.length, mean:round(rows.reduce((n,r)=>n+r.cost,0)/rows.length), stressMean:round(rows.reduce((n,r)=>n+r.conservative,0)/rows.length),
  p90:rows.length ? round(rows.map(r=>r.cost).sort((a,b)=>a-b)[Math.floor((rows.length-1)*.9)]) : null,
  total:round(rows.reduce((n,r)=>n+r.cost,0)), stressTotal:round(rows.reduce((n,r)=>n+r.conservative,0)),
 });
 const modeled = byVideo.filter(rows=>rows.some(r=>r.task==='keywords'&&r.valid)&&rows.some(r=>r.task==='recap'&&r.valid))
  .map(rows=>({channel:rows[0].channel,cost:rows.reduce((n,r)=>n+r.cost,0),conservative:rows.reduce((n,r)=>n+r.conservative,0),chars:Math.max(...rows.map(r=>r.chars))}));
 const byChannel = Object.groupBy(modeled, r=>r.channel??'historical');
 const leastCost = (rows: typeof modeled) => rows.toSorted((a,b)=>a.conservative-b.conservative);
 const channelMinimums = Object.values(byChannel).flatMap(rows => rows?.length ? [leastCost(rows)[0]] : []);
 const shortWave = [...channelMinimums, ...leastCost(modeled.filter(row => !channelMinimums.includes(row)))].slice(0,10);
 console.log(JSON.stringify({
  cohortSha256:digest(raw), selected:sumStats(outcomes), byClass:Object.fromEntries(Object.entries(Object.groupBy(outcomes,r=>r.failure)).map(([k,v])=>[k,sumStats(v!)])),
  distinctVideos:byVideo.length, withBothTasks:byVideo.filter(rows=>new Set(rows.map(r=>r.task)).size===2).length,
  bothValid:modeled.length, anyValid:byVideo.filter(rows=>rows.some(r=>r.valid)).length,
  priorBothAlreadyValid:byVideo.filter(rows=>rows.filter(r=>r.historical).length===2).length,
  cost: { allValidPairs:cost(modeled), standardValidPairs:cost(modeled.filter(r=>r.chars<117252)),
   hardestRecaps:cost(outcomes.filter(r=>r.failure==='analysis_input_limit')),
   byChannel: Object.fromEntries(Object.entries(byChannel).map(([k,v])=>[k,cost(v!)])),
   lowestTenPaired:cost(modeled.toSorted((a,b)=>a.conservative-b.conservative).slice(0,10)),
   tenPairedWithEachChannel: {...cost(shortWave), byChannel: Object.fromEntries(
    Object.entries(Object.groupBy(shortWave, r => r.channel??'historical')).map(([k,v])=>[k,v!.length]))},
   lowestTenRecap:cost(outcomes.filter(r=>r.valid&&r.task==='recap').toSorted((a,b)=>a.conservative-b.conservative).slice(0,10)),
  },
  modelCalls:Object.fromEntries(freshCalls),
 },null,2));
}
void main();
