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
import { PERMISSION_KEYS, fullPermissions } from '../../src/research-engine/screening/permissionPresets.js';

export const QUORUM = 2; // distinct reviewers required to promote a record

/** Resolve the effective module permissions for an access context. */
function resolvePerms({ isOwner, member }) {
  // Owner and leader always get full module access (prompt4 Task 8/9/12).
  if (isOwner || member?.role === 'leader' || member?.role === 'owner') return fullPermissions();
  const perms = {};
  for (const k of PERMISSION_KEYS) perms[k] = !!member?.[k];
  return perms;
}

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
  // Soft-deleted projects are nonexistent for EVERYONE incl. the owner
  // (prompt9): single chokepoint → 404 everywhere (records, chat, members,
  // overview, pdfs). Admin restore is the only way back.
  if (project.deletedAt) return null;

  const isOwner = project.ownerId === user.id;
  const member = await prisma.screenProjectMember.findFirst({
    where: { projectId: pid, userId: user.id },
  });

  // No access at all → caller is neither owner nor a linked member.
  if (!isOwner && !member) return null;
  // A removed/blocked member has no userId link; a 'pending' invite cannot act yet.
  if (!isOwner && member && member.status === 'pending') return null;

  const isLeader = isOwner || member?.role === 'leader' || member?.role === 'owner';
  const active   = isOwner || member?.status === 'active';
  const role     = isOwner ? 'owner' : (member?.role || 'reviewer');
  const perms    = resolvePerms({ isOwner, member });

  return {
    project,
    member: member || null,
    isOwner,
    isLeader,
    role,
    active,
    perms,
    // Viewers and inactive members cannot record decisions.
    canScreen: isOwner
      ? true
      : !!(member && member.status === 'active' && member.role !== 'viewer' && member.canScreen),
    canChat: isOwner ? true : !!(member && member.canChat),
    canResolveConflicts: isOwner
      ? true
      : !!(member && (member.canResolveConflicts || member.role === 'leader')),
    canManageMembers: isLeader || !!member?.canManageMembers,
    canManageSettings: isLeader || !!member?.canManageSettings,
  };
}

/**
 * Idempotently ensure the project owner has an active 'owner' member row.
 * Self-heals projects created before the membership model existed, so the
 * Overview / member list always shows the owner without a data migration.
 *
 * @param {{ id: string, ownerId: string }} project
 * @param {object} [db=prisma] — Prisma client OR an interactive `$transaction`
 *   client (`tx`). Passing `tx` lets the atomic create paths (75.md Phase 6)
 *   seed the owner row inside the same transaction that creates the
 *   ScreenProject, so a failure never orphans an owner-less workspace.
 *   The lazy self-heal call sites keep passing nothing (→ the shared client).
 * @returns {Promise<object|null>} the owner member row, or null when the owner
 *   user no longer exists.
 */
export async function ensureLeaderMember(project, db = prisma) {
  const existing = await db.screenProjectMember.findFirst({
    where: { projectId: project.id, userId: project.ownerId },
  });
  const full = fullPermissions();
  if (existing) {
    // Self-heal: the owner row must be role 'owner', active, with full permissions
    // (migrates legacy 'leader' owner rows created before the owner role existed).
    if (existing.role !== 'owner' || existing.status !== 'active') {
      return db.screenProjectMember.update({
        where: { id: existing.id },
        data: { role: 'owner', status: 'active', permissionPreset: 'owner', canScreen: true, canChat: true, canResolveConflicts: true, ...full },
      });
    }
    return existing;
  }
  const owner = await db.user.findUnique({ where: { id: project.ownerId } });
  if (!owner) return null;
  const ownerData = {
    projectId: project.id,
    userId: owner.id,
    name: owner.name || '',
    email: owner.email || '',
    role: 'owner',
    status: 'active',
    permissionPreset: 'owner',
    canScreen: true,
    canChat: true,
    canResolveConflicts: true,
    ...full,
  };
  try {
    return await db.screenProjectMember.create({ data: ownerData });
  } catch (err) {
    // Race / legacy clash on the unique key [projectId, email]: a pending
    // email-only invite (userId null) or a concurrent writer already holds a row
    // for the owner's email. Adopt & heal that row into the owner row instead of
    // failing — creation must stay idempotent (75.md Phase 6). Any other error
    // re-throws so the caller's transaction rolls back cleanly.
    if (err && err.code === 'P2002') {
      const clash = await db.screenProjectMember.findFirst({
        where: { projectId: project.id, email: owner.email || '' },
      });
      if (clash) {
        return db.screenProjectMember.update({
          where: { id: clash.id },
          data: { userId: owner.id, name: owner.name || '', role: 'owner', status: 'active', permissionPreset: 'owner', canScreen: true, canChat: true, canResolveConflicts: true, ...full },
        });
      }
    }
    throw err;
  }
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
