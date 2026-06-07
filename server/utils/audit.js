import { prisma } from '../db/client.js';

/**
 * logAdminAction — Record an admin action in the AdminAuditLog.
 * Never throws — audit failures must not disrupt the main operation.
 *
 * @param {import('express').Request} req
 * @param {string} action - e.g. "UPDATE_SETTING", "SUSPEND_USER", "DELETE_MESSAGE"
 * @param {string|null} entityType - e.g. "User", "SiteSetting", "ContactMessage"
 * @param {string|null} entityId - ID of the affected entity
 * @param {object|null} details - arbitrary context (before/after values, etc.)
 */
export async function logAdminAction(req, action, entityType, entityId, details) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: req.user.id,
        action,
        entityType: entityType || null,
        entityId: entityId ? String(entityId) : null,
        details: details ? JSON.stringify(details) : null,
        ip: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to log:', err.message);
    // Never let audit failure break the main operation
  }
}
