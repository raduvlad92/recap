-- Transaction-only live database checks; no source/provider request or persisted fixture.
begin;
do $$
declare plan public.collection_plans; job public.collection_jobs; first_revision timestamptz;
begin
 select * into plan from public.collection_plans where platform='Blog';
 if plan.platform is null then raise exception 'Seed plans first';end if;
 update public.collection_plans set provider='apify',actor_id='qa/original',quoted_usd=4,pricing_url='https://apify.com/pricing',unit_label='QA quote',quote_checked_at=current_date where platform='Blog' returning * into plan;
 select * into plan from public.admin_update_plan('Blog',plan.updated_at,'qa_validation','apify','qa/original',48,'QA interval-only change');
 if plan.quoted_usd is distinct from 4::numeric or plan.pricing_url is null then raise exception 'Interval-only edit lost a valid quote';end if;
 select * into plan from public.admin_update_plan('Blog',plan.updated_at,'qa_validation','apify','qa/replacement',24,'QA collector change');
 if plan.quoted_usd is not null or plan.pricing_url is not null or plan.quote_checked_at is not null then raise exception 'Changed actor retained the wrong quote';end if;
 update public.collection_plans set quoted_usd=2,pricing_url='https://apify.com/pricing',quote_checked_at=current_date where platform='Blog' returning * into plan;
 select * into plan from public.admin_update_plan('Blog',plan.updated_at,'qa_validation','brightdata',null,24,'QA provider change');
 if plan.quoted_usd is not null or plan.pricing_url is not null then raise exception 'Changed provider retained the wrong quote';end if;
 begin
  update public.collection_plans set execution_enabled=true where platform='Blog';
  raise exception 'Collection activation unexpectedly accepted';
 exception when check_violation then null;
 end;
 insert into public.collection_jobs(user_id,source_id,source_name,source_url,platform,provider,status) values('qa_validation','qa_source','Transaction-only QA','https://example.com/','Blog','feed','running') returning * into job;
 first_revision:=job.updated_at;
 update public.collection_jobs set status='running' where id=job.id returning * into job;
 if job.updated_at <= first_revision then raise exception 'Same-status update failed to advance revision';end if;
 update public.collection_jobs set observed_cost_usd=99 where id=job.id and updated_at=first_revision;
 if found then raise exception 'Stale ledger revision overwrote newer row';end if;
end$$;
rollback;
select 'Passed quote ownership, disabled activation constraint, same-status revision and stale-write checks; transaction rolled back' as result;
