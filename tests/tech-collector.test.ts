import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error The standalone Actor is dependency-free ESM outside the app TypeScript project.
import { REVIEWED, validateInput, sourceKey, childRequest, normalizeItem, sourceCoverage, observedCharge, committedUsd, reserve, runCollector } from '../actors/tech-collector/src/collector.mjs';

const now=Date.parse('2026-10-21T10:00:00Z');
const yt={id:'source-main',name:'Example studio',platform:'YouTube',url:'https://www.youtube.com/@Example'};
const raw=(patch:Record<string,unknown>={})=>({sources:[yt],dateFrom:'2026-09-21T10:00:00Z',dateTo:'2026-10-21T10:00:00Z',maxTotalChargeUsd:45,parentMaxChargeUsd:2,maxItemsPerSource:300,maxItemsTotal:4000,executionEnabled:true,budgetReservationId:'reservation-test-0001',...patch});
const item=(patch:Record<string,unknown>={})=>({id:'abcdef12345',url:'https://www.youtube.com/watch?v=abcdef12345',channelUrl:yt.url,input:yt.url,date:'2026-10-01T12:00:00Z',title:'A real source title',text:'Publisher video description.',type:'video',...patch});
const normalizedSource=(source=yt)=>validateInput(raw({sources:[source]}),now).sources[0];

function harness(patches:Record<string,unknown>={}) {
 let saved:Record<string,any>|null=null;
 const requests:Record<string,any>[]=[], outputs:Record<string,any>[]=[];
 const parent={id:'parent-run',status:'RUNNING',options:{memoryMbytes:256,timeoutSecs:3600,maxTotalChargeUsd:2}};
 const deps={now:()=>now,parentRun:vi.fn(async()=>parent),load:vi.fn(async()=>saved?structuredClone(saved):null),save:vi.fn(async(state:Record<string,any>)=>{saved=structuredClone(state);}),preflight:vi.fn(async()=>undefined),start:vi.fn(async(request:Record<string,any>)=>{requests.push(request);return {id:'run-'+requests.length,status:'RUNNING',buildId:request.buildId,defaultDatasetId:'dataset-'+requests.length};}),abort:vi.fn(async()=>undefined),wait:vi.fn(async(id:string)=>({id,status:'SUCCEEDED',usageTotalUsd:0.02,defaultDatasetId:'dataset-'+id.split('-')[1]})),items:vi.fn(async()=>({items:[item()],total:1})),output:vi.fn(async(output:Record<string,any>)=>{outputs.push(structuredClone(output));}),publish:vi.fn(async()=>undefined),...patches};
 return {deps,parent,requests,outputs,state:()=>saved,replace:(state:Record<string,any>)=>{saved=structuredClone(state);}};
}

describe('bounded collector input and identity',()=>{
 it.each([NaN,Infinity,0,-1,45.01,'45'])('rejects an unsafe aggregate dollar cap (%s)',cap=>expect(()=>validateInput(raw({maxTotalChargeUsd:cap}),now)).toThrow());
 it('requires explicit execution and a root budget reservation without enabling anything by default',()=>{
  const {executionEnabled,budgetReservationId,...planning}=raw();
  expect(validateInput(planning,now).executionEnabled).toBe(false);
  expect(()=>validateInput({...planning,executionEnabled:true},now)).toThrow('budget_reservation_required');
  expect(()=>validateInput({...planning,executionEnabled:'true'},now)).toThrow();
 });
 it.each([{dateFrom:'2026-08-01T00:00:00Z'},{dateFrom:'2026-10-22T00:00:00Z'},{dateTo:'2026-10-23T00:00:00Z'},{dateFrom:'2026-09-21'}])('rejects unbounded, inverted, future or ambiguous date windows (%j)',patch=>expect(()=>validateInput(raw(patch),now)).toThrow('invalid_date_range'));
 it.each(['http://youtube.com/@Example','https://youtube.com/watch?v=abcdef','https://127.0.0.1/Example','https://youtube.com/@Example?token=private','https://user:pass@youtube.com/@Example'])('rejects nonpublic/nonchannel source input %s',url=>expect(()=>validateInput(raw({sources:[{...yt,url}]}),now)).toThrow());
 it('normalizes public social aliases for duplicate detection without lowercasing stable YouTube channel IDs',()=>{
  expect(sourceKey('https://twitter.com/Example/','X')).toBe(sourceKey('https://x.com/example','X'));
  expect(()=>validateInput(raw({sources:[yt,{...yt,id:'another-id',url:'https://youtube.com/@example/videos'}]}),now)).toThrow('duplicate_sources');
  expect(()=>validateInput(raw({sources:[{...yt,aliases:['https://youtube.com/@Alias']},{...yt,id:'alias-id',url:'https://youtube.com/@Alias'}]}),now)).toThrow('duplicate_sources');
  expect(sourceKey('https://youtube.com/channel/UCAbcdefghijklmnopqrstuv','YouTube')).not.toBe(sourceKey('https://youtube.com/channel/UCabcdefghijklmnopqrstuv','YouTube'));
 });
 it('requests video, Shorts and stream backfill inside one summed source limit, with paid enrichments off',()=>{
  const input=validateInput(raw(),now),request=childRequest(input.sources[0],input,1000);
  expect(request.body.maxResults+request.body.maxResultsShorts+request.body.maxResultStreams).toBe(300);
  expect([request.body.maxResults,request.body.maxResultsShorts,request.body.maxResultStreams].every(n=>n>0)).toBe(true);
  expect(request.body.transcriptionAndSubtitle).toBe('ALWAYS_SUBTITLES');expect(request.body.saveSubsToKVS).toBe(false);expect(request.body.aiVideoSummary).toBe(false);expect(request.body.aiVideoDescription).toBe(false);
  expect(request.options.build).not.toBe('latest');expect(request.options.maxTotalChargeUsd).toBeGreaterThanOrEqual(300*0.0053);
 });
});

describe('real-content normalization and coverage',()=>{
 it('uses inline existing subtitles as content, preserving a description-only video as metadata-only',()=>{
  const input=validateInput(raw(),now),source=input.sources[0];
  const transcript=normalizeItem(source,item({subtitles:[{language:'en',srt:'1\n00:00:00,000 --> 00:00:05,000\nActual spoken words.'}]}),input).update;
  expect(transcript.content).toBe('Actual spoken words.');expect(transcript.contentKind).toBe('transcript');expect(transcript.brands).toEqual([]);expect(transcript.sponsors).toEqual([]);expect(transcript.isSample).toBe(false);
  const metadata=normalizeItem(source,item(),input).update;
  expect(metadata.content).toBe('Publisher video description.');expect(metadata.contentKind).toBe('metadata_only');expect(metadata.coverage).toContain('spoken content not collected');
  const linkOnly=normalizeItem(source,item({subtitles:[{language:'en',srtUrl:'https://example.com/subs'}],transcriptionUrl:'https://example.com/generated'}),input).update;
  expect(linkOnly.contentKind).toBe('metadata_only');
 });
 it('rejects foreign studio channels even when their requested-source input is copied',()=>{
  const input=validateInput(raw({sources:[{...yt,channelId:'UCXuqSBlHAE6Xw-yeJA0Tunw'}]}),now);
  expect(normalizeItem(input.sources[0],item({channelId:'UCBJycsmduvYEL83R_U4JriQ'}),input).reason).toBe('unattributed');
  const noId=validateInput(raw(),now);
  expect(normalizeItem(noId.sources[0],item({channelUrl:'https://youtube.com/@OtherStudio'}),noId).reason).toBe('unattributed');
 });
 it('accepts an explicitly researched channel alias rather than guessing a matching name',()=>{
  const input=validateInput(raw({sources:[{...yt,aliases:['https://youtube.com/@OfficialAlias']}]}),now);
  expect(normalizeItem(input.sources[0],item({input:null,channelUrl:'https://youtube.com/@OfficialAlias'}),input).update.sourceId).toBe(yt.id);
  expect(normalizeItem(input.sources[0],item({input:null,channelUrl:'https://youtube.com/@Other',channelName:yt.name}),input).reason).toBe('unattributed');
 });
 it('keeps public X text separate from image/video or linked article content',()=>{
  const source={id:'x-source',name:'Example',platform:'X',url:'https://x.com/example'};
  const input=validateInput(raw({sources:[source]}),now);
  const result=normalizeItem(input.sources[0],{url:'https://twitter.com/example/status/123',text:'Public creator post.',author:{userName:'Example'},createdAt:'Wed Oct 01 12:00:00 +0000 2026'},input).update;
  expect(result.content).toBe('Public creator post.');expect(result.contentKind).toBe('feed_text');expect(result.coverage).toContain('media audio not collected');
  expect(normalizeItem(input.sources[0],{url:'https://x.com/other/status/123',text:'Foreign post',author:{userName:'other'},createdAt:'2026-10-01'},input).reason).toBe('unattributed');
 });
 it('requires the Instagram owner identity and treats its caption as text, not a Reel transcript',()=>{
  const source={id:'instagram-source',name:'Example',platform:'Instagram',url:'https://www.instagram.com/example/'};
  const input=validateInput(raw({sources:[source]}),now),post={url:'https://www.instagram.com/reel/Abc123/',ownerUsername:'example',caption:'Public caption.',timestamp:'2026-10-01T12:00:00Z'};
  expect(normalizeItem(input.sources[0],post,input).update).toMatchObject({content:'Public caption.',contentKind:'feed_text'});
  expect(normalizeItem(input.sources[0],{...post,ownerUsername:'elsewhere'},input).reason).toBe('unattributed');
 });
 it('filters exact dates, missing timestamps, unsafe original links and provider errors rather than manufacturing updates',()=>{
  const input=validateInput(raw(),now),source=input.sources[0];
  expect(normalizeItem(source,item({date:'2026-09-21T09:59:59Z'}),input).reason).toBe('outside_window');
  expect(normalizeItem(source,item({date:'2026-10-21T10:00:01Z'}),input).reason).toBe('outside_window');
  expect(normalizeItem(source,item({date:null}),input).reason).toBe('missing_date');
  expect(normalizeItem(source,item({url:'javascript:steal()'}),input).reason).toBe('invalid_original_url');
  expect(normalizeItem(source,{error:'PRIVATE_SOURCE'},input).reason).toBe('provider_error');
 });
 it('deduplicates watch/Shorts links while retaining caps and unproven completeness',()=>{
  const input=validateInput(raw({maxItemsPerSource:3}),now),source=input.sources[0],request=childRequest(source,input,3);
  const entry={status:'SUCCEEDED',maxItems:3,formatLimits:request.formatLimits,providerRunId:'run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const result=sourceCoverage(source,entry,[item(),item({url:'https://www.youtube.com/shorts/abcdef12345',type:'shorts'}),item({id:'different',url:'https://www.youtube.com/watch?v=zyxwvu12345'})],input);
  expect(result.updates).toHaveLength(2);expect(result.coverage.rejected.duplicate).toBe(1);expect(result.coverage.capped).toBe(true);expect(result.coverage.complete).toBe(false);expect(result.coverage.earliestReached).toBe('2026-10-01T12:00:00.000Z');
 });
});

describe('durable worst-case spending and interrupted runs',()=>{
 it('never treats an unknown or in-progress charge as zero',()=>{
  expect(observedCharge({status:'SUCCEEDED'})).toBeNull();expect(observedCharge({status:'RUNNING',usageTotalUsd:0})).toBeNull();expect(observedCharge({status:'SUCCEEDED',usageTotalUsd:0})).toBe(0);
  const state={parentMaxChargeUsd:2,maxTotalChargeUsd:4,entries:{one:{reservedUsd:1,observedCostUsd:null}}};
  expect(committedUsd(state)).toBe(3);expect(reserve(state,{id:'two'},{maxChargeUsd:1.01})).toBe(false);expect(state.entries).not.toHaveProperty('two');
 });
 it('can prepare coverage with execution disabled without preflight or any child request',async()=>{
  const h=harness(),out=await runCollector(raw({executionEnabled:false}),h.deps);
  expect(h.deps.start).not.toHaveBeenCalled();expect(h.deps.preflight).not.toHaveBeenCalled();expect(out.coverage[0].status).toBe('execution_disabled');expect(out.updates).toEqual([]);
 });
 it.each([{timeoutSecs:3600,maxTotalChargeUsd:2},{memoryMbytes:512,timeoutSecs:3600,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:0,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:3601,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:3600},{memoryMbytes:256,timeoutSecs:3600,maxTotalChargeUsd:2.01}])('fails before paid child calls when parent resources/cost are not bounded (%j)',async options=>{
  const h=harness({parentRun:async()=>({id:'parent-run',options})});await expect(runCollector(raw(),h.deps)).rejects.toThrow('parent_resource_cap_required');expect(h.deps.start).not.toHaveBeenCalled();
 });
 it('persists the full reservation before requesting a provider and releases only a terminal reported charge',async()=>{
  const h=harness();h.deps.start=vi.fn(async(request:Record<string,any>)=>{expect(h.state()?.entries[yt.id]).toMatchObject({status:'submitting',reservedUsd:request.maxChargeUsd,observedCostUsd:null});return {id:'run-1',status:'RUNNING',buildId:request.buildId,defaultDatasetId:'dataset-1'};});
  const output=await runCollector(raw(),h.deps);
  expect(output.updates).toHaveLength(1);expect(h.state()?.entries[yt.id].observedCostUsd).toBe(0.02);expect(output.manifest.committedUsd).toBe(2.02);expect(output.manifest.parentObservedCostUsd).toBeNull();
 });
 it('retains an ambiguous submission across resumption without repeating the paid POST',async()=>{
  const h=harness({start:vi.fn(async()=>{throw new Error('response lost');})});
  const first=await runCollector(raw(),h.deps),second=await runCollector(raw(),h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(second.coverage[0].status).toBe('ambiguous_start_requires_operator_reconciliation');expect(second.manifest.committedUsd).toBe(first.manifest.committedUsd);expect(second.manifest.unknownCostRuns).toBe(1);
 });
 it('resumes a known provider run after a dataset-read interruption without starting it again',async()=>{
  const read=vi.fn().mockRejectedValueOnce(new Error('temporary dataset failure')).mockResolvedValue({items:[item()],total:1});
  const h=harness({items:read});await runCollector(raw(),h.deps);const out=await runCollector(raw(),h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(out.updates).toHaveLength(1);expect(out.coverage[0].providerRunId).toBe('run-1');expect(out.manifest.datasetPublication).toBe('stale_use_output');
 });
 it('blocks changed inputs or another parent run from reusing a stored reservation',async()=>{
  const h=harness();await runCollector(raw(),h.deps);
  await expect(runCollector(raw({maxItemsPerSource:301}),h.deps)).rejects.toThrow('checkpoint_identity_mismatch');
  h.parent.id='other-parent';await expect(runCollector(raw(),h.deps)).rejects.toThrow('checkpoint_identity_mismatch');expect(h.deps.start).toHaveBeenCalledOnce();
 });
 it('does not submit when the reviewed pricing/build preflight fails',async()=>{
  const h=harness({preflight:async()=>{throw new Error('pricing drift');}});const out=await runCollector(raw(),h.deps);
  expect(h.deps.start).not.toHaveBeenCalled();expect(out.coverage[0].status).toBe('provider_review_changed');
 });
 it('aborts a mismatched actual build and never ingests it on resumption',async()=>{
  const h=harness({start:async()=>({id:'wrong-run',status:'RUNNING',buildId:'unreviewed',defaultDatasetId:'dataset-wrong'})});
  const first=await runCollector(raw(),h.deps),second=await runCollector(raw(),h.deps);
  expect(h.deps.abort).toHaveBeenCalledWith('wrong-run');expect(h.deps.items).not.toHaveBeenCalled();expect(first.updates).toEqual([]);expect(second.coverage[0].status).toBe('provider_build_mismatch');
 });
 it('stops before another source if its worst-case reservation will exceed the combined cap',async()=>{
  const h=harness({wait:async(id:string)=>({id,status:'SUCCEEDED',usageTotalUsd:null,defaultDatasetId:'dataset'})});
  const out=await runCollector(raw({maxTotalChargeUsd:4,sources:[yt,{...yt,id:'another',url:'https://youtube.com/@Another'}]}),h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(out.coverage[1].status).toBe('aggregate_budget_cap');expect(out.manifest.unknownCostRuns).toBe(1);
 });
 it('applies the aggregate accepted-item cap across separate source jobs',async()=>{
  const h=harness({wait:async()=>({id:'run-1',status:'SUCCEEDED',usageTotalUsd:0.001,defaultDatasetId:'dataset'})}),out=await runCollector(raw({maxItemsTotal:1,sources:[yt,{...yt,id:'another',url:'https://youtube.com/@Another'}]}),h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(out.updates).toHaveLength(1);expect(out.coverage[1].status).toBe('total_item_cap');
 });
 it('fails closed instead of continuing if a provider reports a charge beyond its reservation',async()=>{
  const h=harness({wait:async()=>({id:'run-1',status:'SUCCEEDED',usageTotalUsd:20,defaultDatasetId:'dataset'})});
  await expect(runCollector(raw({sources:[yt,{...yt,id:'another',url:'https://youtube.com/@Another'}]}),h.deps)).rejects.toThrow('provider_budget_exceeded');expect(h.deps.start).toHaveBeenCalledOnce();expect(h.deps.items).not.toHaveBeenCalled();
 });
 it('retains canonical OUTPUT and does not replay an interrupted dataset publication',async()=>{
  const h=harness({publish:vi.fn().mockRejectedValueOnce(new Error('lost dataset acknowledgement')).mockResolvedValue(undefined)});
  await expect(runCollector(raw(),h.deps)).rejects.toThrow('lost dataset acknowledgement');
  const out=await runCollector(raw(),h.deps);
  expect(h.deps.publish).toHaveBeenCalledOnce();expect(out.manifest.datasetPublication).toBe('uncertain_use_output');expect(out.updates).toHaveLength(1);
 });
 it('pins all three reviewed providers to successful versioned public metadata rather than mutable latest tags',()=>{
  for(const platform of ['YouTube','X','Instagram']){expect(REVIEWED[platform].buildNumber).toMatch(/^\d+\.\d+\.\d+$/);expect(REVIEWED[platform].buildId).toMatch(/^[A-Za-z0-9]{17}$/);expect(REVIEWED[platform].pricing.pricingModel).toBe('PAY_PER_EVENT');}
 });
});
