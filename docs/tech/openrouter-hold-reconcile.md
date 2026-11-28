# OpenRouter held-charge reconciliation

**26 November 2026 · flow 9 · read-only proposal**

Keep all 46 holds, totaling **USD 4.025827191** (USD 4.03 rounded). Two have unique provisional matches. The provider confirms zero cost for those generations, but their link to the held requests remains unverified. The dry run proposes zero settlements and zero releases.

## Results

| Classification | Holds | Held USD |
| --- | ---: | ---: |
| Matched provisionally by time, model and cost | 2 | 0.200000000 |
| Unmatched | 44 | 3.825827191 |
| Cost mismatch | 0 | 0.000000000 |
| **Total** | **46** | **4.025827191** |

The 44 unmatched holds comprise 19 without activity in the ±2 s window, 15 whose eligible generations are already linked to other ledger entries, seven older than the November export, two that share one unassigned candidate, and one with activity from a different model or route. All 46 have a null actual and observed cost. The held maximum checks whether a candidate charge fits the reservation. Cost agreement between the export and the provider lookup confirms the generation's charge.

## Evidence

- The private [OpenRouter Activity](https://openrouter.ai/blog/announcements/activity-dashboard/) export contains 4,780 unique generations with activity on 1–25 November. The database snapshot at 03:32 UTC on 26 November contained 41 unknown and five reserved calls. None had a saved generation ID or generation receipt.
- Thirty-four settled calls served as controls. Exact generation IDs matched the export, all 34 costs agreed, and all 34 timestamps fit ±2 s when read as UTC. Reading the same timestamps as Berlin time yielded zero matches. The controls also established the app-model to provider-permaslug mapping and the provider/API-key groupings used for the fallback.
- The time windows contained 172 distinct generation IDs. Current and prior ledger references account for 169 of them. The remaining three form four candidate links across four holds. Two links are unique in both directions and one generation has two possible holds.
- Three authenticated, read-only [generation lookups](https://openrouter.ai/docs/api/api-reference/generations/get-generation) returned HTTP 200. All agreed with the export on the generation, model, provider and USD 0 charge. Each was non-BYOK. The lookup verifies the provider's side of each candidate link. The ledger has no exact request-to-generation binding for any of them.
- The row-level receipt and input snapshots are restricted local files. The public branch contains aggregate evidence only.

## Dry run

The update set is empty. The transaction below ran on production in read-only mode and rolled back. The 46-row fingerprint matched across the input and dry-run reads.

```text
read_only                        on
holds_before                     46
holds_after                      46
proposed_updates                 0
openrouter_held_usd_before       4.025827191000
openrouter_held_usd_after        4.025827191000
monthly_commitment_usd           9.668564441061
monthly_unresolved_usd           4.420027191000
held_row_fingerprint             matched
provider_spend_usd               0
```

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH held AS (
  SELECT id, state, greatest(maximum_usd, coalesce(observed_usd, 0)) AS usd,
         encode(sha256(convert_to(to_jsonb(c)::text, 'UTF8')), 'hex') AS row_sha256
  FROM public.reader_content_analysis_calls c
  WHERE actual_usd IS NULL
), proposed AS (
  -- No independently bound generation qualified for an update.
  SELECT NULL::uuid AS id, NULL::numeric AS actual_usd WHERE false
), monthly AS (
  SELECT * FROM public.monthly_provider_budget_snapshot(transaction_timestamp())
)
SELECT current_setting('transaction_read_only') AS read_only,
       (SELECT count(*) FROM held) AS holds_before,
       (SELECT count(*) FROM held WHERE NOT EXISTS
          (SELECT 1 FROM proposed WHERE proposed.id = held.id)) AS holds_after,
       (SELECT count(*) FROM proposed) AS proposed_updates,
       (SELECT sum(usd) FROM held)::text AS openrouter_held_usd_before,
       (SELECT sum(usd) FROM held WHERE NOT EXISTS
          (SELECT 1 FROM proposed WHERE proposed.id = held.id))::text AS openrouter_held_usd_after,
       committed_usd::text AS monthly_commitment_usd,
       unresolved_usd::text AS monthly_unresolved_usd,
       (SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(id,row_sha256) ORDER BY id)::text,
          'UTF8')), 'hex') FROM held) AS hold_set_sha256
FROM monthly;

ROLLBACK;
```

For any future settlement, the existing [receipt guard](../../supabase/migrations/20261024202950_content_analysis_known_rejection_recovery.sql) requires an authenticated provider receipt and, for a missing generation ID, independently reviewed request-to-generation evidence. The provider returns versioned model slugs while the guard checks the exact ledger model string. Both the request binding and the model mapping need verification before submitting a receipt. Preserve the original reservation and use the ledger-only path with retry disabled. Missing activity and the shared candidate leave their holds open.
