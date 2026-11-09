import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertTapReport, assertVitestReport } from '../../infrastructure/ci-trial/policy.mjs';

assert.equal(process.versions.node.split('.')[0],'22');
assert(process.getuid?.() > 0,'Nonroot runner required');
for(const key of ['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','CLERK_SECRET_KEY','APIFY_API_TOKEN','OPENROUTER_API_KEY','CLOUDFLARE_API_TOKEN','DATABASE_URL','PGPASSWORD'])
 assert(!process.env[key],'Production/connection credential forbidden');
assert(!readdirSync('.').some(name=>name.startsWith('.env')&&name!=='.env.example') && !existsSync('/var/run/docker.sock'));
assert.equal(process.env.READER_TEST_PG_BIN,'/usr/lib/postgresql/17/bin');
for(const bin of ['initdb','pg_ctl','psql'])assert.match(execFileSync(bin,['--version'],{encoding:'utf8'}),/\b17\./);
assert(existsSync('/usr/share/postgresql/17/extension/pgcrypto.control'));
if(process.argv[2]==='preflight'){
 console.log(JSON.stringify({node:process.versions.node,postgres:17,uid:process.getuid(),dockerSocket:false,productionCredentials:false}));
}else{
 assert.equal(process.argv[2],'verify'); assert.equal(process.env.HOSTING_BUILD_MODE,'shadow');
 const dir='.local/ci-trial';mkdirSync(dir,{recursive:true});
 const run=(command,args)=>execFileSync(command,args,{stdio:'inherit',timeout:1200000});
 run('npm',['run','catalogue:check']);
 run('node',['node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--testTimeout=30000','--reporter=json','--outputFile='+dir+'/vitest.json']);
 assertVitestReport(JSON.parse(readFileSync(dir+'/vitest.json','utf8')));
 const tap=execFileSync('node',['--test','tests/ci-trial.node.mjs','tests/ci-trial-operator.node.mjs','tests/reader-migration-plan.node.mjs'],{encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024});
 writeFileSync(dir+'/node-tests.tap',tap);assertTapReport(tap);console.log(tap.slice(-500));
 run('npm',['run','build']);run('npm',['run','check:cloudflare']);
 console.log(JSON.stringify({testOnly:true,skippedTests:0,productionReleaseAccepted:false,nativeGitHubReadbackRequired:true}));
}
