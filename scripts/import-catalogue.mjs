import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const target='zlfdqzabsfndifxiqguo';
const path=new URL('../data/catalogue/catalogue.json',import.meta.url);
const raw=await readFile(path,'utf8'),data=JSON.parse(raw),sha=createHash('sha256').update(raw).digest('hex');
if(data.creators.length!==560||data.channels.length!==600||data.plans.length!==7||data.channels.some(c=>c.collection_status!=='planned')||data.plans.some(p=>p.execution_enabled!==false))throw new Error('Catalogue scope or no-collection invariant changed; review before import.');
console.log(JSON.stringify({project:target,creators:data.creators.length,channels:data.channels.length,plans:data.plans.length,sha256:sha,apply:process.argv.includes('--apply')}));
if(!process.argv.includes('--apply'))process.exit(0);
if(process.argv[process.argv.indexOf('--project-ref')+1]!==target)throw new Error('Supply the exact reviewed recap --project-ref before applying.');
const quoted=value=>{const body=JSON.stringify(value),delimiter='$catalogue_'+sha.slice(0,12)+'$';if(body.includes(delimiter))throw new Error('Unexpected SQL delimiter collision');return delimiter+body+delimiter+'::jsonb';};
const sql=`begin;
do $$begin
 if exists(select 1 from public.catalogue_creators) or exists(select 1 from public.catalogue_channels) or exists(select 1 from public.collection_plans) then raise exception 'Catalogue is not empty; refusing to overwrite research or admin edits'; end if;
end$$;
insert into public.collection_plans(platform,provider,actor_id,pricing_url,unit_label,quoted_usd,quote_checked_at,notes,planned_check_hours,execution_enabled)
select platform,provider,actor_id,pricing_url,unit_label,quoted_usd,quote_checked_at,notes,planned_check_hours,execution_enabled
from jsonb_to_recordset(${quoted(data.plans)}) as r(platform text,provider text,actor_id text,pricing_url text,unit_label text,quoted_usd numeric,quote_checked_at date,notes text,planned_check_hours integer,execution_enabled boolean);
insert into public.catalogue_creators(id,slug,name,kind,description,topics,language,is_listed,researched_at)
select id,slug,name,kind,description,topics,language,is_listed,researched_at
from jsonb_to_recordset(${quoted(data.creators)}) as r(id text,slug text,name text,kind text,description text,topics text[],language text,is_listed boolean,researched_at date);
insert into public.catalogue_channels(id,creator_id,platform,name,handle,url,description,language,verification,evidence,researched_at,collection_status)
select id,creator_id,platform,name,handle,url,description,language,verification,evidence,researched_at,collection_status
from jsonb_to_recordset(${quoted(data.channels)}) as r(id text,creator_id text,platform text,name text,handle text,url text,description text,language text,verification text,evidence jsonb,researched_at date,collection_status text);
insert into public.catalogue_channel_contributors(channel_id,creator_id,role,evidence) select id,creator_id,'publisher',evidence from public.catalogue_channels;
do $$begin
 if (select count(*) from public.catalogue_creators)<>560 or (select count(*) from public.catalogue_channels)<>600 or (select count(*) from public.collection_plans)<>7 then raise exception 'Unexpected import counts';end if;
 if exists(select 1 from public.collection_plans where execution_enabled) then raise exception 'Collection must remain off';end if;
end$$;
commit;
select platform,count(*) as channels from public.catalogue_channels group by platform order by platform;`;
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});const sqlPath=new URL('../.local/catalogue-import.sql',import.meta.url);await writeFile(sqlPath,sql,{mode:0o600});
try{const result=execFileSync('npx',['--yes','supabase@latest','db','query','--linked','--project-ref',target,'--file',sqlPath.pathname],{encoding:'utf8',stdio:['ignore','pipe','pipe']});console.log(result);}catch{throw new Error('Import failed; output withheld. Check the exact target and transaction before retrying.');}
