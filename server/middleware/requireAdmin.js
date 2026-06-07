import { prisma } from '../db/client.js';

/**
 * requireAdmin — Express middleware that enforces admin role.
 * requireAuth MUST run before this middleware (depends on req.user being set).
 * Always verifies role from DB — does not trust JWT alone for admin access.
 */
export async function requireAdmin(req, res, next) {
  // requireAuth must run first — this middleware depends on req.user being set
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  try {
    // Always verify role from DB (don't trust JWT alone for admin access)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, suspended: true },
    });

    if (!user || user.role !== 'admin' || user.suspended) {
      // Log the access denial
      await prisma.securityEvent.create({
        data: {
          type: 'ADMIN_ACCESS_DENIED',
          userId: req.user.id,
          email: req.user.email,
          ip: req.ip,
          userAgent: req.get('user-agent') || null,
          details: JSON.stringify({ path: req.path }),
        },
      }).catch(() => {}); // don't fail on log error
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Attach role for downstream use
    req.user.role = 'admin';
    next();
  } catch (err) {
    console.error('[requireAdmin] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
