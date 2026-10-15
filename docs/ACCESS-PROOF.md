# Source-access proof — approved

Version: **0.1**, 15 October 2026. Status: **APPROVED for the bounded experiment and up to €50 total spending**. Q6 response: “Yes — approve the proof, up to €50 total.” Approval does not extend to the full app build.

## Decision this experiment answers

Can scraping providers supply enough of the original public content, reliably and at a measured cost, for therecap to make accurate daily recaps across the required source families? This is a collector experiment, not the app build or a customer test.

## Approved scope

| Item | Approved limit |
| --- | --- |
| Source families | YouTube, X, Instagram, LinkedIn, podcasts, Substack/newsletters, blogs. |
| Sample | Five public sources per family; 35 total, chosen independently of vendor showcases. |
| Creator involvement | No creator onboarding or account authorization. |
| Account/content exclusions | Public, logged-out content. Private accounts, paywalled/subscriber-only bodies, email-only issues, Stories/live streams and complete historical archives are not promised. Record these limits. |
| Providers | Apify first where documented fit is strongest; Bright Data as an alternative/failure comparison. Another provider only within the same approved cap. |
| Duration | Seven days of bounded checks, plus setup and report. Not a launch-date promise. |
| Discovery | At most five latest items/source/check initially; up to 245 daily source checks / 1,225 returned item records before bounded comparisons. Identify high-volume sources that exceed this cap; do not claim full capture for them. |
| Audio | Existing captions/publisher transcripts first. At most 150 minutes total of generated transcription across all sources. |
| Comments / reach | Deferred; no comment-collection budget in this proof. Record ordinary returned metadata without claiming it equals reach. |
| Cash limit | **€50 total**, including any subscription purchase, metered usage, tax and currency conversion. Use available free credits first. |
| Subscription terms | No annual plan, uncapped recharge or continuing paid renewal. Do not purchase if a minimum deposit/plan cannot fit. |
| Customer-facing work | None: no customer recruitment, recap trial, payment collection or published service. |

Before execution verify an account is available, its credit balance, the exact actor charging model and how to prevent further charges. No Apify/Bright Data connector or corresponding token was found in the agent's available tools/environment during preparation. Both services showed login pages in the shared browser's default profile on 15 October 2026; no account was created or signed in. Do not paste secrets into project documents or Git.

## Recommended pass/fail rule

Each mandatory family must provide substantive content sufficient for accurate recaps, with stable original links and dates, disclosed format limits, measured freshness/completeness and cost. Proposed target: at least 90% of the manually observed eligible sample updates captured within 24 hours, with no systematic missing essential format or material text truncation. Include a few active sources so a quiet week is not mistaken for successful refresh.

Text/caption-only results cannot count as understanding an entire video, reel, image collection or podcast. If necessary visuals are missing, mark that format partial. Test an existing-caption video, a captionless video, a carousel, a long text item, and a podcast lacking a publisher transcript. Small samples establish bounded feasibility, not support for every public creator.

Pause execution if spending could exceed the cap, required account access is missing, actor output is not usable, or a required format cannot be covered. Report the evidence and the smallest concrete revision; do not quietly lower the gate or begin customer testing.

## Evidence to save

- Public sample manifest and manual reference items.
- Exact actor/scraper names, versions, configuration, timestamps and run IDs.
- Redacted sample output and field-completeness report. Keep bulk data, credentials and personal details out of Git.
- Expected vs collected updates; duplicates; truncation; missing speech/visuals; refresh lag; error/retry behavior.
- Cost ledger: billable units, included credits, cash actually paid, transcript minutes, retries and projected 100-user cost.
- Account/source restrictions and unresolved downstream-use risks, stated factually.
- Platform results: pass / conditional / fail; daily checks are not the same as seven completed days.
- A short evidence walkthrough in docs/DEMO-LOG.md. This is the first technical demo; do not call it a finished user app.

If the proof passes, return to the proposed three-audience customer test and complete the product decisions. Approval of this experiment does not approve SPEC.md or authorize a full app build.
