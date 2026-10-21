# D21 verification — admin and creator catalogue

Checked 21 October 2026. This increment uses the existing recap Supabase project `zlfdqzabsfndifxiqguo`, recap Clerk development application, private GitHub repository and Netlify review site. No customer identity or credential is included in this evidence.

## Local code and database

- `npm run check`: **137 tests passed**, reproducible offline catalogue check, TypeScript and production build passed. This includes admin authorization and payload minimization, HTML escaping, all 560 creator-page metadata/link contracts, identity/count checks, ledger ordering/failure/race behavior and signed polling.
- [26 live database checks](live-db-checks.json) passed against actual Supabase REST/RPC with real Clerk-issued synthetic development-account tokens. Anonymous/ordinary-account access to private state and privileged edits was denied; own-job visibility and other-reader denial were exercised. Disposable hidden creator and blocked ledger fixtures were removed.
- Actual import: **560 creators, 600 channels, 120 per requested platform, 600 publisher associations and seven disabled plans**. See [live import](../catalogue/LIVE-IMPORT.md).
- [Transactional SQL invariant checks](live-db-invariants.sql) passed: execution stays disabled, actor/provider changes invalidate the old quote, interval changes preserve it, and same-status job revisions reject stale writes. Fixtures rolled back.
- Security advisors after all three migrations: **no issues found**. Active looping admin RPC requests: **0**. Optimistic-concurrency RPCs use explicit `PT409`: a preliminary `40001` conflict probe triggered PostgREST's documented retry behavior; the migration corrected this and actual stale requests now return 409 promptly. No overwrite occurred.
- Current server secrets and private owner email are absent from the public build and candidate tracked files. Both credentials exposed by a CLI output were replaced; [old-key rejection evidence](CREDENTIAL-REPLACEMENT.md) is separate from functionality checks.

## Browser checks

Local authenticated admin loaded all sections against actual backend data. It showed both saved-workspace and no-workspace signups, actual saved follows, researched channels and zero recorded jobs. A collection-plan interval changed 24 → 48 hours and saved; a deliberate simultaneous edit then caused the stale UI to reject its save and offer discard/reload. After reloading, 24 hours saved again and the original quote remained intact. No collection request was made.

[Public browser checks](../catalogue/BROWSER-CHECKS.md) cover search, platform/topic filters, pagination, empty states, evidence expansion, three-channel identity, keyboard focus, HTML metadata and 404s. Chrome inspection at an actual 390 × 844 viewport found no horizontal overflow on the directory or Marques Brownlee page. T3 snapshot/resize tooling was unreliable; its measured viewport is recorded separately instead of claiming a phone screenshot from that tool.

## Hosted release

Deployment and hosted sign-in/access checks are pending this checkpoint. This section will record the checked commit, CI, Netlify deployment, screenshots, actual public response headers and temporary development QA access removal before final handoff.

## Boundaries

No source collection, Actor execution, generated transcription, email or schedule started for D21. The ledger starts at this increment; five public-feed items collected during the earlier v0 are not retrospectively presented as tracked jobs. Provider price references are not bills. No new paid plan or supplier charge was incurred by this task; existing hosting/database resource usage is not an independently reconciled invoice.

Pages describe researched account associations and planned content formats. They do not establish working scraper access, full-content/transcript quality, creator endorsement, search indexing or rankings. One same-name identity pair remains visibly unresolved. Clerk remains a development instance; AI synthesis, Bright Data execution, global spending control and recurring delivery remain tracked unfinished product work.
