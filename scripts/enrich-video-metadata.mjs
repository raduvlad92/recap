#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeItem, publicUrl, sourceKey } from '../actors/tech-collector/src/collector.mjs';

const TARGET='zlfdqzabsfndifxiqguo';
const MAX_RECORD_BYTES=1_000_000;
const fail=code=>Object.assign(new Error(code),{safeCode:code});
const object=value=>!!value && typeof value==='object' && !Array.isArray(value);
const clone=value=>structuredClone(value);
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const hash=value=>createHash('sha256').update(stable(value)).digest('hex');
const jsonbText=value=>Array.isArray(value)?'['+value.map(jsonbText).join(', ')+']':object(value)?'{'+Object.entries(value).map(([key,item])=>JSON.stringify(key)+': '+jsonbText(item)).join(', ')+'}':JSON.stringify(value);
const bytes=value=>Buffer.byteLength(jsonbText(value),'utf8');
const validOwner=value=>typeof value==='string' && /^user_[A-Za-z0-9]{1,100}$/.test(value);
const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,249}$/.test(value);
const safeAvatar=value=>typeof value==='string' && value.length<=2000 && publicUrl(value) && new URL(value).hostname==='yt3.googleusercontent.com';
const clippedNotice=' Source text was clipped at 200,000 characters; the remaining text is not included.';
const legacyPlaintext=value=>value.replace(/\u0000/g,'').trim().split('\n').filter(line=>!/^\s*\d+\s*$/.test(line) && !/-->/.test(line) && !/^WEBVTT/.test(line)).join('\n').replace(/<[^>]*>/g,'').trim();

export function youtubeVideoId(value) {
  const safe=typeof value==='string'?publicUrl(value):'';
  if(!safe)return null;
  const url=new URL(safe),host=url.hostname.replace(/^www\./,'').toLowerCase();
  if(!['youtube.com','youtu.be'].includes(host))return null;
  const id=host==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):/^\/(shorts|live)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)?url.pathname.split('/')[2]:null;
  return /^[A-Za-z0-9_-]{6,20}$/.test(id || '')?id:null;
}

/** Reject marked partial tool output; the full saved plaintext remains a separate input. */
export function captionSegmentsFromExport(text,entry) {
  const truncated=entry?.truncated===true || entry?.toolTruncated===true || entry?.status==='truncated' || /(?:warning:\s*truncated output|original token count|\[(?:[^\]\n]*\btruncated\b[^\]\n]*)\]|<truncated>|\b\d+\s+(?:characters|lines|tokens)\s+omitted\b|output (?:was |has been )?truncated)/i.test(text);
  if(truncated)return {segments:[],status:'truncated'};
  const declared=/^Video ID:\s*(\S+)/m.exec(text)?.[1];
  if(declared && declared!==entry.videoId)throw fail('caption_video_identity_mismatch');
  const segments=[];
  for(const line of text.replace(/\r\n?/g,'\n').split('\n')) {
    const match=/^\[(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{1,3}))?\]\s*(.*)$/.exec(line.trim());
    if(match) {
      const startSeconds=match[3]===undefined?Number(match[1])*60+Number(match[2]):Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
      const start=startSeconds+(match[4]?Number(match[4].padEnd(3,'0'))/1000:0);
      if(!Number.isSafeInteger(startSeconds) || startSeconds<0 || !match[5].trim() || match[5].length>10000 || (segments.length && start<segments.at(-1).startSeconds))return {segments:[],status:'invalid_timing'};
      segments.push({startSeconds:start,text:match[5].trim()});
    } else if(/^\[\d/.test(line.trim()))return {segments:[],status:'invalid_timing'};
    else if(segments.length && line.trim())segments.at(-1).text+=' '+line.trim();
  }
  if(segments.length>10000 || segments.some(segment=>segment.text.length>10000))return {segments:[],status:'invalid_timing'};
  return {segments,status:segments.length?'timed':'no_timing'};
}

export async function loadSavedCaptions(manifestPath,baseDirectory=dirname(manifestPath)) {
  let entries;
  try{entries=JSON.parse(await readFile(manifestPath,'utf8'));}catch(problem){if(problem.code==='ENOENT')return new Map();throw fail('caption_manifest_unreadable');}
  if(!Array.isArray(entries))throw fail('invalid_caption_manifest');
  const base=await realpath(baseDirectory),captions=new Map();
  for(const entry of entries) {
    if(!object(entry) || !/^[A-Za-z0-9_-]{6,20}$/.test(entry.videoId || ''))throw fail('invalid_caption_manifest_entry');
    if(entry.status!=='exported' && entry.status!=='truncated')continue;
    if(typeof entry.path!=='string')throw fail('invalid_caption_manifest_entry');
    if(captions.has(entry.videoId))throw fail('duplicate_caption_video');
    let path;
    try{path=await realpath(isAbsolute(entry.path)?entry.path:resolve(base,entry.path));}catch{throw fail('saved_caption_file_missing');}
    if(path!==base && !path.startsWith(base+sep))throw fail('caption_path_outside_private_directory');
    const text=await readFile(path,'utf8');
    captions.set(entry.videoId,captionSegmentsFromExport(text,entry));
  }
  return captions;
}

export async function loadSavedDatasets(directory) {
  const datasets=[];
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.json')).sort()) {
    const dataset=JSON.parse(await readFile(resolve(directory,name),'utf8'));
    if(!object(dataset) || !Array.isArray(dataset.items) || dataset.sourceId!==name.slice(0,-5))throw fail('dataset_filename_source_mismatch');
    datasets.push(dataset);
  }
  return datasets;
}

function sourceAliases(source) {return new Set([source.url,...(source.aliases || []),...(source.youtubeChannelId?['https://www.youtube.com/channel/'+source.youtubeChannelId]:[])].map(url=>sourceKey(url,'YouTube')));}
function assertRecordSize(record) {
  if(JSON.stringify(record).includes('\\u0000') || bytes(record)>MAX_RECORD_BYTES)throw fail('enriched_archive_record_too_large_or_unsupported');
}
function sameOutside(before,after,allowed) {
  const omit=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!allowed.has(key)));
  return stable(omit(before))===stable(omit(after));
}
function assertWorkspaceAvatarsOnly(before,after) {
  if(!object(before) || !object(after) || !Array.isArray(before.customSources) || !Array.isArray(after.customSources) || before.customSources.length!==after.customSources.length || !sameOutside(before,after,new Set(['customSources'])))throw fail('workspace_change_outside_source_avatars');
  for(let index=0;index<before.customSources.length;index++) {
    const previous=before.customSources[index],next=after.customSources[index];
    if(!sameOutside(previous,next,new Set(['avatarUrl'])) || (previous.avatarUrl!==next.avatarUrl && (previous.platform!=='YouTube' || !safeAvatar(next.avatarUrl))))throw fail('workspace_change_outside_source_avatars');
  }
}

export function buildVideoMetadataPlan({archiveRows,workspace,datasets,sourceManifest,captions=new Map(),now=new Date().toISOString()}) {
  if(!Array.isArray(archiveRows) || !archiveRows.length || archiveRows.some(row=>!validOwner(row.user_id)))throw fail('private_archive_owner_required');
  const owners=new Set(archiveRows.map(row=>row.user_id));
  if(owners.size!==1)throw fail('ambiguous_archive_owner');
  const userId=[...owners][0];
  if(!object(workspace) || workspace.user_id!==userId || !object(workspace.state) || !Array.isArray(workspace.state.customSources) || typeof workspace.updated_at!=='string' || !Number.isFinite(Date.parse(workspace.updated_at)))throw fail('matching_existing_owner_workspace_required');
  if(!Array.isArray(sourceManifest?.sources))throw fail('source_manifest_required');
  const sources=new Map(sourceManifest.sources.filter(source=>source.scope==='included' && source.platform==='YouTube').map(source=>[source.id,source]));
  const knownSources=new Map(workspace.state.customSources.map(source=>[source.id,source]));
  const rawByVideo=new Map();
  let rawYouTubeRows=0;
  for(const dataset of datasets) {
    const source=sources.get(dataset.sourceId);
    if(!source)continue;
    const checkedSource={...source,aliases:source.aliases || [],channelId:source.youtubeChannelId,key:sourceKey(source.url,'YouTube')};
    for(const raw of dataset.items) {
      if(!object(raw) || raw.error)continue;
      const normalized=normalizeItem(checkedSource,raw,{dateFrom:'1970-01-01T00:00:00.000Z',dateTo:'9999-12-31T23:59:59.000Z'});
      if(!normalized.update)throw fail('saved_youtube_row_source_or_url_unverified');
      const videoId=youtubeVideoId(normalized.update.url);
      if(!videoId || (raw.id && raw.id!==videoId))throw fail('saved_youtube_video_identity_mismatch');
      const key=source.id+':'+videoId;
      if(rawByVideo.has(key))throw fail('duplicate_saved_youtube_video');
      const tracks=Array.isArray(raw.subtitles)?raw.subtitles:[],track=tracks.find(track=>track?.language==='en' && typeof track.plaintext==='string' && track.plaintext.trim()) || tracks.find(track=>typeof track?.plaintext==='string' && track.plaintext.trim());
      rawByVideo.set(key,{raw,normalized,plaintext:track?.plaintext,videoId});rawYouTubeRows++;
    }
  }
  const stats={archiveRows:archiveRows.length,youtubeRows:0,rawYouTubeRows,matchedRows:0,shorts:0,nonShortVideos:0,unknownShortsIdentity:0,rawPlaintextRows:0,restoredContentRows:0,preservedDifferentContentRows:0,timedRows:0,truncatedTimingRows:0,invalidTimingRows:0,noTimingRows:0,timingOmittedForSizeRows:0,archiveRowsToPatch:0,sourceAvatarsToPatch:0};
  const archivePatches=[],avatars=new Map(),seen=new Set();
  for(const row of archiveRows) {
    if(!validId(row.id) || seen.has(row.id) || !object(row.record) || row.record.id!==row.id || row.record.sourceId!==row.source_id)throw fail('invalid_or_duplicate_existing_archive_row');
    seen.add(row.id);
    const source=sources.get(row.source_id);
    if(!source)continue;
    stats.youtubeRows++;
    const savedSource=knownSources.get(source.id);
    if(!savedSource || savedSource.platform!=='YouTube' || !sourceAliases(source).has(sourceKey(savedSource.url,'YouTube')))throw fail('existing_workspace_source_identity_mismatch');
    const videoId=youtubeVideoId(row.record.url),saved=rawByVideo.get(source.id+':'+videoId);
    if(!videoId || !saved)throw fail('existing_youtube_archive_has_no_exact_saved_source_match');
    stats.matchedRows++;
    const record=clone(row.record),{normalized,plaintext,raw}=saved;
    if(typeof normalized.update.isShort==='boolean')record.isShort=normalized.update.isShort;
    if(record.isShort===true)stats.shorts++;else if(record.isShort===false)stats.nonShortVideos++;else stats.unknownShortsIdentity++;
    if(plaintext) {
      stats.rawPlaintextRows++;
      const complete=legacyPlaintext(plaintext),clipped=legacyPlaintext(plaintext.slice(0,200000));
      if(record.content!==complete) {
        if(record.coverage?.includes(clippedNotice) && record.content===clipped && plaintext.length>200000) {
          record.content=complete;record.contentKind='transcript';record.coverage=record.coverage.replace(clippedNotice,'');stats.restoredContentRows++;
        } else stats.preservedDifferentContentRows++;
      }
    }
    const timed=captions.get(videoId);
    if(timed?.status==='timed' && timed.segments.length)record.transcriptSegments=clone(timed.segments);
    else if(timed?.status==='truncated'){delete record.transcriptSegments;stats.truncatedTimingRows++;}
    else if(timed?.status==='invalid_timing'){delete record.transcriptSegments;stats.invalidTimingRows++;}
    if(bytes(record)>MAX_RECORD_BYTES && record.transcriptSegments){delete record.transcriptSegments;stats.timingOmittedForSizeRows++;}
    if(record.transcriptSegments?.length)stats.timedRows++;else stats.noTimingRows++;
    assertRecordSize(record);
    if(safeAvatar(raw.channelAvatarUrl)) {
      const previous=avatars.get(source.id);
      if(previous && previous!==raw.channelAvatarUrl)throw fail('conflicting_saved_channel_avatars');
      avatars.set(source.id,raw.channelAvatarUrl);
    }
    if(hash(record)!==hash(row.record))archivePatches.push({id:row.id,sourceId:row.source_id,beforeHash:hash(row.record),beforeRecord:clone(row.record),record,changedFields:[...new Set([...Object.keys(row.record),...Object.keys(record)])].filter(key=>stable(row.record[key])!==stable(record[key]))});
  }
  if(stats.matchedRows!==rawByVideo.size)throw fail('saved_youtube_rows_do_not_match_existing_archive_only');
  const nextState=clone(workspace.state);
  nextState.customSources=nextState.customSources.map(source=>avatars.has(source.id)?{...source,avatarUrl:avatars.get(source.id)}:source);
  assertWorkspaceAvatarsOnly(workspace.state,nextState);
  stats.sourceAvatarsToPatch=nextState.customSources.filter((source,index)=>source.avatarUrl!==workspace.state.customSources[index].avatarUrl).length;
  stats.archiveRowsToPatch=archivePatches.length;
  if(bytes(nextState)>2_000_000)throw fail('enriched_workspace_metadata_too_large');
  return {version:1,targetProject:TARGET,preparedAt:now,userId,stats,archivePatches,workspace:{before:clone(workspace),beforeHash:hash(workspace.state),state:nextState}};
}

function sqlString(value){return "'"+value.replaceAll("'","''")+"'";}
/** The generated transaction provides full JSON equality CAS without oversized REST URLs. */
export function buildVideoMetadataSql(plan) {
  if(plan?.version!==1 || plan.targetProject!==TARGET || !validOwner(plan.userId) || plan.workspace?.before?.user_id!==plan.userId || hash(plan.workspace.before.state)!==plan.workspace.beforeHash || !Array.isArray(plan.archivePatches))throw fail('invalid_enrichment_plan');
  assertWorkspaceAvatarsOnly(plan.workspace.before.state,plan.workspace.state);
  const patches=plan.archivePatches,ids=new Set();
  for(const patch of patches) {
    if(!validId(patch.id) || !validId(patch.sourceId) || ids.has(patch.id) || patch.beforeRecord?.id!==patch.id || patch.record?.id!==patch.id || patch.beforeRecord.sourceId!==patch.sourceId || patch.record.sourceId!==patch.sourceId || hash(patch.beforeRecord)!==patch.beforeHash || !sameOutside(patch.beforeRecord,patch.record,new Set(['isShort','content','contentKind','coverage','transcriptSegments'])))throw fail('invalid_archive_enrichment_patch');
    ids.add(patch.id);assertRecordSize(patch.record);
  }
  const payload={userId:plan.userId,workspace:plan.workspace,archivePatches:patches.map(({id,sourceId,beforeRecord,record})=>{
    const changed=[...new Set([...Object.keys(beforeRecord),...Object.keys(record)])].filter(key=>stable(beforeRecord[key])!==stable(record[key]));
    return {id,sourceId,beforeRecord,patch:Object.fromEntries(changed.filter(key=>key in record).map(key=>[key,record[key]])),removedFields:changed.filter(key=>!(key in record))};
  })};
  const workspaceCondition="user_id=payload->>'userId' and updated_at=(payload#>>'{workspace,before,updated_at}')::timestamptz and state=payload#>'{workspace,before,state}'";
  const archiveCondition="user_id=payload->>'userId' and id=item->>'id' and source_id=item->>'sourceId' and record=item->'beforeRecord'";
  const body=`declare
  payload jsonb := ${sqlString(JSON.stringify(payload))}::jsonb;
  item jsonb;
  affected integer;
begin
  perform 1 from public.reader_workspaces where ${workspaceCondition} for update;
  if not found then raise exception 'stale_video_workspace_plan'; end if;
  -- Lock and compare every expected record before changing the first one.
  for item in select value from jsonb_array_elements(payload->'archivePatches') loop
    perform 1 from public.reader_source_updates where ${archiveCondition} for update;
    if not found then raise exception 'stale_video_archive_plan'; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'archivePatches') loop
    update public.reader_source_updates set record=(record || (item->'patch')) - array(select jsonb_array_elements_text(item->'removedFields')) where ${archiveCondition};
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'stale_video_archive_plan'; end if;
  end loop;
  if payload#>'{workspace,state}' is distinct from payload#>'{workspace,before,state}' then
    update public.reader_workspaces set state=payload#>'{workspace,state}' where ${workspaceCondition};
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'stale_video_workspace_plan'; end if;
  end if;
end;`;
  let tag='$recap_video_enrich$';while(body.includes(tag))tag='$recap_video_enrich_'+createHash('sha256').update(tag).digest('hex').slice(0,12)+'$';
  return 'begin;\nset local statement_timeout=\'60s\';\nset local lock_timeout=\'5s\';\nset local standard_conforming_strings=on;\ndo '+tag+'\n'+body+'\n'+tag+';\ncommit;\n';
}

/** Each batch is atomic. Completed batches remain committed if a later CAS fails. */
export function buildVideoMetadataBatches(plan,{maxBytes=450*1024,maxSinglePatchBytes=768*1024}={}) {
  if(!Number.isInteger(maxBytes) || !Number.isInteger(maxSinglePatchBytes) || maxBytes<1 || maxSinglePatchBytes<maxBytes)throw fail('invalid_enrichment_batch_limits');
  const batches=[];
  const archivePlan=archivePatches=>({...plan,archivePatches,workspace:{...plan.workspace,state:plan.workspace.before.state}});
  const add=(batchPlan,kind)=>{
    const sql=buildVideoMetadataSql(batchPlan),byteLength=Buffer.byteLength(sql,'utf8');
    if(byteLength>maxBytes && !(kind==='archive' && batchPlan.archivePatches.length===1 && byteLength<=maxSinglePatchBytes))throw fail('single_enrichment_patch_exceeds_transport_limit');
    batches.push({kind,sql,bytes:byteLength,archivePatches:batchPlan.archivePatches.length,recordIds:batchPlan.archivePatches.map(patch=>patch.id),exceedsNormalLimit:byteLength>maxBytes});
  };
  let current=[];
  for(const patch of plan.archivePatches) {
    const candidate=[...current,patch],sql=buildVideoMetadataSql(archivePlan(candidate));
    if(Buffer.byteLength(sql,'utf8')>maxBytes) {
      if(current.length)add(archivePlan(current),'archive');
      current=[];
      const single=archivePlan([patch]);
      if(Buffer.byteLength(buildVideoMetadataSql(single),'utf8')>maxBytes)add(single,'archive');else current=[patch];
    } else current=candidate;
  }
  if(current.length)add(archivePlan(current),'archive');
  // Keep the original owner revision stable until every archive batch has finished.
  add({...plan,archivePatches:[]},'workspace-avatars');
  return batches;
}

export async function writeVideoMetadataBatches(plan,directory,options) {
  const batches=buildVideoMetadataBatches(plan,options);
  await mkdir(directory,{recursive:true,mode:0o700});
  const entries=[];
  for(let index=0;index<batches.length;index++) {
    const batch=batches[index],file=String(index+1).padStart(3,'0')+'-'+batch.kind+'.sql';
    await writeFile(resolve(directory,file),batch.sql,{mode:0o600,flag:'wx'});
    entries.push({index:index+1,file,bytes:batch.bytes,archivePatches:batch.archivePatches,recordIds:batch.recordIds,appliesSourceAvatars:batch.kind==='workspace-avatars',exceedsNormalLimit:batch.exceedsNormalLimit,sha256:createHash('sha256').update(batch.sql).digest('hex')});
  }
  const manifest={version:1,targetProject:TARGET,atomicity:'Each batch is atomic. Earlier completed batches remain committed if a later batch fails. Stop on any error; compare exact before/after records before resuming. Source avatars and the owner revision change only in the final batch.',originalPreparedAt:plan.preparedAt,normalLimitBytes:options?.maxBytes ?? 450*1024,singlePatchLimitBytes:options?.maxSinglePatchBytes ?? 768*1024,archivePatches:entries.reduce((total,entry)=>total+entry.archivePatches,0),sourceAvatars:plan.stats.sourceAvatarsToPatch,largestSqlBytes:Math.max(...entries.map(entry=>entry.bytes)),batches:entries};
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  return manifest;
}

export async function readVideoMetadataState(db) {
  const archiveRows=[];
  for(let offset=0;;offset+=500) {
    const result=await db.from('reader_source_updates').select('user_id,id,source_id,record').eq('collection_id','tech').order('id',{ascending:true}).range(offset,offset+499);
    if(result.error || !Array.isArray(result.data))throw fail('private_archive_read_failed');
    archiveRows.push(...result.data);if(result.data.length<500)break;
  }
  const owners=new Set(archiveRows.map(row=>row.user_id));
  if(owners.size!==1 || !validOwner([...owners][0]))throw fail('exactly_one_existing_tech_owner_required');
  const result=await db.from('reader_workspaces').select('user_id,state,updated_at').eq('user_id',[...owners][0]).single();
  if(result.error || !result.data)throw fail('existing_owner_workspace_read_failed');
  return {archiveRows,workspace:result.data};
}

export async function main(args=process.argv.slice(2)) {
  if(args.includes('--apply'))throw fail('apply_generated_sql_through_reviewed_transaction_transport');
  const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  const projectRoot=resolve(option('--root') || process.cwd()),privateRoot=resolve(projectRoot,'.local');
  const outputDirectory=resolve(option('--output-dir') || resolve(privateRoot,'video-metadata-'+new Date().toISOString().replace(/[:.]/g,'-')));
  if(outputDirectory===privateRoot || !outputDirectory.startsWith(privateRoot+sep))throw fail('private_local_output_directory_required');
  const sourceManifest=JSON.parse(await readFile(resolve(projectRoot,'data/tech/sources.json'),'utf8'));
  const datasets=await loadSavedDatasets(resolve(privateRoot,'tech-datasets'));
  const captions=await loadSavedCaptions(resolve(privateRoot,'video-captions/manifest.json'));
  let snapshot;
  if(option('--snapshot'))snapshot=JSON.parse(await readFile(resolve(option('--snapshot')),'utf8'));
  else {
    const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
    if(!url || !key || new URL(url).origin!=='https://'+TARGET+'.supabase.co')throw fail('exact_recap_service_configuration_required');
    const {createClient}=await import('@supabase/supabase-js');
    snapshot=await readVideoMetadataState(createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
  }
  const plan=buildVideoMetadataPlan({...snapshot,datasets,sourceManifest,captions});
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  await writeFile(resolve(outputDirectory,'before.json'),JSON.stringify(snapshot,null,2),{mode:0o600,flag:'wx'});
  await writeFile(resolve(outputDirectory,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});
  const batches=await writeVideoMetadataBatches(plan,resolve(outputDirectory,'batches'));
  process.stdout.write(JSON.stringify({mode:'read-only-preview',...plan.stats,atomicity:'per-batch',transportBatches:batches.batches.length,largestBatchSqlBytes:batches.largestSqlBytes,privateArtifacts:relative(projectRoot,outputDirectory),databaseWrites:0})+'\n');
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(problem=>{process.stderr.write((problem?.safeCode || 'video_metadata_preview_failed_output_withheld')+'\n');process.exitCode=1;});
