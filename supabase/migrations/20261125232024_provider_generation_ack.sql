begin;

-- Financial identity only. An acknowledgement does not settle, release,
-- validate the response, or authorize a new generation.
create function public.record_openrouter_generation_ack(
  p_call_id uuid,p_lease_token uuid,p_request_hash text,p_generation_id text
) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.reader_content_analysis_calls;
begin
  if p_call_id is null or p_lease_token is null or p_request_hash is null
    or p_request_hash !~ '^[a-f0-9]{64}$' or p_generation_id is null
    or p_generation_id !~ '^gen-[A-Za-z0-9_-]{1,240}$' then
    raise exception 'Invalid OpenRouter acknowledgement' using errcode='PT400';
  end if;
  select * into c from public.reader_content_analysis_calls where id=p_call_id for update;
  if not found or c.lease_token is distinct from p_lease_token
    or c.request_hash is distinct from p_request_hash
    or c.execution_identity->>'route' is distinct from 'openrouter'
    or c.state not in ('reserved','unknown') or c.actual_usd is not null
    or (c.provider_id is not null and c.provider_id<>p_generation_id) then
    raise exception 'OpenRouter acknowledgement binding changed' using errcode='PT409';
  end if;
  if c.provider_id is null then
    update public.reader_content_analysis_calls set provider_id=p_generation_id where id=p_call_id;
  end if;
end;
$$;
revoke all on function public.record_openrouter_generation_ack(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.record_openrouter_generation_ack(uuid,uuid,text,text) to service_role;

commit;
