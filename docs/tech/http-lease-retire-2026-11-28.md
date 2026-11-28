# Retire four expired HTTP leases · 28 November 2026

The PM approved one state-only compare-and-swap transaction on production. The release remained `6a794cbd85a960afcf6153ab78889fd2a4d046e8`, Cloudflare owner, active and unpaused at epoch 10. The exact control revision was `dd9234c3-a880-4d50-8360-a7249851be94`. The separate empty unleased HTTP frame remains for #46.

## Release and replay gates

- Ordinary checked releases require zero queued, running and expired-running work at the drain gate. `uncertain` is a retained count. #42 and the frozen #46 carry the same SQL for unleased HTTP and retain this ordinary drain contract. [Serving drain gate](https://github.com/raduvlad92/recap/blob/6a794cbd85a960afcf6153ab78889fd2a4d046e8/scripts/cloudflare-release-state.mjs#L89-L92) · [#42](https://github.com/raduvlad92/recap/pull/42) · [#46](https://github.com/raduvlad92/recap/pull/46)
- Admission reuses queued identities only. Claims require `queued` and finishes require `running`. The web Worker creates a fresh HTTP key per request. Cron and queue workers use their own job kinds. The transport disposition reconciler accepts only automatic-content cron frames. Retired HTTP records remain transport evidence, with domain audits and financial ledgers as the sources of their own receipts. [Serving claim and finish SQL](https://github.com/raduvlad92/recap/blob/6a794cbd85a960afcf6153ab78889fd2a4d046e8/supabase/migrations/20261125030000_hourly_hosting_lease_recovery.sql) · [Cron and queue code](https://github.com/raduvlad92/recap/blob/6a794cbd85a960afcf6153ab78889fd2a4d046e8/cloudflare/jobs.ts)

## Production readback

The exact guarded SELECT matched four expired leased HTTP frames at **00:01:41.255939 UTC** in a read-only transaction. The approved UPDATE ran once and committed after its exact-four assertion. At **00:01:54.777473 UTC**, a second read-only transaction found the four exact keys in `uncertain` and zero expired running HTTP frames. Health returned HTTP 200 for the exact active release.

| Frame state | Before | After | Change |
| --- | ---: | ---: | ---: |
| Queued | 1 | 1 | 0 |
| Running | 4 | 0 | −4 |
| Completed | 10,262 | 10,262 | 0 |
| Uncertain | 233 | 237 | +4 |

The before and after SHA-256 digests of each whole row excluding `state` matched. This includes the original lease token, expiry, creation/update timestamps and payload.

| Frame key | Lease expiry UTC | Matching receipt digest |
| --- | --- | --- |
| `http:fb1c18e4-4b1f-48aa-a336-9842797dc206` | `2026-11-25T20:57:20.294337+00:00` | `b00e03e44be351a94428925c2e8fd6ef667ca4878d20e2e1e9b450b3859cff45` |
| `http:b67acafb-8f5b-4512-9fd3-3858373e02e5` | `2026-11-25T23:46:28.416680+00:00` | `a8c65612f35fab0d38ca56783e41a7610a40b6cd7a720b7cf585a5a351beeab5` |
| `http:16466232-79d9-46bf-939f-0487093962cc` | `2026-11-26T01:46:27.090225+00:00` | `dfe2d72be7e529b84ce9ea6b763e41372fc9c212702e547805b09895b7af7a48` |
| `http:d4183e09-5b98-43e3-a9cb-c6e9f5b0de8f` | `2026-11-26T01:46:52.102170+00:00` | `c854efd94f17a999c30cf6535b790870bddc45eefc4f2bfa311c58aaf1649306` |

The queued unleased frame's full-row SHA-256 matched on both reads. Neither the lease operation nor the health probe started collection or provider work.

## Next ordinary hourly tick

The first slot after the commit is **01:00 UTC** on 28 November. Its readback is pending. Wait for the persisted cron frame and scoped collection receipt.

## Revert SQL

This revert requires separate PM authorization. It returns the four exact frames to their recorded expired `running` state and restores the drain blocker. The transaction locks and compares the same control row and aborts unless all four keys and lease receipts still match. The holder comparison uses SHA-256 fingerprints of the existing lease tokens.

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '12s';

DO $retire_http$
DECLARE
  changed integer;
BEGIN
  PERFORM 1
  FROM public.hosting_runtime_control c
  WHERE c.singleton
    AND c.owner = 'cloudflare'
    AND c.old_host_fenced
    AND NOT c.paused
    AND c.epoch = 10
    AND c.release = '6a794cbd85a960afcf6153ab78889fd2a4d046e8'
    AND c.release_revision = 'dd9234c3-a880-4d50-8360-a7249851be94'::uuid
    AND c.updated_at = '2026-11-25T13:01:34.901866+00:00'::timestamptz
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hosting control changed';
  END IF;

  UPDATE public.hosting_work w
  SET state = 'running'
  FROM (VALUES
    ('http:fb1c18e4-4b1f-48aa-a336-9842797dc206',
     '2026-11-25T20:42:20.110643+00:00', '2026-11-25T20:42:20.294337+00:00',
     '2026-11-25T20:57:20.294337+00:00',
     'a03532aa62e6ab4ed12a4041111b87a7c2ad3034567983df8d76980d0491f264'),
    ('http:b67acafb-8f5b-4512-9fd3-3858373e02e5',
     '2026-11-25T23:31:28.273091+00:00', '2026-11-25T23:31:28.416680+00:00',
     '2026-11-25T23:46:28.416680+00:00',
     '9557f06b9dfe617dcbe3e107c0ae566faa5f5bd23e28a31f9d24f3ddfc230935'),
    ('http:16466232-79d9-46bf-939f-0487093962cc',
     '2026-11-26T01:31:27.030491+00:00', '2026-11-26T01:31:27.090225+00:00',
     '2026-11-26T01:46:27.090225+00:00',
     'bb984782647e24ac3e5abe70e98efdcd3b5c8e9cc2bad1690d24415b98579ac3'),
    ('http:d4183e09-5b98-43e3-a9cb-c6e9f5b0de8f',
     '2026-11-26T01:31:52.045560+00:00', '2026-11-26T01:31:52.102170+00:00',
     '2026-11-26T01:46:52.102170+00:00',
     'c6626539c82f2cd4b7cfe90622ffc35e4a4e577e2d0f8cd6afa2beba23f51ea7')
  ) AS e(key, created_at, updated_at, lease_until, holder_sha256)
  WHERE w.key = e.key
    AND w.kind = 'http'
    AND w.state = 'uncertain'
    AND w.epoch = 10
    AND w.release = '6a794cbd85a960afcf6153ab78889fd2a4d046e8'
    AND w.payload IS NULL
    AND w.lease_token IS NOT NULL
    AND w.created_at = e.created_at::timestamptz
    AND w.updated_at = e.updated_at::timestamptz
    AND w.lease_until = e.lease_until::timestamptz
    AND w.lease_until <= transaction_timestamp()
    AND encode(sha256(convert_to(w.lease_token::text, 'UTF8')), 'hex') = e.holder_sha256;

  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 4 THEN
    RAISE EXCEPTION 'Expected 4 expired HTTP leases, matched %', changed;
  END IF;
END;
$retire_http$;

COMMIT;
```
