import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composeDailyBriefing } from '../netlify/functions/_shared/daily-briefing';
const available = ['initdb', 'pg_ctl', 'psql'].every(bin => { try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'", j = (v: unknown) => q(JSON.stringify(v)) + '::jsonb';
const owner = 'daily-fixture-owner', stranger = 'daily-fixture-other';
const continuityMigration = '20261031013730_daily_briefing_continuity.sql';
const content = 'The AeroBox device uses less power in the reported test. This is a bounded fixture and not a real source.';
const hash = createHash('sha256').update(content).digest('hex');
const finding = { text: 'The AeroBox device uses less power in the reported test.', evidenceQuote: 'The AeroBox device uses less power in the reported test.' };
const record = { id: 'daily-fixture-video', sourceId: 'daily-fixture-source', title: 'Fixture video', url: 'https://www.youtube.com/watch?v=abcdEFGH123', publishedAt: '2026-10-30T22:00:00Z', content, contentKind: 'transcript', format: 'video', isSample: false,
  videoFormat: { kind: 'regular' }, topics: ['Devices'], brands: [], videoKeywords: [{ label: 'AeroBox', ranges: [] }], keywordContentHash: hash,
  videoSummary: { ruleVersion: 'takeaways-v1', status: 'ready', captionHash: hash, timingBasis: 'none' }, videoHighlights: [{ text: finding.text }], references: [], insights: [], sponsors: [], contributorIds: [] };
const workspace = { version: 1, followedSourceIds: ['daily-fixture-source'], customSources: [{ id: 'daily-fixture-source', name: 'Fixture source', platform: 'YouTube', url: 'https://www.youtube.com/@daily-fixture', status: 'ready' }], importedUpdates: [], savedUpdateIds: [], readLaterIds: [],
  settings: { interests: ['Devices'], interfaceLanguage: 'en', recapLanguage: 'de', timezone: 'UTC', deliveryTime: '23:59', emailReminder: false } };

describe.skipIf(!available)('persisted daily briefings, disposable PostgreSQL', () => {
  let root: string, args: string[], started = false, cutoff: string, periodStart: string, day: string, sourcePublished: string;
  const sql = (s: string) => execFileSync('psql', args, { input: s, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const service = (s: string) => sql('set role service_role;' + s), data = (s: string) => JSON.parse(service(s) || 'null');
  const candidate = () => data(`select public.list_daily_briefing_candidates(null,50)->0;`);
  const claim = (c = candidate()) => data(`select public.claim_daily_briefing(${q(owner)},${q(c.generation)},${q(c.workspaceRevision)},${q(day)},${q(cutoff)},${q(periodStart)});`);
  const finish = (c: any, result = composeDailyBriefing(c.input)) => data(`select to_jsonb(public.finish_daily_briefing(${q(c.id)},${q(c.leaseToken)},${q(result.status)},${j(result.snapshot)},${j(result.findingKeys)}));`);
  const own = (s: string, id = owner) => sql(`set role authenticated;set request.jwt.claims=${q(JSON.stringify({ sub: id, role: 'authenticated' }))};` + s);
  beforeAll(() => {
    root = mkdtempSync('/tmp/rcdaily-'); mkdirSync(join(root, 'socket'));
    execFileSync('initdb', ['-D', join(root, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(root, 'data'), '-l', join(root, 'postgres.log'), '-o', `-k ${join(root, 'socket')} -h '' -p 55567`, 'start'], { stdio: 'ignore' }); started = true;
    args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', join(root, 'socket'), '-p', '55567', '-U', 'postgres', '-d', 'postgres'];
    sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const name of readdirSync(dir).filter(x => x.endsWith('.sql') && (x <= '20261031002813_daily_briefings.sql' || x === continuityMigration)).sort()) sql(readFileSync(new URL(name, dir), 'utf8'));
    cutoff = sql(`select to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
    periodStart = new Date(Date.parse(cutoff) - 86400000).toISOString(); day = cutoff.slice(0, 10); sourcePublished = new Date(Date.parse(cutoff) - 3600000).toISOString();
  }, 40000);
  beforeEach(() => {
    sql(`truncate public.social_collection_deliveries,public.social_collection_items,public.social_collection_jobs,public.social_collection_consumers,public.social_collection_sources cascade;
      truncate public.collection_jobs cascade;truncate public.collection_budget_reservations cascade;
      update public.social_collection_platforms set enabled=false;
      truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.reader_collection_policies cascade;truncate public.admin_analysis_reviews cascade;
      update public.daily_briefing_control set enabled=true;
      insert into public.reader_workspaces(user_id,state)values(${q(owner)},${j(workspace)}),(${q(stranger)},${j(workspace)});
      insert into public.reader_collection_policies(user_id,enabled)values(${q(owner)},true);
      insert into public.daily_briefing_schedules(reader_id,starts_at,settings_changed_at)values(${q(owner)},clock_timestamp()-interval'3 days',clock_timestamp()-interval'3 days');
      insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,record)
       values(${q(owner)},'daily-fixture-video','daily-fixture-source','fixture',${q(sourcePublished)},${j({ ...record, publishedAt: sourcePublished })});
      insert into public.admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason,provenance)
       values(${q(owner)},'daily-fixture-video','daily-fixture-source',${q(hash)},'recap','daily-native-fixture',${j({ ...record, publishedAt: sourcePublished })},${j({ highlights: [finding] })},'Disposable pending evidence fixture','{}');
      select public.admin_decide_analysis_review(id,updated_at,'disposable-fixture-admin','approve',null)from public.admin_analysis_reviews where dedupe_key='daily-native-fixture';
      insert into public.reader_collection_checks(user_id,source_id,source_name,source_url,platform,status,started_at,finished_at)
       values(${q(owner)},'daily-fixture-source','Fixture source','https://www.youtube.com/@daily-fixture','YouTube','unchanged',${q(sourcePublished)},${q(sourcePublished)});`);
    cutoff = sql(`select to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
    periodStart = new Date(Date.parse(cutoff) - 86400000).toISOString(); day = cutoff.slice(0, 10);
  });
  afterAll(() => { if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); if (root) rmSync(root, { recursive: true, force: true }); });
  it('freezes exact current approved findings and leaves raw archives unchanged', () => {
    const before = service(`select record::text from public.reader_source_updates where user_id=${q(owner)};`), c = claim();
    expect(c.input.updates[0].findings[0]).toMatchObject({ text: finding.text, citation: { contentHash: hash, evidenceQuote: finding.evidenceQuote } });
    expect(c.input.sources[0].state).toBe('checked'); expect(finish(c)).toBe(c.id);
    expect(service(`select record::text from public.reader_source_updates where user_id=${q(owner)};`)).toBe(before);
    expect(data(`select snapshot from public.daily_briefings where id=${q(c.id)};`).languageMode).toBe('original_approved_wording');
  });
  it('does not consume unapproved or stale-hash source text', () => {
    sql('delete from public.admin_analysis_reviews;');
    const c = claim(); expect(c.input.updates[0].findings).toEqual([]); expect(composeDailyBriefing(c.input).status).toBe('awaiting_review');
  });
  it('allows only one active claim and one permanent briefing for the logical date', () => {
    const c = claim(); expect(claim()).toBeNull(); finish(c); expect(claim()).toBeNull();
    expect(service('select count(*)from public.daily_briefings;')).toBe('1');
    expect(() => finish(c)).toThrow();
  });
  it('recovers the same frozen claim after lease expiry without rereading inputs', () => {
    const c = claim(); sql(`update public.daily_briefing_jobs set lease_until=clock_timestamp()-interval'1 second';update public.reader_workspaces set state=jsonb_set(state,'{settings,interests}','["Changed"]')where user_id=${q(owner)};`);
    const next = claim(); expect(next.id).toBe(c.id); expect(next.leaseToken).not.toBe(c.leaseToken); expect(next.input).toEqual(c.input); expect(() => finish(c)).toThrow(); finish(next);
  });
  it('rejects invented wording even when it retains a real citation', () => {
    const c = claim(), output = composeDailyBriefing(c.input); output.snapshot.topics[0].points[0].text = 'An unsupported invented conclusion.';
    expect(() => finish(c, output)).toThrow(); expect(service('select count(*)from public.daily_briefings;')).toBe('0');
  });
  it('rejects a false complete source count and altered inventory links', () => {
    const c = claim(), output = composeDailyBriefing(c.input); output.snapshot.coverage.checkedSources = 999;
    expect(() => finish(c, output)).toThrow();
    const changed = composeDailyBriefing(c.input); changed.snapshot.allUpdates[0].url = 'https://unrelated.example/item';
    expect(() => finish(c, changed)).toThrow();
  });
  it('preserves a crashed earlier day and carries its source forward after a multi-day outage', () => {
    const currentCutoff=cutoff,currentDay=day,currentStart=periodStart;
    const oldCutoff=new Date(Date.parse(cutoff)-2*86400000).toISOString(),oldStart=new Date(Date.parse(cutoff)-3*86400000).toISOString(),oldPublication=new Date(Date.parse(oldCutoff)-3600000).toISOString();
    sql(`update public.reader_source_updates set published_at=${q(oldPublication)},record=jsonb_set(record,'{publishedAt}',${j(oldPublication)});`);
    const c=candidate(),old=data(`select public.claim_daily_briefing(${q(owner)},${q(c.generation)},${q(c.workspaceRevision)},${q(oldCutoff.slice(0,10))},${q(oldCutoff)},${q(oldStart)});`);
    expect(old.input.updates).toHaveLength(1);
    sql(`update public.daily_briefing_jobs set lease_until=clock_timestamp()-interval'1 second';`);
    const latest=data(`select public.claim_daily_briefing(${q(owner)},${q(c.generation)},${q(c.workspaceRevision)},${q(currentDay)},${q(currentCutoff)},${q(currentStart)});`);
    expect(latest.input.updates[0].findings).toHaveLength(1);
    expect(service(`select state from public.daily_briefing_jobs where id=${q(old.id)};`)).toBe('failed');
    expect(data(`select published_at from public.daily_briefings where id=${q(old.id)};`)).toBeNull();
    expect(()=>finish(old)).toThrow();finish(latest);
  });
  it('keeps updates between an early cycle and the next scheduled period without repeating consumed findings', () => {
    const early=claim();finish(early);
    const saved=data(`select snapshot from public.daily_briefings where id=${q(early.id)};`);
    expect(service('select count(*)from public.daily_briefing_consumed_findings;')).toBe('1');
    // A native early cycle has already consumed today's slot. The pure input
    // function can evaluate the following scheduled window without moving the
    // database clock or bypassing claim's future-cutoff guard.
    const nextStart=new Date(Date.parse(cutoff)+6*3600000).toISOString(),nextCutoff=new Date(Date.parse(cutoff)+30*3600000).toISOString();
    const gapAt=new Date(Date.parse(cutoff)+2*3600000).toISOString();
    const gapRecord={...record,id:'daily-gap-video',publishedAt:gapAt,videoSummary:undefined,videoHighlights:[]};
    sql(`insert into public.reader_source_updates(user_id,id,source_id,collection_id,published_at,updated_at,record)
      values(${q(owner)},'daily-gap-video','daily-fixture-source','fixture',${q(gapAt)},${q(gapAt)},${j(gapRecord)});
      update public.reader_source_updates set record=jsonb_set(record,'{summary}','"Metadata refreshed after the early cycle"')where user_id=${q(owner)}and id='daily-fixture-video';`);
    const next=data(`select public.daily_briefing_input(${q(owner)},${q(nextStart)},${q(nextCutoff)},${q(nextCutoff.slice(0,10))});`);
    expect(next.periodStart).not.toBe(early.input.periodStart);
    expect(next.updates).toHaveLength(1);
    expect(next.updates[0]).toMatchObject({updateId:'daily-gap-video',lateArrival:true,state:'awaiting_review',findings:[]});
    expect(next.updates.some((u:any)=>u.updateId==='daily-fixture-video')).toBe(false);
    expect(composeDailyBriefing(next).snapshot.topics).toEqual([]);
    expect(service('select count(*)from public.daily_briefing_consumed_findings;')).toBe('1');
    expect(data(`select snapshot from public.daily_briefings where id=${q(early.id)};`)).toEqual(saved);
  });
  it.each([{outcome:'completed',state:'unknown',reason:'empty_or_unusable_response'}, {outcome:'failed',state:'failed',reason:'provider_failed'}])('reads real $outcome social-job coverage without a state-variable conflict', ({outcome,state,reason}) => {
    const socialSource={id:'daily-fixture-x',name:'Fixture X source',platform:'X',url:'https://x.com/dailyfixture',status:'ready'};
    sql(`update public.reader_workspaces set state=${j({...workspace,followedSourceIds:[...workspace.followedSourceIds,socialSource.id],customSources:[...workspace.customSources,socialSource]})} where user_id=${q(owner)};
      update public.social_collection_platforms set enabled=true,actor_id='ActorDaily123',build_id='BuildDaily123',build_number='1.2.3',apify_user_id='UserDaily123',pricing_fingerprint=repeat('a',64),reviewed_at=clock_timestamp()where platform='X';`);
    service('select public.sync_social_collection_sources();');
    const job=data('select public.claim_social_collection_job(true);');
    expect(job.source_key).toBe('x.com/dailyfixture');
    service(`select public.mark_social_collection_launch(${q(job.id)},${q(job.lease_token)});
      select public.record_social_collection_run(${q(job.id)},${q(job.lease_token)},'RunDaily123','DatasetDaily123');
      select public.finish_social_collection_job(${q(job.id)},${q(job.lease_token)},'[]',${j({status:state,complete:false,returned:0,accepted:0,rejected:{},reason})},.001,true,${outcome==='failed'?q(reason):'null'});`);
    cutoff=sql(`select to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
    periodStart=new Date(Date.parse(cutoff)-86400000).toISOString();day=cutoff.slice(0,10);
    const c=claim();
    expect(c.input.sources.find((source:any)=>source.sourceId===socialSource.id)).toMatchObject({platform:'X',state,reason});
    expect(finish(c)).toBe(c.id);
  });
  it('keeps saved wording immutable and stores failure as unpublished, never quiet', () => {
    const c = claim(); service(`select public.fail_daily_briefing(${q(c.id)},${q(c.leaseToken)},'daily_source_changed');`);
    const b = data(`select to_jsonb(b)from public.daily_briefings b where id=${q(c.id)};`);
    expect(b.status).toBe('awaiting_review'); expect(b.published_at).toBeNull(); expect(b.snapshot.topics).toEqual([]);
    expect(() => service(`update public.daily_briefings set snapshot=jsonb_set(snapshot,'{notice}','"A silent rewrite"')where id=${q(c.id)};`)).toThrow();
  });
  it('rechecks source changes and approval withdrawal before publication', () => {
    const c = claim(); sql(`update public.reader_source_updates set record=jsonb_set(record,'{content}','"A changed original text invalidates the old approved finding."');`); expect(() => finish(c)).toThrow();
  });
  it('keeps daily history isolated from other readers and denies public/reader writes', () => {
    const c = claim(); finish(c);
    expect(own('select count(*)from public.daily_briefings;')).toBe('1'); expect(own('select count(*)from public.daily_briefings;', stranger)).toBe('0');
    expect(() => sql('set role anon;select*from public.daily_briefings;')).toThrow();
    expect(() => own(`update public.daily_briefings set snapshot='{}';`)).toThrow();
    expect(() => own(`select public.list_daily_briefing_candidates();`)).toThrow();
  });
  it('deletes content while retaining the logical-day tombstone against resurrection', () => {
    const c = claim(); finish(c); const created = service(`select created_at::text from public.daily_briefings where id=${q(c.id)};`);
    service(`select public.delete_daily_briefing(${q(owner)},${q(c.id)},${q(created)});`);
    expect(own('select count(*)from public.daily_briefings;')).toBe('0');
    expect(data(`select snapshot from public.daily_briefings where id=${q(c.id)};`)).toEqual({}); expect(claim()).toBeNull();
    expect(data(`select input from public.daily_briefing_jobs where id=${q(c.id)};`)).toEqual({});
    expect(() => service(`select public.delete_daily_briefing(${q(stranger)},${q(c.id)},${q(created)});`)).toThrow();
  });
  it('atomic reset rotates generation and prevents an already claimed result from publishing', () => {
    const c = claim(), before = candidate().generation, revision = service(`select updated_at::text from public.reader_workspaces where user_id=${q(owner)};`);
    own(`select public.clear_reader_workspace(${q(revision)},${j(workspace)});`);
    expect(candidate().generation).not.toBe(before); expect(() => finish(c)).toThrow(); expect(service('select count(*)from public.daily_briefings;')).toBe('0');
  });
  it('bookmark changes preserve generation while delivery-time changes affect future unclaimed cycles', () => {
    const before = candidate(); sql(`update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["saved"]')where user_id=${q(owner)};`);
    expect(candidate().generation).toBe(before.generation); expect(candidate().settingsChangedAt).toBe(before.settingsChangedAt);
    sql(`update public.reader_workspaces set state=jsonb_set(state,'{settings,deliveryTime}','"12:00"')where user_id=${q(owner)};`);
    expect(candidate().generation).toBe(before.generation); expect(candidate().settingsChangedAt).not.toBe(before.settingsChangedAt); expect(claim()).toBeNull();
  });
  it('pauses claims under the independent global control without altering collection or model gates', () => {
    sql('update public.daily_briefing_control set enabled=false;'); expect(data('select public.list_daily_briefing_candidates();')).toEqual([]);
    expect(service('select enabled from public.reader_collection_policies;')).toBe('t');
  });
  it('serializes two simultaneous claims without duplicate reservations or outputs', async () => {
    const c = candidate(), query = `set role service_role;select public.claim_daily_briefing(${q(owner)},${q(c.generation)},${q(c.workspaceRevision)},${q(day)},${q(cutoff)},${q(periodStart)});`;
    const run = () => new Promise<string>((resolve, reject) => execFile('psql', [...args, '-c', query], (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
    const results = await Promise.all([run(), run()]); expect(results.filter(x => x !== '' && x !== 'null')).toHaveLength(1);
    expect(service('select count(*)from public.daily_briefing_jobs;')).toBe('1');
  });
});
