# Cloudflare release coordination

Current checkpoint: 4 November 2026. This prepares ordinary releases after a separately verified migration. Initial switch, live promotion/CI adapters, rollback execution and retirement are unfinished. The running deployment remains an isolated copy.

`npm run plan:cloudflare` is a read-only command. It checks built Worker/configuration/assets hashes, queries the exact existing Supabase hosting status and Cloudflare components, and produces a plan with explicit blockers. Its environment uses the existing `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and private `SUPABASE_SECRET_KEY`. It accepts no activation/apply argument and prints no credential or private reader identity. [Actual read-only plan](evidence/cloudflare-release-readiness-2026-11-04.json).

The coordinator in `scripts/cloudflare-release-state.mjs` is exercised through explicit test ports. Its platform adapter and durable checkpoint storage are not connected to production. An eventual adapter must validate the exact checked main commit, current Worker versions/policies and source proof before any pause. A checksum detects changed plan/checkpoint data; it is not authorization or a signed approval.

The normal-release sequence is:

1. Verify Cloudflare already owns execution, the old host is durably fenced, both Workers match the current release, the target is an active artifact, execution policies agree, reminders stay off and the source artifact proof matches.
2. Persist the checkpoint before each mutation. Atomically pause only if no queued hosting work remains. A new service-only RPC locks the same control row as admission, so a concurrent admitted job is seen before pausing.
3. Wait for running work to finish. Expired leases and uncertain outcomes are retained; they are never cleared to force a release.
4. Upload checked web/jobs versions, advance the paused release/epoch, promote those exact versions, then verify real routing, assets, component identities and policy/source proof.
5. Resume only if the host was running before the release. An operator-paused host stays paused. Completed retries also recheck the live readback.

Interrupted transfer/resume replies are reconciled by reading the actual control. The coordinator does not replay a business job. Promotion/readback failures leave admission paused. Test coverage includes stale checked heads, changed plans, queued admission races, running/expired work, dropped acknowledgements and failed readback. These are isolated rehearsals, not a live switch.

The database addition defines only `read_hosting_release_status`, `quiesce_hosting_release` and a queued-work index. Both RPCs have empty search paths and service-only execution. The pause rejects repeatable-read snapshots, stale identity, missing fencing and queued work; its row lock has a two-second deadline. No transaction waits for external APIs. [Actual rollback/apply and preservation](evidence/cloudflare-release-guard-migration-2026-11-04.json), [anonymous API denial](evidence/cloudflare-release-api-2026-11-04.json).

The authenticated security advisor reports 47 informational [RLS-enabled/no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), with no finding attached to the new objects. This is recorded separately from the explicit function/table/API permission checks; no unrelated policy is changed.

`cloudflare/verified-source.json` pins the measured Worker/container inputs, exact live private Worker version and exact hosted-tested image. Routine shadow deployments reuse that verified component when it is unchanged, private, disabled, credential-free and limited to one instance. Unexpected live drift fails closed. Changed source inputs can produce only a disabled replacement and require new hosted proof before activation. This avoids rebuilding and changing a tested image merely because the website changed.

The current image is `bc1713f4ad97fe53e861777e27cdcc7b43d3ebe60d44d33a8d585b7450718352`. It passed ten new actual hosted checks after the earlier image/digest attribution was corrected. The gateway was disabled again, the temporary probe removed and the actual instance observed inactive. [Exact-image proof](evidence/cloudflare-source-exact-image-2026-11-04.json).

Remaining implementation is the serialized CI/platform/durable-receipt adapter, initial handover/rollback coordinator, full private-app/ordinary-user parity, independently proved old-host fence, bounded acceptance and site-only retirement. Main still deploys the inert copy; no production target is selected by this checkpoint.
