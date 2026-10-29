import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { YouTubeCard, VideoTakeaways } from '../src/components/YouTubeCard';
import { contentHash, getContentProcessing } from '../src/lib/content-processing';
import { mergeProcessingRefresh } from '../src/lib/processing-refresh';
import { sanitizeArchivedUpdate, sanitizeWorkspace, updatesForSourcePreferences } from '../src/lib/domain';
import type { SourceUpdate } from '../src/lib/types';

// Actual disposable PostgreSQL -> own-RLS archive read -> production sanitizer /
// refresh -> card/details markup. All inputs are synthetic deterministic accepted
// fixtures: this proves publication plumbing, not live AI quality or browser UI.
// A private Unix socket and disabled TCP prevent any hosted/project connection.
const available=['initdb','pg_ctl','psql'].every(binary=>{try{execFileSync(binary,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const jsonSql=(value:unknown)=>quote(JSON.stringify(value))+'::jsonb';
const sourceId='publication-source',updateId='publication-video';
const content='Nvidia makes RTX 5090. The GPU measured a 45 FPS result. Tape to Tape appears in the final sentence.';
const hash=contentHash(content),finding='The GPU measured a 45 FPS result.';
const cues=[{text:'Nvidia makes RTX 5090.',startSeconds:0,durationSeconds:10},{text:finding,startSeconds:20,durationSeconds:10},{text:'Tape to Tape appears in the final sentence.',startSeconds:40,durationSeconds:10}];
const card=(update:SourceUpdate,compact=false)=>renderToStaticMarkup(createElement(YouTubeCard,{update,compact,channelName:'Synthetic channel',channelIcon:'SC',date:'Oct 26',actions:null,topics:null,onChannel:()=>undefined,onOpen:()=>undefined,onTranscript:()=>undefined}));
type Claim={job:{id:string;task:'summary'|'keywords'};leaseToken:string};

describe.skipIf(!available)('actual publication through authenticated archive loading and reader rendering',()=>{
 let directory:string,args:string[],started=false,sequence=0;
 const sql=(query:string)=>execFileSync('psql',args,{input:query,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(query:string)=>sql('set role service_role;'+query);
 const json=(query:string)=>{const result=service(query);return result==='t'?true:result==='f'?false:JSON.parse(result||'null');};
 const ledger=()=>service("select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.reader_content_analysis_calls c;");
 const workspace=(owner:string)=>service(`select to_jsonb(w) from public.reader_workspaces w where user_id=${quote(owner)};`);
 const readOwn=(owner:string)=>JSON.parse(sql(`set role authenticated;set request.jwt.claims=${quote(JSON.stringify({sub:owner}))};select coalesce(jsonb_agg(record order by id),'[]') from public.reader_source_updates;`)) as unknown[];
 const reload=(owner:string)=>readOwn(owner).map(sanitizeArchivedUpdate).filter((update):update is SourceUpdate=>!!update);
 const prepare=(claim:Claim,result:unknown)=>json(`select public.prepare_content_analysis_job(${quote(claim.job.id)},${quote(claim.leaseToken)},${jsonSql(result)});`);
 const publish=(claim:Claim)=>json(`select public.publish_content_analysis_job(${quote(claim.job.id)},${quote(claim.leaseToken)});`);
 const fail=(claim:Claim)=>json(`select public.fail_content_analysis_job(${quote(claim.job.id)},${quote(claim.leaseToken)},'analysis_unsupported_mention',false);`);
 beforeAll(()=>{
  directory=mkdtempSync(join(tmpdir(),'recap-publication-reader-'));const data=join(directory,'data'),socket=join(directory,'socket');mkdirSync(socket);
  execFileSync('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-k ${socket} -h '' -p 55503`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p','55503','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const migrations=new URL('../supabase/migrations/',import.meta.url);
  for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())sql(readFileSync(new URL(name,migrations),'utf8'));
  service('update public.content_analysis_budget set enabled=true,daily_limit_usd=5,lifetime_limit_usd=5;');
 },20000);
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(directory,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(directory)rmSync(directory,{recursive:true,force:true});});
 function fixture(transcriptSegments=cues){
  const owner='publication-owner-'+ ++sequence;
  const state={version:1,followedSourceIds:[sourceId],customSources:[{id:sourceId,name:'Synthetic channel',url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',platform:'YouTube',status:'ready',creatorIds:[]}],savedUpdateIds:[updateId],readLaterIds:[updateId],importedUpdates:[],sourcePreferences:{[sourceId]:{showShorts:false}},settings:{interests:['Technology'],interfaceLanguage:'en',recapLanguage:'en',timezone:'Europe/Berlin',deliveryTime:'08:00',emailReminder:false}};
  const record={id:updateId,sourceId,title:'Synthetic publication result',summary:'Preserve the original description.',url:'https://www.youtube.com/watch?v=abcDEFghijk',publishedAt:'2026-10-26T08:00:00Z',format:'video',contentKind:'transcript',content,coverage:'Partial saved captions',isSample:false,videoFormat:{kind:'regular',basis:'watch_page'},transcriptSegments,topics:[],brands:[],sponsors:[],references:[],insights:[],contributorIds:[]};
  service(`insert into public.reader_workspaces(user_id,state) values(${quote(owner)},${jsonSql(state)});
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values(${quote(owner)},true,5,5,.1,'fixture-model');
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values(${quote(owner)},${quote(updateId)},${quote(sourceId)},'fixture',${quote(record.publishedAt)},${jsonSql(record)});
   select public.sync_content_analysis_jobs(${quote(owner)},200);`);
  const claims=[json(`select public.claim_content_analysis_job(${quote(owner)},900);`),json(`select public.claim_content_analysis_job(${quote(owner)},900);`)] as Claim[];
  expect(claims.map(c=>c.job.task).sort()).toEqual(['keywords','summary']);
  return {owner,state,record,summary:claims.find(c=>c.job.task==='summary')!,keywords:claims.find(c=>c.job.task==='keywords')!};
 }
 const summaryOutput=()=>({state:'ready',pending:[],patch:{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'captions'},videoHighlights:[{text:finding,startSeconds:20}]},evidence:{contentHash:hash,sourceContentState:'partial',coverage:[{start:0,end:content.length}],selected:[{text:finding,evidenceQuote:finding,startSeconds:20}]}});
 const candidate=(label='Nvidia',confidence=100)=>({label,kind:label==='Nvidia'?'brand':'technology',confidence,reason:'Explicit synthetic mention.',evidenceQuote:label==='Nvidia'?cues[0].text:cues[1].text,mention:label,ranges:[{startSeconds:label==='Nvidia'?0:20,endSeconds:label==='Nvidia'?10:30}]});
 const keywordOutput=(pending=false)=>({state:pending?'review':'ready',patch:{keywordRuleVersion:'entities-v2'},pending:pending?[candidate('GPU',40)]:[],evidence:{contentHash:hash,ruleVersion:'entities-v2',coverage:[{start:0,end:content.length}],accepted:[candidate()]}});
 // Keep an exact decimal inside JSONB without a JS Number roundtrip. Existing
 // persisted numeric sums must remain valid alongside the engine's binary64 sum.
 const timedKeywordSql=(startSeconds:number,endLiteral:string)=>{
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(endLiteral))throw new Error('Synthetic exact decimal required');
  const original=keywordOutput(),result={...original,evidence:{...original.evidence,accepted:[{...candidate(),ranges:[{startSeconds,endSeconds:'__EXACT_CUE_END__'}]}]}};
  return jsonSql(result).replace('"__EXACT_CUE_END__"',endLiteral);
 };
 const cueArithmeticCases=[
  {name:'small JS Number sum',start:.1,duration:.2,end:String(.1+.2)},
  {name:'large JS Number sum',start:463,duration:4.439999999999998,end:String(463+4.439999999999998)},
  {name:'legacy exact small numeric sum',start:.1,duration:.2,end:'0.3'},
  {name:'legacy exact large numeric sum',start:463,duration:4.439999999999998,end:'467.439999999999998'},
 ];
 it.each(cueArithmeticCases)('accepts $name through validation, publication and a fresh owner read',({start,duration,end})=>{
  const f=fixture([{text:cues[0].text,startSeconds:start,durationSeconds:duration}]),result=timedKeywordSql(start,end),before=ledger(),workspaceBefore=workspace(f.owner);
  service(`select public.validate_content_analysis_result('keywords',${result},${jsonSql(f.record)},${quote(hash)});`);
  json(`select public.prepare_content_analysis_job(${quote(f.keywords.job.id)},${quote(f.keywords.leaseToken)},${result});`);
  expect(publish(f.keywords)).toBe(true);
  expect(service(`select record#>>'{videoKeywords,0,ranges,0,endSeconds}' from public.reader_source_updates where user_id=${quote(f.owner)} and id=${quote(updateId)};`)).toBe(end);
  const loaded=reload(f.owner)[0];expect(loaded.videoKeywords?.[0].ranges).toEqual([{startSeconds:start,endSeconds:Number(end)}]);
  expect(card(loaded)).toContain('Nvidia');expect(reload(f.owner)).toEqual([loaded]);
  expect(ledger()).toBe(before);expect(workspace(f.owner)).toBe(workspaceBefore);
 });
 it.each([
  {name:'small arbitrary nearby value',start:.1,duration:.2,end:'0.300001'},
  {name:'small adjacent binary64 value',start:.1,duration:.2,end:'0.3000000000000001'},
  {name:'large arbitrary nearby value',start:463,duration:4.439999999999998,end:'467.440001'},
  {name:'large adjacent binary64 value',start:463,duration:4.439999999999998,end:'467.44000000000005'},
 ])('rejects $name without an epsilon allowance or a prepared/public output',({start,duration,end})=>{
  const f=fixture([{text:cues[0].text,startSeconds:start,durationSeconds:duration}]),result=timedKeywordSql(start,end),before=ledger();
  expect(()=>service(`select public.validate_content_analysis_result('keywords',${result},${jsonSql(f.record)},${quote(hash)});`)).toThrow(/PT400.*Ungrounded keyword time/s);
  expect(()=>json(`select public.prepare_content_analysis_job(${quote(f.keywords.job.id)},${quote(f.keywords.leaseToken)},${result});`)).toThrow(/PT400.*Ungrounded keyword time/s);
  expect(json(`select jsonb_build_object('state',state,'result',result) from public.reader_content_analysis_jobs where id=${quote(f.keywords.job.id)};`)).toEqual({state:'running',result:null});
  expect(reload(f.owner)[0].videoKeywords).toBeUndefined();expect(ledger()).toBe(before);
 });
 it.each(cueArithmeticCases.slice(0,2))('validates $name under extra_float_digits=0 without changing the session setting',({start,duration,end})=>{
  const f=fixture([{text:cues[0].text,startSeconds:start,durationSeconds:duration}]),result=timedKeywordSql(start,end);
  const actual=json(`set extra_float_digits=0;
   select public.validate_content_analysis_result('keywords',${result},${jsonSql(f.record)},${quote(hash)});
   select jsonb_build_object('extraFloatDigits',current_setting('extra_float_digits'));`);
  expect(actual).toEqual({extraFloatDigits:'0'});
 });
 it('keeps summary seek times restricted to original cue starts, not newly admitted computed ends',()=>{
  const f=fixture([{text:cues[0].text,startSeconds:.1,durationSeconds:.2}]),original=summaryOutput(),atEnd=.1+.2;
  const atStart={...original,patch:{...original.patch,videoHighlights:[{text:finding,startSeconds:.1}]},evidence:{...original.evidence,selected:[{text:finding,evidenceQuote:finding,startSeconds:.1}]}};
  service(`select public.validate_content_analysis_result('summary',${jsonSql(atStart)},${jsonSql(f.record)},${quote(hash)});`);
  const result={...original,patch:{...original.patch,videoHighlights:[{text:finding,startSeconds:atEnd}]},evidence:{...original.evidence,selected:[{text:finding,evidenceQuote:finding,startSeconds:atEnd}]}};
  expect(()=>service(`select public.validate_content_analysis_result('summary',${jsonSql(result)},${jsonSql(f.record)},${quote(hash)});`)).toThrow(/PT400.*Ungrounded takeaway time/s);
 });
 it.each(['summary','keywords'] as const)('persists both independent outputs when %s publishes first, then survives a fresh owner load',first=>{
  const f=fixture(),workspaceBefore=workspace(f.owner),ledgerBefore=ledger();
  const old=reload(f.owner),prior=old[0];
  const publishTask=(task:'summary'|'keywords')=>{const claim=f[task];prepare(claim,task==='summary'?summaryOutput():keywordOutput());expect(publish(claim)).toBe(true);};
  publishTask(first);
  const refreshed=mergeProcessingRefresh(old,readOwn(f.owner),[updateId],[sourceId]);
  expect(refreshed[0]).not.toBe(prior);
  expect(getContentProcessing(refreshed[0])[first==='summary'?'recap':'keywords']).toBe('ready');
  publishTask(first==='summary'?'keywords':'summary');
  const fromCloud=reload(f.owner),published=fromCloud[0];
  expect(getContentProcessing(published)).toMatchObject({content:'partial',recap:'ready',keywords:'ready'});
  expect(published.keywordContentHash).toBe(hash);expect(published.videoSummary?.captionHash).toBe(hash);
  for(const compact of [false,true]){
   const html=card(published,compact);expect(html).toContain(finding);expect(html).toContain('Nvidia');expect(html).toContain('Partial captions');
   expect(html).toContain('href="https://www.youtube.com/watch?v=abcDEFghijk&amp;t=20s"');expect(html).toContain('Full transcript');
   expect(html).not.toContain('evidenceQuote');expect(html).not.toContain('confidence');
  }
  const details=renderToStaticMarkup(createElement(VideoTakeaways,{update:published}));expect(details).toContain(finding);expect(details).toContain('&amp;t=20s');
  expect(reload(f.owner)).toEqual(fromCloud);expect(publish(f[first])).toBe(true);
  expect(ledger()).toBe(ledgerBefore);expect(workspace(f.owner)).toBe(workspaceBefore);
  const saved=sanitizeWorkspace(JSON.parse(workspace(f.owner)).state)!;expect(saved.savedUpdateIds).toEqual([updateId]);expect(saved.readLaterIds).toEqual([updateId]);expect(saved.sourcePreferences?.[sourceId].showShorts).toBe(false);
  expect(updatesForSourcePreferences([published,{...published,id:'short',videoFormat:{kind:'short',basis:'provider'}},{...published,id:'unknown',videoFormat:{kind:'unknown',basis:'legacy'}}],saved).map(u=>u.id)).toEqual([updateId]);
  expect(readOwn('ordinary-unrelated-reader')).toEqual([]);
  expect(()=>sql('set role anon;select record from public.reader_source_updates;')).toThrow(/42501.*permission denied/s);
  expect(()=>sql(`set role authenticated;set request.jwt.claims=${quote(JSON.stringify({sub:f.owner}))};select * from public.admin_keyword_reviews;`)).toThrow(/42501.*permission denied/s);
 });
 it.each(['summary','keywords'] as const)('keeps the accepted %s visible when its independent counterpart fails',accepted=>{
  const f=fixture(),claim=f[accepted],other=f[accepted==='summary'?'keywords':'summary'];
  prepare(claim,accepted==='summary'?summaryOutput():keywordOutput());expect(publish(claim)).toBe(true);fail(other);
  const published=reload(f.owner)[0],html=card(published);
  if(accepted==='summary'){expect(html).toContain(finding);expect(html).toContain('Keyword processing failed');}
  else{expect(html).toContain('Nvidia');expect(html).toContain('Takeaway processing failed');}
  expect(html).toContain('Full transcript');expect(html).toContain('Watch original');expect(ledger()).toBe('[]');
 });
 it('retains private review and corrected label/type decisions across publication and reload',()=>{
  const f=fixture(),workspaceBefore=workspace(f.owner);
  prepare(f.summary,summaryOutput());publish(f.summary);prepare(f.keywords,keywordOutput(true));publish(f.keywords);
  let loaded=reload(f.owner)[0],html=card(loaded);
  expect(html).not.toContain('Keywords awaiting review');expect(html).toContain('Nvidia');expect(html).not.toContain('Explicit synthetic mention.');
  expect(getContentProcessing(loaded).keywords).toBe('review');
  expect(loaded.videoKeywords?.map(k=>k.label)).toEqual(['Nvidia']);
  const pending=json(`select to_jsonb(q) from public.admin_keyword_reviews q where user_id=${quote(f.owner)} and label='GPU';`);
  json(`select public.admin_review_keyword(${quote(pending.id)},${quote(pending.updated_at)},'synthetic-admin','approve','Graphics processors','category');`);
  loaded=reload(f.owner)[0];expect(getContentProcessing(loaded)).toMatchObject({recap:'ready',keywords:'ready'});
  expect(loaded.videoKeywords?.find(k=>k.label==='Graphics processors')?.ranges).toEqual([{startSeconds:20,endSeconds:30}]);
  expect(loaded.brands).not.toContain('Graphics processors');expect(loaded.topics).toContain('Graphics processors');
  expect(card(loaded)).toContain('Graphics processors');expect(card(loaded)).toContain(finding);
  expect(workspace(f.owner)).toBe(workspaceBefore);expect(ledger()).toBe('[]');
 });
 it('withholds stale output after a source change without deleting the saved audit or recharging',()=>{
  const f=fixture();prepare(f.summary,summaryOutput());publish(f.summary);prepare(f.keywords,keywordOutput());publish(f.keywords);
  const before=reload(f.owner)[0],ledgerBefore=ledger();
  service(`update public.reader_source_updates set record=record||${jsonSql({content:content+' Additional recovered ending.'})} where user_id=${quote(f.owner)} and id=${quote(updateId)};`);
  const after=reload(f.owner)[0];expect(after.videoSummary).toEqual(before.videoSummary);expect(after.videoHighlights).toEqual(before.videoHighlights);
  expect(getContentProcessing(after)).toMatchObject({recap:'pending',keywords:'pending'});expect(card(after)).not.toContain(finding);expect(card(after)).not.toContain('video-keyword-footer');
  expect(ledger()).toBe(ledgerBefore);
 });
});
