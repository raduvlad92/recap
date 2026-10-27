import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';

// Disposable PostgreSQL17 with TCP disabled. Synthetic source/financial data;
// no environment credentials, linked project, provider or application worker.
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const OLD='e5b7e8411c040ab6f12c064829601936faa147b1e44901fb8ff05390e80b1561';
const CURRENT='6388be0aca7cd311339cb258c88486d52ba81adef38911bd6554383ee64bab91';
const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",j=(value:unknown)=>q(JSON.stringify(value))+'::jsonb';
const owner='generation-v3-owner',luna='openai/gpt-6-luna-pro',deepseek='deepseek/deepseek-v4.1-flash-1017',requestHash='a'.repeat(64),heldMaximum=.004574875;
const lunaIdentity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'openai',model:luna,reasoningEffort:'none',pricing:{version:`openrouter-2026-10-24-v2:${luna}:openai`,inputUsdPerMillion:.1,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.01,cacheWriteApplies:true,cacheWriteUsdPerMillion:.125}};
const deepseekIdentity={...lunaIdentity,provider:'relace',model:deepseek,pricing:{version:`openrouter-2026-10-24-v2:${deepseek}:relace`,inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
const commonLimits={chunkChars:1250,maxOutputTokens:3072,maxInputTokens:27700,overlapChars:256,maxChunks:800,maxSourceChars:1000000,maxCallUsd:.10};
const groups:Array<[string,string,string[]]>=[['archive','reader_source_updates',['user_id','id']],['workspaces','reader_workspaces',['user_id']],['jobs','reader_content_analysis_jobs',['id']],['calls','reader_content_analysis_calls',['id']],['policies','reader_content_analysis_policies',['user_id']],['budget','content_analysis_budget',['id']],['settings','content_analysis_runtime_settings',['id']],['reviews','admin_keyword_reviews',['id']],['attempts','reader_content_analysis_call_attempts',['call_id','attempt_number']],['cooldowns','content_analysis_provider_cooldowns',['identity_key']],['pauses','content_analysis_provider_pauses',['job_id','lease_token']],['hourlyPolicies','reader_collection_policies',['user_id']],['hourlySources','reader_collection_source_state',['user_id','source_id']],['hourlyProviders','reader_collection_provider_jobs',['id']],['hourlyChecks','reader_collection_checks',['id']],['supplierBudget','collection_budget_accounts',['id']],['supplierReservations','collection_budget_reservations',['id']],['supplierJobs','collection_jobs',['id']],['scopes','content_analysis_rollout_scopes',['user_id']],['audit','admin_audit_events',['id']],['comparisons','content_analysis_model_comparisons',['id']],['admissions','content_analysis_admissions',['id']]];
type Claim={job:{id:string;update_id:string;task:'keywords'|'summary';content_hash:string;generation_contract_hash:string;generation_admission_id:string};leaseToken:string;generationContext:Record<string,unknown>};
type Profile=typeof lunaIdentity|typeof deepseekIdentity;

describe.skipIf(!available)('Practical v4 revision preserves old contracts and closed holds, PostgreSQL17',()=>{
 let root:string,args:string[],started=false,beforeMigration:string,afterMigration:string,beforeGuards:string,afterGuards:string,beforeMetadata:string,afterMetadata:string;
 let origin:ReturnType<typeof closedOrigin>;
 const sql=(query:string)=>execFileSync('psql',args,{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
 const service=(query:string)=>sql('set role service_role;'+query);
 const json=(query:string):any=>{const value=service(query);return value==='t'?true:value==='f'?false:JSON.parse(value||'null');};
 const hashFunction=(hash:string)=>`create or replace function public.content_analysis_generation_v4_contract_hash()returns text language sql immutable security invoker set search_path='' as $$select ${q(hash)}::text;$$;`;
 const snapshot=()=>service('select jsonb_build_object('+groups.map(([name,table,keys])=>`${q(name)},(select coalesce(jsonb_agg(to_jsonb(r)::text order by ${keys.map(k=>'r."'+k+'"').join(',')}),'[]'::jsonb)from public."${table}"r)`).join(',')+');');
 const targets="array['content_analysis_generation_v4_contract_hash','content_analysis_comparison_unknown_hold','stage_content_analysis_comparison']";
 const unmodifiedGuards=()=>sql(`select jsonb_agg(jsonb_build_object('catalog',to_jsonb(p),'definition',pg_get_functiondef(p.oid))order by p.oid)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.prokind='f'and not(p.proname=any(${targets}));`);
 const targetMetadata=()=>sql(`select jsonb_agg(to_jsonb(p)-'prosrc'order by p.oid)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(${targets});`);
 const seed=()=>sql(readFileSync(new URL('./content-analysis-model-comparison-fixture.sql',import.meta.url),'utf8'));
 const off=()=>service('update public.content_analysis_budget set enabled=false;update public.reader_content_analysis_policies set enabled=false;');
 const activate=()=>service(`update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`);
 const claim=():Claim|null=>json(`select public.claim_content_analysis_job_v2(${q(owner)},900);`);
 const admission=(id:string)=>json(`select to_jsonb(d)from public.content_analysis_admissions d where id=${q(id)};`);
 const record=(id:string)=>json(`select record from public.reader_source_updates where user_id=${q(owner)}and id=${q(id)};`);
 function input(task:'keywords'|'summary'='keywords',profile:Profile=deepseekIdentity){
  service(`update public.reader_content_analysis_policies set per_call_limit_usd=.10 where user_id=${q(owner)};`);
  const slots=[1,2,3].map(n=>json(`select jsonb_build_object('jobId',gen_random_uuid(),'predecessorJobId',null,'updateId',a.id,'sourceId',a.source_id,'task',${q(task)},'contentHash',encode(sha256(convert_to(a.record->>'content','UTF8')),'hex'),'sourceRevision',public.content_analysis_source_revision(a.record),'sourceFingerprint',public.content_analysis_source_fingerprint(w.state,a.source_id),'currentAnnotationHash',public.content_analysis_model_comparison_annotation_hash(a.record,${q(task)}),'adminReviewHash',public.content_analysis_model_comparison_review_hash(a.user_id,a.id),'sourceReviewDigest',repeat('b',64),'emptyDisposition','findings_expected')from public.reader_source_updates a join public.reader_workspaces w on w.user_id=a.user_id where a.user_id=${q(owner)}and a.id=${q('generation-video-'+n)};`));
  const revision=json('select revision from public.content_analysis_runtime_settings where id;');
  return{id:service('select gen_random_uuid();'),key:'synthetic-practical-'+profile.model+':'+task,workspaceRevision:json(`select to_jsonb(updated_at)from public.reader_workspaces where user_id=${q(owner)};`),manifest:{purpose:'content_model_comparison',phase:'comparison',suiteId:'synthetic-frozen-three-'+task,round:1,spendingDisabled:true,workersDrained:true,protocolVersion:'content-v4',generationContractHash:service('select public.content_analysis_generation_v4_contract_hash();'),commonLimits:structuredClone(commonLimits),executionIdentity:structuredClone(profile),selectionRevision:revision,configEpoch:`openrouter-2026-10-24-v2:${profile.model}:${revision}:${'e'.repeat(64)}`,expectedLedgerHash:service('select public.content_analysis_generation_v3_ledger_hash();'),expectedCommittedUsd:json('select sum(greatest(coalesce(actual_usd,maximum_usd),coalesce(observed_usd,0)))from public.reader_content_analysis_calls;'),overallCommitmentCeilingUsd:5,maximumFreshUsd:.10,maximumCalls:20,perCallMaximumUsd:.10,sourceReviewDigest:'b'.repeat(64),slots}};
 }
 type Input=ReturnType<typeof input>;
 const stage=(i:Input)=>json(`select public.stage_content_analysis_comparison(${q(owner)},${q(i.workspaceRevision)},${q(i.id)},${q(i.key)},${j(i.manifest)});`);
 const transition=(i:Input,action:string)=>json(`select public.set_content_analysis_admission_state(${q(i.id)},${admission(i.id).revision},${q(action)},${q(admission(i.id).manifest_digest)},${q('c'.repeat(64))});`);
 const selectDeepseek=()=>json(`select public.admin_set_analysis_model('synthetic-practical-reviewer',${q(deepseek)},(select revision from public.content_analysis_runtime_settings where id));`);
 const reserveSql=(c:Claim,key=c.job.task==='summary'?'summary:v4:verify:0':'extractor:v4:chunk:0',maximum=.001)=>{const identity=admission(c.job.generation_admission_id).manifest.executionIdentity;return`select public.reserve_content_analysis_call_v3(${q(c.job.id)},${q(c.leaseToken)},${q(key)},${maximum},${q(identity.model)},${j(identity)},${q(requestHash)});`;};
 const reserve=(c:Claim,key?:string,maximum?:number)=>json(reserveSql(c,key,maximum));
 const fail=(c:Claim,code='analysis_invalid_output')=>json(`select public.fail_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${q(code)},false,false);`);
 const heldRow=(id:string)=>service(`select to_jsonb(c)::text from public.reader_content_analysis_calls c where id=${q(id)};`);
 function closedOrigin(){
  const keyword=input('keywords',lunaIdentity);stage(keyword);transition(keyword,'release');activate();let heldId='',heldClaim:Claim|undefined;
  for(let n=0;n<3;n++){const c=claim()!;if(c.job.update_id==='generation-video-2'){heldId=reserve(c,undefined,heldMaximum).call.id;heldClaim=c;fail(c,'analysis_unknown_charge_hold');}else fail(c);}
  off();transition(keyword,'close');
  const summary=input('summary',lunaIdentity);stage(summary);transition(summary,'release');activate();for(let n=0;n<3;n++)fail(claim()!);off();transition(summary,'close');
  return{keyword,summary,heldId,heldClaim:heldClaim!};
 }
 const predicate=(i:Input,except:string|null=null)=>json(`select public.content_analysis_comparison_unknown_hold(${q(owner)},'generation-video-2','keywords',${j(i.manifest)},${except?q(except):'null'});`);
 function save(c:Claim,callId:string){const identity=admission(c.job.generation_admission_id).manifest.executionIdentity,value=c.job.task==='summary'?{readComplete:true,verdicts:[{id:'s0',supported:true,sameFinding:true,reason:'Supported synthetic finding.'}]}:{synthetic:true};return json(`select public.record_content_analysis_call_result(${q(callId)},${q(c.leaseToken)},${j({value,requestHash,executionIdentity:identity})},'{}',null,.0001,.0001);`);}
 function output(c:Claim){const r=record(c.job.update_id),base={protocolVersion:'content-v4',generationContractHash:c.job.generation_contract_hash,contentHash:c.job.content_hash,coverage:[{start:0,end:r.content.length}]};return c.job.task==='summary'?{state:'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:c.job.content_hash,timingBasis:'none'},videoHighlights:[{text:'Nvidia makes the RTX 5090.'}]},evidence:{...base,sourceContentState:'partial',verification:[{id:'s0',supported:true,sameFinding:true,reason:'Supported synthetic finding.'}],selected:[{text:'Nvidia makes the RTX 5090.',evidenceQuote:'Nvidia makes RTX 5090.'}]}}:{state:'ready',patch:{keywordRuleVersion:'entities-v2'},pending:[],evidence:{...base,ruleVersion:'entities-v2',accepted:[{label:'Nvidia',kind:'brand',confidence:90,reason:'Explicit synthetic brand.',evidenceQuote:'Nvidia makes RTX 5090.',ranges:[]}]}};}
 const prepare=(c:Claim)=>json(`select public.prepare_content_analysis_job(${q(c.job.id)},${q(c.leaseToken)},${j(output(c))});`);
 const complete=(c:Claim)=>json(`select public.complete_content_analysis_comparison_job(${q(c.job.id)},${q(c.leaseToken)});`);
 const preservedExcept=(id:string)=>service(`select jsonb_build_object('archives',(select jsonb_agg(to_jsonb(a)::text order by user_id,id)from public.reader_source_updates a),'workspaces',(select jsonb_agg(to_jsonb(w)::text order by user_id)from public.reader_workspaces w),'reviews',(select jsonb_agg(to_jsonb(r)::text order by id)from public.admin_keyword_reviews r),'jobs',(select jsonb_agg(to_jsonb(x)::text order by id)from public.reader_content_analysis_jobs x where generation_admission_id is distinct from ${q(id)}::uuid),'calls',(select jsonb_agg(to_jsonb(c)::text order by c.id)from public.reader_content_analysis_calls c left join public.reader_content_analysis_jobs x on x.id=c.job_id where x.generation_admission_id is distinct from ${q(id)}::uuid),'admissions',(select jsonb_agg(to_jsonb(a)::text order by id)from public.content_analysis_admissions a where id<>${q(id)}::uuid));`);

 beforeAll(()=>{
  expect(execFileSync('initdb',['--version'],{encoding:'utf8'})).toMatch(/PostgreSQL\) 17\./);root=mkdtempSync('/tmp/rcpr-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55533`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',join(root,'socket'),'-p','55533','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt()to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   const own=name.endsWith('_content_analysis_v4_practical_fixes.sql');if(own){seed();origin=closedOrigin();beforeMigration=snapshot();beforeGuards=unmodifiedGuards();beforeMetadata=targetMetadata();}
   sql(readFileSync(new URL(name,directory),'utf8'));if(own){afterMigration=snapshot();afterGuards=unmodifiedGuards();afterMetadata=targetMetadata();}
  }
 },40000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.content_analysis_admissions cascade;truncate public.content_analysis_model_comparisons cascade;truncate public.content_analysis_provider_cooldowns;truncate public.admin_audit_events;`);
  // Local fixture setup deliberately constructs historical OLD-contract rows
  // before returning the current hash. No production operation does this.
  sql(hashFunction(OLD));seed();origin=closedOrigin();sql(hashFunction(CURRENT));
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});

 it('preserves all22 data groups, unrelated guards and replacement metadata during migration',()=>{
  expect(afterMigration).toBe(beforeMigration);expect(afterGuards).toBe(beforeGuards);expect(afterMetadata).toBe(beforeMetadata);
  expect(service('select public.content_analysis_generation_v4_contract_hash();')).toBe(CURRENT);expect(service('select enabled from public.content_analysis_budget;')).toBe('f');
 });
 it('keeps old v4 rows CHECK-valid and immutable after advancing the current hash',()=>{
  const id=service(`select id from public.reader_content_analysis_jobs where generation_admission_id=${q(origin.keyword.id)}and state='failed'limit 1;`),before=heldRow(origin.heldId),job=service(`select to_jsonb(x)::text from public.reader_content_analysis_jobs x where id=${q(id)};`);
  expect(origin.heldClaim.job.generation_contract_hash).toBe(OLD);
  service(`begin;update public.reader_content_analysis_jobs set updated_at=clock_timestamp()where id=${q(id)};rollback;`);
  expect(service(`select to_jsonb(x)::text from public.reader_content_analysis_jobs x where id=${q(id)};`)).toBe(job);expect(heldRow(origin.heldId)).toBe(before);
  expect(()=>service(`update public.reader_content_analysis_jobs set state='queued'where id=${q(id)};`)).toThrow();
  expect(()=>transition(origin.keyword,'release')).toThrow();expect(()=>reserve(origin.heldClaim)).toThrow();
  const definition=sql("select pg_get_constraintdef(oid)from pg_constraint where conrelid='public.reader_content_analysis_jobs'::regclass and conname='content_analysis_generation_v3_identity';");expect(definition).toContain(OLD);expect(definition).toContain(CURRENT);
 });
 it.each(['keywords','summary']as const)('admits and completes first DeepSeek %s with the exact old suite and untouched held row',task=>{
  const heldBefore=heldRow(origin.heldId);selectDeepseek();const next=input(task),before=preservedExcept(next.id);
  expect(next.manifest.generationContractHash).toBe(CURRENT);expect(next.manifest.suiteId).toBe(task==='keywords'?origin.keyword.manifest.suiteId:origin.summary.manifest.suiteId);
  if(task==='keywords'){expect(predicate(next)).toBe(false);expect(json(`select public.content_analysis_v2_unknown_hold(${q(owner)},'generation-video-2','keywords');`)).toBe(true);}
  stage(next);transition(next,'release');activate();for(let n=0;n<3;n++){const c=claim()!;expect(c.job.generation_contract_hash).toBe(CURRENT);const call=reserve(c);save(c,call.call.id);prepare(c);expect(complete(c)).toBe(true);}
  off();transition(next,'close');expect(preservedExcept(next.id)).toBe(before);expect(heldRow(origin.heldId)).toBe(heldBefore);expect(admission(origin.keyword.id).state).toBe('closed');
 });
 it('uses only the new current hash for newly staged work',()=>{
  selectDeepseek();const next=input();next.manifest.generationContractHash=OLD;expect(()=>stage(next)).toThrow();next.manifest.generationContractHash='f'.repeat(64);expect(()=>stage(next)).toThrow();expect(heldRow(origin.heldId)).toContain('reserved');
 });
 it.each(['same-model','round','suite','top-reference','slot-reference','limits','source','contract']as const)('retains the closed-origin %s block',field=>{
  selectDeepseek();const next=input();if(field==='same-model')next.manifest.executionIdentity=structuredClone(lunaIdentity);if(field==='round')next.manifest.round=2;if(field==='suite')next.manifest.suiteId='synthetic-different';if(field==='top-reference')next.manifest.sourceReviewDigest='c'.repeat(64);if(field==='slot-reference')next.manifest.slots[1].sourceReviewDigest='c'.repeat(64);if(field==='limits')next.manifest.commonLimits.maxOutputTokens=4096;if(field==='source')next.manifest.slots[1].contentHash='c'.repeat(64);if(field==='contract')next.manifest.generationContractHash='f'.repeat(64);
  const before=heldRow(origin.heldId);expect(predicate(next)).toBe(true);expect(heldRow(origin.heldId)).toBe(before);
 });
 it('counts the old Luna hold toward the unchanged lifetime ceiling',()=>{
  selectDeepseek();const next=input();next.manifest.maximumFreshUsd=5-next.manifest.expectedCommittedUsd+.000001;expect(()=>stage(next)).toThrow();expect(heldRow(origin.heldId)).toContain('0.004574875');expect(service('select count(*)from public.reader_content_analysis_calls where actual_usd is null;')).toBe('4');
 });
 it('blocks a new DeepSeek ambiguous call rather than retrying it or the next key',()=>{
  selectDeepseek();const next=input();stage(next);transition(next,'release');activate();const c=claim()!,call=reserve(c),before=heldRow(call.call.id);
  expect(reserve(c).claimed).toBe(false);expect(()=>reserve(c,'checker:v4:chunk:0')).toThrow();expect(heldRow(call.call.id)).toBe(before);expect(service('select count(*)from public.reader_content_analysis_calls where actual_usd is null;')).toBe('5');
 });
 it.each(['orphaned','historical']as const)('does not ignore an additional %s unknown call',kind=>{
  selectDeepseek();const next=input(),before=heldRow(origin.heldId);
  const corruption=kind==='orphaned'?`update public.reader_content_analysis_calls set job_id=null where id=${q(origin.heldId)};`:`insert into public.reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state)select id,user_id,'synthetic-additional-unknown',gen_random_uuid(),${q(deepseek)},source_revision,.001,'unknown'from public.reader_content_analysis_jobs where generation_admission_id is null and update_id='generation-video-2'and task='keywords'limit 1;`;
  const blocked=sql(`begin;alter table public.reader_content_analysis_calls disable trigger user;${corruption}select public.content_analysis_comparison_unknown_hold(${q(owner)},'generation-video-2','keywords',${j(next.manifest)});rollback;`);expect(blocked).toBe('t');expect(heldRow(origin.heldId)).toBe(before);
 });
 it('keeps consumed first-DeepSeek scopes closed even under a different round',()=>{
  selectDeepseek();const next=input('summary');stage(next);transition(next,'close');const retry=input('summary');retry.manifest.round=2;expect(()=>stage(retry)).toThrow();expect(()=>transition(next,'release')).toThrow();expect(admission(next.id).state).toBe('closed');
 });
 it('preserves service-only privileges without granting a new entry point',()=>{
  for(const role of ['anon','authenticated'])for(const signature of ['content_analysis_generation_v4_contract_hash()','stage_content_analysis_comparison(text,timestamptz,uuid,text,jsonb)','content_analysis_comparison_unknown_hold(text,text,text,jsonb,uuid)'])expect(sql(`select has_function_privilege(${q(role)},${q('public.'+signature)},'execute');`)).toBe('f');
 });
});
