# Autonomous named-mention learning — 27 October 2026

**Completed: the selected prompt is Good for this small private evaluation.** All five training cases pass, averaging **9.84/10**, with **127/127 required identities in the expected state**. Two withheld cases retain all **37/37** known required identities on their first run. Their initial strict reference gate flags five unlisted aliases; a separate source-only audit resolves those flags without changing the frozen prompt. Final audited total: **164/164** required identities correct across seven cases.

[Sanitized measurements and costs](evidence/keyword-autonomous-loop-2026-10-27.json) · [Frozen prompts and settings](keyword-autonomous-prompts-2026-10-27.json) · [Earlier five-case attempt](KEYWORD-LEARNING-RESULTS-2026-10-27.md)

## What ran and what it learned

The founder instructed the assistant to keep testing and learning without asking the founder to grade individual failures. The runner now executes extraction, checking, scoring, diagnosis and revised prompts in a bounded loop. It saves failed attempts, rejects regressions and source-specific answer lists, and retains improvements.

The selected process has three extraction methods and one additional checker:

- DeepSeek reads the full saved transcript directly.
- A separate DeepSeek call sweeps named categories independently.
- Focused source-only patterns supply additional candidates without model charges.
- GPT-6.1 Sol Pro checks the candidate union and complete source, including brief mentions and ads.

The checker returns every candidate's name, kind and disposition, plus missing names. Removing explanation fields reduces output length; it does not remove decisions, kinds or coverage checks. The selected output cap is 2,000 tokens. Code finds literal occurrences and applies explicit boundary guards while preserving original model verdicts.

**Nineteen optimizer proposals** and **sixteen configurations completing all five cases** were assessed, alongside incomplete attempts. Longer instructions and extra prose did not reliably improve results. Focused patterns reduced generic candidate noise; compact feedback preserved complete source texts while showing the optimizer actual failures. The stronger compact checker completed the final set. This is saved, versioned prompt learning, not model-weight training.

Longer private checks use background execution with authenticated result polling; dispatch acceptance never counts as success. Unknown calls remain held and are not redispatched. Settled answers are reused only after source, request, execution-identity and server-result verification. [Netlify documents this asynchronous background model](https://docs.netlify.com/build/functions/background-functions/).

## Final scores and reference corrections

| Ordinal | Phase | Score | Required correct | Result |
| ---: | --- | ---: | ---: | --- |
| 1 | Training | 9.9 | 11/11 | Good |
| 2 | Training | 9.7 | 45/45 | Good |
| 6 | Training | 9.9 | 34/34 | Good |
| 10 | Training | 9.8 | 11/11 | Good |
| 20 | Training | 9.9 | 26/26 | Good |
| 14 | Withheld, audited reference | 9.9 | 14/14 | Good |
| 15 | Withheld, audited reference | 9.7 | 23/23 | Good |

Before held-out generation, source-only reference corrections added **US** and **Max** as required mentions, added three optional technical terms and moved one generic term from required to optional. These corrections are recorded separately from prompt improvements.

The prompt froze at **20:57:43 UTC**. Both withheld outputs immediately preserved all 37 known required identities, but reference v6 gave **9.7/9.2 and zero strict passes** because five accepted literal aliases were unlisted. A separate source-only audit confirmed those five as aliases of existing identities. Reference v7 adds their literal forms; the required total remains **164**. Regrading gives **9.9/9.7, both Good**, with no prompt change or additional model call. The initial blind v6 gate did not pass.

The same v7 reference was applied to **127 saved reports**, preserving originals. On that common reference, the earlier v3 process averages **9.30**, versus **9.84** for the selected process. The scoring formula and thresholds remain unchanged.

All **193 accepted label rows** occur literally in their sources. There are seven raw review suggestions; only six are literal. One normalized spelling suggestion was demoted by the host and never entered accepted output or the usable literal inventory. Accepted labels also include optional technical terms, so their count is not a count of distinct required proper names.

## Costs and closed controls

| Model | New calls | Settled reported USD | Unknown holds USD |
| --- | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 95 | 0.091569200 | 0 |
| GPT-6 Luna Pro | 24 | 0.075553595 | 0.112074125 |
| GPT-6.1 Sol Pro | 17 | 0.608016300 | 0 |
| **Total** | **136** | **0.775139095** | **0.112074125** |

There are **133 settled calls and three unknown calls**. Largest reported call: **US$0.051572**. The finite continuation ceiling rose from US$1 to **US$1.10** for verification within the existing **US$10 cumulative / US$5 daily / US$0.10 per-call** limits; no allowance or hold was reset.

Cumulative commitment is **US$4.505271140**, including **US$0.125827191 total holds**. Daily commitment is **US$4.445195571**. All five new sessions are closed. Production/global/owner analysis remains Off, DeepSeek remains default at revision18, and active AI jobs are zero.

## Verification and next step

All **2,937 local tests / 83 files**, typecheck, build and catalogue checks pass. Functional `e058cb79` passed [CI40578717741](https://github.com/raduvlad92/recap/actions/runs/40578717741). Exact Netlify deploy `6ae10acb5b3565e9e6103bab` is ready, published **20:34:56 UTC**. Closed-session hosted readback matches the saved result and charge (200); fresh preflight is refused (403), without another model call.

All **367 old calls, 501 old archives, 431 jobs, three workspaces and 96 reviews** remain exact. Existing hourly collection separately added three archives.

Good means this small audited saved-text set passes. Captures remain partial/unverified; references are assistant-audited, not exhaustive human gold. These examples do not establish universal accuracy across subjects, languages or platforms. No twenty-video run, backfill, reader keyword publication or production-default change occurred. The next step is the previously requested joint decision about twenty videos; no owner grading remains for this loop.
