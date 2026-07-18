/**
 * errorReporting.js — 77.md §9 (observability + crash containment).
 *
 * Lightweight, dependency-free client error reporting. There is no third-party
 * observability SDK in this project, so this routes structured, PRIVACY-SAFE error
 * events through the existing console channel and (best-effort) a same-origin beacon.
 *
 * It NEVER captures manuscript content, extracted health data, PDF bytes, tokens, or
 * other sensitive payloads — only route/engine, browser+version, release id, a
 * correlation id, and the error name/message/stack (stack to console only, never shown
 * to the user and never beaconed).
 */

/** Short, human-quotable correlation id for support ("error id: a1b2-c3d4"). */
export function newCorrelationId() {
  const rnd = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${rnd()}-${rnd()}`;
}

/** The build/release id if the version-gen step injected one, else 'dev'. */
export function releaseId() {
  try {
    const meta = typeof document !== 'undefined' && document.querySelector('meta[name="app-version"]');
    if (meta && meta.content) return meta.content;
  } catch { /* ignore */ }
  try { if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__; } catch { /* ignore */ }
  return 'dev';
}

/** A privacy-safe browser tag (name + major version), for grouping crashes. */
export function browserTag() {
  try {
    const ua = navigator.userAgent || '';
    const m = ua.match(/(Firefox|Edg|Chrome|Safari|Version)\/(\d+)/g) || [];
    return (m.join(' ') || ua).slice(0, 120);
  } catch { return 'unknown'; }
}

/** Current route path (no query — query can carry ids we don't want to log verbatim). */
function routePath() {
  try { return window.location.pathname; } catch { return ''; }
}

/**
 * reportClientError(error, context) — emit ONE structured, privacy-safe error event.
 * Returns the correlationId so a boundary can show it to the user.
 * @param {any} error
 * @param {{ boundary?:string, engine?:string, kind?:string, correlationId?:string }} [context]
 */
export function reportClientError(error, context = {}) {
  const correlationId = context.correlationId || newCorrelationId();
  const event = {
    kind: context.kind || 'render-crash',
    boundary: context.boundary || 'unknown',
    engine: context.engine || undefined,
    route: routePath(),
    release: releaseId(),
    browser: browserTag(),
    correlationId,
    name: (error && error.name) || 'Error',
    message: String((error && error.message) || error || 'Unknown error').slice(0, 300),
  };
  // Detail (incl. stack) stays in the console — never shown to users, never beaconed.
  // eslint-disable-next-line no-console
  console.error('[client-error]', event, error);
  // 93.md §5.1 — forward to Sentry when (and only when) the DSN-gated client is
  // installed (src/frontend/monitoring/sentryClient.js). Same privacy contract.
  try {
    if (typeof window !== 'undefined' && typeof window.__pecanSentryCapture === 'function') {
      window.__pecanSentryCapture(error, event);
    }
  } catch { /* telemetry is always best-effort */ }
  try {
    const body = JSON.stringify(event);
    if (navigator && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }));
    }
  } catch { /* beacon is best-effort; never throw from the error path */ }
  return correlationId;
}

const CHUNK_RELOAD_FLAG = 'pecan.chunkReloadAt';

/** True when an error looks like a failed dynamic import / stale content-hashed chunk. */
export function isChunkLoadError(err) {
  const msg = String((err && (err.message || err)) || '');
  return /dynamically imported module|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(msg);
}

/**
 * maybeReloadForStaleChunk(err) — after a deploy the content-hashed chunk filenames
 * change, so a client on an already-loaded page can get a rejected import() for a route
 * it hasn't fetched yet. Reload ONCE (guarded by a sessionStorage timestamp) to pick up
 * the new manifest; never loop. Returns true if it triggered a reload.
 */
export function maybeReloadForStaleChunk(err) {
  if (!isChunkLoadError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG) || 0);
    // Allow at most one reload per 30s window so a genuinely-missing chunk can't loop.
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
    reportClientError(err, { kind: 'chunk-load', boundary: 'global' });
    window.location.reload();
    return true;
  } catch { return false; }
}

let installed = false;
/** Install global window error + unhandledrejection handlers (idempotent). */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Vite emits this when a dynamic import fails to load (the primary post-deploy case).
  window.addEventListener('vite:preloadError', (e) => {
    if (maybeReloadForStaleChunk((e && e.payload) || e)) e.preventDefault && e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    if (maybeReloadForStaleChunk(reason)) return;
    reportClientError(reason, { kind: 'unhandledrejection', boundary: 'global' });
  });
  window.addEventListener('error', (e) => {
    // Only the interesting script errors — ignore ResourceLoad errors on <img>/<link>
    // which surface here without an `error` object.
    if (e && e.error) reportClientError(e.error, { kind: 'window-error', boundary: 'global' });
  });
}
