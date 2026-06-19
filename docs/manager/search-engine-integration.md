# Search Engine — Integration Report

Wires the handoff in `.claude/SearchEngine/` (`SearchBuilderTab.jsx` +
`BACKEND_CONTRACT.md` + `INTEGRATION_README.md`) into the app: a **separated**
concept→multi-database Search Builder engine with **full app integration**,
replacing the legacy in-monolith Search Builder behind a feature flag.

## Posture
- **Feature flag `searchEngine`** (default OFF). Off → `/api/search-builder/*`
  endpoints 404 and the monolith renders the legacy `SearchTab` unchanged. On →
  the new `SearchBuilderTab` renders and the endpoints serve. Flip in Ops ›
  Feature Flags. Zero production change until enabled; rollback = flag OFF.
- **Strangler-fig:** `SearchDispatcher` in the monolith swaps legacy↔new (mirrors
  `PICODispatcher`); nothing deleted.

## Backend — the separated engine (`server/searchEngine/`)
- `nlmClient.js` — NLM E-utilities proxy: `meshLookup(term)` (esearch→esummary,
  mapped via the pure `mapMeshSummary`) and `pubmedCount(query)`
  (esearch&rettype=count). Server-side NCBI key/tool/email; graceful (any failure
  → null → frontend "limited mode"); TTL+LRU cache (MeSH ~30d, count ~1h) +
  start-spacing throttle (~9/sec with key, ~2.8/sec without).
- `ttlCache.js` — pure TTL/LRU cache (unit-tested).
- `searchEngineController.js` + `routes/searchEngine.js` — the 4 contract endpoints
  (mounted `/api/search-builder`, `requireAuth` + dedicated rate limiter, each
  flag-gated):
  - `POST /mesh`, `POST /count` — auth + flag only (generic vocab lookups).
  - `GET /:projectId`, `PUT /:projectId` — project-access authorized (owner or
    linked-workspace member; write needs `canEdit`).
- **Persistence reuses the per-module workflow-state infra** (`WorkflowModuleState`
  moduleKey `search`) — so the Search Builder becomes the **second migrated
  workflow module** (after `protocol`), advancing the de-monolithization roadmap.
  No new table. Saves record a `SEARCH_UPDATED` audit row.

## Env (server/.env — not committed)
```
NCBI_API_KEY=<optional; 3/sec → 10/sec>
NCBI_TOOL=metalab
[email protected]
NCBI_TIMEOUT_MS=5000
```
Works without a key at the lower rate. Add the key later as a one-line env change.

## Frontend — full integration (`src/features/searchBuilder/`)
- `SearchBuilderTab.jsx` — the handoff component, **theme-adapted to the app design
  tokens** (its local dark `C` replaced with the app's `C/FONT/MONO/alpha`; all
  hex+alpha concatenations rewritten to `alpha(...)`), so the tab follows day/night
  **and the global brand color** (prompt37). The engine syntax renderers are
  untouched per the handoff's "do not edit" rule.
- `searchBuilderApi.js` — the 4 seams: `meshLookup`/`pubmedCount` (throw on
  HTTP/network error → limited mode; 200+null = genuine no-match), `loadSearch`/
  `saveSearch` (debounced autosave, no save button), `searchEngineFlagEnabled`.
- Seam wiring (monolith `SearchDispatcher`): `projectId={activeId}`,
  `pico={project.pico}` (keys already `{P,I,C,O}` — no PICO form added),
  `api`/`loadSearch`/`saveSearch`.

## Live-verified (dev server, real NLM)
| Check | Result |
|---|---|
| flag OFF → endpoints | 404 |
| `GET /:pid` before save | `null` (tab seeds from PICO) |
| `PUT /:pid` → `GET` | round-trips the saved `{concepts,overrides}` |
| `POST /mesh {term:"type 2 diabetes"}` | live: `Diabetes Mellitus, Type 2` (D003924, 32 synonyms, `source:"live"`) |
| `POST /count {query:"diabetes"}` | live: `1,125,811` |
| unauth / non-member | 401 / 404 |

Unit: +5 (`mapMeshSummary`, `createTtlCache`). Gate: 1387 green. Build green.

## v3.21.1 follow-up — flag visibility + limitation fixes
- **Ops flag was invisible (fixed).** The Feature-Flags UI is driven by a hardcoded
  `FLAG_META` list in `AdminConsole.jsx` that omitted `searchEngine` (and
  `serverBackedWorkflowState`), so neither could be toggled. Both are now listed.
  Root cause beneath that: `getFeatureFlags` (admin) and `getPublicSettings`
  returned the stored row **verbatim**, and `initDefaultSettings` never overwrites
  an existing row — so flags added after the row's creation never appeared. Both
  endpoints now **merge `defaultFeatureFlags()`** under the stored values (stored
  wins), so any future flag surfaces automatically with its correct default.
- **Emtree fallback improved (L1).** `emtreeFallback()` now de-inverts
  comma-inverted MeSH headings into natural Embase word order
  (`"Diabetes Mellitus, Type 2"` → `"type 2 diabetes mellitus"`) instead of a flat
  lowercase. Still a derived heuristic — verify in Embase before publishing.
- **Narrower terms now populated (L2).** `meshNarrower(meshUI)` fetches direct
  narrower descriptors from the **MeSH RDF SPARQL endpoint**
  (`id.nlm.nih.gov/mesh/sparql`, `meshv:broaderDescriptor`); `meshLookup` attaches
  them as `children`. UID-guarded (`/^D\d{6,}$/`, blocks SPARQL injection),
  best-effort and never fatal, cached 30d. The existing hover panel + "includes N
  narrower topic(s)" line light up with real data. Live-verified: Hypertension UID
  → 9, Type 2 Diabetes → 1.
- **Cache/throttle hardening (review follow-up).** `meshNarrower` now returns
  `null` on a *transient* fetch failure vs `[]` for a *genuine* no-children
  result, and `meshLookup` does NOT write a transient-empty record into the 30-day
  `meshCache` (returns it uncached so the next lookup retries) — a failed SPARQL
  call can no longer freeze `children=[]` for 30 days. The NLM throttle is now
  **per-host** (`eutilsSlot` for E-utilities, `meshRdfSlot` for the SPARQL host),
  so the narrower call doesn't consume the eutils spacing budget.

## Known limitations (remaining)
1. **Emtree** is still a *derived* term (NLM has no Emtree data) — the de-inversion
   gets natural word order but a true MeSH→Emtree crosswalk needs UMLS (licensed).
   Verify the Embase subject term before relying on Embase output. Query *syntax*
   for all three DBs is correct.
2. **Per-concept live counts** are not enabled (only the whole-query total) —
   enabling them means editing the frozen handoff engine component, which is out
   of scope; the count seam already supports any query the frontend sends.
3. The NLM throttle is a single-process in-memory spacer (now per-host) — adequate
   for the single-instance VPS deploy; a multi-instance deployment would want a
   shared limiter. `meshLookup` makes up to 3 NLM calls on a cold lookup (esearch →
   esummary → SPARQL, ~0.6s), all throttled + 30d-cached, so steady-state cost
   stays low; the response still blocks on the narrower call because the frozen
   handoff component expects `children` inline (lazy-fill would need a component
   change).
4. NLM `esearch` ranks a bare term's "best match", which is often a *specific*
   narrower descriptor (e.g. "hypertension" → "Familial Primary Pulmonary
   Hypertension") rather than the broad heading — so `children` is legitimately
   empty for those. Pre-existing handoff behavior; the searcher can refine the term.
