#!/usr/bin/env node
import { readFile, realpath, stat, open, rename } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { validateTechManifest } from './tech-source-manifest.mjs';
import { validIsoDate } from './provision-tech-workspace.mjs';
import { reviewedProviderForRun, TERMINAL, pricingFingerprint } from '../actors/tech-collector/src/collector.mjs';

export const RECONCILIATION_TARGET={project:'zlfdqzabsfndifxiqguo',providerUser:'HSYACi7hQoFfaaYkq',providerUsername:'deletecookies',controllerActor:'IGSuksdW9ZsWkrsRj'};
const root=fileURLToPath(new URL('../',import.meta.url));
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const problem=code=>Object.assign(new Error(code),{safeCode:code});
const need=(yes,code)=>{if(!yes)throw problem(code);};
const runId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const readerId=v=>typeof v==='string'&&/^user_[A-Za-z0-9_-]{1,195}$/.test(v)&&v.length<=200;
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1_000_000;
const maximum=v=>amount(v)&&v>0&&v<=45&&Number(v.toFixed(6))===v;
const statuses=new Set(['READY','RUNNING','ABORTING','TIMING-OUT',...TERMINAL]);
const total=values=>Number(values.reduce((a,b)=>a+b,0).toFixed(12));
const jobFields='id,user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status,result_count,observed_cost_usd,cost_status,error_code,created_at,finished_at,updated_at';

export function verifySupabaseTarget(url){
 let u;try{u=new URL(url);}catch{throw problem('wrong_supabase_project');}
 need(u.href===`https://${RECONCILIATION_TARGET.project}.supabase.co/`&&!u.username&&!u.password,'wrong_supabase_project');
 return u.origin;
}
export function verifyProviderIdentity(user){need(object(user)&&user.id===RECONCILIATION_TARGET.providerUser&&typeof user.username==='string'&&user.username.toLowerCase()===RECONCILIATION_TARGET.providerUsername,'wrong_provider_owner');}
export function observedProviderFee(run){
 if(run.usageTotalUsd===undefined||run.usageTotalUsd===null)return null;
 need(amount(run.usageTotalUsd),'invalid_provider_fee');return run.usageTotalUsd;
}
function timing(run){
 need(validIsoDate(run.startedAt),'invalid_provider_started_at');
 if(TERMINAL.has(run.status))need(validIsoDate(run.finishedAt)&&Date.parse(run.finishedAt)>=Date.parse(run.startedAt),'invalid_provider_finished_at');
 else need(run.finishedAt===null||run.finishedAt===undefined,'inconsistent_running_finish');
 return {created_at:run.startedAt,finished_at:TERMINAL.has(run.status)?run.finishedAt:null};
}
function mappedStatus(status){need(statuses.has(status),'invalid_provider_status');return status==='SUCCEEDED'?'succeeded':TERMINAL.has(status)?'failed':'running';}
function providerRun(run,id,actor,build){
 need(object(run)&&runId(run.id)&&run.id===id&&run.actId===actor&&run.buildId===build&&run.userId===RECONCILIATION_TARGET.providerUser,'provider_run_identity_mismatch');
 need(statuses.has(run.status),'invalid_provider_status');timing(run);observedProviderFee(run);
}
export function validateReconciliationInputs({identity,manifest,controllerFile,checkpoint,envelope}){
 need(object(identity)&&readerId(identity.userId),'invalid_reader_identity');validateTechManifest(manifest);
 need(object(controllerFile)&&runId(controllerFile.id)&&runId(controllerFile.buildId)&&controllerFile.actId===RECONCILIATION_TARGET.controllerActor&&controllerFile.userId===RECONCILIATION_TARGET.providerUser,'invalid_controller_reference');
 need(object(envelope)&&uuid(envelope.id)&&envelope.account_id==='source-proof'&&envelope.request_key==='tech-d22-20261021'&&envelope.kind==='envelope'&&envelope.state==='held'&&envelope.maximum_usd===45,'invalid_budget_envelope');
 need(object(checkpoint)&&checkpoint.version===1&&checkpoint.parentRunId===controllerFile.id&&checkpoint.budgetReservationId===envelope.id&&/^[a-f0-9]{64}$/.test(checkpoint.inputFingerprint||'')&&maximum(checkpoint.maxTotalChargeUsd)&&checkpoint.maxTotalChargeUsd<=45&&maximum(checkpoint.parentMaxChargeUsd)&&checkpoint.parentMaxChargeUsd<=0.4&&object(checkpoint.entries),'checkpoint_identity_mismatch');
 const known=new Map(manifest.sources.filter(s=>s.scope==='included').map(s=>[s.id,s])),entries=Object.entries(checkpoint.entries),seen=new Set();
 need(entries.length<=known.size,'too_many_checkpoint_entries');
 for(const[key,entry]of entries){
  const source=known.get(key);
  need(source&&object(entry)&&entry.sourceId===key,'unknown_checkpoint_source');
  let review;
  try{review=reviewedProviderForRun(source.platform,entry.actorId,entry.buildId);}catch{throw problem('unreviewed_child_identity');}
  need(entry.actor===review.actor&&entry.buildNumber===review.buildNumber&&entry.pricingFingerprint===pricingFingerprint(review.pricing)&&entry.rejectedBuild!==true,'unreviewed_child_identity');
  need(maximum(entry.reservedUsd),'invalid_child_reservation');
  if(entry.providerRunId===null||entry.providerRunId===undefined)continue;
  need(runId(entry.providerRunId)&&entry.providerRunId!==controllerFile.id&&!seen.has(entry.providerRunId),'duplicate_or_invalid_child_run');seen.add(entry.providerRunId);
 }
 need(total(entries.map(([,e])=>e.reservedUsd))+checkpoint.parentMaxChargeUsd<=45,'checkpoint_caps_exceed_envelope');
 return {sources:known,entries:entries.map(([,e])=>e)};
}
function normalizedCount(entry,run){
 if(entry.coverage===null||entry.coverage===undefined)return null;
 const c=entry.coverage;
 need(TERMINAL.has(entry.status)&&run.status===entry.status&&object(c)&&c.sourceId===entry.sourceId&&c.providerRunId===run.id&&c.providerStatus===entry.status&&Number.isInteger(c.acceptedItems)&&c.acceptedItems>=0&&c.acceptedItems<=10000&&Array.isArray(entry.updates)&&entry.updates.length===c.acceptedItems,'invalid_normalized_checkpoint_count');
 const ids=new Set();
 for(const update of entry.updates){need(object(update)&&typeof update.id==='string'&&update.id.length>0&&update.id.length<=200&&update.sourceId===entry.sourceId&&update.isSample===false&&!ids.has(update.id),'invalid_normalized_checkpoint_update');ids.add(update.id);}
 return c.acceptedItems;
}
function validateExisting(existing,wanted){
 if(!existing)return;
 need(uuid(existing.id)&&validIsoDate(existing.updated_at)&&existing.user_id===wanted.user_id&&existing.provider==='apify'&&existing.provider_run_id===wanted.provider_run_id&&existing.source_id===wanted.source_id&&existing.source_url===wanted.source_url&&existing.platform===wanted.platform&&existing.actor_id===wanted.actor_id,'existing_job_identity_mismatch');
 need(['requested','running','succeeded','failed','blocked'].includes(existing.status),'invalid_existing_job_state');
 need(!(['succeeded','failed','blocked'].includes(existing.status)&&existing.status!==wanted.status),'terminal_job_state_changed');
 need((existing.observed_cost_usd===null&&existing.cost_status==='unknown')||(amount(existing.observed_cost_usd)&&existing.cost_status==='provider_reported'),'invalid_existing_job_fee');
}
function activity(run,source,identity,count,previous){
 const fee=observedProviderFee(run),row={user_id:identity.userId,source_id:source.id,source_name:source.name,source_url:source.url,platform:source.platform,provider:'apify',actor_id:run.actId,provider_run_id:run.id,status:mappedStatus(run.status),result_count:count,observed_cost_usd:fee,cost_status:fee===null?'unknown':'provider_reported',error_code:TERMINAL.has(run.status)&&run.status!=='SUCCEEDED'?'apify_'+run.status.toLowerCase().replace(/-/g,'_'):null,...timing(run)};
 validateExisting(previous,row);
 // Missing/stale lower telemetry never erases a higher charge already observed.
 // Final credits/adjustments require a separate, explicitly final reconciliation.
 if(previous?.cost_status==='provider_reported'&&(fee===null||fee<previous.observed_cost_usd)){row.observed_cost_usd=previous.observed_cost_usd;row.cost_status='provider_reported';}
 if(count===null&&previous?.result_count!==null&&previous?.result_count!==undefined)row.result_count=previous.result_count;
 return {row,existing:previous||null,freshObservedUsd:fee};
}
function validateDatabaseEnvelope(actual,expected){need(object(actual)&&actual.id===expected.id&&actual.account_id==='source-proof'&&actual.kind==='envelope'&&actual.request_key===expected.request_key&&actual.maximum_usd===45&&actual.state==='held','database_envelope_changed');}

/** Pure: validates every known identity before returning any planned DB mutation. */
export function prepareTechReconciliation(input){
 const {identity,manifest,controllerFile,checkpoint,envelope,providerIdentity,controllerRun,childRuns,existingJobs=[],existingBudgets=[],databaseEnvelope=envelope,existingConsumers=[]}=input;
 const {sources,entries}=validateReconciliationInputs(input);verifyProviderIdentity(providerIdentity);validateDatabaseEnvelope(databaseEnvelope,envelope);
 providerRun(controllerRun,controllerFile.id,RECONCILIATION_TARGET.controllerActor,controllerFile.buildId);
 need(controllerRun.options?.memoryMbytes===256&&controllerRun.options?.timeoutSecs>0&&controllerRun.options.timeoutSecs<=3600&&maximum(controllerRun.options.maxTotalChargeUsd)&&controllerRun.options.maxTotalChargeUsd<=checkpoint.parentMaxChargeUsd&&controllerRun.options.restartOnError===false,'controller_resource_identity_mismatch');
 need(Array.isArray(childRuns)&&Array.isArray(existingJobs)&&Array.isArray(existingBudgets)&&Array.isArray(existingConsumers),'invalid_reconciliation_snapshot');
 const runs=new Map(),jobs=new Map();
 for(const run of childRuns){need(object(run)&&runId(run.id)&&!runs.has(run.id),'duplicate_child_response');runs.set(run.id,run);}
 for(const job of existingJobs){need(object(job)&&runId(job.provider_run_id)&&!jobs.has(job.provider_run_id),'duplicate_existing_activity');jobs.set(job.provider_run_id,job);}
 const bound=entries.filter(e=>e.providerRunId);need(runs.size===bound.length,'missing_or_unexpected_child_response');
 const children=[];
 for(const entry of bound){
  const source=sources.get(entry.sourceId),run=runs.get(entry.providerRunId);providerRun(run,entry.providerRunId,entry.actorId,entry.buildId);
  need(maximum(run.options?.maxTotalChargeUsd)&&run.options.maxTotalChargeUsd<=entry.reservedUsd,'provider_cap_exceeds_reservation');
  if(entry.datasetId!==null&&entry.datasetId!==undefined)need(entry.datasetId===run.defaultDatasetId,'provider_dataset_identity_mismatch');
  const accepted=normalizedCount(entry,run),job=activity(run,source,identity,accepted,jobs.get(run.id));
  children.push({...job,sourceId:source.id,channelId:source.catalogueChannelId||source.id,budget:{requestKey:'tech-d22-child-'+run.id,maximumUsd:entry.reservedUsd,parentId:envelope.id,actorId:entry.actorId,providerRunId:run.id,terminal:TERMINAL.has(run.status)}});
 }
 const rootPrevious=jobs.get(controllerRun.id);need(rootPrevious,'controller_activity_missing');
 const completed=children.filter(c=>c.row.result_count!==null),rootCount=completed.length?completed.reduce((n,c)=>n+c.row.result_count,0):null;
 const controller={...activity(controllerRun,{id:'tech-controller',name:'tech collection controller',url:'https://recap-v0-radu.netlify.app/',platform:'Collection'},identity,rootCount,rootPrevious),channelId:null};
 const budgets=new Map();let baseline=0;
 for(const b of existingBudgets){
  need(object(b)&&uuid(b.id)&&b.parent_id===envelope.id&&b.account_id==='source-proof'&&b.kind==='job'&&['held','settled','released'].includes(b.state)&&maximum(b.maximum_usd)&&typeof b.request_key==='string'&&!budgets.has(b.request_key),'invalid_existing_budget');
  if(b.state==='settled')need(amount(b.actual_cost_usd),'invalid_existing_budget_cost');
  baseline+=b.state==='held'?b.maximum_usd:b.state==='settled'?b.actual_cost_usd:0;budgets.set(b.request_key,b);
 }
 let additional=0;
 for(const child of children){
  const previous=budgets.get(child.budget.requestKey);
  if(previous)need(previous.maximum_usd===child.budget.maximumUsd&&previous.provider==='apify'&&previous.actor_id===child.budget.actorId&&previous.state==='held'&&(previous.provider_run_id===null||previous.provider_run_id===child.budget.providerRunId),'existing_child_budget_identity_mismatch');
  else additional+=child.budget.maximumUsd;
  child.budget.existing=previous||null;
 }
 need(total([baseline,additional])<=45,'database_child_holds_exceed_envelope');
 const all=[controller,...children];
 for(const consumer of existingConsumers){
  need(object(consumer)&&uuid(consumer.job_id)&&typeof consumer.user_id==='string','invalid_existing_consumer');
  const job=all.find(j=>j.existing?.id===consumer.job_id);
  if(consumer.user_id===identity.userId&&job)need(consumer.channel_id===null||consumer.channel_id===job.channelId,'existing_consumer_channel_mismatch');
 }
 const boundIds=new Set(all.map(j=>j.row.provider_run_id));need(existingJobs.every(j=>boundIds.has(j.provider_run_id)),'unexpected_existing_job');
 return {version:1,accountId:'source-proof',envelopeId:envelope.id,controller,children,unboundEntries:entries.length-bound.length,budgetCommittedMaximumUsd:total([baseline,additional]),providerInventoryComplete:false,finalSettlementAllowed:false};
}
export function reconciliationSummary(plan,apply=false){
 const jobs=[plan.controller,...plan.children],known=jobs.filter(j=>j.freshObservedUsd!==null);
 return {version:1,mode:apply?'apply':'preview',controllerRuns:1,childRuns:plan.children.length,unboundReservations:plan.unboundEntries,normalizedAcceptedItems:plan.children.reduce((n,j)=>n+(j.row.result_count||0),0),runningJobs:jobs.filter(j=>j.row.status==='running').length,succeededJobs:jobs.filter(j=>j.row.status==='succeeded').length,failedJobs:jobs.filter(j=>j.row.status==='failed').length,providerReportedRuns:known.length,unreportedRuns:jobs.length-known.length,observedUsageUsd:total(known.map(j=>j.freshObservedUsd)),reservedChildAndExistingMaximumUsd:plan.budgetCommittedMaximumUsd,globalEnvelopeHeldUsd:45,finalBudgetSettlements:0,envelopeClosed:false,providerMutationRequests:0};
}
function unwrap(result,code){if(result.error)throw problem(code);return result.data;}
async function requireJob(db,run){const data=unwrap(await db.from('collection_jobs').select(jobFields).eq('provider_run_id',run).maybeSingle(),'activity_read_failed');return data;}
async function saveActivity(db,planned){
 let current=await requireJob(db,planned.row.provider_run_id);
 if(!current){
  const result=await db.from('collection_jobs').insert(planned.row).select(jobFields).single();
  if(result.error?.code==='23505')current=await requireJob(db,planned.row.provider_run_id);
  else {const data=unwrap(result,'activity_insert_failed');need(data&&uuid(data.id),'invalid_activity_insert_response');validateExisting(data,planned.row);return data;}
 }
 need(current,'activity_race_unresolved');validateExisting(current,planned.row);
 // Re-check identity after the initial preview and serialize with every ledger
 // writer, including another running->running cost refresh.
 const row={...planned.row};
 if(current.cost_status==='provider_reported'&&(row.observed_cost_usd===null||row.observed_cost_usd<current.observed_cost_usd)){row.observed_cost_usd=current.observed_cost_usd;row.cost_status='provider_reported';}
 if(row.result_count===null&&current.result_count!==null)row.result_count=current.result_count;
 const result=await db.from('collection_jobs').update(row).eq('id',current.id).eq('user_id',current.user_id).eq('provider_run_id',current.provider_run_id).eq('updated_at',current.updated_at).select(jobFields).maybeSingle();
 const data=unwrap(result,'activity_update_failed');need(data,'activity_revision_conflict');validateExisting(data,row);return data;
}
async function holdChildBudget(db,child){
 const b=child.budget;
 let data=unwrap(await db.rpc('reserve_collection_budget',{p_request_key:b.requestKey,p_maximum_usd:b.maximumUsd,p_kind:'job',p_parent_id:b.parentId,p_provider:'apify',p_actor_id:b.actorId}),'child_budget_reservation_failed');
 need(object(data)&&uuid(data.id)&&data.state==='held'&&data.maximum_usd===b.maximumUsd&&data.parent_id===b.parentId&&data.actor_id===b.actorId&&(data.provider_run_id===null||data.provider_run_id===b.providerRunId),'child_budget_response_mismatch');
 // This is reconciliation of an existing verified provider run, never authority
 // to POST a new one. Import claim time is not the provider's actual start time.
 const claim=unwrap(await db.rpc('claim_collection_budget',{p_id:data.id}),'child_budget_claim_failed');need(object(claim)&&typeof claim.claimed==='boolean'&&claim.reservation?.id===data.id,'child_budget_claim_mismatch');
 data=unwrap(await db.rpc('settle_collection_budget',{p_id:data.id,p_provider_run_id:b.providerRunId,p_actual_usd:null,p_terminal:b.terminal}),'child_budget_binding_failed');
 need(data?.state==='held'&&data.actual_cost_usd===null&&data.provider_run_id===b.providerRunId,'child_budget_hold_was_finalized');
}
/** DB-only mutations; the provider client is intentionally not available here. */
export async function applyTechReconciliation(plan,db){
 need(plan.finalSettlementAllowed===false&&plan.providerInventoryComplete===false,'unsafe_settlement_plan');
 for(const child of plan.children)await holdChildBudget(db,child);
 for(const job of [plan.controller,...plan.children]){
  const saved=await saveActivity(db,job);
  const old=unwrap(await db.from('collection_job_consumers').select('job_id,user_id,channel_id').eq('job_id',saved.id).eq('user_id',job.row.user_id).maybeSingle(),'consumer_read_failed');
  if(old){need(old.channel_id===null||old.channel_id===job.channelId,'existing_consumer_channel_mismatch');continue;}
  const result=await db.from('collection_job_consumers').upsert({job_id:saved.id,user_id:job.row.user_id,channel_id:job.channelId},{onConflict:'job_id,user_id',ignoreDuplicates:true});unwrap(result,'consumer_link_failed');
  const linked=unwrap(await db.from('collection_job_consumers').select('job_id,user_id,channel_id').eq('job_id',saved.id).eq('user_id',job.row.user_id).maybeSingle(),'consumer_link_read_failed');need(linked&&linked.job_id===saved.id&&linked.user_id===job.row.user_id&&(linked.channel_id===null||linked.channel_id===job.channelId),'consumer_link_identity_mismatch');
 }
 return reconciliationSummary(plan,true);
}

/** Only these provider GET routes exist; start/build/abort cannot be requested. */
export function providerReadClient(token,fetcher=fetch){
 need(typeof token==='string'&&token.length>10,'missing_apify_token');
 return async path=>{
  need(path==='/users/me'||/^\/actor-runs\/[A-Za-z0-9_-]{1,100}$/.test(path),'unsafe_provider_read_path');
  let r;try{r=await fetcher('https://api.apify.com/v2'+path,{method:'GET',headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw problem('provider_read_unavailable');}
  need(r.ok,'provider_read_rejected');let payload;try{payload=await r.json();}catch{throw problem('invalid_provider_response');}
  need(object(payload?.data),'invalid_provider_response');return payload.data;
 };
}
async function privatePath(path,{output=false}={}){
 const base=await realpath(resolve(root,'.local')),dest=resolve(root,path),parent=output?await realpath(dirname(dest)):await realpath(dest);
 const rel=relative(base,parent);need((output||rel!=='')&&!rel.startsWith('..')&&!rel.startsWith('/'),'private_path_outside_ignored_local');
 return dest;
}
async function loadJson(path,isPrivate=true){const file=isPrivate?await privatePath(path):resolve(root,path);need((await stat(file)).size<=64*1024*1024,'input_file_too_large');try{return JSON.parse(await readFile(file,'utf8'));}catch{throw problem('invalid_input_file');}}
async function privateOutput(path,data){
 const file=await privatePath(path,{output:true}),tmp=file+'.tmp-'+process.pid+'-'+Date.now();
 const handle=await open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify(data,null,2)+'\n');}finally{await handle.close();}await rename(tmp,file);
}
export function parseReconciliationArgs(args){
 const paths={identityFile:'.local/tech-owner.json',manifest:'data/tech/sources.json',controllerFile:'.local/tech-run.json',checkpoint:'.local/tech-run-checkpoint.json',envelopeFile:'.local/tech-budget-envelope.json',apply:false};
 const names={'--identity-file':'identityFile','--manifest':'manifest','--controller-file':'controllerFile','--checkpoint':'checkpoint','--envelope-file':'envelopeFile','--private-output':'privateOutput'};const seen=new Set();
 for(let i=0;i<args.length;i++){const a=args[i];need(!seen.has(a),'duplicate_cli_option');seen.add(a);if(a==='--apply'){paths.apply=true;continue;}need(names[a]&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'invalid_cli_option');paths[names[a]]=args[++i];}
 if(paths.privateOutput)need(!['identityFile','manifest','controllerFile','checkpoint','envelopeFile'].some(k=>resolve(root,paths[k])===resolve(root,paths.privateOutput)),'private_output_overwrites_input');
 return paths;
}
export async function runReconciliationCli(args,env=process.env){
 const options=parseReconciliationArgs(args),origin=verifySupabaseTarget(env.VITE_SUPABASE_URL);if(options.privateOutput)await privatePath(options.privateOutput,{output:true});need(typeof env.SUPABASE_SECRET_KEY==='string'&&env.SUPABASE_SECRET_KEY.length>10,'missing_server_database_key');
 const [identity,manifest,controllerFile,checkpoint,envelope]=await Promise.all([loadJson(options.identityFile),loadJson(options.manifest,false),loadJson(options.controllerFile),loadJson(options.checkpoint),loadJson(options.envelopeFile)]);
 const context={identity,manifest,controllerFile,checkpoint,envelope};const {entries}=validateReconciliationInputs(context);
 const get=providerReadClient(env.APIFY_API_TOKEN),providerIdentity=await get('/users/me');verifyProviderIdentity(providerIdentity);
 const controllerRun=await get('/actor-runs/'+controllerFile.id),childRuns=[];
 for(const entry of entries)if(entry.providerRunId)childRuns.push(await get('/actor-runs/'+entry.providerRunId));
 const db=createClient(origin,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const ids=[controllerFile.id,...childRuns.map(r=>r.id)];
 const existingJobs=unwrap(await db.from('collection_jobs').select(jobFields).in('provider_run_id',ids),'activity_read_failed')||[];
 const databaseEnvelope=unwrap(await db.from('collection_budget_reservations').select('*').eq('id',envelope.id).maybeSingle(),'budget_envelope_read_failed');
 const existingBudgets=unwrap(await db.from('collection_budget_reservations').select('*').eq('parent_id',envelope.id).limit(100),'budget_children_read_failed')||[];
 need(existingBudgets.length<100,'budget_inventory_truncated');
 const jobIds=existingJobs.map(j=>j.id),existingConsumers=jobIds.length?unwrap(await db.from('collection_job_consumers').select('job_id,user_id,channel_id').in('job_id',jobIds),'consumer_read_failed')||[]:[];
 const plan=prepareTechReconciliation({...context,providerIdentity,controllerRun,childRuns,existingJobs,databaseEnvelope,existingBudgets,existingConsumers});
 const summary=options.apply?await applyTechReconciliation(plan,db):reconciliationSummary(plan);
 if(options.privateOutput)await privateOutput(options.privateOutput,{checkedAt:new Date().toISOString(),providerIdentity,controllerRun,childRuns,summary});
 return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await runReconciliationCli(process.argv.slice(2)),null,2));}
 catch(error){console.error(JSON.stringify({ok:false,code:/^[a-z0-9_]{1,80}$/.test(error?.safeCode||'')?error.safeCode:'reconciliation_failed',providerMutationRequests:0}));process.exitCode=1;}
}
