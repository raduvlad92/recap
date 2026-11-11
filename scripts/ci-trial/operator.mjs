// Operator-side only. Its GitHub credential never belongs in a runner/container.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { repository, branch, baseBranch, workflow, runnerLabel, limits, validateIntent,validateRegistration } from '../../infrastructure/ci-trial/policy.mjs';

const api=(path,body)=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`,...(body?['--method','POST','--input','-']:[])],
 {input:body?JSON.stringify(body):undefined,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
  env:{...process.env,GH_DEBUG:'',GH_PAGER:'cat'},stdio:['pipe','pipe','pipe']})||'null');
const save=(dir,name,value)=>writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function native(prNumber,runId){
 const pr=api('pulls/'+prNumber), run=api('actions/runs/'+runId), merge=api(`git/ref/pull/${prNumber}/merge`);
 assert.equal(pr.state,'open'); assert.equal(pr.head.repo.full_name,repository);assert.equal(pr.base.repo.full_name,repository);
 assert.equal(pr.head.ref,branch);assert.equal(pr.base.ref,baseBranch);
 assert.equal(pr.merge_commit_sha,merge.object.sha);
 assert.equal(run.event,'pull_request');assert.equal(run.head_sha,pr.head.sha);
 assert.equal(run.path.split('@')[0],workflow);assert.equal(run.repository.full_name,repository);
 assert(['queued','in_progress'].includes(run.status) && run.conclusion===null,'Trial is not awaiting execution');
 assert(run.pull_requests.some(p=>p.number===prNumber),'Run belongs to another PR');
 const jobs=api(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`).jobs;
 const matches=jobs.filter(j=>j.name==='Isolated test-only trial');assert.equal(matches.length,1);
 const job=matches[0];assert.equal(job.status,'queued');assert.equal(job.conclusion,null);assert(!job.runner_id);
 return{pr,run,merge,job};
}
try{
 const [command,...args]=process.argv.slice(2);
 if(command==='prepare'){
  assert.equal(args.length,4,'prepare PR RUN_ID LOCATION NEW_PRIVATE_DIRECTORY');
  assert(/^[1-9][0-9]*$/.test(args[0]) && /^[1-9][0-9]*$/.test(args[1]));
  const prNumber=Number(args[0]),runId=args[1],location=args[2],dir=resolve(args[3]);
  assert(['local-qualification','hostinger'].includes(location));
  const proof=native(prNumber,runId),now=Date.now();
  const intent=validateIntent({schema:1,operationId:randomUUID(),repository,workflow,pullRequest:prNumber,
   headSha:proof.pr.head.sha,baseSha:proof.pr.base.sha,mergeSha:proof.merge.object.sha,runId,
   runAttempt:proof.run.run_attempt,issuedAt:new Date(now).toISOString(),
   expiresAt:new Date(now+limits.intentMilliseconds).toISOString(),location});
  mkdirSync(dir,{mode:0o700});save(dir,'intent.json',intent);save(dir,'native-before.json',proof);
  console.log(JSON.stringify({operationId:intent.operationId,intentFile:join(dir,'intent.json'),location,
   nativeHostCapacityVerified:false,startsRunner:false,productionChanges:false}));
 }else{
  assert.equal(args.length,1,'Expected the same private directory');const dir=resolve(args[0]);
  const intent=JSON.parse(readFileSync(join(dir,'intent.json'),'utf8'));
  // Cleanup/readback may occur after the intent has expired; bind every other field.
  validateIntent(intent,command==='jit'?Date.now():Date.parse(intent.issuedAt));
  if(command==='jit'){
   const proof=native(intent.pullRequest,intent.runId);
   for(const [actual,expected]of [[proof.pr.head.sha,intent.headSha],[proof.pr.base.sha,intent.baseSha],
    [proof.merge.object.sha,intent.mergeSha],[proof.run.run_attempt,intent.runAttempt]])assert.equal(actual,expected);
   assert(!existsSync(join(dir,'jit-intent.json')),'Never retry an acknowledged or ambiguous JIT intent');
   const request={name:'therecap-trial-'+intent.operationId,runner_group_id:1,
    labels:['self-hosted','linux',runnerLabel],work_folder:'_work'};
   save(dir,'jit-intent.json',{operationId:intent.operationId,request,
    requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex')});
   const reply=api('actions/runners/generate-jitconfig',request);
   assert(Number.isSafeInteger(reply.runner?.id) && reply.runner.name===request.name);
   assert(typeof reply.encoded_jit_config==='string' && /^[A-Za-z0-9+/]+={0,2}$/.test(reply.encoded_jit_config));
   save(dir,'registration.json',{id:reply.runner.id,name:reply.runner.name,operationId:intent.operationId});
   writeFileSync(join(dir,'runner-jit'),reply.encoded_jit_config+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({registeredRunnerId:reply.runner.id,operationId:intent.operationId,
    startsRunner:false,operatorHostCapacityAndFilePermissionsRequired:true}));
  }else if(command==='readback'){
   const run=api('actions/runs/'+intent.runId);
   assert.equal(run.head_sha,intent.headSha);assert.equal(run.run_attempt,intent.runAttempt);
   const jobs=api(`actions/runs/${intent.runId}/attempts/${intent.runAttempt}/jobs?per_page=100`).jobs;
   const job=jobs.find(j=>j.name==='Isolated test-only trial');assert(job);
   const registration=validateRegistration(JSON.parse(readFileSync(join(dir,'registration.json'),'utf8')),intent);
   assert.equal(job.runner_id,registration.id);assert.equal(job.runner_name,registration.name);
   assert.equal(job.status,'completed','Final evidence requires a terminal job');
   assert(['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale'].includes(job.conclusion));
   save(dir,'native-after.json',{run,job,location:intent.location});
   console.log(JSON.stringify({runId:intent.runId,jobId:job.id,status:job.status,conclusion:job.conclusion,
    location:intent.location,productionReleaseAccepted:false,cleanupRequired:true}));
  }else if(command==='cleanup'){
   const registration=validateRegistration(JSON.parse(readFileSync(join(dir,'registration.json'),'utf8')),intent);
   const list=api('actions/runners?per_page=100');assert.equal(list.total_count,list.runners.length,'Inspect pagination separately');
   const runner=list.runners.find(r=>r.id===registration.id);
   if(runner){
    assert.equal(runner.name,registration.name);assert.equal(runner.busy,false,'Stop/finish only this trial first');
    assert(runner.labels.some(l=>l.name===runnerLabel));
    execFileSync('gh',['api','--method','DELETE',`repos/${repository}/actions/runners/${registration.id}`],{stdio:'pipe',timeout:30000});
   }
   const after=api('actions/runners?per_page=100');assert(!after.runners.some(r=>r.id===registration.id));
   save(dir,'runner-cleanup.json',{id:registration.id,operationId:intent.operationId,absent:true});
   console.log(JSON.stringify({registrationAbsent:true,containerAndScratchCleanupStillRequired:true}));
  }else throw Error('Unknown operator command');
 }
}catch{console.error('Test-only operator refused input, stale native identity, ambiguous intent or failed GitHub request. Inspect the private intent; do not blindly retry.');process.exitCode=1;}
