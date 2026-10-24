import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const name = readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(n => /^20261024\d+_content_analysis\.sql$/.test(n));
if (!name) throw new Error('D35 migration missing');
const sql = readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
const functions = new Map([...sql.matchAll(/create function public\.(\w+)\(([^]*?)\) returns ([^]*?)as \$\$([^]*?)\$\$;/g)]
 .map(m => [m[1], { args: m[2], declaration: m[3], body: m[4] }]));
const body = (name: string) => {
 const found = functions.get(name);
 if (!found) throw new Error('Function missing: ' + name);
 return found.body;
};

describe('D35 SQL safety contracts (static, does not apply migrations)', () => {
 it('creates only private service tables with RLS and no reader table grants', () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  expect(tables).toHaveLength(4);
  for (const table of tables) expect(sql).toContain(`alter table public.${table} enable row level security;`);
  expect(sql).toMatch(/revoke all on public\.content_analysis_budget,[^;]+from public,anon,authenticated,service_role;/);
  expect(sql).not.toMatch(/grant[^;]+to (?:public|anon|authenticated)\b/i);
  expect(sql).not.toMatch(/create policy|insert into public\.(?:content_analysis_budget|reader_content_analysis_policies)\b/i);
 });
 it('revokes every RPC and helper, and makes only noncallable triggers definers', () => {
  const revokes = [...sql.matchAll(/revoke all on function ([^;]+);/g)].map(m => m[1]).join('\n');
  const grants = [...sql.matchAll(/grant execute on function ([^;]+);/g)].map(m => m[1]).join('\n');
  expect(functions.size).toBeGreaterThanOrEqual(18);
  for (const [name, fn] of functions) {
   expect(revokes).toContain(`public.${name}(`);
   expect(fn.declaration).toContain("set search_path=''");
   if (/security definer/.test(fn.declaration)) {
    expect(fn.declaration).toMatch(/^trigger\s/);
    expect(grants).not.toContain(`public.${name}(`);
   } else expect(grants).toContain(`public.${name}(`);
  }
 });
 it('limits the paid queue to actual video transcripts and explicit regular classification', () => {
  const eligible = body('content_analysis_eligible');
  expect(eligible).toContain("p_record->>'format'='video' and p_record->>'contentKind'='transcript'");
  expect(eligible).toContain("p_record#>>'{videoFormat,kind}'='regular'");
  expect(eligible).toContain('youtube\\.com/shorts/');
  expect(eligible).not.toContain("p_record->'isShort'='false'");
  expect(eligible).toContain('followedSourceIds');
 });
 it('fences timing and source identity without treating annotations as source revisions', () => {
  const revision = body('content_analysis_source_revision');
  for (const key of ['content', 'contentKind', 'transcriptSegments', 'url', 'videoFormatKind']) expect(revision).toContain(`'${key}'`);
  for (const key of ['processing', 'topics', 'videoSummary', 'videoHighlights', 'videoKeywords']) expect(revision).not.toContain(`'${key}'`);
  const lock = body('lock_content_analysis_job');
  expect(lock.indexOf('from public.reader_workspaces')).toBeLessThan(lock.indexOf('from public.reader_source_updates'));
  expect(lock.indexOf('from public.reader_source_updates')).toBeLessThan(lock.lastIndexOf('from public.reader_content_analysis_jobs'));
  for (const fence of ['content_analysis_eligible', 'source_fingerprint', 'source_revision', 'content_hash', 'lease_token', 'lease_until']) expect(lock).toContain(fence);
 });
 it('claims a row lease and persists running status under an archive UPDATE lock', () => {
  const claim = body('claim_content_analysis_job');
  expect(claim).toContain('for update skip locked');
  expect(claim.indexOf('from public.reader_source_updates')).toBeLessThan(claim.indexOf('where id=candidate.id for update skip locked'));
  expect(claim).toContain("'\"running\"'::jsonb");
  expect(claim).toContain('set record=a.record||');
  expect(claim).toContain("q.state in ('running','prepared')");
 });
 it('reserves before calls, preserves call keys, and counts unknown fees across UTC days', () => {
  const reserve = body('reserve_content_analysis_call');
  expect(reserve.indexOf('lock_content_analysis_job')).toBeLessThan(reserve.indexOf('from public.content_analysis_budget'));
  expect(reserve.indexOf('from public.content_analysis_budget')).toBeLessThan(reserve.indexOf('from public.reader_content_analysis_policies'));
  expect(reserve).toContain('created_at>=utc_day or actual_usd is null');
  expect(reserve.match(/daily\+p_maximum_usd>/g)).toHaveLength(2);
  expect(reserve).toContain("jsonb_build_object('claimed',false,'call',to_jsonb(c))");
  expect(sql).toContain('unique(job_id,call_key)');
 });
 it('never clears holds or cached calls on a fail, lease expiry, yield or epoch change', () => {
  const failure = body('fail_content_analysis_job');
  expect(failure).toContain("attempts-case when p_yield or p_error_code='analysis_daily_budget_exhausted' then 1 else 0 end");
  expect(failure).toContain('analysis_cached_input_changed');
  for (const name of ['fail_content_analysis_job', 'sync_content_analysis_jobs', 'claim_content_analysis_job']) {
   expect(body(name)).not.toMatch(/(?:update|delete from) public\.reader_content_analysis_calls/i);
  }
  const sync = body('sync_content_analysis_jobs');
  expect(sync).toContain('config_epoch<>p_config_epoch');
  expect(sync).toContain('analysis_credentials_required');
  expect(sync).not.toContain('analysis_unknown_charge_hold');
  expect(sync).not.toContain('analysis_cached_input_changed');
 });
 it('erases source caches on job deletion while preserving accounting and rejecting evidence resurrection', () => {
  expect(sql).toContain('job_id uuid references public.reader_content_analysis_jobs(id) on delete set null');
  expect(sql).toContain('before delete on public.reader_content_analysis_jobs');
  const erase = body('erase_content_analysis_call_evidence');
  expect(erase).toContain('set result=null,result_at=null');
  expect(erase).not.toMatch(/maximum_usd|actual_usd|observed_usd|usage=/);
  const save = body('record_content_analysis_call_result');
  expect(save.indexOf('if c.job_id is null then return')).toBeLessThan(save.indexOf('set result=p_result'));
  expect(save).toContain('Call result is immutable');
  expect(save.indexOf('settle_content_analysis_call')).toBeLessThan(save.indexOf('for update'));
 });
 it('publishes only annotations using latest-record CAS and rechecks same-hash admin decisions', () => {
  const publish = body('publish_content_analysis_job');
  expect(publish).toContain('lock_content_analysis_job');
  expect(publish).toContain('and record=rec');
  expect(publish).not.toMatch(/insert into public\.reader_source_updates|update public\.reader_workspaces|delete from public\.reader_source_updates/i);
  expect(publish.indexOf('lock_content_analysis_job')).toBeLessThan(publish.indexOf('from public.admin_keyword_reviews'));
  for (const field of ['resolved_label', 'resolved_kind', "q.status='approved'", "q.status='rejected'", 'q.content_hash=j.content_hash']) expect(publish).toContain(field);
  expect(publish).toContain('on conflict(user_id,update_id,content_hash,normalized_label) do nothing');
  expect(body('content_analysis_processing')).toContain("'{processing,content}'='partial'");
 });
 it('matches the actual worker prepare/fail and optional call-cost signatures', () => {
  for (const name of ['prepare_content_analysis_job', 'finish_content_analysis_job', 'publish_content_analysis_job']) expect(functions.has(name)).toBe(true);
  expect(functions.get('fail_content_analysis_job')?.args).toContain('p_yield boolean default false');
  expect(functions.get('record_content_analysis_call_result')?.args).toContain('p_actual_usd numeric default null');
  expect(functions.get('sync_content_analysis_jobs')?.args).toContain("p_config_epoch text default ''");
 });
 it('skips hourly-locked archive rows instead of waiting in newest-first order', () => {
  expect(body('sync_content_analysis_jobs')).toContain('limit p_limit for share of r skip locked');
 });
 it('distinguishes daily pauses from lifetime exhaustion and resumes at UTC midnight without consuming attempts', () => {
  const reserve = body('reserve_content_analysis_call'), fail = body('fail_content_analysis_job'), claim = body('claim_content_analysis_job');
  expect(reserve).toContain("'Lifetime analysis budget exhausted' using errcode='PT402'");
  expect(reserve).toContain("'Daily analysis budget exhausted' using errcode='PT429'");
  expect(reserve.indexOf("errcode='PT402'")).toBeLessThan(reserve.indexOf("errcode='PT429'"));
  expect(fail).toContain("date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day'");
  expect(fail).toContain("p_yield or p_error_code='analysis_daily_budget_exhausted'");
  expect(claim).toContain("q.state='blocked' and q.error_code='analysis_daily_budget_exhausted'");
  expect(reserve).toContain('created_at>=utc_day or actual_usd is null');
 });
 it('closes expired third attempts under locks and updates archive status without touching call holds', () => {
  const claim = body('claim_content_analysis_job');
  const terminal = claim.slice(claim.indexOf("if j.state='running' and j.attempts>=3 then"), claim.indexOf("if j.attempts>=3"));
  expect(terminal).toContain("state='failed',error_code='analysis_lease_expired'");
  expect(terminal).toContain("lease_token=null,lease_until=null,next_attempt_at='infinity'");
  expect(terminal).toContain('set record=a.record||');
  expect(terminal).toContain('continue;');
  expect(terminal).not.toMatch(/update public\.reader_content_analysis_(?:calls|policies)/);
 });
 it('updates persistent reader fairness only on an actual claimed job', () => {
  expect(sql).toContain("last_served_at timestamptz not null default '-infinity'");
  expect(sql).toContain('public.reader_content_analysis_policies(enabled,last_served_at,user_id)');
  const claim = body('claim_content_analysis_job');
  expect(claim.indexOf('set last_served_at=clock_timestamp()')).toBeGreaterThan(claim.indexOf('where id=j.id returning * into j;'));
  expect(claim.indexOf('set last_served_at=clock_timestamp()')).toBeGreaterThan(claim.indexOf('continue;', claim.indexOf("if j.state='running' and j.attempts>=3 then")));
  expect(body('sync_content_analysis_jobs')).not.toContain('set last_served_at');
 });
 it('hashes published keywords independently and refreshes status through the existing admin decision RPC', () => {
  expect(body('publish_content_analysis_job')).toContain("'keywordContentHash',j.content_hash");
  expect(sql).toContain('rename to admin_review_keyword_before_content_processing');
  const review = body('admin_review_keyword');
  expect(review.indexOf('from public.reader_workspaces')).toBeLessThan(review.indexOf('admin_review_keyword_before_content_processing('));
  expect(review).toContain("'keywordContentHash',prior_keyword_provenance");
  expect(review).not.toContain("'keywordContentHash',h");
  expect(review).toContain("q.content_hash=h and q.status='pending'");
  expect(review).toContain("'{processing,keywords}'='review'");
  expect(review).toContain("jsonb_set(a.record->'processing','{keywords}'");
  expect(review).toContain("task='keywords' and state='published'");
  expect(review).not.toMatch(/jsonb_set\([^;]+'\{recap\}'/);
 });
 it('freezes pre-summary provenance and guards both publication and admin timing merges',()=>{
  const publish=body('publish_content_analysis_job'),provenance=body('content_analysis_keyword_provenance');
  expect(publish).toContain("'keywordContentHash',public.content_analysis_keyword_provenance(rec)");
  expect(provenance).toContain("p_record ? 'keywordContentHash'");expect(provenance).toContain("else 'null'::jsonb");
  expect(publish).toContain("(public.content_analysis_keyword_provenance(rec)#>>'{}')=j.content_hash");
  expect(sql).toContain("(public.content_analysis_keyword_provenance(archive.record)#>>'{}')=candidate.content_hash");
  const review=body('admin_review_keyword');
  expect(review.indexOf('prior_keyword_provenance:=')).toBeLessThan(review.indexOf('decided:=public.admin_review_keyword_before_content_processing'));
 });

});
