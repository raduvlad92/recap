import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const file=fileURLToPath(new URL('../data/tech/sources.json',import.meta.url));
const need=(yes,message)=>{if(!yes)throw new Error(message);};
const allowedPlatforms=['YouTube','X','Instagram'];
export function publicSourceUrl(value){
 need(typeof value==='string' && value.length<=2048,'A public source URL is missing or too long.');
 let url;try{url=new URL(value);}catch{throw new Error('Invalid public source URL.');}
 need(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash,'Only clean HTTPS account/evidence URLs are supported.');
 need(url.hostname.includes('.')&&!/^(?:\d+\.){3}\d+$/.test(url.hostname)&&!url.hostname.includes(':')&&!/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname),'Only public hostnames are supported.');
 return url;
}
function evidence(rows){
 need(Array.isArray(rows)&&rows.length>0,'Every identity needs inspected first-party evidence.');
 for(const e of rows){publicSourceUrl(e.url);need(e.checkedAt==='2026-10-21'&&e.method==='official_crosslink'&&typeof e.note==='string'&&e.note.length>10,'Research evidence is incomplete.');}
}
function privateFields(value){
 if(Array.isArray(value)){for(const item of value)privateFields(item);return;}
 if(!value||typeof value!=='object')return;
 for(const[key,val]of Object.entries(value)){
  need(!/^(?:email|emailAddress|ownerEmail|user_id|userId|clerkUserId|token|access_token|password|secret|apiKey|api_key)$/i.test(key),'Private identity/credential fields do not belong in the public manifest.');
  privateFields(val);
 }
}
export function validateTechManifest(data){
 need(data&&data.version===1&&data.checkedAt==='2026-10-21'&&data.collection?.id==='tech'&&data.collection?.name==='tech','Unsupported tech manifest.');
 need(Array.isArray(data.groups)&&Array.isArray(data.creators)&&Array.isArray(data.sources)&&Array.isArray(data.candidates),'Manifest hierarchy is incomplete.');
 privateFields(data);
 need(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(JSON.stringify(data)),'Email addresses do not belong in this public source inventory.');
 need(data.policy?.executionEnabled===false&&data.policy?.identityResearchOnly===true&&data.policy?.unknownAssociationNeverAutoIncluded===true,'An inventory must not enable execution or imply collection proof.');
 const ids=new Set(),creators=new Map(),groups=new Map(),accounts=new Set();
 const id=(value)=>{need(typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value)&&!ids.has(value),'An identity is invalid or duplicated.');ids.add(value);};
 for(const c of data.creators){id(c.id);need(['person','group'].includes(c.kind)&&typeof c.name==='string'&&c.name.trim(),'Invalid creator kind/name.');evidence(c.evidence);creators.set(c.id,c);}
 for(const g of data.groups){id(g.id);need(creators.get(g.creatorId)?.kind==='group','A publishing group needs a distinct group identity.');evidence(g.evidence);groups.set(g.id,g);}
 const counts={YouTube:0,X:0,Instagram:0};let optional=0;
 for(const s of data.sources){
  id(s.id);need(creators.has(s.creatorId)&&groups.has(s.groupId)&&creators.get(s.creatorId).groupId===s.groupId,'A source must link to its evidenced creator and publishing group.');
  need(Array.isArray(s.creatorIds)&&s.creatorIds.includes(s.creatorId)&&s.creatorIds.every(x=>creators.has(x)),'A source has an unknown creator association.');
  need(allowedPlatforms.includes(s.platform)&&['included','optional'].includes(s.scope),'Unsupported source scope/platform.');
  const u=publicSourceUrl(s.url),host=u.hostname.replace(/^www\./,'');
  need((s.platform==='YouTube'&&host==='youtube.com')||(s.platform==='X'&&host==='x.com')||(s.platform==='Instagram'&&host==='instagram.com'),'Source URL and platform disagree.');
  if(s.platform==='YouTube')need(/^UC[A-Za-z0-9_-]{22}$/.test(s.youtubeChannelId)&&u.pathname==='/channel/'+s.youtubeChannelId,'YouTube identity must use its observed stable channel ID.');
  else need(s.youtubeChannelId===null&&/^\/[A-Za-z0-9_.]+\/?$/.test(u.pathname),'Social sources need exact public account paths.');
  const account=s.platform+':'+(s.youtubeChannelId||host+u.pathname.toLowerCase().replace(/\/$/,''));need(!accounts.has(account),'Duplicate canonical source account.');accounts.add(account);
  const stable='tech-source-'+createHash('sha256').update(s.platform+':'+(s.youtubeChannelId||'https://'+host+u.pathname.toLowerCase().replace(/\/$/,''))).digest('hex').slice(0,20);
  need(s.id===(s.catalogueChannelId||stable),'Source ID does not match its stable canonical anchor.');
  need(Array.isArray(s.aliases)&&s.aliases.length>0&&s.aliases.every(a=>!!publicSourceUrl(a)),'Original public account aliases must be preserved.');
  need(Array.isArray(s.formats)&&s.formats.length>0&&s.language==='en'&&s.coverage?.status==='not_collected'&&s.collectionStatus==='planned','Do not label identity research as current activity or content proof.');
  evidence(s.evidence);if(s.scope==='included')counts[s.platform]++;else optional++;
 }
 for(const c of data.candidates){id(c.id);need(c.scope==='unresolved'&&typeof c.reason==='string'&&c.reason.length>20,'Unresolved relationships need a visible explanation.');if(c.url!==null)publicSourceUrl(c.url);evidence(c.evidence);}
 need(counts.YouTube>=20&&counts.X>=10&&counts.Instagram>=8,'The reviewed official technology scope is unexpectedly incomplete.');
 return {included:Object.values(counts).reduce((a,b)=>a+b,0),platforms:counts,optional,unresolved:data.candidates.length,groups:data.groups.length,creators:data.creators.length};
}
export async function loadTechManifest(path=file){const data=JSON.parse(await readFile(path,'utf8'));validateTechManifest(data);return data;}
/** Pure public input preparation only. This never starts a supplier or writes a DB. */
export function actorSources(data){validateTechManifest(data);return data.sources.filter(s=>s.scope==='included').map(s=>({id:s.id,sourceId:s.id,name:s.name,platform:s.platform,url:s.url,channelId:s.youtubeChannelId,creatorId:s.creatorId,creatorIds:s.creatorIds,groupId:s.groupId,aliases:s.aliases,formats:s.formats}));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);need(args.every(a=>['--check','--actor-sources'].includes(a)),'Supported options: --check or --actor-sources.');
  const data=await loadTechManifest();console.log(JSON.stringify(args.includes('--actor-sources')?actorSources(data):{valid:true,...validateTechManifest(data),networkRequests:0,databaseWrites:0,providerJobs:0},null,2));
 }catch{console.error('Tech source manifest validation failed. Check public URLs, identity links, evidence and stable IDs.');process.exitCode=1;}
}
