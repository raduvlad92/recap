-- Align source-derived caption ends with the worker's Number arithmetic.
-- Existing exact numeric endpoints, raw cue starts, grounding, financial and
-- publication guards remain intact. Function-local extra_float_digits keeps
-- shortest-precise float8 serialization independent of the caller's setting.
-- PostgreSQL 17 arithmetic/output reference:
-- https://www.postgresql.org/docs/17/datatype-numeric.html#DATATYPE-FLOAT
-- CREATE OR REPLACE preserves the existing function owner and execute ACLs.

create or replace function public.validate_content_analysis_result(p_task text,p_result jsonb,p_record jsonb,p_content_hash text) returns void
language plpgsql security invoker set search_path='' set extra_float_digits=3 as $$
declare candidate jsonb; point jsonb; quote text; r jsonb; span jsonb; boundary numeric; boundaries numeric[]:='{}';
 cue jsonb; seen text[]:='{}'; k text; coverage_end integer:=0; content_length integer;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>500000
  or p_result->>'state' is null or p_result->>'state' not in ('ready','empty','review')
  or jsonb_typeof(p_result->'patch') is distinct from 'object'
  or jsonb_typeof(p_result->'evidence') is distinct from 'object'
  or jsonb_typeof(p_result->'pending') is distinct from 'array'
  or p_result#>>'{evidence,contentHash}' is distinct from p_content_hash then
  raise exception 'Invalid prepared analysis' using errcode='PT400'; end if;
 -- Engine intervals are UTF16. Compute that length explicitly, including
 -- supplementary code points, instead of confusing bytes/SQL characters.
 select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)::integer into content_length
  from regexp_split_to_table(p_record->>'content','') ch;
 if jsonb_typeof(p_result#>'{evidence,coverage}') is distinct from 'array' then raise exception 'Missing full coverage' using errcode='PT400'; end if;
 for span in select value from jsonb_array_elements(p_result#>'{evidence,coverage}') order by (value->>'start')::integer loop
  if jsonb_typeof(span->'start') is distinct from 'number' or jsonb_typeof(span->'end') is distinct from 'number'
   or (span->>'start')::numeric<>trunc((span->>'start')::numeric) or (span->>'end')::numeric<>trunc((span->>'end')::numeric)
   or (span->>'start')::integer<0 or (span->>'start')::integer>coverage_end
   or (span->>'end')::integer<=(span->>'start')::integer or (span->>'end')::integer>content_length then
   raise exception 'Incomplete source coverage' using errcode='PT400'; end if;
  coverage_end:=greatest(coverage_end,(span->>'end')::integer);
 end loop;
 if coverage_end<>content_length then raise exception 'Incomplete source coverage' using errcode='PT400'; end if;
 for cue in select value from jsonb_array_elements(coalesce(p_record->'transcriptSegments','[]'::jsonb)) loop
  if jsonb_typeof(cue->'startSeconds')='number' then
   boundary:=(cue->>'startSeconds')::numeric; boundaries:=array_append(boundaries,boundary);
   if jsonb_typeof(cue->'durationSeconds')='number' then
    -- Preserve every formerly accepted exact-decimal endpoint. The worker
    -- parses these same source operands as IEEE-754 Numbers; accept its
    -- exact binary64 sum as well, without an epsilon or arbitrary rounding.
    boundaries:=array_append(boundaries,boundary+(cue->>'durationSeconds')::numeric);
    begin
     boundaries:=array_append(boundaries,(((cue->>'startSeconds')::double precision+(cue->>'durationSeconds')::double precision)::text)::numeric);
    exception when numeric_value_out_of_range then
     -- Legacy numeric-only data may exceed binary64 capacity. Its original
     -- numeric endpoint remains valid; do not invent a finite approximation.
     null;
    end;
   end if;
  end if;
 end loop;
 if p_task='summary' then
  if ((p_result->'patch')-array['videoSummary','videoHighlights'])<>'{}'::jsonb
   or p_result#>>'{patch,videoSummary,ruleVersion}' is distinct from 'takeaways-v1'
   or p_result#>>'{patch,videoSummary,status}' is distinct from 'ready'
   or ((p_result#>'{patch,videoSummary}')-array['ruleVersion','status','captionHash','timingBasis'])<>'{}'::jsonb
   or p_result#>>'{patch,videoSummary,captionHash}' is distinct from p_content_hash
   or p_result#>>'{patch,videoSummary,timingBasis}' is null or p_result#>>'{patch,videoSummary,timingBasis}' not in ('captions','none')
   or jsonb_typeof(p_result#>'{patch,videoHighlights}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{patch,videoHighlights}')>6
   or jsonb_typeof(p_result#>'{evidence,selected}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{patch,videoHighlights}')<>jsonb_array_length(p_result#>'{evidence,selected}')
   or jsonb_array_length(p_result->'pending')<>0 or p_result->>'state'='review'
   or ((p_result->>'state'='empty')<>(jsonb_array_length(p_result#>'{patch,videoHighlights}')=0)) then
   raise exception 'Invalid summary fields' using errcode='PT400'; end if;
  for point in select value from jsonb_array_elements(p_result#>'{patch,videoHighlights}') loop
   if jsonb_typeof(point->'text') is distinct from 'string' or length(btrim(point->>'text')) not between 1 and 500
    or array_length(regexp_split_to_array(btrim(point->>'text'),'[[:space:]]+'),1)>38
    or (point-array['text','startSeconds'])<>'{}'::jsonb then raise exception 'Invalid takeaway' using errcode='PT400'; end if;
   select x into candidate from jsonb_array_elements(p_result#>'{evidence,selected}') x where x->>'text'=point->>'text' and x->'startSeconds' is not distinct from point->'startSeconds' limit 1;
   quote:=candidate->>'evidenceQuote';
   if quote is null or length(btrim(quote)) not between 15 and 1000 or strpos(p_record->>'content',quote)=0 then raise exception 'Ungrounded takeaway' using errcode='PT400'; end if;
   if point ? 'startSeconds' and (jsonb_typeof(point->'startSeconds') is distinct from 'number'
    or not ((point->>'startSeconds')::numeric=any(boundaries))
    or not exists(select 1 from jsonb_array_elements(coalesce(p_record->'transcriptSegments','[]'::jsonb)) s
     where s->'startSeconds'=point->'startSeconds')) then raise exception 'Ungrounded takeaway time' using errcode='PT400'; end if;
  end loop;
 elsif p_task='keywords' then
  if ((p_result->'patch')-'keywordRuleVersion')<>'{}'::jsonb or p_result#>>'{patch,keywordRuleVersion}' is distinct from 'entities-v2'
   or p_result#>>'{evidence,ruleVersion}' is distinct from 'entities-v2'
   or jsonb_typeof(p_result#>'{evidence,accepted}') is distinct from 'array'
   or jsonb_array_length(p_result#>'{evidence,accepted}')+jsonb_array_length(p_result->'pending') not between 1 and 500
   or ((p_result->>'state'='review')<>(jsonb_array_length(p_result->'pending')>0)) then raise exception 'Invalid keyword inventory' using errcode='PT400'; end if;
  for candidate in select value from jsonb_array_elements((p_result#>'{evidence,accepted}')||(p_result->'pending')) loop
   quote:=candidate->>'evidenceQuote'; k:=public.content_analysis_keyword_key(candidate->>'label');
   if jsonb_typeof(candidate->'label') is distinct from 'string' or length(btrim(candidate->>'label')) not between 1 and 100 or candidate->>'label' ~ '[[:cntrl:]]'
    or candidate->>'kind' is null or candidate->>'kind' not in ('brand','product','game','technology','category')
    or quote is null or length(btrim(quote)) not between 1 and 1000 or strpos(p_record->>'content',quote)=0
    or jsonb_typeof(candidate->'reason') is distinct from 'string' or length(btrim(candidate->>'reason')) not between 1 and 2000
    or jsonb_typeof(candidate->'confidence') is distinct from 'number' or (candidate->>'confidence')::numeric<>trunc((candidate->>'confidence')::numeric)
    or (candidate->>'confidence')::integer not between 0 and 100
    or jsonb_typeof(candidate->'ranges') is distinct from 'array' or jsonb_array_length(candidate->'ranges')>200
    or k=any(seen) then raise exception 'Invalid keyword candidate' using errcode='PT400'; end if;
   seen:=array_append(seen,k);
   for r in select value from jsonb_array_elements(candidate->'ranges') loop
    if jsonb_typeof(r->'startSeconds') is distinct from 'number' or jsonb_typeof(r->'endSeconds') is distinct from 'number'
     or (r->>'startSeconds')::numeric<0 or (r->>'endSeconds')::numeric<=(r->>'startSeconds')::numeric
     or not ((r->>'startSeconds')::numeric=any(boundaries)) or not ((r->>'endSeconds')::numeric=any(boundaries))
     or (r-array['startSeconds','endSeconds'])<>'{}'::jsonb then raise exception 'Ungrounded keyword time' using errcode='PT400'; end if;
   end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_result#>'{evidence,accepted}') x where (x->>'confidence')::integer<50) then raise exception 'Low-confidence publication' using errcode='PT400'; end if;
 else raise exception 'Unknown analysis task' using errcode='PT400'; end if;
end;
$$;
