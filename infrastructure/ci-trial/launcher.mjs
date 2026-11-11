import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { limits, validateIntent, validateScratch } from './policy.mjs';
import { inspectBounds } from './runtime.mjs';

let child, timer, monitor, stopping=false, boundFailure=false;
const stop = () => {
 if(stopping)return; stopping=true;
 if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
 const kill=setTimeout(()=>{if(child?.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}};process.exit(124);},10000);
 kill.unref();
};
try {
 inspectBounds();
 const intent=validateIntent(JSON.parse(readFileSync('/run/trial/intent.json','utf8')));
 // The separate filesystem is the hard quota. Kernel counters remain valid while temporary files disappear.
 const scratch=()=>validateScratch(statfsSync('/r',{bigint:true}));
 scratch();
 writeFileSync('/r/used-once',intent.operationId,{flag:'wx',mode:0o600});
 for(const path of ['/r/control','/r/home','/r/t','/r/npm'])mkdirSync(path,{mode:0o700});
 cpSync('/opt/actions-runner','/r/actions-runner',{recursive:true,errorOnExist:true,force:false});
 chmodSync('/r/actions-runner',0o700);
 // Intent is kept outside the application checkout; scripts are on the read-only root.
 copyFileSync('/run/trial/intent.json','/r/control/intent.json');
 const stat=lstatSync('/run/secrets/runner-jit');
 assert(stat.isFile() && !stat.isSymbolicLink() && stat.size<=65536 && (stat.mode&0o077)===0,'Private regular JIT file required');
 const jit=readFileSync('/run/secrets/runner-jit','utf8').trim();
 assert(/^[A-Za-z0-9+/]+={0,2}$/.test(jit) && jit.length>=32,'Invalid JIT config');
 const env={...process.env,HOME:'/r/home',TMPDIR:'/r/t',NPM_CONFIG_CACHE:'/r/npm',
  ACTIONS_RUNNER_HOOK_JOB_STARTED:'/opt/trial/job-started.sh',
  READER_TEST_PG_BIN:'/usr/lib/postgresql/17/bin',CI_TRIAL_LOCATION:intent.location};
 console.log(JSON.stringify({event:'test-only-runner-start',operationId:intent.operationId,location:intent.location,
  bounds:limits,productionCredentials:false,dockerSocket:false}));
 child=spawn('/r/actions-runner/run.sh',['--jitconfig',jit],{cwd:'/r/actions-runner',env,detached:true,stdio:'inherit'});
 child.on('error',()=>{console.error('Runner failed to start');stop();process.exitCode=1;});
 timer=setTimeout(()=>{boundFailure=true;stop();},Math.min(limits.seconds*1000,Date.parse(intent.expiresAt)-Date.now()));
 monitor=setInterval(()=>{try{scratch();}catch{console.error('Test runner scratch bound reached');boundFailure=true;stop();}},15000);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{boundFailure=true;stop();});
 child.on('exit',(code)=>{
  clearTimeout(timer);clearInterval(monitor);
  const admitted=existsSync('/r/control/admitted.json');
  console.log(JSON.stringify({event:'test-only-runner-exit',operationId:intent.operationId,admitted,code,boundFailure,
   nativeGitHubConclusionRequired:true,operatorCleanupRequired:true}));
  process.exit(boundFailure?124:(code===0&&admitted?0:1));
 });
} catch { console.error('Test-only runner refused prerequisites, resource bounds, intent or credential file');process.exitCode=1; }
