/**
 * presenceController.js — REST surface for project presence + field locking
 * (prompt23 Tasks 5/13/14/15). Every route is gated by getProjectAccess, so only
 * an owner or active member of the screening workspace can join presence, see who
 * else is here, or acquire a field lock. State is ephemeral (server/realtime/
 * presence.js); changes are broadcast over the existing SSE bus as thin pokes —
 * recipients refetch GET /presence.
 *
 * Privacy: presence is scoped to ONE project's members; nobody learns about
 * activity in projects they cannot access.
 */
import { getProjectAccess } from '../screening/access.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import * as P from '../realtime/presence.js';
import { prisma } from '../db/client.js';

// Any owner/active member may participate in presence + locking.
async function gate(req, res) {
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!(access.isOwner || access.active)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return access;
}

const LOCATION_MAX = 80;
const FIELD_MAX = 120;
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// prompt25 Task 3 — req.user only carries { id, email, role } (no name), so
// presence would otherwise store the email. Resolve the user's CURRENT name from
// the DB with a short cache (≤60s) so presence shows the real name AND stays
// dynamic when the user renames themselves (Task 5), without a query per beat.
const NAME_TTL_MS = 60_000;
const nameCache = new Map(); // userId -> { name, email, ts }
async function resolveUser(reqUser) {
  const cached = nameCache.get(reqUser.id);
  const now = Date.now();
  if (cached && now - cached.ts < NAME_TTL_MS) {
    return { id: reqUser.id, name: cached.name, email: cached.email || reqUser.email };
  }
  let name = null, email = reqUser.email;
  try {
    const u = await prisma.user.findUnique({ where: { id: reqUser.id }, select: { name: true, email: true } });
    if (u) { name = u.name || null; email = u.email || reqUser.email; }
  } catch { /* fall back to the email-derived name in displayName() */ }
  nameCache.set(reqUser.id, { name, email, ts: now });
  return { id: reqUser.id, name, email };
}

export async function heartbeat(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const pid = access.project.id;
    const location = clip(req.body?.location, LOCATION_MAX);
    const user = await resolveUser(req.user);
    const { snapshot, changed } = P.heartbeat(pid, user, location);
    if (changed) emitToProjectMembers(pid, { type: 'presence.changed' }, { exclude: req.user.id });
    return res.json(snapshot);
  } catch (err) {
    console.error('[presence] heartbeat:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function leave(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const pid = access.project.id;
    const { changed } = P.leave(pid, req.user.id);
    if (changed) emitToProjectMembers(pid, { type: 'presence.changed' }, { exclude: req.user.id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[presence] leave:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function list(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    return res.json(P.snapshot(access.project.id));
  } catch (err) {
    console.error('[presence] list:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function acquireLock(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const pid = access.project.id;
    const field = clip(req.body?.field, FIELD_MAX);
    if (!field) return res.status(400).json({ error: 'field is required' });
    const user = await resolveUser(req.user);
    const result = P.acquireLock(pid, user, field, clip(req.body?.location, LOCATION_MAX));
    if (result.ok && result.changed) emitToProjectMembers(pid, { type: 'lock.changed' }, { exclude: req.user.id });
    return res.status(result.ok ? 200 : 409).json(result);
  } catch (err) {
    console.error('[presence] acquireLock:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function releaseLock(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const pid = access.project.id;
    const field = clip(req.body?.field, FIELD_MAX);
    if (!field) return res.status(400).json({ error: 'field is required' });
    const result = P.releaseLock(pid, req.user.id, field);
    if (result.changed) emitToProjectMembers(pid, { type: 'lock.changed' }, { exclude: req.user.id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[presence] releaseLock:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
