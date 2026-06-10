import { verifyToken } from '../auth/jwt.js';
import { prisma } from '../db/client.js';

const COOKIE_NAME = 'metalab_session';

// ── Throttled lastActive updates (prompt6 Task 10) ─────────────────────────────
// Every meaningful authenticated action (opens app, saves, screens, sends a
// message) flows through requireAuth, so this is the single root-fix hook.
// In-memory throttle: at most one DB write per user per 5 minutes. Process-local
// and reset on restart — worst case one extra write per user per boot.
const LAST_ACTIVE_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const lastActiveWrites = new Map(); // userId -> last-write epoch ms

function touchLastActive(userId) {
  const now = Date.now();
  if (now - (lastActiveWrites.get(userId) || 0) < LAST_ACTIVE_WRITE_INTERVAL_MS) return;
  lastActiveWrites.set(userId, now);
  // Fire-and-forget — NEVER awaited; auth must not slow or fail on this write
  // (e.g. user deleted while their JWT is still valid).
  prisma.user.update({ where: { id: userId }, data: { lastActive: new Date() } }).catch(() => {});
}

/**
 * requireAuth — Express middleware that enforces authentication.
 * Reads the httpOnly cookie `metalab_session`, verifies the JWT,
 * and attaches `req.user = { id, email }` on success.
 * Returns 401 if the cookie is missing or the token is invalid/expired.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, email: payload.email, role: payload.role || 'user' };
    touchLastActive(payload.id);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
