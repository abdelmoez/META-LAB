# Ops — Active User Metrics & Country Online Status (prompt25 Tasks 1+2)

*META·LAB internal — v3.6.3 → 3.7.0. Date: 2026-06-15.*

---

## Purpose

The Ops admin console previously showed only historical "active in last 24h" and
total user counts. This update adds **real-time online/offline** visibility across
all user-facing surfaces: overview KPI tiles, the users table, the user detail
panel, and the country breakdown table and map.

---

## Definitions

| Term | Meaning | Source |
|---|---|---|
| **Online now** | A distinct authenticated user whose most-recent presence heartbeat arrived within `ACTIVE_MS` (~75 s) across **any** project room | `server/realtime/presence.js` in-memory registry — **not** `lastActive` |
| **Active (24 h)** | `User.lastActive` within the last 24 hours | `User.lastActive` DB column, throttled to ≤1 write per 5 min |
| **Offline** | `totalUsers − onlineNow` | Derived |
| **Unauthenticated / public visitors** | Never counted in any metric | — |

**Why two signals instead of one.**
`lastActive` is the coarse historical record: it moves at most once per 5 minutes
and persists across server restarts. Presence heartbeats are fine-grained (~30 s
cadence) but live only in the in-memory registry; they reflect *right now*.
"Online now" therefore uses the presence registry; "Active 24 h" uses `lastActive`.
These are complementary, not redundant.

---

## Backend changes

### `server/realtime/presence.js`

Two new exported functions added to the existing in-memory room registry:

| Function | Signature | Returns |
|---|---|---|
| `globalOnlineSnapshot(now)` | `(now: number) → Map<userId, {userId, name, location, lastBeat, projectId, projectIds}>` | Iterates all rooms; most-recent beat per user wins for current location |
| `globalOnlineCount(now)` | `(now: number) → number` | Distinct user count with a valid beat |

The existing per-room `getPresence()` / `heartbeat()` / `lock()` API is unchanged.

### `server/controllers/adminController.js`

| Endpoint / method | Change |
|---|---|
| `getMetrics` → `GET /api/admin/metrics` | `users` object gains `{ online, offline }` |
| `getUsers` → `GET /api/admin/users` | Each user row gains `isOnline: boolean` |
| `getUserCountries` → `GET /api/admin/users/countries` | Each country entry gains `onlineCount` / `offlineCount`; response gains `summary.{ online, offline }` |
| `getUserActivitySummary` *(new)* → `GET /api/admin/users/activity-summary` | `{ totalUsers, online, offline, percentOnline }` — admin role only |
| `getUserActivity` *(new)* → `GET /api/admin/users/:id/activity` | `{ id, name, email, lastActive, onlineNow, currentProjectId, currentProjectTitle, currentLocation }` — admin or mod; gated by `requireTargetEditable` so mods cannot query admin/mod accounts |

Country mapping is **unchanged** — ISO-derived via `countryStats.js`. The UAE/Ukraine
regression fixed in v3.4.0 is not reintroduced.

### `server/routes/admin.js`

`activity-summary` route registered **before** the `/:id` wildcard to prevent path
shadowing. Route ordering: `GET /users/activity-summary` → `GET /users/:id` →
`GET /users/:id/activity`.

---

## Frontend changes

### `src/frontend/pages/admin/AdminConsole.jsx`

**Overview tab**
- Two new KPI tiles: **Online Users** (green) and **Offline Users** (muted).
  Data from `GET /api/admin/users/activity-summary`.

**Users tab**
- Summary line above the table: `Online · Offline · Total · % online`.
- **Status column** — each row shows:
  - Online: green pulsing dot (`.ops-pulse` CSS animation, elevated to the root
    stylesheet; `prefers-reduced-motion: reduce` respected — static dot shown).
  - Offline: muted static dot.
- Clicking a user row opens the existing `UserDetailPanel`.

**UserDetailPanel**
- On open, fetches `GET /api/admin/users/:id/activity`.
- Displays **"Online now"** (pulsing dot) or **"Offline · Xm ago"** (relative
  `lastActive`), current project title, and presence location (e.g.
  `Screening > Title & Abstract`).

**Country table**
- Two new columns: **Online** and **Offline**, populated from `getUserCountries`.

**Country map (choropleth tooltip)**
- Hover tooltip adds a `"{N} online · {N} offline"` line above the existing
  total and percentage.

### `src/frontend/pages/admin/adminApiClient.js`

Added client wrappers for `getUserActivitySummary()` and `getUserActivity(id)`.

---

## Security

- No raw IP address is stored or transmitted at any point.
- Country is derived server-side from the ISO code already held in `User.country`
  (no GeoIP lookup).
- Presence `location` is the user-supplied location string forwarded by the client
  (≤80 chars), never an IP-derived value.
- `activity-summary` requires admin role. `getUserActivity` requires admin or mod,
  and `requireTargetEditable` prevents mods from querying admin or other mod
  accounts.

---

## Known limitations

1. **Online count is in-memory only.** Presence rooms live in the Node process. A
   multi-instance deployment would split the registry across processes, causing
   each instance to under-count. A Redis pub/sub broker would be required (deferred
   architectural work; see final report).
2. **Dashboard-only users are not "online now".** A user browsing the project
   dashboard without opening a project room has no heartbeat and appears offline in
   "online now", even though `lastActive` correctly marks them as active in the
   24 h metric.
3. **`lastActive` granularity is 5 minutes.** The "Active 24 h" count can lag by
   up to 5 min because of the write throttle. This is by design (avoids DB write
   storms) but means the figure should be read as approximate.
4. **`percentOnline` uses `totalUsers` as the denominator.** Accounts that have
   never logged in are included, which may make the percentage appear low for
   large user bases.

---

## QA results

| Scenario | Expected | Result |
|---|---|---|
| User opens a project → Ops console | Online count increments within one poll cycle | ✅ |
| User's heartbeat expires (>75 s) | Moves to Offline | ✅ |
| Mod opens `UserDetailPanel` for another mod | Request blocked (403) by `requireTargetEditable` | ✅ |
| Admin opens `UserDetailPanel` for any user | Online status + location shown | ✅ |
| Country table for a country with online users | Correct online/offline split, total unchanged | ✅ |
| UAE country mapping | Derived from ISO code; no Ukraine regression | ✅ |
| `prefers-reduced-motion` browser setting | Pulsing dot becomes static | ✅ |
