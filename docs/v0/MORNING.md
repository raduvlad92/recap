# Your morning checklist

Updated: 21 October 2026. **The working v0 is live: [Open recap](https://recap-v0-radu.netlify.app).** No setup or payment is needed to explore it. Your existing recap Supabase and Clerk projects are connected; code is backed up in the private [GitHub repository](https://github.com/raduvlad92/recap).

## Try it in five minutes

1. Open the site. Its quiet three-column layout follows your reference. Start with **Northstar Studio**, then drill into **Maya Chen** and the studio's channels. These are clearly labeled fictional examples to demonstrate your modular creator idea.
2. Switch between **All updates** and **Today's recap**. Try search, topics, dates, a bookmark and Read later. Open an update to see its details and references.
3. Sign in with your own account. Saved sources, reading lists and preferences are private to that account. Reload to check your library returns. Clerk is currently using its development instance; this is a review app.
4. For actual collection, open **Manage sources**, add `https://simonwillison.net/atom/everything/` and choose **Collect**. This exact public feed was tested end to end on the deployed site. It imports up to five recent items and labels them **Collected source**. Feed text can be an excerpt; it is not an AI-written recap.
5. Open it on your phone. The desktop rails become compact controls; the same account keeps your library available.

## The useful input from you

- Note which part best matches what you imagined and the first thing that feels wrong.
- List three to five actual creators/studios you want next, including their essential channels. That will give the next collection checks a useful target without forcing a customer segment choice now.
- When ready for paid Apify checks, provide access through a private secret-entry flow or the authorized provider account. **Do not paste a token or password in chat.** No Apify setup is needed to review the current website.

No additional GitHub, Netlify, Clerk or Supabase account creation is needed. Cloudflare was not needed. No subscription upgrade was bought, no paid scraper ran and no email was sent.

## What I still need to implement

These are engineering tasks for the assistant, not homework for you. [Tracked continuation](PLAN.md#continuation-work) and [verification](VERIFICATION.md) retain the details.

- Activate Apify safely: reviewed actor/build, server-side credentials, operator access and a durable total-spend stop, then verify an actual run. The adapter is present but runtime is off. X, Instagram and LinkedIn collection are not active.
- Add genuine cross-source AI synthesis and evaluate accurate snippets, topic/brand/disclosed-sponsor extraction and multilingual recaps. Current recap examples demonstrate the experience; collected items retain publisher extracts without invented analysis.
- Implement daily local-time generation, optional reminder sending and delivery checks. Saving time/language/email preferences does not activate those services.
- Finish stable historical snapshots, corrections/unavailable-original handling, raw-input expiry and full cross-service account deletion. Current workspace export/reset/delete controls do not erase a Clerk account or upstream provider records.
- Complete production authentication/domain setup and readiness checks before inviting customers. No customer outreach or trial has started; your broad-access-before-trial decision remains in force.

**Costs:** €0 new cash charges observed; no AI calls or generated transcription. Existing hosting/build/database usage was used and has not been priced as a measured per-reader operating cost. The earlier €50/150-minute source-proof ceiling is not a recurring budget.
