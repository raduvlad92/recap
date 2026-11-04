# Netlify retirement

Completed **5 November 2026, 00:30 Berlin / 4 November 23:30 UTC**. The founder explicitly instructed: **“just remove the netlify now, no need to wait”**. This supersedes the earlier requirement to wait for 72 hours and two daily cutoffs before deleting the old site. That observation window was **not completed** and is not represented as passed.

## Actual removal

- Deleted only **`recap-v0-radu` / `522a0657-c191-4355-8d72-2ed19c580b81`**. The authenticated Netlify API returned **204**, then **404** for the exact site. It is absent from the subsequent site inventory.
- Removed its one build hook and verified an empty hook list before deleting the site.
- Removed the repository's **`NETLIFY_BUILD_HOOK`** secret and verified its absence. The two existing Cloudflare deployment secrets remain.
- Matched the site's native deploy public key to its read-only GitHub repository key. The complete Netlify site inventory showed this key used by this site alone. Removed that repository key; the native Netlify key is also absent after site deletion.
- Verified that all **18 other Netlify sites** remain, comparing exact IDs privately. The shared account remains intact.

The site had no custom domain/aliases, Netlify database or Netlify Identity instance. Its builds were already stopped. No shared credential, Supabase/Clerk resource, app data, source/model cap, review decision or reminder preference was changed.

## Post-removal verification

Cloudflare passes the same checks before and after removal:

| Check | Actual result |
| --- | --- |
| `https://recap.filternode.dev/api/health` | 200, Cloudflare, active, jobs configured |
| Live release | `80c3d6c34452137c9dfbeefaab0639625fc3f0d6` |
| Homepage and creator directory | Both 200 |
| Anonymous admin API | 401 |
| GitHub deployment target | `cloudflare` |
| Cloudflare deployment workflow | Active; successful exact-release run `41920092072` |

This verifies site deletion and bounded post-removal availability. It does not repeat authenticated browser parity, prove future daily cutoffs/content quality, or establish that shared-account billing stopped. Existing broader evidence remains dated to its actual release. [Native sanitized receipt](evidence/netlify-retirement-2026-11-04.json).

## Follow-up and repository cleanup

The obsolete **7 November final retirement task is deleted**. The existing **5 and 6 November, 07:15 UTC / 08:15 Berlin** cutoff checks remain enabled as read-only Cloudflare operational observations. Their instructions now acknowledge completed early retirement and must not require or recreate the deleted site or its credentials. No replacement task is created. [Task changes](evidence/netlify-retirement-schedules-2026-11-04.json).

The accompanying PR removes the obsolete Netlify build-hook step from the application-check workflow and updates active reader/admin links to the permanent Cloudflare origin. Cloudflare automatic deployment remains in its existing workflow. Historical Netlify receipts, the old routing inventory and shared handler code under `netlify/` are retained; they do not indicate a live Netlify site. Broader package/handler reorganization is separate from this operational deletion.

Local validation passes workflow YAML parsing, retention of `npm run check` and the separate Cloudflare main trigger, absence of the removed hook from the application workflow, permanent-origin links in the three active guides, receipt invariants and `git diff --check`. Application code is unchanged; hosted availability/native absence are separate checks above. PR CI is recorded separately from completed operational deletion.

**Costs:** no new subscription, manual provider/model execution or email. Hosting/API/CI costs remain unmeasured. Site deletion is not proof of account-level billing cessation. Normal existing Cloudflare processing continues under its existing authorization and caps; reminders stay off.
