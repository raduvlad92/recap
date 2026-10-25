import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
// @ts-expect-error Standalone offline JavaScript intentionally has no application imports.
import { evaluateSnapshot, validateSnapshot, parseSnapshot, measureCoverage, parseCallKey, runCli } from '../scripts/analysis-quality-report.mjs';

type Row = Record<string, any>;
const quote = 'The synthetic GPU reaches 45 FPS, with a limited sample.';
const source = (overrides:Row = {}):Row => ({user_id:'synthetic-owner',id:'synthetic-update',source_id:'synthetic-source',record:{id:'synthetic-update',sourceId:'synthetic-source',title:'Synthetic test source',url:'https://example.invalid/synthetic',format:'video',isSample:false,contentKind:'transcript',content:quote,coverage:'Full transcript coverage verified',transcriptSegments:[{startSeconds:120,text:quote,durationSeconds:8}],...overrides}});
const job = (overrides:Row = {}):Row => ({id:'synthetic-job',user_id:'synthetic-owner',update_id:'synthetic-update',source_id:'synthetic-source',task:'summary',state:'prepared',result:null,...overrides});
const call = (overrides:Row = {}):Row => ({id:'synthetic-call',job_id:'synthetic-job',user_id:'synthetic-owner',call_key:'summary:0',maximum_usd:.01,observed_usd:.004,actual_usd:.004,state:'settled',result:{value:{readComplete:true,endQuote:quote,highlights:[{text:'The synthetic test reports 45 FPS.',evidenceQuote:quote,startSeconds:120}]}},...overrides});
const result = (overrides:Row = {}):Row => ({state:'ready',patch:{videoHighlights:[{text:'The synthetic test reports 45 FPS.',startSeconds:120}]},pending:[],evidence:{coverage:[{start:0,end:quote.length}],findings:[{text:'The synthetic test reports 45 FPS.',evidenceQuote:quote,start:0,end:quote.length,startSeconds:120}],selected:[]},...overrides});
const snapshot = (overrides:Row = {}):Row => ({sourceUpdates:[source()],jobs:[job()],calls:[call()],chunkPlans:[{job_id:'synthetic-job',chunks:[{index:0,start:0,end:quote.length}]}],...overrides});
const inspect = (s:Row = snapshot()) => evaluateSnapshot(s);

describe('offline snapshot contract and privacy', () => {
  it('accepts plain snake_case database dumps and direct sources without importing app code', () => {
    const value = parseSnapshot(JSON.stringify({reader_source_updates:[source()],reader_content_analysis_jobs:[job()],reader_content_analysis_calls:[call()]}));
    const {report,review} = inspect(value);
    expect(report.sourceCompleteness).toMatchObject({total:1,transcript:1,declaredComplete:1});
    expect(report).toMatchObject({mode:'offline',manualReviewRequired:true,semanticQuality:'unreviewed'});
    expect(report).toMatchObject({diagnosticScope:'combined_final_job_and_cached_call_result_occurrences',diagnosticsArePublishedOutputVerdicts:false});
    expect(report.sample).toMatchObject({desiredCount:20,actualCount:1,countMatches:false,unlabeledSources:1});
    expect(report.chunks.planCoverageUnknown).toBe(1);
    expect(report.citations).toMatchObject({literal:0,scopeUnknown:1});
    expect(review.items[0].source.record.content).toBe(quote);
    expect(Object.values(review.items[0].verdicts)).toEqual(Array(8).fill('unreviewed'));
    const direct = inspect(snapshot({sourceUpdates:[source().record]}));
    expect(direct.report.jobs.sourceUnavailable).toBe(0);
  });

  it('never emits source identities, raw text, hashes, models or arbitrary keys in the safe report', () => {
    const secret = 'SYNTHETIC_PRIVATE_SENTINEL_person@example.invalid';
    const s = snapshot();
    s.sourceUpdates[0].record.title = secret; s.sourceUpdates[0].record.url = secret;
    s.sourceUpdates[0].record.content += secret;
    s.jobs[0].state = secret; s.jobs[0].error_code = secret; s.jobs[0].model = secret;
    s.calls[0].model = secret; s.calls[0].request_hash = secret; s.calls[0].error = secret;
    s.calls[0].result.requestHash = secret; s.calls[0].result.access_token = secret;
    s.sourceUpdates[0].record.access_token = secret;
    s.arbitrary = {[secret]:secret};
    const {report,review} = inspect(s), publicText = JSON.stringify(report);
    for (const text of [secret,quote,'synthetic-owner','synthetic-job','synthetic-update','https://']) expect(publicText).not.toContain(text);
    expect(JSON.stringify(review)).not.toContain('access_token');
    expect(report.jobs.states.other).toBe(1);
  });

  it.each(['null','[]','"SYNTHETIC_PRIVATE_JSON"','{"sourceUpdates":','1e999'])('rejects malformed root JSON without parser excerpts: %s', text => {
    expect(() => parseSnapshot(text)).toThrow(/^(invalid_|snapshot_)/);
    try { parseSnapshot(text); } catch (error) { expect(String(error)).not.toContain('SYNTHETIC_PRIVATE_JSON'); }
  });

  it('rejects ambiguity, malformed tables, cycles, accessors, sparse arrays and duplicate sources', () => {
    expect(() => inspect(snapshot({reader_source_updates:[]}))).toThrow('ambiguous_snapshot_table');
    expect(() => inspect(snapshot({jobs:{}}))).toThrow('invalid_snapshot_table');
    const cyclic:Row = snapshot(); cyclic.cycle = cyclic;
    expect(() => validateSnapshot(cyclic)).toThrow('invalid_snapshot_json');
    const getter = snapshot(); Object.defineProperty(getter,'bad',{enumerable:true,get:() => { throw new Error('never invoke'); }});
    expect(() => validateSnapshot(getter)).toThrow('invalid_snapshot_json');
    expect(() => inspect(snapshot({calls:new Array(2)}))).toThrow('invalid_snapshot_json');
    expect(() => inspect(snapshot({sourceUpdates:[source(),source()]}))).toThrow('duplicate_source_identity');
  });

  it.each([NaN,Infinity,-Infinity])('rejects nonfinite numbers even in unknown fields (%s)', value => {
    expect(() => inspect(snapshot({unknown:value}))).toThrow('invalid_snapshot_number');
  });

  it('accepts standalone results but refuses conflicting result copies', () => {
    const r = result();
    expect(inspect(snapshot({results:[{job_id:'synthetic-job',result:r}]})).report.jobs.withResult).toBe(1);
    expect(() => inspect(snapshot({jobs:[job({result:r})],results:[{job_id:'synthetic-job',result:{...r,state:'empty'}}]}))).toThrow('conflicting_job_result');
    expect(() => inspect(snapshot({results:[{job_id:'missing',result:r}]}))).toThrow('invalid_job_supplement');
  });

  it('treats saved completeness wording as declarations and does not upgrade from processing status', () => {
    const s = snapshot({sourceUpdates:[source({coverage:'not independently verified',processing:{content:'ready'}})]});
    expect(inspect(s).report.sourceCompleteness).toMatchObject({declaredComplete:0,declaredPartial:1,processingDisagreements:1});
    expect(inspect(snapshot({sourceUpdates:[source({coverage:'Captured captions'})]})).report.sourceCompleteness.unverified).toBe(1);
    expect(inspect(snapshot({sourceUpdates:[source({contentKind:'metadata_only',content:''})]})).report.sourceCompleteness).toMatchObject({metadataOnly:1,emptyContent:1,unusable:1});
  });

  it('uses supplied sample labels without inferring actual20 or real coverage', () => {
    const s = snapshot({sample:{desiredCount:1,categories:[{update_id:'synthetic-update',categories:['short','long','dense-products','outros','sponsors','partial-timing','empty','unknown-private-label']},{update_id:'missing',categories:['short']}]}});
    expect(inspect(s).report.sample).toMatchObject({desiredCount:1,actualCount:1,countMatches:true,labeledSources:1,unlabeledSources:0,missingCategories:[],unknownCategoryLabels:1,unmatchedCategoryEntries:1,categories:{short:1,long:1}});
  });
});

describe('raw materialized responses before domain validation (R3-B2)', () => {
  const cases = [
    {value:null,type:'null',malformed:1,arrays:0,items:0},
    {value:false,type:'boolean',malformed:1,arrays:0,items:0},
    {value:true,type:'boolean',malformed:1,arrays:0,items:0},
    {value:0,type:'number',malformed:1,arrays:0,items:0},
    {value:-2.5,type:'number',malformed:1,arrays:0,items:0},
    {value:'invalid schema',type:'string',malformed:1,arrays:0,items:0},
    {value:'',type:'string',malformed:1,arrays:0,items:0},
    {value:[],type:'array',malformed:1,arrays:0,items:0},
    {value:[null,false,'invalid schema'],type:'array',malformed:1,arrays:0,items:0},
    {value:{},type:'object',malformed:0,arrays:0,items:0},
    {value:{highlights:'invalid'},type:'object',malformed:1,arrays:1,items:0},
    {value:{highlights:[null,false,'invalid',0,[],{}]},type:'object',malformed:1,arrays:1,items:5},
    {value:{evidence:{accepted:[false],pending:'invalid'}},type:'object',malformed:1,arrays:2,items:1},
  ];

  it.each(cases)('reports saved $type value $value without requiring a domain shape', ({value,type,malformed,arrays,items}) => {
    const s = snapshot({calls:[call({result:{value}})]});
    const before = JSON.stringify(s);
    const {report,review} = inspect(parseSnapshot(before));
    expect(report).toMatchObject({semanticQuality:'unreviewed',manualReviewRequired:true,diagnosticScope:'combined_final_job_and_cached_call_result_occurrences',diagnosticsArePublishedOutputVerdicts:false});
    expect(report.calls).toMatchObject({rows:1,uniqueCalls:1,materializedResults:1,withoutMaterializedResult:0,cachedSuccesses:1,markedInvalidResults:0,malformedRawResults:malformed,malformedEvidenceArrays:arrays,malformedEvidenceItems:items,unknownCacheIdentity:1});
    expect(report.calls.rawValueTypes).toEqual(Object.fromEntries(['object','array','null','boolean','number','string'].map(k => [k,k === type ? 1 : 0])));
    expect(report.chunks).toMatchObject({cachedRoleChunks:1,missingRoleChunks:0,acknowledgedRoleChunks:0,invalidAcknowledgements:1});
    expect(report.costs).toMatchObject({knownCalls:1,unknownCalls:0,settledUsd:.004,commitmentUsd:.004});
    expect(review.items[0].jobs[0].calls[0]).toMatchObject({materializedResult:true,markedInvalid:false,result:{value}});
    expect(review.items[0].jobs[0].calls[0].result.value).toEqual(value);
    expect(review.semanticQuality).toBe('unreviewed');
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each([null,false,'invalid schema',[],{},{highlights:'invalid'}])('retains paid invalid original %# beside a successful repair and every financial row', value => {
    const passageId = 'p0_'+quote.length;
    const s = snapshot({
      jobs:[job({result:result()})],
      chunkPlans:[{job_id:'synthetic-job',protocolVersion:'content-v2',chunks:[{index:0,start:0,end:quote.length,passages:[{id:passageId,start:0,end:quote.length,text:quote}]}]}],
      calls:[
        call({call_key:'summary:v2:chunk:0',observed_usd:.0001,actual_usd:.0001,validation_error_code:'analysis_invalid_model_output',validation_result_hash:'private-invalid-hash',result:{value}}),
        call({id:'synthetic-repair',call_key:'summary:v2:chunk:0:repair:1',observed_usd:.0002,actual_usd:.0002,result:{value:{readComplete:true,lastPassageId:passageId,highlights:[{text:'The synthetic test reports 45 FPS.',passageIds:[passageId]}]}}}),
        call({id:'synthetic-hold',call_key:'summary:v2:chunk:1',observed_usd:.015,actual_usd:null,state:'unknown',result:null}),
      ],
    });
    const {report,review} = inspect(s);
    expect(report.calls).toMatchObject({rows:3,uniqueCalls:3,materializedResults:2,withoutMaterializedResult:1,markedInvalidResults:1,duplicateKeyGroups:0});
    expect(report.chunks).toMatchObject({cachedRoleChunks:1,missingRoleChunks:0,acknowledgedRoleChunks:1,repairCalls:1});
    expect(report.costs).toEqual({currency:'USD',knownCalls:2,unknownCalls:1,observedUsd:.0153,settledUsd:.0003,unknownHoldUsd:.015,commitmentUsd:.0153,unknownChargesRemainHolds:true});
    const saved = review.items[0].jobs[0].calls;
    expect(saved).toHaveLength(3);
    expect(saved[0]).toMatchObject({id:'synthetic-call',markedInvalid:true,materializedResult:true,actual_usd:.0001});
    expect(saved[0].result.value).toEqual(value);
    expect(saved[1].result.value).toEqual(s.calls[1].result.value);
    expect(saved[2]).toMatchObject({id:'synthetic-hold',actual_usd:null,result:null,materializedResult:false});
    expect(report.semanticQuality).toBe('unreviewed');
    expect(review.overall.verdict).toBe('unreviewed');
  });

  it('distinguishes absent value from false/null, and keeps duplicate materializations and identity checks accurate', () => {
    const rows = [
      call({result:{value:false,requestHash:'wrong-hash',executionIdentity:{model:'synthetic-model'}},request_hash:'synthetic-hash',execution_identity:{model:'synthetic-model'},model:'synthetic-model'}),
      call({id:'synthetic-null',result:{value:null}}),
      call({id:'synthetic-absent',call_key:'summary:1',result:{requestHash:'synthetic-hash'}}),
      call({id:'synthetic-no-envelope',call_key:'summary:2',result:null}),
    ];
    const {report} = inspect(snapshot({calls:rows}));
    expect(report.calls).toMatchObject({materializedResults:2,withoutMaterializedResult:2,cachedSuccesses:2,duplicateMaterializedResults:1,duplicateCachedSuccesses:1,requestIdentityMismatches:1,unknownCacheIdentity:1});
    expect(report.costs).toMatchObject({knownCalls:4,settledUsd:.016});
  });

  it.each(['ledger','transport'])('counts a %s rejection marker without treating a shape-looking raw response as a valid acknowledgment', marker => {
    const c = call();
    if (marker === 'ledger') Object.assign(c,{validation_error_code:'private-error-value',validation_result_hash:'private-marker-hash'});
    else c.result.validationError = 'private-error-value';
    const {report,review} = inspect(snapshot({calls:[c]}));
    expect(report.calls).toMatchObject({materializedResults:1,markedInvalidResults:1,malformedRawResults:0});
    expect(report.chunks).toMatchObject({cachedRoleChunks:1,acknowledgedRoleChunks:0,invalidAcknowledgements:1});
    expect(report.citations.literal).toBe(1); // Raw and final occurrences remain diagnostics, never publication verdicts.
    expect(review.items[0].jobs[0].calls[0].markedInvalid).toBe(true);
    expect(JSON.stringify({report,review})).not.toContain('private-error-value');
    expect(JSON.stringify({report,review})).not.toContain('private-marker-hash');
  });

  it('keeps whitelisted raw evidence private and public keys fixed, excluding arbitrary transport keys and secrets', () => {
    const evidence = 'PRIVATE_RAW_EVIDENCE_SENTINEL', secret = 'PRIVATE_TRANSPORT_SECRET_SENTINEL';
    const values = [evidence,[evidence,false,null,{highlights:[{text:evidence,access_token:secret}]}],{highlights:[{text:evidence,evidenceQuote:quote,transportSecret:secret}],transportSecret:secret}];
    const s = snapshot({calls:values.map((value,index) => call({id:'private-call-'+index,call_key:'summary:'+index,validation_error_code:secret,result:{value,access_token:secret,transportSecret:secret}}))});
    const {report,review} = inspect(s);
    function publicShape(v:any):any {
      return Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,child]) => [k,publicShape(child)])) : typeof v;
    }
    expect(publicShape(report)).toEqual(publicShape(inspect().report));
    const publicText = JSON.stringify(report), privateText = JSON.stringify(review);
    for (const text of [evidence,secret,'transportSecret','access_token','private-call-',quote,'synthetic-owner']) expect(publicText).not.toContain(text);
    expect(privateText).toContain(evidence);
    for (const text of [secret,'transportSecret','access_token']) expect(privateText).not.toContain(text);
    const saved = review.items[0].jobs[0].calls;
    expect(saved[0].result.value).toBe(evidence);
    expect(saved[1].result.value).toEqual([evidence,false,null,{highlights:[{text:evidence}]}]);
    expect(saved[2].result.value).toEqual({highlights:[{text:evidence,evidenceQuote:quote}]});
    for (const count of Object.values(report.calls.rawValueTypes)) expect(typeof count).toBe('number');
  });

  it('retains unmatched/orphan and conflicting exported originals in private review without dropping accounting', () => {
    const s = snapshot({jobs:[job({update_id:'missing-source'})],calls:[call({result:{value:false}}),call({observed_usd:.02,actual_usd:null,state:'unknown',result:{value:null}}),call({id:'synthetic-orphan',job_id:null,result:{value:['private orphan evidence']}})]});
    const {report,review} = inspect(s);
    expect(report.calls).toMatchObject({rows:3,uniqueCalls:2,conflictingExportRows:1,orphanCalls:1});
    expect(report.costs).toMatchObject({knownCalls:1,unknownCalls:1,settledUsd:.004,unknownHoldUsd:.02,commitmentUsd:.024});
    expect(review.unmatchedJobs[0].calls.map((c:Row) => c.result.value)).toEqual([false,null]);
    expect(review.orphanCalls[0].result.value).toEqual(['private orphan evidence']);
  });

  it.each([false,0,'invalid envelope',[],[null]])('still rejects malformed call envelopes %#', envelope => {
    expect(() => inspect(snapshot({calls:[call({result:envelope})]}))).toThrow('invalid_call_result');
  });

  it.each([false,0,'invalid final result',[]])('keeps final job and supplement results strict %#', value => {
    expect(() => inspect(snapshot({jobs:[job({result:value})]}))).toThrow('invalid_job_result');
    expect(() => inspect(snapshot({results:[{job_id:'synthetic-job',result:value}]}))).toThrow('invalid_job_result');
  });

  it.each([{evidence:{findings:'invalid'}},{evidence:{accepted:[false]}},{pending:[null]}])('still rejects malformed final evidence arrays %# including supplements and baselines', value => {
    expect(() => inspect(snapshot({jobs:[job({result:value})]}))).toThrow('invalid_evidence_array');
    expect(() => inspect(snapshot({results:[{job_id:'synthetic-job',result:value}]}))).toThrow('invalid_evidence_array');
    expect(() => inspect(snapshot({baseline:snapshot({jobs:[job({result:value})]})}))).toThrow('invalid_evidence_array');
  });

  it.each([undefined,1n,NaN,Infinity,() => false,new Date(0)])('requires raw values to remain plain finite JSON %#', value => {
    expect(() => inspect(snapshot({calls:[call({result:{value}})]}))).toThrow(/invalid_snapshot_(json|number)/);
  });

  it.each(['observedUsd','actualUsd'])('validates envelope %s money even beside raw null/false', field => {
    for (const value of [null,false]) expect(() => inspect(snapshot({calls:[call({result:{value,[field]:'PRIVATE_BAD_MONEY'}})]}))).toThrow('invalid_call_cost');
  });

  it('preserves ledger money and row identity guards for arbitrary raw values', () => {
    expect(() => inspect(snapshot({calls:[call({id:'',result:{value:false}})]}))).toThrow('invalid_call_row');
    expect(() => inspect(snapshot({calls:[call({call_key:'',result:{value:null}})]}))).toThrow('invalid_call_row');
    expect(() => inspect(snapshot({calls:[call({actual_usd:-1,result:{value:[]}})]}))).toThrow('invalid_call_cost');
    expect(() => inspect(snapshot({calls:[call({maximum_usd:null,result:{value:'invalid schema'}})]}))).toThrow('missing_call_reserve');
  });
});

describe('source/chunk coverage and literal citations', () => {
  it('counts overlapping UTF-16 coverage once and includes the final tail', () => {
    expect(measureCoverage([{start:0,end:7},{start:5,end:11}],11)).toEqual({known:true,complete:true,coveredCharacters:11,invalidIntervals:0,gaps:0});
    expect(measureCoverage([{start:0,end:4},{start:5,end:9}],11)).toMatchObject({complete:false,gaps:2,coveredCharacters:8});
    expect(measureCoverage([{start:0,end:99},{start:.5,end:2}],11)).toMatchObject({complete:false,invalidIntervals:2});
    expect(measureCoverage([],0).complete).toBe(false);
  });

  it('validates cached citations against their actual chunk, not another literal source passage', () => {
    const early = 'Synthetic opening has no result. ', late = 'Synthetic ending reports a new concrete result.';
    const content = early+late;
    const s = snapshot({sourceUpdates:[source({content,transcriptSegments:[]})],calls:[call({result:{value:{readComplete:true,endQuote:early,highlights:[{text:'The ending contains a result.',evidenceQuote:late,startSeconds:null}]}}})],chunkPlans:[{job_id:'synthetic-job',chunks:[{index:0,start:0,end:early.length},{index:1,start:early.length,end:content.length}]}]});
    const report = inspect(s).report;
    expect(report.chunks).toMatchObject({planCoverageComplete:1,expectedRoleChunks:2,cachedRoleChunks:1,missingRoleChunks:1,acknowledgedRoleChunks:1});
    expect(report.citations).toMatchObject({total:1,literal:0,nonliteralOrMalformed:1,scopeUnknown:0});
  });

  it('leaves citation and acknowledgment scope unknown without an original chunk manifest', () => {
    const r = inspect(snapshot({chunkPlans:null})).report;
    expect(r.chunks).toMatchObject({jobsWithoutPlan:1,planCoverageUnknown:1,expectedRoleChunks:0,acknowledgedRoleChunks:0,unknownAcknowledgements:1});
    expect(r.citations).toMatchObject({total:1,literal:0,scopeUnknown:1});
    expect(r.timing).toMatchObject({savedCueSupported:0,scopeUnknown:1});
  });

  it('distinguishes a fully acknowledged partial plan from complete saved-text coverage', () => {
    const s = snapshot({chunkPlans:[{job_id:'synthetic-job',chunks:[{index:0,start:0,end:20}]}],calls:[call({result:{value:{readComplete:true,endQuote:quote.slice(0,20),highlights:[]}}})]});
    expect(inspect(s).report.chunks).toMatchObject({planCoverageIncomplete:1,planCoverageComplete:0,acknowledgedRoleChunks:1});
    expect(inspect(s).report.jobs).toMatchObject({coverageUnknown:1,completeSavedTextCoverage:0});
  });

  it('checks missing keyword checker/tail chunks independently', () => {
    const s = snapshot({jobs:[job({task:'keywords'})],calls:[call({call_key:'extractor:0',result:{value:{readComplete:true,endQuote:quote,candidates:[]}}})]});
    expect(inspect(s).report.chunks).toMatchObject({expectedRoleChunks:2,cachedRoleChunks:1,missingRoleChunks:1,acknowledgedRoleChunks:1});
  });

  it('uses final evidence coverage as a documented fallback and checks literal offsets', () => {
    const s = snapshot({jobs:[job({result:result()})],chunkPlans:null});
    expect(inspect(s).report.jobs).toMatchObject({withCoverage:1,completeSavedTextCoverage:1});
    expect(inspect(s).report.citations).toMatchObject({literal:2,supportedOffsets:1,unsupportedOffsets:0});
    s.jobs[0].result.evidence.findings[0].start = 1;
    expect(inspect(s).report.citations.unsupportedOffsets).toBe(1);
  });

  it('rejects normalized paraphrase quotes, missing quotes, bad end acknowledgments and cross-owner joins', () => {
    const s = snapshot({calls:[call({result:{value:{readComplete:true,endQuote:'wrong',highlights:[{text:'An unsupported synthetic assertion.',evidenceQuote:quote.replace('45','46')},{text:'A missing citation.'}]}}})]});
    expect(inspect(s).report.citations).toMatchObject({total:2,literal:0,missingQuotes:1,nonliteralOrMalformed:2});
    expect(inspect(s).report.chunks.invalidAcknowledgements).toBe(1);
    s.jobs[0].user_id = 'different-synthetic-owner';
    expect(inspect(s).report.jobs.sourceUnavailable).toBe(1);
    expect(inspect(s).report.citations.sourceUnavailable).toBe(2);
  });

  it('supports full-source legacy reductions separately from original chunks', () => {
    const s = snapshot({calls:[call({call_key:'summary-reduce:0'})]});
    expect(inspect(s).report.chunks).toMatchObject({reductionCalls:1,cachedRoleChunks:0,missingRoleChunks:1});
    expect(inspect(s).report.citations.literal).toBe(1);
  });
});

describe('saved-cue-only timing', () => {
  it('accepts a grounded real cue and omits invented untimed estimates', () => {
    expect(inspect().report.timing).toMatchObject({timedEvidence:1,savedCueSupported:1,unsupported:0});
    const s = snapshot(); s.calls[0].result.value.highlights[0].startSeconds = 121;
    expect(inspect(s).report.timing).toMatchObject({savedCueSupported:0,unsupported:1});
    s.calls[0].result.value.highlights[0].startSeconds = null;
    expect(inspect(s).report.timing).toMatchObject({timedEvidence:0,untimedEvidence:1});
  });

  it('uses only floating-point roundoff tolerance and rejects quote-unrelated real cue starts', () => {
    const s = snapshot({sourceUpdates:[source({transcriptSegments:[{startSeconds:453.84000000000003,text:quote,durationSeconds:8},{startSeconds:10,text:'An unrelated synthetic cue.',durationSeconds:2}]})]});
    s.calls[0].result.value.highlights[0].startSeconds = 453.84;
    expect(inspect(s).report.timing.savedCueSupported).toBe(1);
    s.calls[0].result.value.highlights[0].startSeconds = 453.841;
    expect(inspect(s).report.timing.unsupported).toBe(1);
    s.calls[0].result.value.highlights[0].startSeconds = 10;
    expect(inspect(s).report.timing.unsupported).toBe(1);
  });

  it('checks keyword cue ranges and finite union durations without proportional estimates', () => {
    const s = snapshot({jobs:[job({task:'keywords',result:{state:'ready',evidence:{accepted:[{label:'GPU',mention:'GPU',evidenceQuote:quote,ranges:[{startSeconds:120,endSeconds:128}],seconds:8}]}}})],calls:[]});
    expect(inspect(s).report.timing).toMatchObject({rangeSets:1,savedCueRangeSets:1,unsupportedRangeSets:0,durationTotals:1,unsupportedDurationTotals:0});
    s.jobs[0].result.evidence.accepted[0].ranges[0].endSeconds = 130;
    expect(inspect(s).report.timing).toMatchObject({unsupportedRangeSets:1,unsupportedDurationTotals:1});
  });

  it('rejects malformed saved cues rather than accepting numeric strings as times', () => {
    expect(() => inspect(snapshot({sourceUpdates:[source({transcriptSegments:[{text:quote,startSeconds:'120'}]})]}))).toThrow('invalid_saved_cues');
  });

  it('does not attach a repeated quote to an ambiguous partial cue', () => {
    const s = snapshot({sourceUpdates:[source({content:quote+' intervening text '+quote,transcriptSegments:[{startSeconds:120,text:quote,durationSeconds:8}]})],chunkPlans:[{job_id:'synthetic-job',chunks:[{index:0,start:0,end:(quote+' intervening text '+quote).length}]}]});
    expect(inspect(s).report.timing).toMatchObject({savedCueSupported:0,unsupported:1});
  });

  it('leaves reconciled canonical-label timing unknown when its original mention is unavailable', () => {
    const s = snapshot({jobs:[job({result:{evidence:{accepted:[{label:'GPU',evidenceQuote:quote,ranges:[{startSeconds:120,endSeconds:128}],seconds:8}]}}})],calls:[]});
    expect(inspect(s).report.timing).toMatchObject({rangeScopeUnknown:1,durationScopeUnknown:1,unsupportedRangeSets:0,unsupportedDurationTotals:0});
  });
});

describe('cost accounting and duplicate cached calls', () => {
  it('separates settled actuals from observed highwater and keeps unknown charges as holds', () => {
    const s = snapshot({calls:[call({observed_usd:.009,actual_usd:.004}),call({id:'synthetic-unknown',call_key:'summary:1',maximum_usd:.01,actual_usd:null,observed_usd:.02,state:'unknown'})]});
    expect(inspect(s).report.costs).toEqual({currency:'USD',knownCalls:1,unknownCalls:1,observedUsd:.029,settledUsd:.004,unknownHoldUsd:.02,commitmentUsd:.029,unknownChargesRemainHolds:true});
  });

  it('does exact DB12 additions for 5000 one-cent charges', () => {
    const s = snapshot({calls:Array.from({length:5000},(_,i) => call({id:'synthetic-call-'+i,job_id:null,call_key:'summary:'+i,actual_usd:.01,observed_usd:.01,result:null}))});
    expect(inspect(s).report.costs).toMatchObject({settledUsd:50,observedUsd:50,commitmentUsd:50});
  });

  it('accepts plain database numeric strings and does not use stale cached response costs', () => {
    const s = snapshot({calls:[call({maximum_usd:'0.010000000000',observed_usd:'0.004000000001',actual_usd:'0.003000000001',result:{value:{},observedUsd:0,actualUsd:0}})]});
    expect(inspect(s).report.costs).toMatchObject({settledUsd:.003000000001,observedUsd:.004000000001,commitmentUsd:.004000000001});
  });

  it.each([-1,'NaN','Infinity','1e999',true,'-0.01','0.0000000000001',1e-13,'9999999999999',{}])('rejects malformed/nonfinite/overprecision ledger money %j', cost => {
    expect(() => inspect(snapshot({calls:[call({actual_usd:cost})]}))).toThrow(/invalid_call_cost/);
  });

  it('requires a finite positive reserve for every call including settled and deleted-job rows', () => {
    expect(() => inspect(snapshot({calls:[call({maximum_usd:null})]}))).toThrow('missing_call_reserve');
    expect(() => inspect(snapshot({calls:[call({maximum_usd:0})]}))).toThrow('invalid_call_reserve');
    const c = call({job_id:null,actual_usd:null,observed_usd:null,state:'unknown',result:null,created_at:'2000-01-01T00:00:00Z'});
    expect(inspect(snapshot({calls:[c]})).report).toMatchObject({costs:{unknownCalls:1,unknownHoldUsd:.01},calls:{orphanCalls:1}});
  });

  it('does not infer zero billing from a 429, timeout, receipt, or cached success', () => {
    const s = snapshot({calls:[call({state:'unknown',actual_usd:null,observed_usd:0,rejection_receipt:{httpStatus:429},generation_receipt:{claimedCost:0}})]});
    expect(inspect(s).report.costs).toMatchObject({knownCalls:0,settledUsd:0,unknownCalls:1,unknownHoldUsd:.01});
    expect(inspect(s).report.calls.cachedSuccesses).toBe(1);
  });

  it('deduplicates repeated exports by ID but flags distinct duplicate cached call keys', () => {
    const c = call(), repeated = structuredClone(c), duplicate = call({id:'synthetic-duplicate'});
    const r = inspect(snapshot({calls:[c,repeated,duplicate]})).report;
    expect(r.calls).toMatchObject({rows:3,uniqueCalls:2,repeatedExportRows:1,duplicateKeyGroups:1,duplicateKeyExtraCalls:1,duplicateCachedSuccesses:1,cachedSuccesses:2});
    expect(r.costs.settledUsd).toBe(.008);
  });

  it('retains a conservative highwater hold for conflicting repeated export rows', () => {
    const r = inspect(snapshot({calls:[call(),call({observed_usd:.02,actual_usd:null,state:'unknown'})]})).report;
    expect(r.calls.conflictingExportRows).toBe(1);
    expect(r.costs).toMatchObject({knownCalls:0,unknownCalls:1,unknownHoldUsd:.02,commitmentUsd:.02});
  });

  it('flags cache identity disagreements and leaves legacy cache identity unknown', () => {
    const s = snapshot();
    expect(inspect(s).report.calls.unknownCacheIdentity).toBe(1);
    s.calls[0].model = 'synthetic-model'; s.calls[0].request_hash = 'synthetic-hash'; s.calls[0].execution_identity = {model:'synthetic-model'};
    s.calls[0].result.requestHash = 'other-hash'; s.calls[0].result.executionIdentity = {model:'synthetic-model'};
    expect(inspect(s).report.calls.requestIdentityMismatches).toBe(1);
  });
});

describe('v2 chunk/reference protocol', () => {
  const v2snapshot = (passages = true) => snapshot({chunkPlans:[{job_id:'synthetic-job',protocolVersion:'content-v2',chunks:[{index:0,start:0,end:quote.length,...(passages ? {passages:[{id:'p0_'+quote.length,start:0,end:quote.length,text:quote}]} : {})}]}],calls:[call({call_key:'summary:v2:chunk:0',result:{value:{readComplete:true,lastPassageId:'p0_'+quote.length,highlights:[{text:'A synthetic result.',passageIds:['p0_'+quote.length]}]}}})]});

  it('recognizes exact versioned grammar and rejects nested or unversioned repairs', () => {
    expect(parseCallKey('summary:v2:chunk:0:repair:1')).toMatchObject({protocol:'content-v2',kind:'chunk',baseKey:'summary:v2:chunk:0',repairAttempt:1});
    expect(parseCallKey('summary-reduce:v2:level:2:group:5')).toMatchObject({kind:'reduction'});
    expect(parseCallKey('summary:v2:verify:0')).toMatchObject({kind:'verification'});
    for (const value of ['summary:0:repair:1','summary:v2:chunk:0:repair:2','summary:v2:chunk:0:repair:1:repair:1','summary:v2:chunk:0:extra']) expect(parseCallKey(value)).toBeNull();
  });

  it('acknowledges supplied passage manifests and keeps passage refs separate from literal quotes', () => {
    const r = inspect(v2snapshot()).report;
    expect(r.chunks).toMatchObject({expectedRoleChunks:1,cachedRoleChunks:1,acknowledgedRoleChunks:1,unexpectedCallKeys:0});
    expect(r.citations).toMatchObject({total:0,literal:0,missingQuotes:0,passageReferenceItems:1,suppliedPassageReferencesSupported:1});
  });

  it('leaves v2 acknowledgment/reference diagnostics unknown without passage manifest', () => {
    const r = inspect(v2snapshot(false)).report;
    expect(r.chunks).toMatchObject({acknowledgedRoleChunks:0,unknownAcknowledgements:1});
    expect(r.citations).toMatchObject({literal:0,passageReferenceScopeUnknown:1});
  });

  it('rejects incomplete passage coverage and ignores malformed manifest extras on native coverage', () => {
    const s = v2snapshot(); s.chunkPlans[0].chunks[0].passages[0].end = 10;
    s.chunkPlans[0].chunks[0].passages[0].text = quote.slice(0,10);
    expect(inspect(s).report.chunks).toMatchObject({acknowledgedRoleChunks:0,invalidAcknowledgements:1});
    const fallback = v2snapshot(); delete fallback.chunkPlans;
    fallback.jobs[0].result = {evidence:{protocolVersion:'content-v2',coverage:[{start:0,end:quote.length,passages:[null]}]}};
    expect(inspect(fallback).report.chunks).toMatchObject({acknowledgedRoleChunks:0,unknownAcknowledgements:1});
  });

  it('does not accept global quote offsets outside the actual cached call chunk', () => {
    const text = quote+' '+quote;
    const s = snapshot({sourceUpdates:[source({content:text,transcriptSegments:[]})],chunkPlans:[{job_id:'synthetic-job',chunks:[{index:0,start:0,end:quote.length},{index:1,start:quote.length,end:text.length}]}]});
    Object.assign(s.calls[0].result.value.highlights[0],{start:quote.length+1,end:text.length});
    expect(inspect(s).report.citations).toMatchObject({literal:1,supportedOffsets:0,unsupportedOffsets:1});
  });

  it('groups repaired coverage while retaining separate financial calls and reduction groups', () => {
    const s = v2snapshot();
    s.calls.push(call({id:'synthetic-repair',call_key:'summary:v2:chunk:0:repair:1',result:structuredClone(s.calls[0].result)}));
    s.calls.push(call({id:'synthetic-reduction-one',call_key:'summary-reduce:v2:level:0:group:0',result:{value:{readComplete:true,highlights:[]}}}));
    s.calls.push(call({id:'synthetic-reduction-two',call_key:'summary-reduce:v2:level:0:group:1',result:{value:{readComplete:true,highlights:[]}}}));
    s.calls.push(call({id:'synthetic-verification',call_key:'summary:v2:verify:0',result:{value:{readComplete:true,verdicts:[]}}}));
    const r = inspect(s).report;
    expect(r.chunks).toMatchObject({expectedRoleChunks:1,cachedRoleChunks:1,repairCalls:1,reductionCalls:2,verificationCalls:1,unexpectedCallKeys:0});
    expect(r.calls).toMatchObject({uniqueCalls:5,duplicateKeyGroups:0});
    expect(r.costs.settledUsd).toBe(.02);
  });
});

describe('baseline and latency diagnostics', () => {
  it('reports inventory additions/removals/changes as counts without exposing identifiers', () => {
    const before = snapshot();
    const s = snapshot({baseline:{sourceUpdates:before.sourceUpdates,jobs:before.jobs,calls:before.calls},sourceUpdates:[source({title:'Changed synthetic title'})],calls:[call({id:'new-synthetic-call'})]});
    expect(inspect(s).report.baseline).toMatchObject({provided:true,sourceUpdates:{added:0,removed:0,changed:1,unchanged:0},jobs:{unchanged:1},calls:{added:1,removed:1,changed:0}});
    expect(inspect().report.baseline).toEqual({provided:false});
  });

  it('summarizes native timestamp latency and unavailable data without outputting timestamps', () => {
    const s = snapshot({calls:[call({created_at:'2026-01-01T00:00:00Z',result_at:'2026-01-01T00:00:02Z'}),call({id:'synthetic-no-clock',call_key:'summary:1',result_at:null})],jobs:[job({created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:03Z',published_at:'2026-01-01T00:00:04Z'})]});
    const r = inspect(s).report;
    expect(r.latency.callsCreatedToResult).toMatchObject({available:1,unavailable:1,invalid:0,minMs:2000,maxMs:2000,meanMs:2000,p50Ms:2000,p95Ms:2000});
    expect(r.latency.jobsCreatedToUpdated.maxMs).toBe(3000);
    expect(r.latency.jobsCreatedToPublished.maxMs).toBe(4000);
    expect(r.latency.jobsCreatedToPrepared.unavailable).toBe(1);
    expect(JSON.stringify(r)).not.toContain('2026-01-01');
  });

  it('counts malformed/reversed latency as invalid and never uses update age as publication', () => {
    const s = snapshot({calls:[call({created_at:'2026-01-01T00:00:02Z',result_at:'2026-01-01T00:00:00Z'})],jobs:[job({created_at:'private-clock-string',updated_at:'2026-01-01T00:00:00Z'})]});
    expect(inspect(s).report.latency.callsCreatedToResult).toMatchObject({available:0,invalid:1,meanMs:null});
    expect(inspect(s).report.latency.jobsCreatedToPublished).toMatchObject({available:0,unavailable:1});
    s.calls[0].created_at = '2026-02-30T00:00:00Z'; s.calls[0].result_at = '2026-03-03T00:00:00Z';
    expect(inspect(s).report.latency.callsCreatedToResult).toMatchObject({available:0,invalid:1});
  });
});

describe('CLI private-artifact safety', () => {
  const cleanup:string[] = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path,{recursive:true,force:true}))); });
  async function paths() {
    await mkdir(resolve('.local'),{recursive:true});
    const directory = await mkdtemp(resolve('.local/analysis-report-test-')); cleanup.push(directory);
    const input = join(directory,'private-input.json'), output = join(directory,'safe.json'), review = join(directory,'private-review.json');
    await writeFile(input,JSON.stringify(snapshot()));
    const stdout:string[] = [], stderr:string[] = [];
    const io = {out:(s:string) => stdout.push(s),err:(s:string) => stderr.push(s)};
    const args = ['--input',input,'--output',output,'--review-output',review];
    return {directory,input,output,review,stdout,stderr,io,args};
  }

  it('writes separate sanitized/private artifacts with 0600 permissions and constant console output', async () => {
    const p = await paths();
    expect(await runCli(p.args,p.io)).toBe(0);
    expect(p.stderr).toEqual([]); expect(p.stdout).toEqual(['Offline report written. Manual review required.']);
    expect((await stat(p.review)).mode & 0o777).toBe(0o600);
    expect(await readFile(p.output,'utf8')).not.toContain(quote);
    expect(await readFile(p.review,'utf8')).toContain(quote);
    expect(JSON.parse(await readFile(p.output,'utf8')).manualReviewRequired).toBe(true);
  });

  it('writes paid invalid originals and their repair privately, retaining false/null and refusing overwrite', async () => {
    const p = await paths();
    const values = [null,false,'PRIVATE_RAW_INVALID_ORIGINAL',[],{highlights:'invalid'},{highlights:[false,null]}];
    const rows = values.map((value,index) => call({id:'synthetic-invalid-'+index,call_key:'summary:v2:chunk:'+index,validation_error_code:'analysis_invalid_output',result:{value,access_token:'PRIVATE_TRANSPORT_SECRET'}}));
    rows.push(call({id:'synthetic-repair',call_key:'summary:v2:chunk:0:repair:1'}));
    await writeFile(p.input,JSON.stringify(snapshot({calls:rows})));
    expect(await runCli(p.args,p.io)).toBe(0);
    const publicText = await readFile(p.output,'utf8'), privateText = await readFile(p.review,'utf8');
    const report = JSON.parse(publicText), review = JSON.parse(privateText);
    expect(report.calls).toMatchObject({rows:7,uniqueCalls:7,materializedResults:7,markedInvalidResults:6,malformedRawResults:6});
    expect(report.costs).toMatchObject({knownCalls:7,settledUsd:.028,commitmentUsd:.028});
    expect(report.semanticQuality).toBe('unreviewed');
    expect(publicText).not.toContain('PRIVATE_RAW_INVALID_ORIGINAL');
    expect(privateText).toContain('PRIVATE_RAW_INVALID_ORIGINAL');
    expect(privateText).not.toContain('PRIVATE_TRANSPORT_SECRET');
    expect(privateText).not.toContain('access_token');
    expect(review.items[0].jobs[0].calls.slice(0,6).map((c:Row) => c.result.value)).toEqual(values);
    for (const path of [p.output,p.review]) expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await runCli(p.args,p.io)).toBe(1);
    expect(p.stderr).toEqual(['output_already_exists']);
    expect(await readFile(p.output,'utf8')).toBe(publicText);
    expect(await readFile(p.review,'utf8')).toBe(privateText);
  });

  it('refuses input/output overlap and existing outputs without changing input', async () => {
    const p = await paths(), before = await readFile(p.input,'utf8');
    expect(await runCli(['--input',p.input,'--output',p.input,'--review-output',p.review],p.io)).toBe(1);
    expect(p.stderr).toContain('input_output_paths_overlap');
    await writeFile(p.output,'existing synthetic output');
    expect(await runCli(p.args,p.io)).toBe(1);
    expect(await readFile(p.input,'utf8')).toBe(before);
    expect(await readFile(p.output,'utf8')).toBe('existing synthetic output');
  });

  it('refuses review symlinks, unignored review locations and tracked public outputs', async () => {
    const p = await paths();
    await symlink(p.input,p.review);
    expect(await runCli(p.args,p.io)).toBe(1);
    expect(p.stderr).toContain('output_already_exists');
    const unignored = resolve('tests/synthetic-private-review-never-written.json');
    expect(await runCli(['--input',p.input,'--output',p.output,'--review-output',unignored],p.io)).toBe(1);
    expect(await runCli(['--input',p.input,'--output',resolve('package.json'),'--review-output',join(p.directory,'other-review.json')],p.io)).toBe(1);
    expect(p.stderr).toContain('sanitized_output_is_tracked');
  });

  it('emits fixed diagnostics for malformed private JSON without echoing content or filenames', async () => {
    const p = await paths(); await writeFile(p.input,'{"private":"SYNTHETIC_SECRET"');
    expect(await runCli(p.args,p.io)).toBe(1);
    expect(p.stderr).toEqual(['invalid_snapshot_json']); expect(p.stdout).toEqual([]);
  });

  it('treats spaces, brackets and shell punctuation in ignored filenames literally', async () => {
    const p = await paths();
    const input = join(p.directory,'private [1] $literal.json'), output = join(p.directory,'safe [x]; literal.json'), review = join(p.directory,'review [2] $literal.json');
    await writeFile(input,JSON.stringify(snapshot()));
    expect(await runCli(['--input',input,'--output',output,'--review-output',review],p.io)).toBe(0);
    expect(JSON.parse(await readFile(output,'utf8')).manualReviewRequired).toBe(true);
    expect((await stat(review)).mode & 0o777).toBe(0o600);
  });

  it('has no app imports or provider SDK access and prints no snapshot in actual CLI help', () => {
    const output = execFileSync(process.execPath,['scripts/analysis-quality-report.mjs','--help'],{encoding:'utf8'});
    expect(output).toContain('--review-output'); expect(output).not.toContain(quote);
  });
});
