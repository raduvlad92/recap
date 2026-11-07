import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const available = ['initdb', 'pg_ctl', 'psql'].every(bin => { try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'", j = (v: unknown) => q(JSON.stringify(v)) + '::jsonb';
const owner = 'user_lifecycleFixture', other = 'user_otherFixture', id = '10000000-0000-4000-8000-000000000001';
const state = { version: 1, followedSourceIds: ['source'], savedUpdateIds: [], readLaterIds: [], importedUpdates: [], customSources: [{ id: 'source', name: 'Private follow', platform: 'YouTube', url: 'https://www.youtube.com/@fixture', status: 'ready' }], settings: { emailReminder: false } };
const record = { id: 'video', sourceId: 'source', title: 'Private fixture', url: 'https://www.youtube.com/watch?v=abcdeFGHI12', publishedAt: '2026-11-07T00:00:00Z', content: 'Private source text and prompt sentinel.', contentKind: 'transcript', format: 'video', videoFormat: { kind: 'regular' }, isSample: false };

describe.skipIf(!available)('account lifecycle, disposable PostgreSQL only', () => {
  let root: string, args: string[], started = false;
  const sql = (s: string) => execFileSync('psql', args, { input: s, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const service = (s: string) => sql('set role service_role;' + s), data = (s: string) => JSON.parse(service(s) || 'null');
  const own = (s: string, subject = owner) => sql(`set role authenticated;set request.jwt.claims=${q(JSON.stringify({ sub: subject }))};` + s);
  const deletionArgs = (key = owner, requestId = q(id)) => `${q(key)},${requestId},'https://fixture.clerk.accounts.dev',${q(key)}`;
  const request = () => data(`select request_account_deletion(${deletionArgs()});`);
  const claim = () => data('select claim_account_deletion();');
  const erase = (c: any) => data(`select erase_account_payloads(${q(c.id)},${q(c.lease_token)});`);
  const step = (c: any, name: string) => {
    if (name === 'identity_deleted') for (const identity of c.identities) service(`select record_account_deletion_identity_step(${q(c.id)},${q(c.lease_token)},${q(identity.issuer)},${q(identity.subject)},'deleted');`);
    return data(`select advance_account_deletion(${q(c.id)},${q(c.lease_token)},${q(name)});`);
  };
  const call = (job: string | null = null, settled = false) => service(`insert into reader_content_analysis_calls(job_id,user_id,call_key,lease_token,model,source_revision,maximum_usd,state,actual_usd,observed_usd,result,usage,provider_id)
    values(${job ? q(job) : 'null'},${q(owner)},'fixture-call',gen_random_uuid(),'deepseek/deepseek-v4.1-flash-1017',repeat('a',64),.012345678901,${q(settled ? 'settled' : 'unknown')},${settled ? '.004000000001' : 'null'},.003,${j({ value: 'Private model result sentinel' })},${j({ prompt_tokens: 17, private_raw: 'Private prompt sentinel' })},'gen-fixture') returning id;`);
  async function heldTransaction(query: string) {
    const child = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('lifecycle-held')) resolve(); });
      child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject);
      child.on('exit', code => { if (code) reject(new Error(errors)); });
    });
    const done = new Promise<void>((resolve, reject) => child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors))));
    child.stdin.end(`begin;${query}\n\\echo lifecycle-held\nselect pg_sleep(0.6);commit;`);
    await ready; return { done };
  }
  beforeAll(() => {
    root = mkdtempSync('/tmp/recap-lifecycle-'); mkdirSync(join(root, 'socket'));
    execFileSync('initdb', ['-D', join(root, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(root, 'data'), '-l', join(root, 'log'), '-o', `-k ${join(root, 'socket')} -h '' -p 55739`, 'start'], { stdio: 'ignore' }); started = true;
    args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', join(root, 'socket'), '-p', '55739', '-U', 'postgres', '-d', 'postgres'];
    sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    // Optional stacked migrations can be supplied as LOCAL FILES for the same
    // disposable test matrix. They are never applied to a hosted database.
    const migrations = readdirSync(dir).filter(n => n.endsWith('.sql')).map(name => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));
    for (const path of (process.env.ACCOUNT_LIFECYCLE_TEST_EXTRA_MIGRATIONS || '').split(':').filter(Boolean)) migrations.push({ name: path.split('/').pop()!, text: readFileSync(path, 'utf8') });
    for (const m of migrations.sort((a, b) => a.name.localeCompare(b.name))) sql(m.text);
  }, 40000);
  afterAll(() => { if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), 'stop', '-m', 'immediate'], { stdio: 'ignore' }); if (root) rmSync(root, { recursive: true, force: true }); });
  beforeEach(() => {
    sql(`truncate recap_internal.account_deletions cascade;truncate public.reader_workspaces cascade;truncate public.reader_source_updates cascade;truncate public.keyword_learning_sessions cascade;truncate public.reader_content_analysis_calls cascade;truncate public.reader_content_analysis_policies;truncate public.reader_collection_policies cascade;truncate public.collection_jobs cascade;truncate public.collection_budget_reservations cascade;
      insert into reader_workspaces(user_id,state)values(${q(owner)},${j(state)}),(${q(other)},${j(state)});
      insert into reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'video','source','fixture','2026-11-07T00:00:00Z',${j(record)});
      insert into reader_collection_policies(user_id,enabled,provider_enabled)values(${q(owner)},true,true);
      insert into reader_content_analysis_policies(user_id,enabled,daily_limit_usd,lifetime_limit_usd,per_call_limit_usd,model)values(${q(owner)},true,5,10,.1,'deepseek/deepseek-v4.1-flash-1017');`);
  });
  it('applies without creating any request, deletion, expiry policy or work', () => {
    expect(sql('select count(*)from recap_internal.account_deletions;')).toBe('0');
    expect(service(`select account_access_allowed(${q(owner)});`)).toBe('t');
    expect(service('select claim_account_deletion();')).toBe('');
    expect(own('select count(*)from reader_workspaces;')).toBe('1');
  });
  it('denies all lifecycle RPCs and private tombstones to readers and anonymous roles', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(sql(`select has_function_privilege('${role}','request_account_deletion(text,uuid,text,text)','execute');`)).toBe('f');
      expect(sql(`select has_function_privilege('${role}','record_account_deletion_retention_proof(uuid,text,text,text,text)','execute');`)).toBe('f');
      expect(() => sql(`set role ${role};select * from recap_internal.account_deletions;`)).toThrow();
    }
    expect(() => service('delete from recap_internal.account_deletions;')).toThrow();
  });
  it('atomically suppresses access and disables new work without changing caps', () => {
    service(`insert into admin_audit_events(admin_id,action,details)values(${q(other)},'fixture.prefix',${j({ owner: owner + 'Suffix', raw: 'Unrelated audit detail' })}),(${q(other)},'fixture.exact',${j({ owner, raw: record.content, maximumUsd: .005 })});`);
    const caps = service(`select (to_jsonb(p)-array['enabled','provider_enabled','updated_at'])::text from reader_collection_policies p;`);
    const r = request(); expect(r.state).toBe('requested'); expect(r.payloadErasedAt).toBeNull();
    expect(service(`select account_access_allowed(${q(owner)});`)).toBe('f');
    expect(own('select count(*)from reader_workspaces;')).toBe('0');
    expect(own('select count(*)from reader_source_updates;')).toBe('0');
    expect(own('select count(*)from reader_workspaces;', other)).toBe('1');
    expect(service(`select (to_jsonb(p)-array['enabled','provider_enabled','updated_at'])::text from reader_collection_policies p;`)).toBe(caps);
    expect(service('select enabled or provider_enabled from reader_collection_policies;')).toBe('f');
    expect(() => own(`insert into reader_workspaces(user_id,state)values(${q(owner)},${j(state)})on conflict(user_id)do update set state=excluded.state;`)).toThrow();
    expect(() => service(`update reader_content_analysis_policies set enabled=true where user_id=${q(owner)};`)).toThrow();
    service(`update reader_content_analysis_policies set model='openai/gpt-6-luna-pro'where user_id=${q(owner)};`);
    expect(service(`select enabled from reader_content_analysis_policies where user_id=${q(owner)};`)).toBe('f');
    expect(() => call()).toThrow();
    const c = claim();erase(c);
    expect(data("select details from admin_audit_events where action='fixture.prefix';")).toEqual({ owner: owner + 'Suffix', raw: 'Unrelated audit detail' });
    expect(data("select details from admin_audit_events where action='fixture.exact';")).toEqual({ maximumUsd: .005 });
  });
  it('replays a request without a second deletion identity and rejects cross-owner id reuse', () => {
    expect(request()).toEqual(request());
    expect(data(`select request_account_deletion(${deletionArgs(owner, 'gen_random_uuid()')});`).requestId).toBe(id);
    expect(() => data(`select request_account_deletion(${deletionArgs(other)});`)).toThrow();
    expect(() => sql('delete from recap_internal.account_deletions;')).toThrow();
    expect(() => sql(`update recap_internal.account_deletions set user_id='replacement';`)).toThrow();
  });
  it('cascades jobs/prompts/reviews/snapshots, erases detached caches, keeps exact financial history', () => {
    const job = service(`insert into reader_content_analysis_jobs(user_id,update_id,source_id,content_hash,source_revision,source_fingerprint,workspace_revision,task,result)
      select ${q(owner)},'video','source',repeat('a',64),repeat('a',64),'fixture',updated_at,'summary',${j({ private: 'Private job result' })} from reader_workspaces where user_id=${q(owner)} returning id;`);
    const cid = call(job), before = data(`select to_jsonb(c)-array['result','result_at','usage','job_id','erased_job_id']from reader_content_analysis_calls c where id=${q(cid)};`);
    const sid = sql(`insert into keyword_learning_sessions(user_id,state,sources,models,maximum_usd,max_calls,expires_at)values(${q(owner)},'released',${j([{ updateId: 'video', ordinal: 1, content: record.content }])},array['deepseek/deepseek-v4.1-flash-1017'],.1,2,clock_timestamp()+interval'1 hour')returning id;`);
    service(`insert into admin_analysis_prompt_receipts(job_id,call_key,request_hash,model,request,source_snapshot)values(${q(job)},'fixture-call',repeat('b',64),'fixture',${j({ prompt: record.content })},${j(record)});
      insert into admin_analysis_reviews(user_id,update_id,source_id,content_hash,kind,dedupe_key,source_snapshot,proposal,reason)values(${q(owner)},'video','source',encode(sha256(convert_to(${q(record.content)},'UTF8')),'hex'),'recap','fixture-review',${j(record)},${j({ raw: record.content })},'Fixture only');`);
    sql(`insert into keyword_production_releases(session_id,contract_hash,state,sources)values(${q(sid)},repeat('a',64),'released',${j([{ raw: record.content }])});`);
    service(`insert into automatic_content_policies(user_id,enabled,starts_at)values(${q(owner)},true,clock_timestamp()-interval'1 hour');select sync_automatic_content_tasks();`);
    service(`insert into keyword_learning_requests(session_id,call_key,source_ordinal,source_hash,request_hash,request_payload,call_id,result,completed)values(${q(sid)},'keyword-learning:v1:fixture',1,repeat('a',64),repeat('b',64),${j({ prompt: record.content })},${q(cid)},${j({ private: 'Private result' })},true);`);
    request(); const c = claim(); erase(c);
    expect(service('select count(*)from reader_workspaces;')).toBe('1');
    expect(service('select count(*)from reader_source_updates;')).toBe('0');
    expect(service('select count(*)from reader_content_analysis_jobs;')).toBe('0');
    for (const table of ['admin_analysis_prompt_receipts', 'admin_analysis_reviews', 'automatic_content_tasks']) expect(service(`select count(*)from ${table};`)).toBe('0');
    expect(service('select sources::text from keyword_production_releases;')).toBe('[]');
    const after = data(`select to_jsonb(c)from reader_content_analysis_calls c where id=${q(cid)};`);
    expect(after.job_id).toBeNull(); expect(after.erased_job_id).toBe(job); expect(after.result).toBeNull(); expect(after.usage).toEqual({ prompt_tokens: 17 });
    expect(data(`select to_jsonb(c)-array['result','result_at','usage','job_id','erased_job_id']from reader_content_analysis_calls c where id=${q(cid)};`)).toEqual(before);
    expect(data(`select jsonb_build_object('user',user_id,'sources',sources,'state',state)from keyword_learning_sessions where id=${q(sid)};`)).toEqual({ user: null, sources: [], state: 'closed' });
    expect(service('select (request_payload is null and result is null)from keyword_learning_requests;')).toBe('t');
    const lease = service(`select lease_token from reader_content_analysis_calls where id=${q(cid)};`);
    data(`select record_keyword_learning_call(${q(sid)},'keyword-learning:v1:fixture',${q(cid)},${q(lease)},repeat('b',64),${j({ value: record.content, actualUsd: .004, observedUsd: .004, providerId: 'gen-fixture', usage: { total_tokens: 30, raw: record.content } })},null);`);
    expect(service(`select actual_usd=.004 and result is null and usage='{"total_tokens":30}'::jsonb from reader_content_analysis_calls where id=${q(cid)};`)).toBe('t');
    expect(step(c, 'finish')).toMatchObject({ state: 'blocked', reason: 'identity_deletion_pending', completedAt: null });
  });
  it('allows late money evidence while stripping reintroduced content and never releasing unknown holds', () => {
    const cid = call(); request(); const c = claim(); erase(c);
    service(`update reader_content_analysis_calls set result=${j({ private: 'Delayed raw response' })},usage=${j({ total_tokens: 21, raw_prompt: 'secret' })} where id=${q(cid)};`);
    expect(service(`select result is null and usage='{"total_tokens":21}'::jsonb from reader_content_analysis_calls where id=${q(cid)};`)).toBe('t');
    expect(service(`select actual_usd is null and state='unknown' and maximum_usd=.012345678901 from reader_content_analysis_calls where id=${q(cid)};`)).toBe('t');
    step(c, 'identity_deleted'); expect(step(c, 'finish').reason).toBe('external_work_unresolved');
    service(`select settle_content_analysis_call(${q(cid)},.004000000001,.004000000001);`);
    expect(service(`select actual_usd::text from reader_content_analysis_calls where id=${q(cid)};`)).toBe('0.004000000001');
  });
  it('reclaims an interrupted lease and rejects its delayed continuation', () => {
    request(); const first = claim(); expect(claim()).toBeNull();
    sql(`update recap_internal.account_deletions set lease_until=clock_timestamp()-interval'1 second';`);
    const next = claim(); expect(next.id).toBe(first.id); expect(next.lease_token).not.toBe(first.lease_token);
    expect(() => erase(first)).toThrow(); expect(() => step(first, 'identity_deleted')).toThrow(); erase(next);
  });
  it('retains exact source run/reservation identities and unknown maxima while erasing provider tokens and follows', () => {
    const rid = data(`select to_jsonb(reserve_collection_budget('fixture-lifecycle',.005,'job',null,'apify','fixtureActor'));`).id;
    service(`select claim_collection_budget(${q(rid)});`);
    const ledger = service(`insert into collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,provider_run_id,status)values(${q(owner)},'source','Private source name','https://www.youtube.com/@fixture','YouTube','apify','fixtureActor','RunFixture1','running')returning id;`);
    const check = service(`insert into reader_collection_checks(user_id,source_id,source_name,source_url,platform,provider,job_id,provider_run_id,observed_cost_usd,cost_status,details)values(${q(owner)},'source','Private source name','https://www.youtube.com/@fixture','YouTube','apify',${q(ledger)},'RunFixture1',null,'unknown',${j({ raw: record.content })})returning id;`);
    service(`insert into reader_collection_source_state(user_id,source_id,fingerprint,pending_captions,cursor,feed_url,check_id)values(${q(owner)},'source','fixture',${j([{ content: record.content }])},${j({ raw: record.content })},'https://fixture.example/feed',${q(check)});
      insert into reader_collection_provider_jobs(user_id,source_id,item_key,source_fingerprint,check_id,job_id,reservation_id,actor_id,maximum_usd,state,provider_run_id,job_token,content_pending)values(${q(owner)},'source','youtube:abcdeFGHI12','fixture',${q(check)},${q(ledger)},${q(rid)},'fixtureActor',.005,'running','RunFixture1','fixture-signed-capability',true);`);
    const before = service(`select to_jsonb(r)::text from collection_budget_reservations r where id=${q(rid)};`);
    const hasFeeReceipts = sql("select to_regclass('public.collection_provider_fee_receipts')is not null;") === 't';
    let feeBefore = '';
    if (hasFeeReceipts) {
      // Synthetic immutable receipt, used only to exercise its real FK/cascade.
      service(`insert into collection_provider_fee_receipts(request_key,provider_job_id,reservation_id,provider_run_id,evidence,expected,original_reservation,original_job_finances,original_ledger_finances,previous_usd,reported_usd,corrected_usd,delta_usd,outcome)
        select 'fixture-privacy',p.id,p.reservation_id,p.provider_run_id,'{"fixture":true}','{}',to_jsonb(r),'{}','{}',0,null,0,0,'unresolved_missing_fee'from reader_collection_provider_jobs p join collection_budget_reservations r on r.id=p.reservation_id;`);
      feeBefore = service('select to_jsonb(r)::text from collection_provider_fee_receipts r;');
    }
    request();const c = claim();erase(c);
    expect(service(`select to_jsonb(r)::text from collection_budget_reservations r where id=${q(rid)};`)).toBe(before);
    if (hasFeeReceipts) {
      expect(service('select to_jsonb(r)::text from collection_provider_fee_receipts r;')).toBe(feeBefore);
      expect(() => service('delete from collection_provider_fee_receipts;')).toThrow();
    }
    expect(data('select jsonb_build_object(\'token\',job_token,\'discard\',discard_result,\'run\',provider_run_id,\'actual\',actual_cost_usd,\'maximum\',maximum_usd)from reader_collection_provider_jobs;')).toMatchObject({ token: null, discard: true, run: 'RunFixture1', actual: null, maximum: .005 });
    expect(service(`select(source_name=''and source_url=''and details='{}')from reader_collection_checks;`)).toBe('t');
    expect(service(`select(pending_captions='[]'and cursor='{}'and feed_url is null)from reader_collection_source_state;`)).toBe('t');
    step(c, 'identity_deleted');expect(step(c, 'finish').reason).toBe('external_work_unresolved');
  });
  it('erases immutable daily snapshots/outbox payloads, preserves reminder job identity and ignores a delayed webhook', () => {
    const briefing = service(`insert into daily_briefings(reader_id,local_date,period_start,cutoff_at,status,snapshot,workspace_revision,generation)
      select ${q(owner)},current_date,clock_timestamp()-interval'1 day',clock_timestamp(),'ready',${j({ private: record.content })},updated_at,gen_random_uuid()from reader_workspaces where user_id=${q(owner)}returning id;`);
    const outbox = service(`insert into recap_reminder_outbox(briefing_id,reader_id,generation,consent_revision,idempotency_key,state,recipient_email,payload,payload_hash,provider_id,first_attempt_at)
      values(${q(briefing)},${q(owner)},gen_random_uuid(),gen_random_uuid(),'fixture-reminder','sending','fixture@example.invalid',${j({ private: record.content })},repeat('a',64),'ReminderFixture1',clock_timestamp())returning id;`);
    request();const c = claim();erase(c);
    expect(service('select count(*)from daily_briefings;')).toBe('0');expect(service('select count(*)from recap_reminder_outbox;')).toBe('0');
    expect(sql('select provider_id from recap_internal.account_deletion_external_work;')).toBe('ReminderFixture1');
    const event = { type: 'email.delivered', created_at: '2026-11-07T00:00:00Z', data: { email_id: 'ReminderFixture1', tags: { recap_reminder: outbox }, to: ['fixture@example.invalid'] } };
    expect(data(`select record_recap_reminder_event('FixtureDelayed',${j(event)});`)).toEqual({ matched: false });
    expect(service('select count(*)from recap_reminder_events;')).toBe('0');
    expect(sql('select provider_id from recap_internal.account_deletion_external_receipts;')).toBe('ReminderFixture1');
    data(`select record_recap_reminder_event('FixtureDelayed',${j(event)});`);
    expect(sql('select count(*)from recap_internal.account_deletion_external_receipts;')).toBe('1');
  });
  it('removes only the deleted social consumer, prevents delayed reinsertion and preserves shared run identity', () => {
    const rid = data(`select to_jsonb(reserve_collection_budget('fixture-social',.005,'job',null,'apify','fixtureActor'));`).id;
    const ledger = service(`insert into collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status)values('shared-social','shared','Shared source','https://x.com/fixture','X','apify','fixtureActor','running')returning id;`);
    service(`insert into social_collection_sources(source_key,platform,source_url,source_name)values('x.com/fixture','X','https://x.com/fixture','Fixture');
      insert into social_collection_consumers(source_key,user_id,source_id,workspace_revision,source_fingerprint)select 'x.com/fixture',user_id,'source',updated_at,'fixture'from reader_workspaces;`);
    const job = service(`insert into social_collection_jobs(source_key,platform,window_from,window_to,config,reservation_id,collection_job_id,consumers,provider_run_id)
      values('x.com/fixture','X',clock_timestamp()-interval'1 hour',clock_timestamp(),'{}',${q(rid)},${q(ledger)},${j([{ user_id: owner, source_id: 'source' }, { user_id: other, source_id: 'source' }])},'RunSocialFixture')returning id;`);
    const insertItem = `insert into social_collection_items(source_key,item_key,revision,record,job_id)values('x.com/fixture','x:123',repeat('a',64),${j({ content: record.content })},${q(job)})on conflict do nothing;`;
    service(insertItem);request();erase(claim());
    expect(service('select count(*)from social_collection_items;')).toBe('1');
    expect(data('select consumers from social_collection_jobs;')).toEqual([{ user_id: other, source_id: 'source' }]);
    data(`select request_account_deletion(${deletionArgs(other, "'10000000-0000-4000-8000-000000000002'")});`);erase(claim());
    expect(service('select count(*)from social_collection_items;')).toBe('0');service(insertItem);
    expect(service('select count(*)from social_collection_items;')).toBe('0');
    expect(service('select provider_run_id from social_collection_jobs;')).toBe('RunSocialFixture');
  });
  it('requires a bound per-request retention attestation before completing, invalidated on restore', () => {
    request(); let c = claim(); erase(c); step(c, 'identity_deleted');
    const digest = service(`select account_deletion_reference_digest(${q(id)});`);
    expect(() => service(`select record_account_deletion_retention_proof(${q(id)},'fixture-only',repeat('f',64),repeat('a',64),repeat('b',64));`)).toThrow();
    expect(step(c, 'finish')).toMatchObject({ state: 'blocked', reason: 'retention_proof_required' });
    service(`select record_account_deletion_retention_proof(${q(id)},'fixture-only',${q(digest)},repeat('a',64),repeat('b',64));`);
    service(`select record_account_deletion_retention_proof(${q(id)},'fixture-only',${q(digest)},repeat('a',64),repeat('b',64));`);
    expect(() => service(`select record_account_deletion_retention_proof(${q(id)},'changed-policy',${q(digest)},repeat('a',64),repeat('b',64));`)).toThrow();
    sql(`update recap_internal.account_deletions set next_attempt_at='-infinity';`); c = claim();
    expect(step(c, 'finish')).toMatchObject({ state: 'completed', scope: 'active_services_with_verified_restore_suppression', backupExpiryActivated: false });
    expect(claim()).toBeNull(); expect(() => service(`insert into reader_workspaces(user_id,state)values(${q(owner)},${j(state)});`)).toThrow();
    // Simulate an offline privileged restore bypassing row triggers. The latest
    // separately preserved fence still denies access before quarantine cleanup.
    sql(`set session_replication_role=replica;insert into reader_workspaces(user_id,state)values(${q(owner)},${j(state)});
      insert into reader_source_updates(user_id,id,source_id,collection_id,published_at,record)values(${q(owner)},'video','source','fixture','2026-11-07T00:00:00Z',${j(record)});set session_replication_role=origin;`);
    expect(own('select count(*)from reader_workspaces;')).toBe('0');
    service(`select requeue_account_deletion_after_restore(${q(id)});`);c = claim();erase(c);
    expect(c.identity_deleted_at).toBeNull();step(c, 'identity_deleted');
    expect(service(`select count(*)from reader_source_updates where user_id=${q(owner)};`)).toBe('0');
    expect(step(c, 'finish').reason).toBe('retention_proof_required');
    expect(service(`select account_deletion_reference_digest(${q(id)});`)).not.toBe(digest);
  });
  it('reopens completion on a new exact provider reference without restoring any model payload', () => {
    const cid = call(null, true);request();let c = claim();erase(c);step(c, 'identity_deleted');
    service(`select record_account_deletion_retention_proof(${q(id)},'fixture-only',account_deletion_reference_digest(${q(id)}),repeat('a',64),repeat('b',64));`);
    expect(step(c, 'finish').state).toBe('completed');
    service(`update reader_content_analysis_calls set provider_id='gen-late-fixture',result='{"raw":"private"}'where id=${q(cid)};`);
    expect(data(`select read_account_deletion(${q(owner)});`)).toMatchObject({ state: 'blocked', reason: 'external_reference_changed', completedAt: null });
    expect(service(`select result is null from reader_content_analysis_calls where id=${q(cid)};`)).toBe('t');
  });
  it('leaves optional immutable hosting invocation/disposition evidence byte-exact', () => {
    if (sql("select to_regclass('public.hosting_queue_invocations')is not null;") !== 't') return;
    sql(`truncate public.hosting_work cascade;
      insert into hosting_work(key,kind,epoch,release,state)values('cron:automatic-content:1:1','automatic-content',1,repeat('a',40),'uncertain');
      insert into hosting_queue_invocations(key,message_id,queue_name,control_revision,frame,bound_policy,recorded_at,not_after)
      select key,'FixtureMessage','therecap-jobs',gen_random_uuid(),to_jsonb(w),'cloudflare-queue-wall-15m-plus-2m-v1',moment,moment+interval'17 minutes'from hosting_work w,lateral(select clock_timestamp()moment)t;
      insert into hosting_transport_dispositions(key,recovery_id,disposition,original_frame,control_snapshot,native_evidence,domain_evidence)
      select key,gen_random_uuid(),'expired_outcome_unknown',to_jsonb(w),'{}','{"fixture":true}','{"fixture":true}'from hosting_work w;`);
    const before = service('select to_jsonb(r)::text from hosting_queue_invocations r;') + service('select to_jsonb(r)::text from hosting_transport_dispositions r;');
    request();erase(claim());
    expect(service('select to_jsonb(r)::text from hosting_queue_invocations r;') + service('select to_jsonb(r)::text from hosting_transport_dispositions r;')).toBe(before);
  });
  it('fails closed for a stale repeatable-read transaction as well as an ordinary stale JWT', () => {
    request();
    expect(() => sql(`begin isolation level repeatable read;set role service_role;insert into reader_workspaces(user_id,state)values('user_repeatable',${j(state)});commit;`)).toThrow();
    expect(own('select count(*)from reader_workspaces;')).toBe('0');
  });
  it('does not deadlock with an already-active writer; request retries after its transaction drains', async () => {
    const held = await heldTransaction(`set role service_role;update reader_collection_policies set enabled=true where user_id=${q(owner)};`);
    expect(() => request()).toThrow(); await held.done;
    expect(request().state).toBe('requested');
  });
  it('rejects a delayed worker writer while the deletion transaction is committing', async () => {
    const held = await heldTransaction(`select request_account_deletion(${deletionArgs()});`);
    expect(() => call()).toThrow(); await held.done;
    expect(() => call()).toThrow();
  });
});
