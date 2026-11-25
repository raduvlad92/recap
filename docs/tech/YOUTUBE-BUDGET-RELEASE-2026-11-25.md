# Scheduled YouTube collection and monthly provider cap

**Incident ongoing.** Processing remains paused on the combined release.

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

## Checked continuation and scheduled evidence

The [exact-checkpoint continuation](https://github.com/raduvlad92/recap/actions/runs/45612911148) was submitted once. The checked main verification job passed. The deploy advanced checkpoint 139193034049 to `verified`, then failed GitHub acknowledgment at 12:31:26 UTC. The checkpoint remained in progress with `release_checkpoint_unacknowledged` and no resume intent. Both live versions and the epoch 9 revision still matched. At 12:31:53 UTC the public health predicate passed, admin returned HTTP 503, the USD 20 cap showed USD 9.668564441061 committed, and there were zero post-release hourly frames. Release acceptance and scheduled results are pending.
