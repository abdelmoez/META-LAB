/**
 * server/screening/access.js
 * META·SIFT collaboration access-control + audit helpers.
 *
 * Isolation model (see docs/manager/project-data-isolation.md):
 *   One application database. Every Screen* row is scoped by projectId.
 *   A user may touch a screening project only if they are the OWNER or an
 *   active MEMBER of it. The owner is always treated as a leader.
 */
import { prisma } from '../db/client.js';

export const QUORUM = 2; // distinct reviewers required to promote a record

/**
 * Resolve the caller's access to a screening project.
 * Returns null when the project does not exist OR the caller has no access
 * (handlers should translate null → 404 to avoid leaking existence).
 *
 * Shape: { project, member, isOwner, isLeader, role, active,
 *          canScreen, canChat, canResolveConflicts }
 */
export async function getProjectAccess(pid, user) {
  if (!pid || !user?.id) return null;
  const project = await prisma.screenProject.findUnique({ where: { id: pid } });
  if (!project) return null;

  const isOwner = project.ownerId === user.id;
  const member = await prisma.screenProjectMember.findFirst({
    where: { projectId: pid, userId: user.id },
  });

  // No access at all → caller is neither owner nor a linked member.
  if (!isOwner && !member) return null;
  // A removed/blocked member has no userId link; a 'pending' invite cannot act yet.
  if (!isOwner && member && member.status === 'pending') return null;

  const isLeader = isOwner || member?.role === 'leader';
  const active   = isOwner || member?.status === 'active';
  const role     = isOwner ? 'leader' : (member?.role || 'reviewer');

  return {
    project,
    member: member || null,
    isOwner,
    isLeader,
    role,
    active,
    // Viewers and inactive members cannot record decisions.
    canScreen: isOwner
      ? true
      : !!(member && member.status === 'active' && member.role !== 'viewer' && member.canScreen),
    canChat: isOwner ? true : !!(member && member.canChat),
    canResolveConflicts: isOwner
      ? true
      : !!(member && (member.canResolveConflicts || member.role === 'leader')),
  };
}

/**
 * Idempotently ensure the project owner has a leader member row.
 * Self-heals projects created before the membership model existed, so the
 * Overview / member list always shows the leader without a data migration.
 */
export async function ensureLeaderMember(project) {
  const existing = await prisma.screenProjectMember.findFirst({
    where: { projectId: project.id, userId: project.ownerId },
  });
  if (existing) {
    if (existing.role !== 'leader' || existing.status !== 'active') {
      return prisma.screenProjectMember.update({
        where: { id: existing.id },
        data: { role: 'leader', status: 'active', canScreen: true, canChat: true, canResolveConflicts: true },
      });
    }
    return existing;
  }
  const owner = await prisma.user.findUnique({ where: { id: project.ownerId } });
  if (!owner) return null;
  return prisma.screenProjectMember.create({
    data: {
      projectId: project.id,
      userId: owner.id,
      name: owner.name || '',
      email: owner.email || '',
      role: 'leader',
      status: 'active',
      canScreen: true,
      canChat: true,
      canResolveConflicts: true,
    },
  });
}

/** Look up a registered user by (case-insensitive) email, or null. */
export async function findUserByEmail(email) {
  if (!email) return null;
  return prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
}

/** Append a project-scoped audit entry. Never throws (audit must not break flows). */
export async function writeAudit(projectId, actor, action, { entityType = null, entityId = null, details = {} } = {}) {
  try {
    await prisma.screenAuditLog.create({
      data: {
        projectId,
        actorId: actor?.id || 'system',
        actorName: actor?.name || actor?.email || '',
        action,
        entityType,
        entityId,
        details: JSON.stringify(details ?? {}).slice(0, 4000),
      },
    });
  } catch { /* audit is best-effort */ }
}
