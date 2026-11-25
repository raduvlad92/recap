# Scheduled YouTube collection and monthly provider cap

**Scheduling restored.** Two unattended TechLinked frames completed on the accepted release. The separate signed-in owner browser check passed.

## Release record

[PR #37](https://github.com/raduvlad92/recap/pull/37) added recovery for expired hourly work and pinned the reviewed YouTube provider build. [PR #38](https://github.com/raduvlad92/recap/pull/38) added the USD 20 UTC-month cap for Therecap's Apify and OpenRouter admissions. Combined main was `f36e8f79d873a19f82dd52906945135be2c8fa6c`.

- The [#37 automatic deploy](https://github.com/raduvlad92/recap/actions/runs/45607502748) paused the predecessor at epoch 8 and failed to acknowledge the saved pause in GitHub. [Checkpoint 139187255191](https://github.com/raduvlad92/recap/runs/139187255191) matched the live pause revision and recorded no staged versions. Both Workers still served the predecessor and admin returned HTTP 503. The controller stops after an unacknowledged journal write, preserving the pause for reconciliation.
- The [combined deploy](https://github.com/raduvlad92/recap/actions/runs/45609545120) began paused and promoted both Workers to epoch 9. It failed at 12:07:38 UTC with `release_health_unverified`. [Checkpoint 139193034049](https://github.com/raduvlad92/recap/runs/139193034049) recorded both promoted versions and matched the live revision. The failed probe did not record its observed status, release or mode. The health handler reads Worker bindings independently of the pause and database migrations. It passed on the target at 12:08 and 12:09 UTC while production was still paused and unmigrated. Post-promotion propagation is a possible explanation. The exact cause remains unverified.
- The next 10 probes, from 12:10:52.273 through 12:15:49.275 UTC, all returned HTTP 200, the exact target SHA and mode `active`. Both Workers served the same versions at 100% traffic before and after. Processing remained paused throughout.
- A verified encrypted backup of the application and migration schemas preceded the migration writes. The archive decrypted and fully decoded through PostgreSQL's restore tool. The archive and recovery key remain in private local custody.

## Migration and provider readback

The hourly migration committed with the reviewed definitions. JavaScript replacement-string syntax converted four `$$` delimiters to `$` in the journal copy and left both installed function bodies byte-identical to their sources. A guarded transaction corrected exactly one journal entry under the observed old digest. The fixed helper used literal replacements and its dry run reproduced both original files byte for byte.

| Journal migration | Verified SHA-256 |
| --- | --- |
| `20261125030000_hourly_hosting_lease_recovery` | `b132c73020c88ca7fcbe26f9344f1090e9b0c29ce82480e224123b2ec2add67e` |
| `20261125103322_monthly_provider_budget` | `2a215f1bfae260ae54ea1b04be89e9a02440a7b0d929986eef6ece9ae1587a27` |

The live service-role budget RPC returned HTTP 200 and matched direct SQL. At 12:19 UTC it reported USD 5.237937250061 recorded spend, USD 9.668564441061 committed and USD 4.430627191 unresolved against USD 20. The allowance resets December 1 at 00:00 UTC. The 50%, 80% and 100% alert thresholds and provider admission triggers were present. No threshold had been reached.

The first Apify metadata read returned HTTP 401 because it picked up an older local preparation credential. An account-authentication probe confirmed the older credential was rejected and the approved credential returned HTTP 200. The approved credential confirmed build `0.0.340`, its reviewed build ID and the effective pricing hash. Both serving Workers retained those build bindings. No credentials changed and no manual provider calls were launched.

## First checked continuation

The [exact-checkpoint continuation](https://github.com/raduvlad92/recap/actions/runs/45612911148) was submitted once. The checked main verification job passed. The deploy advanced checkpoint 139193034049 to `verified`, then failed GitHub acknowledgment at 12:31:26 UTC. The checkpoint remained in progress with `release_checkpoint_unacknowledged` and no resume intent. Both live versions and the epoch 9 revision still matched. At 12:31:53 UTC the public health predicate passed, admin returned HTTP 503, the USD 20 cap showed USD 9.668564441061 committed, and there were zero post-release hourly frames. Release acceptance and scheduled results were still pending at that readback.

## Checkpoint acknowledgment diagnosis

The trusted deploy job authenticates as the GitHub Actions app with `checks: write`. It writes or updates the `cloudflare-release-checkpoint` check run. The write response supplies the check-run identity. The release controller acknowledges the state by separately reading the same check-run ID and comparing the full saved summary, status and conclusion. That read must succeed before the controller advances. The acknowledgment is automatic. [Controller source](https://github.com/raduvlad92/recap/blob/f36e8f79d873a19f82dd52906945135be2c8fa6c/scripts/cloudflare-release-github.mjs#L90-L156) · [Workflow job](https://github.com/raduvlad92/recap/blob/f36e8f79d873a19f82dd52906945135be2c8fa6c/.github/workflows/cloudflare-duplicate.yml#L246-L274)

Both incident records contain the coordinator's newly recorded acknowledgment error. The backup diagnostic from the first run also contains the same saved error at `paused`. If the original write identity or observed checkpoint had conflicted, the journal would have latched the conflict and refused the error-save write. Authorization errors have a separate request failure code. The evidence therefore places both incidents in the read-after-write acknowledgment path. The first stopped after pausing and the continuation stopped after verifying the promoted release. The historical workflows logged only the terminal code, so their exact missed responses are unavailable.

The release controller made three observations with waits of 200 and 400 milliseconds. The separate PR storage probe already allowed five observations with 5.5 seconds of delays because GitHub had returned 404 or a previous value after an accepted check write. In a local reproduction with 1.5 seconds of simulated read lag, the original controller failed at both incident phases. The candidate acknowledged both with four reads and a single write per phase. The fix extends the read-only backoff to seven observations with 21.5 seconds of delays and logs each missed read's status and phase. It still requires the exact saved checkpoint. [Guard PR](https://github.com/raduvlad92/recap/pull/41)

Checkpoint 139193034049 remains bound to `f36e8f7` and its artifact hashes. Production was paused at that checkpoint. The merged guard used its own release checkpoint.

## Resolution of the release pause

[PR #41](https://github.com/raduvlad92/recap/pull/41) merged as `6a794cbd85a960afcf6153ab78889fd2a4d046e8`. The [automatic release](https://github.com/raduvlad92/recap/actions/runs/45617664069) passed on that SHA. Its deploy log captured a 404 and three compatible stale reads during checkpoint acknowledgment. Subsequent reads confirmed the same checkpoint. The controller recorded completion at 13:00:41 UTC with [checkpoint 139222108456](https://github.com/raduvlad92/recap/runs/139222108456).

A single checked restoration resumed the existing TechLinked schedule at 13:01:34 UTC. Both Workers served the exact SHA at 100% traffic. Production ran in active mode at epoch 10 and health returned HTTP 200. Web version `754c7831-6d06-4df4-9cd0-5562826a15b3` and jobs version `2de63083-5e03-48d8-a2cc-2496094569fb` were still serving at both scheduled readbacks. The monthly cap held at USD 9.668564441061 committed of USD 20 at the pre-tick read. The separate USD 0.04 TechLinked envelope was preserved.

## Admin verification

The authenticated Backend API probe returned HTTP 401 `invalid_session`. A fresh 60-second token for the existing verified allowlisted owner passed issuer, signature and timing checks and lacked `azp`. Therecap requires `azp=https://recap.filternode.dev`. The same authentication and allowlist implementation served both releases. The PM accepted the Backend API token rejection. Anonymous HTTP 401 `sign_in_required` is expected on the active release.

The PM's separate headless browser audit at 14:48 UTC verified a signed-in owner session from the app origin. The Administration page, signed-in Overview request, and Collection costs request returned HTTP 200. Collection costs displayed USD 9.668564 committed against USD 20. The private audit retained the HTTP and screen evidence.

## Scheduled TechLinked readback

Both observations read persisted production records on `6a794cb`, epoch 10, with the existing TechLinked-only scope.

| Scheduled slot (UTC) | Persisted cron frame | Created (UTC) | TechLinked check (UTC) | Completed (UTC) | New archive entries | Provider jobs |
| --- | --- | --- | --- | --- | --- | --- |
| 14:00 | `cron:hourly-collection:10:5985384` | 14:00:53.477 | 14:00:59.142 | 14:01:07.362 | 0 | 0 |
| 15:00 | `cron:hourly-collection:10:5985396` | 15:00:54.235 | 15:00:59.342 | 15:01:05.526 | 0 | 0 |

Both provider-only checks returned zero new items and no error. Each reported partial coverage with possible gaps. Neither frame archived a transcript. The two completed frames establish scheduling for the restored scope. Fresh transcript yield remains unverified.

At the 14:17 and 15:17 UTC observations, November commitment matched the pre-resume baseline of USD 9.668564441061 against USD 20. This included USD 5.237937250061 spent and USD 4.430627191 unresolved. The separate held USD 0.04 TechLinked envelope had zero held and zero settled child reservations. No new provider fees or commitments were recorded during the two observations. Health returned HTTP 200 each time. The private receipts retain exact timestamps, version identities and scope checks.
