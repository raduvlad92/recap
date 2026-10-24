# OpenRouter video analysis and admin selection

Founder selected OpenRouter and supplied the production key on 24 October 2026. They explicitly restricted analysis to these four IDs and selected DeepSeek as the default:

| Model | Prepared pinned endpoint | Input / output USD per million tokens |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash-1017` — default | DeepInfra, `deepinfra/fp8` | 0.098 / 0.294 |
| `minimax/minimax-m3.1-flash` | Together, `together` | 0.15 / 0.60 |
| `openai/gpt-6-luna-pro` | OpenAI, `openai` | 0.10 / 0.50 |
| `openai/gpt-6.1-sol-pro` | OpenAI, `openai` | 2.00 / 10.00 |

These are dated public inference rates, not measured account spending or output-quality proof. DeepInfra's current discount is part of its price ceiling: if it ends, requests stop rather than moving to a costlier endpoint. Native DeepSeek/MiniMax endpoints do not advertise the strict structured-output support needed here, so the same requested model is pinned to a qualified endpoint. No automatic provider/model fallback is allowed. [Dated public metadata](evidence/openrouter-preflight.json), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [routing controls](https://openrouter.ai/docs/guides/routing/provider-selection).

## Administration

Open **Administration → AI analysis** to select and save a model. Only the four exact IDs are accepted by the interface, authenticated backend, private database setting and OpenRouter adapter. The default saved model is DeepSeek. Selection persists without a redeploy. A stale save is rejected; reload before retrying. The setting update and audit entry are atomic.

Saving a model changes the selection and policy model only; it never enables analysis, increases a budget, starts a supplier job or rewrites completed recaps. Changing models can pause unfinished analysis when existing calls belong to a different execution identity. Unknown-charge holds remain reserved. More expensive models can pause at the current per-call allowance; selecting one never silently increases that allowance.

The panel shows server-key presence, runtime/global spending gates and current global limits. **Check connection** verifies the key through a fixed, read-only OpenRouter request from the server. It does not generate content, return the key or disclose account identifiers/balances.

## Credentials and operating controls

The existing `OPENROUTER_API_KEY` is configured as a Netlify secret with production Functions scope. Off-host tools receive a mask; the assistant does not extract or copy the key. No further key setup is requested. It is never placed in a client-prefixed variable, source, Git or chat.

The worker reads the private saved model before constructing its configuration. Reviewed server profiles override stale environment model/provider/rate settings. Common bounds are 12,000 characters per chunk, 90 chunks, one million saved source characters, 4,096 maximum output tokens and a conservative 128,000 input-token bound. Current maximum call reservation is US$0.01. A model that cannot fit is paused; content is never silently shortened and spending limits never rise with selection.

The exact OpenRouter URL is `https://openrouter.ai/api/v1`, with its own key. Requests use strict JSON Schema, supported-parameter enforcement, pinned routing and rate ceilings. SDK retries are disabled and the body deadline is 45 seconds. Response model and available provider metadata are checked; absent provider names remain unknown. Response-ID candidates from public metadata must be confirmed against actual bounded replies; no guessed prefix/version normalization is used.

The ledger records immutable adapter, route, provider, model, reasoning and pricing identity before a request. Cached-request fingerprints also bind prompt, schema, output limit and response verification pins. Changed settings cannot reuse unrelated cached output or bypass an uncertain charge by changing the stable job/chunk key. Legacy calls with no identity remain unknown.

Reported `usage.cost` is retained as observed account usage. Settlement requires explicit `is_byok=false`; missing/BYOK accounting retains the reservation because another upstream account can be billed. Upstream cost fields are not substituted for charges to OpenRouter credits. [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting). GPT-6.1 Sol uses supported low reasoning rather than unsupported none; output limits include reasoning tokens. [Official OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/latest-model).

## Verification and remaining work

Implementation/local checks, database authorization, push/CI/deployment, actual admin use and real model output are separate evidence. Generation remains disabled during integration and release review. Next: deploy, verify the server connection and four-model selection, then run a bounded DeepSeek quality sample through the durable ledger before recurring backfill. Preserve complete originals, media, preferences and prior review decisions. Verify sponsor/outro names, ambiguous identities, citations, partial timing, genuine empty results, token/cost accounting and reader persistence.

The separate proposed model controls remain US$0.10/day, US$1 lifetime and US$0.01/call; no subscription, billing-plan change, uncapped automation or daily briefing is added. The whole saved backlog may require more than one daily allowance. Existing supplier controls are unchanged.
