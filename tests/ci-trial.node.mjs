import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateIntent,validateJob,validateCgroup,validateRegistration,assertNoProductionEnvironment,assertVitestReport,assertTapReport,
 repository,branch,baseBranch,workflow,validateScratch } from '../infrastructure/ci-trial/policy.mjs';

const now=Date.parse('2026-11-09T01:00:00.000Z');
const intent=()=>({schema:1,operationId:'10000000-0000-4000-8000-000000000001',repository,workflow,pullRequest:23,
 headSha:'a'.repeat(40),baseSha:'b'.repeat(40),mergeSha:'c'.repeat(40),runId:'12345',runAttempt:1,
 issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+2700000).toISOString(),location:'local-qualification'});
function job(){
 const i=intent(),ref='refs/pull/23/merge';
 return{i,env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:ref,
  GITHUB_SHA:i.mergeSha,GITHUB_RUN_ID:i.runId,GITHUB_RUN_ATTEMPT:'1',GITHUB_HEAD_REF:branch,GITHUB_BASE_REF:baseBranch,
  GITHUB_WORKFLOW_REF:`${repository}/${workflow}@${ref}`,GITHUB_WORKFLOW_SHA:i.mergeSha},
  event:{number:23,repository:{full_name:repository},pull_request:{head:{repo:{full_name:repository},ref:branch,sha:i.headSha},
   base:{repo:{full_name:repository},ref:baseBranch,sha:i.baseSha}}}};
}
const cg=()=>({memory:'4294967296',swap:'0',pids:'512',cpu:'100000 100000',status:'CapEff:\t0000000000000000\nNoNewPrivs:\t1\n',rootReadOnly:true,dockerSocket:false});
describe('filesystem counters remain independent of disappearing temporary paths',()=>{
 const disk=()=>({bsize:4096n,blocks:2097152n,bfree:524288n,bavail:262144n});
 it('accepts exact disk and reserved-free boundaries without traversing a path',()=>assert.deepEqual(validateScratch(disk()),{totalBytes:'8589934592',availableBytes:'1073741824'}));
 for(const change of [{bavail:262143n},{blocks:2097153n},{bsize:0n},{blocks:0n},{bfree:2097153n},{bavail:524289n},{bavail:-1n},{bsize:4096}])
  it('rejects uncapped, low-free or inconsistent filesystem '+String(Object.keys(change)[0])+' '+String(Object.values(change)[0]),()=>assert.throws(()=>validateScratch({...disk(),...change})));
});
describe('test-only runner identity and resource boundaries',()=>{
 it('admits exactly one bound synthetic PR merge identity, without changing its input',()=>{
  const {i,env,event}=job(),before=JSON.stringify({i,env,event});assert.equal(validateJob(i,env,event,now).mergeSha,i.mergeSha);
  assert.equal(before,JSON.stringify({i,env,event}));
 });
 for(const key of Object.keys(job().env))it('rejects a different '+key,()=>{
  const {i,env,event}=job();env[key]+='-different';assert.throws(()=>validateJob(i,env,event,now));
 });
 for(const [name,change]of [
  ['fork',e=>e.pull_request.head.repo.full_name='another/repository'],['different PR',e=>e.number=24],
  ['different source',e=>e.pull_request.head.sha='d'.repeat(40)],['changed base',e=>e.pull_request.base.sha='e'.repeat(40)],
  ['other branch',e=>e.pull_request.head.ref='main'],['other target',e=>e.pull_request.base.ref='main'],
 ])it('rejects '+name,()=>{const {i,env,event}=job();change(event);assert.throws(()=>validateJob(i,env,event,now));});
 for(const [name,change]of [
  ['unknown intent field',i=>i.deploy=true],['missing binding',i=>delete i.mergeSha],['future intent',i=>{i.issuedAt=new Date(now+1).toISOString();i.expiresAt=new Date(now+2700001).toISOString();}],
  ['longer expiry',i=>i.expiresAt=new Date(now+2700001).toISOString()],['unqualified location',i=>i.location='production'],
 ])it('rejects '+name,()=>{const i=intent();change(i);assert.throws(()=>validateIntent(i,now));});
 it('expires at the exact bound',()=>assert.throws(()=>validateIntent(intent(),now+2700000)));
 it('allows the fixed cgroup limits',()=>validateCgroup(cg()));
 for(const [key,value]of [['memory','max'],['memory','4294967297'],['pids','max'],['pids','513'],['swap','1'],
  ['cpu','max 100000'],['cpu','100001 100000'],['status','CapEff: 0000000000000001\nNoNewPrivs: 1\n'],
  ['status','CapEff: 0000000000000000\nNoNewPrivs: 0\n'],['rootReadOnly',false],['dockerSocket',true]])
  it('rejects resource/security drift '+key+' '+value,()=>{const c=cg();c[key]=value;assert.throws(()=>validateCgroup(c));});
 for(const key of ['GITHUB_TOKEN','APIFY_TOKEN','CLERK_SECRET_KEY','DATABASE_URL','PGPASSWORD','NODE_AUTH_TOKEN','GITHUB_ACTIONS','GITHUB_RUN_ID'])
  it('rejects credential/context env '+key,()=>assert.throws(()=>assertNoProductionEnvironment({[key]:'synthetic'})));
 it('allows only ordinary launcher configuration',()=>assertNoProductionEnvironment({HOME:'/r/home',NODE_VERSION:'22.0.0',PATH:'/usr/bin'}));
 it('binds cleanup to its exact native runner identity',()=>{
  const i=intent(),r={id:123,name:'therecap-trial-'+i.operationId,operationId:i.operationId};
  validateRegistration(r,i);
  for(const changed of [{...r,id:-1},{...r,id:'123'},{...r,name:'therecap-trial-other'},{...r,operationId:'other'},{...r,extra:true}])
   assert.throws(()=>validateRegistration(changed,i));
 });
});
describe('complete evidence rather than successful skips',()=>{
 const report=()=>({success:true,numPassedTests:4321,numTotalTests:4321,numPassedTestSuites:146,numFailedTests:0,
  numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,numPendingTestSuites:0,
  testResults:Array.from({length:146},(_,i)=>({status:'passed',assertionResults:Array.from({length:i===0?4176:1},()=>({status:'passed'}))}))});
 it('accepts a complete zero-skip constructed report',()=>assertVitestReport(report()));
 for(const [name,change]of [['skips',r=>r.numPendingTests=1],['todo',r=>r.numTodoTests=1],['failed',r=>r.success=false],
  ['missing tests',r=>r.numPassedTests=12],['missing file',r=>r.testResults.pop()],['hidden pending assertion',r=>r.testResults[0].assertionResults[0].status='pending'],
  ['count mismatch',r=>r.numTotalTests=9999]])it('rejects '+name,()=>{const r=report();change(r);assert.throws(()=>assertVitestReport(r));});
 const tap='# tests 102\n# pass 102\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
 it('accepts complete TAP',()=>assertTapReport(tap));
 for(const old of ['# pass 102','# fail 0','# cancelled 0','# skipped 0','# todo 0'])
  it('rejects missing/invalid TAP '+old,()=>assert.throws(()=>assertTapReport(tap.replace(old,old+'1'))));
 it('leaves the production release entrypoint and workflow untouched by this package',()=>{
  const flow=readFileSync(new URL('../.github/workflows/hostinger-ci-trial.yml',import.meta.url),'utf8');
  assert(!/secrets\.|environment:|pull_request_target|workflow_dispatch|release:cloudflare|deploy:/.test(flow));
  assert.match(flow,/persist-credentials: false/);assert.match(flow,/contents: read/);
  assert.match(flow,/RECAP_CI_TRIAL_ENABLED == 'true'/);
  const docker=readFileSync(new URL('../infrastructure/ci-trial/compose.yaml',import.meta.url),'utf8');
  assert(!/docker\.sock|privileged:|network_mode:|ports:|env_file:/.test(docker));
  for(const control of ['read_only: true',"restart: 'no'",'cpus: 1.0','mem_limit: 4g','pids_limit: 512','cap_drop: [ALL]'])assert(docker.includes(control));
 });
});
