import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { assertNoProductionEnvironment,validateCgroup } from './policy.mjs';
export function inspectBounds(){
 assert.equal(process.getuid(),10001,'Unprivileged CI user required');
 assert.equal(process.versions.node.split('.')[0],'22');
 assertNoProductionEnvironment(process.env);
 const cg=name=>readFileSync('/sys/fs/cgroup/'+name,'utf8');
 const mount=readFileSync('/proc/self/mountinfo','utf8').split('\n').find(line=>line.split(' ')[4]==='/');
 const result={memory:cg('memory.max'),swap:cg('memory.swap.max'),pids:cg('pids.max'),cpu:cg('cpu.max'),
  status:readFileSync('/proc/self/status','utf8'),rootReadOnly:mount?.split(' ')[5].split(',').includes('ro'),
  dockerSocket:existsSync('/var/run/docker.sock')||existsSync('/run/docker.sock')};
 validateCgroup(result);return result;
}
