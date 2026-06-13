/**
 * server/screening/metalabAccess.js  (prompt5 Task 4 / Task 6)
 *
 * Resolves a user's access to a META·LAB Project they do NOT own, via a linked
 * Review Workspace (ScreenProject.linkedMetaLabProjectId). This is what makes a
 * member added to a linked workspace actually SEE and (per permission) edit the
 * META·LAB project — not just the META·SIFT one.
 *
 * Module ownership note: link targets are restricted to the workspace owner's
 * own META·LAB projects (see screeningController.linkMetaLab), so a linked
 * Project's userId always equals its ScreenProject.ownerId. Membership therefore
 * grants access to exactly one owner's project — never a stranger's.
 */
import { prisma } from '../db/client.js';

/**
 * Map a ScreenProjectMember row → META·LAB module access flags.
 * Owner/leader get full access; otherwise the stored module flags decide.
 * `canExport` (prompt6 Task 5) is the META·LAB export flag from PERMISSION_KEYS
 * (`canExport`) — owner/leader always may; read-only presets ship it false.
 */
export function mlAccessFromMember(m) {
  const full = m.role === 'owner' || m.role === 'leader';
  const canView = full || !!m.canViewMetaLab || !!m.canEditMetaLab;
  const canEdit = (full || !!m.canEditMetaLab) && !m.readOnlyMetaLab;
  const readOnly = canView && !canEdit;
  const canExport = full || !!m.canExport;
  return { canView, canEdit, readOnly, canExport };
}

/**
 * Resolve a user's membership-based access to a META·LAB Project (by its id).
 * Returns null when the user has no membership-based view access.
 * Shape: { role, canView, canEdit, readOnly, canExport, screenProjectId, screenProjectTitle, ownerId }
 */
export async function getMetaLabMemberAccess(metaLabProjectId, userId) {
  if (!metaLabProjectId || !userId) return null;
  // Soft-deleted workspaces grant nothing (prompt9) — membership dies with them.
  const screenProjects = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true, ownerId: true, title: true },
  });
  if (!screenProjects.length) return null;

  const member = await prisma.screenProjectMember.findFirst({
    where: { projectId: { in: screenProjects.map(s => s.id) }, userId, status: 'active' },
  });
  if (!member) return null;
  // The owner reaches their project through the normal owned path, not here.
  const sp = screenProjects.find(s => s.id === member.projectId);
  if (!sp || sp.ownerId === userId) return null;

  const acc = mlAccessFromMember(member);
  if (!acc.canView) return null;

  // SECURITY (defense in depth): enforce the documented invariant rather than trust
  // it. The linked META·LAB project must exist, be live (not admin-archived), and be
  // OWNED by the workspace owner. This blocks a leak if any write path ever set a
  // foreign linkedMetaLabProjectId, and hides admin-archived projects from members.
  const proj = await prisma.project.findFirst({
    where: { id: metaLabProjectId, deletedAt: null },
    select: { userId: true },
  });
  if (!proj || proj.userId !== sp.ownerId) return null;

  return { role: member.role, ...acc, screenProjectId: sp.id, screenProjectTitle: sp.title, ownerId: sp.ownerId };
}

/**
 * List META·LAB projects the user can access AS A MEMBER (not owner) via linked
 * Review Workspaces. De-duplicated by META·LAB project id (most-permissive wins).
 * Returns [{ metaLabProjectId, role, canView, canEdit, readOnly, canExport, screenProjectId, screenProjectTitle, ownerId }].
 */
export async function listSharedMetaLabAccess(userId) {
  if (!userId) return [];
  const memberships = await prisma.screenProjectMember.findMany({
    where: { userId, status: 'active' },
    select: {
      projectId: true, role: true,
      canViewMetaLab: true, canEditMetaLab: true, readOnlyMetaLab: true, canExport: true,
    },
  });
  if (!memberships.length) return [];

  const screenProjects = await prisma.screenProject.findMany({
    // deletedAt:null — soft-deleted workspaces stop granting shared ML access (prompt9).
    where: { id: { in: memberships.map(m => m.projectId) }, linkedMetaLabProjectId: { not: null }, deletedAt: null },
    select: { id: true, ownerId: true, title: true, linkedMetaLabProjectId: true },
  });
  const spById = Object.fromEntries(screenProjects.map(s => [s.id, s]));

  const byMetaLab = new Map();
  for (const m of memberships) {
    const sp = spById[m.projectId];
    if (!sp || !sp.linkedMetaLabProjectId) continue;
    if (sp.ownerId === userId) continue;             // owned path handles these
    const acc = mlAccessFromMember(m);
    if (!acc.canView) continue;
    const entry = {
      metaLabProjectId: sp.linkedMetaLabProjectId,
      role: m.role, ...acc,
      screenProjectId: sp.id, screenProjectTitle: sp.title, ownerId: sp.ownerId,
    };
    const prev = byMetaLab.get(entry.metaLabProjectId);
    // Keep the most permissive grant when the same project is linked twice.
    if (!prev || (entry.canEdit && !prev.canEdit)) byMetaLab.set(entry.metaLabProjectId, entry);
  }
  return [...byMetaLab.values()];
}
