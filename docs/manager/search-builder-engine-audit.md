# Search Builder Engine — Audit & Live-Sync Plan (SE1)

_Scope: the Search Builder engine and its PICO synchronization only. No changes to
project creation, dashboard, protocol/PICO editor, screening, extraction, RoB,
GRADE, PRISMA, analysis, exports, permissions, or Ops Console behavior. All
changes additive, targeted, reversible, and gated behind the existing
`searchEngine` feature flag (default OFF)._

## 1. Current files / components involved

| Layer | File | Role |
|---|---|---|
| Engine (pure) | `src/research-engine/searchBuilder/conceptExtraction.js` | Deterministic, network-free PICO→concepts extraction (`extractConcepts`, `picoToConcepts`, `splitSegments`, `stripJunk`, `matchFamily`, `expandAbbreviation`, `norm`). |
| Engine data | `src/research-engine/searchBuilder/medicalSynonyms.js` | `CONCEPT_FAMILIES` (phrase ladder + synonyms + abbreviations), `ABBREVIATIONS`, `CONNECTORS`, `JUNK_WORDS`. |
| Engine data | `src/research-engine/screening/keywords.js` | Shared `STOPWORDS` set (reused by `stripJunk`). |
| Frontend tab | `src/features/searchBuilder/SearchBuilderTab.jsx` | The concept→multi-database query builder UI + state. Renders PubMed/Embase/Cochrane syntax, MeSH detail, live PubMed counts. |
| Frontend wiring | `src/features/searchBuilder/searchBuilderApi.js` | `searchBuilderApi` (mesh/count proxies), `loadSearch`/`saveSearch` (per-project persistence), `searchEngineFlagEnabled`. |
| Frontend index | `src/features/searchBuilder/index.js` | Public exports of the feature. |
| Backend HTTP | `server/searchEngine/searchEngineController.js` | `postMesh`, `postCount`, `getSearch`, `putSearch`. |
| Backend NLM | `server/searchEngine/nlmClient.js` + `ttlCache.js` | NLM E-utilities proxy (MeSH lookup, PubMed count) with TTL cache + throttle. |
| Backend routes | `server/routes/searchEngine.js` (mounted `/api/search-builder` in `server/index.js`) | requireAuth + dedicated rate limiter; each handler gates on the `searchEngine` flag. |
| Persistence | `server/services/workflowState.js` | `WorkflowModuleState` row keyed by `(projectId, moduleKey='search')`, optimistic-concurrency `revision`, shallow-merge patch. |
| Realtime (reusable) | `server/realtime/bus.js`, `server/routes/events.js`, `src/frontend/hooks/useRealtime.js` | In-process SSE "poke" bus (`emitToMetaLabProject`, …) + one EventSource per tab. |

## 2. Current data flow

```
PICO ({P,I,C,O})  ──prop──►  SearchBuilderTab
                               │
                               ├─ picoToConcepts(pico)  → concept groups per PICO field
                               │     (segment split → stripJunk → matchFamily/abbrev expand)
                               │
                               ├─ on mount: loadSearch(projectId)  ─GET /api/search-builder/:pid─►
                               │     getModuleState(pid,'search')  (revision>0 ? state : null)
                               │     null → seedFromPICO(initial)
                               │
                               ├─ MeSH: A.meshLookup(text) ─POST /mesh─► nlmClient (NLM proxy, TTL cache)
                               ├─ Count: A.pubmedCount(q)  ─POST /count─► nlmClient
                               │
                               └─ on change (debounced 800ms): saveSearch(pid,{concepts,overrides,ignored})
                                     ─PUT /api/search-builder/:pid─► patchModuleState (revision++ CAS)
```

- Concept/term shape (today): concept `{id,label,field,source,op,terms[]}`; term
  `{id,text,type:'freetext'|'controlled',field,source:'pico_auto'|'user_added'|'synonym',synonym,vocab?}`.
- Deleted **auto** terms are remembered in `ignored[]` (normalized text) so a PICO
  re-sync never re-adds them until "Reset suggestions". User-added terms are just removed.
- Canonical shared state lives **server-side** in `WorkflowModuleState` (NOT localStorage). Good.

## 3. Current sync behavior (the gap)

- **Within a session:** the editing user sees changes immediately (local React state). ✔
- **PICO → builder:** a `pico` prop change flips a `picoDirty` flag and offers a
  non-destructive "+N new suggestions from PICO" merge (never clobbers manual work). ✔
- **Across collaborators (the missing piece):** the tab **only** loads on mount and
  autosaves. It does **not** emit a realtime poke on save, and it does **not** subscribe
  to `useRealtime`. So a second online collaborator does **not** see Search Builder
  changes until they manually refresh. ✘ ← _This is SE1's headline requirement._

## 4. Risks

- **Clobbering in-progress edits:** naïvely refetch-and-replace on a remote poke would
  destroy a collaborator's unsaved edits or close an open term editor. → Apply remote
  state only when idle (no open editor/draft); otherwise defer until idle.
- **Save↔poke ping-pong:** a collaborator applying remote state would re-trigger their
  own autosave → another poke → loop. → Guard autosave with a `lastSaved` snapshot so
  applying remote (or freshly loaded) state never re-PUTs.
- **Last-write-wins:** `putSearch` uses `baseRevision:null` (full upsert). Acceptable for
  a single-strategy-per-project document; revision is surfaced so clients can detect
  newer server state. Field-level OT is out of scope.
- **Clustering:** the SSE bus is in-process (single Node + SQLite). Multi-instance
  delivery would need a broker; the load-on-mount path remains the correctness fallback.
- **Engine purity:** extraction must stay deterministic and network-free (CI must never
  hit NLM). Preserved — MeSH stays behind the mocked `props.api`/backend proxy.
- **Not-yet-mounted tab:** `SearchBuilderTab` is a complete, flag-gated module but is not
  yet rendered in `AppWorkspace`. Live-sync is implemented at the engine/tab/server level
  so it works the moment the tab is mounted; wiring the tab into the workspace is tracked
  separately and is out of SE1's "engine only" scope.

## 5. Proposed minimal implementation plan

1. **Server emit.** Surface `ownerId` from `resolveProjectAccess`; in `putSearch`, after a
   successful save, `emitToMetaLabProject(projectId, ownerId, { type:'search.updated' }, { exclude: req.user.id })`.
   Return `revision`/`updatedAt` from `getSearch` so clients can track concurrency.
2. **Client subscribe.** `SearchBuilderTab` calls `useRealtime({ 'search.updated': … })`;
   on a matching project it refetches via `loadSearch` and applies the server state when
   idle, deferring while an editor is open. A `lastSaved` ref makes both autosave and
   remote-apply idempotent (no ping-pong, no redundant PUT).
3. **Engine metadata.** Additively tag each extracted term with `sourceField` (the PICO
   field) and `normalizedLabel`; tag concepts with `normalizedLabel`. No change to the
   rendering `type`/`source` fields the engine already relies on.
4. **Tests.** Extend `conceptExtraction.test.js` (metadata, idempotent re-extraction,
   hidden-terms-stay-hidden) and add a pure `searchState` helper (serialize/equality/
   merge) with its own unit test for the sync core. No live NLM in CI.

All steps are gated by the `searchEngine` flag and degrade safely when realtime is down
(the client keeps its load-on-mount + autosave behavior; `useRealtime.healthy === false`).
