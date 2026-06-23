# P1 Audit — Existing Search Builder (the foundation P1 extends)

READ-ONLY architecture map. All paths absolute-relative to repo root `H:/META-LAB/META-LAB`.
Feature flag: **`searchEngine`** (default OFF). When OFF, every backend handler 404s and the
frontend `SearchDispatcher` renders the legacy `SearchTab` instead.

---

## 0. Topology (one glance)

```
PICO text (project.pico {P,I,C,O, timeframeMode...})
  └─ conceptExtraction.picoToConcepts ─┐
                                        ▼
  searchState.syncSearchBuilderFromPico → CANONICAL concepts[]  (5 PICO groups + manual)
                                        │   each concept.terms[] = {text,type,field,vocab,...}
                                        ▼
  SearchBuilderTab.jsx render pipeline:  renderTerm → renderConcept → renderSearch  (per dbId)
                                        │   ("pubmed" | "embase" | "cochrane")  ← START of query AST/translation
                                        ▼
  rendered query string ── props.api.pubmedCount ──► POST /api/search-builder/count ──► nlmClient.pubmedCount
  add-term box ── props.api.meshLookup/meshSuggest ─► POST /api/search-builder/mesh[-suggest] ─► nlmClient
  persistence ── props.loadSearch/saveSearch ──────► GET/PUT /api/search-builder/:projectId ──► WorkflowModuleState(moduleKey='search')
```

---

## 1. Backend — separated Search Engine module (`server/searchEngine/`)

### 1a. `server/searchEngine/nlmClient.js` — NLM E-utilities proxy (REUSE for P1 connector HTTP client)
The ONLY place the server-side NCBI key is used. Browser never calls NLM directly. **Graceful: any
failure returns null/[] — never throws.** This is the canonical pattern P1 connectors should clone.

Env (`L9-13`): `NCBI_API_KEY` (raises 3→10/sec), `NCBI_TOOL` (default `metalab`), `NCBI_EMAIL`, `NCBI_TIMEOUT_MS` (default 5000).

Key internals to reuse:
- `apiKey()` `L20`, `tool()` `L21`, `email()` `L22`, `timeoutMs()` `L23`.
- `minIntervalMs()` `L25` → 110ms with key / 350ms without (per-host start-spacing budget).
- **`makeThrottle(intervalFn)` `L37`** — serializes the START SLOT only (not the fetch) via a
  promise chain `gate`, so a slow response never head-of-line-blocks the next call's spacing.
  Two independent throttles: `eutilsSlot` `L50` (key-aware), `meshRdfSlot` `L51` (fixed 350ms for
  `id.nlm.nih.gov` SPARQL). **P1 connectors should make ONE throttle PER HOST.**
- **`nlmFetch(url, slot=eutilsSlot)` `L53`** — `await slot()`, `AbortController` + `setTimeout(timeoutMs)`,
  `fetch(url,{signal,headers:{Accept:'application/json'}})`, returns `res.json()` or `null` on any
  error (`!res.ok`, network, timeout, abort, bad-JSON). Node<18 w/o global fetch → returns null `L54`.
- `commonParams()` `L69` — builds `URLSearchParams` with `retmode=json`, `api_key`, `tool`, `email`.

Endpoints (constants `L17-18`): `EUTILS = https://eutils.ncbi.nlm.nih.gov/entrez/eutils`,
`MESH_SPARQL = https://id.nlm.nih.gov/mesh/sparql`.

Caches (`L27-30`, all `createTtlCache`): `meshCache` 30d, `countCache` 1h, `narrowerCache` 30d,
`suggestCache` 30d. `_caches()` `L272` exposes them for tests.

Exported functions (signatures + contract shapes):
- `emtreeFallback(mesh)` `L86` → de-inverts comma MeSH heading ("Diabetes Mellitus, Type 2" →
  "type 2 diabetes mellitus"). Pure heuristic (NLM has no Emtree).
- `parseSparqlLabels(json)` `L99` → ordered de-duped `?label` strings.
- **`mapMeshSummary(rec)` `L116`** → the Search Builder MeSH contract shape:
  `{ mesh, meshUI, tree:'', emtree, synonyms:[…≤40], scope, children:[], source:'live' }` or null.
- `narrowerQuery(ui)` `L134` (SPARQL), `meshNarrower(meshUI)` `L151` → `string[]` children, `[]` for
  genuine none (cached), **`null` for transient failure (NOT cached → retried)**. UI regex `/^D\d{6,}$/`.
- **`meshLookup(term)` `L169`** — esearch(db=mesh)→esummary→`mapMeshSummary`, enriches `children` via
  `meshNarrower`; caches a `null` as known no-match. Returns the contract record | null.
- `mapMeshSummaryList(result, uids, cap=6)` `L206` — PURE list mapper (dedupe by heading, cap).
- `meshSuggest(term, cap=6)` `L230` — as-you-type; returns `array (possibly [])`; `[]` on any failure.
- `pubmedCount(query)` `L257` — esearch(db=pubmed, rettype=count) → integer | null; caches by query string.

### 1b. `server/searchEngine/ttlCache.js` — `createTtlCache({ttlMs, max=2000})` `L11` (REUSE)
In-memory TTL+LRU `Map`. `get()` returns **`undefined` for miss/expired**, but a stored **`null` is a
valid cached negative** (callers MUST distinguish). `set()` evicts oldest on overflow, refreshes LRU.
Methods: `get/set/has/size/clear`. Pure (only `Date.now()`). P1 connector/result caches should reuse this.

### 1c. `server/searchEngine/searchEngineController.js` — HTTP layer
- `SEARCH_MODULE = 'search'` `L26`.
- `sanitizeIgnored(raw)` `L35` — accepts legacy `string[]` OR `{text,field,label}[]`, normalizes to
  objects, caps 500. Exported for tests.
- **`searchEngineEnabled()` `L57`** — reads `siteSetting{key:'featureFlags'}`, returns `.searchEngine===true`.
  Every handler calls this first; false → 404. (P1 will need its own/extended flag gate.)
- NLM proxy handlers (auth + flag only; degrade rather than 500):
  - `postMesh(req,res)` `L69` — `{term}` → `meshLookup` record | null.
  - `postMeshSuggest(req,res)` `L81` — `{term}` → array (or []).
  - `postCount(req,res)` `L93` — `{query}` → `{count}` (integer|null).
- **`gate(req,res)` `L107`** — flag check + `resolveProjectAccess(req.params.projectId, req.user.id)`;
  404 if no `canView`. Returns the access object (`{canView,canEdit,ownerId,...}`). **This is the
  per-project authorization seam P1 should reuse for any project-scoped search-run endpoints.**
- `getSearch(req,res)` `L114` — `getModuleState(projectId,'search')`; `revision<=0` → `null` (tab seeds
  from PICO); else `{...state, revision, updatedAt, updatedBy}`.
- **`putSearch(req,res)` `L133`** — requires `access.canEdit` (403 else). Builds the persisted `value`:
  `{ concepts[], overrides{}, ignored=sanitizeIgnored(...), databases[≤40 strings], readyForScreening:bool, dismissedWarnings[≤200] }` `L140-160`.
  Persists via `patchModuleState({projectId, moduleKey:'search', patch:value, baseRevision:null, user})`
  (`baseRevision:null` = full upsert, last-write-wins). On ok: `recordWorkflowAudit({action:'SEARCH_UPDATED'})`
  + `emitToMetaLabProject(projectId, ownerId, {type:'search.updated', revision}, {exclude:user.id})`
  (thin live-sync poke). **This is the realtime seam — P1 import progress could ride a similar poke.**

### 1d. Routes + mount
- `server/routes/searchEngine.js` — `Router()`: `POST /mesh`, `POST /mesh-suggest`, `POST /count`,
  `GET /:projectId`, `PUT /:projectId`. (NLM proxies BEFORE the `:projectId` param routes.)
- **Mounted in `server/index.js` L281**: `app.use('/api/search-builder', requireAuth, searchEngineLimiter, searchEngineRouter);`
  - `searchEngineLimiter` `L134` — `rateLimit({windowMs:15min, max: prod?600:2000})`.
  - Router import `L39`. **P1 routes should mount under the same prefix or a sibling with the same
    `requireAuth + limiter` pattern.**

### 1e. Persistence substrate — `WorkflowModuleState` (moduleKey `'search'`)
The search builder is a first-class migrated workflow module. Backend uses `server/services/workflowState.js`:
`resolveProjectAccess(projectId,userId)` `L58`, `getModuleState(projectId,moduleKey)` `L109` (returns
`{state, revision, updatedAt, updatedBy}`, revision 0 = never saved), `patchModuleState({...,baseRevision})`
`L135` (compare-and-swap; `null` baseRevision = overwrite), `recordWorkflowAudit(...)` `L181`.
**No new table for the search state itself — it is a row in WorkflowModuleState.** P1's NEW data
(import runs, provenance, dedup ledger) will almost certainly need NEW Prisma tables (see Risks).

---

## 2. Canonical concept/term data structure (THE shared model — P1 reads this)

### Concept (a "block" / PICO group)
```
{
  id?: string,                 // assigned in the component (uid()); absent until first edit
  label: string,              // display name (user-renamable for picoField groups)
  picoField?: 'P'|'I'|'C'|'O'|'T',   // canonical key (null/absent for manual concepts)
  field: string,              // PICO field label ("Population", ...)
  source: 'pico_auto' | (manual: created without source),
  op: 'AND' | 'OR',           // how this concept joins the NEXT concept (default 'AND')
  note?: string,              // only the Time-Frame ('T') group: human time restriction
  terms: Term[]
}
```
Five canonical groups always present, in order — `PICO_FIELD_DEFS` (searchState.js `L23`):
`P Population`, `I Intervention / Exposure`, `C Comparator / Control`, `O Outcomes`, `T Time Frame`.

### Term (the atom the renderers translate)
From `mkTerm` (conceptExtraction.js `L108`) + extensions added in the UI:
```
{
  text: string,               // the literal term
  normalizedLabel: string,    // norm(text)
  type: 'freetext' | 'controlled',   // 'controlled' = MeSH/Emtree subject heading
  field: 'tiab' | 'ti' | 'all',      // free-text field scope (default 'tiab')
  sourceField?: string,       // PICO field label it came from
  source: 'pico_auto' | 'user_added',// pico_auto = re-syncable; user_added survives re-sync
  synonym?: boolean,
  // controlled-only / UI-set extras consumed by renderers:
  vocab?: { mesh, meshUI, tree, emtree, synonyms[], scope, children[] },  // the mapMeshSummary record
  noExplode?: boolean,        // controlled: don't explode narrower
  truncate?: boolean,         // freetext: trailing * wildcard (single word only)
  phrase?: boolean            // freetext: force quoted phrase
}
```

### Persisted slice (what rides to the server) — `pickPersisted` (searchState.js `L258`)
`{ concepts[], overrides{}, ignored[{text,field,label}], databases[string ids], readyForScreening:bool, dismissedWarnings[string] }`.
`ignored` = auto-suggestions the user deleted so a PICO re-sync never re-adds them.

---

## 3. Pure engine helpers (`src/research-engine/searchBuilder/`)

- **`searchState.js`** — the conflict-safe sync + canonical-grouping core:
  - `syncSearchBuilderFromPico(pico, existingConcepts, ignoredList)` `L103` — idempotent; always
    returns 5 PICO groups (canonical) + manual concepts; reuses ids/vocab; relocates/dedups auto terms
    by PICO role (SB4); **pure, assigns no ids / no I/O** (caller fills ids + runs MeSH).
  - `conceptFieldKey(c)` `L53`, `timeframeLabel(pico)` `L62`, `extractFieldTerms(text)` `L78`,
    `termPicoRole(text)` `L240`.
  - Serialization: `stableStringify` `L247`, `pickPersisted` `L258`, `serializeSearchState` `L271`,
    `searchStatesEqual` `L276`, **`remoteAdoptDecision({remoteSig,lastSavedSig,remoteRevision,knownRevision,busy})` `L289`**
    → `'skip'|'defer'|'adopt'` (drives live-sync without clobbering edits).
  - Tab-1 keyword helpers: `findFieldConcept` `L316`, `fieldHasTerm` `L321`, `addManualTermToField` `L333`,
    `removeTermFromField` `L350`. Concept status: `conceptStatus(concept)` `L359` → `empty|needs-review|mesh-suggested|ready` + `CONCEPT_STATUS_LABELS` `L370`.
  - `extractActiveConcepts(pico, ignoredList)` `L302`.
- **`conceptExtraction.js`** — `norm(s)` `L19`, `extractConcepts(text,fieldLabel)` `L125`,
  `picoToConcepts(pico)` `L163` (PICO_FIELDS = P/I/C/O `L156`), `mkTerm(text,isSyn,fieldLabel)` `L108`,
  `matchFamily`, `expandAbbreviation`, `splitSegments`, `stripJunk`. Imports `STOPWORDS` from screening/keywords.js and `CONCEPT_FAMILIES/ABBREVIATIONS/CONNECTORS/JUNK_WORDS` from `medicalSynonyms.js`.
- **`meshSuggest.js`** — `localMeshSuggestions()` `L130`, `meshConfidence()` `L191` (offline seed;
  `SEED_BY_FAMILY` maps family→official MeSH heading; must include T2DM/HFrEF/IBD/EUS/CKD/COPD).
- **`databases.js`** — the catalogue (see §5).
- Others: `keywordSelection.js` (`tokenizeForSelection` `L172`, `suggestedKeywords`, `isFillerWord`),
  `crossConcept.js` (`termEquivalenceKey` `L30`, `detectCrossConceptDuplicates` `L43`,
  `searchQualityCheck` `L76`, `sensitivitySignal` `L145`), `medicalSynonyms.js`, `crossConcept`,
  benchmark/fixtures.

---

## 4. Frontend (`src/features/searchBuilder/`)

### 4a. `searchBuilderApi.js` — the 4 wiring seams (REUSE the auth-fetch pattern for P1)
`BASE = '/api/search-builder'`. `jpost(url,body)` `L9` — `fetch(POST, credentials:'include')`,
**THROWS on `!r.ok`** (so the tab drops to "limited mode"); a 200 `null` is a real no-match.
- `searchBuilderApi.meshLookup(term)` `L20`, `.meshSuggest(term)` `L25`, `.pubmedCount(query)` `L30`.
- `loadSearch(projectId)` `L37` — GET `:projectId` → `{concepts,overrides,...}|null` (swallows errors → null).
- `saveSearch(projectId, state)` `L48` — PUT → `{ok,revision}|null`.
- `searchEngineFlagEnabled()` `L59` — GET `/api/settings/public` → `featureFlags.searchEngine===true`.

### 4b. `SearchBuilderTab.jsx` — the embeddable engine + UI (~1000+ lines)
Props contract (header doc `L19-24`): `pico`, `api` (mesh/count), `loadSearch`/`saveSearch`, `projectId`.
Imports app theme tokens `C,FONT,MONO,alpha` (`L2`) so it follows day/night + brand.

**THE QUERY RENDER PIPELINE (the START of the canonical query AST + per-database translation — P1's
connectors must convert these strings, or branch the AST, into each DB's REST API params):**
- `renderControlled(term,dbId)` `L123` — subject-heading syntax:
  - pubmed: `"<mesh>"[Mesh]` (+`:NoExp` when `noExplode`)
  - cochrane: `[mh "<mesh>"]` (+`^` for noExplode)
  - embase: `'<emtree>'/exp` (or `/de` for noExplode)
- `freeTextToken(term)` `L130` — applies truncation (`*`, single-word only) + phrase-quoting → `{token,field}`.
- `pubmedFree(term)` `L137` → `<token>[tiab|ti|all]`.
- `fieldSuffix(dbId,field)` `L142` — cochrane `:ti,ab,kw`/`:ti`; embase `:ab,ti`/`:ti`/`:ab,ti,kw`.
- `renderTerm(term,dbId)` `L147` — dispatches controlled vs free; empty text → "".
- `renderConcept(concept,dbId)` `L154` — OR-joins live terms within the concept (groups free-text by
  field, then `(... OR ...)`); single term → no parens.
- **`renderSearch(concepts,dbId)` `L174`** — AND/OR-joins concept blocks per `concept.op`; returns
  `{ full: string, lines: [{n,label,q,op}] }`. **This is the top-level query builder.**
- Plain-English mirror: `plainTerm` `L184`, `plainConcept` `L194`, `plainSearch(concepts)` `L199`.
- Breadth/stats (no fabricated counts): `termBreadth` `L209`, `searchStats` `L217`, `fmtCount` `L222`.

**Supported native-syntax DBs** (local `DBS` `L116`): `pubmed` (live), `embase`, `cochrane` (the same 3
flagged `nativeSyntax:true` in databases.js). All others = generic keyword strategy only (honest note).

Exported pure helpers (also re-exported via index.js): `strategyHash(str)` `L47` (FNV-1a, drives the
PubMed hit lifecycle stale→updating→updated/failed), `relativeTime(ts,nowMs)` `L57`,
`normalizeIgnoredEntry` `L73`, `normalizeIgnored` `L83`.
Offline fallback vocab `CORE_VOCAB` `L96` (used only when backend/NLM down).

### 4c. `index.js` — public surface
Re-exports `SearchBuilderTab` (default), the pure test helpers, `searchBuilderApi/loadSearch/saveSearch/searchEngineFlagEnabled`,
plus engine helpers from research-engine. Header warns: **do NOT edit the syntax renderers**.

### 4d. Dispatcher wiring (the monolith seam)
`src/frontend/workspace/tabs/protocolTabs.jsx`:
- Import `L20`: `SearchBuilderTab, searchBuilderApi, loadSearch as sbLoad, saveSearch as sbSave, searchEngineFlagEnabled`.
- **`SearchDispatcher({project,activeId,updNested,upd})` `L252`** — checks the flag; OFF → legacy
  `SearchTab` `L259` (the LLM-prompt-based builder persisting in `project.mesh`); ON →
  `<SearchBuilderTab projectId={activeId} pico={project.pico} api={searchBuilderApi} loadSearch={sbLoad} saveSearch={sbSave}/>` `L260`.
- Also referenced from `src/frontend/workspace/Workspace.jsx`.

---

## 5. Database catalogue (`databases.js`) — P1's DB targeting list
`DATABASE_CATALOG` `L33` — 16 entries `{id,label,group,tier,nativeSyntax,defaultOn}`. **Only
`pubmed`/`embase`/`cochrane` have `nativeSyntax:true` + `defaultOn:true`.** Others (clinicaltrials,
ictrp, scopus, wos, gscholar, cinahl, psycinfo, proquest, opengrey, europepmc, pmc, ieee, acm) =
`nativeSyntax:false`. Helpers: `databaseGroups()` `L64`, `defaultSelectedDatabases()` `L75`,
`accessNote(id)` `L80`, `getDatabase(id)` `L86`, `nativeSyntaxDatabases()` `L91`, `ACCESS_TIERS` `L19`,
`ACCESS_TOOLTIP` `L96`. **For P1 auto-search, only pubmed is actually live-callable today (count only);
no DB has a record-RETRIEVAL connector yet — that is net-new.**

---

## 6. Exact integration seams for P1

1. **HTTP connector client** — clone `nlmClient.js`'s `makeThrottle`/`nlmFetch`/`commonParams` +
   `ttlCache.js` per new source (one throttle PER HOST, graceful null-return, env key handling).
2. **Query translation** — the per-DB strings come from `renderSearch(concepts,dbId)` /
   `renderConcept` / `renderTerm` in `SearchBuilderTab.jsx` (`L147-181`). P1 must turn these (or the
   canonical `concepts[]` model directly) into each connector's API params. Today only pubmed/embase/
   cochrane have native syntax.
3. **New routes** — add under `app.use('/api/search-builder', requireAuth, searchEngineLimiter, ...)`
   in `server/index.js L281` (or a sibling router with the same `requireAuth`+limiter+flag-gate shape).
   Reuse `gate(req,res)` (controller `L107`) → `resolveProjectAccess` for project-scoped run/import endpoints.
4. **Persistence** — small search-builder state stays in `WorkflowModuleState(moduleKey='search')`.
   P1's heavier artifacts (search-run records, fetched-record provenance, dedup ledger, PRISMA-S
   counts) need NEW Prisma models keyed by projectId — do not overload the module-state blob.
5. **Realtime** — `emitToMetaLabProject(projectId, ownerId, {type:'search.updated', revision}, {exclude})`
   (controller `L176`) over the shared SSE poke channel (`useRealtime` on the client). P1 import
   progress can ride the same channel with a new `type`.
6. **Auto-import handoff** — `putSearch` already persists `readyForScreening:bool` + selected
   `databases[]`; P1 import results must land in the screening pipeline (ScreenProject / studies),
   which is a separate subsystem (out of scope of this file but it is the downstream sink).

---

## 7. Top risks / gotchas

- **Flag gate everywhere.** `searchEngineEnabled()` (DB-read of `siteSetting.featureFlags`) is checked
  at the top of EVERY handler; new P1 endpoints must replicate this or 404. The frontend independently
  re-checks via `searchEngineFlagEnabled()` (public settings). Two separate gates must agree.
- **Cache `undefined` vs `null`.** ttlCache `get()` returns `undefined` for miss but `null` is a valid
  cached negative. Mishandling this re-queries (or wrongly caches) — see meshLookup/meshNarrower's
  careful "transient null → don't cache" handling (`L190-194`, `L158`).
- **Throttle is per-host.** eutils and the MeSH SPARQL endpoint have separate throttles so one doesn't
  consume the other's spacing budget. Each new P1 source = its own throttle (don't share `eutilsSlot`).
- **Renderers are frozen.** index.js + the tab header explicitly say DO NOT edit the syntax renderers
  (`.claude/SearchEngine/INTEGRATION_README.md`). P1 should consume their output / extend a new AST
  layer beside them, not rewrite them.
- **Only 3 DBs have native syntax; only PubMed is live (and only for COUNT).** There is currently NO
  record-retrieval connector for any database — P1 builds the first ones. Embase/Cochrane native syntax
  exists as strings but there is no Embase/Cochrane API client.
- **No baseRevision conflict control on save.** `putSearch` uses `baseRevision:null` (last-write-wins,
  single-strategy-per-project). If P1 introduces concurrent multi-user import state, last-write-wins may
  clobber — consider the compare-and-swap path (`patchModuleState` supports a non-null baseRevision → 409).
- **Persistence size cap.** Persisted arrays are capped (ignored 500, databases 40, dismissedWarnings
  200). The WorkflowModuleState row is meant to stay small — heavy P1 data must NOT go here.
- **Legacy vs new builder coexist.** When the flag is OFF the legacy LLM `SearchTab` (persists in
  `project.mesh`, different shape `selectedDBs/results/...`) is active. P1 must target the new
  flag-ON path (`project.pico` + WorkflowModuleState), not `project.mesh`.
- **emtree is a heuristic.** `emtreeFallback`/`mapMeshSummary.emtree` is NOT authoritative Embase
  vocabulary — any Embase connector must treat it as best-effort.
- **`fetch` global assumed.** nlmFetch returns null if `typeof fetch !== 'function'` (Node<18). Match
  the runtime assumption in P1 connectors.
