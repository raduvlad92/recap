import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone server-side ESM provisioning tool deliberately has no TS declaration.
import { prepareWorkspace, applyTechCoverage, buildArchiveRows, provisionTechWorkspace, validIsoDate } from '../scripts/provision-tech-workspace.mjs';

const manifest=JSON.parse(readFileSync(new URL('../data/tech/sources.json',import.meta.url),'utf8'));
const included=manifest.sources.filter((source:{scope:string})=>source.scope==='included');
const first=included[0];
const now='2026-10-21T12:00:00.000Z';
const previous=()=>({version:1,followedSourceIds:['existing-blog'],followScopes:[{kind:'source',id:'existing-blog'}],savedUpdateIds:['old-save'],readLaterIds:['old-later'],settings:{interfaceLanguage:'de',recapLanguage:'fr',timezone:'Europe/Berlin',deliveryTime:'07:30',emailReminder:true,interests:['Hardware']},customSources:[{id:'existing-blog',name:'Existing blog',url:'https://example.com/feed',platform:'Blog',creatorIds:[],status:'ready'}],importedUpdates:[{id:'old-update',sourceId:'existing-blog',content:'An existing private import.'}],sourceCollections:[{id:'other',name:'Other reading',sourceIds:['existing-blog'],createdAt:'2026-10-01T00:00:00Z'}],activeCollectionId:'other',futurePreference:{preserve:true}});
const update=(patch:Record<string,unknown>={})=>({id:'tech-real-update-001',sourceId:first.id,contributorIds:[],title:'Real creator update',summary:'Publisher extract.',url:'https://www.youtube.com/watch?v=abcdef12345',publishedAt:'2026-10-01T12:00:00.000Z',format:'video',topics:[],brands:[],sponsors:[],references:[{title:'Original update',url:'https://www.youtube.com/watch?v=abcdef12345'}],insights:[],isSample:false,coverage:'Existing source subtitles, no AI analysis.',content:'Actual spoken words.',contentKind:'transcript',...patch});
const output=(updates=[update()])=>({manifest:{executionEnabled:true,dateFrom:'2026-09-21T12:00:00.000Z',dateTo:now,complete:false},coverage:[...new Set(updates.map(record=>record.sourceId))].map(sourceId=>{const records=updates.filter(record=>record.sourceId===sourceId);return {sourceId,status:'collected_unverified_completeness',providerStatus:'SUCCEEDED',providerRunId:'test-provider-run',acceptedItems:records.length,returnedItems:records.length,transcriptItems:records.filter(record=>record.contentKind==='transcript').length,postTextItems:records.filter(record=>record.contentKind==='feed_text').length,metadataOnlyItems:records.filter(record=>record.contentKind==='metadata_only').length,complete:false,capped:false};}),updates});

describe('owner workspace preparation',()=>{
 it('preserves settings, saves, imported material, unrelated sources and other collections without mutating the input',()=>{
  const old=previous(),snapshot=structuredClone(old),next=prepareWorkspace(old,manifest,{now});
  expect(old).toEqual(snapshot);expect(next.settings).toEqual(old.settings);expect(next.savedUpdateIds).toEqual(old.savedUpdateIds);expect(next.readLaterIds).toEqual(old.readLaterIds);expect(next.importedUpdates).toEqual(old.importedUpdates);expect(next.futurePreference).toEqual(old.futurePreference);
  expect(next.customSources.find((s:{id:string})=>s.id==='existing-blog')).toEqual(old.customSources[0]);expect(next.sourceCollections.find((c:{id:string})=>c.id==='other')).toEqual(old.sourceCollections[0]);expect(next.followedSourceIds).toContain('existing-blog');
  expect(next.activeCollectionId).toBe('tech');expect(next.sourceCollections.find((c:{id:string})=>c.id==='tech').sourceIds).toHaveLength(included.length);
 });
 it('uses the exact included manifest IDs and excludes optional/unresolved sources',()=>{
  const next=prepareWorkspace(null,manifest,{now});
  expect(next.customSources.map((source:{id:string})=>source.id)).toEqual(included.map((source:{id:string})=>source.id));expect(next.followedSourceIds).toHaveLength(included.length);
  for(const source of manifest.sources.filter((s:{scope:string})=>s.scope!=='included'))expect(next.followedSourceIds).not.toContain(source.id);
  expect(next.importedUpdates).toEqual([]);expect(next.customSources.every((source:{status:string})=>source.status==='pending')).toBe(true);
 });
 it('is idempotent and preserves the original collection creation time and later manual members',()=>{
  const firstState=prepareWorkspace(previous(),manifest,{now});firstState.sourceCollections.find((c:{id:string})=>c.id==='tech').sourceIds.push('existing-blog');
  const again=prepareWorkspace(firstState,manifest,{now:'2026-10-22T12:00:00Z'});
  expect(again.followedSourceIds).toEqual(firstState.followedSourceIds);expect(again.customSources).toEqual(firstState.customSources);expect(again.followScopes).toEqual(firstState.followScopes);expect(again.sourceCollections.find((c:{id:string})=>c.id==='tech').createdAt).toBe(now);expect(again.sourceCollections.find((c:{id:string})=>c.id==='tech').sourceIds).toContain('existing-blog');
 });
 it('builds evidenced studio/person navigation without making a person the speaker of every group update',()=>{
  const next=prepareWorkspace(null,manifest,{now});
  const studio=next.customCreators.find((c:{id:string})=>c.id==='tech-creator-mkbhd-studio'),person=next.customCreators.find((c:{name:string})=>c.name==='Marques Brownlee');
  expect(studio.kind).toBe('studio');expect(studio.presenterIds).toContain(person.id);expect(person.kind).toBe('person');expect(person.bio).toContain('does not establish who presented');expect(studio.sourceIds.length).toBeGreaterThanOrEqual(person.sourceIds.length);
  expect(next.customCreators.some((c:{id:string})=>c.id==='tech-creator-gnsteve')).toBe(false);expect(buildArchiveRows('user_test',manifest,output())[0].record.contributorIds).toEqual([]);
 });
 it('rejects source ID and preexisting alias conflicts instead of replacing an unrelated saved source',()=>{
  const old=previous();old.customSources.push({...old.customSources[0],id:first.id});expect(()=>prepareWorkspace(old,manifest,{now})).toThrow('existing_source_id_conflict');
  const alias=previous();alias.customSources.push({...alias.customSources[0],id:'older-id',url:first.url,platform:first.platform});expect(()=>prepareWorkspace(alias,manifest,{now})).toThrow('existing_source_alias_conflict');
 });
 it('rejects the 50-source and 15-X limits without dropping existing follows',()=>{
  const tooMany=previous();tooMany.followedSourceIds=Array.from({length:20},(_,i)=>'old-'+i);expect(()=>prepareWorkspace(tooMany,manifest,{now})).toThrow('follow_limit_50');
  const x=previous();x.customSources=Array.from({length:6},(_,i)=>({id:'old-x-'+i,name:'Existing X',url:'https://x.com/old'+i,platform:'X',creatorIds:[],status:'ready'}));x.followedSourceIds=x.customSources.map(s=>s.id);expect(()=>prepareWorkspace(x,manifest,{now})).toThrow('x_follow_limit_15');
 });
 it('rejects unsupported saved state or excessive metadata rather than sanitizing it destructively',()=>{
  expect(()=>prepareWorkspace({version:2},manifest,{now})).toThrow('unsupported_existing_workspace');
  expect(()=>prepareWorkspace({...previous(),futurePreference:{preserve:true},largeUnknown:'a'.repeat(2_000_000)},manifest,{now})).toThrow('workspace_metadata_too_large');
 });
});

describe('actual source coverage in reader metadata',()=>{
 it('marks collected sources ready with exact content-level counts, window and caps while preserving publisher association',()=>{
  const state=prepareWorkspace(previous(),manifest,{now}),data=output([update(),update({id:'tech-meta-002',contentKind:'metadata_only'})]);
  data.coverage[0].status='capped';data.coverage[0].capped=true;
  const next=applyTechCoverage(state,manifest,data),source=next.customSources.find((entry:{id:string})=>entry.id===first.id);
  expect(source.status).toBe('ready');expect(source.description).toContain('2 updates (1 transcripts, 0 public text, 1 metadata only)');expect(source.description).toContain(data.manifest.dateFrom);expect(source.description).toContain('cap or truncated');expect(source.description).toContain('Publisher association only');expect(source.description).toContain('Complete history is not established');expect(source.description).toContain('No AI analysis');expect(source.description).not.toContain('test-provider-run');
  expect(next.customSources.find((entry:{id:string})=>entry.id==='existing-blog')).toEqual(state.customSources.find((entry:{id:string})=>entry.id==='existing-blog'));expect(next.savedUpdateIds).toEqual(state.savedUpdateIds);expect(state.customSources.find((entry:{id:string})=>entry.id===first.id).status).toBe('pending');
 });
 it('marks a failed attempted source failed, while empty successful and unattempted sources remain pending',()=>{
  const state=prepareWorkspace(null,manifest,{now}),data=output([]) as Record<string,any>;
  data.coverage=[{sourceId:included[0].id,status:'failed_or_partial',providerStatus:'FAILED',providerRunId:'failed-provider-run',acceptedItems:0,transcriptItems:0,postTextItems:0,metadataOnlyItems:0,rejected:{provider_error:1}},{sourceId:included[1].id,status:'no_results_unverified',providerStatus:'SUCCEEDED',providerRunId:'empty-provider-run',acceptedItems:0},{sourceId:included[2].id,status:'aggregate_budget_cap',providerRunId:null}];
  const next=applyTechCoverage(state,manifest,data),find=(sourceId:string)=>next.customSources.find((entry:{id:string})=>entry.id===sourceId);
  expect(find(included[0].id).status).toBe('failed');expect(find(included[0].id).description).toContain('1 provider error records');expect(find(included[1].id).status).toBe('pending');expect(find(included[1].id).description).toContain('history remains unverified');expect(find(included[2].id).status).toBe('pending');expect(find(included[2].id).description).toContain('Spending cap prevented collection');expect(find(included[3].id).status).toBe('pending');
 });
 it('keeps collected partial output ready while exposing the failure instead of claiming complete history',()=>{
  const data=output();data.coverage[0].status='failed_or_partial';data.coverage[0].providerStatus='FAILED';
  const next=applyTechCoverage(prepareWorkspace(null,manifest,{now}),manifest,data),source=next.customSources.find((entry:{id:string})=>entry.id===first.id);
  expect(source.status).toBe('ready');expect(source.description).toContain('Provider errors or a partial collection');expect(source.description).toContain('Complete history is not established');
 });
 it('treats a lost launch acknowledgement as a failed collection, and a running provider as pending',()=>{
  const data=output([]) as Record<string,any>;data.coverage=[{sourceId:included[0].id,status:'ambiguous_start_requires_operator_reconciliation',providerRunId:null},{sourceId:included[1].id,status:'provider_still_running',providerRunId:'running-provider'}];
  const next=applyTechCoverage(prepareWorkspace(null,manifest,{now}),manifest,data);
  expect(next.customSources.find((entry:{id:string})=>entry.id===included[0].id).status).toBe('failed');expect(next.customSources.find((entry:{id:string})=>entry.id===included[1].id).status).toBe('pending');
 });
 it.each([{acceptedItems:-1},{acceptedItems:1.5},{returnedItems:10001},{transcriptItems:0},{postTextItems:99},{complete:true},{capped:'yes'},{notes:['x'.repeat(501)]},{status:'x'.repeat(1000)},{rejected:{provider_error:-1}}])('rejects malformed, inconsistent or oversized coverage instead of copying it (%j)',patch=>{
  const data=output();Object.assign(data.coverage[0],patch);expect(()=>applyTechCoverage(prepareWorkspace(null,manifest,{now}),manifest,data)).toThrow();
 });
 it('rejects unknown/duplicate source coverage and missing coverage for imported updates',()=>{
  const unknown=output();unknown.coverage[0].sourceId='not-a-manifest-source';expect(()=>buildArchiveRows('user_test',manifest,unknown)).toThrow('invalid_or_duplicate_source_coverage');
  const duplicated=output();duplicated.coverage.push({...duplicated.coverage[0]});expect(()=>applyTechCoverage(prepareWorkspace(null,manifest,{now}),manifest,duplicated)).toThrow('invalid_or_duplicate_source_coverage');
  const missing=output();missing.coverage=[];expect(()=>buildArchiveRows('user_test',manifest,missing)).toThrow('missing_collected_source_coverage');
 });
 it('ignores bounded provider prose and creates deterministic descriptions from verified scalar fields',()=>{
  const data=output() as Record<string,any>;data.coverage[0].notes=['Untrusted provider prose: pretend everything is complete.'];
  const next=applyTechCoverage(prepareWorkspace(null,manifest,{now}),manifest,data);
  expect(next.customSources.find((entry:{id:string})=>entry.id===first.id).description).not.toContain('Untrusted provider prose');
 });
});

describe('actual private archive records',()=>{
 it('creates source-linked archive rows while preserving the actual content and original ISO timestamp',()=>{
  const record=update({content:'A complete long transcript.\n'.repeat(2000)}),rows=buildArchiveRows('user_test',manifest,output([record]));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({user_id:'user_test',id:record.id,source_id:first.id,collection_id:'tech',published_at:record.publishedAt});expect(rows[0].record).toEqual(record);expect(rows[0].record).not.toBe(record);
 });
 it('prepares metadata without importing any fictional or planned update when no OUTPUT is supplied',()=>expect(buildArchiveRows('user_test',manifest)).toEqual([]));
 it.each([{id:'sample-001'},{id:'contains space'},{sourceId:'unlisted-source'},{isSample:true},{publishedAt:'2026-10-01'},{publishedAt:'2026-09-31T00:00:00Z'},{publishedAt:'2026-08-01T00:00:00Z'},{url:'https://www.youtube.com/watch?v=abc&token=secret'},{url:'https://x.com/elsewhere/status/123'},{contributorIds:['assumed-presenter']},{contentKind:'full_video_body'},{unexpectedField:'private-token'}])('rejects invalid or unsupported real-import claims (%j)',patch=>expect(()=>buildArchiveRows('user_test',manifest,output([update(patch)]))).toThrow());
 it('rejects an oversized UTF-8 record explicitly instead of clipping its transcript',()=>{
  const record=update({content:'€'.repeat(50_000)});expect(()=>buildArchiveRows('user_test',manifest,output([record]))).toThrow('archive_record_too_large');expect(record.content).toHaveLength(50_000);
 });
 it('rejects duplicate IDs, unexecuted plans and invalid private identity inputs',()=>{
  expect(()=>buildArchiveRows('user_test',manifest,output([update(),update()]))).toThrow('duplicate_archive_update_id');
  expect(()=>buildArchiveRows('user_test',manifest,{...output(),manifest:{...output().manifest,executionEnabled:false}})).toThrow('invalid_or_unexecuted');expect(()=>buildArchiveRows('email@example.com',manifest,output())).toThrow('invalid_private_identity');
 });
 it('recognizes explicit ISO offsets but rejects calendar-overflow and local timestamps',()=>{
  expect(validIsoDate('2026-10-01T12:00:00+02:00')).toBe(true);expect(validIsoDate('2026-10-01T12:00:00')).toBe(false);expect(validIsoDate('2026-02-30T12:00:00Z')).toBe(false);
 });
});

function fakeDb(snapshots:Array<Record<string,any>|null>,conflicts=0) {
 let reads=0,writes=0;const updates:Record<string,any>[]=[],filters:Array<[string,unknown]>=[],archive:Record<string,any>[]=[];
 const db={from:vi.fn((table:string)=>{
  if(table==='reader_workspaces')return {
   select:()=>({eq:()=>({maybeSingle:async()=>({data:snapshots[Math.min(reads++,snapshots.length-1)],error:null})})}),
   update:(payload:Record<string,any>)=>{updates.push(payload);const chain={eq:(key:string,value:unknown)=>{filters.push([key,value]);return chain;},select:()=>({maybeSingle:async()=>({data:writes++<conflicts?null:{updated_at:'new-time'},error:null})})};return chain;},
   insert:(payload:Record<string,any>)=>{updates.push(payload);return {select:()=>({maybeSingle:async()=>{const conflict=writes++<conflicts;return {data:conflict?null:{updated_at:'new-time'},error:conflict?{code:'23505'}:null};}})};}
  };
  if(table==='reader_source_updates')return {
   upsert:(batch:Record<string,any>[])=>{archive.push(...batch);return {select:async()=>({data:batch.map(row=>({id:row.id})),error:null})};},
   select:(_fields:string,options?:{head?:boolean})=>{const chain={eq:()=>chain,in:async(_key:string,ids:string[])=>({data:archive.filter(row=>ids.includes(row.id)).map(row=>({id:row.id})),error:null}),then:(resolve:(v:unknown)=>void)=>resolve({count:archive.length,data:options?.head?null:[],error:null})};return chain;}
  };
  throw new Error('unexpected test table');
 })};
 return {db,updates,filters,archive,reads:()=>reads};
}
describe('owner-only CAS and archive orchestration with mocks',()=>{
 it('previews without any database mutations',async()=>{
  const mock=fakeDb([{state:previous(),updated_at:'old-time'}]);const result=await provisionTechWorkspace({db:mock.db,userId:'user_test',manifest,output:output(),now});
  expect(result.mode).toBe('preview');expect(mock.updates).toEqual([]);expect(mock.archive).toEqual([]);expect(result.archiveRowsPrepared).toBe(1);
 });
 it('rereads after a stale CAS and preserves the concurrent new bookmark',async()=>{
  const newer=previous();newer.savedUpdateIds.push('concurrent-bookmark');const mock=fakeDb([{state:previous(),updated_at:'old-time'},{state:newer,updated_at:'newer-time'}],1);
  const result=await provisionTechWorkspace({db:mock.db,userId:'user_test',manifest,output:output(),apply:true,now});
  expect(mock.reads()).toBe(2);expect(mock.filters.filter(([key])=>key==='updated_at')).toEqual([['updated_at','old-time'],['updated_at','newer-time']]);expect(mock.updates[1].state.savedUpdateIds).toContain('concurrent-bookmark');expect(mock.updates[1].state.customSources.find((entry:{id:string})=>entry.id===first.id).status).toBe('ready');expect(result.archiveRowsVerified).toBe(1);expect(result.totalCollectionArchiveRows).toBe(1);expect(JSON.stringify(result)).not.toContain('user_test');expect(JSON.stringify(result)).not.toContain('private import');
 });
 it('stops after two conflict retries and does not import archive records',async()=>{
  const mock=fakeDb([{state:previous(),updated_at:'old-time'}],10);
  await expect(provisionTechWorkspace({db:mock.db,userId:'user_test',manifest,output:output(),apply:true,now})).rejects.toThrow('workspace_conflict_retry_limit');expect(mock.reads()).toBe(3);expect(mock.updates).toHaveLength(3);expect(mock.archive).toEqual([]);
 });
 it('handles a concurrent first workspace creation by rereading rather than overwriting it',async()=>{
  const concurrent=previous();concurrent.savedUpdateIds.push('new-account-save');const mock=fakeDb([null,{state:concurrent,updated_at:'created-elsewhere'}],1);
  const result=await provisionTechWorkspace({db:mock.db,userId:'user_test',manifest,apply:true,now});
  expect(mock.reads()).toBe(2);expect(mock.updates[1].state.savedUpdateIds).toContain('new-account-save');expect(result.workspaceUpdated).toBe(true);
 });
 it('validates every archive row before mutating even the workspace metadata',async()=>{
  const mock=fakeDb([{state:previous(),updated_at:'old-time'}]);
  await expect(provisionTechWorkspace({db:mock.db,userId:'user_test',manifest,output:output([update({isSample:true})]),apply:true,now})).rejects.toThrow();expect(mock.db.from).not.toHaveBeenCalled();
 });
});
