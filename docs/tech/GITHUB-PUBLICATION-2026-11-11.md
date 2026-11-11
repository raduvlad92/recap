# Public repository and hosted CI retry

The founder says they upgraded GitHub and explicitly instructs: **make this repository public before retrying GitHub Actions**, confirming whether standard Actions usage is free. This authorizes the source-repository visibility change and PR verification. It does not authorize a production release, main push, reader migration, provider/model call, backup change or another purchased plan.

## Pricing confirmed

GitHub's current [Actions billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions) states that standard GitHub-hosted runners in public repositories remain free and do not reduce included compute usage. The existing check/verification jobs use standard Ubuntu runners, listed in [GitHub's runner reference](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job). Larger runners are billed in public repositories; artifact/cache storage has separate allowances. Public visibility does not retrospectively erase earlier private usage. The owner reports an upgrade; no payment or plan change is made by the assistant, and no account-wide billing balance is claimed.

## Publication review and action

Before changing visibility, fetch the repository's published branch/tag/PR-head refs and review Git history, current source, screenshots and GitHub's existing publication surfaces. Independent source/privacy and workflow reviews find no concrete blocker: 1,266 reachable commits, 3,279 historical text blobs, OCR of 44 non-fixture screenshots, 220 log archives, 47 artifacts, 23 issue/PR bodies, and their 1,822 extracted text/metadata files. No actual reader/participant records, backup/dataset files or production credentials are identified in this bounded review.

Official checksummed Gitleaks8.30.1 scans Git diffs and the downloaded surfaces. All 216 Git findings are reviewed as 171 constructed fixtures/public Actor references, 41 integrity/continuity hashes and four explicitly publishable client configurations. All 238 surface findings are reviewed as 219 publishable client values, 18 public-configuration hashes and one source-map identifier sequence. JWT publishable values have anon role. No unresolved credential finding remains. The raw reports and archives stay ignored locally; no Git history, GitHub log or artifact is removed. Internal non-auth audit IDs are retained as engineering evidence, not relabeled as credentials or reader identities. These are bounded checks, not a guarantee that no sensitive material can exist.

GitHub documents that [making a repository public](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) also exposes its Actions history/logs. Native prechange reads find no rulesets and an already-unprotected main branch; no existing branch protection or ruleset is removed or newly configured. Source build artifacts contain code/public configuration/hash metadata; privileged credentials appear only in the separately gated non-PR main deployment job. Publication itself matches no production workflow trigger. No license change is made by inference.

The authorized visibility change completes. GitHub reports `private:false` / `visibility:public`; an independent request without authentication receives HTTP200 and the same public repository identity. [Repository](https://github.com/raduvlad92/recap). [Sanitized native receipt](evidence/github-publication-2026-11-11.json).

## Local trial and exact hosted retry

At the owner's change of direction, request cancellation of the running local trial42937052997 while its runner is still online. Native job readback confirms cancelled. Its controller verifies exact registration/JIT/route/container/input/work/backing-volume/loop cleanup; zero repository runners and no trial variable remain. This cancellation is owner-directed, not a new monitor or application test failure. It provides no complete reader test result.

Publish a fresh PR-only checkpoint after the visibility change to retry standard hosted check/Cloudflare verification on the exact final candidate. Keep the local trial route off and release workflows/provenance unchanged. The guarded production deployment requires a non-PR main event; this task creates neither. Hosted admission, actual full test results, artifact checks and production release remain separate claims until their native results are obtained.
