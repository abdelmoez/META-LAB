/**
 * server/screening/ensureWorkspace.js  (prompt18 — unified Review Workspace)
 *
 * The "Review Workspace" repair layer. A user-facing project (a META·LAB
 * `Project`) should ALWAYS have its internal META·SIFT screening module — a
 * linked `ScreenProject`. This module resolves that link and, when the caller
 * OWNS the META·LAB project and no module exists yet, creates it silently and
 * idempotently.
 *
 * This is what lets the unified frontend expose a single "Screening" stage
 * without ever asking the user to "link a META·SIFT project". Backend
 * separation is fully preserved: META·SIFT stays a separate engine (Screen*
 * tables, /api/screening router); this only guarantees the soft link
 * (`ScreenProject.linkedMetaLabProjectId`) exists.
 */
import { prisma } from '../db/client.js';
import { getByIdUnscoped } from '../store.js';
import { createLinkedScreenProject } from './createScreenProject.js';

/**
 * Resolve the linked ScreenProject for a META·LAB project, preferring the
 * caller's OWN workspace, then an active membership. Returns the ScreenProject
 * row, or null when none is reachable by this user.
 *
 * Mirrors the resolver in screeningController.getMetaLabSummary so the unified
 * Screening stage and the PRISMA summary always agree on which module is "the"
 * screening project for a given META·LAB project.
 */
export async function resolveScreenModule(mlProjectId, userId) {
  if (!mlProjectId || !userId) return null;
  const candidates = await prisma.screenProject.findMany({
    // Soft-deleted workspaces are nonexistent (prompt9) — never resolve to them.
    where: { linkedMetaLabProjectId: mlProjectId, deletedAt: null },
    orderBy: { createdAt: 'asc' }, // oldest wins when a project is linked twice
  });
  if (!candidates.length) return null;

  const own = candidates.find(x => x.ownerId === userId);
  if (own) return own;

  const membership = await prisma.screenProjectMember.findFirst({
    where: { projectId: { in: candidates.map(x => x.id) }, userId, status: 'active' },
    select: { projectId: true },
  });
  if (membership) return candidates.find(x => x.id === membership.projectId) || null;
  return null;
}

/**
 * Ensure the META·SIFT screening module exists for a META·LAB project and that
 * the caller can reach it. Idempotent.
 *
 * - Resolves an existing linked ScreenProject (own, or via active membership) →
 *   returns it unchanged.
 * - If none exists AND the caller OWNS the (live) META·LAB project → creates one
 *   silently (`created: true`). A member cannot exist without a ScreenProject,
 *   so this create branch is owner-only by construction.
 * - If the caller neither owns the project nor is an active member → returns
 *   null (the handler translates this to 404; existence-hiding convention).
 *
 * @param {string} mlProjectId
 * @param {{ id: string }} user
 * @returns {Promise<{ screenProjectId: string, ownerId: string, created: boolean, repaired: boolean } | null>}
 */
export async function ensureScreenModuleForMetaLab(mlProjectId, user) {
  if (!mlProjectId || !user?.id) return null;

  const existing = await resolveScreenModule(mlProjectId, user.id);
  if (existing) {
    return { screenProjectId: existing.id, ownerId: existing.ownerId, created: false, repaired: false };
  }

  // No module yet — only the META·LAB project's OWNER may create one. Verify the
  // project is live (not soft-deleted) and owned by the caller.
  const proj = await prisma.project.findFirst({
    where: { id: mlProjectId, userId: user.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!proj) return null;

  // Re-check immediately before creating to shrink the create race window
  // (two near-simultaneous Screening opens must not create two modules).
  const recheck = await resolveScreenModule(mlProjectId, user.id);
  if (recheck) {
    return { screenProjectId: recheck.id, ownerId: recheck.ownerId, created: false, repaired: false };
  }

  // PICO snapshot source — the full project blob (best-effort; snapshotPico
  // tolerates a bare {} or { name }).
  let mlData = null;
  try { mlData = await getByIdUnscoped(mlProjectId); } catch { /* best-effort */ }

  const created = await createLinkedScreenProject({
    ownerId: user.id,
    title: proj.name || (mlData && mlData.name) || 'Review',
    linkedMetaLabProjectId: mlProjectId,
    mlData: mlData || { name: proj.name },
  });
  return { screenProjectId: created.id, ownerId: created.ownerId, created: true, repaired: true };
}

/**
 * Bulk, system-level repair used by the backfill script (prompt18 migration).
 * For every LIVE META·LAB project that has no linked, live ScreenProject, create
 * one owned by the project's owner. Idempotent — safe to re-run. Returns a
 * summary `{ scanned, created, skipped, failed, errors[] }`.
 *
 * NOTE: this is owner-scoped per project (ownerId = Project.userId), so it never
 * creates a foreign link and the link invariant
 * (ScreenProject.ownerId === Project.userId) always holds.
 */
export async function backfillScreenModules({ log = () => {} } = {}) {
  const summary = { scanned: 0, created: 0, skipped: 0, failed: 0, errors: [] };

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, userId: true, name: true },
  });

  // One query for all existing links, then a Set for O(1) membership.
  const linkedIds = new Set(
    (await prisma.screenProject.findMany({
      where: { linkedMetaLabProjectId: { not: null }, deletedAt: null },
      select: { linkedMetaLabProjectId: true },
    })).map(r => r.linkedMetaLabProjectId),
  );

  for (const p of projects) {
    summary.scanned += 1;
    if (linkedIds.has(p.id)) { summary.skipped += 1; continue; }
    try {
      let mlData = null;
      try { mlData = await getByIdUnscoped(p.id); } catch { /* best-effort */ }
      await createLinkedScreenProject({
        ownerId: p.userId,
        title: p.name || (mlData && mlData.name) || 'Review',
        linkedMetaLabProjectId: p.id,
        mlData: mlData || { name: p.name },
      });
      summary.created += 1;
      log(`created screening module for project ${p.id} (${p.name || 'untitled'})`);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ projectId: p.id, error: err.message });
      log(`FAILED for project ${p.id}: ${err.message}`);
    }
  }
  return summary;
}
