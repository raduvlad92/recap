import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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


describe.skipIf(!available)('Nonpublishing v4 model comparison, disposable PostgreSQL 17', () => {
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
  root=mkdtempSync('/tmp/rccm-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55507`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55507','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   const own=name.endsWith('_content_analysis_model_comparison_evaluation.sql');
   if(own){seed();beforeMigration=service(snapshot(true));}
   sql(readFileSync(new URL(name,directory),'utf8'));
   if(own)afterMigration=service(snapshot(true));
  }
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;
   truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   truncate public.content_analysis_admissions cascade;truncate public.content_analysis_model_comparisons cascade;truncate public.content_analysis_provider_cooldowns;truncate public.admin_audit_events;`);
  seed();
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});

 const commonLimits={chunkChars:1250,maxOutputTokens:3072,maxInputTokens:27700,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxCallUsd:.10};
 type Claim={job:{id:string;update_id:string;content_hash:string;task:string;generation_contract_hash:string;generation_admission_id:string};leaseToken:string;generationContext:Record<string,unknown>};
 const record=(id:string)=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`);
 function input(tasks:Array<[string,string]>=[['generation-video-1','keywords'],['generation-video-2','keywords'],['generation-video-3','keywords']]){
  service(`update public.reader_content_analysis_policies set per_call_limit_usd=.10 where user_id=${q(owner)};`);
  const slots=tasks.map(([id,task])=>json(`select jsonb_build_object('jobId',gen_random_uuid(),'predecessorJobId',null,
   'updateId',a.id,'sourceId',a.source_id,'task',${q(task)},'contentHash',encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),
   'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),
   'currentAnnotationHash',public.content_analysis_model_comparison_annotation_hash(a.record,${q(task)}),
   'adminReviewHash',public.content_analysis_model_comparison_review_hash(a.user_id,a.id),'sourceReviewDigest',repeat('b',64),'emptyDisposition','findings_expected')
   from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id where a.user_id=${q(owner)} and a.id=${q(id)};`));
  const revision=json('select revision from public.content_analysis_runtime_settings where id;');
  return {id:service('select gen_random_uuid();'),key:'synthetic-comparison-only',workspaceRevision:json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`),
   manifest:{purpose:'content_model_comparison',phase:'comparison',suiteId:'synthetic-frozen-three',round:1,spendingDisabled:true,workersDrained:true,commonLimits,
    protocolVersion:'content-v4',generationContractHash:service('select public.content_analysis_generation_v4_contract_hash();'),executionIdentity:identity,
    selectionRevision:revision,configEpoch:`openrouter-2026-10-24-v2:${model}:${revision}:${'e'.repeat(64)}`,
    expectedLedgerHash:service('select public.content_analysis_generation_v3_ledger_hash();'),
    expectedCommittedUsd:json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls;'),
    overallCommitmentCeilingUsd:5,maximumFreshUsd:.10,maximumCalls:20,perCallMaximumUsd:.10,sourceReviewDigest:'b'.repeat(64),slots},};
 }
 type Input=ReturnType<typeof input>;
 const stageSql=(i:Input)=>`select public.stage_content_analysis_comparison(${q(owner)},${q(i.workspaceRevision)},${q(i.id)},${q(i.key)},${jsonSql(i.manifest)});`;
 const stage=(i:Input)=>json(stageSql(i));
 const admission=(id:string)=>json(`select to_jsonb(d) from public.content_analysis_admissions d where id=${q(id)};`);
 const transition=(i:Input,action:string)=>json(`select public.set_content_analysis_admission_state(${q(i.id)},${admission(i.id).revision},${q(action)},${q(admission(i.id).manifest_digest)},${q('c'.repeat(64))});`);
 const activate=()=>service(`update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`);
 const off=()=>service('update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;');
 const claim=():Claim|null=>json(`select public.claim_content_analysis_job_v2(${q(owner)},900);`);
 const staged=()=>{const i=input();stage(i);transition(i,'release');activate();return i;};
 const reserveSql=(c:Claim,key='extractor:v4:chunk:0',maximum=.001)=>`select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(model)},${jsonSql(identity)},${q(requestHash)});`;
 const reserve=(c:Claim,key?:string,maximum?:number)=>json(reserveSql(c,key,maximum));
 const save=(c:Claim,id:string,actual:number|null=.0001)=>json(`select public.record_content_analysis_call_result(${q(id)},${q(c.leaseToken)},${jsonSql({value:{synthetic:true},requestHash})},'{}',null,${actual??'null'},${actual??'null'});`);
 function output(c:Claim){const r=record(c.job.update_id);return {state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],
  evidence:{protocolVersion:'content-v4',generationContractHash:c.job.generation_contract_hash,contentHash:c.job.content_hash,ruleVersion:'entities-v2',coverage:[{start:0,end:r.content.length}],
   accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};}
 const prepare=(c:Claim,result=output(c))=>json(`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${jsonSql(result)});`);
 const complete=(c:Claim)=>json(`select public.complete_content_analysis_comparison_job(${q(c.job.id)},${q(c.leaseToken)});`);
 const fail=(c:Claim)=>json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},'analysis_invalid_output',false,false);`);
 const protectedState=()=>service(`select jsonb_build_object(
  'archives',(select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a),
  'workspaces',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
  'scopes',(select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s),
  'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
  'oldJobs',(select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where generation_admission_id is null),
  'oldCalls',(select jsonb_agg(to_jsonb(c) order by c.id) from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs j on j.id=c.job_id where j.generation_admission_id is null));`);

 it('applies without changing existing rows or enabling work',()=>{
  expect(afterMigration).toBe(beforeMigration);expect(claim()).toBeNull();
  expect(service('select enabled from public.content_analysis_budget;')).toBe('f');
 });
 it('stages three fresh keyword jobs while preserving all source and financial history',()=>{
  const i=input(),before=protectedState();stage(i);expect(protectedState()).toBe(before);
  expect(service(`select count(*) from public.reader_content_analysis_jobs where generation_admission_id=${q(i.id)};`)).toBe('3');expect(claim()).toBeNull();
 });
 it('claims, prepares and completes without publishing or creating reviews',()=>{
  const before=protectedState(),i=staged(),c=claim()!;
  expect(c.generationContext.purpose).toBe('content_model_comparison');expect(c.generationContext.commonLimits).toEqual(commonLimits);
  expect(protectedState()).toBe(before);const r=reserve(c);save(c,r.call.id);prepare(c);expect(complete(c)).toBe(true);
  expect(service(`select state from public.reader_content_analysis_jobs where id=${q(c.job.id)};`)).toBe('evaluated');
  expect(service(`select published_at is null and lease_token is null and lease_until is null from public.reader_content_analysis_jobs where id=${q(c.job.id)};`)).toBe('t');
  expect(protectedState()).toBe(before);off();transition(i,'close');expect(()=>transition(i,'release')).toThrow();
 });
 it('refuses the publication RPC and direct comparison published state',()=>{
  const before=protectedState();staged();const c=claim()!,r=reserve(c);save(c,r.call.id);prepare(c);
  expect(()=>json(`select public.publish_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)});`)).toThrow();
  expect(()=>service(`update public.reader_content_analysis_jobs set state='published' where id=${q(c.job.id)};`)).toThrow();expect(protectedState()).toBe(before);
 });
 it.each(['ordinary failure','revoked spending'])('preserves source processing and reviews on %s',mode=>{
  const before=protectedState();staged();const c=claim()!;if(mode==='revoked spending')off();
  expect(fail(c).state).toBe(mode==='revoked spending'?'blocked':'failed');expect(protectedState()).toBe(before);
 });
 it('allows completed keyword sources while still fencing their exact existing annotations',()=>{
  service(`update public.reader_source_updates set record=record||jsonb_build_object('keywordContentHash',encode(sha256(convert_to(record->>'content','UTF8')),'hex'),'keywordRuleVersion','entities-v2','videoKeywords','[{"label":"Existing","ranges":[]}]'::jsonb,'processing',jsonb_build_object('keywords','ready')) where user_id=${q(owner)} and id='generation-video-3';`);
  const before=protectedState();staged();for(let n=0;n<3;n++){const c=claim()!,r=reserve(c);save(c,r.call.id);prepare(c);complete(c);}expect(protectedState()).toBe(before);
 });
 it('keeps terminal evaluated result and paid calls immutable across source/follow changes',()=>{
  staged();const c=claim()!,r=reserve(c);save(c,r.call.id);prepare(c);complete(c);
  const before=service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(c.job.id)};`);
  expect(()=>service(`update public.reader_content_analysis_jobs set state='queued' where id=${q(c.job.id)};`)).toThrow();
  expect(()=>service(`update public.reader_content_analysis_jobs set result='{}' where id=${q(c.job.id)};`)).toThrow();
  expect(()=>reserve(c)).toThrow();expect(()=>complete(c)).toThrow();
  service(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"Changed saved source."') where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  service(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]') where user_id=${q(owner)};`);
  expect(service(`select to_jsonb(j) from public.reader_content_analysis_jobs j where id=${q(c.job.id)};`)).toBe(before);
 });
 it('cannot directly mark a running comparison evaluated without validated prepared output',()=>{
  staged();const c=claim()!;
  expect(()=>service(`update public.reader_content_analysis_jobs set state='evaluated',lease_token=null,lease_until=null where id=${q(c.job.id)};`)).toThrow();
 });
 it('makes duplicate staging idempotent but refuses a new job/round/key for a consumed model',()=>{
  const i=input();stage(i);expect(stage(i).staged).toBe(true);transition(i,'close');
  const next=input();next.manifest.round=2;next.key='different-retry-key';expect(()=>stage(next)).toThrow();expect(()=>stage(i)).toThrow();
 });
 it.each(['minimax/minimax-m3.1-flash','openai/gpt-6.1-sol-pro'])('supports %s on the same sealed suite after closing the first',nextModel=>{
  const first=input();stage(first);transition(first,'close');
  json(`select public.admin_set_analysis_model('synthetic-reviewer',${q(nextModel)},(select revision from public.content_analysis_runtime_settings where id));`);
  const mini=nextModel.startsWith('minimax/'),provider=mini?'together':'openai';
  const next=input();next.manifest.executionIdentity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider,model:nextModel,reasoningEffort:'low',pricing:{version:`openrouter-2026-10-24-v2:${nextModel}:${provider}`,inputUsdPerMillion:mini?.15:2,outputUsdPerMillion:mini?.6:10,cachedInputUsdPerMillion:mini?.015:.1,cacheWriteApplies:!mini,cacheWriteUsdPerMillion:mini?null:2.5}} as any;
  next.manifest.configEpoch=`openrouter-2026-10-24-v2:${nextModel}:${next.manifest.selectionRevision}:${'e'.repeat(64)}`;
  expect(stage(next).staged).toBe(true);expect(admission(first.id).state).toBe('closed');
 });
 it('supports an exactly six-slot recap and keyword comparison without changing old staging',()=>{
  const tasks:Array<[string,string]>=['generation-video-1','generation-video-2','generation-video-3'].flatMap(id=>[[id,'summary'],[id,'keywords']] as Array<[string,string]>);
  expect(stage(input(tasks)).staged).toBe(true);
 });
 it('enforces finite per-profile commitment including settled earlier requests',()=>{
  staged();const c=claim()!,r=reserve(c,undefined,.07);save(c,r.call.id,.06);
  expect(()=>reserve(c,'checker:v4:chunk:0',.05)).toThrow();
 });
 it('rejects a changed cohort for the same suite even under another model',()=>{
  const first=input();stage(first);transition(first,'close');const next=input([['generation-video-1','keywords'],['generation-video-2','keywords'],['generation-video-4','keywords']]);expect(()=>stage(next)).toThrow();
 });
 it('preserves all unknown historical holds and blocks an unsettled same-job charge',()=>{
  staged();const c=claim()!,r=reserve(c);save(c,r.call.id,null);expect(()=>prepare(c)).toThrow();expect(()=>reserve(c,'checker:v4:chunk:0')).toThrow();
  expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('4');
 });
 it('blocks source/task unknown holds at staging',()=>{
  const i=input(),s=i.manifest.slots[0];sql(`alter table public.reader_content_analysis_calls disable trigger fence_content_analysis_v2_call;
   insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state)
   select id,user_id,'synthetic-unknown-comparison',gen_random_uuid(),${q(model)},source_revision,.001,'unknown' from public.reader_content_analysis_jobs where update_id=${q(s.updateId)} and task='keywords' limit 1;
   alter table public.reader_content_analysis_calls enable trigger fence_content_analysis_v2_call;`);expect(()=>stage(input())).toThrow();
 });
 it.each(['contentHash','sourceRevision','sourceFingerprint','currentAnnotationHash','adminReviewHash','sourceReviewDigest'])('rejects a drifted %s seal',field=>{
  const i=input();i.manifest.slots[0][field]='invalid';expect(()=>stage(i)).toThrow();
 });
 it('stops reserves and completes after a private review changes',()=>{
  staged();const c=claim()!;service(`insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
   select user_id,id,source_id,${q(c.job.content_hash)},'RTX 5090','product',60,'Synthetic changed review','RTX 5090','[]','','' from public.reader_source_updates where user_id=${q(owner)} and id=${q(c.job.update_id)};`);
  expect(()=>reserve(c)).toThrow();expect(()=>complete(c)).toThrow();const before=protectedState();expect(fail(c).state).toBe('blocked');expect(protectedState()).toBe(before);
 });
 it.each(['spendingDisabled','workersDrained','commonLimits','suiteId','round','purpose','phase','protocolVersion','generationContractHash','sourceReviewDigest','configEpoch','maximumFreshUsd','maximumCalls','overallCommitmentCeilingUsd','perCallMaximumUsd'])('rejects null %s',field=>{
  const i=input();(i.manifest as any)[field]=null;expect(()=>stage(i)).toThrow();
 });
 it('enforces actual off gates, fresh ledger, per-call limit and remaining global cap',()=>{
  let i=input();i.manifest.expectedLedgerHash='f'.repeat(64);expect(()=>stage(i)).toThrow();
  i=input();i.manifest.maximumFreshUsd=5;expect(()=>stage(i)).toThrow();
  i=input();i.manifest.commonLimits={...commonLimits,maxOutputTokens:8192};expect(()=>stage(i)).toThrow();
  i=input();activate();expect(()=>stage(i)).toThrow();off();
  staged();const c=claim()!;expect(()=>reserve(c,undefined,.1000000001)).toThrow();
 });
 it('cannot use comparison completion for a noncomparison job or accept comparison to unlock expansion',()=>{
  const i=staged();const prior=service(`select id from public.reader_content_analysis_jobs where generation_admission_id is null limit 1;`);
  expect(()=>json(`select public.complete_content_analysis_comparison_job(${q(prior)},gen_random_uuid());`)).toThrow();off();expect(()=>transition(i,'accept')).toThrow();
 });
 it('denies ordinary-reader and anonymous execution of new functions',()=>{
  for(const role of ['anon','authenticated'])for(const signature of ['stage_content_analysis_comparison(text,timestamptz,uuid,text,jsonb)','complete_content_analysis_comparison_job(uuid,uuid)','content_analysis_is_comparison_job(uuid)','content_analysis_comparison_cohort_digest(jsonb)'])
   expect(sql(`select has_function_privilege(${q(role)},${q('public.'+signature)},'execute');`)).toBe('f');
 });
 it('serializes simultaneous same-key reservations into one financial row',async()=>{
  staged();const c=claim()!,a=new Session(args),b=new Session(args);try{
   const receipts=await Promise.all([a.run('set role service_role;'+reserveSql(c)),b.run('set role service_role;'+reserveSql(c))]);
   expect(receipts.map(v=>JSON.parse(v)).filter(r=>r.claimed)).toHaveLength(1);
  }finally{a.close();b.close();}
 });
});
