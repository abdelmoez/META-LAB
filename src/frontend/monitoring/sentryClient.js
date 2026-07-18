/**
 * sentryClient.js — DSN-gated Sentry for the SPA (93.md §5.1).
 *
 * Loaded from main.jsx at boot. When VITE_SENTRY_DSN is unset (the default,
 * including every local dev build) this module does NOTHING and the @sentry/react
 * chunk is never even downloaded (dynamic import → separate lazy chunk).
 *
 * Privacy contract (93.md): no manuscript/research content, no tokens, no
 * cookies, no form values, no file contents. We forward only what the existing
 * privacy-safe funnel (errorReporting.reportClientError) already collects, and
 * scrub URLs/breadcrumbs of query strings. Session replay is NOT enabled — the
 * integration is deliberately never registered (93.md §5.3: replay must stay
 * off unless explicitly configured with full masking; revisit only then).
 */
import { releaseId } from '../components/errorReporting.js';

export async function initSentryClient() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'production',
      release: `pecanrev@${releaseId()}`,
      sendDefaultPii: false,
      // Conservative-by-default performance tracing (93.md): off unless set.
      tracesSampleRate: Math.min(1, Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE) || 0)),
      beforeSend(event) {
        try {
          if (event.request && typeof event.request.url === 'string') {
            event.request.url = event.request.url.split('?')[0];
          }
          delete event.user; // anonymous by default; internal id only via tags if ever needed
        } catch { /* scrubbing must never throw */ }
        return event;
      },
      beforeBreadcrumb(crumb) {
        try {
          // Navigation/fetch breadcrumbs can carry query strings (?token=…) —
          // keep only the path. Console breadcrumbs may quote content — drop them.
          if (crumb.category === 'console') return null;
          if (crumb.data && typeof crumb.data.url === 'string') {
            crumb.data.url = crumb.data.url.split('?')[0];
          }
          if (typeof crumb.message === 'string') crumb.message = crumb.message.slice(0, 200);
        } catch { /* ignore */ }
        return crumb;
      },
    });
    // Bridge: errorReporting.reportClientError forwards every captured error
    // (render crashes from boundaries, unhandled rejections, window errors)
    // through this hook — one funnel, one privacy policy.
    window.__pecanSentryCapture = (error, ctx = {}) => {
      try {
        Sentry.withScope((scope) => {
          if (ctx.kind) scope.setTag('kind', String(ctx.kind).slice(0, 40));
          if (ctx.boundary) scope.setTag('boundary', String(ctx.boundary).slice(0, 80));
          if (ctx.engine) scope.setTag('engine', String(ctx.engine).slice(0, 60));
          if (ctx.route) scope.setTag('route', String(ctx.route).slice(0, 200));
          if (ctx.correlationId) scope.setTag('correlation_id', String(ctx.correlationId).slice(0, 64));
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      } catch { /* telemetry must never break the app */ }
    };
  } catch (e) {
    // SDK failed to load (offline, adblock, bad DSN) — the app must not care.
    console.warn('[sentry] client init failed — continuing without error tracking:', e?.message || e);
  }
}
