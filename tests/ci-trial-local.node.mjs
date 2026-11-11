import assert from 'node:assert/strict';
import { it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCapacity,checkContainer } from '../infrastructure/ci-trial/local-supervise.mjs';

const host=()=>({macMemoryFreePercent:39,vmMemoryAvailable:7*1024**3,cpus:10,cgroupV2:true,diskFree:80*1024**3,vmDiskFree:80*1024**3});
it('local capacity requires independent Mac, VM and disk headroom',()=>{
 checkCapacity(host());
 for(const change of [{macMemoryFreePercent:19},{vmMemoryAvailable:6*1024**3-1},{cpus:1},{cgroupV2:false},{diskFree:20*1024**3-1},{vmDiskFree:20*1024**3-1}])assert.throws(()=>checkCapacity({...host(),...change}));
});
const expected={operationId:'operation-fixture',work:'fixture-work',inputs:'fixture-inputs',network:'bridge'};
const container=()=>({Config:{Labels:{'com.therecap.ci-trial':expected.operationId},User:'10001:10001',Env:['PATH=/usr/bin','HOME=/r/home']},HostConfig:{Memory:4294967296,MemorySwap:4294967296,NanoCpus:1000000000,PidsLimit:512,ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:[],SecurityOpt:['no-new-privileges'],NetworkMode:'bridge',PidMode:'',IpcMode:'private',PortBindings:{},RestartPolicy:{Name:'no'}},Mounts:[{Destination:'/r',Type:'volume',Name:expected.work,RW:true},...['/run/trial','/run/secrets'].map(Destination=>({Destination,Type:'volume',Name:expected.inputs,RW:false}))]});
it('accepts native inspection only with exact local scratch and private read-only inputs',()=>checkContainer(container(),expected));
for(const [name,change]of [
 ['foreign operation',c=>c.Config.Labels['com.therecap.ci-trial']='another'],
 ['operator credential',c=>c.Config.Env.push('GITHUB_TOKEN=constructed')],
 ['unbounded RAM',c=>c.HostConfig.Memory=0],['swap',c=>c.HostConfig.MemorySwap=-1],
 ['extra CPU',c=>c.HostConfig.NanoCpus=2000000000],['unbounded processes',c=>c.HostConfig.PidsLimit=0],
 ['root user',c=>c.Config.User='0:0'],['writable root',c=>c.HostConfig.ReadonlyRootfs=false],
 ['privileged',c=>c.HostConfig.Privileged=true],['extra capability',c=>c.HostConfig.CapAdd=['SYS_ADMIN']],
 ['missing dropped capabilities',c=>c.HostConfig.CapDrop=[]],['missing protection',c=>c.HostConfig.SecurityOpt=[]],
 ['host networking',c=>c.HostConfig.NetworkMode='host'],['host processes',c=>c.HostConfig.PidMode='host'],
 ['host IPC',c=>c.HostConfig.IpcMode='host'],['exposed port',c=>c.HostConfig.PortBindings={'8080/tcp':[{HostPort:'8080'}]}],
 ['persistent restart',c=>c.HostConfig.RestartPolicy.Name='always'],
 ['different workspace',c=>c.Mounts[0].Name='production-work'],['writable intent',c=>c.Mounts[1].RW=true],
 ['foreign inputs',c=>c.Mounts[1].Name='production'],['duplicate input',c=>c.Mounts[2].Destination='/run/trial'],
 ['extra socket',c=>c.Mounts.push({Destination:'/var/run/docker.sock',Type:'bind',RW:true})],
])it('refuses local runner drift: '+name,()=>{const c=container();change(c);assert.throws(()=>checkContainer(c,expected));});

for(const mode of ['foreign','matching','already-detached'])it('loop cleanup preserves custody: '+mode,()=>{
 const harness=String.raw`
import errno,fcntl,json,os,struct,subprocess,sys,types
from unittest.mock import patch
source=open(sys.argv[1]).read();mode=sys.argv[2];calls=[];state={'active':mode!='already-detached'}
def ioctl(fd,command,*args):
 calls.append(command)
 if command==0x4C05:
  if not state['active']:raise OSError(errno.ENXIO,'not attached')
  return struct.pack('=QQ',3 if mode=='foreign' else 1,4 if mode=='foreign' else 2)+bytes(216)
 assert command==0x4C01;state['active']=False
sys.argv=['local-disk.py','clear','/dev/loop0','8589934592']
with patch('os.open',return_value=11),patch('os.close'),patch('os.stat',return_value=types.SimpleNamespace(st_dev=1,st_ino=2)),patch('os.path.exists',return_value=mode!='already-detached'),patch('os.unlink') as unlink,patch('fcntl.ioctl',side_effect=ioctl):
 refused=False
 try:exec(compile(source,'local-disk.py','exec'),{'__name__':'__main__'})
 except AssertionError:refused=True
 if mode=='foreign':assert refused and 0x4C01 not in calls and not unlink.called and state['active']
 else:
  assert not refused and not state['active']
  assert calls.count(0x4C01)==(1 if mode=='matching' else 0)
  assert unlink.called==(mode=='matching')
print('custody-check-passed')
`;
 const result=spawnSync('python3',['-c',harness,fileURLToPath(new URL('../infrastructure/ci-trial/local-disk.py',import.meta.url)),mode],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('custody-check-passed'));
});
