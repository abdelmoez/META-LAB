/**
 * errorHandler.js
 * Global Express error handler. Must be mounted LAST via app.use().
 * Returns a consistent JSON error shape: { error: string }.
 */

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    // Log full error internally but never expose stack traces to clients
    console.error('[error]', err);
    return res.status(status).json({ error: 'Internal server error' });
  }

  // For 4xx, the message is safe to expose (set intentionally by route handlers)
  const message = err.message || 'Bad request';
  res.status(status).json({ error: message });
}
