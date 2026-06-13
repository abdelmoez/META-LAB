/**
 * server/utils/usage.js — best-effort product-usage event recording (prompt9).
 *
 * Powers the ops-console usage metrics (invites pending/accepted, exports by
 * format, emails sent/failed, deletes/leaves, notification clicks).
 *
 * CONTRACT: recordUsage is fire-and-forget and NEVER throws — a metrics
 * failure must never fail or slow the request being measured. UsageEvent has
 * no FKs by design (SecurityEvent/Notification precedent): rows survive the
 * deletion of the users/projects they describe.
 */
import { prisma } from '../db/client.js';

// Typed event constants — use these, never raw strings, at call sites.
export const USAGE = {
  EXPORT: 'EXPORT',
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  PROJECT_DELETED: 'PROJECT_DELETED',
  INVITE_CREATED: 'INVITE_CREATED',
  INVITE_ACCEPTED: 'INVITE_ACCEPTED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  NOTIFICATION_CLICKED: 'NOTIFICATION_CLICKED',
};

/**
 * recordUsage — write one UsageEvent row, best-effort.
 * Fire-and-forget: not awaited by callers, swallows every error.
 *
 * @param {{
 *   type: string,                 // one of USAGE.* (required; no-op when missing)
 *   userId?: string|null,
 *   screenProjectId?: string|null,
 *   metaLabProjectId?: string|null,
 *   format?: string|null,         // export format (csv|json|ris|png|svg|...)
 *   meta?: object|string|null,    // JSON-serialisable context (objects are stringified)
 * }} event
 */
export function recordUsage({ type, userId, screenProjectId, metaLabProjectId, format, meta } = {}) {
  if (!type) return;
  try {
    let metaStr = null;
    if (meta != null) {
      try {
        metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
      } catch { metaStr = null; }
    }
    prisma.usageEvent.create({
      data: {
        type: String(type),
        userId: userId || null,
        screenProjectId: screenProjectId || null,
        metaLabProjectId: metaLabProjectId || null,
        format: format || null,
        meta: metaStr ? metaStr.slice(0, 4000) : null,
      },
    }).catch(() => {});
  } catch { /* usage metrics are a side-effect, never a failure mode */ }
}
