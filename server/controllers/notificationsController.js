/**
 * server/controllers/notificationsController.js — bell endpoints (prompt6 Task 1).
 *
 * Mounted at /api/notifications behind requireAuth ONLY (never under the
 * rate-limited /api/admin or /api/auth mounts — the bell polls).
 *
 * All reads/writes are scoped to the authenticated user; a write against a
 * notification the caller doesn't own returns 404 (no cross-user probing).
 * relatedWorkspaceId / relatedMetaSiftProjectId are response aliases of
 * relatedScreenProjectId — the Review Workspace IS the ScreenProject.
 */
import { prisma } from '../db/client.js';

function shapeNotification(n) {
  return {
    ...n,
    relatedWorkspaceId: n.relatedScreenProjectId,    // workspace = ScreenProject
    relatedMetaSiftProjectId: n.relatedScreenProjectId,
  };
}

/**
 * GET /api/notifications
 * Query: ?unread=1 (unread only) · ?all=1 (include dismissed) ·
 *        ?page=&limit= (default page 1, limit 50, max 200). Newest first.
 * Response: { notifications: [...], total, unreadCount }
 */
export async function listNotifications(req, res) {
  try {
    const userId = req.user.id;
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const where = { userId };
    if (!includeAll) where.dismissedAt = null; // dismissed hidden unless ?all=1
    if (unreadOnly) {
      where.readAt = null;
      where.dismissedAt = null;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null, dismissedAt: null } }),
    ]);

    res.json({ notifications: notifications.map(shapeNotification), total, unreadCount });
  } catch (err) {
    console.error('[notifications] list:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/notifications/unread-count → { count }
 * Unread = readAt null AND dismissedAt null. Cheap — polled by the bell.
 */
export async function getUnreadCount(req, res) {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null, dismissedAt: null },
    });
    res.json({ count });
  } catch (err) {
    console.error('[notifications] unreadCount:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/notifications/:id/read — set readAt if not already read. */
export async function markRead(req, res) {
  try {
    const n = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    const updated = n.readAt
      ? n
      : await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    res.json({ notification: shapeNotification(updated) });
  } catch (err) {
    console.error('[notifications] markRead:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/notifications/:id/dismiss — set dismissedAt (idempotent). */
export async function dismissNotification(req, res) {
  try {
    const n = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    const updated = n.dismissedAt
      ? n
      : await prisma.notification.update({ where: { id: n.id }, data: { dismissedAt: new Date() } });
    res.json({ notification: shapeNotification(updated) });
  } catch (err) {
    console.error('[notifications] dismiss:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/notifications/mark-all-read — set readAt on every unread row. */
export async function markAllRead(req, res) {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    console.error('[notifications] markAllRead:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
