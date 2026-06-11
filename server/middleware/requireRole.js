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

/**
 * requireTargetEditable — target-role guard for the mutating /users/:id routes.
 *
 * requireAdminOrMod MUST run before this middleware: req.user.role is then the
 * DB-verified actor role (never the JWT claim). Admins manage everyone and pass
 * straight through. Mods may only mutate ORDINARY users (role 'user') — admin
 * and mod targets (including the mod themselves via these admin endpoints;
 * self-service edits belong to /api/profile) are rejected with 403 plus a
 * MOD_TARGET_DENIED SecurityEvent.
 *
 * On success the loaded target is attached as req.targetUser so handlers can
 * skip a second lookup if they want (handlers do not depend on it).
 */
export async function requireTargetEditable(req, res, next) {
  // requireAuth + requireAdminOrMod must run first
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  // Admins manage everyone — no target check needed.
  if (req.user.role === 'admin') return next();

  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role !== 'user') {
      await prisma.securityEvent.create({
        data: {
          type: 'MOD_TARGET_DENIED',
          userId: req.user.id,
          email: req.user.email,
          ip: req.ip,
          userAgent: req.get('user-agent') || null,
          details: JSON.stringify({ path: req.path, targetId: target.id, targetRole: target.role }),
        },
      }).catch(() => {}); // never fail on log error
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    req.targetUser = target;
    next();
  } catch (err) {
    console.error('[requireTargetEditable] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
