/**
 * server/security/headers.js — centralized non-CSP security/response headers
 * (prompt 52). Complements server/security/csp.js (which owns CSP) so there is a
 * single, auditable source of truth for the whole security-header surface and no
 * competing systems.
 *
 * Scope of this module:
 *  - helmetOptions(): the helmet baseline. CSP is left to cspMiddleware
 *    (contentSecurityPolicy:false → never two CSP headers). frameguard is DENY so
 *    X-Frame-Options agrees with the CSP `frame-ancestors 'none'` (no contradictory
 *    frame policy). helmet already strips Express's X-Powered-By and sets nosniff,
 *    Referrer-Policy: no-referrer, COOP/CORP same-origin, HSTS, Origin-Agent-Cluster.
 *  - apiNoStore: dynamic, user-specific /api JSON must not be cached by shared or
 *    browser caches (defense in depth; downloads/PDF set their own Cache-Control
 *    and override this).
 *  - publicVersion(): the product version is intentionally public, but build
 *    metadata (commit hash, commit/build dates) is fingerprinting — restrict it to
 *    authenticated callers.
 *
 * Fingerprinting note: the app emits NO Server / X-Powered-By / version /
 * timing / internal-host header. A reverse proxy (nginx, etc.) may add its own
 * `Server:`; that is removed at the proxy (`server_tokens off;` + `proxy_hide_header`),
 * not here — see docs/manager/http-header-hardening.md.
 */

/**
 * helmet configuration. Pure data so it is trivially unit-testable.
 * @returns {import('helmet').HelmetOptions}
 */
export function helmetOptions() {
  return {
    // CSP is owned by cspMiddleware (server/security/csp.js) — disable helmet's so
    // exactly one Content-Security-Policy header is ever emitted.
    contentSecurityPolicy: false,
    // X-Frame-Options: DENY to match the CSP `frame-ancestors 'none'`. The
    // authenticated inline-PDF route overrides this to SAMEORIGIN per-response
    // (server/screening/pdfFraming.js) so it can still be embedded same-origin.
    frameguard: { action: 'deny' },
  };
}

/**
 * Express middleware: mark /api responses no-store so dynamic, often user-specific
 * JSON is never cached by a shared/browser cache. Handlers that set their own
 * Cache-Control (PDF stream, file downloads, SSE) run later and override this.
 */
export function apiNoStore(req, res, next) {
  const p = req.path || '';
  if (p === '/api' || p.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

/**
 * Reduce full build metadata to the publicly-safe subset. The product version is
 * an intentional, user-facing release identifier; the commit hash and build dates
 * are build/deploy fingerprinting and must not be exposed to anonymous callers.
 * @param {{name?:string, version?:string}} meta
 * @returns {{name:string, version:string}}
 */
export function publicVersion(meta) {
  const m = meta || {};
  return { name: m.name || 'PecanRev', version: m.version || '0.0.0' };
}
