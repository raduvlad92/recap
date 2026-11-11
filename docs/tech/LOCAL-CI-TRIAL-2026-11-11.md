# Local test-only CI trial

The founder explicitly says **“ok, let's try with a local runner”** after native Hostinger capacity fails. This authorizes one bounded GitHub job on the existing Mac/Docker Desktop. It does not authorize a production release, reader migration, supplier/model call, paid upgrade, backup change or relaxed release provenance. Hostinger stays untouched.

## Qualified local controls

The original limits remain one CPU, four GiB RAM/no swap, 512 processes, eight GiB private scratch and at most thirty minutes. Native capacity checks require six GiB available inside the Docker VM, twenty GiB free on both Mac and VM, cgroup v2/two CPUs, and at least 20% memory free according to macOS memory-pressure reporting. Current Docker Desktop is ARM64 Linux with ten CPUs and an eight-GiB VM; the existing exact qualified runner image is reused.

The supervisor runs on the Mac, outside the job. A trusted, network-disabled setup helper gets only one preselected free loop device, SYS_ADMIN for its loop ioctls, and its private backing volume. It preallocates/formats its own image. A separate nonprivileged job receives only the resulting ext4 work volume and two read-only projections of its private intent/JIT volume. The job receives no loop device, administrative capability, Docker socket, Mac directory, operator GitHub token or production credential. Small CHOWN helpers initialize only the owned work/input volumes. Cleanup checks operation labels and the backing device/inode before clearing the loop; foreign custody is refused.

An initial Mac-mounted APFS image approach is discarded after Docker file-sharing failures. Its failed attempts are retained privately, are not passing evidence, and all owned Mac images/mounts are removed. The final implementation uses Linux volumes exclusively.

## Evidence so far

**94 guard/operator/security tests pass, zero failures/skips.** They include rejection of credential/environment/mount/resource drift and constructed matching/foreign/already-detached loop-cleanup checks. Four actual Docker probes pass with exact private scratch/container/volume/loop cleanup:

- Environment: Node22.23.4, official runner2.338.2, bundled action Node24.22.1, nonroot PostgreSQL17/pgcrypto over a private Unix socket, and actual cgroups/read-only root/no socket.
- Disk: a disposable 256-MiB instance of the same filesystem mechanism refuses actual writes with ENOSPC; the real profile uses an eight-GiB backing image.
- Deadline: a container deliberately ignores SIGTERM; the Mac's two-second probe deadline plus three-second shutdown grace kills it in 5.156 seconds (exit137, not OOM).
- Inputs: UID10001 can read the mode0600 constructed intent/JIT projections, while writes fail EROFS. The fixture is not a GitHub credential and networking is disabled.

[Sanitized probe receipt and source hashes](evidence/local-ci-trial-2026-11-11.json). These prove local containment/environment only. The full reader workload and actual native GitHub assignment remain pending at this checkpoint. No production or provider/model connection is introduced.

## Exact GitHub trial

Keep the existing workflow path and strict source/base/merge/run/attempt guards. Its visible job name is now **Isolated test-only trial**, so it makes no false Hostinger claim. Only `RECAP_CI_TRIAL_ENABLED` enables this PR-only workflow; existing release workflows and required checks are unchanged.

After publishing this exact code, deliberately enable that single variable, push one fresh native PR event, bind the queued run through the existing operator with location `local-qualification`, and create exactly one JIT configuration. Run the local supervisor, preserve final native GitHub/job/runner and zero-skip test evidence, then remove the exact registration, private JIT, input/work/backing volumes and loop, and the trial variable. Do not retry ambiguous JIT admission or promote a test-only result into production release authority. [Commands and boundaries](../../infrastructure/ci-trial/README.md).

No additional manual sign-in is currently needed. Local compute/storage/bandwidth and existing infrastructure costs are unmeasured; no new service is purchased. Completion and useful reader-content proof remain separate.
