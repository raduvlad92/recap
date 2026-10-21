import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone private enrichment tool deliberately has no TS declaration.
import { buildVideoMetadataBatches, buildVideoMetadataPlan, buildVideoMetadataSql, captionSegmentsFromExport, loadSavedCaptions, loadSavedDatasets, main, readVideoMetadataState, youtubeVideoId } from '../scripts/enrich-video-metadata.mjs';

const sourceId='tech-source-a',videoId='abcdef12345',userId='user_syntheticowner';
const source={id:sourceId,name:'Official channel',platform:'YouTube',url:'https://www.youtube.com/@Example',aliases:[],scope:'included'};
const avatar='https://yt3.googleusercontent.com/official-avatar';
const originalRecord=()=>({id:'tech-video-one',sourceId,contributorIds:[],title:'An actual video',summary:'Publisher extract.',url:'https://www.youtube.com/watch?v='+videoId,publishedAt:'2026-10-01T12:00:00.000Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false,content:'Original words.',contentKind:'transcript',coverage:'Existing YouTube subtitles; no generated transcription or AI analysis.'});
const raw=()=>({id:videoId,url:'https://www.youtube.com/watch?v='+videoId,channelUrl:source.url,input:source.url,date:'2026-10-01T12:00:00Z',type:'shorts',title:'An actual video',channelAvatarUrl:avatar,subtitles:[{language:'en',plaintext:'Original words.'}]});
const input=()=>({archiveRows:[{user_id:userId,id:'tech-video-one',source_id:sourceId,record:originalRecord()}],workspace:{user_id:userId,updated_at:'2026-10-21T12:00:00.000Z',state:{version:1,settings:{timezone:'Europe/Berlin'},customSources:[{...source,status:'ready',creatorIds:[]}],followedSourceIds:[sourceId],savedUpdateIds:['tech-video-one'],readLaterIds:['tech-video-one'],sourcePreferences:{[sourceId]:{showShorts:false}},importedUpdates:[],sourceCollections:[{id:'tech',name:'tech',sourceIds:[sourceId]}]}},datasets:[{sourceId,items:[raw()]}],sourceManifest:{sources:[source]},captions:new Map([[videoId,{status:'timed',segments:[{startSeconds:0,text:'Original words.'}]}]])});
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

describe('private video enrichment planning',()=>{
  it('enriches only existing exact source/video records and preserves reader settings, follows, saves and hidden Shorts',()=>{
    const before=input(),snapshot=structuredClone(before),plan=buildVideoMetadataPlan(before);
    expect(before).toEqual(snapshot);
    expect(plan.stats).toMatchObject({archiveRows:1,youtubeRows:1,matchedRows:1,shorts:1,rawPlaintextRows:1,restoredContentRows:0,timedRows:1,archiveRowsToPatch:1,sourceAvatarsToPatch:1});
    expect(plan.archivePatches[0].record).toEqual({...originalRecord(),isShort:true,transcriptSegments:[{startSeconds:0,text:'Original words.'}]});
    const next=plan.workspace.state,old=before.workspace.state;
    expect({...next,customSources:old.customSources}).toEqual(old);
    expect(next.customSources[0]).toEqual({...old.customSources[0],avatarUrl:avatar});
    expect(next.sourcePreferences).toEqual({[sourceId]:{showShorts:false}});
  });
  it('restores a full saved transcript and removes only its obsolete clipping sentence',()=>{
    const before=input(),full='A complete source transcript. '.repeat(10000);
    before.archiveRows[0].record.content=full.slice(0,200000).trim();
    before.archiveRows[0].record.coverage+=' Source text was clipped at 200,000 characters; the remaining text is not included.';
    before.datasets[0].items[0].subtitles[0].plaintext=full;
    const plan=buildVideoMetadataPlan(before),record=plan.archivePatches[0].record;
    expect(plan.stats.restoredContentRows).toBe(1);expect(record.content).toBe(full.trim());
    expect(record.coverage).toBe(originalRecord().coverage);expect(record.id).toBe(originalRecord().id);
  });
  it('keeps all unrelated platform history outside the patch and retains sample/default preferences',()=>{
    const before=input() as Record<string,any>;
    before.archiveRows.push({user_id:userId,id:'tech-post',source_id:'x-source',record:{...originalRecord(),id:'tech-post',sourceId:'x-source',url:'https://x.com/example/status/123',format:'post'}});
    before.workspace.state.sourcePreferences['northstar-main']={showShorts:false};
    const plan=buildVideoMetadataPlan(before);
    expect(plan.stats.archiveRows).toBe(2);expect(plan.archivePatches.map((patch:{id:string})=>patch.id)).toEqual(['tech-video-one']);
    expect(plan.workspace.state.sourcePreferences['northstar-main']).toEqual({showShorts:false});
  });
  it('retains full plaintext but omits timing for truncated tool exports',()=>{
    const before=input();before.captions.set(videoId,{status:'truncated',segments:[]});
    const plan=buildVideoMetadataPlan(before);
    expect(plan.archivePatches[0].record.content).toBe('Original words.');expect(plan.archivePatches[0].record).not.toHaveProperty('transcriptSegments');
    expect(plan.stats).toMatchObject({truncatedTimingRows:1,timedRows:0,noTimingRows:1});
  });
  it('omits timing when the combined UTF-8 archive record would exceed 1MB while retaining full plaintext',()=>{
    const before=input(),full='€'.repeat(200000);before.datasets[0].items[0].subtitles[0].plaintext=full;before.archiveRows[0].record.content=full;
    before.captions.set(videoId,{status:'timed',segments:Array.from({length:80},(_,index)=>({startSeconds:index,text:'€'.repeat(2000)}))});
    const plan=buildVideoMetadataPlan(before);
    expect(plan.stats.timingOmittedForSizeRows).toBe(1);expect(plan.archivePatches[0].record.content).toBe(full);expect(plan.archivePatches[0].record).not.toHaveProperty('transcriptSegments');
    before.datasets[0].items[0].subtitles[0].plaintext='€'.repeat(334000);before.archiveRows[0].record.content='€'.repeat(334000);
    expect(()=>buildVideoMetadataPlan(before)).toThrow('enriched_archive_record_too_large');
  });
  it('preserves operator-edited transcripts and applies the historical normalization before restoring known clipped content',()=>{
    const edited=input();edited.archiveRows[0].record.content='An operator correction.';
    expect(buildVideoMetadataPlan(edited).archivePatches[0].record.content).toBe('An operator correction.');
    expect(buildVideoMetadataPlan(edited).stats.preservedDifferentContentRows).toBe(1);
    const normalized=input();normalized.datasets[0].items[0].subtitles[0].plaintext='WEBVTT\n123\nOriginal <b>words.</b>\n00:01 --> 00:02';
    expect(buildVideoMetadataPlan(normalized).archivePatches[0].record.content).toBe('Original words.');
    expect(buildVideoMetadataPlan(normalized).stats.restoredContentRows).toBe(0);
    const clipped=input();clipped.archiveRows[0].record.content='An operator correction.';clipped.archiveRows[0].record.coverage+=' Source text was clipped at 200,000 characters; the remaining text is not included.';clipped.datasets[0].items[0].subtitles[0].plaintext='captions '.repeat(25000);
    expect(buildVideoMetadataPlan(clipped).archivePatches[0].record.content).toBe('An operator correction.');expect(buildVideoMetadataPlan(clipped).stats.restoredContentRows).toBe(0);
  });
  it.each(['https://example.org/photo','http://yt3.googleusercontent.com/photo','https://yt3.googleusercontent.com/photo?token=private'])('does not import an unverified avatar %s',channelAvatarUrl=>{
    const before=input();before.datasets[0].items[0].channelAvatarUrl=channelAvatarUrl;
    const plan=buildVideoMetadataPlan(before);expect(plan.stats.sourceAvatarsToPatch).toBe(0);expect(plan.workspace.state.customSources[0]).not.toHaveProperty('avatarUrl');
  });
  it('requires one owner and refuses raw channel spoofing, unmatched new rows or changed workspace source identity',()=>{
    const multiple=input();multiple.archiveRows.push({...multiple.archiveRows[0],user_id:'user_other'});expect(()=>buildVideoMetadataPlan(multiple)).toThrow('ambiguous_archive_owner');
    const foreign=input();foreign.datasets[0].items[0].channelUrl='https://www.youtube.com/@Foreign';expect(()=>buildVideoMetadataPlan(foreign)).toThrow('source_or_url_unverified');
    const wrongId=input();wrongId.datasets[0].items[0].id='zyxwvut9876';expect(()=>buildVideoMetadataPlan(wrongId)).toThrow('video_identity_mismatch');
    const extra=input();extra.datasets[0].items.push({...raw(),id:'zyxwvut9876',url:'https://www.youtube.com/watch?v=zyxwvut9876'});expect(()=>buildVideoMetadataPlan(extra)).toThrow('existing_archive_only');
    const edited=input();edited.workspace.state.customSources[0].url='https://www.youtube.com/@Foreign';expect(()=>buildVideoMetadataPlan(edited)).toThrow('workspace_source_identity_mismatch');
  });
});

describe('real timing export parsing',()=>{
  it('reads actual minute/hour timestamps and continuation lines with identity checks',()=>{
    expect(captionSegmentsFromExport('YouTube transcript\nVideo ID: '+videoId+'\nSource: YouTube\n\n[0:00] Opening.\n[2:15] Detail.\nMore detail.\n[1:02:03] Later.',{videoId})).toEqual({status:'timed',segments:[{startSeconds:0,text:'Opening.'},{startSeconds:135,text:'Detail. More detail.'},{startSeconds:3723,text:'Later.'}]});
    expect(()=>captionSegmentsFromExport('Video ID: zyxwvut9876\n[0:00] Words.',{videoId})).toThrow('caption_video_identity_mismatch');
  });
  it.each(['[Transcript truncated]','Warning: truncated output','100 lines omitted','Output was truncated'])('omits a marked partial export (%s)',marker=>{
    expect(captionSegmentsFromExport('[0:00] Start.\n[1:00] Later.\n'+marker,{videoId})).toEqual({status:'truncated',segments:[]});
  });
  it('rejects backward/invalid timestamps and never estimates timing from untimed text',()=>{
    expect(captionSegmentsFromExport('[0:20] Start.\n[0:10] Earlier.',{videoId}).status).toBe('invalid_timing');
    expect(captionSegmentsFromExport('[0:99] Invalid.',{videoId}).status).toBe('invalid_timing');
    expect(captionSegmentsFromExport('This discussion mentions 2:15.',{videoId})).toEqual({status:'no_timing',segments:[]});
    expect(youtubeVideoId('https://youtube.com.evil.example/watch?v='+videoId)).toBeNull();
    expect(youtubeVideoId('https://youtube.com/shorts/'+videoId)).toBe(videoId);
  });
});

describe('reviewable atomic SQL and private artifact IO',()=>{
  it('partitions transport-sized archive batches exactly once and leaves source avatars until the final revision change',()=>{
    const before=input(),nextVideo='zyxwvut9876';
    before.archiveRows.push({...before.archiveRows[0],id:'tech-video-two',record:{...originalRecord(),id:'tech-video-two',url:'https://www.youtube.com/watch?v='+nextVideo}});
    before.datasets[0].items.push({...raw(),id:nextVideo,url:'https://www.youtube.com/watch?v='+nextVideo});
    before.captions.set(nextVideo,{status:'timed',segments:[{startSeconds:0,text:'Original words.'}]});
    const plan=buildVideoMetadataPlan(before),single={...plan,archivePatches:[plan.archivePatches[0]],workspace:{...plan.workspace,state:plan.workspace.before.state}};
    const singleBytes=Buffer.byteLength(buildVideoMetadataSql(single),'utf8'),maxBytes=singleBytes+50;
    const batches=buildVideoMetadataBatches(plan,{maxBytes,maxSinglePatchBytes:maxBytes+1000});
    expect(batches.map((batch:{archivePatches:number})=>batch.archivePatches)).toEqual([1,1,0]);
    expect(batches.flatMap((batch:{recordIds:string[]})=>batch.recordIds)).toEqual(['tech-video-one','tech-video-two']);
    expect(batches.every((batch:{bytes:number})=>batch.bytes<=maxBytes)).toBe(true);
    expect(batches[0].sql).not.toContain(avatar);expect(batches[1].sql).not.toContain(avatar);expect(batches[2].sql).toContain(avatar);
    expect(batches[2].kind).toBe('workspace-avatars');
  });
  it('permits only an explicitly bounded oversized single patch and rejects payloads beyond the hard ceiling',()=>{
    const plan=buildVideoMetadataPlan(input()),single={...plan,workspace:{...plan.workspace,state:plan.workspace.before.state}};
    const singleBytes=Buffer.byteLength(buildVideoMetadataSql(single),'utf8');
    const batches=buildVideoMetadataBatches(plan,{maxBytes:singleBytes-1,maxSinglePatchBytes:singleBytes+1});
    expect(batches[0].exceedsNormalLimit).toBe(true);expect(batches[0].archivePatches).toBe(1);
    expect(()=>buildVideoMetadataBatches(plan,{maxBytes:singleBytes-2,maxSinglePatchBytes:singleBytes-1})).toThrow('single_enrichment_patch_exceeds_transport_limit');
  });
  it('uses one transaction with all record locks/checks before writes and both archive/state CAS',()=>{
    const before=input();before.datasets[0].items[0].subtitles[0].plaintext="Creator's exact words; $$ are source text.";
    before.archiveRows[0].record.content=before.datasets[0].items[0].subtitles[0].plaintext;
    const plan=buildVideoMetadataPlan(before),sql=buildVideoMetadataSql(plan);
    expect(sql.startsWith('begin;\n')).toBe(true);expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain('for update');expect(sql).toContain("record=item->'beforeRecord'");expect(sql).toContain("updated_at=(payload#>>'{workspace,before,updated_at}')::timestamptz");
    expect(sql.indexOf("raise exception 'stale_video_archive_plan'")).toBeLessThan(sql.indexOf('update public.reader_source_updates'));
    expect(sql).toContain("Creator''s exact words");expect(sql).not.toMatch(/\b(?:insert into|delete from|upsert)\b/i);
    expect(sql).toContain('set local standard_conforming_strings=on');
  });
  it('rejects tampered history identity, unrelated archive fields and reader preferences in plans',()=>{
    const changedId=buildVideoMetadataPlan(input());changedId.archivePatches[0].record.id='other-id';expect(()=>buildVideoMetadataSql(changedId)).toThrow('invalid_archive_enrichment_patch');
    const changedTitle=buildVideoMetadataPlan(input());changedTitle.archivePatches[0].record.title='Invented title';expect(()=>buildVideoMetadataSql(changedTitle)).toThrow('invalid_archive_enrichment_patch');
    const changedPrefs=buildVideoMetadataPlan(input());changedPrefs.workspace.state.sourcePreferences[sourceId].showShorts=true;expect(()=>buildVideoMetadataSql(changedPrefs)).toThrow('workspace_change_outside_source_avatars');
  });
  it('loads only matching dataset filenames and real caption files within the private caption directory',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'recap-video-metadata-'));temporary.push(directory);const captionsDirectory=join(directory,'captions');await mkdir(captionsDirectory);
    await writeFile(join(directory,sourceId+'.json'),JSON.stringify({sourceId,items:[raw()]}));
    expect(await loadSavedDatasets(directory)).toHaveLength(1);
    await writeFile(join(captionsDirectory,'caption.txt'),'Video ID: '+videoId+'\n[0:00] Words.');
    const manifestPath=join(captionsDirectory,'manifest.json');await writeFile(manifestPath,JSON.stringify([{videoId,path:'caption.txt',status:'exported'},{videoId:'unavailable',path:null,status:'unavailable'}]));
    expect((await loadSavedCaptions(manifestPath)).get(videoId).segments).toEqual([{startSeconds:0,text:'Words.'}]);
    await writeFile(manifestPath,JSON.stringify([{videoId,path:'../'+sourceId+'.json',status:'exported'}]));
    await expect(loadSavedCaptions(manifestPath)).rejects.toThrow('outside_private_directory');
    await writeFile(join(directory,sourceId+'.json'),JSON.stringify({sourceId:'mismatch',items:[]}));
    await expect(loadSavedDatasets(directory)).rejects.toThrow('dataset_filename_source_mismatch');
    expect(await readFile(join(captionsDirectory,'caption.txt'),'utf8')).toContain('[0:00] Words.');
  });
  it('paginates read-only archive queries and stops before reading any workspace when ownership is ambiguous',async()=>{
    const rows=Array.from({length:503},(_,index)=>({...input().archiveRows[0],id:'tech-'+index})),offsets:number[]=[],mutations=vi.fn();
    const db={from:vi.fn((table:string)=>{
      if(table==='reader_source_updates')return {select:()=>({eq:()=>({order:()=>({range:async(offset:number,last:number)=>{offsets.push(offset);return {data:rows.slice(offset,last+1),error:null};}})})}),update:mutations,insert:mutations,delete:mutations};
      return {select:()=>({eq:()=>({single:async()=>({data:input().workspace,error:null})})})};
    })};
    expect((await readVideoMetadataState(db)).archiveRows).toHaveLength(503);expect(offsets).toEqual([0,500]);expect(mutations).not.toHaveBeenCalled();
    rows[0].user_id='user_other';await expect(readVideoMetadataState(db)).rejects.toThrow('exactly_one_existing_tech_owner_required');
  });
  it('refuses a command-line apply instead of silently making any database mutation',async()=>{
    await expect(main(['--apply'])).rejects.toThrow('apply_generated_sql_through_reviewed_transaction_transport');
  });
});
