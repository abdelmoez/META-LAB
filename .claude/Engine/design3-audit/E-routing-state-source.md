# design3 Audit E — Routing + Monolith State Plumbing + Stitch Design Source

Read-only audit for building NATIVE Stitch deep-tool pages (PICO, Protocol, Search Builder,
Project Control, Discovery) that reuse the legacy backend/state/autosave/validation/permissions
with ZERO data duplication. All file:line references verified against the working tree.

---

## (1) ROUTING

### Current project route (single entry, one DesignRoute pair)
`src/App.jsx:213`
```jsx
<Route path="/app/project/:projectId" element={<ProtectedRoute><OnboardingGate>
  <DesignRoute legacy={<AppWorkspace />} stitch={<StitchProjectOverview />} />
</OnboardingGate></ProtectedRoute>} />
```
`DesignRoute` (`src/frontend/design/DesignRoute.jsx:43`) renders `stitch` only when an admin has
Stitch active (`useDesignMode().isStitch`) AND a stitch element is given; else `legacy`. The stitch
subtree is wrapped in `StitchErrorBoundary` + `Suspense` (fail-safe to legacy on throw). **Both deep
tools and overview share this ONE route** — there is no `?tab=` branch on the stitch side today, so
every deep tool currently escapes to legacy via `projectStageHref` → `?ui=legacy&tab=<id>` (see §3
routing contract in `navConfig.js`).

### Legacy ?tab= plumbing (the contract a native page must preserve)
`src/frontend/pages/AppWorkspace.jsx`:
- L26-27 `const [searchParams, setSearchParams] = useSearchParams(); const initialTab = searchParams.get('tab') || null;`
- L32-39 `onTabChange(tabId)` writes `?tab=` (replace), drops `?screen=` when leaving screening.
- L58 passes `initialTab`/`onTabChange`/`onProjectChange`/`onBackToProjects` to `<MetaLab>`.

The monolith (`Workspace.jsx`) seeds `tab` from `initialTab` (L234), reflects `tab → URL` (L349-353),
and follows URL → tab on back/forward (L360-362). This is the durable deep-link behavior to mirror.

### PROPOSED WIRING — `StitchProjectWorkspace` (new dispatcher component)

Create `src/frontend/stitch/pages/StitchProjectWorkspace.jsx` and point the route's `stitch=` at it:
```jsx
stitch={<StitchProjectWorkspace />}   // App.jsx:213, replaces <StitchProjectOverview/>
```
It reads `?tab=` and branches to the overview or a native tool page. **SSR-test constraint**: the
unit-test react-router mock exposes ONLY `useNavigate, useLocation, useParams` (NO `useSearchParams`)
— matches how `StitchProjectOverview`/`StitchDashboard` already read params. So parse the query from
`useLocation().search` with `URLSearchParams`, reusing the existing pure helper
`activeProjectStage(search)` in `navConfig.js:235` (returns `tab || 'overview'`):
```jsx
import { useLocation, useParams } from 'react-router-dom';
import { activeProjectStage } from '../nav/navConfig.js';
export default function StitchProjectWorkspace() {
  const { search } = useLocation();
  const stage = activeProjectStage(search);        // 'overview' | 'pico' | 'prospero' | 'search' | 'discovery' | 'control' | ...
  switch (stage) {
    case 'pico':      return <StitchPicoPage />;
    case 'prospero':  return <StitchProtocolPage />;
    case 'search':    return <StitchSearchPage />;
    case 'discovery': return <StitchDiscoveryPage />;
    case 'control':   return <StitchControlPage />;
    default:          return <StitchProjectOverview />;   // overview + any not-yet-native stage
  }
}
```
Permissions/admin-switch/deep-links/refresh are all preserved because: the route still passes through
`ProtectedRoute`+`OnboardingGate`+`DesignRoute`; `?tab=` round-trips on refresh; and any unknown/out-of-scope
stage falls through to `StitchProjectOverview`, which can itself link out (overview already keeps a
"deep tools open in their engine" fallback). Each native page does its own `api.projects.get` load.

**REQUIRED nav change**: `navConfig.js` `STAGE_KIND` (L89-93) currently only marks `overview/screening/rob`.
For native pages, add `pico/prospero/search/discovery/control: 'stitch'` so `projectStageHref` (L138-152)
emits `/app/project/:id?tab=<id>` (NO `?ui=legacy`). The `'stitch'` case at L143-144 returns
`/app/project/:pid` with NO query — it must be extended to append `?tab=` for non-overview stitch stages,
e.g. `return id === 'overview' ? \`/app/project/${pid}\` : \`/app/project/${pid}?tab=${id}\`;`. Then
`StitchProjectRail.go` (L83) and overview's `goStage` (L195-198) route natively with no code change.

### Tab id inventory (from legacy `TABS`, the single source — `projectHelpers.js`, surfaced in `navConfig.buildProjectNav`)
Render dispatch lives at `Workspace.jsx:1542-1558`. Full id list and design3 scope:

| tab id | label | group/phase | design3 NATIVE scope? | current open path |
|---|---|---|---|---|
| `overview` | Overview | project | already native (`StitchProjectOverview`) | `/app/project/:id` |
| `control` | Project Control | project | **YES (design3)** | embeds `ControlTab` |
| `pico` | PICO & Question | Plan | **YES (design3)** | `PICODispatcher` |
| `prospero` | Plan & Protocol | Plan | **YES (design3)** | `PlanProtocolDispatcher` |
| `search` | Search Builder | Search | **YES (design3)** | `SearchDispatcher` |
| `discovery` | Search & Discovery | Search | **YES (design3)** | `DiscoveryDispatcher` |
| `screening` | Screening | Screen | NO — standalone engine `/sift-beta/...` | screening route |
| `prisma` | PRISMA | Screen | out of scope | legacy tab |
| `extraction` | Data Extraction | Extract | out of scope (Stitch HTML exists, future) | legacy tab |
| `rob` | Risk of Bias | Extract | NO — standalone `/rob/:id` | rob route |
| `analysis`/`forest`/`sensitivity`/`subgroup` | Analyze | Analyze | out of scope | legacy tabs |
| `grade`/`report`/`manuscript` | Report | Report | out of scope | legacy tabs |
| `methods` | Methods & Equations | reference | out of scope | legacy tab |

**design3 scope = control, pico, prospero, search, discovery** (5 native pages).

---

## (2) STATE PLUMBING

### How the monolith feeds tool components (`Workspace.jsx:1542-1558`)
- `upd(field, val)` — `Workspace.jsx:511` → `updateProject(activeId, p=>({...p,[field]:val}))`.
- `updNested(field,key,val)` — `Workspace.jsx:512`.
- `updateProject(id, updater)` — `Workspace.jsx:371-380`: the SINGLE client write choke point.
  Read-only gate (L377-378) silently no-ops `_permissions.readOnly`/`_readOnly`; sets `modified:now()`;
  calls `save(next)`.
- `save(pjs)` — `Workspace.jsx:367-369` → `window.storage.set("meta:projects", JSON.stringify(pjs))`.
- `lockCtx={{pid:spId, myUserId:authUser?.id, locks:presenceLocks}}` — built at L1545; `spId` =
  linked ScreenProject id (`linkedSiftId(project)` or lazily-resolved `resolvedSpId`, L488/496-506);
  `presenceLocks` from `useProjectPresence(spId,...)` L508-510.

Exact prop signatures passed by the monolith:
```jsx
<PICODispatcher        project={project} activeId={activeId} updNested={updNested} upd={upd}
                       lockCtx={{pid:spId,myUserId:authUser?.id,locks:presenceLocks}}/>  // L1545
<PlanProtocolDispatcher project={project} activeId={activeId} upd={upd}/>                  // L1546
<SearchDispatcher      project={project} activeId={activeId} updNested={updNested} upd={upd}/> // L1547
<DiscoveryDispatcher   project={project} activeId={activeId} readOnly={projectPerms(project).readOnly}/> // L1548
<ControlTab            project={project} onAnnotate={patchAnnotations} setTab={setTab}
                       presence={{users,locks}} onDeleted={...}/>                          // L1543 (sig: overviewTabs.jsx:507)
```

### Project load + autosave (the blob)
- Load: `Workspace.jsx:308-331` reads `window.storage.get("meta:projects")` → JSON array of FULL projects.
  `window.storage` is set in `serverStorage.js:140` → `get` does `GET /api/projects` (list) + `GET
  /api/projects/:id` per row (`serverStorage.js:146-164`).
- Autosave: `window.storage.set` debounces 800ms (`serverStorage.js:24,171-185`); `doSave` PUTs each
  writable project to `PUT /api/projects/:id/autosave` (`serverStorage.js:96-104`) + DELETEs removed ids.
  `flushStorage()` drains it (L195-205); `hasPendingSave()` guards realtime clobber (L214-216).
- `api.projects.get(id)` = `GET /api/projects/:id` (`apiClient.js:82`); `api.projects.update(id,patch)`
  = `PUT /api/projects/:id` partial top-level (`apiClient.js:103`); `api.projects.autosave(id,body)`
  = `PUT /api/projects/:id/autosave` full upsert (`apiClient.js:162`).

### Which tools use the blob vs a server-backed module
- **PICO**: dual. Flag `serverBackedWorkflowState` OFF → legacy `PICOTab` writes `project.pico` via
  `upd/updNested` (blob). ON → `ProtocolModulePanel` uses `useModuleState(activeId,'protocol')`
  (own server module) and MIRRORS structured fields back to `project.pico` via `onMirror` so
  `stepStatus` stays correct (`protocolTabs.jsx:231-247`).
- **Protocol (prospero)**: dual, same pattern. `PlanProtocolDispatcher` (`PlanProtocolPanel.jsx:213`)
  uses `usePlanProtocolState`→`useModuleState(activeId,'planProtocol')` when ON, mirrors `prospero.fields`
  to the blob via `upd` (L240-253); blob fallback otherwise.
- **Search**: dual. OFF → legacy `SearchTab` writes `project.search`/`project.mesh` via blob. ON →
  `SearchBuilderTab` persists via its OWN `loadSearch/saveSearch` = `searchBuilderApi` →
  `/api/search-builder/*` (NOT the blob) (`protocolTabs.jsx:253-262`, `searchBuilderApi.js:37/48`).
- **Discovery (pecanSearch)**: server-backed engine only (own `/api/...`), flag `pecanSearch` OFF by
  default → inert note, no blob, no `upd` (`protocolTabs.jsx:269-285`).
- **Control**: blob + own screening-API reads. Takes `project` + `onAnnotate` (transient, NO autosave
  — `patchAnnotations`, `Workspace.jsx:384-386`); loads members/ScreenProject via `screeningApi`
  (`overviewTabs.jsx:553-566`); archive/delete via `api.projects.*` directly.

### Minimal way for a NATIVE Stitch page (NOT in the monolith) to get project + working save

**There is NO standalone "load all projects + updateProject" hook.** The monolith's load/save is
bespoke (`window.storage` blob array, debounced in `serverStorage.js`, realtime-guarded). A native page
must NOT reuse `window.storage` (it loads/saves the ENTIRE projects array — wrong granularity, and it
is owned by the mounted monolith's React state, not addressable from a sibling page).

Recommended per-page pattern (already proven by `StitchProjectOverview`):
1. Load ONE project: `const p = await api.projects.get(projectId)` (`apiClient.js:82`). This returns the
   full blob incl. `pico/search/prospero/_permissions/_linkedMetaSift` etc.
2. **For server-module tools (search, and PICO/protocol when flag ON) — REUSE the module hooks directly,
   no blob save needed**: `useModuleState(projectId,'protocol'|'planProtocol')` (`useModuleState.js:25`,
   exposes `{state,status,conflict,update,flush,dismissConflict}`, debounced 700ms + 409 conflict
   handling), or `SearchBuilderTab`'s `loadSearch/saveSearch` props. These are projectId-scoped,
   standalone, and used outside the monolith already. **This is the cleanest path for Search + PICO/Protocol.**
3. **For blob fields with no module (Control annotations; PICO/Protocol when flag OFF)** — a native page
   that needs to PERSIST a blob field must replicate a minimal load+save: `api.projects.get(id)` to read,
   then `api.projects.autosave(id, fullUpdatedBlob)` (`apiClient.js:162`) to write the whole project.
   The read-only gate that `updateProject` enforces in-memory must be re-implemented (check
   `p._permissions?.readOnly || p._readOnly` before writing). The server independently no-ops read-only
   autosaves (`serverStorage.js:84-91` comment; same server contract), so this is defense-in-depth not the
   only guard.

So: `api.projects.get/update/autosave` quoted above; debounce constants `DEBOUNCE_MS=800` (serverStorage)
and `700` (useModuleState).

---

## (3) STITCH SOURCE — intended layouts + visual spec

Shared design system (from all four `code.html` Tailwind configs): **primary purple `#5d509c`** (alias
`tertiary #5d509b`, `surface-tint #60539f`, `primary-container #7669b6`); **Manrope** everywhere; surfaces
`#f7f9ff` (surface) / `#ffffff` (container-lowest = card) / `#ebeef5`–`#f1f4fb` (containers); `outline-variant
#c7c4d8`; success green `secondary #016e1c`/`secondary-container #96f591`; error `#ba1a1a`. Radii: card `xl
0.75rem`, control `lg 0.5rem`, pill `full`. Spacing tokens: `gutter 24px`, `card_padding 20px`, `stack_md 16px`,
`stack_sm 8px`. Card = `bg-surface-container-lowest rounded-xl shadow-soft-card border border-outline-variant/30`
(soft shadow `0 4px 20px rgba(0,0,0,0.04)`). Chrome: 72px purple primary rail + 280px secondary nav
(`ml-[352px]`), 64px top bar. **These map to the existing `stitchTokens.js` `--t-*`/`S.*` system — use `S`
primitives, do NOT hardcode hex.** Material Symbols icons in HTML map to the app's `StitchIcon` set.

### PICO & Question (`pecanrev_pico_question/code.html`)
- Header: breadcrumb eyebrow ("PLAN STAGE › Protocol Definition") + `display-lg` title + right actions
  "Save Draft" (neutral) + "Proceed to Search" (primary, arrow). **NOTE conflict**: a "Save Draft" button
  implies manual save — the real engine AUTOSAVES (module/blob). Render it as a status indicator
  ("Saved"/"Saving…") NOT a fake button (design3: no fake controls). "Proceed to Search" = real
  `goStage('search')`.
- Body: `xl:grid-cols-3`. Left 2/3 = PICO Elements card (2×2 grid: P/I/C/O as `textarea` cards with
  edit affordance + red `*` on required P/I/O) + a wide "Primary Research Question" bento card (large
  textarea). Right 1/3 = "Study Parameters" card (Eligible Study Designs `<select>`, Publication Timeframe
  two inputs `YYYY → Present`, PROSPERO ID input) + "Criteria Quick Notes" card (Inclusion green / Exclusion
  red textareas). Maps cleanly onto real fields `pico.P/I/C/O/question/studyDesign/timeframe*/prosperoId`
  + criteria. Field-lock (`useFieldLock`) edit indicators are compatible with the per-field "edit" glyph.

### Search Builder (`pecanrev_search_builder/code.html`)
- Header: "Search Builder" + concept search + "Save Draft" / "Execute Search" (primary, play icon).
  "Execute Search" must map to the REAL run path (Discovery/pecanSearch) or be omitted if pecanSearch is
  OFF — do NOT render a non-functional run button.
- Body: 2-column flex. Left (min 500px) = Strategy tabs (Broad/Narrow/Concept Blocks N/Vocabulary/Filters/
  Tradeoff) + concept-block cards (purple/green left-border accent, term pills with `[MeSH]`/`[tiab]` source
  badges, OR within a concept, AND chip between concepts) + "Sensitivity vs Precision Diagnostics" card.
  Right (400px) = "Compiled Strings" per database (PubMed/Embase/Cochrane), each a card with DB chip,
  copy/settings buttons, dark mono code block, syntax/length footer. **This matches `SearchBuilderTab`'s
  real model 1:1** (concepts, overrides, ignored, per-DB compiled queries, MeSH/tiab provenance, copy).
  Diagnostics "Estimated Yield 14,203 / Recall 94.2%" are MOCK — only show live counts the engine actually
  computes; otherwise omit (no fake metrics).

### Project Overview / Command Center (`pecanrev_project_overview/code.html` + `pecanrev_command_center`)
- Header: serif project title + phase badge ("Planning Phase") + Import/Export + bell/history/avatar.
- Body: `max-w-7xl mx-auto` bento grid. Hero "Project Progress" card = overall % big number + segmented
  progress bar with phase labels (Plan/Search/Screen/Extract/Analyze/Report) + Found/Screened/Included
  stat cluster. **This is already implemented by `StitchProjectOverview`** (next-step CTA, metric row,
  workflow progress, methodology audit, PICO, readiness, phase cards, team, details) — design3 only needs
  the deep-tool pages; overview stays. Reuse its `phases`/`overallPct`/`dataSummary` computations.

### Data Extraction (`pecanrev_data_extraction/code.html`) — long-form/table reference for Protocol editor styling
- Header: stage chip + "last synced" + serif title + Filter/Export. Body: ONE big card = data table
  (toolbar with entry count + filter input; sortable `th`; rows with colored intervention chips, right-
  aligned numeric Mean/CI). This is the **table + card-shell pattern** to reuse for any long-form editor.
  For the **Protocol** native page (which is a long-form multi-section document editor, not a table), use
  the same `surface-container-lowest` card shell + section headers + `textarea` blocks like the PICO
  "Criteria Quick Notes" / Primary Question cards. Extraction itself is OUT of design3 scope.

**Cross-cutting conflict flags (design3 "no fake controls")**: every "Save Draft" button in the mockups is
fake (engine autosaves → render Saved/Saving status). "Execute Search", diagnostics yields/recall, and the
extraction sync timestamp are mock data — wire to real engine output or omit. The serif title font in
overview/extraction (`source-serif`) is NOT in the token set — keep Manrope unless a serif token is added.

---

## REUSABILITY VERDICTS (per design3 component)

- **PICO** — VERDICT: **EMBED the legacy `PICODispatcher`, OR rebuild native + reuse hooks.** The dispatcher
  is monolith-free EXCEPT it needs props `{project, activeId, updNested, upd, lockCtx}`. `upd/updNested` are
  the only monolith-bound deps. For a native page: load `api.projects.get(id)`; provide `upd/updNested` by
  reimplementing the blob read-modify-write via `api.projects.autosave` (flag OFF) — OR, cleaner, drive
  `ProtocolModulePanel` directly with `useModuleState(id,'protocol')` and mirror to the blob the same way the
  dispatcher does (`protocolTabs.jsx:245-246`). `lockCtx` needs `spId` (`linkedSiftId(project)`) + `authUser.id`
  + `presenceLocks` from `useProjectPresence(spId,...)` — all standalone hooks. Build native Stitch UI per the
  PICO mockup, wire to these. Fully reusable; no monolith mount required.

- **Protocol (prospero)** — VERDICT: **REUSE `usePlanProtocolState`/`useModuleState(id,'planProtocol')` in a
  native page.** `PlanProtocolDispatcher` only needs `{project, activeId, upd}`; `upd` is used solely to mirror
  `prospero.fields` to the blob for stepStatus. A native page can call `useModuleState` directly + do the same
  one-field mirror via `api.projects.autosave`. Standalone-usable. The draft generator is a pure function.

- **Search Builder** — VERDICT: **EMBED `SearchBuilderTab` directly — it is ALREADY standalone.** Signature
  `SearchBuilderTab({projectId, pico, api, loadSearch, saveSearch})` (`SearchBuilderTab.jsx:880`); persistence
  is via injected `loadSearch/saveSearch` = `searchBuilderApi`+`sbLoad/sbSave` (`/api/search-builder`, NOT the
  blob). Pass `projectId`, `project.pico`, `searchBuilderApi`, `loadSearch`, `saveSearch`. No monolith deps.
  Wrap in the Stitch shell; optionally restyle, but the data layer needs zero changes.

- **Discovery (pecanSearch)** — VERDICT: **EMBED `PecanSearchTab` directly.** `DiscoveryDispatcher` needs only
  `{project, activeId, readOnly}`; `PecanSearchTab({projectId, pico, readOnly})` is server-backed and standalone.
  Provide `projectId`, `project.pico`, `readOnly` from `projectPerms(project).readOnly`. Flag-gate with
  `pecanSearchFlagEnabled()` exactly as the dispatcher does.

- **Project Control** — VERDICT: **EMBED `ControlTab` inside a Stitch shell (lowest-risk).** Signature
  `ControlTab({project,onAnnotate,setTab,presence,onDeleted})` (`overviewTabs.jsx:507`). It loads its own
  members/ScreenProject via `screeningApi` and does archive/delete via `api.projects.*` — so it is largely
  self-sufficient. Props to supply from a native page: `project` (`api.projects.get`), `onAnnotate` (a transient
  `setState` patch — for a standalone page, a no-op or local-state updater is acceptable since it does not
  persist), `setTab` (→ `navigate(projectStageHref(...))`), `presence` (`useProjectPresence(spId,...)` →
  `{users,locks}`), `onDeleted` (→ `navigate('/app')`). Rebuilding Control natively is high-effort (danger zone,
  blind-mode/required-reviewers settings against the ScreenProject) — EMBED is recommended; restyle via the
  `--t-*` token harmonization that already lets legacy widgets inherit Stitch theming.

**Bottom line**: Search + Discovery embed cleanly as-is (standalone props). PICO + Protocol are best as native
Stitch UI wired to the existing `useModuleState`/module hooks (+ a small blob-mirror via `api.projects.autosave`).
Control should be EMBEDDED. None require mounting the monolith. The only routing change needed is extending
`navConfig.STAGE_KIND` + the `'stitch'` branch of `projectStageHref` to emit `?tab=` (no `?ui=legacy`), plus the
new `StitchProjectWorkspace` dispatcher on the existing `/app/project/:id` route.
