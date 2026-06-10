# META·LAB / META·SIFT — Realtime Architecture (prompt6 Task 7)

Status: implemented · Owner: Collaboration & Realtime agent · Date: 2026-06-10

## 1. Transport: SSE + polling fallback (WebSocket rejected)

All client→server traffic in this product is already REST with httpOnly cookie
auth (`credentials:'include'` everywhere; no Authorization headers exist in the
frontend). Realtime here is purely **server→client push**, so WebSocket's
bidirectionality buys nothing and would cost: a new dependency (`ws`/socket.io),
an upgrade-handshake path through the Vite proxy (`ws:true` plus its Windows
quirks), and a second authentication path. **Server-Sent Events** ride a plain
HTTP GET: the browser's `EventSource` is same-origin through the Vite proxy
(`/api` → `http://127.0.0.1:3001`), so the `metalab_session` cookie flows
automatically even with `sameSite:'strict'`, and the existing `requireAuth`
middleware works unchanged.

Polling is the fallback, not an afterthought: chat (4s), the notifications bell
(30s), and the load-on-navigation patterns all pre-date SSE and keep working
verbatim when the stream is down. SSE only makes them *faster* and lets them
*stretch* their cadence while healthy.

- **Endpoint**: `GET /api/events` — own router (`server/routes/events.js`),
  mounted in `server/index.js` between the `/api/screening` mount and the 404
  fallback, behind `requireAuth` ONLY. **Never** under `/api/auth` (20 req/15min
  prod) or `/api/admin` (60 req/15min): a reconnecting EventSource would burn
  those limiters and lock the user out of auth/console.
- **Response**: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`; `res.flushHeaders()`; then
  a `retry: 5000` hint and a `:connected` comment frame.
- **No compression middleware exists in this server** (verified: no
  `compression` import in `server/index.js` and no compression package in
  either `package.json`), so `res.write()` frames flush immediately — no
  `res.flush()` shim needed. If compression is ever added, the events route
  must be excluded or frames will buffer.

## 2. Bus design (`server/realtime/bus.js`)

In-process registry: `Map<userId, Set<res>>`.

- `register(userId, res)` / `unregister(userId, res)` — called by the events
  route on connect / `req.on('close')` (which also clears the heartbeat
  interval).
- `emitToUsers(userIds, event)` — direct, user-targeted delivery
  (`permissions.changed`, `notification.created`).
- `emitToProjectMembers(projectId, event, {exclude})` — resolves recipients **at
  emit time** from the DB: `ScreenProjectMember` rows with `status:'active'` and
  a non-null `userId`, plus `ScreenProject.ownerId`. A just-removed or
  deactivated member silently stops receiving — there is no registry ACL to
  invalidate. `exclude` drops the acting user (their own UI already reflects
  the change).
- `emitToMetaLabProject(metaLabProjectId, ownerUserId, event, {exclude})` — the
  META·LAB-side variant: resolves the linked ScreenProject(s) by
  `linkedMetaLabProjectId` (filtered by `ownerId === ownerUserId` to honor the
  link invariant — a foreign workspace that somehow linked someone else's
  project never receives pokes), then emits to each workspace's active members
  + owner. Unlinked projects poke the owner only. Emitted events carry **both**
  `metaLabProjectId` (so the monolith can match) and `projectId` (the linked
  ScreenProject id, so an open SiftProject refreshes e.g. a synced title).

**Every emit is fire-and-forget and error-swallowed** — the async work is
wrapped internally and `.catch(()=>{})`-ed; an emit failure can never fail or
slow the request that triggered it. Emits short-circuit when zero streams are
open (no DB query at all).

**One global stream per browser tab.** Browsers cap ~6 concurrent HTTP/1.1
connections per origin; per-project or per-component streams would exhaust that
instantly. The client hook (`useRealtime`) enforces this with a module-level
shared EventSource and reference counting.

## 3. Event catalog

Wire format: unnamed SSE `data:` frames containing one JSON object. Events are
**pokes**: `{ type, projectId?, metaLabProjectId?, at }` — never content, never
actor identity.

| Type | Extra fields | Emitted from | Recipients |
|---|---|---|---|
| `project.updated` | `projectId` (SIFT) | `screeningController.updateProject` (any settings save), `linkMetaLab` (link/unlink) | active members + owner of the ScreenProject, minus actor |
| `project.updated` | `metaLabProjectId` + `projectId` (linked SP) | `projectsController.updateProject` (owner + member paths), `autosaveProject` (owner + member paths), `screeningReviewController.handoffToMetaLab` (study appended to the ML blob), SIFT→ML title sync in `screeningController.updateProject` | linked-workspace active members + owner (owner only when unlinked), minus actor |
| `members.changed` | `projectId` | `screeningMemberController.addMember` / `updateMember` / `removeMember` | members + owner, minus actor (a removed member is already excluded by emit-time resolution) |
| `permissions.changed` | `projectId` | `updateMember` (any field change) and `removeMember` | **user-targeted**: only the affected `userId` |
| `decision.saved` | `projectId` | `screeningController.saveDecision`, `resolveConflict` | members + owner, minus actor — **no actor identity in the event** (blind-mode safe by construction) |
| `chat.message` | `projectId` | `screeningChatController.postMessage` | members + owner, minus sender; content NEVER rides the event — clients fetch `listChat(?since)` |
| `status.changed` | `projectId` | `screeningController.updateProject` and `screeningAdminController.updateScreeningProjectStatus` — only on a REAL `progressStatus` transition | members + owner, minus actor |
| `handoff.updated` | `projectId` | `screeningReviewController.finalizeRecord` (accept + reject), `retryHandoff` | members + owner, minus actor |
| `notification.created` | — | `notificationService.createNotification` success path (covers invites, role changes, and the claim-on-register hook) | the notification's `userId` only |

Hook placement convention: each emit is one line next to the existing
`writeAudit` call (or the obvious mutation point) in the controller that
performs the write.

## 4. Security model

1. **Poke, don't payload.** Events carry no titles, no text, no decisions, no
   names. A fan-out bug can therefore leak *that something changed in a project
   you were a member of*, never *what*. Every actual read goes through the
   existing REST endpoints, which re-resolve access per request
   (`getProjectAccess` / `getMetaLabMemberAccess` — there is no permission
   cache server-side).
2. **Emit-time membership resolution.** Recipients are computed from active
   member rows at the moment of the emit; removing/deactivating a member
   instantly stops their pokes, and the targeted `permissions.changed` poke
   makes their open UI revalidate (the refetch 403s/404s → "Your access to this
   project changed" → navigate to the dashboard).
3. **Blind-mode safety by construction.** `decision.saved` carries no reviewer
   identity at all — cheaper than per-emit blindMode checks and immune to
   mistakes. What a recipient then sees comes from `listRecords` /
   `listSecondReview`, which already anonymize under blind mode.
4. **Identity-only stream.** The JWT role inside `requireAuth` is stale by
   design; the stream uses it only to know *who* the connection belongs to.
   Authorization always happens at refetch time.
5. The notification stream is per-user (`emitToUsers([n.userId])`) — same
   isolation as the `/api/notifications` queries (`where { userId }`).

## 5. Delivered semantics — the honest statement

"All text updates live" **cannot** be literally delivered for META·LAB's
PICO/extraction content without OT/CRDT: persistence there is one debounced
800ms PUT of the **entire project JSON** (last-write-wins per project). A naive
refetch-on-event would clobber in-flight local edits, and an applied remote
blob followed by a local autosave would silently destroy the other user's work.

Delivered semantics, by surface:

- **META·SIFT (row-level writes: decisions, chat, members, settings, status,
  handoff)** — genuinely live. Pokes trigger refetches of authorized endpoints;
  there is no blob conflict because every write is fine-grained.
- **META·LAB (whole-blob)** — *fresh-on-clean + conflict banner when dirty*:
  - Clean (no pending/debounced/in-flight save — `hasPendingSave()` in
    `serverStorage.js`, which now also covers the in-flight window):
    `project.updated` for a loaded project triggers a silent refetch through
    `window.storage.get` (the normal authorized load path). The dirty check is
    re-run **after** the fetch returns, so edits that began mid-fetch are never
    overwritten.
  - Dirty: NO refetch. If the changed project is the **active** one, a banner
    appears — "Updated by a collaborator — refresh to see changes" — with a
    Refresh action that first `flushStorage()`s the local edits (last-write-wins,
    by design) and then refetches. Dismissable.
  - Project-list level: `members.changed` / `permissions.changed` pokes refetch
    the list (when clean) so `_role/_readOnly/_linkedMetaSift` annotations stay
    fresh.

True concurrent text co-editing (Google-Docs style) requires OT/CRDT and is
explicitly **out of scope** this round; this is the recommended next step if
simultaneous PICO editing becomes a real workflow.

## 6. Client: `src/frontend/hooks/useRealtime.js`

- Module-level singleton `EventSource('/api/events')` with reference counting —
  first mounted subscriber opens it, last unmount closes it. One stream per tab
  no matter how many components subscribe (bell + chat + project shell +
  monolith).
- Subscribers register **per event type**: `useRealtime({ 'chat.message': fn })`.
  The set of types is fixed at mount; handler functions are read through a ref
  on every event, so fresh props/state closures are always used.
- Returns `{ healthy }`. `healthy` flips false on the first `onerror` and true
  again on `onopen`.
- **Reconnect**: native EventSource retry (server sends `retry: 5000`) while
  the browser keeps trying; when it gives up (readyState CLOSED — e.g. 401
  after logout, server restart edge cases) the hook reopens manually with
  capped exponential backoff (1s → 2s → … → 30s max).
- **Fallback**: the fallback *is the polling that already exists*. Wire-up:

| Surface | Healthy (SSE up) | Unhealthy (SSE down) |
|---|---|---|
| ChatLauncher | `chat.message` poke → immediate `listChat(?since)`; background poll stretched to ~30s **while the drawer is closed** (kept at 4s while open so in-memory typing indicators — polling-only — stay live) | original 4s poll |
| NotificationsBell | `notification.created` → immediate unread-count refresh (+ list reload if the panel is open); poll stretched to ~120s | original 30s poll |
| SiftProject | `project.updated` / `members.changed` / `status.changed` / `handoff.updated` for the open pid → `refreshProject()`; `permissions.changed` → revalidate, on 403/404 show "Your access to this project changed" and navigate to the dashboard | manual navigation/refresh, as before prompt6 |
| Monolith (`meta-lab-3-patched.jsx`) | `project.updated` (by `metaLabProjectId`) → refetch-when-clean / banner-when-dirty; `members.changed`/`permissions.changed` → list refetch when clean | as before prompt6 (fresh on load) |

All polls keep their `document.hidden` pause.

## 7. Heartbeat, proxy & deployment notes

- **Heartbeat**: comment frame `:hb` every **25s** — keeps idle proxies and the
  TCP socket alive, and surfaces dead clients to Node so `close` fires and the
  registry stays clean.
- **Dev (Vite)**: the `/api` proxy (http-proxy) streams responses; no special
  config needed. Target stays `127.0.0.1:3001` (NOT `localhost` — Windows +
  Node 20 resolves `localhost` → `::1` first and hangs).
- **Production reverse proxy** (add to deployment-readiness checklist):
  - nginx: `proxy_buffering off` for `/api/events` (the route also sends
    `X-Accel-Buffering: no`, which nginx honors per-response), `proxy_read_timeout`
    ≥ 60s (heartbeat every 25s keeps it from idling out), HTTP/1.1 with
    `proxy_set_header Connection ''` to allow keep-alive streaming.
  - Do NOT route `/api/events` through anything that buffers or compresses
    full responses.
- **Express/Node**: `requestLogger` only logs on `finish` — harmless for a
  long-lived stream. No server-side response timeout is configured (Node
  default), so streams live until the client disconnects.
- **Rate limiters**: untouched; the events route lives on its own mount.

## 8. Clustering limitation

The bus is **process memory**. This deployment is a single Node process on
SQLite, so that's exactly right today. Running N processes (pm2 cluster,
multiple containers) would split the registry: a user connected to process A
never hears emits that happen on process B. Scaling realtime horizontally
requires a broker (Redis pub/sub or similar) between emit and fan-out — noted
as a future step, NOT built now. The polling fallback keeps every feature
*correct* (just slower) even in a misconfigured multi-process deployment, and
the same limitation already applies to the in-memory chat typing indicators.

## 9. Manual test recipe (two browsers)

Setup: `node server/index.js` + `npx vite` · browser A = owner (e.g. Chrome),
browser B = member (e.g. Edge/incognito), both logged in, both members of one
linked workspace.

1. **Handshake**: in either browser's DevTools → Network → `events` — request
   shows `text/event-stream`, stays pending (that's correct), `:connected` then
   `:hb` frames appear in the EventStream/Response tab every ~25s.
2. **Chat**: A and B open the same SIFT project chat. A sends a message → it
   appears in B within ~1s (poke), not the old 4s.
3. **Decisions (and blind mode)**: B screens a record → A's open Screening tab
   refreshes counts after the poke-driven refetch; with blind mode ON, verify
   the SSE frame in DevTools shows ONLY `{type:'decision.saved', projectId, at}`
   — no reviewer identity.
4. **Status**: A flips progressStatus Done ↔ In progress in Project Control →
   B's header badge updates without refresh.
5. **Permissions**: A demotes B to viewer (or removes B) while B has the
   project open → B's page revalidates; if access is gone B sees "Your access
   to this project changed" and lands on the dashboard.
6. **Notifications**: A adds user C to a project while C has any app surface
   open → C's bell badge increments within ~1s.
7. **META·LAB clean refetch**: A and B open the same linked META·LAB project
   (B idle, no edits). A edits PICO and waits ~1s (autosave) → B's view updates
   silently.
8. **META·LAB conflict banner**: B types into a PICO field (do not wait), A
   saves a change → B sees the "Updated by a collaborator" banner and B's local
   text is NOT overwritten. Click Refresh → B's edits flush first, then the
   merged state loads.
9. **Fallback**: kill the API server → both browsers' `healthy` drops (pokes
   stop, EventSource errors in console are expected); chat keeps working off
   the 4s poll once the server is back; the stream reconnects automatically
   (≤30s backoff) without a page refresh.
10. **Scope leak assertion**: log in as a user who is NOT a member of the
    project; open DevTools on `/api/events`; have A generate chat/decision/
    status events in that project → ZERO frames must arrive on the outsider's
    stream (only `:hb`).
