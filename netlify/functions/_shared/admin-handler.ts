import { CollectionError, errorResponse, json, readTextLimited, runtimeEnv, type Env } from './security';
import { clerkRequest, database, requireAdmin, userSummary, type ClerkUser, type WorkspaceRow } from './admin-data';
import { collectionHealth } from './collect-handler';
import type { CatalogueChannel, CollectionJobRecord } from '../../../src/lib/admin-types';
interface Dependencies { env: Env; authorize: typeof requireAdmin; db: typeof database; clerk: typeof clerkRequest }
const success = (value: unknown) => { const response=json(value);response.headers.set('x-robots-tag','noindex, nofollow');return response; };
const unwrap = <T>(result: { data: T; error: {message: string; code?: string} | null }): T => {
 if(result.error) {
  const conflict=result.error.code==='PT409'||result.error.code==='40001';
  throw new CollectionError(conflict?409:502,'database_read_failed',conflict?'This record changed elsewhere. Reload before saving.':'The admin data could not be read or saved. Try again.');
 }
 return result.data;
};
const pageOf = (url: URL) => Math.min(10000,Math.max(0,Number.parseInt(url.searchParams.get('page')||'0')||0));
const queryOf = (url: URL) => (url.searchParams.get('q')||'').trim().slice(0,120).replace(/[%(),]/g,' ');
const exactText = (value: unknown,max:number) => typeof value==='string'&&value.length<=max ? value.trim() : null;

export function createAdminHandler(overrides: Partial<Dependencies>={}) {
 const deps:Dependencies={env:runtimeEnv,authorize:requireAdmin,db:database,clerk:clerkRequest,...overrides};
 return async(request:Request):Promise<Response>=>{
  try {
   if(!['GET','PATCH'].includes(request.method)) return json({error:{code:'method_not_allowed',message:'Use GET or PATCH.'}},405);
   const adminId=await deps.authorize(request,deps.env);
   const db=deps.db(deps.env),url=new URL(request.url),section=url.searchParams.get('section')||'overview',page=pageOf(url),q=queryOf(url);
   if(section==='access' && request.method==='GET')return success({authorized:true});
   if(request.method==='PATCH') {
    if(!request.headers.get('content-type')?.includes('application/json')) throw new CollectionError(415,'json_required','Send JSON.');
    let body:Record<string,unknown>;try {body=JSON.parse(await readTextLimited(new Response(request.body),16000));}catch{throw new CollectionError(400,'invalid_input','The saved details could not be read.');}
    if(!body||Array.isArray(body)||typeof body!=='object') throw new CollectionError(400,'invalid_input','Send record details.');
    const id=exactText(body.id,160),expected=exactText(body.expectedUpdatedAt,60);
    if(!id||!expected||!Number.isFinite(Date.parse(expected))) throw new CollectionError(400,'invalid_input','Reload the record before editing.');
    if(body.action==='creator') {
     const description=exactText(body.description,2000),topics=Array.isArray(body.topics)?body.topics:null;
     if(!description||description.length<10||!topics||topics.length>10||topics.some(t=>typeof t!=='string'||t.length>60||!t.trim())||typeof body.isListed!=='boolean')throw new CollectionError(400,'invalid_input','Use a description of 10–2,000 characters and up to 10 topics.');
     return success({record:unwrap(await db.rpc('admin_update_creator',{p_id:id,p_expected:expected,p_admin:adminId,p_description:description,p_topics:topics,p_listed:body.isListed}))});
    }
    if(body.action==='plan') {
     const provider=exactText(body.provider,30),actor=exactText(body.actorId,160),notes=exactText(body.notes,4000),hours=body.checkHours;
     if(!provider||!['apify','brightdata','native_feed','undecided'].includes(provider)||actor===null||notes===null||typeof hours!=='number'||!Number.isInteger(hours)||hours<1||hours>720)throw new CollectionError(400,'invalid_input','Check the provider, actor, notes and interval (1–720 hours).');
     return success({record:unwrap(await db.rpc('admin_update_plan',{p_platform:id,p_expected:expected,p_admin:adminId,p_provider:provider,p_actor:actor||null,p_hours:hours,p_notes:notes}))});
    }
    throw new CollectionError(400,'invalid_action','Choose an editable record.');
   }
   if(section==='overview') {
    const [metrics,count] = await Promise.all([db.rpc('admin_operating_metrics'),deps.clerk('/users/count',deps.env)]);
    const health=collectionHealth(deps.env);
    return success({overview:{...unwrap(metrics),signedUp:(count as {total_count:number}).total_count,apifyEnabled:health.apifyEnabled,automaticScheduling:false,telemetrySince:'2026-10-21',workspaceCountExact:true},development:deps.env('CLERK_ISSUER_URL')?.includes('.clerk.accounts.dev')===true});
   }
   if(section==='users'||section==='user') {
    const requestedId=url.searchParams.get('id')||'';
    if(section==='user'&&!/^user_[a-zA-Z0-9]{1,100}$/.test(requestedId))throw new CollectionError(400,'invalid_user','Choose a reader.');
    const users:ClerkUser[]=section==='user'?[await deps.clerk('/users/'+encodeURIComponent(requestedId),deps.env) as ClerkUser]:await deps.clerk('/users?'+new URLSearchParams({limit:'50',offset:String(page*50),order_by:'-created_at',...(q?{query:q}:{})}),deps.env) as ClerkUser[];
    const ids=users.map(u=>u.id);
    const [workspaces,channels,usage,total]=await Promise.all([
     ids.length?db.rpc('admin_workspace_summaries',{p_user_ids:ids}):Promise.resolve({data:[],error:null}),
     db.from('catalogue_channels').select('id,creator_id,name,url,platform').limit(1000),
     ids.length?db.rpc('admin_user_job_usage',{p_user_ids:ids}):Promise.resolve({data:[],error:null}),
     section==='users'?deps.clerk('/users/count'+(q?'?'+new URLSearchParams({query:q}):''),deps.env):Promise.resolve({total_count:1})]);
    const rows=unwrap(workspaces) as WorkspaceRow[],allChannels=unwrap(channels) as CatalogueChannel[],usageRows=unwrap(usage) as Array<{user_id:string;job_count:number;actors:string[];observed_cost_usd:number;unknown_cost_jobs:number}>;
    const summaries=users.map(u=>{const item=userSummary(u,rows.find(w=>w.user_id===u.id),allChannels,[]);const usage=usageRows.find(j=>j.user_id===u.id);return usage?{...item,jobCount:Number(usage.job_count),actorsUsed:usage.actors,observedCostUsd:Number(usage.observed_cost_usd),unknownCostJobs:Number(usage.unknown_cost_jobs)}:item;});
    // Access logging stores record IDs only; no email, follows or copied content.
    const audit=await db.from('admin_audit_events').insert({admin_id:adminId,action:section==='user'?'reader.viewed':'readers.listed',target_id:section==='user'?requestedId:null});
    if(audit.error)throw new CollectionError(503,'audit_unavailable','Private reader data was withheld because access logging is unavailable.');
    return success({users:summaries,total:(total as {total_count:number}).total_count,page,pageSize:50});
   }
   if(section==='creators') {
    let query=db.from('catalogue_creators').select('*,catalogue_channels!catalogue_channels_creator_id_fkey(*)',{count:'exact'}).order('name').range(page*50,page*50+49);
    if(q)query=query.ilike('name','%'+q+'%');
    const result=await query;return success({creators:unwrap(result),total:result.count,page,pageSize:50});
   }
   if(section==='plans')return success({plans:unwrap(await db.from('collection_plans').select('*').order('platform')),health:collectionHealth(deps.env)});
   if(section==='jobs') {
    let query=db.from('collection_jobs').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*50,page*50+49);
    const user=url.searchParams.get('user'),status=url.searchParams.get('status'),provider=url.searchParams.get('provider');
    if(user)query=query.eq('user_id',user.slice(0,160));
    if(status)query=query.eq('status',status.slice(0,30));
    if(provider)query=query.eq('provider',provider.slice(0,30));
    const result=await query;return success({jobs:unwrap(result) as CollectionJobRecord[],total:result.count,page,pageSize:50});
   }
   if(section==='audit') {const result=await db.from('admin_audit_events').select('id,admin_id,action,target_id,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*50,page*50+49);return success({events:unwrap(result),total:result.count,page,pageSize:50});}
   throw new CollectionError(404,'unknown_section','This admin section does not exist.');
  }catch(error){const response=errorResponse(error);response.headers.set('x-robots-tag','noindex, nofollow');return response;}
 };
}
