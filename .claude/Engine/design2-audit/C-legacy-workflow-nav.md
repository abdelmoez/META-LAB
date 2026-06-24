# TOPIC C — Complete Legacy Project Workflow Navigation

Audit for design2.md Stitch-vs-legacy redesign. READ-ONLY. Every fact cited to `file:Lnn`.
Goal: mirror the legacy project rail order / labels / icons / routes in the new Stitch project rail.

Source of truth files:
- `src/frontend/workspace/projectHelpers.js` — TABS / PHASES / labels / icons / READING_TABS / stepStatus.
- `src/frontend/workspace/Workspace.jsx` — the monolith (`MetaLab` default export, `L231`) that renders the sidebar + dispatches each tab.
- `src/frontend/workspace/tabs/protocolTabs.jsx` — PICO / Search / Discovery dispatchers (flag gates).
- `src/frontend/workspace/tabs/robTabs.jsx` — RoB dispatcher + permission gate.
- `src/frontend/workspace/tabs/overviewTabs.jsx` — Overview / Control / ScreeningWorkspaceFrame / EmbeddedScreening.
- `src/frontend/pages/AppWorkspace.jsx` — router adapter (`initialTab` / `onTabChange` / `?tab=`).
- `src/App.jsx` — the canonical route tree.
- `src/frontend/components/icons.jsx` — icon registry (`ICON_PATHS`, `ICON_NAMES`).

---

## 1. The FULL `TABS` array (verbatim) — `projectHelpers.js:199-229`

```js
export const TABS=[
  // group:"project" ⇒ project meta-tabs (prompt6 Tasks 15/4) — rendered in their
  // own "Project" sidebar group ABOVE Workflow; phase:null keeps them out of the
  // workflow map, the progress denominator, and the "Next step" walker.
  {id:"overview",   icon:"grid",        label:"Overview",             phase:null,  group:"project"},
  {id:"control",    icon:"sliders",     label:"Project Control",      phase:null,  group:"project"},
  {id:"pico",       icon:"target",      label:"PICO & Question",      phase:"Plan",    num:1},
  {id:"prospero",   icon:"clipboard",   label:"Protocol",             phase:"Plan",    num:2},
  {id:"search",     icon:"search",      label:"Search Builder",       phase:"Search",  num:3},
  // P1 — Search & Discovery: run the saved strategy across multiple databases,
  // deduplicate, and hand new records to screening (flag `pecanSearch`, default
  // OFF; the dispatcher renders a disabled-note when the flag is off).
  {id:"discovery",  icon:"globe",       label:"Search & Discovery",   phase:"Search",  num:4},
  // prompt18 — Screening is now ONE in-project stage that embeds the full
  // META·SIFT engine (import → duplicates → title/abstract → conflicts → full
  // text). The old "Screening & PRISMA" tab is demoted to the PRISMA flow only.
  {id:"screening",  icon:"filter",      label:"Screening",            phase:"Screen",  num:5},
  {id:"prisma",     icon:"flow",        label:"PRISMA Flow",          phase:"Screen",  num:6},
  {id:"extraction", icon:"table",       label:"Data Extraction",      phase:"Extract", num:7},
  {id:"rob",        icon:"scale",       label:"Risk of Bias",         phase:"Extract", num:8},
  {id:"analysis",   icon:"sigma",       label:"Meta-Analysis",        phase:"Analyze", num:9},
  {id:"forest",     icon:"forest",      label:"Forest Plot",          phase:"Analyze", num:10},
  {id:"sensitivity",icon:"activity",    label:"Sensitivity & Bias",   phase:"Analyze", num:11},
  {id:"subgroup",   icon:"layers",      label:"Subgroup Analysis",    phase:"Analyze", num:12},
  {id:"grade",      icon:"award",       label:"GRADE Certainty",      phase:"Report",  num:13},
  {id:"report",     icon:"checkSquare", label:"PRISMA Checklist",     phase:"Report",  num:14},
  {id:"manuscript", icon:"pencil",      label:"Manuscript Draft",     phase:"Report",  num:15},
  // phase:null ⇒ reference page, NOT a workflow step — excluded from the
  // workflow map, progress denominator and "Next step" walker (all filter on t.phase).
  {id:"methods",    icon:"bookOpen",    label:"Methods & Equations",  phase:null,  group:"reference"},
];
```

NOTE on shape: `group` is ONLY present on the 3 non-workflow tabs (`overview`, `control`, `methods`). The 15 workflow tabs have NO `group` key but DO have `phase` + `num`. So the three rendering buckets are:
- `t.group==="project"` → overview, control (no `num`, `phase:null`).
- `t.phase` truthy (workflow) → the 15 numbered steps.
- `t.group==="reference"` → methods (`phase:null`).

## 2. PHASES / PHASE_LABEL / phaseLabel / PHASE_ICON / READING_TABS (verbatim)

`projectHelpers.js:230` — phase grouping keys (stable order, drives the stepper):
```js
export const PHASES=["Plan","Search","Screen","Extract","Analyze","Report"];
```

`projectHelpers.js:234` — full-width vs centred (1100px) judgement set:
```js
export const READING_TABS=new Set(["overview","pico","prospero","control","grade","manuscript","methods","report"]);
```
(Members get `maxWidth:1100, margin:0 auto`; everything else fills full width. `Workspace.jsx:1484`.)

`projectHelpers.js:236` — phase header icons (icon keys all exist in icons.jsx):
```js
export const PHASE_ICON={Plan:"target",Search:"search",Screen:"filter",Extract:"table",Analyze:"sigma",Report:"fileText"};
```

`projectHelpers.js:240-241` — render-only phase DISPLAY label override (only "Plan" is remapped):
```js
export const PHASE_LABEL={Plan:"Plan & Protocol"};
export const phaseLabel=(p)=>PHASE_LABEL[p]||p;
```
So the phase headers shown in the rail are: **Plan & Protocol**, Search, Screen, Extract, Analyze, Report. (`Workspace.jsx:1273` calls `phaseLabel(phase)`.)

## 3. ICON KEY VERIFICATION — every TABS icon + PHASE_ICON exists in `icons.jsx`

All confirmed present in `ICON_PATHS` (`icons.jsx:15-357`):
grid `L24`, sliders `L55`, target `L237`, clipboard `L244`, search `L139`, globe `L330`, filter `L327`, flow `L264`, table `L258`, scale `L309`, sigma `L273`, forest `L274`, activity `L282`, layers `L283`, award `L290`, checkSquare `L296`, pencil `L149`, bookOpen `L302`, fileText `L251`. Render via `<Icon name={t.icon} size={14}/>` (`Workspace.jsx:1218,1335`; `Icon` component `icons.jsx:361`). No missing icons — the Stitch rail can reuse the same keys 1:1.

---

## 4. SIDEBAR RENDER ORDER (top → bottom, as the user sees it) — `Workspace.jsx`

The fixed left sidebar is `.ml-sidebar` (`Workspace.jsx:1163`, `width:256`, `position:fixed`, hides via `transform:translateX(-100%)` when `focus` is on). Render order:

1. **Branding header** `L1172-1185` — hexagon logo + "PecanRev" / "Systematic Review".
2. **Back to Projects** button `L1190-1201` — only if `onBackToProjects` prop present; calls `onBackToProjects()` → navigates `/app` (`AppWorkspace.jsx:51`). Icon `arrowLeft`.
3. **"Project" group** `L1210-1223` — header label "Project"; renders `TABS.filter(t=>t.group==="project")` → **Overview**, **Project Control**. Click = `onClick={()=>setTab(t.id)}` (`L1215`). Active when `tab===t.id` (acc-tinted bg). Icon `t.icon` size 14 + label.
4. **"Workflow" group** `L1226-1324` — IIFE. Header row "Workflow" + pin toggle + `{doneCount}/{wfTabs.length}` counter (`L1231-1254`). Then `PHASES.map(...)` (`L1256`): for each phase a header (`phaseLabel(phase)` + `{phaseDone}/{steps.length}`), then `steps=TABS.filter(t=>t.phase===phase)` rendered as a **vertical stepper** — each step = a connector-line gutter + a numbered/`check` pip + the label. Click = `onClick={()=>goTab(t.id)}` (`L1296`). The 15 steps appear in TABS order grouped under their phase header.
5. **"Reference" group** `L1327-1340` — header "Reference"; renders `TABS.filter(t=>t.group==="reference")` → **Methods & Equations**. Click = `onClick={()=>setTab(t.id)}` (`L1332`).
6. **Footer** `L1343-1355` — version + "PRISMA 2020" + "Export ↓" JSON button.

### EXACT top-to-bottom ORDER the user sees (rail items only):
```
[Project]
  1. Overview            (overview, icon grid)
  2. Project Control     (control,  icon sliders)
[Workflow]   (header shows doneCount/15 + pin toggle)
  Plan & Protocol
    1. PICO & Question      (pico,       num 1, icon target)
    2. Protocol             (prospero,   num 2, icon clipboard)
  Search
    3. Search Builder       (search,     num 3, icon search)
    4. Search & Discovery   (discovery,  num 4, icon globe)     [flag pecanSearch]
  Screen
    5. Screening            (screening,  num 5, icon filter)
    6. PRISMA Flow          (prisma,     num 6, icon flow)
  Extract
    7. Data Extraction      (extraction, num 7, icon table)
    8. Risk of Bias         (rob,        num 8, icon scale)     [perm canAssessRiskOfBias / flag rob_engine_v2]
  Analyze
    9. Meta-Analysis        (analysis,   num 9, icon sigma)
    10. Forest Plot         (forest,     num 10, icon forest)
    11. Sensitivity & Bias  (sensitivity,num 11, icon activity)
    12. Subgroup Analysis   (subgroup,   num 12, icon layers)
  Report
    13. GRADE Certainty     (grade,      num 13, icon award)
    14. PRISMA Checklist    (report,     num 14, icon checkSquare)
    15. Manuscript Draft    (manuscript, num 15, icon pencil)
[Reference]
  Methods & Equations       (methods,    icon bookOpen)
```

### Click handler & navigation primitives
- The local tab state: `const[tab,setTab]=useState(initialTab||"overview")` (`Workspace.jsx:234`).
- Project/Reference groups use `setTab(t.id)` directly (`L1215,1332`).
- Workflow steps use `goTab` (`L931`):
  ```js
  const goTab=(id)=>{ setTab(id); if(shouldAutoCollapseWorkflowMenu({toId:id,mode:workflowMenuMode})) setNavCollapsed(true); };
  ```
  (auto-collapses the rail only when `workflowMenuMode==="auto"`.)
- The "Next step" button at the bottom of the content area walks `TABS.filter(t=>t.phase)` and calls `goTab(next.id)` (`Workspace.jsx:1561-1577`).

---

## 5. DEEP-LINK / ROUTE SYNC — `AppWorkspace.jsx` + `Workspace.jsx`

`MetaLab` signature (`Workspace.jsx:231`):
```js
export default function MetaLab({ initialProjectId = null, initialTab = null, onProjectChange = null, onTabChange = null, onBackToProjects = null } = {})
```

`AppWorkspace.jsx` is the router adapter mounted at `/app/project/:projectId` (`App.jsx:213`):
- `const { projectId } = useParams();` (`L22`) → passed as `initialProjectId`.
- `const initialTab = searchParams.get('tab') || null;` (`L27`) → the `?tab=<id>` deep-link seed.
- `onTabChange` (`L32-39`) writes the active tab back into the URL: `n.set('tab', tabId)` (replace), and DROPS `?screen=` when leaving screening.
- `onProjectChange` (`L44-46`) → `navigate('/app/project/:id', {replace})`.
- `onBackToProjects` (`L51`) → `navigate('/app')`.
- Mount (`L58`): `<MetaLab initialProjectId={projectId} initialTab={initialTab} onProjectChange={...} onTabChange={...} onBackToProjects={...} />`.

Inside `MetaLab`:
- `tab` seeds from `initialTab||"overview"` (`L234`).
- On project open it sets `setTab(initialTab||"overview")` (`L322`).
- Effect mirrors tab → `onTabChange(tab)` (`L352-353`).
- Effect re-applies `initialTab` when the prop changes (`L361-362`): `if(initialTab) setTab(t=> initialTab!==t ? initialTab : t);`.

**Canonical monolith deep-link route:** `/app/project/:projectId?tab=<TAB_ID>` opens that project at that tab. `<TAB_ID>` is any TABS `id` (`overview`, `control`, `pico`, `prospero`, `search`, `discovery`, `screening`, `prisma`, `extraction`, `rob`, `analysis`, `forest`, `sensitivity`, `subgroup`, `grade`, `report`, `manuscript`, `methods`).

---

## 6. FEATURE-FLAG GATING — which tabs are flag-gated and HOW the flag is read

IMPORTANT: **No tab is removed from the rail by a flag.** All 18 TABS always render in the sidebar. Flags only change what the tab's *body* renders (a dispatcher swaps legacy vs new vs a "disabled" note). Each flag is read client-side by fetching `GET /api/settings/public` (credentials:include) and reading `d.featureFlags.<flag> === true`; **default OFF on any error**.

| Tab id | Dispatcher | Flag key | Flag read fn | OFF behaviour | ON behaviour |
|---|---|---|---|---|---|
| `pico` | `PICODispatcher` `protocolTabs.jsx:231` | `serverBackedWorkflowState` | `workflowStateFlagEnabled()` `services/workflowState/api.js:43-52` | legacy `<PICOTab>` (`L244`) | `<ProtocolModulePanel>` server-backed (`L245`) |
| `prospero` (Protocol) | `PlanProtocolDispatcher` `planProtocol/PlanProtocolPanel.jsx:213` | `serverBackedWorkflowState` (internal only) | same | legacy blob editor | server-backed `planProtocol` module. **Tab ALWAYS shown** (`PlanProtocolPanel.jsx:10`); planProtocol is NOT a visibility flag. |
| `search` (Search Builder) | `SearchDispatcher` `protocolTabs.jsx:253` | `searchEngine` | `searchEngineFlagEnabled()` `features/searchBuilder/searchBuilderApi.js:59-68` | legacy `<SearchTab>` (`L260`) | `<SearchBuilderTab>` NLM engine (`L261`) |
| `discovery` (Search & Discovery) | `DiscoveryDispatcher` `protocolTabs.jsx:269` | `pecanSearch` | `pecanSearchFlagEnabled()` `features/pecanSearch/pecanSearchApi.js:172-181` | **inert "feature not enabled yet" card** (`L276-283`) — no API calls | `<PecanSearchTab>` (`L284`) |
| `rob` (Risk of Bias) | `RoBTab` `robTabs.jsx` | `rob_engine_v2` | `robFlagEnabled()` `frontend/rob/robApi.js:42-49` | legacy `<LegacyRoBTab>` table (`robTabs.jsx:49`) | `<ProjectRobPanel embedded>` engine (`robTabs.jsx:59`) |

Flag-read fn body shape (all four identical; example `pecanSearchApi.js:172-181`):
```js
export async function pecanSearchFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.pecanSearch === true);
  } catch { return false; }
}
```
(`searchEngine` → `searchBuilderApi.js:64`; `serverBackedWorkflowState` → `workflowState/api.js:48`; `rob_engine_v2` → `robApi.js:47`.)

`aiScreening` flag: NOT consulted at the project-rail level. Screening renders the embedded META·SIFT workbench regardless (`SiftProject`); aiScreening governs in-screening AI features, not the rail tab. No `aiScreening` reference in Workspace.jsx / projectHelpers.js.

The monolith binds the workflow-menu collapse helper from TABS at `Workspace.jsx:207`:
```js
const { workflowTabIds: WORKFLOW_TAB_IDS, shouldAutoCollapseWorkflowMenu } = makeWorkflowMenuRules(TABS);
```

---

## 7. PERMISSION / LOCK GATING

Effective caller permissions come from `projectPerms(project)` (`projectHelpers.js:370-378`): prefers `project._permissions`, else `_shared`/`_role`/`_canEdit`/`_readOnly`, else owner-all. Shape: `{role,isOwner,canView,canEdit,readOnly,canExport,canAssessRiskOfBias?}`.

- **Read-only (viewer) members** — `projectPerms(project).readOnly` true ⇒ a persistent "Read-only access" lock pill on Overview (`Workspace.jsx:1500`) + a shared-project banner (`L1531-1541`) + autosave is suppressed (`L378`: read-only target returns prev). All tabs are still *navigable* (read-only), nothing is hidden from the rail.
- **Risk of Bias (`rob` tab)** — edit gate `robTabs.jsx:53`:
  ```js
  const canEdit=(!!perms.canEdit||!!perms.canAssessRiskOfBias)&&!project._readOnly;
  ```
  i.e. a member WITHOUT broad `canEdit` can still EDIT RoB if granted `canAssessRiskOfBias`; read-only members stay view-only. `canEdit` is passed into `<ProjectRobPanel canEdit={canEdit}/>` (`L62`). The tab itself is always visible; only mutation is gated.
- **Discovery (`discovery`)** — `readOnly={projectPerms(project).readOnly}` passed to the dispatcher (`Workspace.jsx:1548`) and on to `<PecanSearchTab readOnly>`.
- No tab is permission-HIDDEN. Gating is edit/mutation-level + read-only pills.

---

## 8. "Project Control" / "Overview" tab ids + "Methods" reference tab

- **Overview** → id `overview`, icon `grid`, group `project`, `phase:null`. The project landing page; renders `<OverviewTab>` (`Workspace.jsx:1542`; component `overviewTabs.jsx:253`). It is the default landing tab (`tab` seeds to `overview`, `Workspace.jsx:234`).
- **Project Control** → id `control`, icon `sliders`, group `project`, `phase:null`. Renders `<ControlTab>` (`Workspace.jsx:1543`). Owner can delete the project from here (`onDeleted` `L1544`).
- **Methods (Methods & Equations)** → id `methods`, icon `bookOpen`, group `reference`, `phase:null`. The single reference tab. Renders `<MethodsTab/>` (`Workspace.jsx:1559`). It is excluded from progress math + "Next step" walker because `phase:null` (all walkers filter on `t.phase`, e.g. `L1228,1562`).

There is no "Methods" *phase*; "Methods & Equations" is the only `group:"reference"` tab.

---

## 9. CANONICAL ROUTES — how to open each stage

Route tree in `App.jsx`:
- `/app` → `ProjectLanding` (legacy) / `StitchDashboard` (stitch) `App.jsx:210`.
- `/app/project/:projectId` → `AppWorkspace` (legacy) / `StitchProjectOverview` (stitch) `App.jsx:213`. **All 18 monolith tabs open here via `?tab=<id>`.**
- `/sift-beta` → `SiftDashboard` `App.jsx:222`.
- `/sift-beta/projects/:pid` → `SiftProject` (standalone screening workbench) `App.jsx:223`.
- `/sift-beta/projects/:pid/import` → `SiftImport` `App.jsx:224`.
- `/rob` → `RobPage` `App.jsx:227`.
- `/rob/:projectId` → `RobPage` (standalone RoB) `App.jsx:228`.
All wrapped in `<ProtectedRoute><OnboardingGate>...`. `:pid` for screening = the **linked ScreenProject id** (`linkedSiftId(project)` `projectHelpers.js:380-382`), NOT the monolith project id. RoB `:projectId` = the monolith project id (`activeId`).

IMPORTANT — legacy in-app behaviour vs standalone routes: in the legacy monolith, **Screening and RoB are embedded IN-PLACE inside the `?tab=` content**, they do NOT navigate to `/sift-beta` or `/rob`:
- Screening: `tab==="screening"` renders `<ScreeningWorkspaceFrame>` (`Workspace.jsx:1480`) → `<EmbeddedScreening>` (`overviewTabs.jsx:205-248`) → `<SiftProject embedded embeddedPid={spId}/>` (`overviewTabs.jsx:242`). It auto-resolves/creates the linked ScreenProject via `screeningApi.getWorkspace(pid)` (`overviewTabs.jsx:231`).
- RoB: `tab==="rob"` renders `<RoBTab>` → `<ProjectRobPanel embedded projectId={activeId}/>` (`robTabs.jsx:59-67`).

So for the **Stitch project rail**, each stage maps to a canonical opener as follows (use `?tab=` for the in-monolith stages, or the standalone routes where a dedicated page exists):

| # | Stage (label) | id | icon | phase | num | group | flag? | perm/lock? | Canonical open route |
|---|---|---|---|---|---|---|---|---|---|
| — | Overview | overview | grid | null | — | project | — | viewer read-only pill | `/app/project/:id?tab=overview` |
| — | Project Control | control | sliders | null | — | project | — | owner-only delete inside | `/app/project/:id?tab=control` |
| 1 | PICO & Question | pico | target | Plan | 1 | (workflow) | `serverBackedWorkflowState` (body swap) | edit-gated by canEdit | `/app/project/:id?tab=pico` |
| 2 | Protocol | prospero | clipboard | Plan | 2 | (workflow) | `serverBackedWorkflowState` (internal only; tab always shown) | edit-gated by canEdit | `/app/project/:id?tab=prospero` |
| 3 | Search Builder | search | search | Search | 3 | (workflow) | `searchEngine` (body swap) | edit-gated | `/app/project/:id?tab=search` |
| 4 | Search & Discovery | discovery | globe | Search | 4 | (workflow) | `pecanSearch` (OFF ⇒ disabled card) | `readOnly` passed through | `/app/project/:id?tab=discovery` |
| 5 | Screening | screening | filter | Screen | 5 | (workflow) | — (embeds META·SIFT) | owner/member only (404 else) | embedded: `/app/project/:id?tab=screening`; standalone: `/sift-beta/projects/:linkedSiftId` |
| 6 | PRISMA Flow | prisma | flow | Screen | 6 | (workflow) | — | edit-gated | `/app/project/:id?tab=prisma` |
| 7 | Data Extraction | extraction | table | Extract | 7 | (workflow) | — | edit-gated | `/app/project/:id?tab=extraction` |
| 8 | Risk of Bias | rob | scale | Extract | 8 | (workflow) | `rob_engine_v2` (body swap) | edit gate = `canEdit OR canAssessRiskOfBias`, not `_readOnly` (`robTabs.jsx:53`) | embedded: `/app/project/:id?tab=rob`; standalone: `/rob/:projectId` |
| 9 | Meta-Analysis | analysis | sigma | Analyze | 9 | (workflow) | — | edit-gated | `/app/project/:id?tab=analysis` |
| 10 | Forest Plot | forest | forest | Analyze | 10 | (workflow) | — | — | `/app/project/:id?tab=forest` |
| 11 | Sensitivity & Bias | sensitivity | activity | Analyze | 11 | (workflow) | — | — | `/app/project/:id?tab=sensitivity` |
| 12 | Subgroup Analysis | subgroup | layers | Analyze | 12 | (workflow) | — | — | `/app/project/:id?tab=subgroup` |
| 13 | GRADE Certainty | grade | award | Report | 13 | (workflow) | — | edit-gated | `/app/project/:id?tab=grade` |
| 14 | PRISMA Checklist | report | checkSquare | Report | 14 | (workflow) | — | edit-gated | `/app/project/:id?tab=report` |
| 15 | Manuscript Draft | manuscript | pencil | Report | 15 | (workflow) | — | edit-gated | `/app/project/:id?tab=manuscript` |
| — | Methods & Equations | methods | bookOpen | null | — | reference | — | — (read-only ref) | `/app/project/:id?tab=methods` |

Phase headers (display, in order): **Plan & Protocol**, Search, Screen, Extract, Analyze, Report.

---

## 10. Implementation notes for the Stitch rail

- Reuse `TABS`, `PHASES`, `phaseLabel`, `PHASE_ICON` from `projectHelpers.js` directly — they are pure exports with no React dependency (only import `C` for color, plus stats helpers used elsewhere in the file). Filtering: `TABS.filter(t=>t.group==="project")`, `TABS.filter(t=>t.phase)`, `TABS.filter(t=>t.phase===phase)`, `TABS.filter(t=>t.group==="reference")`.
- Icon keys map 1:1 to `icons.jsx` `ICON_NAMES` (`icons.jsx:359`) — no new glyphs needed.
- Per-step completion status: `stepStatus(project, screeningComplete)` (`projectHelpers.js:261-301`) returns `{[id]:"done"|"partial"|"empty"}` keyed by workflow id — reuse for stepper pips. `screeningComplete` comes from the screening summary roll-up.
- Progress counter `{doneCount}/{wfTabs.length}` where `wfTabs=TABS.filter(t=>t.phase)` (15) (`Workspace.jsx:1228-1229`).
- To navigate a Stitch rail item: route to `/app/project/:id?tab=<id>` (legacy AppWorkspace honours `?tab=` via `initialTab`), OR for screening/RoB use the standalone `/sift-beta/projects/:linkedSiftId` and `/rob/:projectId` pages. `StitchProjectOverview` is already the stitch counterpart at `/app/project/:projectId` (`App.jsx:213`).
- The `discovery` (pecanSearch) tab when flag OFF shows a quiet disabled card — mirror that (do not hide the rail item) to match legacy.
