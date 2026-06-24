# design3 Audit C — Search Builder + Search Discovery

Read-only audit for building NATIVE Stitch versions of the deep search tools. Conclusion up front: **both are already self-contained, feature-module engines with their OWN api clients, OWN server tables, OWN flag checks, and ZERO dependency on the monolith `Project.data` blob for their persistence.** The correct design3 path is **EMBED each Tab verbatim inside a thin Stitch chrome shell** (header / next-step / presence), NOT native rebuild. Both already paint via `var(--t-*)` tokens that the Stitch token remap harmonizes.

---

## 1. File inventory & sizes

| File | Lines/size | Role |
|---|---|---|
| `src/features/searchBuilder/SearchBuilderTab.jsx` | 116 KB (~1640 ln) | The concept→multi-DB query engine. Default export `SearchBuilderTab`. |
| `src/features/searchBuilder/searchBuilderApi.js` | 68 ln | Own client: `searchBuilderApi{meshLookup,meshSuggest,pubmedCount}`, `loadSearch`, `saveSearch`, `searchEngineFlagEnabled`. |
| `src/features/searchBuilder/index.js` | barrel | Re-exports Tab + api + pure helpers (`strategyHash`, `normalizeIgnored`, db catalogue, crossConcept). |
| `src/features/pecanSearch/PecanSearchTab.jsx` | 51.7 KB (~1300 ln) | "Search & Discovery" workspace. Default export `PecanSearchTab`. |
| `src/features/pecanSearch/pecanSearchApi.js` | 181 ln | Own client `pecanSearchApi{getProviders,validate,translate,previewCount,startRun,listRuns,getRun,cancelRun,retryRun,listDuplicates,resolveDuplicate,getReport}` + `loadCanonicalQuery`, `newIdempotencyKey`, `pecanSearchFlagEnabled`. |
| `src/features/pecanSearch/components/parts.jsx` | 10.6 KB | Card/StatTile/StatusPill/Btn/CredsBadge/Toggle/EmptyState/Skeleton/Note/formatWhen — styled via shared `styles.js` `C`. |
| `src/features/pecanSearch/components/DuplicateReview.jsx` | 9 KB | Side-by-side ambiguous-pair resolver. |
| `src/features/pecanSearch/index.js` | barrel | Re-exports `PecanSearchTab`, `pecanSearchFlagEnabled`. |

---

## 2. EXACT Tab signatures (quoted)

### SearchBuilderTab — `SearchBuilderTab.jsx:880`
```js
export default function SearchBuilderTab({projectId,pico,api,loadSearch,saveSearch}){
  const A=api||defaultApi;
```
Documented prop contract (`:873-879`): `projectId` (string), `pico` ({P,I,C,O,timeframe,…}), `api` ({meshLookup, meshSuggest, pubmedCount}), `loadSearch(projectId)=>savedState|null`, `saveSearch(projectId,state)=>{revision}`. ALL optional — falls back to `defaultApi` (`:238`, offline CORE_VOCAB MeSH + `pubmedCount→null`) and skips persistence if `loadSearch/saveSearch` absent. There is **no `readOnly` prop** — the builder is always editable.

### PecanSearchTab — `PecanSearchTab.jsx:68`
```js
export default function PecanSearchTab({ projectId, pico, readOnly }) {
```
`projectId`, `pico` (passed but the canonical query is loaded from the SB backend, not from `pico`), `readOnly` (gates start/cancel/retry/resolve: `const canRun = !readOnly;` `:116`).

---

## 3. Current dispatch & flag-gating — `protocolTabs.jsx`

Imports (`:20-21`):
```js
import { SearchBuilderTab, searchBuilderApi, loadSearch as sbLoad, saveSearch as sbSave, searchEngineFlagEnabled } from ".../searchBuilder/index.js";
import { PecanSearchTab, pecanSearchFlagEnabled } from ".../pecanSearch/index.js";
```

**SearchDispatcher** (`:253-262`): checks `searchEngineFlagEnabled()` (async, default OFF). While `null` → "Loading Search…". When **OFF** → renders the legacy in-blob `SearchTab` (`:288`, the old AI-mesh tab persisting into `project.mesh`). When **ON** →
```js
<SearchBuilderTab projectId={activeId} pico={project.pico} api={searchBuilderApi} loadSearch={sbLoad} saveSearch={sbSave}/>
```

**DiscoveryDispatcher** (`:269-285`): checks `pecanSearchFlagEnabled()` (async, default OFF). While `null` → "Loading Search & Discovery…". When **OFF** → renders an **INERT** centered note ("This feature is not enabled yet… An administrator can switch on… in the Ops console") — NO api calls, NO legacy fallback (`:276-283`). When **ON** →
```js
<PecanSearchTab projectId={activeId} pico={project.pico} readOnly={readOnly}/>
```

Wired in `Workspace.jsx:1547-1548`:
```js
{tab==="search"&&<SearchDispatcher project={project} activeId={activeId} updNested={updNested} upd={upd}/>}
{tab==="discovery"&&<DiscoveryDispatcher project={project} activeId={activeId} readOnly={projectPerms(project).readOnly}/>}
```
So `activeId` = the metaLab project id; `readOnly` derives from `projectPerms(project).readOnly`. The flags are read from `GET /api/settings/public` → `featureFlags.searchEngine` / `.pecanSearch`.

---

## 4. Search Builder feature inventory (where each lives)

State (all React `useState`, NOT monolith blob) is declared `:882-923`:
- **PICO-derived terms / five concept groups** — `concepts`; idempotent `syncFromPico`→`syncSearchBuilderFromPico(pico,…)` (`:938`), runs on mount & whenever `picoKey` changes (`:998-1002`). Re-adding deleted PICO sections = `resetSuggestions()` (`:1048`) / `restoreTermInto` (`:1057`) + the `ignored` list (`:911`).
- **Keyword groups / synonyms / MeSH controlled-vocab** — per-term `type:'controlled'|...`, `vocab`; auto MeSH via `lookupAuto`→`tryLookup` using `A.meshLookup` (`:945-950`); as-you-type suggest via `A.meshSuggest` + local `localMeshSuggestions` (`:518`).
- **Boolean operators/grouping + DB-specific syntax & field tags** — `QueryOutput` (`:578`) per `activeDB` (`:884`); pure renderers in the ENGINE band (do NOT edit, per `index.js` note).
- **Live editing** — `editing/adding/draft` (`:894-896`); `TermEditor` (`:394`), `KeywordField` (`:736`).
- **Validation / Search Quality** — `searchQualityCheck`, `detectCrossConceptDuplicates`, `sensitivitySignal` (crossConcept.js); warnings + `dismissedWarnings` (`:892`); concept warnings `:860-868`.
- **Hit-count updates** — `hitState` lifecycle (`:905`): idle→stale→updating→updated/failed; **REAL NLM** via `A.pubmedCount` (server proxies NCBI E-utilities); **debounced** + `strategyHash`-gated so it only refires when the query genuinely changes. Only PubMed is live; Embase/Cochrane are manual. `limitedMode` (`:898`) when backend/NLM unreachable.
- **Database selection** — `selectedDbs` (`:890`), catalogue `DATABASE_CATALOG`/`databaseGroups`/`defaultSelectedDatabases`.
- **Copy/save controls + previews** — `exportMsg` (`:893`), `QueryOutput` preview, copy buttons.
- **History/versions** — server revision tracking (`revisionRef`, `:918`) for conflict-safe live sync, NOT a full version list.
- **Links to Discovery / handoff** — `readyForScreening` (`:891`) marker persisted; beginner stepper `step/beginner` (`:885-889`).
- **Live collaborator sync** — `useRealtime({"search.updated":…})` (`:1036`); `applyRemote`/`pullRemote`/`remoteAdoptDecision` (`:1009-1031`); never clobbers an open editor (defers via `pendingRemoteRef`).

### Persistence (INDEPENDENT of monolith blob)
- `loadSearch(projectId)` → `GET /api/search-builder/:projectId` (`searchBuilderApi.js:37`).
- `saveSearch(projectId,state)` → `PUT /api/search-builder/:projectId` → `{ok,revision}` (`:48`). Debounced 800 ms autosave (`:984-990`), serialized via `serializeSearchState`; idempotent via `lastSavedRef`.
- Own server table (search-builder backend; per the SearchEngine memo it REUSES `WorkflowModuleState` moduleKey `'search'`). **It does NOT read/write `Project.data`.**

---

## 5. Search Discovery (PecanSearch) feature inventory

State `:69-115` (all `useState`/`useRef`, NOT blob):
- **Canonical query** — `loadCanonicalQuery(projectId)` reads `GET /api/search-builder/:pid` → `{concepts,filters,overrides,revision}` (`pecanSearchApi.js:147`). ONE source of truth shared with the Search Builder.
- **Providers** — `getProviders()` → `/api/pecan-search/providers` (`:74`); `selected/overrides/caps/showOverride` per source.
- **Multi-DB translation + preview** — `translate` / `previewCount` (`:84-90`); debounced `PREVIEW_DEBOUNCE_MS=700` with abort (`previewAbort`); `translations`/`counts`.
- **Run / jobs / worker** — `startRun` with **Idempotency-Key** (`:94`, double-click safe) → 202; durable worker server-side. `activeRun`/`starting`/`startError`.
- **Live progress / streaming** — authoritative polling `ACTIVE_POLL_MS=2500` (`pollRef`) + realtime poke hint; `TERMINAL` set (`:40`); honest INDETERMINATE.
- **Cancellation / retry** — `cancelRun` / `retryRun` (`:110-115`); gated by `canRun=!readOnly`.
- **Dedup / duplicate review** — `listDuplicates` / `resolveDuplicate` (`:120-126`); `DuplicateReview.jsx` side-by-side; `dupes/resolving`.
- **Completion** — `report` via `getReport` (`:131`); export `reportExportUrl` json/csv/html (`:40`).
- **History** — paginated `listRuns` `HISTORY_TAKE=10`, `history/historyTotal/historyPage`.
- **Term discovery / saving back into Search Builder** — drives off the shared canonical query (single SB source); imported records auto-flow to ScreenRecord server-side.

Persistence = entirely its OWN backend `/api/pecan-search/*` + 5 additive Prisma models. **No monolith blob.**

---

## 6. Self-containment verdict (the critical question)

**YES — both render correctly given only `{projectId(=activeId), pico, readOnly}` plus their own api/load/save bindings (already exported from their barrels).** Neither needs `updNested`/`upd`/`lockCtx`/`project` blob. Evidence:
- Both paint exclusively through `var(--t-*)` CSS custom properties: SearchBuilder via `theme/tokens.js` `C` (`SearchBuilderTab.jsx:2`); PecanSearch + parts via `workspace/ui/styles.js` `C` (`PecanSearchTab.jsx:25`, `styles.js:16-35`). The Stitch token remap (`stitch/theme/stitchTokens.js`) overrides these same `--t-*` vars, so embedded widgets harmonize automatically.
- Both bring their OWN outer container & header. PecanSearch: `<div style={{maxWidth:1180,margin:'0 auto'}}>` + an `<h2>Search & Discovery</h2>` (~`:380`). SearchBuilder paints its own full-width body.
- Both do their OWN flag check independently of the dispatcher (`searchEngineFlagEnabled` / `pecanSearchFlagEnabled`).
- Both use the global `useRealtime` SSE channel directly (no monolith plumbing).

Caveat: they do NOT fill viewport height themselves — they grow with content inside a normal scroll container (no `fillHeight`/internal-scroll like RoB). The Stitch shell should give them a normal scrolling content region.

---

## 7. REUSABILITY VERDICT → EMBED (do not rebuild)

Native rebuild of these engines is prohibitively large and would fork live NLM/multi-DB logic, the AST translators, dedup, and realtime sync. **EMBED both Tabs unchanged inside a thin native Stitch chrome.**

### Search Builder — native Stitch page
Wrap in a Stitch page that supplies header/next-step/presence and renders:
```jsx
<SearchBuilderTab
  projectId={project.id}            // = activeId
  pico={project.pico}
  api={searchBuilderApi}
  loadSearch={sbLoad}               // loadSearch from searchBuilder barrel
  saveSearch={sbSave}               // saveSearch from searchBuilder barrel
/>
```
- Flag-gate with `searchEngineFlagEnabled()` (reuse the dispatcher pattern; while `null` show a Stitch skeleton; when OFF either show the inert note or fall back to legacy `?ui=legacy&tab=search`).
- No `readOnly` prop exists — if read-only access matters, the safest design3 move is to keep read-only users on the legacy/overview path, OR add a future `readOnly` prop (out of scope; today it is always editable).

### Search Discovery — native Stitch page
```jsx
<PecanSearchTab
  projectId={project.id}
  pico={project.pico}
  readOnly={projectPerms(project).readOnly}
/>
```
- Flag-gate with `pecanSearchFlagEnabled()`. When OFF, render the same inert "not enabled — switch on in Ops" message but styled as native Stitch (it's pure copy, trivially re-skinned).

### Minimal native Stitch chrome to wrap BOTH
1. **Header bar** — Stitch breadcrumb (Dashboard / project / stage), stage title, role/read-only badge. The Tabs already render their own inner H2; either suppress that or let it sit below the Stitch breadcrumb (low risk — different sizes).
2. **Next-step / workflow nav** — reuse `StitchWorkflowNav` so Search → Search & Discovery → Screening flow stays integrated; Search Builder's `readyForScreening` marker can drive the "next" affordance.
3. **Presence** — reuse the existing Stitch presence indicator; the Tabs already do their own field-level realtime sync, so this is purely the avatar strip.
4. **Scroll region** — a normal `overflow:auto` content area (these Tabs are content-height, not viewport-locked).

### Routing
Today deep tools open via `/app/project/:id?ui=legacy&tab=search|discovery` (`nav/navConfig.js:150`). design3 should add native Stitch stages for `search` and `discovery` so the rail no longer needs `?ui=legacy` for these two — the embed renders inside the Stitch project shell at the existing stage ids.

### Risk notes
- Do NOT edit the SearchBuilder ENGINE band (syntax renderers) — `index.js` explicitly warns against it.
- Keep the exact `loadSearch/saveSearch` bindings — Search Discovery reads the SAME `/api/search-builder/:pid` canonical query, so the two stay coupled through the backend, not through React.
- Preserve flag-gating exactly; both default OFF and must do zero work when disabled.

**Key file:line refs:** dispatchers `protocolTabs.jsx:253-285`; wiring `Workspace.jsx:1547-1548`; SB signature `SearchBuilderTab.jsx:880` (+ defaultApi `:238`, autosave `:984`, realtime `:1036`); PecanSearch signature `PecanSearchTab.jsx:68` (+ canRun `:116`, render root `~:380`); api clients `searchBuilderApi.js` & `pecanSearchApi.js` (flags `:59` / `:172`).
