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
 * requirePermission — placeholder for finer-grained, action-level checks.
 * Currently maps a small set of named permissions to a role set. Admins always pass.
 * Mods pass for permissions explicitly granted to them.
 *
 * @param {string} permission - e.g. 'manage_users', 'reply_messages'
 */
const MOD_PERMISSIONS = new Set([
  'manage_users',     // edit name/email, status, reset password (NOT role/delete)
  'view_users',
  'reply_messages',
  'manage_messages',
]);

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
