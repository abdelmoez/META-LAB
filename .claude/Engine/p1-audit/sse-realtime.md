# P1 Audit — SSE / Realtime Progress Infrastructure

Scope: the server SSE endpoint, the in-process event bus + emit helpers, payload
format, stream auth, the frontend `useRealtime` hook, and how to add a
"search run progress" event type plus reload-safe state reconstruction.

Architecture doc of record: `docs/manager/realtime-architecture.md` (prompt6 Task 7).

---

## 1. The single SSE endpoint

**`server/routes/events.js`** — `GET /api/events` (the ONLY SSE stream).

- Router mounted in **`server/index.js:269`** → `app.use('/api/events', eventsRouter);`
  on its OWN mount, deliberately NOT under the rate-limited `/api/auth` or
  `/api/admin` routers (a reconnecting EventSource would burn the limiter).
- `index.js:177` exempts `/api/events` from the maintenance-mode 503 gate.
- Handler: `router.get('/', requireAuth, (req, res) => { … })` — `events.js:25`.
  - `requireAuth` from `server/middleware/auth.js:61` — identity comes from the
    **httpOnly session cookie** (`metalab_session`); the stream is identity-only,
    NO per-stream authorization. Authorization is re-checked at refetch time on
    each REST endpoint.
  - Response headers (`events.js:26-31`): `Content-Type: text/event-stream`,
    `Cache-Control: no-cache`, `Connection: keep-alive`,
    `X-Accel-Buffering: no` (nginx: disable proxy buffering). `res.flushHeaders()`.
  - Writes `retry: 5000\n\n` (browser native-retry hint) then `:connected\n\n`.
  - `register(req.user.id, res)` adds the stream to the bus registry (`events.js:39`).
  - Heartbeat: `:hb\n\n` comment every `HEARTBEAT_MS = 25000` (`events.js:21,41-43`).
  - `req.on('close')` clears the heartbeat and `unregister(req.user.id, res)`
    (`events.js:45-48`).
- No compression middleware in the server (verified in the file header), so
  `res.write` frames flush immediately.

ONE EventSource per browser tab, ONE stream per user-tab (never per-project) —
browsers cap ~6 concurrent HTTP/1.1 connections per origin.

---

## 2. The in-process event bus + emit helpers

**`server/realtime/bus.js`** — in-process connection registry + emit helpers.

Registry: `const connections = new Map(); // userId -> Set<res>` (`bus.js:26`).

Exported functions (signatures + line refs):

| Function | Ref | Purpose |
|---|---|---|
| `register(userId, res)` | `bus.js:29` | add an open stream |
| `unregister(userId, res)` | `bus.js:36` | drop a stream on close |
| `connectionCount()` | `bus.js:44` | diagnostics/tests only |
| `forceCloseStreams(userId)` | `bus.js:56` | hard-close all of a user's streams (writes `event: session.revoked` then `res.end()`); used by admin suspend / password change. Returns count. |
| `writeFrame(userIds, event)` | `bus.js:72` (private) | serialize one event + `res.write` to every stream of the given users |
| `emitToUsers(userIds, event)` | `bus.js:88` | emit to explicit user id(s) |
| `emitToProjectMembers(projectId, event, { exclude })` | `bus.js:99` | emit to active members + owner of a **ScreenProject**, resolved from DB at emit time |
| `emitToMetaLabProject(metaLabProjectId, ownerUserId, event, { exclude })` | `bus.js:126` | emit for a **META·LAB project**; resolves recipients via the LINKED ScreenProject(s) (active members + owner), honoring the link invariant `ScreenProject.ownerId === Project.userId` via `ownerUserId`. Unlinked → owner only. |

Key behaviors (all emits are **fire-and-forget, error-swallowed, never awaited,
never throw** — an emit failure must never fail/slow the triggering request):

- **`writeFrame` payload shape** (`bus.js:73-74`): wraps the event as
  `{ ...event, at: event.at || new Date().toISOString() }` and writes
  `data: ${JSON.stringify(payload)}\n\n`. Note frames are the DEFAULT
  (unnamed) `message` event — the client's `es.onmessage` handles them. (Only
  `session.revoked` uses a named `event:` line.)
- `emitToProjectMembers` injects `projectId` into the payload (`bus.js:113`).
- `emitToMetaLabProject` injects BOTH `projectId` (the linked ScreenProject id)
  AND `metaLabProjectId` (`bus.js:134,146`) so either an open SiftProject or the
  monolith workspace can match it.
- Recipients are resolved at EMIT time from the DB (active member rows + owner),
  so a just-removed member silently stops receiving — there is NO registry ACL
  to invalidate.
- Short-circuits when `connections.size === 0` (`bus.js:100,127`).

### CLUSTERING LIMITATION (documented in `bus.js:19-22`)
The bus lives in **process memory** (single Node process + SQLite, no
Redis/broker). Multiple server processes would split the registry; cross-instance
delivery would need a pub/sub broker. The polling fallback covers correctness in
that scenario. **A search-run-progress feature must keep server-side durable
state (a DB row) as the source of truth, NOT the stream**, both for clustering
and for reload.

---

## 3. Event payload format ("poke, don't payload")

Events are THIN POKES: `{ type, projectId?, metaLabProjectId?, at, ...minimalIds }`.
NO content, NO actor identity (blind-mode safe by construction). Clients must
REFETCH through existing authorized REST endpoints — never trust an event as data.

Existing event `type` values in use (grep of `server/**`):

| type | emitted from | extra fields |
|---|---|---|
| `members.changed` | invites/screening/member controllers | — |
| `presence.changed`, `lock.changed` | `presenceController.js:78,91,117,132` | — |
| `permissions.changed` | `screeningMemberController.js:408,465,504,632` (via `emitToUsers`) | `projectId` |
| `project.updated` | projects/screening/review controllers | `metaLabProjectId` and/or `projectId` |
| `status.changed` | `screeningController.js:419`, `screeningAdminController.js:530` | — |
| `decision.saved` | `screeningController.js:1356,1480` | `projectId` |
| `conflict.changed` | (consumed in ConflictsTab) | `projectId` |
| `handoff.updated` | `screeningReviewController.js:193,219,259,335` | `projectId` |
| `ai.updated` | `screeningAiController.js`, `screeningAiJobs.js:79` | — |
| `chat.message` | `screeningChatController.js:136` | `projectId` |
| `notification.created` | `notificationService.js:67` (via `emitToUsers`) | — |
| **`import.completed`** | **`screeningImportWorker.js:100`** | **`jobId`** ← closest analog |
| **`search.updated`** | **`searchEngineController.js:176`** | **`revision`, `metaLabProjectId`** ← Search Builder precedent |
| `session.revoked` | `bus.js:62` (named event) | — |

---

## 4. Frontend hook — `useRealtime`

**`src/frontend/hooks/useRealtime.js`** — `export function useRealtime(handlers)` at `L102`.

- Module-level SINGLE shared `EventSource` for the whole tab (`EVENTS_URL = '/api/events'`,
  `L30`). Connection manager: `typeListeners: Map<type, Set<fn>>` (`L35`),
  `healthListeners: Set<fn(healthy)>` (`L36`), refcounted `open()`/`close()`
  (`L66,84`), capped exponential backoff `1s→30s` (`MAX_BACKOFF_MS=30000`, `L31,59`).
- `dispatch(rawEvent)` (`L50`): `JSON.parse(rawEvent.data)`, requires `data.type`,
  fans out to `typeListeners.get(data.type)`.
- API: `useRealtime({ 'event.type': ev => {…} })`. The **set of types is fixed at
  mount** (mount-once effect, `L107-139`); handler FUNCTIONS are read through a ref
  each event (`handlersRef`, `L103-104,118-121`) so fresh closures/props are always used.
- Returns `{ healthy }` — `false` means "rely on your polling fallback"; `true`
  means pokes flow and polls may be stretched. `healthy` flips false the instant
  `es.onerror` fires (`L71-73`).
- Same-origin via the Vite proxy → httpOnly session cookie flows automatically;
  no tokens.

### Canonical consumer patterns (copy these)
- **Search Builder live sync** — `src/features/searchBuilder/SearchBuilderTab.jsx:1036-1038`:
  ```js
  const { healthy:rtHealthy }=useRealtime({
    "search.updated":(ev)=>{ if(ev&&ev.metaLabProjectId===projectId) pullRemote(); },
  });
  ```
  `pullRemote()` refetches the authorized document and adopts it only when newer
  AND the user is not mid-edit (never clobber an open editor / unsaved chip).
- Workspace: `src/frontend/workspace/Workspace.jsx:292,442` (`project.updated`,
  `decision.saved`, `status.changed`, `handoff.updated`).
- SiftProject: `src/frontend/screening/pages/SiftProject.jsx:159` (guards on
  `ev?.projectId === pid`).
- Screening tabs, ConflictsTab, ChatDrawer, usePresence, NotificationsBell,
  overviewTabs all follow the `if (ev.projectId === pid) refetch()` pattern.

Standard guard idiom: `if (!ev || ev.projectId === pid || ev.projectId === undefined) refetch()`.

---

## 5. How to add a "search.run.progress" event type (P1)

The event channel needs NO changes — adding a new `type` is purely additive
("poke, don't payload"). Plan:

### Publish (server)
The Search Builder runs against a META·LAB project (`projectId` param = the
META·LAB project id; `SEARCH_MODULE = 'search'`, `searchEngineController.js:26`).
Use the META·LAB emit helper to reach the workspace + linked-workspace members:

```js
import { emitToMetaLabProject } from '../realtime/bus.js';
// inside the search-run worker, on each progress tick / completion:
emitToMetaLabProject(
  metaLabProjectId, ownerUserId,
  { type: 'search.run.progress', runId, stage, dbKey, fetched, total },
  { exclude: actingUserId } // optional
);
```
- `ownerUserId` is available from `resolveProjectAccess(...).ownerId`
  (`workflowState.js:58-67`) without re-resolving — pass it straight through.
- Keep the payload to IDENTIFIERS + tiny progress scalars only (no records, no
  titles) to honor the poke discipline and blind-mode safety.
- Fire-and-forget: never `await`, never let it throw inside the worker.
- Throttle emits (e.g. coalesce to ≤1/sec) — the registry write loop is cheap but
  the bus has NO built-in rate limiting.

### Subscribe (frontend)
```js
const { healthy } = useRealtime({
  'search.run.progress': ev => { if (ev.metaLabProjectId === projectId) refetchRunStatus(); },
});
```
Mirror `SearchBuilderTab`'s `pullRemote` guard semantics (match on
`metaLabProjectId`, don't clobber local edits).

---

## 6. Reload-safe state reconstruction (DO NOT rely on the stream)

The stream is ephemeral and lossy (missed while offline; split across cluster
nodes). The codebase has TWO proven reload-reconstruction patterns; P1 should
follow the **durable-job** one for a long-running search run:

### Pattern A — durable background job + REST poll + completion poke (USE THIS)
This is exactly what async screening import does and is the cleanest template for
a search run:
- **DB job row** is the single source of truth. Worker:
  `server/services/screeningImportWorker.js` (`processJob` `L63`, `patch(jobId,…)`
  updates `stage`/`processedRecords`/… as it runs; emits the poke at completion
  `L100`).
- **Create**: `POST .../import/start` → returns `202 { jobId, status }`
  (`screeningController.js:1010,1040,1072`).
- **Status endpoint (reload reconstruction)**: `GET /projects/:pid/import/jobs/:jobId`
  → `getImportJob` (`screeningController.js:1079-1105`). Re-checks access via
  `getProjectAccess`, reads the job row, returns a SHAPED, content-free status:
  `{ id, status, stage, totalRecords, processedRecords, importedRecords,
  duplicateRecords, rejectedRecords, warningCount, error, batchId, createdAt,
  startedAt, completedAt, progress }` where `progress` is a computed 0-100
  (`L1097-1099`).
- **Client**: `screeningApi.startImport` / `screeningApi.getImportJob`
  (`src/frontend/screening/api-client/screeningApi.js:57-63`). UI in
  `src/frontend/screening/pages/SiftImport.jsx:150-181` polls ~1s until terminal
  (`completed | completed_with_warnings | failed`), driving a progress UI — and
  because status is a plain GET keyed by `jobId`, a page reload re-reads the live
  job from the server. The SSE `import.completed` poke is an OPTIMISATION layer on
  top (so OTHER sessions refresh); correctness never depends on it.

P1 search run: add a `SearchRun` (or similar) table with `stage`,
`fetchedCount`, `totalCount`, `perDbStatus`, `error`, timestamps; a
`POST .../search/run` → `202 {runId}`; a `GET .../search/runs/:runId` status
endpoint shaped like `getImportJob`; emit `search.run.progress` pokes; client
polls the status endpoint (and stretches polling when `useRealtime().healthy`).

### Pattern B — server-backed module state with optimistic revision
For the persisted search STRATEGY/document (not the run), the Search Builder
already uses `WorkflowModuleState` keyed by `(projectId, moduleKey='search')`:
- `server/services/workflowState.js` — `patchModuleState` (shallow CAS merge on
  `revision`, 409 on stale; `MODULE_KEYS` whitelist `L26`, `getModuleState`,
  `resolveProjectAccess` `L58`). Gated by flag `serverBackedWorkflowState`
  (default OFF → 404).
- `searchEngineController.js:118` `getModuleState(...,'search')` on load;
  `:163-181` `patchModuleState(...)` on save then `emitToMetaLabProject(...,
  { type:'search.updated', revision })`.
- Note: `'search'` is read/written by the searchEngine controller but is NOT in
  `workflowState.js` `MODULE_KEYS` (that whitelist gates the generic
  `/api/.../modules/:key/state` route; the searchEngine has its own
  `/api/search-builder/*` endpoints). If P1 stores run metadata via module state,
  decide explicitly whether to add a key or use a dedicated table (a dedicated
  job table is recommended for run progress — Pattern A).

---

## 7. Integration seams (exact)

1. **Emit seam**: `import { emitToProjectMembers | emitToMetaLabProject } from
   '../realtime/bus.js'` inside the P1 search-run service/worker. No bus change
   needed — just call with a new `type`. (META·LAB variant preferred since the
   Search Builder is META·LAB-project scoped.)
2. **Subscribe seam**: add a `'search.run.progress'` key to a `useRealtime({…})`
   call in the P1 search UI component (alongside / mirroring
   `SearchBuilderTab.jsx:1036`). Guard on `ev.metaLabProjectId === projectId`.
3. **Reload seam (authoritative)**: a new REST status endpoint (shaped like
   `getImportJob`, `screeningController.js:1079`) backed by a durable run row;
   client polls it and reconstructs full progress on reload, independent of SSE.
4. **Auth seam**: none on the stream itself (identity-only via cookie). All
   authorization happens in the new status/run REST endpoints via the existing
   access resolvers (`getProjectAccess` for ScreenProject; `resolveProjectAccess`
   / `getMetaLabMemberAccess` for META·LAB projects).

---

## 8. Risks / gotchas

- **Never put data on the stream.** Pokes carry IDs + tiny scalars only; the UI
  must refetch through an authorized endpoint. Required for blind-mode safety and
  because the stream is lossy.
- **Stream is best-effort & ephemeral.** Missed-while-offline, server-restart, and
  multi-process clustering all drop pokes. Correctness MUST live in a DB row +
  REST status poll (Pattern A). Treat SSE purely as a latency optimisation that
  lets you stretch the poll interval when `healthy`.
- **Single-process / SQLite clustering limit** (`bus.js:19-22`): in-memory
  registry won't fan out across processes without a broker. Don't design P1
  progress to assume cross-instance delivery.
- **`useRealtime` fixes the set of event TYPES at mount** — you cannot add/remove
  a `type` per render (mount-once effect, `useRealtime.js:137-139`). Declare
  `'search.run.progress'` statically; vary behavior inside the handler via the ref.
- **Default `message` frames.** New events go out as unnamed `data:` frames
  consumed by `es.onmessage`/`dispatch`. Do NOT use a named `event:` line (only
  `session.revoked` does) — `useRealtime` only listens to `onmessage`.
- **Recipients resolved at emit time** from member rows + owner. For a META·LAB
  search run, pass the correct `ownerUserId` (link invariant) or non-owner
  collaborators won't receive — get it from `resolveProjectAccess(...).ownerId`.
- **Throttle/coalesce progress emits** — the bus has no rate limiting; a tight
  per-record emit loop would spam every member's socket. Emit on stage changes or
  ≤1/sec.
- **`exclude` the actor** when their own UI already reflects the change (matches
  every existing emit call site).
- **Heartbeat / proxy buffering**: the endpoint already sets `X-Accel-Buffering:
  no` and a 25s `:hb`. If P1 adds an nginx location, ensure proxy buffering stays
  off for `/api/events` (see `docs/manager/realtime-architecture.md`).
- **The `'search'` module key is special-cased** outside `workflowState.js`
  `MODULE_KEYS`; don't assume the generic module-state route serves it. Prefer a
  dedicated run table for progress.

---

## 9. File index (quick reference)

- `server/routes/events.js` — `GET /api/events` SSE endpoint (`L25`).
- `server/realtime/bus.js` — registry + `emitToUsers`/`emitToProjectMembers`/
  `emitToMetaLabProject`/`forceCloseStreams` (`L29-149`).
- `server/index.js:269` — mount; `:177` maintenance-exempt.
- `server/middleware/auth.js:61` — `requireAuth` (cookie identity).
- `src/frontend/hooks/useRealtime.js:102` — `useRealtime`.
- `server/searchEngine/searchEngineController.js:26,118,163-181` — Search Builder
  load/save + `search.updated` emit (closest existing precedent).
- `src/features/searchBuilder/SearchBuilderTab.jsx:1036` — Search Builder consumer.
- `server/services/screeningImportWorker.js:63-106` — durable async worker +
  `import.completed` poke (`L100`).
- `server/controllers/screeningController.js:1010-1105` — start (202 `{jobId}`) +
  `getImportJob` status endpoint (reload reconstruction template).
- `src/frontend/screening/pages/SiftImport.jsx:150-181` &
  `src/frontend/screening/api-client/screeningApi.js:57-63` — client poll loop.
- `server/services/workflowState.js` — server-backed module state (revision CAS).
- `docs/manager/realtime-architecture.md` — architecture of record.
