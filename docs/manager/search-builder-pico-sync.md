# Search Builder — PICO Auto-Sync — prompt40 Task 2

The Search Builder reflects PICO changes without destroying manual work.

## Behavior
- **First seed** (no saved search): `seedFromPICO(true)` extracts concepts from PICO
  (`picoToConcepts`) and populates the builder.
- **PICO change detection:** a `picoKey` of `[P|I|C|O]` is watched; when it changes
  after load, `picoDirty` is set. `newSuggestionCount` is computed = extracted
  concepts whose primary term is neither already present nor previously deleted.
- **Non-destructive merge:** if there are new suggestions, the header shows
  `+ N new suggestion(s) from PICO`. Clicking it runs `seedFromPICO(false)`, which
  **only ADDS** the new concepts — existing concepts, manual terms, and edited terms
  are never touched or overwritten.
- **Deleted auto-terms stay deleted** (see Task 5): re-syncing never re-adds a term
  the user removed, until **Reset suggestions**.

## Term provenance
Each term carries `source`: `pico_auto` (extracted), `user_added` (typed by the
user), or `synonym` (added from a MeSH lookup). This distinguishes auto-generated vs
manual work and drives the ignore-on-delete rule.

## Reset suggestions
A `↺ Reset suggestions (N)` control (shown when ≥1 auto-term was deleted) clears the
ignore list and re-seeds the PICO concepts, **preserving** any user-added concepts.

## QA
Change Population → `+ N new suggestions`; click → added, nothing lost. Add a manual
term → a PICO change never deletes it. Delete an auto term → a re-sync does not bring
it back. Reset suggestions → it returns. Refresh → all of the above persist (server).
