import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
// @ts-expect-error Standalone offline JavaScript intentionally has no application imports.
import { evaluateSnapshot, parseCallKey, parseSnapshot, runCli } from '../scripts/analysis-quality-report.mjs';

// Exercise actual private file permissions without invoking Git in this offline task.
// This simulates repository metadata only; the original CLI/Git integration tests stay unchanged.
vi.mock('node:child_process', () => ({execFileSync:(executable:string,args:string[]) => {
  if (executable !== 'git') throw new Error('unexpected_subprocess');
  if (args.includes('rev-parse')) return process.cwd();
  if (args.includes('ls-files')) return '';
  if (args.includes('check-ignore') && args.at(-1)?.startsWith('.local/')) return args.at(-1);
  throw new Error('unexpected_repository_metadata_request');
}}));

type Row = Record<string, any>;
const text = 'Synthetic testing reports 45 FPS with an explicitly limited sample.';
const passage = {id:'synthetic-passage',start:0,end:text.length,text};
const source = (record:Row = {}, row:Row = {}):Row => ({user_id:'synthetic-owner',id:'synthetic-update',...row,record:{id:row.id ?? 'synthetic-update',content:text,contentKind:'transcript',format:'video',coverage:'Captured captions',...record}});
const job = (overrides:Row = {}):Row => ({id:'synthetic-job',user_id:'synthetic-owner',update_id:'synthetic-update',content_hash:'synthetic-content-hash',task:'summary',state:'prepared',rule_version:'content-v3',generation_contract_hash:'synthetic-generation-hash',...overrides});
const call = (overrides:Row = {}):Row => ({id:'synthetic-call',job_id:'synthetic-job',user_id:'synthetic-owner',call_key:'summary:v3:chunk:0',maximum_usd:'0.010000000000',observed_usd:'0.000000000001',actual_usd:'0.000000000001',state:'settled',result:{value:{readComplete:true,lastPassageId:passage.id,highlights:[{text:'Synthetic testing reports a result.',passageIds:[passage.id]}]}},...overrides});
const output = (state = 'ready', disposition?:unknown):Row => ({state,patch:{videoHighlights:state === 'empty' ? [] : [{text:'Synthetic testing reports a result.'}],videoSummary:{status:'ready'}},pending:[],evidence:{protocolVersion:'content-v3',coverage:[{start:0,end:text.length}],...(disposition === undefined ? {} : {emptyDisposition:disposition})}});
const snapshot = (overrides:Row = {}):Row => ({sourceUpdates:[source()],jobs:[job()],calls:[call()],chunkPlans:[{job_id:'synthetic-job',protocolVersion:'content-v3',chunks:[{index:0,start:0,end:text.length,passages:[passage]}]}],...overrides});
const inspect = (s:Row = snapshot()) => evaluateSnapshot(parseSnapshot(JSON.stringify(s)));

describe('offline content-v3 protocol', () => {
  it.each([
    ['summary:v3:chunk:12','chunk','summary',12,0],
    ['extractor:v3:chunk:2:repair:1','chunk','extractor',2,1],
    ['checker:v3:chunk:0','chunk','checker',0,0],
    ['summary-reduce:v3:level:2:group:5','reduction',undefined,undefined,0],
    ['summary-reduce:v3:level:0:group:0:repair:1','reduction',undefined,undefined,1],
    ['summary:v3:verify:0','verification',undefined,undefined,0],
    ['summary:v3:verify:0:repair:1','verification',undefined,undefined,1],
  ])('parses exact v3 key %s', (value,kind,role,index,repairAttempt) => {
    expect(parseCallKey(value)).toEqual({protocol:'content-v3',kind,...(role ? {role,index} : {}),baseKey:String(value).replace(/:repair:1$/,''),repairAttempt});
  });

  it.each([
    'summary:v3:chunk:-1','summary:v3:chunk:1.5','summary:v3:chunk:0:repair:0',
    'summary:v3:chunk:0:repair:2','summary:v3:chunk:0:repair:1:repair:1',
    'summary:v3:chunk:0:extra','extractor:v3:verify:0','checker:v3:verify:0',
    'summary:v3:verify:1','summary-reduce:v3:level:0','summary-reduce:v3:level:0:group:-1',
    'summary:v5:chunk:0',' summary:v3:chunk:0','summary:v3:chunk:0\n',
  ])('rejects malformed versioned key %j', value => {
    expect(parseCallKey(value)).toBeNull();
  });

  it('uses v3 manifests, references and repair groups without merging monetary attempts', () => {
    const s = snapshot();
    s.calls[0].result = {value:false};
    s.calls[0].validation_error_code = 'synthetic-invalid';
    s.calls.push(call({id:'synthetic-repair',call_key:'summary:v3:chunk:0:repair:1'}));
    s.calls.push(call({id:'synthetic-reducer',call_key:'summary-reduce:v3:level:0:group:0',result:{value:{readComplete:true,highlights:[]}}}));
    s.calls.push(call({id:'synthetic-verifier',call_key:'summary:v3:verify:0',result:{value:{readComplete:true,verdicts:[]}}}));
    const {report,review} = inspect(s);
    expect(report.jobs).toMatchObject({protocols:{'content-v3':1},protocolDisagreements:0});
    expect(report.chunks).toMatchObject({expectedRoleChunks:1,cachedRoleChunks:1,acknowledgedRoleChunks:1,repairCalls:1,reductionCalls:1,verificationCalls:1,unknownAcknowledgements:1,unexpectedCallKeys:0});
    expect(report.citations).toMatchObject({total:0,passageReferenceItems:1,suppliedPassageReferencesSupported:1});
    expect(report.calls).toMatchObject({uniqueCalls:4,materializedResults:4,markedInvalidResults:1,rawValueTypes:{boolean:1,object:3}});
    expect(report.costs).toMatchObject({knownCalls:4,settledUsd:.000000000004,commitmentUsd:.000000000004});
    expect(review.items[0].jobs[0].calls[0].result.value).toBe(false);
    expect(report).toMatchObject({semanticQuality:'unreviewed',fullOriginalCoverage:'unverified'});
  });

  it.each(['summary:0','summary:v2:chunk:0','summary-reduce:0','summary-reduce:v2:level:0:group:0','summary:v2:verify:0'])('never falls back to a historical call %s for a v3 job', call_key => {
    const s = snapshot({calls:[call({call_key})]});
    delete s.chunkPlans[0].protocolVersion;
    const {report} = inspect(s);
    expect(report.chunks).toMatchObject({expectedRoleChunks:1,cachedRoleChunks:0,missingRoleChunks:1,acknowledgedRoleChunks:0,unexpectedCallKeys:1,reductionCalls:0,verificationCalls:0});
    expect(report.citations).toMatchObject({total:0,passageReferenceItems:1,passageReferenceScopeUnknown:1,suppliedPassageReferencesSupported:0});
  });

  it.each(['manifest','evidence','call'])('infers v3 from %s when the job has no rule version', origin => {
    const s = snapshot({jobs:[job({rule_version:null})]});
    if (origin !== 'manifest') delete s.chunkPlans[0].protocolVersion;
    if (origin === 'evidence') s.jobs[0].result = output();
    expect(inspect(s).report.chunks).toMatchObject({expectedRoleChunks:1,acknowledgedRoleChunks:1,unexpectedCallKeys:0});
  });

  it('keeps a v3 rule authoritative and reports a conflicting v2 manifest', () => {
    const s = snapshot(); s.chunkPlans[0].protocolVersion = 'content-v2';
    s.calls[0].call_key = 'summary:v2:chunk:0';
    expect(inspect(s).report).toMatchObject({jobs:{protocolDisagreements:1,protocols:{'content-v3':1,'content-v2':0}},chunks:{missingRoleChunks:1,cachedRoleChunks:0,unexpectedCallKeys:1}});
  });

  it('keeps v3 acknowledgments unknown without original passages instead of accepting endQuote', () => {
    const s = snapshot({jobs:[job({result:output()})],chunkPlans:null});
    s.calls[0].result.value.endQuote = text;
    const {report} = inspect(s);
    expect(report.jobs.completeSavedTextCoverage).toBe(1);
    expect(report.chunks).toMatchObject({expectedRoleChunks:1,acknowledgedRoleChunks:0,unknownAcknowledgements:1});
    expect(report.citations).toMatchObject({passageReferenceScopeUnknown:1,total:0});
  });

  it('checks the v3 saved passage tail and references against their actual chunk', () => {
    const s = snapshot();
    s.chunkPlans[0].chunks[0].passages[0] = {...passage,end:10,text:text.slice(0,10)};
    expect(inspect(s).report).toMatchObject({chunks:{invalidAcknowledgements:1,acknowledgedRoleChunks:0},citations:{unsupportedPassageReferences:1}});
    const wrong = snapshot(); wrong.calls[0].result.value.lastPassageId = 'synthetic-wrong-tail';
    wrong.calls[0].result.value.highlights[0].passageIds = ['synthetic-wrong-reference'];
    expect(inspect(wrong).report).toMatchObject({chunks:{invalidAcknowledgements:1},citations:{unsupportedPassageReferences:1}});
  });

  it('counts v3 final reference evidence as unknown without a binding manifest rather than as a missing legacy quote', () => {
    const r = output(); r.evidence.findings = [{text:'Synthetic finding.',passageIds:[passage.id]}];
    const {report} = inspect(snapshot({jobs:[job({result:r})],calls:[]}));
    expect(report.citations).toMatchObject({total:0,missingQuotes:0,passageReferenceItems:1,passageReferenceScopeUnknown:1});
  });

  it('requires extractor and checker chunks independently under v3', () => {
    const s = snapshot({jobs:[job({task:'keywords'})],calls:[call({call_key:'extractor:v3:chunk:0',result:{value:{readComplete:true,lastPassageId:passage.id,candidates:[]}}})]});
    expect(inspect(s).report.chunks).toMatchObject({expectedRoleChunks:2,cachedRoleChunks:1,missingRoleChunks:1,acknowledgedRoleChunks:1});
  });
});

describe('summary states and explicit v3 empty dispositions', () => {
  it.each([
    ['findings_expected','findings_expected',0,1],
    ['no_findings_reviewed','no_findings_reviewed',1,0],
    ['unreviewed','unreviewed',0,1],
    [undefined,'missing',0,1],
    [null,'missing',0,1],
    ['SYNTHETIC_PRIVATE_DISPOSITION','invalid',0,1],
    [{private:'SYNTHETIC_PRIVATE_DISPOSITION'},'invalid',0,1],
  ])('counts declared empty disposition %# without asserting semantic acceptance', (disposition,bucket,declared,unreviewed) => {
    const {report,review} = inspect(snapshot({jobs:[job({state:'published',result:output('empty',disposition)})],calls:[]}));
    expect(report.summaries).toMatchObject({acceptanceBasis:'state_only_not_semantic_quality',independentEmptyAcceptance:'unreviewed',acceptedNonemptyByState:0,emptyResultsByState:1,publishedAttempts:1,publishedEmptyAttempts:1,historicalPublishedEmptyUnreviewed:0,v3EmptyResults:1,v3EmptyWithDeclaredNoFindings:declared,v3EmptyWithoutReviewedDisposition:unreviewed,v3EmptyDispositions:{[String(bucket)]:1}});
    expect(report).toMatchObject({manualReviewRequired:true,semanticQuality:'unreviewed',fullOriginalCoverage:'unverified'});
    expect(review.overall.verdict).toBe('unreviewed');
    expect(JSON.stringify(report)).not.toContain('SYNTHETIC_PRIVATE_DISPOSITION');
    if (disposition !== undefined) expect(review.items[0].jobs[0].result.evidence.emptyDisposition).toEqual(typeof disposition === 'object' && disposition !== null ? {} : disposition);
  });

  it.each([undefined,'content-v2'])('does not treat a no-findings declaration without v3 evidence (%s) as a v3 empty disposition contract', protocolVersion => {
    const r = output('empty','no_findings_reviewed');
    if (protocolVersion) r.evidence.protocolVersion = protocolVersion; else delete r.evidence.protocolVersion;
    const {report} = inspect(snapshot({jobs:[job({result:r})],calls:[]}));
    expect(report.summaries).toMatchObject({v3EmptyResults:1,v3EmptyWithDeclaredNoFindings:0,v3EmptyWithoutReviewedDisposition:1,v3EmptyWithoutV3Evidence:1});
  });

  it('keeps accepted nonempty states separate from empty and contradictory raw output', () => {
    const nonempty = job({id:'synthetic-nonempty',result:output()}), emptyReady = output();
    emptyReady.patch.videoHighlights = [];
    const contradictory = output('empty','no_findings_reviewed'); contradictory.patch.videoHighlights = [{text:'Synthetic retained finding.'}];
    const {report} = inspect(snapshot({jobs:[nonempty,job({id:'synthetic-empty-ready',result:emptyReady}),job({id:'synthetic-contradiction',result:contradictory})],calls:[],chunkPlans:[]}));
    expect(report.summaries).toMatchObject({acceptedNonemptyByState:1,readyResultsWithoutNonemptyHighlights:1,emptyResultsByState:1,emptyResultsWithNonemptyHighlights:1,v3EmptyResults:2});
    expect(report.semanticQuality).toBe('unreviewed');
  });

  it('preserves historical v2 empty publication while reporting a currently withheld source and independent successor attempt', () => {
    const historical = output('empty'); historical.evidence.protocolVersion = 'content-v2';
    const old = job({id:'synthetic-v2',rule_version:'content-v2',state:'published',result:historical,generation_contract_hash:null});
    const next = job({generation_predecessor_job_id:old.id,result:output()});
    const s = snapshot({sourceUpdates:[source({videoSummary:{status:'ready',captionHash:'synthetic-hash'},videoHighlights:[],processing:{recap:'failed',reason:'analysis_summary_omission'}})],jobs:[old,next],calls:[]});
    const before = JSON.stringify(s), {report,review} = inspect(s);
    expect(report.jobs).toMatchObject({total:2,protocols:{'content-v2':1,'content-v3':1},states:{published:1,prepared:1}});
    expect(report.tasks).toMatchObject({logicalTasks:1,jobAttempts:2,repeatedTaskAttempts:1,predecessorReferences:1,linkedSuccessorAttempts:1,predecessorAttempts:1,generationContractHashPresent:1,generationContractHashMissing:1});
    expect(report.summaries).toMatchObject({acceptedNonemptyByState:1,publishedEmptyAttempts:1,historicalPublishedEmptyUnreviewed:1,v3EmptyResults:0,v3EmptyWithoutReviewedDisposition:0,currentSources:{readyEmpty:1,withheldForOmission:1}});
    expect(review.items[0].source.record.processing).toEqual(s.sourceUpdates[0].record.processing);
    expect(review.items[0].jobs[1]).toMatchObject({rule_version:'content-v3',generation_predecessor_job_id:'synthetic-v2',generation_contract_hash:'synthetic-generation-hash'});
    expect(JSON.stringify(s)).toBe(before);
  });

  it('leaves a historical D25 empty source unreviewed without inventing a v3 contract failure', () => {
    const {report} = inspect(snapshot({sourceUpdates:[source({videoSummary:{status:'ready'},videoHighlights:[],processing:{recap:'empty'}})],jobs:[],calls:[],chunkPlans:[]}));
    expect(report.summaries).toMatchObject({independentEmptyAcceptance:'unreviewed',v3EmptyResults:0,v3EmptyWithoutReviewedDisposition:0,currentSources:{readyEmpty:1,emptyProcessing:1,withheldForOmission:0}});
  });

  it('reports synthetic three-video/six-v2-attempt history and eleven settled calls without promoting the one empty publication', () => {
    const sources = Array.from({length:3},(_,i) => source({videoHighlights:[],processing:{recap:'failed',reason:i === 0 ? 'analysis_summary_omission' : 'synthetic-failure'}},{id:'synthetic-update-'+i}));
    const jobs = sources.flatMap((s,i) => ['summary','keywords'].map(task => job({id:'synthetic-job-'+i+'-'+task,update_id:s.id,task,rule_version:'content-v2',state:i === 0 && task === 'summary' ? 'published' : 'failed',result:i === 0 && task === 'summary' ? {...output('empty'),evidence:{protocolVersion:'content-v2'}} : null})));
    const calls = Array.from({length:11},(_,i) => call({id:'synthetic-call-'+i,job_id:jobs[i%jobs.length].id,call_key:'summary:v2:chunk:'+i,result:{value:i%2 ? null : false}}));
    const {report} = inspect(snapshot({sourceUpdates:sources,jobs,calls,chunkPlans:[]}));
    expect(report).toMatchObject({sourceCompleteness:{total:3},jobs:{total:6,states:{published:1,failed:5}},tasks:{logicalTasks:6,jobAttempts:6},costs:{knownCalls:11,unknownCalls:0,settledUsd:.000000000011},summaries:{acceptedNonemptyByState:0,publishedEmptyAttempts:1,historicalPublishedEmptyUnreviewed:1,v3EmptyWithoutReviewedDisposition:0,currentSources:{withheldForOmission:1}}});
    expect(report.semanticQuality).toBe('unreviewed');
  });

  it('treats optional root manual verdicts as arbitrary input, never as an approval mechanism', () => {
    const s = snapshot({jobs:[job({result:output('empty')})],qualityDispositions:[{update_id:'synthetic-update',content_hash:'synthetic-content-hash',verdict:'pass',emptyDisposition:'no_findings_reviewed'}]});
    const {report,review} = inspect(s);
    expect(report.summaries).toMatchObject({v3EmptyWithDeclaredNoFindings:0,v3EmptyDispositions:{missing:1}});
    expect(report.semanticQuality).toBe('unreviewed');
    expect(review.overall.verdict).toBe('unreviewed');
  });
});

describe('generation identity and sanitized aggregates', () => {
  it('groups attempts across protocol generations but keeps owners, content and tasks separate', () => {
    const jobs = [job({id:'synthetic-old',rule_version:'content-v2'}),job({generation_predecessor_job_id:'synthetic-old'}),job({id:'synthetic-keywords',task:'keywords'}),job({id:'synthetic-other-owner',user_id:'synthetic-other-owner'}),job({id:'synthetic-new-content',content_hash:'synthetic-new-hash'})];
    expect(inspect(snapshot({jobs,calls:[],chunkPlans:[]})).report.tasks).toMatchObject({identityScope:'owner_update_task_content_hash',logicalTasks:4,jobAttempts:5,repeatedTaskAttempts:1,linkedSuccessorAttempts:1,predecessorAttempts:1});
  });

  it('counts missing, self and cross-owner/content/task predecessor links without claiming verified lineage', () => {
    const jobs = [job({id:'synthetic-base'}),job({id:'synthetic-missing',generation_predecessor_job_id:'synthetic-not-exported'}),job({id:'synthetic-self',generation_predecessor_job_id:'synthetic-self'}),job({id:'synthetic-owner-change',user_id:'other-owner',generation_predecessor_job_id:'synthetic-base'}),job({id:'synthetic-content-change',content_hash:'new-hash',generation_predecessor_job_id:'synthetic-base'}),job({id:'synthetic-task-change',task:'keywords',generation_predecessor_job_id:'synthetic-base'})];
    expect(inspect(snapshot({jobs,calls:[],chunkPlans:[]})).report.tasks).toMatchObject({predecessorReferences:5,linkedSuccessorAttempts:0,predecessorAttempts:0,missingPredecessorAttempts:1,invalidPredecessorLinks:4});
  });

  it('counts predecessor attempts once when several successors reference the same historical job', () => {
    const jobs = [job({id:'synthetic-parent'}),job({id:'synthetic-successor-a',generation_predecessor_job_id:'synthetic-parent'}),job({id:'synthetic-successor-b',generation_predecessor_job_id:'synthetic-parent'})];
    expect(inspect(snapshot({jobs,calls:[],chunkPlans:[]})).report.tasks).toMatchObject({logicalTasks:1,jobAttempts:3,repeatedTaskAttempts:2,linkedSuccessorAttempts:2,predecessorAttempts:1});
  });

  it('keeps new hashes, source states and arbitrary disposition values out of public output and nested secrets out of private context', () => {
    const sentinel = 'SYNTHETIC_PRIVATE_CONTEXT_SENTINEL', credential = 'SYNTHETIC_TRANSPORT_SECRET';
    const s = snapshot({sourceUpdates:[source({videoSummary:{status:'ready',captionHash:sentinel,access_token:credential},videoHighlights:[],processing:{recap:'failed',reason:'analysis_summary_omission',access_token:credential}})],jobs:[job({generation_contract_hash:sentinel,generation_predecessor_job_id:sentinel,result:output('empty',sentinel)})]});
    const {report,review} = inspect(s), safe = JSON.stringify(report);
    for (const value of [sentinel,credential,text,'synthetic-owner','synthetic-job','synthetic-update','analysis_summary_omission']) expect(safe).not.toContain(value);
    expect(JSON.stringify(review)).toContain(sentinel);
    expect(JSON.stringify(review)).not.toContain(credential);
    expect(JSON.stringify(review)).not.toContain('access_token');
    expect(report.summaries.v3EmptyDispositions.invalid).toBe(1);
  });
});

describe('v3 private files with simulated repository metadata (no Git process)', () => {
  const cleanup:string[] = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path,{recursive:true,force:true}))); });

  it('writes v3 review/report files as 0600, keeps source content private and refuses overwrite', async () => {
    await mkdir(resolve('.local'),{recursive:true});
    const directory = await mkdtemp(resolve('.local/analysis-report-v3-test-')); cleanup.push(directory);
    const input = join(directory,'input.json'), outputPath = join(directory,'safe.json'), reviewPath = join(directory,'review.json');
    await writeFile(input,JSON.stringify(snapshot({jobs:[job({result:output('empty','no_findings_reviewed')})]})));
    const stdout:string[] = [], stderr:string[] = [], io = {out:(s:string) => stdout.push(s),err:(s:string) => stderr.push(s)};
    const args = ['--input',input,'--output',outputPath,'--review-output',reviewPath];
    expect(await runCli(args,io)).toBe(0);
    const safe = await readFile(outputPath,'utf8'), privateText = await readFile(reviewPath,'utf8');
    for (const path of [outputPath,reviewPath]) expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(safe).not.toContain(text);
    expect(privateText).toContain(text);
    expect(JSON.parse(safe)).toMatchObject({semanticQuality:'unreviewed',fullOriginalCoverage:'unverified',summaries:{v3EmptyWithDeclaredNoFindings:1}});
    expect(stdout).toEqual(['Offline report written. Manual review required.']);
    expect(stderr).toEqual([]);
    expect(await runCli(args,io)).toBe(1);
    expect(stderr).toEqual(['output_already_exists']);
    expect(await readFile(outputPath,'utf8')).toBe(safe);
    expect(await readFile(reviewPath,'utf8')).toBe(privateText);
  });
});
