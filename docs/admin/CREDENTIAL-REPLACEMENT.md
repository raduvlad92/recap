# Credential replacement — 21 October 2026

An environment-variable CLI command unexpectedly printed the recap Clerk development Secret Key and the Supabase default secret API key in its tool output. Neither value is reproduced here or committed. This is a credential-exposure response, separate from product functionality and catalogue research.

## Clerk: replaced and verified

- Target: recap application `app_3Kz2AkpHvnp0Y5RfcmllEARrYcE`, development instance `ins_3Kz2AkZNSy46XTulGv6r36RYOHJ` only. The target application/name and exact development instance were rechecked through a read-only Platform API request before rotation.
- Used the officially documented **instance** Secret Key rotation endpoint, `POST /v1/platform/applications/{applicationID}/instances/{envOrInsID}/rotate_secret_keys`, through the existing authenticated Clerk CLI. This is distinct from machine/M2M key rotation.
- Requested `delay_old_secrets_expiration_hours: 0`. Replacement completed at approximately **02:28 UTC**. Revocation was not instantaneous: the old key briefly still worked immediately afterward. By **02:29:48 UTC**, the old key returned **401**, and the new key returned **200** for the same Backend API request. The new key's instance matched recap development.
- Updated only `CLERK_SECRET_KEY` in ignored `.env.local`, `.local/admin-runtime.env` and `.local/clerk-admin.env`. Other values were preserved. New private responses/files use owner-only file permissions.
- Updated the existing recap Netlify site's `CLERK_SECRET_KEY` successfully using captured CLI output. The first secret-controller/scoping attempts were rejected by CLI argument rules and did not update the remote value; the subsequent update preserved the existing variable scopes and succeeded. A new build/deploy is required before hosted functions receive changed environment values.
- No Clerk publishable key, user account, production instance, session configuration or unrelated application was changed. No secret values were emitted by the replacement steps.

Official references: [Clerk Platform API](https://clerk.com/docs/reference/platform-api), [Clerk key rotation guide](https://clerk.com/docs/guides/secure/rotate-api-keys). Installed CLI endpoint listing and a read-only exact-application request confirmed the terminal route before mutation.

## Supabase: replaced and verified

- Target: recap project `zlfdqzabsfndifxiqguo`. The exposed modern default **secret** API key had ID `c90578a8-c7b4-4645-bf57-ba7c09eb1893`. Its type/name/ID and the exact recap project were rechecked through the official Management API before mutation.
- Replacement created successfully (**201**) with the name `recap_admin_replacement_2026_10_21` and ID `30f25044-197d-46e1-b98a-9d100f0e5243`. No key value or prefix is recorded here.
- Updated only `SUPABASE_SECRET_KEY` in ignored `.env.local` and `.local/admin-runtime.env`, preserving other variables. Updated the existing recap Netlify variable successfully. A new deploy/restart is required for running functions to receive the replacement.
- Verified the replacement against the exact project's Data API before revocation. Deleted only the exposed default modern secret key through the official API with `was_compromised=true`; deletion returned **200**.
- At **02:33:33 UTC**, the old key returned **401** and the replacement returned **200** for the same zero-row Data API request. Public publishable and legacy `service_role`/`anon` keys were not changed.

The installed Supabase CLI exposes API-key listing, but not creation/deletion. With explicit narrow authorization for this response, used the **exact credential-resolution mechanism** documented in the official CLI v2.121.0 source: native keychain service `Supabase CLI`, the documented `access-token` legacy account, and the CLI's `go-keyring-base64:` normalization. The default profile account was absent. There was no keychain inventory or access to other services. The Management API bearer token stayed in process memory and was never written to Git, Netlify or a local token file.

Official API sequence: `POST /v1/projects/{ref}/api-keys?reveal=true`, update server environments, test replacement, then `DELETE /v1/projects/{ref}/api-keys/{oldID}?reveal=false&was_compromised=true&reason=local-cli-output-exposure`. All potentially sensitive output was captured privately. An initial create request with a hyphenated key name was rejected with **400** and created no replacement; the current official OpenAPI schema requires names matching `^[a-z_][a-z0-9_]+$`, so the successful request used underscores.

Official references: [create project API key](https://supabase.com/docs/reference/api/v1-create-project-api-key), [delete project API key](https://supabase.com/docs/reference/api/v1-delete-project-api-key), [Management API authentication](https://supabase.com/docs/reference/api/introduction), [current API schema](https://api.supabase.com/api/v1-json), [CLI credential resolution](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/auth/command-credentials.layer.ts), [CLI credential normalization](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/shared/auth/keyring-token.ts).

## Handling and next step

No credentials belong in Git, public pages, screenshots or chat. CLI stdout/stderr that might contain a value is captured only in ignored owner-readable files. Both exposed credentials are now replaced and the previous values are rejected. Reload local runtime environments, redeploy hosted functions, and verify the actual hosted admin endpoint with the replacements. Credential replacement does not imply that broader product or source-collection checks have passed.
