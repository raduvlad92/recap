#!/usr/bin/env node
// Preparation only: no source/model requests and no database writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { captionHash, validateVideoAnnotation, validateStoredVideoAnalysis } from './lib/video-analysis.mjs';
import { readVideoMetadataState } from './enrich-video-metadata.mjs';

const TARGET='zlfdqzabsfndifxiqguo';
const fail=code=>Object.assign(new Error(code),{safeCode:code});
const ALLOWED=new Set(['videoSummary','videoHighlights','videoKeywords','topics']);
const withoutAnnotations=record=>Object.fromEntries(Object.entries(record).filter(([key])=>!ALLOWED.has(key)));

export function buildVideoAnalysisPlan(snapshot,inputs,annotations) {
  const {workspace,archiveRows}=snapshot;
  if(!workspace?.user_id||!/^user_[A-Za-z0-9]+$/.test(workspace.user_id)||archiveRows.some(r=>r.user_id!==workspace.user_id)||!workspace.state?.customCreators)throw fail('exact_existing_owner_required');
  const group=workspace.state.customCreators.find(c=>c.id==='tech-creator-lmg');
  if(!group)throw fail('existing_lmg_scope_required');
  const sources=new Set(group.sourceIds),rows=archiveRows.filter(r=>sources.has(r.source_id)&&r.record.format==='video');
  const byInput=new Map(inputs.map(x=>[x.id,x])),byAnnotation=new Map(annotations.map(x=>[x.id,x]));
  if(byInput.size!==inputs.length||byAnnotation.size!==annotations.length||rows.length!==inputs.length||rows.length!==annotations.length)throw fail('incomplete_or_duplicate_video_review');
  const patches=[];
  for(const row of rows) {
    const input=byInput.get(row.id),annotation=byAnnotation.get(row.id);
    if(!input||!annotation||input.captionHash!==captionHash(row.record.content||'')||input.status!==(row.record.contentKind==='transcript'?'ready':'unavailable'))throw fail('stale_caption_analysis');
    const record={...row.record,...validateVideoAnnotation(input,annotation)};
    validateStoredVideoAnalysis(record);
    if(!isDeepStrictEqual(withoutAnnotations(row.record),withoutAnnotations(record)))throw fail('source_data_change_forbidden');
    if(Buffer.byteLength(JSON.stringify(record))>1_000_000)throw fail('analysis_record_too_large');
    if(!isDeepStrictEqual(row.record,record))patches.push({id:row.id,sourceId:row.source_id,beforeRecord:row.record,record});
  }
  return {version:1,targetProject:TARGET,preparedAt:new Date().toISOString(),workspaceBefore:workspace,patches,stats:{archiveRows:archiveRows.length,lmgVideos:rows.length,captionedVideos:rows.filter(r=>r.record.contentKind==='transcript').length,metadataOnlyVideos:rows.filter(r=>r.record.contentKind!=='transcript').length,captionTiming:inputs.filter(x=>x.status==='ready'&&x.timingBasis==='captions').length,chapterTiming:inputs.filter(x=>x.status==='ready'&&x.timingBasis==='publisher-chapters').length,patches:patches.length}};
}

export function buildVideoAnalysisSql(plan,patches=plan.patches) {
  if(plan.targetProject!==TARGET||plan.version!==1||!plan.workspaceBefore?.user_id||!Array.isArray(patches))throw fail('invalid_analysis_plan');
  for(const p of patches)if(!/^[A-Za-z0-9_-]+$/.test(p.id)||p.beforeRecord.id!==p.id||p.record.id!==p.id||p.record.sourceId!==p.sourceId||!isDeepStrictEqual(withoutAnnotations(p.beforeRecord),withoutAnnotations(p.record)))throw fail('invalid_analysis_patch');
  const payload={workspace:plan.workspaceBefore,patches:patches.map(p=>({id:p.id,sourceId:p.sourceId,beforeRecord:p.beforeRecord,annotation:Object.fromEntries([...ALLOWED].map(key=>[key,p.record[key]]))}))};
  const literal="'"+JSON.stringify(payload).replaceAll("'","''")+"'";
  const body=`declare payload jsonb := ${literal}::jsonb; item jsonb; affected integer;
begin
  perform 1 from public.reader_workspaces where user_id=payload#>>'{workspace,user_id}' and updated_at=(payload#>>'{workspace,updated_at}')::timestamptz and state=payload#>'{workspace,state}' for update;
  if not found then raise exception 'stale_analysis_workspace'; end if;
  for item in select value from jsonb_array_elements(payload->'patches') loop
    perform 1 from public.reader_source_updates where user_id=payload#>>'{workspace,user_id}' and id=item->>'id' and source_id=item->>'sourceId' and record=item->'beforeRecord' for update;
    if not found then raise exception 'stale_analysis_record'; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'patches') loop
    update public.reader_source_updates set record=record || (item->'annotation') where user_id=payload#>>'{workspace,user_id}' and id=item->>'id' and source_id=item->>'sourceId' and record=item->'beforeRecord';
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'stale_analysis_record'; end if;
  end loop;
end;`;
  let tag='$recap_video_analysis$';while(body.includes(tag))tag='$recap_video_analysis_'+captionHash(tag).slice(0,12)+'$';
  return `begin;\nset local statement_timeout='60s';\nset local lock_timeout='5s';\nset local standard_conforming_strings=on;\ndo ${tag}\n${body}\n${tag};\ncommit;\n`;
}

export function buildVideoAnalysisBatches(plan,maxBytes=450*1024) {
  const batches=[];let pending=[];
  const add=patches=>{const sql=buildVideoAnalysisSql(plan,patches);if(Buffer.byteLength(sql)>768*1024)throw fail('analysis_batch_too_large');batches.push({patches,sql});};
  for(const patch of plan.patches) {if(pending.length&&Buffer.byteLength(buildVideoAnalysisSql(plan,[...pending,patch]))>maxBytes){add(pending);pending=[];}pending.push(patch);}
  if(pending.length)add(pending);
  return batches;
}

export async function main(args=process.argv.slice(2)) {
  const directory=resolve(args[0]||'.local/lmg-summaries');
  const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
  const inputs=[],annotations=[];
  for(const entry of manifest){inputs.push(JSON.parse(await readFile(resolve(directory,'input',entry.id+'.json'),'utf8')));annotations.push(JSON.parse(await readFile(resolve(directory,'output',entry.id+'.json'),'utf8')));}
  if(new URL(process.env.VITE_SUPABASE_URL||'https://invalid').hostname!==TARGET+'.supabase.co'||!process.env.SUPABASE_SECRET_KEY)throw fail('exact_recap_project_required');
  const {createClient}=await import('@supabase/supabase-js');
  const snapshot=await readVideoMetadataState(createClient(process.env.VITE_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}));
  const plan=buildVideoAnalysisPlan(snapshot,inputs,annotations),out=resolve(directory,'prepared-'+Date.now());
  await mkdir(out,{recursive:true,mode:0o700});
  await writeFile(resolve(out,'before.json'),JSON.stringify(snapshot),{mode:0o600});
  await writeFile(resolve(out,'plan.json'),JSON.stringify(plan),{mode:0o600});
  const batches=buildVideoAnalysisBatches(plan),files=[];
  for(let i=0;i<batches.length;i++){const file=String(i+1).padStart(3,'0')+'.sql';await writeFile(resolve(out,file),batches[i].sql,{mode:0o600});files.push({file,patches:batches[i].patches.length,bytes:Buffer.byteLength(batches[i].sql),sha256:captionHash(batches[i].sql)});}
  await writeFile(resolve(out,'manifest.json'),JSON.stringify({targetProject:TARGET,atomicity:'per-batch; stop and replan on any stale state',batches:files}),{mode:0o600});
  process.stdout.write(JSON.stringify({mode:'read-only-preparation',...plan.stats,batches:files.length,privateDirectory:out,databaseWrites:0})+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(problem=>{process.stderr.write((problem.safeCode||'video_analysis_preparation_failed')+'\n');process.exitCode=1;});
