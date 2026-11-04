---
status: accepted
date: 2026-11-04
---

# Suspend and drain Cloudflare deployment CI before the local handover

The initial operator keeps Supabase Management and repository-variable authority local. Its Git checkpoint does not acquire the Actions concurrency group used by automatic Cloudflare delivery. `HOSTING_TARGET=paused` still permits safe shadow deployments, so that variable cannot serialize the operator with CI.

Before a future live local handover or recovery, temporarily disable only the fixed Cloudflare deployment workflow and wait for **all** of its already admitted runs to finish. A disabled workflow is not evidence that its existing runs stopped. Check exact main identity, fixed workflow ID/path/state and every nonterminal run status, without branch/SHA/event filters, again before each native action. Incomplete inventories, re-enabled/changed workflow metadata or a moved main head stop progression. Keep the ordinary check workflow and native Netlify build pause intact.

This reuses the existing operator authority and avoids distributing global Management credentials to CI or creating another lock service. It trades continuous automatic delivery during the maintenance window for explicit operator ownership of suspension/restoration. The operator must keep the workflow disabled throughout native work, then enable it only after the acknowledged completed handover/recovery and exact live readback. Ambiguous failures retain the suspension for controlled recovery; do not automatically enable it in a cleanup/finally block.

The current increment implements a read-only guard and executor enforcement. It does not disable/cancel/re-enable a workflow, claim a live acquired maintenance window or expose an apply CLI. The guard cannot override another repository administrator; unexpected manual changes remain a stop condition. Genuine private parity, usable recovery, the durable suspension/restoration wrapper and complete native switch/recovery verification are still required.

[Implementation and exact evidence](../tech/CLOUDFLARE-QUIESCENCE.md).
