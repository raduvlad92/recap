# Optional daily reminder implementation

Implemented locally 31 October 2026 under the approved social collection/daily delivery increment. This note describes the code contract; it is not a deployment or live-mail receipt.

## Application workers

- `recap-reminders` runs every five minutes and wakes the authenticated background `recap-reminder-worker` only when configured/enabled.
- A published private daily briefing in `ready`, `partial` or `quiet` state queues one durable outbox entry transactionally. `awaiting_review`, deleted and opted-out briefings do not qualify.
- The worker resolves the reader's **current verified Clerk primary address**, then checks current consent, daily generation/reset fence, status, suppression, lease and finite operator policy at the final database send boundary.
- Resend receives a concise localized HTML/text reminder linking to `/?briefing=<id>`. The reader must authenticate to read it. No original source content, tracking pixel or reader identifier enters the email body.
- `reminder-events` verifies the raw Svix HMAC, freshness and supported event shape before importing an idempotent event receipt. Accepted, delivered-to-server, bounced and complained are separate states; a later `sent` event cannot regress delivery.
- `reminder-unsubscribe` verifies a scoped HMAC token. GET shows a confirmation form without changing consent, so mail-link scanners cannot unsubscribe the reader. POST, including standard one-click unsubscribe, disables the reader's preference and cancels pending attempts.

## Configuration and activation

The sending gate defaults off. Required values are `REMINDER_EMAIL_ENABLED=true`, `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `REMINDER_UNSUBSCRIBE_SECRET`, existing `APP_URL` and `CONTENT_ANALYSIS_WORKER_SECRET`, plus the existing server database/Clerk credentials. The reminder signing secret must be 32–256 characters. Never place these values in Git, public metadata or logs.

Where Netlify account permissions prevent environment-variable writes, `recap_reminder_runtime_settings` holds an **AES-256-GCM encrypted** fallback. Only `service_role` can access it. `encryptReminderRuntime` derives the 256-bit key with SHA-256 of `therecap:recap-reminder-runtime:v1:` followed by the existing worker secret, uses a random 12-byte IV, and authenticates the scope `therecap:recap-reminder-runtime:v1`. The JSON envelope has `version:1` and base64url `iv`, `tag`, `ciphertext`. Only the five reminder-specific settings above are accepted. Explicit environment values take precedence. An outgoing emergency-off switch does not disable webhook processing or unsubscribe.

An operator must separately enable the intended reader in `recap_reminder_policies`, with a finite `enabled_until`. Default policy is disabled, maximum one initial send per UTC day and seven initial sends for the pilot; the schema permits a finite lifetime ceiling up to 31. Unknown acceptance counts toward these limits. The user's actual saved reminder preference must also be on; an operator policy is not user consent. Existing saved preference opt-in timestamps are not invented.

## Retry and lifecycle guarantees

The payload, verified destination/identity and deterministic provider idempotency key are frozen before POST. A timeout preserves uncertainty; retries reuse the exact payload/key. Automated retries stop before 23 hours or four attempts, conservatively inside Resend's 24-hour key window. Old uncertainty retains its receipt/recipient metadata and is not automatically sent again. Changed identity or payload cancels the old attempt rather than creating a replacement reminder.

Workspace reset rotates the daily generation; opt-out changes the consent revision. Both block claimed work at authorization. Deleted briefings cancel pending attempts. Workspace deletion cascades private outbox/events/consent records. Provider-accepted mail cannot be recalled; delayed provider events can record its acceptance even if consent was subsequently withdrawn.

## Local evidence

`tests/recap-reminders.test.ts` and `tests/recap-reminders-local-db.test.ts` pass **51 focused cases**: 33 unit/transport fixtures and 18 disposable PostgreSQL protocol cases. The database tests use the agreed daily table boundary independently of concurrent composer work. Full combined migration, hosted schedule, verified sender, a separately authorized opted-in reader mail test and real Inbox/read-link proof remain separate integration/release gates. No provider email was sent by these tests.

Primary documentation checked: [Resend API](https://resend.com/docs/api-reference/emails/send-email), [24-hour idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [raw webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Svix manual HMAC contract](https://docs.svix.com/receiving/verifying-payloads/how-manual).

The owner explicitly chose **Keep my reminders off** on 31 October. That preference remains off. Current release, hosted checks and deferred mail proof are recorded in [the release report](SOCIAL-DELIVERY-2026-10-31.md).
