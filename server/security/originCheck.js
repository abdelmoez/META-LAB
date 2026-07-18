/**
 * originCheck.js — cross-site request forgery defense-in-depth (93.md §4.6).
 *
 * The PRIMARY CSRF defenses in this app are architectural and already in place:
 *   1. The session cookie is SameSite=Strict (server/config/cookies.js) — a
 *      cross-site request never carries it in any modern browser.
 *   2. CORS is a credentialed explicit allowlist that never echoes a wildcard
 *      (server/config/cors.js), so cross-origin XHR/fetch cannot read responses.
 *   3. Only `express.json` is mounted (no urlencoded parser), so a cross-site
 *      HTML <form> post parses to an empty body.
 *
 * This middleware adds the belt-and-suspenders layer 93.md asks for: on every
 * state-changing request (POST/PUT/PATCH/DELETE) whose `Origin` header is
 * present but NOT in the CORS allowlist, reject with 403 before any handler
 * runs. It also rejects when the browser explicitly labels the request
 * `Sec-Fetch-Site: cross-site`. Requests WITHOUT an Origin header pass —
 * same-origin navigations, curl, server-to-server calls and old clients don't
 * send one, and for those the SameSite cookie remains the effective defense.
 *
 * Exemptions (mounted before this middleware in index.js, listed here for
 * clarity): the CSP report endpoint and the client-error beacon — both are
 * unauthenticated, log-only sinks that legitimately fire from anywhere.
 */
import { resolveCorsAllowlist } from '../config/cors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Normalize an origin for comparison (scheme+host+port, lowercased, no slash). */
function normalizeOrigin(value) {
  try {
    const u = new URL(String(value));
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Build the middleware. The allowlist is resolved once at mount time (it is
 * env-derived and static for the process lifetime) and compared as normalized
 * origins. `sameOriginHosts` additionally accepts the request's own Host —
 * a same-origin browser request always satisfies Origin === scheme://Host.
 */
export function originCheck({ allowlist = resolveCorsAllowlist() } = {}) {
  const allowed = new Set(
    allowlist.map(normalizeOrigin).filter(Boolean)
  );

  return function originCheckMiddleware(req, res, next) {
    if (!MUTATING.has(req.method)) return next();

    // Modern browsers: explicit cross-site fetch metadata → reject outright.
    // ('same-site' — e.g. a sibling subdomain — is intentionally allowed only
    // when the Origin check below also passes.)
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') {
      return res.status(403).json({ error: 'Cross-origin request rejected', code: 'ORIGIN_FORBIDDEN' });
    }

    const rawOrigin = req.headers.origin;
    if (rawOrigin == null || rawOrigin === '' || rawOrigin === 'null') {
      // No Origin (curl, same-origin GET-form navigations, legacy clients) or
      // an opaque origin. SameSite=Strict cookies remain the defense; the
      // opaque-origin 'null' case is also covered by fetch metadata above in
      // every browser new enough to sandbox iframes.
      return next();
    }

    const origin = normalizeOrigin(rawOrigin);
    if (origin && allowed.has(origin)) return next();

    // Same-origin fallback: the deployment origin may not appear in the CORS
    // allowlist env in dev setups; accept when Origin's host equals the Host
    // header (the browser guarantees Origin is not client-spoofable).
    const host = String(req.headers.host || '').toLowerCase();
    if (origin && host && origin.endsWith(`//${host}`)) return next();

    return res.status(403).json({ error: 'Cross-origin request rejected', code: 'ORIGIN_FORBIDDEN' });
  };
}
