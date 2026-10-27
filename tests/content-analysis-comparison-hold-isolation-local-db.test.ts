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


describe.skipIf(!available)('Closed comparison hold isolation, disposable PostgreSQL 17', () => {
 let root: string, args: string[], started=false, beforeMigration:string, afterMigration:string, beforeGuards:string, afterGuards:string;
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
  root=mkdtempSync('/tmp/rchi-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55511`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55511','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   const own=name.endsWith('_content_analysis_comparison_hold_isolation.sql');
   if(own){seed();closedOrigin();beforeMigration=service(snapshot(true));beforeGuards=unchangedGuards();}
   sql(readFileSync(new URL(name,directory),'utf8'));
   if(own){afterMigration=service(snapshot(true));afterGuards=unchangedGuards();}
  }
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;
   truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;
   truncate public.content_analysis_admissions cascade;truncate public.content_analysis_model_comparisons cascade;truncate public.content_analysis_provider_cooldowns;truncate public.admin_audit_events;`);
  seed();
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});

 const solIdentity={...identity,model:'openai/gpt-6.1-sol-pro',reasoningEffort:'low',pricing:{version:'openrouter-2026-10-24-v2:openai/gpt-6.1-sol-pro:openai',inputUsdPerMillion:2,outputUsdPerMillion:10,cachedInputUsdPerMillion:.1,cacheWriteApplies:true,cacheWriteUsdPerMillion:2.5}};
 const heldMaximum=.004574875;
 const commonLimits={chunkChars:1250,maxOutputTokens:3072,maxInputTokens:27700,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxCallUsd:.10};
 type Claim={job:{id:string;update_id:string;content_hash:string;task:string;generation_contract_hash:string;generation_admission_id:string};leaseToken:string;generationContext:Record<string,unknown>};
 const record=(id:string)=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id=${q(id)};`);
 function input(tasks:Array<[string,string]>=[['generation-video-1','keywords'],['generation-video-2','keywords'],['generation-video-3','keywords']],profile=solIdentity,suiteId='synthetic-frozen-three'){
  service(`update public.reader_content_analysis_policies set per_call_limit_usd=.10 where user_id=${q(owner)};`);
  const slots=tasks.map(([id,task])=>json(`select jsonb_build_object('jobId',gen_random_uuid(),'predecessorJobId',null,
   'updateId',a.id,'sourceId',a.source_id,'task',${q(task)},'contentHash',encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),
   'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),
   'currentAnnotationHash',public.content_analysis_model_comparison_annotation_hash(a.record,${q(task)}),
   'adminReviewHash',public.content_analysis_model_comparison_review_hash(a.user_id,a.id),'sourceReviewDigest',repeat('b',64),'emptyDisposition','findings_expected')
   from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id where a.user_id=${q(owner)} and a.id=${q(id)};`));
  const revision=json('select revision from public.content_analysis_runtime_settings where id;');
  return {id:service('select gen_random_uuid();'),key:'synthetic-comparison-only',workspaceRevision:json(`select to_jsonb(updated_at) from public.reader_workspaces where user_id=${q(owner)};`),
   manifest:{purpose:'content_model_comparison',phase:'comparison',suiteId,round:1,spendingDisabled:true,workersDrained:true,commonLimits:structuredClone(commonLimits),
    protocolVersion:'content-v4',generationContractHash:service('select public.content_analysis_generation_v4_contract_hash();'),executionIdentity:structuredClone(profile),
    selectionRevision:revision,configEpoch:`openrouter-2026-10-24-v2:${profile.model}:${revision}:${'e'.repeat(64)}`,
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
 
 const reserveSql=(c:Claim,key=c.job.task==='summary'?'summary:v4:verify:0':'extractor:v4:chunk:0',maximum=.001)=>{
  const profile=admission(c.job.generation_admission_id).manifest.executionIdentity;
  return `select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(profile.model)},${jsonSql(profile)},${q(requestHash)});`;
 };
 const reserve=(c:Claim,key?:string,maximum?:number)=>json(reserveSql(c,key,maximum));
 const save=(c:Claim,id:string,actual:number|null=.0001)=>{
  const profile=admission(c.job.generation_admission_id).manifest.executionIdentity;
  const value=c.job.task==='summary'?{readComplete:true,verdicts:[{id:'s0',supported:true,sameFinding:true,reason:'Supported synthetic claim.'}]}:{synthetic:true};
  return json(`select public.record_content_analysis_call_result(${q(id)},${q(c.leaseToken)},${jsonSql({value,requestHash,executionIdentity:profile})},'{}',null,${actual??'null'},${actual??'null'});`);
 };
 function output(c:Claim){const r=record(c.job.update_id);return c.job.task==='summary'?{
  state:'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:c.job.content_hash,timingBasis:'none'},videoHighlights:[{text:'Nvidia makes the RTX 5090.'}]},
  evidence:{protocolVersion:'content-v4',generationContractHash:c.job.generation_contract_hash,contentHash:c.job.content_hash,sourceContentState:'partial',coverage:[{start:0,end:r.content.length}],verification:[{id:'s0',supported:true,sameFinding:true,reason:'Supported synthetic claim.'}],selected:[{text:'Nvidia makes the RTX 5090.',evidenceQuote:'Nvidia makes RTX 5090.'}]}
 }:{state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],
  evidence:{protocolVersion:'content-v4',generationContractHash:c.job.generation_contract_hash,contentHash:c.job.content_hash,ruleVersion:'entities-v2',coverage:[{start:0,end:r.content.length}],
   accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};}
 const prepare=(c:Claim,result=output(c))=>json(`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${jsonSql(result)});`);
 const complete=(c:Claim)=>json(`select public.complete_content_analysis_comparison_job(${q(c.job.id)},${q(c.leaseToken)});`);
 const fail=(c:Claim,code='analysis_invalid_output')=>json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${q(code)},false,false);`);
 const protectedState=()=>service(`select jsonb_build_object(
  'archives',(select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a),
  'workspaces',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
  'scopes',(select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s),
  'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
  'oldJobs',(select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where generation_admission_id is null),
  'oldCalls',(select jsonb_agg(to_jsonb(c) order by c.id) from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs j on j.id=c.job_id where j.generation_admission_id is null));`);

 function unchangedGuards(){return sql(`select jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) order by p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')
   and p.proname not in ('content_analysis_comparison_unknown_hold','content_analysis_admission_current','stage_content_analysis_comparison','fence_content_analysis_admitted_call');`);}
 function closedOrigin(){
  const i=input(undefined,identity);stage(i);transition(i,'release');activate();let heldId='',heldClaim:Claim|undefined;
  for(let n=0;n<3;n++){const c=claim()!;if(c.job.update_id==='generation-video-2'){heldId=reserve(c,undefined,heldMaximum).call.id;heldClaim=c;fail(c,'analysis_unknown_charge_hold');}else fail(c);}
  off();transition(i,'close');return {i,heldId,heldClaim:heldClaim!};
 }
 function selectSol(){json(`select public.admin_set_analysis_model('synthetic-reviewer',${q(solIdentity.model)},(select revision from public.content_analysis_runtime_settings where id));`);}
 const held=(i:Input,except?:string)=>json(`select public.content_analysis_comparison_unknown_hold(${q(owner)},'generation-video-2','keywords',${jsonSql(i.manifest)},${except?q(except):'null'});`);
 const heldRow=(id:string)=>service(`select to_jsonb(c)::text from public.reader_content_analysis_calls c where id=${q(id)};`);
 // Corruptions below are deliberately confined to this synthetic disposable DB.
 // They exercise fail-closed handling; no production mutation can use this helper.
 function corrupt(query:string){sql('alter table public.reader_content_analysis_calls disable trigger user;alter table public.reader_content_analysis_jobs disable trigger user;'+query+'alter table public.reader_content_analysis_jobs enable trigger user;alter table public.reader_content_analysis_calls enable trigger user;');}
 function alterManifest(id:string,change:(value:any)=>void){const value=admission(id).manifest;change(value);sql(`update public.content_analysis_admissions set manifest=${jsonSql(value)},manifest_digest=public.content_analysis_generation_v3_digest(${jsonSql(value)}),predecessor_digest=public.content_analysis_generation_v3_digest(jsonb_build_array(${jsonSql(value)}->>'suiteId',${jsonSql(value)}#>>'{executionIdentity,model}',public.content_analysis_comparison_cohort_digest(case when jsonb_typeof(${jsonSql(value)}->'slots')='array' then ${jsonSql(value)}->'slots' else '[]'::jsonb end))) where id=${q(id)};`);}
 function oldState(except:string){return service(`select jsonb_build_object(
  'archives',(select jsonb_agg(to_jsonb(a) order by user_id,id) from public.reader_source_updates a),
  'workspaces',(select jsonb_agg(to_jsonb(w) order by user_id) from public.reader_workspaces w),
  'scopes',(select jsonb_agg(to_jsonb(s) order by user_id) from public.content_analysis_rollout_scopes s),
  'reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.admin_keyword_reviews r),
  'jobs',(select jsonb_agg(to_jsonb(j) order by id) from public.reader_content_analysis_jobs j where generation_admission_id is distinct from ${q(except)}::uuid),
  'calls',(select jsonb_agg(to_jsonb(c) order by c.id) from public.reader_content_analysis_calls c left join public.reader_content_analysis_jobs j on j.id=c.job_id where j.generation_admission_id is distinct from ${q(except)}::uuid),
  'attempts',(select jsonb_agg(to_jsonb(a) order by call_id,attempt_number) from public.reader_content_analysis_call_attempts a),
  'admissions',(select jsonb_agg(to_jsonb(d) order by id) from public.content_analysis_admissions d where id<>${q(except)}::uuid));`);}

 it('adds the narrow predicate without changing rows or unrelated legacy/H3/H4 function definitions',()=>{
  expect(afterMigration).toBe(beforeMigration);expect(afterGuards).toBe(beforeGuards);
  expect(service('select enabled from public.content_analysis_budget;')).toBe('f');
 });
 it('permits the first Sol keyword trial despite an exact closed Luna hold and preserves prior bytes',()=>{
  const origin=closedOrigin(),beforeCall=heldRow(origin.heldId);selectSol();const next=input(),before=oldState(next.id);
  expect(held(next)).toBe(false);expect(json(`select public.content_analysis_v2_unknown_hold(${q(owner)},'generation-video-2','keywords');`)).toBe(true);
  stage(next);transition(next,'release');activate();let completed=0;
  for(let n=0;n<3;n++){const c=claim()!;expect(c).not.toBeNull();const r=reserve(c);save(c,r.call.id);prepare(c);expect(complete(c)).toBe(true);completed++;}
  off();transition(next,'close');expect(completed).toBe(3);expect(oldState(next.id)).toBe(before);expect(heldRow(origin.heldId)).toBe(beforeCall);
  expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('4');
  expect(service(`select actual_usd is null and maximum_usd=${heldMaximum} from public.reader_content_analysis_calls where id=${q(origin.heldId)};`)).toBe('t');
 });
 it('stops when Sol itself gains an ambiguous call and never retries its held key',()=>{
  const origin=closedOrigin();selectSol();const next=input();stage(next);transition(next,'release');activate();
  const claims=[claim()!,claim()!,claim()!],c=claims.find(c=>c.job.update_id==='generation-video-2')!,r=reserve(c);
  expect(()=>reserve(c,'checker:v4:chunk:0')).toThrow();expect(reserve(c).claimed).toBe(false);expect(reserve(c).call.id).toBe(r.call.id);
  expect(()=>prepare(c)).toThrow();expect(()=>complete(c)).toThrow();expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('5');
  expect(service(`select actual_usd is null and maximum_usd=${heldMaximum} from public.reader_content_analysis_calls where id=${q(origin.heldId)};`)).toBe('t');
 });
 it.each(['staged','released','paused'])('blocks an origin admission left %s',state=>{
  const origin=closedOrigin();sql(`update public.content_analysis_admissions set state=${q(state)} where id=${q(origin.i.id)};`);selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it.each(['suite','round','limits','review','cohort','slot','manifest-shape','manifest-hash','missing-per-call','wrong-purpose'])('fails closed for changed origin %s',kind=>{
  const origin=closedOrigin();
  if(kind==='manifest-hash')sql(`update public.content_analysis_admissions set manifest_digest=repeat('f',64) where id=${q(origin.i.id)};`);
  else if(kind==='wrong-purpose')sql(`update public.content_analysis_admissions set purpose='content_v4_evaluation' where id=${q(origin.i.id)};`);
  else alterManifest(origin.i.id,m=>{
   if(kind==='suite')m.suiteId='different-suite';if(kind==='round')m.round=2;if(kind==='limits')m.commonLimits.maxOutputTokens=8192;
   if(kind==='review')m.sourceReviewDigest='c'.repeat(64);if(kind==='cohort')m.slots[0].contentHash='c'.repeat(64);
   if(kind==='slot')m.slots.find((s:any)=>s.updateId==='generation-video-2').jobId='00000000-0000-4000-8000-000000000000';
   if(kind==='manifest-shape')m.slots={malformed:true};if(kind==='missing-per-call')delete m.perCallMaximumUsd;
  });
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it.each(['same-model','null-model','bad-identity','missing-round','null-slots','bad-slot-review'])('fails closed for target %s',kind=>{
  closedOrigin();selectSol();const next=input();const m=next.manifest as any;
  if(kind==='same-model')m.executionIdentity=identity;if(kind==='null-model')m.executionIdentity.model=null;
  if(kind==='bad-identity')m.executionIdentity.provider='bad provider';if(kind==='missing-round')delete m.round;
  if(kind==='null-slots')m.slots=null;if(kind==='bad-slot-review')m.slots.find((s:any)=>s.updateId==='generation-video-2').sourceReviewDigest=null;
  expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it.each(['call-model','call-identity','request-hash','call-source-revision','job-source','job-content','job-revision','job-fingerprint','lease','queued-sibling','origin-owner'])('blocks inconsistent %s',kind=>{
  const origin=closedOrigin(),jobId=origin.heldClaim.job.id;
  if(kind==='origin-owner')sql(`update public.content_analysis_admissions set user_id='comparison-unrelated-owner-1' where id=${q(origin.i.id)};`);
  else corrupt(kind==='call-model'?`update public.reader_content_analysis_calls set model=${q(solIdentity.model)} where id=${q(origin.heldId)};`:
   kind==='call-identity'?`update public.reader_content_analysis_calls set execution_identity=jsonb_set(execution_identity,'{provider}','"wrong"') where id=${q(origin.heldId)};`:
   kind==='request-hash'?`update public.reader_content_analysis_calls set request_hash=null where id=${q(origin.heldId)};`:
   kind==='call-source-revision'?`update public.reader_content_analysis_calls set source_revision=repeat('f',64) where id=${q(origin.heldId)};`:
   kind==='job-source'?`update public.reader_content_analysis_jobs set source_id='wrong-source' where id=${q(jobId)};`:
   kind==='job-content'?`update public.reader_content_analysis_jobs set content_hash=repeat('f',64) where id=${q(jobId)};`:
   kind==='job-revision'?`update public.reader_content_analysis_jobs set source_revision=repeat('f',64) where id=${q(jobId)};`:
   kind==='job-fingerprint'?`update public.reader_content_analysis_jobs set source_fingerprint='wrong' where id=${q(jobId)};`:
   kind==='lease'?`update public.reader_content_analysis_jobs set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute' where id=${q(jobId)};`:
   `update public.reader_content_analysis_jobs set state='queued' where generation_admission_id=${q(origin.i.id)} and id<>${q(jobId)};`);
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it('blocks an ambiguous saved response whose request binding disagrees with its call',()=>{
  const origin=closedOrigin();corrupt(`update public.reader_content_analysis_calls set result=${jsonSql({value:{synthetic:true},requestHash:'f'.repeat(64),executionIdentity:identity})} where id=${q(origin.heldId)};`);
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it('blocks a closed origin whose review receipt is missing',()=>{
  const origin=closedOrigin();sql(`update public.content_analysis_admissions set review_digest=null where id=${q(origin.i.id)};`);
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it('does not hide an additional historical hold behind the valid Luna exception',()=>{
  closedOrigin();corrupt(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state)
   select id,user_id,'synthetic-historical-unknown',gen_random_uuid(),${q(model)},source_revision,.001,'unknown' from public.reader_content_analysis_jobs where user_id=${q(owner)} and update_id='generation-video-2' and task='keywords' and generation_admission_id is null limit 1;`);
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();expect(service('select count(*) from public.reader_content_analysis_calls where actual_usd is null;')).toBe('5');
 });
 it('blocks an orphaned unknown hold after privacy deletes its job',()=>{
  const origin=closedOrigin();service(`delete from public.reader_content_analysis_jobs where id=${q(origin.heldClaim.job.id)};`);selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
  expect(service(`select job_id is null and actual_usd is null from public.reader_content_analysis_calls where id=${q(origin.heldId)};`)).toBe('t');
 });
 it.each(['call-owner','job-owner'])('does not hide another unknown with mismatched %s behind the valid Luna origin',kind=>{
  closedOrigin();
  let jobId:string;
  if(kind==='job-owner'){
   sql(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
    select 'comparison-unrelated-owner-1',id,source_id,collection_id,published_at,record from public.reader_source_updates where user_id=${q(owner)} and id='generation-video-2';`);
   jobId=sql(`insert into public.reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,task,source_revision,source_fingerprint,workspace_revision,state)
    select a.user_id,a.id,a.source_id,encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),'keywords',public.content_analysis_source_revision(a.record),
     public.content_analysis_source_fingerprint(w.state,a.source_id),w.updated_at,'blocked'
    from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id where a.user_id='comparison-unrelated-owner-1' and a.id='generation-video-2' returning id;`);
  }else jobId=service(`select id from public.reader_content_analysis_jobs where user_id=${q(owner)} and update_id='generation-video-2' and task='keywords' and generation_admission_id is null limit 1;`);
  corrupt(`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state)
   select id,${q(kind==='job-owner'?owner:'comparison-unrelated-owner-1')},'synthetic-owner-mismatch',gen_random_uuid(),${q(model)},source_revision,.001,'unknown'
   from public.reader_content_analysis_jobs where id=${q(jobId)};`);
  selectSol();const next=input();expect(held(next)).toBe(true);expect(()=>stage(next)).toThrow();
 });
 it('still forbids another admission for the consumed Luna model or a disguised new round',()=>{
  closedOrigin();const retry=input(undefined,identity);retry.manifest.round=2;expect(held(retry)).toBe(true);expect(()=>stage(retry)).toThrow();
 });
 it('checks the unchanged global commitment including Luna at staging',()=>{
  const origin=closedOrigin();selectSol();const next=input();expect(held(next)).toBe(false);
  next.manifest.overallCommitmentCeilingUsd=next.manifest.expectedCommittedUsd-heldMaximum+next.manifest.maximumFreshUsd;
  expect(()=>stage(next)).toThrow();expect(service(`select actual_usd is null from public.reader_content_analysis_calls where id=${q(origin.heldId)};`)).toBe('t');
 });
 it.each(['lifetime','daily'])('keeps every hold in the %s reservation cap including across UTC days',cap=>{
  const origin=closedOrigin();corrupt(`update public.reader_content_analysis_calls set created_at=clock_timestamp()-interval '2 days' where id=${q(origin.heldId)};`);
  selectSol();const next=input();stage(next);transition(next,'release');
  const total=json(`select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0))) from public.reader_content_analysis_calls ${cap==='daily'?"where created_at>=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC') or actual_usd is null":''};`);
  const limit=total-heldMaximum+.001;
  service(`update public.content_analysis_budget set ${cap==='daily'?'daily_limit_usd':'lifetime_limit_usd'}=${limit};`);activate();
  const claims=[claim()!,claim()!,claim()!],c=claims.find(c=>c.job.update_id==='generation-video-2')!;
  expect(c).toBeTruthy();expect(()=>reserve(c)).toThrow();expect(service(`select actual_usd is null and maximum_usd=${heldMaximum} from public.reader_content_analysis_calls where id=${q(origin.heldId)};`)).toBe('t');
 });
 it('admits three summaries under a separate suite without repaying keyword calls',()=>{
  const origin=closedOrigin(),beforeCall=heldRow(origin.heldId);selectSol();
  const tasks:Array<[string,string]>=['generation-video-1','generation-video-2','generation-video-3'].map(id=>[id,'summary']);
  const next=input(tasks,solIdentity,'synthetic-frozen-three-recaps');stage(next);transition(next,'release');activate();
  for(let n=0;n<3;n++){const c=claim()!;expect(c.job.task).toBe('summary');const r=reserve(c);save(c,r.call.id);prepare(c);expect(complete(c)).toBe(true);}
  expect(heldRow(origin.heldId)).toBe(beforeCall);expect(service(`select count(*) from public.reader_content_analysis_calls c join public.reader_content_analysis_jobs j on j.id=c.job_id where j.generation_admission_id=${q(next.id)} and j.task='keywords';`)).toBe('0');
 });
 it('rejects a mixed three-slot cohort and retains six-slot both-task support',()=>{
  selectSol();const mixed=input([['generation-video-1','summary'],['generation-video-2','keywords'],['generation-video-3','summary']]);expect(()=>stage(mixed)).toThrow();
  const tasks:Array<[string,string]>=['generation-video-1','generation-video-2','generation-video-3'].flatMap(id=>[[id,'summary'],[id,'keywords']] as Array<[string,string]>);
  expect(stage(input(tasks)).staged).toBe(true);
 });
 it('does not extend the exception to H3/H4 or legacy unknown-hold behavior',()=>{
  closedOrigin();selectSol();const next=input();const h4={...next.manifest,purpose:'content_v4_evaluation',phase:'smoke',runtimeDisabled:true};
  expect(()=>json(`select public.stage_content_analysis_admission(${q(owner)},${q(next.workspaceRevision)},${q(next.id)},'synthetic-h4',${jsonSql(h4)});`)).toThrow();
  expect(json(`select public.content_analysis_v2_unknown_hold(${q(owner)},'generation-video-2','keywords');`)).toBe(true);
 });
 it('keeps the new helper service-only',()=>{
  const signature='public.content_analysis_comparison_unknown_hold(text,text,text,jsonb,uuid)';
  for(const role of ['anon','authenticated'])expect(sql(`select has_function_privilege(${q(role)},${q(signature)},'execute');`)).toBe('f');
  expect(sql(`select has_function_privilege('service_role',${q(signature)},'execute');`)).toBe('t');
 });
});
