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


describe.skipIf(!available)('ONE sealed same-H3 comparison, disposable PostgreSQL 17', () => {
 let root: string, args: string[], started=false, beforeMigration:string, afterMigration:string;
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
  root=mkdtempSync(join(tmpdir(),'recap-model-comparison-db-'));mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55497`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55497','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   const own=name.endsWith('_content_analysis_model_comparison.sql');if(own){seed();beforeMigration=service(snapshot());}
   sql(readFileSync(new URL(name,directory),'utf8'));
   if(own){afterMigration=service(snapshot(true));sql(readFileSync(new URL('./content-analysis-model-comparison-db.sql',import.meta.url),'utf8'));}
  }
 },25000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;
   truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   truncate public.content_analysis_model_comparisons cascade;truncate public.content_analysis_provider_cooldowns;truncate public.admin_audit_events;`);
  seed();
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 type Claim={job:{id:string;task:'summary'|'keywords';generation_comparison_id:string;generation_predecessor_job_id:string;generation_contract_hash:string;update_id:string;content_hash:string};leaseToken:string;generationContext:Record<string,unknown>};
 const job=(id:string)=>json(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(id)};`);
 const record=(id:string)=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`);
 function input(selected?:string[]){
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
 type Input=ReturnType<typeof input>;
 const stageSql=(i:Input)=>`select public.stage_content_analysis_model_comparison(${q(owner)},${q(i.scopeHash)},${q(i.workspaceRevision)},${q(i.id)},${q(i.key)},${jsonSql(i.manifest)});`;
 const stage=(i:Input)=>json(stageSql(i));
 const comparison=(id:string)=>json(`select to_jsonb(c) from public.content_analysis_model_comparisons c where id=${q(id)};`);
 const lifecycleSql=(i:Input,action:string,revision=comparison(i.id).revision)=>`select public.set_content_analysis_model_comparison_state(${q(i.id)},${revision},${q(action)},${q(comparison(i.id).manifest_digest)},${q('c'.repeat(64))});`;
 const lifecycle=(i:Input,action:string,revision?:number)=>json(lifecycleSql(i,action,revision));
 const claimSql=()=>`select public.claim_content_analysis_job_v2(${q(owner)},900);`;
 const claim=():Claim|null=>json(claimSql());
 function activate(){service(`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1','generation-video-2','generation-video-3'],'evaluation');
  update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`);}
 function staged(){const i=input();stage(i);lifecycle(i,'release');activate();return i;}
 const reserveSql=(c:Claim,key=c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0',maximum=.001,id:unknown=identity)=>
  `select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(model)},${jsonSql(id)},${q(requestHash)});`;
 const reserve=(c:Claim,key?:string,maximum?:number,id?:unknown)=>json(reserveSql(c,key,maximum,id));
 const save=(c:Claim,id:string,actual:number|null=.0001)=>json(`select public.record_content_analysis_call_result(${q(id)},${q(c.leaseToken)},${jsonSql({value:{synthetic:true},requestHash})},'{}',null,${actual??'null'},${actual??'null'});`);
 const mark=(c:Claim,key=c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0')=>json(`select public.mark_content_analysis_call_invalid(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${q(requestHash)},'analysis_unsupported_passage');`);
 function output(c:Claim){const r=record(c.job.update_id),h=c.job.content_hash;
  return c.job.task==='summary'?{state:'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:h,timingBasis:'none'},videoHighlights:[{text:'Nvidia makes the RTX 5090.'}]},
   evidence:{protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,contentHash:h,sourceContentState:'partial',coverage:[{start:0,end:r.content.length}],selected:[{text:'Nvidia makes the RTX 5090.',evidenceQuote:'Nvidia makes RTX 5090.'}]}}:
   {state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,contentHash:h,ruleVersion:'entities-v2',coverage:[{start:0,end:r.content.length}],accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};
 }
 const prepare=(c:Claim)=>json(`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${jsonSql(output(c))});`);
 const publishSql=(c:Claim)=>`select public.publish_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)});`;
 async function waiting(pattern:string){const deadline=Date.now()+4000;while(sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and query like ${q('%'+pattern+'%')};`)==='0'){
  if(Date.now()>deadline)throw new Error('Expected local PostgreSQL lock wait');await new Promise(resolve=>setTimeout(resolve,10));}}
 const oldJobs=()=>service("select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where generation_comparison_id is null;");
 const ledger=()=>service("select jsonb_build_object('calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a));");
 it('additive migration preserves every old value, 490 originals/394 jobs/35 calls/3 holds and all original audit/manifest digests',()=>{
  expect(afterMigration).toBe(beforeMigration);
  expect(json('select count(*) from public.content_analysis_model_comparisons;')).toBe(0);
 });
 it.each(['anon','authenticated'])('denies %s private table and stage/lifecycle/helper execution',role=>{
  const i=input();for(const command of [stageSql(i),`select public.set_content_analysis_model_comparison_state(${q(i.id)},1,'release',${q('a'.repeat(64))},${q('b'.repeat(64))});`,
   'select * from public.content_analysis_model_comparisons;',"select public.content_analysis_model_comparison_job_digest('{}');"])
   expect(()=>sql(`set role ${role};${command}`)).toThrow(/42501/);
 });
 it('denies direct service writes and forged comparison jobs; keeps all old identities immutable',()=>{
  const i=input();stage(i);
  for(const op of ['delete from public.content_analysis_model_comparisons;',"update public.content_analysis_model_comparisons set state='released';",`insert into public.content_analysis_model_comparisons select * from public.content_analysis_model_comparisons;`])
   expect(()=>service(op)).toThrow(/42501/);
  const original=job(i.manifest.slots[0].predecessorJobId);
  expect(()=>service(`insert into public.reader_content_analysis_jobs select (jsonb_populate_record(null::public.reader_content_analysis_jobs,${jsonSql({...original,id:'ffffffff-ffff-ffff-ffff-ffffffffffff',generation_comparison_id:i.id})})).*;`)).toThrow(/PT403/);
  expect(()=>service(`update public.reader_content_analysis_jobs set generation_comparison_id=${q(i.id)} where id=${q(original.id)};`)).toThrow(/PT409/);
 });
 it('stages exactly six rows with immutable original scope/root evidence and idempotent replay performs zero writes',()=>{
  const i=input(),old=oldJobs(),priorLedger=ledger(),scope=service('select to_jsonb(s) from public.content_analysis_rollout_scopes s;');
  expect(stage(i)).toMatchObject({staged:true,successorJobIds:expect.any(Array)});expect(oldJobs()).toBe(old);expect(ledger()).toBe(priorLedger);
  expect(service('select to_jsonb(s) from public.content_analysis_rollout_scopes s;')).toBe(scope);expect(claim()).toBeNull();
  const before=service(snapshot(true));expect(stage(i).staged).toBe(false);expect(service(snapshot(true))).toBe(before);
  expect(json('select count(*) from public.reader_content_analysis_jobs;')).toBe(400);
  expect(json("select details->'humanApproval' from public.admin_audit_events where action='analysis.model_comparison.staged';")).toBe(false);
 });
 it.each(['id','key','model','slots','epoch'])('permanent one-comparison key rejects changed %s and survives close',kind=>{
  const i=input();stage(i);lifecycle(i,'close');
  const next=structuredClone(i);if(kind==='id')next.id='ffffffff-ffff-ffff-ffff-ffffffffffff';if(kind==='key')next.key='second';
  if(kind==='model')next.manifest.responseModel='minimax/minimax-m3.1-flash';if(kind==='slots')next.manifest.slots.pop();if(kind==='epoch')next.manifest.configEpoch+='changed';
  expect(()=>stage(next)).toThrow(/PT40[09]/);expect(()=>lifecycle(i,'release')).toThrow(/PT409/);
  expect(json('select count(*) from public.content_analysis_model_comparisons;')).toBe(1);
 });
 it.each(['scope','workspace','budget','policy','ledger','annotation','review','selection','counts','bound','original','baseEpoch','h3','response','limits'])('stage rejects stale/forged %s atomically',field=>{
  const i=input();if(field==='scope')i.scopeHash='c'.repeat(64);if(field==='workspace')i.workspaceRevision='2000-01-01T00:00:00Z';
  if(['budget','policy','ledger'].includes(field))Object.assign(i.manifest,{[`expected${field[0].toUpperCase()+field.slice(1)}Hash`]:'c'.repeat(64)});
  if(field==='annotation')i.manifest.slots[0].currentAnnotationHash='c'.repeat(64);if(field==='review')i.manifest.slots[0].adminReviewHash='c'.repeat(64);
  if(field==='selection')i.manifest.selectionRevision++;if(field==='counts')i.manifest.expectedCounts.jobs=388;
  if(field==='bound')i.manifest.callBound.maximumFreshUsd=.25;if(field==='original')i.manifest.originalManifestDigest='c'.repeat(64);
  if(field==='baseEpoch'){i.manifest.baseEpochHash='f'.repeat(64);i.manifest.configEpoch=i.manifest.configEpoch.slice(0,-64)+'f'.repeat(64);}
  if(field==='h3')i.manifest.generationContractHash='c'.repeat(64);if(field==='response')i.manifest.responseProviderName='Other';if(field==='limits')i.manifest.effectiveLimits.maxOutputTokens=4096;
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT40[09]/);expect(service(snapshot(true))).toBe(before);expect(comparison(i.id)).toBeNull();
 });
 it.each(['unknown','null_diagnosis','nonallowlisted_diagnosis','published','grandchild','root','no_call','unsettled','wrong_identity'])('requires exact known-settled original failure lineage: %s',kind=>{
  const i=input(),id=i.manifest.slots[0].predecessorJobId;
  // Fixture-only mutation of historical immutable evidence simulates corrupt or
  // stale operator snapshots, never a production reset/admission mechanism.
  sql('alter table public.reader_content_analysis_jobs disable trigger preserve_content_analysis_generation_v3_job;');
  if(kind==='null_diagnosis')service(`update public.reader_content_analysis_jobs set error_code=null where id=${q(id)};`);
  if(kind==='nonallowlisted_diagnosis')service(`update public.reader_content_analysis_jobs set error_code='analysis_provider_refusal' where id=${q(id)};`);
  if(kind==='published')service(`update public.reader_content_analysis_jobs set state='published' where id=${q(id)};`);
  sql('alter table public.reader_content_analysis_jobs enable trigger preserve_content_analysis_generation_v3_job;');
  if(kind==='root')i.manifest.slots[0].rootJobId='ffffffff-ffff-ffff-ffff-ffffffffffff';
  if(kind==='grandchild')i.manifest.slots[0].predecessorJobId=i.manifest.slots[0].rootJobId;
  if(kind==='no_call')sql(`delete from public.reader_content_analysis_calls where job_id=${q(id)};`); // Superuser-only corruption fixture; service ledger deletion is denied.
  if(['unknown','unsettled','wrong_identity'].includes(kind)){
   sql('alter table public.reader_content_analysis_calls disable trigger preserve_content_analysis_execution_identity;');
   if(kind==='wrong_identity')service(`update public.reader_content_analysis_calls set execution_identity=null where job_id=${q(id)};`);
   else service(`update public.reader_content_analysis_calls set actual_usd=null,state='unknown' where job_id=${q(id)};`);
   sql('alter table public.reader_content_analysis_calls enable trigger preserve_content_analysis_execution_identity;');
  }
  const changed=input();if(['root','grandchild'].includes(kind))changed.manifest.slots=i.manifest.slots;
  expect(()=>stage(changed)).toThrow(/PT409/);
 });
 it.each(['missing_audit','wrong_actor','human_claim','wrong_root','annotation'])('quarantined-empty v2 root remains narrowly audited: %s',kind=>{
  if(kind==='missing_audit')service("delete from public.admin_audit_events where action='analysis.summary.withheld';");
  if(kind==='wrong_actor')service("update public.admin_audit_events set admin_id='owner' where action='analysis.summary.withheld';");
  if(kind==='human_claim')service(`update public.admin_audit_events set details=details||'{"humanApproval":true}' where action='analysis.summary.withheld';`);
  if(kind==='wrong_root')service(`update public.admin_audit_events set details=details||jsonb_build_object('predecessorJobId',gen_random_uuid()) where action='analysis.summary.withheld';`);
  if(kind==='annotation')service(`update public.reader_source_updates set record=jsonb_set(record,'{videoSummary,status}','"ready"') where id='generation-video-1';`);
  expect(()=>stage(input())).toThrow(/PT409/);
 });
 it('release is revisioned, off-first and privately reviewed; no human approval claim or setting mutation',()=>{
  const i=input();stage(i);const settings=service('select to_jsonb(s) from public.content_analysis_runtime_settings s;');
  expect(()=>json(`select public.set_content_analysis_model_comparison_state(${q(i.id)},1,'release',${q(comparison(i.id).manifest_digest)},null);`)).toThrow(/PT400/);
  expect(lifecycle(i,'release')).toMatchObject({state:'released',revision:2,review_digest:'c'.repeat(64)});
  expect(()=>lifecycle(i,'pause',1)).toThrow(/PT409/);expect(claim()).toBeNull();
  expect(service('select to_jsonb(s) from public.content_analysis_runtime_settings s;')).toBe(settings);
  activate();const c=claim()!;expect(c.job.generation_comparison_id).toBe(i.id);expect(c.generationContext.comparisonId).toBe(i.id);
  expect(c.generationContext).toMatchObject({protocolVersion:'content-v3',generationContractHash:ANALYSIS_V3_CONTRACT_HASH,predecessorJobId:c.job.generation_predecessor_job_id});
 });
 it.each(['staged','paused','closed'])('scope/gates cannot execute comparison while %s',state=>{
  const i=input();stage(i);if(state!=='staged')lifecycle(i,state==='paused'?'pause':'close');activate();expect(claim()).toBeNull();
 });
 it.each(['source','annotation','admin','follow','model','same_model_revision','config','scope','global_gate','reader_gate'])('every runtime boundary rejects %s drift',kind=>{
  const i=staged(),c=claim()!;prepare(c);
  if(kind==='source')service(`update public.reader_source_updates set record=record||'{"content":"Changed saved source"}' where id=${q(c.job.update_id)};`);
  if(kind==='annotation')service(`update public.reader_source_updates set record=record||'{"topics":["operator"],"videoHighlights":[{"text":"Operator correction"}]}' where id=${q(c.job.update_id)};`);
  if(kind==='admin')service(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
   values(${q(owner)},${q(c.job.update_id)},'fixture-source',${q(c.job.content_hash)},'Changed identity','brand',60,'Synthetic drift','Nvidia','[]','','');`);
  if(kind==='follow')service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${q(owner)};`);
  if(['model','same_model_revision'].includes(kind))service(`select public.admin_set_analysis_model('fixture',${q(kind==='model'?'deepseek/deepseek-v4.1-flash-1017':model)},(select revision from public.content_analysis_runtime_settings where id));`);
  if(kind==='config')expect(()=>service(`update public.reader_content_analysis_jobs set config_epoch='changed' where id=${q(c.job.id)};`)).toThrow(/PT409/);
  if(kind==='scope')lifecycle(i,'pause');if(kind==='global_gate')service('update public.content_analysis_budget set enabled=false;');if(kind==='reader_gate')service('update public.reader_content_analysis_policies set enabled=false;');
  if(kind==='config')return;
  for(const boundary of [reserveSql(c),`select public.read_content_analysis_cached_calls_v2(${q(c.job.id)},${q(c.leaseToken)},array[${q(c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0')}],null,${q(model)});`,publishSql(c)])
   expect(()=>json(boundary)).toThrow(/PT40[39]/);
 });
 it.each(['orphan','old_task','source_revision','same_job'])('unknown %s charge fences new spend/cache/prepare/publication without releasing holds',kind=>{
  staged();const c=claim()!,row=reserve(c).call;if(kind==='same_job')save(c,row.id,null);else{
   save(c,row.id);sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
   service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd)
    values(${kind==='orphan'?'null':q(c.job.generation_predecessor_job_id)},${q(owner)},'synthetic-unknown',gen_random_uuid(),${q(model)},${q(kind==='source_revision'?'f'.repeat(64):job(c.job.id).source_revision)},.001);`);
   sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  }
  expect(()=>reserve(c,c.job.task==='summary'?'summary:v3:chunk:1':'extractor:v3:chunk:1')).toThrow(/PT409/);
  expect(()=>prepare(c)).toThrow(/PT409/);
  expect(json('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(4);
 });
 it('settlement/result recording survives pause, gates off and restored selection while fresh work stays fenced',()=>{
  const i=staged(),c=claim()!,r=reserve(c).call;lifecycle(i,'pause');service('update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;');
  service("select public.admin_set_analysis_model('fixture','deepseek/deepseek-v4.1-flash-1017',(select revision from public.content_analysis_runtime_settings where id));");
  expect(save(c,r.id)).toMatchObject({state:'settled',actual_usd:.0001});expect(()=>reserve(c)).toThrow(/PT409/);
  expect(json('select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(.009178191);
 });
 it('same-job cache and one exact settled correction remain isolated from original paid jobs',()=>{
  staged();const c=claim()!,r=reserve(c),key=c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0';save(c,r.call.id);mark(c,key);
  expect(reserve(c)).toMatchObject({claimed:false,call:{id:r.call.id}});
  expect(json(`select public.read_content_analysis_cached_calls_v2(${q(c.job.id)},${q(c.leaseToken)},array[${q(key)}],null,${q(model)});`).calls).toHaveLength(1);
  expect(reserve(c,key+':repair:1').claimed).toBe(true);expect(()=>reserve(c,key+':repair:2')).toThrow(/PT400/);
 });
 it.each(['provider','model','pricing','adapterVersion'])('rejects %s execution identity drift before a fresh call',field=>{
  staged();const c=claim()!,changed={...identity,[field]:field==='pricing'?{...identity.pricing,version:'changed'}:field==='model'?'minimax/minimax-m3.1-flash':field==='provider'?'other':'changed'};
  expect(()=>reserve(c,undefined,undefined,changed)).toThrow(/PT40[09]/);expect(json('select count(*) from public.reader_content_analysis_calls;')).toBe(35);
 });
 it('original fixed smoke ceiling applies despite $5 caps and old dates',()=>{
  staged();const c=claim()!;service(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state,created_at)
   values('other-owner','synthetic-envelope',gen_random_uuid(),${q(model)},${q('d'.repeat(64))},.239,.239,.239,'settled','2000-01-01');`);
  expect(()=>reserve(c,undefined,.001)).toThrow(/PT402.*smoke/s);
 });
 it('sealed fresh maximum and finite call bound cannot refresh independently of the shared envelope',()=>{
  staged();const c=claim()!;
  // Synthetic settled calls exercise the hard comparison bound without models.
  sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
  service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state,request_hash,execution_identity)
   select ${q(c.job.id)},${q(owner)},'synthetic-bound-'||n,gen_random_uuid(),${q(model)},${q(job(c.job.id).source_revision)},.01,.0078,.0078,'settled',${q(requestHash)},${jsonSql(identity)} from generate_series(1,29)n;`);
  sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  expect(()=>reserve(c)).toThrow(/PT402.*bound/s);
 });
 it('publishes useful nonempty task result, retains exact original paid rows, and terminal notifications/source enrichment still work',()=>{
  staged();const c=claim()!,old=oldJobs(),before=ledger();prepare(c);expect(json(publishSql(c))).toBe(true);expect(oldJobs()).toBe(old);expect(ledger()).toBe(before);
  const done=job(c.job.id);service(`update public.reader_content_analysis_jobs set updated_at=clock_timestamp() where id=${q(c.job.id)};`);
  const notified=job(c.job.id);delete done.updated_at;delete notified.updated_at;expect(notified).toEqual(done);
  service(`update public.reader_source_updates set record=record||'{"content":"Later caption enrichment"}' where id=${q(c.job.update_id)};`);
  expect(record(c.job.update_id).content).toBe('Later caption enrichment');expect(job(c.job.id).state).toBe('published');
 });
 it.each(['delete_source','clear_keep','clear_delete'])('privacy %s redacts comparison evidence, retains permanent tombstone and all financial holds',kind=>{
  const i=staged(),c=claim()!,row=reserve(c).call;
  if(kind==='delete_source')service(`delete from public.reader_source_updates where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  else{const rev=json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`);
   sql(`set role authenticated;select set_config('request.jwt.claims',${q(JSON.stringify({sub:owner}))},false);
    select public.clear_reader_workspace(${q(rev)},${kind==='clear_delete'?'null':jsonSql({version:1,followedSourceIds:[],customSources:[],savedUpdateIds:[],readLaterIds:[],importedUpdates:[],settings:{}})});`);}
  expect(comparison(i.id)).toMatchObject({state:'closed',manifest:null,user_id:null,idempotency_key:null,review_digest:null});
  expect(json(`select actual_usd from public.reader_content_analysis_calls where id=${q(row.id)};`)).toBeNull();
  expect(json('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(4);
  expect(json(`select result from public.reader_content_analysis_calls where id=${q(row.id)};`)).toBeNull();
 });
 it.each(['content-v1','content-v2'])('both legacy sync conflict targets retain actual upsert behavior: %s',version=>{
  service(`insert into public.reader_workspaces(user_id,state) select 'comparison-legacy-owner',state from public.reader_workspaces where user_id=${q(owner)};
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values('comparison-legacy-owner',false,5,5,.01,${q(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    select 'comparison-legacy-owner','legacy-update',source_id,collection_id,published_at,record||'{"id":"legacy-update"}' from public.reader_source_updates where id='generation-video-3';`);
  if(version==='content-v2')service("select public.set_content_analysis_rollout_scope('comparison-legacy-owner',array['legacy-update'],'evaluation');");
  const rpc=version==='content-v1'?'sync_content_analysis_jobs':'sync_content_analysis_jobs_v2';
  expect(json(`select public.${rpc}('comparison-legacy-owner',200,'legacy-1');`)).toEqual({synchronized:2});
  service("update public.reader_content_analysis_jobs set state='cancelled' where user_id='comparison-legacy-owner';");
  expect(json(`select public.${rpc}('comparison-legacy-owner',200,'legacy-2');`)).toEqual({synchronized:2});
  expect(json("select count(*) from public.reader_content_analysis_jobs where user_id='comparison-legacy-owner';")).toBe(2);
 });
 function verifiedZero(c:Claim){
  const row=reserve(c).call,now=service('select clock_timestamp();');
  json(`select public.record_content_analysis_known_rejection(${q(row.id)},${q(c.leaseToken)},${q(requestHash)},${jsonSql(identity)},429,0,'gen-synthetic-comparison-zero',${q(now)},true);`);
  json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_provider_http_429',false);`);
  const proof={verification:'authenticated_generation_get',generationId:'gen-synthetic-comparison-zero',model,providerSlug:identity.provider,providerName:'OpenAI',generationCreatedAt:row.attempt_reserved_at,
   checkedAt:service('select clock_timestamp();'),totalCost:0,isByok:false,promptTokens:0,completionTokens:0,reasoningTokens:0,evidenceSha256:'d'.repeat(64),bindingEvidenceSha256:null};
  expect(json(`select public.record_content_analysis_generation_receipt(${q(row.id)},${q(c.leaseToken)},${q(requestHash)},${jsonSql(identity)},${jsonSql(proof)},true);`).retryEligible).toBe(true);
  sql(`alter table public.reader_content_analysis_calls disable trigger preserve_content_analysis_request;
   update public.reader_content_analysis_calls set retry_not_before='-infinity' where id=${q(row.id)};
   alter table public.reader_content_analysis_calls enable trigger preserve_content_analysis_request;
   update public.content_analysis_provider_cooldowns set cooldown_until='-infinity';
   update public.reader_content_analysis_jobs set next_attempt_at='-infinity' where id=${q(c.job.id)};`);return row;
 }
 it.each(['allowed','shared_cap','same_job','old_task','orphan','selection'])('verified-zero retry UPDATE repeats fresh fences and stays atomic: %s',kind=>{
  const i=staged();let c=claim()!;const prior=verifiedZero(c);c=claim()!;expect(c.job.id).toBe(prior.job_id);
  if(kind==='shared_cap')service(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state)
   values('other-owner','synthetic-retry-envelope',gen_random_uuid(),${q(model)},${q('d'.repeat(64))},.239,.239,.239,'settled');`);
  if(kind==='same_job')reserve(c,c.job.task==='summary'?'summary:v3:chunk:1':'extractor:v3:chunk:1');
  if(['old_task','orphan'].includes(kind)){
   sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
   service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd)
    values(${kind==='orphan'?'null':q(c.job.generation_predecessor_job_id)},${q(owner)},'synthetic-retry-hold',gen_random_uuid(),${q(model)},${q(job(c.job.id).source_revision)},.001);`);
   sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  }
  if(kind==='selection')service(`select public.admin_set_analysis_model('fixture',${q(model)},(select revision from public.content_analysis_runtime_settings where id));`);
  const before=ledger();
  if(kind==='allowed'){expect(reserve(c)).toMatchObject({claimed:true,call:{id:prior.id,attempt_number:2}});expect(json(`select count(*) from public.reader_content_analysis_call_attempts where call_id=${q(prior.id)};`)).toBe(1);}
  else{expect(()=>reserve(c)).toThrow(/PT40[29]/);expect(ledger()).toBe(before);}
  expect(comparison(i.id).manifest.callBound.maximumFreshUsd).toBe(.224562875);
 });
 it('concurrent identical staging is one insert and one exact replay, never duplicate jobs',async()=>{
  const i=input(),a=new Session(args),b=new Session(args);try{
   await a.run('begin;set local role service_role;'+stageSql(i));
   const pending=b.run('set role service_role;'+stageSql(i));await waiting('stage_content_analysis_model_comparison');await a.run('commit;');
   expect(JSON.parse(await pending)).toMatchObject({staged:false});expect(json('select count(*) from public.content_analysis_model_comparisons;')).toBe(1);
   expect(json('select count(*) from public.reader_content_analysis_jobs where generation_comparison_id is not null;')).toBe(6);
  }finally{a.close();b.close();}
 });
 it.each(['source','delete'])('real concurrent %s wins admission; stale stage creates no comparison',async kind=>{
  const i=input(),a=new Session(args),b=new Session(args);try{
   await a.run(`begin;set local role service_role;${kind==='source'?`update public.reader_source_updates set record=record||'{"content":"New saved content"}' where id='generation-video-1';`:`delete from public.reader_source_updates where id='generation-video-1';`}`);
   const pending=b.run('set role service_role;'+stageSql(i)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting('stage_content_analysis_model_comparison');await a.run('commit;');expect((await pending).error).toMatch(/PT409/);
   expect(comparison(i.id)).toBeNull();expect(json('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(3);
  }finally{a.close();b.close();}
 });
 it('pause wins a real concurrent claim with no new call and no terminal-history rewrite',async()=>{
  const i=staged(),a=new Session(args),b=new Session(args),old=oldJobs();try{
   await a.run('begin;set local role service_role;'+lifecycleSql(i,'pause'));
   const pending=b.run('set role service_role;'+claimSql());await waiting('claim_content_analysis_job_v2');await a.run('commit;');expect(await pending).toBe('');
   expect(oldJobs()).toBe(old);expect(json('select count(*) from public.reader_content_analysis_calls;')).toBe(35);
  }finally{a.close();b.close();}
 });
 it.each(['pause_first','publish_first'])('real publication/lifecycle order %s is serialized',async order=>{
  const i=staged(),c=claim()!;prepare(c);const a=new Session(args),b=new Session(args);try{
   const first=order==='pause_first'?lifecycleSql(i,'pause'):publishSql(c),second=order==='pause_first'?publishSql(c):lifecycleSql(i,'pause');
   await a.run('begin;set local role service_role;'+first);
   const pending=b.run('set role service_role;'+second).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting(order==='pause_first'?'publish_content_analysis_job':'set_content_analysis_model_comparison_state');await a.run('commit;');const result=await pending;
   if(order==='pause_first'){expect(result.error).toMatch(/PT409/);expect(job(c.job.id).state).toBe('prepared');}
   else{expect(result.error).toBe('');expect(job(c.job.id).state).toBe('published');}
   expect(comparison(i.id).state).toBe('paused');
  }finally{a.close();b.close();}
 });
 it.each(['review_first','publish_first'])('admin review/publication actual lock order %s preserves the decision',async order=>{
  const i=input();stage(i);lifecycle(i,'release');activate();let c:Claim|null;do{c=claim();}while(c&&(c.job.update_id!=='generation-video-2'||c.job.task!=='keywords'));
  const chosen=c!,review=json("select to_jsonb(r) from public.admin_keyword_reviews r where update_id='generation-video-2';");prepare(chosen);
  const decide=`select public.admin_review_keyword(${q(review.id)},${q(review.updated_at)},'synthetic-admin','approve','Nvidia','brand');`;
  const a=new Session(args),b=new Session(args);try{
   await a.run('begin;set local role service_role;'+(order==='review_first'?decide:publishSql(chosen)));
   const pending=b.run('set role service_role;'+(order==='review_first'?publishSql(chosen):decide)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting(order==='review_first'?'publish_content_analysis_job':'admin_review_keyword');await a.run('commit;');const result=await pending;
   if(order==='review_first'){expect(result.error).toMatch(/PT409/);expect(job(chosen.job.id).state).toBe('prepared');}else{expect(result.error).toBe('');expect(job(chosen.job.id).state).toBe('published');}
   expect(service(`select status from public.admin_keyword_reviews where id=${q(review.id)};`)).toBe('approved');
  }finally{a.close();b.close();}
 });
 it('real concurrent reservations use the singleton budget lock and only one fits the unchanged original smoke ceiling',async()=>{
  staged();const c1=claim()!,c2=claim()!;
  service(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state)
   values('other-owner','synthetic-race-envelope',gen_random_uuid(),${q(model)},${q('d'.repeat(64))},.2385,.2385,.2385,'settled');`);
  const a=new Session(args),b=new Session(args);try{
   await a.run('begin;set local role service_role;'+reserveSql(c1));
   const pending=b.run('set role service_role;'+reserveSql(c2)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting('reserve_content_analysis_call_v3');await a.run('commit;');expect((await pending).error).toMatch(/PT402.*smoke/s);
   expect(json('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(4);
  }finally{a.close();b.close();}
 });
 it('in-flight receipt/result settlement waits for gate-off then persists while paused, without reopening permission',async()=>{
  const i=staged(),c=claim()!,r=reserve(c).call,a=new Session(args),b=new Session(args);try{
   await a.run('begin;set local role service_role;update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;');
   const pending=b.run(`set role service_role;select public.record_content_analysis_call_result(${q(r.id)},${q(c.leaseToken)},${jsonSql({value:{synthetic:true},requestHash})},'{}',null,.0001,.0001);`);
   await waiting('record_content_analysis_call_result');await a.run('commit;');expect(JSON.parse(await pending)).toMatchObject({state:'settled',actual_usd:.0001});
   lifecycle(i,'pause');expect(()=>reserve(c)).toThrow(/PT409/);expect(json('select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(.009178191);
  }finally{a.close();b.close();}
 });
 it.each(['baseCalls','baseMaximumUsd','correctionCalls','correctionMaximumUsd','maximumCalls','maximumFreshUsd'])('sealed conservative preflight %s cannot be silently expanded or shrunk',key=>{
  const i=input();const bound=i.manifest.callBound as Record<string,number>;bound[key]+=1;expect(()=>stage(i)).toThrow(/PT400/);
 });
 it.each(['predecessor','root'])('later %s ledger mutation invalidates runtime permission without rewriting audit/manifests',kind=>{
  const i=staged(),c=claim()!,slot=i.manifest.slots.find((x:any)=>x.successorJobId===c.job.id),id=kind==='predecessor'?slot.predecessorJobId:slot.rootJobId;
  service(`update public.reader_content_analysis_calls set usage='{"syntheticDrift":true}' where job_id=${q(id)};`);
  expect(()=>reserve(c)).toThrow(/PT409/);expect(()=>prepare(c)).toThrow(/PT409/);
 });
 it('unresolved same-job charge cannot publish an already prepared result',()=>{
  staged();const c=claim()!,r=reserve(c).call;save(c,r.id);prepare(c);
  service(`update public.reader_content_analysis_calls set actual_usd=null,state='unknown' where id=${q(r.id)};`);
  expect(()=>json(publishSql(c))).toThrow(/PT409/);expect(job(c.job.id).state).toBe('prepared');
 });
 it('both-empty comparison keyword inventories are withheld at the database boundary',()=>{
  staged();let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='keywords');const chosen=c!,r=output(chosen);
  r.state='empty';if('accepted' in r.evidence)r.evidence.accepted=[];
  expect(()=>json(`select public.prepare_content_analysis_job(${q(chosen.job.id)},${q(chosen.leaseToken)},${jsonSql(r)});`)).toThrow(/PT409.*Empty comparison/s);
 });
 it.each(['failed','published','skipped','cancelled'])('terminal %s comparison evidence survives source enrichment/unfollow without blocking either change',state=>{
  const i=staged(),c=claim()!;
  if(state==='published'){prepare(c);json(publishSql(c));}else service(`update public.reader_content_analysis_jobs set state=${q(state)} where id=${q(c.job.id)};`);
  const before=job(c.job.id),paid=ledger();service(`update public.reader_source_updates set record=record||'{"content":"New saved transcript revision"}' where id=${q(c.job.update_id)};`);
  service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${q(owner)};`);
  expect(job(c.job.id)).toEqual(before);expect(ledger()).toBe(paid);expect(comparison(i.id).manifest).toBeTruthy();
 });
 it.each(['comparison','predecessor','root'])('deleting a %s job redacts all newly introduced private comparison evidence without erasing cost holds',kind=>{
  const i=staged(),c=claim()!,row=reserve(c).call,slot=i.manifest.slots.find((x:any)=>x.successorJobId===c.job.id);
  service(`delete from public.reader_content_analysis_jobs where id=${q(kind==='comparison'?c.job.id:kind==='predecessor'?slot.predecessorJobId:slot.rootJobId)};`);
  expect(comparison(i.id)).toMatchObject({manifest:null,user_id:null,state:'closed'});expect(json('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(4);
  expect(json(`select job_id from public.reader_content_analysis_calls where id=${q(row.id)};`)).toBeNull();
 });
 it.each(['base_count','base_cost','correction_count'])('finite preflight category %s remains a hard boundary even when total cost/call count still fits',kind=>{
  staged();const c=claim()!,prefix=c.job.task==='summary'?'summary:v3:chunk:':'extractor:v3:chunk:';
  const amount=kind==='base_cost'?.0095:.0001,number=kind==='base_cost'?10:kind==='base_count'?16:13;
  sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
  const insert=(correction:boolean)=>service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state,request_hash,execution_identity)
   select ${q(c.job.id)},${q(owner)},${q(prefix)}||n||${q(correction?':repair:1':'')},gen_random_uuid(),${q(model)},${q(job(c.job.id).source_revision)},.01,${amount},${amount},'settled',${q(requestHash)},${jsonSql(identity)} from generate_series(0,${number-1})n;`);
  insert(false);if(kind==='correction_count')insert(true);
  sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  if(kind==='correction_count'){const key=prefix+'13',r=reserve(c,key);save(c,r.call.id);mark(c,key);expect(()=>reserve(c,key+':repair:1')).toThrow(/PT402.*category/s);}
  else expect(()=>reserve(c,prefix+'99')).toThrow(/PT402.*category/s);
 });
 it.each(['pending_only','admin_decision'])('sibling keyword publication %s preserves only its authorized pending rows during summary work',kind=>{
  staged();const claims:Claim[]=[];let next:Claim|null;while((next=claim()))claims.push(next);
  const summary=claims.find(c=>c.job.update_id==='generation-video-3'&&c.job.task==='summary')!,keywords=claims.find(c=>c.job.update_id==='generation-video-3'&&c.job.task==='keywords')!;
  expect(summary).toBeTruthy();expect(keywords).toBeTruthy();const value=output(keywords) as any;
  value.state='review';value.pending=[{label:'RTX',kind:'product',confidence:60,reason:'Synthetic uncertain identity',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}];
  json(`select public.prepare_content_analysis_job(${q(keywords.job.id)},${q(keywords.leaseToken)},${jsonSql(value)});`);expect(json(publishSql(keywords))).toBe(true);
  const review=json("select to_jsonb(r) from public.admin_keyword_reviews r where update_id='generation-video-3' and label='RTX';");expect(review.status).toBe('pending');
  if(kind==='admin_decision'){
   json(`select public.admin_review_keyword(${q(review.id)},${q(review.updated_at)},'synthetic-admin','reject','RTX','product');`);
   expect(()=>prepare(summary)).toThrow(/PT409/);
  }else{expect(prepare(summary)).toMatchObject({prepared:true});expect(json(publishSql(summary))).toBe(true);expect(service(`select status from public.admin_keyword_reviews where id=${q(review.id)};`)).toBe('pending');}
 });
 // A new unselected arrival is measured independently of the immutable cohort.
 const addUnselectedArrival=(id='comparison-native-arrival-1',arrivalOwner=owner)=>service(`
  insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
  select ${q(arrivalOwner)},${q(id)},a.source_id,a.collection_id,a.published_at,
   a.record||jsonb_build_object('id',${q(id)},'title','Synthetic unselected hourly arrival')
  from public.reader_source_updates a where a.user_id=${q(owner)} and a.id='comparison-history-1';`);
 const nativeCountState=()=>json(`select jsonb_build_object(
  'sourceUpdates',(select count(*) from public.reader_source_updates),
  'workspaces',(select count(*) from public.reader_workspaces),
  'jobs',(select count(*) from public.reader_content_analysis_jobs where generation_comparison_id is null),
  'calls',(select count(*) from public.reader_content_analysis_calls),
  'settledCalls',(select count(*) from public.reader_content_analysis_calls where state='settled'),
  'unsettledCalls',(select count(*) from public.reader_content_analysis_calls where actual_usd is null),
  'committedUsd',(select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls));`);
 it.each(['target','unrelated'])('measured native 491/three-workspace checkpoint stages the same three originals/six slots and preserves every old row: %s arrival',arrival=>{
  addUnselectedArrival('comparison-native-arrival-1',arrival==='target'?owner:'comparison-unrelated-owner-1');
  const i=input(),before=nativeCountState(),old=oldJobs(),paid=ledger();
  const archives=service('select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a;');
  const workspaces=service('select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w;');
  const scope=service('select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s;');
  expect(before).toEqual({sourceUpdates:491,workspaces:3,jobs:394,calls:35,settledCalls:32,unsettledCalls:3,committedUsd:.028604315});
  expect(i.manifest.expectedCounts).toEqual({sourceUpdates:491,jobs:394,calls:35,unsettledCalls:3});
  expect(new Set(i.manifest.slots.map((slot:any)=>slot.updateId))).toEqual(new Set(['generation-video-1','generation-video-2','generation-video-3']));
  expect(i.manifest.slots).toHaveLength(6);expect(stage(i)).toMatchObject({staged:true,successorJobIds:expect.any(Array)});
  expect(comparison(i.id).manifest.expectedCounts.sourceUpdates).toBe(491);expect(nativeCountState()).toEqual(before);
  expect(oldJobs()).toBe(old);expect(ledger()).toBe(paid);
  expect(service('select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a;')).toBe(archives);
  expect(service('select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w;')).toBe(workspaces);
  expect(service('select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s;')).toBe(scope);
  expect(json('select count(*) from public.reader_content_analysis_jobs where generation_comparison_id is not null;')).toBe(6);
  expect(json(`select count(distinct update_id) from public.reader_content_analysis_jobs where generation_comparison_id=${q(i.id)};`)).toBe(3);
  expect(comparison(i.id).manifest.budget.smokeLifetimeCeilingUsd).toBe(.268365907);
  expect(comparison(i.id).manifest.callBound.maximumCalls).toBe(29);expect(claim()).toBeNull();
 });
 it('original measured 490 checkpoint remains valid with three workspaces',()=>{
  const i=input();expect(i.manifest.expectedCounts.sourceUpdates).toBe(490);expect(nativeCountState().workspaces).toBe(3);
  expect(stage(i).staged).toBe(true);expect(nativeCountState()).toEqual({sourceUpdates:490,workspaces:3,jobs:394,calls:35,settledCalls:32,unsettledCalls:3,committedUsd:.028604315});
 });
 it.each(['old_fixed_490','growth_after_manifest'])('native archive count CAS rejects %s with zero job/comparison/audit writes',kind=>{
  if(kind==='old_fixed_490')addUnselectedArrival();
  const i=input();if(kind==='old_fixed_490')i.manifest.expectedCounts.sourceUpdates=490;else addUnselectedArrival();
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT409/);expect(service(snapshot(true))).toBe(before);
  expect(json('select count(*) from public.content_analysis_model_comparisons;')).toBe(0);
  expect(json('select count(*) from public.reader_content_analysis_jobs;')).toBe(394);
  expect(json("select count(*) from public.admin_audit_events where action='analysis.model_comparison.staged';")).toBe(0);
  expect(nativeCountState()).toEqual({sourceUpdates:491,workspaces:3,jobs:394,calls:35,settledCalls:32,unsettledCalls:3,committedUsd:.028604315});
 });
 it.each([
  ['zero',0],['one',1],['two',2],['negative',-1],['fraction',490.5],['above_bound',10000001],
  ['max_safe_integer',9007199254740991],['unsafe_integer',9007199254740992],['huge_number',1e30],
  ['numeric_string','490'],['null',null],['boolean',true],['object',{}],['array',[490]],['missing',undefined],
 ] as const)('native archive count rejects malformed %s with PT400 and no writes',(_label,value)=>{
  const i=input();(i.manifest.expectedCounts as Record<string,unknown>).sourceUpdates=value;
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT400/);expect(service(snapshot(true))).toBe(before);
  expect(comparison(i.id)).toBeNull();
 });
 it.each(['490.0','4.905e2'])('native archive count rejects a JSON decimal %s without integer coercion',value=>{
  const i=input(),query=stageSql(i).replace('"sourceUpdates":490','"sourceUpdates":'+value);
  expect(query).not.toBe(stageSql(i));const before=service(snapshot(true));expect(()=>json(query)).toThrow(/PT400/);expect(service(snapshot(true))).toBe(before);
 });
 it.each([3,10000000])('native archive count integer bound %s is valid syntax but mismatched native count fails PT409',count=>{
  const i=input();i.manifest.expectedCounts.sourceUpdates=count;expect(()=>stage(i)).toThrow(/PT409/);expect(comparison(i.id)).toBeNull();
 });
 it.each(['extra','missing_jobs','missing_calls','missing_unsettled','wrong_jobs','wrong_calls','wrong_unsettled','string_jobs','null_counts','array_counts','string_counts','missing_counts'])('expectedCounts retains exact keys and fixed financial counts: %s',kind=>{
  const i=input(),manifest=i.manifest as Record<string,unknown>,counts=i.manifest.expectedCounts as Record<string,unknown>;
  if(kind==='extra')counts.workspaces=3;
  if(kind.startsWith('missing_')&&kind!=='missing_counts')delete counts[kind==='missing_jobs'?'jobs':kind==='missing_calls'?'calls':'unsettledCalls'];
  if(kind==='wrong_jobs')counts.jobs=395;if(kind==='wrong_calls')counts.calls=36;if(kind==='wrong_unsettled')counts.unsettledCalls=4;
  if(kind==='string_jobs')counts.jobs='394';if(kind==='null_counts')manifest.expectedCounts=null;if(kind==='array_counts')manifest.expectedCounts=[];
  if(kind==='string_counts')manifest.expectedCounts='490/394/35/3';if(kind==='missing_counts')delete manifest.expectedCounts;
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT400/);expect(service(snapshot(true))).toBe(before);expect(comparison(i.id)).toBeNull();
 });
});
