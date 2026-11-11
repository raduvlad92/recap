# Hostinger CI trial: native capacity checkpoint

11 November 2026 Berlin / 10 November 23:31:58.157400 UTC. This is a read-only observation of the existing Hostinger VPS, not runner qualification or a production release.

The founder requested external Chrome, signed into Dokploy, corrected the initially selected Hostinger account and confirmed readiness. The existing VPS identity matches the Dokploy server. Hostinger's existing web console opens an authenticated root shell; no new API token, SSH key, root password or runner registration is needed for this access. Dokploy's separate terminal reports `Authentication failed`; its suggested SSH-key authorization is not performed because the Hostinger console already supplies the necessary access.

## Native observation

The console runs `free -m`, a read-only Python capacity query and `docker stats --no-stream`. Output is visually inspected in external Chrome and transcribed into the [sanitized receipt](evidence/hostinger-capacity-2026-11-11.json); it is not a downloaded or cryptographically attested host receipt. Raw screenshots, account identifiers, host addresses and container identities are not committed.

- Ubuntu 24.04.4, Linux 6.8.0-147-generic, x86_64; two CPUs and cgroup v2.
- Total RAM: 8,326,615,040 bytes (7.75 GiB). Available RAM: 2,144,305,152 bytes (2.00 GiB). `free -m` separately reports 2,054 MiB available and zero swap.
- Free root-filesystem space: 69,634,740,224 bytes (64.85 GiB).
- Existing management, automation, database and protected-backup containers are running. Container statistics show real existing memory use; this is not solely a misleading dashboard cache figure. No service is stopped, restarted, reconfigured or inspected for credentials.

## Verdict and continuation

**Do not launch the prepared runner on this host.** Its current profile caps the job at four GiB and requires six GiB available host RAM before launch. CPU count, disk and cgroup prerequisites pass this observation; available RAM fails by 4,298,145,792 bytes (4.00 GiB). This is a capacity calculation against the checked supervisor, not an executed supervisor rejection. Architecture is identified, but the x64 image and native containment remain unqualified.

The owner has completed the manual access step. No additional credential card, SSH authorization or service setup is required now. Keep the existing services and backups running and the trial route disabled. The next Hostinger execution needs sufficient independently verified spare memory, followed by native image/deadline/scratch qualification and one fresh exact GitHub job under the [existing procedure](../../infrastructure/ci-trial/README.md). A smaller memory profile would first need workload qualification and a justified headroom policy; reducing the guard alone is not acceptance. A paid upgrade, stopping other workloads or switching execution hosts is not performed by inference.

No runner/image/scratch provisioning, JIT request, GitHub routing change, provider/model call, production release/migration or backup alteration occurs. This session incurs no new purchased service; existing infrastructure and local/browser usage costs are unmeasured. Fresh GitHub GETs after the capacity readback show zero repository runners and no trial-enable variable. GitHub billing and PR checks are not refreshed by this host-capacity observation. Earlier 67-test/local ARM64 results remain historical and are not rerun or relabeled as Hostinger proof.
