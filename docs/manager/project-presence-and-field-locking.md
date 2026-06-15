# Project Presence & Field Locking (prompt23 Tasks 5/13/14/15)

Real-time "who's here, where, and what are they editing" + field-level locks so
two members can't overwrite the same field. Built on the **existing SSE bus** with
an **ephemeral in-memory** store — no Prisma model, no migration.

## Design

- **Store:** `server/realtime/presence.js` — `Map<projectId, { users, locks }>`.
  - Presence entry: `{ userId, name, location, lastBeat }`.
  - Lock entry: `{ field, userId, name, lockedAt, lastBeat }`.
  - `ACTIVE_MS = 75_000`, `LOCK_TTL_MS = 75_000`. Entries are pruned on every
    access, so presence and locks **expire automatically** on disconnect — a lock
    can never permanently trap a field.
  - Pure logic with an injectable `now` → fully unit-tested (`tests/unit/presence.test.js`).
- **Delivery:** changes emit thin SSE pokes via `emitToProjectMembers`
  (`presence.changed`, `lock.changed`); clients refetch `GET /presence`. Idle
  heartbeats that change nothing do **not** emit (no SSE spam).
- **Scope key:** the `ScreenProject` id — the workspace that already owns
  membership, `getProjectAccess`, and SSE routing.

## API (under `/api/screening`, all `requireAuth` + `getProjectAccess`-gated)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/projects/:pid/presence` | snapshot `{ users, locks }` |
| `POST` | `/projects/:pid/presence/heartbeat` `{ location }` | upsert presence, refresh my locks, returns snapshot |
| `POST` | `/projects/:pid/presence/leave` | drop presence + release my locks |
| `POST` | `/projects/:pid/locks/acquire` `{ field }` | acquire; `409 { ok:false, lock }` if held by another |
| `POST` | `/projects/:pid/locks/release` `{ field }` | release (holder only) |

Only an **owner or active member** may participate; outsiders get 404, inactive
members 403 — nobody learns about activity in projects they can't access.

## Client

- `useProjectPresence(pid, location)` (`src/frontend/screening/hooks/usePresence.js`)
  — heartbeats every 30s, on location change, and on tab-visibility; announces
  `leave` on unmount/hide; refetches on `presence.changed`/`lock.changed`. Returns
  `{ users, locks }`. **Owned once** by `SiftProject` and passed down to tabs.
- `useFieldLock({ pid, field, myUserId, locks })` — derives `lockedByOther` from
  the shared `locks` and provides `acquire()` / `release()`. **Fail-open**: any
  lock-system error never blocks the user from editing.

## Timing
- heartbeat every **30s**; active window **75s**; lock TTL **75s** (refreshed by
  heartbeat). Acquire on focus, release on blur/save; hard tab/browser closes are
  covered by the TTL.

## UI
- **Presence indicator** (`PresenceIndicator.jsx`) in the project utility area:
  `active / total` chip + hover popover listing each user's name, location, and the
  field they're editing.
- **Members tab**: green "Active now · <location>" (or "editing <field>") per row.
- **Field lock**: the locked control is disabled with a "🔒 <name> is editing" note
  (demonstrated on the shared *Required reviewers* setting).

## Scope & limitations
- **Now spans the whole project (v3.5.1).** The monolith (`meta-lab-3-patched.jsx`)
  heartbeats presence across **all stages** (PICO, Data Extraction, Analysis, …)
  scoped to the **linked screening project id** (`linkedSiftId`), so monolith and
  screening users share ONE presence room. The monolith's heartbeat is disabled
  while the Screening stage is open (SiftProject owns it there) to avoid a double
  beat. **PICO P/I/C/O fields are field-locked** (plus the screening *Required
  reviewers* setting). Field locking is fail-open — a lock error never blocks editing.
- Verified end-to-end by `tests/integration/prompt23-presence.test.js` (two real
  sessions: presence, single-holder lock contention, release, non-member 404).
- **Remaining (architectural):** the SSE bus is in-process (single Node + SQLite),
  so presence is per-instance — the SAME caveat as every existing realtime feature
  (chat, pokes). Multi-instance delivery needs a Redis pub/sub broker; the polling
  fallback preserves correctness in the meantime.
