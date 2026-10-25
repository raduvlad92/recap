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
const model = 'deepseek/deepseek-v4.1-flash-1017', requestHash = 'a'.repeat(64);
const identity = {
 adapterVersion: 'content-analysis-model-v2', route: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
 provider: 'relace', model, reasoningEffort: null, pricing: {
  version: 'synthetic-fixture-2026-10-25', inputUsdPerMillion: .1, outputUsdPerMillion: .4,
  cachedInputUsdPerMillion: null, cacheWriteApplies: false, cacheWriteUsdPerMillion: null,
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


describe.skipIf(!available)('bounded content-v3 successor actual disposable PostgreSQL 17', () => {
 let root: string, args: string[], started = false, beforeMigration: string, afterMigration: string, acceptance: string;
 const owner = 'generation-v3-owner';
 const seed = () => sql(readFileSync(new URL('./content-analysis-generation-v3-fixture.sql', import.meta.url), 'utf8'));
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] }).trim();
 const service = (query: string) => sql('set role service_role; ' + query);
 const json = (query: string) => { const value=service(query); return value==='t'?true:value==='f'?false:JSON.parse(value||'null'); };
 const hashSql = (value: string) => `encode(sha256(convert_to((${value})::text,'UTF8')),'hex')`;
 const snapshot = (after = false) => `select jsonb_build_object(
  'budget',(select to_jsonb(b) from public.content_analysis_budget b),
  'policies',(select jsonb_agg(to_jsonb(p) order by user_id) from public.reader_content_analysis_policies p),
  'workspaces',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
  'archives',(select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a),
  'jobs',(select jsonb_agg(${after ? "to_jsonb(j)-array['generation_predecessor_job_id','generation_contract_hash']" : 'to_jsonb(j)'} order by id) from public.reader_content_analysis_jobs j),
  'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c),
  'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a),
  'scopes',(select jsonb_agg(${after ? "to_jsonb(s)-array['generation_rule_version','generation_revision_manifest']" : 'to_jsonb(s)'} order by user_id) from public.content_analysis_rollout_scopes s),
  'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
  'settings',(select to_jsonb(s) from public.content_analysis_runtime_settings s),
  'audit',(select jsonb_agg(to_jsonb(e) order by id) from public.admin_audit_events e));`;
 beforeAll(() => {
  expect(execFileSync('initdb',['--version'],{encoding:'utf8'})).toMatch(/PostgreSQL\) 17\./);
  root = mkdtempSync(join(tmpdir(), 'recap-generation-v3-db-')); const data = join(root,'data'), socket = join(root,'socket'); mkdirSync(socket);
  execFileSync('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${socket} -h '' -p 55499`,'start'],{stdio:'ignore'}); started = true;
  args = ['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p','55499','-U','postgres','-d','postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/',import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
   if (name.includes('_content_analysis_generation_v3.sql')) { seed(); beforeMigration=service(snapshot()); }
   sql(readFileSync(new URL(name,directory),'utf8'));
   if (name.includes('_content_analysis_generation_v3.sql')) {
    afterMigration=service(snapshot(true)); acceptance=sql(readFileSync(new URL('./content-analysis-generation-v3-db.sql',import.meta.url),'utf8'));
   }
  }
 },20000);
 beforeEach(() => {
  sql(`truncate public.reader_workspaces cascade; truncate public.reader_source_updates cascade; truncate public.reader_content_analysis_calls cascade;
   truncate public.reader_content_analysis_policies; truncate public.content_analysis_provider_cooldowns; truncate public.admin_audit_events;`);
  seed();
 });
 afterAll(() => {
  if (started) execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});
  if (root) rmSync(root,{recursive:true,force:true});
 });
 type Claim = {job:{id:string;task:'summary'|'keywords';rule_version:string;generation_contract_hash:string;generation_predecessor_job_id:string;state:string};leaseToken:string;generationContext:unknown};
 const record = (id='generation-video-1') => json(`select record from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`);
 const job = (id:string) => json(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(id)};`);
 const call = (id:string) => json(`select to_jsonb(c) from public.reader_content_analysis_calls c where id=${q(id)};`);
 const oldRows = () => service(`select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where rule_version<>'content-v3'),
  'calls',(select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c where call_key not like '%:v3:%'),
  'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a));`);
 function quarantine() {
  sql(`begin;
   with current as (select a.*,j.id jid,j.content_hash,j.source_revision from public.reader_source_updates a join public.reader_content_analysis_jobs j
    on j.user_id=a.user_id and j.update_id=a.id and j.task='summary' and j.rule_version='content-v2'
    where a.user_id=${q(owner)} and a.id='generation-video-1'), patched as (
    update public.reader_source_updates a set record=jsonb_set(current.record,'{videoSummary,status}','"unavailable"')||
     jsonb_build_object('processing',current.record->'processing'||jsonb_build_object('recap','failed','reason','analysis_summary_omission','updatedAt',clock_timestamp()))
     from current where a.user_id=current.user_id and a.id=current.id returning a.record,current.record original,current.jid,current.content_hash,current.source_revision)
   insert into public.admin_audit_events(admin_id,action,target_id,details)
    select 'system:analysis-quality-review','analysis.summary.withheld','generation-video-1',jsonb_build_object('predecessorJobId',jid,'contentHash',content_hash,'sourceRevision',source_revision,
     'previousRecordHash',${hashSql('original')},'withheldRecordHash',${hashSql('record')},'sourceReviewDigest',${q('b'.repeat(64))},'reason','analysis_summary_omission','actorType','assistant','humanApproval',false) from patched;
   commit;`);
 }
 function stageInput(disposition='findings_expected', selected?: string[]) {
  const h3=service('select public.content_analysis_generation_v3_contract_hash();');
  const slots=json(`select jsonb_agg(jsonb_build_object('predecessorJobId',j.id,'successorJobId',gen_random_uuid(),'updateId',j.update_id,'sourceId',j.source_id,
   'task',j.task,'contentHash',j.content_hash,'sourceRevision',j.source_revision,'sourceFingerprint',j.source_fingerprint,
   'predecessorJobHash',public.content_analysis_generation_v3_digest(to_jsonb(j)),'predecessorLedgerHash',public.content_analysis_generation_v3_ledger_hash(j.id),
   'emptyDisposition',${q(disposition)},'sourceReviewDigest',${disposition==='unreviewed'?'null':q('b'.repeat(64))},
   'reason',case when j.state='published' then 'audited_empty_omission' else 'format_or_coverage_failure' end,
   'withholdAuditId',case when j.state='published' then (select id from public.admin_audit_events where action='analysis.summary.withheld' and target_id=j.update_id limit 1) else null end,
   'currentAnnotationHash',case when j.state='published' then public.content_analysis_generation_v3_digest(jsonb_build_object('videoSummary',a.record->'videoSummary','videoHighlights',a.record->'videoHighlights')) else null end)
   order by j.update_id,j.task) from public.reader_content_analysis_jobs j join public.reader_source_updates a on a.user_id=j.user_id and a.id=j.update_id
   where j.user_id=${q(owner)} and j.rule_version='content-v2' and j.update_id in ('generation-video-1','generation-video-2','generation-video-3') ${selected ? `and j.id=any(array[${selected.map(q).join(',')}]::uuid[])`:''};`);
  const manifest={protocolVersion:'content-v3',generationContractHash:h3,executionIdentity:identity,configEpoch:'bounded-v3-fixture',runtimeDisabled:true,workersDrained:true,
   expectedBudgetHash:service('select public.content_analysis_generation_v3_digest(to_jsonb(b)) from public.content_analysis_budget b;'),
   expectedPolicyHash:service(`select public.content_analysis_generation_v3_digest(to_jsonb(p)) from public.reader_content_analysis_policies p where user_id=${q(owner)};`),
   expectedLedgerHash:service('select public.content_analysis_generation_v3_ledger_hash();'),
   expectedCommittedUsd:json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;'),
   budget:{originalCommittedUsd:.018365907,incrementalAllowanceUsd:.25,smokeLifetimeCeilingUsd:.268365907},slots};
  return {scopeHash:service(`select public.content_analysis_generation_v3_digest(to_jsonb(s)) from public.content_analysis_rollout_scopes s where user_id=${q(owner)};`),
   workspaceRevision:json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`),h3,manifest};
 }
 type StageInput=ReturnType<typeof stageInput>;
 const stageSql=(i:StageInput) => `select public.stage_content_analysis_generation_v3(${q(owner)},${q(i.scopeHash)},${q(i.workspaceRevision)},${q(i.h3)},${jsonSql(i.manifest)});`;
 const stage=(i:StageInput) => json(stageSql(i));
 function activate(ids=['generation-video-1','generation-video-2','generation-video-3']) {
  service(`select public.set_content_analysis_rollout_scope(${q(owner)},array[${ids.map(q).join(',')}]::text[],'evaluation');
   update public.content_analysis_budget set enabled=true; update public.reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`);
 }
 const claimSql=() => `select public.claim_content_analysis_job_v2(${q(owner)},900);`;
 const claim=():Claim|null => json(claimSql());
 function staged(disposition='findings_expected') { quarantine(); const input=stageInput(disposition); const result=stage(input); activate(); return {input,result}; }
 const reserveSql=(c:Claim,key=c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0',value:unknown=identity,maximum=.001,hash=requestHash) =>
  `select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(model)},${jsonSql(value)},${q(hash)});`;
 const reserve=(c:Claim,key?:string,value?:unknown,maximum?:number) => json(reserveSql(c,key,value,maximum));
 function save(c:Claim,id:string,actual:number|null=.0001,value:unknown={invalid:true}) {
  return json(`select public.record_content_analysis_call_result(${q(id)},${q(c.leaseToken)},${jsonSql({value,requestHash})},'{}',null,${actual===null?'null':actual},${actual===null?'null':actual});`);
 }
 const mark=(c:Claim,key?:string) => json(`select public.mark_content_analysis_call_invalid(${q(c.job.id)},${q(c.leaseToken)},${q(key??(c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0'))},${q(requestHash)},'analysis_unsupported_passage');`);
 function summary(c:Claim,empty=false) {
  const r=record(job(c.job.id).update_id),h=job(c.job.id).content_hash;
  return {state:empty?'empty':'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:h,timingBasis:'none'},videoHighlights:empty?[]:[{text:'Nvidia makes the RTX 5090.'}]},
   evidence:{protocolVersion:'content-v3',generationContractHash:c.job.generation_contract_hash,contentHash:h,sourceContentState:'partial',coverage:[{start:0,end:r.content.length}],
    selected:empty?[]:[{text:'Nvidia makes the RTX 5090.',evidenceQuote:'Nvidia makes RTX 5090.'}]}};
 }
 const prepare=(c:Claim,result:unknown) => json(`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${jsonSql(result)});`);
 const publishSql=(c:Claim) => `select public.publish_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)});`;
 const due=(c:Claim) => service(`update public.reader_content_analysis_jobs set next_attempt_at='-infinity' where id=${q(c.job.id)};`);
 function verifiedZero(c:Claim) {
  const row=reserve(c).call,now=service('select clock_timestamp();');
  json(`select public.record_content_analysis_known_rejection(${q(row.id)},${q(c.leaseToken)},${q(requestHash)},${jsonSql(identity)},429,0,'gen-synthetic-v3-zero',${q(now)},true);`);
  json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_provider_http_429',false);`);
  const proof={verification:'authenticated_generation_get',generationId:'gen-synthetic-v3-zero',model,providerSlug:identity.provider,providerName:'Synthetic',
   generationCreatedAt:row.attempt_reserved_at,checkedAt:service('select clock_timestamp();'),totalCost:0,isByok:false,promptTokens:0,completionTokens:0,reasoningTokens:0,
   evidenceSha256:'d'.repeat(64),bindingEvidenceSha256:null};
  expect(json(`select public.record_content_analysis_generation_receipt(${q(row.id)},${q(c.leaseToken)},${q(requestHash)},${jsonSql(identity)},${jsonSql(proof)},true);`).retryEligible).toBe(true);
  // Only the synthetic cluster advances cooldown timestamps; production keeps
  // immutable provider receipts and actual retry timing.
  sql(`alter table public.reader_content_analysis_calls disable trigger preserve_content_analysis_request;
   update public.reader_content_analysis_calls set retry_not_before='-infinity' where id=${q(row.id)};
   alter table public.reader_content_analysis_calls enable trigger preserve_content_analysis_request;
   update public.content_analysis_provider_cooldowns set cooldown_until='-infinity';`);
  due(c);return row;
 }
 async function waiting(pattern:string) {
  const deadline=Date.now()+4000;
  while(sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and query like ${q('%'+pattern+'%')};`)==='0') {
   if(Date.now()>deadline) throw new Error('Expected concurrent local PostgreSQL lock wait');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 it('preserves exact 23 old calls/3 holds, failed/published jobs, D25 empty/nonempty, sources, scopes, workspace and disabled controls across migration',()=>{
  expect(beforeMigration).toBeTruthy();expect(afterMigration).toBe(beforeMigration);expect(acceptance).toBe('');
 });
 it.each(['anon','authenticated'])('denies %s every new service-only helper, writer and private scope',role=>{
  quarantine();const i=stageInput();
  const statements=[stageSql(i),'select public.content_analysis_generation_v3_contract_hash();',"select public.content_analysis_generation_v3_digest('{}');",
   'select public.content_analysis_generation_v3_ledger_hash();','select public.content_analysis_generation_v3_slot(gen_random_uuid());',
   'select public.content_analysis_generation_job_in_scope(gen_random_uuid());',"select public.content_analysis_generation_v3_withhold_valid(gen_random_uuid(),'{}');","select public.content_analysis_generation_job_completed(gen_random_uuid(),'{}');",
   "select public.validate_content_analysis_generation_v3_result(gen_random_uuid(),'{}');",'select * from public.content_analysis_rollout_scopes;'];
  for(const statement of statements)expect(()=>sql(`set role ${role};${statement}`)).toThrow(/42501.*permission denied/s);
 });
 it('stage creates exactly six new jobs and one private audit, keeps scope paused/off, and exact replay performs zero writes',()=>{
  quarantine();const old=oldRows(),i=stageInput(),first=stage(i),snap=service(snapshot(true));
  expect(first.staged).toBe(true);expect(first.successorJobIds).toHaveLength(6);expect(oldRows()).toBe(old);
  expect(first.scope).toMatchObject({phase:'paused',generation_rule_version:'content-v3'});expect(claim()).toBeNull();
  expect(stage(i)).toMatchObject({staged:false,successorJobIds:first.successorJobIds});expect(service(snapshot(true))).toBe(snap);
  expect(json("select count(*) from public.admin_audit_events where action='analysis.generation_revision.staged';")).toBe(1);
  expect(()=>stage({...i,manifest:{...i.manifest,configEpoch:'changed'}})).toThrow(/PT409/);
 });
 it.each(['scope','workspace','budget','policy','ledger','contract'])('staging fails atomic CAS for stale %s',field=>{
  quarantine();const i=stageInput();
  if(field==='scope')i.scopeHash='c'.repeat(64);
  if(field==='workspace')i.workspaceRevision='2000-01-01T00:00:00Z';
  if(field==='budget')i.manifest.expectedBudgetHash='c'.repeat(64);
  if(field==='policy')i.manifest.expectedPolicyHash='c'.repeat(64);
  if(field==='ledger')i.manifest.expectedLedgerHash='c'.repeat(64);
  if(field==='contract')i.h3='c'.repeat(64);
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT40[09]/);expect(service(snapshot(true))).toBe(before);
 });
 it.each(['missing_audit','wrong_actor','human_claim','annotation','predecessor_result','source_review'])('audited empty exception rejects %s',kind=>{
  quarantine();
  if(kind==='missing_audit')service("delete from public.admin_audit_events;");
  if(kind==='wrong_actor')service("update public.admin_audit_events set admin_id='owner';");
  if(kind==='human_claim')service(`update public.admin_audit_events set details=details||'{"humanApproval":true}';`);
  if(kind==='annotation')service(`update public.reader_source_updates set record=jsonb_set(record,'{videoSummary,status}','"ready"') where user_id=${q(owner)} and id='generation-video-1';`);
  if(kind==='predecessor_result')service(`update public.reader_content_analysis_jobs set result=jsonb_set(result,'{state}','"ready"') where rule_version='content-v2' and state='published' and update_id='generation-video-1';`);
  const i=stageInput();if(kind==='source_review')i.manifest.slots.find((s:{reason:string})=>s.reason==='audited_empty_omission').sourceReviewDigest='c'.repeat(64);
  const before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT40[09]/);expect(service(snapshot(true))).toBe(before);
 });
 it.each(['duplicate','expanded','seventh','wrong_source','wrong_owner','wrong_task','unknown_field','version'])('rejects manifest %s',kind=>{
  quarantine();const i=stageInput(),slots=i.manifest.slots;
  if(kind==='duplicate')slots[1]={...slots[0]};
  if(kind==='expanded')slots[0].updateId='outside';
  if(kind==='seventh')slots.push({...slots[0]});
  if(kind==='wrong_source')slots[0].sourceId='other-source';
  if(kind==='wrong_owner')slots[0].predecessorJobId=json("select to_jsonb(id) from public.reader_content_analysis_jobs where rule_version='content-v1' limit 1;");
  if(kind==='wrong_task')slots[0].task='invalid';
  if(kind==='unknown_field')slots[0].surprise=true;
  if(kind==='version')i.manifest.protocolVersion='content-v2';
  expect(()=>stage(i)).toThrow(/PT40[09]/);expect(json("select count(*) from public.reader_content_analysis_jobs where rule_version='content-v3';")).toBe(0);
 });
 it.each(['analysis_provider_refusal','analysis_unsupported_summary_claim','analysis_provider_http_429','analysis_cached_input_changed','analysis_invalid_json'])('does not promote terminal non-allowlisted error %s',code=>{
  quarantine();service(`update public.reader_content_analysis_jobs set error_code=${q(code)} where rule_version='content-v2' and state='failed';`);
  expect(()=>stage(stageInput())).toThrow(/PT409/);
 });
 it('requires a concrete diagnosed failure code and rolls back a null-code staging attempt',()=>{
  quarantine();service("update public.reader_content_analysis_jobs set error_code=null where rule_version='content-v2' and state='failed';");
  const input=stageInput(),before=service(snapshot(true));
  expect(()=>stage(input)).toThrow(/PT409/);
  expect(service(snapshot(true))).toBe(before);
 });
 it.each(['same_source_task','other_hash','orphan'])('cross-version %s unknown holds fence staging without releasing old charges',kind=>{
  quarantine();sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
  const target=json("select to_jsonb(j) from public.reader_content_analysis_jobs j where rule_version='content-v2' and state='failed' limit 1;");
  if(kind==='other_hash')service(`update public.reader_content_analysis_jobs set content_hash=${q('f'.repeat(64))} where id=${q(target.id)};`);
  service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd) values(${kind==='orphan'?'null':q(target.id)},${q(owner)},'synthetic-unknown',gen_random_uuid(),${q(model)},${q(target.source_revision)},.001);`);
  sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  const before=oldRows();expect(()=>stage(stageInput())).toThrow(/PT409/);expect(oldRows()).toBe(before);
 });
 it('never fans out or resets v3 through sync, config epochs, expanded IDs/phases or direct service inserts',()=>{
  const {input}=staged(),before=oldRows();
  for(const phase of ['active','backfill'])expect(()=>service(`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1'],${q(phase)});`)).toThrow(/PT409/);
  for(const ids of ['null',"array['outside']"])expect(()=>service(`select public.set_content_analysis_rollout_scope(${q(owner)},${ids},'evaluation');`)).toThrow(/PT409/);
  expect(()=>service(`update public.content_analysis_rollout_scopes set phase='paused';`)).toThrow(/42501/);
  const rows=service("select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where rule_version='content-v3';");
  expect(json(`select public.sync_content_analysis_jobs_v2(${q(owner)},1000,'another-config-epoch');`)).toEqual({synchronized:0});
  expect(service("select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where rule_version='content-v3';")).toBe(rows);
  expect(()=>service(`insert into public.reader_content_analysis_jobs select (jsonb_populate_record(null::public.reader_content_analysis_jobs,${jsonSql({...job(input.manifest.slots[0].successorJobId),id:'ffffffff-ffff-ffff-ffff-ffffffffffff'})})).*;`)).toThrow(/PT403/);
  expect(oldRows()).toBe(before);
 });
 it('claims trusted bounded v3 context and skips the audited predecessor only, keeping D25/current valid completion protected',()=>{
  const {input}=staged(),old=oldRows(),c=claim()!;expect(c.job.rule_version).toBe('content-v3');
  expect(c.generationContext).toEqual({protocolVersion:'content-v3',generationContractHash:input.h3,predecessorJobId:c.job.generation_predecessor_job_id,emptyDisposition:'findings_expected',sourceReviewDigest:'b'.repeat(64)});
  expect(oldRows()).toBe(old);
  for(const id of ['generation-video-4','generation-video-5'])expect(json(`select public.content_analysis_task_completed(record,${hashSql("record->>'content'")},'summary') from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`)).toBe(true);
 });
 it.each(['rule_version','generation_contract_hash','config_epoch','source_revision','generation_predecessor_job_id'])('v3 identity %s is immutable after staging',column=>{
  staged();const c=claim()!,value=column==='rule_version'?'content-v2':column==='generation_predecessor_job_id'?'ffffffff-ffff-ffff-ffff-ffffffffffff':'f'.repeat(64);
  expect(()=>service(`update public.reader_content_analysis_jobs set ${column}=${q(value)} where id=${q(c.job.id)};`)).toThrow(/PT409/);
 });
 it('keeps terminal failed v3 jobs terminal across epochs and scope changes',()=>{
  staged();const c=claim()!;json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_unsupported_passage',false);`);
  const terminal=job(c.job.id);expect(()=>service(`update public.reader_content_analysis_jobs set state='queued',attempts=0,next_attempt_at='-infinity' where id=${q(c.job.id)};`)).toThrow(/PT409/);
  expect(json(`select public.sync_content_analysis_jobs_v2(${q(owner)},200,'fresh-epoch');`)).toEqual({synchronized:0});expect(job(c.job.id)).toEqual(terminal);
 });
 it('skips a terminal failed v3 row even if a historical due timestamp is finite',()=>{
  staged();activate(['generation-video-2']);const chosen=claim()!;
  service(`update public.reader_content_analysis_jobs set state='failed',error_code='analysis_storage_unavailable',next_attempt_at='-infinity',lease_token=null,lease_until=null where id=${q(chosen.job.id)};`);
  const terminal=job(chosen.job.id),next=claim();expect(next?.job.id).not.toBe(chosen.job.id);expect(job(chosen.job.id)).toEqual(terminal);
 });
 it('resumes explicitly retryable storage failures from queued cache replay, stopping after three claim attempts',()=>{
  staged();activate(['generation-video-2']);let chosen=claim()!;const saved=reserve(chosen).call;save(chosen,saved.id);
  for(let attempt=1;attempt<=3;attempt++){
   const failed=json(`select public.fail_content_analysis_job(${q(chosen.job.id)},${q(chosen.leaseToken)},'analysis_storage_unavailable',true);`),current=job(chosen.job.id);
   expect(current.attempts).toBe(attempt);expect(failed.state).toBe(attempt<3?'queued':'failed');
   expect(record(current.update_id).processing[current.task==='summary'?'recap':'keywords']).toBe(attempt<3?'pending':'failed');
   if(attempt<3){due(chosen);const next=claim()!;expect(next.job.id).toBe(chosen.job.id);chosen=next;expect(reserve(chosen)).toMatchObject({claimed:false,call:{id:saved.id}});}
   else expect(current.next_attempt_at).toBe('infinity');
  }
  expect(json("select count(*) from public.reader_content_analysis_calls where call_key like '%:v3:%';")).toBe(1);
  const terminal=job(chosen.job.id);expect(claim()?.job.id).not.toBe(chosen.job.id);expect(job(chosen.job.id)).toEqual(terminal);
 });
 it.each(['failed','published','skipped','cancelled'])('preserves terminal %s evidence while source enrichment and unfollow remain possible',state=>{
  staged();activate(['generation-video-2']);let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');const chosen=c!;
  if(state==='published'){prepare(chosen,summary(chosen));expect(json(publishSql(chosen))).toBe(true);}
  else service(`update public.reader_content_analysis_jobs set state=${q(state)} where id=${q(chosen.job.id)};`);
  const terminal=job(chosen.job.id),ledger=service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;');
  service(`update public.reader_source_updates set record=record||'{"content":"Later complete saved transcript enrichment."}' where user_id=${q(owner)} and id='generation-video-2';`);
  expect(record('generation-video-2').content).toBe('Later complete saved transcript enrichment.');expect(job(chosen.job.id)).toEqual(terminal);
  service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}',(state->'followedSourceIds')-${q(terminal.source_id)}) where user_id=${q(owner)};`);
  expect(job(chosen.job.id)).toEqual(terminal);expect(service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;')).toBe(ledger);
 });
 it.each(['approve','reject'])('permits post-publication admin %s with only a notification timestamp change to terminal jobs',decision=>{
  staged();activate(['generation-video-2']);let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='keywords');const chosen=c!,j=job(chosen.job.id),r=record(j.update_id);
  const output={state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{protocolVersion:'content-v3',generationContractHash:chosen.job.generation_contract_hash,contentHash:j.content_hash,ruleVersion:'entities-v2',coverage:[{start:0,end:r.content.length}],accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};
  prepare(chosen,output);expect(json(publishSql(chosen))).toBe(true);
  const published=job(chosen.job.id),ledger=service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;');
  const review=json(`select to_jsonb(q) from public.admin_keyword_reviews q where user_id=${q(owner)} and update_id='generation-video-2';`);
  json(`select public.admin_review_keyword(${q(review.id)},${q(review.updated_at)},'synthetic-admin',${q(decision)},'Nvidia','brand');`);
  const after=job(chosen.job.id),withoutNotification=(value:Record<string,unknown>)=>{const copy={...value};delete copy.updated_at;return copy;};
  expect(withoutNotification(after)).toEqual(withoutNotification(published));expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(published.updated_at));
  expect(service(`select status from public.admin_keyword_reviews where id=${q(review.id)};`)).toBe(decision==='approve'?'approved':'rejected');
  expect(service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;')).toBe(ledger);
 });
 it.each(['provider','pricing','adapterVersion','model'])('pins manifest execution identity for fresh reservation %s',field=>{
  staged();const c=claim()!,changed={...identity,[field]:field==='pricing'?{...identity.pricing,version:'changed'}:field==='model'?'minimax/minimax-m3.1-flash':field==='provider'?'other':'changed'};
  expect(()=>reserve(c,undefined,changed)).toThrow(/PT40[09]/);expect(json("select count(*) from public.reader_content_analysis_calls;")).toBe(23);
 });
 it('accepts matching v3 cache keys, exact replay and one settled repair while rejecting cross-version/task/second repair keys',()=>{
  staged();const c=claim()!,key=c.job.task==='summary'?'summary:v3:chunk:0':'extractor:v3:chunk:0',r=reserve(c,key);save(c,r.call.id);mark(c,key);
  expect(reserve(c,key)).toMatchObject({claimed:false,call:{id:r.call.id}});
  expect(json(`select public.read_content_analysis_cached_calls_v2(${q(c.job.id)},${q(c.leaseToken)},array[${q(key)}],null,${q(model)});`).calls).toHaveLength(1);
  for(const bad of [key.replace(':v3:',':v2:'),c.job.task==='summary'?'extractor:v3:chunk:0':'summary:v3:chunk:0',key+':repair:2'])expect(()=>reserve(c,bad)).toThrow(/PT40[09]/);
  expect(()=>json(`select public.read_content_analysis_cached_calls_v2(${q(c.job.id)},${q(c.leaseToken)},array[${q(key.replace(':v3:',':v2:'))}],null,${q(model)});`)).toThrow(/PT409/);
  const repair=reserve(c,key+':repair:1');expect(repair.claimed).toBe(true);save(c,repair.call.id);expect(reserve(c,key+':repair:1').claimed).toBe(false);
 });
 it('refuses v3 verifier repair and independent self-approval of empty output',()=>{
  staged();let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');expect(c).toBeTruthy();const chosen=c!;
  const r=reserve(chosen,'summary:v3:verify:0');save(chosen,r.call.id);
  expect(()=>mark(chosen,'summary:v3:verify:0')).toThrow(/PT409/);expect(()=>reserve(chosen,'summary:v3:verify:0:repair:1')).toThrow(/PT400/);
  const output=summary(chosen,true);Object.assign(output.evidence,{emptyDisposition:'no_findings_reviewed'});expect(()=>prepare(chosen,output)).toThrow(/PT409.*no-findings/s);
 });
 it.each(['findings_expected','unreviewed','no_findings_reviewed'])('empty preparation uses trusted %s disposition',disposition=>{
  quarantine();const i=stageInput(disposition);const omission=i.manifest.slots.find((s:{reason:string})=>s.reason==='audited_empty_omission');
  omission.emptyDisposition='findings_expected';omission.sourceReviewDigest='b'.repeat(64);stage(i);activate(['generation-video-2']);
  let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');expect(c).toBeTruthy();
  if(disposition==='no_findings_reviewed'){expect(prepare(c!,summary(c!,true))).toMatchObject({prepared:true});expect(json(publishSql(c!))).toBe(true);}
  else expect(()=>prepare(c!,summary(c!,true))).toThrow(/PT409.*no-findings/s);
 });
 it('requires protocol/H3 before prepare, then publishes nonempty without touching predecessors or holds',()=>{
  staged();let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');const chosen=c!,old=oldRows(),valid=summary(chosen);
  expect(()=>prepare(chosen,{...valid,evidence:{...valid.evidence,protocolVersion:'content-v2'}})).toThrow(/PT409/);
  expect(()=>prepare(chosen,{...valid,evidence:{...valid.evidence,generationContractHash:'c'.repeat(64)}})).toThrow(/PT409/);
  expect(prepare(chosen,valid)).toMatchObject({prepared:true});expect(json(publishSql(chosen))).toBe(true);expect(oldRows()).toBe(old);
  expect(job(chosen.job.id).state).toBe('published');expect(record(job(chosen.job.id).update_id).videoHighlights).toHaveLength(1);
 });
 it.each(['source','delete','pause','annotation','withhold_audit'])('fences %s changes before further spending/publication',kind=>{
  staged();activate(['generation-video-1']);let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');const chosen=c!;
  if(kind==='withhold_audit')service("update public.admin_audit_events set details=details||'{\"actorType\":\"owner\"}' where action='analysis.summary.withheld';");
  if(kind==='source')service(`update public.reader_source_updates set record=record||'{"content":"Changed synthetic transcript"}' where user_id=${q(owner)} and id='generation-video-1';`);
  if(kind==='delete')service(`delete from public.reader_source_updates where user_id=${q(owner)} and id='generation-video-1';`);
  if(kind==='pause')service(`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1'],'paused');`);
  if(kind==='annotation')service(`update public.reader_source_updates set record=jsonb_set(record,'{videoSummary,status}','"ready"') where user_id=${q(owner)} and id='generation-video-1';`);
  expect(()=>reserve(chosen)).toThrow(/PT409/);expect(json("select count(*) from public.reader_content_analysis_calls;")).toBe(23);
 });
 it('settles existing calls while paused/off and preserves three unrelated old unknown holds',()=>{
  staged();const c=claim()!,r=reserve(c);service(`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1','generation-video-2','generation-video-3'],'paused');update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;`);
  expect(save(c,r.call.id)).toMatchObject({state:'settled',actual_usd:.0001});expect(()=>reserve(c)).toThrow(/PT409/);
  expect(json('select sum(maximum_usd) from public.reader_content_analysis_calls where actual_usd is null;')).toBe(.009178191);
 });
 it('fixed original smoke anchor survives restored $5 limits and midnight',()=>{
  staged();const c=claim()!;
  // Unrelated known-settled synthetic spend remains globally committed. Dates
  // change only in the disposable fixture; outer daily/lifetime remain $5.
  service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state,created_at)
   values(null,'unrelated-owner','synthetic-anchor',gen_random_uuid(),${q(model)},${q('d'.repeat(64))},.244,.244,.244,'settled','2000-01-01');`);
  const before=service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;');
  expect(()=>reserve(c,undefined,undefined,.001)).toThrow(/PT402.*smoke/s);
  expect(service('select jsonb_agg(to_jsonb(c) order by id) from public.reader_content_analysis_calls c;')).toBe(before);
 });
 it('three no-progress continuation yields terminate v3 while settled materialization resets the stall count',()=>{
  staged();activate(['generation-video-2']);let c=claim()!;const original=c.job.id;
  for(let n=0;n<2;n++){json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_worker_yield',false,true);`);due(c);c=claim()!;}
  const r=reserve(c);save(c,r.call.id);json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_worker_yield',false,true);`);expect(job(c.job.id).continuation_stalls).toBe(0);
  for(let n=0;n<3;n++){due(c);c=claim()!;json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_worker_yield',false,true);`);}
  expect(job(original)).toMatchObject({state:'failed',error_code:'analysis_no_progress',next_attempt_at:'infinity'});
 });
 it('scope pause wins a concurrent claim without changing staged jobs or reserving any spend',async()=>{
  staged();const a=new Session(args),b=new Session(args);
  try{await a.run(`begin;set local role service_role;select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1','generation-video-2','generation-video-3'],'paused');`);
   const pending=b.run('set role service_role;'+claimSql());await waiting('claim_content_analysis_job_v2');await a.run('commit;');expect(await pending).toBe('');expect(claim()).toBeNull();
  }finally{a.close();b.close();}
 });
 it.each(['global_enabled','reader_enabled','scope_active','lease_active'])('stage rejects nonquiescent %s without a mutation',kind=>{
  quarantine();
  if(kind==='global_enabled')service('update public.content_analysis_budget set enabled=true;');
  if(kind==='reader_enabled')service('update public.reader_content_analysis_policies set enabled=true;');
  if(kind==='scope_active')service(`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1','generation-video-2','generation-video-3'],'evaluation');`);
  if(kind==='lease_active')service("update public.reader_content_analysis_jobs set state='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes' where rule_version='content-v2' and state='failed';");
  const i=stageInput(),before=service(snapshot(true));expect(()=>stage(i)).toThrow(/PT409/);expect(service(snapshot(true))).toBe(before);
 });
 it('audit failure rolls back the entire staged manifest and every new job',()=>{
  quarantine();const i=stageInput(),before=service(snapshot(true));
  sql(`create function public.synthetic_v3_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic audit unavailable';end;$$;
   create trigger synthetic_v3_audit_failure before insert on public.admin_audit_events for each row execute function public.synthetic_v3_audit_failure();`);
  try{expect(()=>stage(i)).toThrow(/synthetic audit unavailable/);expect(service(snapshot(true))).toBe(before);}
  finally{sql('drop trigger synthetic_v3_audit_failure on public.admin_audit_events;drop function public.synthetic_v3_audit_failure();');}
 });
 it.each(['same_job_unknown','cross_version_unknown','orphan_unknown','smoke_cap'])('verified-zero UPDATE repeats %s fresh-spend fence with attempt history atomic',kind=>{
  staged();activate(['generation-video-2']);let c=claim()!;const previous=verifiedZero(c);c=claim()!;
  expect(c.job.id).toBe(previous.job_id);
  if(kind==='same_job_unknown')reserve(c,c.job.task==='summary'?'summary:v3:chunk:1':'extractor:v3:chunk:1');
  else if(kind==='smoke_cap')service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state)
   values(null,'unrelated-owner','synthetic-ceiling',gen_random_uuid(),${q(model)},${q('e'.repeat(64))},.244,.244,.244,'settled');`);
  else {
   sql('alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;');
   const predecessor=job(c.job.generation_predecessor_job_id);
   service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd)
    values(${kind==='orphan_unknown'?'null':q(predecessor.id)},${q(owner)},'synthetic-later-unknown',gen_random_uuid(),${q(model)},${q(predecessor.source_revision)},.001);`);
   sql('alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;');
  }
  const before=call(previous.id);expect(()=>reserve(c)).toThrow(kind==='smoke_cap'?/PT402.*smoke/s:/PT409.*Unresolved/s);expect(call(previous.id)).toEqual(before);
  expect(json('select count(*) from public.reader_content_analysis_call_attempts;')).toBe(0);
 });
 it('verified-zero UPDATE preserves one archived attempt and immutable pinned identity',()=>{
  staged();activate(['generation-video-2']);let c=claim()!;const previous=verifiedZero(c);c=claim()!;const r=reserve(c);
  expect(r).toMatchObject({claimed:true,call:{id:previous.id,attempt_number:2,actual_usd:null,execution_identity:identity}});
  expect(json('select count(*) from public.reader_content_analysis_call_attempts;')).toBe(1);
 });
 it.each(['pause-first','publish-first'])('scope and %s publication serialize without overwriting a paused result',async order=>{
  staged();activate(['generation-video-1']);let c:Claim|null;do{c=claim();}while(c&&c.job.task!=='summary');const chosen=c!;prepare(chosen,summary(chosen));
  const before=job(chosen.job.id),a=new Session(args),b=new Session(args);
  const pauseSql=`select public.set_content_analysis_rollout_scope(${q(owner)},array['generation-video-1'],'paused');`;
  try{await a.run('begin;set local role service_role;'+(order==='pause-first'?pauseSql:publishSql(chosen)));
   const pending=b.run('set role service_role;'+(order==='pause-first'?publishSql(chosen):pauseSql)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting(order==='pause-first'?'publish_content_analysis_job':'set_content_analysis_rollout_scope');await a.run('commit;');const result=await pending;
   if(order==='pause-first'){expect(result.error).toMatch(/PT409.*scope paused/s);expect(job(chosen.job.id)).toEqual(before);expect(record().videoSummary.status).toBe('unavailable');}
   else{expect(result.error).toBe('');expect(job(chosen.job.id).state).toBe('published');expect(record().videoSummary.status).toBe('ready');}
  }finally{a.close();b.close();}
 });
 it('two fresh reservations serialize at the original smoke ceiling without overspend or partial holds',async()=>{
  staged();const c1=claim()!,c2=claim()!;
  service(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,observed_usd,state)
   values(null,'unrelated-owner','synthetic-near-ceiling',gen_random_uuid(),${q(model)},${q('e'.repeat(64))},.243,.243,.243,'settled');`);
  const a=new Session(args),b=new Session(args);
  try{await a.run('begin;set local role service_role;'+reserveSql(c1));
   const pending=b.run('set role service_role;'+reserveSql(c2)).then(value=>({value,error:''}),error=>({value:'',error:String(error)}));
   await waiting('reserve_content_analysis_call_v3');await a.run('commit;');expect((await pending).error).toMatch(/PT402.*smoke/s);
   expect(json("select count(*) from public.reader_content_analysis_calls where call_key like '%:v3:%';")).toBe(1);
   expect(json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;')).toBeLessThanOrEqual(.268365907);
  }finally{a.close();b.close();}
 });

 it('new functions keep empty search paths and no PUBLIC execute; only bounded staging is a definer',()=>{
  const names=['content_analysis_generation_v3_contract_hash','content_analysis_generation_v3_digest','content_analysis_generation_v3_ledger_hash',
   'content_analysis_generation_v3_slot','content_analysis_generation_job_in_scope','content_analysis_generation_job_completed','content_analysis_generation_v3_withhold_valid',
   'preserve_content_analysis_generation_v3_scope','preserve_content_analysis_generation_v3_job','stage_content_analysis_generation_v3','validate_content_analysis_generation_v3_result'];
  const metadata=json(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'config',p.proconfig,
   'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${names.map(q).join(',')}]);`);
  expect(metadata).toHaveLength(names.length);
  for(const row of metadata)expect(row).toMatchObject({config:['search_path=""'],publicExecute:false,definer:row.name==='stage_content_analysis_generation_v3'});
 });

 it('v3 retains the unchanged US$0.01 per-call cap',()=>{
  staged();const c=claim()!;expect(()=>reserve(c,undefined,undefined,.010000000001)).toThrow(/PT40[03]/);
  expect(json('select count(*) from public.reader_content_analysis_calls;')).toBe(23);
 });

 it('SQL pins the frozen canonical engine contract exactly',()=>{
  expect(service('select public.content_analysis_generation_v3_contract_hash();')).toBe(ANALYSIS_V3_CONTRACT_HASH);
  expect(ANALYSIS_V3_CONTRACT_HASH).toBe('8b45295994cadc1798f29d61675f169687c5cf187de289c48eb117b5b62d0946');
 });

});
