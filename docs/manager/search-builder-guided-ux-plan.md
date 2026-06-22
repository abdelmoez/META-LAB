# Search Builder — Guided, Beginner-Friendly UX (SB3)

**Status:** implemented · **Scope:** Search Builder only · **Flag:** `searchEngine` (default OFF)

This plan covers the SB3 task: turn the Search Builder from a dense, two-column
"concept builder + live output" power-tool into a **guided 5-step workflow** a
beginner can understand within ~10 seconds, without losing any expert capability.

---

## 1. Current behaviour (before SB3)

The Search Builder is a single component, `SearchBuilderTab.jsx` (~1.2k lines),
mounted by `SearchDispatcher` (`src/frontend/workspace/tabs/protocolTabs.jsx`)
**only when the `searchEngine` feature flag is ON** — otherwise the legacy in-blob
`SearchTab` renders unchanged. So this redesign cannot affect default production.

Layout today: a header (Beginner toggle, live-sync dot, stats) and a fixed
two-column grid — **left** = concept cards (term chips, MeSH editor, hidden-terms
panel, "+ concept"), **right** = a sticky "Live output" panel with PubMed / Embase /
Cochrane query strings, live PubMed hit counts, and a plain-English mirror.

It works for someone who already understands concept blocks, MeSH, explode, and
field tags. It is visually exhausting for a beginner: everything is on screen at
once, the Boolean strings are front-and-centre, and there is no on-ramp from the
research question to "what do I click first?".

### Current files / components

| File | Role |
|---|---|
| `src/features/searchBuilder/SearchBuilderTab.jsx` | The whole UI + all stateful logic (autosave, realtime sync, hit lifecycle, MeSH lookup, PICO→5-group sync). |
| `src/features/searchBuilder/searchBuilderApi.js` | Wires the 4 seams to `/api/search-builder` (mesh, mesh-suggest, count, load/save) + the flag check. |
| `src/features/searchBuilder/index.js` | Public exports. |
| `src/research-engine/searchBuilder/conceptExtraction.js` | Pure: PICO text → concept families (`picoToConcepts`). |
| `src/research-engine/searchBuilder/searchState.js` | Pure: idempotent `syncSearchBuilderFromPico` (the 5 PICO groups), persisted-slice serialization, remote-adopt decision. |
| `src/research-engine/searchBuilder/meshSuggest.js` | Pure: as-you-type local MeSH/keyword suggestions. |
| `src/research-engine/searchBuilder/medicalSynonyms.js` | Pure vocab: `CONCEPT_FAMILIES`, `ABBREVIATIONS`, `CONNECTORS`, `JUNK_WORDS`. |
| `server/searchEngine/searchEngineController.js` | HTTP layer; **whitelists** persisted keys to `{concepts, overrides, ignored}`. |

PICO object shape (from `project.pico`): `{ question, P, I, C, O, studyDesign,
timeframe, timeframeMode, tfStart, tfEnd, incl, excl, keywords, prosperoId }`.

---

## 2. UX problems being fixed

1. No on-ramp: a beginner opens the tab and sees concept cards, not their own question.
2. Everything at once: concepts + 3 database syntaxes + counts + plain English all visible — overwhelming.
3. Jargon-first: "Boolean", "MeSH", "explode", "[tiab]" appear before the user has chosen anything.
4. Only 3 databases, no guidance on which to pick or whether they need a subscription.
5. No clear "check it / export it / hand off to screening" closing step.

---

## 3. Proposed structure — a light guided stepper (5 steps)

A horizontal stepper at the top; one step visible at a time; steps are clickable
so experts can jump. **Beginner mode is the default.** All five steps read/write
the *same* concept model the engine already maintains — no parallel state.

| # | Step | Shows | Writes |
|---|---|---|---|
| 1 | **Select Keywords** | Research Question + each PICO field as readable cards with **clickable word/phrase tokens**; filler words dimmed/non-clickable; auto-suggested keywords; a "Selected keywords" tray showing each keyword's source field; a manual "add keyword" box per field. | Adds/removes terms in the matching PICO concept group. |
| 2 | **Organize Concepts** | The existing concept cards, cleaned: a per-card **status** chip (Ready / Needs review / No terms yet / MeSH suggested), collapsible advanced options, the hidden-terms panel. Reuses the term chip + MeSH editor verbatim. | Term/concept edits (unchanged engine). |
| 3 | **Choose Databases** | Expanded database catalogue grouped (core biomedical / multidisciplinary / allied health / grey literature / open), each with a conservative **access note** (Free vs "usually requires institutional subscription") and an info tooltip about institutional access. | Selected database ids (persisted). |
| 4 | **Build Strategy** | **Visual concept blocks** (label + term count) joined by AND/OR first, then the generated search logic, then the database-specific strings for the *selected* databases. Beginner vs Expert toggle (Expert exposes per-query editing + field tags). | Per-database query overrides (unchanged). |
| 5 | **Check / Export** | Selected databases, final string per database, live PubMed hit count + "updated" time, **warnings** (no terms, missing PICO concept, looks very broad/narrow), and export actions (copy per database, copy all, export a strategy table, mark ready for Screening Import). | `readyForScreening` flag (persisted). |

Step 1 is the most important. Its promise to the user: *"Click the important ideas
in your question. PecanRev turns them into a search strategy."*

### How data moves between steps

There is **one** source of truth: the five canonical PICO concept groups
(`P/I/C/O/T`) plus any manual concepts, exactly as `syncSearchBuilderFromPico`
already produces them. Step 1 adds keywords *into* those groups; Step 2 refines
them; Steps 4–5 *render* them. PICO edits still auto-sync the groups live (no
button). Nothing is duplicated, so re-opening/refreshing/syncing cannot create
double terms (the engine already dedupes by normalized text).

### Beginner vs Expert

- **Beginner (default):** plain-English labels ("Search logic" not "Boolean"),
  generated strategy, defaults pre-chosen, advanced controls hidden behind
  "Show advanced".
- **Expert:** direct query editing, field tags (`[tiab]`, `[Mesh]`), explode
  control, per-database syntax — all the existing controls, surfaced.

### Word replacements (beginner copy)

Boolean operators → "Search logic" · MeSH extraction → "Suggested medical subject
headings" · Query syntax → "Database search format" · Explode → "Include narrower
related terms" (with an advanced tooltip).

---

## 4. Data-model impact

The persisted per-project search slice grows from `{concepts, overrides, ignored}`
to `{concepts, overrides, ignored, databases, readyForScreening}`:

- `databases: string[]` — selected database ids (defaults to the three with native
  syntax when unset, so existing projects behave exactly as before).
- `readyForScreening: boolean` — set in Step 5; advisory handoff marker.

Both are **additive and optional**. `pickPersisted`/`serializeSearchState` include
them so autosave + idempotent remote-apply still work; the server `putSearch` is
extended to whitelist + validate them (capped, type-checked). Old saved searches
load unchanged (missing fields default safely). No DB migration — the search state
is a JSON blob in the existing workflow-state row.

---

## 5. Database catalogue & access-note wording

Conservative, non-absolute wording (access "depends on your institution"). Only
**PubMed, Embase, Cochrane** have verified native syntax renderers today, so only
those produce database-specific strings; the rest are selectable (for planning /
access guidance) and receive a generic keyword strategy plus an honest note that
native syntax for that database isn't generated yet. Catalogue lives in a new pure
`databases.js` (id, label, group, access tier, access note, `nativeSyntax`).

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Breaking autosave / realtime / hit lifecycle during the refactor | **Keep every existing hook, effect, ref, and mutator verbatim.** Only the `return(...)` render is reorganized into steps; logic is untouched. |
| Losing manual concepts / terms / hidden terms / overrides | All flow through the unchanged engine + persisted slice. New fields are additive. |
| Server dropping the new `databases` field | Extend the `putSearch` whitelist (small, validated, capped). |
| Generating wrong syntax for the new databases | Don't. Only the 3 verified renderers emit native syntax; others get a generic strategy + explicit note. |
| Drag-to-select multi-word phrases is fragile across browsers | Approximate with **phrase detection** (known medical phrases + concept-family triggers render as one clickable chip) + a manual add box. Documented assumption. |
| Flag is OFF in prod | Redesign ships dark by default; the marketing demo enables the flag, so screenshots reflect it. |

---

## 7. Assumptions (no clarifying questions per spec)

1. "Research Question" = `pico.question`; the six Step-1 fields map to
   `question / P / I / C / O` + Time Frame (`timeframeMode`/`tfStart`/`tfEnd`).
2. "Selected keywords" are concrete search terms inside the PICO concept groups —
   selecting a keyword adds a term to that group; unselecting removes it.
3. "Save search version" = the existing autosave (single strategy per project,
   last-write-wins); explicit *named* versions are out of scope (follow-up).
4. "Mark ready for Screening Import" persists an advisory `readyForScreening`
   flag + validates the strategy; deeper auto-handoff to Screening is a follow-up.
5. Hit counts remain PubMed-only (live); other databases show "Hit counts are not
   available for this database yet." No new live external calls; none in tests.

---

## 8. Acceptance criteria (from the spec) → where met

- Easier for a beginner → guided stepper, beginner default, plain language. ✓
- Step 1 selects keywords from the question/PICO; select & unselect. ✓
- Auto-suggested keywords are helpful but not forced. ✓
- Selected keywords flow into PICO concept groups; groups shown individually. ✓
- Concept view cleaner (status chips, collapsible advanced). ✓
- Choose databases; access notes (free vs subscription). ✓
- Strategy generated from concepts; beginners need no Boolean; experts keep advanced editing. ✓
- PICO autosync still works; manual concepts/terms preserved; nothing outside Search Builder changes. ✓

---

## 9. Minimal implementation

**New (pure, tested):** `keywordSelection.js` (tokenize text → selectable
word/phrase/filler tokens), `databases.js` (catalogue + access notes). **Extended:**
`searchState.js` (`addManualTermToField`, `removeTermFromField`, `conceptStatus`,
`databases`/`readyForScreening` in the persisted slice). **Refactored render only:**
`SearchBuilderTab.jsx` (5-step shell reusing existing logic). **Server:**
`searchEngineController.js` whitelist += `databases`, `readyForScreening`.
**Tests:** keyword tokenization/filler/phrase, catalogue integrity, persisted
round-trip, concept status.
