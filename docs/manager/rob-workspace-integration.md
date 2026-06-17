# RoB engine ↔ workspace integration & criteria→keywords (prompt28)

_Status: shipped in v3.11.0._

Three connected improvements, kept additive and reversible.

## 1. Project criteria → screening keywords (Part 1)

- A project's inclusion/exclusion **criteria** (`pico.incl` / `pico.excl`, edited in
  PICO & Question) now appear automatically in that project's META·SIFT screening
  keyword panel, badged **criteria**, and drive highlighting/filtering like any
  other keyword.
- Pure helper: `src/research-engine/screening/criteriaKeywords.js`
  (`criteriaKeywordsFromSnapshot`, `mergeKeywordSources`, `effectiveKeywords`).
- **Project-specific by construction**: the criteria come from the linked META·LAB
  project, cached per `ScreenProject.picoSnapshot` (already refreshed on every
  workspace/project load). One project's criteria can never reach another's panel.
- **Derived layer, not persisted**: stored default/manual keywords are untouched;
  criteria terms are merged on read, deduped (case/space-insensitive). Updating the
  criteria updates the keywords; removing them removes the derived terms. No schema
  change. The leader keyword editor still manages only the stored list.
- Server `keyword-stats` counts the effective list (stored ∪ criteria) so criteria
  badges also show article counts; it refreshes `picoSnapshot` the same lazy way
  `getProject` does, so client and server agree.

## 2. RoB engine native in the workspace "Risk of Bias" tab (Part 2)

- When `rob_engine_v2` is ON, the project's **Risk of Bias** tab IS the standalone
  RoB 2 engine, scoped to the already-open project (no project selector). When OFF,
  the original lightweight per-study table (`LegacyRoBTab`) is preserved — nothing
  breaks for orgs that have not enabled the engine.
- The engine stays modular: pure engine in `src/research-engine/rob`, data behind
  `/api/rob`, UI in `src/frontend/rob`. The shared, embeddable `ProjectRobPanel` is
  used by BOTH the standalone `/rob/:projectId` route and the workspace tab.
- Permissions: the `/api/rob` service is owner-scoped (non-owner → 404). The panel
  surfaces that as a clear "managed by the owner" notice, and `RobWorkspace` has a
  `readOnly` mode (gates answers incl. the number-key shortcut, override, finalise).
- Dynamic project state: the panel always reads the current project's studies +
  assessments; the workspace tab flushes pending autosave first so a just-added
  study is server-visible. Assessments whose study was later removed are kept and
  shown in a separate "no longer in this project" group (no silent data loss).

## 3. Traffic-light plot fixes (Part 3)

- Canvas width now fits the legend **and** the title (kills the legend clipping);
  long row labels truncate with a hover `<title>`; the plot is centred and the
  displayed SVG scales responsively while the **exported** SVG stays pristine for
  journal-ready PNG/SVG.

## 4. Per-project RoB tool selection (Part 4)

- `src/research-engine/rob/tools.js` — RoB 2 active; ROBINS-I, QUADAS-2,
  Newcastle–Ottawa, Custom shown as **Soon**/disabled. Saved per project
  (`project.robTool`, additive JSON). `normalizeRobTool` collapses any unsupported
  value back to RoB 2, so an unimplemented tool can never be used.

## Follow-ups (documented, deliberately not forced)

1. **Synthesis consumption.** `synthesisHooks.js` (`annotateForestRows`,
   `gradeRiskOfBiasInput`) are still stubs. The Forest Plot / GRADE / PRISMA /
   exports do **not** yet read the new engine's per-result judgements. Wiring them
   is a deliberate, separate change (it touches the analysis pipeline) and was left
   as a follow-up rather than risk the meta-analysis code.
2. **Legacy vs engine RoB data are separate stores.** Flag-OFF uses per-study
   `study.rob`; flag-ON uses `RobAssessment`. Toggling the flag does not migrate
   between them (the legacy adapter can read old data). A one-way importer could be
   added if an org wants continuity.
3. **Collaborative RoB.** RoB is owner-scoped like all project data; contributor
   assessment would need a sharing model on the META·LAB project itself.
4. **Additional instruments.** ROBINS-I/QUADAS-2/NOS/custom are advertised; each
   needs its own pure engine + workspace before it can be activated in `tools.js`.
