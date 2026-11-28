# Daily briefing at the reader cutoff

## Production readback

On 26 November 2026 at 00:40 UTC a `BEGIN READ ONLY` transaction confirmed one enabled reader schedule at 08:00 Europe/Berlin and an enabled database control. One workspace met the worker’s schedule-creation policy. Both serving Cloudflare Workers were active on `6a794cb` with `DAILY_BRIEFING_ENABLED=false`. The five-minute scheduler requires the literal `true`. Automatic analysis and reminder flags were also off. The last completed daily scheduler frame was 13 November at 21:16 UTC on the prior release and epoch. No later daily job or snapshot was saved. The verified disablement is the serving flag and the release policy that preserves it. [November release and scope](YOUTUBE-BUDGET-RELEASE-2026-11-25.md)

The November 13 snapshot covered 12 Nov 07:00 UTC through 13 Nov 07:00 UTC. The job finished at 07:01:49 UTC. It had 17 archived updates from nine sources. Ten awaited review, seven lacked usable content, and none supplied approved findings. Coverage was 0 checked, 0 quiet, 7 partial, 14 failed and 18 unknown across 39 followed sources. Storage recorded `awaiting_review` with a null publication time.

At the readback there were 158 pending recap reviews and zero approved recap reviews for that reader. The saved input requires usable transcript or feed text, a current-hash ready recap and keyword approval or publication, and matching approved recap review wording and quote. Captions, drafts and completed analysis jobs alone confer no publication authority. The owner's **Keep held** decision stays in effect.

## What the reader sees

- At the local cutoff, the worker freezes a snapshot of eligible archive material and the most recent source evidence at or before cutoff. Its existing timezone rules pick the first repeated wall time and move nonexistent wall times to the next valid minute. An original first archived after cutoff can carry to the following run with its original publication date. Findings whose saved source row changed after cutoff wait for the next run because an earlier row version is unavailable.
- The worker copies approved findings and quotes, ranks up to five topics by explicit interests and recency and keeps the full bounded inventory in **All updates**. Every displayed claim retains its whole original link, source and publication timestamp. The wording stays in its approved language. Incomplete coverage or unavailable content can coexist with approved topics under **Partial**.
- **Quiet** requires a nonempty set of followed sources, complete check evidence, an empty update inventory and no known gap. Coverage lists fully checked sources and the subset with no updates, plus partial, failed, blocked and unknown checks. When updates exceed the snapshot bound, the quiet count is withheld. A check marked partial, blocked or failed records an attempt without counting it as fully checked.
- An unpublished day can appear privately as **Partial**, **Awaiting review** or **Failed**. A recorded generation failure or an entirely failed, empty source set appears as **Failed**. Partial source coverage and missing content appear as **Partial**. Pending reviews are counted separately. Existing stored publication states and reminder eligibility stay authoritative. Disabled scheduling is visible alongside saved history.
- The storage transaction rechecks the current source hash, original quote, ready recap and keywords before publishing. It rejects a quiet finish with incomplete coverage. Existing snapshots remain immutable, including older failures.

The check window continues to use the latest check within six hours of cutoff. Provider-only partial discovery does not establish complete daily coverage. The archived reader snapshot is separate from the original source's factual accuracy.

## Offline replay from November 25

The read-only export includes eight regular YouTube uploads with saved transcripts from TechLinked, ShortCircuit and GamersNexus. Six were archived on November 25 and two on November 19. All eight had no matching current-hash recap or keyword review. Format evidence was applied at 22:57 UTC on November 25, after that day's cutoff. This is a retrospective replay of the saved archive, using the scheduled 08:00 Berlin window and recovered format. All eight are late arrivals for that window. The actual production-wide historical coverage input reconstructed at readback had 0 checked, 1 partial, 20 blocked and 18 unknown sources, with 39 updates awaiting review and two without usable content. The replay narrows the scope to the three public channels and eight recovered uploads.

The tracked fixture contains public item identifiers, titles, links, dates, hashes, short source excerpts and separately labelled mock responses. Full private transcripts stay in the local ignored snapshot. The test verifies that the held-state replay yields zero topics. The second run supplies five mock approvals in-process and prints the resulting **Partial** briefing. Neither run calls a model or changes review data. [Fixture](../../tests/fixtures/daily-briefing/archive-2026-11-25.json)

```sh
DAILY_BRIEFING_REPLAY_PRINT=1 npx vitest run --disableConsoleIntercept tests/daily-briefing-replay.test.ts
```

### Replay output for 25 November at 08:00 Berlin

**Partial** · Three sources · 0 checked · 0 quiet · 1 partial · 0 failed · 2 blocked

Offline replay using eight archived regular uploads. Five mock approvals yielded five cited topics and three updates awaiting review. The actual review-state replay yielded zero topics and eight updates awaiting review. Original publication times are UTC. Links below include the saved caption cue.

- **Storage** — GamersNexus reports that NVIDIA and AMD GPU driver problems caused high writes on SSDs and hard drives. [GamersNexus, 2026-11-22 13:27 UTC](https://www.youtube.com/watch?v=l8qxFcaLSM4&t=18s)
- **3D printing** — ShortCircuit puts the new Formlabs resin printer at $699. [ShortCircuit, 2026-11-21 18:09 UTC](https://www.youtube.com/watch?v=GBCfagEoRDI&t=7s)
- **PC gaming** — TechLinked says the Windows conversion it covered could not boot at the time of reporting. [TechLinked, 2026-11-24 02:15 UTC](https://www.youtube.com/watch?v=kibDx91B6eg&t=154s)
- **Rugged phones** — ShortCircuit lists a 20,000 mAh battery and a 64-megapixel camera on the Oukitel WP63. [ShortCircuit, 2026-11-22 18:37 UTC](https://www.youtube.com/watch?v=iTAsOxThOFA&t=12s)
- **Networks** — TechLinked reports that a new fiber-optic router was installed as part of an upgrade from copper equipment. [TechLinked, 2026-11-17 00:56 UTC](https://www.youtube.com/watch?v=w2VoBbhOVcQ&t=47s)

## Cost and headroom

The implemented daily assembler uses **0 input tokens, 0 output tokens and $0 in OpenRouter fees per briefing**. Upstream per-item analysis uses the existing model admission and budget. At readback the shared cap was $20 per UTC month. Commitment was $9.668564441061, including $4.430627191 unresolved, leaving $10.331435558939. The briefing adds $0 at any run count. This is incremental OpenRouter cost, with hosting, additional ingestion and upstream analysis outside the briefing calculation.

For a cost comparison, one future narration request at 12,000 input and 1,500 charged output tokens gives the estimates below. These are uncached public prices from 26 November. Any future narration path would need independent review, a spend reservation, verified routing and source grounding.

| Comparable current model endpoint | Input / output per million | Per request | 31 requests |
| --- | ---: | ---: | ---: |
| [DeepSeek V4.1 Flash, Relace](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints) | $0.12 / $0.50 | $0.00219 | $0.06789 |
| [GPT-6 Luna Pro, OpenAI standard](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-pro/endpoints) | $0.10 / $0.50 | $0.00195 | $0.06045 |
| [MiniMax M3.1 Flash, Together](https://openrouter.ai/api/v1/models/minimax/minimax-m3.1-flash/endpoints) | $0.15 / $0.60 | $0.00270 | $0.08370 |
| [GPT-6.1 Sol Pro, OpenAI standard](https://openrouter.ai/api/v1/models/openai/gpt-6.1-sol-pro/endpoints) | $2.00 / $10.00 | $0.03900 | $1.20900 |

Relace's advertised FP4 input price matches the automatic-video extractor profile and exceeds the older general DeepSeek pin of $0.07 per million. This read grants no routing or pricing change. The estimates exclude multiple calls, cache writes and larger reasoning output.

## Checked enablement after R1

Reviewed intent for the release owner. Apply only after the PM accepts the R1 release path, the exact main artifact and this daily-only change.

| Surface | Readback | Requested state |
| --- | --- | --- |
| Active web and jobs bindings | `DAILY_BRIEFING_ENABLED=false` | Literal `true` on both |
| Daily database control and reader schedule | Enabled | Verify the eligible workspace count, the chosen reader and saved local time |
| Daily scheduler transport | Shared five-minute trigger | Verify the existing trigger and queue consumer on the checked jobs Worker |
| Content review, provider budgets and reminders | Owner hold, existing limits, reminders off | Preserve the hold and enforce the existing limits and reminder state |

1. During the PM's paused release window, verify migration `20261126004132_daily_briefing_cutoff_evidence`, SHA-256 `dd7625e7ff320dbe9ccbd6b128ac5820dafc5b489582137270248c3e29d1a3f9`, against the journal and verify the three function definitions. Confirm the verified main build and acknowledged release checkpoint, exact serving web/jobs versions, Cloudflare ownership, revision, fenced previous host, paused state and drained work. The release artifact is the only code input.
2. Review a separate flag-only restoration receipt. The normal controller copies the previous serving policy, so a wrangler default edit or a normal deploy alone cannot enable daily. Under the same pause, use the existing checked platform staging and promotion functions to prepare new versions of both Workers from the exact verified artifact with only this flag enabled in the copied policy. Bind the transition to the read-back versions, artifact and binding hashes using a separate operation digest. Read the two staged flag values and all prior policy/binding values before promoting to 100%. Keep the prior version IDs for rollback.
3. Read back both newly serving version IDs, exact SHA, all policy values and the public health predicate. Save the flag-change receipt alongside the acknowledged release checkpoint. The checkpoint attests to the versions it recorded. The separate receipt attests to the new versions. Resume through the existing scope-bound checked restoration using the current paused revision. Stop if any identity, policy, migration, scope or revision differs. If the increment must be reverted, re-enter checked pause and restore the two prior versions before resuming.
4. Observe the next genuine saved local cutoff and its authenticated reader result. A finished worker frame proves transport only. A useful result requires the existing review state to allow at least one fresh cited topic. If everything stays held, preserve that state and report the private partial or awaiting-review day. Keep the useful-output gate and 72-hour clock open.

## 72-hour observation

Start the 72-hour clock after checked restoration, a normal ingestion-to-archive result, an approved analysis item and a genuine useful cutoff. Record the accepted SHA, epoch, saved reader timezone and local cutoff in UTC, and the start time after that first proof. Supply the previous scheduled cutoff and all cutoffs inside the next 72 hours. Derive UTC values from the reader's IANA timezone and the same rules as the worker. Example for 08:00 Berlin in winter:

```sh
PGSERVICE=therecap_observer node scripts/watch-daily-briefing.mjs \
  2026-11-26T07:15:00Z "$CHECKED_SHA" "$CHECKED_EPOCH" \
  2026-11-26T07:00:00Z 2026-11-27T07:00:00Z 2026-11-28T07:00:00Z 2026-11-29T07:00:00Z
```

Set `DAILY_WATCH_READER_ID` in the private environment and use a verified read-only database connection with access to the observation tables and budget read function. Schedule the same command once 15 minutes after each cutoff and once after 72 hours and the final cutoff's grace period. Retain each JSON receipt. The script runs a single `BEGIN READ ONLY` transaction and reports source checks and archived usable items, currently retained analysis and review states by update time, and the exact daily job, persisted coverage and scheduled frames. Analysis counters reflect current rows whose recorded update time falls in the window. They are supporting telemetry and do not reconstruct superseded states.

Exit 2 flags release/epoch or schedule drift, unavailable or paused budget, missing scheduled ingestion/daily frames, missing/late/failed snapshots, no approved output for an active day, invalid quiet coverage, or new usable archive content with no observed analysis or review activity. Exit 1 flags an unavailable read or invalid inputs. Quiet days with complete proof can pass after the initial useful cutoff. `complete=true` requires at least 72 elapsed hours, two or more observed normal cutoffs, and no alerts. Check retained cutoff receipts alongside the final aggregate. No watch schedule or clock was started in this lane.
