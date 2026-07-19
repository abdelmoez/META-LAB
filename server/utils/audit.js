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
 * @param {{reason?: string|null, bulkOperationId?: string|null}} [extra] -
 *   95.md Phase 12 — first-class correlation columns (queryable, unlike the
 *   details JSON). requestId is stamped automatically from the 93.md
 *   request-correlation middleware (req.id).
 */
export async function logAdminAction(req, action, entityType, entityId, details, extra = {}) {
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
        reason: extra.reason ? String(extra.reason).slice(0, 500) : null,
        requestId: req.id || null,
        bulkOperationId: extra.bulkOperationId || null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to log:', err.message);
    // Never let audit failure break the main operation
  }
}
