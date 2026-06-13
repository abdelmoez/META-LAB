/**
 * server/services/notificationService.js — per-user notifications (prompt6 Task 1).
 *
 * The "Review Workspace" is the ScreenProject row: relatedScreenProjectId
 * doubles as the workspaceId (aliased as relatedWorkspaceId in API responses).
 *
 * Every write here is BEST-EFFORT: a notification failure must never fail the
 * main request (invite, role change, registration). Nothing in this module
 * throws — errors are swallowed and `null` is returned instead.
 */
import { prisma } from '../db/client.js';
import { emitToUsers } from '../realtime/bus.js';

/**
 * Ops kill-switch (prompt9): appSettings.notificationsEnabled === false
 * silently disables creation at this single chokepoint. Default (key missing,
 * row missing, parse/DB error) = ENABLED — the gate must never throw and must
 * fail open.
 */
async function notificationsEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    const settings = row ? JSON.parse(row.value || '{}') : {};
    return settings.notificationsEnabled !== false;
  } catch {
    return true; // fail open — a settings read failure must not mute the product
  }
}

/**
 * Create a notification row for one user. Best-effort — never throws.
 * Returns the created Notification or null on failure / missing required fields.
 */
export async function createNotification({
  userId,
  type,
  title,
  message = '',
  app = '',
  relatedScreenProjectId = null,
  relatedMetaLabProjectId = null,
  actorId = null,
  actorName = '',
  actorEmail = '',
  role = '',
} = {}) {
  if (!userId || !type || !title) return null;
  try {
    // Admin kill-switch (prompt9): skip creation silently when disabled.
    if (!(await notificationsEnabled())) return null;
    const created = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message: message || '',
        app: app || '',
        relatedScreenProjectId: relatedScreenProjectId || null,
        relatedMetaLabProjectId: relatedMetaLabProjectId || null,
        actorId: actorId || null,
        actorName: actorName || '',
        actorEmail: actorEmail || '',
        role: role || '',
      },
    });
    // Realtime poke (Task 7) — the bell refetches its own authorized endpoints.
    emitToUsers([userId], { type: 'notification.created' });
    return created;
  } catch {
    return null; // notifications are a side-effect, never a failure mode
  }
}

/**
 * Compose + create the PROJECT_INVITE notification for a newly added member.
 *   member  — ScreenProjectMember row (must have userId; pending invites are
 *             claimed later at registration time)
 *   project — ScreenProject row ({ id, title, linkedMetaLabProjectId })
 *   actor   — { id, name?, email? } of the inviter
 *   roleLabel — preset/role granted (e.g. 'reviewer', 'leader', 'viewer')
 * Best-effort — never throws.
 */
export async function notifyProjectInvite({ member, project, actor, roleLabel } = {}) {
  if (!member?.userId || !project?.id) return null;
  const who = actor?.name || actor?.email || 'A project manager';
  return createNotification({
    userId: member.userId,
    type: 'PROJECT_INVITE',
    title: `Added to "${project.title || 'Untitled project'}"`,
    message: `${who} added you as ${roleLabel || member.role || 'member'}`,
    app: project.linkedMetaLabProjectId ? 'workspace' : 'metasift',
    relatedScreenProjectId: project.id,
    relatedMetaLabProjectId: project.linkedMetaLabProjectId || null,
    actorId: actor?.id || null,
    actorName: actor?.name || '',
    actorEmail: actor?.email || '',
    role: roleLabel || member.role || '',
  });
}
