import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../netlify/functions/_shared/admin-data';
import { claimBudgetLaunch, closeBudgetEnvelope, collectionBudgetStatus, releaseUnlaunchedBudget, reserveBudget, settleBudget, type BudgetRequest } from '../netlify/functions/_shared/budget-ledger';
vi.mock('../netlify/functions/_shared/admin-data', () => ({ database: vi.fn() }));
const id='a9a43a2a-c01a-40eb-ae1e-a1d41b52b901';
const parent='b9a43a2a-c01a-40eb-ae1e-a1d41b52b902';
const env=()=>undefined;
const row=(patch:Record<string,unknown>={})=>({id,account_id:'source-proof',request_key:'tech.root.v1',kind:'job',parent_id:parent,maximum_usd:2,provider:'apify',actor_id:'owner/tech',provider_run_id:null,state:'held',actual_cost_usd:null,launch_attempted_at:null,completed_at:null,provider_inventory_complete:false,...patch});
const request:BudgetRequest={kind:'job',requestKey:'tech.root.v1',maximumUsd:2,parentReservationId:parent,provider:'apify',actorId:'owner/tech'};
const call=vi.fn();
beforeEach(()=>{vi.resetAllMocks();vi.mocked(database).mockReturnValue({rpc:call} as unknown as ReturnType<typeof database>);call.mockResolvedValue({data:row(),error:null});});

describe('shared collection spending reservations',()=>{
 it('uses one atomic server RPC without a per-reader reset or browser identifier',async()=>{
  const value=await reserveBudget(request,env);
  expect(value.id).toBe(id);
  expect(database).toHaveBeenCalledWith(env);
  expect(call).toHaveBeenCalledExactlyOnceWith('reserve_collection_budget',{p_request_key:'tech.root.v1',p_maximum_usd:2,p_kind:'job',p_parent_id:parent,p_provider:'apify',p_actor_id:'owner/tech'});
 });
 it('holds a root envelope separately from the jobs allocated inside it',async()=>{
  call.mockResolvedValue({data:row({kind:'envelope',maximum_usd:45,parent_id:null,provider:null,actor_id:null}),error:null});
  await reserveBudget({kind:'envelope',requestKey:'tech.envelope.v1',maximumUsd:45},env);
  expect(call).toHaveBeenCalledWith('reserve_collection_budget',{p_request_key:'tech.envelope.v1',p_maximum_usd:45,p_kind:'envelope',p_parent_id:null,p_provider:null,p_actor_id:null});
 });
 it.each([0,-1,45.000001,Infinity,NaN,0.0000001])('rejects invalid or over-ceiling maximum %s before contacting a database',async value=>{
  await expect(reserveBudget({...request,maximumUsd:value},env)).rejects.toMatchObject({code:'invalid_budget_record'});
  expect(database).not.toHaveBeenCalled();
 });
 it.each([{requestKey:'private?token=value'},{parentReservationId:'not-an-id'},{actorId:''},{actorId:undefined},{actorId:'https://supplier.test/actor'},{provider:'native_feed'},{kind:'envelope'}])('rejects malformed authority/identity fields %j',async patch=>{
  await expect(reserveBudget({...request,...patch} as BudgetRequest,env)).rejects.toMatchObject({code:'invalid_budget_record'});
  expect(database).not.toHaveBeenCalled();
 });
 it('fails closed when the shared ceiling is exhausted, without leaking a supplier error',async()=>{
  call.mockResolvedValue({data:null,error:{code:'PT402',message:'private database detail'}});
  await expect(reserveBudget(request,env)).rejects.toMatchObject({status:402,code:'collection_budget_exhausted'});
 });
 it('does not retry an ambiguous transport failure that could have reserved already',async()=>{
  call.mockRejectedValue(new Error('network detail'));
  await expect(reserveBudget(request,env)).rejects.toMatchObject({status:503,code:'budget_ledger_unavailable'});
  expect(call).toHaveBeenCalledTimes(1);
 });
 it('returns a stable held reservation on an idempotent repeat; it does not launch a supplier',async()=>{
  expect((await reserveBudget(request,env)).id).toBe((await reserveBudget(request,env)).id);
  expect(call.mock.calls.map(c=>c[0])).toEqual(['reserve_collection_budget','reserve_collection_budget']);
 });
 it('claims a provider start once and preserves the claimed=false replay result',async()=>{
  const held=row({launch_attempted_at:'2026-10-21T10:00:00Z'});
  call.mockResolvedValueOnce({data:{claimed:true,reservation:held},error:null}).mockResolvedValueOnce({data:{claimed:false,reservation:held},error:null});
  expect((await claimBudgetLaunch(id,env)).claimed).toBe(true);
  expect((await claimBudgetLaunch(id,env)).claimed).toBe(false);
 });
 it('rejects an invalid claim response rather than granting launch permission',async()=>{
  call.mockResolvedValue({data:{claimed:'yes',reservation:row()},error:null});
  await expect(claimBudgetLaunch(id,env)).rejects.toMatchObject({code:'budget_ledger_unavailable'});
 });
 it('records a terminal unknown charge as null, preserving the full held amount',async()=>{
  await settleBudget(id,{providerRunId:'actualRun123',actualUsd:null,terminal:true},env);
  expect(call).toHaveBeenCalledWith('settle_collection_budget',{p_id:id,p_provider_run_id:'actualRun123',p_actual_usd:null,p_terminal:true});
 });
 it('accepts an exact small final provider charge without rounding it to zero',async()=>{
  const cost=0.0000783674;
  call.mockResolvedValue({data:row({state:'settled',actual_cost_usd:cost}),error:null});
  expect((await settleBudget(id,{providerRunId:'actualRun123',actualUsd:cost,terminal:true},env)).actual_cost_usd).toBe(cost);
 });
 it('never treats a still-running usage estimate as a final charge',async()=>{
  await expect(settleBudget(id,{providerRunId:'actualRun123',actualUsd:0.2,terminal:false},env)).rejects.toMatchObject({code:'invalid_budget_record'});
  expect(call).not.toHaveBeenCalled();
 });
 it('preserves a known overrun as an observed charge rather than clamping it to the reservation',async()=>{
  call.mockResolvedValue({data:row({state:'settled',actual_cost_usd:2.2}),error:null});
  expect((await settleBudget(id,{providerRunId:'actualRun123',actualUsd:2.2,terminal:true},env)).actual_cost_usd).toBe(2.2);
 });
 it('asks the database to refuse release of launched/ambiguous jobs',async()=>{
  call.mockResolvedValue({data:null,error:{code:'PT409',message:'internal launched metadata'}});
  await expect(releaseUnlaunchedBudget(id,env)).rejects.toMatchObject({status:409,code:'budget_state_changed'});
 });
 it('requires affirmative complete-provider-inventory evidence to close an envelope',async()=>{
  await expect(closeBudgetEnvelope(parent,false as true,env)).rejects.toMatchObject({code:'invalid_budget_record'});
  expect(call).not.toHaveBeenCalled();
 });
 it('refuses envelope close when an unresolved child cost remains held',async()=>{
  call.mockResolvedValue({data:null,error:{code:'PT409'}});
  await expect(closeBudgetEnvelope(parent,true,env)).rejects.toMatchObject({status:409});
 });
 it('returns an aggregate over-ceiling signal that callers must stop on',async()=>{
  call.mockResolvedValue({data:{accountId:'source-proof',currency:'USD',ceilingUsd:45,committedUsd:45.1,availableUsd:0,overCeiling:true,heldEnvelopes:1,unknownCostJobs:0},error:null});
  expect((await collectionBudgetStatus(env)).overCeiling).toBe(true);
 });
 it('rejects a substituted account or increased ceiling in a malformed status response',async()=>{
  call.mockResolvedValue({data:{accountId:'per-reader-reset',currency:'USD',ceilingUsd:500},error:null});
  await expect(collectionBudgetStatus(env)).rejects.toMatchObject({code:'budget_ledger_unavailable'});
 });
 it('redacts unknown database failures and malformed rows',async()=>{
  call.mockResolvedValueOnce({data:null,error:{code:'42501',message:'secret server detail'}}).mockResolvedValueOnce({data:{id:'malformed'},error:null});
  await expect(reserveBudget(request,env)).rejects.toMatchObject({code:'budget_ledger_unavailable'});
  await expect(reserveBudget(request,env)).rejects.toMatchObject({code:'budget_ledger_unavailable'});
 });
});
