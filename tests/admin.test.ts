import {describe,it,expect,vi,afterEach} from 'vitest';
import {isAllowedAdmin,requireAdmin,userSummary,type ClerkUser} from '../netlify/functions/_shared/admin-data';
import {createAdminHandler} from '../netlify/functions/_shared/admin-handler';
import {renderCreator,renderDirectory,structuredJson} from '../netlify/functions/_shared/catalogue-pages';
import type {CatalogueCreator} from '../src/lib/admin-types';
import type {Env} from '../netlify/functions/_shared/security';
const env=(v:Record<string,string>):Env=>k=>v[k];
const user:ClerkUser={id:'user_reader',first_name:'Reader',last_name:null,username:null,primary_email_address_id:'email_primary',email_addresses:[{id:'email_primary',email_address:'owner@example.com',verification:{status:'verified'}}],created_at:1,last_sign_in_at:null,banned:false,locked:false};
const fail=()=>{throw Object.assign(new Error('denied'),{status:401});};
afterEach(()=>vi.restoreAllMocks());
describe('server-owned administrator authorization',()=>{
 it('denies an authenticated user when no explicit owner is configured',()=>expect(isAllowedAdmin(user,env({}))).toBe(false));
 it('requires an exact explicit subject rather than a first-signup flag',()=>{
  expect(isAllowedAdmin(user,env({ADMIN_USER_IDS:'user_other'}))).toBe(false);
  expect(isAllowedAdmin(user,env({ADMIN_USER_IDS:'user_reader'}))).toBe(true);
 });
 it('only accepts a verified primary email from the trusted identity provider',()=>{
  const config=env({ADMIN_ALLOWED_EMAILS:'OWNER@example.com'});
  expect(isAllowedAdmin(user,config)).toBe(true);
  expect(isAllowedAdmin({...user,email_addresses:[{...user.email_addresses[0],verification:{status:'unverified'}}]},config)).toBe(false);
  expect(isAllowedAdmin({...user,primary_email_address_id:'another'},config)).toBe(false);
 });
 it('does not accept editable metadata, arbitrary email claims or banned accounts',()=>{
  expect(isAllowedAdmin({...user,email_addresses:[],public_metadata:{admin:true}} as ClerkUser,env({ADMIN_ALLOWED_EMAILS:'owner@example.com'}))).toBe(false);
  expect(isAllowedAdmin({...user,banned:true},env({ADMIN_USER_IDS:user.id}))).toBe(false);
  expect(isAllowedAdmin({...user,locked:true},env({ADMIN_USER_IDS:user.id}))).toBe(false);
 });
 it('verifies the session before reading any identity data',async()=>{
  const getUser=vi.fn();await expect(requireAdmin(new Request('https://app.example/api/admin'),env({}),fail,getUser)).rejects.toThrow();expect(getUser).not.toHaveBeenCalled();
 });
 it('rejects a provider response for a different subject',async()=>{
  await expect(requireAdmin(new Request('https://app.example/api/admin'),env({ADMIN_USER_IDS:'user_owner'}),async()=>user.id,async()=>({...user,id:'user_owner'}))).rejects.toMatchObject({status:403});
 });
 it('never reads privileged database data after an authorization denial',async()=>{
  const db=vi.fn();const handler=createAdminHandler({authorize:async()=>{throw new Error('denied');},db});
  const response=await handler(new Request('https://app.example/api/admin?section=users'));
  expect(response.status).toBeGreaterThanOrEqual(400);expect(db).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-robots-tag')).toContain('noindex');
 });
 it('keeps access checks small and does not read a reader list',async()=>{
  const clerk=vi.fn();const response=await createAdminHandler({authorize:async()=>user.id,db:(()=>({})) as never,clerk})(new Request('https://app.example/api/admin?section=access'));
  expect(await response.json()).toEqual({authorized:true});expect(clerk).not.toHaveBeenCalled();
 });
 it('rejects a paid-enable action and invalid edits without making a write',async()=>{
  const rpc=vi.fn();const handler=createAdminHandler({authorize:async()=>user.id,db:(()=>({rpc})) as never});
  const response=await handler(new Request('https://app.example/api/admin',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({action:'enable_collection',id:'YouTube',expectedUpdatedAt:'2026-10-21T01:00:00Z'})}));
  expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['PT409','40001'])('returns an actionable conflict for database code %s without exposing its raw message',async code=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{code,message:'internal database detail that must stay private'}});
  const handler=createAdminHandler({authorize:async()=>user.id,db:(()=>({rpc})) as never});
  const response=await handler(new Request('https://app.example/api/admin',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({action:'creator',id:'creator1',expectedUpdatedAt:'2026-10-21T01:00:00Z',description:'Updated factual creator description.',topics:['Technology'],isListed:true})}));
  expect(response.status).toBe(409);
  const result=await response.json();
  expect(result.error.message).toContain('Reload before saving');
  expect(JSON.stringify(result)).not.toContain('internal database detail');
 });
 it('minimizes reader data to follows and counts, without copied private content',()=>{
  const summary=userSummary(user,{user_id:user.id,updated_at:'2026-10-21',state:{followedSourceIds:['s1'],customSources:[{id:'s1',name:'Real source',url:'javascript:steal()',platform:'X',status:'pending'}],savedCount:5,importedCount:2,privateToken:'must-not-appear',importedUpdates:[{content:'private full article'}]}},[],[]);
  expect(summary.follows[0].url).toBe('');expect(summary.savedCount).toBe(5);expect(summary.importedCount).toBe(2);expect(JSON.stringify(summary)).not.toContain('private full article');expect(JSON.stringify(summary)).not.toContain('must-not-appear');
 });
});
const creator:CatalogueCreator={id:'creator1',slug:'test-creator',name:'Test <Creator>',kind:'person',description:'Independent technology writing & teaching.',topics:['Technology'],language:'en',is_listed:true,researched_at:'2026-10-21',updated_at:'2026-10-21T01:00:00Z',catalogue_channels:[{id:'ch1',creator_id:'creator1',platform:'YouTube',name:'Test channel',handle:'@test',url:'https://www.youtube.com/@test',description:'Technology tutorials and explanations.',language:'en',verification:'public_directory',evidence:[{url:'https://example.com/directory',note:'Public account link inspected'}],researched_at:'2026-10-21',collection_status:'planned'}]};
describe('crawlable honest catalogue pages',()=>{
 it('renders original links, planned coverage, a canonical and an inspectable research reference in HTML',()=>{
  const page=renderCreator(creator,[],'https://app.example');
  expect(page).toContain('<h1>Test &lt;Creator&gt;</h1>');expect(page).toContain('https://app.example/creators/test-creator/');expect(page).toContain('https://www.youtube.com/@test');expect(page).toContain('Collection planned');expect(page).toContain('Content collection has not been tested');expect(page).toContain('https://example.com/directory');expect(page).toContain('ProfilePage');
 });
 it('prevents markup and JSON-LD injection from curated or edited descriptions',()=>{
  const page=renderCreator({...creator,description:'</script><script>steal()</script>'},[],'https://app.example');
  expect(page).not.toContain('</script><script>steal()');expect(structuredJson({text:'</script>'})).toContain('\\u003c/script>');
 });
 it('does not turn an invalid channel URL into a clickable original or follow action',()=>{
  const page=renderCreator({...creator,catalogue_channels:[{...creator.catalogue_channels![0],url:'javascript:steal()'}]},[],'https://app.example');expect(page).not.toContain('href="javascript:');expect(page).not.toContain('addSource=javascript');
 });
 it('filters the real directory and keeps query results out of the index',()=>{
  const page=renderDirectory([creator],'https://app.example',new URLSearchParams('q=nonexistent'));
  expect(page).toContain('No matching sources');expect(page).toContain('noindex, follow');expect(page).not.toContain('href="/creators/test-creator/"');
 });
});

describe('private source credentials',()=>{
 it('withholds private feed credentials and URL fragments from administrator link output',async()=>{
  const {safeLink}=await import('../netlify/functions/_shared/admin-data');
  expect(safeLink('https://example.com/feed?token=reader-secret')).toBe('');
  expect(safeLink('https://example.com/feed#private-fragment')).toBe('https://example.com/feed');
  const {normalizeSourceUrl}=await import('../src/lib/domain');
  expect(()=>normalizeSourceUrl('https://example.com/feed?api_key=private')).toThrow();
 });
});

it('matches reader-normalized follows to researched channels and their canonical creator identity',()=>{
 const channels=[{id:'catalogue-channel',creator_id:'real-creator',name:'Example video channel',platform:'YouTube',url:'https://www.youtube.com/@example/',catalogue_creators:{name:'A real creator'}}] as never;
 const summary=userSummary(user,{user_id:user.id,updated_at:'2026-10-21',state:{followedSourceIds:['s1'],customSources:[{id:'s1',name:'example',url:'https://youtube.com/@example',platform:'YouTube',status:'pending'}]}},channels,[]);
 expect(summary.follows[0].name).toBe('Example video channel');expect(summary.follows[0].creatorNames).toEqual(['A real creator']);expect(summary.follows[0].catalogueCreatorId).toBe('real-creator');
});
it('keeps a Substack publication label separate from its canonical creator name',()=>{
 const channels=[{id:'newsletter-channel',creator_id:'newsletter-author',name:"Lenny's Newsletter",platform:'Substack',url:'https://www.lennysnewsletter.com/',catalogue_creators:{name:'Lenny Rachitsky'}}] as never;
 const summary=userSummary(user,{user_id:user.id,updated_at:'2026-10-21',state:{followedSourceIds:['newsletter'],customSources:[{id:'newsletter',name:'lennysnewsletter',url:'https://lennysnewsletter.com',platform:'Blog',status:'pending'}]}},channels,[]);
 expect(summary.follows[0]).toMatchObject({name:"Lenny's Newsletter",platform:'Substack',creatorNames:['Lenny Rachitsky'],catalogueCreatorId:'newsletter-author'});
});
it.each([undefined,null,{name:null},{name:''},{name:'   '}])('leaves the creator identity unknown when its canonical name is missing (%j)',catalogue_creators=>{
 const channels=[{id:'newsletter-channel',creator_id:'newsletter-author',name:'A publication, not a person',platform:'Substack',url:'https://example.substack.com/',catalogue_creators}] as never;
 const summary=userSummary(user,{user_id:user.id,updated_at:'2026-10-21',state:{followedSourceIds:['newsletter'],customSources:[{id:'newsletter',name:'Reader-entered label',url:'https://example.substack.com',platform:'Substack',status:'pending'}]}},channels,[]);
 expect(summary.follows[0].creatorNames).toEqual([]);expect(summary.follows[0].name).toBe('A publication, not a person');
});
it('reads canonical creator names through the explicit catalogue foreign key for the admin reader list',async()=>{
 const channels=[{id:'newsletter-channel',creator_id:'newsletter-author',name:'A publication',platform:'Substack',url:'https://example.substack.com/',catalogue_creators:{name:'An author'}}];
 const select=vi.fn(()=>({limit:()=>({overrideTypes:async()=>({data:channels,error:null})})}));
 const insert=vi.fn().mockResolvedValue({error:null});
 const db={from:(table:string)=>table==='catalogue_channels'?{select}:{insert},rpc:async(name:string)=>({data:name==='admin_workspace_summaries'?[{user_id:user.id,updated_at:'2026-10-21',state:{followedSourceIds:['newsletter'],customSources:[{id:'newsletter',url:'https://example.substack.com'}]}}]:[],error:null})};
 const handler=createAdminHandler({authorize:async()=>user.id,db:(()=>db) as never,clerk:async path=>path.startsWith('/users/count')?{total_count:1}:[user]});
 const response=await handler(new Request('https://app.example/api/admin?section=users'));
 expect(response.status).toBe(200);expect(select).toHaveBeenCalledWith('id,creator_id,name,url,platform,catalogue_creators!catalogue_channels_creator_id_fkey(name)');
 expect((await response.json()).users[0].follows[0]).toMatchObject({name:'A publication',creatorNames:['An author']});expect(insert).toHaveBeenCalledOnce();
});
it('accepts researched legacy YouTube channel links for a planned source list without claiming collection support',async()=>{
 const {normalizeSourceUrl}=await import('../src/lib/domain');
 expect(normalizeSourceUrl('https://www.youtube.com/user/ExampleChannel').platform).toBe('YouTube');
 expect(normalizeSourceUrl('https://www.youtube.com/ExampleChannel').platform).toBe('YouTube');
 expect(()=>normalizeSourceUrl('https://www.youtube.com/feed')).toThrow();
});

it('renders usable crawlable metadata for every researched creator page',async()=>{
 const catalogue=(await import('../data/catalogue/catalogue.json')).default;
 for(const item of catalogue.creators){
  const channels=catalogue.channels.filter(c=>c.creator_id===item.id);
  const page=renderCreator({...item,updated_at:'2026-10-21T00:00:00Z',catalogue_channels:channels} as CatalogueCreator,[],'https://app.example');
  const structured=JSON.parse(page.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)![1]);
  expect(structured.mainEntity.sameAs).toHaveLength(channels.length);
  expect(structured.mainEntity.name).toBe(item.name);
  expect(page).toContain('https://app.example/creators/'+item.slug+'/');
  expect(page).toContain('Not collected yet');
 }
});
