# TechLinked source budget apply · 28 November 2026

The PM approved the one-row envelope update reviewed in [#70](https://github.com/raduvlad92/recap/pull/70), merged as `34b414fca44197e20b81d2eaf8a1e978f6f35b9e`. The scope was the existing TechLinked pilot on recap Supabase project `zlfdqzabsfndifxiqguo`. The approved SQL ran through the existing Supabase SQL connection with only its final `ROLLBACK` changed to `COMMIT`. All evidence reads used `BEGIN READ ONLY` and `ROLLBACK`.

## Apply and independent readback

| UTC time | Evidence |
| --- | --- |
| 02:00:58.793584 | The reviewed read-only preview matched exactly one held envelope. Cap $0.040000, two settled children totaling $0.026500, zero held children. The query required active Cloudflare ownership at epoch 10, release `6a794cbd85a960afcf6153ab78889fd2a4d046e8`, revision `dd9234c3-a880-4d50-8360-a7249851be94`. |
| 02:01:04–02:01:05 | The guarded transaction returned one row with cap **$0.376500** and November provider commitment **$10.005064441061**, then committed. |
| 02:01:20.153722 | A separate read-only transaction confirmed cap **$0.376500**, two settled children and zero held, the same unpaused runtime, and source-proof commitment **$5.868771595978** of $45. November provider commitment remained **$10.005064441061** of $20, including $5.264437250061 in settled spend and $4.740627191 in unresolved commitment. |

The row is `public.collection_budget_reservations.id = a4a5e7de-27fc-4f31-858d-d244aaf54ba1`, account `source-proof`, key `youtube-recurring-20261125-techlinked`. The write added **$0.336500** of commitment and incurred $0 in immediate supplier charges. The resulting November commitment was **$7.994935558939** below the $18 train 2 threshold. The serving database still enforced the $20 shared cap. The envelope update left $0.350000 available at readback.

## Scheduled verification

The 02:00 UTC TechLinked check in `cron:hourly-collection:10:5986104` ended at **02:01:02.153737 UTC** before the apply and recorded `collection_budget_exhausted`, zero items and a blocked job with no provider run. The transport frame completed at 02:01:07.495733 UTC. The 03:00 UTC frame was the first eligible post-apply slot.

Both following frames completed on epoch 10 and serving release `6a794cb`. The production evidence ties the one UTC-day discovery key to the launch, provider fee and first-seen archive row.

| UTC slot | Persisted evidence |
| --- | --- |
| 03:00 | Frame `cron:hourly-collection:10:5986116` completed at 03:01:07.987208. Check `33bbc185-5dd2-4bca-8683-7b2caaab358d` admitted `youtube-discovery:UCeeFfhMcJa1kjtfZAGskOCA:2026-11-28` with a **$0.020000** reservation. The launch claim was recorded at 03:01:01.752425 UTC. The only saved provider run was `TulO6HhWGG7QAvGOb`. The 03:01:31.982031 UTC readback showed that run pending, with no reported fee or archive insert yet. |
| 04:00 | Frame `cron:hourly-collection:10:5986128` completed at 04:01:05.233622. Check `f9963b08-380e-418d-8325-e376e1536ca1` recovered three provider results from the same run. The ledger marked it succeeded with `cost_status=provider_reported`. The reservation, reader provider job and collection ledger all recorded **$0.015900**. The archive recorded **one new nonempty transcript** at 04:01:02.060570 UTC and marked it first seen at 04:01:02.105457 UTC. |

The final read-only transaction at **04:01:43.472346 UTC** found exactly one discovery reservation, one provider run reference and one launch attempt for the day's key across the two frames. The budget refusal cleared. The 04:00 source check remained partial and the transcript's video format was unknown.

The envelope still reads **$0.376500**. Three settled children total **$0.042400**, zero are held, and **$0.334100** remains available. November settled spend rose to **$5.280337250061** as the fee moved out of reserved capacity. November total commitment remains **$10.005064441061** and source-proof commitment remains **$5.868771595978**. Flow 6 verifies natural admission and archive insertion for TechLinked. Flow 9 still needs separate Worker enablement and an accepted briefing cutoff. [Flow 9 plan](https://github.com/raduvlad92/recap/pull/60)

## Revert command

This is the exact guarded revert from the reviewed transaction, with `reverting` set to `true` and the final statement set to `COMMIT`. Run it only after separate PM authorization. It expects the same serving revision and the exact held envelope at $0.376500. **With $0.042400 allocated, the revert would now abort** with `Original cap is below preserved child allocation`. The checked pilot controls can pause new admissions under separate authorization while preserving the receipts.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DO $bridge$
DECLARE
  reverting constant boolean := true;
  target constant uuid := 'a4a5e7de-27fc-4f31-858d-d244aaf54ba1';
  old_cap constant numeric := .040000;
  bridge_cap constant numeric := .376500;
  expected_cap numeric := CASE WHEN reverting THEN bridge_cap ELSE old_cap END;
  next_cap numeric := CASE WHEN reverting THEN old_cap ELSE bridge_cap END;
  account_ceiling numeric;
  month_commitment numeric;
  child_count bigint;
  held_children bigint;
  allocated numeric;
BEGIN
  PERFORM 1 FROM public.hosting_runtime_control
  WHERE singleton AND owner = 'cloudflare' AND old_host_fenced AND NOT paused
    AND epoch = 10 AND release = '6a794cbd85a960afcf6153ab78889fd2a4d046e8'
    AND release_revision = 'dd9234c3-a880-4d50-8360-a7249851be94'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serving control changed';
  END IF;

  SELECT ceiling_usd INTO STRICT account_ceiling
  FROM public.collection_budget_accounts WHERE id = 'source-proof' FOR UPDATE;
  PERFORM public.lock_monthly_provider_budget();

  SELECT count(*), count(*) FILTER (WHERE state = 'held'),
         coalesce(sum(CASE state WHEN 'held' THEN maximum_usd
                                 WHEN 'settled' THEN actual_cost_usd ELSE 0 END), 0)
    INTO child_count, held_children, allocated
  FROM public.collection_budget_reservations WHERE parent_id = target;

  IF reverting THEN
    IF allocated > old_cap THEN
      RAISE EXCEPTION 'Original cap is below preserved child allocation';
    END IF;
  ELSE
    IF child_count <> 2 OR held_children <> 0 OR allocated <> .026500 THEN
      RAISE EXCEPTION 'Pilot allocation changed';
    END IF;
    SELECT committed_usd INTO STRICT month_commitment
    FROM public.monthly_provider_budget_snapshot(clock_timestamp());
    IF month_commitment + bridge_cap - old_cap >= 18
       OR public.collection_budget_committed() + bridge_cap - old_cap > account_ceiling THEN
      RAISE EXCEPTION 'Budget headroom changed';
    END IF;
  END IF;

  UPDATE public.collection_budget_reservations
  SET maximum_usd = next_cap
  WHERE id = target AND account_id = 'source-proof'
    AND request_key = 'youtube-recurring-20261125-techlinked'
    AND kind = 'envelope' AND state = 'held' AND maximum_usd = expected_cap;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected one exact held envelope';
  END IF;
END;
$bridge$;

SELECT id, request_key, state, maximum_usd,
       public.read_monthly_provider_budget()->>'committedUsd' AS monthly_committed_usd
FROM public.collection_budget_reservations
WHERE id = 'a4a5e7de-27fc-4f31-858d-d244aaf54ba1';
COMMIT;
```
