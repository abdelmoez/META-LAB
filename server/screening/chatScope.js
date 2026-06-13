/**
 * server/screening/chatScope.js — META·LAB door into the shared workspace chat
 * (prompt7 Task 11).
 *
 * The chat thread is keyed by ScreenProject.id. A linked pair (META·LAB
 * `Project` + `ScreenProject` via linkedMetaLabProjectId — the implicit
 * "Review Workspace") shares ONE thread, so the META·LAB-side routes
 * (/metalab/:mlpid/chat*) must first resolve the META·LAB project id to the
 * linked ScreenProject, then authorize exactly like the SIFT-side routes.
 *
 * Resolution copies the prefer-own-then-membership selection used by
 * getMetaLabSummary (screeningController.js): candidates by
 * linkedMetaLabProjectId (newest first) → prefer a workspace OWNED by the
 * caller → else the first one where the caller is an ACTIVE member.
 *
 * Returns { sp, access } or null. Handlers translate null → 404 to preserve
 * the existence-hiding contract: "no linked workspace", "project does not
 * exist" and "no access" are indistinguishable to the caller.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess } from './access.js';

export async function resolveMetaLabChatScope(mlpid, user) {
  if (!mlpid || !user?.id) return null;

  const candidates = await prisma.screenProject.findMany({
    // deletedAt:null — a soft-deleted workspace must not resolve a chat scope
    // (getProjectAccess would also null it; filtering here lets a second live
    // workspace win instead).
    where: { linkedMetaLabProjectId: mlpid, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  if (!candidates.length) return null;

  // Prefer the caller's own workspace (same tie-break as getMetaLabSummary
  // when one META·LAB project is linked from more than one workspace).
  let sp = candidates.find(x => x.ownerId === user.id) || null;
  if (!sp) {
    const membership = await prisma.screenProjectMember.findFirst({
      where: { projectId: { in: candidates.map(x => x.id) }, userId: user.id, status: 'active' },
      select: { projectId: true },
    });
    if (membership) sp = candidates.find(x => x.id === membership.projectId) || null;
  }
  if (!sp) return null;

  // Standard access resolution — every chat gate (canChat, isLeader, active,
  // chatRestricted) behaves exactly as on the /projects/:pid/chat side.
  const access = await getProjectAccess(sp.id, user);
  if (!access) return null;
  return { sp, access };
}
