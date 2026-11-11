// Operator-side macOS supervisor. Never copied into, or controlled by, the job.
import assert from 'node:assert/strict';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { assertNoProductionEnvironment, limits, validateIntent } from './policy.mjs';

const label = 'com.therecap.ci-trial';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function checkCapacity(host) {
 assert(host.macMemoryFreePercent >= 20, 'Mac memory pressure is too high');
 assert(host.vmMemoryAvailable >= 6 * 1024 ** 3, 'Docker VM needs six GiB available RAM');
 assert(host.cpus >= 2 && host.cgroupV2, 'Docker CPU/cgroup prerequisites missing');
 assert(host.diskFree >= 20 * 1024 ** 3 && host.vmDiskFree >= 20 * 1024 ** 3, 'Mac and Docker VM each need twenty GiB free disk');
}
export function checkContainer(c, { operationId, work, inputs, network }) {
 const h = c.HostConfig;
 assert.equal(c.Config.Labels[label], operationId);
 assert.equal(c.Config.User, '10001:10001');
 assertNoProductionEnvironment(Object.fromEntries(c.Config.Env.map(s => [s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)])));
 assert.equal(h.Memory, limits.memory); assert.equal(h.MemorySwap, limits.memory);
 assert.equal(h.NanoCpus, 1000000000); assert.equal(h.PidsLimit, limits.pids);
 assert.equal(h.ReadonlyRootfs, true); assert.equal(h.Privileged, false);
 assert.deepEqual(h.CapDrop, ['ALL']); assert(!h.CapAdd?.length);
 assert(h.SecurityOpt.includes('no-new-privileges'));
 assert.equal(h.NetworkMode, network); assert(!h.PidMode && h.IpcMode !== 'host');
 assert(!Object.keys(h.PortBindings || {}).length && h.RestartPolicy.Name === 'no');
 assert.equal(c.Mounts.length, inputs ? 3 : 1);
 assert.deepEqual(c.Mounts.map(m=>m.Destination).sort(),(inputs?['/r','/run/trial','/run/secrets']:['/r']).sort());
 for (const m of c.Mounts) {
  if (m.Destination === '/r') assert(m.Type === 'volume' && m.Name === work && m.RW);
  else assert(inputs && ['/run/trial','/run/secrets'].includes(m.Destination) && m.Type === 'volume' && m.Name === inputs && !m.RW);
 }
 assert.equal(c.Mounts.filter(m => m.Destination === '/r').length,1);
}
const command = (file,args,options={}) => execFileSync(file,args,{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,...options});
const docker = (args,options) => command('docker',args,options);
const json = args => JSON.parse(docker(args));
const save = (dir,name,value) => writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const helperBounds = ['--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--memory-swap','128m','--cpus','0.25','--pids-limit','32'];
const vmQuery = `const fs=require('fs'),os=require('os'); const m=fs.readFileSync('/proc/meminfo','utf8').split('\\n').find(s=>s.startsWith('MemAvailable:')); console.log(JSON.stringify({vmMemoryAvailable:Number(m.trim().split(/\\s+/)[1])*1024,cpus:os.cpus().length,cgroupV2:fs.existsSync('/sys/fs/cgroup/cgroup.controllers'),vmDiskFree:Number(fs.statfsSync('/',{bigint:true}).bavail*fs.statfsSync('/',{bigint:true}).bsize)}));`;

export async function supervise(mode, directory, image) {
 assert.equal(process.platform,'darwin','This supervisor is only for local macOS Docker Desktop');
 assert(['qualify','deadline-probe','disk-probe','inputs-probe','run'].includes(mode));
 assert.match(image,/^sha256:[a-f0-9]{64}$/);
 const local = realpathSync(join(root,'.local'));
 const dir = resolve(directory);
 assert(dir.startsWith(local+'/') && !existsSync(join(dir,'supervisor-started')));
 if (!['run','inputs-probe'].includes(mode)) mkdirSync(dir,{mode:0o700});
 assert.equal(realpathSync(dir),dir); assert.equal(lstatSync(dir).mode & 0o077,0);
 const intent = ['run','inputs-probe'].includes(mode) ? validateIntent(JSON.parse(readFileSync(join(dir,'intent.json'),'utf8'))) : null;
 if (intent) assert.equal(intent.location,'local-qualification');
 const operationId = intent?.operationId || randomUUID();
 const name = 'therecap-ci-local-'+operationId;
 const inputs = intent ? name+'-inputs' : null;
 const helper=name+'-init', storage=name+'-disk', work=name+'-work';
 for(const volume of [storage,work])assert.equal(docker(['volume','ls','-q','--filter','name=^'+volume+'$']).trim(),'');
 assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']).trim(),'');
 if (inputs) assert.equal(docker(['volume','ls','-q','--filter','name=^'+inputs+'$']).trim(),'');
 const imageInfo = json(['image','inspect',image])[0]; assert.equal(imageInfo.Id,image);
 assert.equal(imageInfo.Architecture,'arm64');
 const pressure = /System-wide memory free percentage: (\d+)%/.exec(command('/usr/bin/memory_pressure',['-Q']));
 assert(pressure,'Unknown Mac memory-pressure output');
 const diskStat = statfsSync(dir,{bigint:true});
 const host = {...JSON.parse(docker(['run','--rm',...helperBounds,'--user','10001:10001','--entrypoint','node',image,'-e',vmQuery])),
  diskFree:Number(diskStat.bavail*diskStat.bsize),macMemoryFreePercent:Number(pressure[1]),sampledAtUtc:new Date().toISOString()};
 checkCapacity(host); save(dir,'capacity-before.json',host);
 // Docker's JSON-lines output is saved verbatim, privately, without inspecting environments.
 writeFileSync(join(dir,'containers-before.jsonl'),docker(['ps','-a','--no-trunc','--format','json']),{flag:'wx',mode:0o600});
 save(dir,'supervisor-started',{operationId,mode,image});
 let createAttempted=false, inputsAttempted=false, storageAttempted=false, workAttempted=false, loop, timedOut=false, timer, fd;
 const maximum=mode==='disk-probe'?256*1024**2:limits.scratch;
 const diskHelper=readFileSync(new URL('./local-disk.py',import.meta.url),'utf8');
 const diskCommand=action=>JSON.parse(docker(['run','--rm','--name',helper,'--label',label+'='+operationId,...helperBounds,'--cap-add','SYS_ADMIN','--user','0:0','--device',loop,'--mount','type=volume,source='+storage+',target=/disk','--entrypoint','python3',image,'-c',diskHelper,action,loop,String(maximum)]));
 let failure;
 const removeContainer = target => {
  const found=docker(['ps','-aq','--filter','name=^/'+target+'$']).trim();
  if (!found) return;
  const c=json(['inspect',target])[0]; assert.equal(c.Config.Labels[label],operationId);
  docker(['rm','--force',target]);
 };
 try {
  storageAttempted=true;docker(['volume','create','--label',label+'='+operationId,storage]);
  const free=JSON.parse(docker(['run','--rm',...helperBounds,'--user','0:0','--device','/dev/loop-control','--entrypoint','python3',image,'-c',"import os,fcntl,json;f=os.open('/dev/loop-control',os.O_RDWR);print(json.dumps({'index':fcntl.ioctl(f,0x4C82)}));os.close(f)"]));
  assert(Number.isSafeInteger(free.index)&&free.index>=0&&free.index<1024);loop='/dev/loop'+free.index;
  save(dir,'disk-custody.json',{operationId,loop,storage,work,maximumBytes:maximum});
  save(dir,'loop-attached.json',diskCommand('create'));
  workAttempted=true;docker(['volume','create','--label',label+'='+operationId,'--driver','local','--opt','type=ext4','--opt','device='+loop,'--opt','o=nodev,nosuid',work]);
  docker(['run','--rm','--name',helper,'--label',label+'='+operationId,...helperBounds,'--cap-add','CHOWN','--user','0:0','--mount','type=volume,source='+work+',target=/work','--entrypoint','node',image,'-e',"const fs=require('fs');fs.chmodSync('/work',0o700);fs.chownSync('/work',10001,10001)"]);
  const query=`const fs=require('fs'),a=require('assert/strict');const s=fs.statfsSync('/probe',{bigint:true});a(s.blocks*s.bsize<=${maximum}n);console.log(JSON.stringify({operationId:${JSON.stringify(operationId)},filesystemBytes:String(s.blocks*s.bsize),freeBytes:String(s.bavail*s.bsize)}));`;
  const proof=JSON.parse(docker(['run','--rm',...helperBounds,'--user','10001:10001','--mount','type=volume,source='+work+',target=/probe,readonly','--entrypoint','node',image,'-e',query]));
  save(dir,'scratch-capacity.json',{...proof,hardMaximumBytes:maximum});
  if (inputs) {
   const jitPath=join(dir,'runner-jit'),st=lstatSync(jitPath);
   assert(st.isFile()&&!st.isSymbolicLink()&&st.size<=65536&&(st.mode&0o077)===0);
   const jit=readFileSync(jitPath,'utf8').trim();assert(/^[A-Za-z0-9+/]+={0,2}$/.test(jit)&&jit.length>=32);
   inputsAttempted=true;docker(['volume','create','--label',label+'='+operationId,inputs]);
   const init=`const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));for(const [n,v]of Object.entries(p)){fs.writeFileSync('/inputs/'+n,v,{flag:'wx',mode:0o600});fs.chownSync('/inputs/'+n,10001,10001)}fs.chmodSync('/inputs',0o700);fs.chownSync('/inputs',10001,10001);`;
   docker(['run','--rm','--interactive','--name',helper,'--label',label+'='+operationId,...helperBounds,'--cap-add','CHOWN','--user','0:0','--mount','type=volume,source='+inputs+',target=/inputs','--entrypoint','node',image,'-e',init],
    {input:JSON.stringify({'intent.json':JSON.stringify(intent),'runner-jit':jit})});
  }
  const network=mode==='run'?'bridge':'none';
  const args=['create','--name',name,'--label',label+'='+operationId,'--network',network,'--read-only','--init','--user','10001:10001','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','4g','--memory-swap','4g','--cpus','1','--pids-limit','512','--restart','no','--log-driver','json-file','--log-opt','max-size=10m','--log-opt','max-file=2',
   '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001','--mount','type=volume,source='+work+',target=/r'];
  if(inputs)for(const target of ['/run/trial','/run/secrets'])args.push('--mount','type=volume,source='+inputs+',target='+target+',readonly');
  if(mode!=='run')args.push('--entrypoint','node');
  args.push(image);
  if(mode==='qualify')args.push('/opt/trial/qualify.mjs');
  if(mode==='inputs-probe')args.push('-e',"const fs=require('fs'),a=require('assert/strict');for(const p of ['/run/trial/intent.json','/run/secrets/runner-jit']){const s=fs.statSync(p);a.equal(s.uid,10001);a.equal(s.mode&511,384);a(fs.readFileSync(p,'utf8').length>32);a.throws(()=>fs.writeFileSync(p,'forbidden'),{code:'EROFS'})}console.log(JSON.stringify({privateInputProjectionQualified:true,uid:process.getuid(),readOnly:true}));");
  if(mode==='deadline-probe')args.push('-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)");
  if(mode==='disk-probe')args.push('-e',"const fs=require('fs');const f='/r/fill';let fd=fs.openSync(f,'wx'),written=0;try{while(true)written+=fs.writeSync(fd,Buffer.alloc(1048576))}catch(e){if(e.code!=='ENOSPC')throw e;console.log(JSON.stringify({kind:'disk-full-refused',written,errno:e.code}))}finally{fs.closeSync(fd);fs.unlinkSync(f)}");
  createAttempted=true;docker(args);
  const before=json(['inspect',name])[0];checkContainer(before,{operationId,work,inputs,network});save(dir,'container-before.json',before);
  fd=openSync(join(dir,'runner.log'),'wx',0o600);
  const seconds=mode==='deadline-probe'?2:mode==='run'?Math.min(limits.seconds,Math.floor((Date.parse(intent.expiresAt)-Date.now())/1000)):300;
  assert(seconds>0);
  const started=Date.now();
  const code=await new Promise((done,reject)=>{
   const child=spawn('docker',['start','--attach',name],{stdio:['ignore',fd,fd]});
   const stop=()=>{timedOut=true;try{docker(['stop','--time','3',name]);}catch{try{docker(['kill',name]);}catch{}}};
   timer=setTimeout(stop,seconds*1000);
   const interrupt=()=>stop();process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
   child.once('error',reject);child.once('exit',value=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);done(value)});
  });
  clearTimeout(timer);closeSync(fd);fd=undefined;
  const after=json(['inspect',name])[0];save(dir,'container-after.json',after);
  const elapsedMilliseconds=Date.now()-started;
  save(dir,'runtime.json',{mode,code,exitCode:after.State.ExitCode,oomKilled:after.State.OOMKilled,timedOut,elapsedMilliseconds,deadlineSeconds:seconds,operationId,image});
  if(mode==='deadline-probe')assert(timedOut && !after.State.Running && elapsedMilliseconds<15000,'External deadline did not stop container');
  else {
   assert(!timedOut&&!after.State.OOMKilled&&code===0&&after.State.ExitCode===0,'Container did not finish successfully');
   if(mode==='qualify')assert(readFileSync(join(dir,'runner.log'),'utf8').includes('"pgcrypto":true'),'Environment qualification missing');
   if(mode==='inputs-probe')assert(readFileSync(join(dir,'runner.log'),'utf8').includes('"privateInputProjectionQualified":true'),'Private input qualification missing');
   if(mode==='disk-probe')assert(readFileSync(join(dir,'runner.log'),'utf8').includes('"errno":"ENOSPC"'),'Disk cap not exercised');
  }
 }catch(error){failure=error;}
 finally {
  clearTimeout(timer);if(fd!==undefined)closeSync(fd);
  try {
   if(createAttempted&&mode==='run')for(const [source,target]of [['/r/control/admitted.json','admitted.json'],['/r/actions-runner/_work/recap/recap/.local/ci-trial','reports']]){
    try{docker(['cp',name+':'+source,join(dir,target)]);}catch{/* Missing evidence remains missing; preserve the failure/log. */}
   }
   if(createAttempted)removeContainer(name);if(inputsAttempted)removeContainer(helper);
   if(inputsAttempted&&docker(['volume','ls','-q','--filter','name=^'+inputs+'$']).trim()){
    const v=json(['volume','inspect',inputs])[0];assert.equal(v.Labels[label],operationId);docker(['volume','rm',inputs]);
   }
   removeContainer(helper);
   const removeVolume = volume => {
    if(!docker(['volume','ls','-q','--filter','name=^'+volume+'$']).trim())return;
    const v=json(['volume','inspect',volume])[0];assert.equal(v.Labels[label],operationId);docker(['volume','rm',volume]);
   };
   if(workAttempted)removeVolume(work);
   if(loop)save(dir,'loop-cleanup.json',diskCommand('clear'));
   if(storageAttempted)removeVolume(storage);
   const volumeAbsent=volume=>!docker(['volume','ls','-q','--filter','name=^'+volume+'$']).trim();
   save(dir,'local-cleanup.json',{operationId,containerAbsent:!docker(['ps','-aq','--filter','name=^/'+name+'$']).trim(),inputsAbsent:!inputs||volumeAbsent(inputs),scratchVolumeAbsent:volumeAbsent(work),backingVolumeAbsent:volumeAbsent(storage),loopDetached:!!loop,githubRegistrationCleanupStillRequired:mode==='run'});
  }catch(error){failure ||= error;}
 }
 if(failure)throw failure;
 console.log(JSON.stringify({operationId,mode,localExecutionFinished:true,productionReleaseAccepted:false,privateEvidenceDirectory:dir}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{assert.equal(process.argv.length,5);await supervise(...process.argv.slice(2));}
 catch(error){console.error('Local test-only supervisor refused or failed: '+error.message);process.exitCode=1;}
}
