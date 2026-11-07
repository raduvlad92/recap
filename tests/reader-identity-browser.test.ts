import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => void>, client: null as any, clients: [] as any[], auth: {} as any }));
const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((v,i)=>Object.is(v,b[i]));
vi.mock('react', () => ({
 useRef: (initial:any) => { const n=h.index++; return h.slots[n]??={current:initial}; },
 useState: (initial:any) => { const n=h.index++,s=h.slots[n]??={value:typeof initial==='function'?initial():initial}; return [s.value,(v:any)=>s.value=typeof v==='function'?v(s.value):v]; },
 useMemo: (fn:any,deps:any[]) => { const n=h.index++,s=h.slots[n];if(!s||!same(s.deps,deps))h.slots[n]={value:fn(),deps};return h.slots[n].value; },
 useCallback: (fn:any,deps:any[]) => { const n=h.index++,s=h.slots[n];if(!s||!same(s.deps,deps))h.slots[n]={value:fn,deps};return h.slots[n].value; },
 useEffect: (fn:any,deps:any[]) => { const n=h.index++,s=h.slots[n];if(!s||!same(s.deps,deps)){const next={deps,cleanup:s?.cleanup};h.slots[n]=next;h.effects.push(()=>{next.cleanup?.();next.cleanup=fn();});} },
}));
vi.mock('@supabase/supabase-js',()=>({createClient:(_url:any,_key:any,options:any)=>{h.clients.push(options);return h.client;}}));
vi.mock('../src/lib/auth',()=>({useRecapAuth:()=>h.auth}));
import { useReaderOwner } from '../src/lib/reader-identity';
import { useWorkspace } from '../src/lib/workspace';
import { createDefaultWorkspace } from '../src/lib/fixtures';
function deferred<T>() { let resolve!:(v:T)=>void; const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}; }
function render<T>(fn:()=>T):T { h.index=0;const result=fn();h.effects.splice(0).forEach(f=>f());return result; }
async function tick() { for(let n=0;n<3;n++)await new Promise(r=>setImmediate(r)); }
beforeEach(()=>{
 h.slots=[];h.index=0;h.effects=[];h.clients=[];
 vi.stubEnv('VITE_SUPABASE_URL','https://synthetic.invalid');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','synthetic-publishable');
});
afterEach(()=>{h.slots.forEach(s=>s?.cleanup?.());vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('does not install late resolver results across session switches, and leaves unbound/error identities without a subject fallback',async()=>{
 const a=deferred<any>(),b=deferred<any>(),pending=[a.promise,b.promise];
 h.client={rpc:vi.fn(()=>({abortSignal:()=>pending.shift()}))};
 const getToken=async()=> 'synthetic-token';let key='session-a';
 const read=()=>render(()=>useReaderOwner(key,true,true,getToken));
 expect(read().status).toBe('loading');key='session-b';expect(read().ownerId).toBeNull();
 a.resolve({data:'synthetic-old-owner',error:null});await tick();expect(read().ownerId).toBeNull();
 b.resolve({data:'synthetic-stable-owner',error:null});await tick();expect(read()).toMatchObject({status:'ready',ownerId:'synthetic-stable-owner'});
 key='session-unbound';pending.push(Promise.resolve({data:null,error:null}));read();await tick();expect(read()).toMatchObject({status:'unbound',ownerId:null});
 key='session-invalid';pending.push(Promise.resolve({data:{owner:'synthetic-provider-subject'},error:null}));read();await tick();expect(read()).toMatchObject({status:'error',ownerId:null});
});
it('touches no cache or remote workspace before resolution; reads/writes stable owner keys and fences stale tokens, saves and callbacks even for a new session on the same owner',async()=>{
 const storage=new Map<string,string>(),getItem=vi.fn((k:string)=>storage.get(k)??null),setItem=vi.fn((k:string,v:string)=>storage.set(k,v));
 vi.stubGlobal('localStorage',{getItem,setItem,removeItem:(k:string)=>storage.delete(k)});
 vi.stubGlobal('document',{visibilityState:'hidden',addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('window',{setInterval:vi.fn(()=>1),clearInterval:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No provider or network call allowed');}));
 h.auth={isLoaded:true,isSignedIn:true,userId:'synthetic-provider-subject',ownerId:null,identityKey:'session-a',identityStatus:'loading',identityError:null,retryIdentity:vi.fn(),getToken:async()=> 'synthetic-token'};
 const state={...createDefaultWorkspace(),sourceCollections:[]},oldSave=deferred<any>(),owners:string[]=[],persisted:string[]=[];
 h.client={from:(table:string)=>{
  const query:any={owner:'',saving:false,select:()=>query,eq:(key:string,value:string)=>{if(key==='user_id'){query.owner=value;owners.push(value);}return query;},order:()=>query,range:()=>query,
   update:()=>{query.saving=true;return query;},insert:(row:any)=>{persisted.push(row.user_id);query.saving=true;return query;},
   maybeSingle:()=>query.saving?oldSave.promise:Promise.resolve({data:{state,updated_at:'2026-11-01T00:00:00Z'},error:null}),
   single:()=>oldSave.promise,abortSignal:()=>table==='reader_workspaces'?query:Promise.resolve({data:[],error:null})};return query;
 }};
 const read=()=>render(()=>useWorkspace());
 let workspace=read();expect(workspace.isLoaded).toBe(false);expect(workspace.updateSettings({deliveryTime:'09:15'})).toBe(false);
 expect(h.clients).toHaveLength(0);expect(getItem).not.toHaveBeenCalled();expect(setItem).not.toHaveBeenCalled();
 h.auth.ownerId='synthetic-stable-owner';h.auth.identityStatus='ready';workspace=read();await tick();workspace=read();expect(workspace.isLoaded).toBe(true);
 expect(owners).toContain('synthetic-stable-owner');expect(owners).not.toContain('synthetic-provider-subject');
 expect(storage.has('therecap.workspace.v1.synthetic-stable-owner')).toBe(true);expect(storage.has('therecap.workspace.v1.synthetic-provider-subject')).toBe(false);
 const pendingToken=deferred<string|null>();h.auth.getToken=()=>pendingToken.promise;
 const oldClient=h.clients.at(-1),tokenRequest=oldClient.accessToken();
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});expect(workspace.updateSettings({deliveryTime:'09:15'})).toBe(true);workspace=read();await vi.advanceTimersByTimeAsync(500);
 const staleMutation=workspace.updateSettings;
 h.auth.identityKey='session-b';h.auth.getToken=async()=> 'synthetic-new-token';workspace=read();expect(workspace.isLoaded).toBe(false);
 pendingToken.resolve('synthetic-old-token');expect(await tokenRequest).toBeNull();
 expect(staleMutation({deliveryTime:'22:00'})).toBe(false);
 await tick();workspace=read();expect(workspace.isLoaded).toBe(true);
 const before=JSON.stringify([...storage.entries()]);oldSave.resolve({data:{updated_at:'2026-11-02T00:00:00Z'},error:null});await tick();workspace=read();
 expect(JSON.stringify([...storage.entries()])).toBe(before);expect(workspace.state.settings.deliveryTime).toBe('09:15');
 expect(persisted).not.toContain('synthetic-provider-subject');expect(fetch).not.toHaveBeenCalled();
});
