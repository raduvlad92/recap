import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Standalone offline JavaScript intentionally has no application imports.
import { evaluateSnapshot, evaluationEligibility, parseCallKey, parseSnapshot } from '../scripts/analysis-quality-report.mjs';

type Row = Record<string, any>;
const text='Nvidia makes RTX 5090. The GPU measured a 45 FPS result. Tape to Tape appears in the closing sentence.';
const hash=createHash('sha256').update(text).digest('hex');
const passage={id:'fixture-passage',start:0,end:text.length,text};
const source=(record:Row={},id='fixture-update'):Row=>({user_id:'fixture-owner',id,source_id:'fixture-source',record:{id,sourceId:'fixture-source',format:'video',contentKind:'transcript',content:text,coverage:'Partial saved captions',...record}});
const job=(extra:Row={}):Row=>({id:'fixture-job',user_id:'fixture-owner',update_id:'fixture-update',source_id:'fixture-source',task:'summary',state:'failed',rule_version:'content-v4',content_hash:hash,generation_contract_hash:'fixture-v4-hash',...extra});
const call=(extra:Row={}):Row=>({id:'fixture-call',job_id:'fixture-job',user_id:'fixture-owner',call_key:'summary:v4:chunk:0',maximum_usd:'0.100000000000',actual_usd:'0.000200000000',observed_usd:'0.000200000000',state:'settled',result:{value:{readComplete:true,lastPassageId:passage.id,highlights:[{text:'The GPU measured a 45 FPS result.',passageIds:[passage.id]}]}},...extra});
const plan=(id='fixture-job',protocolVersion='content-v4')=>({job_id:id,protocolVersion,chunks:[{index:0,start:0,end:text.length,passages:[passage]}]});
const snapshot=(extra:Row={}):Row=>({sourceUpdates:[source()],jobs:[job()],calls:[call()],chunkPlans:[plan()],...extra});
const inspect=(s:Row=snapshot())=>evaluateSnapshot(parseSnapshot(JSON.stringify(s)));
const baselineRecord=():Row=>({videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'none'},videoHighlights:[{text:'The GPU measured a 45 FPS result.'}],videoKeywords:[{label:'GPU',ranges:[]}],processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'blocked',keywords:'blocked'}});

describe('offline v4 protocol, immutable history and cost evidence',()=>{
 it.each(['summary:v4:chunk:0','extractor:v4:chunk:12:repair:1','checker:v4:chunk:1','summary-reduce:v4:level:2:group:4','summary:v4:verify:0'])('recognizes the separate v4 namespace %s',key=>{
  expect(parseCallKey(key)?.protocol).toBe('content-v4');
 });
 it.each(['summary:v4:chunk:-1','summary:v4:verify:1','summary:v4:chunk:0:repair:2','summary:v4:chunk:0:extra','summary:v5:chunk:0'])('rejects malformed or unsupported namespaces %s',key=>{
  expect(parseCallKey(key)).toBeNull();
 });
 it('uses v4 passage acknowledgements without treating H3 calls as compatible work',()=>{
  expect(inspect().report).toMatchObject({jobs:{protocols:{'content-v4':1}},chunks:{expectedRoleChunks:1,cachedRoleChunks:1,acknowledgedRoleChunks:1},semanticQuality:'unreviewed'});
  const s=snapshot({calls:[call({call_key:'summary:v3:chunk:0'})]});
  expect(inspect(s).report.chunks).toMatchObject({missingRoleChunks:1,cachedRoleChunks:0,unexpectedCallKeys:1});
 });
 it('retains old attempts and unresolved money beside an explicitly linked v4 successor',()=>{
  const old=job({id:'fixture-old',rule_version:'content-v3'}),next=job({generation_predecessor_job_id:old.id});
  const held=call({id:'fixture-hold',job_id:old.id,call_key:'summary:v3:chunk:0',actual_usd:null,observed_usd:null,state:'unknown',result:null});
  const s=snapshot({jobs:[old,next],calls:[held,call()]});
  const before=JSON.stringify(s),{report,review}=inspect(s);
  expect(report.tasks).toMatchObject({logicalTasks:1,jobAttempts:2,linkedSuccessorAttempts:1,predecessorAttempts:1});
  expect(report.costs).toMatchObject({knownCalls:1,unknownCalls:1,settledUsd:.0002,unknownHoldUsd:.1,commitmentUsd:.1002,unknownChargesRemainHolds:true});
  expect(review.items[0].jobs).toHaveLength(2);expect(JSON.stringify(s)).toBe(before);
 });
 it('reports v4 empty declarations independently without promoting them to reviewed quality',()=>{
  const result={state:'empty',patch:{videoHighlights:[]},evidence:{protocolVersion:'content-v4',emptyDisposition:'no_findings_reviewed'}};
  const {report}=inspect(snapshot({jobs:[job({state:'published',result})]}));
  expect(report.summaries).toMatchObject({v4EmptyResults:1,v4EmptyWithDeclaredNoFindings:1,v3EmptyResults:0,historicalPublishedEmptyUnreviewed:0,independentEmptyAcceptance:'unreviewed'});
  expect(report.semanticQuality).toBe('unreviewed');
 });
 it('keeps v4 lexical references bound to the supplied chunk map and treats absent maps as unknown',()=>{
  const units=[{id:'u0_6',start:0,end:6,text:'Nvidia'},{id:'u7_12',start:7,end:12,text:'makes'},{id:'u13_16',start:13,end:16,text:'RTX'},{id:'u17_21',start:17,end:21,text:'5090'}];
  const candidate={label:'RTX 5090',kind:'product',confidence:100,reason:'Explicit source name.',firstUnitId:'u13_16',lastUnitId:'u17_21'};
  const s=snapshot({jobs:[job({task:'keywords'})],calls:[call({call_key:'extractor:v4:chunk:0',result:{value:{readComplete:true,lastPassageId:passage.id,candidates:[candidate]}}})]});
  s.chunkPlans[0].chunks[0].lexicalUnits=units;
  expect(inspect(s).report.citations).toMatchObject({lexicalReferenceItems:1,suppliedLexicalReferencesSupported:1,unsupportedLexicalReferences:0,passageReferenceItems:0});
  const wrong=structuredClone(s);wrong.calls[0].result.value.candidates[0].lastUnitId='not-supplied';
  expect(inspect(wrong).report.citations.unsupportedLexicalReferences).toBe(1);
  const absent=structuredClone(s);delete absent.chunkPlans[0].chunks[0].lexicalUnits;
  expect(inspect(absent).report.citations).toMatchObject({lexicalReferenceScopeUnknown:1,suppliedLexicalReferencesSupported:0});
 });
 it('retains immutable proposal lineage and opaque malformed response evidence privately',()=>{
  const lineage={proposalId:'private-proposal',originalResponseHash:'private-response-hash',originalProposalHash:'private-proposal-hash',originalText:'Prior unsupported wording.',originalPassageIds:[passage.id],corrected:true,correctionReason:'Narrow to source support.'};
  const malformed='{"readComplete":true} extra {"readComplete":false}';
  const result={state:'ready',patch:{videoHighlights:[{text:'The GPU measured a 45 FPS result.'}]},evidence:{protocolVersion:'content-v4',selected:[{text:'The GPU measured a 45 FPS result.',proposalId:lineage.proposalId,lineage:[lineage]}]}};
  const s=snapshot({jobs:[job({result})],calls:[call({result:{value:{rawOutput:malformed,finishReason:'stop'},validationError:'analysis_invalid_json',access_token:'TRANSPORT_SECRET'}})]});
  const {report,review}=inspect(s),privateText=JSON.stringify(review);
  expect(review.items[0].jobs[0].result.evidence.selected[0].lineage).toEqual([lineage]);
  expect(report.proposalLineage).toMatchObject({lineageEntries:1,correctedEntries:1,semanticContinuity:'unreviewed'});
  expect(review.items[0].jobs[0].calls[0].result).toEqual({value:{rawOutput:malformed,finishReason:'stop'},validationError:'analysis_invalid_json'});
  expect(privateText).not.toContain('TRANSPORT_SECRET');expect(JSON.stringify(report)).not.toContain(malformed);expect(JSON.stringify(report)).not.toContain(lineage.proposalId);
 });
});

describe('frozen evaluation admission protects existing task annotations',()=>{
 it('ignores blocked processing overrides when the content-bound annotation is valid',()=>{
  const record=source(baselineRecord()).record,before=JSON.stringify(record);
  expect(evaluationEligibility(record)).toMatchObject({contentHash:hash,sourceContentAssessment:'declaredPartial',summary:{decision:'protected'},keywords:{decision:'protected'}});
  expect(JSON.stringify(record)).toBe(before);
 });
 it('preserves task independence, explicit unknown keyword provenance and stale source binding',()=>{
  expect(evaluationEligibility(source({...baselineRecord(),keywordContentHash:null}).record)).toMatchObject({summary:{decision:'protected'},keywords:{decision:'eligible'}});
  expect(evaluationEligibility(source({...baselineRecord(),videoSummary:{ruleVersion:'takeaways-v1',status:'unavailable',captionHash:hash,timingBasis:'none'},keywordContentHash:hash}).record)).toMatchObject({summary:{decision:'eligible'},keywords:{decision:'protected'}});
  expect(evaluationEligibility(source({...baselineRecord(),content:text+' Later recovered text.'}).record)).toMatchObject({summary:{decision:'eligible'},keywords:{decision:'eligible'}});
 });
 it('holds malformed matching annotations for review instead of silently reprocessing them',()=>{
  const record=source({...baselineRecord(),videoHighlights:[{text:'Unsupported seek time.',startSeconds:999}],videoKeywords:[{label:'GPU',ranges:[{startSeconds:20,endSeconds:10}]}]}).record;
  expect(evaluationEligibility(record)).toMatchObject({summary:{decision:'review'},keywords:{decision:'review'}});
 });
 it('assesses all twenty frozen identities but permits at most nineteen newly generated video results',()=>{
  const sources=Array.from({length:20},(_,i)=>source(i===3?baselineRecord():{},'fixture-'+i));
  const {report,review}=inspect(snapshot({sourceUpdates:sources,jobs:[],calls:[],chunkPlans:[],sample:{desiredCount:20}}));
  expect(report.evaluation).toMatchObject({assessmentCount:20,fullyProtectedRecords:1,maximumNewVideoResults:19,tasks:{summary:{protected:1,eligible:19},keywords:{protected:1,eligible:19}},originalCaptureVerified:false,genuineWholeTaskEmptyCoverage:'unverified',semanticAcceptance:'unreviewed'});
  expect(report.sourceCompleteness).toMatchObject({total:20,declaredPartial:20,declaredComplete:0});
  expect(review.items[3]).toMatchObject({eligibility:{summary:{decision:'protected'},keywords:{decision:'protected'}},reviewer:{type:'unreviewed',humanApproval:false}});
  const safe=JSON.stringify(report);for(const secret of [text,hash,'fixture-owner','fixture-3'])expect(safe).not.toContain(secret);
 });
 it('never makes unusable input eligible or claims a real empty from an empty category tag',()=>{
  const s=snapshot({sourceUpdates:[source({content:'',contentKind:'metadata_only'})],jobs:[],calls:[],chunkPlans:[],sample:{categories:[{update_id:'fixture-update',categories:['empty']}]}});
  expect(inspect(s).report.evaluation).toMatchObject({maximumNewVideoResults:0,tasks:{summary:{unusable:1},keywords:{unusable:1}},genuineWholeTaskEmptyCoverage:'unverified'});
 });
});

describe('referenced paid prefix is reused diagnostically without financial duplication',()=>{
 const parent=job({id:'fixture-parent',rule_version:'content-v3'}),successor=job({rule_version:'content-v3',generation_predecessor_job_id:parent.id});
 const prefix=call({id:'fixture-prefix',job_id:parent.id,call_key:'summary:v3:chunk:0',actual_usd:'0.000300000000',observed_usd:'0.000300000000'});
 const final=call({call_key:'summary:v3:verify:0',result:{value:{readComplete:true,verdicts:[{id:'0',supported:true}]}}});
 const referenced=(extra:Row={}):Row=>structuredClone(snapshot({jobs:[parent,successor],calls:[prefix,final],chunkPlans:[plan(parent.id,'content-v3'),plan(successor.id,'content-v3')],callReferences:[{job_id:successor.id,call_id:prefix.id,call_key:prefix.call_key}],baseline:{sourceUpdates:[source()],jobs:[parent],calls:[prefix]},...extra}));
 it('counts one original ledger row once while exposing its reference to successor coverage',()=>{
  const s=referenced(),before=JSON.stringify(s),{report,review}=inspect(s);
  expect(report.cacheReferences).toMatchObject({supplied:1,identityBound:1,knownSettledMaterialized:1,monetaryRowsCopied:0,executionAuthority:'not_verified'});
  expect(report.chunks).toMatchObject({expectedRoleChunks:2,cachedRoleChunks:2,missingRoleChunks:0});
  expect(report.costs).toMatchObject({knownCalls:2,settledUsd:.0005,commitmentUsd:.0005,newSinceBaseline:{scope:'new_monetary_row_ids_only',rows:1,settledUsd:.0002,commitmentUsd:.0002,changedExistingRows:0}});
  expect(review.items[0].jobs[1].callReferences).toEqual([{call_id:prefix.id,call_key:prefix.call_key}]);
  expect(JSON.stringify(s)).toBe(before);
 });
 it.each(['owner','source','revision','task','hash','key','missing','unknown-cost','state-cost'])('refuses to treat a %s mismatch as reusable saved work',kind=>{
  const s=referenced();
  if(kind==='owner')s.jobs[1].user_id='different-owner';
  if(kind==='source')s.jobs[1].source_id='different-source';
  if(kind==='revision')s.jobs[1].source_revision='different-revision';
  if(kind==='task')s.jobs[1].task='keywords';
  if(kind==='hash')s.jobs[1].content_hash='different-hash';
  if(kind==='key')s.callReferences[0].call_key='summary:v3:chunk:1';
  if(kind==='missing')s.callReferences[0].call_id='missing-call';
  if(kind==='unknown-cost'){s.calls[0].actual_usd=null;s.calls[0].state='unknown';}
  if(kind==='state-cost')s.calls[0].state='unknown';
  const {report}=inspect(s);
  expect(report.cacheReferences.knownSettledMaterialized).toBe(0);
  if(kind==='owner')expect(report.jobs.sourceUnavailable).toBe(1);else expect(report.chunks.missingRoleChunks).toBeGreaterThan(0);
  expect(report.calls.uniqueCalls).toBe(2);
 });
 it('rejects duplicate/malformed references without revealing their private values',()=>{
  const s=referenced();s.callReferences.push(s.callReferences[0]);
  expect(()=>inspect(s)).toThrow('duplicate_call_reference');
  const invalid=referenced({callReferences:[{job_id:'missing',call_id:'SECRET'}]});
  expect(()=>inspect(invalid)).toThrow('invalid_call_reference');
 });
});
