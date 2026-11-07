import { describe, expect, it, vi } from 'vitest';
import { readerProviderSubject, resolveReaderOwner, resolveReaderOwners, type IdentityStore } from '../netlify/functions/_shared/reader-identity';
import { requireAdmin, userSummary, type ClerkUser } from '../netlify/functions/_shared/admin-data';
import { createAdminHandler } from '../netlify/functions/_shared/admin-handler';
import { verifiedReminderRecipient } from '../netlify/functions/_shared/recap-reminders';
const env=(name:string)=>({CLERK_ISSUER_URL:'https://synthetic.example',CLERK_SECRET_KEY:'synthetic-clerk-key',ADMIN_USER_IDS:'synthetic-provider'} as Record<string,string>)[name];
const db=(data:unknown,error:unknown=null):IdentityStore=>({rpc:vi.fn(async()=>({data,error}))});
const provider={issuer:'https://synthetic.example',subject:'synthetic-provider'};
const user:ClerkUser={id:provider.subject,first_name:'Synthetic',last_name:null,username:null,primary_email_address_id:'synthetic-primary',email_addresses:[{id:'synthetic-primary',email_address:'synthetic@example.com',verification:{status:'verified'}}],created_at:1,last_sign_in_at:null,banned:false,locked:false};
describe('provider identity and stable data ownership',()=>{
 it('resolves only an exact server-owned response and never falls back to the provider subject',async()=>{
  expect(await resolveReaderOwner(provider,env,db([{provider_subject:provider.subject,owner_id:'synthetic-old-owner'}]))).toBe('synthetic-old-owner');
  await expect(resolveReaderOwner(provider,env,db([{provider_subject:provider.subject,owner_id:null}]))).rejects.toMatchObject({status:403,code:'reader_identity_unbound'});
  for(const value of [null,[],[{provider_subject:'other',owner_id:'synthetic-old-owner'}],[{provider_subject:provider.subject,owner_id:'guest'}]])
   await expect(resolveReaderOwner(provider,env,db(value))).rejects.toMatchObject({status:503});
  await expect(resolveReaderOwner(provider,env,db(null,{message:'synthetic-internal-detail'}))).rejects.toMatchObject({status:503});
 });
 it('keeps batch null identities absent and rejects duplicate/missing response subjects',async()=>{
  expect([...(await resolveReaderOwners(provider.issuer,[provider.subject,'synthetic-unbound'],env,db([{provider_subject:provider.subject,owner_id:'synthetic-old-owner'},{provider_subject:'synthetic-unbound',owner_id:null}])))]).toEqual([[provider.subject,'synthetic-old-owner']]);
  await expect(resolveReaderOwners(provider.issuer,[provider.subject,'synthetic-unbound'],env,db([{provider_subject:provider.subject,owner_id:'synthetic-old-owner'},{provider_subject:provider.subject,owner_id:'synthetic-old-owner'}]))).rejects.toMatchObject({status:503});
 });
 it('looks up administrators with the actual subject and retains their provider actor identity',async()=>{
  const getUser=vi.fn(async()=>user);
  expect(await requireAdmin(new Request('https://app.example/api/admin'),env,async()=>provider.subject,getUser)).toBe(provider.subject);
  expect(getUser).toHaveBeenCalledWith('/users/synthetic-provider',env);
  const summary=userSummary(user,{user_id:'synthetic-old-owner',updated_at:'2026-11-07',state:{}},[],[{user_id:'synthetic-old-owner',provider:'feed',observed_cost_usd:null}] as never,'synthetic-old-owner');
  expect(summary).toMatchObject({id:provider.subject,ownerId:'synthetic-old-owner',jobCount:1,unknownCostJobs:1});
 });
 it('joins admin workspace/usage on stable owner while reader-detail IDs remain current provider subjects',async()=>{
  const rpc=vi.fn(async(name:string,args:any)=>({data:name==='admin_workspace_summaries'?[{user_id:'synthetic-old-owner',updated_at:'2026-11-07',state:{savedCount:7}}]:name==='admin_user_job_usage'?[{user_id:'synthetic-old-owner',job_count:9,actors:[],observed_cost_usd:0,unknown_cost_jobs:1}]:[],error:null}));
  const database={rpc,from:(name:string)=>name==='catalogue_channels'?{select:()=>({limit:()=>({overrideTypes:async()=>({data:[],error:null})})})}:{insert:async()=>({error:null})}};
  const response=await createAdminHandler({env,authorize:async()=>provider.subject,db:(()=>database)as never,clerk:async path=>path.startsWith('/users/count')?{total_count:1}:[user],owners:async()=>new Map([[provider.subject,'synthetic-old-owner']])})(new Request('https://app.example/api/admin?section=users'));
  expect(response.status).toBe(200);expect((await response.json()).users[0]).toMatchObject({id:provider.subject,ownerId:'synthetic-old-owner',savedCount:7,jobCount:9});
  expect(rpc).toHaveBeenCalledWith('admin_workspace_summaries',{p_user_ids:['synthetic-old-owner']});expect(rpc).toHaveBeenCalledWith('admin_user_job_usage',{p_user_ids:['synthetic-old-owner']});
 });
 it('resolves reminder destinations via the current alias and verified Clerk primary email, never a historical owner lookup',async()=>{
  expect(await readerProviderSubject('synthetic-old-owner',provider.issuer,env,db(provider.subject))).toBe(provider.subject);
  await expect(readerProviderSubject('synthetic-old-owner',provider.issuer,env,db(null))).rejects.toMatchObject({status:403});
  const fetcher=vi.fn(async(_input:string|URL|Request,_init?:RequestInit)=>Response.json(user)),resolve=vi.fn(async()=>provider.subject);
  expect(await verifiedReminderRecipient('synthetic-old-owner',env,fetcher,resolve)).toEqual({email:'synthetic@example.com',identity:'synthetic-primary'});
  expect(resolve).toHaveBeenCalledWith('synthetic-old-owner',provider.issuer,env);expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.clerk.com/v1/users/synthetic-provider');
  const blocked=vi.fn(async()=>{throw new Error('synthetic-blocked-alias');});fetcher.mockClear();
  await expect(verifiedReminderRecipient('synthetic-old-owner',env,fetcher,blocked)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
});
