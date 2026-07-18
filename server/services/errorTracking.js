/**
 * errorTracking.js — DSN-gated Sentry integration for the API (93.md §5.1).
 *
 * Design constraints (all from 93.md):
 *   - Disabled safely when SENTRY_DSN is unset: zero SDK import cost, zero
 *     network calls, and every exported function is a cheap no-op.
 *   - Sentry failure must NEVER crash or slow the application: the SDK is
 *     loaded lazily inside try/catch and every capture call is guarded.
 *   - Sensitive-data scrubbing: no cookies, auth headers, tokens, request
 *     bodies (may contain manuscript/research content), or query strings are
 *     ever sent. We build minimal event context by hand instead of trusting
 *     SDK defaults.
 *   - Release tagging via the build's version.json; environment via
 *     SENTRY_ENVIRONMENT || NODE_ENV so staging and production stay separate.
 *
 * Wiring (server/index.js): initErrorTracking() at boot; captureException()
 * from the global errorHandler and the process-level guards.
 */
import { getVersion } from '../version.js';

let sentry = null;        // the loaded SDK module, when enabled
let initStarted = false;

export function errorTrackingEnabled() {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Initialize Sentry if (and only if) SENTRY_DSN is configured. Async and
 * fire-and-forget from the caller's perspective; failures log one line and
 * leave the app fully functional.
 */
export async function initErrorTracking() {
  if (initStarted || !errorTrackingEnabled()) return;
  initStarted = true;
  try {
    const Sentry = await import('@sentry/node');
    const { version, commit } = getVersion();
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: commit ? `pecanrev@${version}+${commit}` : `pecanrev@${version}`,
      // Conservative tracing (93.md): default OFF; opt in via env.
      tracesSampleRate: Math.min(1, Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0)),
      // No default PII (IPs, cookies, headers). We add safe context ourselves.
      sendDefaultPii: false,
      // Final privacy gate: strip anything request-shaped the SDK gathered.
      beforeSend(event) {
        try {
          if (event.request) {
            delete event.request.cookies;
            delete event.request.headers;
            delete event.request.data;         // bodies may hold research content
            if (typeof event.request.query_string !== 'undefined') delete event.request.query_string;
            if (typeof event.request.url === 'string') {
              // Never leak single-use tokens that ride in URLs.
              event.request.url = event.request.url
                .replace(/([?&](?:token|invite|t)=)[^&#]+/gi, '$1<redacted>')
                .split('?')[0];
            }
          }
          delete event.user; // we attach only the internal user id as a tag below
        } catch { /* scrubbing must never throw */ }
        return event;
      },
    });
    sentry = Sentry;
    console.log(`[sentry] enabled (env=${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'}, release=pecanrev@${version})`);
  } catch (e) {
    console.error('[sentry] init failed — continuing WITHOUT error tracking:', e?.message || e);
    sentry = null;
  }
}

/**
 * Report an exception with minimal, privacy-safe context. `ctx` may carry
 * { requestId, route, method, status, userId } — all internal identifiers,
 * never content. Always safe to call; never throws.
 */
export function captureException(err, ctx = {}) {
  if (!sentry) return;
  try {
    sentry.withScope((scope) => {
      if (ctx.requestId) scope.setTag('request_id', String(ctx.requestId).slice(0, 64));
      if (ctx.route) scope.setTag('route', String(ctx.route).slice(0, 200));
      if (ctx.method) scope.setTag('method', String(ctx.method).slice(0, 10));
      if (ctx.status) scope.setTag('status', String(ctx.status).slice(0, 6));
      // Internal user id only (93.md: never emails/names into error reports).
      if (ctx.userId) scope.setUser({ id: String(ctx.userId).slice(0, 64) });
      sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch { /* never let telemetry take the app down */ }
}

/** Flush pending events with a hard time bound (used during graceful shutdown). */
export async function flushErrorTracking(timeoutMs = 2000) {
  if (!sentry) return;
  try { await sentry.flush(timeoutMs); } catch { /* best-effort */ }
}
