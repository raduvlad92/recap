// Credential-free local image/environment probe, never GitHub/Hostinger release evidence.
import assert from 'node:assert/strict';
import { chmodSync,cpSync,mkdirSync,rmSync,statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectBounds } from './runtime.mjs';
import { validateScratch } from './policy.mjs';
const bounds=inspectBounds(),root='/r/qualification',bin='/usr/lib/postgresql/17/bin/';
const scratch=validateScratch(statfsSync('/r',{bigint:true}));
const run=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:60000,maxBuffer:1048576});
mkdirSync(root,{mode:0o700});mkdirSync(root+'/socket',{mode:0o700});
cpSync('/opt/actions-runner',root+'/runner',{recursive:true,errorOnExist:true,force:false});chmodSync(root+'/runner',0o700);
const version=execFileSync(root+'/runner/bin/Runner.Listener',['--version'],{cwd:root+'/runner',encoding:'utf8',timeout:15000}).trim();
assert.equal(version,'2.338.2');
const actionNode=run(root+'/runner/externals/node24/bin/node',['--version']).trim();assert.match(actionNode,/^v24\./);
for(const file of ['initdb','pg_ctl','psql'])assert.match(run(bin+file,['--version']),/\b17\./);
let started=false;
try{
 run(bin+'initdb',['-D',root+'/data','-A','trust','-U','postgres','--no-locale','-E','UTF8']);
 run(bin+'pg_ctl',['-D',root+'/data','-l',root+'/postgres.log','-o',`-k ${root}/socket -h '' -p 55491`,'-w','start']);started=true;
 const answer=run(bin+'psql',['-X','-qAt','-h',root+'/socket','-p','55491','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1',
  '-c',"create extension pgcrypto;select current_setting('server_version_num')::int/10000,encode(digest('constructed-probe','sha256'),'hex');"]).trim();
 assert.equal(answer,'17|'+createHash('sha256').update('constructed-probe').digest('hex'));
 console.log(JSON.stringify({kind:'credential-free-local-image-probe',node:process.versions.node,runner:version,actionNode,
  postgresql:17,pgcrypto:true,uid:process.getuid(),memoryMax:bounds.memory.trim(),swapMax:bounds.swap.trim(),
  cpuMax:bounds.cpu.trim(),pidsMax:bounds.pids.trim(),rootReadOnly:true,dockerSocket:false,
  tcpDatabaseListener:false,productionCredentials:false,scratch,hostingerProven:false,githubJobProven:false}));
}finally{
 if(started)run(bin+'pg_ctl',['-D',root+'/data','stop','-m','immediate','-w']);
 rmSync(root,{recursive:true,force:true});
}
