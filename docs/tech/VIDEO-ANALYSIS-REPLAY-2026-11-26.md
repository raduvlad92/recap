# November video analysis replay and enablement proposal

The offline replay produced **210 structurally valid drafts from 241 selected jobs (87.1%)**. Among the 88 videos with both tasks selected, **69 produced both drafts (78.4%)**. Hold broad activation. The first paid wave should test the 90% bar on ten short videos within the $0.75 cap, with review still required. Spend for this work was **$0**.

## Replay results

The frozen November 25 owner manifest selected 241 jobs on 153 of the 155 original videos. The [historical receipt](https://github.com/raduvlad92/recap/blob/580694c/docs/tech/QUEUED-VIDEO-RERUN-2026-11-25.md) recorded 112 draft-producing jobs, 3,297 draft items and 93 videos with at least one draft. The offline replay ran main `c36b588`, which contains the `b90b7b6` analysis fix. It rebuilt each of the 218 claimed tasks from the exact saved session and transcript hash. It matched the 17 never-claimed, over-limit recap jobs against their exact archived hashes and counted the six unclaimed same-video charge holds separately.

| Original outcome | Valid offline | Evidence |
| --- | ---: | --- |
| Prior draft | 112/112 | Replacement responses simulated |
| Malformed JSON | 44/44 | 44 exact settled response bodies, simulated retries |
| Output capacity | 18/19 | 19 exact settled truncations, simulated splits. One checker had a single candidate and stopped |
| Over-limit recap | 17/17 | Exact original transcripts from 117,252 to 232,555 characters, simulated responses |
| Unresolved charge after claim | 0/20 | Retained unresolved receipts, no generation attempted |
| Unresolved charge before claim | 0/6 | Held by the original manifest, no generation attempted |
| Changed finding / invalid check | 7/7 and 3/3 | Simulated replacements |
| Empty recap / failed reduction / unsupported draft | 2/2, 2/2 and 1/1 | Simulated replacements |
| Invalid learning input / generation failed | 3/3 and 1/1 | Simulated replacements |
| Storage unavailable / budget exhausted | 0/3 and 0/1 | Simulated stops preserved |

A structurally valid draft has one to six short takeaways with exact quotes or one to 15 literal keywords. The replay checked the request wire and per-call admission limits, then ran the existing review proposal validator on the output. Its 63 retained provider failures were injected at the matching checker role. Old successful results belong to different request shapes and often a different checker model, so replacement completions use deterministic mocks. The remaining 152 exercised jobs use mocks only. The replay simulates favorable checker judgments for replacement outputs. It measures recovery and source binding. Human usefulness, attribution, veracity, settlement and the live 90% target still require real evidence.

Of the 123 failure jobs in the earlier plan, **98 passed offline (79.7%)**, or **98/103 (95.1%)** excluding the 20 already-held charges. Across the whole selected set, **141/153 videos (92.2%)** produced at least one draft. Flow 4 requires both drafts and uses the per-video rate. Sixty-five selected videos had just one task in the replay manifest. Earlier completed or withheld jobs do not count as new successes.

## Three-channel cost

Current OpenRouter rates are **$0.12 input and $0.50 output per million tokens** for the exact Relace DeepSeek Flash route and **$2 input and $10 output** for the standard OpenAI Sol Pro route. The latter charges $2.50 per million cache-write tokens and $0.10 for cache reads. OpenRouter metadata reads on November 26 used no model calls. [Relace endpoint](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints) · [OpenAI endpoint](https://openrouter.ai/api/v1/models/openai/gpt-6.1-sol-pro/endpoints)

The database held 36 distinct captioned videos across the three pilot channels, published October 27–November 25 UTC. This is observed archive volume. A zero-network replay of both tasks for each transcript measured 516 shaped requests. The base case uses four request characters per input token and 700 DeepSeek or 500 Sol billable output tokens, bounded by each request's output ceiling. The stress case uses three characters per input token and twice the outputs, with the same ceilings. Costs assume uncached input. Real reasoning, caching, retries and charge holds can move costs in either direction. Historical December planning should be replaced with actual settled usage from the paid wave.

| Channel | Archived videos / 30 days | Base / video | Stress / video | Base / 30 days | Stress / 30 days |
| --- | ---: | ---: | ---: | ---: | ---: |
| TechLinked | 16 | $0.054 | $0.087 | $0.87 | $1.39 |
| ShortCircuit | 10 | $0.096 | $0.151 | $0.96 | $1.51 |
| GamersNexus | 10 | $0.244 | $0.381 | $2.44 | $3.81 |
| **Total** | **36** | **$0.118** | **$0.186** | **$4.26** | **$6.70** |

At 90% yield this is **$0.132 base or $0.207 stress per video with both usable drafts**. The recovery cohort costs more. Both drafts average $0.269 across the 69 valid pairs. The 17 long recap tasks alone average $0.264 base and $0.412 stress, which can exceed the current $0.30 session budget, especially with a full $0.10 reservation needed for the next call.

The November 26 read-only ledger showed **$9.668564 committed against $20**, including $4.430627 unresolved. Arithmetic headroom was **$10.331436**. At 00:58 UTC the global and pilot-owner model day gates each had **$4.025827 committed against $5**, leaving **$0.974173** after carrying unresolved calls forward. Recheck both gates before a paid wave. As a conservative one-month illustration, including that entire commitment, the $0.75 proof, a $6.70 stress month of model usage and $0.144 at the observed $0.004 acquisition fee for 36 new transcripts totals **$17.27**, leaving **$2.73** for other charges. The transcript fee estimate excludes idle checks, retries and new scope. The shared ledger, active owner/day limits, per-call reservation and finite sessions remain the live controls. [Six-transcript supplier proof](YOUTUBE-LIVE-PROOF-2026-11-25.md) · [Monthly budget rules](MONTHLY-PROVIDER-BUDGET.md)

## Proposed first paid wave

1. Wait for the PM to accept the exact post-R1 release containing #39. Verify the Worker readback and migration `20261125174500`, provider routes and current policies. Read-only evidence on November 26 showed that migration installed while the health endpoint and both Workers still served `6a794cb`. Both live automatic-analysis flags were false. The rollout test remains pending.
2. Freeze ten short, current transcripts and both task IDs/revisions before launch. Prioritize a new/recent profile with balanced coverage where the cap permits. The ten lowest-cost three-channel profiles cost **$0.370 base and $0.611 stress**. Including at least one archived video per channel raises this example to **$0.452 base and $0.742 stress**, which leaves too little for the next $0.10 reservation. Qualify short videos first. Run an all-channel or long-video wave only under a separate verified envelope.
3. Keep the scheduled worker off. Use a checked, private manifest-bound dispatch with a **$0.75 transactional commitment ceiling** applied before every call, including retries, repairs and splits. Count the greater of actual or observed charges for settled calls and full reservations for in-flight or unknown calls. Rehearse a refused eighth $0.10 reservation and a retry after a partial settlement on a disposable database. The existing monthly control cannot enforce a separate batch ceiling by itself. The private guard and exact-session dispatch need to be prepared and separately authorized before this wave can run.
4. Run one frozen video at a time. Verify original citation/keyword evidence, pending status, actual settlement and per-video cost after each. Stop on source or release drift, unresolved billing, unknown result, or insufficient headroom. Count any preselected video skipped for cost as missing. A separate reviewer checks usefulness, literal identity, attribution and omitted qualifications before crediting a video.
5. Take the first-wave gate as **at least nine of the ten frozen videos with both acceptable drafts**, no public publication and at most $0.75 committed. Report each failure, both task denominators, usable videos and total spend. Ten short videos can clear this sample gate. The production-wide 90% target still needs representative ongoing results across all three channels and duration bands.

## Checked path to automatic drafts

- After the paid sample and a representative follow-up pass, verify one intended enabled reader policy and its immutable enrollment cutoff, allowed inputs, live owner/global day limits, session size and model route. The current read found one enabled policy with **$0.30 per task and 100 calls**, and zero queued automatic tasks. Read back which sources are eligible under that policy and cutoff. The existing sync reads eligible followed-archive rows and has no three-channel or new-only override. If anything beyond the approved cohort would queue, keep the switch off until checked admission can enforce that scope.
- Through the usual checked release, set **`AUTOMATIC_CONTENT_ENABLED=true`** on the jobs Worker and make the web binding agree for status readback. The five-minute jobs schedule requires an explicit true value for automatic-content. Its private generation and verification RPCs use the finite-session handler. There is no need to turn on the general `CONTENT_ANALYSIS_ENABLED` cron or the separate `KEYWORD_LEARNING_ENABLED` entry point. Verify the private routes, existing worker-secret binding and both serving configurations inside the release checkpoint before restoring the schedule.
- Observe the next two genuine five-minute frames. Require matching release, epoch, revisions and current-source receipts, both held draft types, correct commitment deltas and zero publication without an explicit owner review decision. Leave the owner’s earlier held proof pending. If any check fails, return the flag to false through checked operations and preserve uncertain calls and task history.

[Offline replay totals](evidence/november-video-replay-2026-11-26.json) · [Cost inputs and totals](evidence/november-three-channel-cost-2026-11-26.json) · [Network-disabled runner](evidence/replay-november-video-analysis.mts)

The runner uses a private JSON array of saved task/snapshot records. Each item binds `video`, `task`, `legacyId`, `failure`, `metadata`, `content`, and `content_hash`, with the recorded calls where applicable. Held rows only need the original outcome and relevant receipt metadata. Compile with `node_modules/.bin/esbuild docs/tech/evidence/replay-november-video-analysis.mts --bundle --packages=external --platform=node --format=cjs --outfile=.local/video-replay.cjs`, then run `node .local/video-replay.cjs <private-manifest.json>`. Reports include aggregate counts and the input digest. Original source text, model replies, private IDs and financial receipts stay in private storage.
