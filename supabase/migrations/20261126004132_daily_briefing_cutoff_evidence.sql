-- Preserve saved history and existing publication controls.
begin;
do $$
declare
  signature text;
  definition text;
  old_clause text;
  new_clause text;
  changes text[][] := array[
    array[
      'public.daily_briefing_input(text,timestamptz,timestamptz,date)',
      'q.published_at<p_cutoff_at',
      'q.published_at<p_cutoff_at and q.collected_at<=p_cutoff_at'
    ],
    array[
      'public.daily_briefing_input(text,timestamptz,timestamptz,date)',
      'or q.updated_at>=least(p_period_start,s.last_cutoff_at)',
      'or q.collected_at>=least(p_period_start,s.last_cutoff_at) or q.updated_at>=least(p_period_start,s.last_cutoff_at)'
    ],
    array[
      'public.daily_briefing_input(text,timestamptz,timestamptz,date)',
      'published:=usable and',
      'published:=usable and a.updated_at<=p_cutoff_at and'
    ],
    array[
      'public.finish_daily_briefing(uuid,uuid,text,jsonb,jsonb)',
      'or strpos(a.record->>''content'',citation->>''evidenceQuote'')=0',
      $clause$or strpos(a.record->>'content',citation->>'evidenceQuote')=0
       or a.record#>>'{videoSummary,status}' is distinct from 'ready'
       or a.record#>>'{videoSummary,captionHash}' is distinct from h
       or not coalesce(
         (a.record#>>'{keywordApprovals,contentHash}'=h and jsonb_array_length(coalesce(a.record#>'{keywordApprovals,labels}','[]'))>0)
         or (coalesce(a.record->>'keywordContentHash',a.record#>>'{videoSummary,captionHash}')=h and jsonb_array_length(coalesce(a.record->'videoKeywords','[]'))>0),
         false)
       or not exists(select 1 from jsonb_array_elements(coalesce(a.record->'videoHighlights','[]'))v where btrim(v->>'text')=finding->>'text')$clause$
    ],
    array[
      'public.finish_daily_briefing(uuid,uuid,text,jsonb,jsonb)',
      ' insert into public.daily_briefings(',
      $clause$ if p_status='quiet' and (
      jsonb_array_length(j.input->'sources')=0
      or jsonb_array_length(j.input->'updates')>0
      or (j.input->>'omittedUpdates')::integer>0
      or (j.input->>'missedCycles')::integer>0
      or exists(select 1 from jsonb_array_elements(j.input->'sources')src where src->>'state' is distinct from 'checked')
    ) then raise exception 'Quiet briefing requires complete empty coverage' using errcode='PT409'; end if;
    insert into public.daily_briefings($clause$
    ],
    array[
      'public.fail_daily_briefing(uuid,uuid,text)',
      $clause$(u-array['topics','findings'])||jsonb_build_object('state',case when u->>'state'='content_missing'then'content_missing'else'awaiting_review'end)$clause$,
      $clause$(u-array['topics','findings'])$clause$
    ],
    array[
      'public.fail_daily_briefing(uuid,uuid,text)',
      $clause$'pendingReviewUpdates',jsonb_array_length(inventory)-missing$clause$,
      $clause$'pendingReviewUpdates',(select count(*) from jsonb_array_elements(inventory)u where u->>'state'='awaiting_review')$clause$
    ],
    array[
      'public.fail_daily_briefing(uuid,uuid,text)',
      $clause$'allUpdates',inventory,'notice',$clause$,
      $clause$'allUpdates',inventory,'failureCode',p_error_code,'notice',$clause$
    ]
  ];
  change text[];
begin
  foreach change slice 1 in array changes loop
    signature := change[1];
    old_clause := change[2];
    new_clause := change[3];
    definition := pg_get_functiondef(signature::regprocedure);
    if length(definition)-length(replace(definition,old_clause,''))<>length(old_clause) then
      raise exception 'Unexpected daily briefing function definition: %', signature;
    end if;
    execute replace(definition,old_clause,new_clause);
  end loop;
end;
$$;
commit;
