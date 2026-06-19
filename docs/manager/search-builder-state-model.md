# Search Builder — State Model & Server-Backed Persistence — prompt40 Task 6

## In-component state (`SearchBuilderTab`)
- `concepts: [{ id, label, op:'AND'|'OR', field?, source?, terms: [Term] }]`
- `Term: { id, text, type:'freetext'|'controlled', field:'ti'|'tiab'|'all',
   vocab?:{mesh,emtree,synonyms,…}, source?:'pico_auto'|'user_added'|'synonym',
   synonym?:bool, noExplode?, phrase?, truncate? }`
- `overrides: { [dbId]: string }` — hand-edited per-database query strings.
- `ignored: string[]` — normalized texts of auto-suggestions the user deleted.

Concepts are OR-within (synonyms) and AND-between (different concepts) — see
`search-builder-final-report.md` Task 7.

## Persistence (server-backed, reuses prompt38 infra)
- Saved as the `search` workflow module (`WorkflowModuleState`, moduleKey `'search'`)
  via `/api/search-builder/:projectId` (GET/PUT), the SAME per-module, revision-aware
  store the Protocol module uses. No localStorage as canonical state.
- Persisted value: `{ concepts, overrides, ignored }`. `ignored` is validated and
  capped server-side (`searchEngineController.putSearch`, ≤500 string entries).
- Autosave: debounced 800 ms on any change to `concepts` / `overrides` / `ignored`.
- Load on mount: `loadSearch(projectId)` → restores concepts + overrides + ignored;
  empty → seed from PICO.

## What is saved
extracted terms · ignored/deleted terms · manual terms · per-database strategy
overrides · user edits. The PICO source is tracked implicitly by the `picoKey`
change detector (drives "new suggestions").

## Conflict / multi-user
Writes go through the per-module store; the module's revision is the authority
(same compare-and-swap → 409 path as Protocol). The Search Builder is single-
strategy-per-project, so the PUT is a full upsert (last-write-wins on the whole
search), which is the documented trade-off for this module.
