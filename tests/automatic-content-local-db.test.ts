import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const available=['initdb','pg_ctl','psql'].every(bin=>{try{execFileSync(bin,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",j=(v:unknown)=>q(JSON.stringify(v))+'::jsonb';
const owner='automatic-content-fixture',model='deepseek/deepseek-v4.1-flash-1017';
const content='AeroBox Plus uses a quiet focus setting. The laboratory measured an improvement over the older design.';
const hash=createHash('sha256').update(content).digest('hex');
const record={id:'automatic-video',sourceId:'automatic-source',title:'Fixture new video',url:'https://www.youtube.com/watch?v=abcdEFGH123',publishedAt:'2026-10-29T00:00:00Z',content,contentKind:'transcript',format:'video',isSample:false,videoFormat:{kind:'regular'},topics:[],brands:[],videoKeywords:[]};
const workspace={version:1,followedSourceIds:['automatic-source'],customSources:[{id:'automatic-source',platform:'YouTube',url:'https://www.youtube.com/@automaticfixture',status:'live'}],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{}};
const identity={adapterVersion:'content-analysis-model-v2',route:'openrouter',baseURL:'https://openrouter.ai/api/v1',provider:'relace',model,reasoningEffort:'none',pricing:{version:'fixture-pricing',inputUsdPerMillion:.07,outputUsdPerMillion:.5,cachedInputUsdPerMillion:.008,cacheWriteApplies:false,cacheWriteUsdPerMillion:null}};
describe.skipIf(!available)('automatic new-content drafts, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false;
 const sql=(s:string)=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(s:string)=>sql('set role service_role;'+s),json=(s:string)=>JSON.parse(service(s)||'null');
 const sync=()=>json('select public.sync_automatic_content_tasks();');
 const claim=()=>json('select public.claim_automatic_content_task();');
 const source=()=>json(`select record from public.reader_source_updates where user_id=${q(owner)} and id='automatic-video';`);
 function task(kind='recap'){
  sync();service(`update public.automatic_content_tasks set state='blocked',error_code='fixture_skip'where task<>${q(kind)};`);
  return claim();
 }
 function reserveStatement(t:any,key:string,originalKey?:string,correction?:{baseKey:string;errorCode:string}){
  const callKey='keyword-learning:v1:automatic-fixture-'+key;
  return `select public.reserve_keyword_learning_call(${q(t.task.session_id)},${q(callKey)},1,${q(hash)},${q(model)},${j(identity)},repeat('a',64),.10,${j({originalKey,request:{key:callKey,correction,role:'extractor',system:'Fixture exact instructions',prompt:content,schema:{type:'object'},maxOutputTokens:100}})});`;
 }
 function reserve(t:any,key='one',originalKey?:string,correction?:{baseKey:string;errorCode:string}){
  return json(reserveStatement(t,key,originalKey,correction));
 }
 function settle(t:any,r:any,result:unknown={value:{names:['AeroBox Plus']},actualUsd:.001,observedUsd:.001,providerId:'fixture-provider'},error:string|null=null){
  return json(`select public.record_keyword_learning_call(${q(t.task.session_id)},${q(r.call.call_key)},${q(r.call.id)},${q(r.call.lease_token)},${q(r.requestHash)},${result===null?'null':j(result)},${error===null?'null':q(error)});`);
 }
 const finish=(t:any,result:unknown=null,error:string|null=null)=>json(`select public.finish_automatic_content_task(${q(t.task.id)},${q(t.leaseToken)},${result===null?'null':j(result)},${error===null?'null':q(error)});`);
 const keyword=(keys:string[],proposals:unknown[]=[{label:'AeroBox Plus',kind:'product',reason:'Check relevance and naming'}])=>({kind:'keywords',callKeys:keys,proposals});
 const recap=(keys:string[])=>({kind:'recap',callKeys:keys,proposal:{highlights:[{text:'AeroBox Plus has a quiet focus setting.',evidenceQuote:'AeroBox Plus uses a quiet focus setting.'}]}});
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rcac-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55549`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55549','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())sql(readFileSync(new URL(name,dir),'utf8'));
 },40000);
 beforeEach(()=>{
  sql(`truncate public.hosting_work cascade;truncate public.collection_budget_reservations cascade;truncate recap_internal.monthly_provider_budget_alerts;truncate public.keyword_learning_sessions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.content_analysis_provider_cooldowns;
   insert into public.content_analysis_budget(id,enabled,daily_limit_usd,lifetime_limit_usd)values(true,true,5,10)on conflict(id)do update set enabled=true,daily_limit_usd=5,lifetime_limit_usd=10;
   insert into public.reader_workspaces(user_id,state)values(${q(owner)},${j(workspace)});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)values(${q(owner)},true,5,10,.1,${q(model)});
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'automatic-video','automatic-source','fixture','2026-10-29T00:00:00Z',${j(record)});
   insert into public.automatic_content_policies(user_id,enabled,starts_at)values(${q(owner)},true,clock_timestamp()-interval'1 hour');`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 const proofId='ca038128-af54-44f1-ad70-6a59c604e9ee', approval='212785f0-8675-47da-b9b7-f64631a8979e';
 const proofRelease='e'.repeat(40);
 function prepareProof() {
  sql(`update public.hosting_runtime_control set owner='cloudflare', epoch=6, release=${q(proofRelease)}, paused=false, old_host_fenced=true;
   update public.automatic_content_policies set session_budget_usd=.75 where user_id=${q(owner)};`);
  return json(`select public.prepare_video_analysis_proof(${q(proofId)},${q(owner)},${q(proofRelease)},
   jsonb_build_array(jsonb_build_object('updateId','automatic-video','sourceHash',${q(hash)},'sourceRevision',public.content_analysis_source_revision(${j(record)}))));`);
 }
 const proofScope=(p:any)=>`${q(p.id)},${q(p.manifestSha256)}`;
 const authorizeProof=(p:any)=>service(`select public.authorize_video_analysis_proof(${proofScope(p)},${q(approval)});`);
 const proofClaim=(p:any)=>json(`select public.claim_video_analysis_proof_task(${proofScope(p)});`);
 const proofReceipt=(p:any)=>json(`select public.read_video_analysis_proof(${proofScope(p)});`);
 const closeProof=(p:any)=>json(`select public.close_video_analysis_proof(${proofScope(p)});`);
 const proofReserve=(t:any,key:string)=>reserve(t,key,`automatic-video:v1:${t.task.task}:draft:0:3`);
 it('keeps the proof inert until a distinct authorization of the exact manifest and old-host-fenced release',()=>{
  const p=prepareProof();
  expect(prepareProof()).toEqual(p);
  expect(p).toMatchObject({capUsd:.75,videos:1});
  expect(proofReceipt(p)).toMatchObject({targets:[{state:'unstarted',task:'keywords'},{state:'unstarted',task:'recap'}],calls:0,authorizedAt:null});
  expect(()=>proofClaim(p)).toThrow(/closed, expired or outside its approved release/);
  expect(()=>authorizeProof({...p,manifestSha256:'0'.repeat(64)})).toThrow(/Unconfirmed/);
  sql("update hosting_runtime_control set paused=true;");
  expect(()=>authorizeProof(p)).toThrow(/outside its approved release/);
  sql("update hosting_runtime_control set paused=false;");
  authorizeProof(p);authorizeProof(p);
  const t=proofClaim(p);
  expect(t).toMatchObject({claimed:true,task:{task:'recap',content_hash:hash,update_id:'automatic-video'}});
  expect(proofClaim(p)).toEqual({claimed:false,reason:'video_proof_unresolved'});
  expect(()=>reserve(t,'wrong-kind','automatic-video:v1:keywords:direct:0')).toThrow(/outside its frozen target/);
  expect(proofReceipt(p)).toMatchObject({calls:0,committedUsd:0,authorizationRef:approval});
  const r=proofReserve(t,'valid');
  expect(r.claimed).toBe(true);
  expect(proofReserve(t,'valid').claimed).toBe(false);
  expect(()=>proofReserve(t,'would-race')).toThrow(/remains held|Unresolved/);
  expect(proofReceipt(p)).toMatchObject({calls:1,unresolved:1,committedUsd:.1});
  expect(closeProof(p)).toMatchObject({committedUsd:.1,unresolved:1});
  // A genuine late receipt still settles the existing hold after closure.
  settle(t,r,{value:{highlights:[]},actualUsd:.02,observedUsd:.03,providerId:'fixture-provider'});
  expect(proofReceipt(p)).toMatchObject({committedUsd:.03,settledUsd:.03,unresolved:0,calls:1});
  expect(()=>proofReserve(t,'closed')).toThrow(/closed, expired/);
  expect(()=>proofClaim(p)).toThrow();
 });
 it('uses one exact-money ceiling across both sessions, including partial settlement and observed fees',()=>{
  const p=prepareProof();
  authorizeProof(p);
  const a=proofClaim(p);
  const book=(t:any,key:string,actualUsd:number,observedUsd=actualUsd)=>{
   const call=proofReserve(t,key);
   settle(t,call,{value:{fixture:true},actualUsd,observedUsd,providerId:'fixture-provider'});
   return call.call.call_key;
  };
  const recapKeys=Array.from({length:4},(_,i)=>book(a,'recap-'+i,.10));
  expect(finish(a,recap(recapKeys))).toMatchObject({state:'review',reviewCount:1});
  const b=proofClaim(p);
  expect(b.task.task).toBe('keywords');
  book(b,'keywords-0',.10);book(b,'keywords-1',.10);
  const partial=proofReserve(b,'partial');
  expect(proofReceipt(p)).toMatchObject({committedUsd:.70,unresolved:1,calls:7});
  settle(b,partial,{value:{fixture:true},actualUsd:.02,observedUsd:.04,providerId:'fixture-provider'});
  expect(proofReceipt(p)).toMatchObject({committedUsd:.64,settledUsd:.64,unresolved:0,calls:7});
  const eighth=proofReserve(b,'eighth');
  expect(proofReceipt(p)).toMatchObject({committedUsd:.74,unresolved:1,calls:8});
  settle(b,eighth,{value:{fixture:true},actualUsd:.10,observedUsd:.10,providerId:'fixture-provider'});
  expect(()=>proofReserve(b,'blocked-ninth')).toThrow(/Video proof hard cap exhausted/);
  const receipt=closeProof(p);
  expect(receipt).toMatchObject({calls:8,committedUsd:.74,settledUsd:.74,unresolved:0});
  expect(receipt.targets[0].calls).toHaveLength(4);
  expect(receipt.targets[1].calls).toHaveLength(4);
  expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('8');
  expect(source().videoHighlights).toBeUndefined();
  expect(source().videoKeywords).toEqual([]);
  expect(service("select count(*) from public.admin_analysis_reviews where status='pending';")).toBe('1');
 });
 it('rejects a stale source or hosting revision and denies reader access to proof operations',()=>{
  const p=prepareProof();
  authorizeProof(p);
  sql("update public.hosting_runtime_control set release_revision=gen_random_uuid();");
  expect(()=>proofClaim(p)).toThrow(/outside its approved release/);
  const roleList=['anon','authenticated'];
  for (const role of roleList) for(const fn of [
   'prepare_video_analysis_proof(uuid,text,text,jsonb)', 'authorize_video_analysis_proof(uuid,text,uuid)',
   'claim_video_analysis_proof_task(uuid,text)', 'read_video_analysis_proof(uuid,text)', 'close_video_analysis_proof(uuid,text)',
  ]) expect(sql(`select has_function_privilege(${q(role)},${q('public.'+fn)},'execute');`)).toBe('f');
  expect(proofReceipt(p)).toMatchObject({calls:0,unresolved:0,committedUsd:0});
 });
 it('serializes competing proof reservations and never leaves the rejected call row behind', async () => {
  const p=prepareProof();
  authorizeProof(p);
  const t=proofClaim(p);
  const reserveInClient=(key:string)=>new Promise<{ ok: boolean; err: string }>(resolve=>{
   const statement=reserveStatement(t,key,'automatic-video:v1:recap:draft:0:3');
   execFile('psql',[...args,'-c','set role service_role;'+statement],
     (error,_stdout,stderr)=>resolve({ok:!error,err:stderr}));
  });
  const results=await Promise.all([reserveInClient('concurrent-one'),reserveInClient('concurrent-two')]);
  expect(results.filter(result=>result.ok)).toHaveLength(1);
  expect(results.find(result=>!result.ok)?.err).toMatch(/remains held|Unresolved/);
  expect(proofReceipt(p)).toMatchObject({calls:1,committedUsd:.1,unresolved:1});
  expect(service('select count(*) from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('fails closed if the exact archive changes after preparation',()=>{
  const p=prepareProof();
  authorizeProof(p);
  sql(`update public.reader_source_updates set record=record||'{"title":"Changed upstream"}'::jsonb where id='automatic-video';`);
  expect(()=>proofClaim(p)).toThrow(/Proof transcript or its charge state changed/);
  expect(proofReceipt(p)).toMatchObject({calls:0,committedUsd:0});
 });
 it('admits a recurring draft past the retired lifetime limit without dropping its prior unknown charge',()=>{
  sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,actual_usd,state,created_at)
   select ${q(owner)},'historical-'||i,gen_random_uuid(),${q(model)},repeat('c',64),.1,.1,'settled',clock_timestamp()-interval'2 days'from generate_series(1,129)i;
   insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)
   values(${q(owner)},'historical-unknown',gen_random_uuid(),${q(model)},repeat('c',64),.05,'unknown',clock_timestamp()-interval'2 days');
   update public.content_analysis_budget set lifetime_limit_usd=12;update public.reader_content_analysis_policies set lifetime_limit_usd=12;`);
  const previous=service("select to_jsonb(c)from public.reader_content_analysis_calls c where call_key='historical-unknown';");
  const t=task();expect(t.claimed).toBe(true);expect(reserve(t).claimed).toBe(true);
  expect(service("select to_jsonb(c)from public.reader_content_analysis_calls c where call_key='historical-unknown';")).toBe(previous);
 });
 it('recovers transport after domain completion without replaying a paid call or publishing its held review',()=>{
  const release='a'.repeat(40),first='cron:automatic-content:3:1',second='cron:automatic-content:3:2';
  sql(`update hosting_runtime_control set owner='cloudflare',epoch=3,release=${q(release)},paused=false,old_host_fenced=true;`);
  const admit=(key:string)=>service(`select admit_hosting_work(${q(key)},'automatic-content',3,${q(release)});`);
  const hostingClaim=(key:string)=>json(`select begin_automatic_hosting_queue_work(${q(key)},3,${q(release)},'native-fixture');`);
  admit(first);hostingClaim(first);
  const t=task('keywords'),r=reserve(t);settle(t,r);finish(t,keyword([r.call.call_key]));
  // Process dies before finish_hosting_work. Age only the native-bound fixture.
  sql(`update hosting_work set updated_at=updated_at-interval '1 hour',lease_until=lease_until-interval '1 hour' where key=${q(first)};
   alter table hosting_queue_invocations disable trigger hosting_invocation_immutable;
   update hosting_queue_invocations set frame=(select to_jsonb(w) from hosting_work w where key=${q(first)}),recorded_at=recorded_at-interval '1 hour',not_after=not_after-interval '1 hour';
   alter table hosting_queue_invocations enable trigger hosting_invocation_immutable;`);
  const evidence=json('select read_automatic_hosting_domain_evidence();'),original=source();
  admit(second);expect(hostingClaim(second).token).toBeTruthy();expect(hostingClaim(first)).toBeNull();
  expect(json('select read_automatic_hosting_domain_evidence();')).toEqual(evidence);expect(source()).toEqual(original);
  expect(service('select count(*)from reader_content_analysis_calls;')).toBe('1');expect(service('select count(*)from admin_analysis_reviews;')).toBe('1');
  expect(service(`select state from automatic_content_tasks where id=${q(t.task.id)};`)).toBe('review');
  expect(sql(`select state from hosting_work where key=${q(first)};`)).toBe('uncertain');
 });
 it('keeps even expired running domain tasks blocked during hosting recovery and preserves unknown call holds',()=>{
  const release='a'.repeat(40),first='cron:automatic-content:3:1',second='cron:automatic-content:3:2';
  sql(`update hosting_runtime_control set owner='cloudflare',epoch=3,release=${q(release)},paused=false,old_host_fenced=true;`);
  service(`select admit_hosting_work(${q(first)},'automatic-content',3,${q(release)});select begin_automatic_hosting_queue_work(${q(first)},3,${q(release)},'native-1');`);
  const t=task('keywords'),r=reserve(t);settle(t,r,null,'analysis_provider_timeout');
  sql(`update automatic_content_tasks set lease_until=clock_timestamp()-interval '1 hour' where id=${q(t.task.id)};
   update hosting_work set updated_at=updated_at-interval '1 hour',lease_until=lease_until-interval '1 hour' where key=${q(first)};
   alter table hosting_queue_invocations disable trigger hosting_invocation_immutable;
   update hosting_queue_invocations set frame=(select to_jsonb(w) from hosting_work w where key=${q(first)}),recorded_at=recorded_at-interval '1 hour',not_after=not_after-interval '1 hour';
   alter table hosting_queue_invocations enable trigger hosting_invocation_immutable;`);
  const evidence=json('select read_automatic_hosting_domain_evidence();');
  service(`select admit_hosting_work(${q(second)},'automatic-content',3,${q(release)});`);
  expect(json(`select begin_automatic_hosting_queue_work(${q(second)},3,${q(release)},'native-2');`)).toEqual({superseded:true,recovery_required:true});
  expect(sql(`select state from hosting_work where key=${q(first)};`)).toBe('running');
  expect(json('select read_automatic_hosting_domain_evidence();')).toEqual(evidence);expect(evidence.unknown_calls).toBe(1);
 });
 it('syncs only explicit opted-in new followed usable sources and never touches originals or the old queue',()=>{
  const before=source(),jobs=service('select count(*)from public.reader_content_analysis_jobs;');
  expect(sync()).toEqual({synchronized:2});expect(sync()).toEqual({synchronized:0});expect(source()).toEqual(before);
  expect(service('select count(*)from public.reader_content_analysis_jobs;')).toBe(jobs);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
 });
 it('leaves old archives, metadata-only records, unfollowed sources and Shorts excluded',()=>{
  sql(`update public.reader_source_updates set collected_at=clock_timestamp()-interval'2 hours';`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_source_updates set collected_at=clock_timestamp(),record=jsonb_set(record,'{contentKind}','"metadata_only"');`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_source_updates set record=${j(record)};update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);expect(sync().synchronized).toBe(0);
  sql(`update public.reader_workspaces set state=${j(workspace)};update public.reader_source_updates set record=jsonb_set(record,'{videoFormat,kind}','"short"');`);expect(sync().synchronized).toBe(0);
 });
 it('does not synchronize disabled policies and makes the activation cutoff immutable',()=>{
  service('update public.automatic_content_policies set enabled=false;');expect(sync().synchronized).toBe(0);
  expect(()=>service(`update public.automatic_content_policies set starts_at=starts_at-interval'1 day';`)).toThrow();
 });
 it('does not queue already published current-source keyword or recap batches again',()=>{
  sql(`update public.reader_source_updates set record=record||${j({keywordContentHash:hash,videoSummary:{captionHash:hash,status:'ready',ruleVersion:'takeaways-v1',timingBasis:'none'},videoHighlights:[{text:'Prior supported finding'}]})};`);
  expect(sync().synchronized).toBe(0);
 });
 it('requires both enabled financial policies without enabling any old processing scope',()=>{
  sync();sql('update public.content_analysis_budget set enabled=false;');expect(claim().reason).toBe('automatic_processing_paused');
  expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
  sql('update public.content_analysis_budget set enabled=true;update public.reader_content_analysis_policies set enabled=false;');expect(claim().reason).toBe('automatic_processing_paused');
 });
 it('creates one finite 24-hour DeepSeek plus Sol session and immutable exact evidence',()=>{
  const t=task();expect(t.claimed).toBe(true);expect(t.record).toEqual(record);expect(t.task.source_snapshot).toEqual(record);expect(t.task.content_hash).toBe(hash);
  const s=json(`select to_jsonb(s)-'user_id'from public.keyword_learning_sessions s where id=${q(t.task.session_id)};`);
  expect(s.models).toEqual([model,'openai/gpt-6.1-sol-pro']);expect(s.state).toBe('released');expect(Number(s.maximum_usd)).toBe(.3);expect(s.sources).toMatchObject([{ordinal:1,updateId:'automatic-video',sourceHash:hash}]);
  expect(Date.parse(s.expires_at)-Date.parse(s.created_at)).toBeLessThanOrEqual(86400000);
  expect(()=>service(`update public.automatic_content_tasks set source_snapshot='{}'where id=${q(t.task.id)};`)).toThrow();
  expect(()=>service(`update public.automatic_content_tasks set session_id=gen_random_uuid()where id=${q(t.task.id)};`)).toThrow();
 });
 it('puts literal keyword drafts into pending review without publishing and keeps exact native prompt references',()=>{
  const t=task('keywords'),before=source(),r=reserve(t);settle(t,r);const out=finish(t,keyword([r.call.call_key]));
  expect(out).toEqual({state:'review',reviewCount:1});expect(source()).toEqual(before);
  const v=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(v.status).toBe('pending');expect(v.proposal).toEqual({label:'AeroBox Plus',kind:'product'});expect(v.source_snapshot).toEqual(before);
  expect(v.provenance).toMatchObject({origin:'automatic_content',sessionId:t.task.session_id,callKeys:[r.call.call_key],sourceRevision:t.task.source_revision});expect(v.provenance.prompts).toBeUndefined();
  expect(service(`select state from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('closed');
  expect(()=>finish(t,keyword([r.call.call_key]))).toThrow();expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('1');
 });
 it.each(['analysis_invalid_json','analysis_output_capacity'])('keeps the original settled %s receipt and requires its exact recovery to finish',code=>{
  const t=task(),first=reserve(t,'failure','automatic-video:v1:recap:fixture');
  const failure={value:{rawOutput:'{'},validationError:code,actualUsd:.002,observedUsd:.002,providerId:'fixture-provider'};
  settle(t,first,failure,code);
  expect(()=>finish(t,recap([first.call.call_key]))).toThrow();
  const second=reserve(t,'recovery','automatic-video:v1:recap:fixture:recovery',{baseKey:first.call.call_key,errorCode:code});
  settle(t,second);
  expect(()=>finish(t,recap([second.call.call_key]))).toThrow();
  expect(finish(t,recap([first.call.call_key,second.call.call_key]))).toEqual({state:'review',reviewCount:1});
  const saved=json(`select public.read_keyword_learning_call(${q(t.task.session_id)},${q(first.call.call_key)});`);
  expect(saved.result).toEqual(failure);expect(saved.errorCode).toBe(code);expect(saved.call.actual_usd).toBe(.002);
 });
 it('fences new video proposals at 15 literal mentions while preserving the older review contract',()=>{
  const t=task('keywords'),r=reserve(t,'capped','automatic-video:v1:keywords:fixture');settle(t,r);
  const key=[r.call.call_key],row={label:'AeroBox Plus',kind:'product'};
  expect(()=>finish(t,keyword(key,Array.from({length:16},()=>row)))).toThrow();
  expect(()=>finish(t,keyword(key,[{...row,label:'Invented Unmentioned Device'}]))).toThrow();
  expect(finish(t,keyword(key,[row]))).toEqual({state:'review',reviewCount:1});
 });
 it('puts cited recap drafts into pending review without changing existing reader annotations',()=>{
  const t=task(),before=source(),r=reserve(t);settle(t,r);expect(finish(t,recap([r.call.call_key]))).toEqual({state:'review',reviewCount:1});expect(source()).toEqual(before);
  expect(json('select proposal from public.admin_analysis_reviews;')).toEqual(recap([]).proposal);
 });
 it('deduplicates repeated labels and preserves unsupported proposals for correction while publication still rejects them',()=>{
  const t=task('keywords'),r=reserve(t);settle(t,r);
  expect(finish(t,keyword([r.call.call_key],[{label:'AeroBox Plus',kind:'product'},{label:'AeroBox Plus',kind:'product'},{label:'Invented Unmentioned Device',kind:'product'}])).reviewCount).toBe(2);
  const v=json("select to_jsonb(r)from public.admin_analysis_reviews r where proposal->>'label'='Invented Unmentioned Device';");
  expect(v.reason).toContain('does not occur literally');expect(v.status).toBe('pending');
  expect(()=>json(`select public.admin_decide_analysis_review(${q(v.id)},${q(v.updated_at)},'admin:fixture','approve');`)).toThrow();expect(source()).toEqual(record);
 });
 it('rejects unquoted recaps and mismatched call evidence atomically',()=>{
  const t=task(),r=reserve(t);settle(t,r);const wrong=recap([r.call.call_key]);wrong.proposal.highlights[0].evidenceQuote='This passage was invented by the fixture.';
  expect(()=>finish(t,wrong)).toThrow();expect(()=>finish(t,recap(['keyword-learning:v1:some-other-task']))).toThrow();expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('refuses changed source versions and unfollows at finish without generating a false failure review',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);
  expect(finish(t,recap([r.call.call_key]))).toMatchObject({state:'blocked',errorCode:'automatic_source_changed',reviewCount:0});expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('does not create a session for a task whose original source revision changed before claim',()=>{
  sync();sql(`update public.reader_source_updates set record=jsonb_set(record,'{title}','"Changed source title"');`);expect(claim()).toMatchObject({claimed:false,reason:'automatic_source_changed'});expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
 });
 it('enforces pause and follow/source checks on every new native request, retaining unrelated private evaluation behavior',()=>{
  const t=task();sql('update public.content_analysis_budget set enabled=false;');expect(()=>reserve(t)).toThrow();expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('0');
  sql(`update public.content_analysis_budget set enabled=true;update public.reader_workspaces set state=jsonb_set(state,'{followedSourceIds}','[]');`);expect(()=>reserve(t)).toThrow();
 });
 it('blocks shared monthly and UTC-day exhaustion before sessions or empty reviews and preserves old unknown holds',()=>{
  sync();sql(`insert into public.reader_content_analysis_calls(user_id,call_key,lease_token,model,source_revision,maximum_usd,state,created_at)values(${q(owner)},'old-unknown',gen_random_uuid(),${q(model)},repeat('c',64),.095,'unknown',clock_timestamp()-interval'2 days');update public.reader_content_analysis_policies set lifetime_limit_usd=.1;`);
  const hold=service("select (public.reserve_collection_budget('monthly-fixture-hold',17.9,'job',null,'apify','FixtureActor')).id;");
  expect(claim()).toMatchObject({claimed:false,reason:'provider_monthly_budget_exhausted'});
  expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('0');
  service(`select public.release_collection_budget('${hold}'); update public.reader_content_analysis_policies set lifetime_limit_usd=10,daily_limit_usd=.1;`);expect(claim().reason).toBe('analysis_daily_budget_exhausted');expect(service("select actual_usd is null and state='unknown'from public.reader_content_analysis_calls where call_key='old-unknown';")).toBe('t');
 });
 it('yields with settled cache and resumes the same finite session without recreating paid calls',()=>{
  const t=task(),r=reserve(t);settle(t,r);expect(finish(t,null,'automatic_worker_yield')).toMatchObject({state:'queued',sessionId:t.task.session_id});
  const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);expect(resumed.leaseToken).not.toBe(t.leaseToken);expect(reserve(resumed).claimed).toBe(false);
  expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('parks at the cross-provider limit and renews the same finite session with its saved result',()=>{
  const t=task(),r=reserve(t);settle(t,r);
  const sourceHold=service("select (public.reserve_collection_budget('monthly-midtask',17.999,'job',null,'apify','FixtureActor')).id;");
  expect(()=>reserve(t,'second')).toThrow(/provider_monthly_budget_exhausted/);
  expect(finish(t,null,'provider_monthly_budget_exhausted')).toMatchObject({state:'queued',sessionId:t.task.session_id});
  expect(claim()).toMatchObject({claimed:false,reason:'provider_monthly_budget_exhausted'});
  sql(`update public.keyword_learning_sessions set created_at=clock_timestamp()-interval'2 days',expires_at=clock_timestamp()-interval'1 day'
    where id=${q(t.task.session_id)};
    select public.release_collection_budget('${sourceHold}');`);
  const resumed=claim();
  expect(resumed.task.session_id).toBe(t.task.session_id);
  expect(resumed.leaseToken).not.toBe(t.leaseToken);
  expect(reserve(resumed)).toMatchObject({claimed:false,completed:true});
  expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
  expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('resumes expired task leases using the same released session and blocks expired sessions permanently',()=>{
  const t=task();service(`update public.automatic_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);
  sql(`update public.keyword_learning_sessions set created_at=clock_timestamp()-interval'2 days',expires_at=clock_timestamp()-interval'1 day'where id=${q(t.task.session_id)};update public.automatic_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);
  expect(claim().reason).toBe('automatic_session_expired');expect(claim().claimed).toBe(false);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('keeps unknown provider charges held, creates one inspectable failure, and never redispatches it',()=>{
  const t=task(),r=reserve(t);settle(t,r,null,'analysis_provider_timeout');expect(finish(t,null,'analysis_provider_timeout')).toMatchObject({state:'blocked',errorCode:'analysis_unknown_charge_hold',reviewCount:1});
  const review=json('select to_jsonb(r)from public.admin_analysis_reviews r;');expect(review.proposal).toEqual({});expect(review.status).toBe('pending');expect(review.provenance.callKeys).toEqual([r.call.call_key]);
  expect(claim().claimed).toBe(false);expect(service('select actual_usd is null from public.reader_content_analysis_calls;')).toBe('t');expect(()=>reserve(t)).toThrow();
 });
 it('does not turn an unresolved lease into a retry or a replacement session',()=>{
  const t=task();reserve(t);service(`update public.automatic_content_tasks set lease_until=clock_timestamp()-interval'1 minute'where id=${q(t.task.id)};`);
  expect(claim().reason).toBe('analysis_unknown_charge_hold');expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('keeps operational capacity/budget failures in task monitoring without an empty inbox row',()=>{
  const t=task();expect(finish(t,null,'analysis_budget_exhausted')).toMatchObject({state:'blocked',reviewCount:0});expect(service('select count(*)from public.admin_analysis_reviews;')).toBe('0');
 });
 it('only resumes a daily budget stop on a later UTC day and keeps the same finite session',()=>{
  const t=task();finish(t,null,'analysis_daily_budget_exhausted');sync();expect(service(`select state from public.automatic_content_tasks where id=${q(t.task.id)};`)).toBe('blocked');
  sql(`alter table public.automatic_content_tasks disable trigger automatic_content_task_immutable;update public.automatic_content_tasks set updated_at=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC'-interval'1 second'where id=${q(t.task.id)};alter table public.automatic_content_tasks enable trigger automatic_content_task_immutable;`);
  sync();const resumed=claim();expect(resumed.task.session_id).toBe(t.task.session_id);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
 it('whole-workspace deletion erases tasks and closes admission evidence without orphan sessions',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`delete from public.reader_workspaces where user_id=${q(owner)};`);
  expect(service('select count(*)from public.automatic_content_tasks;')).toBe('0');expect(service('select count(*)from public.automatic_content_policies;')).toBe('0');
  expect(service(`select state='closed'and user_id is null and sources='[]'::jsonb from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('t');
  expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
 });
 it('erases task/source evidence on archive or workspace deletion while preserving the native financial ledger',()=>{
  const t=task(),r=reserve(t);settle(t,r);sql(`delete from public.reader_source_updates where id='automatic-video';`);
  expect(service('select count(*)from public.automatic_content_tasks;')).toBe('0');expect(service('select count(*)from public.reader_content_analysis_calls;')).toBe('1');
  expect(service(`select state='closed'and user_id is null and sources='[]'::jsonb from public.keyword_learning_sessions where id=${q(t.task.session_id)};`)).toBe('t');
  expect(service('select request_payload is null and result is null from public.keyword_learning_requests;')).toBe('t');
 });
 it('does not expose automatic policies, task evidence or RPCs to ordinary readers',()=>{
  for(const role of ['anon','authenticated']){
   for(const table of ['automatic_content_policies','automatic_content_tasks'])expect(()=>sql(`set role ${role};select*from public.${table};`)).toThrow();
   for(const fn of ['sync_automatic_content_tasks()','claim_automatic_content_task(integer)','finish_automatic_content_task(uuid,uuid,jsonb,text)','automatic_content_immutable()','guard_automatic_content_request()'])expect(sql(`select has_function_privilege(${q(role)},${q('public.'+fn)},'execute');`)).toBe('f');
  }
 });
 it('serializes simultaneous workers into one task lease and one finite session',async()=>{
  sync();service("update public.automatic_content_tasks set state='blocked',error_code='fixture_skip'where task='keywords';");
  const run=()=>new Promise<any>((resolve,reject)=>{const child=execFile('psql',args,{encoding:'utf8'},(e,out)=>e?reject(e):resolve(JSON.parse(out.split('\n').find(x=>x.startsWith('{'))!)));child.stdin?.end('set role service_role;begin;select public.claim_automatic_content_task();select pg_sleep(.1);commit;');});
  const values=await Promise.all([run(),run()]);expect(values.filter(x=>x.claimed)).toHaveLength(1);expect(service('select count(*)from public.keyword_learning_sessions;')).toBe('1');
 });
});
