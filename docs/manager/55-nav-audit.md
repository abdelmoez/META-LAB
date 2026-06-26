# 55.md — Project Navigation IA Redesign: Consolidated Audit & Plan

**Lead architect reconciliation of 8 parallel audit findings, grounded in real files.**
Spec: `.claude/Prompts/55.md` (30 acceptance criteria). Scope: purple rail → 9 categories, persistent white submenu, restored steppers, calmer Overview, top-bar presence, design-switch relocation. Read-only audit — no code changed.

Key real files (single source of truth today):
- `src/frontend/workspace/projectHelpers.js` — `TABS` (L199-233), `PHASES` (L234), `stepStatus()` (L265), `auditProject()` (L308), `readinessCheck()` (L248), `projectPerms()`, `linkedSiftId()`.
- `src/frontend/stitch/nav/navConfig.js` — centralized nav model: `buildProjectNav()` (L111), `projectStageHref()` (L139), `SCREENING_SUBNAV` (L153), `screeningSubHref()` (L171), `activeProjectStage()` (L231).
- `src/frontend/stitch/shell/StitchProjectRail.jsx` — purple rail (renders all 19 stages flat).
- `src/frontend/stitch/pages/StitchProjectWorkspace.jsx` — `?tab=` router; `SCOPE` set (L70), `contextRail: null` (L135), presence in page header (L184), full-bleed gate (L128).
- `src/frontend/stitch/shell/StitchAppShell.jsx` — shell; `contextRail` prop already supported (L65), mobile drawer.
- `src/frontend/stitch/shell/shellParts.jsx` — `StitchContextRail` (L149, generic white 280px column, EXISTS), `StitchTopHeader` (L248, utilities cluster L263).
- `src/frontend/stitch/pages/StitchProjectOverview.jsx` — overview (all metric/phase/audit/team cards).
- `src/frontend/screening/pages/SiftProject.jsx` — `EMBEDDED_TABS` (L57), `?screen=` param (L104), `TAB_ALIASES` (L43).
- `src/frontend/screening/ui/Stepper.jsx` + `screeningSteps.js` — screening `StepIndicator` + `buildScreeningSteps()`.
- `src/frontend/design/AdminDesignSwitch.jsx` — floating pill `top:12 right:12 z:2147483000` (L84); inline variant.
- `src/frontend/workspace/tabs/overviewTabs.jsx` — legacy `ProjectHeaderBar`: middle cluster has `fileText`/Export-report (L183) and `grid`/Projects (L189) — the design-switch relocation target.

---

## 1. Route & Navigation Matrix (9 categories → REAL routes)

The 9 target categories map onto the existing legacy `TABS`/`PHASES` model. Categories 3-8 are the `PHASES` (with "Plan" relabelled "Plan & Protocol" via existing `PHASE_LABEL`, L244). Categories 1, 2, 9 are the `group:project` / `group:reference` tabs. **No new routes are required** — every child already has a `?tab=` (and screening `?screen=`) route. Completion source = `stepStatus()` key unless noted.

Legend: WF# = legacy `TABS` `num`; Perm "all" = any project member with view access (mutation gated at backend `updateProject`/engine); "Proj-scoped" = yes for every row (no global project nav variant exists).

| # | Main category | Child item | Route / tab | Permission gate | WF order | Completion-state source | In white submenu? | In stepper? | Proj-scoped? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Overview** | (no children) | `/app/project/:id` (bare) | view | — | n/a (roll-up page) | **NO** (reclaim width) | current-stage anchor | yes |
| 2 | **Project Control** | (no children) | `?tab=control` | view; edit→`canManageSettings`/owner/leader | — | n/a | **NO** (reclaim width) | no | yes |
| 3 | **Plan & Protocol** | PICO & Question | `?tab=pico` | view; edit→canEdit | 1 | `stepStatus.pico` | YES | YES | yes |
| 3 | Plan & Protocol | Protocol | `?tab=prospero` | view; flag `serverBackedWorkflowState`→ProtocolModulePanel else legacy | 2 | `stepStatus.prospero` | YES | YES | yes |
| 4 | **Search** | Search Builder | `?tab=search` | view; flag `searchEngine`→SearchBuilderTab else legacy | 3 | `stepStatus.search` | YES | YES | yes |
| 4 | Search | Search & Discovery | `?tab=discovery` | view + readOnly prop; flag `pecanSearch` (else disabled-note) | 4 | (no stepStatus key) | YES | YES | yes |
| 5 | **Screen** | Screening Overview | `?tab=screening` (+`screen=overview`) | view; needs `linkedSiftId` | 5 | screening roll-up (none) | YES (full screening sub-stepper) | YES (1 stepper node) | yes |
| 5 | Screen | Import | `?tab=screening&screen=import` | `canImportRecords` | 5.1 | `dataSummary.totalArticles` | YES | sub | yes |
| 5 | Screen | Duplicates | `&screen=duplicates` | `canManageDuplicates` | 5.2 | `unresolvedDuplicateGroups` | YES | sub | yes |
| 5 | Screen | Title & Abstract | `&screen=screening` | `canScreen` | 5.3 | `titleAbstractPending` | YES | sub | yes |
| 5 | Screen | Conflicts | `&screen=conflicts` | `canResolveConflicts` | 5.4 | `unresolvedConflicts` | YES | sub | yes |
| 5 | Screen | Final Review (full-text/2nd) | `&screen=second-review` | `canSecondReview` | 5.5 | `eligibleSecondReview` | YES | sub | yes |
| 5 | Screen | Settings | `&screen=control` | `canManageSettings` | — | n/a | YES | no | yes |
| 5 | Screen | Export | `&screen=export` | `canExportRecords`/`canExport` | — | n/a | YES | no | yes |
| 5 | Screen | PRISMA Flow | `?tab=prisma` | view | 6 | `stepStatus.prisma` | YES (under Screen) | YES | yes |
| 6 | **Extract** | Data Extraction | `?tab=extraction` | view; edit→`canManageExtraction` | 7 | `stepStatus.extraction` | YES | YES | yes |
| 6 | Extract | Risk of Bias | `?tab=rob` | owner OR `canAssessRiskOfBias`; flag `rob_engine_v2` | 8 | `stepStatus.rob` | YES | YES | yes |
| 7 | **Analyze** | Meta-Analysis | `?tab=analysis` | view; `canRunAnalysis` | 9 | `stepStatus.analysis` | YES | YES | yes |
| 7 | Analyze | Forest Plot | `?tab=forest` | view (export-only) | 10 | `stepStatus.forest` | YES | YES | yes |
| 7 | Analyze | Sensitivity & Bias | `?tab=sensitivity` | view | 11 | `stepStatus.sensitivity` | YES | YES | yes |
| 7 | Analyze | Subgroup Analysis | `?tab=subgroup` | view | 12 | `stepStatus.subgroup` | YES | YES | yes |
| 7 | Analyze | Network Meta-Analysis | `?tab=nma` | view; flag `networkMetaAnalysis` (else disabled-note) | 13 | (no stepStatus key) | YES | YES | yes |
| 8 | **Report** | GRADE Certainty | `?tab=grade` | view | 14 | `stepStatus.grade` | YES | YES | yes |
| 8 | Report | PRISMA Checklist | `?tab=report` | view; `canExport` | 15 | `stepStatus.report` | YES | YES | yes |
| 8 | Report | Manuscript Draft | `?tab=manuscript` | view | 16 | `stepStatus.manuscript` | YES | YES | yes |
| 9 | **Reference** | Methods & Equations | `?tab=methods` | view | — (phase:null) | n/a (reference) | YES (single item ok) | no | yes |

**IA reconciliation decisions (resolving cross-audit conflicts):**
- **RoB placement (screening-workflow vs perms-flags disagreement):** `TABS` puts `rob` in phase `Extract` (num:8). Keep it under **Extract** for the matrix to preserve the existing `stepStatus`/`num` ordering and avoid moving data. 55.md §Analyze explicitly says "determine whether RoB belongs under Extract, Analyze… by reviewing the current architecture" → current architecture = Extract. (Optional later: surface a RoB cross-link in Analyze, no data move.)
- **PRISMA Flow placement:** legacy phase is `Screen` (num:6). It is a screening output → keep under **Screen** category (last item after the screening sub-stepper), not a separate category.
- **Screen is the special case:** its white submenu must show BOTH the embedded screening sub-stages (`EMBEDDED_TABS`/`SCREENING_SUBNAV`, the 8 `?screen=` steps) AND `PRISMA Flow` (`?tab=prisma`). Two different param spaces under one category.
- **"Reference" today = only Methods.** 55.md §Reference lists a richer library (Included/Excluded studies, citations, PDFs). Those do NOT exist as routes yet → matrix lists ONLY the real `methods` route; the richer set is a documented future expansion, NOT faked.
- **Categories that are flag-gated** never disappear from nav (graceful disabled-note pattern, per perms-flags audit) — submenu item stays, body shows disabled-note.

---

## 2. What already exists (design2/design3/design4) vs what 55.md still needs

### Already built and reusable (DO NOT rebuild)
- **Centralized nav model** (`navConfig.js`): `buildProjectNav()` already returns `{project, phases, reference, flat}` grouped by the 9 categories' underlying structure. `projectStageHref`, `screeningSubHref`, `activeProjectStage`, `activeGlobalKey` exist and are unit-tested (`tests/unit/stitchNavRedesign.test.jsx`). **This is the contract 55.md §"Shared Navigation Architecture" asks for** — extend it, don't replace it.
- **`SCREENING_SUBNAV`** (L153): the 8 screening steps with `step`/`count` keys are **already defined** — just unused in UI.
- **`StitchContextRail`** (shellParts L149): a generic, collapsible, white 280px column **already exists** and is keyboard/landmark-correct (`<aside aria-label>`). The shell (`StitchAppShell` L65) **already accepts a `contextRail` prop** and renders it beside the purple rail on desktop, hides it < 1024px. The plumbing for the white submenu is present; `StitchProjectWorkspace` just passes `contextRail: null` (L135).
- **`?tab=` deep-link routing**: refresh/back/forward/new-tab restoration works — URL is source of truth (`activeProjectStage(useLocation().search)`). Acceptance #6, #22 are structurally met for tab level.
- **Native engine rendering** (design4): all 18 stages render inside the ONE shell via lazy components (`SCOPE` set). Engine separation preserved. Acceptance #13 met.
- **Screening sub-stepper engine**: `buildScreeningSteps()` + `StepIndicator` (`Stepper.jsx`) already render a glyph-based stepper with counts from `dataSummary` and live realtime refresh — **inside SiftProject**. Acceptance #9 core logic exists.
- **Presence**: `useProjectPresence` + `PresenceIndicator` (avatars, +N overflow, popover, field locks, privacy gate) fully functional. Acceptance #15 met.
- **Design switch**: admin-only, dual-variant (floating legacy / inline stitch), server-enforced. Switching preserves route. Acceptance #19/#20 mechanism intact.
- **Overview**: rich data already fetched (`stepStatus`, `auditProject`, `readinessCheck`, presence, members, metrics) — the redesign is reorganization, not new data.

### What 55.md still needs (the actual work)
1. **Purple rail = 9 categories only** (today: 19 flat stages). New: collapse `phases` into single category buttons; Overview/Control/Reference as their own buttons.
2. **Persistent white submenu** driven by active category (today: `contextRail: null`). New: per-category child list rendered into `StitchContextRail`; persistent (not hover-flyout); hidden for Overview/Control.
3. **Restored main workflow stepper** in/under the purple rail with non-color states (today: 7px color dots only — fails WCAG 1.4.1 / acceptance #11, #12).
4. **Screening sub-stepper mounted in the white submenu on the Screen category** (today: only inside SiftProject body; `StitchWorkflowNav` template exists but unmounted).
5. **Top-bar presence** (today: presence in page content L184/Overview L295). Move avatars+overflow into `StitchTopHeader` utilities cluster (L263), between NotificationsBell and theme toggle.
6. **Overview redesign** — calmer hierarchy + single next-action (data already present).
7. **Legacy design-switch relocation** — out of fixed `top:12 right:12` pill into legacy `ProjectHeaderBar` middle cluster, left of Export-report (`fileText` L183) or Projects (`grid` L189).
8. **Submenu-active derivation from route** + category-active derivation (extend `activeProjectStage` → also resolve active category + whether submenu shows).

---

## 3. Per-acceptance-criterion status (30)

Status: MET / PARTIAL / MISSING — file to touch.

| # | Criterion | Status | File(s) to touch / evidence |
|---|---|---|---|
| 1 | Purple rail shows only 9 categories | **MISSING** | `StitchProjectRail.jsx` (renders flat 19); `navConfig.js` add `buildCategoryNav()` |
| 2 | Overview opens without white submenu | **PARTIAL** | `StitchProjectWorkspace.jsx` L135 (`contextRail:null` already — but no submenu exists yet to suppress); needs category model |
| 3 | Project Control without white submenu | **PARTIAL** | same; encode "no children" in category model (`navConfig.js`) |
| 4 | Categories with children open persistent white submenu | **MISSING** | new `StitchProjectSubnav.jsx` → pass as `contextRail`; `StitchProjectWorkspace.jsx` L135 |
| 5 | Submenu does not disappear when pointer leaves | **MET (structurally)** | `StitchContextRail` is a static `<aside>`, not hover — just needs to be mounted |
| 6 | Direct nested URL restores category + submenu | **PARTIAL** | `activeProjectStage` resolves tab; add `activeCategoryFor(stage)` resolver in `navConfig.js` |
| 7 | Every engine page represented in correct category | **MET (data)** | `TABS`/`buildProjectNav` already map all; matrix §1 confirms |
| 8 | Screening exposes full workflow import→export+settings | **PARTIAL** | `SCREENING_SUBNAV` defined (L153) but unmounted; render in submenu |
| 9 | Screening stepper works with real data | **MET (engine)** | `buildScreeningSteps()`/`Stepper.jsx` live; mount in submenu (move/reuse) |
| 10 | Main legacy-inspired stepper restored in purple rail | **MISSING** | new `StitchWorkflowStepper.jsx`; data from `stepStatus()` |
| 11 | Colored dots replaced by clearer stepper | **MISSING** | `StitchProjectRail.jsx` `StatusDot` (L32) → replace with glyph+label states |
| 12 | All stepper states have non-color indicators | **MISSING** | same; add icon/text per state (done check / in-progress / attention alert / locked) |
| 13 | Engines separate backend, integrated frontend | **MET** | `StitchProjectWorkspace` SCOPE + lazy engine mounts |
| 14 | "Active now" beside notifications in top bar | **MISSING** | `shellParts.jsx` `StitchTopHeader` L263; pass presence from `StitchAppShell`/workspace |
| 15 | Presence remains project-specific + functional | **MET** | `useProjectPresence` (project-scoped heartbeat); keep |
| 16 | Overview reorganized + clear next action | **PARTIAL** | `StitchProjectOverview.jsx` (next-step CTA exists, needs to be primary) |
| 17 | Overview calmer / less overwhelming | **PARTIAL** | `StitchProjectOverview.jsx` (progressive disclosure of audit/metrics) |
| 18 | Role/permission behavior correct | **MET** | `projectPerms`/backend gates unchanged; submenu must filter by perm (new) |
| 19 | Legacy design functional | **MET** | preserve; only header switch moves |
| 20 | Stitch design functional | **MET** | preserve |
| 21 | Legacy design switch no longer overlaps | **MISSING** | `AdminDesignSwitch.jsx` floating variant + `overviewTabs.jsx` `ProjectHeaderBar` L181-190 |
| 22 | Nav works refresh/back/fwd/deep-link/new-tab | **PARTIAL** | tab-level MET; category+submenu derivation needs same (`navConfig.js`) |
| 23 | Mobile/tablet intentional | **PARTIAL** | `StitchAppShell` drawer exists; submenu-in-drawer needs design (L69) |
| 24 | Keyboard navigation works | **PARTIAL** | rail/contextRail focusable; new stepper+submenu need `aria-current`, focus order |
| 25 | Light + dark themes work | **MET** | scoped `--t-*` tokens; new components must use `S`/`salpha` |
| 26 | Automated tests pass | **PARTIAL** | extend `tests/unit/stitchNavRedesign.test.jsx`; add stepper/submenu/presence-format unit tests |
| 27 | No clipping/overlap/overflow | **MISSING→verify** | layout work + Playwright visual states (`e2e/`) |
| 28 | No data loss | **MET (by design)** | read-only nav change; no schema/data touch |
| 29 | No console errors / unhandled rejections | **verify** | post-impl review |
| 30 | One cohesive PecanRev app | **PARTIAL** | sum of above |

---

## 4. Risk-ordered implementation plan

**Principle:** establish the shared centralized navigation CONTRACT first (one pure module, fully unit-tested), then build presentation against it. Small/safe items that unblock or de-risk go early; large multi-file layout work goes after the contract is locked.

### Phase 0 — Centralized navigation contract (SMALL, pure, SAFE; foundation for everything)
**File:** `src/frontend/stitch/nav/navConfig.js` (extend; pure, no React → trivially testable). Add:
- `PROJECT_CATEGORIES` — the 9 categories with `{id, label, icon, kind:'overview'|'control'|'phase'|'reference', hasSubmenu:boolean, children:[stageIds]|null}`. Derive children from `TABS` by phase/group (reuse `buildProjectNav`). Screen category children = `SCREENING_SUBNAV` keys + `prisma`.
- `categoryForStage(stageId)` → category id (route → active category resolver).
- `submenuForCategory(categoryId, ctx)` → ordered child descriptors with `href` (reusing `projectStageHref`/`screeningSubHref`) + `completionKey`.
- `categoryShowsSubmenu(categoryId)` → false for `overview`/`control`.
- Keep all existing exports back-compat. **Unit tests** in `tests/unit/stitchNavRedesign.test.jsx` (acceptance #26 partial; covers #1,#3,#6,#7,#22 logic). **Risk: very low. No UI change yet.**

### Phase 1 — Two SMALL, SAFE, independent wins (parallelizable, low blast radius)
1a. **Legacy design-switch relocation (acceptance #21).** `AdminDesignSwitch.jsx`: change the legacy path from the fixed `top:12 right:12` portal pill to an `inline` instance rendered inside `ProjectHeaderBar` (`overviewTabs.jsx` L181-190 middle cluster, left of `fileText` Export-report L183), preserving the admin gate (`if(!isAdmin) return null`). Other legacy pages (non-project) keep a portal but repositioned to avoid header overlap, OR mount inline in their own headers. **Single concern, admin-gated, no data. Risk: low** (must verify across all legacy routes that have/lack a header — keep a safe portal fallback for header-less pages).
1b. **Top-bar presence (acceptance #14).** `StitchTopHeader` (`shellParts.jsx` L263): insert `PresenceIndicator` between `NotificationsBell` and theme toggle with a visual divider. Lift `useProjectPresence` state to where the shell can receive it (pass `presence` prop down from `StitchProjectWorkspace`/`StitchProjectOverview` into `StitchAppShell`→`StitchTopHeader`). Remove the in-content copies (workspace L184, overview L295) to avoid duplicate widgets (#408 in presence audit). **Risk: low-medium** — needs a clean prop path; handle empty state (render nothing when 0 users) and project-switch reset (key the indicator on projectId).

### Phase 2 — White submenu + shell wiring (MEDIUM, multi-file, the IA core)
- **New `src/frontend/stitch/shell/StitchProjectSubnav.jsx`**: consumes `submenuForCategory()`, renders into the existing `StitchContextRail` (reuse, don't rebuild). Active item from route (`activeProjectStage`); `aria-current`; tooltips for truncation; permission filtering (hide/disable child if perm missing, using `projectPerms` + screening perms). For the **Screen** category, embed the screening sub-stepper (Phase 4).
- **`StitchProjectWorkspace.jsx`** L135: replace `contextRail: null` with `categoryShowsSubmenu(activeCategory) ? <StitchProjectSubnav…/> : null`. Overview/Control/(and bare reference if single) reclaim width automatically (shell already centers main column; `maxWidth` logic L136 stays). **Acceptance #2,#3,#4,#5,#8.**
- Mobile: pass submenu as `contextRailMobile` into the drawer (shell L69 already stacks) OR layered nav. **Acceptance #23 partial.**
- **Risk: medium** — layout stability (#27): the shell already reserves the context column with a fixed 280px; the main risk is the transition between submenu/no-submenu categories (avoid width jump — keep main column `margin:0 auto`, animate submenu mount). The `StitchContextRail` and shell slot already exist, which de-risks this substantially.

### Phase 3 — Purple rail = 9 categories (MEDIUM, focused single-file rewrite)
- **`StitchProjectRail.jsx`**: render `PROJECT_CATEGORIES` (9 buttons) instead of `buildProjectNav().flat` (19). Active category from `categoryForStage(stage)`. Clicking a category with children navigates to its first/overview child and reveals submenu; Overview/Control navigate directly (no submenu). Keep collapse/expand + keyboard + brand + profile footer. **Acceptance #1.**
- **Risk: medium** — this is the most user-visible structural change; existing rail tests will need updates. Single file, well-bounded.

### Phase 4 — Steppers with non-color states (MEDIUM/LARGE — the WCAG-critical work)
- **Main workflow stepper (`StitchWorkflowStepper.jsx`, new):** ordered category/stage progress from `stepStatus()`. Replace `StatusDot` color-only dots (`StitchProjectRail.jsx` L32) with a state system: Not-started / In-progress / Completed (check glyph) / Needs-attention (alert glyph) / Blocked / Optional — each with **icon + text label + aria**, not color alone. Usable in compact (icon+tooltip) and expanded (icon+label) rail states. **Acceptance #10,#11,#12.**
- **Screening sub-stepper:** reuse `buildScreeningSteps()`/`StepIndicator` (already real-data, already glyph-based) — mount inside the Screen submenu (Phase 2). Reuse, don't fork. **Acceptance #9.**
- **Define ONE status language** in `navConfig.js`/a `navStatus.js` pure helper shared by rail dots, main stepper, and submenu badges (spec: "one clear status language"). **Risk: medium** (pure logic, testable) + visual.

### Phase 5 — Overview redesign (LARGE, single-file but heavy; data already present)
- **`StitchProjectOverview.jsx`**: reorganize into spec's hierarchy — compact header → ONE prominent next-action (drive from `stepStatus`+`readinessCheck`+`auditProject` first-blocker) → calm workflow progress → items-requiring-attention (from `auditProject` severity) → recent activity → team snapshot (dedupe vs top-bar presence) → progressive-disclosure metrics. Role-adaptive. **Preserve all existing cards/data — reorganize, do not delete.** **Acceptance #16,#17.**
- **Risk: medium-high** for regressions (lots of existing functionality) — but isolated to one page; no routing/data change.

### Phase 6 — Cross-cutting QA (per spec Final Review)
- Extend unit tests (nav contract, stepper states, submenu visibility, presence formatting). Component tests (rail, submenu, steppers, top-bar presence, relocated switch). Playwright visual states in `e2e/` (every submenu, compact/expanded rail, light/dark, desktop/medium/mobile, relocated legacy switch). Console-error sweep. **Acceptance #22-#27,#29,#30.**

### Risk summary
- **Small / safe:** Phase 0 (pure contract), Phase 1a (design-switch), Phase 1b (top-bar presence).
- **Medium / multi-file:** Phase 2 (submenu+shell), Phase 3 (rail), Phase 4 (steppers).
- **Large:** Phase 5 (Overview).
- **Biggest structural de-risk:** the white-submenu plumbing (`StitchContextRail` + shell `contextRail` slot) and the centralized nav model already exist — so the IA change is mostly *populating an existing slot*, not building new layout machinery. Highest-risk areas are (a) layout stability on submenu-show/hide transitions (#27) and (b) Overview regression surface (#16/#17).
