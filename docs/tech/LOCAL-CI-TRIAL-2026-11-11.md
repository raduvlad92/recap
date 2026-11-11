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

## First native admission and corrected preflight

Native run [42934793789](https://github.com/raduvlad92/recap/actions/runs/42934793789) queues for exact head `38b884a`. Its registered runner stops before contacting GitHub because `du` cannot traverse the new ext4 filesystem's root-owned `lost+found`. The automatic controller cancels the unassigned run and removes the registration, JIT, route, container, input/work/backing volumes and loop. Native terminal job readback shows cancelled, runner ID0 and zero steps; this is not an application test failure or executed CI pass.

The trusted initializer now removes only that fresh empty recovery directory before handing the owned filesystem to UID10001. A fifth, network-disabled probe executes the actual image launcher with a constructed unusable JIT: its resource/scratch/copy/private-file preflight succeeds, the listener rejects the fixture, no job is admitted, and all local resources are removed. A new GitHub trial requires a fresh head/run/intent/JIT; the first intent is never reused.

## Monitor failure, corrected image and pending GitHub cleanup

The actual local run below is interrupted after 198.115 seconds. Its launcher recursively scans scratch with `du`; normal PostgreSQL test teardown removes files during that scan, `du` returns nonzero, and the supplementary monitor incorrectly treats this as a disk-bound failure. The native container is not OOM-killed, the Mac deadline does not fire, and no complete reader report is available. This is a runner-monitor defect, not an application test result or proven capacity breach.

The automatic controller removes the local container, input/work/backing volumes and loop, and deletes/readbacks the trial variable. GitHub still reports runner22 offline/busy and the assigned job in progress after normal cancellation. A separately journaled exact-run force-cancel request is acknowledged; terminal GitHub readback, registration deletion and original local JIT erasure remain pending. Do not weaken busy cleanup or start another trial while that custody is unresolved. The original failure/result evidence is retained.

The corrected monitor checks kernel filesystem counters directly: total capacity must be at most eight GiB and available space at least one GiB. It traverses no temporary paths and leaves all CPU/RAM/PID/time/quota controls intact. All **103 guard/operator tests pass**, including exact counter boundaries and malformed/uncapped/low-free rejection. Rebuilt image `sha256:16ec1defe343ae98eee6f70368d7e3f083903bd13c10aa84ee8b86674f114438` matches all six runtime source files. Fresh environment, actual-launcher/invalid-fixture and 17-second churn probes pass; the churn probe performs **420 counter checks and 223,744 temporary-file deletions**. All three probes fully remove their local resources. A new native run remains unstarted pending old-job cleanup.

GitHub documents [force cancellation](https://docs.github.com/en/rest/actions/workflow-runs#force-cancel-a-workflow-run) for a run that does not respond to normal cancellation. An acknowledged request is not terminal state or cleanup proof.

## Earlier native local run checkpoint (superseded)

At exact head `ff96969`, hosted jobs [check130243581728](https://github.com/raduvlad92/recap/actions/runs/42935243893/job/130243581728) and [verify130243581848](https://github.com/raduvlad92/recap/actions/runs/42935243831/job/130243581848) both have runner ID0 and zero steps. Their native annotations identify the same account payment/spending restriction. They are refused hosted admission, not executed application test failures. The local job independently completes dependency installation and runs the full reader checks; final result/cleanup remain pending. Do not rerun or alter the hosted/release workflows or billing by inference.

Fresh run [42935243758](https://github.com/raduvlad92/recap/actions/runs/42935243758), attempt1, binds head `ff96969fc9a79a221b2e7ebd3a616b36fbeccec2` and its native synthetic merge. GitHub assigns job130243581696 to runner22. Actual job setup/hook, checkout and unprivileged prerequisites pass; npm installation and complete reader/build/Worker checks are running. The private automatic controller retains native final readback, exact registration/JIT/volume/loop cleanup and removal/readback of the enable variable. Final conclusion, full counts and cleanup remain pending; this is already actual local GitHub execution, separate from earlier environment probes.

## Exact GitHub trial

Keep the existing workflow path and strict source/base/merge/run/attempt guards. Its visible job name is now **Isolated test-only trial**, so it makes no false Hostinger claim. Only `RECAP_CI_TRIAL_ENABLED` enables this PR-only workflow; existing release workflows and required checks are unchanged.

After publishing this exact code, deliberately enable that single variable, push one fresh native PR event, bind the queued run through the existing operator with location `local-qualification`, and create exactly one JIT configuration. Run the local supervisor, preserve final native GitHub/job/runner and zero-skip test evidence, then remove the exact registration, private JIT, input/work/backing volumes and loop, and the trial variable. Do not retry ambiguous JIT admission or promote a test-only result into production release authority. [Commands and boundaries](../../infrastructure/ci-trial/README.md).

No additional manual sign-in is currently needed. Local compute/storage/bandwidth and existing infrastructure costs are unmeasured; no new service is purchased. Completion and useful reader-content proof remain separate.
