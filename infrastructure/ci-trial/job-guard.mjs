import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { validateJob } from './policy.mjs';

try {
 const file=process.env.GITHUB_EVENT_PATH;
 if(!file?.startsWith('/r/')) throw Error('Event must be in disposable workspace');
 const stat=lstatSync(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw Error('Invalid event file');
 const intent=JSON.parse(readFileSync('/run/trial/intent.json','utf8'));
 const admitted=validateJob(intent,process.env,JSON.parse(readFileSync(file,'utf8')));
 // One admitted job per scratch volume, even if routing or runner state is reused.
 writeFileSync('/r/control/admitted.json',JSON.stringify(admitted)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(admitted));
} catch { console.error('Test-only runner refused job identity, expiry, event or reuse'); process.exitCode=1; }
