# Your recap admin guide

Open [Administration](https://recap.filternode.dev/admin/) and use the same owner email you use for the Clerk dashboard. On your first app visit, choose **Sign up** if you have not created an app account yet; a dashboard account and an app account are separate. Verify that same email through the normal sign-in flow. Owner access is already configured on the server; you do not need to provide tokens or change Supabase settings. Other readers cannot see this panel or its private data. The [current release status](../../STATUS.md) records deployment verification separately from this guide.

## What each area shows

| Area | What you can learn or change |
| --- | --- |
| **Overview** | How many people signed up, how many saved workspaces exist, followed-channel totals, catalogue size, recorded jobs and observed supplier charges. Signups come from Clerk, so people who have not saved a workspace are still counted. |
| **Readers** | Search signups, open a reader and see their saved creator/channel follows, signup and sign-in dates, saved-item counts, languages and recorded collection activity. Fictional starter sources are labeled; development test accounts can also appear in the signup list. |
| **Creators** | Search the researched catalogue, inspect a creator’s channels and account evidence, edit their content-focus description/topics, or hide their public listing. Public pages can take up to five minutes to reflect a change. |
| **Collection plans** | Review or edit the proposed provider, Actor reference, intended check interval and notes. Saving a plan never starts a job, turns on a schedule or enables paid collection. Changing the provider or collector clears its previous price quote. |
| **Review queue** | Review held keywords and recaps in a compact list. Open a row for its exact saved source, AI prompts, reason and decision needed. Confirm, edit and confirm, or reject. Decisions are saved and checked against the current source. |
| **Collection jobs** | Filter recorded activity by reader, provider or status. See actual provider-run references, returned-item counts and any reported charge. This view starts recording from the D21 increment; earlier activity was not invented or backfilled. |
| **Access log** | See recorded private reader-view access and creator/plan edits, with their time and operator reference. This is an operational audit trail, not a customer-analytics report. |

**Configured Actors, used Actors and runs mean different things.** A plan names a possible Actor. An Actor counts as used only after an actual provider-run reference is recorded. One Actor may have many runs; a shared source should not require one paid run per follower.

**Unknown costs stay unknown.** A blank/unreported charge is not zero. “No provider charge” for a public feed means no scraper supplier fee; app hosting, database and other operating costs still exist. The plan’s quoted price is not an invoice or a spending limit.

## Decide a held keyword or recap

Open [Review queue](https://recap.filternode.dev/admin/?section=reviews). Each compact row shows the keyword or recap, its source and why it was held. Open only the item you want to decide.

- **Exact transcript / source** shows the saved text used for that analysis. **Saved AI prompt** shows the actual stored system instructions, request and model. Older items may say **Prompt not saved**; a current template is never shown as a historical request. A source-review suggestion is labeled separately from what the AI returned. If there are many saved prompts, use **Next prompts** or **Previous prompts**; your edits stay in place.
- **Confirm and publish** approves that item and applies it to its reader update. It does not enable analysis for other videos or start collection. Confirmation is disabled when the source changed or the saved proposal is invalid.
- **Edit** lets you fix a keyword and type, or write up to six recap points with exact supporting text copied from the transcript. **Save and publish** checks and publishes your correction. If no usable recap was saved, you can write supported points or reject the attempt.
- **Reject** keeps held content unpublished; rejecting an existing keyword can remove its visible label. Approved and rejected items remain available through the status filter. If another decision or source change happened meanwhile, reload the latest review before saving again.

Your decisions and the original evidence remain saved. This does not start paid training or automatic AI processing. Reviewing an uncertain name does not verify its outside-world spelling or identity; use the actual source rather than guessing a correction.

### Bulk selection

Check individual rows or use **Select this page** for up to 50 visible items; **Clear** removes the selection. Choose **Confirm and publish selected** or **Reject selected**. Each item keeps its own source and revision checks. The result shows separate successes and failures; unsupported or changed items are not silently approved. An uncertain response is not automatically retried: check that item's saved state before trying again.

### Keep reviewing while a decision saves

A row shows **Saving** immediately while its decision saves in the background. You can continue with the next review. Confirmed decisions leave the pending list without reloading the whole list, including after a successful bulk action. Failed or uncertain items stay visible with their error; reread or reload those items before retrying. Use **Load remaining reviews** to fetch more when needed.

### What the app remembers

For the same saved video and unchanged transcript, approved or edited keywords are kept and rejected names stay excluded when results are published again. An approved or edited recap is protected from later replacement. Rejecting a recap dismisses that attempt; it does not ban future recaps. These choices do not transfer to new videos, change the prompts or train the AI.

### Keep published results readable

A video with a published recap and at least one published keyword keeps those results readable while other proposals await review. Later approved keywords and distinct recap points are added to that same video. Each new recap proposal can contain up to six cited points; the video can hold 30 total. The card shows six, with **Show more takeaways** for the rest. Existing published points and valid timing are preserved; duplicates are not added again.

If older keywords are unverified, only the names you actually approve for the current transcript become readable. Their separate approval proof leaves the old labels and their unknown/stale provenance intact; it does not publish those unknown names.

The open reader normally picks up approvals on its next visible-page check, about once a minute. Processing progress can still show pending work without hiding the published results. Shorts, source, history and other feed preferences keep working as before; this does not add a stricter feed filter or start AI processing. [Scope and verification status](../tech/PUBLISHED-REVIEW-SUBSET-2026-10-29.md).

## Five-minute review

1. Open **Overview**, then **Readers**. Open your own reader record to check that the followed sources match your workspace.
2. Search **Creators** for **Marques Brownlee**. Its three evidenced channels share one creator page.
3. Open **Collection plans** and inspect the different billing units. YouTube video records, X profile queries and transcript minutes are separate costs.
4. Open [the public creator directory](https://recap.filternode.dev/creators/) and follow a creator page to its original account links. Pages explain the planned collection and its gaps; they do not claim collected posts.

There are **600 researched platform accounts: 120 each on YouTube, Instagram, X, Substack and LinkedIn**. They form **560 canonical creator records**, with 33 having multiple evidenced channels. People and publishing groups remain separate. One Ottolenghi Instagram/Substack identity pair remains unresolved and is clearly recorded in the [import manifest](../catalogue/IMPORT-REPORT.md); matching names alone did not merge it.

## What remains unfinished

Authentication still uses the Clerk development instance. Paid Apify and Bright Data collection, seven-platform content proof, AI-written recaps, automatic schedules/reminders, payments and the wider specification are not complete. The researched directory and its public pages do not establish scraper reliability, creator endorsement, search-engine indexing or SEO rankings.

You can review and edit catalogue descriptions and collection plans without starting collection. The remaining supplier activation and spending-control work belongs in the tracked engineering plan, not in an owner token/setup checklist.

If administration says access is unavailable, check that you used the same owner email and completed the normal email-verification flow, then sign out and back in. A service error should show an error/retry state rather than made-up reader or cost figures.

Technical evidence: [live database checks](live-db-checks.json), [delivery plan](PLAN.md), [live import record](../catalogue/LIVE-IMPORT.md), [supplier cost comparison](../catalogue/COLLECTION-COSTS.md). No private reader identities or credentials belong in these documents.


### New automatic drafts

New eligible followed YouTube videos now get keyword and recap drafts automatically within the existing budget. In **Analysis**, **Automatic content drafts** shows queued, running, sent-for-review and blocked counts. The standard worker's separate Off setting is historical; this new path has its own private opt-in. Keywords use the reviewed DeepSeek approaches plus Sol checking; recaps use DeepSeek draft/check calls. The model dropdown applies to the standard worker.

For this initial live version, every new suggestion waits for your approval, even when the checker accepted it. Exact original requests are available on those reviews. A draft with unsupported quotes keeps valid quoted points where possible and explains what was withheld; a partial draft may need improvement. The first run also preserves one original failed recap attempt beside its recovered partial draft. Review decisions add to the existing reader item without enabling more spending or training a model.

The remaining cumulative allowance is limited; automatic generation stops at the existing US$10 total, US$5 UTC-day or US$0.10-call bound. This does not activate X/Instagram/LinkedIn freshness collection or daily briefing/email delivery. See the [current live report](../tech/LIVE-WORKFLOW-2026-10-29.md).
