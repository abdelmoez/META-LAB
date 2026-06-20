# `meta-lab-3-patched.jsx` decomposition — refactor plan (prompt46)

The monolith (`meta-lab-3-patched.jsx`, ~9.4k lines) is being migrated into proper
modules. This is an **incremental, behavior-preserving** migration: the app must
build and the full test suite (1515 unit/screening) must stay green after **every**
step. We never rewrite from scratch and never change behavior to "improve" structure.

> Why incremental and not one big-bang: the file is a single deeply-coupled web of
> module-scope helpers, constants, ~30 stateful tab components, and one giant
> orchestrating component that owns most app state. A big-bang rewrite would almost
> certainly break behavior. Each phase below is independently shippable and reversible.

## Principles

1. Extract **pure / leaf** code first (no React state, no JSX): constants, pure
   functions, then small presentational components, then larger components, and the
   stateful orchestrator LAST.
2. Copy code **verbatim** into the new module and import it back — only adjust
   imports/exports. No logic edits in the same step as a move.
3. After each cluster: `npm run build` (exit 0) **and**
   `npx vitest run tests/unit tests/screening/unit` (all green). If a cluster can't
   stay green, revert it rather than leave the tree broken.
4. Follow the EXISTING project structure (`src/research-engine/`, `src/frontend/`,
   `src/features/`, `server/`) — do not invent a parallel tree.
5. **Do not touch the search-builder engine** (`src/research-engine/searchBuilder`,
   `src/features/searchBuilder`) — separately owned.

## Known traps (verified)

- **Duplicate definitions already exist outside the monolith.** `ES_TYPES` and the
  meta-analysis stats (`runMeta`, math helpers) live BOTH inline in the monolith AND
  in `src/research-engine/project-model/constants.js` / `src/research-engine/statistics/`.
  The monolith uses its OWN inline copies. When extracting, create fresh modules with
  the monolith's exact copies (do NOT re-point to the existing duplicates) unless a
  byte-for-byte diff proves them identical — otherwise numbers/behavior can drift.
- **`C` (theme tokens) is a LOCAL object in the monolith** (`const C={…}` ~L1156-ish),
  distinct from `src/frontend/theme/tokens.js`'s `C`. Any component extracted from the
  monolith must keep using the monolith's `C` until `C` itself is unified — so `C`
  (and the style helpers `btnS/inp/lbl/th/tagS`) must be extracted to a shared module
  BEFORE the components that use them, then both the monolith and the new component
  files import from it.
- **Closures over monolith-internal functions.** `CONVERSIONS` (entries hold `run`
  closures calling `invNorm`) and `GRADE_OPTIONS` (references `C.grn/yel/red`) are NOT
  pure data — extracting them needs their dependencies extracted first. Left inline.
- The big stateful component (`SiftProject`/the workspace orchestrator at the bottom)
  owns most state and threads it as props/closures into every tab. Extract tabs only
  after the shared helpers/tokens are modularized; the orchestrator moves last.

## Phases (extraction order, low → high risk)

- **Phase 1 — DONE (this commit).** Pure, isolated clusters:
  - `src/research-engine/import-export/referenceParsers.js` — RIS/NBIB/BibTeX/EndNote
    parsers + `parseReferences`/`dedupeRecords`/`mkRecord`/`normTitle`/`isNonPrimary`.
  - `src/research-engine/project-model/monolithConstants.js` — `ES_TYPES`, `ROB2`,
    `NOS`, `PRISMA_CL`, `MESH_DBS`, `PROSP_FIELDS`, source/data-nature/adjust/flag
    options + label maps, `GRADE_DOMAINS`.
  - Monolith 9414 → 9139 lines. Build + 1515 tests green.
- **Phase 2 — pure stats engine.** Move the inline stats (`runMeta`, `eggersTest`,
  `leaveOneOut`, `trimFill`, `influenceDiagnostics`, `subgroupAnalysis`, `calcES`,
  `CONVERSIONS`/`invNorm`, `analysisTypeWarnings`, math helpers `gammp/chiSquareCDF/
  betacf/lgamma/ibeta/tCDF/tCrit/invNormAbs/normalCDF/Z975`, `validateStudy`,
  `findDuplicates`, `checkPoolability`) into `src/research-engine/statistics/` modules
  (verbatim copies). Verify pooled numbers unchanged with the existing golden tests.
- **Phase 3 — shared tokens + UI primitives.** Extract `C`, `btnS/inp/lbl/th/tagS`,
  and the small presentational components (`SwitchToggle`, `SectionHeader`, `InfoBox`,
  `HelpTip`, `ProgressBar`, `CriteriaList`, `Frac`) to `src/frontend/workspace/ui/`.
  Then `GRADE_OPTIONS` becomes movable.
- **Phase 4 — charts.** `ForestPlot`, `FunnelPlot`, `buildPrismaSVG`, `buildPubForestSVG`,
  `liveSvgToString`, `presetTag` → `src/frontend/workspace/charts/`.
- **Phase 5 — AI/citation services** (all behind `AI_FEATURES_ENABLED=false`):
  `callClaude`/`callClaudeWeb`/`fetchCitationAI`/`fetchByDOI`/`fetchByPMID`/
  `testClaudeConnection` + `safeParseJSON`/`parseSections`/… → `src/frontend/services/ai/`.
- **Phase 6 — tab components** (one per file), after Phases 2–4 give them their imports:
  `src/frontend/workspace/tabs/` — `OverviewTab`, `PICOTab`, `SearchTab`, `MeSHTab`,
  `PROSPEROTab`, `ExtractionTab` (+ `StudyCard`/`AddStudyModal`/`ESCalcInline`/
  `ConversionPanel`), `RoBTab`/`LegacyRoBTab`, `AnalysisTab` (+ `DataBehindAnalysis`/
  `ResearchExport`/`ResultsWriteup`/`interpretResult`), `ForestTab`, `SensitivityTab`,
  `SubgroupTab`, `GRADETab`, `ReportTab`, `ManuscriptTab`, `MethodsTab`, `PRISMATab`,
  `ControlTab`, `AuditPanel`, `ProjectHeaderBar`, dispatchers.
- **Phase 7 — orchestrator.** Move the project-config helpers (`mkProject`/`mkStudy`/
  `TABS`/`PHASES`/`READING_TABS`/`readinessCheck`/`stepStatus`/`auditProject`/
  `projectPerms`/`linkedSiftId`) and finally the workspace component itself into
  `src/frontend/workspace/`. At that point the app imports the workspace from its new
  home; `meta-lab-3-patched.jsx` is reduced to a thin re-export (or deleted) and kept
  only as a legacy/reference file.

## Verification gate (every phase)

```
npm run build            # exit 0
npx vitest run tests/unit tests/screening/unit   # all green (>= 1515)
graphify update .        # keep the knowledge graph current (AST-only)
```
