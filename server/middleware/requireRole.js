import { prisma } from '../db/client.js';

/**
 * requireRole — Express middleware factory that enforces a DB-verified role.
 *
 * requireAuth MUST run before any middleware produced here (depends on req.user).
 * The role is ALWAYS verified against the database — the JWT is never trusted for
 * authorization decisions. On success, req.user.role is set to the real DB role so
 * downstream handlers (and audit logs) see the authoritative value.
 *
 * @param {string[]} allowedRoles - roles permitted to proceed, e.g. ['admin'] or ['admin','mod']
 */
export function requireRole(allowedRoles) {
  const allowed = new Set(allowedRoles);

  return async function roleGuard(req, res, next) {
    // requireAuth must run first — this middleware depends on req.user being set
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    try {
      // Always verify role from DB (don't trust JWT alone for privileged access)
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, suspended: true },
      });

      if (!user || user.suspended || !allowed.has(user.role)) {
        await prisma.securityEvent.create({
          data: {
            type: 'ADMIN_ACCESS_DENIED',
            userId: req.user.id,
            email: req.user.email,
            ip: req.ip,
            userAgent: req.get('user-agent') || null,
            details: JSON.stringify({ path: req.path, required: allowedRoles, actual: user?.role || null }),
          },
        }).catch(() => {}); // never fail on log error
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Attach the authoritative DB role for downstream handlers + audit
      req.user.role = user.role;
      next();
    } catch (err) {
      console.error('[requireRole] error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * requireAdminOrMod — allow either admin or mod (DB-verified, not suspended).
 * Used to gate moderator-accessible routes (user management, contact messages).
 */
export const requireAdminOrMod = requireRole(['admin', 'mod']);
