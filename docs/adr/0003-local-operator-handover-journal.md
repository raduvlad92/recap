---
status: accepted
date: 2026-11-04
---

# Keep initial hosting handover authority local with an atomic Git journal

The initial migration needs the existing local Supabase Management authority to revoke only Netlify's database key and the existing repository-owner authority to select automatic deployment. The CI GitHub App can write Checks; the local OAuth token cannot. Exporting global Management authority to CI or assuming those identities have interchangeable permissions would broaden access unnecessarily.

Use the existing local repository authority to persist sanitized initial-handover and rollback checkpoints on the fixed `ops/therecap-hosting-journal` branch. Contents API writes must name the previously observed blob SHA, and exact native readback must acknowledge the complete plan/state before another provider mutation. Reconcile a lost write only when the exact intended payload is present; otherwise require restoration of the acknowledged checkpoint. Keep the GitHub App Checks transport for CI probes and ordinary releases.

The operational branch is never merged or executed. Both current push workflows target only main; legacy Netlify builds are stopped. Checkpoints admit only the validated full-artifact plan, phase/revisions, sanitized native intents and deployment-selection witness. They contain no credentials, private reader records or supplier response bodies. Probe records use a distinct non-restorable format.

This trades CI-only orchestration for dependence on local operator availability, GitHub Contents availability and Git history. Expected-blob writes protect journal updates; they are **not** a provider execution lock. A future live entrypoint must also establish serialization with the existing production delivery workflow before enabling mutations. The current composition library exposes no apply CLI, and a storage probe does not authorize cutover. Private parity, usable active recovery and complete native switch/recovery verification remain separate gates.

[Implementation and evidence](../tech/CLOUDFLARE-EXECUTOR.md).
