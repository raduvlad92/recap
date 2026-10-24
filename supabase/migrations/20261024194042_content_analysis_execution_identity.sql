-- D36: persist source-free execution and verified pricing provenance before a
-- provider request. Historical null identities remain unknown, never inferred.
alter table public.reader_content_analysis_calls add column execution_identity jsonb;

create function public.validate_content_analysis_execution_identity(p_identity jsonb,p_model text) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare pricing jsonb; k text; rate numeric;
begin
 if jsonb_typeof(p_identity) is distinct from 'object' or octet_length(p_identity::text)>4096 then
  raise exception 'Invalid analysis execution identity' using errcode='PT400'; end if;
 if not (p_identity ?& array['adapterVersion','route','baseURL','provider','model','reasoningEffort','pricing'])
  or (p_identity-array['adapterVersion','route','baseURL','provider','model','reasoningEffort','pricing'])<>'{}'::jsonb then
  raise exception 'Invalid analysis execution identity fields' using errcode='PT400'; end if;
 foreach k in array array['adapterVersion','route','baseURL','provider','model'] loop
  if jsonb_typeof(p_identity->k) is distinct from 'string' then
   raise exception 'Invalid analysis execution identity value' using errcode='PT400'; end if;
 end loop;
 if length(p_identity->>'adapterVersion') not between 1 and 100
  or p_identity->>'adapterVersion' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  or length(p_identity->>'model') not between 1 and 150
  or p_identity->>'model' !~ '^[A-Za-z0-9_./:-]+$'
  or p_identity->>'model' is distinct from p_model
  or length(p_identity->>'provider') not between 1 and 150
  or p_identity->>'provider' !~ '^[a-z0-9]+([-/][a-z0-9]+)*$'
  or length(p_identity->>'baseURL') not between 1 and 300 then
  raise exception 'Invalid analysis execution identity value' using errcode='PT400'; end if;
 if p_identity->'reasoningEffort'<>'null'::jsonb then
  if jsonb_typeof(p_identity->'reasoningEffort') is distinct from 'string'
   or length(p_identity->>'reasoningEffort') not between 1 and 32
   or p_identity->>'reasoningEffort' !~ '^[a-z][a-z0-9_-]*$' then
   raise exception 'Invalid analysis reasoning identity' using errcode='PT400'; end if;
 end if;
 if p_identity->>'route'='direct' then
  if p_identity->>'provider'<>'openai' or p_identity->>'baseURL'<>'https://api.openai.com/v1' then
   raise exception 'Invalid direct analysis route' using errcode='PT400'; end if;
 elsif p_identity->>'route'='netlify' then
  if p_identity->>'provider'<>'netlify'
   or p_identity->>'baseURL' !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.netlify\.com(:443)?(/[A-Za-z0-9._~/-]*)?$' then
   raise exception 'Invalid Netlify analysis route' using errcode='PT400'; end if;
 elsif p_identity->>'route'='openrouter' then
  if p_identity->>'baseURL'<>'https://openrouter.ai/api/v1'
   or strpos(p_model,'/')=0 or p_model like 'openrouter/%' or strpos(p_model,':')>0 then
   raise exception 'Invalid OpenRouter analysis route' using errcode='PT400'; end if;
 else raise exception 'Invalid analysis route' using errcode='PT400';
 end if;
 pricing:=p_identity->'pricing';
 if jsonb_typeof(pricing) is distinct from 'object' then
  raise exception 'Invalid analysis pricing identity' using errcode='PT400'; end if;
 if not (pricing ?& array['version','inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteApplies','cacheWriteUsdPerMillion'])
  or (pricing-array['version','inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteApplies','cacheWriteUsdPerMillion'])<>'{}'::jsonb
  or jsonb_typeof(pricing->'version') is distinct from 'string'
  or length(pricing->>'version') not between 1 and 150
  or pricing->>'version' !~ '^[A-Za-z0-9][A-Za-z0-9._:/+-]*$'
  or jsonb_typeof(pricing->'cacheWriteApplies') is distinct from 'boolean' then
  raise exception 'Invalid analysis pricing fields' using errcode='PT400'; end if;
 foreach k in array array['inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteUsdPerMillion'] loop
  if pricing->k='null'::jsonb and (k='cachedInputUsdPerMillion' or (k='cacheWriteUsdPerMillion' and pricing->'cacheWriteApplies'='false'::jsonb)) then
   continue;
  end if;
  if jsonb_typeof(pricing->k) is distinct from 'number' then
   raise exception 'Missing verified analysis rate' using errcode='PT400'; end if;
  rate:=(pricing->>k)::numeric;
  if rate<0.000001 or rate>1000 then
   raise exception 'Invalid analysis rate' using errcode='PT400'; end if;
 end loop;
 if pricing->'cacheWriteApplies'='false'::jsonb and pricing->'cacheWriteUsdPerMillion'<>'null'::jsonb
  or (pricing->>'cachedInputUsdPerMillion')::numeric>(pricing->>'inputUsdPerMillion')::numeric then
  raise exception 'Inconsistent analysis cache pricing' using errcode='PT400'; end if;
end;
$$;

-- Existing settlement, result and privacy cleanup UPDATEs retain provenance.
-- A single initial assignment is needed because the compatibility RPC inserts
-- the new call first; v2 assigns it before that transaction can return/commit.
create function public.preserve_content_analysis_execution_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.model is distinct from old.model
   or (old.execution_identity is not null and new.execution_identity is distinct from old.execution_identity) then
   raise exception 'Analysis execution identity is immutable' using errcode='PT409'; end if;
 end if;
 if new.execution_identity is not null then
  perform public.validate_content_analysis_execution_identity(new.execution_identity,new.model);
 end if;
 return new;
end;
$$;
create trigger preserve_content_analysis_execution_identity
 before insert or update of execution_identity,model on public.reader_content_analysis_calls
 for each row execute function public.preserve_content_analysis_execution_identity();

create function public.reserve_content_analysis_call_v2(p_job_id uuid,p_lease_token uuid,p_call_key text,p_maximum_usd numeric,p_model text,p_execution_identity jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare reservation jsonb; c public.reader_content_analysis_calls;
begin
 -- Reject unexpected/source/secret fields before taking locks or holding money.
 perform public.validate_content_analysis_execution_identity(p_execution_identity,p_model);
 -- Delegate all source/lease/policy/budget fences and their established lock
 -- order to v1. Stable job/call keys are never varied with model or pricing.
 reservation:=public.reserve_content_analysis_call(p_job_id,p_lease_token,p_call_key,p_maximum_usd,p_model);
 if reservation->'claimed'='true'::jsonb then
  update public.reader_content_analysis_calls set execution_identity=p_execution_identity
   where id=(reservation#>>'{call,id}')::uuid and execution_identity is null
   returning * into c;
  if not found then raise exception 'Analysis identity reservation unavailable' using errcode='PT409'; end if;
  return jsonb_build_object('claimed',true,'call',to_jsonb(c));
 end if;
 -- Includes legacy null identities: return their exact original ledger row.
 -- Workers must block missing/mismatched identity, never refund/re-key/retry.
 return reservation;
end;
$$;

revoke all on function public.validate_content_analysis_execution_identity(jsonb,text),
 public.preserve_content_analysis_execution_identity(),
 public.reserve_content_analysis_call_v2(uuid,uuid,text,numeric,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.validate_content_analysis_execution_identity(jsonb,text),
 public.reserve_content_analysis_call_v2(uuid,uuid,text,numeric,text,jsonb) to service_role;
comment on column public.reader_content_analysis_calls.execution_identity is 'Private immutable execution/pricing identity committed before provider requests. Null means legacy unknown provenance; never infer or backfill it from current configuration. Does not settle an unknown charge.';
