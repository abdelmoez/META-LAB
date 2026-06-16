/**
 * server/realtime/presence.js — ephemeral, in-memory PROJECT PRESENCE + FIELD
 * LOCK manager (prompt23 Tasks 5/13/14/15).
 *
 * WHY IN-MEMORY (no Prisma model): presence and field locks are transient — they
 * describe "who is here right now and what are they touching", not durable data.
 * They must expire on disconnect and reset on restart. We pigg-back on the
 * existing SSE bus (server/realtime/bus.js) for delivery; clients heartbeat to
 * stay present and to keep their locks alive. Same single-process clustering
 * caveat as the bus (documented there).
 *
 * Scope key = the ScreenProject id (the collaborative workspace that already owns
 * membership, access control, and SSE routing). Field keys are caller-defined
 * strings like "settings.requiredReviewers" or "pico.C".
 *
 * Pure logic with an injectable `now` so it is unit-testable without timers.
 */

export const ACTIVE_MS = 75_000;    // present if heartbeat within 75s
export const LOCK_TTL_MS = 75_000;  // a lock auto-expires 75s after its last heartbeat

const rooms = new Map(); // projectId -> { users: Map<userId,entry>, locks: Map<field,lock> }

function room(projectId) {
  let r = rooms.get(projectId);
  if (!r) { r = { users: new Map(), locks: new Map() }; rooms.set(projectId, r); }
  return r;
}

function prune(r, now) {
  for (const [k, v] of r.users) if (now - v.lastBeat > ACTIVE_MS) r.users.delete(k);
  for (const [f, l] of r.locks) if (now - l.lastBeat > LOCK_TTL_MS) r.locks.delete(f);
}

// prompt25 Task 3 — show a real NAME, never the email. Fallback chain:
// name → email local-part (before @) → full email → generic. Callers should
// enrich `user` with the live name (presenceController resolves it from the DB,
// since req.user only carries id/email/role).
function displayName(user) {
  if (!user) return 'A teammate';
  const name = user.name && String(user.name).trim();
  if (name) return name;
  if (user.email) {
    const local = String(user.email).split('@')[0].trim();
    return local || user.email;
  }
  return 'A teammate';
}

export function snapshot(projectId, now = Date.now()) {
  const r = room(projectId);
  prune(r, now);
  return {
    users: [...r.users.values()].map(u => ({
      userId: u.userId, name: u.name, location: u.location || null, lastBeat: u.lastBeat,
    })),
    locks: [...r.locks.values()].map(l => ({
      field: l.field, userId: l.userId, name: l.name, lockedAt: l.lockedAt,
    })),
  };
}

/**
 * Record a heartbeat for a user in a project, updating their current location and
 * refreshing any locks they hold. Returns { snapshot, changed } — `changed` is
 * true only when something OTHER clients care about moved (join / leave-by-timeout
 * pruned / location change), so callers can avoid SSE spam on idle heartbeats.
 */
export function heartbeat(projectId, user, location, now = Date.now()) {
  const r = room(projectId);
  const prior = r.users.get(user.id);
  const loc = location || null;
  const changed = !prior || prior.location !== loc;
  r.users.set(user.id, { userId: user.id, name: displayName(user), location: loc, lastBeat: now });
  for (const l of r.locks.values()) if (l.userId === user.id) l.lastBeat = now; // keep my locks alive
  const before = r.users.size + r.locks.size;
  prune(r, now);
  const after = r.users.size + r.locks.size;
  return { snapshot: snapshot(projectId, now), changed: changed || before !== after };
}

/** Remove a user's presence and release every lock they hold. */
export function leave(projectId, userId, now = Date.now()) {
  const r = room(projectId);
  const had = r.users.delete(userId);
  let releasedLock = false;
  for (const [f, l] of r.locks) if (l.userId === userId) { r.locks.delete(f); releasedLock = true; }
  prune(r, now);
  return { snapshot: snapshot(projectId, now), changed: had || releasedLock };
}

/**
 * Try to acquire a field lock. Succeeds if the field is free or already held by
 * the same user (idempotent re-acquire / heartbeat). Otherwise returns the
 * current holder so the caller can show "X is editing".
 */
export function acquireLock(projectId, user, field, location, now = Date.now()) {
  const r = room(projectId);
  prune(r, now);
  const existing = r.locks.get(field);
  if (existing && existing.userId !== user.id) {
    return { ok: false, lock: { field: existing.field, userId: existing.userId, name: existing.name, lockedAt: existing.lockedAt } };
  }
  const lock = {
    field, userId: user.id, name: displayName(user),
    lockedAt: existing ? existing.lockedAt : now, lastBeat: now,
  };
  r.locks.set(field, lock);
  // Acquiring implies presence.
  const prior = r.users.get(user.id);
  r.users.set(user.id, { userId: user.id, name: lock.name, location: (prior && prior.location) || location || null, lastBeat: now });
  return { ok: true, lock: { field, userId: user.id, name: lock.name, lockedAt: lock.lockedAt }, changed: !existing };
}

/** Release a field lock — only the holder may release it. */
export function releaseLock(projectId, userId, field, now = Date.now()) {
  const r = room(projectId);
  const l = r.locks.get(field);
  const released = !!(l && l.userId === userId);
  if (released) r.locks.delete(field);
  prune(r, now);
  return { ok: true, changed: released };
}

/**
 * prompt25 Tasks 1/2 — GLOBAL online snapshot across ALL project rooms, for the
 * Ops console. Returns one entry per distinct user who has an active heartbeat
 * (within ACTIVE_MS) in any room, with their most-recent location + the project
 * room they're in. Pure (injectable `now`) and read-only.
 *   Map<userId, { userId, name, location, lastBeat, projectId, projectIds: string[] }>
 * `location`/`projectId` reflect the user's MOST RECENT beat (where they are now).
 */
export function globalOnlineSnapshot(now = Date.now()) {
  const byUser = new Map();
  for (const [projectId, r] of rooms) {
    prune(r, now);
    for (const u of r.users.values()) {
      const prev = byUser.get(u.userId);
      if (!prev) {
        byUser.set(u.userId, {
          userId: u.userId, name: u.name, location: u.location || null,
          lastBeat: u.lastBeat, projectId, projectIds: [projectId],
        });
      } else {
        prev.projectIds.push(projectId);
        if (u.lastBeat > prev.lastBeat) { // most-recent beat wins for "current" location
          prev.lastBeat = u.lastBeat; prev.location = u.location || null;
          prev.projectId = projectId; prev.name = u.name;
        }
      }
    }
  }
  return byUser;
}

/** Count of distinct users online right now across all projects. */
export function globalOnlineCount(now = Date.now()) {
  return globalOnlineSnapshot(now).size;
}

/** Test-only: wipe all rooms. */
export function _reset() { rooms.clear(); }
