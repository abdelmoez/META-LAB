# Search Builder ⇄ PICO Sync — Root-Cause Analysis & Fix (SE2)

_Scope: Search Builder only. No changes to Protocol/PICO, Screening, Extraction, RoB,
GRADE, PRISMA, Analysis, Project Control, permissions, dashboard, or Ops Console. The fix
lives entirely inside the Search Builder (`src/research-engine/searchBuilder/`,
`src/features/searchBuilder/`, `server/searchEngine/`) — the monolith is **not** edited._

## Intended behavior (SE2)

Opening the Search Builder for a Review Project must immediately show **five PICO concept
groups by default**, each populated from its own PICO field:

1. **Population** 2. **Intervention / Exposure** 3. **Comparator / Control**
4. **Outcomes** 5. **Time Frame**

Each group shows that field's extracted keywords + synonyms + MeSH suggestions. Editing a
PICO field updates only the matching group, live, for the editor and online collaborators —
without duplicating terms, erasing manual concepts/terms, or resurrecting hidden terms.

## Current (broken) behavior

- The Search Builder seeds concepts via `picoToConcepts(pico)`, which produces concepts
  **labelled by medical family** ("type 2 diabetes", "heart failure (HFrEF)"), grouped by
  field but **only for fields with extractable content**. So a user never sees the five
  fixed PICO-field cards; empty fields produce nothing, and one field can fan out into
  several family cards.
- **No Time Frame concept exists** — extraction only covered P/I/C/O.
- On mount the tab does `if (saved && saved.concepts) { use saved } else { seed from PICO }`.
  An empty array `[]` is truthy, so a project where a blank/legacy state was ever saved
  adopts that state and **never re-seeds from PICO** — the "empty state shadows the PICO
  concepts" bug.
- PICO changes only flipped a `picoDirty` flag and surfaced a manual **"+N new suggestions
  from PICO"** button. Sync was opt-in, not automatic — "PICO saved but Search Builder not
  subscribed to those changes."

## Root cause

The seed/sync model was **family-grouped and opt-in**, not **field-grouped and idempotent**.
There was no single function that guarantees "the 5 PICO field groups exist and each mirrors
its field", safe to run on mount and on every PICO change. Combined with the truthy-empty
saved-state guard and the missing Time Frame field, the five-concept default and live PICO
sync could not hold.

## Files involved

- `src/research-engine/searchBuilder/conceptExtraction.js` — per-field term extraction (kept; reused).
- `src/research-engine/searchBuilder/searchState.js` — **new** idempotent
  `syncSearchBuilderFromPico(pico, existingConcepts, ignored)` + `timeframeLabel` +
  `extractFieldTerms` + `PICO_FIELD_DEFS`.
- `src/features/searchBuilder/SearchBuilderTab.jsx` — init + auto-sync rewired to the new
  function; Time Frame group note; PICO groups non-deletable; manual concepts/terms and
  hidden terms preserved.
- `server/searchEngine/searchEngineController.js` + `searchBuilderApi.js` — unchanged contract
  (already revision-aware + `search.updated` realtime poke from SE1).
- PICO source (read-only): `meta-lab-3-patched.jsx` `pico` object
  `{P,I,C,O,timeframe,timeframeMode,tfStart,tfEnd,…}`, passed to the tab via
  `SearchDispatcher` `pico={project.pico}`. The monolith already refetches the project on a
  `project.updated` realtime poke, so collaborator PICO edits reach the tab's `pico` prop live.

## Proposed minimal, safe fix

Introduce a pure, idempotent **`syncSearchBuilderFromPico(pico, existingConcepts, ignored)`**:

- Always emits the **five canonical PICO groups** (stable `picoField` key `P/I/C/O/T`), in
  order, each labelled by its field.
- Populates P/I/C/O by **flattening** that field's `extractConcepts(...)` ladders/synonyms
  into one deduped term list, minus any `ignored` (hidden/deleted) terms.
- **Time Frame** carries no search keyword (a date restriction is not a tiab term); it shows
  the selected restriction as a `note` derived from `timeframeMode`/`tfStart`/`tfEnd`/legacy
  `timeframe`. (No syntax-renderer change — empty-term concepts simply don't contribute to
  the query.)
- **Preserves** user work: manual concepts (no `picoField`) are kept and appended after the
  five; manual/synonym terms inside a field group are kept; auto terms the user converted to
  MeSH are kept even if no longer extracted; existing term objects (with their `id`/`vocab`)
  are reused so MeSH lookups and ids survive.
- **Migrates** SE1-era family concepts (keyed by their `field` label) into the five groups,
  so saved searches don't lose terms.
- **Idempotent**: same PICO + same existing ⇒ same result (dedup by normalized text; no
  duplicate terms after repeated sync).

The tab calls it (a) on mount after `loadSearch` and (b) automatically whenever the `pico`
prop changes (replacing the manual "+N suggestions" button), then persists via the existing
revision-aware autosave and broadcasts via the existing `search.updated` poke (SE1). Hidden
terms are restored via the existing "Reset suggestions" action.

## Assumptions / trade-offs (documented)

- **Within-field OR.** Per SE2's example, all of a field's terms live in one group (OR'd).
  For a field naming two distinct concepts ("T2DM with HFrEF") this ORs them rather than
  ANDing; users who need AND between sub-concepts can split via **Add Concept**. This follows
  SE2's explicit UI spec; the syntax renderers are unchanged.
- **MeSH** stays heuristic/server-proxied and is never called from CI (mocked via `props.api`).
- **Last-write-wins** on the whole-document save remains (revision + lastSaved guard prevent
  self-clobbering/ping-pong); idempotent sync makes concurrent PICO-driven syncs converge.
