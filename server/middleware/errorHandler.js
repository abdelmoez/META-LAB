/**
 * errorHandler.js
 * Global Express error handler. Must be mounted LAST via app.use().
 * Returns a consistent JSON error shape: { error: string }.
 *
 * 93.md §4.11/§5.1 — 5xx responses include the request correlation id (safe:
 * random, no user data) so a beta tester can quote it in a bug report, and the
 * error is forwarded to the DSN-gated error tracker with privacy-scrubbed
 * context. Stack traces are never exposed to clients.
 */
import { captureException } from '../services/errorTracking.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    // Log full error internally but never expose stack traces to clients
    console.error('[error]', req?.id ? `[${req.id}]` : '', err);
    captureException(err, {
      requestId: req?.id,
      route: req?.originalUrl ? String(req.originalUrl).split('?')[0] : undefined,
      method: req?.method,
      status,
      userId: req?.user?.id,
    });
    return res.status(status).json({ error: 'Internal server error', requestId: req?.id });
  }

  // For 4xx, the message is safe to expose (set intentionally by route handlers)
  const message = err.message || 'Bad request';
  res.status(status).json({ error: message });
}
