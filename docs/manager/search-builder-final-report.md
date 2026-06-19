# Search Builder + Server-Backed Parity — Final Report (prompt40, v3.23.0)

## 1. Server-backed UI parity issues found
`ProtocolModulePanel` (server-backed) had data persistence but a plain form, missing
the legacy PICOTab polish (SectionHeader, required-progress card, numbered sections,
colour-coded P/I/C/O cards + asterisks, interactive CriteriaList, HelpTips, timeframe
validation, monospace keywords, InfoBox footer). Detail: `server-backed-ui-parity.md`.

## 2. What was changed to match the old UI
New `src/features/protocol/picoUi.jsx` (SectionHeader/InfoBox/HelpTip/CriteriaList/
RequiredPicoCard, built on shared `Icon`/`Tooltip`); `ProtocolModulePanel` rewritten
to the legacy layout while preserving server state, revision/409 conflict, presence
locks, read-only, and `onMirror`. AI buttons are absent from BOTH editors
(`AI_FEATURES_ENABLED` is false) — parity, not a gap.

## 3. PICO auto-sync
Non-destructive: PICO change → `+ N new suggestions` → adds only new concepts; manual
and edited terms are never overwritten. Detail: `search-builder-pico-sync.md`.

## 4. Concept extraction logic
Deterministic split on connectors → strip junk → match a medical concept family →
emit a term ladder (+ abbreviation expansions). Detail:
`search-builder-concept-extraction.md`.

## 5. Example — "type 2 diabetes mellitus with HFrEF"
→ concept **diabetes**: type 2 diabetes mellitus · diabetes mellitus · diabetes · T2DM
→ concept **heart failure**: heart failure with reduced ejection fraction · HFrEF · heart failure
Rendered (PubMed): `((... diabetes ... ) AND (... HFrEF ... ))`.

## 6. Search Builder UX improvements
`+ N new suggestions` change-log, `↺ Reset suggestions`, per-term delete (existing),
term `source` provenance. Detail: `search-builder-ux-redesign.md`.

## 7. Term delete behavior (Task 5)
Each term chip has a `×`. Deleting an **auto** term records its normalized text in
`ignored` (persisted) so PICO re-sync won't re-add it; deleting a **manual** term just
removes it. Deleting a concept ignores its auto terms. Reset suggestions clears the
ignore list and re-seeds (keeping manual concepts).

## 8. Deleted/ignored persistence
`ignored: string[]` is saved in the `search` module value and capped server-side
(≤500). Survives refresh and re-sync.

## 9. Server-backed Search Builder state
Reuses the prompt38 `WorkflowModuleState` (`moduleKey 'search'`) via
`/api/search-builder/:projectId`; value `{concepts, overrides, ignored}`; 800 ms
debounced autosave; revision-aware. Detail: `search-builder-state-model.md`.

## 10. Backend changes
`searchEngineController.putSearch` now also persists `ignored` (validated, capped).

## 11. Frontend changes
New `conceptExtraction.js`, `medicalSynonyms.js`, `picoUi.jsx`; `SearchBuilderTab`
(extraction-driven seed, ignore tracking, non-destructive merge, reset, change-log
banner, term provenance); `ProtocolModulePanel` parity rewrite.

## 12. Database / migration
None. (Persistence reuses the existing `WorkflowModuleState`.)

## 13. Tests added
`tests/unit/conceptExtraction.test.js` (14 cases, incl. all prompt worked examples).
Gate total **1424** green.

## 14. Manual QA
Flag ON → PICO tab matches legacy. Enter "type 2 diabetes mellitus with HFrEF" in
Population → both diabetes and heart-failure concepts appear. Delete one term → only
it goes, strategy updates, re-sync doesn't re-add it, Reset restores it. Edit a
PubMed strategy → changing PICO does not destroy the edit (override + Revert).
Refresh → state persists. (Visual rendering is manual-QA; the extraction + state
logic is unit-tested.)

## 15. Build / test results
`npm run build` green; gate `tests/unit tests/screening/unit` = 1424 passed.

## 16. Version
3.22.0 → **3.23.0** (minor — Search Builder intelligence + server-backed UI parity).

## 17–18. Commit / push
See the landing commit (pushed to `main`).

## 19. Known limitations
- Concept extraction is dictionary-driven: unknown phrases are searchable but get no
  synonym ladder (extend `medicalSynonyms.js`). Connectors `in`/`for` may over-split
  occasionally (user reviews/deletes).
- Re-sync merge adds new concepts but does not auto-refresh synonyms of EXISTING
  concepts when PICO text is reworded (avoids overwriting edits) — Reset re-seeds.
- Search Builder + Protocol visual rendering verified by build + code review; no
  headless-browser visual QA in CI.

## 21. Follow-up round (limitations addressed)
- **Per-term provenance badges shipped** — each chip now shows AUTO / ADDED / SYN
  (tooltip) so auto-generated vs manual vs synonym terms are clear at a glance
  (Task 4); edit/remove buttons gained `aria-label`/`title` (Task 5 accessibility).
- The soft-connector ("in"/"among") over-split of fixed phrases ("carcinoma in situ")
  found in adversarial review was fixed before the first commit (regression-tested).

## 20. Recommendations (future)
- Render `source` badges + a per-database date filter from the Time Frame field.
- Add CINAHL/Scopus/Web of Science renderers (engine is per-database pluggable).
- Optional UMLS/MeSH-RDF expansion to grow synonyms beyond the local dictionary.
- A small "what changed" diff when re-syncing (added/removed concept summary).
