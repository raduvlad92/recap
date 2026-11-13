import{describe,it,expect,vi}from'vitest';
import{createHash}from'node:crypto';
import{ReleaseGitHub,ReleaseJournal}from'../scripts/cloudflare-release-github.mjs';
import{ReleaseError,runRelease}from'../scripts/cloudflare-release-state.mjs';
const target='a'.repeat(40),plan={target,digest:'b'.repeat(64),artifactHashes:{web:'c'.repeat(64),jobs:'d'.repeat(64),sourceWorker:'e'.repeat(64),sourceContainer:'f'.repeat(64)}};
const pause='11111111-1111-4111-8111-111111111111';
const journal=(phase='transferred',pending=null,error=null)=>({schema:2,planDigest:plan.digest,phase,pending,error,versions:{jobs:pause,web:'22222222-2222-4222-8222-222222222222'},revision:pause,intents:{pause}});
function fixture(selectedPlan=plan){
 const state={records:new Map(),calls:[],readQueue:[],readError:null,postResponseLost:false,patchReplyStale:false};let next=1;
 const github={wait:vi.fn(async()=>{}),request:async(path,body,method)=>{
  const verb=method||(body?'POST':'GET'),bare=path.split('?')[0];state.calls.push({path,verb,body:structuredClone(body)});
  if(bare==='check-runs'&&verb==='POST'){
   const record={...structuredClone(body),id:next++,app:{slug:'github-actions'}};state.records.set(record.id,record);
   if(state.postResponseLost)throw new Error('POST response lost after possible acceptance');return structuredClone(record);
  }
  const id=Number(bare.split('/')[1]);
  if(verb==='PATCH'){const before=structuredClone(state.records.get(id));Object.assign(state.records.get(id),structuredClone(body));return state.patchReplyStale?before:structuredClone(state.records.get(id));}
  if(state.readError)throw state.readError;
  return structuredClone(state.readQueue.length?state.readQueue.shift():state.records.get(id));
 }};
 return{state,github,remote:new ReleaseJournal(github,selectedPlan)};
}
const creates=f=>f.state.calls.filter(c=>c.verb==='POST'),patches=f=>f.state.calls.filter(c=>c.verb==='PATCH'),gets=f=>f.state.calls.filter(c=>c.verb==='GET');
describe('checkpoint acknowledgement reads never retry a write',()=>{
 it('reconciles a stale GET after PATCH using distinct fresh read URLs and unchanged nonce/version bindings',async()=>{
  const f=fixture();await f.remote.save(journal());const old=structuredClone(f.state.records.get(1));f.state.readQueue.push(old);f.state.calls=[];
  await f.remote.save(journal('transferred','promote'));
  expect(patches(f)).toHaveLength(1);expect(creates(f)).toHaveLength(0);expect(gets(f)).toHaveLength(2);expect(new Set(gets(f).map(x=>x.path)).size).toBe(2);expect(gets(f).every(x=>new URL('https://fixture/'+x.path).searchParams.has('ack_observation'))).toBe(true);expect(f.github.wait.mock.calls).toEqual([[200]]);
  const saved=JSON.parse(f.state.records.get(1).output.summary);expect(saved.plan).toEqual(plan);expect(saved.journal.intents).toEqual({pause});expect(saved.journal.versions).toEqual(journal().versions);
 });
 it('also reconciles a stale PATCH response through reads, without repeating that PATCH',async()=>{
  const f=fixture();await f.remote.save(journal());f.state.calls=[];f.state.patchReplyStale=true;
  await f.remote.save(journal('transferred','promote'));expect(patches(f)).toHaveLength(1);expect(gets(f)).toHaveLength(1);expect(f.remote.id).toBe(1);
 });
 it('retains a validated created ID when all GET acknowledgements fail; later error save uses that same ID',async()=>{
  const f=fixture(),error=Object.assign(new ReleaseError('release_github_request_failed'),{httpStatus:503});f.state.readError=error;
  await expect(f.remote.save(journal())).rejects.toBe(error);expect(f.remote.id).toBe(1);expect(creates(f)).toHaveLength(1);expect(gets(f)).toHaveLength(3);
  f.state.readError=null;await f.remote.save(journal('transferred',null,'release_github_request_failed'));
  expect(creates(f)).toHaveLength(1);expect(patches(f)).toHaveLength(1);expect(f.state.records.size).toBe(1);expect(JSON.parse(f.state.records.get(1).output.summary).journal.error).toBe('release_github_request_failed');
 });
 it('stops after three permanently stale reads and preserves the same created identity',async()=>{
  const f=fixture();await f.remote.save(journal());const old=structuredClone(f.state.records.get(1));f.state.readQueue.push(old,old,old);f.state.calls=[];
  await expect(f.remote.save(journal('transferred','promote'))).rejects.toThrow('release_checkpoint_unacknowledged');expect(patches(f)).toHaveLength(1);expect(gets(f)).toHaveLength(3);expect(f.remote.id).toBe(1);
 });
 it('does not create a second checkpoint if the initial POST response loses its ID',async()=>{
  const f=fixture();f.state.postResponseLost=true;await expect(f.remote.save(journal())).rejects.toThrow('POST response lost');expect(f.remote.id).toBe(null);
  await expect(f.remote.save(journal('transferred',null,'release_phase_uncertain'))).rejects.toThrow('release_checkpoint_creation_uncertain');expect(creates(f)).toHaveLength(1);expect(f.state.records.size).toBe(1);
 });
 it.each(['head','plan','nonce','extra-nonce','versions'])('refuses incompatible fresh %s evidence without accepting or overwriting the conflict again',async kind=>{
  const f=fixture();await f.remote.save(journal());const wrong=structuredClone(f.state.records.get(1));
  if(kind==='head')wrong.head_sha='c'.repeat(40);
  else{const data=JSON.parse(wrong.output.summary);if(kind==='plan')data.plan.target='d'.repeat(40);else if(kind==='versions')data.journal.versions.jobs='33333333-3333-4333-8333-333333333333';else if(kind==='extra-nonce')data.journal.intents.resume='33333333-3333-4333-8333-333333333333';else data.journal.intents.pause='33333333-3333-4333-8333-333333333333';wrong.output.summary=JSON.stringify(data);}
  f.state.readQueue.push(wrong);f.state.calls=[];await expect(f.remote.save(journal('transferred','promote'))).rejects.toThrow('release_checkpoint_changed');expect(patches(f)).toHaveLength(1);expect(gets(f)).toHaveLength(1);
 });
 it('does not retry authentication failures as eventual consistency',async()=>{
  const f=fixture();f.state.readError=Object.assign(new ReleaseError('release_github_request_failed'),{httpStatus:403});await expect(f.remote.save(journal())).rejects.toThrow('release_github_request_failed');expect(gets(f)).toHaveLength(1);expect(f.github.wait).not.toHaveBeenCalled();expect(f.remote.id).toBe(1);
 });
 it.each([[null,'release_checkpoint_unacknowledged'],['resume',null]])('never publishes completion success for pending=%s/error=%s',async(pending,error)=>{
  const f=fixture();await expect(f.remote.save(journal('complete',pending,error))).rejects.toThrow('release_checkpoint_reconciliation_required');expect(f.state.calls).toHaveLength(0);
 });
 it('preserves and blocks a legacy complete/error checkpoint instead of silently clearing it on restore',async()=>{
  const f=fixture();await f.remote.save(journal());f.state.records.get(1).output.summary=JSON.stringify({schema:1,plan,journal:journal('complete',null,'release_checkpoint_unacknowledged')});f.state.calls=[];
  await expect(ReleaseJournal.restore(f.github,1,{release:target,hashes:plan.artifactHashes})).rejects.toThrow('release_checkpoint_reconciliation_required');expect(gets(f)).toHaveLength(1);expect(gets(f)[0].path).toContain('?restore_observation=');expect(patches(f)).toHaveLength(0);
 });
 it('publishes a complete checkpoint only after exact error-free completion is freshly read back',async()=>{
  const f=fixture();await f.remote.save(journal('complete'));const saved=f.state.records.get(1);expect(saved.status).toBe('completed');expect(saved.conclusion).toBe('success');expect(JSON.parse(saved.output.summary).journal).toEqual(journal('complete'));
 });
 it('rejects a restored response from another checkpoint even with the exact same plan and journal',async()=>{
  const f=fixture();await f.remote.save(journal());f.state.readQueue.push({...structuredClone(f.state.records.get(1)),id:2});f.state.calls=[];
  await expect(ReleaseJournal.restore(f.github,1,{release:target,hashes:plan.artifactHashes})).rejects.toThrow('release_checkpoint_changed');expect(gets(f)).toHaveLength(1);expect(patches(f)).toHaveLength(0);expect(creates(f)).toHaveLength(0);
 });
 it.each([0,-1,1.5,'01','9007199254740993',''])('rejects invalid or noncanonical checkpoint identity %s before any read',async id=>{
  const f=fixture();await expect(ReleaseJournal.restore(f.github,id,{release:target,hashes:plan.artifactHashes})).rejects.toThrow('invalid_release_checkpoint');expect(f.state.calls).toHaveLength(0);
 });
 it.each([['in_progress',null],['completed','failure'],['completed','neutral']])('rejects a complete journal with incompatible remote status %s/%s',async(status,conclusion)=>{
  const f=fixture();await f.remote.save(journal('complete'));Object.assign(f.state.records.get(1),{status,conclusion});f.state.calls=[];
  await expect(ReleaseJournal.restore(f.github,1,{release:target,hashes:plan.artifactHashes})).rejects.toThrow('release_checkpoint_reconciliation_required');expect(gets(f)).toHaveLength(1);expect(patches(f)).toHaveLength(0);
 });
 it.each([['completed','success'],['completed','failure'],['in_progress','failure']])('rejects an incomplete journal with incompatible remote status %s/%s',async(status,conclusion)=>{
  const f=fixture();await f.remote.save(journal());Object.assign(f.state.records.get(1),{status,conclusion});f.state.calls=[];
  await expect(ReleaseJournal.restore(f.github,1,{release:target,hashes:plan.artifactHashes})).rejects.toThrow('release_checkpoint_reconciliation_required');expect(patches(f)).toHaveLength(0);
 });
 it('retains HTTP status metadata without exposing response bodies for read retry classification',async()=>{
  const github=new ReleaseGitHub({token:'fixture',runId:1,fetcher:async()=>Response.json({private:'must not escape'},{status:403})});
  let error;try{await github.request('check-runs/1')}catch(value){error=value;}expect(error.code).toBe('release_github_request_failed');expect(error.httpStatus).toBe(403);expect(String(error)).not.toContain('must not escape');
 });
});

function continuationFixture(){
 const transfer='33333333-3333-4333-8333-333333333333';
 const body={schema:2,action:'cloudflare-release',target,expected:{owner:'cloudflare',epoch:6,release:'9'.repeat(40),paused:true,old_host_fenced:true,revision:pause},blockers:[],artifactHashes:plan.artifactHashes};
 const selectedPlan={...body,digest:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
 const f=fixture(selectedPlan),prior={...journal(),planDigest:selectedPlan.digest,revision:transfer,intents:{pause,transfer},error:'release_checkpoint_unacknowledged'};
 const calls=[],status={control:{owner:'cloudflare',epoch:7,release:target,paused:true,old_host_fenced:true},revision:transfer,work:{queued:0,running:0,expired_running:0,uncertain:96}};
 const api={status:async()=>structuredClone(status),assertCheckedRelease:async()=>{},promote:async()=>{calls.push('promote');},verify:async()=>{calls.push('verify');return true;}};
 for(const key of ['quiesce','upload','transfer','resume'])api[key]=async()=>{calls.push(key);throw new Error('unexpected native mutation: '+key);};
 return{...f,selectedPlan,prior,calls,status,api};
}
describe('real coordinator plus private in-memory acknowledgement transport',()=>{
 it('never overwrites a conflicting nonce through the coordinator error-save path',async()=>{
  const f=continuationFixture();await f.remote.save(f.prior);const request=f.github.request;let injected=false;
  f.github.request=async(...args)=>{const read=await request(...args);if((args[2]||'GET')==='GET'&&!injected){injected=true;const data=JSON.parse(read.output.summary);data.journal.intents.pause='44444444-4444-4444-8444-444444444444';read.output.summary=JSON.stringify(data);f.state.records.set(1,structuredClone(read));}return read;};f.state.calls=[];
  await expect(runRelease(f.selectedPlan,f.api,value=>f.remote.save(value),f.prior)).rejects.toThrow('release_checkpoint_changed');
  expect(patches(f)).toHaveLength(1);expect(gets(f)).toHaveLength(1);expect(creates(f)).toHaveLength(0);expect(f.calls).toEqual([]);expect(JSON.parse(f.state.records.get(1).output.summary).journal.intents.pause).toBe('44444444-4444-4444-8444-444444444444');
 });
 it('continues one saved transferred checkpoint through a stale promotion-intent read, preserving pause and all saved identities',async()=>{
  const f=continuationFixture();await f.remote.save(f.prior);f.state.readQueue.push(structuredClone(f.state.records.get(1)));f.state.calls=[];
  const result=await runRelease(f.selectedPlan,f.api,value=>f.remote.save(value),f.prior);
  expect(result.phase).toBe('complete');expect(result.error).toBe(null);expect(result.pending).toBe(null);expect(result.versions).toEqual(f.prior.versions);expect(result.intents.pause).toBe(pause);expect(result.intents.transfer).toBe(f.prior.intents.transfer);expect(f.calls).toEqual(['promote','verify']);expect(f.status.control.paused).toBe(true);expect(f.status.work.uncertain).toBe(96);expect(creates(f)).toHaveLength(0);expect(patches(f)).toHaveLength(5);expect(gets(f)).toHaveLength(6);
 });
 it('records the same pending phase/error without any promotion if three promotion-intent observations stay stale',async()=>{
  const f=continuationFixture();await f.remote.save(f.prior);const old=structuredClone(f.state.records.get(1));f.state.readQueue.push(old,old,old);f.state.calls=[];
  await expect(runRelease(f.selectedPlan,f.api,value=>f.remote.save(value),f.prior)).rejects.toThrow('release_checkpoint_unacknowledged');
  const actual=JSON.parse(f.state.records.get(1).output.summary);expect(actual.journal.phase).toBe('transferred');expect(actual.journal.pending).toBe('promote');expect(actual.journal.error).toBe('release_checkpoint_unacknowledged');expect(actual.plan).toEqual(f.selectedPlan);expect(actual.journal.versions).toEqual(f.prior.versions);expect(actual.journal.intents).toEqual(f.prior.intents);expect(f.calls).toEqual([]);expect(f.status.control.paused).toBe(true);expect(f.status.work.uncertain).toBe(96);expect(creates(f)).toHaveLength(0);expect(patches(f)).toHaveLength(2);expect(gets(f)).toHaveLength(4);
 });
});
