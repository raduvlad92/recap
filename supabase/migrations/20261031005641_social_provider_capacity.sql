-- Bounded social provider concurrency after the verified five-Actor org limit.
-- Preserve all existing jobs, fee holds, run references and admitted proof data.
begin;
-- A finite operator proof is a different scope from recurring reader collection.
-- An ambiguous proof keeps its own uniqueness and money without owning the
-- normal source schedule. Both purposes still count toward fresh admission.
drop index public.social_one_open_source_job;
create unique index social_one_open_source_job on public.social_collection_jobs(source_key,purpose)
 where state in('claimed','launch_claimed','running','ambiguous');
create or replace function public.claim_social_collection_job(p_allow_launch boolean default false)returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.social_collection_sources;p public.social_collection_platforms;j public.social_collection_jobs;r public.collection_budget_reservations;consumer jsonb;members jsonb;ledger uuid;cost numeric;daily numeric;token uuid;moment timestamptz:=clock_timestamp();
begin
 -- Accepted jobs remain reconcilable with the platform stopped. An ambiguous
 -- POST without a run reference is deliberately never automatically relaunched.
 select * into j from public.social_collection_jobs where provider_run_id is not null and(state='running'or(state='completed'and actual_usd is null))and lease_until<moment and next_poll_at<=moment order by next_poll_at,created_at for update skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning * into j;
  select * into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 if not p_allow_launch then return null;end if;
 -- A claim whose launch marker was never written is safe to resume using
 -- the same reservation. Once marked, an unknown POST is never relaunched.
 select q.*into j from public.social_collection_jobs q
 join public.social_collection_platforms reviewed_platform on reviewed_platform.platform=q.platform and reviewed_platform.enabled
 where q.purpose='collection'and q.state='claimed'and q.provider_run_id is null and q.lease_until<moment
 order by q.created_at,q.id for update of q skip locked limit 1;
 if j.id is not null then
  update public.social_collection_jobs set lease_token=gen_random_uuid(),lease_until=moment+interval'5 minutes'where id=j.id returning*into j;
  select*into s from public.social_collection_sources where source_key=j.source_key;
  return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
 end if;
 -- One fresh-claim gate across all platforms and scheduler invocations. The
 -- organization currently allows five Actor jobs. At most three outstanding
 -- social admissions leave two nominal slots for the existing YouTube route.
 -- Reconciliation and a provably unlaunched claim above consume no new slot.
 if not pg_catalog.pg_try_advisory_xact_lock(734601,3101) then return null;end if;
 if(select count(*)from public.social_collection_jobs
   where state in('claimed','launch_claimed','running'))>=3 then return null;end if;
 -- Lock platform before source. All reservations serialize through the existing
 -- global account, without changing the old YouTube policy/caps.
 select q.* into p from public.social_collection_platforms q where enabled
 and q.maximum_usd+coalesce((select sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end)from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=q.platform),0)<=q.lifetime_limit_usd
 and q.maximum_usd+coalesce((select sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end)from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=q.platform and a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'),0)<=q.daily_limit_usd
 and exists(select 1 from public.social_collection_sources a where a.platform=q.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.purpose='collection'and z.state in('claimed','launch_claimed','running','ambiguous')))order by q.platform for update skip locked limit 1;
 if p.platform is null then return null;end if;
 select a.* into s from public.social_collection_sources a where a.platform=p.platform and a.paused_reason is null and a.next_check_at<=moment and exists(select 1 from public.social_collection_consumers c where c.source_key=a.source_key)and not exists(select 1 from public.social_collection_jobs z where z.source_key=a.source_key and z.purpose='collection'and z.state in('claimed','launch_claimed','running','ambiguous'))order by a.next_check_at,a.source_key for update skip locked limit 1;
 if s.source_key is null then return null;end if;
 select coalesce(sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end),0),coalesce(sum(case when a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'then case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end else 0 end),0)into cost,daily from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=p.platform;
 if cost+p.maximum_usd>p.lifetime_limit_usd or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
 select jsonb_agg(to_jsonb(c)order by c.user_id,c.source_id)into members from public.social_collection_consumers c where c.source_key=s.source_key;
 consumer:=members->0;if consumer is null then return null;end if;
 token:=gen_random_uuid();r:=public.reserve_collection_budget('social.'||token::text,p.maximum_usd,'job',null,'apify',p.actor_id);
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status,cost_status)values(consumer->>'user_id',consumer->>'source_id',s.source_name,s.source_url,s.platform,'apify',p.actor_id,'requested','unknown')returning id into ledger;
 insert into public.collection_job_consumers(job_id,user_id)select ledger,value->>'user_id'from jsonb_array_elements(members)on conflict do nothing;
 insert into public.social_collection_jobs(id,source_key,platform,window_from,window_to,config,reservation_id,collection_job_id,consumers)values(token,s.source_key,s.platform,greatest(moment-interval'24 hours',coalesce(s.last_discovered_until-interval'2 hours',moment-interval'24 hours')),moment,to_jsonb(p),r.id,ledger,members)returning * into j;
 return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
end;$$;

create or replace function public.claim_social_collection_proof(p_platform text,p_url text,p_name text,p_operator_id text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s public.social_collection_sources;p public.social_collection_platforms;j public.social_collection_jobs;r public.collection_budget_reservations;k text;ledger uuid;token uuid;cost numeric;daily numeric;moment timestamptz:=clock_timestamp();
begin
 k:=public.social_source_key(p_platform,p_url);
 if k is null or length(p_operator_id)not between 1 and 200 or p_operator_id is null then raise exception'Invalid proof target'using errcode='PT400';end if;
 -- Explicit proof admission shares the same global capacity gate as recurring
 -- collection. Otherwise a concurrent proof could take slot three while the
 -- normal claimant waits for a platform lock and subsequently insert slot four.
 if not pg_catalog.pg_try_advisory_xact_lock(734601,3101)then return null;end if;
 if(select count(*)from public.social_collection_jobs
   where state in('claimed','launch_claimed','running'))>=3 then return null;end if;
 select * into p from public.social_collection_platforms where platform=p_platform for update;
 if p.platform is null or not p.enabled then raise exception'Proof configuration unavailable'using errcode='PT409';end if;
 if(select count(*)from public.social_collection_jobs where platform=p_platform and purpose='proof'and config->>'actor_id'=p.actor_id)>=5 then raise exception'Finite proof roster exhausted'using errcode='PT402';end if;
 select coalesce(sum(case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end),0),coalesce(sum(case when a.created_at>=date_trunc('day',moment at time zone'UTC')at time zone'UTC'then case when b.state='held'then b.maximum_usd when b.state='settled'then b.actual_cost_usd else 0 end else 0 end),0)into cost,daily from public.social_collection_jobs a join public.collection_budget_reservations b on b.id=a.reservation_id where a.platform=p.platform;
 if cost+p.maximum_usd>p.lifetime_limit_usd or daily+p.maximum_usd>p.daily_limit_usd then raise exception'Social budget exhausted'using errcode='PT402';end if;
 insert into public.social_collection_sources(source_key,platform,source_url,source_name)values(k,p_platform,p_url,left(coalesce(p_name,'Public proof source'),160))on conflict do nothing;
 select * into s from public.social_collection_sources where source_key=k for update;
 if exists(select 1 from public.social_collection_jobs where source_key=k and state in('claimed','launch_claimed','running','ambiguous'))then raise exception'Existing source job requires reconciliation'using errcode='PT409';end if;
 token:=gen_random_uuid();r:=public.reserve_collection_budget('social.'||token::text,p.maximum_usd,'job',null,'apify',p.actor_id);
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,actor_id,status,cost_status)values(p_operator_id,'proof-'||md5(k),s.source_name,s.source_url,s.platform,'apify',p.actor_id,'requested','unknown')returning id into ledger;
 insert into public.collection_job_consumers(job_id,user_id)values(ledger,p_operator_id);
 insert into public.social_collection_jobs(id,source_key,platform,purpose,window_from,window_to,config,reservation_id,collection_job_id,consumers)values(token,s.source_key,s.platform,'proof',moment-interval'24 hours',moment,to_jsonb(p),r.id,ledger,'[]')returning * into j;
 return to_jsonb(j)||jsonb_build_object('source_url',s.source_url,'source_name',s.source_name);
end;$$;

revoke all on function public.claim_social_collection_job(boolean),public.claim_social_collection_proof(text,text,text,text)from public,anon,authenticated;
grant execute on function public.claim_social_collection_job(boolean),public.claim_social_collection_proof(text,text,text,text)to service_role;
commit;
