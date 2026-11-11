import { expect, it, vi } from 'vitest';
const harness=vi.hoisted(()=>({slots:[] as any[],index:0,effects:[] as any[],client:null as any,auth:{isLoaded:true,isSignedIn:true,userId:'synthetic-provider-subject',ownerId:'synthetic-race-owner',identityKey:'synthetic-session-a',identityStatus:'ready',identityError:null,retryIdentity:()=>{},getToken:async()=> 'synthetic-token'}}));
const same=(a:any[],b:any[])=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
vi.mock('react',()=>({
 useRef:(initial:any)=>{const n=harness.index++;return harness.slots[n]??=( {current:initial});},
 useState:(initial:any)=>{const n=harness.index++;const s=harness.slots[n]??=({value:typeof initial==='function'?initial():initial});return[s.value,(next:any)=>{s.value=typeof next==='function'?next(s.value):next;}];},
 useMemo:(fn:any,deps:any[])=>{const n=harness.index++,s=harness.slots[n];if(!s||!same(s.deps,deps))harness.slots[n]={value:fn(),deps};return harness.slots[n].value;},
 useCallback:(fn:any,deps:any[])=>{const n=harness.index++,s=harness.slots[n];if(!s||!same(s.deps,deps))harness.slots[n]={value:fn,deps};return harness.slots[n].value;},
 useEffect:(fn:any,deps:any[])=>{const n=harness.index++,s=harness.slots[n];if(!s||!same(s.deps,deps)){const next={deps,cleanup:s?.cleanup};harness.slots[n]=next;harness.effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
}));
vi.mock('../src/lib/auth',()=>({useRecapAuth:()=>harness.auth}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>harness.client}));
import {useWorkspace} from '../src/lib/workspace';
import {createDefaultWorkspace} from '../src/lib/fixtures';
import {contentHash,getContentProcessing} from '../src/lib/content-processing';
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
it('coordinates history retries with polling and fences older reads and other owners',async()=>{
 vi.stubEnv('VITE_SUPABASE_URL','https://synthetic.invalid');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','synthetic-publishable');
 const intervalFns:Function[]=[];const storage=new Map();
 vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
 vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('window',{setInterval:(fn:Function)=>{intervalFns.push(fn);return intervalFns.length;},clearInterval:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const source={id:'synthetic-race-source',name:'Synthetic race channel',url:'https://www.youtube.com/@synthetic-race',platform:'YouTube',status:'ready',creatorIds:[],avatarUrl:'https://yt3.googleusercontent.com/synthetic'};
 const state={...createDefaultWorkspace(),sourceCollections:[],followedSourceIds:[source.id],customSources:[source],importedUpdates:[]};
 const original={id:'synthetic-race-item',sourceId:source.id,title:'Synthetic video',summary:'',publishedAt:'2026-10-24T00:00:00.000Z',url:'https://www.youtube.com/watch?v=AbCdEfGhI12',format:'video',contentKind:'transcript',content:'Synthetic GPU performance improved.',isSample:false,contributorIds:[],topics:[],brands:[],sponsors:[],references:[],insights:[],videoFormat:{kind:'regular',basis:'provider'}};
 const hash=contentHash(original.content);
 const completed={...original,videoSummary:{ruleVersion:'takeaways-v1',status:'ready',captionHash:hash,timingBasis:'none'},videoHighlights:[{text:'Synthetic GPU performance improved.'}],processing:{ruleVersion:'content-v1',contentHash:hash,content:'partial',recap:'ready',keywords:'pending'}};
 const staleRead=deferred<any>(),archiveReads=[Promise.resolve({data:[{record:original}],error:null}),staleRead.promise];
 let changedRead:Promise<any>|undefined;const owners:string[]=[];
 harness.client={from:(table:string)=>{const query:any={kind:'all',owner:'',select:()=>query,eq:(key:string,value:string)=>{if(key==='user_id'){query.owner=value;owners.push(value);}return query;},order:()=>query,range:()=>query,in:()=>{query.kind='changed';return query;},maybeSingle:async()=>({data:{state:query.owner==='synthetic-race-owner'?state:{...createDefaultWorkspace(),sourceCollections:[]},updated_at:'2026-10-24T00:00:00.000Z'},error:null}),abortSignal:()=>table==='reader_workspaces'?query:query.kind==='changed'?(changedRead??Promise.resolve({data:[{record:completed}],error:null})):(archiveReads.shift()??Promise.resolve({data:[],error:null}))};return query;}};
 let poll=0;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({updateIds:[2,4].includes(++poll)?[original.id]:[],windowEnd:`2026-10-24T00:0${poll}:00.000Z`,nextCursor:null})));
 let workspace:ReturnType<typeof useWorkspace>;
 function render(){harness.index=0;workspace=useWorkspace();harness.effects.splice(0).forEach(fn=>fn());return workspace;}
 async function settle(){for(let n=0;n<3;n++){await new Promise(r=>setImmediate(r));render();}}
 try{
  render();await settle();expect(workspace!.isLoaded).toBe(true);expect(poll).toBe(1);
  expect(new URL(String(vi.mocked(fetch).mock.calls[0][0]),'https://example.test').searchParams.get('mode')).toBe('archive');
  const cacheBefore=JSON.stringify([...storage.entries()]);
  const retry=workspace!.retryArchive(); // An ordinary history retry captures the older pending row.
  intervalFns[0]();await settle(); // A later poll installs the completed annotation.
  expect(getContentProcessing(workspace!.updates[0]).recap).toBe('pending'); // Poll waits for full history retry.
  expect(JSON.stringify([...storage.entries()])).toBe(cacheBefore);
  staleRead.resolve({data:[{record:original}],error:null});await retry;await settle();
  expect(getContentProcessing(workspace!.updates[0]).recap).toBe('pending');
  intervalFns[0]();await settle(); // Overlapping polling resumes after the history read.
  expect(getContentProcessing(workspace!.updates[0]).recap).toBe('ready');
  const oldOwnerRead=deferred<any>();changedRead=oldOwnerRead.promise;
  intervalFns[0]();await settle();
  intervalFns[0]();await settle();
  harness.auth.ownerId='synthetic-second-owner';harness.auth.userId='synthetic-provider-b';harness.auth.identityKey='synthetic-session-b';render();await settle();
  expect(workspace!.updates).toEqual([]);
  oldOwnerRead.resolve({data:[{record:completed}],error:null});await settle();
  expect(workspace!.updates).toEqual([]);
  expect(owners).toContain('synthetic-second-owner');
 }finally{harness.slots.forEach(s=>s?.cleanup?.());vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
