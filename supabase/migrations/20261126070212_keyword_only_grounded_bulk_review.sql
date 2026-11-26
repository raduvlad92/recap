begin;

-- The grouped queue and batch apply share this score. Only an exact,
-- current keyword citation qualifies for batch approval.
create or replace function public.admin_video_review_score(r public.admin_analysis_reviews, a public.reader_source_updates)
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
    when r.proposal = '{}'::jsonb and r.reason ~ '^Automatic generation could not provide a validated draft [(]analysis_(invalid_json|output_capacity)[)]' then 0
    else 50
  end
$$;

commit;
