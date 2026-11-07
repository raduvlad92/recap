import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearUnacceptedDeletion, deletionMarkerKey, parseDeletionStatus, readAccountDeletion, readDeletionMarker, requestAccountDeletion, suppressDeletedWorkspace } from '../src/lib/account-deletion';
const owner='synthetic-delete-client-owner',id='10000000-0000-4000-8000-000000000001';
const status={requestId:id,state:'requested',reason:null};
let storage:Map<string,string>;
beforeEach(()=>{storage=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});vi.stubGlobal('window',{dispatchEvent:vi.fn()});clearUnacceptedDeletion(owner);});
afterEach(()=>{clearUnacceptedDeletion(owner);vi.unstubAllGlobals();});
it('erases only this owner cache and synchronously suppresses it before dispatch; another owner remains intact',()=>{
 storage.set('therecap.workspace.v1.'+owner,'private');storage.set('therecap.workspace.v1.synthetic-other','other');
 suppressDeletedWorkspace(owner,{requestId:id,state:'pending'});
 expect(readDeletionMarker(owner)).toEqual({requestId:id,state:'pending'});expect(storage.has('therecap.workspace.v1.'+owner)).toBe(false);expect(storage.get('therecap.workspace.v1.synthetic-other')).toBe('other');expect(window.dispatchEvent).toHaveBeenCalled();
});
it('keeps an in-memory fence when storage is full and cannot persist a tombstone',()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}});
 suppressDeletedWorkspace(owner,{requestId:id,state:'pending'});expect(readDeletionMarker(owner)?.requestId).toBe(id);
});
it('reads cross-tab persisted marker changes instead of retaining stale module state',()=>{
 suppressDeletedWorkspace(owner,{requestId:id,state:'pending'});storage.set(deletionMarkerKey(owner),JSON.stringify({requestId:id,state:'accepted'}));expect(readDeletionMarker(owner)?.state).toBe('accepted');storage.delete(deletionMarkerKey(owner));expect(readDeletionMarker(owner)).toBeNull();
});
it('sends exactly one owner-free same-origin confirmation with the original request identity, retaining pending state on a lost reply',async()=>{
 suppressDeletedWorkspace(owner,{requestId:id,state:'pending'});
 const fetcher=vi.fn(async()=>{throw new Error('lost reply');});vi.stubGlobal('fetch',fetcher);
 await expect(requestAccountDeletion('synthetic-token',id)).rejects.toThrow('lost reply');expect(readDeletionMarker(owner)?.requestId).toBe(id);
 expect(fetcher).toHaveBeenCalledWith('/api/account-deletion',expect.objectContaining({method:'POST',body:JSON.stringify({confirmation:'DELETE_ACCOUNT',requestId:id}),cache:'no-store',headers:expect.objectContaining({'x-recap-account-action':'delete-account',authorization:'Bearer synthetic-token'})}));
});
it('returns only the SDK reverification hint for a definitive recent-sign-in refusal',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'account_reverification_required'}},{status:401})));
 expect(await requestAccountDeletion('synthetic-token',id)).toEqual({clerk_error:{type:'forbidden',reason:'reverification-error',metadata:{reverification:{level:'multi_factor',afterMinutes:5}}}});
});
it('checks recorded own status without an owner parameter and rejects malformed completion claims',async()=>{
 const fetcher=vi.fn(async()=>Response.json({deletion:status}));vi.stubGlobal('fetch',fetcher);
 expect(await readAccountDeletion('synthetic-token')).toEqual(status);expect(fetcher).toHaveBeenCalledWith('/api/account-deletion',expect.objectContaining({cache:'no-store'}));
 expect(()=>parseDeletionStatus({state:'completed'})).toThrow();expect(()=>parseDeletionStatus({...status,state:'erased_everywhere'})).toThrow();
});
