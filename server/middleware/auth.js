import { verifyToken } from '../auth/jwt.js';
import { prisma } from '../db/client.js';
import { recordUsage, USAGE } from '../utils/usage.js';
import { sessionCookieName, clearSessionCookieOptions } from '../config/cookies.js';

const COOKIE_NAME = sessionCookieName();

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
  // prompt15 follow-up — also drop one APP_ACTIVE event behind the SAME throttle
  // (≤1/user/5min) so the ops console can chart per-day active users over time.
  recordUsage({ type: USAGE.APP_ACTIVE, userId });
}

// ── Session revocation state (prompt49) ────────────────────────────────────────
// Stateless JWTs can't be deleted server-side, so on every authenticated request
// we check the user's live `suspended` flag and `sessionEpoch` against the DB.
// A short in-memory cache keeps this to ~1 DB read per user per TTL; suspend /
// password-change call invalidateAuthState() so revocation is effectively instant.
const AUTH_STATE_TTL_MS = 15 * 1000;
const authStateCache = new Map(); // userId -> { suspended, sessionEpoch, exp }

/** Drop the cached auth state for a user so the next request re-reads the DB. */
export function invalidateAuthState(userId) {
  if (userId) authStateCache.delete(userId);
}

async function loadAuthState(userId) {
  const cached = authStateCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { suspended: true, sessionEpoch: true },
  });
  if (!user) { authStateCache.delete(userId); return null; }
  const rec = { suspended: !!user.suspended, sessionEpoch: user.sessionEpoch ?? 0, exp: Date.now() + AUTH_STATE_TTL_MS };
  authStateCache.set(userId, rec);
  return rec;
}

/**
 * requireAuth — Express middleware that enforces authentication.
 * Reads the httpOnly cookie `metalab_session`, verifies the JWT, then checks the
 * live account state (suspended + sessionEpoch) so suspended users and revoked
 * sessions are rejected promptly across ALL devices — not after a 7-day expiry.
 * Attaches `req.user = { id, email, role }` on success. 401/403 otherwise.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  try {
    const state = await loadAuthState(payload.id);
    if (!state) {
      // User no longer exists — clear the cookie and reject.
      res.clearCookie(COOKIE_NAME, clearSessionCookieOptions());
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (state.suspended) {
      res.clearCookie(COOKIE_NAME, clearSessionCookieOptions());
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' });
    }
    // Tokens issued before this feature have no `se` claim → treated as epoch 0,
    // so existing sessions are NOT force-logged-out on deploy (epoch starts at 0).
    const tokenEpoch = Number.isInteger(payload.se) ? payload.se : 0;
    if (tokenEpoch !== state.sessionEpoch) {
      res.clearCookie(COOKIE_NAME, clearSessionCookieOptions());
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: 'SESSION_REVOKED' });
    }
    req.user = { id: payload.id, email: payload.email, role: payload.role || 'user' };
    touchLastActive(payload.id);
    return next();
  } catch (err) {
    // A transient DB error during the state check must not log everyone out (the
    // app is SQLite/local). Suspended accounts are also blocked at login and on
    // every admin route via requireRole's own DB check, so proceed with the token
    // identity and record the anomaly. Fail-open is bounded to DB-outage windows.
    console.error('[auth] account-state check failed, proceeding on token identity:', err.message);
    req.user = { id: payload.id, email: payload.email, role: payload.role || 'user' };
    return next();
  }
}
