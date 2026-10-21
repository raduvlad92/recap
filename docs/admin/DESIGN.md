# Admin workspace design

21 October 2026. Uses the frontend-design skill and the founder's existing reference.

Palette: canvas `#f8f8f6`, paper `#ffffff`, ink `#20231f`, secondary text `#697267`, dividers `#dedfd9`, teal `#519c8d`. Onest remains the locally bundled typeface; large, lightly weighted headings sit above readable operational tables. All copy is left aligned.

The product's creator rail becomes a compact operations rail. The center is a reader/canonical-creator index with drill-down; the signal-map idea becomes an honest operating snapshot rather than a fabricated trend chart.

```text
recap / Admin                         Workspace   Creator directory   Account
────────────────────────────────────────────────────────────────────────────
Overview          A clear view of recap.
Readers           Signups / saved workspaces / source follows / provider use
Creators          ──────────────────────────────────────────────────────────
Collection plans  Searchable table with explicit sample + unknown states
Collection jobs   Selected reader or creator: channels, evidence and details
Access log
```

Review before implementation: a conventional sales dashboard would overstate what exists. Keep actual signup counts, observed jobs and incomplete costs distinct; use no growth charts, revenue estimates, fake users or running-collection illustrations. Provider editing changes plans only and offers no execution switch. On phones the navigation wraps, tables scroll inside labeled regions, forms stack and actions remain visible.

Interaction: native forms and buttons, labeled fields, visible keyboard focus, route-specific loading/error/empty states, paginated lists and explicit reload after a stale edit. Private responses and pending saves belong to the signed-in account; changing or signing out aborts requests and unmounts private content.

## Implementation review

Implemented `src/admin/AdminApp.tsx` and scoped `admin.css`: overview, searchable/paginated signups, reader/follow details, searchable creator catalogue with description/topic/listing edits, actual channel/evidence inspection, editable provider plans, filtered/paginated jobs and access logs. Every control either navigates, filters, refreshes, inspects or saves an actual API record. There are no execution or paid-enable controls.

Reviewed React behavior against the React best-practices skill: component definitions stay outside render functions; private requests are scoped to the current account, cancelled on unmount/sign-out, and discarded after account changes; route keys prevent a previous reader's response from appearing while another loads. The shared sign-in redirect needs to preserve `/admin/`; the parent owns that change. Editors use optimistic record timestamps, disable fields during saves and expose a specific stale-record reload action.

Typecheck passed after implementation and after the request/render hardening. A real local `/admin/` browser request exercised the server's `503` configuration state: it displayed the exact actionable error without private reader data. Browser snapshot calls timed out, and resize did not change the measured viewport in this agent's background tab, so no complete visual/mobile or owner-flow verification is claimed here. The parent integration task owns authenticated live checks and saved screenshots.

Source review confirms contained horizontal scrolling for wide tables, wrapping navigation, stacked phone forms, visible keyboard focus, truthful unknown-cost states and explicit telemetry from 21 October 2026. Earlier provider activity is not reconstructed. This is an implemented admin surface; it is not proof of owner authorization or a live collection run.
