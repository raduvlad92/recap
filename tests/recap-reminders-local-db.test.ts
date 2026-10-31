import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const available=['initdb','pg_ctl','psql'].every(name=>{try{execFileSync(name,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",j=(value:unknown)=>q(JSON.stringify(value))+'::jsonb';
const reader='reminder-reader',other='other-reminder-reader',briefing='00000000-0000-4000-8000-000000000002',generation='00000000-0000-4000-8000-000000000003';
const state=(opted=true)=>({version:1,followedSourceIds:['source'],customSources:[],importedUpdates:[],savedUpdateIds:[],readLaterIds:[],settings:{emailReminder:opted}});
const payload={from:'Therecap <recap@example.com>',to:['owner@example.com'],subject:'Your recap',text:'Your recap is ready',html:'<p>Your recap is ready</p>',headers:{},tags:[]};
describe.skipIf(!available)('recap reminder protocol, disposable PostgreSQL only',()=>{
 let root:string,args:string[],started=false;
 const sql=(input:string)=>execFileSync('psql',args,{input,encoding:'utf8',maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
 const service=(input:string)=>sql('set role service_role;'+input),json=(input:string)=>JSON.parse(service(input)||'null');
 const claim=()=>json('select public.claim_recap_reminder();');
 const authorize=(c:any,value=payload,identity='primary')=>json(`select public.authorize_recap_reminder_send(${q(c.outbox.id)},${q(c.leaseToken)},'owner@example.com',${q(identity)},${j(value)},repeat('a',64));`);
 const finish=(c:any,outcome='accepted',provider:string|null='provider-fixture')=>json(`select public.finish_recap_reminder_send(${q(c.outbox.id)},${q(c.leaseToken)},${q(outcome)},${provider===null?'null':q(provider)},null);`);
 const enable=()=>service(`insert into public.recap_reminder_policies(user_id,enabled,enabled_until)values(${q(reader)},true,clock_timestamp()+interval'7 days')on conflict(user_id)do update set enabled=true,enabled_until=clock_timestamp()+interval'7 days';`);
 const create=(id=briefing,status='ready')=>service(`insert into public.daily_briefings(id,reader_id,local_date,cutoff_at,status,snapshot,generation,published_at)values(${q(id)},${q(reader)},current_date,clock_timestamp(),${q(status)},'{"recapLanguage":"en"}',${q(generation)},clock_timestamp());`);
 const event=(c:any,type='email.delivered',id='event-one',to='owner@example.com',time='2026-10-31T09:00:00Z')=>json(`select public.record_recap_reminder_event(${q(id)},${j({type,created_at:time,data:{email_id:'provider-fixture',to:[to],tags:{recap_reminder:c.outbox.id}}})});`);
 const outbox=()=>json('select to_jsonb(x)from public.recap_reminder_outbox x;');
 beforeAll(()=>{
  root=mkdtempSync('/tmp/rcrm-');mkdirSync(join(root,'socket'));
  execFileSync('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${join(root,'socket')} -h '' -p 55562`,'start'],{stdio:'ignore'});started=true;
  args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',join(root,'socket'),'-p','55562','-U','postgres','-d','postgres'];
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create schema recap_internal;create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;grant usage on schema public,auth,extensions to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to service_role;`);
  sql(readFileSync(new URL('../supabase/migrations/20261021013525_recap_v0_workspace.sql',import.meta.url),'utf8'));
  // Exact agreed daily-table boundary, independent of the concurrently built
  // composer. Root also runs all real migrations together before release.
  sql(`create table public.daily_briefing_schedules(reader_id text primary key references public.reader_workspaces(user_id)on delete cascade,generation uuid not null);
   create table public.daily_briefings(id uuid primary key,reader_id text not null references public.reader_workspaces(user_id)on delete cascade,local_date date not null,cutoff_at timestamptz not null,status text not null,snapshot jsonb not null,generation uuid not null,published_at timestamptz,deleted_at timestamptz);grant all on public.daily_briefings,public.daily_briefing_schedules to service_role;`);
  sql(readFileSync(new URL('../supabase/migrations/20261031002826_recap_reminder_delivery.sql',import.meta.url),'utf8'));
 },30000);
 beforeEach(()=>{
  sql(`truncate public.reader_workspaces cascade;truncate public.recap_reminder_suppressions;insert into public.reader_workspaces(user_id,state)values(${q(reader)},${j(state())}),(${q(other)},${j(state(false))});insert into public.daily_briefing_schedules(reader_id,generation)values(${q(reader)},${q(generation)});`);
 });
 afterAll(()=>{if(started)execFileSync('pg_ctl',['-D',join(root,'data'),'stop','-m','immediate'],{stdio:'ignore'});if(root)rmSync(root,{recursive:true,force:true});});
 it('queues exactly one ready briefing transactionally and refuses delivery without an enabled finite policy',()=>{
  create();expect(service('select count(*)from public.recap_reminder_outbox;')).toBe('1');service(`update public.daily_briefings set status='partial';`);expect(service('select count(*)from public.recap_reminder_outbox;')).toBe('1');expect(claim()).toEqual({claimed:false});enable();expect(claim().claimed).toBe(true);
 });
 it('does not queue awaiting-review, opted-out or unpublished material',()=>{
  create(briefing,'awaiting_review');expect(service('select count(*)from public.recap_reminder_outbox;')).toBe('0');service(`update public.reader_workspaces set state=${j(state(false))} where user_id=${q(reader)};update public.daily_briefings set status='ready';`);expect(service('select count(*)from public.recap_reminder_outbox;')).toBe('0');
 });
 it('captures historical preference presence without inventing its consent date',()=>{
  expect(json(`select to_jsonb(x)from public.recap_reminder_preferences x where user_id=${q(reader)};`)).toMatchObject({opted_in:true,consent_basis:'preference_change'});
 });
 it('authorizes one frozen payload and records provider acceptance separately from delivery',()=>{
  create();enable();const c=claim();expect(authorize(c)).toEqual({authorized:true});expect(outbox()).toMatchObject({state:'sending',attempts:1,recipient_email:'owner@example.com',payload});expect(finish(c)).toEqual({state:'accepted'});expect(outbox().delivered_at).toBeNull();expect(claim()).toEqual({claimed:false});
 });
 it('claims one lease and refuses duplicate pre-POST authorization',()=>{
  create();enable();const c=claim();expect(claim()).toEqual({claimed:false});authorize(c);expect(()=>authorize(c)).toThrow();
 });
 it('retries uncertain acceptance under the same key, payload and recipient only',()=>{
  create();enable();const c=claim();authorize(c);expect(finish(c,'uncertain',null)).toEqual({state:'uncertain'});service(`update public.recap_reminder_outbox set next_attempt_at=clock_timestamp()-interval'1 second';`);
  const retry=claim();expect(retry.outbox.idempotency_key).toBe(c.outbox.idempotency_key);expect(retry.outbox.payload).toEqual(payload);expect(authorize(retry)).toEqual({authorized:true});expect(outbox().attempts).toBe(2);
 });
 it('cancels a changed recipient identity or payload instead of creating another email',()=>{
  create();enable();const c=claim();authorize(c);finish(c,'uncertain',null);service(`update public.recap_reminder_outbox set next_attempt_at=clock_timestamp()-interval'1 second';`);const retry=claim();expect(authorize(retry,{...payload,subject:'changed'}).authorized).toBe(false);expect(outbox().state).toBe('cancelled');
 });
 it('checks opt-out again at the send boundary, including an already claimed reminder',()=>{
  create();enable();const c=claim();service(`update public.reader_workspaces set state=${j(state(false))} where user_id=${q(reader)};`);expect(outbox().state).toBe('cancelled');expect(()=>authorize(c)).toThrow();expect(finish(c,'cancelled',null)).toEqual({state:'cancelled'});
 });
 it('opt-out then opt-in cannot revive an old briefing reminder',()=>{
  create();enable();service(`update public.reader_workspaces set state=${j(state(false))} where user_id=${q(reader)};update public.reader_workspaces set state=${j(state())} where user_id=${q(reader)};`);expect(json('select public.sync_recap_reminders();').synchronized).toBe(0);expect(claim()).toEqual({claimed:false});
 });
 it('allows bookmark changes without cancelling, while reset generation fences the send',()=>{
  create();enable();const c=claim();service(`update public.reader_workspaces set state=jsonb_set(state,'{savedUpdateIds}','["bookmark"]')where user_id=${q(reader)};`);expect(authorize(c).authorized).toBe(true);finish(c,'uncertain',null);service(`update public.recap_reminder_outbox set next_attempt_at=clock_timestamp()-interval'1 second';update public.daily_briefing_schedules set generation=gen_random_uuid();`);expect(claim()).toEqual({claimed:false});expect(outbox().state).toBe('cancelled');
 });
 it('deleting a briefing cancels pending reminder and account deletion removes private email state',()=>{
  create();enable();claim();service(`update public.daily_briefings set status='deleted',deleted_at=clock_timestamp(),snapshot='{}';`);expect(outbox().state).toBe('cancelled');service(`delete from public.reader_workspaces where user_id=${q(reader)};`);expect(service('select count(*)from public.recap_reminder_outbox;')).toBe('0');
 });
 it('preserves unknown acceptance past expiry without ever automatically sending again',()=>{
  create();enable();const c=claim();authorize(c);finish(c,'uncertain',null);service(`update public.recap_reminder_outbox set first_attempt_at=clock_timestamp()-interval'24 hours',next_attempt_at=clock_timestamp()-interval'1 second';`);json('select public.sync_recap_reminders();');expect(outbox().state).toBe('uncertain');expect(outbox().next_attempt_at).toBe('infinity');expect(outbox().recipient_email).toBe('owner@example.com');expect(claim()).toEqual({claimed:false});expect(event(c,'email.sent','late-reconciled-acceptance')).toMatchObject({state:'accepted'});expect(outbox().state).toBe('accepted');
 });
 it('counts unknown attempts against a finite per-reader daily/lifetime stop',()=>{
  create();enable();const c=claim();authorize(c);finish(c,'uncertain',null);create('00000000-0000-4000-8000-000000000004');const second=claim();expect(authorize(second)).toMatchObject({authorized:false,reason:'reminder_send_limit'});
 });
 it('rejects missing recipient payload and stale tokens',()=>{
  create();enable();const c=claim();expect(()=>authorize(c,{...payload,to:undefined}as any)).toThrow();expect(()=>authorize({...c,leaseToken:'00000000-0000-4000-8000-000000000005'})).toThrow();
 });
 it('records signed delivery before POST response, then deduplicates and never regresses to accepted',()=>{
  create();enable();const c=claim();authorize(c);expect(event(c)).toMatchObject({matched:true,state:'delivered'});expect(finish(c)).toEqual({state:'delivered'});expect(event(c)).toMatchObject({duplicate:true});event(c,'email.sent','event-earlier','owner@example.com','2026-10-30T09:00:00Z');expect(outbox().state).toBe('delivered');expect(service('select count(*)from public.recap_reminder_events;')).toBe('2');
 });
 it('suppresses complaint/bounce addresses and does not leak or accept a foreign event recipient',()=>{
  create();enable();const c=claim();authorize(c);finish(c);expect(()=>event(c,'email.delivered','foreign','other@example.com')).toThrow();event(c,'email.complained');event(c,'email.delivered','late-delivery');expect(outbox().state).toBe('complained');expect(service('select count(*)from public.recap_reminder_suppressions;')).toBe('1');
 });
 it('scoped unsubscribe changes only the matching reader and blocks all pending work',()=>{
  create();enable();const c=claim();expect(json(`select public.unsubscribe_recap_reminder(${q(c.outbox.id)});`)).toEqual({unsubscribed:true});expect(service(`select state#>>'{settings,emailReminder}'from public.reader_workspaces where user_id=${q(reader)};`)).toBe('false');expect(service(`select state#>>'{settings,emailReminder}'from public.reader_workspaces where user_id=${q(other)};`)).toBe('false');expect(outbox().state).toBe('cancelled');
 });
 it('denies private outbox rows and state-changing RPCs to readers and anonymous clients',()=>{
  create();enable();for(const role of ['anon','authenticated']){expect(()=>sql(`set role ${role};select*from public.recap_reminder_outbox;`)).toThrow();expect(()=>sql(`set role ${role};select public.claim_recap_reminder();`)).toThrow();expect(()=>sql(`set role ${role};select public.sync_recap_reminders();`)).toThrow();}
 });
});
