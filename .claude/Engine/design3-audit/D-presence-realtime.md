# design3 audit — D: Online project-member PRESENCE + realtime

Read-only audit. Goal: a reusable, project-scoped "online members" component on every Stitch
project page, reusing the legacy presence backend with ZERO data duplication.

VERDICT (one line): **REUSE the hook (`useProjectPresence`) + REUSE the legacy
`PresenceIndicator` component embedded in a Stitch shell.** Both are standalone, monolith-free,
and already used outside the monolith (SiftProject). No new endpoint, no new state needed. The
ONLY missing wiring on the Stitch side is: (a) resolve the linked ScreenProject id, (b) pass
`myUserId` from `useAuth`, (c) own-or-listen heartbeat decision. Detail below.

---

## 1. EXACT presence data source

There is a **dedicated presence REST surface** (not derived from chat, not pure SSE). Presence
is **ephemeral, in-memory, project-scoped**; SSE only carries thin "something changed" pokes that
trigger a refetch.

### Server state (no DB model)
`server/realtime/presence.js` — in-memory `Map<projectId, { users: Map, locks: Map }>`.
- `ACTIVE_MS = 75_000` — a user is "present" if their last heartbeat was within 75s.
- `LOCK_TTL_MS = 75_000` — a field lock auto-expires 75s after its last heartbeat.
- `prune(r, now)` drops stale users + locks on every read/write (staleness handled server-side;
  hard tab/browser close is covered by TTL alone — `leave` is best-effort).
- Scope key = **the ScreenProject id** (the collaborative workspace that owns membership +
  access control + SSE routing). NOT the META·LAB Project id (see §4).
- `snapshot(projectId, now)` returns:
  ```js
  {
    users: [ { userId, name, location|null, lastBeat } ],   // lastBeat = ms epoch
    locks: [ { field, userId, name, lockedAt } ]
  }
  ```
  `name` is a real display name (resolved from DB, never the email — `displayName()` chain:
  name → email local-part → email → "A teammate"). There is **no avatar URL** — the legacy UI
  derives avatars from `name` via the `<Avatar>` initials component (no image field exists).

### REST endpoints (client base `/api/screening`, see `screeningApi.js:81-85`)
| Method | Path | Returns | Notes |
|---|---|---|---|
| GET  | `/projects/:pid/presence`            | snapshot `{users, locks}` | `screeningApi.getPresence(pid)` |
| POST | `/projects/:pid/presence/heartbeat`  | snapshot `{users, locks}` | body `{ location }`; `presenceHeartbeat(pid, body)` |
| POST | `/projects/:pid/presence/leave`      | `{ ok:true }`             | `presenceLeave(pid)`; fired on tab-hide/unmount |
| POST | `/projects/:pid/locks/acquire`       | `{ ok, lock, changed }` (200) / 409 | field locking |
| POST | `/projects/:pid/locks/release`       | `{ ok:true }`             | |

`:pid` here is the **ScreenProject id**. Controller `server/controllers/presenceController.js`.
The heartbeat is the source of "who is online": calling it both **records you** and **returns the
full current snapshot** (including yourself), so a single component can heartbeat + render in one
round-trip.

There is ALSO a global, non-project ping: `POST /api/presence/ping` (`useGlobalPresence.js` →
`presenceController.globalPing`) writing the `__global__` room, used only by the Ops console
("online now" across the app). **NOT relevant** to project-scoped presence — do not use it for the
Stitch project page.

---

## 2. Realtime event types that signal join/leave

SSE channel: `GET /api/events` (`server/routes/events.js`), ONE EventSource per tab, identity-only
(userId from session cookie). Frames are pokes: `{ type, projectId?, metaLabProjectId?, at }`.

Presence-relevant types emitted by `presenceController` via
`emitToProjectMembers(pid, { type }, { exclude: req.user.id })`:
- **`presence.changed`** — emitted on heartbeat when `changed` is true (join, location change, or a
  prune removed/added someone) and on `leave`. The actor is EXCLUDED (their own UI already knows).
- **`lock.changed`** — emitted on `acquireLock` (first acquire) and `releaseLock`.

Both are CONTENT-FREE pokes (blind-mode safe by design). The client **must refetch**
`GET /presence` on receipt — never trust the event as data. `bus.js:emitToProjectMembers` resolves
recipients from the DB at emit time (active members + owner, minus `exclude`), so a just-removed
member silently stops receiving.

Important nuance (`usePresence.js:78`): the server only pokes OTHER members on heartbeat, so a
listen-only client must additionally poll (`useProjectPresence` already does this — see §5).

---

## 3. How legacy `PresenceIndicator` renders

`src/frontend/screening/components/PresenceIndicator.jsx` — standalone (only imports `react`,
`react-dom`, `../ui/theme.js` C/FONT/MONO/alpha, and `../ui/components.jsx` `Avatar`). **No
monolith dependency.**

Props: `{ users = [], locks = [], totalMembers, myUserId }`.
- Renders a green pill chip: dot + `active` count + ` / totalMembers` (e.g. `3 / 7`).
  `active = users.length`. **Returns `null` when `active === 0`** (nothing until presence flows).
- Hover/click opens a **portaled** popover (into `document.body`, z-index 10000, viewport collision
  clamping) — never clipped by overflow/transform ancestors. Bridge-safe hover (160ms close delay
  to cross the 6px gap), closes on Escape / outside-click, full keyboard + ARIA (`role="dialog"`,
  focus management).
- Each row: `<Avatar name={u.name} size={22}>` (initials, no image) + name (`(you)` suffix when
  `u.userId === myUserId`) + a secondary line that is **`editing <fieldLabel>`** if the user holds a
  lock, else `u.location` (e.g. "Screening · Title & Abstract"), else "In project". Field labels are
  humanized via a `FIELD_LABELS` map + camelCase fallback.
- **Staleness**: not handled in the component — the SERVER prunes (>75s) before every snapshot, so
  `users` is already fresh. Every user shown gets a green "Active" dot.
- **Reconnect**: not the component's concern — `useRealtime` owns reconnection (§5); the component
  is pure render of `users`/`locks`.

Avatar styling: legacy `Avatar` uses legacy `--t-*` tokens, which the Stitch token layer
(`stitchTokens.js`) already remaps — so embedding it harmonizes. There is also a native
`StitchAvatar` primitive (used in StitchProjectOverview member roster) if a fully-native chip is
preferred.

---

## 4. Permission / privacy scoping + project-id mapping

- Every project presence route is gated by `gate()` in `presenceController.js:18`, which calls
  `getProjectAccess(req.params.pid, req.user)` and requires `access.isOwner || access.active`.
  404 if no access, 403 if not owner/active member. **Presence is visible only to members of that
  one project** — nobody learns activity in projects they cannot access.
- **ID mapping is the critical detail.** `:pid` is the **ScreenProject id**, NOT the META·LAB
  Project (`/app/project/:projectId`) id. To map:
  - `linkedSiftId(project)` (`workspace/projectHelpers.js:380`) =
    `project._linkedMetaSift?.id || project._screenProjectId || null`.
  - If null (project has no screening workspace yet), resolve via
    `screeningApi.getWorkspace(metaLabProjectId)` → `{ screenProjectId, created, repaired }`
    (`screeningApi.js:142` = `GET /api/screening/metalab/:mlpid/workspace`). The monolith does this
    OWNER-ONLY and best-effort (`Workspace.jsx:496-506`): `const spId = linkedSp || resolvedSpId`.
    A member always already has a link (membership implies a workspace); a non-owner with no link
    leaves presence simply OFF rather than erroring.
  - `totalMembers` comes from `project._memberCount` in the monolith; on Stitch use the already-
    loaded `members.length` (StitchProjectOverview already fetches `screeningApi.listMembers(linkedId)`).

So: the Stitch presence room id = `linkedSiftId(project)` (fallback `getWorkspace().screenProjectId`).

---

## 5. The EXACT hooks/api a `StitchProjectPresence` component should call

The hook **`useProjectPresence(pid, location, { enabled, heartbeat })`**
(`src/frontend/screening/hooks/usePresence.js:17`) is the complete, reusable engine. It is
monolith-free (imports only `react`, `useRealtime`, `screeningApi`) and already used by both
SiftProject and the monolith header — **REUSE IT VERBATIM.**

What it gives you:
- `{ users, locks, refetch }`.
- Heartbeats on mount + every 30s (`HEARTBEAT_MS`), immediate beat on `location` change, and on
  visibility change (hide → `presenceLeave`, show → beat). Releases (`presenceLeave`) on unmount.
- Subscribes to `presence.changed` + `lock.changed` via `useRealtime` and refetches the snapshot.
- `heartbeat:false` = **listen-only** mode (still loads the snapshot + polls every 15s, but never
  writes) — for pages where another component already owns the precise heartbeat.

Recommended `StitchProjectPresence` (drop-in, ~15 lines):
```jsx
import { useProjectPresence } from '../../screening/hooks/usePresence.js';
import PresenceIndicator from '../../screening/components/PresenceIndicator.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

function StitchProjectPresence({ spId, location, totalMembers, heartbeat = true }) {
  const { user } = useAuth();                       // myUserId source
  const { users, locks } = useProjectPresence(
    spId, location, { enabled: !!spId, heartbeat }  // enabled gates everything when no link
  );
  if (!spId) return null;
  return <PresenceIndicator users={users} locks={locks}
                            totalMembers={totalMembers} myUserId={user?.id} />;
}
```
Wiring on each Stitch page:
- `spId` = `linkedSiftId(project)` (resolve via `getWorkspace` like Workspace.jsx:496-506 if null).
- `location` = the page's user-facing name (e.g. the workflow stage label — Stitch already has
  `STAGE_LABEL`/`STEP_LABELS_SHORT`). Keep it short (server clips to 80 chars).
- `totalMembers` = `members.length` (already loaded in StitchProjectOverview) or `project._memberCount`.
- `myUserId` = `useAuth().user.id` — **StitchProjectOverview does NOT currently import `useAuth`;
  add it.** Without `myUserId` the "(you)" suffix is wrong but presence still works.
- **heartbeat ownership** (avoids double-beat overwriting a precise location): exactly ONE mounted
  component per tab per room should `heartbeat:true`. On a Stitch native page that IS the page,
  use `heartbeat:true`. On the Screening stage where SiftProject is embedded, the Stitch chrome
  must run `heartbeat:false` (listen-only) — mirror Workspace.jsx:509 `heartbeat: tab !== "screening"`.

Reconnect safety: fully handled by the shared `useRealtime` connection manager
(`src/frontend/hooks/useRealtime.js`) — one EventSource per tab, native CONNECTING retry + manual
capped backoff (1s→30s) on CLOSED, `healthy` flag, ref-based fresh handlers. The 15s/30s polls in
`useProjectPresence` are the correctness fallback when SSE is unhealthy, so presence is never stale
even across reconnects/restarts.

---

## Fragility / improvement notes (no behavior change required)

1. **Single-process only.** `presence.js` + `bus.js` are in-memory (no Redis). Multiple Node
   processes would split rooms; cross-instance SSE would need a broker. Polling fallback keeps it
   correct but cross-instance presence would be partial. Documented limitation; not a Stitch
   concern.
2. **No avatar image field** anywhere — initials only. If Stitch wants photo avatars later, that is
   a new field on User, out of scope.
3. **Double-heartbeat hazard** is real: two mounted `heartbeat:true` instances for the same room
   fight over `location`. Enforce single-owner per tab (see §5). The existing listen-only pattern
   already solves the Screening case.
4. **`getWorkspace` is owner-creating.** It may CREATE/repair a workspace as a side effect. For a
   non-owner with no link this 403/404s harmlessly (presence stays off). Match Workspace.jsx's
   owner-only + best-effort guard; do not call it eagerly for shared/member projects without a link.
5. No security gap found: presence read/write is access-gated, events are content-free, recipients
   resolved live from the DB.

---

## Key file:line references
- `src/frontend/screening/hooks/usePresence.js:17` — `useProjectPresence` (REUSE)
- `src/frontend/screening/hooks/usePresence.js:100/162` — `useFieldLock` / `useFieldEditing`
- `src/frontend/screening/components/PresenceIndicator.jsx:38` — `PresenceIndicator({users,locks,totalMembers,myUserId})` (REUSE)
- `src/frontend/hooks/useRealtime.js:102` — `useRealtime(handlers)` shared SSE manager
- `src/frontend/screening/api-client/screeningApi.js:81-85,142` — presence/lock/getWorkspace methods
- `src/frontend/workspace/projectHelpers.js:380` — `linkedSiftId(project)`
- `src/frontend/workspace/Workspace.jsx:488-510,1363` — canonical wiring (spId resolve + listen-only)
- `src/frontend/stitch/pages/StitchProjectOverview.jsx:121-126,151` — already loads linkedId+members; NO presence/useAuth yet
- `server/controllers/presenceController.js:18,71,99,109` — gate + heartbeat/list/acquire
- `server/realtime/presence.js:19-20,58,77,91` — ACTIVE_MS/TTL, snapshot, heartbeat, leave
- `server/realtime/bus.js:99` — `emitToProjectMembers` (recipients = active members + owner − actor)
- `server/routes/events.js:25` — `GET /api/events` SSE (retry:5000, :hb every 25s)
