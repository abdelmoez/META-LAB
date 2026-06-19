# Search Builder — UX — prompt40 Task 4

The Search Builder is a two-column, self-explanatory builder. prompt40 sharpened the
intelligence and the change-tracking UX; the existing clear layout was preserved.

## Layout
- **Header:** title + `+ N new suggestions from PICO` (when PICO changed), Beginner
  mode toggle, and a live stats line (`N concepts · M MeSH · P free-text`).
- **Left — Concepts:** one card per concept (colour bar + editable label). Inside
  each, the OR'd terms render as chips; every chip has an edit (✎) and a delete (×)
  button (Task 5). A `↺ Reset suggestions (N)` link appears when auto-terms were
  deleted. `+ term` adds a manual term; the concept header `×` deletes the concept.
- **Right — Live output:** PubMed / Embase / Cochrane tabs, the generated query with
  Copy / Edit / Revert, a live PubMed hit count, and a plain-English explanation
  (always shown in Beginner mode).

## Self-explanatory elements
- **Auto vs manual:** terms carry `source` (`pico_auto` / `user_added` / `synonym`);
  deleting an auto term is remembered, deleting a manual term is not.
- **Search logic explained:** "Synonyms within a concept are combined with OR;
  different concepts are combined with AND" (concept-panel help + plain English).
- **Change log:** the `+ N new suggestions` button is the "PICO changed" signal;
  "Reset suggestions" explains deleted terms won't return unless reset.
- Theme-consistent (day/night + brand tokens), responsive two-column grid.

## Per-database strategies (Task 7)
Each database tab shows an **editable** query with **Copy** and inline **Edit /
Revert**. Manual edits set an override (a `✎` badge on the tab) and are never
silently destroyed by regeneration — Revert restores the generated query.

## Deliberate scope notes
- The redesign kept the proven two-column builder rather than the alternative
  four-section mock in the prompt — it already groups concepts, explains the logic,
  and exposes per-database strategies, with less chrome. The substantive gains were
  in extraction intelligence + non-destructive PICO sync + ignore-tracking.
- Per-term source **badges** on each chip are a small, low-risk follow-up (the data
  model already carries `source`); deferred to avoid shipping unverified visual
  detail (no headless-browser QA here).
