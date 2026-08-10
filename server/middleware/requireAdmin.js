import { prisma } from '../db/client.js';
import { requireRole } from './requireRole.js';

/**
 * requireAdmin — Express middleware that enforces admin role.
 * requireAuth MUST run before this middleware (depends on req.user being set).
 * Always verifies role from DB — does not trust JWT alone for admin access.
 *
 * Delegates to requireRole(['admin']) so the DB-verification logic lives in one place.
 */
export const requireAdmin = requireRole(['admin']);

/**
 * requirePermission — finer-grained, action-level checks. Maps a named permission
 * to a role set. Admins always pass. Mods pass for permissions explicitly granted
 * to them.
 *
 * 109.md §39 — this is the capability seam. PecanRev has exactly three system roles
 * (admin | mod | user) and 109 asks for capability SPLITS, not new roles. Rather
 * than inventing a role hierarchy, the Research Governance routes are gated by two
 * named capabilities so the read/write boundary is explicit and enforced by the
 * backend (§56), not by hiding buttons:
 *
 *   view_research_diagnostics  — admin + mod. Read-only job/telemetry inspection.
 *   manage_research_jobs       — admin ONLY. Requeue and any other state change.
 *
 * The mod grant deliberately matches `isFlagAdmin`'s narrower shape (mods never get
 * the feature-flag bypass, featureAccess.js) — mods may LOOK at operational health,
 * they may not change system state.
 *
 * @param {string} permission - e.g. 'manage_users', 'view_research_diagnostics'
 */
const MOD_PERMISSIONS = new Set([
  'manage_users',     // edit name/email, status, reset password (NOT role/delete)
  'view_users',
  'reply_messages',
  'manage_messages',
  // 109.md §39 — read-only operational diagnostics. NOT granted:
  // manage_research_jobs (requeue), flag writes, safety-setting writes.
  'view_research_diagnostics',
  // 112.md follow-up — read-only email template/delivery inspection. NOT granted:
  // manage_email_templates (copy edits, enable/disable, restore, test-send) —
  // mods may LOOK at what the product sends, they may not change it.
  'view_email_delivery',
]);

/** Exported for the authorization unit test — the grant list IS the contract. */
export const MOD_GRANTED_PERMISSIONS = Object.freeze([...MOD_PERMISSIONS]);

export function requirePermission(permission) {
  return async function permissionGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, suspended: true },
      });
      if (!user || user.suspended) return res.status(403).json({ error: 'Forbidden' });

      const ok = user.role === 'admin' || (user.role === 'mod' && MOD_PERMISSIONS.has(permission));
      if (!ok) {
        await prisma.securityEvent.create({
          data: {
            type: 'ADMIN_ACCESS_DENIED',
            userId: req.user.id,
            email: req.user.email,
            ip: req.ip,
            userAgent: req.get('user-agent') || null,
            details: JSON.stringify({ path: req.path, permission, actual: user.role }),
          },
        }).catch(() => {});
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user.role = user.role;
      next();
    } catch (err) {
      console.error('[requirePermission] error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
