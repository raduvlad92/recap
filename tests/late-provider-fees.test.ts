import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../netlify/functions/_shared/admin-data';
import { readApifyFeeEvidence, YOUTUBE_ACTOR_ID } from '../netlify/functions/_shared/apify';
import { reconcileLateProviderFee } from '../netlify/functions/_shared/late-provider-fees';
vi.mock('../netlify/functions/_shared/admin-data', () => ({ database: vi.fn() }));
const id='a9a43a2a-c01a-40eb-ae1e-a1d41b52b901', runId='Run123456789',build='Build123456789';
const env=(key:string)=>({APIFY_API_TOKEN:'synthetic-only',APIFY_YOUTUBE_BUILD_ID:build,COLLECTION_ALLOWED_USER_IDS:'synthetic-owner'}[key]);
const job={userId:'synthetic-owner',providerRunId:runId,actorId:YOUTUBE_ACTOR_ID};
const data={id:runId,actId:YOUTUBE_ACTOR_ID,buildId:build,userId:'ProviderOwner123',status:'SUCCEEDED',finishedAt:'2026-11-06T07:00:00.000Z',usageTotalUsd:.004,options:{maxTotalChargeUsd:.005}};
const response=(value:unknown)=>new Response(JSON.stringify(value));
const fetcherFor=(patch:Record<string,unknown>={})=>vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
 expect(init?.method).toBeUndefined();expect(init?.headers).toMatchObject({authorization:'Bearer synthetic-only'});
 return String(url).endsWith('/users/me')?response({data:{id:'ProviderOwner123'}}):response({data:{...data,...patch}});
});
beforeEach(()=>vi.resetAllMocks());
describe('authenticated saved-run fee evidence',()=>{
 it('GETs only the exact run and authenticated owner, without runtime flags, source or dataset requests',async()=>{
  const fetcher=fetcherFor(),evidence=await readApifyFeeEvidence(job,env,fetcher);
  expect(evidence).toMatchObject({run_id:runId,actor_id:YOUTUBE_ACTOR_ID,build_id:build,usage_usd:'0.004',maximum_usd:'0.005',authenticated_owner:true});
  expect(evidence.response_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(['https://api.apify.com/v2/actor-runs/'+runId,'https://api.apify.com/v2/users/me']);
 });
 it('preserves decimal/exponent tokens without binary floating point conversion',async()=>{
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/users/me')?response({data:{id:'ProviderOwner123'}}):new Response(JSON.stringify({data}).replace('"usageTotalUsd":0.004','"usageTotalUsd":0.0040000000000000001')));
  expect((await readApifyFeeEvidence(job,env,fetcher)).usage_usd).toBe('0.0040000000000000001');
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/users/me')?response({data:{id:'ProviderOwner123'}}):new Response(JSON.stringify({data}).replace('"usageTotalUsd":0.004','"usageTotalUsd":4.0000000000001e-3')));
  expect((await readApifyFeeEvidence(job,env,fetcher)).usage_usd).toBe('4.0000000000001e-3');
 });
 it.each([0,null,undefined])('preserves zero/missing observations %s without inventing finality',async value=>{
  const evidence=await readApifyFeeEvidence(job,env,fetcherFor({usageTotalUsd:value,status:'RUNNING',finishedAt:null}));
  expect(evidence).toMatchObject({usage_usd:value===0?'0':null,status:'RUNNING',finished_at:null});
 });
 it.each([{id:'WrongRun123'},{actId:'WrongActor123'},{buildId:'WrongBuild123'},{userId:'WrongOwner123'}])('rejects mismatched current provider identity %j',async patch=>{
  await expect(readApifyFeeEvidence(job,env,fetcherFor(patch))).rejects.toMatchObject({code:'provider_fee_identity_changed'});
 });
 it('rejects a different operator before any HTTP or database request',async()=>{
  const fetcher=vi.fn();await expect(readApifyFeeEvidence({...job,userId:'other'},env,fetcher)).rejects.toMatchObject({status:403});expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([-1,'0.004'])('rejects invalid supplier money %s',async value=>{
  await expect(readApifyFeeEvidence(job,env,fetcherFor({usageTotalUsd:value}))).rejects.toMatchObject({code:'provider_fee_invalid'});
 });
 it('fails closed on duplicate decimal fields',async()=>{
  const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/users/me')?response({data:{id:'ProviderOwner123'}}):new Response(JSON.stringify({data}).replace('"usageTotalUsd":0.004','"usageTotalUsd":0.003,"usageTotalUsd":0.004')));
  await expect(readApifyFeeEvidence(job,env,fetcher)).rejects.toMatchObject({code:'provider_fee_invalid'});
 });
});
describe('explicit late-fee service',()=>{
 it('uses a trusted saved snapshot, then current authenticated evidence, then one CAS receipt RPC',async()=>{
  const expected={provider_job_id:id,reservation_id:id,user_id:job.userId,provider_run_id:runId,actor_id:job.actorId,revision:'saved-revision'};
  const rpc=vi.fn().mockResolvedValueOnce({data:expected}).mockResolvedValueOnce({data:{id:'receipt',outcome:'applied',delta_usd:'0.004000000000'}});
  vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  expect((await reconcileLateProviderFee(id,'stable-key',env,fetcherFor())).outcome).toBe('applied');
  expect(rpc.mock.calls).toEqual([['prepare_late_provider_fee',{p_job_id:id}],['record_late_provider_fee',{p_job_id:id,p_request_key:'stable-key',p_expected:expected,p_evidence:expect.objectContaining({usage_usd:'0.004',run_id:runId})}]]);
 });
 it('does not contact the provider when an unknown/unsupported saved reservation is rejected',async()=>{
  const rpc=vi.fn().mockResolvedValue({error:{code:'PT409',message:'private detail'}}),fetcher=vi.fn();vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  await expect(reconcileLateProviderFee(id,'stable-key',env,fetcher)).rejects.toMatchObject({code:'provider_fee_state_changed'});expect(fetcher).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('does not retry an ambiguous receipt response',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce({data:{provider_job_id:id,reservation_id:id,user_id:job.userId,provider_run_id:runId,actor_id:job.actorId,revision:'snapshot'}}).mockResolvedValueOnce({error:{code:'PT409'}});
  vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  await expect(reconcileLateProviderFee(id,'stable-key',env,fetcherFor())).rejects.toMatchObject({status:409});expect(rpc).toHaveBeenCalledTimes(2);
 });
});
