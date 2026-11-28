# TechLinked source budget · 28 November 2026

**Decision for the PM.** Approve one guarded update to the existing TechLinked envelope from **$0.040000 to $0.376500**. This buys a 14-UTC-day bridge at the current one-source cadence, starting 28 November, and adds **$0.336500** to shared budget commitment immediately. Use the coordinated [train 2 restoration](https://github.com/raduvlad92/recap/pull/46) for the next window if approved. The existing Worker supports this budget change without a release or new code. Flow 9 has a separate enablement step in the [switch-on plan](https://github.com/raduvlad92/recap/pull/60).

## What stopped

Production Supabase project `zlfdqzabsfndifxiqguo` was queried through the recap MCP connection using `BEGIN READ ONLY` and `ROLLBACK`. The serving control was active and unpaused at epoch 10 on `6a794cbd85a960afcf6153ab78889fd2a4d046e8`.

| Gate | Scope and result |
| --- | --- |
| **Exhausted pilot envelope** | `public.collection_budget_reservations`, account `source-proof`, request key `youtube-recurring-20261125-techlinked`, ID `a4a5e7de-27fc-4f31-858d-d244aaf54ba1`. Held since 25 November at 01:26:44 UTC. The current provider-only TechLinked pilot sends this parent via `HOURLY_COLLECTION_BUDGET_PARENT_ID`. Its $0.040000 cap minus two settled children ($0.026500) and zero held children leaves **$0.013500**. A new discovery reservation costs $0.020000 in headroom, so it falls short by $0.006500. |
| Reader | One enabled reader/provider policy, $0.10 UTC day and $1.00 stored lifetime limit. The UTC-day gate counted $0.075000 of unresolved reader jobs, leaving $0.025000 for a $0.020000 discovery reservation. Its UTC-day boundary rolls at 00:00 UTC and unresolved jobs carry forward. Total reader commitment was $0.646700. The serving hourly admission RPC checks the daily limit. Its body contains no lifetime check, so the bridge calculation separately honors the stored $1.00 limit. |
| Source account | `public.collection_budget_accounts`, `source-proof`. $5.532271595978 committed against the non-recurring $45 ceiling. |
| Shared provider month | $9.668564441061 committed against the live $20 ceiling. [PR #61](https://github.com/raduvlad92/recap/pull/61) introduces the tighter $18 admission stop. The installed `public.require_monthly_provider_capacity` uses the snapshot's $20 limit, and migration `20261126034741` was absent from the live journal. |

The pilot envelope has **no automatic reset or expiry**. Admission counts settled child fees plus the maximum of each held child for the life of the parent. Settlement of the second child on 27 November at 01:01:02.729 UTC left the $0.013500 balance. The existing 27 November discovery identity suppressed another launch that day. The first refused new discovery was 28 November at 00:00 UTC. The **two matured slots** at **00:00 and 01:00 UTC** both completed their scheduler frames and had failed TechLinked checks, zero new/retrieved items, and a blocked job with no provider run reference. The frame keys were `cron:hourly-collection:10:5986080` and `cron:hourly-collection:10:5986092`. The 22:00 and 23:00 slots on 27 November were partial, with no new items and no budget refusal. Earlier November refusals involved other budget state. The **1 December 00:00 UTC** shared reset removes November settled charges from the current-month spend calculation and carries unresolved commitments. It leaves the pilot exhausted.

The latest successful archive insert was **27 November at 01:01:03.916 UTC**, check `cd7624c3-9fa4-4858-b680-60771f2fc372`. It saved one nonempty transcript from run `uChcrA1K3QMG0vL9J`. The check was partial and the video format was unknown. The latest check explicitly marked `collected` was the 25 November proof at 01:24:29.596 UTC with two retrieved items. [Serving reservation and once-per-day discovery](https://github.com/raduvlad92/recap/blob/6a794cbd85a960afcf6153ab78889fd2a4d046e8/netlify/functions/_shared/hourly-collection.ts) · [Serving budget SQL](../../supabase/migrations/20261125103322_monthly_provider_budget.sql)

## November ledger reconciliation

These are project ledger amounts since 1 November UTC. Both pilot runs match on reservation, reader provider job, and `collection_jobs` record with `cost_status=provider_reported`. No pilot child has a correction row in `collection_provider_fee_receipts`. The three November correction rows apply elsewhere. Each added $0.004000 to its original charge, already included in the Apify ledger total. The pilot parent contributes unused capacity separately.

| Pilot launch (UTC) | Apify run | Reserved | Settled and provider-reported |
| --- | --- | ---: | ---: |
| 26 Nov 00:01:01.377 | `Q7OberqsgZaSpAscx` | $0.020000 | $0.010600 |
| 27 Nov 00:01:01.733 | `uChcrA1K3QMG0vL9J` | $0.020000 | $0.015900 |
| **Total** | | | **$0.026500** |

| Budget component | November spend | Commitment including unresolved |
| --- | ---: | ---: |
| Apify reservation records (2,734 settled November charges, including both pilot runs) | $3.331632458061 | $3.686632458061 |
| Apify unused capacity across the held pilot/proof envelopes ($0.013500 on this pilot) | $0 | $0.023300000000 |
| OpenRouter call records (1,238 November rows with final amounts) | $1.932804792000 | $5.958631983000 |
| **Combined** | **$5.264437250061** | **$9.668564441061** |

No legacy-only Apify ledger row qualified for a separate monthly charge or hold in the snapshot. Combined unresolved commitment was **$4.404127191000**. This is the production admission ledger reconciled to saved provider fee evidence. External invoices and unknown amounts were outside this readback.

## Cost and scope of the bridge

- Hourly checks continue to run every hour. The paid discovery key is channel plus UTC date, so the pilot admits at most one discovery per day for its one enabled reader. At the observed $0.075 carried reader commitment there is also room for $0.005/day of caption or metadata fallback. The parent allowance of **$0.350000 available** covers **14 × $0.025000** through 11 December inclusive at that rate. That gives at most **$0.996700** total reader commitment from the measured baseline, assuming the pilot is the only added use of that reader allowance.
- The two recorded discovery fees average $0.01325. That projects **$0.18550** in new discovery fees over the bridge, split $0.03975 in November and $0.14575 in December. The conservative bridge spend bound is $0.075 for the three remaining November days and $0.275 for the first 11 December days at the planned cadence. A full 31-day month at the same operating pace projects **$0.41075** for discovery plus up to $0.155 for fallback. At reservation maxima the 31-day bound is **$0.775**. The two-run mean is a planning estimate. Provider overages, unresolved holds, and outside pilot activity can alter admissions and costs.
- Direct briefing composition is **$0** in Apify/OpenRouter charges. At this readback the database control and one 08:00 Europe/Berlin reader schedule were enabled, with zero daily-briefing frames since the 25 November restoration. The last saved cutoff was **13 November 07:00 UTC**, and all 13 saved briefings were awaiting review. The last checked Worker policy in #60 had `DAILY_BRIEFING_ENABLED=false`. Checked enablement of that Worker flag with its five-minute trigger and approved findings is separate. A natural cutoff with usable cited output remains the Flow 9 acceptance gate.
- The one proposed write projects November commitment of **$10.005064441061**, leaving **$7.994935558939** to the $18 stop. Using today's unresolved balance as the December opening projection, carrying the entire extra $0.336500, and adding the switch-on plan's hypothetical model stress of $0.224/day for 31 days gives **$11.684627191** committed. If the separately gated $2.50 train 2 allowance and $0.75 proof are also reserved in December, the projected commitment is **$14.934627191**. This assumes the current and future envelopes can both be held and counts each funded child once. Recheck the actual monthly snapshot before applying the bridge or enabling any other paid work. The SQL enforces $18 for this write. Shared runtime enforcement of $18 depends on #61.

The bridge is sized for the current source and cadence. It expires by consumption. If paid discovery every hour is required, the once-per-day key and reviewed transport would need a separate product change and cost review.

## Dry run and exact one-row update

The following dry run returned **one row** in live recap at **01:35:19.502234 UTC**, with `read_only=on`. It showed cap $0.040000 → $0.376500, available $0.013500 → $0.350000, two settled children, zero held children, month commitment $9.668564441061 → $10.005064441061, and source-account commitment after of $5.868771595978. Re-run it immediately before seeking approval to apply. A changed row count or release/pilot configuration calls for fresh review.

```sql
BEGIN READ ONLY;
WITH candidate AS (
  SELECT r.id, r.request_key, r.maximum_usd AS old_cap, .376500::numeric AS new_cap,
         count(c.id) AS child_count,
         count(c.id) FILTER (WHERE c.state = 'held') AS held_children,
         coalesce(sum(CASE c.state WHEN 'held' THEN c.maximum_usd
                                  WHEN 'settled' THEN c.actual_cost_usd ELSE 0 END), 0) AS allocated
  FROM public.collection_budget_reservations r
  LEFT JOIN public.collection_budget_reservations c ON c.parent_id = r.id
  WHERE r.id = 'a4a5e7de-27fc-4f31-858d-d244aaf54ba1'
    AND r.account_id = 'source-proof'
    AND r.request_key = 'youtube-recurring-20261125-techlinked'
    AND r.kind = 'envelope' AND r.state = 'held' AND r.maximum_usd = .040000
  GROUP BY r.id
)
SELECT current_setting('transaction_read_only') AS read_only, now() AS observed_at,
       c.*, c.old_cap - c.allocated AS old_available, c.new_cap - c.allocated AS new_available,
       m.committed_usd AS monthly_before, m.committed_usd + c.new_cap - c.old_cap AS monthly_after,
       public.collection_budget_committed() + c.new_cap - c.old_cap AS source_proof_after
FROM candidate c CROSS JOIN public.monthly_provider_budget_snapshot(now()) m
WHERE c.child_count = 2 AND c.held_children = 0 AND c.allocated = .026500
  AND m.committed_usd + c.new_cap - c.old_cap < 18
  AND public.collection_budget_committed() + c.new_cap - c.old_cap <=
      (SELECT ceiling_usd FROM public.collection_budget_accounts WHERE id = 'source-proof')
  AND EXISTS (
    SELECT 1 FROM public.hosting_runtime_control
    WHERE singleton AND owner = 'cloudflare' AND old_host_fenced AND NOT paused
      AND epoch = 10 AND release = '6a794cbd85a960afcf6153ab78889fd2a4d046e8'
      AND release_revision = 'dd9234c3-a880-4d50-8360-a7249851be94'
  );
ROLLBACK;
```

Run the following as the privileged SQL operator. The transaction acquires the source-account row lock and the shared monthly advisory lock in the same order as collection admissions. The exact release check fences a concurrent cutover. The live reservation trigger does not perform admission on a `maximum_usd`-only update, so the block enforces both ceilings itself. It returns the updated row for inspection and defaults to rollback. **For an approved apply, replace only the final `ROLLBACK` with `COMMIT`.** Leave `reverting` false.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DO $bridge$
DECLARE
  reverting constant boolean := false;
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
ROLLBACK;
```

**Revert.** Use the same block with `reverting constant boolean := true` and `COMMIT` after separate approval. It compares $0.376500 and restores $0.040000 only while total child allocation fits under $0.040000. If it aborts because more was spent or held, retain the ledger and use the checked pilot controls to stop admission if needed. The next ordinary hourly frame after an approved apply should have one admission for that UTC day and no duplicate run, or give a specific independent refusal reason. Observe persisted evidence through read-only SQL.

The SQL was also run on disposable PostgreSQL 17 with the serving monthly-budget migration and synthetic child records. The update returned one row, rollback restored the exact starting cap, and the existing children retained their digest. Local checks exercised admission before and after, rejection at the $18 guard, rejection of a second apply, successful revert before new allocation, and rejection of revert once the child commitments exceeded the old cap. Live readbacks used SELECT only. This task incurred $0 in provider fees.
