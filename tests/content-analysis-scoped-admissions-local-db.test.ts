import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANALYSIS_V3_CONTRACT_HASH } from '../netlify/functions/_shared/content-analysis-grounded-v3-protocol';

// Real PostgreSQL, synthetic DATABASE-ONLY fixtures. Private Unix socket with
// TCP disabled. Never reads environment credentials or Supabase project config.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
const q = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const jsonSql = (value: unknown) => q(JSON.stringify(value)) + '::jsonb';
const model = 'openai/gpt-6-luna-pro', requestHash = 'a'.repeat(64);
const identity = {
 adapterVersion: 'content-analysis-model-v2', route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
 provider: 'openai', model, reasoningEffort: 'none', pricing: {
  version: 'openrouter-2026-10-24-v2:openai/gpt-6-luna-pro:openai', inputUsdPerMillion: .1, outputUsdPerMillion: .5,
  cachedInputUsdPerMillion: .01, cacheWriteApplies: true, cacheWriteUsdPerMillion: .125,
 },
};
class Session {
 private child: ChildProcessWithoutNullStreams;
 private output = ''; private errors = ''; private sequence = 0;
 private pending?: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
 constructor(args: string[]) {
  this.child = spawn('psql', args, { stdio: 'pipe' });
  this.child.stdout.on('data', chunk => {
   this.output += String(chunk);
   if (this.pending && this.output.includes(this.pending.marker + '\n')) {
    const p = this.pending, end = this.output.indexOf(p.marker + '\n'); this.pending = undefined;
    const value = this.output.slice(0, end).trim(); this.output = this.output.slice(end + p.marker.length + 1);
    clearTimeout(p.timer); p.resolve(value);
   }
  });
  this.child.stderr.on('data', chunk => { this.errors += String(chunk); });
  const fail = (error: Error) => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; } };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error(`Local psql exited ${code}: ${this.errors}`)));
 }
 run(sql: string): Promise<string> {
  if (this.pending) throw new Error('One outstanding local command per session');
  return new Promise((resolve, reject) => {
   const marker = `protocol_command_${++this.sequence}_done`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local SQL timeout: ' + this.errors)); }, 8000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); this.child.kill('SIGTERM'); }
}


describe.skipIf(!available)('Purpose-bound finalization and v4 admissions, disposable PostgreSQL 17', () => {
 let root: string, args: string[], started=false, beforeMigration:string, afterMigration:string, beforeAdmission:string, afterAdmission:string;
 const owner='generation-v3-owner';
 const sql=(query:string)=>execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(query:string)=>sql('set role service_role;'+query);
 const json=(query:string):any=>{const v=service(query);return v==='t'?true:v==='f'?false:JSON.parse(v||'null');};
 const seed=()=>sql(readFileSync(new URL('./content-analysis-model-comparison-fixture.sql',import.meta.url),'utf8'));
 const snapshot=(after=false)=>`select jsonb_build_object(
 'budget',(select to_jsonb(b) from public.content_analysis_budget b),
 'policies',(select jsonb_agg(to_jsonb(p) order by user_id) from public.reader_content_analysis_policies p),
 'workspace',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
 'archives',(select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a),
 'jobs',(select jsonb_agg(${after?"to_jsonb(j)-'generation_comparison_id'":"to_jsonb(j)"} order by id) from public.reader_content_analysis_jobs j where ${after?'generation_comparison_id is null':'true'}),
 'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),
 'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a),
 'scopes',(select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s),
 'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
 'settings',(select to_jsonb(s) from public.content_analysis_runtime_settings s),
 'audit',(select jsonb_agg(to_jsonb(e) order by id) from public.admin_audit_events e));`;
 beforeAll(()=>{
  expect(execFileSync('initdb',['--version'],{encoding:'utf8'})).toMatch(/PostgreSQL\) 17\./);
  root=mkdtempSync('/tmp/rcad-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55498`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55498','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   const own=name.endsWith('_content_analysis_model_comparison.sql');if(own){seed();beforeMigration=service(snapshot());}
   const admissionMigration=name.endsWith('_content_analysis_scoped_admissions.sql');if(admissionMigration)beforeAdmission=service(snapshot(true));
   sql(readFileSync(new URL(name,directory),'utf8'));
   if(admissionMigration)afterAdmission=service(snapshot(true).replace("to_jsonb(j)-'generation_comparison_id'","to_jsonb(j)-array['generation_comparison_id','generation_admission_id']"));
   if(own){afterMigration=service(snapshot(true));sql(readFileSync(new URL('./content-analysis-model-comparison-db.sql',import.meta.url),'utf8'));}
  }
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;
   truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   truncate public.content_analysis_admissions cascade;truncate public.content_analysis_model_comparisons cascade;truncate public.content_analysis_provider_cooldowns;truncate public.admin_audit_events;`);
  seed();
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});

 function comparisonInput(selected?:string[]){
  const slots=json(`select jsonb_agg(jsonb_build_object(
   'predecessorJobId',j.id,'successorJobId',gen_random_uuid(),'rootJobId',j.generation_predecessor_job_id,
   'originalSlotDigest',public.content_analysis_generation_v3_digest(public.content_analysis_generation_v3_slot(j.id)),
   'updateId',j.update_id,'sourceId',j.source_id,'task',j.task,'contentHash',j.content_hash,'sourceRevision',j.source_revision,'sourceFingerprint',j.source_fingerprint,
   'predecessorJobHash',public.content_analysis_model_comparison_job_digest(to_jsonb(j)),
   'predecessorLedgerHash',public.content_analysis_generation_v3_ledger_hash(j.id),
   'rootJobHash',public.content_analysis_model_comparison_job_digest(to_jsonb(r)),'rootLedgerHash',public.content_analysis_generation_v3_ledger_hash(r.id),
   'currentAnnotationHash',public.content_analysis_model_comparison_annotation_hash(a.record,j.task),
   'adminReviewHash',public.content_analysis_model_comparison_review_hash(j.user_id,j.update_id),
   'emptyDisposition',public.content_analysis_generation_v3_slot(j.id)->'emptyDisposition',
   'sourceReviewDigest',public.content_analysis_generation_v3_slot(j.id)->'sourceReviewDigest') order by j.update_id,j.task)
   from public.reader_content_analysis_jobs j join public.reader_content_analysis_jobs r on r.id=j.generation_predecessor_job_id
   join public.reader_source_updates a on a.user_id=j.user_id and a.id=j.update_id
   where j.user_id=${q(owner)} and j.rule_version='content-v3' and j.generation_comparison_id is null
    ${selected?`and j.id=any(array[${selected.map(q).join(',')}]::uuid[])`:''};`);
  const revision=json('select revision from public.content_analysis_runtime_settings where id;');
  return {id:service('select gen_random_uuid();'),key:'synthetic-comparison-one',
   scopeHash:service(`select public.content_analysis_generation_v3_digest(to_jsonb(s)) from public.content_analysis_rollout_scopes s where user_id=${q(owner)};`),
   workspaceRevision:json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`),
   manifest:{protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,purpose:'approved_model_comparison',
    originalManifestDigest:service(`select public.content_analysis_generation_v3_digest(generation_revision_manifest) from public.content_analysis_rollout_scopes where user_id=${q(owner)};`),
    executionIdentity:identity,responseModel:model,responseProviderName:'OpenAI',selectionRevision:revision,baseEpochHash:'e'.repeat(64),
    configEpoch:`openrouter-2026-10-24-v2:${model}:${revision}:${'e'.repeat(64)}`,
    effectiveLimits:{maxSourceChars:1000000,chunkChars:12000,overlapChars:256,maxChunks:800,maxOutputTokens:8192,maxInputTokens:128000,maxCallUsd:.01},
    runtimeDisabled:true,workersDrained:true,
    expectedBudgetHash:service('select public.content_analysis_generation_v3_digest(to_jsonb(b)) from public.content_analysis_budget b;'),
    expectedPolicyHash:service(`select public.content_analysis_generation_v3_digest(to_jsonb(p)) from public.reader_content_analysis_policies p where user_id=${q(owner)};`),
    expectedLedgerHash:service('select public.content_analysis_generation_v3_ledger_hash();'),
    expectedCommittedUsd:json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;'),
    expectedCounts:{sourceUpdates:json('select count(*) from public.reader_source_updates;'),jobs:394,calls:35,unsettledCalls:3},
    budget:{originalCommittedUsd:.018365907,incrementalAllowanceUsd:.25,smokeLifetimeCeilingUsd:.268365907},
    callBound:{baseCalls:16,correctionCalls:13,maximumCalls:29,baseMaximumUsd:.094562875,correctionMaximumUsd:.13,maximumFreshUsd:.224562875},
    reviewDigest:'b'.repeat(64),slots},};
 }
 type Input=ReturnType<typeof comparisonInput>;
 const stageSql=(i:Input)=>`select public.stage_content_analysis_model_comparison(${q(owner)},${q(i.scopeHash)},${q(i.workspaceRevision)},${q(i.id)},${q(i.key)},${jsonSql(i.manifest)});`;
 const stage=(i:Input)=>json(stageSql(i));
 const comparison=(id:string)=>json(`select to_jsonb(c) from public.content_analysis_model_comparisons c where id=${q(id)};`);
 const lifecycleSql=(i:Input,action:string,revision=comparison(i.id).revision)=>`select public.set_content_analysis_model_comparison_state(${q(i.id)},${revision},${q(action)},${q(comparison(i.id).manifest_digest)},${q('c'.repeat(64))});`;
 const lifecycle=(i:Input,action:string,revision?:number)=>json(lifecycleSql(i,action,revision));

 const admissionHash=()=>service('select public.content_analysis_generation_v4_contract_hash();');
 type Claim={job:{id:string;task:'summary'|'keywords';rule_version:string;generation_admission_id:string;generation_predecessor_job_id:string|null;generation_contract_hash:string;update_id:string;content_hash:string};leaseToken:string;generationContext:Record<string,unknown>};
 const record=(id:string)=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`);
 const native=()=>service(`select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j),'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),'workspaces',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),'scopes',(select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s),'comparisons',(select jsonb_agg(to_jsonb(c) order by id) from public.content_analysis_model_comparisons c));`);
 function input(tasks:Array<[string,'summary'|'keywords']>=[['generation-video-2','summary']]){
  service(`update public.reader_content_analysis_policies set per_call_limit_usd=.10 where user_id=${q(owner)};`);
  const slots=tasks.map(([updateId,task])=>json(`select jsonb_build_object('jobId',gen_random_uuid(),'predecessorJobId',j.id,
   'updateId',a.id,'sourceId',a.source_id,'task',${q(task)},'contentHash',encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),
   'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),
   'currentAnnotationHash',public.content_analysis_model_comparison_annotation_hash(a.record,${q(task)}),
   'adminReviewHash',public.content_analysis_model_comparison_review_hash(a.user_id,a.id),'sourceReviewDigest',repeat('b',64),'emptyDisposition','findings_expected',
   'predecessorLedgerHash',case when j.id is null then null else public.content_analysis_generation_v3_ledger_hash(j.id) end)
   from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id
   left join public.reader_content_analysis_jobs j on j.user_id=a.user_id and j.update_id=a.id and j.task=${q(task)} and j.rule_version='content-v3' and j.generation_comparison_id is null and j.generation_admission_id is null
   where a.user_id=${q(owner)} and a.id=${q(updateId)};`));
  const revision=json('select revision from public.content_analysis_runtime_settings where id;');
  return {id:service('select gen_random_uuid();'),key:'synthetic-scoped-admission',workspaceRevision:json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`),
   manifest:{purpose:'content_v4_evaluation',phase:'smoke',runtimeDisabled:true,workersDrained:true,protocolVersion:'content-v4',generationContractHash:admissionHash(),executionIdentity:identity,
    selectionRevision:revision,configEpoch:`openrouter-2026-10-24-v2:${model}:${revision}:${'e'.repeat(64)}`,
    expectedLedgerHash:service('select public.content_analysis_generation_v3_ledger_hash();'),
    expectedCommittedUsd:json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;'),
    overallCommitmentCeilingUsd:.268365907,maximumFreshUsd:.10,maximumCalls:20,perCallMaximumUsd:.10,sourceReviewDigest:'b'.repeat(64),slots},};
 }
 type AdmissionInput=ReturnType<typeof input>;
 const stageAdmissionSql=(i:AdmissionInput)=>`select public.stage_content_analysis_admission(${q(owner)},${q(i.workspaceRevision)},${q(i.id)},${q(i.key)},${jsonSql(i.manifest)});`;
 const stageAdmission=(i:AdmissionInput)=>json(stageAdmissionSql(i));
 const admission=(id:string)=>json(`select to_jsonb(d) from public.content_analysis_admissions d where id=${q(id)};`);
 const transitionSql=(i:AdmissionInput,action:string,revision=admission(i.id).revision)=>`select public.set_content_analysis_admission_state(${q(i.id)},${revision},${q(action)},${q(admission(i.id).manifest_digest)},${q('c'.repeat(64))});`;
 const transition=(i:AdmissionInput,action:string,revision?:number)=>json(transitionSql(i,action,revision));
 const activate=()=>service(`update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`);
 const off=()=>service('update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;');
 const claimSql=()=>`select public.claim_content_analysis_job_v2(${q(owner)},900);`;
 const claim=():Claim|null=>json(claimSql());
 function staged(tasks?:Array<[string,'summary'|'keywords']>){const i=input(tasks);stageAdmission(i);transition(i,'release');activate();return i;}
 const keyFor=(c:Claim)=>c.job.rule_version==='content-v3'?'summary:v3:verify:0':c.job.task==='summary'?'summary:v4:chunk:0':'extractor:v4:chunk:0';
 const reserveSql=(c:Claim,key=keyFor(c),maximum=.001,hash=requestHash)=>`select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(model)},${jsonSql(identity)},${q(hash)});`;
 const reserve=(c:Claim,key?:string,maximum?:number,hash?:string)=>json(reserveSql(c,key,maximum,hash));
 const verdicts=(c:Claim)=>[{id:'s0',supported:true,...(c.job.rule_version==='content-v4'?{sameFinding:true}:{}),reason:'Supported synthetic claim.'}];
 const save=(c:Claim,id:string,actual:number|null=.0001)=>json(`select public.record_content_analysis_call_result(${q(id)},${q(c.leaseToken)},${jsonSql({value:c.job.task==='summary'?{readComplete:true,verdicts:verdicts(c)}:{synthetic:true},requestHash})},'{}',null,${actual??'null'},${actual??'null'});`);
 function output(c:Claim){const r=record(c.job.update_id),h=c.job.content_hash;
  return c.job.task==='summary'?{state:'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:h,timingBasis:'none'},videoHighlights:[{text:'Nvidia makes the RTX 5090.'}]},
   evidence:{protocolVersion:c.job.rule_version,generationContractHash:c.job.generation_contract_hash,contentHash:h,sourceContentState:'partial',coverage:[{start:0,end:r.content.length}],verification:verdicts(c),selected:[{text:'Nvidia makes the RTX 5090.',evidenceQuote:'Nvidia makes RTX 5090.'}]}}:
   {state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{protocolVersion:c.job.rule_version,generationContractHash:c.job.generation_contract_hash,contentHash:h,ruleVersion:'entities-v2',coverage:[{start:0,end:r.content.length}],accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};
 }
 const prepareSql=(c:Claim,result=output(c))=>`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${jsonSql(result)});`;
 function publish(c:Claim){service(prepareSql(c));return json(`select public.publish_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)});`);}
 function finalizer(){
  const old=comparisonInput();stage(old);lifecycle(old,'close');
  const prior=service(`select id from public.reader_content_analysis_jobs where generation_comparison_id=${q(old.id)} and task='summary' and update_id='generation-video-3';`);
  // Exact synthetic settled prefix; only this disposable fixture disables call fencing.
  sql(`alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;
   insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state,result,request_hash,execution_identity)
   select id,user_id,'summary:v3:chunk:0',gen_random_uuid(),${q(model)},source_revision,.001,.0001,.0001,'settled',${jsonSql({value:{syntheticPrefix:true},requestHash})},${q(requestHash)},${jsonSql(identity)} from public.reader_content_analysis_jobs where id=${q(prior)};
   alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;
   update public.reader_content_analysis_jobs set state='failed',error_code='analysis_source_changed' where generation_comparison_id=${q(old.id)};`);
  const i=input([['generation-video-3','summary']]);
  i.manifest.purpose='summary_finalization';i.manifest.protocolVersion='content-v3';i.manifest.generationContractHash=ANALYSIS_V3_CONTRACT_HASH;i.manifest.maximumCalls=1;
  i.manifest.slots[0].predecessorJobId=prior;i.manifest.slots[0].predecessorLedgerHash=service(`select public.content_analysis_generation_v3_ledger_hash(${q(prior)});`);
  i.manifest.slots[0].prefixCalls=json(`select jsonb_agg(jsonb_build_object('callId',c.id,'callKey',c.call_key,'requestHash',c.request_hash,'callHash',public.content_analysis_generation_v3_digest(to_jsonb(c)))) from public.reader_content_analysis_calls c where c.job_id=${q(prior)};`);
  i.manifest.slots[0].allowedFreshRequest={key:'summary:v3:verify:0',requestHash};
  return {i,old,prior};
 }

 it('loads the additive schema without activating or creating work',()=>{
  expect(afterAdmission).toBe(beforeAdmission);
  expect(service('select count(*) from public.content_analysis_admissions;')).toBe('0');
  expect(service('select enabled from public.content_analysis_budget where id;')).toBe('f');
  expect(admissionHash()).toMatch(/^[a-f0-9]{64}$/);
 });
 it('stages only explicit jobs preserving all prior records, calls, scope and off gates',()=>{
  const i=input(),before=native();stageAdmission(i);const after=JSON.parse(native());
  const old=JSON.parse(before);after.jobs=after.jobs.filter((j:any)=>j.generation_admission_id!==i.id);expect(after).toEqual(old);
  expect(admission(i.id).state).toBe('staged');expect(claim()).toBeNull();
 });
 it('claims and publishes a v4 task while keeping the original v3 scope paused',()=>{
  staged();const c=claim()!;expect(c.job.rule_version).toBe('content-v4');expect(c.generationContext.admissionId).toBe(c.job.generation_admission_id);
  expect(service(`select phase from public.content_analysis_rollout_scopes where user_id=${q(owner)};`)).toBe('paused');
  const r=reserve(c,'summary:v4:verify:0');save(c,r.call.id);expect(publish(c)).toBe(true);expect(record(c.job.update_id).videoSummary.status).toBe('ready');
 });
 it('allows a conservative request above the old cent ceiling and rejects above ten cents',()=>{
  staged();const c=claim()!;expect(reserve(c,undefined,.05).claimed).toBe(true);
  expect(()=>reserve(c,'summary:v4:chunk:1',.100000000001)).toThrow();
 });
 it.each(['contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','sourceReviewDigest'])('rejects missing/drifted %s before staging',field=>{
  const i=input();i.manifest.slots[0][field]=field==='sourceReviewDigest'?'invalid':'a'.repeat(64);expect(()=>stageAdmission(i)).toThrow();expect(service('select count(*) from public.content_analysis_admissions;')).toBe('0');
 });
 it.each(['maximumFreshUsd','overallCommitmentCeilingUsd','perCallMaximumUsd'])('rejects invalid financial %s',field=>{const i=input();(i.manifest as any)[field]=-1;expect(()=>stageAdmission(i)).toThrow();});
 it.each(['purpose','phase','runtimeDisabled','workersDrained','protocolVersion','generationContractHash','sourceReviewDigest','configEpoch','maximumFreshUsd','maximumCalls','overallCommitmentCeilingUsd','perCallMaximumUsd'])('rejects explicit JSON null admission %s',field=>{const i=input();(i.manifest as any)[field]=null;i.manifest.overallCommitmentCeilingUsd=field==='overallCommitmentCeilingUsd'?null as any:5;expect(()=>stageAdmission(i)).toThrow();});
 it('rejects stale ledger, settings revision and enabled staging',()=>{
  const i=input();i.manifest.expectedLedgerHash='f'.repeat(64);expect(()=>stageAdmission(i)).toThrow();
  const j=input();j.manifest.selectionRevision++;expect(()=>stageAdmission(j)).toThrow();
  activate();expect(()=>stageAdmission(input())).toThrow();
 });
 it('protects a matching existing editorial summary despite blocked processing override',()=>{
  service(`update public.reader_source_updates set record=jsonb_set(record,'{processing,recap}','"blocked"') where user_id=${q(owner)} and id='generation-video-4';`);
  const i=input([['generation-video-4','summary']]);expect(()=>stageAdmission(i)).toThrow();
 });
 it('blocks unknown source/task holds and never releases historical unknown money',()=>{
  const i=input();const prior=i.manifest.slots[0].predecessorJobId;
  sql(`alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state) select id,user_id,'synthetic-unknown',gen_random_uuid(),${q(model)},source_revision,.001,'unknown' from public.reader_content_analysis_jobs where id=${q(prior)};alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;`);
  expect(()=>stageAdmission(input())).toThrow();expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('4');
 });
 it('denies direct service insertion and anonymous or ordinary-reader admission access',()=>{
  const i=input();stageAdmission(i);const d=admission(i.id);expect(()=>service(`update public.content_analysis_admissions set state='released' where id=${q(i.id)};`)).toThrow();
  for(const role of ['anon','authenticated']){expect(()=>sql(`set role ${role};select * from public.content_analysis_admissions;`)).toThrow();expect(()=>sql(`set role ${role};${transitionSql(i,'release')}`)).toThrow();}
  expect(()=>service(`insert into public.reader_content_analysis_jobs select (jsonb_populate_record(null::public.reader_content_analysis_jobs,${jsonSql({...json(`select to_jsonb(j) from public.reader_content_analysis_jobs j where generation_admission_id=${q(i.id)};`),id:service('select gen_random_uuid();')})})).*;`)).toThrow();
  expect(d.state).toBe('staged');
 });
 it('fences source changes and erases admission evidence after source deletion',()=>{
  const i=staged(),c=claim()!;
  service(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"Changed saved original."') where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  expect(()=>reserve(c)).toThrow();expect(()=>service(prepareSql(c))).toThrow();off();
  service(`delete from public.reader_source_updates where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  expect(admission(i.id).manifest).toBeNull();expect(admission(i.id).state).toBe('closed');expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('3');
 });
 it('enforces aggregate money and call bounds even for direct ledger writes',()=>{
  const i=input();i.manifest.maximumFreshUsd=.001;i.manifest.maximumCalls=1;stageAdmission(i);transition(i,'release');activate();const c=claim()!;
  const first=reserve(c);save(c,first.call.id,0);expect(()=>reserve(c,'summary:v4:chunk:1')).toThrow();
  expect(()=>service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,execution_identity,request_hash) select id,user_id,'summary:v4:chunk:2',lease_token,${q(model)},source_revision,.001,${jsonSql(identity)},${q(requestHash)} from public.reader_content_analysis_jobs where id=${q(c.job.id)};`)).toThrow();
 });
 it('requires a prior accepted six-task v4 smoke and hosted review for evaluation expansion',()=>{
  const i=input();i.manifest.phase='evaluation';i.manifest.overallCommitmentCeilingUsd=5;expect(()=>stageAdmission(i)).toThrow();
 });
 it('keeps terminal v4 failures immutable and cannot reset them using another admission',()=>{
  const i=staged(),c=claim()!;service(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_invalid_output',false,false);`);off();
  expect(()=>service(`update public.reader_content_analysis_jobs set state='queued' where id=${q(c.job.id)};`)).toThrow();
  const other=input();other.id=service('select gen_random_uuid();');other.manifest.slots[0].predecessorJobId=c.job.id;other.manifest.slots[0].predecessorLedgerHash=service(`select public.content_analysis_generation_v3_ledger_hash(${q(c.job.id)});`);expect(()=>stageAdmission(other)).toThrow();
 });
 it('reuses only the sealed H3 paid prefix and purchases at most the single final verifier',()=>{
  const {i,old,prior}=finalizer(),before=service(`select public.content_analysis_generation_v3_ledger_hash(${q(prior)});`);stageAdmission(i);transition(i,'release');activate();const c=claim()!;
  expect(c.job.rule_version).toBe('content-v3');expect(c.generationContext.purpose).toBe('summary_finalization');
  const page=json(`select public.read_content_analysis_cached_calls_v2(${q(c.job.id)},${q(c.leaseToken)},array['summary:v3:chunk:0','summary:v3:verify:0'],null,${q(model)});`);
  expect(page.calls).toHaveLength(1);expect(page.calls[0].id).toBe(i.manifest.slots[0].prefixCalls[0].callId);
  expect(()=>reserve(c,'summary:v3:chunk:0')).toThrow();expect(()=>reserve(c,'summary:v3:verify:0',.001,'f'.repeat(64))).toThrow();
  const r=reserve(c);save(c,r.call.id);expect(publish(c)).toBe(true);expect(service(`select public.content_analysis_generation_v3_ledger_hash(${q(prior)});`)).toBe(before);
  expect(comparison(old.id).state).toBe('closed');off();transition(i,'close');expect(()=>transition(i,'release')).toThrow();
 });
 it('cannot stage a mismatched settled prefix hash',()=>{
  const {i}=finalizer();i.manifest.slots[0].prefixCalls[0].callHash='f'.repeat(64);expect(()=>stageAdmission(i)).toThrow();
 });
 it('never corrects a finalizer verdict and cannot prepare without final settlement',()=>{
  const {i}=finalizer();stageAdmission(i);transition(i,'release');activate();const c=claim()!;
  expect(()=>service(prepareSql(c))).toThrow();expect(()=>reserve(c,'summary:v3:verify:0:repair:1')).toThrow();
  const r=reserve(c);save(c,r.call.id,null);expect(()=>service(prepareSql(c))).toThrow();
  expect(service(`select count(*) from public.reader_content_analysis_calls where job_id=${q(c.job.id)};`)).toBe('1');
 });
 it('serializes two concurrent claims so one admission job has one live lease',async()=>{
  staged();const a=new Session(args),b=new Session(args);try{
   const values=await Promise.all([a.run('set role service_role;'+claimSql()),b.run('set role service_role;'+claimSql())]);
   expect(values.filter(v=>v&&v!=='null')).toHaveLength(1);
  }finally{a.close();b.close();}
 });
 const fresh=(id:string)=>service(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
  select user_id,${q(id)},source_id,collection_id,published_at,jsonb_set(record,'{id}',to_jsonb(${q(id)}::text)) from public.reader_source_updates where user_id=${q(owner)} and id='generation-video-2';`);
 it('admits first analysis without fabricating a v3 predecessor',()=>{
  fresh('fresh-admission-1');const i=staged([['fresh-admission-1','summary']]);const c=claim()!;expect(c.job.generation_predecessor_job_id).toBeNull();expect(c.job.generation_admission_id).toBe(i.id);
 });
 it('protects valid matching keyword output even when raw processing says blocked',()=>{
  service(`update public.reader_source_updates set record=record||jsonb_build_object('keywordContentHash',encode(sha256(convert_to(record->>'content','UTF8')),'hex'),'keywordRuleVersion','entities-v2','videoKeywords','[{"label":"Nvidia","ranges":[]}]'::jsonb,'processing',jsonb_build_object('keywords','blocked')) where user_id=${q(owner)} and id='generation-video-4';`);
  expect(()=>stageAdmission(input([['generation-video-4','keywords']]))).toThrow();
 });
 it('accepts exactly six independently published smoke tasks before same-profile expansion',()=>{
  for(const id of ['fresh-smoke-1','fresh-smoke-2','fresh-smoke-3'])fresh(id);
  const i=staged(['fresh-smoke-1','fresh-smoke-2','fresh-smoke-3'].flatMap(id=>[[id,'summary'],[id,'keywords']] as Array<[string,'summary'|'keywords']>));
  for(let n=0;n<6;n++){const c=claim()!;expect(c).not.toBeNull();const r=reserve(c,c.job.task==='summary'?'summary:v4:verify:0':undefined);save(c,r.call.id);expect(publish(c)).toBe(true);}
  off();expect(transition(i,'accept').acceptance_digest).toBe('c'.repeat(64));expect(admission(i.id).state).toBe('closed');
  fresh('fresh-evaluation-1');const next=input([['fresh-evaluation-1','summary']]);next.manifest.phase='evaluation';next.manifest.overallCommitmentCeilingUsd=5;
  (next.manifest as any).acceptedSmokeAdmissionId=i.id;(next.manifest as any).hostedPublicationReviewDigest='d'.repeat(64);
  expect(stageAdmission(next).staged).toBe(true);expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('3');
 });
 it('does not treat two published tasks as the six-task quality gate',()=>{
  const i=staged([['generation-video-2','summary'],['generation-video-2','keywords']]);
  for(let n=0;n<2;n++){const c=claim()!;const r=reserve(c,c.job.task==='summary'?'summary:v4:verify:0':undefined);save(c,r.call.id);publish(c);}
  off();expect(()=>transition(i,'accept')).toThrow();
 });
 it('does not invalidate an in-flight summary when its sibling creates unchanged private pending rows',()=>{
  const i=input([['generation-video-2','summary'],['generation-video-2','keywords']]);
  i.manifest.slots.find((x:any)=>x.task==='keywords').jobId='00000000-0000-4000-8000-000000000001';
  i.manifest.slots.find((x:any)=>x.task==='summary').jobId='00000000-0000-4000-8000-000000000002';
  stageAdmission(i);transition(i,'release');activate();
  const claims=[claim()!,claim()!];const keyword=claims.find(c=>c.job.task==='keywords')!,summary=claims.find(c=>c.job.task==='summary')!;
  const kr=reserve(keyword);save(keyword,kr.call.id);const result=output(keyword);result.state='review';
  result.pending=[{label:'RTX 5090',kind:'product',confidence:40,reason:'Uncertain synthetic identity.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}] as any;
  service(prepareSql(keyword,result));expect(json(`select public.publish_content_analysis_job(${q(keyword.job.id)},${q(keyword.leaseToken)});`)).toBe(true);
  const sr=reserve(summary,'summary:v4:verify:0');save(summary,sr.call.id);expect(publish(summary)).toBe(true);
  expect(json(`select jsonb_agg(label order by label) from public.admin_keyword_reviews where user_id=${q(owner)} and update_id=${q(summary.job.update_id)} and status='pending';`)).toEqual(['Nvidia','RTX 5090']);
 });
 it.each(['source','workspace','job'])('redacts private admission evidence on %s deletion and retains monetary holds',what=>{
  const i=staged(),c=claim()!;const r=reserve(c);expect(r.claimed).toBe(true);
  if(what==='workspace')service(`delete from public.reader_workspaces where user_id=${q(owner)};`);
  else if(what==='source')service(`delete from public.reader_source_updates where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  else service(`delete from public.reader_content_analysis_jobs where id=${q(c.job.id)};`);
  expect(admission(i.id).manifest).toBeNull();expect(admission(i.id).user_id).toBeNull();expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('4');
 });
 it('serializes simultaneous same-key reservations into one monetary attempt',async()=>{
  staged();const c=claim()!,a=new Session(args),b=new Session(args);try{
   const values=await Promise.all([a.run('set role service_role;'+reserveSql(c)),b.run('set role service_role;'+reserveSql(c))]);
   expect(values.map(v=>JSON.parse(v)).filter(v=>v.claimed)).toHaveLength(1);expect(service(`select count(*) from public.reader_content_analysis_calls where job_id=${q(c.job.id)};`)).toBe('1');
  }finally{a.close();b.close();}
 });
 it('preserves terminal v4 history when source text changes after accepted publication',()=>{
  staged();const c=claim()!,r=reserve(c,'summary:v4:verify:0');save(c,r.call.id);publish(c);
  const before=service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(c.job.id)};`);
  service(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"A changed saved original."') where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  expect(service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(c.job.id)};`)).toBe(before);
 });
 it.each([false,null,'malformed'])('rejects a settled terminal verdict with unsupported=%s',supported=>{
  const {i}=finalizer();stageAdmission(i);transition(i,'release');activate();const c=claim()!,r=reserve(c);
  const value=supported==='malformed'?{rawOutput:'two complete JSON envelopes'}:{readComplete:true,verdicts:[{id:'s0',supported,reason:'Synthetic terminal rejection.'}]};
  service(`select public.record_content_analysis_call_result(${q(r.call.id)},${q(c.leaseToken)},${jsonSql({value,requestHash})},'{}',null,.0001,.0001);`);
  expect(()=>service(prepareSql(c))).toThrow();expect(()=>service(`select public.mark_content_analysis_call_invalid(${q(c.job.id)},${q(c.leaseToken)},'summary:v3:verify:0',${q(requestHash)},'analysis_invalid_json');`)).toThrow();
 });
 it('resumes a due daily-budget pause with a new lease and no duplicate paid response',()=>{
  staged();const c=claim()!;service(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_daily_budget_exhausted',false,false);`);
  expect(claim()).toBeNull();service(`update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${q(c.job.id)};`);
  const resumed=claim()!;expect(resumed.job.id).toBe(c.job.id);expect(resumed.leaseToken).not.toBe(c.leaseToken);expect(service(`select count(*) from public.reader_content_analysis_calls where job_id=${q(c.job.id)};`)).toBe('0');
 });
 it('safely closes the exact running lease after gates are disabled without granting further work',()=>{
  staged();const c=claim()!;off();expect(()=>reserve(c)).toThrow();
  expect(json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_state_conflict',false,false);`).state).toBe('blocked');
  expect(service(`select state from public.reader_content_analysis_jobs where id=${q(c.job.id)};`)).toBe('blocked');expect(claim()).toBeNull();
 });
 it('safely stops a lease after a real private admin decision changes its sealed review snapshot',()=>{
  staged();const c=claim()!;service(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url) values(${q(owner)},${q(c.job.update_id)},'fixture-source',${q(c.job.content_hash)},'RTX 5090','product',40,'Synthetic admin review.','Nvidia makes RTX 5090.','[]','Synthetic','https://example.org/');`);
  expect(()=>reserve(c)).toThrow();expect(json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_state_conflict',false,false);`).state).toBe('blocked');
 });

 it('retains a late settled response after permission-revocation cleanup without publishing it',()=>{
  staged();const c=claim()!,r=reserve(c,'summary:v4:verify:0');off();
  service(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_state_conflict',false,false);`);
  expect(save(c,r.call.id,.0002).state).toBe('settled');expect(()=>service(prepareSql(c))).toThrow();
  expect(service(`select state from public.reader_content_analysis_jobs where id=${q(c.job.id)};`)).toBe('blocked');
 });
 it('does not let a stale lease perform failure-only cleanup after a new claim',()=>{
  staged();const old=claim()!;service(`select public.fail_content_analysis_job(${q(old.job.id)},${q(old.leaseToken)},'analysis_worker_yield',false,true);`);
  service(`update public.reader_content_analysis_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${q(old.job.id)};`);
  const current=claim()!;off();expect(()=>service(`select public.fail_content_analysis_job(${q(old.job.id)},${q(old.leaseToken)},'analysis_state_conflict',false,false);`)).toThrow();
  expect(service(`select lease_token from public.reader_content_analysis_jobs where id=${q(current.job.id)};`)).toBe(current.leaseToken);
 });

 it('rejects a missing prefix and never renews a closed finalization by changing ids',()=>{
  const {i}=finalizer();const empty=structuredClone(i);empty.manifest.slots[0].prefixCalls=[];expect(()=>stageAdmission(empty)).toThrow();
  stageAdmission(i);transition(i,'close');const again=structuredClone(i);again.id=service('select gen_random_uuid();');again.key='attempted-new-finalizer-id';again.manifest.slots[0].jobId=service('select gen_random_uuid();');
  expect(()=>stageAdmission(again)).toThrow();expect(service('select count(*) from public.content_analysis_admissions;')).toBe('1');
 });

 it('denies ledger deletion, job detachment and hold reduction by the service role',()=>{
  staged();const c=claim()!,r=reserve(c);
  expect(()=>service(`delete from public.reader_content_analysis_calls where id=${q(r.call.id)};`)).toThrow();
  expect(()=>service(`update public.reader_content_analysis_calls set job_id=null where id=${q(r.call.id)};`)).toThrow();
  expect(()=>service(`update public.reader_content_analysis_calls set maximum_usd=.00001 where id=${q(r.call.id)};`)).toThrow();
  expect(()=>service(`update public.reader_content_analysis_calls set source_revision=${q('f'.repeat(64))} where id=${q(r.call.id)};`)).toThrow();
  expect(service(`select maximum_usd from public.reader_content_analysis_calls where id=${q(r.call.id)};`)).toBe('0.001000000000');
 });

});
