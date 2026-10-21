import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error The standalone Actor is dependency-free ESM outside the app TypeScript project.
import { REVIEWED, reviewedProviderForRun, validateInput, sourceKey, childRequest, normalizeItem, timedSubtitleSegments, sourceCoverage, observedCharge, plannedBudget, committedUsd, reserve, runCollector } from '../actors/tech-collector/src/collector.mjs';

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
 it('requests a bounded Xquik latest search with UTC boundary overfetch and the exact reviewed runtime constraints',()=>{
  const source={id:'source-x',name:'Example',platform:'X',url:'https://x.com/Example'},input=validateInput(raw({sources:[source]}),now),request=childRequest(input.sources[0],input,300);
  expect(request.actor).toBe('xquik/x-tweet-scraper');expect(request.body).toEqual({mode:'search',searchTerms:['from:example since:2026-09-21 until:2026-10-22'],queryType:'Latest',maxItems:300,outputVariant:'rich',fieldStyle:'camelCase',includeSearchTerms:true});
  expect(request.options).toMatchObject({build:'1.12.394',memory:256,timeout:120,maxTotalChargeUsd:0.05,restartOnError:false});expect(request.maxChargeUsd).toBe(0.05);
  expect(childRequest(input.sources[0],input,5).maxChargeUsd).toBe(0.00575);expect(request.body).not.toHaveProperty('start');expect(request.body).not.toHaveProperty('sort');
 });
 it('looks up historical and current reviewed providers by exact platform, actor and build instead of a mutable default',()=>{
  const legacy=reviewedProviderForRun('X','nfp1fpt5gUlBwPcor','yaoXYYsyMoS92pVsj'),current=reviewedProviderForRun('X','wAusCMrm284Voaw86','0zYfRnonkqidzEkEF');
  expect(legacy.actor).toBe('apidojo/twitter-scraper-lite');expect(legacy.buildNumber).toBe('0.0.1037');expect(current).toBe(REVIEWED.X);expect(current.actor).toBe('xquik/x-tweet-scraper');
  expect(()=>reviewedProviderForRun('X',legacy.actorId,current.buildId)).toThrow('unreviewed_provider_run');expect(()=>reviewedProviderForRun('Instagram',current.actorId,current.buildId)).toThrow('unreviewed_provider_run');expect(()=>reviewedProviderForRun('X',current.actorId,'latest')).toThrow('unreviewed_provider_run');
 });
});

describe('real-content normalization and coverage',()=>{
 it('preserves explicit Shorts identity after canonicalizing the original URL without guessing from duration',()=>{
  const input=validateInput(raw(),now),source=input.sources[0];
  expect(normalizeItem(source,item({type:'shorts'}),input).update).toMatchObject({isShort:true,url:'https://www.youtube.com/watch?v=abcdef12345'});
  expect(normalizeItem(source,item({type:'video',url:'https://www.youtube.com/shorts/abcdef12345'}),input).update.isShort).toBe(true);
  for(const type of ['video','stream'])expect(normalizeItem(source,item({type,duration:'00:30'}),input).update.isShort).toBe(false);
  const unknown=normalizeItem(source,item({type:undefined,duration:'00:15'}),input).update;
  expect(unknown).not.toHaveProperty('isShort');expect(unknown.duration).toBe('00:15');
 });
 it('keeps actual inline SRT/VTT timestamps with full captions while leaving plain text untimed',()=>{
  const input=validateInput(raw(),now),source=input.sources[0];
  const srt='1\r\n00:00:00,000 --> 00:00:02,500\r\nOpening words.\r\n\r\n2\r\n00:02:03,250 --> 00:02:06,750\r\nA later <b>detail</b>.\r\nSecond line.';
  const normalized=normalizeItem(source,item({subtitles:[{language:'en',plaintext:'Opening words. A later detail. Second line.',srt}]}),input).update;
  expect(normalized.content).toBe('Opening words. A later detail. Second line.');
  expect(normalized.transcriptSegments).toEqual([{startSeconds:0,durationSeconds:2.5,text:'Opening words.'},{startSeconds:123.25,durationSeconds:3.5,text:'A later detail.\nSecond line.'}]);
  const vtt='WEBVTT\n\nNOTE Editorial note\n00:01.000 --> 00:02.000\nDo not import this note.\n\ncue-one\n00:03.500 --> 00:05.250 align:start position:0%\n<v Speaker>Hello.</v>';
  expect(timedSubtitleSegments(vtt)).toEqual([{startSeconds:3.5,durationSeconds:1.75,text:'Hello.'}]);
  const plaintext=normalizeItem(source,item({subtitles:[{language:'en',plaintext:'We discuss a change at 2:15 in the video.'}]}),input).update;
  expect(plaintext.contentKind).toBe('transcript');expect(plaintext).not.toHaveProperty('transcriptSegments');
  expect(normalizeItem(source,item({subtitles:[{language:'en',vtt:'WEBVTT\n\n00:03.000 --> 00:05.000\nActual words.'}]}),input).update.transcriptSegments).toEqual([{startSeconds:3,durationSeconds:2,text:'Actual words.'}]);
 });
 it('rejects invalid caption timing instead of inventing start points',()=>{
  expect(timedSubtitleSegments('1\n00:65:00,000 --> 00:66:00,000\nInvalid minutes.\n\n2\n00:00:20,000 --> 00:00:10,000\nReversed.\n\n3\nMissing times.\n\n4\n00:00:05,000 --> 00:00:07,000\nGood cue.')).toEqual([{startSeconds:5,durationSeconds:2,text:'Good cue.'}]);
  expect(timedSubtitleSegments(null)).toEqual([]);expect(timedSubtitleSegments('Plain words with no cue timing.')).toEqual([]);
 });
 it('carries a safe avatar only from an accepted channel row into source coverage',()=>{
  const input=validateInput(raw(),now),source=input.sources[0],request=childRequest(source,input,300);
  const entry={...request,status:'SUCCEEDED',providerRunId:'test-provider-run',observedCostUsd:null,costStatus:'unreported'};
  const channelAvatarUrl='https://yt3.googleusercontent.com/official-avatar';
  const normalized=normalizeItem(source,item({channelAvatarUrl}),input);
  expect(normalized.sourceAvatarUrl).toBe(channelAvatarUrl);expect(normalized.update).not.toHaveProperty('sourceAvatarUrl');expect(normalized.update).not.toHaveProperty('avatarUrl');
  expect(sourceCoverage(source,entry,[item({channelUrl:'https://youtube.com/@Foreign',channelAvatarUrl:'https://example.org/foreign'}),item({channelAvatarUrl})],input).coverage.sourceAvatarUrl).toBe(channelAvatarUrl);
  for(const avatar of ['javascript:alert(1)','https://127.0.0.1/private','https://example.org/photo?token=private'])expect(normalizeItem(source,item({channelAvatarUrl:avatar}),input)).not.toHaveProperty('sourceAvatarUrl');
 });
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
 it('normalizes the proved Xquik camelCase row shape without importing profile contact data or engagement analysis',()=>{
  const input=validateInput(raw({sources:[{id:'source-xquik',name:'MKBHD',platform:'X',url:'https://x.com/MKBHD'}]}),now),source=input.sources[0];
  const row={id:'1234567890',text:'Synthetic public-post text for the response-shape regression.',createdAt:'Mon Oct 19 16:40:36 +0000 2026',url:'https://x.com/MKBHD/status/1234567890',author:{username:'MKBHD',name:'Example publisher',contactInfo:{email:'excluded@example.com'}},likeCount:4,viewCount:50,searchTerm:'from:mkbhd',type:'tweet'};
  const result=normalizeItem(source,row,input);
  expect(result.update).toMatchObject({sourceId:source.id,url:row.url,publishedAt:'2026-10-19T16:40:36.000Z',content:row.text,contentKind:'feed_text',isSample:false,contributorIds:[],topics:[],brands:[],sponsors:[]});expect(JSON.stringify(result.update)).not.toContain('excluded@example.com');expect(result.update).not.toHaveProperty('viewCount');
  expect(normalizeItem(source,{...row,author:{username:'elsewhere'}},input).reason).toBe('unattributed');expect(normalizeItem(source,{...row,createdAt:'Mon Sep 01 16:40:36 +0000 2026'},input).reason).toBe('outside_window');
 });
 it('requires the Instagram owner identity and treats its caption as text, not a Reel transcript',()=>{
  const source={id:'instagram-source',name:'Example',platform:'Instagram',url:'https://www.instagram.com/example/'};
  const input=validateInput(raw({sources:[source]}),now),post={url:'https://www.instagram.com/reel/Abc123/',ownerUsername:'example',caption:'Public caption.',timestamp:'2026-10-01T12:00:00Z'};
  expect(normalizeItem(input.sources[0],post,input).update).toMatchObject({content:'Public caption.',contentKind:'feed_text'});
  expect(normalizeItem(input.sources[0],{...post,ownerUsername:'elsewhere'},input).reason).toBe('unattributed');
 });
 it('recognizes source-matched Instagram no_items as an ambiguous empty/private report, retaining independent request failures',()=>{
  const input=validateInput(raw({sources:[{id:'source-instagram-empty',name:'Example',platform:'Instagram',url:'https://instagram.com/example/'}]}),now),source=input.sources[0],request=childRequest(source,input,300);
  const entry={status:'SUCCEEDED',maxItems:1,formatLimits:null,providerRunId:'ig-run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const row={url:'https://instagram.com/example/',inputUrl:'https://instagram.com/example/',requestErrorMessages:[],error:'no_items',errorDescription:'Empty or private data for provided input'};
  const result=sourceCoverage(source,entry,[row],input);
  expect(result.updates).toEqual([]);expect(result.coverage).toMatchObject({status:'no_items_reported',acceptedItems:0,returnedItems:1,rejected:{no_items_reported:1},capped:false,complete:false,earliestReached:null,dateCutoffReached:null});expect(result.coverage.notes.join(' ')).toContain('quiet and inaccessible accounts cannot be distinguished');
  const blocked=sourceCoverage(source,entry,[{...row,requestErrorMessages:['Synthetic blocked-request detail which must not be copied.']}],input);
  expect(blocked.coverage.status).toBe('failed_or_partial');expect(blocked.coverage.rejected).toEqual({provider_request_error:1,no_items_reported:1});expect(JSON.stringify(blocked)).not.toContain('Synthetic blocked-request detail');expect(blocked.coverage.complete).toBe(false);
  expect(sourceCoverage(source,{...entry,status:'FAILED'},[row],input).coverage.status).toBe('failed_or_partial');
  expect(normalizeItem(source,{...row,inputUrl:'https://instagram.com/someoneelse/'},input).reason).toBe('provider_error');expect(normalizeItem(source,{error:'no_items'},input).reason).toBe('provider_error');expect(normalizeItem(source,{...row,error:'private_account'},input).reason).toBe('provider_error');
  const other=validateInput(raw(),now);expect(normalizeItem(other.sources[0],{...row},other).reason).toBe('provider_error');
 });
 it('filters exact dates, missing timestamps, unsafe original links and provider errors rather than manufacturing updates',()=>{
  const input=validateInput(raw(),now),source=input.sources[0];
  expect(normalizeItem(source,item({date:'2026-09-21T09:59:59Z'}),input).reason).toBe('outside_window');
  expect(normalizeItem(source,item({date:'2026-10-21T10:00:01Z'}),input).reason).toBe('outside_window');
  expect(normalizeItem(source,item({date:null}),input).reason).toBe('missing_date');
  expect(normalizeItem(source,item({url:'javascript:steal()'}),input).reason).toBe('invalid_original_url');
  expect(normalizeItem(source,{error:'PRIVATE_SOURCE'},input).reason).toBe('provider_error');
 });
 it('excludes actual-shaped supplier demo rows before source attribution or usable-content classification',()=>{
  const input=validateInput(raw(),now),source=input.sources[0],request=childRequest(source,input,300);
  const entry={status:'SUCCEEDED',maxItems:request.maxItems,formatLimits:request.formatLimits,providerRunId:'demo-run',actor:request.actor,buildId:request.buildId,observedCostUsd:0,costStatus:'provider_reported'};
  expect(normalizeItem(source,{demo:true},input)).toEqual({reason:'provider_demo_data'});
  expect(normalizeItem(source,item({demo:true}),input)).toEqual({reason:'provider_demo_data'});
  const result=sourceCoverage(source,entry,Array.from({length:10},()=>({demo:true})),input);
  expect(result.updates).toEqual([]);expect(result.coverage).toMatchObject({status:'provider_demo_only',providerStatus:'SUCCEEDED',returnedItems:10,acceptedItems:0,transcriptItems:0,postTextItems:0,metadataOnlyItems:0,rejected:{provider_demo_data:10},complete:false,capped:false,earliestReached:null,dateCutoffReached:null});
  expect(result.coverage.notes.join(' ')).toContain('10 supplier demo rows were excluded');
  const mixed=sourceCoverage(source,entry,[item(),{demo:true}],input);
  expect(mixed.updates).toHaveLength(1);expect(mixed.coverage.status).toBe('failed_or_partial');expect(mixed.coverage.rejected.provider_demo_data).toBe(1);
 });
 it('keeps actual-shaped empty-format and strict-date diagnostics distinct from a provider failure or content cap',()=>{
  const input=validateInput(raw({maxItemsPerSource:3}),now),source=input.sources[0],request=childRequest(source,input,3);
  const entry={status:'SUCCEEDED',maxItems:3,formatLimits:request.formatLimits,providerRunId:'quiet-run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const rows=[{aboutChannelInfo:{},url:source.url,error:'CHANNEL_HAS_NO_SHORTS',input:source.url,note:'The channel has no shorts.'},{aboutChannelInfo:{},url:source.url,error:'CHANNEL_HAS_NO_LIVE_VIDEOS',input:source.url,note:'The channel has no live videos.'},{aboutChannelInfo:{},url:source.url,error:'DATE_FILTER_TOO_STRICT',input:source.url,note:'No videos were collected due to date filtering.'}];
  const result=sourceCoverage(source,entry,rows,input);
  expect(result.updates).toEqual([]);expect(result.coverage).toMatchObject({status:'no_items_reported',returnedItems:3,acceptedItems:0,complete:false,capped:false,rejected:{empty_format:2,no_items_reported:1},diagnosticCodes:{CHANNEL_HAS_NO_SHORTS:1,CHANNEL_HAS_NO_LIVE_VIDEOS:1,DATE_FILTER_TOO_STRICT:1},emptyFormats:['shorts','stream'],earliestReached:null,dateCutoffReached:null});
  expect(result.coverage.rejected).not.toHaveProperty('provider_error');expect(result.coverage.notes.join(' ')).toContain('not proof of exhaustive history');
  expect(sourceCoverage(source,{...entry,status:'FAILED'},rows,input).coverage.status).toBe('failed_or_partial');
  expect(sourceCoverage(source,entry,[...rows,{error:'PRIVATE_SOURCE'}],input).coverage.status).toBe('failed_or_partial');
 });
 it('accepts real results beside empty-format notices without labeling known notices as fatal errors',()=>{
  const input=validateInput(raw(),now),source=input.sources[0],request=childRequest(source,input,300);
  const entry={status:'SUCCEEDED',maxItems:300,formatLimits:request.formatLimits,providerRunId:'partial-run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const result=sourceCoverage(source,entry,[item(),{error:'CHANNEL_HAS_NO_SHORTS'}],input);
  expect(result.updates).toHaveLength(1);expect(result.coverage.status).toBe('collected_unverified_completeness');expect(result.coverage.rejected).toEqual({empty_format:1});expect(result.coverage.complete).toBe(false);
  const x=validateInput(raw({sources:[{id:'x',name:'Example',platform:'X',url:'https://x.com/example'}]}),now);
  expect(normalizeItem(x.sources[0],{error:'DATE_FILTER_TOO_STRICT'},x).reason).toBe('provider_error');
 });
 it('deduplicates watch/Shorts links while retaining caps and unproven completeness',()=>{
  const input=validateInput(raw({maxItemsPerSource:3}),now),source=input.sources[0],request=childRequest(source,input,3);
  const entry={status:'SUCCEEDED',maxItems:3,formatLimits:request.formatLimits,providerRunId:'run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const result=sourceCoverage(source,entry,[item(),item({url:'https://www.youtube.com/shorts/abcdef12345',type:'shorts'}),item({id:'different',url:'https://www.youtube.com/watch?v=zyxwvu12345'})],input);
  expect(result.updates).toHaveLength(2);expect(result.coverage.rejected.duplicate).toBe(1);expect(result.coverage.capped).toBe(true);expect(result.coverage.complete).toBe(false);expect(result.coverage.earliestReached).toBe('2026-10-01T12:00:00.000Z');
 });
 it('labels source-text clipping on the update and source coverage instead of implying an entire transcript',()=>{
  const input=validateInput(raw(),now),source=input.sources[0],request=childRequest(source,input,300),long=item({subtitles:[{language:'en',srt:'spoken '.repeat(30000)}]});
  const normalized=normalizeItem(source,long,input);
  expect(normalized.contentClipped).toBe(true);expect(normalized.update.content.length).toBeLessThanOrEqual(200000);expect(normalized.update.coverage).toContain('clipped at 200,000 characters');expect(normalized.update).not.toHaveProperty('contentClipped');
  const entry={status:'SUCCEEDED',maxItems:request.maxItems,formatLimits:request.formatLimits,providerRunId:'run',actor:request.actor,buildId:request.buildId,observedCostUsd:null,costStatus:'unreported'};
  const result=sourceCoverage(source,entry,[long],input);
  expect(result.coverage.clippedItems).toBe(1);expect(result.coverage.notes.join(' ')).toContain('entire transcripts or post bodies are not established');expect(result.coverage.complete).toBe(false);
  const metadata=normalizeItem(source,item({text:'description '.repeat(20000)}),input);
  expect(metadata.update.contentKind).toBe('metadata_only');expect(metadata.update.coverage).toContain('clipped');
 });
});

describe('durable worst-case spending and interrupted runs',()=>{
 it('never treats an unknown or in-progress charge as zero',()=>{
  expect(observedCharge({status:'SUCCEEDED'})).toBeNull();expect(observedCharge({status:'RUNNING',usageTotalUsd:0})).toBeNull();expect(observedCharge({status:'SUCCEEDED',usageTotalUsd:0})).toBe(0);
  const state={parentMaxChargeUsd:2,maxTotalChargeUsd:4,entries:{one:{reservedUsd:1,observedCostUsd:null}}};
  expect(committedUsd(state)).toBe(3);expect(reserve(state,{id:'two'},{maxChargeUsd:1.01})).toBe(false);expect(state.entries).not.toHaveProperty('two');
 });
 it('holds the full child API cap when reported fees rise after terminal status',()=>{
  const state={parentMaxChargeUsd:0.4,maxTotalChargeUsd:0.6,entries:{one:{reservedUsd:0.2,observedCostUsd:0.163}}};
  expect(committedUsd(state)).toBeCloseTo(0.6,6);expect(reserve(state,{id:'two'},{maxChargeUsd:0.02})).toBe(false);
  state.entries.one.observedCostUsd=0.1736;
  expect(committedUsd(state)).toBeCloseTo(0.6,6);expect(reserve(state,{id:'two'},{maxChargeUsd:0.02})).toBe(false);
  state.entries.one.observedCostUsd=0;
  expect(committedUsd(state)).toBeCloseTo(0.6,6);expect(reserve(state,{id:'two'},{maxChargeUsd:0.02})).toBe(false);
 });
 it('can prepare coverage with execution disabled without preflight or any child request',async()=>{
  const h=harness(),out=await runCollector(raw({executionEnabled:false}),h.deps);
  expect(h.deps.start).not.toHaveBeenCalled();expect(h.deps.preflight).not.toHaveBeenCalled();expect(out.coverage[0].status).toBe('execution_disabled');expect(out.updates).toEqual([]);
 });
 it.each([{timeoutSecs:3600,maxTotalChargeUsd:2},{memoryMbytes:512,timeoutSecs:3600,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:0,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:3601,maxTotalChargeUsd:2},{memoryMbytes:256,timeoutSecs:3600},{memoryMbytes:256,timeoutSecs:3600,maxTotalChargeUsd:2.01}])('fails before paid child calls when parent resources/cost are not bounded (%j)',async options=>{
  const h=harness({parentRun:async()=>({id:'parent-run',options})});await expect(runCollector(raw(),h.deps)).rejects.toThrow('parent_resource_cap_required');expect(h.deps.start).not.toHaveBeenCalled();
 });
 it('persists and retains the full reservation, with terminal fees and their observation time reported separately',async()=>{
  const h=harness();h.deps.start=vi.fn(async(request:Record<string,any>)=>{expect(h.state()?.entries[yt.id]).toMatchObject({status:'submitting',reservedUsd:request.maxChargeUsd,observedCostUsd:null});return {id:'run-1',status:'RUNNING',buildId:request.buildId,defaultDatasetId:'dataset-1'};});
  const output=await runCollector(raw(),h.deps);
  expect(output.updates).toHaveLength(1);expect(h.state()?.entries[yt.id].observedCostUsd).toBe(0.02);expect(output.manifest.committedUsd).toBeCloseTo(3.59,6);expect(output.manifest.observedChildCostUsd).toBe(0.02);expect(output.manifest.parentObservedCostUsd).toBeNull();expect(h.state()?.entries[yt.id].costObservedAt).toBe(new Date(now).toISOString());expect(output.coverage[0].costObservedAt).toBe(new Date(now).toISOString());expect(output.manifest.observedCostsAreFinal).toBe(false);
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
 it.each([null,0,0.163,0.1736])('stops before another source at held caps even with an observed terminal fee of %s',async usageTotalUsd=>{
  const h=harness({wait:async(id:string)=>({id,status:'SUCCEEDED',usageTotalUsd,defaultDatasetId:'dataset'})});
  const out=await runCollector(raw({maxTotalChargeUsd:4,sources:[yt,{...yt,id:'another',url:'https://youtube.com/@Another'}]}),h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(out.coverage[1].status).toBe('aggregate_budget_cap');expect(out.manifest.unknownCostRuns).toBe(usageTotalUsd===null?1:0);expect(out.manifest.partialBudgetRun).toBe(true);expect(out.manifest.maxTotalChargeUsd).toBe(4);
 });
 it('does not reuse observed savings after a same-run checkpoint resumes',async()=>{
  const input=raw({maxTotalChargeUsd:4,sources:[yt,{...yt,id:'another',url:'https://youtube.com/@Another'}]}),h=harness({wait:async(id:string)=>({id,status:'SUCCEEDED',usageTotalUsd:0.163,defaultDatasetId:'dataset'})});
  await runCollector(input,h.deps);
  const checkpoint=h.state()!;checkpoint.entries[yt.id].observedCostUsd=0.1736;h.replace(checkpoint);
  const resumed=await runCollector(input,h.deps);
  expect(h.deps.start).toHaveBeenCalledOnce();expect(resumed.manifest.committedUsd).toBeCloseTo(3.59,6);expect(resumed.coverage[1].status).toBe('aggregate_budget_cap');
 });
 it('refuses a legacy checkpoint whose full caps already exceed its declared ceiling before another provider request',async()=>{
  const h=harness(),input=raw({maxTotalChargeUsd:4});await runCollector(input,h.deps);
  const checkpoint=h.state()!;checkpoint.entries.legacy={reservedUsd:2,observedCostUsd:0,updates:[]};h.replace(checkpoint);
  await expect(runCollector(input,h.deps)).rejects.toThrow('checkpoint_full_caps_exceed_budget');expect(h.deps.start).toHaveBeenCalledOnce();
 });
 it('reports the full 39-source cap plan and labels a smaller budget without raising it or starting jobs',async()=>{
  const inventory=JSON.parse(readFileSync(new URL('../data/tech/sources.json',import.meta.url),'utf8'));
  const sources=inventory.sources.filter((source:{scope:string})=>source.scope==='included').map((source:Record<string,unknown>)=>({...source,channelId:source.youtubeChannelId}));
  const input=raw({sources,executionEnabled:false,parentMaxChargeUsd:0.4,maxTotalChargeUsd:4.7}),h=harness({parentRun:async()=>({id:'parent-run',status:'RUNNING',options:{memoryMbytes:256,timeoutSecs:3600,maxTotalChargeUsd:0.4}})});
  const plan=plannedBudget(validateInput(input,now)),out=await runCollector(input,h.deps);
  expect(plan.plannedSourceCaps).toHaveLength(39);expect(plan.plannedFullCapUsd).toBe(40.77);expect(out.manifest.plannedFullCapUsd).toBe(plan.plannedFullCapUsd);expect(out.manifest.allSourceCapsFitBudget).toBe(false);expect(out.manifest.partialBudgetRun).toBe(true);expect(out.manifest.maxTotalChargeUsd).toBe(4.7);expect(h.deps.start).not.toHaveBeenCalled();
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
