# Current Monolith & State Map (prompt38, Phase 1)

_Derived from a code sweep (not guessed). The monolith grew to **9095 lines**._

## A. Monolith section map — `meta-lab-3-patched.jsx`

One module: engine/constants → ~40 tab/panel components → the `MetaLab`
default-export App shell (L7971–9095) that wires them. Target feature tags show
where each section will move during decomposition.

| Section | Lines | Responsibility | Target |
|---|---|---|---|
| Effect-size math/validation constants (`Z975`, `CONVERSIONS`) | 37–586 | pure stats/validation | lib-utils (mostly already in `research-engine`) |
| Extraction enum/label maps | 857–886 | extraction options | data-extraction |
| `ES_TYPES`/`ROB2`/`NOS`/`PRISMA_CL`/`MESH_DBS`/`PROSP_FIELDS` | 1040–1138 | registries | lib-utils / rob / reports |
| `mkProject` / `mkStudy` | 811–856 | **canonical project + study blob shape** | persistence-adapter |
| `C` theme tokens | 1139–1209 | local var(--t-*) token object | shared-ui |
| `SwitchToggle`/`SectionHeader`/`InfoBox`/`HelpTip`/`AIButton`/`ProgressBar` | 1210–1318 | primitives | shared-ui |
| `ForestPlot` / `FunnelPlot` | 1319–1509 | SVG plots | analysis |
| **`PICOTab`** | 1859–2058 | **protocol/PICO editor + criteria + field locks** | **protocol (migrating now)** |
| `SearchTab` / `CombinedDBView` / `MeSHTab` | 2059–2558, 5291–5899 | search-string builders | protocol |
| `ScreeningModule` / `MetaSiftPrismaSync` / `EmbeddedScreening` | 2559–2816, 7384–7431 | screening wrappers | screening |
| `PRISMATab` / `PrismaFigureExport` | 2817–2940 | PRISMA flow | reports |
| `ESCalcInline` / `ConversionPanel` / `AddStudyModal` / `StudyCard` / `ExtractionTab` | 2941–3942 | data extraction | data-extraction |
| `RoBTab` (dispatcher) / `LegacyRoBTab` | 3943–4082 | risk of bias | risk-of-bias |
| `AnalysisTab` / `DataBehindAnalysis` / `SensitivityTab` / `SubgroupTab` | 4083–4595, 6191–6508 | meta-analysis | analysis |
| `ResearchExport` / `ResultsWriteup` / `ManuscriptTab` / `MethodsTab` / `ReportTab` | 4596–5290, 6763–6972 | reports/export | reports |
| `ForestTab` | 5070–5252 | forest-plot wrapper | analysis |
| `PROSPEROTab` | 5900–6190 | protocol/PROSPERO registration | protocol |
| `GRADE_*` + `GRADETab` | 6509–6762 | GRADE certainty + RoB→GRADE sync | grade |
| `TABS`/`PHASES`/`WORKFLOW_TAB_IDS`/`READING_TABS` | 6973–7011 | tab registry + phases | project-shell |
| `TIMEFRAME_OPTIONS` + `timeframeComplete` | (was 7015–7045) | **EXTRACTED → `features/protocol/constants.js` (prompt38)** | protocol ✅ |
| `CriteriaList` | 7046–7196 | structured incl/excl editor | protocol |
| `AuditPanel` / `auditProject` | 7197–7270 | completeness audit | project-shell |
| `ProjectTitle` / `ProjectHeaderBar` | 7271–7383 | universal header | project-shell |
| `OverviewTab` | 7432–7648 | in-project overview | dashboard |
| `ControlTab` | 7649–7970 | project control (members/settings/delete) | project-control |
| `MetaLab` (default export) | 7971–9095 | **App shell**: project state, autosave bridge, nav/stepper, export/import, **tab render switch (~L8985–9075)**, `lockCtx` | project-shell |

## B. Workflow-state map (where the data actually lives)

**Key finding:** in this app, canonical workflow state is **NOT in localStorage**.
It lives in the **server `Project.data` JSON blob**, persisted by a *whole-project*
autosave. So the real risk is **whole-blob last-write-wins**, not localStorage.

| Concern | Reality |
|---|---|
| Canonical workflow state | `Project.data` (one JSON blob: `pico`, `prospero`, `search`, `studies`, `records`, `grade`, `robSync`, `analysisPrecision`, …) |
| Save path | monolith mutates the project object → `window.storage.set('meta:projects', …)` → `serverStorage.js` debounce (800ms) → `PUT /api/projects/:id/autosave` (whole blob) per project |
| Conflict model | **last-write-wins** (the blob is replaced wholesale); a stale tab can clobber newer data; `store.save()` only guards ownership/resurrection + a content-diff no-op |
| Already structured (NOT blob) | Screening (`ScreenProject` + ~15 relational tables), RoB (`RobAssessment`/`RobAnswer`/…), onboarding, institutions, user prefs, theme |
| Realtime | SSE pokes (`emitToMetaLabProject`); `hasPendingSave()` blocks remote refetch from clobbering local edits |
| Field locks / presence | ephemeral in-memory (`server/realtime/presence.js`); PICO P/I/C/O only |

### State classification (for the migration)
- **Domain data (→ structured tables / module state):** protocol/PICO, search,
  extraction studies, analysis config, GRADE, PRISMA, report drafts.
- **Already structured:** screening, RoB (keep).
- **User preference (already has server home + local cache):** theme,
  dashboardPreferences, screeningShortcuts.
- **UI-only (keep local):** nav collapse, panel split ratios, PDF toolbar, recent
  projects (derived).
- **Derived (recompute):** counts/stats/audit status.

→ localStorage detail: `localstorage-audit.md`. Target: `target-feature-module-architecture.md`.
