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

## Known limitations (from the handoff + this integration)
1. **Emtree term** is a lowercased MeSH fallback (NLM has no Emtree data) — verify
   the Embase *subject term* against a real Embase session or add a MeSH→Emtree
   crosswalk before relying on Embase output. Query *syntax* for all three DBs is
   correct.
2. **Narrower terms (`children`)** are left empty (optional in the contract) — the
   hover panel simply shows none; a follow-up can fetch them via the MeSH RDF API.
3. **Per-concept live counts** are not enabled (only the whole-query total) — the
   safe default; switch on only with an API key + short-TTL cache.
4. The NLM throttle is a single-process in-memory spacer — fine for one server;
   multi-instance deployments would want a shared limiter.
