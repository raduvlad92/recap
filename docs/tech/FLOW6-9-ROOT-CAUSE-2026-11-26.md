# Why Flows 6 and 9 failed on November 26

The 72-hour production baseline had **23 of 72 hourly collection slots complete on time** and **zero of three daily briefings**. An expired queue lease kept 47 hourly slots from starting. The November 25 release pause covered the other two missing hourly slots. The Worker disabled daily briefings and automatic analysis throughout the window. The $20 shared provider cap passed.

## Evidence and classifications

The exact window was **2026-11-23 02:22:54.563573 UTC through 2026-11-26 02:22:54.563573 UTC**. The retained evidence was re-read on November 26 with `transaction_read_only=on` and checked against the scorer in [#56](https://github.com/raduvlad92/recap/pull/56). Times below are UTC. Production health was sampled after the window and served `6a794cb` with Cloudflare active.

| Class | Hourly | Daily | Evidence |
| --- | ---: | ---: | --- |
| A · Release or incident pause | 2 | 0 | November 25 at 12:00 and 13:00. Both have no frame. The first deploy job paused epoch 8 by 11:56:18 and stopped at checkpoint `139187255191` with `release_checkpoint_unacknowledged`. The epoch 9 promotion stopped at `release_health_unverified` at 12:07:38 and remained paused after the continuation's second acknowledgement failure at 12:31:26. Epoch 10 resumed at 13:01:34. |
| B · Scheduling disabled | 0 | 3 | All three 07:00 cutoffs had an enabled database schedule and no cron frame, job or snapshot. The historical jobs Worker on epoch 8 had `DAILY_BRIEFING_ENABLED=false` and `AUTOMATIC_CONTENT_ENABLED=false`. Both flags stayed false on epoch 9 and on both epoch 10 Workers. |
| C · Started and failed | 0 | 0 | No in-window hourly frame with a lease failed. There were zero failed or abandoned checks in successfully completed hourly frames. The original canceled invocation was November 19, outside this window. The manual model rerun was separate. |
| D · Delayed by transport | 47 | 0 | All 47 had regular cron admission timestamps and no lease token or deadline. The old single-active-worker gate kept them queued behind the expired November 19 lease. They missed the deadline without entering source code. Bulk retirement wrote the same terminal timestamp on all 47. No hourly slot actually completed late. |
| E · Scheduled work with missing attribution | 0 | 0 | The six archive additions match the separately recorded three-channel manual proof. The 218 started model tasks match the owner-directed rerun. There were zero scheduled automatic-content, content-analysis or daily-briefing frames and zero scheduled check retrievals. These activities cannot supply scheduled yield. |
| OK · Completed in time | 23 | 0 | Each frame completed within 15 minutes. Their 897 checks recorded 23 partial, 460 `provider_channel_outside_scope`, 414 `freshness_check_unavailable`, zero failed and zero new items. |

**Lease chain.** Blocking frame `cron:hourly-collection:8:5983608` was admitted November 19 at 10:00:53.320624, claimed at 10:00:55.514612 and expired at 10:15:55.514612. It remained running until November 25. The transport disposition `a084b630-65b2-4165-ad44-d2acfa8c3982`, recorded November 25 at 01:28:41.258679, records `expired_outcome_unknown`, native evidence `observed_cancelled_invocation` and primary queue depth zero. The recovery retired 135 queued records across the full backlog, including the 47 in this window. The explicit validation frame `manual:hourly-collection:8:youtube-live-proof-20261125` finished at 01:28:57.089165. The ordinary 02:00 scheduled frame then completed on time. [Three-channel proof and transport recovery](YOUTUBE-LIVE-PROOF-2026-11-25.md)

**Release chain.** The checked restoration at **2026-11-25 13:01:34.901866 UTC** came after the 13:00 tick. The first on-time post-resume frame was 14:00. The later #39 deploy failed before pausing because its migration-read secret was missing. The frames at 17:00 and afterward continued on epoch 10. [First pause log](https://github.com/raduvlad92/recap/actions/runs/45607502748/job/139186971094) · [Epoch 9 checkpoint](https://github.com/raduvlad92/recap/runs/139193034049) · [Epoch 10 checkpoint](https://github.com/raduvlad92/recap/runs/139222108456) · [Restoration evidence](YOUTUBE-BUDGET-RELEASE-2026-11-25.md) · [Failed #39 deploy](https://github.com/raduvlad92/recap/actions/runs/45659268265/job/139368200100)

**Runtime readback.** Cloudflare version metadata confirmed the historical epoch 8 jobs version `87368420-4580-4e8d-80a1-5670680ef038` and the current jobs and web versions `2de63083-5e03-48d8-a2cc-2496094569fb` and `754c7831-6d06-4df4-9cd0-5562826a15b3`. The hourly flag is true and the daily, automatic-content and general content-analysis flags are false on all three. The Jobs Worker has both `0 * * * *` and `*/5 * * * *` configured. The five-minute trigger admits each worker only if its flag is explicitly true. The saved reader schedule is 08:00 Europe/Berlin, enabled since October 31, with its latest saved cutoff November 13 at 07:00 UTC. November 25's 07:00 hourly frame also proves that cutoff preceded the release pause. [Epoch 9 and 10 verification](YOUTUBE-BUDGET-RELEASE-2026-11-25.md)

**Yield.** The three manual source checks at November 25 01:24:15–01:24:46 UTC were `a3c689d6-da9e-43b2-be17-50032267920f`, `0e3837de-4313-40ba-87f4-ddd93d04823c` and `14d656aa-ad65-4df6-a0e5-896855f4d239`. Each imported two transcripts. Two ordinary Apify-path checks on November 26, `60e6e74d-ab5a-4812-8b9e-86b73f786387` at 00:00:58 and `34787e08-f0cb-499a-b4ce-e26884ad0417` at 01:00:57, returned partial coverage and zero new or retrieved records. The 218 model tasks recorded 1,168 calls, including 20 with unknown cost, and 3,197 structurally valid proposals out of 3,406. They produced zero qualifying scheduled video pairs. In that separate rerun, the largest error classes were `analysis_invalid_json` (44), `analysis_unknown_charge_hold` (20) and `analysis_output_capacity` (19). [Manual collection](YOUTUBE-LIVE-PROOF-2026-11-25.md) · [Manual analysis and offline replay](VIDEO-ANALYSIS-REPLAY-2026-11-26.md)

## All 72 hourly slots

Every short frame ID below denotes `cron:hourly-collection:<epoch>:<ID>`. D rows share `updated_at=2026-11-25 01:28:41.258679 UTC` and have no claim. Their update timestamp records backlog retirement. A rows have no admitted frame. The admission and completion times share the slot date and are shown to milliseconds.

| Slot (UTC) | Class | Epoch / frame ID | Admitted (UTC) | Completed (UTC) |
| --- | --- | --- | --- | --- |
| 11-23 03:00 | D | 8 / `5984676` | 03:00:53.478 | — |
| 11-23 04:00 | D | 8 / `5984688` | 04:00:53.333 | — |
| 11-23 05:00 | D | 8 / `5984700` | 05:00:53.054 | — |
| 11-23 06:00 | D | 8 / `5984712` | 06:00:53.332 | — |
| 11-23 07:00 | D | 8 / `5984724` | 07:00:52.973 | — |
| 11-23 08:00 | D | 8 / `5984736` | 08:00:53.510 | — |
| 11-23 09:00 | D | 8 / `5984748` | 09:00:54.027 | — |
| 11-23 10:00 | D | 8 / `5984760` | 10:00:53.271 | — |
| 11-23 11:00 | D | 8 / `5984772` | 11:00:53.852 | — |
| 11-23 12:00 | D | 8 / `5984784` | 12:00:53.626 | — |
| 11-23 13:00 | D | 8 / `5984796` | 13:00:53.406 | — |
| 11-23 14:00 | D | 8 / `5984808` | 14:00:53.886 | — |
| 11-23 15:00 | D | 8 / `5984820` | 15:00:53.703 | — |
| 11-23 16:00 | D | 8 / `5984832` | 16:00:53.353 | — |
| 11-23 17:00 | D | 8 / `5984844` | 17:00:53.948 | — |
| 11-23 18:00 | D | 8 / `5984856` | 18:00:54.053 | — |
| 11-23 19:00 | D | 8 / `5984868` | 19:00:53.201 | — |
| 11-23 20:00 | D | 8 / `5984880` | 20:00:54.058 | — |
| 11-23 21:00 | D | 8 / `5984892` | 21:00:53.928 | — |
| 11-23 22:00 | D | 8 / `5984904` | 22:00:54.415 | — |
| 11-23 23:00 | D | 8 / `5984916` | 23:00:53.335 | — |
| 11-24 00:00 | D | 8 / `5984928` | 00:00:54.251 | — |
| 11-24 01:00 | D | 8 / `5984940` | 01:00:54.251 | — |
| 11-24 02:00 | D | 8 / `5984952` | 02:00:53.466 | — |
| 11-24 03:00 | D | 8 / `5984964` | 03:00:53.230 | — |
| 11-24 04:00 | D | 8 / `5984976` | 04:00:53.252 | — |
| 11-24 05:00 | D | 8 / `5984988` | 05:00:53.265 | — |
| 11-24 06:00 | D | 8 / `5985000` | 06:00:52.894 | — |
| 11-24 07:00 | D | 8 / `5985012` | 07:00:53.516 | — |
| 11-24 08:00 | D | 8 / `5985024` | 08:00:53.275 | — |
| 11-24 09:00 | D | 8 / `5985036` | 09:00:53.163 | — |
| 11-24 10:00 | D | 8 / `5985048` | 10:00:53.898 | — |
| 11-24 11:00 | D | 8 / `5985060` | 11:00:53.314 | — |
| 11-24 12:00 | D | 8 / `5985072` | 12:00:53.759 | — |
| 11-24 13:00 | D | 8 / `5985084` | 13:00:53.740 | — |
| 11-24 14:00 | D | 8 / `5985096` | 14:00:54.032 | — |
| 11-24 15:00 | D | 8 / `5985108` | 15:00:54.150 | — |
| 11-24 16:00 | D | 8 / `5985120` | 16:00:54.878 | — |
| 11-24 17:00 | D | 8 / `5985132` | 17:00:53.673 | — |
| 11-24 18:00 | D | 8 / `5985144` | 18:00:54.529 | — |
| 11-24 19:00 | D | 8 / `5985156` | 19:00:53.454 | — |
| 11-24 20:00 | D | 8 / `5985168` | 20:00:53.615 | — |
| 11-24 21:00 | D | 8 / `5985180` | 21:00:53.864 | — |
| 11-24 22:00 | D | 8 / `5985192` | 22:00:53.937 | — |
| 11-24 23:00 | D | 8 / `5985204` | 23:00:53.205 | — |
| 11-25 00:00 | D | 8 / `5985216` | 00:00:53.913 | — |
| 11-25 01:00 | D | 8 / `5985228` | 01:00:53.011 | — |
| 11-25 02:00 | OK | 8 / `5985240` | 02:00:53.493 | 02:01:04.785 |
| 11-25 03:00 | OK | 8 / `5985252` | 03:00:54.094 | 03:01:07.508 |
| 11-25 04:00 | OK | 8 / `5985264` | 04:00:52.983 | 04:01:05.744 |
| 11-25 05:00 | OK | 8 / `5985276` | 05:00:53.275 | 05:01:06.755 |
| 11-25 06:00 | OK | 8 / `5985288` | 06:00:52.856 | 06:01:05.868 |
| 11-25 07:00 | OK | 8 / `5985300` | 07:00:53.211 | 07:01:06.290 |
| 11-25 08:00 | OK | 8 / `5985312` | 08:00:53.522 | 08:01:02.712 |
| 11-25 09:00 | OK | 8 / `5985324` | 09:00:55.647 | 09:01:05.280 |
| 11-25 10:00 | OK | 8 / `5985336` | 10:00:53.511 | 10:01:04.136 |
| 11-25 11:00 | OK | 8 / `5985348` | 11:00:54.199 | 11:01:07.108 |
| 11-25 12:00 | A | — | — | — |
| 11-25 13:00 | A | — | — | — |
| 11-25 14:00 | OK | 10 / `5985384` | 14:00:53.476 | 14:01:07.361 |
| 11-25 15:00 | OK | 10 / `5985396` | 15:00:54.235 | 15:01:05.525 |
| 11-25 16:00 | OK | 10 / `5985408` | 16:00:54.430 | 16:01:09.099 |
| 11-25 17:00 | OK | 10 / `5985420` | 17:00:55.784 | 17:01:09.067 |
| 11-25 18:00 | OK | 10 / `5985432` | 18:00:53.712 | 18:01:07.941 |
| 11-25 19:00 | OK | 10 / `5985444` | 19:00:53.290 | 19:01:07.118 |
| 11-25 20:00 | OK | 10 / `5985456` | 20:00:53.557 | 20:01:04.504 |
| 11-25 21:00 | OK | 10 / `5985468` | 21:00:53.946 | 21:01:08.893 |
| 11-25 22:00 | OK | 10 / `5985480` | 22:00:54.362 | 22:01:06.986 |
| 11-25 23:00 | OK | 10 / `5985492` | 23:00:53.729 | 23:01:06.772 |
| 11-26 00:00 | OK | 10 / `5985504` | 00:00:52.964 | 00:01:07.901 |
| 11-26 01:00 | OK | 10 / `5985516` | 01:00:52.573 | 01:01:06.069 |
| 11-26 02:00 | OK | 10 / `5985528` | 02:00:52.472 | 02:01:06.043 |

## All three daily cutoffs

| Local date | Due UTC | Latest accepted time UTC | Class | Job / snapshot |
| --- | --- | --- | --- | --- |
| 2026-11-23 | 07:00 | 07:15 | B | No row for this cutoff |
| 2026-11-24 | 07:00 | 07:15 | B | No row for this cutoff |
| 2026-11-25 | 07:00 | 07:15 | B | No row for this cutoff |

## Draft changes

- The active hourly lease fix in migration `20261125030000` retires expired **running** hourly frames on the next eligible claim. All 13 post-resume slots in the baseline completed on time. The follow-up migration on this draft branch expires overdue **queued** hourly cron frames that never acquired a lease, even if their queue message disappeared. It preserves the frame and other kinds, respects active leases and release fences, and prevents stale delivery from entering source work. An isolated PostgreSQL test reproduces the old late claim and checks the new behavior. The existing running-lease and pause repairs are already in production.
- The [scorer draft](https://github.com/raduvlad92/recap/pull/56) now distinguishes unclaimed slots from started failures and unknown outcomes, requires 72 matured hourly slots, and uses the actual hourly lease start for source-check attribution. The fixed historical bounds reproduced 23/72 and 0/3, with all 47 explicitly unclaimed. Neither verdict changes. No attributable scheduled archive or model activity was recovered.

## Configuration proposal for PM approval

November commitment is **$9.668564441061 of $20**, including **$4.420027191** unresolved; arithmetic headroom is **$10.331435558939**. The cap resets at 00:00 UTC December 1 and unresolved holds can carry over. A 30-day/month planning estimate follows. Check live commitment and the day/pilot gates before activating.

| Setting or gate | Current | Proposed | 30-day provider cost or bound |
| --- | --- | --- | --- |
| Jobs and web `DAILY_BRIEFING_ENABLED` | `false` on both | `true` on both via checked release. Preserve database control and the selected reader's enabled 08:00 Europe/Berlin schedule. Verify Jobs Worker five-minute cron and consumer. Keep email reminders off. | **$0** Apify/OpenRouter. Composition folds existing approved findings. Hosting use is separate. |
| Jobs and web `AUTOMATIC_CONTENT_ENABLED` | `false` on both. The one enabled reader policy starts 2026-10-29 00:00 UTC, with $0.30 per task and 100-call max. No queued tasks at readback. | `true` on both only after the checked #39 code and scoped admission ship, the separate $0.75 ten-video proof reaches 9/10 with both approved-quality drafts, and representative follow-up passes. Require a checked scheduler admission limited to the exact three channels, current regular transcripts and dates at or after approved activation. The existing enrollment date is immutable and broad. The finite proof gate in #53 covers its manifest only, so keep this flag off until the scheduler can enforce that scope. Preserve the enabled $5 model day gate, $12 legacy lifetime control and per-call/session limits. Keep `CONTENT_ANALYSIS_ENABLED` and `KEYWORD_LEARNING_ENABLED` false. | **$4.26 base / $6.70 stress** at 36 three-channel transcripted videos per 30 days. The $0.75 proof is separate, one-time and subject to approval. |
| Hourly source scope and Apify admission | `HOURLY_COLLECTION_ENABLED=true`, TechLinked-only provider scope, $0.04 finite pilot envelope; reader ceilings $0.10/day and $1.00 lifetime. | Via [#46](https://github.com/raduvlad92/recap/pull/46), start with checked `p_recurring=false` for TechLinked, ShortCircuit and GamersNexus on a specific UTC proof day. After an actual scheduled import and duplicate check, use the checked restore with `p_recurring=true`. The reviewed pilot binds those channels and release to its $2.50 envelope and $0.20/day, $3.50 lifetime reader ceilings. | **$2.25 maximum scheduled reservations / 30 days** ($2.325 for 31), from $0.020 discovery plus one $0.005 caption fallback per channel per UTC day. **$2.50** envelope commitment inside the cap. |
| Shared Apify/OpenRouter cap | $20 per UTC month, alerts at 50/80/100%, unknown charges held | $20, same admission guards and holds. The entire pilot envelope is included in the conservative same-month calculation. | **$19.618564441061** including current commitment, $2.50 envelope, $0.75 proof and $6.70 analysis stress, leaving **$0.381435558939**. Check remaining headroom and block any expansion if it shrinks. |

[Budget behavior](MONTHLY-PROVIDER-BUDGET.md) · [Analysis cost model and qualification](VIDEO-ANALYSIS-REPLAY-2026-11-26.md) · [Checked pilot and rollback](https://github.com/raduvlad92/recap/blob/68a71c9ea59965e5d4fad2301147bfe8dc84ac21/docs/tech/CHECKED-YOUTUBE-PILOT.md)

## Start condition for the 72-hour clock

1. The PM ships the checked release train and accepts the exact release, epoch, restored queue, cron, binding parity and budget readbacks. The PM authorizes the bounded three-channel scope, enables daily briefing and enables automatic analysis after the scope and quality gates pass. Successful activation includes actual scheduled regular-video transcript yield and both review-bound drafts. An empty or partial provider result stays partial.
2. Observe one ordinary useful, cited 08:00 Berlin cutoff on that release before starting the clock. The daily composer uses approved findings and a quiet day needs complete checks within six hours on every followed source. All baseline checks were partial, blocked or unsupported. Confirm the selected reader can get full coverage on a quiet day, or useful cited output on each incomplete day. Arrange any necessary editorial approval before the clock. A scheduled unresolved or empty partial recap fails, and a manual review during the clock counts as intervention in the current acceptance contract. If evidence for a useful in-window day and honest quiet or useful outputs for the other days is unavailable, keep the clock stopped. Review-first approval remains the current product policy.
3. Record `T0` after the qualifying cutoff's grace period and after the last intervention or restoration, at minute 15 or later within a UTC hour. Confirm the next 72 hours contain 72 mature hourly slots and three mature 07:00 UTC Berlin cutoffs for the eligible schedule. For example, a qualified November 27 cutoff could allow `2026-11-27T07:20:00Z` through `2026-11-30T07:20:00Z`, with November 28–30 as the three scored cutoff dates. This is a calendar example. The clock is stopped as of this diagnosis. A release, pause, intervention or missing evidence invalidates the window. Use the observer at the recorded start and end.

This lane used the PM's read-only production and provider metadata authorization. It opened no production session, created no test credential, changed no production data or config, launched no provider job and incurred **$0**. All code tests used disposable PostgreSQL or offline fixtures. The live baseline replay queried retained database evidence and public HTTP health only.
