# Working on therecap

At the start of a session, read STATUS.md, SPEC.md, PLAN.md and docs/DECISIONS.md. Read GLOSSARY.md when changing domain language. Research is in docs/RESEARCH.md; source and customer tests are in docs/VALIDATION.md.

The founder is not a developer. Research factual questions independently, explain conclusions in plain language, and recommend an answer when a business decision is needed. Use grill-with-docs while shaping the specification; keep interview rounds short and respect settled answers.

Current founder decisions take precedence over earlier recommendations:

- Aim for rapid growth.
- Explore consultants, marketing/brand-monitoring buyers and general readers; choose a focus from evidence.
- Secure broad source access before a customer trial.
- Public creators should not have to join or authorize this app.
- Usable underlying content comes first; comments and audience statistics can follow later.
- Evaluate scraping with Apify, Bright Data and alternatives. A missing official API is not, by itself, a failed access test.
- First release is a website that works well on phones and computers.
- Start with editable source collections and pasted creator links; automatic following-list import can come later.
- Keep history in date order, with topics inside each day prioritized by explicitly chosen interests and an all-updates option.
- The main recap is about five minutes, with up to five main topics, expandable details, updated-source counts, snippets and original links; quiet days stay short.
- Deliver one daily recap at the reader's chosen local time, with an optional email reminder linking to the website.
- First-release analysis covers topics, brand mentions and explicitly disclosed sponsors. Source sentiment, comment sentiment and audience statistics are later features.
- Launch with multiple interface and recap languages. The exact language list in SPEC v1.0 is proposed until whole-version approval.
- Keep dated recap history until deletion, with original-update citations and creator-linked references, export/delete controls, visible corrections and unavailable-original notices.
- Use clear limits with larger allowances than the former 15-source/500-update/60-minute recommendation. Exact revised numbers remain proposed until whole-version approval.

Do not silently replace those choices with a limited-RSS pilot or creator-only partnership model. Clearly distinguish a publicly documented scraper capability from a scraper that has actually been run and verified. Do not call platform titles/descriptions full-content coverage.

The app specification remains a draft until the founder explicitly approves a named version. Documentation and research may continue. Product implementation follows the approved scope. Q6 approved docs/ACCESS-PROOF.md v0.1, but the founder subsequently said to ignore Apify for now, assume it works, and apply the same assumption to all other scrapers. Therefore defer live supplier proof, sign-in requests and spending; continue product specification using scraper capability as an explicit assumption. Do not call that assumption verified access or discard actual feed-preflight evidence. Do not resume provider execution or repeatedly request authentication unless the founder asks to return to it. The previously approved €50/150-minute limits remain a ceiling if that work is resumed, not a direction to keep spending now. No customer outreach, paid customer trial, publication or full app build is authorized.

Before ending a substantive session, update STATUS.md, PLAN.md, docs/DECISIONS.md and docs/DEMO-LOG.md as applicable. Record approved decisions, open questions, completed work, exact evidence, costs incurred, and the next action. Put demos and evidence in durable project paths. Never represent a mockup, fixture, local check, deployment or live collection as another kind of proof.

Add ADRs only for consequential decisions with a real trade-off. Keep GLOSSARY.md free of implementation details. Do not store credentials, scraped personal datasets, or participant identities in Git.
