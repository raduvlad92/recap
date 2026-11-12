import { describe, expect, it, vi } from 'vitest';
import { database } from '../netlify/functions/_shared/admin-data';
import { createHourlyStore, type HourlyClaim } from '../netlify/functions/_shared/hourly-collection';
import { withHostRuntime, type HostPipelineCapability } from '../netlify/functions/_shared/host-runtime';
import { metadataFixture } from './helpers/metadata-provider';
vi.mock('../netlify/functions/_shared/admin-data', () => ({ database: vi.fn() }));
const capability: HostPipelineCapability = { key: 'cron:hourly-collection:2:123', token: '22222222-2222-4222-8222-222222222222', epoch: 2, release: 'a'.repeat(40), revision: '11111111-1111-4111-8111-111111111111', messageId: null };
const claim = { checkId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', state: { user_id: 'hourly-test-reader', source_id: 'test-source' }, source: { id: 'test-source' } } as HourlyClaim;
describe('native metadata store RPC contracts', () => {
 it('keeps the new path inert without the private capability', async () => {
  const rpc=vi.fn(); vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  const store=createHourlyStore(()=>undefined);
  expect(await store.prepareMetadata!(claim)).toEqual([]); expect(await store.pendingMetadata!(claim)).toEqual([]); expect(rpc).not.toHaveBeenCalled();
 });
 it('binds preparation/reservation/dispatch/result/import to exact native check, lease and capability without caller actor or approval flags', async () => {
  const f=metadataFixture(),rpc=vi.fn(async(name:string,_args:Record<string,unknown>)=>({data:name==='assert_hourly_metadata_dispatch'?true:name==='prepare_hourly_metadata_provider'||name==='pending_hourly_metadata_providers'?[]:{applied:false,observationId:'test-observation',claimed:true,intent:f.intent}}));
  vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  await withHostRuntime({env:()=>undefined,pipelineCapability:capability},async()=>{
   const store=createHourlyStore(()=>undefined);
   await store.prepareMetadata!(claim); await store.pendingMetadata!(claim);
   await store.reserveMetadata!(claim,f.intent,f.intent.jobId,{contractDigest:'a'.repeat(64),requestSha256:f.intent.requestSha256,actorId:f.contract.actorId,buildId:f.contract.buildId,buildNumber:f.contract.buildNumber,originalAccountId:f.contract.originalAccountId,maximumUsd:'0.005',maximumItems:1,pricingSha256:f.contract.pricingSha256,inputSchemaSha256:f.contract.inputSchemaSha256,observedAt:'2026-11-12T01:00:00Z',responseSha256:'b'.repeat(64)});
   await store.assertMetadataDispatch!(claim,f.intent);
   await store.finishMetadata!(claim,f.intent,'test-observation');
  });
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['prepare_hourly_metadata_provider','pending_hourly_metadata_providers','reserve_hourly_metadata_provider','assert_hourly_metadata_dispatch','finish_hourly_metadata_provider']);
  for(const [,args] of rpc.mock.calls as unknown as [string,Record<string,unknown>][])expect(args).toMatchObject({p_check_id:claim.checkId,p_lease_token:claim.leaseToken,p_capability:capability});
  expect(rpc.mock.calls[2][1]).toMatchObject({p_scope_id:f.intent.scopeId,p_job_id:f.intent.jobId,p_prepared_digest:f.intent.preparedDigest});
  expect(rpc.mock.calls[2][1]).not.toHaveProperty('p_actor_id'); expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_classification');
 });
 it('keeps exact replay keys stable while a later fresh terminal observation can mature its fee', async () => {
  const f=metadataFixture(),rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:{observationId:'receipt',status:'observed'}}));
  vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  await withHostRuntime({env:()=>undefined,pipelineCapability:capability},async()=>{
   const store=createHourlyStore(()=>undefined),evidence={kind:'status',runId:f.run.id,status:'SUCCEEDED',finishedAt:'2026-11-12T01:00:00Z',usageUsd:'0.0012',observedAt:'2026-11-12T01:00:01Z'};
   await store.recordMetadata!(claim,f.intent,evidence);await store.recordMetadata!(claim,f.intent,evidence);
   await store.recordMetadata!(claim,f.intent,{...evidence,observedAt:'2026-11-12T01:00:15Z'});
  });
  const keys=rpc.mock.calls.map(([,args])=>(args as Record<string,unknown>).p_observation_key);
  expect(keys[0]).toBe(keys[1]);expect(keys[2]).not.toBe(keys[0]);expect(String(keys[2]).length).toBeLessThanOrEqual(160);
 });
 it('uses the live-archive guarded caption admission RPC while legacy metadata identities retain their original route', async()=>{
  const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:{claimed:false,id:'existing'}}));vi.mocked(database).mockReturnValue({rpc} as unknown as ReturnType<typeof database>);
  const store=createHourlyStore(()=>undefined),f=metadataFixture();
  await store.reserve(claim,'youtube:abcdefghijk',f.intent.jobId,.005);
  await store.reserve(claim,'youtube-format:abcdefghijk:'+'a'.repeat(64),f.intent.jobId,.005);
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['reserve_hourly_caption_provider','reserve_hourly_provider']);
 });
});
