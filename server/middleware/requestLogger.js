/**
 * requestLogger.js
 * Simple console logger middleware — logs method, path, and response status.
 *
 * SECURITY: single-use credential tokens must NEVER be written to logs (80.md
 * Phase 12 / prompt49). Some public token endpoints carry the raw token in the URL
 * (path segment or ?token= query) — the invitation accept/landing, the project
 * invite landing, and any legacy ?token= link. redactUrl() masks those so a raw
 * token can never leak through the access log, referrer, or log aggregation.
 */

// Path prefixes whose FINAL meaningful segment is a raw single-use token.
const TOKEN_PATH_PREFIXES = ['/api/accept-invitation/', '/api/invites/'];

/** Mask raw tokens in a request URL (path segment + ?token= query) for logging. */
export function redactUrl(originalUrl) {
  let url = String(originalUrl || '');
  // 1) ?token=… / &token=… query values (defense-in-depth for any token-in-query link).
  url = url.replace(/([?&](?:token|invite|t)=)[^&#]+/gi, '$1<redacted>');
  // 2) Token as a path segment, e.g. /api/accept-invitation/<hex>[/accept].
  for (const prefix of TOKEN_PATH_PREFIXES) {
    if (url.startsWith(prefix)) {
      const rest = url.slice(prefix.length);
      const slash = rest.indexOf('/');
      const tail = slash >= 0 ? rest.slice(slash) : '';
      url = `${prefix}<token>${tail}`;
      break;
    }
  }
  return url;
}

export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${redactUrl(req.originalUrl)} → ${res.statusCode} (${ms}ms)`);
  });

  next();
}
