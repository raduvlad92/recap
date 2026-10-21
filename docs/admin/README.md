# Your recap admin guide

Open [Administration](https://recap-v0-radu.netlify.app/admin/) and use the same owner email you use for the Clerk dashboard. On your first app visit, choose **Sign up** if you have not created an app account yet; a dashboard account and an app account are separate. Verify that same email through the normal sign-in flow. Owner access is already configured on the server; you do not need to provide tokens or change Supabase settings. Other readers cannot see this panel or its private data. The [current release status](../../STATUS.md) records deployment verification separately from this guide.

## What each area shows

| Area | What you can learn or change |
| --- | --- |
| **Overview** | How many people signed up, how many saved workspaces exist, followed-channel totals, catalogue size, recorded jobs and observed supplier charges. Signups come from Clerk, so people who have not saved a workspace are still counted. |
| **Readers** | Search signups, open a reader and see their saved creator/channel follows, signup and sign-in dates, saved-item counts, languages and recorded collection activity. Fictional starter sources are labeled; development test accounts can also appear in the signup list. |
| **Creators** | Search the researched catalogue, inspect a creator’s channels and account evidence, edit their content-focus description/topics, or hide their public listing. Public pages can take up to five minutes to reflect a change. |
| **Collection plans** | Review or edit the proposed provider, Actor reference, intended check interval and notes. Saving a plan never starts a job, turns on a schedule or enables paid collection. Changing the provider or collector clears its previous price quote. |
| **Collection jobs** | Filter recorded activity by reader, provider or status. See actual provider-run references, returned-item counts and any reported charge. This view starts recording from the D21 increment; earlier activity was not invented or backfilled. |
| **Access log** | See recorded private reader-view access and creator/plan edits, with their time and operator reference. This is an operational audit trail, not a customer-analytics report. |

**Configured Actors, used Actors and runs mean different things.** A plan names a possible Actor. An Actor counts as used only after an actual provider-run reference is recorded. One Actor may have many runs; a shared source should not require one paid run per follower.

**Unknown costs stay unknown.** A blank/unreported charge is not zero. “No provider charge” for a public feed means no scraper supplier fee; app hosting, database and other operating costs still exist. The plan’s quoted price is not an invoice or a spending limit.

## Five-minute review

1. Open **Overview**, then **Readers**. Open your own reader record to check that the followed sources match your workspace.
2. Search **Creators** for **Marques Brownlee**. Its three evidenced channels share one creator page.
3. Open **Collection plans** and inspect the different billing units. YouTube video records, X profile queries and transcript minutes are separate costs.
4. Open [the public creator directory](https://recap-v0-radu.netlify.app/creators/) and follow a creator page to its original account links. Pages explain the planned collection and its gaps; they do not claim collected posts.

There are **600 researched platform accounts: 120 each on YouTube, Instagram, X, Substack and LinkedIn**. They form **560 canonical creator records**, with 33 having multiple evidenced channels. People and publishing groups remain separate. One Ottolenghi Instagram/Substack identity pair remains unresolved and is clearly recorded in the [import manifest](../catalogue/IMPORT-REPORT.md); matching names alone did not merge it.

## What remains unfinished

Authentication still uses the Clerk development instance. Paid Apify and Bright Data collection, seven-platform content proof, AI-written recaps, automatic schedules/reminders, payments and the wider specification are not complete. The researched directory and its public pages do not establish scraper reliability, creator endorsement, search-engine indexing or SEO rankings.

You can review and edit catalogue descriptions and collection plans without starting collection. The remaining supplier activation and spending-control work belongs in the tracked engineering plan, not in an owner token/setup checklist.

If administration says access is unavailable, check that you used the same owner email and completed the normal email-verification flow, then sign out and back in. A service error should show an error/retry state rather than made-up reader or cost figures.

Technical evidence: [live database checks](live-db-checks.json), [delivery plan](PLAN.md), [live import record](../catalogue/LIVE-IMPORT.md), [supplier cost comparison](../catalogue/COLLECTION-COSTS.md). No private reader identities or credentials belong in these documents.
