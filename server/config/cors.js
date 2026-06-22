/**
 * server/config/cors.js
 *
 * Single source of truth for the CORS policy. Extracted from server/index.js
 * (roadmap 0.3) so the env-driven resolution is unit-testable without booting
 * the Express server.
 *
 * Precedence / allowlist: CORS_ORIGIN (one origin, OR a comma-separated list for
 * www + apex + a deliberate preview origin) ∪ APP_BASE_URL → falling back to the
 * local Vite dev server when nothing is set. Never hard-code a production host
 * here; deployment sets CORS_ORIGIN.
 *
 * Credentialed CORS (cookies) MUST NOT be combined with a wildcard origin — so
 * the delegate below echoes a request's origin ONLY when it is in the explicit
 * allowlist, and never `*`.
 */

/** Strip trailing slashes/whitespace so an allowlist entry matches the Origin header. */
function normalizeOrigin(o) {
  return String(o || '').trim().replace(/\/+$/, '');
}

/**
 * Back-compat single-origin resolver (unchanged behaviour; still used by callers
 * and the existing guard test). Prefer resolveCorsAllowlist for new code.
 */
export function resolveCorsOrigin(env = process.env) {
  return env.CORS_ORIGIN || env.APP_BASE_URL || 'http://localhost:3000';
}

/**
 * The explicit, de-duplicated allowlist of permitted browser origins. Parses
 * CORS_ORIGIN as a comma-separated list (so `https://pecanrev.com,https://www.pecanrev.com`
 * both work), unions APP_BASE_URL, and defaults to the dev origin when empty.
 */
export function resolveCorsAllowlist(env = process.env) {
  const set = new Set();
  for (const o of String(env.CORS_ORIGIN || '').split(',').map(normalizeOrigin).filter(Boolean)) set.add(o);
  const base = normalizeOrigin(env.APP_BASE_URL);
  if (base) set.add(base);
  if (set.size === 0) set.add('http://localhost:3000');
  return [...set];
}

/**
 * `origin` delegate for the cors() middleware. Allows requests WITHOUT an Origin
 * header (same-origin navigations, curl, server-to-server, health checks — not
 * browser cross-origin requests), and allows a browser cross-origin request only
 * when its Origin is in the allowlist. A non-match resolves to `false` (no CORS
 * headers → the browser blocks it) rather than throwing (which would 500 the
 * request). Never returns a wildcard.
 */
export function corsOriginDelegate(env = process.env) {
  const allow = resolveCorsAllowlist(env);
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, allow.includes(normalizeOrigin(origin)));
  };
}
