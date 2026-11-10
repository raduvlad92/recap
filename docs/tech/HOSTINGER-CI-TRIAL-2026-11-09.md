# Hostinger CI trial preparation

The founder said **“do it”** after the proposed isolated, resource-limited test-only trial on the existing Hostinger/Dokploy server. This authorizes the scoped runner qualification. It does not authorize a paid server/plan, billing change, production release, reader migration, provider/model execution, backup alteration or replacement of existing release evidence.

The candidate branch `ci/hostinger-test-trial-20261109` starts from exact reader PR #22 `3c93e91a4516515ff4590fd059786207b5cec076`. The original checkout and release entrypoints are untouched. [Package and operator procedure](../../infrastructure/ci-trial/README.md).

## Current evidence

- Current GitHub metadata still reports PR #22 open at that exact candidate. Its historical 4,321-test/102-migration results belong to the previous integration; they are not new evidence for this runner.
- Fresh repository runner-download metadata supplies official **2.338.2** x64 checksum `baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40` and ARM64 checksum `670adb2f268fe21dcbb58b3db0e0aa9d5b3bddfe2c651481336e561ff86de945`. The Docker recipe verifies the selected archive before extraction. The Node 22 base manifest is fixed at `sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d`.
- **67 new tests pass**, zero failures/skips. They cover exact merge/ref/run/attempt/event identity, expiry, environment rejection, cgroup bounds, complete zero-skip reports, fresh native intent, refusal of nonqueued jobs, one JIT POST across acknowledged/ambiguous failures, final-only readback, and exact-operation cleanup/busy refusal. GitHub operator tests use a constructed local CLI double with private isolated configuration; no network or real registration occurs.
- Bash/JavaScript syntax and resolved Docker Compose resource/mount checks pass. An initial local Compose assertion compared a numeric string with an integer; inspecting actual normalized output and converting numeric fields verifies the intended four-GiB limits. This was a verification type mismatch, not a changed limit.
- Independent environment review confirms Node **22 specifically**, nonroot PostgreSQL **17/pgcrypto**, disk-backed short temporary paths, and no Docker socket or production credentials for Cloudflare dry-run/workerd tests. Some older suites skip missing/root PostgreSQL; the new trial explicitly rejects those skips.
- Independent safety review initially finds four P2 issues. Parent fixes final-only immutable readback and operation-derived cleanup identity, with actual operator regressions. It also replaces reliance on same-UID timer/disk sampling with a separate host `timeout` and a fully preallocated eight-GiB private filesystem. The in-container watchdog remains supplementary. The new Linux host supervisor is source/syntax checked; its mount, deadline, quota, cleanup and actual job behavior still require native qualification. No second independent review or Hostinger pass is inferred.

The ARM64 image builds successfully at `sha256:ee5dcff3c2df92f314dbf983a512e0ba846865f5a8613e5764ef457cf75a7b77`. A credential-free, network-disabled local Docker probe verifies Node 22.23.4, runner 2.338.2, bundled action Node 24.22.1, UID10001, PostgreSQL17/pgcrypto via a private Unix socket, read-only root and actual one-CPU/four-GiB/no-swap/512-process cgroups. Three separate variants correctly refuse root, unbounded memory and writable root. All four probe containers and their volume are removed; fresh native Docker listings are empty for the qualification namespace. Six runtime source hashes match the actual image. Full reader/workerd-in-image and real GitHub job execution are not performed. These exact results are recorded in [the receipt](evidence/hostinger-ci-trial-2026-11-09.json). A local ARM64 Docker build is not a Hostinger build, Linux x64 proof, real GitHub job or accepted release artifact.

## 11 November access and capacity update

The founder completes external-Chrome sign-in and correct-account selection. Hostinger's existing root web console works; no additional key/token is needed. Native capacity shows only 2.00 GiB available RAM against the prepared six-GiB gate, so no runner is launched. [Current native observation and continuation](HOSTINGER-CAPACITY-2026-11-11.md). The access history and next-action description below record the earlier 9 November checkpoint; follow this update for current access.

## 9 November access blocker (historical)

The remote-environment link/list tools are not callable. No SSH configuration/identity or `op` CLI is available. The existing Dokploy site is reachable but the T3 preview is signed out. Native browser integration is unavailable; the existing Chrome session is in active human use and rejects input with “The user changed …”. Stop interacting with it. The owned preview tab is closed.

Two secure Dokploy API-key requests expire without an answer; no credential is received. No request for Supabase, Clerk, provider, model, backup or production deployment credentials is needed for the trial. Do not inspect or repurpose another project's credentials. Current server capacity, architecture, kernel, Docker state, applications and backups have **not** been inspected, and no remote runner/container, routing variable or GitHub registration has been created.

## Next action

Provide authenticated Dokploy/server management access through the secure credential mechanism. Then inspect native capacity and existing workloads, qualify the exact image on the host, deliberately enable the new test-only workflow, bind its fresh queued PR merge/run/attempt, create one JIT configuration and execute under the external supervisor. Obtain terminal native GitHub/host/resource evidence, remove the exact registration/container/volume/private filesystem/JIT, disable the trial route and verify original workloads. The detailed procedure refuses changed/expired identities and ambiguous JIT retries.

The test workflow is disabled by default, uses `contents: read`, accepts only this repository/branch/reader target and has no production secret references. The existing release workflow and its provenance checks are unchanged. Successful test-only execution would be engineering evidence, not permission to merge/deploy the reader release.

No paid service is purchased and no paid supplier/model execution occurs. Existing local compute/build bandwidth is unmeasured; the current Hostinger bill and GitHub account balance are unknown. No extra hosting-cost claim or billing unlock is made.

Primary references: [GitHub runner hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts), [ephemeral/JIT runners](https://docs.github.com/en/actions/reference/runners/self-hosted-runners), [act compatibility limits](https://nektosact.com/not_supported.html).
