/**
 * server/realtime/bus.js — in-process SSE connection registry + emit helpers
 * (prompt6 Task 7 — see docs/manager/realtime-architecture.md).
 *
 * Design:
 *   - Map<userId, Set<res>>: ONE registry for the whole process. Each browser
 *     tab holds ONE global stream (never per-project — browsers cap ~6
 *     concurrent HTTP/1.1 connections per origin).
 *   - "Poke, don't payload": events carry ONLY { type, projectId?,
 *     metaLabProjectId?, at }. No content, no actor identity (blind-mode safe
 *     by construction). Clients refetch through existing authorized endpoints,
 *     each re-checked per request.
 *   - Recipients are resolved at EMIT time from the DB (active member rows +
 *     owner), so a just-removed member silently stops receiving — there is no
 *     registry ACL to invalidate.
 *   - Every emit path is fire-and-forget and error-swallowed: an emit failure
 *     must NEVER fail (or slow) the request that triggered it.
 *
 * CLUSTERING LIMITATION: this bus lives in process memory (single Node process
 * + SQLite — no Redis/broker). Running multiple server processes would split
 * the registry; cross-instance delivery would need a pub/sub broker. The
 * polling fallback still covers correctness in that scenario.
 */
import { prisma } from '../db/client.js';

const connections = new Map(); // userId -> Set<res>

/** Register an open SSE response stream for a user. */
export function register(userId, res) {
  let set = connections.get(userId);
  if (!set) { set = new Set(); connections.set(userId, set); }
  set.add(res);
}

/** Deregister a stream (on req 'close'). */
export function unregister(userId, res) {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) connections.delete(userId);
}

/** Total open streams (diagnostics / tests only). */
export function connectionCount() {
  let n = 0;
  for (const set of connections.values()) n += set.size;
  return n;
}

/**
 * forceCloseStreams — prompt49: immediately close ALL open SSE streams for a user
 * (called when an admin suspends them or a password change revokes sessions). A
 * final `session.revoked` event lets the client redirect to sign-in. Returns the
 * number of streams closed. Never throws.
 */
export function forceCloseStreams(userId) {
  const set = connections.get(userId);
  if (!set) return 0;
  let closed = 0;
  for (const res of set) {
    try {
      res.write('event: session.revoked\ndata: {"type":"session.revoked"}\n\n');
      res.end();
      closed += 1;
    } catch { /* socket already dead */ }
  }
  connections.delete(userId);
  return closed;
}

/** Serialize one event and write it to every open stream of the given users. */
function writeFrame(userIds, event) {
  const payload = { ...event, at: event.at || new Date().toISOString() };
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const uid of userIds) {
    const set = connections.get(uid);
    if (!set) continue;
    for (const res of set) {
      try { res.write(frame); } catch { /* dead socket — 'close' cleanup deregisters */ }
    }
  }
}

/**
 * Emit one event to specific users (e.g. user-targeted permissions.changed,
 * notification.created). Fire-and-forget — never throws.
 */
export function emitToUsers(userIds, event) {
  try {
    writeFrame(Array.isArray(userIds) ? userIds : [userIds], event);
  } catch { /* emits must never fail the request */ }
}

/**
 * Emit one event to the ACTIVE members (+ owner) of a ScreenProject, resolved
 * from the DB at emit time. `exclude` drops the acting user (their own UI
 * already reflects the change). Fire-and-forget — never throws, never awaited.
 */
export function emitToProjectMembers(projectId, event, { exclude } = {}) {
  if (!projectId || connections.size === 0) return;
  (async () => {
    const [project, members] = await Promise.all([
      prisma.screenProject.findUnique({ where: { id: projectId }, select: { ownerId: true } }),
      prisma.screenProjectMember.findMany({
        where: { projectId, status: 'active', userId: { not: null } },
        select: { userId: true },
      }),
    ]);
    if (!project) return;
    const ids = new Set(members.map(m => m.userId));
    ids.add(project.ownerId);
    if (exclude) ids.delete(exclude);
    if (ids.size) writeFrame([...ids], { ...event, projectId });
  })().catch(() => { /* emits are best-effort */ });
}

/**
 * Emit one event for a META·LAB project save/update. Recipients are resolved
 * via the LINKED ScreenProject(s): active members + workspace owner, honoring
 * the link invariant (ScreenProject.ownerId === Project.userId) via
 * `ownerUserId`. Unlinked projects poke the owner only. The event carries
 * `metaLabProjectId` (so the monolith can match it) AND `projectId` (the
 * linked ScreenProject id, so an open SiftProject can refresh e.g. a synced
 * title). Fire-and-forget — never throws, never awaited.
 */
export function emitToMetaLabProject(metaLabProjectId, ownerUserId, event, { exclude } = {}) {
  if (!metaLabProjectId || connections.size === 0) return;
  (async () => {
    const where = { linkedMetaLabProjectId: metaLabProjectId };
    if (ownerUserId) where.ownerId = ownerUserId; // link invariant — never poke a foreign workspace
    const sps = await prisma.screenProject.findMany({ where, select: { id: true, ownerId: true } });
    if (!sps.length) {
      if (ownerUserId && ownerUserId !== exclude) {
        writeFrame([ownerUserId], { ...event, metaLabProjectId });
      }
      return;
    }
    for (const sp of sps) {
      const members = await prisma.screenProjectMember.findMany({
        where: { projectId: sp.id, status: 'active', userId: { not: null } },
        select: { userId: true },
      });
      const ids = new Set(members.map(m => m.userId));
      ids.add(sp.ownerId);
      if (exclude) ids.delete(exclude);
      if (ids.size) writeFrame([...ids], { ...event, projectId: sp.id, metaLabProjectId });
    }
  })().catch(() => { /* emits are best-effort */ });
}
