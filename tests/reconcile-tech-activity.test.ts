import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone server-side ESM reconciliation tool has no TS declaration.
import { prepareTechReconciliation, reconciliationSummary, validateReconciliationInputs, observedProviderFee, verifySupabaseTarget, providerReadClient, parseReconciliationArgs, applyTechReconciliation } from '../scripts/reconcile-tech-activity.mjs';
// @ts-expect-error The owned standalone Actor module is JavaScript.
import { pricingFingerprint, reviewedProviderForRun } from '../actors/tech-collector/src/collector.mjs';
const manifest=JSON.parse(readFileSync(new URL('../data/tech/sources.json',import.meta.url),'utf8'));
const reviewed=JSON.parse(readFileSync(new URL('../actors/tech-collector/providers/reviewed-metadata.json',import.meta.url),'utf8'));
const source=manifest.sources.find((s:{scope:string;platform:string})=>s.scope==='included'&&s.platform==='YouTube');
const envId='a9a43a2a-c01a-40eb-ae1e-a1d41b52b901',rootJobId='b9a43a2a-c01a-40eb-ae1e-a1d41b52b902',childJobId='c9a43a2a-c01a-40eb-ae1e-a1d41b52b903';
const started='2026-10-21T11:00:00.000Z',finished='2026-10-21T11:05:00.000Z';
function fixture():any{
 const provider=reviewed.YouTube;
 const controllerFile={id:'fixtureController',actId:'IGSuksdW9ZsWkrsRj',userId:'HSYACi7hQoFfaaYkq',buildId:'fixtureControllerBuild'};
 const controllerRun={...controllerFile,status:'RUNNING',startedAt:started,finishedAt:null,usageTotalUsd:0.0000783674,options:{memoryMbytes:256,timeoutSecs:3600,maxTotalChargeUsd:0.4,restartOnError:false}};
 const child={id:'fixtureChild',actId:provider.actorId,userId:controllerFile.userId,buildId:provider.buildId,status:'SUCCEEDED',startedAt:started,finishedAt:finished,usageTotalUsd:0.163,defaultDatasetId:'fixtureDataset',options:{maxTotalChargeUsd:2}};
 const entry={sourceId:source.id,actorId:provider.actorId,actor:provider.actor,buildId:provider.buildId,buildNumber:provider.buildNumber,pricingFingerprint:pricingFingerprint(provider.pricing),reservedUsd:2,providerRunId:child.id,datasetId:child.defaultDatasetId,status:'SUCCEEDED',updates:[{id:'fixture-post-one',sourceId:source.id,isSample:false},{id:'fixture-post-two',sourceId:source.id,isSample:false}],coverage:{sourceId:source.id,providerRunId:child.id,providerStatus:'SUCCEEDED',acceptedItems:2}};
 const root={id:rootJobId,user_id:'user_fixture',source_id:'tech-controller',source_name:'tech collection controller',source_url:'https://recap-v0-radu.netlify.app/',platform:'Collection',provider:'apify',actor_id:controllerFile.actId,provider_run_id:controllerFile.id,status:'running',result_count:null,observed_cost_usd:null,cost_status:'unknown',error_code:null,created_at:'2026-10-21T10:59:59.000Z',finished_at:null,updated_at:started};
 const envelope={id:envId,account_id:'source-proof',request_key:'tech-d22-20261021',kind:'envelope',state:'held',maximum_usd:45};
 return {identity:{userId:'user_fixture',email:'fixture@example.invalid'},manifest:structuredClone(manifest),controllerFile,controllerRun,providerIdentity:{id:'HSYACi7hQoFfaaYkq',username:'DeleteCookies'},childRuns:[child],checkpoint:{version:1,parentRunId:controllerFile.id,inputFingerprint:'a'.repeat(64),budgetReservationId:envId,maxTotalChargeUsd:45,parentMaxChargeUsd:0.4,entries:{[source.id]:entry}},envelope,existingJobs:[root],existingBudgets:[],existingConsumers:[]};
}
const xPairs=[['legacy apidojo','nfp1fpt5gUlBwPcor','yaoXYYsyMoS92pVsj'],['Xquik','wAusCMrm284Voaw86','0zYfRnonkqidzEkEF']];
function xFixture(actorId:string,buildId:string):any{
 const data=fixture(),x=manifest.sources.find((s:{scope:string;platform:string})=>s.scope==='included'&&s.platform==='X');
 const provider=reviewedProviderForRun('X',actorId,buildId),entry=data.checkpoint.entries[source.id];
 Object.assign(entry,{sourceId:x.id,actorId,actor:provider.actor,buildId,buildNumber:provider.buildNumber,pricingFingerprint:pricingFingerprint(provider.pricing)});
 entry.coverage.sourceId=x.id;for(const update of entry.updates)update.sourceId=x.id;
 data.checkpoint.entries={[x.id]:entry};Object.assign(data.childRuns[0],{actId:actorId,buildId});return data;
}
function mockDb(jobs:any[],options:any={}){
 const store={jobs:structuredClone(jobs),consumers:[] as any[],budgets:new Map<string,any>(),calls:[] as any[]};let revision=1;
 const rpc=vi.fn(async(name:string,args:any)=>{
  store.calls.push({rpc:name,args});
  if(name==='reserve_collection_budget'){
   const row={id:'dddddddd-dddd-4ddd-8ddd-'+String(store.budgets.size+1).padStart(12,'0'),account_id:'source-proof',request_key:args.p_request_key,parent_id:args.p_parent_id,maximum_usd:args.p_maximum_usd,actor_id:args.p_actor_id,provider:'apify',kind:'job',provider_run_id:null,state:'held',actual_cost_usd:null,launch_attempted_at:null};
   if(!store.budgets.has(row.request_key))store.budgets.set(row.request_key,row);return {data:store.budgets.get(row.request_key),error:null};
  }
  const row=[...store.budgets.values()].find(x=>x.id===args.p_id);
  if(name==='claim_collection_budget'){const claimed=!row.launch_attempted_at;row.launch_attempted_at=started;return {data:{claimed,reservation:row},error:null};}
  if(name==='settle_collection_budget'){row.provider_run_id=args.p_provider_run_id;row.actual_cost_usd=args.p_actual_usd;return {data:row,error:null};}
  return {data:null,error:{code:'unknown_rpc'}};
 });
 const from=(table:string)=>{
  const filters:any[]=[];let op='select',value:any,upsertOptions:any;
  const execute=async()=>{
   const rows=table==='collection_jobs'?store.jobs:store.consumers;
   store.calls.push({table,op,filters:structuredClone(filters),value:structuredClone(value)});
   const match=(row:any)=>filters.every(([k,v]:any)=>row[k]===v);
   if(op==='select')return {data:rows.find(match)||null,error:null};
   if(op==='insert'){
    if(options.insertRace){const collision={...value,id:childJobId,updated_at:started,...options.insertRace};store.jobs.push(collision);options.insertRace=null;return {data:null,error:{code:'23505'}};}
    if(rows.some((r:any)=>r.provider_run_id===value.provider_run_id))return {data:null,error:{code:'23505'}};
    const row={...value,id:childJobId,updated_at:started};rows.push(row);return {data:row,error:null};
   }
   if(op==='update'){
    if(options.revisionRace){options.revisionRace=false;const row=rows.find(match);if(row)row.updated_at='2026-10-21T11:00:00.999999Z';}
    const row=rows.find(match);if(!row)return {data:null,error:null};Object.assign(row,value,{updated_at:`2026-10-21T11:10:00.${String(revision++).padStart(6,'0')}Z`});return {data:row,error:null};
   }
   if(op==='upsert'){
    if(!rows.some((r:any)=>r.job_id===value.job_id&&r.user_id===value.user_id))rows.push({...value});
    expect(upsertOptions).toMatchObject({ignoreDuplicates:true});return {data:null,error:null};
   }
   return {data:null,error:null};
  };
  const query:any={select:()=>query,eq:(key:string,v:any)=>{filters.push([key,v]);return query;},insert:(v:any)=>{op='insert';value=v;return query;},update:(v:any)=>{op='update';value=v;return query;},upsert:(v:any,opts:any)=>{op='upsert';value=v;upsertOptions=opts;return query;},maybeSingle:execute,single:execute,then:(ok:any,bad:any)=>execute().then(ok,bad)};
  return query;
 };
 return {db:{from,rpc},store};
}

describe('pure provider activity reconciliation',()=>{
 it('accepts a39-source manifest with an actual one-source checkpoint and creates only that run',()=>{
  const plan=prepareTechReconciliation(fixture());expect(plan.children).toHaveLength(1);expect(plan.children[0].row.source_id).toBe(source.id);expect(plan.children[0].row.result_count).toBe(2);expect(plan.controller.row.result_count).toBe(2);expect(plan.children[0].budget.maximumUsd).toBe(2);expect(plan.finalSettlementAllowed).toBe(false);
 });
 it.each(xPairs)('accepts the exact immutable %s Actor/build review even when it is not the current default',(_label,actorId,buildId)=>{
  const plan=prepareTechReconciliation(xFixture(actorId,buildId));expect(plan.children).toHaveLength(1);expect(plan.children[0].row).toMatchObject({platform:'X',actor_id:actorId});
 });
 it('rejects mixed old/new Actor-build pairs and unknown pairs',()=>{
  for(const [actorId,buildId]of [['nfp1fpt5gUlBwPcor','0zYfRnonkqidzEkEF'],['wAusCMrm284Voaw86','yaoXYYsyMoS92pVsj'],['unknownActor','unknownBuild']]){
   const data=xFixture('nfp1fpt5gUlBwPcor','yaoXYYsyMoS92pVsj'),entry=Object.values(data.checkpoint.entries)[0] as any;entry.actorId=actorId;entry.buildId=buildId;
   expect(()=>prepareTechReconciliation(data)).toThrow('unreviewed_child_identity');
  }
 });
 it('checks the pricing fingerprint against the matched historical review rather than the new default',()=>{
  const data=xFixture('nfp1fpt5gUlBwPcor','yaoXYYsyMoS92pVsj'),entry=Object.values(data.checkpoint.entries)[0] as any;
  entry.pricingFingerprint=pricingFingerprint(reviewedProviderForRun('X','wAusCMrm284Voaw86','0zYfRnonkqidzEkEF').pricing);
  expect(()=>prepareTechReconciliation(data)).toThrow('unreviewed_child_identity');
 });
 it('keeps unrelated same-envelope proof holds in its baseline without creating source activity for them',()=>{
  const data=xFixture('wAusCMrm284Voaw86','0zYfRnonkqidzEkEF');
  data.existingBudgets=[1,2].map(i=>({id:i===1?rootJobId:childJobId,parent_id:envId,account_id:'source-proof',kind:'job',state:'held',maximum_usd:0.05,actual_cost_usd:null,request_key:'unrelated-proof-'+i,provider:'apify',actor_id:'wAusCMrm284Voaw86',provider_run_id:'unrelatedProof'+i}));
  const plan=prepareTechReconciliation(data);expect(plan.budgetCommittedMaximumUsd).toBe(2.1);expect(plan.children).toHaveLength(1);expect(plan.children[0].row.provider_run_id).toBe('fixtureChild');
 });
 it('uses provider start/finish times rather than reconciliation time',()=>{
  const plan=prepareTechReconciliation(fixture());expect(plan.children[0].row).toMatchObject({created_at:started,finished_at:finished,status:'succeeded'});expect(plan.controller.row.created_at).toBe(started);
 });
 it.each(['wrong project','https://other.supabase.co','https://zlfdqzabsfndifxiqguo.supabase.co/?token=private','https://zlfdqzabsfndifxiqguo.supabase.co/rest/v1'])('rejects wrong or credential-bearing backend target %s',url=>expect(()=>verifySupabaseTarget(url)).toThrow('wrong_supabase_project'));
 it('requires exact provider owner, controller, checkpoint and budget identities',()=>{
  const mutations=[(x:any)=>x.providerIdentity.username='Other',(x:any)=>x.providerIdentity.id='other',(x:any)=>x.controllerRun.actId='other',(x:any)=>x.controllerRun.buildId='other',(x:any)=>x.controllerRun.userId='other',(x:any)=>x.checkpoint.parentRunId='other',(x:any)=>x.checkpoint.budgetReservationId=childJobId];
  for(const mutate of mutations){const data=fixture();mutate(data);expect(()=>prepareTechReconciliation(data)).toThrow();}
 });
 it.each(['actId','buildId','userId','id'])('rejects a child provider %s mismatch before producing a write plan',field=>{
  const data=fixture();data.childRuns[0][field]='other';expect(()=>prepareTechReconciliation(data)).toThrow();
 });
 it('rejects unreviewed checkpoint Actors/builds and swapped source IDs',()=>{
  for(const mutate of [(e:any)=>e.actorId='other',(e:any)=>e.buildId='other',(e:any)=>e.sourceId='other',(e:any)=>e.pricingFingerprint='changed']){const data=fixture();mutate(data.checkpoint.entries[source.id]);expect(()=>prepareTechReconciliation(data)).toThrow();}
 });
 it('rejects provider caps exceeding the durable child hold',()=>{const data=fixture();data.childRuns[0].options.maxTotalChargeUsd=2.01;expect(()=>prepareTechReconciliation(data)).toThrow('provider_cap_exceeds_reservation');});
 it('rejects duplicate run references and unknown checkpoint accounts',()=>{
  const data=fixture();data.checkpoint.entries['unknown-source']={...data.checkpoint.entries[source.id],sourceId:'unknown-source'};expect(()=>prepareTechReconciliation(data)).toThrow('unknown_checkpoint_source');
  const dup=fixture();dup.childRuns.push(structuredClone(dup.childRuns[0]));expect(()=>prepareTechReconciliation(dup)).toThrow('duplicate_child_response');
 });
 it('keeps an ambiguous start visible without inventing a run/job or releasing its envelope',()=>{
  const data=fixture();data.checkpoint.entries[source.id].providerRunId=null;data.childRuns=[];
  const plan=prepareTechReconciliation(data);expect(plan.children).toHaveLength(0);expect(plan.unboundEntries).toBe(1);expect(reconciliationSummary(plan).globalEnvelopeHeldUsd).toBe(45);
 });
 it('does not turn absent provider costs into zero, including terminal runs',()=>{
  const data=fixture();delete data.childRuns[0].usageTotalUsd;
  expect(prepareTechReconciliation(data).children[0].row).toMatchObject({observed_cost_usd:null,cost_status:'unknown'});expect(observedProviderFee({usageTotalUsd:0})).toBe(0);
 });
 it('refreshes a rising terminal observed fee while the full budget reservation stays held',()=>{
  const data=fixture(),first=prepareTechReconciliation(data).children[0].row;
  data.existingJobs.push({...first,id:childJobId,updated_at:started});data.childRuns[0].usageTotalUsd=0.1736;
  const plan=prepareTechReconciliation(data);expect(plan.children[0].row.observed_cost_usd).toBe(0.1736);expect(plan.children[0].budget.maximumUsd).toBe(2);expect(plan.finalSettlementAllowed).toBe(false);
 });
 it('preserves a previous observed fee if a refresh omits that field',()=>{
  const data=fixture(),first=prepareTechReconciliation(data).children[0].row;data.existingJobs.push({...first,id:childJobId,updated_at:started});data.childRuns[0].usageTotalUsd=null;
  const plan=prepareTechReconciliation(data);expect(plan.children[0].row.observed_cost_usd).toBe(0.163);expect(plan.children[0].freshObservedUsd).toBeNull();
 });
 it('retains a higher previously observed fee when a stale provider response is lower',()=>{
  const data=fixture(),first=prepareTechReconciliation(data).children[0].row;data.existingJobs.push({...first,id:childJobId,updated_at:started,observed_cost_usd:0.1736});
  expect(prepareTechReconciliation(data).children[0].row.observed_cost_usd).toBe(0.1736);
 });
 it.each([-1,NaN,Infinity,'0.17'])('rejects unsafe reported fee %s',fee=>expect(()=>observedProviderFee({usageTotalUsd:fee})).toThrow('invalid_provider_fee'));
 it('leaves a result count unknown until the checkpoint contains completed normalized coverage',()=>{
  const data=fixture();data.checkpoint.entries[source.id].coverage=null;data.checkpoint.entries[source.id].updates=[];
  expect(prepareTechReconciliation(data).children[0].row.result_count).toBeNull();
 });
 it('rejects forged accepted counts and cross-source normalized items',()=>{
  const data=fixture();data.checkpoint.entries[source.id].coverage.acceptedItems=99;expect(()=>prepareTechReconciliation(data)).toThrow('invalid_normalized_checkpoint_count');
  const cross=fixture();cross.checkpoint.entries[source.id].updates[0].sourceId='other';expect(()=>prepareTechReconciliation(cross)).toThrow('invalid_normalized_checkpoint_update');
 });
 it('maps running and failed outcomes independently of accepted content counts',()=>{
  const running=fixture();running.childRuns[0].status='RUNNING';running.childRuns[0].finishedAt=null;running.checkpoint.entries[source.id].coverage=null;
  expect(prepareTechReconciliation(running).children[0].row).toMatchObject({status:'running',finished_at:null,result_count:null});
  const failed=fixture();failed.childRuns[0].status='TIMED-OUT';failed.checkpoint.entries[source.id].status='TIMED-OUT';failed.checkpoint.entries[source.id].coverage.providerStatus='TIMED-OUT';
  expect(prepareTechReconciliation(failed).children[0].row).toMatchObject({status:'failed',error_code:'apify_timed_out',result_count:2});
 });
 it('requires existing activity to retain its private owner/source/provider identity',()=>{
  const data=fixture(),row=prepareTechReconciliation(data).children[0].row;data.existingJobs.push({...row,id:childJobId,updated_at:started,user_id:'user_other'});expect(()=>prepareTechReconciliation(data)).toThrow('existing_job_identity_mismatch');
 });
 it('does not duplicate a missing controller record or accept an already finalized child hold',()=>{
  const missing=fixture();missing.existingJobs=[];expect(()=>prepareTechReconciliation(missing)).toThrow('controller_activity_missing');
  const data=fixture();data.existingBudgets=[{id:childJobId,parent_id:envId,account_id:'source-proof',kind:'job',state:'settled',maximum_usd:2,actual_cost_usd:0.163,request_key:'tech-d22-child-fixtureChild',provider:'apify',actor_id:reviewed.YouTube.actorId,provider_run_id:'fixtureChild'}];expect(()=>prepareTechReconciliation(data)).toThrow('existing_child_budget_identity_mismatch');
 });
 it('counts existing build/root holds before importing additional child caps',()=>{
  const data=fixture();data.existingBudgets=[{id:childJobId,parent_id:envId,account_id:'source-proof',kind:'job',state:'held',maximum_usd:44,actual_cost_usd:null,request_key:'existing-real-build'}];expect(()=>prepareTechReconciliation(data)).toThrow('database_child_holds_exceed_envelope');
 });
 it('emits only aggregate counts/charges in the public-safe summary',()=>{
  const plan=prepareTechReconciliation(fixture()),text=JSON.stringify(reconciliationSummary(plan));expect(text).not.toContain('user_fixture');expect(text).not.toContain('fixtureController');expect(text).not.toContain('fixture@example');expect(text).not.toContain(envId);expect(text).not.toContain(source.id);expect(JSON.parse(text).providerMutationRequests).toBe(0);
 });
});

describe('read-only provider client and idempotent DB application',()=>{
 it('only exposes authenticated provider GET routes and never follows redirects',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{id:'example'}})}),read=providerReadClient('fixture-provider-token',fetcher);
  await read('/actor-runs/fixtureChild');expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error'});
  for(const path of ['/acts/anything/runs','/actor-runs/run/abort','/actor-runs/run?token=anything','https://other.test'])await expect(read(path)).rejects.toThrow('unsafe_provider_read_path');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('defaults to preview and rejects unknown/duplicate CLI flags',()=>{
  expect(parseReconciliationArgs([]).apply).toBe(false);expect(parseReconciliationArgs(['--apply']).apply).toBe(true);
  expect(()=>parseReconciliationArgs(['--start'])).toThrow('invalid_cli_option');expect(()=>parseReconciliationArgs(['--apply','--apply'])).toThrow('duplicate_cli_option');
  expect(()=>parseReconciliationArgs(['--private-output','.local/tech-owner.json'])).toThrow('private_output_overwrites_input');
 });
 it('imports each full child hold and binds null costs even after terminal provider success',async()=>{
  const data=fixture(),plan=prepareTechReconciliation(data),{db,store}=mockDb(data.existingJobs);await applyTechReconciliation(plan,db);
  expect(store.calls.find(c=>c.rpc==='settle_collection_budget').args).toMatchObject({p_actual_usd:null,p_terminal:true});expect([...store.budgets.values()][0]).toMatchObject({state:'held',maximum_usd:2,actual_cost_usd:null});
  expect(store.jobs).toHaveLength(2);expect(store.jobs.find(j=>j.id===childJobId).result_count).toBe(2);expect(store.consumers).toHaveLength(2);expect(store.calls.some(c=>c.rpc==='close_collection_budget_envelope')).toBe(false);
 });
 it('repeated application reuses jobs, owner links and child holds without double-counting the root',async()=>{
  const data=fixture(),plan=prepareTechReconciliation(data),{db,store}=mockDb(data.existingJobs);await applyTechReconciliation(plan,db);await applyTechReconciliation(plan,db);
  expect(store.jobs).toHaveLength(2);expect(store.consumers).toHaveLength(2);expect(store.budgets.size).toBe(1);expect(store.jobs.filter(j=>j.provider_run_id==='fixtureController')).toHaveLength(1);
 });
 it('rejects a raced provider-run insert belonging to a different reader instead of upserting over it',async()=>{
  const data=fixture(),plan=prepareTechReconciliation(data),{db,store}=mockDb(data.existingJobs,{insertRace:{user_id:'user_other'}});
  await expect(applyTechReconciliation(plan,db)).rejects.toThrow('existing_job_identity_mismatch');expect(store.jobs.find(j=>j.provider_run_id==='fixtureChild').user_id).toBe('user_other');
 });
 it('cannot lower a newer fee recorded after the preview but before application',async()=>{
  const data=fixture(),plan=prepareTechReconciliation(data),newer={...plan.children[0].row,id:childJobId,updated_at:started,observed_cost_usd:0.1736};
  const {db,store}=mockDb([...data.existingJobs,newer]);await applyTechReconciliation(plan,db);expect(store.jobs.find(j=>j.id===childJobId).observed_cost_usd).toBe(0.1736);
 });
 it('uses the server revision to reject a concurrent running->running activity update',async()=>{
  const data=fixture(),plan=prepareTechReconciliation(data),{db}=mockDb(data.existingJobs,{revisionRace:true});
  await expect(applyTechReconciliation(plan,db)).rejects.toThrow('activity_revision_conflict');
 });
});
