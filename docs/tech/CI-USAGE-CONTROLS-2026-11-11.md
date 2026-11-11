# CI usage controls

The November owner billing exports attributed 950 hosted Linux minutes to recap before it became public. `Check recap` repeated catalogue validation, Vitest and the application build already performed by `Verify and deploy Cloudflare`; 48 identical commit/event groups ran both workflows during 1–7 November.

The release workflow now owns the single verification path. The redundant `check.yml` is removed; no branch protection or repository ruleset required its `check` context at inspection. The remaining workflow still validates catalogue data, every test assertion, native PostgreSQL 17, application/Workers builds, exact release artifacts and checkpoint storage. Its path filters also cover actors, assets, data and all Supabase source. Documentation-only changes do not start application verification.

Superseded PR runs cancel. Main/manual release runs retain their serialized, non-cancelling production group. Verification has a 20-minute deadline, artifact/checkpoint probes five minutes, active preparation ten minutes and deployment 30 minutes. PRs still receive no production deployment credentials. Existing deployment-selection, drain, source, publication and financial holds remain in force.

The repository was independently verified public on 11 November. Standard public GitHub-hosted runner compute does not draw on the owner's private-repository allowance; artifact storage and larger runners have separate billing. No visibility or payment setting is changed by this patch.

The Hostinger trial remains disabled and unqualified. Its native capacity observation found only 2 GiB available RAM against the existing 6 GiB launch guard. The public-runner alternative has passing real CI evidence; reducing that guard or displacing production workloads is unnecessary. See [capacity](https://github.com/raduvlad92/recap/blob/524314135002d858f9e21cb9d87ddbe511840130/docs/tech/HOSTINGER-CAPACITY-2026-11-11.md) on trial PR #23 for that separate evidence. No trial code is merged or runner provisioned here.

Validation of this workflow-only change: actionlint and current-head GitHub verification. Application release and runtime health remain separate evidence.

After PR24 merged, main verification passed and automatic delivery correctly stopped at the existing release gates (`release_gates_blocked`). CI-only changes now skip automatic delivery/active preparation when the before/current commit comparison contains no application, test, build, catalogue or runtime input. Manual handover/release dispatch remains explicit and keeps all release checks. Unreadable comparison identities fail the job rather than skipping an unknown change. No gate or production selection is weakened.
