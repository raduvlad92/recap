import { describe,expect,it } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { GitHandoverJournal,GitDeploymentWindowJournal,hostingJournalBranch,probeGitHandoverJournal } from '../scripts/cloudflare-handover-git.mjs';
import { ReleaseGitHub } from '../scripts/cloudflare-release-github.mjs';
import { planHandover } from '../scripts/cloudflare-handover-state.mjs';
import { deploymentWindowState } from '../scripts/cloudflare-deployment-window.mjs';
import { executionFlags } from '../scripts/cloudflare-release-state.mjs';
const target='a'.repeat(40),hash='b'.repeat(64),ids={web:'11111111-1111-4111-8111-111111111111',jobs:'22222222-2222-4222-8222-222222222222',source:'33333333-3333-4333-8333-333333333333'};
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
function fixture(){
 const artifact={release:target,mode:'active',hashes:Object.fromEntries(['web','jobs','sourceWorker','sourceContainer'].map(name=>[name,hash])),configs:{sourceRuntime:hash},assets:{'index.html':hash}},off=Object.fromEntries(executionFlags.map(flag=>[flag,'false']));
 const snapshot={control:{owner:'netlify',epoch:1,release:'0'.repeat(40),paused:true,old_host_fenced:false},revision:randomUUID(),work:{queued:0,running:0,expired_running:0,uncertain:0},domain:'recap.filternode.dev',sourceVerified:true,sourcePin:{version:ids.source,image:hash,workerHash:hash,containerHash:hash,enabled:false},workers:Object.fromEntries(['web','jobs'].map(kind=>[kind,{version:ids[kind],mode:'shadow',flags:off,bindingsHash:hash}])),evidence:Object.fromEntries(['privateParity','secretContinuity','preservation','legacyDrain','fenceReadiness'].map(name=>[name,{verified:true,release:target,digest:hash}])),rollback:{verified:true,host:'cloudflare',mode:'active',release:'c'.repeat(40),digest:hash,versions:{web:ids.web,jobs:ids.jobs}}};
 const plan=planHandover(artifact,snapshot,{policy:off,resumeProcessing:false}),journal={schema:1,planDigest:plan.digest,phase:'prepared',pending:'stop-delivery',error:null,versions:null,fenceReceipt:null,revision:plan.expected.revision,intents:{},native:{schema:1,targetWitness:null,operations:{}}};
 const files=new Map(),calls=[],state={branch:false,head:target,lose:false,forceConflict:false,corrupt:false};
 const fetcher=async(input,init={})=>{
  const url=new URL(input),path=url.pathname.split('/recap/')[1],method=init.method||'GET';calls.push({path,method,body:init.body&&JSON.parse(init.body)});
  if(path==='git/ref/heads/main')return Response.json({object:{sha:state.head}});
  if(path==='git/ref/heads/'+hostingJournalBranch)return state.branch?Response.json({ref:'refs/heads/'+hostingJournalBranch,object:{type:'commit',sha:target}}):Response.json({message:'missing'},{status:404});
  if(path==='git/refs'){expect(method).toBe('POST');expect(JSON.parse(init.body)).toEqual({ref:'refs/heads/'+hostingJournalBranch,sha:target});state.branch=true;return Response.json({});}
  if(path.startsWith('contents/')){
   const file=path.slice('contents/'.length);expect(file.startsWith('.hosting-journal/')).toBe(true);
   if(method==='GET'){
    expect(url.searchParams.get('ref')).toBe(hostingJournalBranch);const text=files.get(file);if(!text)return Response.json({message:'missing'},{status:404});
    return Response.json({type:'file',path:file,encoding:'base64',content:Buffer.from(state.corrupt?'tampered':text).toString('base64'),sha:blob(text)});
   }
   expect(method).toBe('PUT');const data=JSON.parse(init.body);expect(data.branch).toBe(hostingJournalBranch);
   const old=files.get(file);if(state.forceConflict||data.sha!==(old?blob(old):undefined))return Response.json({message:'conflict'},{status:409});
   const text=Buffer.from(data.content,'base64').toString();files.set(file,text);
   if(state.lose){state.lose=false;throw Error('lost-git-write-reply');}return Response.json({content:{sha:blob(text)}});
  }
  throw Error('Unexpected isolated Git endpoint');
 };
 const github=new ReleaseGitHub({token:'fixture-operator-token',runId:1,fetcher});return{artifact,plan,journal,files,calls,state,github,remote:new GitHandoverJournal(github,plan,artifact)};
}
describe('operator journal with expected-blob writes',()=>{
 it('creates only the isolated branch/file and acknowledges exact remote content before returning',async()=>{
  const f=fixture();await f.remote.save(f.journal);expect(f.remote.checkpoint).toMatchObject({branch:hostingJournalBranch,path:'.hosting-journal/'+f.plan.digest+'/handover.json'});
  const restored=await GitHandoverJournal.restore(f.github,f.plan.digest,f.artifact);expect(restored.prior).toEqual(f.journal);
  await restored.remote.save({...f.journal,phase:'delivery-stopped',pending:null});
  const updates=f.calls.filter(call=>call.method==='PUT');expect(updates).toHaveLength(2);expect(updates[1].body.sha).toBe(blob(Buffer.from(updates[0].body.content,'base64').toString()));
  expect(f.calls.some(call=>/check-runs|messages|deployments|api-keys/.test(call.path))).toBe(false);
 });
 it('does not repeat a creation or update after a lost successful response',async()=>{
  const f=fixture();f.state.lose=true;await expect(f.remote.save(f.journal)).rejects.toThrow('lost-git-write-reply');await f.remote.save(f.journal);
  const next={...f.journal,phase:'delivery-stopped',pending:null};f.state.lose=true;await expect(f.remote.save(next)).rejects.toThrow('lost-git-write-reply');await f.remote.save(next);
  expect(f.calls.filter(call=>call.method==='PUT')).toHaveLength(2);expect(JSON.parse(f.files.get(f.remote.path)).sequence).toBe(2);
 });
 it('rejects stale writers and provider-side compare-and-swap conflicts',async()=>{
  const f=fixture();await f.remote.save(f.journal);const stale=await GitHandoverJournal.restore(f.github,f.plan.digest,f.artifact);
  await f.remote.save({...f.journal,phase:'delivery-stopped',pending:null});
  await expect(stale.remote.save({...f.journal,error:'handover_phase_uncertain'})).rejects.toThrow('handover_git_requires_resume');
  f.state.forceConflict=true;await expect(f.remote.save({...f.journal,phase:'delivery-stopped',pending:'fence'})).rejects.toThrow('release_github_conflict');
 });
 it.each(['blob','artifact','native-private','witness','unknown-envelope'])('rejects changed %s content',async reason=>{
  const f=fixture();await f.remote.save(f.journal);
  if(reason==='blob')f.state.corrupt=true;
  if(reason==='artifact'){await expect(GitHandoverJournal.restore(f.github,f.plan.digest,{...f.artifact,assets:{}})).rejects.toThrow('handover_artifact_changed');return;}
  if(reason==='native-private'){await expect(f.remote.save({...f.journal,native:{...f.journal.native,privateKey:'do-not-record'}})).rejects.toThrow('handover_checkpoint_changed');return;}
  if(reason==='witness'){await expect(f.remote.save({...f.journal,native:{...f.journal.native,targetWitness:{name:'OTHER_TARGET',value:'paused',updatedAt:'2026-11-04T00:00:00Z'}}})).rejects.toThrow('handover_checkpoint_changed');return;}
  if(reason==='unknown-envelope'){const value=JSON.parse(f.files.get(f.remote.path));value.privateData='do-not-record';f.files.set(f.remote.path,JSON.stringify(value));}
  await expect(GitHandoverJournal.restore(f.github,f.plan.digest,f.artifact)).rejects.toThrow('handover_git_record_changed');
 });
 it('blocks branch creation when main moved and refuses arbitrary checkpoint paths',async()=>{
  const f=fixture();f.state.head='c'.repeat(40);await expect(f.remote.save(f.journal)).rejects.toThrow('release_checked_head_changed');expect(f.files.size).toBe(0);
  await expect(GitHandoverJournal.restore(f.github,'../probes/private',f.artifact)).rejects.toThrow('invalid_handover_checkpoint');
 });
 it('verifies native-style storage and stale-write rejection with a non-restorable probe',async()=>{
  const f=fixture(),proof=await probeGitHandoverJournal(f.github,target);expect(proof).toMatchObject({storageVerified:true,staleWriteRejected:true,activatesProcessing:false,restorableCheckpoint:false});
  expect(JSON.parse(f.files.get(proof.path)).kind).toBe('transport-only-operator-journal');expect(f.files.size).toBe(1);
 });
});

describe('separate operator deployment-window storage',()=>{
 it('acknowledges and restores a transport-only window without constructing a handover plan',async()=>{
  const f=fixture(),state=deploymentWindowState(target,'transport-only'),remote=new GitDeploymentWindowJournal(f.github,state);await remote.save(state);
  const restored=await GitDeploymentWindowJournal.restore(f.github,state.operation);expect(restored.state).toEqual(state);
  expect(remote.path).toBe('.hosting-journal/windows/'+state.operation+'.json');expect(f.files.size).toBe(1);
  await expect(GitHandoverJournal.restore(f.github,f.plan.digest,f.artifact)).rejects.toThrow();
 });
 it('reconciles a lost storage reply and rejects stale window writers',async()=>{
  const f=fixture(),state=deploymentWindowState(target,'transport-only'),remote=new GitDeploymentWindowJournal(f.github,state);f.state.lose=true;
  await expect(remote.save(state)).rejects.toThrow('lost-git-write-reply');await remote.save(state);
  const stale=await GitDeploymentWindowJournal.restore(f.github,state.operation),next={...state,phase:'disable-intent',workflow:{id:406418558,path:'.github/workflows/cloudflare-duplicate.yml',priorUpdatedAt:'2026-11-04T00:00:00Z',disabledUpdatedAt:null}};
  await remote.save(next);await expect(stale.remote.save({...next,phase:'suspended',workflow:{...next.workflow,disabledUpdatedAt:'2026-11-04T01:00:00Z'}})).rejects.toThrow('deployment_window_requires_resume');
 });
 it('rejects changed identity, private fields and arbitrary restore paths',async()=>{
  const f=fixture(),state=deploymentWindowState(target,'transport-only'),remote=new GitDeploymentWindowJournal(f.github,state);await remote.save(state);
  await expect(remote.save({...state,target:'c'.repeat(40)})).rejects.toThrow('deployment_window_checkpoint_changed');
  await expect(remote.save({...state,token:'private'})).rejects.toThrow('deployment_window_checkpoint_changed');
  await expect(GitDeploymentWindowJournal.restore(f.github,'../private')).rejects.toThrow('invalid_deployment_window_checkpoint');
  const value=JSON.parse(f.files.get(remote.path));value.state.purpose='handover';f.files.set(remote.path,JSON.stringify(value));
  await expect(GitDeploymentWindowJournal.restore(f.github,state.operation)).rejects.toThrow('deployment_window_checkpoint_changed');
 });
});
