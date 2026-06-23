# P1 Audit — Frontend Architecture + Stitch/Legacy Design System

Scope: where a NEW "Search & Discovery" (Pecan Search Engine) workspace tab/page must live so it
appears in BOTH the legacy workspace AND the Stitch UI, reusing ONE backend. All paths absolute from
repo root `H:/META-LAB/META-LAB`.

---

## 1. The TWO-LEVEL UI architecture (critical mental model)

The app has TWO orthogonal navigation layers, and they integrate the design switch differently:

1. **App ROUTES** (`src/App.jsx`) — page-level. Each route pairs a legacy page with an optional lazy
   Stitch page via `<DesignRoute legacy={…} stitch={…}/>`. The design mode flips which page renders.
2. **WORKSPACE TABS** (inside the legacy monolith `Workspace.jsx`) — the 17 SR-workflow steps (PICO,
   Search Builder, Screening, …). These tabs DO NOT exist in Stitch. In Stitch, the project route
   renders `StitchProjectOverview` instead, which shows phase cards and **deep-links into the legacy
   workspace** via `?ui=legacy&tab=<tabId>`.

So a workspace tab is "in both designs" by:
- Adding a `TABS` entry → appears in the legacy sidebar/dispatch.
- Adding it to the Stitch overview's phase model → appears as a phase/step card that deep-links to the
  legacy tab (current convention for all deep tools), OR by building a Stitch-native page if desired.

---

## 2. Legacy workspace tab registration (THE seam to add a tab)

### TABS config — `src/frontend/workspace/projectHelpers.js`
- `export const TABS=[…]` at **L199-225**. Each entry:
  `{id, icon, label, phase, num?, group?}`.
  - `phase` ∈ `"Plan"|"Search"|"Screen"|"Extract"|"Analyze"|"Report"` puts it in the Workflow stepper
    and the progress denominator. `phase:null` + `group:"project"|"reference"` keeps it OUT of progress
    math (Overview, Project Control, Methods).
  - `num` is the stepper pip number.
  - Existing Search entry: **L207** `{id:"search", icon:"search", label:"Search Builder", phase:"Search", num:3}`.
- `export const PHASES` (**L226**), `export const PHASE_LABEL`/`phaseLabel` (**L236-237**),
  `export const READING_TABS` (**L230**, a `Set` — tabs in it get a centred max-width; data tabs get
  full width), `export const PHASE_ICON` (**L232**).
- Icons render via `<Icon name={t.icon} size=…/>` from `src/frontend/components/icons.jsx`; `t.icon`
  must be a key that exists there (e.g. `search`, `target`, `filter`, `table`, `scale`).

### Sidebar rendering — `src/frontend/workspace/Workspace.jsx`
- Project group: `TABS.filter(t=>t.group==="project").map(...)` at **L1213**.
- Workflow stepper: `TABS.filter(t=>t.phase)` at **L1228**; per-phase `TABS.filter(t=>t.phase===phase)`
  at **L1257**; click handler `onClick={()=>goTab(t.id)}` at **L1296**.
- Reference group: `TABS.filter(t=>t.group==="reference")` at **L1330**.

### Tab content dispatch — `src/frontend/workspace/Workspace.jsx` **L1542-1558**
A flat ladder of `{tab==="<id>"&&<Component .../>}`. The Search seam:
- **L1547** `{tab==="search"&&<SearchDispatcher project={project} activeId={activeId} updNested={updNested} upd={upd}/>}`
- A new tab needs a new `{tab==="<id>"&&<…/>}` line here, plus the `TABS` entry.

### Auto-collapse / workflow-menu rules
- `makeWorkflowMenuRules(TABS)` (**Workspace.jsx L207**, from `src/frontend/pages/workflowMenu.js`) derives
  `WORKFLOW_TAB_IDS` + `shouldAutoCollapseWorkflowMenu`. Driven purely from `TABS`, so a new phase tab
  is auto-handled.

### Component prop conventions for a tab
Tabs receive a subset of: `project` (full blob), `activeId` (project id), `upd(field,val)`,
`updNested(field,key,val)`, `updateProject(id,updater)`, `setTab(id)`. `lockCtx={{pid:spId,
myUserId:authUser?.id,locks:presenceLocks}}` for field-locking. Read-only is enforced centrally in
`updateProject` (**L371-380**) — viewer writes silently no-op. Server independently no-ops autosaves.

### Canonical persistence model (IMPORTANT)
Legacy project state is a **single autosaved blob** at `meta:projects` via `window.storage` (see
`save`/`updateProject` **L367-380**). It is last-write-wins. NEW per-module features (Protocol, Search
Builder) instead persist via dedicated server endpoints + their own tables, NOT the blob — see §4.

---

## 3. The Stitch / legacy design system (parallel presentation)

### Pure core — `src/frontend/design/designMode.js`
- `DESIGN_MODES=['legacy','stitch']`, `DEFAULT_MODE='legacy'`, `STORAGE_KEY='metalab_ui_design'`,
  `ROOT_DATASET_KEY='uiDesign'` (→ `<html data-ui-design="…">`).
- `isValidMode`, `normalizeMode`, `isDesignAdmin(user)` (`user.role==='admin'` ONLY — mods excluded),
  `readQueryOverride(search)` (parses `?ui=`), `resolveDesignMode({user,savedMode,queryOverride})`
  (**L82**: non-admin → ALWAYS legacy; valid `?ui=` wins; else saved; else legacy),
  `getSavedDesignMode`/`saveDesignMode`/`clearSavedDesignMode`, `applyDesignAttr(mode)`.
- No React/imports — trivially testable. The pre-paint bootstrap in `index.html` mirrors this.

### Runtime context — `src/frontend/design/DesignModeContext.jsx`
- `DesignModeProvider` (**L49**) wraps the app (mounted in `App.jsx` L167). Resolves mode from
  `useAuth().user` + `?ui=` + saved pref; calls `applyDesignAttr`; persists admin `?ui=` once.
- `useDesignMode()` (**L132**) → `{mode, isStitch, isAdmin, ready, setMode, toggle}`.
- `setMode` (**L102**) guards `if(!admin)return` then persists to localStorage + `PUT /api/profile
  {uiDesignMode}`. Non-admins always report `legacy` (**L116**).

### Per-route selector — `src/frontend/design/DesignRoute.jsx`
- `export default function DesignRoute({legacy, stitch})` (**L43**): renders `stitch` ONLY when
  `isStitch && stitch`, wrapped in `<StitchErrorBoundary><Suspense fallback={StitchRouteFallback}>`.
  Else returns `legacy`. Stitch element is expected lazy so non-admins never download the bundle.

### Error containment — `src/frontend/design/StitchErrorBoundary.jsx`
- Class boundary; on any throw shows a recovery panel; `escapeToLegacy()` (**L20**) persists `legacy`
  to localStorage + server + hard-navigates with `?ui=legacy`. Works even if React state is wedged.

### Admin switch — `src/frontend/design/AdminDesignSwitch.jsx`
- `AdminDesignSwitch({variant='inline'|'floating', tone})`. `floating` portals a fixed pill to
  `<body>` in legacy mode; `inline` renders inside `StitchTopHeader`. Returns `null` for non-admins.
- Mounted in `App.jsx` **L172** as `<AdminDesignSwitch variant="floating"/>`.

### Backend persistence (the ONE backend already wired)
- Schema: `server/prisma/schema.prisma` **L64** `uiDesignMode String?` (+ mirrored in
  `server/prisma/postgres/schema.prisma`).
- `server/controllers/profileController.js`: `PROFILE_SELECT` includes `uiDesignMode` (**L21**);
  `updateProfile` (**L52**) validates `['legacy','stitch']`/null (**L73**) and **refuses `stitch` for
  non-admins with 403** (**L76-80**). `authController.js` returns it in getMe.

---

## 4. The Stitch presentation layer (where a Stitch-native page lives)

### Pages — `src/frontend/stitch/pages/`
`StitchDashboard.jsx` (→ /app), `StitchProjectOverview.jsx` (→ /app/project/:id),
`StitchProfile.jsx` (→ /profile), `StitchOpsConsole.jsx` (→ /ops). All lazy-imported in `App.jsx`
**L42-45** and paired in routes **L210-219**.

### Shell — `src/frontend/stitch/shell/StitchAppShell.jsx`
- `StitchAppShell({activeKey, contextRail, breadcrumb, children, maxWidth=1320, contentPad=true})`.
- Mounts `<StitchStyle/>` (the scoped CSS — paid ONCE here), `StitchToastProvider`, `StitchPrimaryRail`,
  optional `contextRail`, `StitchTopHeader`. Responsive: rails → off-canvas `StitchDrawer` <1024px;
  context rail hidden <1280px.

### Chrome + PRIMARY NAV — `src/frontend/stitch/shell/shellParts.jsx`
- **`export const PRIMARY_NAV`** (**L30-34**) — the 72px rail's top-level areas:
  `dashboard` (/app), `screening` (/sift-beta), `rob` (/rob). `ADMIN_NAV` = ops (**L35**). A new
  TOP-LEVEL Stitch destination (e.g. its own page) would add an entry here. `StitchPrimaryRail`
  (**L42**) sets `active` via `activeKey` prop or path match.
- `StitchContextRail({title,subtitle,action,children,footer})` (**L99**) — 280px contextual rail
  (used for the project phase list). `StitchTopHeader` (**L177**) hosts `<AdminDesignSwitch variant="inline"/>`.

### Tokens — `src/frontend/stitch/theme/stitchTokens.js`
- `STITCH_LIGHT`/`STITCH_DARK` palettes; `S` (**L152**) = object of `var(--stitch-*)` strings
  (theme-aware), with static helpers `S.font`, `S.railContext`, `S.radiusCard`, etc. `salpha(color,a)`
  (**L171**) = theme-aware translucency.
- `buildStitchCss()` (**L231**) scopes ALL rules under `html[data-ui-design="stitch"]` AND
  **re-maps legacy `--t-*` tokens** (`legacyRemap` **L191**) so embedded legacy widgets harmonize.
  This is why deep legacy tools (screening, PDF, RoB) look acceptable when shown inside Stitch chrome.

### Primitives — import surface `src/frontend/stitch/primitives/index.js`
Re-exports `core.jsx` + `controls.jsx` + `overlay.jsx` + `{S, salpha, STITCH_FONT, STITCH_TYPE}`.
Available components (file:line in `primitives/`):
- core.jsx: `StitchCard`, `StitchPanel`, `StitchButton`, `StitchIconButton`, `StitchBadge`,
  `StitchAvatar`, `StitchPageHeader`, `StitchSectionHeader`, `StitchMetricCard`, `StitchProgressBar`,
  `StitchProgressRing`, `StitchSpinner`, `StitchSkeleton`, `StitchLoadingState`, `StitchEmptyState`,
  `StitchErrorState`, `StitchIcon` (re-exported), `StitchStatusDot`.
- controls.jsx: `StitchField`, `StitchInput`, `StitchSearchInput`, `StitchTextarea`, `StitchSelect`,
  `StitchSwitch`, `StitchCheckbox`.
- overlay.jsx: `StitchModal`, `StitchDrawer`, `StitchTooltip`, `StitchTabs`, `StitchTable`,
  `StitchPagination`, `StitchToastProvider`/`useStitchToast`.

### The current Stitch deep-tool convention — `src/frontend/stitch/pages/StitchProjectOverview.jsx`
THE key file for how a new SR phase surfaces in Stitch. Reads SAME data as legacy:
- `api.projects.get(projectId)`, `screeningApi.getOverview/listMembers`, and pure
  `workspace/projectHelpers.js` (`stepStatus`, `PHASES`, `phaseLabel`, `PHASE_ICON`, `readinessCheck`,
  `projectPerms`, `linkedSiftId`).
- **`PHASE_STEPS`** (**L48-55**) maps each phase → its `stepStatus` tab keys.
  `PHASE_PRIMARY_TAB` (**L58**), `PHASE_DESC` (**L63**), `STEP_LABELS_SHORT` (**L502**).
- `openClassicTab(tabId)` (**L172**) = `navigate('/app/project/<id>?ui=legacy&tab=<tabId>')` — THE
  deep-link hand-off. Screening/RoB open their dedicated routes; everything else opens the classic
  workspace with the inline "Opens in the classic workspace" note (**L491-495**). No fake controls.

So: a new "search" step appears in Stitch by (a) being in `stepStatus` (so it has a status), and
(b) being mapped under a phase in `PHASE_STEPS` (currently `Search:['search']`, L50) — the phase card +
chips render automatically. Adding a NEW tab id to a phase here makes its chip appear.

---

## 5. The closest reusable analog: the Search Builder feature module

The Pecan Search Engine should mirror the SearchEngine feature, which is the precedent for a
flag-gated, server-backed, modular workspace tab.

### Dispatcher pattern — `src/frontend/workspace/tabs/protocolTabs.jsx`
- `SearchDispatcher` (**L252-261**): `useState(null)` flag → checks `searchEngineFlagEnabled()` →
  renders legacy `SearchTab` when OFF, `SearchBuilderTab` when ON. Mirror this for a new tab.
- `PICODispatcher` (**L230-246**) is the same pattern but also `flushStorage()` first then renders the
  server-backed module — copy this if migrating blob→module.

### Feature module — `src/features/searchBuilder/`
- `index.js` — public API: `SearchBuilderTab`, `searchBuilderApi`, `loadSearch`/`saveSearch`,
  `searchEngineFlagEnabled`, plus pure research-engine helpers.
- `searchBuilderApi.js` — authenticated `fetch` wrappers to `/api/search-builder/*`;
  `loadSearch(projectId)`/`saveSearch(projectId,state)` (own table, NOT the blob);
  **`searchEngineFlagEnabled()`** (**L59**) reads `/api/settings/public` → `featureFlags.searchEngine`.
  This is the exact flag-gating template for a `pecanSearch` flag.

### Imports into the monolith — `src/frontend/workspace/Workspace.jsx` **L52**
`import { SearchBuilderTab, searchBuilderApi, loadSearch as sbLoad, saveSearch as sbSave,
searchEngineFlagEnabled } from "../../features/searchBuilder/index.js";`

---

## 6. Route wiring (App.jsx) — exact integration points

`src/App.jsx`:
- Lazy Stitch pages **L42-45**; lazy legacy pages **L19-37**.
- `DesignModeProvider` wraps everything (**L167**).
- Project route **L213**:
  `<Route path="/app/project/:projectId" element={<ProtectedRoute><OnboardingGate><DesignRoute legacy={<AppWorkspace/>} stitch={<StitchProjectOverview/>}/></OnboardingGate></ProtectedRoute>}/>`
- `AppWorkspace.jsx` (**L18**) bridges router → monolith: reads `?tab=` into `initialTab` (**L27**),
  passes `initialProjectId`, `initialTab`, `onTabChange`/`onProjectChange`/`onBackToProjects` to
  `MetaLab`. `onTabChange` (**L32**) reflects the active tab back into `?tab=` (replace).
- `MetaLab` (`Workspace.jsx` **L231**) seeds `tab` from `initialTab||"overview"` (**L234**) and FOLLOWS
  `initialTab` after mount (**L360-362**) — so `?ui=legacy&tab=<newId>` deep-links land on the new tab.

If the new tab also wants its OWN top-level page (route), add a `<Route>` with
`<DesignRoute legacy={…} stitch={…}/>` and a `PRIMARY_NAV` entry — but the standard SR-phase tab does
NOT need a new route; it lives inside the existing project route.

---

## 7. RECOMMENDED placement for P1 "Search & Discovery"

The Pecan Search Engine (automated API search/import/dedup/PRISMA-S) is a workspace phase, so:

1. **New feature module** `src/features/pecanSearch/` (mirror `src/features/searchBuilder/`):
   `index.js`, `pecanSearchApi.js` (auth fetch → new `/api/pecan-search/*` backend +
   `pecanSearchFlagEnabled()` reading `featureFlags.pecanSearch`), and `PecanSearchTab.jsx`.
   Persist via its own server table (NOT the autosave blob) — follow `searchBuilderApi.js`.
2. **TABS entry** in `projectHelpers.js` **L207-area** under `phase:"Search"` (e.g.
   `{id:"discovery", icon:"<icon-in-icons.jsx>", label:"Search & Discovery", phase:"Search", num:…}`)
   — renumber subsequent `num`s. Decide whether it's full-width (leave out of `READING_TABS`).
3. **Dispatcher + dispatch line**: add `PecanSearchDispatcher` (copy `SearchDispatcher`) in
   `protocolTabs.jsx`, import in `Workspace.jsx` L52-area, add `{tab==="discovery"&&<PecanSearchDispatcher .../>}`
   in the **L1542-1558** ladder.
4. **Stitch surfacing** in `StitchProjectOverview.jsx`: add the new tab id to `PHASE_STEPS.Search`
   (**L50**) and `STEP_LABELS_SHORT` (**L502**) so the phase chip + status appear; the existing
   `openClassicTab('search')`/`PHASE_PRIMARY_TAB.Search` hand-off already opens the Search phase via
   `?ui=legacy&tab=…`. Optionally point `PHASE_PRIMARY_TAB.Search` at the new tab id.
5. (Optional, larger) A Stitch-NATIVE discovery page: build under `src/frontend/stitch/pages/`,
   lazy-import in `App.jsx`, add a `PRIMARY_NAV` entry + a `<DesignRoute>` route — only if it needs a
   first-class Stitch screen rather than the deep-link hand-off.

This makes ONE backend serve both designs: legacy renders `PecanSearchTab` in-tab; Stitch shows the
phase card/chips and deep-links into that same legacy tab.

---

## 8. Risks / gotchas

- **TABS `num` renumbering**: inserting a tab mid-phase shifts the stepper pip numbers; update all
  later `num`s in `TABS` (L205-224) or numbers desync from the stepper.
- **`t.icon` must exist** in `src/frontend/components/icons.jsx` (`<Icon name=…>`), else blank icon.
- **READING_TABS width**: omit the new tab id from `READING_TABS` (projectHelpers L230) for a
  full-width data workspace; include it for a centred reading layout.
- **Persistence**: DO NOT push search results into the `meta:projects` autosave blob (last-write-wins,
  bloat). Use a dedicated endpoint + table like `searchBuilderApi` — the established pattern.
- **Flag gating**: register a `pecanSearch` flag in `defaultFeatureFlags()` so it auto-surfaces in
  `/api/settings/public` + Ops (per the searchEngine memory note — a hardcoded `FLAG_META` once hid a
  flag). `pecanSearchFlagEnabled()` must default OFF on error (copy L59-68 of searchBuilderApi.js).
- **Stitch chips need a status**: a new tab only gets a Stitch phase chip if `stepStatus` returns a
  status for it AND it's listed in `PHASE_STEPS`. If P1 has no blob-derived status, either extend
  `stepStatus` (projectHelpers L257) or render the chip as neutral.
- **Stitch never renders the tab directly**: by current convention deep tools are legacy-only inside
  Stitch (hand-off via `?ui=legacy&tab=`). A truly Stitch-native search page is extra work (item 5) and
  must reuse the SAME `/api/pecan-search` backend — never fork logic.
- **Admin-only Stitch**: all Stitch paths force legacy for non-admins (client `resolveDesignMode` +
  server 403 on persist). Any P1 Stitch UI is admin-preview only until rollout; legacy is the real
  user-facing surface today.
- **Monolith size**: `Workspace.jsx` is ~1590 lines; the dispatch ladder + imports are the only places
  you touch. Keep new logic in the feature module, not the monolith.
