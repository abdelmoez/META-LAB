# Search Builder — live auto-updating hits, restore deleted PICO terms, MeSH suggestions (prompt42 Tasks 1-3)

**Files:** `src/features/searchBuilder/SearchBuilderTab.jsx` (UI + state),
`src/features/searchBuilder/searchBuilderApi.js` (API adapter),
`src/research-engine/searchBuilder/meshSuggest.js` (new pure suggestion seed),
`server/searchEngine/{nlmClient,searchEngineController}.js` + `server/routes/searchEngine.js` (backend).
Feature-flagged `searchEngine` (default OFF); persists via `WorkflowModuleState` moduleKey `search`.
The pure engine syntax renderers (`renderControlled/renderTerm/renderConcept/renderSearch`) are
**unchanged** (off-limits).

## Task 1 — hits update automatically with a clear status lifecycle

- A pure `strategyHash(str)` (exported, tested) keys the live PubMed strategy
  (`pubmedQuery`, which already prefers a hand-edited override → user edits stay safe).
- `hitState = { strategyHash, hitCount, status, lastUpdatedAt, errorMessage }` where
  `status ∈ idle | stale | updating | updated | failed`.
- On ANY search-relevant change (PICO, term add/delete/restore, MeSH add, syntax edit, filters),
  `concepts/overrides` change → `pubmedQuery` → hash changes → status flips to **stale** immediately,
  then a single **debounced (600 ms)** refresh runs: **updating → updated** (+count, +`lastUpdatedAt`)
  or **failed** (+errorMessage). Cached by query string; the fetch is skipped when the hash is unchanged
  or cached. A **race guard** (`s.strategyHash === pubHash`) discards a stale in-flight result.
- The output panel shows **"Updating hits…"**, the count + **"updated <relative time>"** (pure
  `relativeTime`), or a small **non-blocking** "⚠ hits unavailable" (never crashes / freezes the UI).
- Only PubMed is live (Embase/Cochrane are `live:false`) → they stay idle/manual, never perpetually
  updating. Hit state is runtime-only (never persisted → no stale counts on reload).

## Task 2 — restore deleted / hidden PICO terms (granular)

- Deleting an auto-suggested (`pico_auto`) term records its **provenance** — `{text, field, label}` (the
  source PICO field, read from the owning concept) — in the `ignored` set, instead of losing it.
- **Back-compatible load:** legacy `ignored` rows (plain `string[]`) are normalized to
  `{text, field:'', label:''}`; the backend `putSearch` sanitizer accepts BOTH shapes (cap preserved).
- A **"Hidden PICO terms"** panel near the Concepts header lists hidden terms **grouped by PICO field**,
  with: **restore one** (↩), **restore all from `<field>`**, and the existing **Reset suggestions**
  (restore all + re-seed). Restoring re-adds the term to its matching concept (or recreates it), drops it
  from `ignored`, re-runs MeSH lookup, and — because `concepts` changed — auto-refreshes the hit count.
- A PICO change never silently re-adds a deleted term (the seed merge still respects `ignored`).

## Task 3 — MeSH term suggestions as you type

- New pure `meshSuggest.js`: `localMeshSuggestions(text)` returns instant, offline suggestions from a
  SEED that maps common abbreviations/families → the **official MeSH heading** (e.g. **T2DM/DM2 →
  "Diabetes Mellitus, Type 2"**, HFrEF → "Heart Failure, Systolic" (+"Heart Failure"), IBD →
  "Inflammatory Bowel Diseases", EUS → "Endosonography", CKD → "Renal Insufficiency, Chronic", COPD →
  "Pulmonary Disease, Chronic Obstructive"). It reuses `CONCEPT_FAMILIES` + `ABBREVIATIONS` so the
  vocabulary lives in one place. Each suggestion is tagged `mesh | keyword | synonym`.
- Backend `nlmClient.meshSuggest(term)` (esearch retmax≈6 → esummary → `mapMeshSummary`) returns up to 6
  live MeSH records; cached + throttled; **graceful** (returns `[]` on any failure, never 500).
  Exposed via `POST /api/search-builder/mesh-suggest` (`postMeshSuggest`, flag-gated like the others) and
  `searchBuilderApi.meshSuggest`.
- The add-term box is a `SuggestBox`: merges the **instant local seed** with a **debounced (≥300 ms)
  remote** lookup (remote failure → local-only). It is **keyboard-accessible** (↑/↓ move, Enter adds the
  highlighted suggestion or the typed term, Escape closes), shows **MeSH vs keyword vs synonym badges**,
  **de-dupes** against existing terms, and adds a MeSH pick as a `controlled` term (with the descriptor
  attached via the existing lookup) or a keyword/synonym as `freetext` — which then refreshes hits.

## Tests

`tests/unit/searchBuilderHits.test.js` (strategyHash determinism, relativeTime buckets, ignored
back-compat normalization, restore preserves field), `tests/unit/meshSuggest.test.js` (T2DM →
"Diabetes Mellitus, Type 2" + the required abbreviations), and extensions to
`tests/unit/searchEngine.test.js` / `tests/unit/conceptExtraction.test.js`. No live NLM calls in CI.

## Known limitations

- Hit counts are live for **PubMed only** (the other databases have no contract count source yet).
- MeSH suggestions are **suggestions**, not authoritative — the local seed is small and high-precision;
  the live backend covers the long tail and degrades to local-only when unreachable.
