begin;

-- Scores describe saved evidence. Older attempts include the owner's held proof.
-- For keywords, admit only conservative literal boundaries. Other names remain individually editable.
create function public.admin_video_review_score(r public.admin_analysis_reviews, a public.reader_source_updates)
returns integer language sql stable security invoker set search_path = '' as $$
  select case
    when r.id is null or r.provenance->>'origin' is distinct from 'automatic_content'
      or not exists (select 1 from public.automatic_content_tasks t
        where t.id = case when split_part(r.dedupe_key, ':', 2) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
          then split_part(r.dedupe_key, ':', 2)::uuid end
          and t.user_id = r.user_id and t.update_id = r.update_id and t.content_hash = r.content_hash and t.task = case r.kind when 'keyword' then 'keywords' else 'recap' end
          and t.created_at >= '2026-11-25T00:00:00Z')
      or a.record->>'contentKind' is distinct from 'transcript'
      or coalesce(a.record->>'url', '') !~ '^https://(www[.]|m[.])?youtube[.]com/(watch[?]v=|shorts/)|^https://youtu[.]be/'
      or a.source_id is distinct from r.source_id
      or encode(sha256(convert_to(a.record->>'content', 'UTF8')), 'hex') is distinct from r.content_hash
      or encode(sha256(convert_to(r.source_snapshot->>'content', 'UTF8')), 'hex') is distinct from r.content_hash
    then null
    when r.kind = 'keyword' and r.reason like 'The AI checker accepted this %'
      and (r.proposal->>'label') ~ '^[!-~]([ -~]{0,98}[!-~])?$'
      and (r.proposal->>'label') ~ '[A-Za-z0-9]'
      and coalesce(r.proposal->>'kind', '') in ('brand', 'product', 'game', 'technology', 'category')
      and exists (
        select 1 from (
          select part, ord, lead(part) over (order by ord) as next_part, count(*) over () as parts
          from unnest(string_to_array(a.record->>'content', r.proposal->>'label')) with ordinality as f(part, ord)
        ) matches
        where ord < parts
          and (right(part, 1) ~ '[[:space:],;:!?()"/-]' or (part = '' and ord = 1)
            or (right(part, 1) = '.' and left(r.proposal->>'label', 1) !~ '[0-9]'))
          and (left(next_part, 1) ~ '[[:space:],;:!?()"/-]' or (next_part = '' and ord = parts - 1)
            or (left(next_part, 1) = '.' and right(r.proposal->>'label', 1) !~ '[0-9]'))
      ) then 100
    when r.kind = 'recap' and (r.reason like 'The independent AI checker found quote-only support for each retained finding.%'
      or r.reason like 'The independent AI checker found quote-only support for every atomic claim.%')
      and jsonb_typeof(r.proposal->'highlights') = 'array'
      then case when jsonb_array_length(r.proposal->'highlights') between 1 and 6
        and not exists (select 1 from jsonb_array_elements(r.proposal->'highlights') point
          where coalesce(char_length(point->>'evidenceQuote'), 0) < 15
            or strpos(a.record->>'content', point->>'evidenceQuote') = 0) then 100 else 50 end
    when r.proposal = '{}'::jsonb and r.reason ~ '^Automatic generation could not provide a validated draft [(]analysis_(invalid_json|output_capacity)[)]' then 0
    else 50
  end
$$;

create function public.admin_grouped_analysis_reviews(p_page integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with pending as materialized (
    select q.*, coalesce(nullif(q.source_url, ''), q.origin || ':' || q.id::text) as group_key
    from public.admin_analysis_review_queue q where q.status = 'pending'
  ), groups as materialized (
    select group_key, max(created_at) as newest from pending group by group_key
  ), chosen as (
    select group_key, newest from groups order by newest desc, group_key limit 6 offset greatest(0, p_page) * 6
  ), scored as (
    select p.*, c.newest, public.admin_video_review_score(r, a) as quality_score
    from chosen c join pending p using (group_key)
    left join public.admin_analysis_reviews r on p.origin = 'analysis' and r.id = p.id
    left join public.reader_source_updates a on (a.user_id, a.id) = (r.user_id, r.update_id)
  )
  select jsonb_build_object(
    'reviews', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'origin', origin, 'kind', kind, 'status', status, 'proposal',
        case when kind = 'keyword' then jsonb_build_object('label', proposal->>'label') else '{}'::jsonb end,
        'reason', reason, 'updated_at', updated_at, 'created_at', created_at, 'source_title', source_title, 'source_url', source_url,
        'quality_score', quality_score)
      order by newest desc, group_key, quality_score desc nulls last, kind, id) from scored), '[]'::jsonb),
    'total', (select count(*) from pending),
    'groupTotal', (select count(*) from groups), 'page', p_page, 'pageSize', 6
  )
$$;

create function public.admin_apply_video_reviews(p_targets jsonb, p_admin text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  target record;
  decided jsonb;
  results jsonb := '[]'::jsonb;
  score integer;
begin
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 250 then
    raise exception 'Invalid review batch size' using errcode = 'PT400';
  end if;
  -- Consistent source and review order across overlapping batches.
  for target in
    select x.id, x.expected, x.decision, r.user_id, r.update_id
    from jsonb_to_recordset(p_targets) as x(id uuid, expected timestamptz, decision text)
    left join public.admin_analysis_reviews r on r.id = x.id
    order by r.user_id, r.update_id, x.id
  loop
    begin
      select public.admin_video_review_score(r, a) into score
      from public.admin_analysis_reviews r
      join public.reader_source_updates a on (a.user_id, a.id) = (r.user_id, r.update_id)
      where r.id = target.id and r.status = 'pending' and r.updated_at = target.expected;
      if score not in (0, 100) or score is null or (case score when 100 then 'approve' when 0 then 'reject' end) is distinct from target.decision then
        raise exception 'Review changed or requires individual review' using errcode = 'PT409';
      end if;
      decided := public.admin_decide_analysis_review(target.id, target.expected, p_admin, target.decision);
      results := results || jsonb_build_array(jsonb_build_object('id', target.id, 'published', decided->'published'));
    exception when sqlstate 'PT400' or sqlstate 'PT409' then
      results := results || jsonb_build_array(jsonb_build_object('id', target.id, 'error', sqlstate));
    end;
  end loop;
  return results;
end;
$$;

revoke all on function public.admin_video_review_score(public.admin_analysis_reviews, public.reader_source_updates),
  public.admin_grouped_analysis_reviews(integer), public.admin_apply_video_reviews(jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_video_review_score(public.admin_analysis_reviews, public.reader_source_updates),
  public.admin_grouped_analysis_reviews(integer), public.admin_apply_video_reviews(jsonb, text) to service_role;

commit;
