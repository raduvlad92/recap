# D35 verification artifacts

`local-*` images show synthetic fixtures rendered by the real components using a local Vite test-mode server. They contain no signed-in reader data and are not production screenshots or evidence of generated AI output.

Checked Chrome at 320 × 800 (Compact and Regular) and 1280 × 900 (Compact): no page overflow; unknown-format section starts collapsed and expands without changing saved preferences; full stored transcript opens and closes; reviewed takeaways/keywords and explicit provider/configuration pauses remain distinct. Browser preview automation timed out twice at the snapshot step, so native Chrome was used for these visual checks.

The private before/after archive exports, captured original/provider artifacts and SQL repair plans remain outside Git in `.local/content-repair/`. Sanitized real database/release results will be recorded in the parent content repair document.
