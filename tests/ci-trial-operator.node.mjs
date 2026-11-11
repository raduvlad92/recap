import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'recap-ci-operator-')),bin=join(dir,'bin'),state=join(dir,'state.json');mkdirSync(bin);
 const data={head:'a'.repeat(40),base:'b'.repeat(40),merge:'c'.repeat(40),jobStatus:'queued',runnerId:0,
  conclusion:null,runnerName:'',runners:[],calls:[],failPost:false,busy:false};
 writeFileSync(join(bin,'gh'),'#!'+process.execPath+'\n'+String.raw`
const fs=require('node:fs'),file=process.env.CI_FAKE_GITHUB_STATE,d=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2),path=args.find(s=>s.startsWith('repos/'));
const method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET';
const save=()=>fs.writeFileSync(file,JSON.stringify(d));
d.calls.push({path,method});save();let result;
if(method==='DELETE'){d.runners=[];save();process.exit(0);}
else if(method==='POST'){
 const body=JSON.parse(fs.readFileSync(0,'utf8'));d.runnerName=body.name;d.runners=[{id:123,name:body.name,busy:false,labels:body.labels.map(name=>({name}))}];save();
 if(d.failPost)process.exit(1);
 result={runner:{id:123,name:body.name},encoded_jit_config:Buffer.from('constructed-one-job-fixture-only-configuration').toString('base64')};
}else if(path.endsWith('/pulls/23'))result={state:'open',merge_commit_sha:d.merge,head:{ref:'ci/hostinger-test-trial-20261109',sha:d.head,repo:{full_name:'raduvlad92/recap'}},base:{ref:'review/full-reader-release-20261108',sha:d.base,repo:{full_name:'raduvlad92/recap'}}};
else if(path.endsWith('/git/ref/pull/23/merge'))result={object:{sha:d.merge}};
else if(path.includes('/attempts/1/jobs'))result={jobs:[{id:999,name:'Isolated test-only trial',status:d.jobStatus,conclusion:d.conclusion,runner_id:d.runnerId,runner_name:d.runnerName}]};
else if(path.endsWith('/actions/runs/12345'))result={event:'pull_request',head_sha:d.head,path:'.github/workflows/hostinger-ci-trial.yml',repository:{full_name:'raduvlad92/recap'},status:d.runStatus||'in_progress',conclusion:null,run_attempt:1,pull_requests:[{number:23}]};
else if(path.includes('/actions/runners?'))result={total_count:d.runners.length,runners:d.runners.map(r=>({...r,busy:d.busy}))};
else process.exit(2);
console.log(JSON.stringify(result));
`,{mode:0o700});
 const save=()=>writeFileSync(state,JSON.stringify(data));save();
 const load=()=>Object.assign(data,JSON.parse(readFileSync(state,'utf8')));
 const privateDir=join(dir,'operation');
 const run=(command,...args)=>spawnSync(process.execPath,[join(root,'scripts/ci-trial/operator.mjs'),command,...args],
  {encoding:'utf8',env:{PATH:bin+':'+dirname(process.execPath)+':/usr/bin:/bin',HOME:dir,GH_CONFIG_DIR:join(dir,'gh'),CI_FAKE_GITHUB_STATE:state},timeout:10000});
 const prepare=()=>run('prepare','23','12345','local-qualification',privateDir);
 return{data,save,load,run,prepare,privateDir,close:()=>rmSync(dir,{recursive:true,force:true})};
}
it('creates a private exact native intent and never starts or registers during preparation',()=>{
 const f=fixture();try{const result=f.prepare();assert.equal(result.status,0,result.stderr);f.load();
  const i=JSON.parse(readFileSync(join(f.privateDir,'intent.json'),'utf8'));assert.equal(i.mergeSha,f.data.merge);
  assert(f.data.calls.every(c=>c.method==='GET'));assert(!existsSync(join(f.privateDir,'runner-jit')));
 }finally{f.close();}
});
it('rejects a nonqueued native job before creating an operation',()=>{
 const f=fixture();try{f.data.jobStatus='in_progress';f.save();assert.notEqual(f.prepare().status,0);
  assert(!existsSync(f.privateDir));f.load();assert(f.data.calls.every(c=>c.method==='GET'));
 }finally{f.close();}
});
for(const ambiguous of [false,true])it('never duplicates '+(ambiguous?'an ambiguous':'an acknowledged')+' JIT request',()=>{
 const f=fixture();try{assert.equal(f.prepare().status,0);f.data.failPost=ambiguous;f.save();
  assert.equal(f.run('jit',f.privateDir).status,ambiguous?1:0);assert.notEqual(f.run('jit',f.privateDir).status,0);
  f.load();assert.equal(f.data.calls.filter(c=>c.method==='POST').length,1);
  assert(existsSync(join(f.privateDir,'jit-intent.json')));
 }finally{f.close();}
});
it('an early readback cannot consume the final evidence path',()=>{
 const f=fixture();try{assert.equal(f.prepare().status,0);assert.equal(f.run('jit',f.privateDir).status,0);f.load();
  f.data.jobStatus='in_progress';f.data.runnerId=123;f.save();assert.notEqual(f.run('readback',f.privateDir).status,0);
  assert(!existsSync(join(f.privateDir,'native-after.json')));
  f.data.jobStatus='completed';f.data.conclusion='success';f.save();assert.equal(f.run('readback',f.privateDir).status,0);
  assert.equal(JSON.parse(readFileSync(join(f.privateDir,'native-after.json'),'utf8')).job.conclusion,'success');
 }finally{f.close();}
});
it('cleanup refuses another operation and a busy runner, then deletes only its own exact ID',()=>{
 const f=fixture();try{assert.equal(f.prepare().status,0);assert.equal(f.run('jit',f.privateDir).status,0);f.load();
  const path=join(f.privateDir,'registration.json'),original=JSON.parse(readFileSync(path,'utf8'));
  writeFileSync(path,JSON.stringify({...original,name:'therecap-trial-another'}));assert.notEqual(f.run('cleanup',f.privateDir).status,0);
  writeFileSync(path,JSON.stringify(original));f.data.busy=true;f.save();assert.notEqual(f.run('cleanup',f.privateDir).status,0);
  f.load();assert.equal(f.data.calls.filter(c=>c.method==='DELETE').length,0);
  f.data.busy=false;f.save();assert.equal(f.run('cleanup',f.privateDir).status,0);f.load();
  assert.deepEqual(f.data.calls.filter(c=>c.method==='DELETE'),[{path:'repos/raduvlad92/recap/actions/runners/123',method:'DELETE'}]);
  assert.equal(f.data.runners.length,0);
 }finally{f.close();}
});
