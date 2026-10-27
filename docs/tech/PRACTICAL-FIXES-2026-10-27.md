# Practical analysis fixes — 27 October 2026

The founder approved the recommended repairs and a small follow-up test, with the instruction to prioritize easy fixes that make sense. This work keeps the existing engine and database design. Twenty-video generation and backfill remain off.

## Small changes

- Keep a keyword phrase's existing real cue ranges when combining proposals. Its lookup already includes every occurrence of that exact phrase. Other variants keep their separate proof; their timestamps cannot migrate onto the retained phrase.
- Compact keyword correction requests: encode the same lexical-unit IDs/text as pairs and send only proposal IDs to the model. Full immutable parent hashes and proposals remain in the host audit and paid call records. Summary correction lineage is unchanged.
- Omit two null-only fields from compact keyword lineage. This removes duplicated empty audit data while retaining every proposal, variant and proof hash. Non-null values stay intact. The 480,000-byte result limit is unchanged.
- Clarify existing instructions: prioritize the main review verdict or explanatory lesson and retain material qualifications. Preserve every explicit named entity, including passing/sponsor/outro mentions, while avoiding incidental generic words and redundant category inflections. Use consistent kinds for hardware models and technologies. No title-based shortcuts, new source-reference framework or special cases for the three videos.

The revised v4 contract is **`6388be0aca7cd311339cb258c88486d52ba81adef38911bd6554383ee64bab91`**, revision `grounded-v4-20261027-2`. Changed prompts require fresh request bindings; old paid requests and their outcomes remain unchanged. The existing v3 protocol is unchanged. The additive database patch preserves both the old v4 hash and the exact new hash, permits the first DeepSeek comparison in the existing suites, and retains all financial/unknown-hold fences. No new tables or services are introduced.

## Saved-response checks

Three regressions fail before the timing fix and pass afterward, covering wrong seek ranges and the whole-task rejection when a retained full phrase has no own timed cue. An additional regression verifies correction compaction without losing source units, proposals or the full host audit. All **2,818 local tests / 79 files**, typecheck, production build and catalogue checks pass. The one fixture that read the former correction format was updated without weakening its reservation/invalidity/replay assertions.

An offline counterfactual matches **38 saved request hashes and provider identities**, then completes the three formerly timing-blocked cases under the code repairs: Luna power supply 5 mechanically accepted/21 pending; Sol power supply 29/27; Sol upscalers 86/64. This is **zero-spend counterfactual evidence**, not a fresh model trial, publication, permission to reopen failed jobs or semantic approval. The earlier host-only attempt exposed the result-size limit; removing reversible null defaults reduces that draft from **491,260 to 455,228 bytes**. Reinstating the omitted nulls reproduces the prior evidence exactly.

Under the revised prompts, the four previously oversized keyword corrections measure **25,794 / 24,428 / 26,448 / 27,552** conservative input units, all below 27,700. Every source passage, lexical-unit ID/text pair, invalid candidate, proposal count/order and full host lineage is preserved. These input-size counterfactuals reuse old invalid values for measurement; they do not pretend old answers belong to new request hashes. The tightest margin is 148 units; future larger corrections still stop before spending.

## Small follow-up and spending boundary

Use the existing default **DeepSeek** on the same three frozen videos for recaps and keywords. Keep the existing common 1,250-character chunks, 3,072 output tokens, 27,700 input guard and US$0.10/call. The [current Relace endpoint metadata](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints) matches the pinned rates and structured-output support, giving at most **US$0.003475 per admissible call**. The complete graph permits at most 79 recap and 96 keyword calls: **US$0.608125** total maximum reservations. Separate finite caps are **US$0.275 recaps and US$0.334 keywords**, US$0.609 combined. Oversized requests stop without a reservation; a known-settled base gets at most one eligible correction; terminal verifier failures remain terminal.

Fresh controls at **10:00:54 UTC** confirm runtime-independent database spending Off, zero active jobs, eight closed admissions, DeepSeek revision16 and 255 model calls. Cumulative commitment is **US$3.534673560**, including all four unresolved holds totaling **US$0.013753066**. Original remaining allowance is **US$1.465326440**. The proposed US$0.609 cap leaves at least **US$0.856326440** under the existing US$5 total, without releasing a hold or renewing an old allowance. Actual follow-up execution, charges, semantic review, off-deployment and preservation will be recorded separately. No new model request has occurred at this preparation checkpoint.

Raw sources, responses, operator evidence and reversible-output proofs remain in ignored private paths. Model usage is separate from unmeasured hosting/database/supplier costs. All comparison outputs remain private until separately accepted for publication.
