# prompt25 — Final Report (v3.7.0)

*META·LAB internal — summary of all Tasks 1–8 plus cross-cutting fixes. Date: 2026-06-15.*

Build green. Unit suite: **725 pass / 6 pre-existing `serverStorage` timing failures**
(unchanged baseline). `npx vite build` exits 0; the pre-existing AnalysisTab esbuild
JSX warning at ~L4328 is unchanged.

---

## Release summary

Version **3.6.3 → 3.7.0** (minor). Eight tasks: two backend-heavy (ops metrics,
keyboard shortcut persistence), two frontend-only (integrated nav, project import),
two cross-stack fixes (presence names, dynamic owner display), and two
infrastructure fixes (project timestamps, presence name resolution pipeline).

---

## Task inventory

### Task 1+2 — Ops online/offline metrics + country online status

Real-time **"Online now"** and historical **"Active (24 h)"** metrics across the
admin console. Two new API endpoints, four updated endpoints, two new KPI tiles,
a pulsing status column in the users table, online/offline split in the country
table and map tooltip, and a per-user activity panel showing current project and
location.

Full detail: `docs/manager/ops-active-user-metrics.md`

### Task 3 — Presence shows name, not email

**Root cause.** `requireAuth` attaches `{ id, email, role }` to `req.user` — no
`name` field. When presence stored the authenticated user's identity, it wrote
the email address. This surfaced as the email string appearing in the presence
popover, field-lock labels ("you@institution.org is editing"), and the Members
activity panel.

**Fix.** Two-layer resolution in the presence pipeline:

1. `server/realtime/presence.js` — `displayName()` now applies a fallback chain:
   `User.name → email-local-part (before @) → full email → "A teammate"`. This
   protects against any future case where the DB fetch is unavailable.
2. `server/controllers/presenceController.js` — `resolveUser()` fetches the
   user's **live `User.name` from the DB** before every heartbeat and lock event,
   using a ≤60 s in-memory cache per user ID. The cache prevents a DB hit on every
   ~30 s heartbeat while ensuring names propagate within one TTL cycle after an
   account rename.

**Surfaces fixed.** Presence popover member list, field-lock "X is editing" banner,
Members tab activity status — all now show the real display name.

The 5 new tests in `tests/unit/presence.test.js` cover the fallback chain and the
`globalOnlineSnapshot` function added for Tasks 1+2.

### Task 4 — Project timestamp root-cause fix

All of a user's projects showed the same "updated" timestamp after opening any
single project. The fix prevents `store.js` from writing a row to Prisma when
`name` and `data` are byte-for-byte identical to what is already stored,
preserving `@updatedAt` correctly.

Full detail: `docs/manager/project-timestamp-root-cause.md`

### Task 5 — Dynamic owner display name

Owner and member names now resolve from the live `User` record on every request,
across the members panel, ControlTab, SiftDashboard, and AdminConsole. Stale
denormalised name strings are no longer used for display.

Full detail: `docs/manager/dynamic-owner-display-name.md`

### Task 6 — Integrated screening step navigation

The left navigation column in the screening workspace merges the title button and
the non-clickable `StepIndicator` sibling into a single `<button>` per stage.
The full row (icon + title + step count) is now one click/keyboard target with
`aria-current="page"` on the active item.

Full detail: `docs/manager/screening-integrated-step-navigation.md`

### Task 7 — Screening keyboard shortcuts

Per-user configurable keyboard shortcuts for Include / Exclude / Maybe / Undo /
Next / Previous. Server-persisted (`User.screeningShortcuts`), per-user localStorage
cached, with a Profile settings UI that includes key-capture, duplicate detection,
and reset-to-defaults. Safe guards prevent shortcut fires inside text inputs,
select elements, and content-editable regions.

Full detail: `docs/manager/screening-keyboard-shortcuts.md`

### Task 8 — Import project from dashboard

"Import Project" button on the dashboard accepts four JSON shapes produced by
existing META·LAB export flows. Fresh IDs are always assigned; name collisions
are handled automatically. Uses the existing `/api/projects/:id/autosave`
endpoint — no new backend endpoint. Per-user recents localStorage key
(`metalab.recentProjects.<userId>`) was namespaced as part of this task.

Full detail: `docs/manager/project-import-dashboard.md`

---

## File change index

| File | Tasks |
|---|---|
| `server/realtime/presence.js` | 1+2, 3 |
| `server/controllers/adminController.js` | 1+2 |
| `server/controllers/presenceController.js` | 3 |
| `server/routes/admin.js` | 1+2 |
| `server/store.js` | 4 |
| `server/controllers/screeningMemberController.js` | 5 |
| `server/controllers/profileController.js` | 7 |
| `src/frontend/pages/admin/AdminConsole.jsx` | 1+2 |
| `src/frontend/pages/admin/adminApiClient.js` | 1+2 |
| `src/frontend/pages/ProjectLanding.jsx` | 8 |
| `src/frontend/api/apiClient.js` | 8 |
| `src/frontend/screening/pages/SiftProject.jsx` | 5 (SiftDashboard), 6 |
| `src/frontend/screening/screeningShortcuts.js` *(new)* | 7 |
| `src/frontend/screening/hooks/useScreeningShortcuts.js` *(new)* | 7 |
| `src/frontend/pages/Profile.jsx` | 7 |
| `meta-lab-3-patched.jsx` (ControlTab) | 5 |
| `tests/unit/presence.test.js` | 1+2, 3 (+5 new tests) |
| `tests/unit/screeningShortcuts.test.js` *(new)* | 7 (+5 tests) |
| `server/version.json` | version bump |

---

## DB / migration

| Change | Method |
|---|---|
| `User.screeningShortcuts String?` | db-push-safe: nullable column, no `@unique`, additive |

No other schema changes. No new npm dependencies. All other backend changes are
in-memory or controller-level.

---

## Tests

| Suite | Result |
|---|---|
| `tests/unit/presence.test.js` (+5 new: name fallback, global snapshot) | 5/5 pass |
| `tests/unit/screeningShortcuts.test.js` (new, 5 tests) | 5/5 pass |
| Full unit suite | **725 pass / 6 pre-existing failures** (`serverStorage.test.js` network-mock flakiness; unchanged baseline) |
| `npx vite build` | Green; pre-existing AnalysisTab esbuild JSX warning unchanged, build exits 0 |

---

## Version

**3.7.0** (minor; ops online metrics, presence name fix, timestamp root-cause,
dynamic owner name, integrated step nav, keyboard shortcuts, project import).

---

## Known limitations

1. **Presence is in-memory, single-process.** No Redis pub/sub broker. A
   multi-instance deployment would split the in-memory room registry across
   processes, causing each instance to under-count "online now". This is a
   pre-existing architectural caveat shared by chat, pokes, and field locks.

2. **Dashboard-only users are not "online now".** A user browsing the project
   dashboard or profile page without opening a project room emits no heartbeat
   and is therefore counted as offline in the real-time metric, even though
   `lastActive` correctly marks them as active in the 24 h metric.

3. **`lastActive` 24 h granularity is 5 minutes.** The write throttle prevents
   DB write storms but means the "Active 24 h" count can lag by up to 5 minutes.

4. **Presence and member names refresh within the ≤60 s name-cache TTL** after a
   rename. Project `_owner` is live immediately (resolved on every request via
   `annotateShared`).

5. **Project import: no preview or partial-failure rollback.** Projects are written
   immediately after client-side parsing. A failed mid-import (network drop)
   leaves already-written projects in place; there is no auto-rollback. Very large
   backup files are read fully into memory before parsing.

6. **Screening-shortcut prefs: cross-device cache lag.** The per-browser
   localStorage cache (`metalab.screeningShortcuts.<userId>`) may briefly show
   old bindings on a new device until `/api/profile` loads. The lag is typically
   under one second on normal connections.

7. **Import: no deep schema validation.** A valid JSON shape with corrupt field
   values is stored as-is; the project may appear malformed on open.

---

## Recommended next steps

1. **Move presence to a Redis pub/sub broker.** Resolves limitation 1 for
   multi-instance deployments. The SSE + TTL-polling architecture already
   abstracts the transport; the broker would replace the in-memory `Map`.

2. **Add a lightweight global (non-project) heartbeat.** A small periodic ping
   from authenticated pages (dashboard, profile) would let dashboard-only users
   count as "online now", resolving limitation 2.

3. **Lower `lastActive` throttle or add a dedicated online ping.** A shorter
   throttle (e.g. 1 min instead of 5 min) or a separate lightweight "am alive"
   write would improve the precision of the 24 h active-user figure without
   requiring a full presence room.

4. **Import preview/confirm modal with schema validation.** Show the user a
   summary of what will be imported (project names, study counts) and validate
   required fields before writing. Report per-project success/failure so a partial
   failure is clearly attributed.

5. **Cross-device shortcut sync via profile push.** After saving shortcuts, push
   the new config to the server and optionally broadcast to other open sessions
   via SSE, eliminating the localStorage cache lag.

6. **Remove the denormalised `Project.ownerName` column** once all downstream
   consumers (exports, legacy clients) have confirmed they use the live `_owner`
   path. Requires a migration with a safe-window deployment.

---

## Follow-up patch — limitations resolved (v3.7.1)

Shipped right after v3.7.0; resolves recommended next steps 2 (limitation 2) and
the rename-lag (limitation 6).

| Item | Resolution |
|------|------------|
| Limitation 2 — dashboard-only users not "online" | **App-wide global presence heartbeat.** `presence.js` gained `GLOBAL_ROOM`; `globalOnlineSnapshot()` merges it as a fallback (a project room's specific location still wins, but dashboard-only users are added with a route-derived location like "Dashboard"). New `POST /api/presence/ping` (`requireAuth`, not project-gated) → `presenceController.globalPing`. Frontend `useGlobalPresence()` is mounted once in `App.jsx` as `<GlobalPresence/>` and pings every 30 s with a location derived from the route, paused while the tab is hidden. Every signed-in user now shows online with a location. |
| Rename lag (≤60 s name-cache TTL) | `presenceController` exports `invalidateUserName(userId)`; `profileController.updateProfile` calls it whenever the name changes, so a rename shows in presence on the next heartbeat. |

**Still deferred (architectural):** single-process in-memory presence (multi-instance
needs a Redis pub/sub broker, recommended step 1); the 5-min `lastActive` throttle
(the new global heartbeat makes "online now" accurate regardless — this now only
affects the coarse 24 h figure).

**Verification:** `vite build` green; `tests/unit/presence.test.js` 15 pass (+1
global-room fallback test). Version `3.7.0` → `3.7.1`.
