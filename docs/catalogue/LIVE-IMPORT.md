# D21 live catalogue import

Recorded **21 October 2026**. The reviewed metadata was actually imported into the existing **recap** Supabase project. This is database/import evidence; hosted deployment and browser evidence are tracked separately in [STATUS.md](../../STATUS.md) and the [demo log](../DEMO-LOG.md).

## Exact target

| Resource | Target |
| --- | --- |
| Supabase organization | recap |
| Supabase project | recap |
| Project reference | `zlfdqzabsfndifxiqguo` |
| Region | London / `eu-west-2` |
| Backend | Existing selected project; no replacement project or new supplier account |

The scoped migration is [20261021021732_admin_catalogue_operations.sql](../../supabase/migrations/20261021021732_admin_catalogue_operations.sql). It separates public creator/channel research from private collection plans, job records, job consumers and audit records. Public catalogue reads are subject to listing visibility; ordinary readers cannot edit catalogue records or forge usage/costs.

## Imported result

| Item | Verified count/state |
| --- | ---: |
| Canonical creator records | **560** |
| Public platform channels | **600** |
| YouTube | **120** |
| Instagram | **120** |
| X | **120** |
| Substack | **120** |
| LinkedIn | **120** |
| Canonical creators with multiple evidenced channels | **33** |
| Collection plans | **7** |
| Enabled catalogue collection plans | **0** |
| Source collection/provider runs started by this task | **0** |

Seed: [catalogue.json](../../data/catalogue/catalogue.json). SHA-256 of that exact file:

```text
121df103c3f4a5cf51550d259d81bc82b681f25ee834ee74f5b777d42e3724d8
```

The [import manifest](IMPORT-REPORT.md) records source hashes, identity rules and the unresolved Ottolenghi pair. [Identity overrides](../../data/catalogue/identity-overrides.json) save twelve additional primary cross-link bridges; their evidence is also retained on the affected channels. No presenter memberships or studio affiliations were inferred.

## Verification completed at this checkpoint

- **137 local tests passed**. TypeScript, build and deployment checks are recorded separately in the delivery workflow.
- **26 actual Supabase REST/RPC checks passed** using real Clerk-issued synthetic development-account tokens. The [sanitized result](../admin/live-db-checks.json) includes exact counts, denied anonymous/private access, denied ordinary-reader mutations, stale-edit protection and ownership checks.
- SQL invariants and Supabase security advisors reported no issues. [Invariant queries](../admin/live-db-invariants.sql) are saved.
- A disposable unlisted creator and a synthetic **blocked** ledger record exercised database protections without contacting any creator source or supplier. Both were removed; the final catalogue returned to 560 creators and no collection job remained from that test.
- Owner authorization is checked on the server against a private allowlist and verified primary email. Anonymous admin requests receive 401; ordinary signed-in accounts receive 403. No private email, reader ID, session token or secret is recorded here.

The offline build is reproducible with `node scripts/build-catalogue.mjs --check`. It does not import into Supabase or start collection. Future imports must review the change against live admin edits rather than blindly overwrite them.

## What this proves—and what remains open

The actual database contains the researched catalogue and disabled plans, with the tested access controls above. The public creator pages use these records and expose original channel links, descriptions and research evidence; source collection stays labeled planned.

This does **not** prove full-content coverage, active Apify/Bright Data scraping, generated transcripts, AI synthesis, daily delivery, payments, production authentication or SEO rankings. The current Clerk instance is for development. No paid supplier job or new supplier subscription was started; ordinary hosting/database usage is not measured here as a complete operating-cost total.
