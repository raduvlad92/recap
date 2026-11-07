import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({slots:[]as any[],index:0,effects:[]as Array<()=>void>,auth:{}as any,cancel:false}));
const same=(a:any[],b:any[])=>a?.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
vi.mock('react',()=>({
 useRef:(value:any)=>{const n=h.index++;return h.slots[n]??={current:value};},
 useState:(value:any)=>{const n=h.index++,s=h.slots[n]??={value:typeof value==='function'?value():value};return[s.value,(v:any)=>s.value=typeof v==='function'?v(s.value):v];},
 useCallback:(fn:any,deps:any[])=>{const n=h.index++,s=h.slots[n];if(!s||!same(s.deps,deps))h.slots[n]={value:fn,deps};return h.slots[n].value;},
 useEffect:(fn:any,deps:any[])=>{const n=h.index++,s=h.slots[n];if(!s||!same(s.deps,deps)){const next={deps,cleanup:s?.cleanup};h.slots[n]=next;h.effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}},
}));
vi.mock('../src/lib/auth',()=>({useRecapAuth:()=>h.auth}));
vi.mock('@clerk/react',()=>({useReverification:(fn:any)=>async()=>{let result=await fn();if(result?.clerk_error){if(h.cancel)throw new Error('synthetic-reverification-cancelled');result=await fn();}return result;}}));
import { AccountDeletion } from '../src/components/AccountDeletion';
import { clearUnacceptedDeletion, readDeletionMarker } from '../src/lib/account-deletion';
const owner='synthetic-delete-ui-owner',id='10000000-0000-4000-8000-000000000001';
const accepted={requestId:id,state:'requested',reason:null};
const signedOut=vi.fn();
function render(){h.index=0;const tree=AccountDeletion({language:'en',onSignedOut:signedOut});h.effects.splice(0).forEach(fn=>fn());return tree;}
function nodes(tree:any):any[]{return tree&&typeof tree==='object'?[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]:[];}
function button(tree:any,label:string){const found=nodes(tree).find(n=>n.type==='button'&&n.props.children===label);expect(found,'button '+label).toBeTruthy();return found;}
async function tick(){for(let n=0;n<4;n++)await new Promise(r=>setImmediate(r));}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
function confirm(tree:any,value='DELETE'){nodes(tree).find(n=>n.type==='input').props.onChange({target:{value}});tree=render();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault:vi.fn()});return tree;}
beforeEach(()=>{
 h.slots=[];h.index=0;h.effects=[];h.cancel=false;signedOut.mockReset();
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});vi.stubGlobal('window',{dispatchEvent:vi.fn()});clearUnacceptedDeletion(owner);
 h.auth={identityKey:'synthetic-session',ownerId:owner,isSignedIn:true,getToken:vi.fn(async()=> 'synthetic-token'),signOut:vi.fn(async()=>{})};
});
afterEach(()=>{h.slots.forEach(s=>s?.cleanup?.());clearUnacceptedDeletion(owner);vi.unstubAllGlobals();});
it('requires exact typed confirmation, posts no owner identity, and signs out only after a recorded acknowledgement',async()=>{
 const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:any,options:any)=>{calls.push([url,options]);return Response.json({deletion:options.method==='POST'?accepted:null});}));
 let tree=render();await tick();tree=render();button(tree,'Delete account').props.onClick();tree=render();
 expect(button(tree,'Verify and delete account').props.disabled).toBe(true);confirm(tree,'delete');await tick();expect(calls.filter(c=>c[1].method==='POST')).toHaveLength(0);
 tree=render();confirm(tree);await tick();expect(calls.filter(c=>c[1].method==='POST')).toHaveLength(1);expect(JSON.parse(calls.find(c=>c[1].method==='POST')[1].body)).toEqual({confirmation:'DELETE_ACCOUNT',requestId:expect.any(String)});expect(h.auth.signOut).toHaveBeenCalledTimes(1);expect(signedOut).toHaveBeenCalled();expect(readDeletionMarker(owner)?.state).toBe('accepted');
});
it('retains an ambiguous original request despite a null status read and safely retries that exact identity',async()=>{
 let posts=0;const ids:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{if(options.method==='POST'){ids.push(JSON.parse(options.body).requestId);if(++posts===1)throw new Error('lost reply');return Response.json({deletion:{...accepted,requestId:ids[0]}});}return Response.json({deletion:null});}));
 let tree=render();await tick();tree=render();button(tree,'Delete account').props.onClick();tree=render();confirm(tree);await tick();
 expect(readDeletionMarker(owner)).toMatchObject({requestId:ids[0],state:'pending'});expect(h.auth.signOut).not.toHaveBeenCalled();
 tree=render();confirm(tree);await tick();expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);expect(readDeletionMarker(owner)?.state).toBe('accepted');
});
it('leaves cancellation reversible only after the definitive pre-write reverification refusal',async()=>{
 h.cancel=true;vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>options.method==='POST'?Response.json({error:{code:'account_reverification_required'}},{status:401}):Response.json({deletion:null})));
 let tree=render();await tick();tree=render();button(tree,'Delete account').props.onClick();tree=render();confirm(tree);await tick();expect(readDeletionMarker(owner)).toBeNull();expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('does not dispatch or sign out a replacement session after a delayed token',async()=>{
 const token=deferred<string|null>(),posts=vi.fn();vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{if(options.method==='POST')posts();return Response.json({deletion:null});}));
 let tree=render();await tick();tree=render();button(tree,'Delete account').props.onClick();tree=render();h.auth.getToken=()=>token.promise;confirm(tree);h.auth.identityKey='synthetic-new-session';h.auth.getToken=async()=> 'synthetic-new-token';render();token.resolve('synthetic-old-token');await tick();expect(posts).not.toHaveBeenCalled();expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('does not sign out another session or apply callbacks after an unmounted confirmation loses its reply',async()=>{
 const reply=deferred<Response>();vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>options.method==='POST'?reply.promise:Response.json({deletion:null})));
 let tree=render();await tick();tree=render();button(tree,'Delete account').props.onClick();tree=render();confirm(tree);await tick();h.slots.forEach(s=>s?.cleanup?.());reply.resolve(Response.json({deletion:accepted}));await tick();expect(h.auth.signOut).not.toHaveBeenCalled();expect(signedOut).not.toHaveBeenCalled();expect(readDeletionMarker(owner)?.state).toBe('pending');
});
