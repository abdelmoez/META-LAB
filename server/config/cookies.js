/**
 * server/config/cookies.js — single source of truth for the session cookie name
 * and attributes (prompt49 item 6 hardening).
 *
 * Centralising this guarantees the SET options and the CLEAR options stay
 * consistent — a cookie only clears when name + Path (+ Domain) match, so a
 * drifting clearCookie would silently fail to log a user out — and that every
 * issue/clear site (login, register, change-password, logout, the auth
 * middleware's reject paths) uses the same Secure / HttpOnly / SameSite policy.
 *
 * Policy:
 *   - HttpOnly   — never readable by JS (XSS can't exfiltrate the session).
 *   - SameSite=Strict — never sent cross-site → CSRF defence-in-depth on top of
 *                  the JSON-only, token-in-cookie API.
 *   - Secure     — HTTPS-only in production (disabled in dev so http://localhost
 *                  works); enforced by NODE_ENV.
 *   - Path=/      — explicit (not relying on the default) so set/clear always match.
 *
 * The cookie NAME stays `metalab_session` (an internal identifier deliberately
 * preserved across the PecanRev rebrand). The `__Host-` prefix is intentionally
 * NOT used: it mandates an HTTPS-only Secure cookie, which would break local
 * http dev and force a coordinated rename that logs out every existing session —
 * a marginal gain over the already-strict flags above. This decision is
 * documented in docs/manager/deployment-config.md and revisited there.
 */
const SESSION_COOKIE_NAME = 'metalab_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function sessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/**
 * Options for clearing the session cookie. Must mirror the SET attributes
 * (name + Path [+ Secure/SameSite]) so the browser actually removes it; maxAge
 * is intentionally omitted (res.clearCookie sets an immediate expiry).
 */
export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
