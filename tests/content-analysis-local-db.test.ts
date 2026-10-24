import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentHash, getContentProcessing, getKeywordContentHash } from '../src/lib/content-processing';
import type { SourceUpdate } from '../src/lib/types';

// Self-contained DATABASE-ONLY fixtures. Uses a private Unix socket with TCP
// disabled. Loads schema files into an empty disposable cluster; never links
// Supabase, connects to a project, or writes migration history.
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => {
 try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
class Session {
 private child: ChildProcessWithoutNullStreams;
 private stdout = ''; private stderr = ''; private sequence = 0;
 private pending?: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
 constructor(args: string[]) {
  this.child = spawn('psql', args, { stdio: 'pipe' });
  this.child.stdout.on('data', chunk => {
   this.stdout += String(chunk);
   if (this.pending && this.stdout.includes(this.pending.marker + '\n')) {
    const p = this.pending, end = this.stdout.indexOf(p.marker + '\n'); this.pending = undefined;
    const output = this.stdout.slice(0, end).trim(); this.stdout = this.stdout.slice(end + p.marker.length + 1);
    clearTimeout(p.timer); p.resolve(output);
   }
  });
  this.child.stderr.on('data', chunk => { this.stderr += String(chunk); });
  const fail = (error: Error) => { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; } };
  this.child.on('error', fail);
  this.child.on('exit', code => fail(new Error(`Local psql exited ${code}: ${this.stderr}`)));
 }
 run(sql: string): Promise<string> {
  if (this.pending) throw new Error('Only one outstanding command per local session');
  return new Promise((resolve, reject) => {
   const marker = `analysis_command_${++this.sequence}_done`;
   const timer = setTimeout(() => { this.child.kill('SIGKILL'); reject(new Error('Local SQL session timeout: ' + this.stderr)); }, 8000);
   this.pending = { marker, resolve, reject, timer };
   this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
  });
 }
 close() { this.child.stdin.end(); this.child.kill('SIGTERM'); }
}
describe.skipIf(!available)('D35 actual disposable PostgreSQL acceptance and sync lock regression', () => {
 let root: string, args: string[], started = false, count = 0;
 const sql = (query: string) => execFileSync('psql', args, { input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
 beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'recap-analysis-db-')); const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -h '' -p 55493`, 'start'], { stdio: 'ignore' }); started = true;
  args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55493', '-U', 'postgres', '-d', 'postgres'];
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant execute on function auth.jwt() to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to service_role;`);
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) sql(readFileSync(new URL(name, directory), 'utf8'));
 }, 20000);
 afterAll(() => {
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' });
  if (root) rmSync(root, { recursive: true, force: true });
 });
 it('passes rollback-only queue, budget/day recovery, exhausted lease, fairness, deletion and admin status acceptance', () => {
  const output = sql(readFileSync(new URL('./content-analysis-db.sql', import.meta.url), 'utf8'));
  expect(output).toBe('');
 });
 const currentText='AMD makes Ryzen processors. GPU comparisons were measured in this test.';
 const currentHash=contentHash(currentText),oldHash=contentHash('Nvidia makes graphics cards.');
 const provenanceCases=[
  {name:'old legacy source hash',legacyHash:oldHash,expected:oldHash},
  {name:'matching legacy source hash',legacyHash:currentHash,expected:currentHash},
  {name:'missing legacy source hash',expected:null},
  {name:'invalid legacy source hash',legacyHash:'unverified',expected:null},
  {name:'explicit unknown overrides matching summary',legacyHash:currentHash,ownHash:null,expected:null},
  {name:'malformed explicit hash blocks fallback',legacyHash:currentHash,ownHash:'invalid',expected:null},
  {name:'independent old hash overrides fresh summary',legacyHash:currentHash,ownHash:oldHash,expected:oldHash},
  {name:'current independent review survives',legacyHash:oldHash,ownHash:currentHash,expected:currentHash,state:'review'},
  {name:'current independent failure survives',legacyHash:oldHash,ownHash:currentHash,expected:currentHash,state:'failed'},
 ];
 it.each(provenanceCases)('freezes $name before actual independent summary publication',scenario=>{
  const owner='analysis-provenance-'+ ++count,source='analysis-provenance-source';
  const state={version:1,followedSourceIds:[source],customSources:[{id:source,name:'Synthetic channel',url:'https://example.org/channel',platform:'YouTube',status:'ready',creatorIds:[]}],savedUpdateIds:[],readLaterIds:[],importedUpdates:[],settings:{}};
  const record={id:'provenance-video',sourceId:source,title:'Synthetic provenance',url:'https://example.org/video',publishedAt:'2026-10-24T00:00:00Z',format:'video',isSample:false,videoFormat:{kind:'regular',basis:'watch_page'},contentKind:'transcript',content:currentText,
   videoKeywords:[{label:'Nvidia',ranges:[]}],topics:['Nvidia'],brands:['Nvidia'],...(scenario.legacyHash?{videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:scenario.legacyHash,timingBasis:'none'},videoHighlights:[{text:'Historical finding.'}]}:{}),...('ownHash' in scenario?{keywordContentHash:scenario.ownHash}:{})};
  sql(`insert into public.reader_workspaces(user_id,state) values('${owner}','${JSON.stringify(state)}');
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values('${owner}',true,1,2,1,'fixture-model');
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('${owner}','provenance-video','${source}','fixture','${record.publishedAt}','${JSON.stringify(record)}');
   select public.sync_content_analysis_jobs('${owner}',200);
   -- Exercise an authorized reprocessing of an already-valid legacy summary too.
   update public.reader_content_analysis_jobs set state='queued' where user_id='${owner}' and task='summary';
   do $$ declare c jsonb; chosen jsonb; n integer; output jsonb; begin
    for n in 1..2 loop c:=public.claim_content_analysis_job('${owner}',900);if c#>>'{job,task}'='summary' then chosen:=c;end if;end loop;
    if chosen is null then raise exception 'Synthetic summary claim missing';end if;
    update public.reader_source_updates set record=jsonb_set(record,'{processing,keywords}',to_jsonb('${scenario.state||'ready'}'::text)) where user_id='${owner}';
    output:=jsonb_build_object('state','ready','pending','[]'::jsonb,'patch',jsonb_build_object('videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash','${currentHash}','timingBasis','none'),'videoHighlights','[{"text":"AMD makes Ryzen processors."}]'::jsonb),
     'evidence',jsonb_build_object('contentHash','${currentHash}','sourceContentState','partial','coverage','[{"start":0,"end":${currentText.length}}]'::jsonb,'selected','[{"text":"AMD makes Ryzen processors.","evidenceQuote":"AMD makes Ryzen processors."}]'::jsonb));
    perform public.prepare_content_analysis_job((chosen#>>'{job,id}')::uuid,(chosen->>'leaseToken')::uuid,output);
    perform public.publish_content_analysis_job((chosen#>>'{job,id}')::uuid,(chosen->>'leaseToken')::uuid);
    -- A repeated successful publication must not replace the independent hash.
    perform public.publish_content_analysis_job((chosen#>>'{job,id}')::uuid,(chosen->>'leaseToken')::uuid);
   end $$;`);
  const published=JSON.parse(sql(`select record from public.reader_source_updates where user_id='${owner}';`)) as SourceUpdate;
  expect(Object.hasOwn(published,'keywordContentHash')).toBe(true);
  expect(published.keywordContentHash).toBe(scenario.expected);
  expect(published.videoSummary?.captionHash).toBe(currentHash);
  expect(published.videoKeywords).toEqual(record.videoKeywords);expect(published.topics).toEqual(record.topics);expect(published.brands).toEqual(record.brands);
  expect(getKeywordContentHash(published)).toBe(scenario.expected);
  expect(getContentProcessing(published).keywords).toBe(scenario.expected===currentHash?scenario.state||'ready':'pending');
  expect(getContentProcessing(published).recap).toBe('ready');
 });
 it.each([{decision:'approve',ownHash:oldHash},{decision:'reject',ownHash:oldHash},{decision:'approve',ownHash:null},{decision:'reject',ownHash:null}])('keeps $decision on stale/unknown inventory from promoting unrelated labels or old ranges',scenario=>{
  const owner='analysis-admin-provenance-'+ ++count,source='analysis-provenance-source';
  const content='Opening context. GPU measured a 45 FPS result. Nvidia is explicitly mentioned.',hash=contentHash(content);
  const record={id:'admin-video',sourceId:source,title:'Synthetic admin provenance',url:'https://example.org/admin-video',publishedAt:'2026-10-24T00:00:00Z',format:'video',isSample:false,videoFormat:{kind:'regular',basis:'watch_page'},contentKind:'transcript',content,
   videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:oldHash,timingBasis:'none'},videoHighlights:[{text:'Old finding.'}],
   keywordContentHash:scenario.ownHash,videoKeywords:[{label:'GPU',ranges:[{startSeconds:0,endSeconds:10}],seconds:10},{label:'ObsoleteBrand',ranges:[]}],topics:['GPU','ObsoleteBrand'],brands:['ObsoleteBrand'],
   transcriptSegments:[{text:'Opening context.',startSeconds:0,durationSeconds:10},{text:'GPU measured a 45 FPS result.',startSeconds:20,durationSeconds:10},{text:'Nvidia is explicitly mentioned.',startSeconds:40,durationSeconds:10}]};
  const state={version:1,followedSourceIds:[source],customSources:[{id:source,name:'Synthetic channel',url:'https://example.org/channel',platform:'YouTube',status:'ready',creatorIds:[]}],savedUpdateIds:[],readLaterIds:[],importedUpdates:[],settings:{}};
  sql(`insert into public.reader_workspaces(user_id,state) values('${owner}','${JSON.stringify(state)}');
   insert into public.reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model) values('${owner}',true,1,2,1,'fixture-model');
   insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('${owner}','admin-video','${source}','fixture','${record.publishedAt}','${JSON.stringify(record)}');
   insert into public.admin_keyword_reviews(user_id,update_id,source_id,content_hash,label,kind,confidence,reason,evidence_quote,proposed_ranges,update_title,update_url)
    values('${owner}','admin-video','${source}','${hash}','GPU','category',40,'Synthetic ambiguity','GPU measured a 45 FPS result.','[{"startSeconds":20,"endSeconds":30}]','','');
   do $$ declare q public.admin_keyword_reviews; begin
    select * into q from public.admin_keyword_reviews where user_id='${owner}';
    perform public.admin_review_keyword(q.id,q.updated_at,'synthetic-admin','${scenario.decision}','${scenario.decision==='approve'?'Graphics processors':'GPU'}','category');
   end $$;`);
  const decided=JSON.parse(sql(`select record from public.reader_source_updates where user_id='${owner}';`)) as SourceUpdate;
  expect(decided.keywordContentHash).toBe(scenario.ownHash);expect(decided.topics).toContain('ObsoleteBrand');
  expect(getContentProcessing(decided).keywords).toBe('pending');
  if(scenario.decision==='approve') {
   expect(decided.videoKeywords?.find(k=>k.label==='Graphics processors')?.ranges).toEqual([{startSeconds:20,endSeconds:30}]);
   // Independently test full-publish range reuse: a historical archive artifact
   // can still carry old timing for an already-corrected current admin label.
   // Removing only the publication guard must make the final assertion fail.
   sql(`update public.reader_source_updates set record=jsonb_set(record,'{videoKeywords}',
    '[{"label":"Graphics processors","ranges":[{"startSeconds":0,"endSeconds":10}],"seconds":10},{"label":"ObsoleteBrand","ranges":[]}]'::jsonb) where user_id='${owner}';`);
  }
  const priorDecisions=sql(`select jsonb_agg(to_jsonb(q) order by q.id) from public.admin_keyword_reviews q where user_id='${owner}';`);
  sql(`do $$ declare c jsonb; summary_job jsonb; keyword_job jsonb; n integer; result jsonb; begin
   perform public.sync_content_analysis_jobs('${owner}',200);
   for n in 1..2 loop c:=public.claim_content_analysis_job('${owner}',900);if c#>>'{job,task}'='summary' then summary_job:=c;else keyword_job:=c;end if;end loop;
   result:=jsonb_build_object('state','ready','patch','{"keywordRuleVersion":"entities-v2"}'::jsonb,'pending','[]'::jsonb,'evidence',jsonb_build_object('contentHash','${hash}','ruleVersion','entities-v2','coverage','[{"start":0,"end":${content.length}}]'::jsonb,'accepted',
    '[{"label":"GPU","kind":"category","confidence":100,"reason":"Explicit category","evidenceQuote":"GPU measured a 45 FPS result.","ranges":[{"startSeconds":20,"endSeconds":30}]},{"label":"Nvidia","kind":"brand","confidence":100,"reason":"Explicit brand","evidenceQuote":"Nvidia is explicitly mentioned.","ranges":[{"startSeconds":40,"endSeconds":50}]}]'::jsonb));
   perform public.prepare_content_analysis_job((keyword_job#>>'{job,id}')::uuid,(keyword_job->>'leaseToken')::uuid,result);
   perform public.publish_content_analysis_job((keyword_job#>>'{job,id}')::uuid,(keyword_job->>'leaseToken')::uuid);
   -- Keywords publish first; the subsequent summary must retain their hash.
   result:=jsonb_build_object('state','ready','pending','[]'::jsonb,'patch',jsonb_build_object('videoSummary',jsonb_build_object('ruleVersion','takeaways-v1','status','ready','captionHash','${hash}','timingBasis','captions'),'videoHighlights','[{"text":"The GPU measured a 45 FPS result.","startSeconds":20}]'::jsonb),
    'evidence',jsonb_build_object('contentHash','${hash}','sourceContentState','partial','coverage','[{"start":0,"end":${content.length}}]'::jsonb,'selected','[{"text":"The GPU measured a 45 FPS result.","evidenceQuote":"GPU measured a 45 FPS result.","startSeconds":20}]'::jsonb));
   perform public.prepare_content_analysis_job((summary_job#>>'{job,id}')::uuid,(summary_job->>'leaseToken')::uuid,result);
   perform public.publish_content_analysis_job((summary_job#>>'{job,id}')::uuid,(summary_job->>'leaseToken')::uuid);
  end $$;`);
  const published=JSON.parse(sql(`select record from public.reader_source_updates where user_id='${owner}';`)) as SourceUpdate;
  expect(published.keywordContentHash).toBe(hash);expect(published.topics).not.toContain('ObsoleteBrand');expect(published.topics).toContain('Nvidia');
  expect(published.topics).not.toContain('GPU');
  if(scenario.decision==='approve')expect(published.videoKeywords?.find(k=>k.label==='Graphics processors')?.ranges).toEqual([{startSeconds:20,endSeconds:30}]);
  else expect(published.topics).not.toContain('Graphics processors');
  expect(sql(`select jsonb_agg(to_jsonb(q) order by q.id) from public.admin_keyword_reviews q where user_id='${owner}';`)).toBe(priorDecisions);
  expect(getContentProcessing(published)).toMatchObject({recap:'ready',keywords:'ready'});
 });
 function fixture() {
  const owner = 'analysis-lock-owner-' + ++count, source = 'analysis-lock-source';
  const state = { version: 1, followedSourceIds: [source], customSources: [{ id: source, name: 'Synthetic channel', url: 'https://example.org/channel', platform: 'YouTube', status: 'ready', creatorIds: [] }], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], settings: {} };
  sql(`insert into public.reader_workspaces(user_id,state) values('${owner}','${JSON.stringify(state)}');`);
  for (const [id, date] of [['older', '2026-10-23'], ['newer', '2026-10-24']]) {
   const record = { id, sourceId: source, publishedAt: date + 'T00:00:00Z', url: 'https://example.org/' + id, title: 'Synthetic ' + id, isSample: false, format: 'video', contentKind: 'transcript', content: 'Synthetic saved source words.', videoFormat: { kind: 'regular', basis: 'watch_page' }, topics: [], brands: [] };
   sql(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record) values('${owner}','${id}','${source}','fixture','${record.publishedAt}','${JSON.stringify(record)}');`);
  }
  return owner;
 }
 async function concurrentSync() {
  const owner = fixture(), a = new Session(args), b = new Session(args);
  try {
   // Same older->newer archive UPDATE order as hourly caller-supplied items.
   // The second session explicitly holds newer SHARE before calling actual
   // sync, making the previously reproduced lock cycle deterministic.
   await a.run(`begin; set local statement_timeout='5s'; set local deadlock_timeout='100ms'; select 1 from public.reader_source_updates where user_id='${owner}' and id='older' for update;`);
   await b.run(`begin; set local statement_timeout='5s'; set local deadlock_timeout='100ms'; select 1 from public.reader_source_updates where user_id='${owner}' and id='newer' for share;`);
   const writer = a.run(`update public.reader_source_updates set record=record||'{"summary":"New hourly metadata"}' where user_id='${owner}' and id='newer'; commit;`)
    .then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
   const sync = b.run(`select public.sync_content_analysis_jobs('${owner}',200); commit;`)
    .then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
   const outcomes = await Promise.all([writer, sync]);
   return { owner, outcomes };
  } finally { a.close(); b.close(); }
 }
 it('skips the older hourly lock, commits both sessions, and enqueues the skipped row next time', async () => {
  const { owner, outcomes } = await concurrentSync();
  for (const result of outcomes) expect(result.ok, 'error' in result ? result.error : '').toBe(true);
  expect(sql(`select count(*) from public.reader_content_analysis_jobs where user_id='${owner}';`)).toBe('2');
  sql(`select public.sync_content_analysis_jobs('${owner}',200);`);
  expect(sql(`select count(*) from public.reader_content_analysis_jobs where user_id='${owner}';`)).toBe('4');
 });
 it('reproduces the previous deadlock when only sync SKIP LOCKED is removed', async () => {
  const definition = sql("select pg_get_functiondef('public.sync_content_analysis_jobs(text,integer,text)'::regprocedure);");
  expect(definition).toContain('for share of r skip locked');
  try {
   sql(definition.replace('for share of r skip locked', 'for share of r'));
   const { outcomes } = await concurrentSync();
   expect(outcomes.some(result => 'error' in result && result.error.includes('40P01') && result.error.includes('deadlock detected'))).toBe(true);
  } finally { sql(definition); }
 });
});
