# Isolated test-only CI trial

**11 November: the founder selects the local Mac runner.** Local containment and environment probes pass; the real GitHub trial is next. [Current local evidence](../../docs/tech/LOCAL-CI-TRIAL-2026-11-11.md). Hostinger's RAM blocker below remains historical and unchanged.

## Local Mac execution

Use Node22 and the existing exact qualified ARM64 image. `local-supervise.mjs` runs outside the job and manages only its UUID-labeled Linux scratch/input volumes and one checked loop device. The trusted setup helper has SYS_ADMIN only for its selected loop; the job drops all capabilities and has no devices, Mac binds or Docker socket. The original limits and fresh native operator intent remain required.

```sh
node infrastructure/ci-trial/local-supervise.mjs qualify .local/NEW_QUALIFICATION_DIRECTORY sha256:QUALIFIED_IMAGE_ID
node scripts/ci-trial/operator.mjs prepare PR_NUMBER RUN_ID local-qualification .local/NEW_PRIVATE_OPERATION
node scripts/ci-trial/operator.mjs jit .local/NEW_PRIVATE_OPERATION
node infrastructure/ci-trial/local-supervise.mjs run .local/NEW_PRIVATE_OPERATION sha256:QUALIFIED_IMAGE_ID
node scripts/ci-trial/operator.mjs readback .local/NEW_PRIVATE_OPERATION
node scripts/ci-trial/operator.mjs cleanup .local/NEW_PRIVATE_OPERATION
```

The trial variable must be deliberately enabled for one fresh PR run and removed/read back absent afterward. Preserve final job/report/cleanup receipts and remove the original local JIT only after container/input-volume/registration cleanup. Do not rerun the same operation directory; ambiguous JIT custody retains its original intent. `deadline-probe`, `disk-probe` and constructed `inputs-probe` modes qualify containment without contacting GitHub or creator/provider/model services.

The founder authorized this trial on 9 November 2026. It is a candidate for running Therecap's checks on the existing Hostinger/Dokploy server. **11 November: native console access works, but available RAM fails the launch gate (2.00 GiB versus six GiB required).** Do not launch on this host in its observed state. [Native capacity checkpoint](../../docs/tech/HOSTINGER-CAPACITY-2026-11-11.md). Local Docker probes remain separate from Hostinger runner qualification.

The official GitHub runner preserves real GitHub job identity; `act` cannot supply the existing production release authority. This package does not change the existing release workflow, required checks, deployment journal, database migrations, runtime flags, caps or reminders. No production credentials belong in the runner. The private backup containers and their schedule are outside this operation.

## Scope and containment

- One repository, one PR merge SHA/ref, one workflow, one run/attempt, and one job. The source and target branches are fixed in `policy.mjs`. The workflow is disabled unless `RECAP_CI_TRIAL_ENABLED` is exactly `true`.
- Official GitHub runner **2.338.2**, with separately published x64/ARM64 checksums from the repository runner-download API. The Node 22 Debian base is bound to its manifest digest. PostgreSQL 17/pgcrypto is installed at build time. Apt packages are resolved during build; qualify and use the resulting exact image digest. This does not promise bit-identical rebuilds from apt.
- UID/GID 10001, read-only root, all capabilities dropped, no-new-privileges, no published ports, no existing host workspace or Docker socket in the job, no production credentials. The only source checkout comes from the pinned GitHub job.
- **Hard runtime bounds:** one CPU, 4 GiB memory with no swap, 512 processes, and an external host-side deadline of at most 30 minutes with shutdown grace. The in-container watcher is supplementary: job code shares its UID and could stop it. It is not independent containment.
- **Hostinger scratch:** a fresh, fully preallocated 8 GiB ext4 image, loop-mounted only for this operation, then exposed as the private scratch volume. That separate filesystem bounds writes even if the job stops its own watchdog. The 15-second `du` check is a soft early-stop check, not a quota. The host script requires at least two CPUs, 6 GiB available RAM, 20 GiB free disk and cgroup v2 before allocating anything. These requirements still need native confirmation.
- Exactly one JIT credential, never a personal/admin GitHub token. Job permissions are `contents: read`; checkout does not persist credentials. The operator's GitHub credential stays on the operator machine. No `.env*`, service credentials or backup files are copied into the image or job.

## Build and local qualification

Build from this small dedicated context, which excludes the application, Git metadata and private files:

```sh
docker build -t therecap-ci-trial:qualification infrastructure/ci-trial
node --test tests/ci-trial.node.mjs
bash -n infrastructure/ci-trial/supervise.sh
```

The recipe supports Linux x64 and ARM64. A build on one architecture does not qualify the other, the Hostinger kernel, cgroups or workerd behavior. Save image ID/digest, source hashes, versions and the actual bounded environment probe. Transfer a checksum-verified Docker image archive if no private registry is configured; a local `sha256:IMAGE_ID` is an immutable permitted reference. No registry subscription/credential is required. Compose never pulls or builds on the production host. Do not run an unqualified tag there.

The job requires Node 22 and PostgreSQL 17, fails on UID0/missing pgcrypto, runs the full Vitest suite with one worker, then the standalone guarded migration and runner tests, catalogue/build and Cloudflare shadow/runtime checks. JSON/TAP results must contain zero failed, skipped, cancelled or todo tests and the full reader test inventory. Successful optional skips are rejected. Worker harness networking is controlled/blocked; no source container is built or started.

## One native trial

1. Obtain current authorized Dokploy access and native server identity/capacity. Verify the qualified architecture/image, cgroup v2, actual spare CPU/RAM/disk and unrelated application/backup state. Make no paid upgrade, global Docker change, filesystem repartition or backup modification. If capacity is insufficient, stop and report it.
2. Publish this branch as a draft PR targeting `review/full-reader-release-20261108`. The new workflow is inert with the enable variable absent. Deliberately enable only `RECAP_CI_TRIAL_ENABLED`, create a fresh native PR event/run and capture the exact queued job. Existing hosted jobs remain unchanged. Do not substitute this trial workflow for production release provenance.
3. From the operator machine, create a new private directory and bind fresh native PR/run/job/merge-ref evidence:

   ```sh
   node scripts/ci-trial/operator.mjs prepare PR_NUMBER RUN_ID hostinger NEW_PRIVATE_DIRECTORY
   node scripts/ci-trial/operator.mjs jit SAME_PRIVATE_DIRECTORY
   ```

   These commands use the existing `gh` authentication. `prepare` only reads GitHub and writes private evidence. `jit` creates one ephemeral repository runner after rechecking the exact queued identity, saving intent before POST. If its reply is lost, preserve that intent and inspect the exact operation-derived runner name; never repeat the POST blindly. Default runner group 1 must be the actual approved repository group; a refusal is not permission to select another group silently.
4. Transfer only the reviewed supervisor/compose package, qualified image and this operation's private intent/JIT files through authorized server access. Stage the files at `/var/lib/therecap-ci-trial/OPERATION_UUID`, owned by root with directory mode 0700. The transfer does not include the operator's GitHub token, unrelated receipts, application keys or backups. Preserve the original local native evidence.
5. Run **on the Linux Docker host**, outside the job's namespace:

   ```sh
   bash infrastructure/ci-trial/supervise.sh /var/lib/therecap-ci-trial/OPERATION_UUID sha256:QUALIFIED_IMAGE_ID
   ```

   The supervisor checks capacity, allocates only its new filesystem, sets private file ownership, records image/mount/deployment data and wraps Compose in the host's `timeout`. The job cannot signal that host process. **Starting Compose directly does not qualify Hostinger containment.** The Linux root/loop-mount supervisor has not yet been exercised on Hostinger; that remains an explicit native gate. Do not give a job host administration to run it.
6. After the job is terminal, read back real GitHub evidence and remove only this runner registration:

   ```sh
   node scripts/ci-trial/operator.mjs readback SAME_PRIVATE_DIRECTORY
   node scripts/ci-trial/operator.mjs cleanup SAME_PRIVATE_DIRECTORY
   ```

   `readback` requires the matching runner ID/name and terminal job before saving immutable evidence. `cleanup` binds the operation-derived name, positive ID and label, refuses a busy runner and verifies absence. The supervisor separately kills/removes its container and volume, unmounts/removes its private scratch image and deletes the host JIT file. Preserve private logs and cleanup receipts before removing local JIT material. If the supervisor or Docker API fails, verify exact container/volume/mount custody manually before calling cleanup complete; never purge shared Docker resources.
7. Remove the trial enable variable and read it back absent. Verify original application/backup state. Report host, exact GitHub run/attempt/merge/job/runner, tests/skips, resource and cleanup evidence, actual charges if reported and any unknowns. A successful trial does not unlock billing, approve reader migrations, or deploy Therecap.

## Current result

See [the scoped preparation evidence](../../docs/tech/HOSTINGER-CI-TRIAL-2026-11-09.md) and [11 November native capacity observation](../../docs/tech/HOSTINGER-CAPACITY-2026-11-11.md). No registration, GitHub routing change, remote runner container or production change has been made. Access is established; native execution is blocked by insufficient available RAM. This is not a demonstrated test failure.
