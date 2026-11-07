# Reader interface languages — 7 November 2026

This bounded implementation completes the six existing reader interface choices: `en`, `de`, `es`, `fr`, `it` and `pt-BR`. It is stacked on `feat/free-first-retrieval`, from prepared base `748216a`, on `t3/complete-reader-localization`. It implements the reader-language stream in [the delivery plan](DELIVERY-PLAN-2026-11-07.md). The six choices are implementation targets, not qualified public launch-language support or approval of the full specification.

## Implemented coverage

Each locale has **480 keys** with identical interpolation names. The original 192 English keys remain, with complete translations and the additional labels already needed by reader flows. Known locales read their complete dictionaries directly; a missing key or missing/extra interpolation argument fails instead of silently using English. TypeScript checks key names, dictionary completeness and interpolation arguments. Unsupported legacy locale identifiers retain the existing English default; they cannot masquerade as another complete locale.

The existing compact interface now translates navigation, settings and help, collection selection/editing/validation, source management and Shorts controls, local application error messages, history filters, card density, feed pagination, accessibility labels, account controls, source coverage, transcript/takeaway/keyword processing, social context and media controls. Shared context carries only the interface locale. It adds no service, dependency, section, CSS rule or browser request. Language selection does not restart daily history or activity requests.

Daily briefing labels cover signed-out access, loading, unavailable/error/conflict, empty/disabled/enabled scheduling, ready/partial/quiet/review/deleted states, source coverage, missing content, unsupported source language, citations, late arrival, pagination, export and deletion. Counts, currency displays, dates, chart labels and keyword durations use the interface locale. Snapshot cutoff time keeps the snapshot's own timezone; calendar/filter identities remain exact. Unknown charges remain unknown, with the existing USD precision and reservation wording preserved.

The interface does **not** translate source text, publisher alt text, creator/collection names, approved recap wording, topic titles, quotes, stored snapshot notices or arbitrary supplier diagnostics. Raw source/provider diagnostic codes remain visible as evidence. Known application error wrappers are localized around the original diagnostic. Briefing export still exports the original JSON, and deletion sends the original ID and expected creation revision. Requested recap language remains a preference; the saved daily composer still copies original approved wording. The existing preferences note states that translated recaps are not generated.

Authentication checks/identity, private-data ownership, saved history, source/model admission, monetary limits, administrative review and reminder consent are unchanged. Shared STATUS/PLAN/DECISIONS/DEMO documents remain parent-owned. No supplier/model call, source collection, external data write, subscription, browser/preview operation, merge or deployment is part of this stream. Git branch/PR publication is the requested review delivery.

## Local verification

Final checks use **Node 22.23.4**, matching the CI major. Initial Node 25 runs also passed, but the installed Vitest release warns that Node 25 is outside its supported versions; the final Node 22 runs are the acceptance evidence.

- **280 targeted tests in 11 files passed**, including 76 new locale/reader-flow cases. The tests cover all six dictionaries and interpolation contracts, forced missing-key behavior, application/diagnostic separation, daily states, date/count formatting, safe citation links, exact snapshot/export preservation, revision-checked deletion requests, settings and collection handlers, unchanged reminder/recap preferences, immediate cross-account activity hiding, unknown/held fees, cards/media accessibility and compact structure.
- The JSX audit rejects untranslated prose and accessibility-label literals on the scoped reader surfaces. Brand `recap` and the URL example remain literal.
- Long source names and all locale variants preserve the same feed tags/classes, controls and sections. Existing narrow-toolbar, wrapping, disclosure and long-source CSS contracts are checked. These are structural checks, **not pixel measurements or native keyboard/touch proof**.
- `npm run build` (TypeScript `--noEmit` plus Vite production build) passed under Node 22. Vite reports a chunk-size warning (main JavaScript 663.89 kB / 191.90 kB gzip); this is a successful local build, not hosted performance evidence.
- `git diff --check` passed. React reviewer skill applied: unconditional hooks, primitive context, no locale-driven request effects, existing owner/epoch/abort behavior and controls retained.

Targeted command (run with the Node 22 executable):

```sh
node node_modules/vitest/vitest.mjs run tests/reader-locales.test.ts tests/reader-language-flows.test.ts tests/content-processing-ui.test.ts tests/post-media-ui.test.ts tests/daily-briefing.test.ts tests/source-collections.test.ts tests/source-preferences.test.ts tests/sample-removal.test.ts tests/collection.test.ts tests/collection-activity.test.ts tests/reader-archive.test.ts
npm run build
```

The full repository/real-database suites were not run by this stream. GitHub CI/reviews, parent integration, deployment and actual reader verification are separate evidence.

## Remaining qualification and parent acceptance

1. Review translations with qualified/native readers in all six locales, including consistent collection/source/creator terminology and singular/plural phrasing. Key parity does not establish linguistic quality.
2. On the parent's hosted artifact, check 320px/360px and desktop with long German/French/Portuguese strings, expanded daily citations, collection editing, source rows, settings, authentication controls, errors and history pagination. Measure nested-control overflow as well as page width; local structure checks do not prove fit.
3. Exercise native keyboard focus, dialog escape/return, selects/disclosures, keyword pause/resume, reduced motion and touch/media navigation for those locales. This stream retains their existing handlers and semantics but did not operate a browser.
4. Keep advertised launch languages separate from these six selectable implementations. Translated recap generation needs its own versioned source-grounding, quote/name/number/negation/citation checks, linguistic review and spending admission; it is not enabled here.
