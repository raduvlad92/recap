# Cloudflare release coordination

Current checkpoint: 4 November 2026. Ordinary release adapters and serialized CI are implemented. A native **disabled review-copy** rehearsal passes on `ca43f97`; the initial ownership switch, rollback execution, full private-app parity, durable old-host fence and retirement remain unfinished. The running website is still an isolated copy.

`npm run plan:cloudflare` is read-only. It checks built Worker/configuration/assets hashes and reads the exact existing Supabase hosting status and Cloudflare components. It accepts no activation argument and prints no credentials or private reader identity. The [actual current plan](evidence/cloudflare-release-adapter-readiness-2026-11-04.json) correctly blocks active-artifact, Cloudflare-ownership, old-host-fence and active-Worker gates.

## Checked delivery

`.github/workflows/cloudflare-duplicate.yml` verifies the application, PostgreSQL contracts and workerd behavior. Main builds choose the public application configuration only after `HOSTING_TARGET=cloudflare`; otherwise the ordinary browser shell remains disconnected from production authentication/database credentials. Active builds require the existing Clerk publishable key, exact Supabase project URL and public database key to match committed hashes. A server key cannot be substituted. The two public Supabase GitHub variables are configured and read back; no active production target or CI database credential has been provisioned by this checkpoint.

The verification job uploads an explicit artifact whitelist. The main deploy job downloads that same run's artifact and does not rebuild it. Cloudflare deployments share the `therecap-hosting-production` concurrency group with cancellation disabled. The main entrypoint independently checks the current main SHA, workflow/run/repository and completed `verify` job. Its token has Checks write access only in the jobs that require it. PR verification receives no Cloudflare/database secret.

A separate same-repository PR job now exercises GitHub checkpoint transport without runtime credentials. It creates a neutral `cloudflare-release-journal-probe`, reads it back and updates it. This probe cannot be restored as an executable release checkpoint. Its first native CI run remains pending on the next pushed head; local protocol tests do not substitute for that run. Main also probes storage before deploying a shadow copy.

The existing Netlify build-hook step remains available while no target is selected. It is skipped for `cloudflare` or `paused`; neither value is selected here. Removing the hook or selecting the initial target remains part of the verified handover.

## Ordinary release protocol

`npm run release:cloudflare` runs only in trusted main CI with `HOSTING_TARGET=cloudflare` and an active checked artifact. It cannot take initial ownership from Netlify. The sequence is:

1. Verify Cloudflare already owns execution, the old host is durably fenced, both Workers match the current release, policies/binding inventories agree, reminders remain off and the immutable source proof matches.
2. Persist the sanitized plan and checkpoint as a GitHub check run, acknowledge it with a separate read, then atomically pause admission only when queued work is empty. A local fsynced checkpoint/artifact is an additional backup.
3. Wait for running work to finish. Expired leases and uncertain outcomes are retained; no business job is cleared or replayed to force a release.
4. Upload web/jobs **versions without changing serving traffic**. Preserve existing ordinary variables, private secret inventory and service/queue/rate bindings. Version uploads do not change schedules, consumers or the source component.
5. Advance the paused release/epoch, promote those exact versions at 100 percent, then verify actual health, every static asset, version identity, bindings and source proof.
6. Resume only if the runtime was running before the release. An already paused runtime stays paused. Completed retries recheck live state.

`ReleaseJournal` uses `cloudflare-release-checkpoint`, the target SHA and plan digest. Restore rejects another commit, artifact, app or changed journal. Before each external mutation the coordinator checks the current checked head, artifact/source pin and known serving versions. A checksum detects changed data; it is not approval or authorization.

Operation-specific revision UUIDs are saved before pause/advance/resume. Checked database RPCs compare owner, epoch, release and revision under the admission row lock. A retry can adopt only its own already-applied revision. Any intervening operator update, including another pause while already paused, invalidates the release. Lost replies therefore do not allow a deployment to override a later operator pause. Failures leave admission paused; no transaction waits for an external API.

## Verification and boundaries

The [native review-copy rehearsal](evidence/cloudflare-release-adapter-shadow-2026-11-04.json) uploads both exact versions while the old versions continue serving, deliberately drops a successful upload reply and recovers the retained version without a second upload. It also drops a successful promotion reply and reconciles actual state without another promotion. Both versions are then promoted in **shadow mode**, with all nine execution flags false, source unchanged and Netlify ownership/revision unchanged. This proves the platform adapter against Cloudflare; it is not an active release or initial switch.

An [independent hosted readback](evidence/cloudflare-release-adapter-hosted-readback-2026-11-04.json) passes 22 routes/two denials and 72 static-file hashes, verifies no schedules/consumers, and preserves all 56 original tables / 21,115 rows / 296 function-index definitions. Full local check passes 3,725 tests / 113 files, plus the separately added artifact-integrity case; 54 focused cases / seven files and 26 workerd cases pass. Active frontend build/workerd checks also pass without deployment.

Migration `20261104110432` adds a revision to the single hosting-control row, a trigger and two service-only checked transition functions. Two existing hosting-guard functions are updated. Actual rollback/apply verification preserves all other 57 public tables exactly and all original application rows/definitions. The old hosting-control fields stay unchanged. [Migration evidence](evidence/cloudflare-release-revision-migration-2026-11-04.json). [Real API checks](evidence/cloudflare-release-adapter-api-2026-11-04.json) return anonymous status 401 and service status 200; both checked mutation endpoints reject Netlify ownership without changing control/revision. The native advisor returns 47 INFO RLS-without-policy notices, including the deliberately private hosting tables; no warning/error or unrelated policy change is claimed. [Advisor summary](evidence/cloudflare-release-revision-advisor-2026-11-04.json).

`cloudflare/verified-source.json` pins measured inputs, exact disabled/enabled Worker versions and the hosted-tested image `bc1713f4ad97fe53e861777e27cdcc7b43d3ebe60d44d33a8d585b7450718352`. The enabled version used for the ten hosted cases has the same script/runtime/bindings as the disabled pin apart from the enable flag. Routine shadow deploys reuse only the disabled pin; ordinary active release checks also recognize the separately tested enabled pin. Neither path rebuilds/enables the source as a side effect. Changed source inputs require new proof. The source remains private, disabled, credential-free, limited to one instance and observed inactive. [Exact-image proof and earlier attribution correction](evidence/cloudflare-source-exact-image-2026-11-04.json).

Still required: native PR checkpoint transport result, actual checked-main automatic deployment, full latest-release private save/reload/ordinary-user parity, initial handover/rollback rehearsal, independent old-host fencing and dedicated replacement database credential, bounded acceptance, then site-only retirement. The prior real owner/admin/workspace-existence browser proof remains attached to `8fdfbae`; it is not relabeled as current private-app proof. No repeat billing, OpenRouter key or administrator setup is needed.
