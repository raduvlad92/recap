#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { publicUrl, sourceKey } from '../actors/tech-collector/src/collector.mjs';

const TARGET='zlfdqzabsfndifxiqguo';
const PUBLISHER_ASSOCIATION='Official public channel. Publisher association only; per-update presenter credits remain unknown.';
const object=value=>!!value && typeof value==='object' && !Array.isArray(value);
const unique=values=>[...new Set(values)];
const error=code=>Object.assign(new Error(code),{safeCode:code});
const id=(value,max=120)=>typeof value==='string' && new RegExp('^[A-Za-z0-9][A-Za-z0-9_-]{0,'+(max-1)+'}$').test(value);
const strings=(value,max=200)=>Array.isArray(value) && value.every(v=>typeof v==='string' && v.length<=max);
const clone=value=>structuredClone(value);
const jsonbText=value=>Array.isArray(value)?'['+value.map(jsonbText).join(', ')+']':object(value)?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+': '+jsonbText(v)).join(', ')+'}':JSON.stringify(value);
const jsonBytes=value=>Buffer.byteLength(jsonbText(value),'utf8');
export function validIsoDate(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))return false;
  const [year,month,day]=value.slice(0,10).split('-').map(Number),hour=Number(value.slice(11,13)),minute=Number(value.slice(14,16)),second=Number(value.slice(17,19));
  return month>=1 && month<=12 && day>=1 && day<=new Date(Date.UTC(year,month,0)).getUTCDate() && hour<24 && minute<60 && second<60;
}
function manifestData(manifest) {
  if(!object(manifest) || manifest.version!==1 || manifest.collection?.id!=='tech' || typeof manifest.collection.name!=='string' || !manifest.collection.name.trim() || manifest.collection.name.length>80 || !Array.isArray(manifest.sources) || !Array.isArray(manifest.creators) || !Array.isArray(manifest.groups))throw error('invalid_tech_manifest');
  const sources=manifest.sources.filter(source=>source.scope==='included');
  if(!sources.length || sources.length>50)throw error('invalid_manifest_source_count');
  const sourceIds=new Set(),identities=new Set();
  for(const source of sources) {
    if(!id(source.id) || sourceIds.has(source.id) || typeof source.name!=='string' || !source.name.trim() || source.name.length>200 || !Array.isArray(source.creatorIds) || !source.creatorIds.length || !source.creatorIds.every(v=>id(v,200)) || !id(source.creatorId,200))throw error('invalid_manifest_source');
    let key;try{key=sourceKey(source.url,source.platform);}catch{throw error('invalid_manifest_source_url');}
    if(identities.has(key))throw error('duplicate_manifest_source');
    sourceIds.add(source.id);identities.add(key);
  }
  const creators=new Map();
  for(const creator of manifest.creators) {
    if(!id(creator.id,200) || creators.has(creator.id) || !['person','group'].includes(creator.kind) || typeof creator.name!=='string' || !creator.name.trim() || creator.name.length>200 || typeof creator.description!=='string' || creator.description.length>1800)throw error('invalid_manifest_creator');
    creators.set(creator.id,creator);
  }
  const groups=new Map();
  for(const group of manifest.groups) {if(!id(group.id,200) || groups.has(group.id) || !creators.has(group.creatorId) || creators.get(group.creatorId).kind!=='group')throw error('invalid_manifest_group');groups.set(group.id,group);}
  for(const source of sources)if(!groups.has(source.groupId) || !creators.has(source.creatorId) || source.creatorIds.some(v=>!creators.has(v)))throw error('unlinked_manifest_source');
  return {sources,creators,groups};
}
export function prepareWorkspace(existing,manifest,{now=new Date().toISOString()}={}) {
  if(!validIsoDate(now))throw error('invalid_preparation_date');
  const {sources,creators,groups}=manifestData(manifest);
  const state=existing===null || existing===undefined ? {version:1,followedSourceIds:[],followScopes:[],savedUpdateIds:[],readLaterIds:[],settings:{interests:['AI & technology','Work & productivity'],interfaceLanguage:'en',recapLanguage:'en',timezone:'UTC',deliveryTime:'08:00',emailReminder:false},customSources:[],importedUpdates:[]} : clone(existing);
  if(!object(state) || state.version!==1 || !object(state.settings) || !['followedSourceIds','savedUpdateIds','readLaterIds','customSources','importedUpdates'].every(key=>Array.isArray(state[key])) || !strings(state.followedSourceIds) || (state.customCreators!==undefined && !Array.isArray(state.customCreators)) || (state.sourceCollections!==undefined && !Array.isArray(state.sourceCollections)) || (state.followScopes!==undefined && !Array.isArray(state.followScopes)))throw error('unsupported_existing_workspace');
  const customById=new Map(state.customSources.map(source=>[source.id,source]));
  const sourceCreators=new Map();
  for(const source of sources) {
    const anchors=new Set([source.url,...(source.aliases || [])].map(url=>sourceKey(url,source.platform)));
    const previous=customById.get(source.id);
    if(previous) {let oldKey;try{oldKey=sourceKey(previous.url,previous.platform);}catch{throw error('existing_source_id_conflict');}if(!anchors.has(oldKey))throw error('existing_source_id_conflict');}
    // A different saved source ID for the same known official URL must be reconciled, not overwritten or duplicated.
    for(const old of state.customSources)if(old.id!==source.id) {try{if(anchors.has(sourceKey(old.url,old.platform)))throw error('existing_source_alias_conflict');}catch(problem){if(problem?.safeCode)throw problem;}}
    const ids=unique([...source.creatorIds,groups.get(source.groupId).creatorId]);
    sourceCreators.set(source.id,ids);
    customById.set(source.id,{...(previous || {}),id:source.id,name:source.name,url:source.url,platform:source.platform,creatorIds:ids,status:previous?.status==='ready'?'ready':'pending',description:PUBLISHER_ASSOCIATION});
  }
  state.customSources=[...customById.values()];
  state.followedSourceIds=unique([...state.followedSourceIds,...sources.map(source=>source.id)]);
  if(state.followedSourceIds.length>50)throw error('follow_limit_50_exceeded');
  const platforms=new Map(state.customSources.map(source=>[source.id,source.platform]));
  // The only X fixture is signal-x. Unknown old IDs count conservatively toward the X cap.
  const samplePlatforms={ 'northstar-main':'YouTube','northstar-lab':'YouTube','northstar-podcast':'Podcast','maya-letter':'Substack','leo-blog':'Blog','fieldwork-linkedin':'LinkedIn','fieldwork-blog':'Blog','signal-x':'X','nia-instagram':'Instagram' };
  const xUpperBound=state.followedSourceIds.filter(sourceId=>(platforms.get(sourceId) || samplePlatforms[sourceId] || 'X')==='X').length;
  if(xUpperBound>15)throw error('x_follow_limit_15_exceeded_or_unknown');
  const scopes=state.followScopes || state.followedSourceIds.filter(sourceId=>!sources.some(source=>source.id===sourceId)).map(sourceId=>({kind:'source',id:sourceId}));
  state.followScopes=[...scopes,...sources.filter(source=>!scopes.some(scope=>scope.kind==='source' && scope.id===source.id)).map(source=>({kind:'source',id:source.id}))];
  const customCreators=new Map((state.customCreators || []).map(creator=>[creator.id,creator]));
  for(const creator of creators.values()) {
    const owned=sources.filter(source=>sourceCreators.get(source.id).includes(creator.id)).map(source=>source.id);
    if(!owned.length)continue; // Optional/unresolved personal channels do not become default follows or invented credits.
    const previous=customCreators.get(creator.id),kind=creator.kind==='group'?'studio':'person';
    if(previous && previous.kind!==kind)throw error('existing_creator_id_conflict');
    const associatedPeople=[...creators.values()].filter(person=>person.kind==='person' && person.groupId===creator.groupId && sources.some(source=>sourceCreators.get(source.id).includes(person.id))).map(person=>person.id);
    customCreators.set(creator.id,{...(previous || {}),id:creator.id,name:creator.name,kind,handle:previous?.handle || '',bio:creator.description+' Publisher association does not establish who presented any individual update.',color:previous?.color || (creator.kind==='group'?'#dce6da':'#dce1ed'),initials:creator.name.split(/\s+/).slice(0,2).map(s=>s[0]).join(''),sourceIds:unique([...(previous?.sourceIds || []),...owned]),...(kind==='studio'?{presenterIds:unique([...(previous?.presenterIds || []),...associatedPeople])}:{})});
  }
  state.customCreators=[...customCreators.values()];
  const collections=state.sourceCollections || [],previousCollection=collections.find(collection=>collection.id==='tech');
  const collection={...(previousCollection || {}),id:'tech',name:manifest.collection.name,createdAt:previousCollection?.createdAt || now,sourceIds:unique([...(previousCollection?.sourceIds || []),...sources.map(source=>source.id)])};
  state.sourceCollections=[...collections.filter(item=>item.id!=='tech'),collection];state.activeCollectionId='tech';
  if(state.customSources.length>200 || state.customCreators.length>200 || state.sourceCollections.length>30 || state.followScopes.length>200)throw error('workspace_structural_limit_exceeded');
  if(jsonBytes(state)>2_000_000)throw error('workspace_metadata_too_large');
  return state;
}
function outputWindow(output) {
  if(!object(output) || !Array.isArray(output.updates) || !object(output.manifest) || output.manifest.executionEnabled!==true || !validIsoDate(output.manifest.dateFrom) || !validIsoDate(output.manifest.dateTo) || Date.parse(output.manifest.dateFrom)>=Date.parse(output.manifest.dateTo) || Date.parse(output.manifest.dateTo)-Date.parse(output.manifest.dateFrom)>31*86400000)throw error('invalid_or_unexecuted_actor_output');
  return output.manifest;
}
const COVERAGE_STATUSES=new Set(['failed_or_partial','capped','collected_unverified_completeness','no_results_unverified','execution_disabled','not_attempted','ambiguous_start_requires_operator_reconciliation','provider_status_unavailable','provider_build_mismatch','provider_review_changed','aggregate_budget_cap','total_item_cap','provider_still_running','provider_dataset_unavailable','blocked','failed']);
const PROVIDER_STATUSES=new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT','RUNNING','READY','ABORTING','TIMING-OUT']);
function coverageMap(manifest,output) {
  const {sources}=manifestData(manifest),known=new Map(sources.map(source=>[source.id,source])),window=outputWindow(output),mapped=new Map();
  if(!Array.isArray(output.coverage) || output.coverage.length>sources.length)throw error('invalid_source_coverage');
  const boundedCount=value=>Number.isInteger(value) && value>=0 && value<=10000;
  for(const entry of output.coverage) {
    if(!object(entry) || !known.has(entry.sourceId) || mapped.has(entry.sourceId) || !COVERAGE_STATUSES.has(entry.status) || jsonBytes(entry)>16000)throw error('invalid_or_duplicate_source_coverage');
    const source=known.get(entry.sourceId);
    if(entry.platform!==undefined && entry.platform!==source.platform)throw error('coverage_platform_mismatch');
    if(entry.sourceUrl!==undefined) {try{if(sourceKey(entry.sourceUrl,source.platform)!==sourceKey(source.url,source.platform))throw error('coverage_source_url_mismatch');}catch{throw error('coverage_source_url_mismatch');}}
    if(entry.providerStatus!==undefined && !PROVIDER_STATUSES.has(entry.providerStatus))throw error('invalid_coverage_provider_status');
    if(entry.providerRunId!==undefined && entry.providerRunId!==null && (typeof entry.providerRunId!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.providerRunId)))throw error('invalid_coverage_run_reference');
    for(const key of ['returnedItems','acceptedItems','transcriptItems','postTextItems','metadataOnlyItems'])if(entry[key]!==undefined && !boundedCount(entry[key]))throw error('invalid_coverage_count');
    for(const key of ['capped','datasetTruncated','complete'])if(entry[key]!==undefined && typeof entry[key]!=='boolean')throw error('invalid_coverage_flag');
    if(entry.complete===true)throw error('unsupported_complete_coverage_claim');
    for(const key of ['dateFrom','dateTo'])if(entry[key]!==undefined && (!validIsoDate(entry[key]) || Date.parse(entry[key])!==Date.parse(window[key])))throw error('coverage_window_mismatch');
    if(entry.earliestReached!==undefined && entry.earliestReached!==null && !validIsoDate(entry.earliestReached))throw error('invalid_coverage_date');
    if(entry.notes!==undefined && (!strings(entry.notes,500) || entry.notes.length>20))throw error('oversized_coverage_notes');
    for(const key of ['rejected','formatLimits','formatsSeen']) {
      if(entry[key]===undefined || entry[key]===null)continue;
      if(!object(entry[key]) || Object.keys(entry[key]).length>30 || Object.entries(entry[key]).some(([label,count])=>!/^[_a-z][_a-z0-9]{0,49}$/.test(label) || !boundedCount(count)))throw error('invalid_coverage_count_map');
    }
    const updates=output.updates.filter(update=>update?.sourceId===entry.sourceId);
    const counts={acceptedItems:updates.length,transcriptItems:updates.filter(update=>update.contentKind==='transcript').length,postTextItems:updates.filter(update=>update.contentKind==='feed_text').length,metadataOnlyItems:updates.filter(update=>!update.contentKind || update.contentKind==='metadata_only').length};
    for(const [key,value]of Object.entries(counts))if(entry[key]!==undefined && entry[key]!==value)throw error('coverage_update_count_mismatch');
    if(entry.returnedItems!==undefined && entry.returnedItems<updates.length)throw error('coverage_returned_count_mismatch');
    mapped.set(entry.sourceId,{...entry,...counts});
  }
  if(output.updates.some(update=>!mapped.has(update?.sourceId)))throw error('missing_collected_source_coverage');
  return mapped;
}
export function applyTechCoverage(workspace,manifest,output) {
  const entries=coverageMap(manifest,output),window=outputWindow(output),{sources}=manifestData(manifest),known=new Set(sources.map(source=>source.id));
  if(!object(workspace) || !Array.isArray(workspace.customSources) || sources.some(source=>!workspace.customSources.some(saved=>saved.id===source.id)))throw error('coverage_sources_not_prepared');
  const state=clone(workspace);
  state.customSources=state.customSources.map(source=>{
    if(!known.has(source.id))return source;
    const entry=entries.get(source.id),accepted=entry?.acceptedItems ?? 0;
    const failed=accepted===0 && !!entry && (['FAILED','ABORTED','TIMED-OUT'].includes(entry.providerStatus) || (entry.providerRunId && ['failed_or_partial','blocked','failed','provider_status_unavailable','provider_build_mismatch','provider_dataset_unavailable'].includes(entry.status)) || entry.status==='ambiguous_start_requires_operator_reconciliation');
    const status=accepted>0?'ready':failed?'failed':'pending';
    const countText=entry ? `${accepted} updates (${entry.transcriptItems} transcripts, ${entry.postTextItems} public text, ${entry.metadataOnlyItems} metadata only)${entry.returnedItems!==undefined?`; ${entry.returnedItems} provider records returned`:''}.` : 'No source coverage returned for this run.';
    const labels={failed_or_partial:'Provider errors or a partial collection',capped:'Collection cap reached',collected_unverified_completeness:'Updates collected',no_results_unverified:'No matching results returned; history remains unverified',execution_disabled:'Execution disabled; not attempted',not_attempted:'Not attempted',ambiguous_start_requires_operator_reconciliation:'Launch outcome unknown; operator reconciliation required',provider_status_unavailable:'Provider status could not be read',provider_build_mismatch:'Unreviewed provider build rejected',provider_review_changed:'Provider review changed; not attempted',aggregate_budget_cap:'Spending cap prevented collection',total_item_cap:'Overall item cap prevented collection',provider_still_running:'Provider collection still running',provider_dataset_unavailable:'Provider results could not be read',blocked:'Provider blocked collection',failed:'Collection failed'};
    const detail=entry?labels[entry.status]:'Not attempted or unreported';
    const capped=entry && (entry.capped || entry.datasetTruncated || ['capped','aggregate_budget_cap','total_item_cap'].includes(entry.status));
    const errors=entry?.rejected?.provider_error ? ` ${entry.rejected.provider_error} provider error records.` : '';
    const description=`${PUBLISHER_ASSOCIATION} Window ${window.dateFrom} to ${window.dateTo}. ${countText} ${detail}.${errors}${capped?' A cap or truncated result set limits this coverage.':''} Complete history is not established. No AI analysis or generated transcription.`;
    return {...source,status,description};
  });
  if(jsonBytes(state)>2_000_000)throw error('workspace_metadata_too_large');
  return state;
}
function validateUpdate(update,source,window) {
  const requiredStrings=['id','sourceId','title','summary','url','publishedAt','format'];
  const arrays=['contributorIds','topics','brands','sponsors','references','insights'];
  const allowed=new Set([...requiredStrings,...arrays,'isSample','image','duration','coverage','content','contentKind']);
  if(!object(update) || Object.keys(update).some(key=>!allowed.has(key)) || requiredStrings.some(key=>typeof update[key]!=='string') || arrays.some(key=>!Array.isArray(update[key])) || !id(update.id,200) || update.id.startsWith('sample-') || update.sourceId!==source.id || update.isSample!==false || !['video','article','podcast','post'].includes(update.format) || !validIsoDate(update.publishedAt))throw error('invalid_archive_update');
  if(!publicUrl(update.url) || (update.image!==undefined && !publicUrl(update.image)))throw error('invalid_archive_url');
  for(const key of ['contributorIds','topics','brands','sponsors','insights'])if(!strings(update[key],1000))throw error('invalid_archive_list');
  if(update.contributorIds.length)throw error('unverified_archive_presenter_credit');
  if(update.references.some(reference=>!object(reference) || typeof reference.title!=='string' || !publicUrl(reference.url) || Object.keys(reference).some(key=>!['title','url'].includes(key))))throw error('invalid_archive_reference');
  for(const key of ['image','duration','coverage','content'])if(update[key]!==undefined && typeof update[key]!=='string')throw error('invalid_archive_text');
  if(update.contentKind!==undefined && !['feed_text','transcript','metadata_only'].includes(update.contentKind))throw error('invalid_archive_content_kind');
  const host=new URL(update.url).hostname.replace(/^www\./,'');
  if((source.platform==='YouTube' && !['youtube.com','youtu.be'].includes(host)) || (source.platform==='X' && !['x.com','twitter.com'].includes(host)) || (source.platform==='Instagram' && host!=='instagram.com'))throw error('archive_platform_mismatch');
  const date=Date.parse(update.publishedAt);
  if(date<Date.parse(window.dateFrom) || date>Date.parse(window.dateTo))throw error('archive_update_outside_output_window');
  const serialized=JSON.stringify(update);
  if(serialized.includes('\\u0000') || Buffer.byteLength(serialized,'utf8')>150000 || jsonBytes(update)>150000)throw error('archive_record_too_large_or_unsupported');
}
export function buildArchiveRows(userId,manifest,output) {
  if(!/^user_[A-Za-z0-9]{1,100}$/.test(userId || ''))throw error('invalid_private_identity');
  const {sources}=manifestData(manifest),byId=new Map(sources.map(source=>[source.id,source]));
  if(output===undefined || output===null)return [];
  outputWindow(output);
  const rows=[],seen=new Set();
  for(const update of output.updates) {
    if(!byId.has(update?.sourceId))throw error('archive_source_not_in_included_collection');
    validateUpdate(update,byId.get(update.sourceId),output.manifest);
    if(seen.has(update.id))throw error('duplicate_archive_update_id');seen.add(update.id);
    rows.push({user_id:userId,id:update.id,source_id:update.sourceId,collection_id:'tech',published_at:update.publishedAt,record:clone(update)});
  }
  coverageMap(manifest,output);
  return rows;
}
export async function provisionTechWorkspace({db,userId,manifest,output,apply=false,now=new Date().toISOString()}) {
  const archiveRows=buildArchiveRows(userId,manifest,output); // Validate the entire import before the first mutation.
  let prepared,updated=false;
  for(let attempt=0;attempt<=2;attempt++) {
    const loaded=await db.from('reader_workspaces').select('state,updated_at').eq('user_id',userId).maybeSingle();
    if(loaded.error)throw error('workspace_read_failed');
    prepared=prepareWorkspace(loaded.data?.state,manifest,{now});
    if(output!==undefined && output!==null)prepared=applyTechCoverage(prepared,manifest,output);
    if(!apply)break;
    const saved=loaded.data
      ? await db.from('reader_workspaces').update({state:prepared}).eq('user_id',userId).eq('updated_at',loaded.data.updated_at).select('updated_at').maybeSingle()
      : await db.from('reader_workspaces').insert({user_id:userId,state:prepared}).select('updated_at').maybeSingle();
    if(saved.error && saved.error.code!=='23505')throw error('workspace_write_failed');
    if(saved.data && !saved.error){updated=true;break;}
    if(attempt===2)throw error('workspace_conflict_retry_limit');
  }
  let verified=0,totalArchive=null;
  if(apply) {
    for(let index=0;index<archiveRows.length;index+=50) {
      const batch=archiveRows.slice(index,index+50),result=await db.from('reader_source_updates').upsert(batch,{onConflict:'user_id,id'}).select('id');
      if(result.error || result.data?.length!==batch.length)throw error('archive_upsert_failed_partial_import_possible');
    }
    for(let index=0;index<archiveRows.length;index+=100) {
      const batch=archiveRows.slice(index,index+100),result=await db.from('reader_source_updates').select('id').eq('user_id',userId).eq('collection_id','tech').in('id',batch.map(row=>row.id));
      if(result.error || result.data?.length!==batch.length || result.data.some(row=>!batch.some(expected=>expected.id===row.id)))throw error('archive_verification_failed');
      verified+=result.data.length;
    }
    const count=await db.from('reader_source_updates').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('collection_id','tech');
    if(count.error || typeof count.count!=='number')throw error('archive_count_unavailable');totalArchive=count.count;
  }
  return {mode:apply?'applied':'preview',collection:'tech',includedSources:manifest.sources.filter(source=>source.scope==='included').length,followedSources:prepared.followedSourceIds.length,archiveRowsPrepared:archiveRows.length,archiveRowsVerified:verified,totalCollectionArchiveRows:totalArchive,workspaceUpdated:updated};
}
export async function main(args=process.argv.slice(2)) {
  const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  if(!option('--identity-file') || !option('--manifest'))throw error('usage_identity_file_and_manifest_required');
  const identity=JSON.parse(await readFile(resolve(option('--identity-file')),'utf8'));
  const manifest=JSON.parse(await readFile(resolve(option('--manifest')),'utf8'));
  const output=option('--output')?JSON.parse(await readFile(resolve(option('--output')),'utf8')):undefined;
  const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url || !key || new URL(url).hostname!==TARGET+'.supabase.co' || new URL(url).protocol!=='https:')throw error('exact_recap_service_configuration_required');
  const {createClient}=await import('@supabase/supabase-js');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const result=await provisionTechWorkspace({db,userId:identity.userId,manifest,output,apply:args.includes('--apply')});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(problem=>{process.stderr.write((problem?.safeCode || 'provision_failed_output_withheld')+'\n');process.exitCode=1;});
