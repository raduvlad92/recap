import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildReminderPayload, canRetryReminder, canonicalReminderJson, createRecapReminderWorker, createReminderStore, createReminderUnsubscribeHandler,
 createReminderWebhookHandler, decryptReminderRuntime, dispatchRecapReminders, encryptReminderRuntime, loadReminderEnvironment, reminderConfiguration, reminderRuntimeAllowed, reminderUnsubscribeToken, reminderWorkerAuthorized,
 verifiedReminderRecipient, verifyReminderEvent, verifyReminderUnsubscribeToken, type ReminderClaim, type ReminderEvent, type ReminderStore } from '../netlify/functions/_shared/recap-reminders';

const outboxId='00000000-0000-4000-8000-000000000001',briefingId='00000000-0000-4000-8000-000000000002';
const clock=Date.parse('2026-10-31T09:00:00Z');
const values:Record<string,string>={APP_URL:'https://example.com',REMINDER_EMAIL_ENABLED:'true',RESEND_API_KEY:'fixture-key',RESEND_FROM_EMAIL:'Therecap <recap@example.com>',REMINDER_UNSUBSCRIBE_SECRET:'x'.repeat(40),CONTENT_ANALYSIS_WORKER_SECRET:'y'.repeat(40),RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('fixture-webhook-secret-32-characters').toString('base64')};
const env=(name:string)=>values[name];
const claim=():ReminderClaim=>({outbox:{id:outboxId,briefing_id:briefingId,reader_id:'fixture-reader',idempotency_key:'therecap:daily-reminder:v1:'+briefingId,attempts:0,first_attempt_at:null,recipient_email:null,recipient_identity:null,payload:null,payload_hash:null},briefing:{id:briefingId,local_date:'2026-10-31',status:'ready',snapshot:{recapLanguage:'English'}},leaseToken:'fixture-lease'});
function store(c:ReminderClaim|null=claim()):ReminderStore {
 return {sync:vi.fn(async()=>({synchronized:1})),claim:vi.fn().mockResolvedValueOnce(c).mockResolvedValue(null),authorize:vi.fn(async()=>({authorized:true})),finish:vi.fn(async()=>({})),event:vi.fn(async()=>({})),unsubscribe:vi.fn(async()=>({}))};
}
const recipient=vi.fn(async()=>({email:'owner@example.com',identity:'email_fixture'}));
const accepted=()=>new Response(JSON.stringify({id:'fixture-provider-id'}),{status:200});
function event(kind:ReminderEvent['type']='email.delivered'):ReminderEvent{return {type:kind,created_at:'2026-10-31T08:59:00Z',data:{email_id:'fixture-provider-id',to:['owner@example.com'],tags:{recap_reminder:outboxId}}};}
function signed(raw:string,timestamp=String(clock/1000),id='msg_fixture'){
 const signature=createHmac('sha256',Buffer.from(values.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest('base64');
 return new Headers({'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature});
}

describe('optional recap reminders, fixtures only',()=>{
 it('encrypts the private runtime fallback and authenticates both ciphertext and key',()=>{
  const secret=values.CONTENT_ANALYSIS_WORKER_SECRET,settings={RESEND_API_KEY:'private-fixture',REMINDER_EMAIL_ENABLED:'true'};
  const encrypted=encryptReminderRuntime(settings,secret);expect(JSON.stringify(encrypted)).not.toContain('private-fixture');expect(decryptReminderRuntime(encrypted,secret)).toEqual(settings);
  expect(encryptReminderRuntime(settings,secret).iv).not.toBe(encrypted.iv);
  const changedTag=Buffer.from(encrypted.tag,'base64url');changedTag[0]^=1;
  expect(()=>decryptReminderRuntime(encrypted,secret+'wrong')).toThrow();expect(()=>decryptReminderRuntime({...encrypted,tag:changedTag.toString('base64url')},secret)).toThrow();
  expect(()=>encryptReminderRuntime({CLERK_SECRET_KEY:'forbidden'},secret)).toThrow();
 });
 it('loads only service-side encrypted settings and keeps explicit environment overrides',async()=>{
  const encrypted=encryptReminderRuntime({RESEND_API_KEY:'private-fixture',REMINDER_EMAIL_ENABLED:'true'},values.CONTENT_ANALYSIS_WORKER_SECRET);
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:{encrypted_config:encrypted},error:null}))},db={from:vi.fn(()=>query)};
  const inherited=(name:string)=>name==='CONTENT_ANALYSIS_WORKER_SECRET'?values.CONTENT_ANALYSIS_WORKER_SECRET:name==='RESEND_API_KEY'?'explicit-key':undefined;
  const loaded=await loadReminderEnvironment(inherited,db as any);expect(loaded('RESEND_API_KEY')).toBe('explicit-key');expect(loaded('REMINDER_EMAIL_ENABLED')).toBe('true');expect(loaded('CLERK_SECRET_KEY')).toBeUndefined();expect(db.from).toHaveBeenCalledWith('recap_reminder_runtime_settings');
 });
 it('honors a runtime emergency send stop before reading private fallback or calling a provider',async()=>{
  const loadEnv=vi.fn(),fetcher=vi.fn(),off=(name:string)=>name==='REMINDER_EMAIL_ENABLED'?'false':undefined;
  expect(await createRecapReminderWorker({env:off,loadEnv,fetcher})()).toMatchObject({enabled:false});expect(loadEnv).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('continues loading opt-out and webhook secrets when outgoing email is stopped',async()=>{
  const encrypted=encryptReminderRuntime({RESEND_WEBHOOK_SECRET:values.RESEND_WEBHOOK_SECRET,REMINDER_UNSUBSCRIBE_SECRET:values.REMINDER_UNSUBSCRIBE_SECRET,REMINDER_EMAIL_ENABLED:'true'},values.CONTENT_ANALYSIS_WORKER_SECRET);
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:{encrypted_config:encrypted},error:null}))},db={from:vi.fn(()=>query)};
  const loaded=await loadReminderEnvironment(name=>name==='REMINDER_EMAIL_ENABLED'?'false':name==='CONTENT_ANALYSIS_WORKER_SECRET'?values.CONTENT_ANALYSIS_WORKER_SECRET:undefined,db as any);
  expect(loaded('REMINDER_EMAIL_ENABLED')).toBe('false');expect(loaded('RESEND_WEBHOOK_SECRET')).toBe(values.RESEND_WEBHOOK_SECRET);
 });
 it('fails closed when encrypted settings cannot be authenticated or read',async()=>{
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:null,error:{code:'fixture'}}))},db={from:vi.fn(()=>query)};
  await expect(loadReminderEnvironment(name=>name==='CONTENT_ANALYSIS_WORKER_SECRET'?values.CONTENT_ANALYSIS_WORKER_SECRET:undefined,db as any)).rejects.toThrow();
 });
 it('is disabled by default and performs no database or provider operation',async()=>{
  const db=store(),fetcher=vi.fn();expect(reminderRuntimeAllowed(()=>undefined)).toBe(false);
  expect(await createRecapReminderWorker({env:()=>undefined,store:db,fetcher})()).toMatchObject({enabled:false,accepted:0});
  expect(db.sync).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('requires valid sender and private token configuration before dispatch',()=>{
  expect(reminderConfiguration(env).from).toBe(values.RESEND_FROM_EMAIL);
  for(const pair of [['RESEND_FROM_EMAIL','a@example.com\r\nBcc: attacker@example.com'],['REMINDER_UNSUBSCRIBE_SECRET','short'],['RESEND_API_KEY',''],['RESEND_WEBHOOK_SECRET',''],['APP_URL','http://localhost']])expect(()=>reminderConfiguration(name=>name===pair[0]?pair[1]:env(name))).toThrow();
 });
 it('builds only a private briefing link and no source text or private user identity',()=>{
  const payload=buildReminderPayload(claim(),'owner@example.com',env);
  expect(payload.to).toEqual(['owner@example.com']);expect(payload.text).toContain('https://example.com/?briefing='+briefingId);
  expect(payload.html).toContain('<html lang="en">');expect(payload.html).not.toContain('fixture-reader');
  expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  expect(payload.html).not.toContain('<img');expect(payload.tags).toEqual([{name:'recap_reminder',value:outboxId}]);
 });
 it.each(['en','de','es','fr','it','pt-BR'])('renders requested supported reminder language %s',language=>{
  const c=claim();c.briefing.snapshot.recapLanguage=language;c.briefing.status='partial';const payload=buildReminderPayload(c,'owner@example.com',env);
  expect(payload.html).toContain('<html lang="'+language.split('-')[0]+'">');expect(payload.text.length).toBeGreaterThan(100);
 });
 it('retains quiet/partial coverage wording and rejects unknown languages explicitly',()=>{
  const c=claim();c.briefing.status='quiet';expect(buildReminderPayload(c,'owner@example.com',env).text).toContain('quiet day');
  c.briefing.status='partial';expect(buildReminderPayload(c,'owner@example.com',env).text).toContain('still pending');
  c.briefing.snapshot.recapLanguage='unsupported';expect(()=>buildReminderPayload(c,'owner@example.com',env)).toThrow('reminder');
 });
 it('scopes tamper-resistant opt-out tokens to one outbox without exposing the reader id',()=>{
  const token=reminderUnsubscribeToken(outboxId,values.REMINDER_UNSUBSCRIBE_SECRET);
  expect(verifyReminderUnsubscribeToken(token,values.REMINDER_UNSUBSCRIBE_SECRET)).toBe(outboxId);
  expect(()=>verifyReminderUnsubscribeToken(token.replace(outboxId,briefingId),values.REMINDER_UNSUBSCRIBE_SECRET)).toThrow();
  expect(()=>verifyReminderUnsubscribeToken(token,values.REMINDER_UNSUBSCRIBE_SECRET+'changed')).toThrow();
 });
 it('does not unsubscribe on GET or scanner prefetch; POST performs the scoped change',async()=>{
  const db=store(),handler=createReminderUnsubscribeHandler({env,store:db}),url='https://example.com/.netlify/functions/reminder-unsubscribe?token='+reminderUnsubscribeToken(outboxId,values.REMINDER_UNSUBSCRIBE_SECRET);
  const preview=await handler(new Request(url));expect(preview.status).toBe(200);expect(db.unsubscribe).not.toHaveBeenCalled();expect(await preview.text()).toContain('method="post"');
  const response=await handler(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}));expect(response.status).toBe(200);expect(db.unsubscribe).toHaveBeenCalledWith(outboxId);
  expect((await handler(new Request(url+'x',{method:'POST'}))).status).toBe(400);
 });
 it('resolves only current verified Clerk primary email, with no browser destination',async()=>{
  const user={id:'fixture-provider-subject',primary_email_address_id:'primary',email_addresses:[{id:'other',email_address:'other@example.com',verification:{status:'verified'}},{id:'primary',email_address:'Owner@Example.com',verification:{status:'verified'}}]};
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(user)));
  expect(await verifiedReminderRecipient('fixture-owner',name=>name==='CLERK_SECRET_KEY'?'fixture-clerk-key':env(name),fetcher,async()=> 'fixture-provider-subject')).toEqual({email:'owner@example.com',identity:'primary'});
  expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toBe('https://api.clerk.com/v1/users/fixture-provider-subject');
  user.email_addresses[1].verification.status='unverified';await expect(verifiedReminderRecipient('fixture-owner',()=> 'fixture',fetcher,async()=> 'fixture-provider-subject')).rejects.toThrow();
 });
 it('linearizes the final consent check before provider POST and stores acceptance separately',async()=>{
  const db=store(),fetcher=vi.fn(async()=>accepted());const result=await createRecapReminderWorker({env,store:db,fetcher,recipient,now:()=>clock})();
  expect(result.accepted).toBe(1);expect(db.authorize).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
  expect((db.authorize as any).mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
  const request=(fetcher.mock.calls[0] as unknown as [string,RequestInit])[1];expect((request.headers as Record<string,string>)['Idempotency-Key']).toBe(claim().outbox.idempotency_key);
  expect(db.finish).toHaveBeenCalledWith(expect.anything(),'accepted','fixture-provider-id');
 });
 it('makes no provider call after the final consent/generation guard refuses',async()=>{
  const db=store();db.authorize=vi.fn(async()=>({authorized:false,reason:'reminder_no_longer_eligible'}));const fetcher=vi.fn();
  await createRecapReminderWorker({env,store:db,fetcher,recipient})();expect(fetcher).not.toHaveBeenCalled();
 });
 it('reuses the exact frozen payload and idempotency key on a retry',async()=>{
  const c=claim();c.outbox.payload=buildReminderPayload(c,'owner@example.com',env);c.outbox.recipient_email='owner@example.com';c.outbox.recipient_identity='email_fixture';c.outbox.attempts=1;c.outbox.first_attempt_at=new Date(clock-3600000).toISOString();
  const fetcher=vi.fn(async()=>accepted()),db=store(c);await createRecapReminderWorker({env,store:db,fetcher,recipient,now:()=>clock})();
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)).toEqual(c.outbox.payload);
 });
 it('cancels rather than sending to a changed identity during ambiguous acceptance',async()=>{
  const c=claim();c.outbox.recipient_email='old@example.com';c.outbox.recipient_identity='old';c.outbox.first_attempt_at=new Date(clock-1000).toISOString();c.outbox.attempts=1;
  const db=store(c),fetcher=vi.fn();await createRecapReminderWorker({env,store:db,fetcher,recipient,now:()=>clock})();expect(fetcher).not.toHaveBeenCalled();expect(db.finish).toHaveBeenCalledWith(c,'cancelled',undefined,'reminder_recipient_changed');
 });
 it('retains an uncertain result after a timed-out POST, without launching another request',async()=>{
  const db=store(),fetcher=vi.fn(async()=>{throw new Error('network fixture');});
  const result=await createRecapReminderWorker({env,store:db,fetcher,recipient})();expect(result.deferred).toBe(1);expect(fetcher).toHaveBeenCalledOnce();expect(db.finish).toHaveBeenCalledWith(expect.anything(),'uncertain',undefined,'reminder_acceptance_unknown');
 });
 it.each([[429,'retry'],[503,'uncertain'],[422,'failed'],[409,'uncertain']])('classifies provider status %s as %s',async(status,outcome)=>{
  const db=store(),fetcher=vi.fn(async()=>new Response('{}',{status:Number(status)}));await createRecapReminderWorker({env,store:db,fetcher,recipient})();expect(db.finish).toHaveBeenCalledWith(expect.anything(),outcome,undefined,expect.any(String));
 });
 it('stops automated retries before the 24-hour provider deduplication boundary',async()=>{
  expect(canRetryReminder(new Date(clock-23*3600000).toISOString(),1,clock)).toBe(false);expect(canRetryReminder(new Date(clock-22*3600000).toISOString(),3,clock)).toBe(true);expect(canRetryReminder(null,4,clock)).toBe(false);
  const c=claim();c.outbox.first_attempt_at=new Date(clock-24*3600000).toISOString();c.outbox.attempts=1;const db=store(c),fetcher=vi.fn();await createRecapReminderWorker({env,store:db,fetcher,recipient,now:()=>clock})();expect(fetcher).not.toHaveBeenCalled();
 });
 it('verifies raw Svix signatures, including secret rotation multiple signatures',()=>{
  const raw=JSON.stringify(event()),headers=signed(raw);expect(verifyReminderEvent(raw,headers,values.RESEND_WEBHOOK_SECRET,clock).event.type).toBe('email.delivered');
  headers.set('svix-signature','v1,invalid '+headers.get('svix-signature'));expect(verifyReminderEvent(raw,headers,values.RESEND_WEBHOOK_SECRET,clock).id).toBe('msg_fixture');
  expect(()=>verifyReminderEvent(raw+' ',headers,values.RESEND_WEBHOOK_SECRET,clock)).toThrow();
  expect(()=>verifyReminderEvent(raw,signed(raw,String(clock/1000-301)),values.RESEND_WEBHOOK_SECRET,clock)).toThrow();
 });
 it('rejects unsigned/unsupported/multi-recipient events before touching storage',async()=>{
  const db=store(),handler=createReminderWebhookHandler({env,store:db,now:()=>clock}),raw=JSON.stringify(event());
  expect((await handler(new Request('https://example.com/events',{method:'POST',body:raw}))).status).toBe(400);expect(db.event).not.toHaveBeenCalled();
  const unsupported=JSON.stringify({...event(),type:'email.opened'});expect(()=>verifyReminderEvent(unsupported,signed(unsupported),values.RESEND_WEBHOOK_SECRET,clock)).toThrow();
  const multi=JSON.stringify({...event(),data:{...event().data,to:['a@example.com','b@example.com']}});expect(()=>verifyReminderEvent(multi,signed(multi),values.RESEND_WEBHOOK_SECRET,clock)).toThrow();
 });
 it('persists a verified delivery event before acknowledging',async()=>{
  const db=store(),handler=createReminderWebhookHandler({env,store:db,now:()=>clock}),raw=JSON.stringify(event());
  const response=await handler(new Request('https://example.com/events',{method:'POST',headers:signed(raw),body:raw}));expect(response.status).toBe(200);expect(db.event).toHaveBeenCalledWith('msg_fixture',event());
 });
 it('does not dispatch without the runtime gate and authenticates background requests',async()=>{
  const fetcher=vi.fn(async()=>new Response(null,{status:202}));expect(await dispatchRecapReminders(()=>undefined,fetcher)).toEqual({dispatched:false});expect(fetcher).not.toHaveBeenCalled();
  expect(await dispatchRecapReminders(env,fetcher)).toEqual({dispatched:true});
  expect(reminderWorkerAuthorized(new Request('https://example.com/worker',{method:'POST',headers:{'x-content-analysis-secret':values.CONTENT_ANALYSIS_WORKER_SECRET}}),env)).toBe(true);
  expect(reminderWorkerAuthorized(new Request('https://other.example/worker',{method:'POST',headers:{'x-content-analysis-secret':values.CONTENT_ANALYSIS_WORKER_SECRET}}),env)).toBe(false);
 });
 it('never emits a malformed claim or treats DB errors as successful sends',async()=>{
  const db={rpc:vi.fn(async()=>({data:{claimed:true,outbox:{}},error:null}))};await expect(createReminderStore(db as any).claim()).rejects.toThrow();
  const failedDb={rpc:vi.fn(async()=>({data:null,error:{message:'fixture'}}))};await expect(createReminderStore(failedDb as any).sync()).rejects.toThrow();
  expect(canonicalReminderJson({b:1,a:[2,3]})).toBe('{"a":[2,3],"b":1}');
 });
});
