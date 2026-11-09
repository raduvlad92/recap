import assert from 'node:assert/strict';

export const repository = 'raduvlad92/recap';
export const branch = 'ci/hostinger-test-trial-20261109';
export const baseBranch = 'review/full-reader-release-20261108';
export const workflow = '.github/workflows/hostinger-ci-trial.yml';
export const runnerLabel = 'therecap-test-only-20261109';
export const limits = Object.freeze({ seconds: 1800, memory: 4294967296, pids: 512,
 scratch: 8589934592, free: 1073741824, intentMilliseconds: 2700000 });
const keys = ['schema','operationId','repository','workflow','pullRequest','headSha','baseSha','mergeSha',
 'runId','runAttempt','issuedAt','expiresAt','location'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateIntent(intent, now = Date.now()) {
 assert(intent && typeof intent === 'object' && !Array.isArray(intent), 'Intent object required');
 assert.deepEqual(Object.keys(intent).sort(), [...keys].sort(), 'Unexpected intent fields');
 assert.equal(intent.schema, 1);
 assert.match(intent.operationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(intent.repository, repository); assert.equal(intent.workflow, workflow);
 assert(Number.isSafeInteger(intent.pullRequest) && intent.pullRequest > 0, 'Invalid PR');
 for (const key of ['headSha','baseSha','mergeSha']) assert(sha(intent[key]), 'Invalid '+key);
 assert(typeof intent.runId === 'string' && /^[1-9][0-9]{0,18}$/.test(intent.runId), 'Invalid run');
 assert(Number.isSafeInteger(intent.runAttempt) && intent.runAttempt >= 1 && intent.runAttempt <= 100, 'Invalid attempt');
 assert(date(intent.issuedAt) && date(intent.expiresAt), 'Exact UTC dates required');
 assert.equal(Date.parse(intent.expiresAt)-Date.parse(intent.issuedAt), limits.intentMilliseconds);
 assert(Number.isFinite(now) && now >= Date.parse(intent.issuedAt) && now < Date.parse(intent.expiresAt), 'Intent is not current');
 assert(['local-qualification','hostinger'].includes(intent.location), 'Location required');
 return intent;
}

export function validateJob(intent, env, event, now = Date.now()) {
 validateIntent(intent, now);
 const ref = `refs/pull/${intent.pullRequest}/merge`;
 for (const [key,value] of Object.entries({ GITHUB_ACTIONS:'true', GITHUB_REPOSITORY:repository,
  GITHUB_EVENT_NAME:'pull_request', GITHUB_REF:ref, GITHUB_SHA:intent.mergeSha,
  GITHUB_RUN_ID:intent.runId, GITHUB_RUN_ATTEMPT:String(intent.runAttempt),
  GITHUB_HEAD_REF:branch, GITHUB_BASE_REF:baseBranch,
  GITHUB_WORKFLOW_REF:`${repository}/${workflow}@${ref}`, GITHUB_WORKFLOW_SHA:intent.mergeSha })) {
  assert.equal(env[key], value, 'Job identity differs: '+key);
 }
 assert.equal(event.number, intent.pullRequest); assert.equal(event.repository?.full_name, repository);
 const pr = event.pull_request;
 assert.equal(pr?.head?.repo?.full_name, repository); assert.equal(pr?.base?.repo?.full_name, repository);
 assert.equal(pr?.head?.ref, branch); assert.equal(pr?.base?.ref, baseBranch);
 assert.equal(pr?.head?.sha, intent.headSha); assert.equal(pr?.base?.sha, intent.baseSha);
 return { schema:1, kind:'test-only-job-admitted', operationId:intent.operationId,
  runId:intent.runId, runAttempt:intent.runAttempt, mergeSha:intent.mergeSha, location:intent.location };
}

export function assertNoProductionEnvironment(env) {
 const allowed=new Set(['PATH','HOSTNAME','NODE_VERSION','YARN_VERSION','HOME','TMPDIR','NODE_OPTIONS',
  'DEBIAN_FRONTEND','LANG','LC_ALL','TZ','TERM','SHLVL','PWD','_']);
 const forbidden = /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|^PGHOST$|^PGPORT$|^PGUSER$|^PGDATABASE$)/i;
 for (const key of Object.keys(env)) assert(!forbidden.test(key), 'Credential/connection environment is forbidden: '+key);
 for (const key of ['GITHUB_ACTIONS','GITHUB_SHA','GITHUB_REF','GITHUB_RUN_ID','ACTIONS_RUNTIME_TOKEN'])
  assert(!(key in env), 'Do not manufacture GitHub job context');
 for(const key of Object.keys(env))assert(allowed.has(key),'Unreviewed launcher environment: '+key);
}

export function validateCgroup({ memory, swap, pids, cpu, status, rootReadOnly, dockerSocket }) {
 for (const [value,cap] of [[memory,limits.memory],[pids,limits.pids]])
  assert(/^[1-9][0-9]*$/.test(value.trim()) && BigInt(value.trim()) <= BigInt(cap), 'Missing or excessive cgroup bound');
 assert.equal(swap.trim(),'0','Swap must be disabled');
 const match = /^([1-9][0-9]*) ([1-9][0-9]*)$/.exec(cpu.trim());
 assert(match && BigInt(match[1]) <= BigInt(match[2]), 'CPU must be limited to one core');
 assert(/^CapEff:\s+0+$/m.test(status), 'Capabilities must be dropped');
 assert(/^NoNewPrivs:\s+1$/m.test(status), 'no-new-privileges required');
 assert(rootReadOnly && !dockerSocket, 'Read-only root and no Docker socket required');
}

export function validateRegistration(registration,intent) {
 assert.deepEqual(Object.keys(registration).sort(),['id','name','operationId']);
 assert(Number.isSafeInteger(registration.id) && registration.id>0,'Invalid runner ID');
 assert.equal(registration.operationId,intent.operationId);
 assert.equal(registration.name,'therecap-trial-'+intent.operationId,'Runner belongs to another operation');
 return registration;
}

export function assertVitestReport(report) {
 assert.equal(report.success,true); assert(report.numPassedTests >= 4321, 'Incomplete reader suite');
 assert(report.numPassedTestSuites >= 146, 'Incomplete reader files');
 for(const field of ['numFailedTests','numPendingTests','numTodoTests','numFailedTestSuites','numPendingTestSuites'])
  assert.equal(report[field] ?? 0,0,'Failed/skipped tests: '+field);
 assert(Array.isArray(report.testResults) && report.testResults.length >= 146);
 let count=0;
 for(const file of report.testResults){
  assert.equal(file.status,'passed');
  assert(Array.isArray(file.assertionResults) && file.assertionResults.length>0);
  for(const result of file.assertionResults){assert.equal(result.status,'passed','A test was skipped or failed');count++;}
 }
 assert.equal(count,report.numPassedTests); assert.equal(report.numTotalTests,count);
}

export function assertTapReport(tap) {
 for(const key of ['fail','cancelled','skipped','todo']) assert(new RegExp('^# '+key+' 0$','m').test(tap),'Nonzero/missing TAP '+key);
 const counts = [...tap.matchAll(/^# tests ([0-9]+)$/gm)];
 assert.equal(counts.length,1); assert(Number(counts[0][1]) >= 102,'Incomplete guarded suite');
 assert(new RegExp('^# pass '+counts[0][1]+'$','m').test(tap),'TAP pass count differs');
}
